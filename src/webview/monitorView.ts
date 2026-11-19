import { claudeBarMarkup, claudeBarScript, claudeBarStyles } from './claudeBar';
import { themedPage } from './page';

/** Device monitor webview (approved design: design-mockups/monitor.html). Host logic is in monitorPage.ts. */
export function monitorHtml(cspSource: string) {
  return themedPage('Device monitor', body, styles + claudeBarStyles, script + claudeBarScript + "\napi.postMessage({action:'ready'});", cspSource);
}

const styles = `
table.cmp{width:100%;border-collapse:collapse;min-width:960px}
table.cmp th{text-align:left;font-size:12px;font-weight:600;color:var(--vscode-descriptionForeground);padding:8px 12px;border-bottom:1px solid var(--vscode-panel-border);white-space:nowrap}
table.cmp td{padding:10px 12px;border-bottom:1px solid var(--vscode-panel-border);vertical-align:middle}
table.cmp tbody tr{cursor:pointer}
table.cmp tbody tr:hover td{background:var(--vscode-list-hoverBackground)}
table.cmp tbody tr[aria-selected="true"] td{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground,inherit)}
.cell{display:flex;align-items:center;gap:10px}
.val{font-variant-numeric:tabular-nums;color:var(--mota-heading);font-weight:600;min-width:52px;white-space:nowrap}
.val small{font-weight:400;color:var(--vscode-descriptionForeground)}
.spark{width:84px;height:26px;flex:none}
.spark path{fill:none;stroke:var(--vscode-charts-blue);stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
.flag{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--vscode-editorWarning-foreground);white-space:nowrap}
.flag svg.i{width:13px;height:13px}
.chart{position:relative}
.chart svg.plot{width:100%;height:260px;display:block}
.chart .grid line{stroke:var(--vscode-panel-border);stroke-width:1}
.chart .axis text{fill:var(--vscode-descriptionForeground);font-size:11px;font-family:var(--vscode-font-family)}
.chart .series{fill:none;stroke:var(--vscode-charts-blue);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.chart .threshold{stroke:var(--vscode-editorWarning-foreground);stroke-dasharray:4 4;stroke-width:1;vector-effect:non-scaling-stroke}
.chart .cross{stroke:var(--vscode-descriptionForeground);stroke-width:1;vector-effect:non-scaling-stroke}
.tip{position:absolute;pointer-events:none;padding:6px 10px;background:var(--vscode-editorHoverWidget-background,var(--vscode-editorWidget-background));border:1px solid var(--vscode-editorHoverWidget-border,var(--vscode-widget-border));border-radius:4px;box-shadow:var(--mota-shadow);font-size:12px;white-space:nowrap}
.tip b{color:var(--mota-heading);font-variant-numeric:tabular-nums}
.marker{position:absolute;width:10px;height:10px;border-radius:50%;background:var(--vscode-charts-blue);border:2px solid var(--vscode-sideBar-background,var(--vscode-editor-background));transform:translate(-50%,-50%);pointer-events:none}
table.data{border-collapse:collapse;font-size:12px}table.data td,table.data th{padding:3px 12px 3px 0;text-align:left}
`;

const body = `
<div class="page">
 <header class="page-header">
  <div><h1>Performance monitor</h1><div class="subtitle" id="sub"><span class="dot live" style="margin-right:6px"></span>Waiting for the first sample…</div></div>
  <div class="row">
   <label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>App</span><select class="select" id="pkg" aria-label="App to measure" style="max-width:260px"><option value="">No app (device only)</option></select></label>
   <div class="seg" role="group" aria-label="Sample interval" id="intervals"></div>
   <button class="btn btn-secondary" data-action="pause" id="pauseBtn"><svg data-i="pause"></svg>Pause</button>
   <button class="btn btn-secondary" data-action="add"><svg data-i="plus"></svg>Add device</button>
   <button class="btn btn-secondary" data-action="export"><svg data-i="download"></svg>Export CSV</button>
  </div>
 </header>
 <p class="small" id="notice" role="status" style="margin:0" hidden></p>
 <div class="card" style="overflow-x:auto"><table class="cmp" aria-label="Current values per device. Select a row to see its history.">
  <thead><tr><th>Device</th><th>CPU</th><th>Device memory</th><th>App memory</th><th>Frames</th><th>Battery</th><th>Temperature</th><th></th></tr></thead>
  <tbody id="rows"><tr><td colspan="8" class="muted">Waiting for the first sample…</td></tr></tbody></table></div>
 <section class="card card-pad" style="display:flex;flex-direction:column;gap:12px" aria-label="History">
  <div class="row" style="justify-content:space-between"><div><h2 id="dTitle">History</h2><div class="subtitle" id="dSub"></div></div>
   <div class="seg" role="group" aria-label="Metric" id="metric">
    <button aria-pressed="true" data-m="cpu">CPU</button><button aria-pressed="false" data-m="memory">Memory</button><button aria-pressed="false" data-m="appMb">App memory</button><button aria-pressed="false" data-m="jank">Jank</button><button aria-pressed="false" data-m="temperature">Temperature</button>
   </div></div>
  <div class="chart" id="chart"></div>
  <details><summary class="small muted" style="cursor:pointer">Show data table</summary><div id="dataTable" style="margin-top:8px;max-height:200px;overflow:auto"></div></details>
  <p class="small" id="issue" style="margin:0;color:var(--vscode-errorForeground)"></p>
 </section>
 <details class="card card-pad"><summary style="cursor:pointer;font-weight:600;color:var(--mota-heading)">Raw diagnostics</summary><pre class="output" id="raw" style="margin-top:10px;max-height:320px">Waiting for a sample…</pre></details>
</div>
${claudeBarMarkup({ placeholder: 'Ask Claude, e.g. “why is the CPU high on this phone?”…' })}`;

const script = `
document.body.classList.add('has-dock');
const $=id=>document.getElementById(id);
const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let S={devices:[]},current=null,metric='cpu';
const send=(action,extra)=>api.postMessage(Object.assign({action},extra||{}));
function claudeScope(){return{serials:S.devices.map(d=>d.serial),label:S.devices.length===1?S.devices[0].model:S.devices.length+' monitored devices'};}
const M={cpu:['CPU','%',100,80,'Android-reported total CPU %'],memory:['Memory','%',100,90,'Device memory in use'],appMb:['App memory','MB',null,null,'App PSS from dumpsys meminfo'],jank:['Jank','%',null,10,'Share of janky frames (gfxinfo)'],temperature:['Temperature','°C',null,42,'Battery temperature']};
const n=(v,d)=>v===null||v===undefined?'—':(+v).toFixed(d);
function spark(values,max){const pts=values.map((v,i)=>[i,v]).filter(p=>p[1]!==null);if(pts.length<2)return'<svg class="spark" aria-hidden="true"></svg>';
 const w=84,hh=26,mx=max||Math.max(...pts.map(p=>p[1]))*1.15||1,len=values.length-1;
 return '<svg class="spark" viewBox="0 0 '+w+' '+hh+'" role="img" aria-label="Recent trend"><path d="'+pts.map((p,k)=>(k?'L':'M')+(p[0]/len*(w-2)+1).toFixed(1)+','+(hh-2-Math.min(1,p[1]/mx)*(hh-4)).toFixed(1)).join('')+'"/></svg>';}
const flag=t=>t?'<span class="flag">'+icon('warn')+h(t)+'</span>':'';
function rows(){
 if(!S.devices.length){$('rows').innerHTML='<tr><td colspan="8"><div class="empty" style="border:0"><span class="muted">No devices in the monitor.</span><button class="btn btn-primary" data-action="add">'+icon('plus')+'Add device</button></div></td></tr>';return;}
 $('rows').innerHTML=S.devices.map(d=>{const m=d.metrics||{},f=d.flags||{},hs=d.history||{};
  return '<tr aria-selected="'+(d.serial===current)+'" data-serial="'+h(d.serial)+'"><td><div style="font-weight:600;color:var(--mota-heading)">'+h(d.model)+'</div><div class="small muted">'+h(d.sub)+'</div>'+(d.issue&&!d.ok?'<div class="small" style="color:var(--vscode-errorForeground)">'+h(d.issue.slice(0,120))+'</div>':'')+'</td>'
   +'<td><div class="cell"><span class="val">'+n(m.cpu,0)+'<small>%</small></span>'+spark(hs.cpu||[],100)+flag(f.cpu)+'</div></td>'
   +'<td><div class="cell"><span class="val">'+n(m.memory,0)+'<small>%</small></span>'+spark(hs.memory||[],100)+flag(f.memory)+'</div>'+(m.totalGb?'<div class="small muted">'+n(m.usedGb,1)+' / '+n(m.totalGb,1)+' GB</div>':'')+'</td>'
   +'<td><div class="cell"><span class="val">'+(S.packageName?n(m.appMb,0)+'<small> MB</small>':'<small>Choose an app</small>')+'</span>'+(S.packageName?spark(hs.appMb||[]):'')+'</div></td>'
   +'<td><div class="cell"><span class="val">'+(S.packageName&&m.jank!=null?n(m.jank,0)+'<small>% janky</small>':S.packageName?'—':'<small>—</small>')+'</span>'+flag(f.jank)+'</div>'+(m.frames!=null?'<div class="small muted">'+m.frames+' frames</div>':'')+'</td>'
   +'<td><div class="cell"><span class="val" style="font-weight:400">'+(m.battery!=null?n(m.battery,0)+'%'+(m.charging?' · charging':''):'—')+'</span>'+flag(f.battery)+'</div></td>'
   +'<td><div class="cell"><span class="val">'+n(m.temperature,1)+'<small> °C</small></span>'+flag(f.temperature)+'</div></td>'
   +'<td style="text-align:right"><button class="icon-btn" data-remove="'+h(d.serial)+'" aria-label="Remove '+h(d.model)+' from the monitor" title="Remove">'+icon('close')+'</button></td></tr>';}).join('');}
function chart(){const d=S.devices.find(x=>x.serial===current);const el=$('chart');
 if(!d){$('dTitle').textContent='History';$('dSub').textContent='';el.innerHTML='<p class="muted small">Select a device above.</p>';$('dataTable').innerHTML='';return;}
 const [label,unit,fixedMax,warn,desc]=M[metric],values=(d.history||{})[metric]||[],times=d.times||[];
 $('dTitle').textContent=d.model+' · '+label;$('dSub').textContent='Last '+Math.round(values.length*S.interval/1000)+' s · '+desc;$('issue').textContent=d.issue||'';$('raw').textContent=d.raw||'No sample yet.';
 const pts=values.map((v,i)=>[i,v]).filter(p=>p[1]!==null);
 if((metric==='appMb'||metric==='jank')&&!S.packageName){el.innerHTML='<p class="muted small">Choose an app at the top to measure its memory and frames.</p>';$('dataTable').innerHTML='';return;}
 if(pts.length<2){el.innerHTML='<p class="muted small">Collecting samples…</p>';$('dataTable').innerHTML='';return;}
 const W=1000,H=260,L=46,R=12,T=12,B=26,pw=W-L-R,ph=H-T-B,len=Math.max(1,values.length-1);
 const max=fixedMax||Math.max(warn||0,...pts.map(p=>p[1]))*1.15||1;
 const x=i=>L+i/len*pw,y=v=>T+ph-Math.min(1,v/max)*ph;
 const ticks=[0,.25,.5,.75,1].map(f=>f*max);
 const ago=i=>{const s=Math.round((times[times.length-1]-times[i])/1000);return s?'−'+s+' s':'now';};
 el.innerHTML='<svg class="plot" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="'+h(label)+' history for '+h(d.model)+'">'
  +'<g class="grid">'+ticks.map(t=>'<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y(t)+'" y2="'+y(t)+'"/>').join('')+'</g>'
  +'<g class="axis">'+ticks.map(t=>'<text x="'+(L-8)+'" y="'+(y(t)+4)+'" text-anchor="end">'+(t>=10?t.toFixed(0):t.toFixed(1))+(unit==='%'?'%':'')+'</text>').join('')
  +[0,Math.round(len/2),len].map(i=>'<text x="'+x(i)+'" y="'+(H-6)+'" text-anchor="'+(i===0?'start':i===len?'end':'middle')+'">'+ago(i)+'</text>').join('')+'</g>'
  +(warn&&warn<=max?'<line class="threshold" x1="'+L+'" x2="'+(W-R)+'" y1="'+y(warn)+'" y2="'+y(warn)+'"/>':'')
  +'<path class="series" d="'+pts.map((p,k)=>(k?'L':'M')+x(p[0]).toFixed(1)+','+y(p[1]).toFixed(1)).join('')+'"/>'
  +'<line class="cross" id="cross" y1="'+T+'" y2="'+(T+ph)+'" x1="-10" x2="-10"/></svg><div class="marker" id="marker" hidden></div><div class="tip" id="tip" hidden></div>'
  +(warn?'<div class="small muted" style="display:flex;gap:6px;align-items:center;margin-top:6px"><svg width="22" height="6" aria-hidden="true"><line x1="0" x2="22" y1="3" y2="3" stroke="var(--vscode-editorWarning-foreground)" stroke-dasharray="4 4"/></svg>Warning at '+warn+(unit==='%'?'%':' '+unit)+'</div>':'');
 const plot=el.querySelector('svg.plot'),tip=$('tip'),mk=$('marker');
 plot.addEventListener('mousemove',e=>{const r=plot.getBoundingClientRect(),fx=(e.clientX-r.left)/r.width*W;let i=Math.round((fx-L)/pw*len);i=Math.max(0,Math.min(len,i));
  while(i>0&&values[i]===null)i--;if(values[i]===null)return;
  const c=$('cross');c.setAttribute('x1',x(i));c.setAttribute('x2',x(i));
  const px=x(i)/W*r.width,py=y(values[i])/H*r.height;mk.hidden=false;mk.style.left=px+'px';mk.style.top=py+'px';
  tip.hidden=false;tip.innerHTML='<span class="muted">'+ago(i)+'</span> · <b>'+(+values[i]).toFixed(1)+' '+h(unit)+'</b>';tip.style.left=Math.min(r.width-150,px+12)+'px';tip.style.top=Math.max(0,py-36)+'px';});
 plot.addEventListener('mouseleave',()=>{tip.hidden=true;mk.hidden=true;const c=$('cross');c.setAttribute('x1',-10);c.setAttribute('x2',-10);});
 $('dataTable').innerHTML='<table class="data"><thead><tr><th>Time</th><th>'+h(label)+' ('+h(unit)+')</th></tr></thead><tbody>'+values.map((v,i)=>[i,v]).reverse().slice(0,30).map(p=>'<tr><td>'+ago(p[0])+'</td><td>'+(p[1]===null?'—':(+p[1]).toFixed(1))+'</td></tr>').join('')+'</tbody></table>';}
function render(){
 const live=!S.paused;$('sub').innerHTML='<span class="dot '+(live?'live':'off')+'" style="margin-right:6px"></span>'+(live?'Live':'Paused')+' · '+S.devices.length+' device'+(S.devices.length===1?'':'s')+' · every '+S.interval/1000+' s · updated '+new Date(S.time).toLocaleTimeString();
 $('pauseBtn').innerHTML=icon(S.paused?'play':'pause')+(S.paused?'Resume':'Pause');
 $('intervals').innerHTML=(S.intervals||[]).map(v=>'<button aria-pressed="'+(v===S.interval)+'" data-interval="'+v+'">'+v/1000+' s</button>').join('');
 const sel=$('pkg');if(document.activeElement!==sel){sel.innerHTML='<option value="">No app (device only)</option>'+(S.packages||[]).concat(S.packageName&&!(S.packages||[]).includes(S.packageName)?[S.packageName]:[]).map(p=>'<option value="'+h(p)+'">'+h(p)+'</option>').join('');sel.value=S.packageName||'';}
 if(!S.devices.some(d=>d.serial===current))current=S.devices[0]?S.devices[0].serial:null;
 rows();chart();drawIcons();if(window.claudeBar)claudeBar.refreshScope();}
document.addEventListener('click',e=>{const t=e.target;if(t.closest('#aiDock'))return;const b=t.closest('button');
 if(b&&b.dataset.remove){send('remove',{serial:b.dataset.remove});return;}
 if(b&&b.dataset.interval){send('interval',{interval:+b.dataset.interval});return;}
 if(b&&b.dataset.m){metric=b.dataset.m;document.querySelectorAll('[data-m]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));chart();return;}
 if(b&&b.dataset.action){$('notice').hidden=true;send(b.dataset.action);return;}
 const tr=t.closest('#rows tr[data-serial]');if(tr){current=tr.dataset.serial;rows();chart();drawIcons();}});
$('pkg').addEventListener('change',e=>send('package',{package:e.target.value}));
window.addEventListener('message',e=>{const m=e.data;if(!m)return;
 if(m.kind==='sample'){S=m;render();}
 else if(m.kind==='notice'){$('notice').hidden=false;$('notice').textContent=m.text;$('notice').style.color=m.error?'var(--vscode-errorForeground)':'';}});
`;
