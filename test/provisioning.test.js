const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const {join} = require('node:path');
const {provisioningPayload, lanAddresses, HelperDownloadServer, parseDeviceOwner, readHelperMetadata, OWNER_COMPONENT} = require('../out/provisioning');
const {HELPER_VERSION} = require('../out/helperClient');

const E = 'android.app.extra.';
const checksum = 'qsrlR7TTtOGYX7kqe43J9-9y5y8DXmMSvLJot-5vB7A';

test('provisioning payload pins the helper certificate and keeps system apps', () => {
  const p = JSON.parse(provisioningPayload('http://192.168.1.5:5000/abc/mota-recorder.apk', checksum));
  assert.equal(p[E + 'PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME'], OWNER_COMPONENT);
  assert.equal(p[E + 'PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'], 'http://192.168.1.5:5000/abc/mota-recorder.apk');
  assert.equal(p[E + 'PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM'], checksum);
  assert.equal(p[E + 'PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED'], true);
  assert.equal(Object.keys(p).some(k => k.includes('WIFI')), false);
});

test('provisioning payload adds Wi-Fi only when asked and validates it', () => {
  const wpa = JSON.parse(provisioningPayload('http://h:1/a/b.apk', checksum, {ssid: 'Lab "5G"', password: 'p@ss;word'}));
  assert.equal(wpa[E + 'PROVISIONING_WIFI_SSID'], 'Lab "5G"');
  assert.equal(wpa[E + 'PROVISIONING_WIFI_SECURITY_TYPE'], 'WPA');
  assert.equal(wpa[E + 'PROVISIONING_WIFI_PASSWORD'], 'p@ss;word');
  const open = JSON.parse(provisioningPayload('http://h:1/a/b.apk', checksum, {ssid: 'Guest'}));
  assert.equal(open[E + 'PROVISIONING_WIFI_SECURITY_TYPE'], 'NONE');
  assert.equal(E + 'PROVISIONING_WIFI_PASSWORD' in open, false);
  assert.throws(() => provisioningPayload('http://h:1/a/b.apk', checksum, {ssid: ''}));
  assert.throws(() => provisioningPayload('http://h:1/a/b.apk', checksum, {ssid: 'x', password: 'short'}));
  assert.throws(() => provisioningPayload('ftp://h/a.apk', checksum));
  assert.throws(() => provisioningPayload('http://h:1/a/b.apk', 'not-a-checksum'));
});

test('LAN addresses skip loopback, link-local and IPv6, private ranges first', () => {
  const list = lanAddresses({
    lo0: [{address: '127.0.0.1', family: 'IPv4', internal: true}],
    utun: [{address: '100.64.0.2', family: 'IPv4', internal: false}],
    en0: [{address: 'fe80::1', family: 'IPv6', internal: false}, {address: '192.168.1.23', family: 'IPv4', internal: false}],
    en5: [{address: '169.254.3.4', family: 'IPv4', internal: false}],
  });
  assert.deepEqual(list, [{name: 'en0', address: '192.168.1.23'}, {name: 'utun', address: '100.64.0.2'}]);
});

function get(url, method = 'GET') {
  return new Promise((resolve, reject) => http.request(url, {method}, res => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks)}));
  }).on('error', reject).end());
}

test('download server serves only the APK at its secret path, then closes', async () => {
  const apk = join(__dirname, '..', 'resources', 'mota-recorder.apk');
  const downloads = [], closes = [];
  let downloaded;
  const firstDownload = new Promise(r => { downloaded = r; });
  const server = new HelperDownloadServer(apk, '127.0.0.1', from => { downloads.push(from); downloaded(); }, reason => closes.push(reason));
  try {
  const url = await server.url;
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/mota-recorder\.apk$/);
  const ok = await get(url);
  assert.equal(ok.status, 200);
  assert.equal(ok.type, 'application/vnd.android.package-archive');
  assert.deepEqual(ok.body, fs.readFileSync(apk));
  // The server reports a download on its response's 'finish', which can come after the client has the body.
  await firstDownload;
  assert.deepEqual(downloads, ['127.0.0.1']);
  const origin = new URL(url).origin;
  assert.equal((await get(origin + '/')).status, 404);
  assert.equal((await get(origin + '/mota-recorder.apk')).status, 404);
  assert.equal((await get(url, 'POST')).status, 405);
  assert.equal((await get(url, 'HEAD')).status, 200);
  assert.equal(downloads.length, 1, 'HEAD is not a download');
  server.close('stopped'); server.close('again');
  assert.deepEqual(closes, ['stopped']);
  await assert.rejects(get(url));
  } finally { server.close('cleanup'); }
});

test('download server expires on its own', async () => {
  const closes = [];
  const server = new HelperDownloadServer(join(__dirname, '..', 'resources', 'mota-recorder.apk'), '127.0.0.1', () => {}, r => closes.push(r), 50);
  await server.url;
  await new Promise(r => setTimeout(r, 120));
  assert.deepEqual(closes, ['expired']);
});

test('bundled helper metadata matches the APK and extension version', () => {
  const meta = readHelperMetadata(join(__dirname, '..', 'resources', 'mota-recorder.json'));
  assert.equal(meta.version, HELPER_VERSION);
  assert.equal(createHash('sha256').update(fs.readFileSync(join(__dirname, '..', 'resources', 'mota-recorder.apk'))).digest('hex'), meta.sha256);
});

test('device owner is read from dumpsys device_policy on old and new Android', () => {
  const android10 = 'Current Device Policy Manager state:\n  Device Owner: \n    admin=ComponentInfo{dev.mota.recorder/dev.mota.recorder.DeviceOwnerReceiver}\n    name=\n    package=dev.mota.recorder\n';
  assert.equal(parseDeviceOwner(android10), 'dev.mota.recorder');
  assert.equal(parseDeviceOwner('  Device Owner:\n    admin=ComponentInfo{com.example.dpc/.Admin}\n'), 'com.example.dpc');
  assert.equal(parseDeviceOwner('  Profile Owner (User 10):\n    admin=ComponentInfo{dev.mota.recorder/x.Y}\n'), undefined);
  assert.equal(parseDeviceOwner(''), undefined);
});
