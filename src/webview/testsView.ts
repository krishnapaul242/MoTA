import { claudeBarMarkup, claudeBarScript, claudeBarStyles } from './claudeBar';
import { themedPage } from './page';

/** Maestro tests webview: setup → running → results (approved design: design-mockups/tests-*.html). Host is testsPage.ts + the shared AI host. */
export function testsHtml(cspSource: string) {
  return themedPage('Tests', body, styles + claudeBarStyles, script + claudeBarScript + '\nstart();', cspSource);
}

const styles = `
.cols{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.main-col{flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:16px}
.side-col{flex:1 1 300px;min-width:0;display:flex;flex-direction:column;gap:16px}
.flows{border:1px solid var(--vscode-panel-border);border-radius:6px;overflow:auto;max-height:340px}
.flow{display:flex;align-items:center;gap:10px;padding:7px 12px;cursor:pointer}
.flow+.flow{border-top:1px solid var(--vscode-panel-border)}
.flow:hover{background:var(--vscode-list-hoverBackground)}
.flow input{accent-color:var(--vscode-button-background);margin:0}
.flow .name{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;color:var(--mota-heading)}
.tagchip{font-size:11px;padding:0 6px;height:18px;display:inline-flex;align-items:center;border-radius:9px;border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));color:var(--vscode-descriptionForeground)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 16px}
textarea.input{height:auto;padding:6px 8px;resize:vertical;font-family:var(--vscode-editor-font-family,monospace);font-size:12px}
.dev-check{display:flex;gap:10px;align-items:flex-start;padding:9px 0}
.dev-check+.dev-check{border-top:1px solid var(--vscode-panel-border)}
.dev-check input{margin-top:2px;accent-color:var(--vscode-button-background)}
.stat{display:flex;justify-content:space-between;font-size:12px;padding:3px 0;gap:12px}.stat b{color:var(--mota-heading);font-weight:600;text-align:right}
.banner{display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;padding:12px 16px;border-radius:8px;background:var(--mota-live-bg);border:1px solid var(--vscode-focusBorder)}
.banner.done{background:transparent;border-color:var(--vscode-panel-border)}
.overall{flex:1 1 200px;height:6px;border-radius:3px;background:var(--vscode-panel-border);overflow:hidden;display:flex}
.overall .p,.prog .p{background:var(--vscode-testing-iconPassed,#3fb950)}.overall .f,.prog .f{background:var(--vscode-errorForeground)}
.count{display:inline-flex;align-items:center;gap:6px;font-size:12px}
.runs{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.rdev{background:var(--vscode-sideBar-background,var(--vscode-editor-background));border:1px solid var(--vscode-panel-border);border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.rdev.active{border-color:var(--vscode-focusBorder)}
.prog{height:6px;border-radius:3px;background:var(--vscode-panel-border);overflow:hidden;display:flex}
.current{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;color:var(--vscode-charts-blue);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fl{font-family:var(--vscode-editor-font-family,monospace);font-size:11.5px;line-height:1.7;background:var(--vscode-textCodeBlock-background);border-radius:6px;padding:6px 10px;max-height:150px;overflow:auto}
.fl .ok{color:var(--vscode-testing-iconPassed,#3fb950)}.fl .no{color:var(--vscode-errorForeground)}.fl .na{color:var(--vscode-descriptionForeground)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.stats .card{padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.stats .v{font-size:22px;font-weight:600;color:var(--mota-heading);font-variant-numeric:tabular-nums}
table.grid{width:100%;border-collapse:collapse;min-width:560px}
table.grid th{text-align:left;font-size:12px;font-weight:600;color:var(--vscode-descriptionForeground);padding:8px 12px;border-bottom:1px solid var(--vscode-panel-border)}
table.grid td{padding:6px 12px;border-bottom:1px solid var(--vscode-panel-border);font-size:12px}
table.grid td.flowname{font-family:var(--vscode-editor-font-family,monospace);color:var(--mota-heading)}
.cell{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:4px;border:1px solid transparent;background:transparent;color:inherit;font:inherit;font-variant-numeric:tabular-nums}
.cell svg.i{width:14px;height:14px}
.cell.pass{color:var(--vscode-testing-iconPassed,#3fb950)}.cell.skip,.cell.wait{color:var(--vscode-descriptionForeground)}
.cell.fail{color:var(--vscode-errorForeground);cursor:pointer;border-color:var(--mota-danger-border)}
.cell.fail[aria-pressed="true"]{border-color:var(--vscode-errorForeground)}
.cell .t{color:var(--vscode-descriptionForeground)}
.detail{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
.detail img{max-width:180px;max-height:380px;border-radius:6px;border:2px solid var(--mota-bezel)}
.assert{padding:8px 10px;border-left:2px solid var(--vscode-errorForeground);background:var(--vscode-textCodeBlock-background);border-radius:0 4px 4px 0;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
`;

const body = `
<div class="page" id="setupView">
 <header class="page-header">
  <div class="row" style="gap:12px"><button class="icon-btn" data-action="farm" title="Back to devices" aria-label="Back to devices"><svg data-i="arrowLeft"></svg></button>
   <div><h1>Run Maestro tests</h1><div class="subtitle" id="setupSub">Loading flows…</div></div></div>
  <div class="row"><span class="small muted" id="setupSummary"></span><button class="btn btn-primary" id="startBtn" data-run="start" disabled><svg data-i="play"></svg>Start run</button></div>
 </header>
 <p class="small" id="setupNotice" role="alert" style="margin:0;color:var(--vscode-errorForeground)" hidden></p>
 <div class="cols">
  <div class="main-col">
   <section class="card card-pad" style="display:flex;flex-direction:column;gap:12px">
    <div class="row" style="justify-content:space-between"><h2>Flows</h2><div class="row"><span class="small muted mono" id="folder"></span><button class="btn btn-ghost btn-sm" data-action="settings" title="Change the flows folder or Maestro path in settings"><svg data-i="settings"></svg></button><button class="btn btn-ghost btn-sm" data-run="reload-flows" title="Reload flows"><svg data-i="refresh"></svg></button></div></div>
    <div class="row"><button class="btn btn-ghost btn-sm" data-run="all-flows">Select all</button><button class="btn btn-ghost btn-sm" data-run="no-flows">Select none</button><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-run="ask-flows"><svg data-i="sparkle"></svg>Ask Claude which flows my changes affect</button></div>
    <div class="flows" id="flows"><div class="small muted" style="padding:10px 12px">Loading flows…</div></div>
   </section>
   <section class="card card-pad" style="display:flex;flex-direction:column;gap:12px">
    <div><h2>Filters and variables</h2><div class="subtitle">Every selected flow runs on every selected device.</div></div>
    <div class="grid2"><label class="field"><span>Include tags (comma separated)</span><input class="input" id="incTags" placeholder="e.g. smoke"></label><label class="field"><span>Exclude tags</span><input class="input" id="excTags" placeholder="e.g. slow"></label></div>
    <label class="field"><span>Variables, one KEY=VALUE per line (passed as <span class="mono">-e</span>)</span><textarea class="input" id="env" rows="3" placeholder="APP_ID=com.example.app"></textarea></label>
   </section>
   <section class="card card-pad" style="display:flex;flex-direction:column;gap:10px">
    <h2>Before the run</h2>
    <div class="row" style="flex-wrap:nowrap"><label class="check" style="flex:none"><input type="checkbox" id="useApk"> Install APK first</label><input class="input mono" id="apk" style="flex:1;min-width:0" placeholder="path/to/app.apk (relative to the workspace)"><button class="btn btn-secondary btn-sm" data-action="choose-apk"><svg data-i="folder"></svg>Choose…</button></div>
    <div class="row" style="flex-wrap:nowrap"><label class="check" style="flex:none"><input type="checkbox" id="useClear"> Clear app data for</label><input class="input mono" id="clearData" style="flex:1;min-width:0" placeholder="com.example.app"></div>
    <div class="small muted">Phones are woken and kept awake during the run, and logcat is saved for each one. Maestro takes about 40 s to start on each phone.</div>
   </section>
  </div>
  <div class="side-col">
   <section class="card card-pad">
    <div class="row" style="justify-content:space-between"><h2>Devices</h2><button class="icon-btn" data-action="devices" title="Refresh devices" aria-label="Refresh devices"><svg data-i="refresh"></svg></button></div>
    <div id="devices"><div class="small muted" style="padding:8px 0">Looking for devices…</div></div>
   </section>
   <section class="card card-pad"><h2 style="margin-bottom:8px">Summary</h2><div id="summary"></div></section>
  </div>
 </div>
</div>

<div class="page" id="runView" hidden>
 <header class="page-header">
  <div class="row" style="gap:12px"><button class="icon-btn" data-run="new" title="New run" aria-label="New run"><svg data-i="arrowLeft"></svg></button><div><h1 id="runTitle">Test run</h1><div class="subtitle" id="runSub"></div></div></div>
  <div class="row"><button class="btn btn-ghost" data-run="open-dir" title="Open the run folder"><svg data-i="folder"></svg>Run folder</button><button class="btn btn-secondary" data-run="results" id="toResults">Results</button></div>
 </header>
 <section class="banner" id="banner" aria-label="Run progress"></section>
 <div class="runs" id="runDevices"></div>
</div>

<div class="page" id="resultsView" hidden>
 <header class="page-header">
  <div class="row" style="gap:12px"><button class="icon-btn" data-run="new" title="New run" aria-label="New run"><svg data-i="arrowLeft"></svg></button><div><h1 id="resTitle">Results</h1><div class="subtitle" id="resSub"></div></div></div>
  <div class="row"><button class="btn btn-ghost" data-run="to-run">Live view</button><button class="btn btn-secondary" data-run="again">Run again</button><button class="icon-btn" data-run="open-dir" title="Open the run folder" aria-label="Open the run folder"><svg data-i="folder"></svg></button><button class="btn btn-primary" data-run="rerun-failed" id="rerunBtn"><svg data-i="refresh"></svg>Rerun failed</button></div>
 </header>
 <div class="stats" id="stats"></div>
 <section class="card card-pad" style="display:flex;flex-direction:column;gap:8px">
  <div class="row" style="justify-content:space-between"><div class="row" style="gap:8px"><svg data-i="sparkle" style="color:var(--vscode-charts-blue)"></svg><h2>Claude</h2></div></div>
  <div class="small muted">Claude can explain each failure (app bug, broken test, flaky test or phone problem) and propose a fix to the flow for you to approve.</div>
  <div class="row"><button class="btn btn-secondary btn-sm" data-run="summarize"><svg data-i="sparkle"></svg>Summarize this run</button><span class="small muted">or choose a failed cell below and use Ask Claude why.</span></div>
 </section>
 <section class="card" style="overflow-x:auto"><table class="grid" aria-label="Results by flow and device"><thead id="gridHead"></thead><tbody id="gridBody"></tbody></table><div class="small muted" id="gridNote" style="padding:8px 12px"></div></section>
 <section class="card card-pad" id="failure" style="display:flex;flex-direction:column;gap:12px" hidden></section>
</div>
<div class="toast" id="toast" role="status" hidden><span id="toastIcon"></span><div id="toastText" style="flex:1;min-width:0;overflow-wrap:anywhere"></div><button class="icon-btn" data-run="toast-close" aria-label="Dismiss" style="width:22px;height:22px"><svg data-i="close"></svg></button></div>
${claudeBarMarkup({ placeholder: 'Ask Claude, e.g. “write a flow that logs in and adds shoes to the cart”…' })}`;

const script = `
document.body.classList.add('has-dock');
const $=id=>document.getElementById(id);
const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const send=(action,extra)=>api.postMessage(Object.assign({action},extra||{}));
let view='setup',flows=[],folder='',flowSel=new Set(),devices=[],devSel=new Set(),preselect=[],runs={},active=null,lastRequest=null,starting=false,failSel=null,toastTimer,flowsLoaded=false;
const dur=ms=>ms==null?'':ms<1000?ms+' ms':ms<60000?Math.round(ms/1000)+' s':Math.floor(ms/60000)+':'+String(Math.round(ms%60000/1000)).padStart(2,'0');
const clock=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
function toast(text,error){$('toastText').textContent=text;$('toastIcon').innerHTML=icon(error?'error':'checkCircle','class="i" style="color:'+(error?'var(--vscode-errorForeground)':'var(--vscode-testing-iconPassed,#3fb950)')+'"');$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?12000:4000);}
function claudeScope(){if(view!=='setup'&&active&&runs[active]){const r=runs[active];return{serials:r.serials,label:'This run · '+r.serials.length+' device'+(r.serials.length===1?'':'s')};}
 const s=[...devSel];return{serials:s,label:s.length?(s.length===1?modelOf(s[0]):s.length+' selected devices'):'No devices selected'};}
const modelOf=s=>{for(const r of Object.values(runs)){const d=(r.devices||[]).find(x=>x.serial===s);if(d)return d.model;}const d=devices.find(x=>x.serial===s);return d?d.model:s;};
function show(v){view=v;$('setupView').hidden=v!=='setup';$('runView').hidden=v!=='run';$('resultsView').hidden=v!=='results';render();if(window.claudeBar)claudeBar.refreshScope();}
// ---- setup
const tags=id=>$(id).value.split(',').map(s=>s.trim()).filter(Boolean);
function envObj(){const o={};for(const line of $('env').value.split('\\n')){const t=line.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i<1)return null;o[t.slice(0,i).trim()]=t.slice(i+1);}return o;}
function effectiveFlows(){const inc=tags('incTags'),exc=tags('excTags');return flows.filter(f=>flowSel.has(f.path)&&(!inc.length||f.tags.some(t=>inc.includes(t)))&&!f.tags.some(t=>exc.includes(t)));}
function renderSetup(){
 $('folder').textContent=folder;$('folder').title=folder;
 $('flows').innerHTML=!flowsLoaded?'<div class="small muted" style="padding:10px 12px">Loading flows…</div>':flows.length?flows.map(f=>'<label class="flow"><input type="checkbox" data-flow="'+h(f.path)+'"'+(flowSel.has(f.path)?' checked':'')+' aria-label="'+h(f.name)+'"><span class="name">'+h(f.path)+'</span>'+(f.name&&f.name!==f.path.replace(/^.*\\//,'').replace(/\\.ya?ml$/,'')?'<span class="small muted">'+h(f.name)+'</span>':'')+f.tags.map(t=>'<span class="tagchip">'+h(t)+'</span>').join('')+(f.appId?'<span class="spacer"></span><span class="small muted mono">'+h(f.appId)+'</span>':'')+'</label>').join(''):'<div class="small muted" style="padding:10px 12px">No flows found in this folder.</div>';
 $('devices').innerHTML=devices.length?devices.map(d=>{const ready=d.state==='device';const why={unauthorized:'Accept the USB debugging prompt on the phone.',offline:'Offline. Reconnect it.',remembered:'Not connected.'}[d.state]||'';
  return '<label class="dev-check"><input type="checkbox" data-dev="'+h(d.serial)+'"'+(devSel.has(d.serial)?' checked':'')+(ready?'':' disabled')+'><div><div style="color:var(--mota-heading);font-weight:600">'+h(d.model)+'</div><div class="small muted">'+h([d.android&&'Android '+d.android,d.kind].filter(Boolean).join(' · '))+'</div>'+(why?'<div class="small" style="color:var(--vscode-editorWarning-foreground)">'+h(why)+'</div>':'')+'</div></label>';}).join(''):'<div class="small muted" style="padding:8px 0">No devices. Connect one from the device farm.</div>';
 const ef=effectiveFlows(),nd=[...devSel].filter(s=>devices.some(d=>d.serial===s&&d.state==='device')).length,env=envObj();
 $('summary').innerHTML=[['Flows',ef.length+' of '+flows.length+(flowSel.size>ef.length?' ('+(flowSel.size-ef.length)+' filtered out by tags)':'')],['Devices',nd+' selected'],['Flow runs',ef.length*nd+(ef.length&&nd?' ('+ef.length+' × '+nd+')':'')],['Estimated start','about 40 s per phone, in parallel'],['Saved to','.mota/test-runs/']].map(r=>'<div class="stat"><span class="muted">'+r[0]+'</span><b>'+h(r[1])+'</b></div>').join('');
 $('setupSub').textContent=nd+' device'+(nd===1?'':'s')+' selected'+(folder?' · '+folder:'');
 $('setupSummary').textContent=ef.length&&nd?(ef.length*nd)+' flow runs':'';
 $('startBtn').disabled=starting||!ef.length||!nd||!env||($('useApk').checked&&!$('apk').value.trim())||($('useClear').checked&&!/^[A-Za-z][\\w]*(\\.[A-Za-z][\\w]*)+$/.test($('clearData').value.trim()));
 $('startBtn').innerHTML=icon('play')+(starting?'Starting…':'Start run');
 if(!env){$('setupNotice').hidden=false;$('setupNotice').textContent='Write each variable as KEY=VALUE on its own line.';}else if($('setupNotice').dataset.kind!=='host')$('setupNotice').hidden=true;}
function startRun(req){const r=req||{type:'test/start',flows:effectiveFlows().map(f=>f.path),serials:[...devSel].filter(s=>devices.some(d=>d.serial===s&&d.state==='device')),env:envObj()||{},includeTags:tags('incTags'),excludeTags:tags('excTags'),installApk:$('useApk').checked?$('apk').value.trim():undefined,clearData:$('useClear').checked?$('clearData').value.trim():undefined};
 if(!r.flows.length||!r.serials.length){toast('Choose at least one flow and one ready device.',true);return;}
 lastRequest=r;starting=true;$('setupNotice').hidden=true;$('setupNotice').dataset.kind='';renderSetup();
 send('remember',{env:$('env').value,apk:$('apk').value,clearData:$('clearData').value});api.postMessage(r);}
// ---- run model
function runOf(id){return runs[id]||(runs[id]={runId:id,flows:[],serials:[],devices:[],dir:'',progress:{},results:{},done:null,startedAt:Date.now()});}
function counts(r){let p=0,f=0,n=0;for(const s of r.serials)for(const fl of r.flows){const x=(r.results[s]||{})[fl];if(!x)continue;if(x.status==='pass')p++;else if(x.status==='fail')f++;else n++;}
 const total=r.flows.length*r.serials.length,running=r.serials.filter(s=>{const g=r.progress[s];return g&&(g.state==='running'||g.state==='starting');}).length;return{p,f,n,total,running,queued:Math.max(0,total-p-f-n-running)};}
function stateLabel(g,r,s){if(!g)return['Waiting','off'];const done=Object.keys(r.results[s]||{}).length;
 if(g.state==='starting')return['Starting Maestro… '+clock((Date.now()-g.startedAt)/1000),'live'];
 if(g.state==='running')return['Testing '+Math.min(done+1,g.total)+'/'+g.total+(g.failed?' · '+g.failed+' failed':''),'live'];
 if(g.state==='done')return['Done · '+g.passed+' passed'+(g.failed?' · '+g.failed+' failed':''),g.failed?'fail':'ready'];
 if(g.state==='cancelled')return['Stopped','off'];if(g.state==='lost')return['Device lost','fail'];return['Error','fail'];}
function renderRun(){const r=runs[active];if(!r)return;const c=counts(r),elapsed=((r.done?r.doneAt:Date.now())-r.startedAt)/1000;
 $('runTitle').textContent='Maestro run · '+r.flows.length+' flow'+(r.flows.length===1?'':'s')+' on '+r.serials.length+' device'+(r.serials.length===1?'':'s');
 $('runSub').textContent='Started '+new Date(r.startedAt).toLocaleTimeString()+' · '+clock(elapsed)+(r.done?' · finished':' elapsed');
 $('banner').className='banner'+(r.done?' done':'');
 $('banner').innerHTML=(r.done?icon(c.f?'error':'checkCircle','style="color:'+(c.f?'var(--vscode-errorForeground)':'var(--vscode-testing-iconPassed,#3fb950)')+'"'):icon('spinner','class="i spin" style="color:var(--vscode-charts-blue)"'))
  +'<div><b style="color:var(--mota-heading)">'+(r.done?'Run finished':'Running')+'</b><div class="small muted">'+c.total+' flow runs</div></div>'
  +'<div class="overall" role="progressbar" aria-label="Overall progress" aria-valuenow="'+Math.round((c.p+c.f+c.n)/Math.max(1,c.total)*100)+'" aria-valuemin="0" aria-valuemax="100"><span class="p" style="width:'+(c.p/Math.max(1,c.total)*100)+'%"></span><span class="f" style="width:'+(c.f/Math.max(1,c.total)*100)+'%"></span></div>'
  +'<span class="count"><span class="dot ready"></span>'+c.p+' passed</span><span class="count"><span class="dot fail"></span>'+c.f+' failed</span>'+(c.n?'<span class="count"><span class="dot off"></span>'+c.n+' not run</span>':'')
  +(r.done?'':'<span class="count"><span class="dot live"></span>'+c.running+' running</span><span class="count"><span class="dot off"></span>'+c.queued+' queued</span><button class="btn btn-danger" data-run="cancel">Cancel run</button>');
 $('runDevices').innerHTML=r.serials.map(s=>{const g=r.progress[s],[label,dot]=stateLabel(g,r,s),res=r.results[s]||{},list=r.flows.filter(f=>res[f]),total=g?g.total||r.flows.length:r.flows.length,pp=list.filter(f=>res[f].status==='pass').length,ff=list.filter(f=>res[f].status==='fail').length,live=g&&(g.state==='running'||g.state==='starting');
  return '<article class="rdev'+(live?' active':'')+'"><div class="row" style="justify-content:space-between"><div><div style="font-weight:600;color:var(--mota-heading)">'+h(modelOf(s))+'</div><div class="small muted mono">'+h(s)+'</div></div><span class="status small"><span class="dot '+dot+'"></span>'+h(label)+'</span></div>'
   +'<div class="prog"><span class="p" style="width:'+(pp/Math.max(1,total)*100)+'%"></span><span class="f" style="width:'+(ff/Math.max(1,total)*100)+'%"></span></div>'
   +(g&&g.currentFlow&&g.state==='running'?'<div class="current">'+icon('play','style="width:12px;height:12px"')+' '+h(g.currentFlow)+'</div>':'')
   +(g&&g.message?'<div class="small" style="color:'+(g.state==='error'||g.state==='lost'?'var(--vscode-errorForeground)':'var(--vscode-descriptionForeground)')+'">'+h(g.message)+'</div>':'')
   +(list.length?'<div class="fl">'+list.map(f=>{const x=res[f];return '<div class="'+(x.status==='pass'?'ok':x.status==='fail'?'no':'na')+'">'+(x.status==='pass'?'✓':x.status==='fail'?'✗':'–')+' '+h(f)+' <span class="na">'+dur(x.durationMs)+'</span></div>';}).join('')+'</div>':'')
   +(list.filter(f=>res[f].status==='fail').map(f=>'<div class="row small"><span style="color:var(--vscode-errorForeground)">'+h(f)+': '+h((res[f].failure||{}).message||'failed').slice(0,140)+'</span><button class="btn btn-ghost btn-sm" data-diagnose="'+h(f)+'" data-serial="'+h(s)+'">'+icon('sparkle')+'Ask Claude why</button></div>').join(''))
   +'<div class="row">'+(live?'<button class="btn btn-ghost btn-sm" data-stop="'+h(s)+'">Stop this device</button>':'')+'<button class="btn btn-ghost btn-sm" data-action="farm">Watch on device farm</button></div></article>';}).join('');
 $('toResults').hidden=!Object.keys(r.results).length;}
function renderResults(){const r=runs[active];if(!r)return;const c=counts(r);
 $('resTitle').textContent='Test run · '+new Date(r.startedAt).toLocaleString([], {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
 $('resSub').textContent=r.flows.length+' flow'+(r.flows.length===1?'':'s')+' on '+r.serials.length+' device'+(r.serials.length===1?'':'s')+(r.done?' · finished in '+clock((r.doneAt-r.startedAt)/1000):' · still running');
 let slow=null;for(const s of r.serials)for(const f of r.flows){const x=(r.results[s]||{})[f];if(x&&x.durationMs&&(!slow||x.durationMs>slow.d))slow={f,d:x.durationMs};}
 $('stats').innerHTML=[['Flow runs',c.total,''],['Passed',c.p,'var(--vscode-testing-iconPassed,#3fb950)'],['Failed',c.f,c.f?'var(--vscode-errorForeground)':''],['Not run',c.n+(r.done?0:c.queued+c.running),''],['Slowest flow',slow?slow.f.replace(/^.*\\//,'')+' · '+dur(slow.d):'—','']]
  .map((x,i)=>'<div class="card"><span class="small muted">'+x[0]+'</span><span class="v"'+(x[2]?' style="color:'+x[2]+'"':'')+(i===4?' style="font-size:14px;padding-top:6px"':'')+'>'+h(x[1])+'</span></div>').join('');
 $('rerunBtn').disabled=!c.f||!r.done;$('rerunBtn').innerHTML=icon('refresh')+'Rerun failed'+(c.f?' ('+c.f+')':'');
 $('gridHead').innerHTML='<tr><th>Flow</th>'+r.serials.map(s=>'<th>'+h(modelOf(s))+'</th>').join('')+'</tr>';
 $('gridBody').innerHTML=r.flows.map(f=>'<tr><td class="flowname">'+h(f)+'</td>'+r.serials.map(s=>{const x=(r.results[s]||{})[f];
  if(!x){const g=r.progress[s];return '<td><span class="cell wait">'+(g&&g.currentFlow===f&&g.state==='running'?icon('spinner','class="i spin"')+'running':r.done?'– not run':'queued')+'</span></td>';}
  if(x.status==='pass')return '<td><span class="cell pass">'+icon('checkCircle')+'<span class="t">'+dur(x.durationMs)+'</span></span></td>';
  if(x.status==='fail'){const on=failSel&&failSel.s===s&&failSel.f===f;return '<td><button class="cell fail" aria-pressed="'+on+'" data-cell="'+h(f)+'" data-serial="'+h(s)+'" title="Show failure">'+icon('error')+'<span class="t">'+dur(x.durationMs)+'</span></button></td>';}
  return '<td><span class="cell skip">– not run</span></td>';}).join('')+'</tr>').join('');
 const lost=r.serials.filter(s=>(r.progress[s]||{}).state==='lost');
 $('gridNote').textContent=lost.length?lost.map(modelOf).join(', ')+' disconnected during the run; its remaining flows are marked not run.':'';
 const fs=failSel&&(r.results[failSel.s]||{})[failSel.f];$('failure').hidden=!fs;
 if(fs){const fl=fs.failure||{};$('failure').innerHTML='<div class="row" style="justify-content:space-between"><div><h2><span style="color:var(--vscode-errorForeground)">✗</span> '+h(failSel.f)+' on '+h(modelOf(failSel.s))+'</h2><div class="subtitle">'+(fl.step?'Failed at '+h(fl.step)+' · ':'')+dur(fs.durationMs)+'</div></div>'
  +'<div class="row"><button class="btn btn-primary btn-sm" data-diagnose="'+h(failSel.f)+'" data-serial="'+h(failSel.s)+'">'+icon('sparkle')+'Ask Claude why</button><button class="btn btn-secondary btn-sm" data-rerun-one>Rerun on this device</button><button class="btn btn-ghost btn-sm" data-open-flow="'+h(failSel.f)+'">Open flow</button></div></div>'
  +'<div class="detail">'+(fl.screenshotUri?'<div><img alt="Screenshot at the failure" src="'+h(fl.screenshotUri)+'"><div class="small muted" style="margin-top:6px">Screenshot at the failure</div></div>':'')+'<div style="flex:1;min-width:260px;display:flex;flex-direction:column;gap:10px"><div class="assert">'+h(fl.message||'The flow failed.')+'</div><div class="small muted">Maestro output, logcat and other files for this device are in the run folder.</div></div></div>';}}
function render(){if(view==='setup')renderSetup();else if(view==='run')renderRun();else renderResults();drawIcons();}
// ---- events
document.addEventListener('change',e=>{const t=e.target;
 if(t.dataset.flow!==undefined){t.checked?flowSel.add(t.dataset.flow):flowSel.delete(t.dataset.flow);renderSetup();}
 else if(t.dataset.dev!==undefined){t.checked?devSel.add(t.dataset.dev):devSel.delete(t.dataset.dev);renderSetup();if(window.claudeBar)claudeBar.refreshScope();}
 else if(['useApk','useClear'].includes(t.id))renderSetup();});
document.addEventListener('input',e=>{if(['incTags','excTags','env','apk','clearData'].includes(e.target.id))renderSetup();});
document.addEventListener('click',e=>{const t=e.target;if(t.closest('#aiDock'))return;const b=t.closest('button');if(!b||b.disabled)return;
 const r=runs[active];
 if(b.dataset.action){send(b.dataset.action);return;}
 if(b.dataset.diagnose){api.postMessage({type:'test/diagnose',runId:active,serial:b.dataset.serial,flow:b.dataset.diagnose});if(window.claudeBar)claudeBar.open();return;}
 if(b.dataset.stop){api.postMessage({type:'test/cancel',runId:active,serial:b.dataset.stop});return;}
 if(b.dataset.cell){failSel={s:b.dataset.serial,f:b.dataset.cell};renderResults();drawIcons();$('failure').scrollIntoView({block:'nearest'});return;}
 if(b.hasAttribute('data-rerun-one')&&failSel&&lastRequest){startRun({...lastRequest,flows:[failSel.f],serials:[failSel.s]});return;}
 if(b.dataset.openFlow){send('open-flow',{folder,flow:b.dataset.openFlow});return;}
 switch(b.dataset.run){
  case 'start':startRun();return;
  case 'reload-flows':flowsLoaded=false;renderSetup();api.postMessage({type:'test/flows'});return;
  case 'all-flows':flows.forEach(f=>flowSel.add(f.path));renderSetup();return;
  case 'no-flows':flowSel.clear();renderSetup();return;
  case 'ask-flows':if(window.claudeBar)claudeBar.ask('Look at my uncommitted changes (git diff) and tell me which Maestro flows in '+(folder||'the flows folder')+' cover them. List the flow paths.',false);return;
  case 'cancel':api.postMessage({type:'test/cancel',runId:active});return;
  case 'new':show('setup');api.postMessage({type:'test/flows'});send('devices');return;
  case 'results':show('results');return;
  case 'to-run':show('run');return;
  case 'open-dir':if(r&&r.dir)send('open-dir',{dir:r.dir});return;
  case 'again':if(r)startRun({...(lastRequest||{type:'test/start',env:{}}),flows:r.flows,serials:r.serials});return;
  case 'rerun-failed':if(r){const failedFlows=r.flows.filter(f=>r.serials.some(s=>((r.results[s]||{})[f]||{}).status==='fail'));const failedDevs=r.serials.filter(s=>r.flows.some(f=>((r.results[s]||{})[f]||{}).status==='fail'));startRun({...(lastRequest||{type:'test/start',env:{}}),flows:failedFlows,serials:failedDevs});}return;
  case 'summarize':if(r&&window.claudeBar)claudeBar.ask('Summarize test run '+r.runId+': which failures look like app bugs, broken tests, flaky tests or phone problems, and what should I do next?',true);return;
  case 'toast-close':$('toast').hidden=true;return;}});
window.addEventListener('message',e=>{const m=e.data;if(!m)return;
 if(m.kind==='devices'){devices=m.devices;if(m.preselect&&m.preselect.length&&!devSel.size)m.preselect.forEach(s=>devSel.add(s));else if(!devSel.size){const ready=devices.filter(d=>d.state==='device');if(ready.length===1)devSel.add(ready[0].serial);}for(const s of [...devSel])if(!devices.some(d=>d.serial===s&&d.state==='device'))devSel.delete(s);render();if(window.claudeBar)claudeBar.refreshScope();return;}
 if(m.kind==='select'){devSel=new Set(m.serials);if(view!=='setup'&&!(runs[active]&&!runs[active].done))show('setup');else render();return;}
 if(m.kind==='settings'){if(!$('env').value)$('env').value=m.env||'';if(!$('apk').value)$('apk').value=m.apk||'';if(!$('clearData').value)$('clearData').value=m.clearData||'';renderSetup();return;}
 if(m.kind==='apk'){$('apk').value=m.path;$('useApk').checked=true;renderSetup();return;}
 if(m.kind==='notice'){toast(m.text,m.error);return;}
 if(typeof m.type!=='string'||!m.type.startsWith('test/'))return;
 if(m.type==='test/flows'){flowsLoaded=true;folder=m.folder;const first=!flows.length;flows=m.items||[];if(first)flows.forEach(f=>flowSel.add(f.path));else for(const p of [...flowSel])if(!flows.some(f=>f.path===p))flowSel.delete(p);
  if(m.error){$('setupNotice').hidden=false;$('setupNotice').dataset.kind='host';$('setupNotice').textContent=m.error;}renderSetup();drawIcons();return;}
 if(m.type==='test/error'){starting=false;toast(m.message,true);if(view==='setup'){$('setupNotice').hidden=false;$('setupNotice').dataset.kind='host';$('setupNotice').textContent=m.message;}render();return;}
 if(m.type==='test/started'){const r=runOf(m.runId);Object.assign(r,{flows:m.flows,serials:m.serials,dir:m.dir,devices:m.devices||[]});if(starting||!active||(runs[active]&&runs[active].done)){active=m.runId;failSel=null;starting=false;show('run');}else render();return;}
 const r=runs[m.runId];if(!r)return;
 if(m.type==='test/progress'){r.progress[m.serial]=m;if(m.startedAt&&m.startedAt<r.startedAt)r.startedAt=m.startedAt;}
 else if(m.type==='test/flow'){(r.results[m.serial]||(r.results[m.serial]={}))[m.flow]={status:m.status,durationMs:m.durationMs,failure:m.failure};}
 else if(m.type==='test/done'){r.done={passed:m.passed,failed:m.failed,notRun:m.notRun};r.doneAt=Date.now();if(m.runId===active&&view==='run'){show('results');toast(m.failed?m.failed+' flow run'+(m.failed===1?'':'s')+' failed.':'All '+m.passed+' flow runs passed.',m.failed>0);return;}}
 if(m.runId===active&&view!=='setup')render();});
setInterval(()=>{const r=runs[active];if(view==='run'&&r&&!r.done)render();},1000);
function start(){api.postMessage({type:'test/flows'});send('ready');}
`;
