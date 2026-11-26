const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseDf, formatKb, describeFill, storageState, fillStorage, clearStorageFill, trimMemory, killInBackground, FILL_PATH} = require('../out/pressure');
const {MOTA_TOOL_RISK} = require('../out/ai/policy');
const {motaTools} = require('../out/ai/tools');

/** A phone with `diskKb` of free storage whose shell understands the commands the pressure module sends. */
function phone({diskKb = 40 * 1024 * 1024, fallocate = true, running = ['com.example.app'], killable = true, trimError = ''} = {}) {
  const p = {fillKb: 0, owner: '', calls: [], running: new Set(running), launched: 0};
  const sh = async (script) => {
    p.calls.push(script);
    if (script.startsWith('df -k')) return `Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-3 52138076 1 ${diskKb - p.fillKb} 11% /data/user/0\nfill=${p.fillKb ? p.fillKb * 1024 : ''}\nowner=${p.owner}`;
    const alloc = /fallocate -l (\d+)/.exec(script);
    if (alloc) { p.fillKb = fallocate ? Math.min(diskKb, +alloc[1] / 1024) : 0; p.owner = /echo '(.*)' > /.exec(script)[1]; return ''; }
    const dd = /dd if=\/dev\/zero bs=1048576 count=(\d+) >>/.exec(script);
    if (dd) { p.fillKb = Math.min(diskKb, p.fillKb + +dd[1] * 1024); return ''; }
    if (script.startsWith('rm -f')) { p.fillKb = 0; p.owner = ''; return ''; }
    const pid = /^pidof (\S+)/.exec(script);
    if (pid) return p.running.has(pid[1]) ? '4242' : '';
    const kill = /^am kill (\S+)/.exec(script);
    if (kill) { if (killable) p.running.delete(kill[1]); return ''; }
    if (script.startsWith('am send-trim-memory')) { if (trimError) throw new Error(`Exception occurred while executing 'send-trim-memory':\njava.lang.IllegalArgumentException: ${trimError}\n\tat com.android.server.am.ActivityManagerService`); return ''; }
    if (script.includes('resolve-activity')) return 'com.example.app/.Main';
    if (script.startsWith('am start')) { p.launched++; p.running.add('com.example.app'); return 'Status: ok'; }
    return '';
  };
  p.adb = {shell: (_s, args) => sh(args.join(' ')), run: (args) => sh(args.slice(3).join(' '))};
  return p;
}
const GB = 1024 * 1024;

test('df output is read on old and new Android, and sizes are shown in MB or GB', () => {
  assert.deepEqual(parseDf('Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/mmcblk0p87  52942792 49567796   3271684  94% /data'), {totalKb: 52942792, freeKb: 3271684});
  assert.equal(parseDf('df: /data: Permission denied'), undefined);
  assert.equal(formatKb(511964), '500 MB');
  assert.equal(formatKb(3.2 * GB), '3.2 GB');
  assert.equal(formatKb(44 * GB), '44 GB');
  assert.equal(describeFill({totalKb: 1, freeKb: 204800, fillKb: 0}), '');
  assert.equal(describeFill({totalKb: 1, freeKb: 204800, fillKb: 3.2 * GB, owner: 'claude · app'}), 'storage filled: 3.2 GB by claude · app, 200 MB free');
});

test('filling leaves the asked free space, records who did it, and clearing gives it all back', async () => {
  const p = phone();
  const {before, after} = await fillStorage(p.adb, 'A', 500, 'claude · ~/app');
  assert.equal(before.fillKb, 0);
  assert.equal(after.freeKb, 500 * 1024);
  assert.equal(after.owner, 'claude · ~/app');
  assert.ok(p.calls.some(c => c.includes(`fallocate -l ${(40 * GB - 500 * 1024) * 1024} ${FILL_PATH}`)));
  assert.ok(!p.calls.some(c => c.includes('dd ')), 'fallocate was enough');
  const cleared = await clearStorageFill(p.adb, 'A');
  assert.equal(cleared.freedKb, 40 * GB - 500 * 1024);
  assert.equal((await storageState(p.adb, 'A')).freeKb, 40 * GB);
  assert.equal((await clearStorageFill(p.adb, 'A')).freedKb, 0);
});

test('a second fill replaces the first instead of adding to it', async () => {
  const p = phone();
  await fillStorage(p.adb, 'A', 500);
  const {before, after} = await fillStorage(p.adb, 'A', 2000);
  assert.equal(before.freeKb, 500 * 1024);
  assert.equal(after.freeKb, 2000 * 1024);
  assert.equal((await fillStorage(p.adb, 'A', 0)).after.freeKb, 0);
});

test('zeros are written when the phone refuses fallocate', async () => {
  const p = phone({fallocate: false, diskKb: 2 * GB});
  const {after} = await fillStorage(p.adb, 'A', 200);
  assert.equal(after.freeKb, 200 * 1024);
  assert.ok(p.calls.some(c => c.includes('dd if=/dev/zero')));
});

test('a phone already below the target is not filled, and an earlier fill is removed', async () => {
  const p = phone({diskKb: 300 * 1024});
  await assert.rejects(fillStorage(p.adb, 'A', 500), /only 300 MB free, which is already at or below 500 MB\. Nothing to fill/);
  await fillStorage(p.adb, 'A', 100);
  await assert.rejects(fillStorage(p.adb, 'A', 500), /Removed the earlier fill/);
  assert.equal(p.fillKb, 0);
  await assert.rejects(fillStorage(p.adb, 'A', -1), /whole number/);
  await assert.rejects(fillStorage(p.adb, 'A', 1.5), /whole number/);
});

test('a memory signal needs a running app and explains Android\'s refusals', async () => {
  assert.equal(await trimMemory(phone().adb, 'A', 'com.example.app', 'RUNNING_CRITICAL'), 'Sent RUNNING_CRITICAL to com.example.app.');
  await assert.rejects(trimMemory(phone({running: []}).adb, 'A', 'com.example.app', 'RUNNING_LOW'), /not running/);
  await assert.rejects(trimMemory(phone().adb, 'A', 'com.example.app; reboot', 'RUNNING_LOW'), /valid app package/);
  await assert.rejects(trimMemory(phone().adb, 'A', 'com.example.app', 'NOPE'), /Use one of/);
  await assert.rejects(trimMemory(phone({trimError: 'Unable to set a background trim level on a foreground process'}).adb, 'A', 'com.example.app', 'COMPLETE'), /in use on screen\. Use a RUNNING_ level/);
  await assert.rejects(trimMemory(phone({trimError: 'Unable to set a higher trim level than current level'}).adb, 'A', 'com.example.app', 'MODERATE'), /already got a stronger memory signal/);
  await assert.rejects(trimMemory(phone({trimError: 'Something new'}).adb, 'A', 'com.example.app', 'MODERATE'), /^Error: Something new$/);
});

test('a background kill presses Home, waits for the app to save, kills it and reopens it', async () => {
  const p = phone(), waits = [];
  const wait = async ms => { waits.push(ms); };
  assert.match(await killInBackground(p.adb, 'A', 'com.example.app', true, wait), /killed in the background and reopened/);
  const home = p.calls.findIndex(c => c.includes('KEYCODE_HOME')), kill = p.calls.findIndex(c => c.startsWith('am kill'));
  assert.ok(home >= 0 && home < kill, 'Home comes before the kill');
  assert.equal(waits[0], 1500);
  assert.equal(p.launched, 1);
  assert.ok(!p.calls.some(c => c.includes('force-stop')), 'a force stop would drop the saved state');

  const q = phone();
  assert.match(await killInBackground(q.adb, 'A', 'com.example.app', false, wait), /Reopen it/);
  assert.equal(q.launched, 0);
  assert.ok(!q.running.has('com.example.app'));
});

test('a background kill says so when the app is not running or Android keeps it alive', async () => {
  const wait = async () => undefined;
  const off = phone({running: []});
  await assert.rejects(killInBackground(off.adb, 'A', 'com.example.app', true, wait), /not running/);
  assert.ok(!off.calls.some(c => c.includes('KEYCODE_HOME')), 'the screen is left alone');
  const kept = phone({killable: false});
  await assert.rejects(killInBackground(kept.adb, 'A', 'com.example.app', true, wait), /kept com\.example\.app alive/);
  assert.equal(kept.launched, 0);
});

test('pressure tools: filling storage is a change, memory signals are input, and nothing counts as data loss', () => {
  assert.equal(MOTA_TOOL_RISK.fill_storage, 'change');
  assert.equal(MOTA_TOOL_RISK.clear_storage_fill, 'change');
  assert.equal(MOTA_TOOL_RISK.trim_memory, 'input');
  assert.equal(MOTA_TOOL_RISK.kill_background_app, 'input');
});

/** MoTA's tools over a fake phone, as plain handlers by name. */
function tools(p, lease) {
  const define = (name, description, inputSchema, handler) => ({name, description, inputSchema, handler});
  const adb = {...p.adb, devices: async () => [{serial: 'A', model: 'Pixel 9', state: 'device'}, {serial: 'B', model: 'Pixel 8', state: 'offline'}]};
  const defs = motaTools(define, {adb, input: {send: async () => undefined}, runner: {running: () => []}, flowsFolder: () => '/w/.maestro', workspaceRoot: () => '/w', screenshotSide: () => 960, requestPlan: async () => true, onScreenshot: () => undefined, onFlowWritten: () => undefined, lease});
  return name => async args => (await defs.find(d => d.name === name).handler(args, {})).content.map(c => c.text).join('\n');
}
const gate = (label, held) => ({
  holder: async () => ({id: label, label, pid: 1}), check: async () => undefined, enter: async () => ({exit: async () => undefined}),
  notes: async () => '', userNote: async () => '', describe: async serials => new Map(serials.map(s => [s, 'in use by you'])),
  acquire: async () => ({status: 'none', text: ''}), release: async () => held,
});

test('list_devices shows a storage fill and who made it, so a full phone is no surprise', async () => {
  const p = phone(), call = tools(p, gate('claude · ~/app', ['A']));
  assert.match(await call('fill_storage')({serial: 'A', leaveFreeMb: 200}), /A now has 200 MB free \(was 40 GB without a fill\); the fill is 40 GB/);
  assert.equal(await call('list_devices')({}), 'A · Pixel 9 · device · in use by you · storage filled: 40 GB by claude · ~/app, 200 MB free\nB · Pixel 8 · offline · in use by you');
  assert.match(await call('clear_storage_fill')({serial: 'A'}), /Removed the 40 GB fill\. A has 40 GB free/);
  assert.equal(await call('list_devices')({}), 'A · Pixel 9 · device · in use by you\nB · Pixel 8 · offline · in use by you');
});

test('releasing a phone removes the fill the session made, but not another session\'s', async () => {
  const p = phone(), mine = tools(p, gate('claude · ~/app', ['A']));
  await mine('fill_storage')({serial: 'A', leaveFreeMb: 200});
  assert.equal(await mine('release_device')({}), 'Released A. Removed your storage fill on A.');
  assert.equal(p.fillKb, 0);

  await mine('fill_storage')({serial: 'A', leaveFreeMb: 200});
  const other = tools(p, gate('codex · ~/other', ['A']));
  assert.equal(await other('release_device')({}), 'Released A.');
  assert.ok(p.fillKb > 0, 'someone else\'s fill stays');
});
