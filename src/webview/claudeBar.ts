import { consoleMarkup } from '../adbConsole';
import { DEFAULT_PERMISSION, DEFAULT_TOKEN_CAP, TOKEN_CAPS } from '../ai/protocol';

/**
 * The Claude bar: a full-width input docked at the bottom of a page that expands into a conversation panel.
 * Talks to the shared AI host through the ai/* messages in src/ai/protocol.ts.
 * The page must define `claudeScope()` returning `{ serials: string[], label: string }`, and call
 * `claudeBar.refreshScope()` whenever its device selection changes.
 */

export interface ClaudeBarOptions {
  /** Include the ADB console as a second tab (device farm only). */
  adb?: boolean;
  /** Placeholder for the input. */
  placeholder?: string;
}

const PERMISSIONS = [
  ['ask-task', 'Ask once per task', 'Approve a plan of steps and devices; its small steps then run without asking. Data loss always asks again.'],
  ['ask-data-loss', 'Ask only for data loss', 'Everything runs straight away except uninstall, clear data, reboot and file overwrites.'],
  ['read-only', 'Read-only', "Screenshots, logs, metrics and device info only. Claude can't tap, install or change anything."],
] as const;

const fmtTokens = (n: number) => n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`;

export function claudeBarMarkup(options: ClaudeBarOptions = {}) {
  const adbTab = options.adb ? consoleMarkup.replace('<details class="adbcon" id="adbcon">', '<details class="adbcon" id="adbcon" open>') : '';
  return `<section class="ai-dock" id="aiDock" aria-label="Claude assistant">
<div class="ai-panel" id="aiPanel">
 <div class="ai-head">
  <span id="aiHeadIcon" style="display:inline-flex;color:var(--vscode-charts-blue)"><svg data-i="sparkle"></svg></span>
  <strong id="aiTitle" style="color:var(--mota-heading)">Claude</strong>
  <span class="small muted" id="aiSub"></span>
  <span class="spacer"></span>
  <span class="usage" id="aiUsage" hidden title="Tokens used in this conversation, of its limit"><span class="meter"><span id="aiMeter"></span></span><span id="aiUsageText"></span></span>
  <button class="icon-btn" data-ai="new" title="New conversation" aria-label="New conversation"><svg data-i="plus"></svg></button>
  <span class="ai-pop-wrap"><button class="icon-btn" data-ai="history" title="Earlier conversations" aria-label="Earlier conversations" aria-haspopup="menu"><svg data-i="history"></svg></button><div class="menu ai-menu ai-menu-right" id="aiHistory" role="menu" hidden></div></span>
  <button class="icon-btn" data-ai="collapse" title="Collapse" aria-label="Collapse panel"><svg data-i="chevronDown"></svg></button>
 </div>
 <div class="ai-feed" id="aiFeed" role="log" aria-live="polite" aria-label="Conversation with Claude">
  <div class="ai-intro" id="aiIntro"><p class="muted">Ask Claude to do anything you can do in MoTA, on the devices in the scope below. It shows each step, and asks before acting according to the permission setting.</p>
  <div class="row"><button class="btn btn-secondary btn-sm" data-ai-example>Take a screenshot of each device and describe what's on screen</button><button class="btn btn-secondary btn-sm" data-ai-example>Why is the app crashing? Check the logs</button><button class="btn btn-secondary btn-sm" data-ai-example>Install the latest debug APK and open the app</button></div></div>
 </div>
 ${options.adb ? `<div class="ai-console" id="aiConsole" hidden>${adbTab}</div>` : ''}
</div>
<div class="ai-bar"><div class="ai-input">
 <textarea id="aiText" rows="1" placeholder="${options.placeholder ?? 'Ask Claude to install, test, debug or explore on your devices…'}" aria-label="Message Claude"></textarea>
 <div class="ai-meta">
  ${options.adb ? `<div class="ai-mode" role="group" aria-label="Input mode"><button type="button" aria-pressed="true" data-ai-mode="claude" title="Ask Claude"><svg data-i="sparkle"></svg>Claude</button><button type="button" aria-pressed="false" data-ai-mode="adb" title="Run ADB commands"><svg data-i="terminal"></svg>ADB</button></div><span class="ai-sep" aria-hidden="true"></span>` : ''}
  <span class="ai-pop-wrap" data-claude-only><button type="button" class="scope" data-ai="scope" title="Devices Claude may act on" aria-haspopup="menu"><svg data-i="phone"></svg><span id="aiScopeLabel">No devices</span><svg data-i="chevronDown"></svg></button><div class="menu ai-menu" id="aiScopeMenu" role="menu" hidden>
   <button role="menuitemradio" data-scope="page" aria-checked="true">Follow this page <span class="muted small" id="aiScopePage"></span></button>
   <button role="menuitemradio" data-scope="all" aria-checked="false">All ready devices</button></div></span>
  <span class="ai-pop-wrap" data-claude-only><button type="button" class="scope" data-ai="perm" title="What Claude may do without asking" aria-haspopup="menu"><svg data-i="shield"></svg><span id="aiPermLabel"></span><svg data-i="chevronDown"></svg></button><div class="menu ai-menu ai-menu-wide" id="aiPermMenu" role="menu" hidden>
   ${PERMISSIONS.map(([id, label, hint]) => `<button role="menuitemradio" data-perm="${id}" aria-checked="false"><span><b>${label}</b><br><span class="muted small">${hint}</span></span></button>`).join('')}</div></span>
  <span class="ai-pop-wrap" data-claude-only><button type="button" class="scope" data-ai="cap" title="Token limit for this task" aria-haspopup="menu"><svg data-i="gauge"></svg><span id="aiCapLabel"></span><svg data-i="chevronDown"></svg></button><div class="menu ai-menu ai-menu-wide" id="aiCapMenu" role="menu" hidden>
   <div class="small muted" style="padding:4px 10px 6px">Claude stops before going over this limit.</div>
   ${TOKEN_CAPS.map(c => `<button role="menuitemradio" data-cap="${c.tokens}" aria-checked="false"><span><b>${fmtTokens(c.tokens)}</b> <span class="muted small">${c.hint}</span></span></button>`).join('')}</div></span>
  <span class="spacer"></span>
  <span class="ai-pop-wrap" data-claude-only><button type="button" class="scope ghost" data-ai="model" title="Model" aria-haspopup="menu"><span id="aiModelLabel">Model</span><svg data-i="chevronDown"></svg></button><div class="menu ai-menu ai-menu-right" id="aiModelMenu" role="menu" hidden></div></span>
  <button type="button" class="send" id="aiSend" data-claude-only aria-label="Send" title="Send (Enter) · new line (Shift+Enter)"><svg data-i="send"></svg></button>
 </div>
</div></div>
</section>`;
}

export const claudeBarStyles = `
body.has-dock{display:flex;flex-direction:column;min-height:100vh}
.ai-dock{position:sticky;bottom:0;z-index:30;margin-top:auto;border-top:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background,var(--vscode-editor-background));box-shadow:0 -6px 18px rgba(0,0,0,.18)}
.ai-panel{display:none;flex-direction:column;height:min(440px,55vh);border-bottom:1px solid var(--vscode-panel-border)}
.ai-dock.open .ai-panel{display:flex}
.ai-head{display:flex;align-items:center;gap:8px;padding:6px 12px 6px 16px;border-bottom:1px solid var(--vscode-panel-border)}
.ai-feed,.ai-console{flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.ai-console .adbcon>summary{display:none}
.ai-console button{display:inline-flex;align-items:center;height:24px;padding:0 8px;font:inherit;font-size:12px;border-radius:4px;border:1px solid var(--vscode-input-border,transparent);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer}
.ai-console button:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground)}
.ai-console button:disabled{opacity:.5;cursor:default}
.ai-console form button:not(.secondary){background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:transparent}
.ai-console form button:not(.secondary):hover{background:var(--vscode-button-hoverBackground)}
.ai-console select,.ai-console input{height:26px;background:var(--vscode-input-background);color:var(--vscode-input-foreground,var(--vscode-foreground));border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:4px;font:inherit;padding:0 6px}
.ai-console button:focus-visible,.ai-console select:focus-visible,.ai-console input:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}
.ai-intro p{margin:0 0 10px}
.msg-user{align-self:flex-end;max-width:80%;background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground,var(--mota-heading));padding:8px 12px;border-radius:8px 8px 2px 8px;white-space:pre-wrap;overflow-wrap:anywhere}
.msg-ai{max-width:100%;line-height:1.5;overflow-wrap:anywhere}
.msg-ai p{margin:0 0 6px}.msg-ai ul{margin:0 0 6px;padding-left:20px}
.msg-ai code{background:var(--vscode-textCodeBlock-background);padding:0 3px;border-radius:3px}
.call{display:flex;align-items:center;gap:8px;padding:5px 10px;border:1px solid var(--vscode-panel-border);border-radius:6px;font-size:12px;background:var(--vscode-editor-background)}
.call .fn{font-family:var(--vscode-editor-font-family,monospace);color:var(--mota-heading)}
.call .sum{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.call .ok{color:var(--vscode-testing-iconPassed,#3fb950)}.call .run{color:var(--vscode-charts-blue)}.call .err{color:var(--vscode-errorForeground)}
.call img.thumb{height:40px;border-radius:3px;border:1px solid var(--mota-bezel)}
.call details{font-size:12px}
.approval{border:1px solid var(--vscode-editorWarning-foreground);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;background:var(--vscode-editor-background)}
.approval.plan{border-color:var(--vscode-focusBorder)}
.approval.decided{border-color:var(--vscode-panel-border)}
.approval ol{margin:0;padding-left:20px}
.ai-status{font-size:12px;color:var(--vscode-descriptionForeground);display:flex;gap:6px;align-items:center}
.ai-status.bad{color:var(--vscode-errorForeground)}
.ai-attach img{max-height:240px;border-radius:6px;border:1px solid var(--mota-bezel)}
.ai-bar{padding:10px 16px 12px}
.ai-input{width:100%;display:flex;flex-direction:column;gap:8px;padding:10px 10px 8px 12px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:10px}
.ai-input:focus-within{border-color:var(--vscode-focusBorder);box-shadow:0 0 0 1px var(--vscode-focusBorder)}
.ai-input textarea{width:100%;resize:none;background:transparent;border:0;color:var(--vscode-input-foreground,var(--vscode-foreground));font:inherit;line-height:20px;outline:none;height:20px;max-height:160px;padding:0 2px}
.ai-input textarea::placeholder{color:var(--vscode-input-placeholderForeground)}
.ai-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ai-sep{width:1px;height:16px;background:var(--vscode-widget-border,var(--vscode-panel-border));margin:0 2px}
.ai-mode{display:inline-flex;padding:2px;gap:2px;border-radius:7px;background:var(--vscode-editor-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border))}
.ai-mode button{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:5px;border:0;background:transparent;color:var(--vscode-descriptionForeground);font:inherit;font-size:12px;cursor:pointer}
.ai-mode button svg.i{width:13px;height:13px}
.ai-mode button[aria-pressed="true"]{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground,var(--mota-heading))}
.scope{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--vscode-input-border,var(--vscode-panel-border));background:transparent;color:var(--vscode-foreground);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.scope:hover{background:var(--vscode-toolbar-hoverBackground)}
.scope.ghost{border-color:transparent;color:var(--vscode-descriptionForeground)}
.scope svg.i{width:13px;height:13px}
.send{width:28px;height:28px;border-radius:7px;border:0;background:var(--vscode-button-background);color:var(--vscode-button-foreground);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
.send:hover{background:var(--vscode-button-hoverBackground)}
.send:disabled{opacity:.5;cursor:default}
.ai-pop-wrap{position:relative;display:inline-flex}
.ai-menu{bottom:32px;left:0}
.ai-head .ai-menu{bottom:auto;top:30px}
.ai-menu-right{left:auto;right:0}
.ai-menu-wide{width:340px}
.ai-menu button[aria-checked="true"]{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground,inherit)}
.usage{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--vscode-descriptionForeground);margin-right:6px}
.meter{width:60px;height:4px;border-radius:2px;background:var(--vscode-panel-border);overflow:hidden;display:inline-block}
.meter span{display:block;height:100%;width:0;background:var(--vscode-charts-blue)}
.meter span.high{background:var(--vscode-editorWarning-foreground)}
`;

export const claudeBarScript = `
(()=>{
const $=id=>document.getElementById(id);
const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>n>=1e6?(+(n/1e6).toFixed(1))+'M':Math.round(n/1e3)+'K';
const PERM=${JSON.stringify(Object.fromEntries(PERMISSIONS.map(p => [p[0], p[1]])))};
const saved=(()=>{try{return api.getState()?.claude||{};}catch{return{};}})();
const st={convId:saved.convId||null,permission:saved.permission||${JSON.stringify(DEFAULT_PERMISSION)},cap:saved.cap||${DEFAULT_TOKEN_CAP},model:saved.model||'',scopeMode:saved.scopeMode||'page',mode:'claude',running:false,models:[],texts:{}};
const dock=$('aiDock'),feed=$('aiFeed'),text=$('aiText');
function persist(){try{const s=api.getState()||{};s.claude={convId:st.convId,permission:st.permission,cap:st.cap,model:st.model,scopeMode:st.scopeMode};api.setState(s);}catch{}}
function scope(){const page=typeof claudeScope==='function'?claudeScope():{serials:[],label:'No devices'};
 if(st.scopeMode==='all'){const all=typeof claudeAllReady==='function'?claudeAllReady():page;return{serials:all.serials,label:'All ready devices ('+all.serials.length+')',page};}
 return{serials:page.serials,label:page.label,page};}
function refreshScope(){const s=scope();$('aiScopeLabel').textContent=s.label||'No devices';const p=$('aiScopePage');if(p)p.textContent=s.page.label?'· '+s.page.label:'';
 document.querySelectorAll('[data-scope]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.scope===st.scopeMode)));}
function refreshChips(){$('aiPermLabel').textContent=PERM[st.permission];$('aiCapLabel').textContent='≤ '+fmt(st.cap)+' tokens';
 document.querySelectorAll('[data-perm]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.perm===st.permission)));
 document.querySelectorAll('[data-cap]').forEach(b=>b.setAttribute('aria-checked',String(+b.dataset.cap===st.cap)));
 const m=st.models.find(x=>x.id===st.model);$('aiModelLabel').textContent=m?m.label:(st.models.length?'Model':'Model');
 $('aiModelMenu').innerHTML=st.models.length?st.models.map(x=>'<button role="menuitemradio" data-model="'+h(x.id)+'" aria-checked="'+(x.id===st.model)+'">'+h(x.label)+'</button>').join(''):'<div class="small muted" style="padding:6px 10px">No models available yet.</div>';}
function open(){dock.classList.add('open');}
function closeMenus(except){document.querySelectorAll('.ai-menu').forEach(m=>{if(m!==except)m.hidden=true;});}
function toBottom(){feed.scrollTop=feed.scrollHeight;}
function setRunning(on){st.running=on;const b=$('aiSend');b.innerHTML=icon(on?'stop':'send');b.setAttribute('aria-label',on?'Stop':'Send');b.title=on?'Stop Claude':'Send (Enter) · new line (Shift+Enter)';}
function md(src){const blocks=h(src).split(/\\n{2,}/);return blocks.map(b=>{const lines=b.split('\\n');
  const inline=t=>t.replace(/\`([^\`]+)\`/g,'<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>');
  if(lines.every(l=>/^\\s*[-*] /.test(l)))return '<ul>'+lines.map(l=>'<li>'+inline(l.replace(/^\\s*[-*] /,''))+'</li>').join('')+'</ul>';
  return '<p>'+inline(lines.join('<br>'))+'</p>';}).join('');}
function add(html){const intro=$('aiIntro');if(intro)intro.remove();feed.insertAdjacentHTML('beforeend',html);drawIcons(feed);toBottom();return feed.lastElementChild;}
function status(textValue,bad){add('<div class="ai-status'+(bad?' bad':'')+'">'+icon(bad?'error':'info')+'<span>'+h(textValue)+'</span></div>');}
function send(){const value=text.value.trim();if(!value||st.running)return;const s=scope();
 add('<div class="msg-user">'+h(value)+'</div>');text.value='';grow();open();setRunning(true);
 api.postMessage({type:'ai/send',convId:st.convId||undefined,text:value,mode:'claude',scope:{serials:s.serials},permission:st.permission,model:st.model,tokenCap:st.cap});}
function grow(){text.style.height='auto';text.style.height=Math.min(text.scrollHeight,160)+'px';}
function setMode(mode){st.mode=mode;document.querySelectorAll('[data-ai-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.aiMode===mode)));
 const adb=mode==='adb';feed.hidden=adb;const c=$('aiConsole');if(c)c.hidden=!adb;text.hidden=adb;
 document.querySelectorAll('[data-claude-only]').forEach(e=>e.hidden=adb);
 $('aiTitle').textContent=adb?'ADB console':(st.title||'Claude');$('aiHeadIcon').innerHTML=icon(adb?'terminal':'sparkle');
 document.querySelectorAll('[data-ai="new"],[data-ai="history"]').forEach(b=>b.hidden=adb);$('aiUsage').hidden=adb||!st.usageShown;$('aiSub').textContent=adb?'':(st.sub||'');
 if(adb){open();const d=$('adbcon');if(d&&!d.open){d.open=true;d.dispatchEvent(new Event('toggle'));}setTimeout(()=>{const l=$('conline');if(l)l.focus();},0);}else text.focus();}
function newConversation(){st.convId=null;st.title='';st.sub='';st.texts={};st.usageShown=false;persist();feed.innerHTML='';$('aiTitle').textContent='Claude';$('aiSub').textContent='';$('aiUsage').hidden=true;api.postMessage({type:'ai/new'});text.focus();}
text.addEventListener('input',grow);
text.addEventListener('focus',open);
text.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}});
dock.addEventListener('keydown',e=>{if(e.key==='Escape'){if(document.querySelector('.ai-menu:not([hidden])')){closeMenus();e.stopPropagation();}else if(dock.classList.contains('open')){dock.classList.remove('open');e.stopPropagation();}}});
document.addEventListener('click',e=>{if(!dock.contains(e.target))closeMenus();});
dock.addEventListener('click',e=>{const t=e.target;
 const opener=t.closest('[data-ai="scope"],[data-ai="perm"],[data-ai="cap"],[data-ai="model"],[data-ai="history"]');
 if(opener){const menu=opener.parentElement.querySelector('.ai-menu');const show=menu.hidden;closeMenus(menu);menu.hidden=!show;if(show&&opener.dataset.ai==='history')api.postMessage({type:'ai/list'});if(show&&opener.dataset.ai==='scope')refreshScope();return;}
 if(!t.closest('.ai-menu'))closeMenus();
 const b=t.closest('button');if(!b)return;
 if(b.dataset.aiMode){setMode(b.dataset.aiMode);return;}
 if(b.dataset.ai==='collapse'){dock.classList.remove('open');return;}
 if(b.dataset.ai==='new'){newConversation();closeMenus();return;}
 if(b.id==='aiSend'){if(st.running&&st.convId)api.postMessage({type:'ai/stop',convId:st.convId});else send();return;}
 if(b.dataset.scope){st.scopeMode=b.dataset.scope;persist();refreshScope();closeMenus();return;}
 if(b.dataset.perm){st.permission=b.dataset.perm;persist();refreshChips();closeMenus();return;}
 if(b.dataset.cap){st.cap=+b.dataset.cap;persist();refreshChips();closeMenus();return;}
 if(b.dataset.model){st.model=b.dataset.model;persist();refreshChips();closeMenus();return;}
 if(b.dataset.conv){st.convId=b.dataset.conv;st.title=b.dataset.title;persist();feed.innerHTML='';$('aiTitle').textContent=st.title;add('<div class="ai-status">'+icon('history')+'<span>Continuing this conversation. Earlier messages are not shown here.</span></div>');closeMenus();text.focus();return;}
 if(b.hasAttribute('data-ai-example')){text.value=b.textContent;grow();text.focus();return;}
 if(b.dataset.approve){const card=b.closest('.approval');api.postMessage({type:'ai/approve',convId:card.dataset.conv,requestId:card.dataset.req,decision:b.dataset.approve});
  card.classList.add('decided');card.querySelector('.approval-actions').innerHTML='<span class="small muted">'+(b.dataset.approve==='deny'?'Denied':b.dataset.approve==='conversation'?'Allowed for this conversation':'Allowed')+'</span>';return;}});
function toolLine(m){let el=feed.querySelector('.call[data-call="'+CSS.escape(m.callId)+'"]');
 const stIcon=m.state==='running'?icon('spinner','class="i run spin"'):m.state==='ok'?icon('checkCircle','class="i ok"'):icon('error','class="i err"');
 const dur=m.durationMs!=null?(m.durationMs<1000?m.durationMs+' ms':Math.round(m.durationMs/1000)+' s'):'';
 const devs=m.devices&&m.devices.length?(m.devices.length===1?m.devices[0]:m.devices.length+' devices'):'';
 const html='<div class="call" data-call="'+h(m.callId)+'">'+stIcon+'<span class="fn">'+h(m.name)+'</span><span class="sum muted">'+h([m.summary,devs].filter(Boolean).join(' · '))+'</span><span class="spacer"></span>'
  +(m.thumbUri?'<img class="thumb" alt="Screenshot" src="'+h(m.thumbUri)+'">':'')+'<span class="muted">'+h(dur)+'</span></div>'
  +(m.detail&&m.state==='error'?'<div class="small" style="color:var(--vscode-errorForeground);padding:0 10px">'+h(m.detail)+'</div>':'');
 if(el){const extra=el.nextElementSibling&&!el.nextElementSibling.matches('.call,.msg-ai,.msg-user,.approval,.ai-status')?el.nextElementSibling:null;if(extra)extra.remove();el.outerHTML=html;drawIcons(feed);}else add(html);}
window.addEventListener('message',e=>{const m=e.data;if(!m||typeof m.type!=='string'||!m.type.startsWith('ai/'))return;
 if(m.type==='ai/models'){st.models=m.items||[];if(!st.models.some(x=>x.id===st.model))st.model=st.models[0]?st.models[0].id:'';refreshChips();return;}
 if(m.type==='ai/conversations'){$('aiHistory').innerHTML=m.items.length?m.items.map(c=>'<button role="menuitem" data-conv="'+h(c.convId)+'" data-title="'+h(c.title)+'"><span><b>'+h(c.title)+'</b><br><span class="muted small">'+new Date(c.updatedAt).toLocaleString()+' · '+fmt(c.totalTokens)+' tokens</span></span></button>').join(''):'<div class="small muted" style="padding:6px 10px">No earlier conversations.</div>';return;}
 if(m.convId&&st.convId&&m.convId!==st.convId&&m.type!=='ai/started')return;
 if(m.type==='ai/started'){if(st.convId&&st.convId!==m.convId){feed.innerHTML='';st.texts={};st.usageShown=false;$('aiUsage').hidden=true;}st.convId=m.convId;st.title=m.title;st.sub=(m.scope&&m.scope.serials.length?m.scope.serials.length+' device'+(m.scope.serials.length>1?'s':''):'');persist();if(st.mode==='claude'){$('aiTitle').textContent=m.title||'Claude';$('aiSub').textContent=st.sub;}setRunning(true);open();return;}
 if(m.type==='ai/text'){const key=m.messageId;st.texts[key]=(st.texts[key]||'')+m.delta;let el=feed.querySelector('.msg-ai[data-mid="'+CSS.escape(key)+'"]');if(!el){el=add('<div class="msg-ai" data-mid="'+h(key)+'"></div>');}el.innerHTML=md(st.texts[key]);toBottom();return;}
 if(m.type==='ai/text-end')return;
 if(m.type==='ai/tool'){toolLine(m);return;}
 if(m.type==='ai/attachment'){if(m.callId&&m.kind==='screenshot'){const el=feed.querySelector('.call[data-call="'+CSS.escape(m.callId)+'"]');if(el&&!el.querySelector('img')){el.querySelector('.spacer').insertAdjacentHTML('afterend','<img class="thumb" alt="'+h(m.caption||'Screenshot')+'" src="'+h(m.uri)+'">');return;}}
  add('<figure class="ai-attach" style="margin:0">'+(m.kind==='screenshot'?'<img alt="'+h(m.caption||'Screenshot')+'" src="'+h(m.uri)+'">':'<a href="'+h(m.uri)+'">'+h(m.caption||m.kind)+'</a>')+(m.caption?'<figcaption class="small muted">'+h(m.caption)+'</figcaption>':'')+'</figure>');return;}
 if(m.type==='ai/approval'){const plan=m.kind==='plan';
  const buttons=plan?'<button class="btn btn-primary btn-sm" data-approve="once">Approve plan</button><button class="btn btn-ghost btn-sm" data-approve="deny">Deny</button>'
   :'<button class="btn btn-primary btn-sm" data-approve="once">Allow once</button><button class="btn btn-secondary btn-sm" data-approve="conversation">Allow for this conversation</button><button class="btn btn-ghost btn-sm" data-approve="deny">Deny</button>';
  add('<div class="approval'+(plan?' plan':'')+'" role="group" data-conv="'+h(m.convId)+'" data-req="'+h(m.requestId)+'"><div class="row" style="gap:8px">'+icon(plan?'checkCircle':'warn',plan?'':'style="color:var(--vscode-editorWarning-foreground)"')+'<strong style="color:var(--mota-heading)">'+h(m.title)+'</strong>'
   +(m.tokenCapEstimate?'<span class="small muted">about '+fmt(m.tokenCapEstimate)+' tokens</span>':'')+'</div>'
   +(m.steps&&m.steps.length?'<ol class="small">'+m.steps.map(s=>'<li>'+h(s)+'</li>').join('')+'</ol>':'')
   +'<div class="small muted">'+(m.tool?'<span class="mono">'+h(m.tool)+'</span> · ':'')+(m.devices.length?h(m.devices.join(', ')):'')+'</div>'
   +'<div class="row approval-actions">'+buttons+'</div></div>');return;}
 if(m.type==='ai/usage'){const u=$('aiUsage');st.usageShown=true;u.hidden=st.mode==='adb';const pct=m.tokenCap?Math.min(100,m.totalTokens/m.tokenCap*100):0;const bar=$('aiMeter');bar.style.width=pct+'%';bar.classList.toggle('high',pct>=80);$('aiUsageText').textContent=fmt(m.totalTokens)+' / '+fmt(m.tokenCap)+' tokens';return;}
 if(m.type==='ai/done'){setRunning(false);const msg={success:'',stopped:'Stopped.','cap-reached':'Stopped at the token limit. Raise the limit or continue with a new message.',denied:'Stopped because an action was denied.',error:m.message||'Something went wrong.'}[m.outcome];
  if(m.outcome!=='success'&&msg)status(m.outcome==='error'&&m.message?m.message:msg,m.outcome==='error');else if(m.message)status(m.message);return;}
});
function ask(value,go){if(st.mode!=='claude'&&document.querySelector('[data-ai-mode]'))setMode('claude');text.value=value;grow();open();text.focus();if(go)send();}
window.claudeBar={refreshScope,open,setMode,ask};
refreshChips();refreshScope();setRunning(false);
})();
`;
