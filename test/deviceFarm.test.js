const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseFarmInfo,connectionKind,gestureArgs,pairingQr,validPairingCode} = require('../out/deviceFarm');
test('farm info parses device details from one shell call', () => {
  const out = '@mfr\nsamsung\n@rel\n14\n@sdk\n34\n@size\nPhysical size: 1080x2400\nOverride size: 720x1600\n@bat\nCurrent Battery Service state:\n  AC powered: false\n  USB powered: true\n  level: 41\n  scale: 50\n';
  assert.deepEqual(parseFarmInfo(out),{manufacturer:'Samsung',android:'14',sdk:'34',width:720,height:1600,battery:82,charging:true});
  assert.deepEqual(parseFarmInfo(''),{manufacturer:'',android:'',sdk:'',width:null,height:null,battery:null,charging:false});
});
test('farm labels USB, Wi-Fi and emulator connections', () => {
  assert.equal(connectionKind('R58M12ABCDE'),'USB');
  assert.equal(connectionKind('192.168.1.5:41000'),'Wi-Fi');
  assert.equal(connectionKind('adb-R58M12-abc._adb-tls-connect._tcp'),'Wi-Fi');
  assert.equal(connectionKind('emulator-5554'),'Emulator');
});
test('farm gestures validate coordinates and clamp swipe duration', () => {
  assert.deepEqual(gestureArgs({type:'tap',x:10,y:20}),['input','tap','10','20']);
  assert.deepEqual(gestureArgs({type:'swipe',x:1,y:2,x2:3,y2:4,duration:9}),['input','swipe','1','2','3','4','50']);
  assert.deepEqual(gestureArgs({type:'swipe',x:1,y:2,x2:3,y2:4,duration:12000}),['input','swipe','1','2','3','4','5000']);
  for (const m of [{type:'tap',x:-1,y:0},{type:'tap',x:'1;reboot',y:0},{type:'tap',x:1.5,y:0},{type:'swipe',x:1,y:1,x2:2,y2:2},{type:'rm'}]) assert.throws(() => gestureArgs(m));
});
test('QR pairing payload matches the Android Wireless debugging format and rejects injection', () => {
  assert.equal(pairingQr('mota-ab12','123456789'),'WIFI:T:ADB;S:mota-ab12;P:123456789;;');
  assert.throws(() => pairingQr('x;P:1','123456789'));
  assert.throws(() => pairingQr('mota','12;'));
});
test('pairing codes must be exactly six digits', () => {
  assert.ok(validPairingCode('012345'));
  for (const c of ['12345','1234567','12a456',123456,'123456; rm']) assert.ok(!validPairingCode(c));
});
