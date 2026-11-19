const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const vm = require('node:vm');
const {Adb} = require('../out/adb');
function harness() {
 const registered=new Map(),panels=[],quick=[],inputs=[],warnings=[],global=new Map(),workspace=new Map(),calls=[],deviceSettings=new Map();
 const context={subscriptions:[],globalState:{get:(k,d)=>global.has(k)?global.get(k):d,update:async(k,v)=>global.set(k,v)},workspaceState:{get:(k,d)=>workspace.has(k)?workspace.get(k):d,update:async(k,v)=>workspace.set(k,v)}};
 const disposable=()=>({dispose(){}});
 const uri={fsPath:'/project/app.apk',path:'/project/app.apk'};
 const vscode={TreeItem:class{constructor(label){this.label=label;}},ThemeIcon:class{},EventEmitter:class{event=()=>{};fire(){}dispose(){}},ViewColumn:{One:1},ProgressLocation:{Notification:1},
  commands:{registerCommand:(k,fn)=>{registered.set(k,fn);return disposable();},executeCommand:async(k,...args)=>registered.get(k)?.(...args)},
  workspace:{getConfiguration:()=>({get:(k,d)=>d}),findFiles:async()=>[],asRelativePath:u=>u.fsPath,createFileSystemWatcher:()=>({dispose(){},onDidCreate:disposable,onDidDelete:disposable})},
  env:{clipboard:{writeText:async()=>{}}},window:{registerTreeDataProvider:disposable,showWarningMessage:async()=>warnings.shift(),showErrorMessage:async()=>undefined,showQuickPick:async(items)=>{const value=quick.shift();return typeof value==='function'?value(items):value;},showInputBox:async()=>inputs.shift(),showOpenDialog:async()=>[uri],showInformationMessage:async()=>undefined,withProgress:async(_o,fn)=>fn({report(){}}),createWebviewPanel:(_id,title)=>{
   let handler,disposed=false;const disposeHandlers=[];
   const panel={title,webview:{html:'',postMessage:async m=>{panel.messages.push(m);return true;},onDidReceiveMessage:fn=>{handler=fn;return disposable();}},messages:[],onDidDispose:fn=>{disposeHandlers.push(fn);return disposable();},dispose:()=>{if(!disposed){disposed=true;disposeHandlers.forEach(fn=>fn());}},reveal(){},receive:async m=>handler?.(m)};
   panels.push(panel);context.subscriptions.push(panel);return panel;
  }}
 };
 const oldLoad=Module._load,oldRun=Adb.prototype.run,oldDevices=Adb.prototype.devices;
 const apk = require('../out/apk');let detectedId;let failureText='INSTALL_FAILED_TEST_ONLY';let uninstallFailure=false;
 Module._load=function(request,...args){return request==='vscode'?vscode:request==='./apk'?{...apk,detectApkPackage:async()=>detectedId,readApkBadging:async()=>detectedId?{package:detectedId,versionName:'2.0',versionCode:2,abis:[],debuggable:false}:undefined}:oldLoad.call(this,request,...args);};
 for(const m of ['../out/extension','../out/installPage','../out/monitorPage'])delete require.cache[require.resolve(m)];
 const {activate}=require('../out/extension');Module._load=oldLoad;
 Adb.prototype.devices=async()=>[{serial:'one',state:'device',model:'Pixel'},{serial:'two',state:'device',model:'Samsung'}];
 let failSecond=true;
 Adb.prototype.run=async function(args){calls.push(args);if(args.includes('install')) {if(args[1]==='two'&&failSecond)throw new Error(failureText);return 'Success';}if(args.includes('uninstall')) {if(uninstallFailure)throw new Error('DELETE_FAILED_DEVICE_POLICY_MANAGER');return 'Success';}if(args[0]==='connect')return args[1].includes('bad')?'failed to connect':'connected to '+args[1];if(args[3]==='settings') {const key=args[1]+':'+args[5]+':'+args[6];if(args[4]==='put'){deviceSettings.set(key,args[7]);return '';}return deviceSettings.get(key) ?? (args[5]==='global'?'2':'30000');}if(args.includes('resolve-activity'))return args.at(-1)+'/.MainActivity';if(args[3]==='am')return 'Status: ok';if(args.includes('getprop'))return '14';if(args.includes('battery'))return 'level: 80\nscale: 100';if(args.includes('cpuinfo'))return '12% TOTAL';if(args.includes('/proc/meminfo'))return 'MemTotal: 8388608 kB\nMemAvailable: 4194304 kB';return '';};
 activate(context);
 return {registered,panels,quick,inputs,warnings,global,workspace,calls,deviceSettings,uri,setFailure:text=>{failureText=text;},setMetadata:pkg=>{detectedId=pkg;},failUninstall:()=>{uninstallFailure=true;},success:()=>{failSecond=false;},cleanup:()=>{context.subscriptions.forEach(s=>s.dispose());Adb.prototype.run=oldRun;Adb.prototype.devices=oldDevices;}};
}
const tick=()=>new Promise(r=>setTimeout(r,10));


test('successful connections are remembered and failed ones open actionable recovery',async()=>{
 const h=harness();try{await h.registered.get('mota.connect')('192.168.1.2:5555');assert.deepEqual(h.global.get('addresses'),['192.168.1.2:5555']);await h.registered.get('mota.connect')('bad:5555');assert.deepEqual(h.global.get('addresses'),['192.168.1.2:5555']);assert.match(h.panels.at(-1).webview.html,/Reconnect device/);await tick();assert.equal(h.global.get('knownDevices').length,2);}finally{h.cleanup();}
});


const installOptions={replace:true,test:false,downgrade:false,grant:false,user:'',timeout:180};





test('keep awake preserves original settings across repeated enables and restores them',async()=>{
 const h=harness();const item={device:{serial:'one',state:'device',model:'Pixel'}};try{
 for(const value of ['on','on','battery','battery','restore']){h.quick.push({value});await h.registered.get('mota.awake')(item);}
 assert.equal(h.deviceSettings.get('one:global:stay_on_while_plugged_in'),'2');
 assert.equal(h.deviceSettings.get('one:system:screen_off_timeout'),'30000');
 assert.equal(h.global.get('awake.one'),undefined);assert.equal(h.global.get('sleep.one'),undefined);
 assert.match(h.panels.at(-1).webview.html,/Previous sleep setting restored/);
 }finally{h.cleanup();}
});

test('standalone launch remembers app ID and targets selected devices',async()=>{
 const h=harness();try{h.quick.push(items=>items);h.inputs.push('com.example.app');await h.registered.get('mota.launch')();assert.equal(h.workspace.get('launchPackage'),'com.example.app');assert.equal(h.calls.filter(a=>a[3]==='am').length,2);}finally{h.cleanup();}
});

// ---- redesigned install page (src/installPage.ts) and monitor (src/monitorPage.ts)
const settle=async()=>{for(let i=0;i<15;i++)await tick();};
const both=[{serial:'one',state:'device',model:'Pixel'},{serial:'two',state:'device',model:'Samsung'}];
const lastState=panel=>panel.messages.filter(m=>m.kind==='state').at(-1);
const installs=h=>h.calls.filter(a=>a.includes('install'));
async function openInstall(h){await h.registered.get('mota.install')({targets:both});const panel=h.panels.at(-1);await settle();return panel;}
const scriptsParse=panel=>{for(const [,script]of panel.webview.html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script);};
test('install page retains success and retries only failed targets with revised flags',async()=>{
 const h=harness();try{
 const panel=await openInstall(h);
 assert.match(panel.webview.html,/How to install/);scriptsParse(panel);
 await panel.receive({action:'install'});await settle();
 let st=lastState(panel);
 assert.equal(st.rows.find(r=>r.serial==='one').state,'installed');
 const two=st.rows.find(r=>r.serial==='two');assert.equal(two.state,'failed');assert.deepEqual(two.fixes,['test']);
 h.success();await panel.receive({action:'fix',serial:'two',fix:'test'});await settle();
 assert.equal(installs(h).filter(a=>a[1]==='one').length,1);
 assert.equal(installs(h).filter(a=>a[1]==='two').length,2);
 assert.ok(installs(h).at(-1).includes('-t'));
 assert.ok(lastState(panel).rows.every(r=>r.state==='installed'));
 await panel.receive({action:'options',options:{test:true,downgrade:false,grant:false,user:'',timeout:180}});
 assert.equal(h.workspace.get('installOptions').test,true);
 }finally{h.cleanup();}
});
test('invalid page options never invoke adb install',async()=>{
 const h=harness();try{const panel=await openInstall(h);
 await panel.receive({action:'options',options:{user:'--bad',timeout:1}});await settle();
 assert.match(lastState(panel).notice,/User|Timeout/);assert.equal(h.workspace.get('installOptions'),undefined);
 assert.equal(installs(h).length,0);
 }finally{h.cleanup();}
});
test('signature recovery requires confirmation and uninstalls only the failed device',async()=>{
 const h=harness();try{
 h.setMetadata('com.example.app');h.setFailure('INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.example.app signatures do not match newer version');
 const panel=await openInstall(h);
 await panel.receive({action:'install'});await settle();
 assert.ok(lastState(panel).rows.find(r=>r.serial==='two').fixes.includes('clean'));
 h.warnings.push(undefined);await panel.receive({action:'fix',serial:'two',fix:'clean'});await settle();
 assert.equal(h.calls.filter(a=>a.includes('uninstall')).length,0,'cancelled confirmation never uninstalls');
 h.success();h.warnings.push('Uninstall & install');await panel.receive({action:'fix',serial:'two',fix:'clean'});await settle();
 assert.deepEqual(h.calls.filter(a=>a.includes('uninstall')),[['-s','two','uninstall','com.example.app']]);
 assert.equal(installs(h).filter(a=>a[1]==='one'&&!a.includes('uninstall')).length,1);
 assert.match(lastState(panel).rows.find(r=>r.serial==='two').detail,/app data was reset/);
 }finally{h.cleanup();}
});
test('clean replacement cancellation and mismatched package never uninstall',async()=>{
 const h=harness();try{
 h.setMetadata('com.example.app');const panel=await openInstall(h);
 await panel.receive({action:'mode',mode:'clean'});h.warnings.push(undefined);await panel.receive({action:'install'});await settle();
 assert.equal(h.calls.filter(a=>a.includes('uninstall')).length,0);
 await panel.receive({action:'mode',mode:'update'});
 h.setFailure('INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.wrong.app signatures do not match');
 await panel.receive({action:'install'});await settle();
 h.warnings.push('Uninstall & install');await panel.receive({action:'fix',serial:'two',fix:'clean'});await settle();
 assert.match(lastState(panel).notice,/isn't the one in this APK/);assert.equal(h.calls.filter(a=>a.includes('uninstall')).length,0);
 }finally{h.cleanup();}
});
test('uninstall failure stops before reinstall and surfaces device error',async()=>{
 const h=harness();try{
 h.setMetadata('com.example.app');const panel=await openInstall(h);h.failUninstall();
 await panel.receive({action:'mode',mode:'clean'});h.warnings.push('Uninstall & install');await panel.receive({action:'install'});await settle();
 assert.equal(installs(h).filter(a=>!a.includes('uninstall')).length,0);
 assert.ok(lastState(panel).rows.every(r=>r.state==='failed'&&/DELETE_FAILED_DEVICE_POLICY_MANAGER/.test(r.error)));
 }finally{h.cleanup();}
});
test('already-installed recovery keeps replace on and touches only the failed target',async()=>{
 const h=harness();try{
 h.setFailure('INSTALL_FAILED_ALREADY_EXISTS');const panel=await openInstall(h);
 await panel.receive({action:'install'});await settle();h.success();
 await panel.receive({action:'fix',serial:'two',fix:'replace'});await settle();
 assert.ok(installs(h).at(-1).includes('-r'));assert.equal(installs(h).at(-1)[1],'two');assert.equal(h.calls.filter(a=>a.includes('uninstall')).length,0);
 }finally{h.cleanup();}
});
test('apps launch after install only on devices where the install succeeded',async()=>{
 const h=harness();try{
 h.setMetadata('com.example.app');const panel=await openInstall(h);
 await panel.receive({action:'install'});await settle();
 const launches=h.calls.filter(a=>a[3]==='am');assert.equal(launches.length,1);assert.equal(launches[0][1],'one');
 assert.match(lastState(panel).rows.find(r=>r.serial==='one').detail,/launched/);
 }finally{h.cleanup();}
});
test('monitor delivers structured samples, validates options and supports pause',async()=>{
 const h=harness();try{h.quick.push(items=>items);await h.registered.get('mota.stats')();const panel=h.panels.at(-1);
 await panel.receive({action:'ready'});await settle();
 const first=panel.messages.filter(m=>m.kind==='sample').find(m=>m.devices.every(d=>d.metrics));
 assert.equal(first.devices.length,2);assert.equal(first.devices[0].metrics.battery,80);assert.equal(first.devices[0].metrics.memory,50);
 await panel.receive({action:'pause'});assert.equal(panel.messages.filter(m=>m.kind==='sample').at(-1).paused,true);
 await panel.receive({action:'package',package:'bad;inject'}).catch(()=>{});await settle();
 assert.match(panel.messages.filter(m=>m.kind==='notice').at(-1).text,/valid app package/);
 await panel.receive({action:'interval',interval:7});assert.equal(panel.messages.filter(m=>m.kind==='sample').at(-1).interval,2000);
 scriptsParse(panel);panel.dispose();
 }finally{h.cleanup();}
});
