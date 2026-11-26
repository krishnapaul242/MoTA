const {test} = require('node:test');
const assert = require('node:assert/strict');
const {join} = require('node:path');
const {existsSync} = require('node:fs');
const L = require('../out/loadApps');
const {MOTA_TOOL_RISK} = require('../out/ai/policy');
const {motaTools} = require('../out/ai/tools');

const DIR = join(__dirname, '..', 'resources', 'load');
const GB = 1024 * 1024;

/** A phone whose shell understands what the load-app module sends. `killed` packages die as soon as they are started. */
function phone({installed = [], killed = [], installError = '', exits = {}} = {}) {
  const p = {installed: new Set(installed), running: new Map(), calls: [], installs: [], record: '', sets: []};
  const sh = async script => {
    p.calls.push(script);
    if (script.startsWith('pm list packages')) return [...p.installed].map(x => `package:${x} versionCode:1`).join('\n');
    if (script.startsWith('date')) return '2026-11-26 16:30:00';
    if (script.startsWith('echo ') && script.includes('mota-load.json')) { p.record = /^echo '(.*)' > /s.exec(script)[1]; return ''; }
    if (script.startsWith('cat /proc/meminfo')) return 'MemTotal: 4194304 kB\nMemAvailable: 2097152 kB';
    if (script.startsWith('am start')) return 'Starting';
    const call = /^content call --uri content:\/\/(\S+)\.ctl --method (\w+)(?: --arg '(.*)')?$/s.exec(script);
    if (call) {
      const [, pkg, method, arg] = call;
      if (method === 'set') { p.sets.push([pkg, JSON.parse(arg)]); if (!killed.includes(pkg)) p.running.set(pkg, JSON.parse(arg)); }
      return `Result: Bundle[{json=${JSON.stringify({package: pkg, pid: 1, memHeldMb: p.running.get(pkg)?.memMb ?? 0, error: ''})}}]`;
    }
    const pid = /^pidof (\S+)$/.exec(script);
    if (pid) return p.running.has(pid[1]) ? '77' : '';
    const exit = /^dumpsys activity exit-info (\S+)$/.exec(script);
    if (exit) return exits[exit[1]] ?? '';
    if (script.includes('==pids') && script.includes('==mem')) {
      const names = /for p in (.*?); do/.exec(script)[1].split(' ');
      return `${p.record}\n==mem\nMemTotal: 4194304 kB\nMemAvailable: 524288 kB\n==pids\n${names.map(n => `${n}=${p.running.has(n) ? '77' : ''}=${p.running.has(n) ? (p.running.get(n).state === 'service' ? 200 : 915) : ''}`).join('\n')}`;
    }
    if (script.includes('==pids')) return p.record ? `${p.record}\n==pids\n${[...p.running.keys()].join('\n')}` : '';
    if (script.includes('pm clear')) { const n = p.running.size; p.running.clear(); p.record = ''; return Array(n).fill('running').join('\n'); }
    if (script.startsWith('rm -f')) { p.record = ''; return ''; }
    return '';
  };
  p.adb = {
    shell: (_s, args) => sh(args.join(' ')),
    run: async args => {
      if (args[2] === 'install') { if (installError) throw new Error(installError); p.installs.push(args[4]); p.installed.add(`dev.mota.load.a${/mota-load-(\d+)\.apk/.exec(args[4])[1]}`); return 'Success'; }
      return sh(args.slice(3).join(' '));
    },
    devices: async () => [{serial: 'A', model: 'Pixel 9', state: 'device'}],
  };
  return p;
}
const wait = async () => undefined;

test('the load apps are built: 12 APKs and their metadata ship in resources/load', () => {
  const meta = L.readLoadMeta(DIR);
  assert.equal(meta.count, 12);
  assert.equal(meta.packagePrefix, 'dev.mota.load.a');
  assert.deepEqual(L.loadPackages(meta, 3), ['dev.mota.load.a01', 'dev.mota.load.a02', 'dev.mota.load.a03']);
  for (let n = 1; n <= meta.count; n++) assert.ok(existsSync(join(DIR, `mota-load-${String(n).padStart(2, '0')}.apk`)), `APK ${n}`);
  assert.throws(() => L.readLoadMeta('/nowhere'), /not built/);
});

test('scenarios are sized to the phone, and options override the size and number', () => {
  const small = {totalKb: 3 * GB, availableKb: 1 * GB}, big = {totalKb: 12 * GB, availableKb: 6 * GB};
  const open = L.planScenario('open-apps', small, 12);
  assert.equal(open.length, 8);
  assert.ok(open.every(a => a.state === 'recent' && a.memMb === 128), 'about 4% of 3 GB, in 16 MB steps');
  assert.equal(L.planScenario('open-apps', big, 12)[0].memMb, 496);
  assert.deepEqual(L.planScenario('heavy-app', small, 12), [{memMb: 768, state: 'recent'}]);
  const busy = L.planScenario('busy-background', small, 12);
  assert.equal(busy.length, 3);
  assert.ok(busy.every(a => a.state === 'service' && a.respawn && a.cpuPercent === 30 && a.ioMbps === 5));
  const squeeze = L.planScenario('squeeze', small, 12, {leaveAvailableMb: 124});
  assert.equal(squeeze.length, 6);
  assert.equal(squeeze.reduce((n, a) => n + a.memMb, 0), 864, 'takes what is available minus what to leave, in 16 MB steps');
  assert.ok(squeeze.every(a => a.randomPercent === 100 && a.respawn));
  assert.equal(L.planScenario('open-apps', small, 12, {apps: 50}).length, 12, 'no more apps than exist');
  assert.equal(L.planScenario('open-apps', small, 12, {apps: 2, memoryMbEach: 300})[1].memMb, 300);
  assert.equal(L.planScenario('squeeze', {totalKb: 3 * GB, availableKb: 100 * 1024}, 12)[0].memMb, 16, 'a phone already short of memory gets the smallest load');
});

const EXIT = `ACTIVITY MANAGER PROCESS EXIT INFO (dumpsys activity exit-info)
  package: com.shop
    Historical Process Exit for uid=10204
        ApplicationExitInfo #0:
          timestamp=2026-11-26 16:32:56.703 pid=3600 realUid=10204 packageUid=10204 definingUid=10204 user=0
          process=com.shop reason=3 (LOW_MEMORY) subreason=0 (UNKNOWN) status=9
          importance=400 pss=0.00 rss=0.00 description=null state=empty trace=null
        ApplicationExitInfo #1:
          timestamp=2026-11-26 16:26:06.076 pid=4540 realUid=10198 packageUid=10198 definingUid=10198 user=0
          process=com.shop reason=10 (USER REQUESTED) subreason=21 (FORCE STOP) status=0
          importance=400 pss=0.00 rss=0.00 description=stop com.shop due to from pid 5258 state=empty trace=null`;

test('exit records are read newest first and explained in plain words', () => {
  const exits = L.parseExitInfo(EXIT);
  assert.deepEqual(exits.map(e => [e.timestamp, e.reason, e.subreason, e.description]), [
    ['2026-11-26 16:32:56', 'LOW_MEMORY', 'UNKNOWN', ''],
    ['2026-11-26 16:26:06', 'USER REQUESTED', 'FORCE STOP', 'stop com.shop due to from pid 5258'],
  ]);
  assert.equal(L.describeExit(exits[0]), 'killed by Android for low memory at 16:32:56');
  assert.equal(L.describeExit(exits[1]), 'stopped on request at 16:26:06 (force stop)');
  assert.match(L.describeExit({timestamp: '2026-11-26 10:00:00', reason: 'SIGNALED', subreason: 'UNKNOWN', description: ''}), /low-memory kill/);
  assert.equal(L.describeExit({timestamp: '2026-11-26 10:00:00', reason: 'CRASH', subreason: 'UNKNOWN', description: ''}), 'crashed at 10:00:00');
  assert.deepEqual(L.parseExitInfo('ACTIVITY MANAGER PROCESS EXIT INFO'), []);
});

test('starting installs only the missing apps, opens recent apps on screen first, and records the load on the phone', async () => {
  const p = phone({installed: ['dev.mota.load.a01']});
  let installed;
  const status = await L.startLoad(p.adb, 'A', DIR, [{memMb: 96, state: 'recent'}, {memMb: 96, state: 'recent'}, {memMb: 64, state: 'service', respawn: true}], {owner: 'claude · ~/app', scenario: 'open-apps', wait, installed: l => { installed = l; }});
  assert.deepEqual(installed, ['dev.mota.load.a02', 'dev.mota.load.a03']);
  assert.deepEqual(p.installs.map(f => f.replace(/^.*\//, '')), ['mota-load-02.apk', 'mota-load-03.apk']);
  const order = p.calls.filter(c => /^am start|--method set/.test(c)).map(c => `${/^am start/.test(c) ? 'screen' : 'set'} ${/a0\d/.exec(c)[0]}`);
  assert.deepEqual(order, ['screen a01', 'set a01', 'screen a02', 'set a02', 'set a03'], 'oldest first; a service app has no screen');
  assert.deepEqual(p.sets[2], ['dev.mota.load.a03', {memMb: 64, state: 'service', respawn: true}]);
  assert.ok(p.calls.some(c => c.includes('KEYCODE_HOME')), 'the last app opened is sent to the background too');
  assert.equal(status.record.owner, 'claude · ~/app');
  assert.equal(status.record.startedAt, '2026-11-26 16:30:00');
  assert.deepEqual(status.apps.map(a => [a.package, a.alive, a.adj]), [['dev.mota.load.a01', true, 915], ['dev.mota.load.a02', true, 915], ['dev.mota.load.a03', true, 200]]);
  assert.equal(L.describeLoad(status), [
    'open-apps: 3 of 3 load apps running, started by claude · ~/app at 16:30:00.',
    '  dev.mota.load.a01 · 96 MB · running (cached)',
    '  dev.mota.load.a02 · 96 MB · running (cached)',
    '  dev.mota.load.a03 · 64 MB, comes back · running (background work)',
    'Memory: 512 MB available of 4096 MB.',
  ].join('\n'));
  assert.deepEqual(await L.loadSummary(p.adb, 'A', L.readLoadMeta(DIR)), {text: 'load apps: 3 of 3 running by claude · ~/app', owner: 'claude · ~/app'});
});

test('a load app Android kills is reported with the reason, and so is the app under test', async () => {
  const exits = {'dev.mota.load.a01': EXIT.replace(/com\.shop/g, 'dev.mota.load.a01'), 'com.shop': EXIT};
  const p = phone({installed: ['dev.mota.load.a01', 'dev.mota.load.a02'], killed: ['dev.mota.load.a01'], exits});
  const status = await L.startLoad(p.adb, 'A', DIR, [{memMb: 96, state: 'recent'}, {memMb: 96, state: 'recent'}], {wait, scenario: 'open-apps'});
  assert.equal(status.apps[0].alive, false);
  assert.equal(status.apps[0].exit.reason, 'LOW_MEMORY');
  const watched = await L.loadStatus(p.adb, 'A', L.readLoadMeta(DIR), 'com.shop');
  assert.match(L.describeLoad(watched), /dev\.mota\.load\.a01 · 96 MB · killed by Android for low memory at 16:32:56/);
  assert.match(L.describeLoad(watched), /com\.shop: not running; killed by Android for low memory at 16:32:56\.$/);
});

test('an exit from before the load started is not blamed on it', async () => {
  const old = EXIT.replace(/16:32:56/g, '16:10:00').replace(/16:26:06/g, '16:05:00').replace(/com\.shop/g, 'dev.mota.load.a01');
  const p = phone({installed: ['dev.mota.load.a01'], killed: ['dev.mota.load.a01'], exits: {'dev.mota.load.a01': old}});
  const status = await L.startLoad(p.adb, 'A', DIR, [{memMb: 96, state: 'cached'}], {wait});
  assert.equal(status.apps[0].exit, undefined);
  assert.match(L.describeLoad(status), /a01 · 96 MB · not running/);
});

test('stopping clears every installed load app and the record, and says how many ran', async () => {
  const p = phone({installed: ['dev.mota.load.a01', 'dev.mota.load.a02']});
  const meta = L.readLoadMeta(DIR);
  await L.startLoad(p.adb, 'A', DIR, [{memMb: 96, state: 'cached'}, {memMb: 96, state: 'cached'}], {wait});
  assert.equal(await L.stopLoad(p.adb, 'A', meta), 2);
  assert.equal(p.running.size, 0);
  assert.deepEqual(await L.loadSummary(p.adb, 'A', meta), {text: '', owner: ''});
  assert.equal(L.describeLoad(await L.loadStatus(p.adb, 'A', meta)).split('\n')[0], 'No load apps are running on this phone.');
  assert.equal(await L.stopLoad(phone().adb, 'A', meta), 0);
});

test('a phone that refuses the install gets advice for its own reason', async () => {
  const fail = e => L.startLoad(phone({installError: e}).adb, 'A', DIR, [{memMb: 96, state: 'cached'}], {wait});
  await assert.rejects(fail('adb: failed to install x.apk: Failure [INSTALL_FAILED_VERIFICATION_FAILURE: Package Verification Result]'), /Could not install load app dev\.mota\.load\.a01 on A\. Play Protect blocked it/);
  await assert.rejects(fail('Failure [INSTALL_FAILED_USER_RESTRICTED: Install canceled by user]'), /Install via USB/);
  await assert.rejects(fail('Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]'), /clear_storage_fill/);
  await assert.rejects(fail('Performing Streamed Install\nadb: failed to install: Failure [SOMETHING_ELSE]'), /Failure \[SOMETHING_ELSE\]/);
  await assert.rejects(L.startLoad(phone().adb, 'A', DIR, Array(13).fill({memMb: 16, state: 'cached'}), {wait}), /There are 12 load apps/);
});

function tools(p, lease, loadAppsDir = () => DIR) {
  const define = (name, description, inputSchema, handler) => ({name, description, inputSchema, handler});
  const defs = motaTools(define, {adb: p.adb, input: {send: async () => undefined}, runner: {running: () => []}, flowsFolder: () => '/w/.maestro', workspaceRoot: () => '/w', screenshotSide: () => 960, requestPlan: async () => true, onScreenshot: () => undefined, onFlowWritten: () => undefined, lease, ...(loadAppsDir ? {loadAppsDir} : {})});
  return name => async args => (await defs.find(d => d.name === name).handler(args, {})).content.map(c => c.text).join('\n');
}
const gate = (label, held) => ({
  holder: async () => ({id: label, label, pid: 1}), check: async () => undefined, enter: async () => ({exit: async () => undefined}),
  notes: async () => '', userNote: async () => '', describe: async serials => new Map(serials.map(s => [s, 'in use by you'])),
  acquire: async () => ({status: 'none', text: ''}), release: async () => held,
});

test('load tools: list_devices shows a running load, and releasing the phone stops the session\'s own load only', async () => {
  assert.equal(MOTA_TOOL_RISK.start_load_apps, 'change');
  assert.equal(MOTA_TOOL_RISK.stop_load_apps, 'change');
  assert.equal(MOTA_TOOL_RISK.load_apps_status, 'read');
  const p = phone(), mine = tools(p, gate('claude · ~/app', ['A']));
  const started = await mine('start_load_apps')({serial: 'A', scenario: 'heavy-app'});
  assert.match(started, /^Installed 1 load app\(s\)\. heavy-app: 1 of 1 load apps running, started by claude · ~\/app/);
  assert.match(started, /dev\.mota\.load\.a01 · 1024 MB · running/, '25% of the phone\'s 4 GB');
  assert.equal(await mine('list_devices')({}), 'A · Pixel 9 · device · in use by you · load apps: 1 of 1 running by claude · ~/app');
  assert.match(await mine('load_apps_status')({serial: 'A', package: 'com.shop'}), /com\.shop: not running\.$/);

  const other = tools(p, gate('codex · ~/other', ['A']));
  assert.equal(await other('release_device')({}), 'Released A.');
  assert.equal(p.running.size, 1, 'someone else\'s load keeps running');
  assert.equal(await mine('release_device')({}), 'Released A. Stopped your load apps on A.');
  assert.equal(p.running.size, 0);
  assert.equal(await mine('stop_load_apps')({serial: 'A'}), 'No load apps were running.');
  assert.match(await tools(p, undefined, null)('start_load_apps')({serial: 'A', scenario: 'open-apps'}), /not available here/);
});
