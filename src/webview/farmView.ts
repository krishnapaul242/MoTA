import { consoleScript, consoleStyles } from '../adbConsole';
import { claudeBarMarkup, claudeBarScript, claudeBarStyles } from './claudeBar';
import { themedPage } from './page';
import { liveTouchScript } from './liveTouch';

/** Device farm webview (approved design: design-mockups/farm.html and farm-live.html). Host logic stays in deviceFarm.ts. */
export function farmHtml(cspSource: string) {
  return themedPage('Device farm', `<div id="app" class="has-dock-root">${body}</div>${claudeBarMarkup({ adb: true })}`, styles + claudeBarStyles + consoleStyles, script + claudeBarScript + consoleScript + '\napi.postMessage({action:\'ready\'});', cspSource);
}

const styles = `
.farm{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:16px}
.dev{background:var(--vscode-sideBar-background,var(--vscode-editor-background));border:1px solid var(--vscode-panel-border);border-radius:8px;overflow:hidden;display:flex;flex-direction:column}
.dev.selected{border-color:var(--vscode-focusBorder);box-shadow:0 0 0 1px var(--vscode-focusBorder)}
.dev .stage{position:relative;height:292px;background:var(--mota-stage);display:flex;align-items:center;justify-content:center;padding:14px}
.dev .stage.clickable{cursor:pointer}
.dev .stage img{max-width:100%;max-height:100%;object-fit:contain;border-radius:10px;border:3px solid var(--mota-bezel)}
.dev .stage .pill{position:absolute;top:10px;left:10px}
.dev .stage .msg{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;max-width:200px;font-size:12px;color:var(--vscode-descriptionForeground)}
.dev .stage .msg b{color:var(--mota-heading);font-size:13px}
.dev .stage .msg svg.i{width:26px;height:26px;stroke-width:1.1}
.pick{position:absolute;top:9px;right:9px;width:18px;height:18px;margin:0;accent-color:var(--vscode-button-background);cursor:pointer;opacity:0;transition:opacity .12s}
.dev:hover .pick,.pick:checked,.pick:focus-visible,body.selecting .pick{opacity:1}
.dev .meta{padding:10px 12px 12px;display:flex;flex-direction:column;gap:6px}
.dev .top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.name{font-weight:600;color:var(--mota-heading);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chips{display:flex;gap:12px;flex-wrap:wrap}
table.list{width:100%;border-collapse:collapse;min-width:760px}
table.list th{text-align:left;font-weight:600;font-size:12px;color:var(--vscode-descriptionForeground);padding:6px 10px;border-bottom:1px solid var(--vscode-panel-border)}
table.list td{padding:8px 10px;border-bottom:1px solid var(--vscode-panel-border);vertical-align:middle}
table.list tr.selected td{background:var(--vscode-list-activeSelectionBackground)}
table.list tr:hover td{background:var(--vscode-list-hoverBackground)}
table.list .pick{position:static;opacity:1}
.thumb{width:26px;height:54px;border-radius:5px;border:2px solid var(--mota-bezel);overflow:hidden;background:var(--mota-stage);display:block;object-fit:cover}
#cardMenu,#moreMenu{position:fixed}
.errline{color:var(--vscode-errorForeground);margin:0}
.errline:empty{display:none}
/* live view */
.live-split{flex:1;display:flex;flex-wrap:wrap;min-height:0}
.rail{flex:1 1 240px;max-width:280px;border-right:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background,var(--vscode-editor-background));display:flex;flex-direction:column;overflow:auto}
.rail-item{display:flex;gap:10px;align-items:center;width:100%;padding:8px 14px;border:0;border-left:2px solid transparent;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.rail-item:hover{background:var(--vscode-list-hoverBackground)}
.rail-item[aria-current="true"]{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground,inherit);border-left-color:var(--vscode-focusBorder)}
.rail-item[disabled]{opacity:.55;cursor:default}
.lv-main{flex:999 1 560px;min-width:0;display:flex;flex-direction:column}
.lv-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-bottom:1px solid var(--vscode-panel-border)}
.lv-work{flex:1;display:flex;flex-wrap:wrap;min-height:0}
.lv-stage{flex:0 0 auto;display:flex;justify-content:center;align-items:flex-start;padding:20px 24px;background:var(--mota-stage);border-right:1px solid var(--vscode-panel-border)}
.lv-col{display:grid;gap:10px;justify-items:stretch}
.lv-screen{position:relative;display:flex;align-items:center;justify-content:center;min-width:240px;min-height:420px;border-radius:22px;border:6px solid var(--mota-bezel);background:#000;overflow:hidden}
.lv-screen img,.lv-screen canvas{display:block;height:min(640px,calc(100vh - 300px));min-height:400px;width:auto;max-width:min(46vw,560px);object-fit:contain;touch-action:none;user-select:none;-webkit-user-drag:none;cursor:crosshair}
.lv-screen .msg{color:#bbb;font-size:12px;padding:24px;text-align:center}
.devtools{display:flex;flex-direction:column;gap:2px;padding:6px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));border-radius:8px}
.devtools hr{width:100%;border:0;border-top:1px solid var(--vscode-widget-border,var(--vscode-panel-border));margin:4px 0}
.lv-side{flex:1 1 320px;min-width:0;padding:20px;display:flex;flex-direction:column;gap:16px;overflow:auto}
.lv-side .card{padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;font-size:12px;margin:0}
.kv dt{color:var(--vscode-descriptionForeground)}
.kv dd{margin:0;color:var(--mota-heading);display:flex;align-items:center;gap:6px;min-width:0;overflow-wrap:anywhere}
/* add device */
.addtabs{display:flex;gap:2px;border-bottom:1px solid var(--vscode-panel-border);margin:12px 0 16px;overflow-x:auto}
.dialog form{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}
.dialog form .field{flex:1;min-width:150px}
.qrbox{display:flex;justify-content:center;margin:8px 0}
.qrbox img{background:#fff;border-radius:10px;width:240px;height:240px}.qrbox img.big{width:300px;height:300px}
.dialog ol{padding-left:20px;margin:6px 0 12px}
.dialog .chips{margin-top:10px;gap:6px}
`;

const body = `
<div id="gridView" class="page">
 <header class="page-header">
  <div><h1>Devices</h1><div class="subtitle" id="summary">Looking for devices…</div></div>
  <div class="row"><button class="btn btn-secondary" data-top="refresh"><svg data-i="refresh"></svg>Refresh</button><button class="btn btn-primary" data-top="add"><svg data-i="plus"></svg>Add device</button></div>
 </header>
 <div class="row" style="gap:10px">
  <label class="search" style="flex:1 1 260px;max-width:360px"><svg data-i="search"></svg><input id="search" placeholder="Search name, model, Android version, serial" aria-label="Search devices"></label>
  <div class="seg" role="group" aria-label="Filter by status" id="filter">
   <button aria-pressed="true" data-f="all">All <span class="count" id="c-all">0</span></button>
   <button aria-pressed="false" data-f="ready">Ready <span class="count" id="c-ready">0</span></button>
   <button aria-pressed="false" data-f="attention">Needs attention <span class="count" id="c-attention">0</span></button>
   <button aria-pressed="false" data-f="offline">Offline <span class="count" id="c-offline">0</span></button>
  </div>
  <button class="btn btn-ghost btn-sm" data-top="select-all">Select all ready</button>
  <span class="spacer"></span>
  <label class="check small"><input type="checkbox" id="live" checked> Live screens</label>
  <div class="seg" role="group" aria-label="Layout" id="layout">
   <button aria-pressed="true" data-l="grid" aria-label="Grid view" title="Grid"><svg data-i="grid"></svg></button>
   <button aria-pressed="false" data-l="list" aria-label="List view" title="List"><svg data-i="list"></svg></button>
  </div>
 </div>
 <p class="errline" id="error" role="alert"></p>
 <div class="card card-pad row" id="testBanner" hidden style="background:var(--mota-live-bg);border-color:var(--vscode-focusBorder)"></div>
 <div id="view"></div>
 <div class="floating-bar" id="selbar" role="toolbar" aria-label="Actions for selected devices" hidden>
  <span style="font-weight:600;color:var(--mota-heading);margin-right:6px" id="selcount"></span>
  <button class="btn btn-primary" data-bulk="tests"><svg data-i="flask"></svg>Run tests</button>
  <button class="btn btn-secondary" data-bulk="install"><svg data-i="package"></svg>Install APK</button>
  <button class="btn btn-secondary" data-bulk="launch"><svg data-i="play"></svg>Launch app</button>
  <span class="divider"></span>
  <button class="icon-btn" data-bulk="back" title="Back" aria-label="Back"><svg data-i="back"></svg></button>
  <button class="icon-btn" data-bulk="home" title="Home" aria-label="Home"><svg data-i="home"></svg></button>
  <button class="icon-btn" data-bulk="wake" title="Wake screen" aria-label="Wake screen"><svg data-i="sun"></svg></button>
  <button class="icon-btn" data-bulk="sleep" title="Sleep screen" aria-label="Sleep screen"><svg data-i="moon"></svg></button>
  <span class="divider"></span>
  <button class="btn btn-ghost" data-top="more" aria-haspopup="menu">More<svg data-i="chevronDown"></svg></button>
  <button class="icon-btn" data-top="clear" title="Clear selection (Esc)" aria-label="Clear selection"><svg data-i="close"></svg></button>
 </div>
</div>

<div id="liveView" class="live-split" hidden>
 <aside class="rail" aria-label="Devices">
  <div class="row" style="padding:14px 14px 10px;justify-content:space-between;flex-wrap:nowrap">
   <button class="btn btn-ghost btn-sm" data-view="close" title="Back to all devices (Esc)"><svg data-i="arrowLeft"></svg>Devices</button>
   <button class="icon-btn" data-top="add" aria-label="Add device" title="Add device"><svg data-i="plus"></svg></button>
  </div>
  <div id="rail"></div>
 </aside>
 <main class="lv-main">
  <header class="lv-head">
   <div><div class="row" style="gap:10px"><h1 style="font-size:16px" id="vtitle"></h1><span class="live-pill" id="livemode">Connecting…</span></div><div class="subtitle" id="vsub"></div></div>
   <div class="row" style="gap:6px"><button class="btn btn-secondary" data-view="controls">Open full controls</button><button class="icon-btn" data-view="close" title="Close live view (Esc)" aria-label="Close live view"><svg data-i="close"></svg></button></div>
  </header>
  <div class="lv-work">
   <section class="lv-stage" aria-label="Live screen">
    <div class="lv-col">
     <div style="display:flex;gap:12px;align-items:flex-start">
      <div class="lv-screen"><canvas id="livecanvas" hidden role="img" aria-label="Live device video. Click to tap, drag to swipe."></canvas><img id="liveimg" alt="Live device screen. Click to tap, drag to swipe." draggable="false" hidden><span class="msg" id="livemsg">Connecting…</span></div>
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
     <form id="textform" class="row" style="flex-wrap:nowrap"><label class="search" style="flex:1"><svg data-i="keyboard"></svg><input id="text" placeholder="Type on device" aria-label="Text to type on the device" autocomplete="off"></label><button class="btn btn-secondary">Send</button></form>
     <div class="small muted" style="text-align:center">Click to tap · drag to swipe</div>
    </div>
   </section>
   <aside class="lv-side" aria-label="Quick actions and details">
    <section class="card">
     <div class="row" style="justify-content:space-between"><h2>App</h2><button class="btn btn-ghost btn-sm" data-lv="packages" title="Reload the list of installed apps"><svg data-i="refresh"></svg></button></div>
     <div class="row" style="flex-wrap:nowrap">
      <select class="select" id="lvPackage" style="flex:1;min-width:0" aria-label="Installed app"><option value="">Loading installed apps…</option></select>
      <button class="btn btn-primary" data-lv="launch"><svg data-i="play"></svg>Launch</button>
      <button class="btn btn-secondary" data-lv="stop">Force stop</button>
     </div>
     <form class="row" id="deeplinkform" style="flex-wrap:nowrap"><input class="input mono" id="lvLink" style="flex:1;min-width:0" placeholder="Deep link, e.g. myapp://product/123" aria-label="Deep link"><button class="btn btn-secondary"><svg data-i="link"></svg>Open</button></form>
     <div class="row"><button class="btn btn-ghost btn-sm" data-view="install"><svg data-i="package"></svg>Install APK…</button><button class="btn btn-ghost btn-sm" data-view="monitor"><svg data-i="activity"></svg>Monitor</button><button class="btn btn-ghost btn-sm" data-view="logs"><svg data-i="logs"></svg>Logs</button></div>
    </section>
    <section class="card"><h2>Device</h2><dl class="kv" id="lvInfo"></dl></section>
   </aside>
  </div>
 </main>
</div>

<div class="menu" id="moreMenu" role="menu" hidden>
 <button role="menuitem" data-bulk="monitor"><svg data-i="activity"></svg>Monitor</button>
 <button role="menuitem" data-bulk="logs"><svg data-i="logs"></svg>Logs</button>
 <button role="menuitem" data-bulk="awake"><svg data-i="sun"></svg>Keep awake…</button>
 <button role="menuitem" data-bulk="managed" title="Managed phones only: stay awake while charging and postpone system updates for 30 days"><svg data-i="shield"></svg>Farm defaults</button>
 <hr>
 <button role="menuitem" data-bulk="disconnect"><svg data-i="wifiOff"></svg>Disconnect (Wi-Fi)</button>
 <button role="menuitem" class="danger" data-bulk="reboot"><svg data-i="power"></svg>Reboot…</button>
</div>
<div class="menu" id="cardMenu" role="menu" hidden></div>

<div class="modal" id="add" hidden><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="addtitle">
 <div class="row" style="justify-content:space-between"><h2 id="addtitle">Add a device</h2><button class="icon-btn" data-add="close" aria-label="Close"><svg data-i="close"></svg></button></div>
 <nav class="tabs addtabs" role="tablist"><button role="tab" data-tab="qr" aria-selected="true">QR code</button><button role="tab" data-tab="code" aria-selected="false">Pairing code</button><button role="tab" data-tab="address" aria-selected="false">IP address</button><button role="tab" data-tab="usb" aria-selected="false">USB</button><button role="tab" data-tab="managed" aria-selected="false">Managed setup</button></nav>
 <section data-pane="qr"><ol><li>Connect the phone to the same Wi-Fi as this computer.</li><li>On the phone (Android 11+), open <b>Developer options → Wireless debugging → Pair device with QR code</b>.</li><li>Scan this code.</li></ol>
  <div class="qrbox"><img id="qrimg" alt="ADB pairing QR code" hidden></div><p class="st" id="st-qr" role="status"></p><button class="btn btn-secondary btn-sm" data-add="qr-new">New QR code</button></section>
 <section data-pane="code" hidden><ol><li>On the phone, open <b>Developer options → Wireless debugging → Pair device with pairing code</b>.</li><li>Enter the IP address &amp; port and the 6-digit code it shows.</li></ol>
  <form id="codeform"><label class="field"><span>IP address &amp; port</span><input class="input" id="pairaddr" placeholder="192.168.1.10:37099" autocomplete="off"></label><label class="field" style="max-width:130px"><span>Pairing code</span><input class="input" id="paircode" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="off"></label><button class="btn btn-primary">Pair</button></form><p class="st" id="st-code" role="status"></p></section>
 <section data-pane="address" hidden><p class="muted">For a phone that is already paired, or one switched to <code>adb tcpip</code> mode. Use the IP address &amp; port on the main <b>Wireless debugging</b> screen, not the pairing port. The port changes whenever Wireless debugging restarts.</p>
  <form id="addrform"><label class="field"><span>IP address &amp; port</span><input class="input" id="addr" placeholder="192.168.1.10:41235" autocomplete="off"></label><button class="btn btn-primary">Connect</button></form><div class="chips" id="recent"></div><p class="st" id="st-address" role="status"></p></section>
 <section data-pane="usb" hidden><ol><li>On the phone, open <b>Settings → About phone</b> and tap <b>Build number</b> seven times to enable Developer options.</li><li>Turn on <b>Developer options → USB debugging</b>.</li><li>Plug the phone in and accept the <b>Allow USB debugging</b> prompt.</li></ol><p class="muted">USB devices appear here automatically.</p></section>
 <section data-pane="managed" hidden><p class="muted">Makes MoTA the device owner of a dedicated test phone, so it can install apps and grant permissions without a SIM, Mi account or USB security settings. <b>This needs a factory reset.</b></p>
  <ol><li>Factory reset the phone. Don't add a Google or Mi account.</li><li>On the first setup screen, tap the same spot six times to open the QR scanner.</li><li>Scan the code. The phone downloads the MoTA helper from this computer and finishes setup with it.</li><li>Turn on Developer options and USB debugging, plug the phone in, and turn on MoTA Recorder in Accessibility settings.</li></ol>
  <form id="provform"><label class="field"><span>This computer's address</span><select class="select" id="provaddr" aria-label="Network address the phone downloads from"></select></label><label class="field"><span>Wi-Fi name (optional)</span><input class="input" id="provssid" autocomplete="off" maxlength="32"></label><label class="field"><span>Wi-Fi password</span><input class="input" id="provpass" type="password" autocomplete="off" maxlength="63"></label><button class="btn btn-primary">Create setup QR</button></form>
  <p class="small muted">The phone must reach this computer on the same network. macOS may ask whether VS Code can accept incoming connections. Anyone who scans the code can read a Wi-Fi password in it.</p>
  <div class="qrbox"><img id="provimg" class="big" alt="Device-owner setup QR code" hidden></div><p class="st" id="st-managed" role="status"></p><button class="btn btn-secondary btn-sm" data-add="prov-stop" id="provstop" hidden>Stop serving</button></section>
</div></div>
<div class="toast" id="notice" role="status" hidden><span id="noticeIcon"></span><div id="noticeText"></div><button class="icon-btn" data-top="dismiss" aria-label="Dismiss" style="width:22px;height:22px"><svg data-i="close"></svg></button></div>
`;

// Globals `$`, `esc`, `devices`, `selected` and `api` are also used by consoleScript (src/adbConsole.ts).
const script = `
document.body.classList.add('has-dock');
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let devices=[],last='',focus=null,noticeTimer,filter='all',layout='grid',menuSerial=null;const selected=new Set(),frames={},frameErrors={};
const online=d=>d.state==='device';
const kindOf=d=>online(d)?'ready':d.state==='remembered'?'offline':'attention';
function statusOf(d){const t=testState(d.serial);if(t)return t;if(focus===d.serial)return['In use · live','live'];return{device:['Ready','ready'],unauthorized:['Unauthorized','warn'],offline:['Offline','fail'],remembered:['Not connected','off']}[d.state]||[d.state,'off'];}
function matches(d){const q=$('search').value.trim().toLowerCase();if(filter!=='all'&&kindOf(d)!==filter)return false;
 const i=d.info||{};return !q||[d.model,d.serial,d.kind,i.manufacturer,i.android&&'android '+i.android,i.managed&&'managed'].some(v=>v&&String(v).toLowerCase().includes(q));}
const sub=d=>{const i=d.info||{};return[i.manufacturer,i.android&&'Android '+i.android].filter(Boolean).join(' · ')||(online(d)?'':d.serial);};
const connChip=d=>'<span class="chip">'+icon(d.kind==='USB'?'usb':d.kind==='Wi-Fi'?'wifi':'phone')+esc(d.kind)+'</span>';
function batteryChip(d){const i=d.info||{};if(i.battery==null)return'';const low=i.battery<=20&&!i.charging;return'<span class="chip'+(low?' warn':'')+'">'+icon(i.charging?'bolt':'battery')+i.battery+'%'+(i.charging?' · charging':low?' · low':'')+'</span>';}
function chips(d){const i=d.info||{};return connChip(d)+(online(d)?batteryChip(d)+(i.width?'<span class="chip">'+i.width+' × '+i.height+'</span>':''):'')+(i.managed?'<span class="chip">'+icon('shield')+'Managed</span>':'');}
function stageInner(d){
 if(online(d))return frames[d.serial]?'<img src="'+frames[d.serial]+'" alt="Screen of '+esc(d.model)+'">':'<div class="msg">'+icon(frameErrors[d.serial]?'warn':'phone')+'<span>'+esc(frameErrors[d.serial]||($('live').checked?'Loading screen…':'Live screens are off'))+'</span></div>';
 if(d.state==='unauthorized')return'<div class="msg">'+icon('warn','style="color:var(--vscode-editorWarning-foreground)"')+'<b>Waiting for authorization</b><span>Unlock the phone and tap <b>Allow</b> on the USB debugging prompt.</span></div>';
 if(d.state==='offline')return'<div class="msg">'+icon('warn')+'<b>Offline</b><span>Reconnect the cable or Wi-Fi, or restart ADB from the ADB tab below.</span></div>';
 return'<div class="msg">'+icon('wifiOff')+'<b>Not connected</b><span>Wireless debugging ports change, so reconnect or pair again.</span><button class="btn btn-secondary btn-sm" data-card="reconnect">Reconnect</button></div>';}
function card(d){const [label,dot]=statusOf(d),on=online(d),sel=selected.has(d.serial);
 return '<article class="dev'+(sel?' selected':'')+'" data-serial="'+esc(d.serial)+'"><div class="stage'+(on?' clickable':'')+'"'+(on?' data-card="open" title="Open live view"':'')+'>'+stageInner(d)
  +'<span class="pill"><span class="dot '+dot+'"></span>'+esc(label)+'</span>'
  +(on?'<input type="checkbox" class="pick" data-select aria-label="Select '+esc(d.model)+'"'+(sel?' checked':'')+'>':'')+'</div>'
  +'<div class="meta"><div class="top"><div style="min-width:0"><div class="name" title="'+esc(d.serial)+'">'+esc(d.model)+'</div><div class="small muted">'+esc(sub(d))+'</div></div>'
  +'<div class="row" style="flex-wrap:nowrap;gap:2px">'+(on?'<button class="btn btn-secondary btn-sm" data-card="open">Open</button>':'')+'<button class="icon-btn" data-card="menu" aria-haspopup="menu" aria-label="More actions for '+esc(d.model)+'"><svg data-i="more"></svg></button></div></div>'
  +'<div class="chips">'+chips(d)+'</div></div></article>';}
function row(d){const [label,dot]=statusOf(d),on=online(d),sel=selected.has(d.serial);
 return '<tr class="'+(sel?'selected':'')+'" data-serial="'+esc(d.serial)+'"><td style="width:32px">'+(on?'<input type="checkbox" class="pick" data-select aria-label="Select '+esc(d.model)+'"'+(sel?' checked':'')+'>':'')+'</td>'
  +'<td style="width:40px">'+(frames[d.serial]&&on?'<img class="thumb" alt="" src="'+frames[d.serial]+'">':'<span class="thumb"></span>')+'</td>'
  +'<td><div class="name">'+esc(d.model)+'</div><div class="small muted">'+esc(sub(d))+'</div></td>'
  +'<td><span class="status"><span class="dot '+dot+'"></span>'+esc(label)+'</span></td><td>'+connChip(d)+'</td><td>'+(on?batteryChip(d)||'<span class="muted">—</span>':'<span class="muted">—</span>')+'</td>'
  +'<td class="muted">'+((d.info||{}).width?d.info.width+' × '+d.info.height:'—')+'</td><td class="mono muted">'+esc(d.serial)+'</td>'
  +'<td style="text-align:right;white-space:nowrap">'+(on?'<button class="btn btn-secondary btn-sm" data-card="open">Open</button>':d.state==='remembered'?'<button class="btn btn-secondary btn-sm" data-card="reconnect">Reconnect</button>':'')+'<button class="icon-btn" data-card="menu" aria-haspopup="menu" aria-label="More actions for '+esc(d.model)+'"><svg data-i="more"></svg></button></td></tr>';}
function render(){
 const c={all:devices.length,ready:0,attention:0,offline:0};for(const d of devices)c[kindOf(d)]++;
 for(const k in c)$('c-'+k).textContent=c[k];
 $('summary').textContent=devices.length?c.ready+' ready · '+c.attention+' need'+(c.attention===1?'s':'')+' attention · '+c.offline+' offline':'No devices yet';
 const shown=devices.filter(matches),view=$('view');
 if(!shown.length)view.innerHTML='<div class="empty">'+(devices.length?'<h2>No devices match</h2><p class="muted" style="margin:0">Clear the search or the status filter.</p>':'<h2>No devices yet</h2><p class="muted" style="margin:0">Connect a phone over USB, or pair one over Wi-Fi.</p><button class="btn btn-primary" data-top="add"><svg data-i="plus"></svg>Add device</button>')+'</div>';
 else if(layout==='grid')view.innerHTML='<div class="farm">'+shown.map(card).join('')+'</div>';
 else view.innerHTML='<div class="card" style="overflow-x:auto"><table class="list"><thead><tr><th></th><th></th><th>Device</th><th>Status</th><th>Connection</th><th>Battery</th><th>Resolution</th><th>Serial</th><th></th></tr></thead><tbody>'+shown.map(row).join('')+'</tbody></table></div>';
 document.body.classList.toggle('selecting',selected.size>0);
 $('selbar').hidden=!selected.size;$('selcount').textContent=selected.size+' selected';
 drawIcons();if(focus)renderRail();if(window.claudeBar)claudeBar.refreshScope();}
const serialOf=el=>el.closest('[data-serial]')?.dataset.serial;
const device=s=>devices.find(d=>d.serial===s);
function notice(text,error){const n=$('notice');$('noticeText').textContent=text;$('noticeIcon').innerHTML=icon(error?'error':'checkCircle','class="i '+(error?'bad':'ok')+'"');n.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>n.hidden=true,error?10000:4000);}
// Claude bar scope: the live device, else the selection, else every ready device.
function claudeAllReady(){const r=devices.filter(online);return{serials:r.map(d=>d.serial),label:'All ready devices ('+r.length+')'};}
function claudeScope(){if(focus){const d=device(focus);return{serials:[focus],label:d?d.model:focus};}
 if(selected.size){const s=[...selected];return{serials:s,label:s.length===1?(device(s[0])||{}).model||s[0]:s.length+' selected devices'};}
 return claudeAllReady();}
function closeMenus(){$('moreMenu').hidden=true;$('cardMenu').hidden=true;menuSerial=null;}
function placeMenu(menu,anchor){menu.hidden=false;const r=anchor.getBoundingClientRect(),w=menu.offsetWidth,hgt=menu.offsetHeight;
 let top=r.bottom+4;if(top+hgt>innerHeight-8)top=Math.max(8,r.top-hgt-4);menu.style.top=top+'px';menu.style.left=Math.max(8,Math.min(innerWidth-w-8,r.right-w))+'px';const f=menu.querySelector('button');if(f)f.focus();}
function openCardMenu(serial,anchor){const d=device(serial);if(!d)return;menuSerial=serial;const on=online(d);
 $('cardMenu').innerHTML=(on?'<button role="menuitem" data-cm="open">'+icon('phone')+'Open live view</button><button role="menuitem" data-cm="controls">'+icon('settings')+'Full controls</button><button role="menuitem" data-cm="install">'+icon('package')+'Install APK…</button><button role="menuitem" data-cm="logs">'+icon('logs')+'Logs</button><button role="menuitem" data-cm="monitor">'+icon('activity')+'Monitor</button><hr>'
  +(d.kind==='Wi-Fi'?'<button role="menuitem" data-cm="disconnect">'+icon('wifiOff')+'Disconnect</button>':'')+'<button role="menuitem" class="danger" data-cm="reboot">'+icon('power')+'Reboot…</button>'
  :(d.state==='remembered'||d.kind==='Wi-Fi'?'<button role="menuitem" data-cm="reconnect">'+icon('refresh')+'Reconnect</button>':'')+'<button role="menuitem" data-cm="copy">'+icon('copy')+'Copy serial</button>');
 placeMenu($('cardMenu'),anchor);}
// ---- live view (docked)
function renderRail(){$('rail').innerHTML=devices.map(d=>{const [label,dot]=statusOf(d);return '<button class="rail-item" data-rail="'+esc(d.serial)+'"'+(d.serial===focus?' aria-current="true"':'')+(online(d)?'':' disabled')+'>'
  +(frames[d.serial]&&online(d)?'<img class="thumb" alt="" src="'+frames[d.serial]+'">':'<span class="thumb"></span>')
  +'<span style="min-width:0;display:flex;flex-direction:column;gap:3px"><span class="name">'+esc(d.model)+'</span><span class="status muted"><span class="dot '+dot+'"></span>'+esc(label)+'</span><span class="small muted">'+esc([d.kind,(d.info||{}).battery!=null?d.info.battery+'%':''].filter(Boolean).join(' · '))+'</span></span></button>';}).join('');}
function renderInfo(d){const i=d.info||{};const rows=[['Model',d.model+(i.manufacturer?' ('+i.manufacturer+')':'')],['Android',i.android?i.android+(i.sdk?' · API '+i.sdk:''):'—'],['Connection',d.kind+(i.managed?' · managed':'')],['Battery',i.battery!=null?i.battery+'%'+(i.charging?' · charging':''):'—'],['Screen',i.width?i.width+' × '+i.height:'—']];
 $('lvInfo').innerHTML=rows.map(r=>'<dt>'+r[0]+'</dt><dd>'+esc(r[1])+'</dd>').join('')+'<dt>Serial</dt><dd><span class="mono">'+esc(d.serial)+'</span><button class="icon-btn" style="width:22px;height:22px" data-lv="copy" aria-label="Copy serial" title="Copy serial"><svg data-i="copy"></svg></button></dd>';drawIcons($('lvInfo'));}
function openView(s){const d=device(s);if(!d||!online(d))return;focus=s;
 $('vtitle').textContent=d.model;$('vsub').textContent=[sub(d),d.kind,(d.info||{}).width?d.info.width+' × '+d.info.height:''].filter(Boolean).join(' · ');renderInfo(d);
 if(frames[s]){img.src=frames[s];img.hidden=false;$('livemsg').hidden=true;}else{img.hidden=true;$('livemsg').hidden=false;$('livemsg').textContent='Connecting…';}
 canvas.hidden=true;resetDecoder();decodeErrors=0;$('gridView').hidden=true;$('liveView').hidden=false;$('livemode').textContent='Connecting…';closeMenus();render();
 $('lvPackage').innerHTML='<option value="">Loading installed apps…</option>';api.postMessage({action:'packages',serial:s});
 touchLive.on=false;videoSupported().then(ok=>{if(focus!==s)return;$('livemode').textContent=ok?'Live video':'Screenshot mode';api.postMessage({action:'focus',serial:s,stream:ok});});}
function closeView(){if(!focus)return;focus=null;touchLive.on=false;resetDecoder();$('liveView').hidden=true;$('gridView').hidden=false;api.postMessage({action:'focus',serial:null});render();}
// ---- clicks
document.addEventListener('change',e=>{const t=e.target;if(t.matches('[data-select]')){const s=serialOf(t);t.checked?selected.add(s):selected.delete(s);render();}});
document.addEventListener('click',e=>{const t=e.target;
 if(t.closest('#aiDock'))return;
 if(t.closest('[data-con-open]')&&window.claudeBar){claudeBar.setMode('adb');return;}
 if(t.matches('[data-select]'))return;
 const b=t.closest('[data-card],[data-top],[data-bulk],[data-key],[data-view],[data-tab],[data-add],[data-recent],[data-cm],[data-rail],[data-lv],[data-f],[data-l]');
 if(!t.closest('.menu')&&!(b&&(b.dataset.top==='more'||b.dataset.card==='menu')))closeMenus();
 if(!b)return;
 if(b.dataset.f){filter=b.dataset.f;document.querySelectorAll('[data-f]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();return;}
 if(b.dataset.l){layout=b.dataset.l;document.querySelectorAll('[data-l]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();return;}
 if(b.dataset.top==='add'){openAdd();return;}
 if(b.dataset.top==='dismiss'){$('notice').hidden=true;return;}
 if(b.dataset.top==='tests'){api.postMessage({action:'open-tests'});return;}
 if(b.dataset.top==='hide-tests'){testActive=null;$('testBanner').hidden=true;render();return;}
 if(b.dataset.top==='more'){if($('moreMenu').hidden)placeMenu($('moreMenu'),b);else closeMenus();return;}
 if(b.dataset.tab){showTab(b.dataset.tab);return;}
 if(b.dataset.add==='close'){closeAdd();return;}
 if(b.dataset.add==='qr-new'){startQr();return;}
 if(b.dataset.add==='prov-stop'){api.postMessage({action:'provision-stop'});return;}
 if(b.dataset.recent){$('addr').value=b.dataset.recent;connectAddr();return;}
 if(b.dataset.rail){if(b.dataset.rail!==focus)openView(b.dataset.rail);return;}
 if(b.dataset.card){const s=serialOf(b);if(b.dataset.card==='open')openView(s);else if(b.dataset.card==='reconnect')api.postMessage({action:'reconnect',serial:s});else if(b.dataset.card==='menu'){if(menuSerial===s)closeMenus();else{closeMenus();openCardMenu(s,b);}}return;}
 if(b.dataset.cm){const s=menuSerial,cm=b.dataset.cm;closeMenus();if(!s)return;
  if(cm==='open')openView(s);else if(cm==='reconnect')api.postMessage({action:'reconnect',serial:s});else if(cm==='copy')api.postMessage({action:'copy',text:s});else api.postMessage({action:'bulk',command:cm,serials:[s]});return;}
 if(b.dataset.top==='refresh'){api.postMessage({action:'refresh'});return;}
 if(b.dataset.top==='select-all'){devices.filter(d=>online(d)&&matches(d)).forEach(d=>selected.add(d.serial));render();return;}
 if(b.dataset.top==='clear'){selected.clear();render();return;}
 if(b.dataset.bulk){closeMenus();api.postMessage({action:'bulk',command:b.dataset.bulk,serials:[...selected]});return;}
 if(b.dataset.key){if(focus)api.postMessage({action:'key',serial:focus,key:b.dataset.key});return;}
 if(b.dataset.view==='close'){closeView();return;}
 if(b.dataset.view){if(focus)api.postMessage({action:'bulk',command:b.dataset.view,serials:[focus]});return;}
 if(b.dataset.lv==='packages'){if(focus){$('lvPackage').innerHTML='<option value="">Loading installed apps…</option>';api.postMessage({action:'packages',serial:focus});}return;}
 if(b.dataset.lv==='copy'){if(focus)api.postMessage({action:'copy',text:focus});return;}
 if(b.dataset.lv==='launch'||b.dataset.lv==='stop'){const pkg=$('lvPackage').value;if(!pkg){notice('Choose an installed app first.',true);return;}if(focus)api.postMessage({action:b.dataset.lv==='launch'?'app-launch':'app-stop',serial:focus,package:pkg});return;}
});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!$('moreMenu').hidden||!$('cardMenu').hidden){closeMenus();return;}if(!$('add').hidden){closeAdd();return;}if(focus){closeView();return;}if(selected.size){selected.clear();render();}});
$('deeplinkform').addEventListener('submit',e=>{e.preventDefault();const uri=$('lvLink').value.trim();if(uri&&focus)api.postMessage({action:'deep-link',serial:focus,uri,package:$('lvPackage').value});});
// ---- add device dialog
let tab='qr';
function setStatus(t,state,text){const el=$('st-'+t);if(el){el.className='st '+state;el.textContent=text;}}
function startQr(){$('qrimg').hidden=true;setStatus('qr','working','Generating code…');api.postMessage({action:'qr-start'});}
function showTab(t){if(tab==='qr'&&t!=='qr')api.postMessage({action:'qr-stop'});tab=t;
 document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===t)));
 document.querySelectorAll('[data-pane]').forEach(p=>p.hidden=p.dataset.pane!==t);
 if(t==='qr')startQr();if(t==='managed'){api.postMessage({action:'provision-addresses'});$('provssid').focus();}if(t==='address'){api.postMessage({action:'addresses'});$('addr').focus();}if(t==='code')$('pairaddr').focus();}
function openAdd(){$('add').hidden=false;showTab('qr');}
function closeAdd(){$('add').hidden=true;api.postMessage({action:'qr-stop'});}
function connectAddr(){const a=$('addr').value.trim();if(a){setStatus('address','working','Connecting…');api.postMessage({action:'connect-address',address:a});}}
$('add').addEventListener('click',e=>{if(e.target===$('add'))closeAdd();});
$('addrform').addEventListener('submit',e=>{e.preventDefault();connectAddr();});
$('codeform').addEventListener('submit',e=>{e.preventDefault();const code=$('paircode').value.trim();if(!/^[0-9]{6}$/.test(code)){setStatus('code','error','Enter the 6-digit pairing code.');return;}setStatus('code','working','Pairing…');api.postMessage({action:'pair-code',address:$('pairaddr').value.trim(),code});});
$('provform').addEventListener('submit',e=>{e.preventDefault();$('provimg').hidden=true;setStatus('managed','working','Starting…');api.postMessage({action:'provision-start',address:$('provaddr').value,ssid:$('provssid').value,password:$('provpass').value});});
$('search').addEventListener('input',render);
$('live').addEventListener('change',e=>{api.postMessage({action:'live',on:e.target.checked});render();});
$('textform').addEventListener('submit',e=>{e.preventDefault();const v=$('text').value;if(v&&focus){api.postMessage({action:'text',serial:focus,text:v});$('text').value='';}});
// ---- live H.264 video (WebCodecs); screenshots are the fallback
let down=null;const img=$('liveimg'),canvas=$('livecanvas'),ctx=canvas.getContext('2d');
${liveTouchScript}
let decoder=null,decoderCodec='',waitKey=true,timestamp=0,decodeErrors=0,supported;
function videoSupported(){if(supported!==undefined)return Promise.resolve(supported);if(typeof VideoDecoder!=='function')return Promise.resolve(supported=false);
 return VideoDecoder.isConfigSupported({codec:'avc1.42e01f',optimizeForLatency:true}).then(r=>supported=!!r.supported,()=>supported=false);}
function resetDecoder(){try{if(decoder&&decoder.state!=='closed')decoder.close();}catch{}decoder=null;decoderCodec='';waitKey=true;}
function drawFrame(frame){if(!focus){frame.close();return;}
 if(canvas.width!==frame.displayWidth||canvas.height!==frame.displayHeight){canvas.width=frame.displayWidth;canvas.height=frame.displayHeight;}
 ctx.drawImage(frame,0,0);frame.close();if(canvas.hidden){canvas.hidden=false;img.hidden=true;$('livemsg').hidden=true;$('livemode').textContent=touchLive.on?'Live · scrcpy':'Live video';}}
function decoderFailed(e){resetDecoder();if(++decodeErrors>=3){touchLive.on=false;api.postMessage({action:'video-unsupported'});$('livemode').textContent='Screenshot mode';canvas.hidden=true;notice('Video decoding failed, so the view uses screenshots: '+(e&&e.message||e),true);}else api.postMessage({action:'video-error'});}
function onVideo(m){if(m.serial!==focus||decodeErrors>=3)return;
 if(m.key&&m.codec&&(!decoder||decoderCodec!==m.codec)){resetDecoder();
  try{decoder=new VideoDecoder({output:drawFrame,error:decoderFailed});decoder.configure({codec:m.codec,optimizeForLatency:true});decoderCodec=m.codec;}catch(e){decoderFailed(e);return;}}
 if(!decoder||(waitKey&&!m.key))return;waitKey=false;
 try{decoder.decode(new EncodedVideoChunk({type:m.key?'key':'delta',timestamp:(timestamp++)*33333,data:bytes(m.data)}));}catch(e){decoderFailed(e);}}
function bytes(d){return d instanceof Uint8Array?d:d instanceof ArrayBuffer?new Uint8Array(d):ArrayBuffer.isView(d)?new Uint8Array(d.buffer,d.byteOffset,d.byteLength):new Uint8Array(Array.isArray(d)?d:Object.values(d||{}));}
function surface(){if(!canvas.hidden&&canvas.width){const i=(device(focus)||{}).info||{};let w=i.width||canvas.width,h=i.height||canvas.height;
  if((canvas.width>canvas.height)!==(w>h))[w,h]=[h,w];return{el:canvas,w,h};}
 return img.naturalWidth&&!img.hidden?{el:img,w:img.naturalWidth,h:img.naturalHeight}:null;}
const point=(e,s)=>{const r=s.el.getBoundingClientRect();return{x:Math.round((e.clientX-r.left)*s.w/r.width),y:Math.round((e.clientY-r.top)*s.h/r.height),cx:e.clientX,cy:e.clientY};};
for(const el of [img,canvas]){
 el.addEventListener('pointerdown',e=>{const s=surface();if(!s||s.el!==el)return;el.setPointerCapture(e.pointerId);down={...point(e,s),t:performance.now(),s};e.preventDefault();});
 el.addEventListener('pointerup',e=>{if(!down||!focus)return;const s=down.s,p=point(e,s),clamp=(v,m)=>Math.max(0,Math.min(m-1,v));
  const x=clamp(down.x,s.w),y=clamp(down.y,s.h),x2=clamp(p.x,s.w),y2=clamp(p.y,s.h);
  if(Math.hypot(p.cx-down.cx,p.cy-down.cy)<8)api.postMessage({action:'gesture',serial:focus,type:'tap',x,y});
  else api.postMessage({action:'gesture',serial:focus,type:'swipe',x,y,x2,y2,duration:performance.now()-down.t});down=null;});
 el.addEventListener('pointercancel',()=>{down=null;});}
touchAttach([img,canvas],m=>{if(focus)api.postMessage({...m,serial:focus});});
// ---- Maestro runs (broadcast by the shared AI host): show progress on cards and a banner
const testRuns={};let testActive=null;
function testState(s){const r=testRuns[testActive];if(!r||r.done)return null;const g=r.progress[s];if(!g||!r.serials.includes(s))return null;
 if(g.state==='starting')return['Starting Maestro…','live'];if(g.state==='running')return['Testing '+(g.passed+g.failed)+'/'+g.total+(g.failed?' · '+g.failed+' failed':''),'live'];if(g.state==='error')return['Test error','fail'];if(g.state==='lost')return['Lost during test','fail'];return null;}
function testErrors(r){return r.serials.map(s=>r.progress[s]).filter(g=>g&&(g.state==='error'||g.state==='lost')&&g.message);}
function renderTestBanner(){const r=testRuns[testActive],b=$('testBanner');if(!r){b.hidden=true;return;}
 let p=0,f=0;for(const s of r.serials){const g=r.progress[s];if(g){p+=g.passed;f+=g.failed;}}const total=r.flows.length*r.serials.length;
 b.hidden=false;b.innerHTML=(r.done?icon(r.done.failed?'error':'checkCircle'):icon('spinner','class="i spin" style="color:var(--vscode-charts-blue)"'))+'<b style="color:var(--mota-heading)">'+(r.done?'Maestro run finished':'Maestro run in progress')+'</b><span class="small muted">'+(testErrors(r).length?'<span title="'+esc(testErrors(r)[0].message)+'">'+esc(testErrors(r)[0].message.slice(0,160))+(testErrors(r)[0].message.length>160?'…':'')+'</span>'+(testErrors(r).length>1?' (+'+(testErrors(r).length-1)+' more)':'')+' · ':'')+(r.done?r.done.passed+' passed · '+r.done.failed+' failed':(p+f)+' of '+total+' flow runs · '+p+' passed · '+f+' failed')+'</span><span class="spacer"></span><button class="btn btn-secondary btn-sm" data-top="tests">'+(r.done?'Results':'Open run')+'</button>'+(r.done?'<button class="icon-btn" data-top="hide-tests" aria-label="Dismiss"><svg data-i="close"></svg></button>':'');drawIcons(b);}
window.addEventListener('message',e=>{const m=e.data;if(!m||typeof m.type!=='string'||!m.type.startsWith('test/'))return;
 if(m.type==='test/started'){testRuns[m.runId]={flows:m.flows,serials:m.serials,progress:{},done:null};testActive=m.runId;}
 const r=testRuns[m.runId];if(!r)return;
 if(m.type==='test/progress')r.progress[m.serial]=m;else if(m.type==='test/done')r.done=m;
 if(m.runId===testActive){renderTestBanner();render();}});

// ---- host messages
window.addEventListener('message',e=>{const m=e.data;if(!m||!m.kind)return;
 if(m.kind==='devices'){$('error').textContent=m.error?'ADB unavailable: '+m.error:'';const json=JSON.stringify(m.devices);
  devices=m.devices;for(const s of [...selected])if(!devices.some(d=>d.serial===s&&online(d)))selected.delete(s);if(json!==last){last=json;render();if(focus){const d=device(focus);if(d)renderInfo(d);}}}
 else if(m.kind==='frame'){frames[m.serial]=m.src;delete frameErrors[m.serial];
  const st=document.querySelector('.dev[data-serial="'+CSS.escape(m.serial)+'"] .stage');
  if(st){const i=st.querySelector('img');if(i)i.src=m.src;else{const msg=st.querySelector('.msg');if(msg)msg.outerHTML='<img src="'+m.src+'" alt="Screen">';}}
  const t=document.querySelector('tr[data-serial="'+CSS.escape(m.serial)+'"] .thumb');if(t&&t.tagName==='IMG')t.src=m.src;
  if(m.serial===focus&&canvas.hidden){img.src=m.src;img.hidden=false;$('livemsg').hidden=true;}}
 else if(m.kind==='video')onVideo(m);
 else if(m.kind==='video-reset'){if(m.serial===focus){if(m.session)resetDecoder();else waitKey=true;}}
 else if(m.kind==='live-mode'){if(m.serial===focus){touchLive.on=m.engine==='scrcpy';if(!canvas.hidden)$('livemode').textContent=touchLive.on?'Live · scrcpy':'Live video';if(m.note)notice(m.note,true);}}
 else if(m.kind==='video-failed'){if(m.serial===focus){touchLive.on=false;resetDecoder();canvas.hidden=true;$('livemode').textContent='Screenshot mode';notice('Live video stopped: '+m.text,true);}}
 else if(m.kind==='frame-error'){frameErrors[m.serial]=m.text;if(m.serial===focus&&!frames[m.serial])$('livemsg').textContent=m.text;if(!frames[m.serial])render();}
 else if(m.kind==='focus-lost'){notice('The device disconnected.',true);closeView();}
 else if(m.kind==='notice')notice(m.text,m.error);
 else if(m.kind==='packages'){if(m.serial!==focus)return;const sel=$('lvPackage'),prev=sel.value;
  sel.innerHTML=m.error?'<option value="">'+esc(m.error)+'</option>':m.list.length?m.list.map(p=>'<option value="'+esc(p)+'">'+esc(p)+'</option>').join(''):'<option value="">No third-party apps installed</option>';if(m.list&&m.list.includes(prev))sel.value=prev;else if(m.last&&m.list&&m.list.includes(m.last))sel.value=m.last;}
 else if(m.kind==='qr'){$('qrimg').src=m.src;$('qrimg').hidden=false;}
 else if(m.kind==='provision-qr'){$('provimg').hidden=!m.src;if(m.src)$('provimg').src=m.src;$('provstop').hidden=!m.src;}
 else if(m.kind==='provision-addresses'){const sel=$('provaddr'),prev=sel.value;sel.innerHTML=m.list.map(a=>'<option value="'+esc(a.address)+'">'+esc(a.address+' ('+a.name+')')+'</option>').join('');if(m.list.some(a=>a.address===prev))sel.value=prev;if(!m.list.length)setStatus('managed','error','No local network address found. Connect this computer to the same Wi-Fi as the phone.');$('provstop').hidden=!m.serving;}
 else if(m.kind==='add-status'){setStatus(m.tab,m.state,m.text);if(m.state==='ok'&&m.tab==='qr')$('qrimg').hidden=true;}
 else if(m.kind==='addresses'){$('recent').innerHTML=m.list.length?'<span class="small muted" style="width:100%">Recent</span>'+m.list.map(a=>'<button class="btn btn-secondary btn-sm" data-recent="'+esc(a)+'">'+esc(a)+'</button>').join(''):'';}
});
`;
