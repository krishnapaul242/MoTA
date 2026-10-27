const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const vm = require('node:vm');
const {Adb} = require('../out/adb');
function harness() {
 const registered=new Map(),panels=[],quick=[],inputs=[],global=new Map(),workspace=new Map(),calls=[];
 const context={subscriptions:[],globalState:{get:(k,d)=>global.has(k)?global.get(k):d,update:async(k,v)=>global.set(k,v)},workspaceState:{get:(k,d)=>workspace.has(k)?workspace.get(k):d,update:async(k,v)=>workspace.set(k,v)}};
 const disposable=()=>({dispose(){}});
 const uri={fsPath:'/project/app.apk',path:'/project/app.apk'};
 const vscode={TreeItem:class{constructor(label){this.label=label;}},ThemeIcon:class{},EventEmitter:class{event=()=>{};fire(){}dispose(){}},ViewColumn:{One:1},ProgressLocation:{Notification:1},
  commands:{registerCommand:(k,fn)=>{registered.set(k,fn);return disposable();},executeCommand:async(k,...args)=>registered.get(k)?.(...args)},
  workspace:{getConfiguration:()=>({get:(k,d)=>d}),findFiles:async()=>[],asRelativePath:u=>u.fsPath,createFileSystemWatcher:()=>({dispose(){},onDidCreate:disposable,onDidDelete:disposable})},
  window:{registerTreeDataProvider:disposable,showQuickPick:async(items)=>{const value=quick.shift();return typeof value==='function'?value(items):value;},showInputBox:async()=>inputs.shift(),showOpenDialog:async()=>[uri],showInformationMessage:async()=>undefined,withProgress:async(_o,fn)=>fn({report(){}}),createWebviewPanel:(_id,title)=>{
   let handler,disposed=false;const disposeHandlers=[];
   const panel={title,webview:{html:'',postMessage:async m=>{panel.messages.push(m);return true;},onDidReceiveMessage:fn=>{handler=fn;return disposable();}},messages:[],onDidDispose:fn=>{disposeHandlers.push(fn);return disposable();},dispose:()=>{if(!disposed){disposed=true;disposeHandlers.forEach(fn=>fn());}},reveal(){},receive:async m=>handler?.(m)};
   panels.push(panel);context.subscriptions.push(panel);return panel;
  }}
 };
 const oldLoad=Module._load,oldRun=Adb.prototype.run,oldDevices=Adb.prototype.devices;
 const apk = require('../out/apk');let detectedId;let failureText='INSTALL_FAILED_TEST_ONLY';let uninstallFailure=false;
 Module._load=function(request,...args){return request==='vscode'?vscode:request==='./apk'?{...apk,detectApkPackage:async()=>detectedId}:oldLoad.call(this,request,...args);};
 delete require.cache[require.resolve('../out/extension')];
 const {activate}=require('../out/extension');Module._load=oldLoad;
 Adb.prototype.devices=async()=>[{serial:'one',state:'device',model:'Pixel'},{serial:'two',state:'device',model:'Samsung'}];
 let failSecond=true;
 Adb.prototype.run=async function(args){calls.push(args);if(args.includes('install')) {if(args[1]==='two'&&failSecond)throw new Error(failureText);return 'Success';}if(args.includes('uninstall')) {if(uninstallFailure)throw new Error('DELETE_FAILED_DEVICE_POLICY_MANAGER');return 'Success';}if(args[0]==='connect')return args[1].includes('bad')?'failed to connect':'connected to '+args[1];if(args.includes('getprop'))return '14';if(args.includes('battery'))return 'level: 80\nscale: 100';if(args.includes('cpuinfo'))return '12% TOTAL';if(args.includes('/proc/meminfo'))return 'MemTotal: 8388608 kB\nMemAvailable: 4194304 kB';return '';};
 activate(context);
 return {registered,panels,quick,inputs,global,workspace,calls,uri,setFailure:text=>{failureText=text;},setMetadata:pkg=>{detectedId=pkg;},failUninstall:()=>{uninstallFailure=true;},success:()=>{failSecond=false;},cleanup:()=>{context.subscriptions.forEach(s=>s.dispose());Adb.prototype.run=oldRun;Adb.prototype.devices=oldDevices;}};
}
const tick=()=>new Promise(r=>setTimeout(r,10));
test('install page retains success and retries only failed targets with revised flags',async()=>{
 const h=harness();try{
 h.quick.push(items=>items,{value:'page'});
 await h.registered.get('mota.install')();
 const panel=h.panels.at(-1);
 assert.match(panel.webview.html,/Install options/);
 const options={replace:true,test:false,downgrade:false,grant:false,user:'',timeout:180};
 await panel.receive({action:'install',options});
 assert.match(panel.webview.html,/Retry failed devices/);
 assert.match(panel.webview.html,/Allow test APK/);
 h.success();await panel.receive({action:'install',options:{...options,test:true}});
 const installs=h.calls.filter(a=>a.includes('install'));
 assert.equal(installs.filter(a=>a[1]==='one').length,1);
 assert.equal(installs.filter(a=>a[1]==='two').length,2);
 assert.ok(installs.at(-1).includes('-t'));
 assert.match(panel.webview.html,/Installed successfully/);
 assert.deepEqual(h.global.get('selectedDevices'),['one','two']);
 assert.equal(h.workspace.get('installOptions').test,true);
 // Parse inline webview JavaScript as JavaScript, including its nonce wrapper.
 for(const [,script]of panel.webview.html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script);
 }finally{h.cleanup();}
});
test('invalid page options never invoke adb install',async()=>{
 const h=harness();try{h.quick.push(items=>items,{value:'page'});await h.registered.get('mota.install')();const panel=h.panels.at(-1);await panel.receive({action:'install',options:{user:'--bad',timeout:1}});assert.ok(panel.messages.some(m=>m.error));assert.equal(h.calls.filter(a=>a.includes('install')).length,0);}finally{h.cleanup();}
});
test('successful connections are remembered and failed ones open actionable recovery',async()=>{
 const h=harness();try{await h.registered.get('mota.connect')('192.168.1.2:5555');assert.deepEqual(h.global.get('addresses'),['192.168.1.2:5555']);await h.registered.get('mota.connect')('bad:5555');assert.deepEqual(h.global.get('addresses'),['192.168.1.2:5555']);assert.match(h.panels.at(-1).webview.html,/Reconnect device/);await tick();assert.equal(h.global.get('knownDevices').length,2);}finally{h.cleanup();}
});
test('monitor delivers structured samples, validates options and supports pause',async()=>{
 const h=harness();try{h.quick.push(items=>items);await h.registered.get('mota.stats')();const panel=h.panels.at(-1);const first=panel.messages.find(m=>m.devices);assert.equal(first.devices.length,2);assert.equal(first.devices[0].metrics.battery,80);assert.equal(first.devices[0].metrics.memory,50);await panel.receive({action:'pause'});assert.equal(panel.messages.at(-1).paused,true);await panel.receive({action:'apply',package:'bad;inject',interval:5000});assert.match(panel.messages.at(-1).error,/valid Android package/);for(const [,script]of panel.webview.html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script);}finally{h.cleanup();}
});

const installOptions={replace:true,test:false,downgrade:false,grant:false,user:'',timeout:180};
test('signature recovery requires confirmation and uninstalls only the failed device',async()=>{
 const h=harness();try{
 h.setFailure('INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.example.app signatures do not match newer version');
 h.quick.push(items=>items,{value:'page'});await h.registered.get('mota.install')();const panel=h.panels.at(-1);
 await panel.receive({action:'install',options:installOptions});
 assert.match(panel.webview.html,/Uninstall conflicting app & reinstall/);
 await panel.receive({action:'clean-one',index:1,package:'',options:installOptions});
 assert.match(panel.webview.html,/Confirm clean replacement/);assert.match(panel.webview.html,/com.example.app/);
 assert.equal(h.calls.filter(a=>a.includes('uninstall')).length,0);
 await panel.receive({action:'confirm-replace',confirmed:false});assert.equal(h.calls.filter(a=>a.includes('uninstall')).length,0);
 h.success();await panel.receive({action:'confirm-replace',confirmed:true});
 assert.deepEqual(h.calls.filter(a=>a.includes('uninstall')),[['-s','two','uninstall','com.example.app']]);
 assert.equal(h.calls.filter(a=>a.includes('install')&&a[1]==='one').length,1);
 assert.match(panel.webview.html,/Local app data was reset/);
 }finally{h.cleanup();}
});
test('clean replacement cancellation and mismatched package never uninstall',async()=>{
 const h=harness();try{
 h.quick.push(items=>items,{value:'page'});await h.registered.get('mota.install')();const panel=h.panels.at(-1);
 await panel.receive({action:'clean',package:'com.example.app',options:installOptions});
 await panel.receive({action:'cancel-replace'});await panel.receive({action:'confirm-replace',confirmed:true});
 assert.equal(h.calls.filter(a=>a.includes('uninstall')).length,0);
 h.setFailure('INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.example.app signatures do not match');
 await panel.receive({action:'install',options:installOptions});
 await panel.receive({action:'clean-one',index:1,package:'com.wrong.app',options:installOptions});
 assert.match(panel.messages.at(-1).error,/differs/);assert.equal(h.calls.filter(a=>a.includes('uninstall')).length,0);
 }finally{h.cleanup();}
});
test('uninstall failure stops before reinstall and surfaces device error',async()=>{
 const h=harness();try{
 h.quick.push(items=>items,{value:'page'});await h.registered.get('mota.install')();const panel=h.panels.at(-1);
 await panel.receive({action:'clean',package:'com.example.app',options:installOptions});h.failUninstall();
 await panel.receive({action:'confirm-replace',confirmed:true});
 assert.equal(h.calls.filter(a=>a.includes('install')).length,0);assert.match(panel.webview.html,/DELETE_FAILED_DEVICE_POLICY_MANAGER/);
 }finally{h.cleanup();}
});
test('already-installed recovery enables replace on only the failed target',async()=>{
 const h=harness();try{
 h.quick.push(items=>items,{value:'page'});h.setFailure('INSTALL_FAILED_ALREADY_EXISTS');await h.registered.get('mota.install')();const panel=h.panels.at(-1);
 await panel.receive({action:'install',options:{...installOptions,replace:false}});h.success();
 await panel.receive({action:'retry-replace',index:1,options:{...installOptions,replace:false}});
 assert.ok(h.calls.filter(a=>a.includes('install')).at(-1).includes('-r'));assert.equal(h.calls.filter(a=>a.includes('uninstall')).length,0);
 }finally{h.cleanup();}
});
