const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseMetrics,installArgs,recoveryHint} = require('../out/metrics');
test('monitor converts Android units and preserves zero values',()=>{
 const m=parseMetrics('level: 0\nscale: 100\ntemperature: 315\nUSB powered: true','MemTotal: 8388608 kB\nMemAvailable: 2097152 kB','0% TOTAL: 0% user','TOTAL PSS: 131,072','Total frames rendered: 100\nJanky frames: 7 (7.00%)');
 assert.deepEqual(m,{battery:0,temperature:31.5,charging:true,memory:75,usedGb:6,totalGb:8,cpu:0,appMb:128,frames:100,jank:7});
});
test('missing and inaccessible metrics remain unavailable rather than zero',()=>{
 const m=parseMetrics('Permission denied','','','No process found','');
 for(const k of ['battery','temperature','memory','usedGb','totalGb','cpu','appMb','frames','jank']) assert.equal(m[k],null);
});
test('older meminfo TOTAL layout is supported',()=>assert.equal(parseMetrics('','','',' TOTAL 20480 1000 40').appMb,20));
test('install flags are explicit and paths remain literal',()=>{
 assert.deepEqual(installArgs('device:123','/an apk/file.apk',{replace:true,test:true,downgrade:true,grant:true,user:'current',timeout:180}),['-s','device:123','install','-r','-t','-d','-g','--user','current','/an apk/file.apk']);
 assert.deepEqual(installArgs('usb','app.apk',{replace:false,test:false,downgrade:false,grant:false,user:'',timeout:10}),['-s','usb','install','app.apk']);
});
test('install options reject malformed users and unbounded timeouts',()=>{
 const base={replace:true,test:false,downgrade:false,grant:false,user:'',timeout:180};
 for(const user of ['--foo','0;rm','-1']) assert.throws(()=>installArgs('s','a',{...base,user}));
 for(const timeout of [NaN,Infinity,0,601]) assert.throws(()=>installArgs('s','a',{...base,timeout}));
});
test('recovery guidance matches actionable installation failures',()=>{
 assert.match(recoveryHint('INSTALL_FAILED_TEST_ONLY'),/Allow test APK/);
 assert.match(recoveryHint('INSTALL_FAILED_VERSION_DOWNGRADE'),/Allow downgrade/);
 assert.match(recoveryHint('INSTALL_FAILED_UPDATE_INCOMPATIBLE'),/signing key/);
 assert.match(recoveryHint('device offline'),/reconnect/);
});
