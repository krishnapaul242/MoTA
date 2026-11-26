const {test} = require('node:test');
const assert = require('node:assert/strict');
const {join} = require('node:path');
const {readFileSync} = require('node:fs');
const C = require('../out/pressureControl');
const L = require('../out/loadApps');
const {MOTA_TOOL_RISK} = require('../out/ai/policy');
const {motaTools} = require('../out/ai/tools');
const {controlsHtml} = require('../out/webview/controlsView');
const {farmHtml} = require('../out/webview/farmView');

const DIR = join(__dirname, '..', 'resources', 'load');
const META = L.readLoadMeta(DIR);
const GB = 1024 * 1024;

/** A phone with a storage fill and load apps that can be on or off. Each running load app takes `appKb` of the available memory. */
function phone({fillKb = 0, apps = 0, owner = 'claude · ~/app', appKb = 256 * 1024, availableKb = 2 * GB, dieAfter = Infinity} = {}) {
  const p = {fillKb, running: new Set(), calls: [], record: '', started: 0};
  const names = n => L.loadPackages(META, n);
  const setRecord = list => { p.record = list.length ? JSON.stringify({owner, scenario: 'open-apps', startedAt: '2026-11-26 16:30:00', apps: list.map(x => ({package: x, memMb: 256, state: 'service'}))}) : ''; };
  for (const n of names(apps)) p.running.add(n);
  setRecord(names(apps));
  const meminfo = () => `MemTotal: ${4 * GB} kB\nMemAvailable: ${availableKb - p.running.size * appKb} kB`;
  const sh = async script => {
    p.calls.push(script);
    if (script.startsWith('df -k')) return `/dev/block/dm-3 52138076 1 ${40 * GB - p.fillKb} 11% /data\nfill=${p.fillKb ? p.fillKb * 1024 : ''}\nowner=${p.fillKb ? owner : ''}`;
    if (script.startsWith('rm -f /data/local/tmp/mota-fill')) { p.fillKb = 0; return ''; }
    if (script.startsWith('pm list packages')) return names(12).map(x => `package:${x} versionCode:${META.versionCode}`).join('\n');
    if (script.includes('pm clear')) { const n = p.running.size; p.running.clear(); p.record = ''; return Array(n).fill('running').join('\n'); }
    if (script.startsWith('date')) return '2026-11-26 16:30:00';
    if (script.startsWith('echo ') && script.includes('mota-load.json')) { p.record = /^echo '(.*)' > /s.exec(script)[1]; return ''; }
    if (script.startsWith('cat /proc/meminfo; echo ==pids')) return `${meminfo()}\n==pids\n${JSON.parse(p.record).apps.some(a => !p.running.has(a.package)) ? 'dead' : ''}`;
    if (script.startsWith('cat /proc/meminfo')) return meminfo();
    const call = /^content call --uri content:\/\/(\S+)\.ctl --method (\w+)/.exec(script);
    if (call) { if (call[2] === 'set') { p.started++; if (p.started <= dieAfter) p.running.add(call[1]); } return `Result: Bundle[{json=${JSON.stringify({pid: 1, memHeldMb: 9999, error: ''})}}]`; }
    const pid = /^pidof (\S+)$/.exec(script);
    if (pid) return p.running.has(pid[1]) ? '77' : '';
    if (script.includes('==mem')) return `${p.record}\n==mem\n${meminfo()}\n==pids\n${names(12).map(n => `${n}=${p.running.has(n) ? '77=200' : '='}`).join('\n')}`;
    if (script.includes('==pids')) return p.record ? `${p.record}\n==pids\n${[...p.running].join('\n')}` : '';
    return '';
  };
  p.adb = {shell: (_s, args) => sh(args.join(' ')), run: args => sh(args.slice(3).join(' ')), devices: async () => [{serial: 'A', model: 'Pixel 9', state: 'device'}]};
  return p;
}
const wait = async () => undefined;

test('a phone with no fill and no load apps reports no pressure', async () => {
  const state = await C.pressureState(phone().adb, 'A', META);
  assert.equal(state.active, false);
  assert.equal(state.fill, '');
  assert.equal(state.load, '');
  assert.equal(state.storage.freeKb, 40 * GB);
});

test('pressure state names the fill and the load apps, and who made them', async () => {
  const state = await C.pressureState(phone({fillKb: 39 * GB, apps: 3}).adb, 'A', META);
  assert.equal(state.active, true);
  assert.equal(state.fill, 'storage filled: 39 GB by claude · ~/app, 1.0 GB free');
  assert.equal(state.load, 'load apps: 3 of 3 running by claude · ~/app');
  assert.deepEqual([state.loadRunning, state.loadTotal, state.scenario], [3, 3, 'open-apps']);
  assert.equal((await C.pressureState(phone({fillKb: GB}).adb, 'A', undefined)).load, '', 'without bundled load apps only storage is read');
});

test('stop all removes the fill and stops every load app in one go, and says what it gave back', async () => {
  const p = phone({fillKb: 39 * GB, apps: 3});
  const stopped = await C.stopAllPressure(p.adb, 'A', META);
  assert.deepEqual(stopped, {freedKb: 39 * GB, stoppedApps: 3, errors: []});
  assert.equal(C.describeStopped(stopped), 'freed 39 GB of storage, stopped 3 load apps');
  assert.equal(p.fillKb, 0);
  assert.equal(p.running.size, 0);
  assert.equal((await C.pressureState(p.adb, 'A', META)).active, false);
  assert.equal(C.describeStopped(await C.stopAllPressure(p.adb, 'A', META)), 'no pressure was on');
  assert.equal(C.describeStopped({freedKb: 0, stoppedApps: 1, errors: []}), 'stopped 1 load app');
});

test('stop all still does the other half when one half fails, and reports the failure', async () => {
  const p = phone({fillKb: GB, apps: 2});
  const shell = p.adb.shell;
  p.adb.shell = (s, args) => args.join(' ').startsWith('df -k') ? Promise.reject(new Error('device offline\nmore')) : shell(s, args);
  const stopped = await C.stopAllPressure(p.adb, 'A', META);
  assert.equal(stopped.stoppedApps, 2);
  assert.equal(C.describeStopped(stopped), 'stopped 2 load apps, failed: device offline');
});

test('squeeze adds load apps one at a time and stops at the memory target', async () => {
  const p = phone({availableKb: 2 * GB});
  const plan = Array(8).fill({memMb: 256, state: 'service', respawn: true});
  const status = await L.startLoad(p.adb, 'A', DIR, plan, {wait, scenario: 'squeeze', untilAvailableKb: 1 * GB});
  assert.equal(status.apps.length, 4, '2 GB available, 256 MB each: the fourth app brings it to the 1 GB target');
  assert.equal(JSON.parse(p.record).apps.length, 4, 'only started apps are recorded');
});

test('squeeze stops adding as soon as Android kills a load app', async () => {
  const p = phone({availableKb: 100 * GB, dieAfter: 2});
  const status = await L.startLoad(p.adb, 'A', DIR, Array(8).fill({memMb: 256, state: 'service'}), {wait, untilAvailableKb: 0});
  assert.deepEqual(status.apps.map(a => a.alive), [true, true, false]);
});

test('agents get the same one-stop switch as a tool', async () => {
  assert.equal(MOTA_TOOL_RISK.stop_pressure, 'change');
  const p = phone({fillKb: 39 * GB, apps: 3});
  const define = (name, description, inputSchema, handler) => ({name, handler});
  const defs = motaTools(define, {adb: p.adb, input: {}, runner: {running: () => []}, flowsFolder: () => '/w', workspaceRoot: () => '/w', screenshotSide: () => 960, requestPlan: async () => true, onScreenshot() {}, onFlowWritten() {}, loadAppsDir: () => DIR});
  const out = await defs.find(d => d.name === 'stop_pressure').handler({serial: 'A'}, {});
  assert.equal(out.content[0].text, 'A: freed 39 GB of storage, stopped 3 load apps.');
});

test('the device page has the pressure banner, controls for storage and load apps, and a stop-all button', () => {
  const html = controlsHtml({serial: 'A', model: 'Pixel 9'}, 'vscode-resource:');
  for (const id of ['pressBanner', 'pressBannerText', 'pressCard', 'pressSummary', 'pressStorage', 'pressLeave', 'pressClear', 'pressLoad', 'pressScenario', 'pressStopLoad', 'pressDetail']) assert.ok(html.includes(`id="${id}"`), id);
  for (const action of ['fill', 'clear', 'load', 'stop-load', 'stop-all', 'refresh']) assert.ok(html.includes(`data-press="${action}"`), action);
  for (const s of L.SCENARIOS) assert.ok(html.includes(`<option value="${s}">`), s);
  assert.equal(html.match(/data-press="stop-all"/g).length, 2, 'in the banner and in the card');
});

test('the farm page shows pressure on cards and a bar that stops it everywhere', () => {
  const html = farmHtml('vscode-resource:');
  assert.ok(html.includes('id="pressBar"') && html.includes('data-top="stop-pressure"'));
  assert.ok(html.includes('pressChip(d)'));
  assert.ok(html.includes("action:'stop-pressure'"));
});

test('Stop All Pressure is a command in the palette', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.contributes.commands.find(c => c.command === 'mota.stopPressure').title, 'MoTA: Stop All Pressure (Free Storage and Memory)');
});
