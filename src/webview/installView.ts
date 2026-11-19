import { claudeBarMarkup, claudeBarScript, claudeBarStyles } from './claudeBar';
import { themedPage } from './page';

/** Install APK webview (approved design: design-mockups/install.html). Host logic is in installPage.ts. */
export function installHtml(cspSource: string) {
  return themedPage('Install APK', body, styles + claudeBarStyles, script + claudeBarScript + "\napi.postMessage({action:'ready'});", cspSource);
}

const styles = `
.apk{display:flex;flex-wrap:wrap;gap:16px;align-items:center}
.appicon{width:48px;height:48px;border-radius:12px;color:#fff;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex:none;background:var(--vscode-button-background)}
.facts{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12px;color:var(--vscode-descriptionForeground)}
.facts b{color:var(--mota-heading);font-weight:600}
table.targets{width:100%;border-collapse:collapse;min-width:760px}
table.targets th{text-align:left;font-size:12px;font-weight:600;color:var(--vscode-descriptionForeground);padding:8px 12px;border-bottom:1px solid var(--vscode-panel-border)}
table.targets td{padding:10px 12px;border-bottom:1px solid var(--vscode-panel-border);vertical-align:middle}
table.targets input[type=checkbox]{accent-color:var(--vscode-button-background)}
.plan{display:inline-flex;align-items:center;gap:6px;font-size:12px}
.plan.warn{color:var(--vscode-editorWarning-foreground)}
.bar{height:4px;border-radius:2px;background:var(--vscode-panel-border);overflow:hidden;width:160px;position:relative}
.bar span{position:absolute;inset:0 auto 0 0;width:35%;background:var(--vscode-progressBar-background,var(--vscode-button-background));animation:indet 1.2s ease-in-out infinite}
@keyframes indet{0%{left:-35%}100%{left:100%}}
@media (prefers-reduced-motion:reduce){.bar span{animation:none;width:100%}}
.result{display:flex;flex-direction:column;gap:6px}
.ok{color:var(--vscode-testing-iconPassed,#3fb950)}.bad{color:var(--vscode-errorForeground)}
.line{display:inline-flex;align-items:center;gap:6px}
.fix{border-left:2px solid var(--vscode-errorForeground);padding:6px 10px;background:var(--vscode-textCodeBlock-background);border-radius:0 4px 4px 0;font-size:12px;max-width:520px}
.mode{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.mode label{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--vscode-panel-border);border-radius:6px;cursor:pointer}
.mode label:has(input:checked){border-color:var(--vscode-focusBorder);background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground,inherit)}
.mode input{margin-top:2px;accent-color:var(--vscode-button-background)}
details.adv summary{cursor:pointer;display:flex;gap:8px;align-items:center;list-style:none}
details.adv summary::-webkit-details-marker{display:none}
details.adv[open] .chev{transform:rotate(90deg)}
.advgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 24px;margin-top:12px}
`;

const body = `
<div class="page">
 <header class="page-header">
  <div><h1>Install APK</h1><div class="subtitle">Choose devices, check what will change, then install.</div></div>
  <div class="row" style="gap:12px">
   <label class="check small"><input type="checkbox" id="launchAfter"> Launch when done</label>
   <span class="small" id="summary"></span>
   <span id="actions" class="row"></span>
  </div>
 </header>
 <p class="small" id="notice" role="status" style="margin:0" hidden></p>
 <section class="card card-pad apk" aria-label="Selected APK">
  <span class="appicon" id="apkIcon">APK</span>
  <div style="flex:1;min-width:240px;display:flex;flex-direction:column;gap:6px">
   <div class="row" style="gap:10px"><h2 style="font-size:16px" id="apkName">Reading APK…</h2><span class="badge" id="apkBadge" hidden>debug</span></div>
   <div class="facts" id="apkFacts"></div>
   <div class="small muted mono" id="apkPath"></div>
  </div>
  <div class="row"><button class="btn btn-ghost btn-sm" data-action="reveal">Reveal</button><button class="btn btn-secondary" data-action="choose-apk"><svg data-i="folder"></svg>Choose another APK</button></div>
 </section>
 <section class="card" style="overflow-x:auto" aria-label="Target devices">
  <div class="row" style="justify-content:space-between;padding:12px 12px 4px"><h2>Devices</h2><div class="row"><span class="small muted" id="selsummary"></span><button class="icon-btn" data-action="refresh" title="Refresh devices" aria-label="Refresh devices"><svg data-i="refresh"></svg></button></div></div>
  <table class="targets"><thead><tr><th style="width:32px"><input type="checkbox" id="all" aria-label="Select all devices"></th><th>Device</th><th>Installed now</th><th>What happens</th><th style="min-width:280px">Result</th></tr></thead><tbody id="rows"><tr><td colspan="5" class="muted">Looking for devices…</td></tr></tbody></table>
 </section>
 <section class="card card-pad" style="display:flex;flex-direction:column;gap:12px" aria-label="Install options">
  <h2>How to install</h2>
  <div class="mode" role="radiogroup" aria-label="Install mode">
   <label><input type="radio" name="mode" value="update"><span><b>Update, keep app data</b><br><span class="small muted">Replaces the app and keeps logins, databases and settings. A phone whose installed app has a different signing key fails safely and offers a clean install.</span></span></label>
   <label><input type="radio" name="mode" value="clean"><span><b>Clean install, erase app data</b><br><span class="small muted">Uninstalls first, then installs. You'll be asked to confirm.</span></span></label>
  </div>
  <details class="adv"><summary><svg data-i="chevronRight" class="chev"></svg><b>Advanced</b><span class="small muted" id="advSummary"></span></summary>
   <div class="advgrid">
    <label class="check"><input type="checkbox" data-opt="downgrade"> Allow downgrade (debuggable apps)</label>
    <label class="check"><input type="checkbox" data-opt="test"> Allow test-only APKs</label>
    <label class="check"><input type="checkbox" data-opt="grant"> Grant all runtime permissions</label>
    <label class="field"><span>Android user</span><select class="select" data-opt="user"><option value="">Default</option><option value="current">Current user</option><option value="all">All users</option><option value="0">User 0 (owner)</option><option value="10">User 10 (work profile)</option></select></label>
    <label class="field"><span>Timeout</span><select class="select" data-opt="timeout"><option value="60">60 s</option><option value="180">180 s</option><option value="600">600 s</option></select></label>
   </div>
  </details>
 </section>
</div>
${claudeBarMarkup({ placeholder: 'Ask Claude, e.g. “install this and run a quick smoke test”…' })}`;

const script = `
document.body.classList.add('has-dock');
const $=id=>document.getElementById(id);
const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let S={rows:[],options:{},apk:{},mode:'update',running:false};
const send=(action,extra)=>api.postMessage(Object.assign({action},extra||{}));
function claudeScope(){const r=S.rows.filter(x=>x.selected);return{serials:r.map(x=>x.serial),label:r.length?(r.length===1?r[0].model:r.length+' target devices'):'No devices selected'};}
const FIX={replace:'Replace existing app & retry',downgrade:'Allow downgrade & retry',test:'Allow test APK & retry',clean:'Uninstall & install…'};
const size=b=>b>1048576?(b/1048576).toFixed(1)+' MB':Math.max(1,Math.round(b/1024))+' KB';
const ago=t=>{if(!t)return'';const m=Math.round((Date.now()-t)/60000);return m<1?'built just now':m<60?'built '+m+' min ago':m<1440?'built '+Math.round(m/60)+' h ago':'built '+new Date(t).toLocaleDateString();};
function result(r){
 if(r.state==='installing'||r.state==='uninstalling')return'<div class="result"><span class="small">'+(r.state==='uninstalling'?'Uninstalling…':'Installing…')+'</span><div class="bar" role="progressbar" aria-label="Working"><span></span></div></div>';
 if(r.state==='installed')return'<div class="result"><span class="line ok">'+icon('checkCircle')+h(r.detail||'Installed')+'</span>'+(S.apk.info&&S.apk.info.package?'<div><button class="btn btn-ghost btn-sm" data-launch="'+h(r.serial)+'">'+icon('play')+'Launch</button></div>':'')+'</div>';
 if(r.state==='failed')return'<div class="result"><span class="line bad">'+icon('error')+'Not installed</span><div class="fix">'+h(r.hint)+'<div class="small muted mono" style="margin-top:4px;max-height:60px;overflow:auto">'+h(r.error)+'</div><div class="row" style="margin-top:8px">'
  +r.fixes.map(f=>'<button class="btn '+(f==='clean'?'btn-danger':'btn-secondary')+' btn-sm" data-fix="'+f+'" data-serial="'+h(r.serial)+'"'+(S.running?' disabled':'')+'>'+FIX[f]+'</button>').join('')+'<button class="btn btn-ghost btn-sm" data-copy="'+h(r.serial)+'">Copy error</button></div></div></div>';
 return r.selected?'<span class="muted">Ready</span>':'<span class="muted">—</span>';}
function render(){const a=S.apk,i=a.info||{};
 $('apkName').textContent=i.label||i.package||a.file||'APK';$('apkIcon').textContent=(i.label||a.file||'APK').replace(/[^A-Za-z0-9]/g,'').slice(0,2).toUpperCase()||'APK';$('apkBadge').hidden=!i.debuggable;
 $('apkFacts').innerHTML=[i.versionName?'<span><b>'+h(i.versionName)+'</b>'+(i.versionCode?' ('+i.versionCode+')':'')+'</span>':'',i.package?'<span class="mono">'+h(i.package)+'</span>':'<span>Package unknown: install Android SDK build-tools to read APK details</span>',a.size?'<span>'+size(a.size)+'</span>':'',
  i.minSdk?'<span>min SDK '+i.minSdk+(i.targetSdk?' · target '+i.targetSdk:'')+'</span>':'',i.abis&&i.abis.length?'<span>'+h(i.abis.join(', '))+'</span>':''].join('');
 $('apkPath').textContent=a.path?(a.path.length>90?'…'+a.path.slice(-88):a.path)+(a.mtime?' · '+ago(a.mtime):''):'';$('apkPath').title=a.path||'';
 const sel=S.rows.filter(r=>r.selected),failed=S.rows.filter(r=>r.state==='failed'),done=S.rows.filter(r=>r.state==='installed'),busy=S.rows.filter(r=>r.state==='installing'||r.state==='uninstalling');
 $('rows').innerHTML=S.rows.length?S.rows.map(r=>'<tr><td><input type="checkbox" data-select="'+h(r.serial)+'"'+(r.selected?' checked':'')+(S.running?' disabled':'')+' aria-label="Install on '+h(r.model)+'"></td>'
  +'<td><div style="font-weight:600;color:var(--mota-heading)">'+h(r.model)+'</div><div class="small muted">'+h([r.android&&'Android '+r.android,r.kind].filter(Boolean).join(' · '))+'</div></td>'
  +'<td class="small">'+(r.installed===undefined?'<span class="muted">—</span>':r.installed===null?'Not installed':h(r.installed.version))+'</td>'
  +'<td><span class="plan'+(r.plan.warn?' warn':'')+'">'+(r.plan.warn?icon('warn'):'')+h(r.plan.text)+'</span></td><td>'+result(r)+'</td></tr>').join(''):'<tr><td colspan="5" class="muted">No ready devices. Connect a phone, then refresh.</td></tr>';
 $('all').checked=S.rows.length>0&&sel.length===S.rows.length;$('all').indeterminate=sel.length>0&&sel.length<S.rows.length;$('all').disabled=S.running;
 $('selsummary').textContent=sel.length+' of '+S.rows.length+' selected';
 $('summary').innerHTML=S.running?'<span class="muted">Installing on '+busy.length+' device'+(busy.length===1?'':'s')+'…</span>':done.length||failed.length?(done.length?'<span class="ok">'+done.length+' installed</span>':'')+(done.length&&failed.length?' · ':'')+(failed.length?'<span class="bad">'+failed.length+' failed</span>':''):'';
 const n=sel.length,label=S.mode==='clean'?'Clean install on ':'Install on ';
 $('actions').innerHTML=(failed.length&&!S.running?'<button class="btn btn-secondary" data-action="retry-failed">Retry failed</button>':'')
  +(done.length&&!S.running&&S.apk.info&&S.apk.info.package?'<button class="btn btn-secondary" data-action="launch">'+icon('play')+'Launch on '+done.length+'</button>':'')
  +'<button class="btn btn-primary" data-action="install"'+(S.running||!n?' disabled':'')+'>'+icon('package')+(S.running?'Installing…':label+n+' device'+(n===1?'':'s'))+'</button>';
 document.querySelectorAll('input[name=mode]').forEach(x=>{x.checked=x.value===S.mode;x.disabled=S.running;});
 const o=S.options;document.querySelectorAll('[data-opt]').forEach(el=>{const k=el.dataset.opt;if(el.type==='checkbox')el.checked=!!o[k];else el.value=String(o[k]??'');el.disabled=S.running;});
 $('advSummary').textContent=[o.downgrade?'downgrade allowed':'',o.test?'test APKs allowed':'',o.grant?'grants permissions':'',o.user?(o.user==='all'?'all users':'user '+o.user):'default user',o.timeout+' s timeout'].filter(Boolean).join(' · ');
 $('launchAfter').checked=!!S.launchAfter;
 if(S.notice){$('notice').hidden=false;$('notice').textContent=S.notice;}
 drawIcons();if(window.claudeBar)claudeBar.refreshScope();}
function options(){const o={};document.querySelectorAll('[data-opt]').forEach(el=>{o[el.dataset.opt]=el.type==='checkbox'?el.checked:el.value;});o.timeout=Number(o.timeout);return o;}
document.addEventListener('change',e=>{const t=e.target;
 if(t.dataset.select!==undefined&&t.matches('[data-select]'))send('select',{serial:t.dataset.select,on:t.checked});
 else if(t.id==='all')send('select-all',{on:t.checked});
 else if(t.name==='mode')send('mode',{mode:t.value});
 else if(t.dataset.opt)send('options',{options:options()});
 else if(t.id==='launchAfter')send('launch-after',{on:t.checked});});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled||e.target.closest('#aiDock'))return;
 if(b.dataset.fix){send('fix',{serial:b.dataset.serial,fix:b.dataset.fix});return;}
 if(b.dataset.copy){send('copy-error',{serial:b.dataset.copy});return;}
 if(b.dataset.launch){send('launch',{serial:b.dataset.launch});return;}
 if(b.dataset.action){$('notice').hidden=true;send(b.dataset.action);}});
window.addEventListener('message',e=>{const m=e.data;if(m&&m.kind==='state'){S=m;render();}});
`;
