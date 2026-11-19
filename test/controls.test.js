const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {parseLs, parsePackageDump, summarizeDiagnostics} = require('../out/devicePage');
const {controlsHtml} = require('../out/webview/controlsView');

test('folder listings keep folders first, follow links and skip . and ..', () => {
  const out = [
    'total 48',
    'drwxrwx--x  4 root sdcard_rw 3488 2026-11-19 10:00 .',
    'drwxrwx--x 40 root sdcard_rw 3488 2026-11-19 10:00 ..',
    '-rw-rw----  1 root sdcard_rw 18000 2026-11-18 09:00 fixtures.json',
    'drwxrwx--x  2 root sdcard_rw 3488 2026-11-19 10:00 Screenshots',
    'lrw-r--r--  1 root root        21 2009-01-01 05:30 sdcard -> /storage/self/primary',
    '-rw-rw----  1 root sdcard_rw   12 2026-11-18 09:01 my notes.txt',
  ].join('\n');
  assert.deepEqual(parseLs(out).map(e => [e.name, e.dir]), [['Screenshots', true], ['sdcard', true], ['fixtures.json', false], ['my notes.txt', false]]);
  assert.equal(parseLs(out).find(e => e.name === 'fixtures.json').size, 18000);
});

test('package dumps give version, dates, SDK levels and running state; missing apps give null', () => {
  const dump = 'Packages:\n  Package [com.example.shop] (abc):\n    versionCode=241 minSdk=26 targetSdk=35\n    versionName=2.4.1\n    pkgFlags=[ HAS_CODE DEBUGGABLE ALLOW_CLEAR_USER_DATA ]\n    firstInstallTime=2026-11-17 10:02:11\n    lastUpdateTime=2026-11-19 10:42:03\n';
  assert.deepEqual(parsePackageDump(dump, '12873\n'), {version: '2.4.1 (241)', installed: '2026-11-17 10:02:11', updated: '2026-11-19 10:42:03', targetSdk: '35', minSdk: '26', debuggable: true, pid: '12873'});
  assert.equal(parsePackageDump('Unable to find package: x'), null);
});

test('diagnostics summarise memory, storage, density and temperature', () => {
  const info = {manufacturer: 'HMD', android: '12', sdk: '31', width: 720, height: 1560, battery: 98, charging: true, managed: false};
  const more = '@mem\nMemTotal:        3774372 kB\nMemFree:          151020 kB\nMemAvailable:     905628 kB\n@df\n/dev/block/dm-6   47G   38G  8.9G  82% /data\n@build\n00WW_3_460_SP06\n@patch\n2023-12-01\n@abi\narm64-v8a\n@dens\nPhysical density: 280\n@temp\n  temperature: 340\n';
  const d = summarizeDiagnostics(info, more);
  assert.equal(d.memTotal, '3.6'); assert.equal(d.memPct, 76); assert.equal(d.storageFree, '8.9G'); assert.equal(d.storageTotal, '47G');
  assert.equal(d.density, '280'); assert.equal(d.temperature, 34); assert.equal(d.build, '00WW_3_460_SP06');
});

test('controls page escapes the device name in markup and script', () => {
  const html = controlsHtml({serial: 'x</script><b>', model: 'Phone </script><img src=x onerror=alert(1)>'}, '');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!/const DEVICE=[^;]*<\/script>/.test(html));
  for (const [, script] of html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)) new vm.Script(script);
});
