// Uses only the helper installed on a specified emulator; never prints its token.
const assert=require('node:assert/strict');const {join}=require('node:path');
const {Adb}=require('../../out/adb');const {HelperClient}=require('../../out/helperClient');
const serial=process.argv[2];if(!/^emulator-\d+$/.test(serial||''))throw new Error('Pass an emulator serial');
const executable=process.env.MOTA_TEST_ADB||join(process.env.ANDROID_SDK_ROOT||join(process.env.HOME,'Library/Android/sdk'),'platform-tools/adb');
(async()=>{
 const adb=new Adb(()=>executable),client=new HelperClient(adb,serial);let tests=0;let previous,previousEnabled;
 try{
 const status=await client.connect();assert.equal(status.protocol,1);tests++;assert.equal(status.version,'0.3.0');tests++;
 const sessions=await client.request('sessions');assert.ok(Array.isArray(sessions.sessions));tests++;
 await assert.rejects(client.request('read',{session:'valid-id',path:'../secret',offset:0}),/Invalid file path/);tests++;
 const token=client.token;client.token='wrong';await assert.rejects(client.request('status'),/closed|disconnected/);client.token=token;tests++;
 assert.equal((await client.request('status')).protocol,1);tests++;
 if(process.argv.includes('--exercise-service')){
 previous=await adb.shell(serial,['settings','get','secure','enabled_accessibility_services']);
 previousEnabled=await adb.shell(serial,['settings','get','secure','accessibility_enabled']);
 const component='dev.mota.recorder/dev.mota.recorder.RecorderService';
 const enabled=previous==='null'||!previous?component:previous.includes(component)?previous:previous+':'+component;
 await adb.shell(serial,['settings','put','secure','enabled_accessibility_services',enabled]);
 await adb.shell(serial,['settings','put','secure','accessibility_enabled','1']);
 let ready;const until=Date.now()+25000;do{await new Promise(r=>setTimeout(r,300));ready=await client.request('status');}while(!ready.ready&&Date.now()<until);
 assert.equal(ready.ready,true);tests++;
 const started=await client.request('start',{mode:'adb'});assert.equal(started.recording,true);assert.equal(started.mode,'adb');tests++;
 assert.ok(started.width>0&&started.uptimeStartMs>0);tests++;
 await assert.rejects(client.request('files',{session:started.session}),/Stop/);tests++;
 const stopped=await client.request('stop');assert.equal(stopped.recording,false);tests++;
 const files=await client.request('files',{session:started.session});assert.ok(files.files.some(f=>f.path==='actions.json'));tests++;
 const chunk=await client.request('read',{session:started.session,path:'actions.json',offset:0});
 const saved=JSON.parse(Buffer.from(chunk.data,'base64'));assert.equal(saved.finished,true);assert.equal(saved.captureMode,'adb-events');tests++;
 await assert.rejects(client.request('replay',{session:{schemaVersion:1,width:1,height:1,rotation:0,actions:[]}}),/display/);tests++;
 }
 console.log(`PASS: ${tests} emulator bridge checks; accessibility ${status.ready?'ready':'not enabled'}`);
 }finally{
 if(previous!==undefined){await client.request('stop').catch(()=>{});await adb.shell(serial,['settings','put','secure','enabled_accessibility_services',previous||'null']);await adb.shell(serial,['settings','put','secure','accessibility_enabled',previousEnabled||'0']);}
 await client.dispose();}
})().catch(e=>{console.error('Bridge smoke failed:',e.message);process.exitCode=1;});
