const {test}=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');const vm=require('node:vm');
const {mkdtemp,writeFile,rm}=require('node:fs/promises');const {join}=require('node:path');const {tmpdir}=require('node:os');
const {RecordingStore}=require('../out/recorder');
async function harness(){
 const root=await mkdtemp(join(tmpdir(),'mota-ui-')),commands=new Map(),panels=[],quick=[],input=[],warnings=[],calls=[],clipboard=[];
 const display={width:100,height:200,rotation:0};let state={protocol:1,version:'0.4.0',ready:true,recording:false,playing:false,busy:false,videoActive:false,...display};
 let source={schemaVersion:1,...display,actions:[{type:'gesture',atMs:0,delayMs:0,...display,dispatch:'completed',strokes:[{pointerId:0,startMs:0,durationMs:100,points:[[10,10,0],[10,10,100]]}]}],screenshots:[]};
 class Client{constructor(_adb,serial){this.serial=serial;}async connect(){return state;}async dispose(){calls.push('dispose');}async request(op,p={}){calls.push({op,p});if(op==='status')return state;if(op==='start'){state={...state,recording:true,session:'20261027-123000',mode:p.mode,actions:0};return state;}if(op==='stop'||op==='cancel'){state={...state,recording:false,playing:false};return state;}if(op==='files')return {files:[{path:'actions.json',size:Buffer.byteLength(JSON.stringify(source))}]};if(op==='read')return {data:Buffer.from(JSON.stringify(source)).toString('base64')};if(op==='replay'){state={...state,playing:true,replayIndex:0,replayTotal:1};return state;}return state;}}
 const vscode={env:{clipboard:{writeText:async text=>{clipboard.push(text);}}},ViewColumn:{One:1},Uri:{file:p=>({fsPath:p,path:p,toString:()=>p})},workspace:{workspaceFolders:[],getConfiguration:()=>({get:(k,d)=>k==='recordingsDirectory'?root:d})},commands:{registerCommand:(n,fn)=>{commands.set(n,fn);return {dispose(){}};},executeCommand:async()=>{}},window:{showQuickPick:async items=>{const pick=quick.shift();return typeof pick==='function'?pick(items):pick;},showInputBox:async()=>input.shift(),showWarningMessage:async()=>warnings.shift(),createWebviewPanel:()=>{let receive;const dispose=[];let closed=false;const panel={webview:{html:'',cspSource:'vscode-webview://test',asWebviewUri:u=>u,postMessage:async()=>true,onDidReceiveMessage:f=>{receive=f;}},receive:m=>receive(m),reveal(){},onDidDispose:f=>dispose.push(f),dispose:()=>{if(!closed){closed=true;dispose.forEach(f=>f());}}};panels.push(panel);return panel;}}};
 const context={subscriptions:[],globalStorageUri:{fsPath:root},asAbsolutePath:p=>join(root,p),workspaceState:{get:(_k,d)=>d}};
 const adc={shell:async(_s,args)=>args.includes('android_id')?'0123456789abcdef':args.includes('getprop')?'36':'',run:async()=> 'Success'};
 const old=Module._load;Module._load=function(name,...rest){return name==='./helperClient'?{...require('../out/helperClient'),HelperClient:Client}:old.call(this,name,...rest);};
 delete require.cache[require.resolve('../out/recordingsView')];const {registerRecordings}=require('../out/recordingsView');Module._load=old;
 registerRecordings(vscode,context,adc,async()=>[{serial:'phone',model:'Test phone',state:'device'}]);
 const store=new RecordingStore(root);
 return {root,commands,panels,quick,input,warnings,calls,clipboard,store,get state(){return state;},set state(v){state=v;},data:()=>source,close:async()=>{for(const p of panels)p.dispose();await new Promise(r=>setTimeout(r,25));await rm(root,{recursive:true,force:true});}};
}
test('recordings UI starts overlay capture, finalizes downloads, renders timeline and confirms replay',async()=>{
 const h=await harness();try{
 await h.commands.get('mota.recordings')({device:{serial:'phone',model:'Phone',state:'device'}});const panel=h.panels[0];
 h.quick.push({value:'overlay',label:'Overlay recording'},{video:false});h.input.push('<script>flow</script>','');
 await panel.receive({action:'start'});assert.ok(h.calls.some(c=>c.op==='start'&&c.p.mode==='overlay'));assert.match(panel.webview.html,/Recording &lt;script&gt;/);
 await panel.receive({action:'stop'});const records=await h.store.list();assert.equal(records.length,1);assert.equal(records[0].meta.complete,true);assert.match(panel.webview.html,/1 finger path/);assert.ok(!panel.webview.html.includes('<script>flow</script>'));
 await panel.receive({action:'replay'});assert.ok(!h.calls.some(c=>c.op==='replay'));
 h.warnings.push('Replay');await panel.receive({action:'replay'});assert.ok(h.calls.some(c=>c.op==='replay'));await panel.receive({action:'stop'});assert.ok(h.calls.some(c=>c.op==='cancel'));
 for(const [,s]of panel.webview.html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(s);
 }finally{await h.close();}
});
test('closing the recordings page stops capture and preserves the local session',async()=>{
 const h=await harness();try{
 await h.commands.get('mota.recordings')();const p=h.panels[0];h.quick.push({value:'overlay',label:'Overlay recording'},{video:false});h.input.push('Close test','');await p.receive({action:'start'});p.dispose();await new Promise(r=>setTimeout(r,80));assert.ok(h.calls.some(c=>c.op==='stop'));assert.equal((await h.store.list())[0].meta.complete,true);
 }finally{await h.close();}
});
test('recordings page rejects cross-device replay before asking the helper to execute',async()=>{
 const h=await harness();try{
 const staged=await h.store.create({name:'Wrong device',device:'other',identity:'different',model:'Other',mode:'helper',complete:true});await writeFile(join(staged.dir,'actions.json'),JSON.stringify(h.data()));
 await h.commands.get('mota.recordings')();const p=h.panels[0];await p.receive({action:'select',index:0});h.warnings.push('Replay');await p.receive({action:'replay'});assert.match(p.webview.html,/restricted to the device/);assert.ok(!h.calls.some(c=>c.op==='replay'));
 }finally{await h.close();}
});

test('closing the page while options are open never starts a device recording',async()=>{
 const h=await harness();try{await h.commands.get('mota.recordings')();const p=h.panels[0];h.quick.push(items=>{p.dispose();return {value:'overlay',label:'Overlay recording'};});await p.receive({action:'start'});assert.ok(!h.calls.some(c=>c.op==='start'));}finally{await h.close();}
});

test('recording failures show selectable details and copy the diagnostic report',async()=>{
 const h=await harness();try{await h.commands.get('mota.recordings')();const p=h.panels[0];await p.receive({action:'replay'});assert.match(p.webview.html,/Copy error details/);assert.match(p.webview.html,/user-select:text/);await p.receive({action:'copy-error'});assert.equal(h.clipboard.length,1);assert.match(h.clipboard[0],/MoTA recording error/);assert.match(h.clipboard[0],/Operation: replay/);assert.match(h.clipboard[0],/Select a saved session/);assert.match(p.webview.html,/copied to clipboard/);}finally{await h.close();}
});
