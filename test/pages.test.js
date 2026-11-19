const {test} = require('node:test');
const assert = require('node:assert/strict');
const {installPlan, fixesFor} = require('../out/installPage');
const {metricFlags, monitorCsv} = require('../out/monitorPage');
const {parseBadging} = require('../out/apk');

test('install plan explains what will happen on each device', () => {
  const apk = {package: 'com.example.shop', versionName: '2.5.0', versionCode: 250, minSdk: 26, abis: [], debuggable: true};
  const opts = {downgrade: false};
  assert.equal(installPlan(apk, {installed: null, sdk: 34}, 'update', opts).text, 'Fresh install');
  assert.equal(installPlan(apk, {installed: {version: '2.4.1 (241)', code: 241}, sdk: 34}, 'update', opts).text, 'Update 2.4.1 (241) → 2.5.0 (250)');
  const older = installPlan(apk, {installed: {version: '3.0 (300)', code: 300}, sdk: 34}, 'update', opts);
  assert.ok(older.warn && /Allow downgrade/.test(older.text));
  assert.match(installPlan(apk, {installed: {version: '3.0 (300)', code: 300}, sdk: 34}, 'update', {downgrade: true}).text, /^Downgrade/);
  assert.match(installPlan(apk, {installed: null, sdk: 23}, 'update', opts).text, /Needs Android API 26\+/);
  assert.ok(installPlan(apk, {installed: null, sdk: 34}, 'clean', opts).warn);
  assert.equal(installPlan(undefined, {installed: undefined}, 'update', opts).text, 'Install');
});

test('install errors map to the one-click fixes that can resolve them', () => {
  assert.deepEqual(fixesFor('INSTALL_FAILED_ALREADY_EXISTS'), ['replace', 'clean']);
  assert.deepEqual(fixesFor('INSTALL_FAILED_VERSION_DOWNGRADE'), ['downgrade', 'clean']);
  assert.deepEqual(fixesFor('INSTALL_FAILED_TEST_ONLY'), ['test']);
  assert.deepEqual(fixesFor('INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match'), ['clean']);
  assert.deepEqual(fixesFor('INSTALL_FAILED_INSUFFICIENT_STORAGE'), []);
});

test('monitor flags high CPU, memory, jank, heat and low battery only past their thresholds', () => {
  const base = {battery: 50, temperature: 30, charging: false, memory: 50, usedGb: 1, totalGb: 2, cpu: 20, appMb: 100, frames: 10, jank: 1};
  assert.deepEqual(metricFlags(base), {});
  assert.deepEqual(metricFlags({...base, cpu: 85, memory: 95, jank: 12, temperature: 44, battery: 15}), {cpu: 'High', memory: 'High', jank: 'Janky', temperature: 'Hot', battery: 'Low'});
  assert.deepEqual(metricFlags({...base, battery: 15, charging: true}), {});
});

test('monitor CSV has a header, one row per sample and quotes awkward names', () => {
  const csv = monitorCsv([{model: 'Pixel "8", Pro', serial: 'x', samples: [{time: 0, metrics: {cpu: 12.5, memory: 40, battery: 80, charging: true}}]}]);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'time,device,serial,cpu,memory,usedGb,totalGb,appMb,frames,jank,battery,charging,temperature');
  assert.equal(lines[1], '1970-01-01T00:00:00.000Z,"Pixel ""8"", Pro",x,12.5,40,,,,,,80,true,');
});

test('APK badging gives package, version, label, SDK levels and ABIs', () => {
  const out = "package: name='com.example.shop' versionCode='250' versionName='2.5.0' platformBuildVersionName='15'\nsdkVersion:'26'\ntargetSdkVersion:'35'\napplication-label:'Example Shop'\napplication-debuggable\nnative-code: 'arm64-v8a' 'armeabi-v7a'\n";
  assert.deepEqual(parseBadging(out), {package: 'com.example.shop', versionName: '2.5.0', versionCode: 250, label: 'Example Shop', minSdk: 26, targetSdk: 35, abis: ['arm64-v8a', 'armeabi-v7a'], debuggable: true});
  assert.equal(parseBadging('garbage').package, undefined);
});
