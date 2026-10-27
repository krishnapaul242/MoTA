const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseDevices,parseServices,validAddress,escapeHtml,Adb} = require('../out/adb');
test('device discovery preserves state and serials for multiple targets', () => {
  assert.deepEqual(parseDevices('List of devices attached\nusb1 device product:x model:Pixel_8 transport_id:1\n192.168.1.3:4444 offline\nusb2 unauthorized\n'),[
    {serial:'usb1',state:'device',model:'Pixel 8'}, {serial:'192.168.1.3:4444',state:'offline',model:'192.168.1.3:4444'}, {serial:'usb2',state:'unauthorized',model:'usb2'}]);
});
test('mDNS discovery distinguishes QR pairing from connection services', () => {
  assert.deepEqual(parseServices('List of discovered mdns services\nstudio-abc _adb-tls-pairing._tcp 192.168.1.2:12345\nadb-xyz _adb-tls-connect._tcp 192.168.1.2:45678\n').map(s=>s.type),['_adb-tls-pairing._tcp','_adb-tls-connect._tcp']);
});
test('connection input validates ports and rejects command text', () => {
  for(const a of ['192.168.1.2:34567','localhost:5555','[::1]:5555']) assert.ok(validAddress(a));
  for(const a of ['host:0','host:65536','host:5555; rm','-x','host']) assert.ok(!validAddress(a));
});
test('device output cannot inject markup into a webview', () => assert.equal(escapeHtml('<script>"&\'</script>'),'&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;'));
test('ADB invocation passes each argument literally without a shell', async () => {
 const adb = new Adb(()=>process.execPath);
 assert.equal(await adb.run(['-e','process.stdout.write(process.argv[1])','a path/$(echo unsafe).apk']), 'a path/$(echo unsafe).apk');
});
test('ADB command failures expose diagnostics', async () => {
 const adb = new Adb(()=>process.execPath);
 await assert.rejects(adb.run(['-e','process.stderr.write("device offline");process.exit(1)']),/device offline/);
});
