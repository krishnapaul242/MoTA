import { ChildProcess, execFile } from 'node:child_process';
import type { Adb, Device } from './adb';

/**
 * Collapsible "ADB console" for the device farm page: run adb commands on the host or on
 * chosen devices, stream their output, and restart a stuck ADB server.
 * Self-contained so the farm page only needs to embed the markup/styles/script and route
 * `console-*` messages here.
 */

/** Splits an adb command line like a shell would (quotes, backslashes) and drops a leading "adb". */
export function parseAdbCommand(line: string): string[] {
  const args: string[] = [];
  let cur = '', quote: string | null = null, has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += c;
    } else if (c === '"' || c === "'") { quote = c; has = true; }
    else if (c === '\\' && i + 1 < line.length) { cur += line[++i]; has = true; }
    else if (/\s/.test(c)) { if (has) { args.push(cur); cur = ''; has = false; } }
    else { cur += c; has = true; }
  }
  if (quote) throw new Error('Unclosed quote in the command.');
  if (has) args.push(cur);
  if (args[0] === 'adb') args.shift();
  return args;
}

/** One argument list per target device, or a single host-level call when no serials are given. */
export function consoleInvocations(args: string[], serials: string[]): { serial?: string; args: string[] }[] {
  if (!args.length) throw new Error('Type an adb command, for example: shell getprop ro.product.model');
  if (serials.length && /^-[a-zA-Z]$/.test(args[0])) throw new Error(`Choose the device in "Run on" instead of passing ${args[0]}.`);
  return serials.length ? serials.map(serial => ({ serial, args: ['-s', serial, ...args] })) : [{ args }];
}

const RISKY = new Set(['reboot', 'uninstall', 'root', 'unroot', 'remount', 'disable-verity', 'enable-verity', 'sideload', 'tcpip', 'usb', 'kill-server', 'emu']);
/** Commands that reboot, wipe, uninstall or cut the connection: ask before running them. */
export function riskyAdbCommand(args: string[]): boolean {
  if (RISKY.has(args[0])) return true;
  if (args[0] !== 'shell') return false;
  return /(^|[\s;&|(])(rm|reboot|wipe|svc\s+power|pm\s+(clear|uninstall)|cmd\s+package\s+uninstall)(\s|$)/.test(args.slice(1).join(' '));
}

const MAX_RUNS = 32, FLUSH_MS = 80;

export class AdbConsole {
  private runs = new Map<number, ChildProcess>();
  private buffers = new Map<number, { err: boolean; text: string }>();
  private flushTimer?: ReturnType<typeof setTimeout>;
  private nextRun = 0;
  private restarting = false;

  constructor(
    private adb: Adb,
    private post: (m: unknown) => void,
    private confirm: (message: string, detail: string, action: string) => Promise<boolean>,
    private afterRestart: () => Promise<void>,
  ) {}

  /** Handles a `console-*` message from the webview. `online` is the farm's available devices. */
  async message(m: any, online: Device[]) {
    if (m.action === 'console-run') return this.run(String(m.line ?? ''), m.target, Array.isArray(m.serials) ? m.serials : [], online);
    if (m.action === 'console-stop') { this.stop(typeof m.run === 'number' ? m.run : undefined); return; }
    if (m.action === 'console-restart') return this.restart();
  }

  dispose() { this.stop(); clearTimeout(this.flushTimer); }

  private async run(line: string, target: unknown, serials: unknown[], online: Device[]) {
    const fail = (text: string) => this.post({ kind: 'console-error', text });
    let args: string[];
    try { args = parseAdbCommand(line); } catch (e) { fail(errorText(e)); return; }
    const pick = (s: unknown) => online.find(d => d.serial === s);
    const targets = target === 'host' ? [] : target === 'all' ? online
      : target === 'selected' ? serials.map(pick).filter((d): d is Device => !!d) : [pick(target)].filter((d): d is Device => !!d);
    if (target !== 'host' && !targets.length) { fail('No available device for that target. Pick another one in "Run on".'); return; }
    let calls: ReturnType<typeof consoleInvocations>;
    try { calls = consoleInvocations(args, targets.map(d => d.serial)); } catch (e) { fail(errorText(e)); return; }
    if (this.runs.size + calls.length > MAX_RUNS) { fail(`Too many commands running. Stop some first (limit ${MAX_RUNS}).`); return; }
    if (riskyAdbCommand(args)) {
      const where = targets.length ? targets.map(d => `${d.model} (${d.serial})`).join('\n') : 'This computer';
      if (!await this.confirm(`Run "adb ${args.join(' ')}" on ${targets.length ? `${targets.length} device${targets.length > 1 ? 's' : ''}` : 'this computer'}?`, where, 'Run')) return;
    }
    this.post({ kind: 'console-accepted', line });
    for (const call of calls) this.start(call.args, call.serial ? targets.find(d => d.serial === call.serial)?.model : undefined);
  }

  private start(args: string[], model?: string) {
    const run = ++this.nextRun, started = Date.now();
    this.post({ kind: 'console-start', run, cmd: 'adb ' + args.map(quote).join(' '), model });
    let child: ChildProcess;
    try { child = this.adb.stream(args); } catch (e) { this.out(run, errorText(e) + '\n', true); this.exit(run, null, started); return; }
    this.runs.set(run, child);
    child.stdout?.setEncoding('utf8').on('data', (t: string) => this.out(run, t, false));
    child.stderr?.setEncoding('utf8').on('data', (t: string) => this.out(run, t, true));
    let done = false;
    const finish = (code: number | null) => { if (done) return; done = true; this.runs.delete(run); this.exit(run, code, started); };
    child.on('error', e => { this.out(run, errorText(e) + '\n', true); finish(null); });
    child.on('close', code => finish(code));
  }

  private stop(run?: number) {
    for (const [id, child] of this.runs) if (run === undefined || id === run) child.kill();
  }

  /** Stops the ADB server (force-stopping it if it no longer answers) and starts a fresh one. */
  private async restart() {
    if (this.restarting) return;
    this.restarting = true;
    const run = ++this.nextRun, started = Date.now();
    const log = (t: string, err = false) => this.out(run, t + '\n', err);
    this.post({ kind: 'console-start', run, cmd: 'Restart ADB server' });
    let code = 0;
    try {
      try { await this.adb.run(['kill-server'], 5000); log('Stopped the ADB server.'); }
      catch (e) { log(`kill-server did not finish (${errorText(e)}). Force-stopping adb…`, true); await forceStopAdbServer(); }
      await new Promise(r => setTimeout(r, 500));
      await this.adb.run(['start-server'], 20000);
      log('Started a fresh ADB server.');
      const found = await this.adb.devices();
      log(`${found.length} device${found.length === 1 ? '' : 's'} attached. Wi-Fi devices may need to reconnect.`);
    } catch (e) { log(errorText(e), true); code = 1; }
    finally { this.restarting = false; }
    this.exit(run, code, started);
    await this.afterRestart();
  }

  private out(run: number, text: string, err: boolean) {
    const b = this.buffers.get(run);
    if (b && b.err !== err) this.flush();
    const cur = this.buffers.get(run);
    if (cur) cur.text += text; else this.buffers.set(run, { err, text });
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }
  private flush() {
    clearTimeout(this.flushTimer); this.flushTimer = undefined;
    for (const [run, b] of this.buffers) this.post({ kind: 'console-out', run, text: b.text, err: b.err });
    this.buffers.clear();
  }
  private exit(run: number, code: number | null, started: number) {
    this.flush();
    this.post({ kind: 'console-exit', run, code, ms: Date.now() - started });
  }
}

function quote(a: string) { return /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`; }
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Last resort when the server accepts connections but never answers (seen after days of uptime). */
function forceStopAdbServer() {
  const [cmd, args] = process.platform === 'win32' ? ['taskkill', ['/F', '/IM', 'adb.exe']] : ['pkill', ['-f', 'adb.*fork-server']];
  return new Promise<void>(resolve => execFile(cmd as string, args as string[], { timeout: 5000, windowsHide: true }, () => resolve()));
}

export const consoleStyles = `
.adbcon{margin:0 0 16px;border:1px solid var(--vscode-panel-border);border-radius:12px;background:var(--vscode-sideBar-background)}
.adbcon>summary{padding:10px 14px;display:flex;gap:10px;align-items:center;list-style:none;user-select:none}
.adbcon>summary::-webkit-details-marker{display:none}
.adbcon>summary::before{content:'▸';display:inline-block;transition:transform .15s;color:var(--vscode-descriptionForeground)}
.adbcon[open]>summary::before{transform:rotate(90deg)}
.adbcon>summary .muted{font-size:12px}
.adbcon .badge{margin-left:auto}
.conbody{padding:0 14px 14px;display:flex;flex-direction:column;gap:10px}
.conbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.conbar small{margin-right:4px}
.conform{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.conform select{max-width:240px}
.conline{flex:1;min-width:220px;display:flex;align-items:center;border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:4px;background:var(--vscode-input-background)}
.conline:focus-within{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
.conline span{padding-left:8px;font-family:var(--vscode-editor-font-family);color:var(--vscode-descriptionForeground)}
.conline input{flex:1;border:0;outline:0;font-family:var(--vscode-editor-font-family)}
.consnip{display:flex;gap:6px;flex-wrap:wrap}
.consnip button{font-family:var(--vscode-editor-font-family);font-size:11px;padding:3px 8px}
.conout{max-height:420px;overflow:auto;border-radius:8px;background:var(--vscode-terminal-background,var(--vscode-textCodeBlock-background));font-family:var(--vscode-editor-font-family);font-size:12px}
.conout:empty::before{content:'Output appears here.';display:block;padding:12px;color:var(--vscode-descriptionForeground)}
.crun{border-bottom:1px solid var(--vscode-panel-border);padding:8px 12px}
.crun:last-child{border-bottom:0}
.crunhead{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.crunhead code{font-weight:600;overflow-wrap:anywhere}
.crunhead .who{color:var(--vscode-descriptionForeground)}
.crunhead .rs{margin-left:auto;font-size:11px;color:var(--vscode-descriptionForeground)}
.crunhead .rs.bad{color:var(--vscode-errorForeground)}.crunhead .rs.good{color:var(--vscode-testing-iconPassed,#3fb950)}
.crunhead button{padding:2px 8px;font-size:11px}
.crun pre{margin:6px 0 0;padding:0;background:none;max-height:none;overflow:visible;white-space:pre-wrap}
.crun pre:empty{display:none}
.crun .e{color:var(--vscode-errorForeground)}
.conerr{color:var(--vscode-errorForeground);font-size:12px;min-height:0;margin:0}
`;

export const consoleMarkup = `<details class="adbcon" id="adbcon"><summary><b>ADB console</b><span class="muted">Run adb commands and manage the ADB server</span><span class="badge" id="conbadge" hidden></span></summary>
<div class="conbody">
<div class="conbar"><small class="muted">Server</small>
<button class="small secondary" data-con-restart title="Stop the ADB server (force-stop it if it is stuck) and start a fresh one">Restart server</button>
<button class="small secondary" data-con-host="reconnect offline" title="adb reconnect offline">Reconnect offline</button>
<button class="small secondary" data-con-host="devices -l">List devices</button>
<button class="small secondary" data-con-host="mdns services">Wi-Fi discovery</button>
<button class="small secondary" data-con-host="version">Version</button></div>
<form class="conform" id="conform">
<select id="contarget" aria-label="Run on"></select>
<label class="conline"><span>adb</span><input id="conline" placeholder="shell getprop ro.build.version.release" autocomplete="off" spellcheck="false" aria-label="adb command"></label>
<button class="small">Run</button><button type="button" class="small secondary" data-con-stop disabled id="constopall">Stop all</button><button type="button" class="small secondary" data-con-clear>Clear</button></form>
<div class="consnip" aria-label="Examples"><small class="muted">Try</small>
<button type="button" class="secondary" data-con-snip="shell getprop ro.product.model">getprop model</button>
<button type="button" class="secondary" data-con-snip="shell dumpsys battery">battery</button>
<button type="button" class="secondary" data-con-snip="shell wm size">screen size</button>
<button type="button" class="secondary" data-con-snip="shell pm list packages -3">3rd-party apps</button>
<button type="button" class="secondary" data-con-snip="shell dumpsys activity activities | grep -m1 mResumedActivity">current activity</button>
<button type="button" class="secondary" data-con-snip="logcat -d -t 200">last 200 log lines</button>
<button type="button" class="secondary" data-con-snip="get-state">get-state</button></div>
<p class="conerr" id="conerr" role="alert"></p>
<div class="conout" id="conout" role="log" aria-live="polite"></div>
</div></details>`;

/** Webview script; relies on the farm page's `api`, `$`, `esc`, `devices` and `selected`. */
export const consoleScript = `
(()=>{const st=Object.assign({open:false,target:'all',history:[]},api.getState()?.adbConsole||{});let hi=-1;const running=new Set();
const save=()=>{try{api.setState({...(api.getState()||{}),adbConsole:{open:$('adbcon').open,target:$('contarget').value,history:st.history.slice(-50)}});}catch{}};
$('adbcon').open=st.open;$('adbcon').addEventListener('toggle',()=>{save();if($('adbcon').open)targets();});
function targets(){const sel=$('contarget'),prev=sel.value||st.target,on=devices.filter(d=>d.state==='device'),n=[...selected].filter(s=>on.some(d=>d.serial===s)).length;
 const opts=[['all','All available ('+on.length+')',!on.length],['selected','Selected devices ('+n+')',!n],...on.map(d=>[d.serial,d.model+' · '+d.serial,false]),['host','This computer (no device)',false]];
 sel.innerHTML=opts.map(([v,l,dis])=>'<option value="'+esc(v)+'"'+(dis?' disabled':'')+'>'+esc(l)+'</option>').join('');
 const ok=opts.find(o=>o[0]===prev&&!o[2]);sel.value=ok?prev:(on.length?'all':'host');}
$('contarget').addEventListener('focus',targets);$('contarget').addEventListener('mousedown',targets);$('contarget').addEventListener('change',()=>{st.target=$('contarget').value;save();});
function busy(){$('constopall').disabled=!running.size;const b=$('conbadge');b.hidden=!running.size;b.textContent=running.size+' running';}
function send(line,target){$('conerr').textContent='';api.postMessage({action:'console-run',line,target,serials:[...selected]});}
function runLine(){const line=$('conline').value.trim();if(!line)return;send(line,$('contarget').value);}
$('conform').addEventListener('submit',e=>{e.preventDefault();runLine();});
$('conline').addEventListener('keydown',e=>{const h=st.history;if(e.key==='ArrowUp'&&h.length){hi=hi<0?h.length-1:Math.max(0,hi-1);$('conline').value=h[hi];e.preventDefault();}
 else if(e.key==='ArrowDown'&&hi>=0){hi++;$('conline').value=hi<h.length?h[hi]:'';if(hi>=h.length)hi=-1;e.preventDefault();}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-con-host],[data-con-snip],[data-con-restart],[data-con-stop],[data-con-clear],[data-con-run-stop],[data-con-open]');if(!b)return;
 if(b.dataset.conOpen!==undefined){$('adbcon').open=true;$('adbcon').scrollIntoView({behavior:'smooth',block:'start'});}
 if(b.dataset.conHost)send(b.dataset.conHost,'host');
 else if(b.dataset.conSnip){$('conline').value=b.dataset.conSnip;$('conline').focus();}
 else if(b.dataset.conRestart!==undefined){$('adbcon').open=true;api.postMessage({action:'console-restart'});}
 else if(b.dataset.conStop!==undefined)api.postMessage({action:'console-stop'});
 else if(b.dataset.conClear!==undefined){for(const el of [...$('conout').children])if(!running.has(+el.dataset.run))el.remove();}
 else if(b.dataset.conRunStop)api.postMessage({action:'console-stop',run:+b.dataset.conRunStop});});
const runEl=r=>$('conout').querySelector('.crun[data-run="'+r+'"]');
function stick(fn){const o=$('conout'),bottom=o.scrollHeight-o.scrollTop-o.clientHeight<40;fn();if(bottom)o.scrollTop=o.scrollHeight;}
window.addEventListener('message',e=>{const m=e.data;if(!m||typeof m.kind!=='string')return;
 if(m.kind==='devices'){if($('adbcon').open&&document.activeElement!==$('contarget'))targets();
  if(m.error&&!$('error').querySelector('[data-con-restart]'))$('error').insertAdjacentHTML('beforeend',' <button class="small" data-con-restart>Restart ADB server</button> <button class="small secondary" data-con-open>Open ADB console</button>');}
 else if(m.kind==='console-error')$('conerr').textContent=m.text;
 else if(m.kind==='console-accepted'){const h=st.history;if(h[h.length-1]!==m.line)h.push(m.line);hi=-1;$('conline').value='';save();}
 else if(m.kind==='console-start'){running.add(m.run);busy();stick(()=>{$('conout').insertAdjacentHTML('beforeend','<div class="crun" data-run="'+m.run+'"><div class="crunhead"><code>$ '+esc(m.cmd)+'</code>'+(m.model?'<span class="who">'+esc(m.model)+'</span>':'')+'<span class="rs">running…</span><button class="secondary" data-con-run-stop="'+m.run+'">Stop</button></div><pre></pre></div>');
  const o=$('conout');while(o.children.length>60)o.firstElementChild.remove();});}
 else if(m.kind==='console-out'){const el=runEl(m.run);if(!el)return;stick(()=>{const pre=el.querySelector('pre');const s=document.createElement('span');if(m.err)s.className='e';s.textContent=m.text;pre.appendChild(s);
  while(pre.textContent.length>200000&&pre.firstChild)pre.firstChild.remove();});}
 else if(m.kind==='console-exit'){running.delete(m.run);busy();const el=runEl(m.run);if(!el)return;el.querySelector('[data-con-run-stop]')?.remove();const rs=el.querySelector('.rs');
  const t=m.ms<1000?m.ms+' ms':(m.ms/1000).toFixed(1)+' s';rs.textContent=(m.code===0?'done':m.code===null?'stopped':'exit '+m.code)+' · '+t;rs.className='rs '+(m.code===0?'good':'bad');}});
targets();busy();})();
`;
