// Emulator only: makes MoTA Recorder device owner with dpm, exercises the admin* bridge ops, then releases device owner.
// Usage: npm run compile && node helper-apk/tests/device-owner-smoke.js emulator-5554
// Needs an emulator with no accounts. Never prints the bridge token.
const assert=require('node:assert/strict');const fs=require('node:fs');const {join}=require('node:path');
const {Adb}=require('../../out/adb');const {HelperClient}=require('../../out/helperClient');
const serial=process.argv[2];if(!/^emulator-\d+$/.test(serial||''))throw new Error('Pass an emulator serial');
const executable=process.env.MOTA_TEST_ADB||join(process.env.ANDROID_SDK_ROOT||join(process.env.HOME,'Library/Android/sdk'),'platform-tools/adb');
const dist=join(__dirname,'..','dist'),sample=join(dist,'mota-recorder-tests.apk'),samplePackage='dev.mota.recorder.tests';
let step='setup';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// The provider is briefly unavailable right after install or a device-owner restart.
async function connect(adb){for(let i=0;;i++){const c=new HelperClient(adb,serial);try{await c.connect();return c;}catch(e){await c.dispose().catch(()=>{});if(i>=10)throw e;await wait(1000);}}}
async function poll(fn){const until=Date.now()+60000;for(;;){const r=await fn();if(r.state!=='pending')return r;if(Date.now()>until)throw new Error('Timed out waiting for PackageInstaller');await wait(300);}}
(async()=>{
 const adb=new Adb(()=>executable);let client=new HelperClient(adb,serial);let tests=0,owner=false,stayOn;
 try{
  await adb.run(['-s',serial,'install','--no-incremental','-r',join(dist,'mota-recorder-0.4.0.apk')]);
  await adb.run(['-s',serial,'uninstall',samplePackage]).catch(()=>{});
  stayOn=await adb.shell(serial,['settings','get','global','stay_on_while_plugged_in']);
  step='connect';await client.dispose();client=await connect(adb);
  const before=await client.request('adminStatus');assert.equal(before.deviceOwner,false);tests++;
  await assert.rejects(client.request('adminStayAwake',{enabled:true}),/not device owner/);tests++;
  const set=await adb.shell(serial,['dpm','set-device-owner','dev.mota.recorder/.DeviceOwnerReceiver']);
  assert.match(set,/Success|Active admin/,set);owner=true;
  // Becoming device owner restarts the helper process, so reconnect to the new bridge.
  step='reconnect';await client.dispose();client=await connect(adb);
  step='admin ops';const status=await client.request('status');assert.equal(status.deviceOwner,true);tests++;

  step='install';
  // Chunked silent install, using small chunks to exercise offsets.
  const bytes=fs.readFileSync(sample),chunk=8192;
  const {session}=await client.request('adminInstallBegin',{size:bytes.length,packageName:samplePackage});
  for(let o=0;o<bytes.length;o+=chunk){const w=await client.request('adminInstallWrite',{session,offset:o,data:bytes.subarray(o,o+chunk).toString('base64')});assert.equal(w.written,Math.min(o+chunk,bytes.length));}
  await client.request('adminInstallCommit',{session});
  const installed=await poll(()=>client.request('adminInstallResult',{session}));assert.equal(installed.state,'success',JSON.stringify(installed));tests++;
  assert.match(await adb.shell(serial,['pm','list','packages',samplePackage]),new RegExp(`package:${samplePackage.replace(/\./g,'\\.')}`));tests++;
  await assert.rejects(client.request('adminInstallWrite',{session:1,offset:0,data:'AA==',name:'../x.apk'}),/Invalid APK name/);tests++;

  step='permission';
  // Runtime permission grant to the installed sample, which declares READ_CONTACTS.
  const grant=await client.request('adminPermission',{packageName:samplePackage,permission:'android.permission.READ_CONTACTS',state:'granted'});
  assert.equal(grant.state,1);tests++;
  assert.match(await adb.shell(serial,['dumpsys','package',samplePackage]),/android\.permission\.READ_CONTACTS: granted=true/);tests++;
  // Rejected up front rather than hanging (Android 10 system call never returns for these).
  await assert.rejects(client.request('adminPermission',{packageName:samplePackage,permission:'android.permission.MOTA_MISSING'}),/does not exist/);tests++;
  await assert.rejects(client.request('adminPermission',{packageName:'dev.mota.missing',permission:'android.permission.READ_CONTACTS'}),/not installed/);tests++;
  await assert.rejects(client.request('adminPermission',{packageName:samplePackage,permission:'android.permission.INTERNET'}),/not a runtime permission/);tests++;
  await assert.rejects(client.request('adminPermission',{packageName:'dev.mota.recorder',permission:'x',state:'maybe'}),/State must be/);tests++;

  step='settings';const awake=await client.request('adminStayAwake',{enabled:true});assert.equal(awake.stayAwake,true);tests++;
  assert.equal(await adb.shell(serial,['settings','get','global','stay_on_while_plugged_in']),'7');tests++;
  assert.equal((await client.request('adminKeyguard',{disabled:true})).deviceOwner,true);tests++;
  assert.equal((await client.request('adminUpdatePolicy',{policy:'postpone'})).updatePolicy,'postpone');tests++;
  assert.equal((await client.request('adminUpdatePolicy',{policy:'window',startMinute:120,endMinute:240})).updatePolicy,'window');tests++;
  assert.equal((await client.request('adminUpdatePolicy',{policy:'default'})).updatePolicy,'default');tests++;

  step='uninstall';await client.request('adminUninstall',{packageName:samplePackage});
  const removed=await poll(()=>client.request('adminUninstallResult',{packageName:samplePackage}));assert.equal(removed.state,'success',JSON.stringify(removed));tests++;
  await assert.rejects(client.request('adminUninstall',{packageName:'dev.mota.recorder'}),/adminRelease/);tests++;

  step='release';await assert.rejects(client.request('adminRelease'),/confirm/);tests++;
  const released=await client.request('adminRelease',{confirm:'release'});assert.equal(released.deviceOwner,false);owner=false;tests++;
  console.log(`PASS: ${tests} device-owner checks on ${serial}`);
 }finally{
  if(owner)await client.request('adminRelease',{confirm:'release'}).catch(()=>{});
  if(stayOn!==undefined)await adb.shell(serial,['settings','put','global','stay_on_while_plugged_in',stayOn==='null'?'0':stayOn]).catch(()=>{});
  await adb.run(['-s',serial,'uninstall',samplePackage]).catch(()=>{});
  await client.dispose();
 }
})().catch(e=>{console.error(`Device-owner smoke failed at ${step}:`,e.message);process.exitCode=1;});
