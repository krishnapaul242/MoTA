import { claudeBarMarkup, claudeBarScript, claudeBarStyles } from './claudeBar';
import { esc, themedPage } from './page';
import { liveScreenScript } from './liveScreen';

/** Device controls webview (approved design: design-mockups/controls.html). Host logic stays in devicePage.ts. */
export function controlsHtml(device: { serial: string; model: string }, cspSource: string) {
  const boot = `const DEVICE=${JSON.stringify({ serial: device.serial, model: device.model }).replace(/</g, '\\u003c')};`;
  return themedPage(`${device.model} · Device controls`, body(device), styles + claudeBarStyles, boot + liveScreenScript + script + claudeBarScript + '\nstart();', cspSource);
}

const styles = `
body{display:flex;flex-direction:column;min-height:100vh}
.top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:12px 24px;border-bottom:1px solid var(--vscode-panel-border)}
.layout{display:flex;flex-wrap:wrap;align-items:stretch;flex:1}
.left{flex:0 1 420px;min-width:300px;display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px;background:var(--mota-stage)}
.screenrow{display:flex;gap:12px;align-items:flex-start}
.screen{position:relative;display:flex;align-items:center;justify-content:center;min-width:220px;min-height:400px;border-radius:22px;border:5px solid var(--mota-bezel);background:#000;overflow:hidden}
.screen img,.screen canvas{display:block;height:min(600px,calc(100vh - 260px));min-height:380px;width:auto;max-width:320px;object-fit:contain;touch-action:none;user-select:none;-webkit-user-drag:none;cursor:crosshair}
.screen .msg{color:#bbb;font-size:12px;padding:24px;text-align:center}
.devtools{display:flex;flex-direction:column;gap:2px;padding:5px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));border-radius:8px}
.devtools hr{width:100%;border:0;border-top:1px solid var(--vscode-widget-border,var(--vscode-panel-border));margin:4px 0}
.right{flex:999 1 520px;min-width:0;display:flex;flex-direction:column}
.panel{padding:20px 24px;display:flex;flex-direction:column;gap:16px}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;font-size:12px;margin:0}
.kv dt{color:var(--vscode-descriptionForeground)}.kv dd{margin:0;color:var(--mota-heading);overflow-wrap:anywhere}
.danger{border:1px solid var(--mota-danger-border);border-radius:8px}
.danger .item{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px}
.danger .item+.item{border-top:1px solid var(--mota-danger-border)}
.applist{max-height:220px;overflow:auto;border-top:1px solid var(--vscode-panel-border)}
.appitem{display:flex;gap:10px;align-items:center;padding:7px 12px;width:100%;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.appitem:hover{background:var(--vscode-list-hoverBackground)}
.appitem[aria-selected="true"]{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground,inherit)}
.appicon{width:28px;height:28px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:11px;flex:none}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px}
.shot{border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-sideBar-background,var(--vscode-editor-background));padding:6px;display:flex;flex-direction:column;gap:4px;cursor:pointer;font:inherit;color:inherit;text-align:left}
.shot[aria-selected="true"]{border-color:var(--vscode-focusBorder);box-shadow:0 0 0 1px var(--vscode-focusBorder)}
.shot .ph{height:150px;border-radius:4px;background:var(--mota-stage);display:flex;align-items:center;justify-content:center;overflow:hidden}
.shot .ph img{max-width:100%;max-height:100%}
.preview{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
.preview .media{flex:0 0 auto;max-width:280px}
.preview .media img,.preview .media video{max-width:280px;max-height:520px;border-radius:8px;border:2px solid var(--mota-bezel);display:block}
.log{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;line-height:1.55;background:var(--vscode-textCodeBlock-background);border-radius:6px;padding:8px 0;height:min(460px,calc(100vh - 330px));min-height:200px;overflow:auto}
.log div{padding:0 12px;white-space:pre}
.log .E,.log .F{color:var(--vscode-errorForeground)}.log .W{color:var(--vscode-editorWarning-foreground)}.log .D,.log .V{color:var(--vscode-descriptionForeground)}
.term{background:var(--vscode-textCodeBlock-background);border-radius:6px;font-family:var(--vscode-editor-font-family,monospace);font-size:12px}
.term pre{margin:0;padding:12px;height:min(380px,calc(100vh - 380px));min-height:160px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.term pre .cmd{color:var(--mota-heading)}
.term form{display:flex;gap:8px;align-items:center;border-top:1px solid var(--vscode-panel-border);padding:8px 12px}
.term input{flex:1;background:transparent;border:0;color:var(--vscode-foreground);font:inherit;outline:none}
table.files{width:100%;border-collapse:collapse}
table.files td,table.files th{padding:7px 10px;border-bottom:1px solid var(--vscode-panel-border);text-align:left;font-size:12px}
table.files th{color:var(--vscode-descriptionForeground);font-weight:600}
table.files tr:hover td{background:var(--vscode-list-hoverBackground)}
table.files tr[aria-selected="true"] td{background:var(--vscode-list-activeSelectionBackground)}
table.files button{background:transparent;border:0;color:inherit;font:inherit;cursor:pointer;display:inline-flex;gap:8px;align-items:center;padding:0}
.stat{display:flex;flex-direction:column;gap:2px}.stat .v{font-size:20px;font-weight:600;color:var(--mota-heading)}
#menu{position:fixed}
`;

const tab = (id: string, label: string, on = false) => `<button role="tab" aria-selected="${on}" data-tab="${id}" id="tab-${id}" aria-controls="panel-${id}">${label}</button>`;

function body(d: { serial: string; model: string }) {
  return `
<header class="top">
 <div class="row" style="gap:12px">
  <button class="icon-btn" data-action="farm" title="All devices" aria-label="All devices"><svg data-i="arrowLeft"></svg></button>
  <div><div class="row" style="gap:10px"><h1 style="font-size:16px">${esc(d.model)}</h1><span class="status"><span class="dot ready" id="hdrDot"></span><span id="hdrStatus">Ready</span></span></div>
  <div class="subtitle" id="hdrSub">${esc(d.serial)}</div></div>
 </div>
 <div class="row" style="gap:6px">
  <button class="btn btn-secondary" data-action="screenshot" data-busy title="Capture screenshot"><svg data-i="camera"></svg>Screenshot</button>
  <button class="btn btn-secondary" data-action="start-video" id="hdrRecord" data-busy title="Record the screen (needs the helper)"><svg data-i="record" style="color:var(--vscode-errorForeground)"></svg>Record</button>
  <button class="icon-btn" data-menu="device" title="More device actions" aria-label="More device actions" aria-haspopup="menu"><svg data-i="more"></svg></button>
 </div>
</header>
<div class="layout">
 <section class="left" aria-label="Live screen">
  <div class="screenrow">
   <div class="screen"><canvas id="livecanvas" hidden role="img" aria-label="Live device video. Click to tap, drag to swipe."></canvas><img id="liveimg" alt="Live device screen. Click to tap, drag to swipe." draggable="false" hidden><span class="msg" id="livemsg">Connecting…</span></div>
   <div class="devtools" role="toolbar" aria-orientation="vertical" aria-label="Device buttons">
    <button class="tool" data-key="wake" title="Wake screen" aria-label="Wake screen"><svg data-i="sun"></svg></button>
    <button class="tool" data-key="sleep" title="Sleep screen" aria-label="Sleep screen"><svg data-i="moon"></svg></button>
    <button class="tool" data-key="volumeUp" title="Volume up" aria-label="Volume up"><svg data-i="volUp"></svg></button>
    <button class="tool" data-key="volumeDown" title="Volume down" aria-label="Volume down"><svg data-i="volDown"></svg></button>
    <hr>
    <button class="tool" data-key="back" title="Back" aria-label="Back"><svg data-i="back"></svg></button>
    <button class="tool" data-key="home" title="Home" aria-label="Home"><svg data-i="home"></svg></button>
    <button class="tool" data-key="recents" title="Recent apps" aria-label="Recent apps"><svg data-i="recents"></svg></button>
   </div>
  </div>
  <div class="row small muted" style="gap:6px"><span class="dot live" id="liveDot"></span><span id="livemode">Connecting…</span><span>· click to tap, drag to swipe</span></div>
  <form class="row" id="textform" style="width:100%;max-width:340px;flex-wrap:nowrap"><label class="search" style="flex:1"><svg data-i="keyboard"></svg><input id="text" placeholder="Type on device" aria-label="Text to type on the device" autocomplete="off"></label><button class="btn btn-secondary">Send</button></form>
 </section>
 <section class="right">
  <nav class="tabs" role="tablist" aria-label="Device tools" style="padding:0 16px">${tab('apps', 'Apps', true)}${tab('captures', 'Captures')}${tab('logs', 'Logs')}${tab('diag', 'Diagnostics')}${tab('shell', 'Shell')}${tab('files', 'Files')}</nav>

  <div class="panel" id="panel-apps" role="tabpanel" aria-labelledby="tab-apps">
   <div class="card">
    <div class="row" style="padding:12px;flex-wrap:nowrap"><label class="search" style="flex:1"><svg data-i="search"></svg><input id="appSearch" placeholder="Find an installed app" aria-label="Find an installed app"></label><button class="icon-btn" data-action="packages" title="Reload installed apps" aria-label="Reload installed apps"><svg data-i="refresh"></svg></button></div>
    <div class="applist" role="listbox" aria-label="Installed apps" id="applist"><div class="small muted" style="padding:8px 12px">Loading installed apps…</div></div>
   </div>
   <div class="card card-pad" style="display:flex;flex-direction:column;gap:14px" id="appCard">
    <div class="row" style="justify-content:space-between">
     <div class="row" style="gap:10px"><span class="appicon" id="appIcon" style="background:var(--vscode-button-background);width:36px;height:36px;border-radius:9px"></span><div><h2 id="appName">No app selected</h2><div class="small muted mono" id="appPkg">Choose an app above, or type a package ID.</div></div></div>
     <span class="status small" id="appRun"></span>
    </div>
    <label class="field" id="pkgField"><span>Package ID</span><input class="input mono" id="package" placeholder="com.example.app" autocomplete="off"></label>
    <dl class="kv" id="appInfo"></dl>
    <div class="row">
     <button class="btn btn-primary" data-action="app" data-operation="launch" data-busy><svg data-i="play"></svg>Launch</button>
     <button class="btn btn-secondary" data-action="app" data-operation="restart" data-busy>Restart</button>
     <button class="btn btn-secondary" data-action="app" data-operation="force-stop" data-busy>Force stop</button>
     <button class="btn btn-ghost" data-action="app" data-operation="settings" data-busy>App info on device</button>
     <button class="btn btn-ghost" data-action="install"><svg data-i="package"></svg>Install APK…</button>
    </div>
   </div>
   <div class="card card-pad" style="display:flex;flex-direction:column;gap:10px">
    <h2>Deep link</h2>
    <form class="row" id="deeplinkform" style="flex-wrap:nowrap"><input class="input mono" id="uri" style="flex:1;min-width:0" placeholder="myapp://product/123" aria-label="Deep link URI"><button class="btn btn-secondary" data-busy><svg data-i="link"></svg>Open</button></form>
    <div class="small muted">Opens with the selected app when one is chosen.</div>
   </div>
   <div class="danger" role="group" aria-label="Actions that delete data">
    <div class="item"><div><h3>Clear app data</h3><div class="small muted">Deletes accounts, databases and settings for this app.</div></div><button class="btn btn-danger" data-action="app" data-operation="clear" data-busy>Clear data…</button></div>
    <div class="item"><div><h3>Uninstall</h3><div class="small muted">Removes the app for all users on this device.</div></div><button class="btn btn-danger" data-action="app" data-operation="uninstall" data-busy><svg data-i="trash"></svg>Uninstall…</button></div>
   </div>
  </div>

  <div class="panel" id="panel-captures" role="tabpanel" aria-labelledby="tab-captures" hidden>
   <div class="row">
    <button class="btn btn-primary" data-action="screenshot" data-busy><svg data-i="camera"></svg>Capture screenshot</button>
    <button class="btn btn-secondary" data-action="start-video" id="start-video" data-busy><svg data-i="record" style="color:var(--vscode-errorForeground)"></svg>Start recording</button>
    <button class="btn btn-secondary" data-action="pause-video" id="pause-video" disabled><svg data-i="pause"></svg>Pause capture</button>
    <button class="btn btn-secondary" data-action="stop-video" id="stop-video" disabled><svg data-i="stop"></svg>Stop</button>
    <span class="spacer"></span>
    <button class="btn btn-ghost" data-action="open-captures"><svg data-i="folder"></svg>Open folder</button>
   </div>
   <div class="small muted" id="captureHint">Recording needs the MoTA helper and approval on the phone. Pause capture to leave a period out of the video.</div>
   <div class="preview" id="previewBox" hidden>
    <div class="media"><img id="image" alt="Selected screenshot" hidden><video id="video" controls preload="metadata" crossorigin="anonymous" hidden></video></div>
    <div style="flex:1;min-width:220px;display:flex;flex-direction:column;gap:10px">
     <h2 id="previewName"></h2><div class="small muted" id="previewMeta"></div>
     <div class="row" id="imageActions"><button class="btn btn-secondary" data-action="copy-image" data-image><svg data-i="copy"></svg>Copy image</button><button class="btn btn-secondary" data-action="save-image" data-image><svg data-i="download"></svg>Save as…</button></div>
     <div class="row" id="videoActions" hidden><button class="btn btn-secondary" data-action="copy-frame" data-video><svg data-i="copy"></svg>Copy current frame</button><button class="btn btn-secondary" data-action="save-frame" data-video>Save current frame</button><button class="btn btn-secondary" data-action="save-video" data-video><svg data-i="download"></svg>Save video…</button></div>
    </div>
   </div>
   <h2 class="section-title">Recent captures</h2>
   <div class="gallery" id="gallery"><div class="small muted">No captures yet.</div></div>
  </div>

  <div class="panel" id="panel-logs" role="tabpanel" aria-labelledby="tab-logs" hidden>
   <div class="row">
    <div class="seg" role="group" aria-label="Minimum level" id="levels">${['V', 'D', 'I', 'W', 'E'].map(l => `<button aria-pressed="${l === 'I'}" data-level="${l}">${({ V: 'Verbose', D: 'Debug', I: 'Info', W: 'Warn', E: 'Error' } as Record<string, string>)[l]}</button>`).join('')}</div>
    <label class="search" style="flex:1 1 200px"><svg data-i="search"></svg><input id="logFilter" placeholder="Filter by tag or text" aria-label="Filter logs"></label>
    <label class="check small"><input type="checkbox" id="logApp"> Only the selected app</label>
    <button class="btn btn-secondary" id="logToggle" data-logs="toggle"><svg data-i="pause"></svg>Pause</button>
    <button class="icon-btn" data-logs="clear" title="Clear" aria-label="Clear logs"><svg data-i="trash"></svg></button>
   </div>
   <div class="log" role="log" aria-label="Logcat" id="log"></div>
   <div class="small muted" id="logStatus"></div>
  </div>

  <div class="panel" id="panel-diag" role="tabpanel" aria-labelledby="tab-diag" hidden>
   <div class="row" style="justify-content:space-between"><h2>Device health</h2><div class="row"><button class="btn btn-ghost btn-sm" data-action="diag"><svg data-i="refresh"></svg>Refresh</button><button class="btn btn-secondary" data-action="stats"><svg data-i="activity"></svg>Open live monitor</button></div></div>
   <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px" id="diagCards"></div>
   <div class="card card-pad"><dl class="kv" id="diagKv"><dt>Loading</dt><dd>…</dd></dl></div>
   <div><h2 class="section-title" style="margin-bottom:8px">Raw dumps</h2><div class="row">${[['properties', 'getprop'], ['battery', 'dumpsys battery'], ['memory', 'dumpsys meminfo'], ['activities', 'Activities'], ['display', 'Display size']].map(([p, l]) => `<button class="btn btn-secondary btn-sm" data-action="preset" data-preset="${p}" data-out="diag" data-busy>${l}</button>`).join('')}</div></div>
   <div><h2 class="section-title" style="margin-bottom:8px">Settings on the device</h2><div class="row">${[['settings', 'Settings'], ['wifi', 'Wi-Fi'], ['bluetooth', 'Bluetooth']].map(([p, l]) => `<button class="btn btn-secondary btn-sm" data-action="preset" data-preset="${p}" data-busy>${l}</button>`).join('')}<button class="btn btn-secondary btn-sm" data-action="awake">Keep awake…</button></div></div>
   <pre class="output" id="diagOut" hidden tabindex="0"></pre>
  </div>

  <div class="panel" id="panel-shell" role="tabpanel" aria-labelledby="tab-shell" hidden>
   <div class="row"><div class="seg" role="group" aria-label="Command mode" id="modes"><button aria-pressed="true" data-mode="shell" title="Run Android shell syntax on the device">Android shell</button><button aria-pressed="false" data-mode="adb" title="Device-scoped ADB arguments, such as logcat -d -t 100">adb (this device)</button></div><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-shell="clear">Clear</button><button class="btn btn-ghost" data-action="terminal"><svg data-i="terminal"></svg>Open in terminal</button></div>
   <div class="term"><pre id="transcript" tabindex="0" aria-label="Command output"></pre>
    <form id="shellform"><span class="muted" id="prompt">$</span><input id="command" placeholder="Enter a command · ↑ for history" aria-label="Device command" autocomplete="off" spellcheck="false"><button class="btn btn-secondary btn-sm" data-busy>Run</button></form></div>
   <div class="row small muted"><span>Snippets:</span>${[['dumpsys activity activities | grep -m1 mResumedActivity', 'Current activity'], ['pm list packages -3', 'Installed packages'], ['dumpsys wifi | grep -m1 mWifiInfo', 'Wi-Fi info'], ['getprop ro.build.version.release', 'Android version']].map(([c, l]) => `<button class="btn btn-ghost btn-sm" data-snippet="${esc(c)}">${l}</button>`).join('')}</div>
  </div>

  <div class="panel" id="panel-files" role="tabpanel" aria-labelledby="tab-files" hidden>
   <div class="row">
    <button class="icon-btn" data-files="up" title="Up one folder" aria-label="Up one folder"><svg data-i="arrowLeft"></svg></button>
    <form id="pathform" style="flex:1;min-width:200px;display:flex"><input class="input mono" id="path" value="/sdcard/Download" style="flex:1" aria-label="Device folder"></form>
    <button class="icon-btn" data-files="refresh" title="Refresh" aria-label="Refresh folder"><svg data-i="refresh"></svg></button>
    <button class="btn btn-secondary" data-files="push" data-busy><svg data-i="upload"></svg>Push file…</button>
    <button class="btn btn-secondary" data-files="pull" id="pullBtn" data-busy disabled><svg data-i="download"></svg>Pull selected</button>
   </div>
   <div class="card" style="overflow-x:auto"><table class="files"><thead><tr><th>Name</th><th>Size</th><th>Modified</th></tr></thead><tbody id="files"><tr><td colspan="3" class="muted">Loading…</td></tr></tbody></table></div>
  </div>
 </section>
</div>
<div class="menu" id="menu" role="menu" hidden>
 <button role="menuitem" data-action="awake"><svg data-i="sun"></svg>Keep awake…</button>
 <button role="menuitem" data-action="stats"><svg data-i="activity"></svg>Live monitor</button>
 <button role="menuitem" data-action="recordings"><svg data-i="record"></svg>Input recordings</button>
 <button role="menuitem" data-action="setup"><svg data-i="settings"></svg>Set up helper</button>
 <hr><button role="menuitem" class="danger" data-action="reboot"><svg data-i="power"></svg>Reboot…</button>
</div>
<div class="toast" id="toast" role="status" hidden><span id="toastIcon"></span><div style="flex:1;min-width:0"><div id="toastText" style="overflow-wrap:anywhere"></div><div class="row" id="toastActions" style="margin-top:6px" hidden><button class="btn btn-secondary btn-sm" data-action="copy-error">Copy details</button></div></div><button class="icon-btn" data-toast="close" aria-label="Dismiss" style="width:22px;height:22px"><svg data-i="close"></svg></button></div>
${claudeBarMarkup()}`;
}

const script = `
document.body.classList.add('has-dock');
const $=id=>document.getElementById(id);
const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let info={},apps=[],selectedApp='',lastMessage='',lastError='',toastTimer,outTarget='shell',shellMode='shell',history=[],histPos=0,logLevel='I',logOn=false,logBuf=[],cwd='/sdcard/Download',fileSel='',captures=[],selectedCapture='';
const send=(action,extra)=>api.postMessage(Object.assign({action},extra||{}));
function claudeScope(){return{serials:[DEVICE.serial],label:DEVICE.model};}
function toast(text,error){$('toastText').textContent=text;$('toastIcon').innerHTML=icon(error?'error':'checkCircle','class="i" style="color:'+(error?'var(--vscode-errorForeground)':'var(--vscode-testing-iconPassed,#3fb950)')+'"');$('toastActions').hidden=!error;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?12000:4000);}
function showTab(id){document.querySelectorAll('[role=tab]').forEach(t=>t.setAttribute('aria-selected',String(t.dataset.tab===id)));document.querySelectorAll('[role=tabpanel]').forEach(p=>p.hidden=p.id!=='panel-'+id);
 if(id==='logs'&&!logOn&&!$('log').dataset.started){$('log').dataset.started='1';startLogs();}
 if(id==='diag'&&!$('diagKv').dataset.loaded){$('diagKv').dataset.loaded='1';send('diag');}
 if(id==='files'&&!$('files').dataset.loaded){$('files').dataset.loaded='1';ls(cwd);}
 if(id==='captures')send('captures');
 try{const s=api.getState()||{};s.tab=id;api.setState(s);}catch{}}
// ---- apps
const pkgColor=p=>{let x=0;for(const c of p)x=(x*31+c.charCodeAt(0))>>>0;return 'hsl('+(x%360)+' 45% 42%)';};
const initials=p=>{const parts=p.split('.').filter(Boolean);const n=parts[parts.length-1]||p;return n.slice(0,2).toUpperCase();};
function renderApps(){const q=$('appSearch').value.trim().toLowerCase();const list=apps.filter(p=>!q||p.toLowerCase().includes(q));
 $('applist').innerHTML=list.length?list.map(p=>'<button class="appitem" role="option" aria-selected="'+(p===selectedApp)+'" data-app="'+h(p)+'"><span class="appicon" style="background:'+pkgColor(p)+'">'+h(initials(p))+'</span><span class="mono" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">'+h(p)+'</span></button>').join(''):'<div class="small muted" style="padding:8px 12px">'+(apps.length?'No app matches.':'No third-party apps installed.')+'</div>';}
function selectApp(p){selectedApp=p;$('package').value=p;$('appName').textContent=p?p.split('.').slice(-1)[0]:'No app selected';$('appPkg').textContent=p||'Choose an app above, or type a package ID.';
 $('appIcon').textContent=p?initials(p):'';$('appIcon').style.background=p?pkgColor(p):'var(--vscode-button-background)';$('appInfo').innerHTML='';$('appRun').innerHTML='';renderApps();if(p)send('app-info',{package:p});
 try{const s=api.getState()||{};s.app=p;api.setState(s);}catch{}}
// ---- captures
function fmtSize(b){return b>1048576?(b/1048576).toFixed(1)+' MB':Math.max(1,Math.round(b/1024))+' KB';}
function renderGallery(){$('gallery').innerHTML=captures.length?captures.map(c=>'<button class="shot" aria-selected="'+(c.name===selectedCapture)+'" data-capture="'+h(c.name)+'"><span class="ph">'+(c.kind==='image'?'<img alt="" src="'+h(c.uri)+'">':icon('play','style="width:28px;height:28px"'))+'</span><span class="small muted">'+(c.kind==='image'?'Screenshot':'Video')+' · '+new Date(c.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+'</span></button>').join(''):'<div class="small muted">No captures yet.</div>';}
function showCapture(c){if(!c)return;selectedCapture=c.name;$('previewBox').hidden=false;const isImg=c.kind==='image';
 $('image').hidden=!isImg;$('video').hidden=isImg;$('imageActions').hidden=!isImg;$('videoActions').hidden=isImg;
 if(isImg)$('image').src=c.uri;else{$('video').src=c.uri;$('video').load();}
 $('previewName').textContent=c.label;$('previewMeta').textContent=new Date(c.time).toLocaleString()+' · '+fmtSize(c.size);renderGallery();send('select-capture',{name:c.name});}
function pngBlob(data){const v=atob(data.slice(data.indexOf(',')+1)),b=new Uint8Array(v.length);for(let i=0;i<v.length;i++)b[i]=v.charCodeAt(i);return new Blob([b],{type:'image/png'});}
async function copyImageData(data,fallback){try{if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw 0;await navigator.clipboard.write([new ClipboardItem({'image/png':pngBlob(data)})]);send('copied');}catch{api.postMessage(fallback);}}
function videoFrame(){const v=$('video');if(v.seeking)throw new Error('Wait for the seek to finish before copying the frame.');if(!v.videoWidth||v.readyState<2)throw new Error('Wait for a video frame to load, then pause or seek.');v.pause();const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return c.toDataURL('image/png');}
// ---- logs
function startLogs(){logOn=true;$('logToggle').innerHTML=icon('pause')+'Pause';send('logs-start',{level:logLevel,package:$('logApp').checked?selectedApp:''});$('logStatus').textContent='Streaming '+({V:'all',D:'debug and above',I:'info and above',W:'warnings and errors',E:'errors'})[logLevel]+(($('logApp').checked&&selectedApp)?' for '+selectedApp:'')+'.';}
function stopLogs(){logOn=false;$('logToggle').innerHTML=icon('play')+'Resume';send('logs-stop');$('logStatus').textContent='Paused.';}
function logRow(l){const m=l.match(/^\\S+ \\S+ ([VDIWEF])\\//);return '<div class="'+(m?m[1]:'')+'">'+h(l)+'</div>';}
function renderLogs(){const q=$('logFilter').value.trim().toLowerCase();const el=$('log'),stick=el.scrollTop+el.clientHeight>=el.scrollHeight-20;
 el.innerHTML=logBuf.filter(l=>!q||l.toLowerCase().includes(q)).slice(-1500).map(logRow).join('');if(stick)el.scrollTop=el.scrollHeight;}
// ---- shell
function appendTranscript(cmd,out){const t=$('transcript');t.insertAdjacentHTML('beforeend',(t.textContent?'\\n':'')+'<span class="cmd">'+h((shellMode==='adb'?'adb ':'$ ')+cmd)+'</span>\\n'+h(out||''));t.scrollTop=t.scrollHeight;}
let pendingCmd=null;
// ---- files
function ls(p){cwd=p;$('path').value=p;fileSel='';$('pullBtn').disabled=true;$('files').innerHTML='<tr><td colspan="3" class="muted">Loading…</td></tr>';send('ls',{path:p});}
// ---- state from host
function applyState(m){
 document.querySelectorAll('[data-busy]').forEach(b=>b.disabled=m.working);
 document.querySelectorAll('[data-image]').forEach(b=>b.disabled=!m.hasImage);document.querySelectorAll('[data-video]').forEach(b=>b.disabled=!m.hasVideo);
 const rec=m.capture;$('start-video').disabled=m.working||rec!=='idle';$('hdrRecord').disabled=m.working||rec!=='idle';$('pause-video').disabled=m.working||!['recording','paused'].includes(rec);$('stop-video').disabled=!['awaiting','recording','paused'].includes(rec);
 $('pause-video').innerHTML=icon(rec==='paused'?'play':'pause')+(rec==='paused'?'Resume capture':'Pause capture');
 $('hdrStatus').textContent=rec==='recording'?'Recording':rec==='paused'?'Recording paused':rec==='awaiting'?'Waiting for capture approval':rec==='finalizing'?'Saving recording…':'Ready';
 $('hdrDot').className='dot '+(rec==='recording'||rec==='awaiting'?'fail':rec==='paused'||rec==='finalizing'?'warn':'ready');
 if(m.error&&m.error!==lastError){lastError=m.error;toast(m.message,true);}
 else if(!m.error&&m.message!==lastMessage&&lastMessage)toast(m.message,false);
 if(!m.error)lastError='';lastMessage=m.message;
 if(m.output!==undefined&&!m.working&&pendingCmd!==null){appendTranscript(pendingCmd,m.error?m.message:m.output);pendingCmd=null;}
 else if(m.output&&!m.working&&outTarget==='diag'){$('diagOut').hidden=false;$('diagOut').textContent=m.output;outTarget='';}}
// ---- events
document.addEventListener('click',e=>{const t=e.target;const b=t.closest('button');
 if(!t.closest('#menu')&&!(b&&b.dataset.menu))$('menu').hidden=true;
 if(!b||t.closest('#aiDock'))return;
 if(b.dataset.tab){showTab(b.dataset.tab);return;}
 if(b.dataset.menu){const m=$('menu');if(!m.hidden){m.hidden=true;return;}m.hidden=false;const r=b.getBoundingClientRect();m.style.top=(r.bottom+4)+'px';m.style.left=Math.max(8,r.right-m.offsetWidth)+'px';return;}
 if(b.dataset.toast){$('toast').hidden=true;return;}
 if(b.dataset.app){selectApp(b.dataset.app);return;}
 if(b.dataset.capture){showCapture(captures.find(c=>c.name===b.dataset.capture));return;}
 if(b.dataset.level){logLevel=b.dataset.level;document.querySelectorAll('[data-level]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));if(logOn)startLogs();return;}
 if(b.dataset.logs==='toggle'){logOn?stopLogs():startLogs();return;}
 if(b.dataset.logs==='clear'){logBuf=[];renderLogs();return;}
 if(b.dataset.mode){shellMode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));$('prompt').textContent=shellMode==='adb'?'adb':'$';$('command').focus();return;}
 if(b.dataset.shell==='clear'){$('transcript').textContent='';return;}
 if(b.dataset.snippet){if(shellMode!=='shell')document.querySelector('[data-mode=shell]').click();$('command').value=b.dataset.snippet;$('command').focus();return;}
 if(b.dataset.files==='up'){const p=cwd.replace(/\\/+$/,'');ls(p.slice(0,p.lastIndexOf('/'))||'/');return;}
 if(b.dataset.files==='refresh'){ls(cwd);return;}
 if(b.dataset.files==='push'){send('push',{path:cwd.replace(/\\/?$/,'/')});return;}
 if(b.dataset.files==='pull'){if(fileSel)send('pull',{path:fileSel});return;}
 if(b.dataset.dir){ls(b.dataset.dir);return;}
 if(b.dataset.file){fileSel=b.dataset.file;$('pullBtn').disabled=false;document.querySelectorAll('#files tr').forEach(r=>r.setAttribute('aria-selected',String(r.dataset.path===fileSel)));return;}
 if(b.dataset.key){liveKey(b.dataset.key);return;}
 const action=b.dataset.action;if(!action||b.disabled)return;
 $('menu').hidden=true;
 if(action==='copy-image'){const img=$('image');if(img.src.startsWith('data:'))copyImageData(img.src,{action:'copy-image'});else send('copy-image');return;}
 if(action==='copy-frame'||action==='save-frame'){try{const png=videoFrame();if(action==='copy-frame')copyImageData(png,{action,png});else send(action,{png});}catch(err){toast(String(err.message||err),true);}return;}
 if(action==='preset'){outTarget=b.dataset.out||'';if(outTarget==='diag'){$('diagOut').hidden=false;$('diagOut').textContent='Running…';}send('preset',{preset:b.dataset.preset});return;}
 if(action==='app'){const pkg=$('package').value.trim();if(!pkg){toast('Choose an installed app or type its package ID.',true);return;}send('app',{operation:b.dataset.operation,package:pkg});return;}
 send(action);});
$('appSearch').addEventListener('input',renderApps);
$('package').addEventListener('change',()=>{const p=$('package').value.trim();if(p&&p!==selectedApp)selectApp(p);});
$('deeplinkform').addEventListener('submit',e=>{e.preventDefault();const uri=$('uri').value.trim();if(uri)send('deeplink',{uri,package:$('package').value.trim()});});
$('logFilter').addEventListener('input',renderLogs);
$('logApp').addEventListener('change',()=>{if($('logApp').checked&&!selectedApp){toast('Choose an app on the Apps tab first.',true);$('logApp').checked=false;return;}if(logOn)startLogs();});
$('shellform').addEventListener('submit',e=>{e.preventDefault();const c=$('command').value.trim();if(!c)return;history.push(c);histPos=history.length;pendingCmd=c;$('command').value='';send('command',{mode:shellMode,command:c});});
$('command').addEventListener('keydown',e=>{if(e.key==='ArrowUp'&&histPos>0){e.preventDefault();$('command').value=history[--histPos];}else if(e.key==='ArrowDown'){e.preventDefault();histPos=Math.min(history.length,histPos+1);$('command').value=history[histPos]||'';}});
$('pathform').addEventListener('submit',e=>{e.preventDefault();const p=$('path').value.trim();if(p.startsWith('/'))ls(p);else toast('Enter an absolute folder path, such as /sdcard/Download.',true);});
$('textform').addEventListener('submit',e=>{e.preventDefault();const v=$('text').value;if(v){liveText(v);$('text').value='';}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('menu').hidden=true;$('toast').hidden=true;}});
const vid=$('video');vid.addEventListener('error',()=>{if(vid.src)toast('This video could not be played here. Save the MP4 and open it in a video player.',true);});
window.addEventListener('message',e=>{const m=e.data;if(!m||!m.kind)return;
 if(liveMessage(m))return;
 if(m.kind==='state')applyState(m);
 else if(m.kind==='info'){info=m.info||{};const i=info;$('hdrSub').textContent=[i.manufacturer,i.android&&'Android '+i.android+(i.sdk?' (API '+i.sdk+')':''),m.connection,i.battery!=null?i.battery+'%'+(i.charging?' charging':''):'',DEVICE.serial].filter(Boolean).join(' · ');liveInfo(i);}
 else if(m.kind==='packages'){apps=m.list||[];if(m.error)toast(m.error,true);renderApps();if(!selectedApp){const s=(()=>{try{return api.getState()?.app;}catch{return '';}})()||m.last;if(s&&apps.includes(s))selectApp(s);}}
 else if(m.kind==='app-info'){if(m.package!==selectedApp)return;const i=m.info;
  $('appInfo').innerHTML=i?['Version',i.version||'—','Installed',i.installed||'—','Updated',i.updated||'—','Target / min SDK',(i.targetSdk||'—')+' / '+(i.minSdk||'—')].reduce((a,v,k,arr)=>k%2?a:a+'<dt>'+h(v)+'</dt><dd>'+h(arr[k+1])+'</dd>','')+(i.debuggable?'<dt>Build</dt><dd>Debuggable</dd>':''):'<dt>Status</dt><dd>Not installed</dd>';
  $('appRun').innerHTML=i&&i.pid?'<span class="dot ready"></span>Running · pid '+h(i.pid):i?'<span class="dot off"></span>Not running':'';}
 else if(m.kind==='captures'){captures=m.items||[];renderGallery();const sel=captures.find(c=>c.name===(m.select||selectedCapture));if(m.select&&sel)showCapture(sel);}
 else if(m.kind==='screenshot'){send('captures');}
 else if(m.kind==='video'){send('captures');}
 else if(m.kind==='log'){logBuf.push(...m.lines);if(logBuf.length>4000)logBuf=logBuf.slice(-3000);renderLogs();}
 else if(m.kind==='log-ended'){logOn=false;$('logToggle').innerHTML=icon('play')+'Resume';$('logStatus').textContent=m.text||'Log stream ended.';}
 else if(m.kind==='diag'){const d=m.diag||{};
  $('diagCards').innerHTML=[['Battery',d.battery!=null?d.battery+'%':'—',[d.charging?'Charging':'On battery',d.temperature!=null?d.temperature+' °C':''].filter(Boolean).join(' · ')],['Memory',d.memUsed!=null?d.memUsed+' / '+d.memTotal+' GB':'—',d.memPct!=null?d.memPct+'% used':''],['Storage',d.storageFree||'—',d.storageTotal?'free of '+d.storageTotal:''],['Display',d.width?d.width+' × '+d.height:'—',d.density?d.density+' dpi':'']]
   .map(c=>'<div class="card card-pad stat"><span class="small muted">'+c[0]+'</span><span class="v">'+h(c[1])+'</span><span class="small muted">'+h(c[2])+'</span></div>').join('');
  $('diagKv').innerHTML=[['Model',d.model],['Build',d.build],['Security patch',d.patch],['ABI',d.abi],['Managed by MoTA',d.managed?'Yes':'No']].filter(r=>r[1]!==undefined&&r[1]!=='').map(r=>'<dt>'+h(r[0])+'</dt><dd>'+h(r[1])+'</dd>').join('');}
 else if(m.kind==='files'){if(m.path!==cwd)return;if(m.error){$('files').innerHTML='<tr><td colspan="3" style="color:var(--vscode-errorForeground)">'+h(m.error)+'</td></tr>';return;}
  $('files').innerHTML=m.entries.length?m.entries.map(f=>{const full=(cwd==='/'?'':cwd.replace(/\\/+$/,''))+'/'+f.name;return '<tr data-path="'+h(full)+'"><td><button '+(f.dir?'data-dir':'data-file')+'="'+h(full)+'">'+icon(f.dir?'folder':'file')+h(f.name)+'</button></td><td class="muted">'+(f.dir?'—':fmtSize(f.size))+'</td><td class="muted">'+h(f.modified)+'</td></tr>';}).join(''):'<tr><td colspan="3" class="muted">This folder is empty.</td></tr>';}
});
function start(){const s=(()=>{try{return api.getState()||{};}catch{return{};}})();send('ready');send('info');send('packages');send('captures');liveStart();if(s.tab&&s.tab!=='apps')showTab(s.tab);}
`;
