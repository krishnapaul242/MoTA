const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {parsePs, maestroTarget, isMaestro, maestroWork, activeInstrumentations, externalWorkDetector} = require('../out/externalBusy');
const {LeaseStore, leaseGate, BusyMark} = require('../out/leases');

const A = {id: 'agent:500', label: 'claude · ~/a', pid: 500};
const B = {id: 'agent:600', label: 'codex · ~/b', pid: 600};

const PS = `
  1     0 /sbin/launchd
  500   1 claude
  600   1 codex
  510 500 /bin/zsh -c maestro --device p1 test flows/login.yaml
  511 510 /bin/bash /Users/me/.maestro/bin/maestro --device p1 test flows/login.yaml
  512 511 /usr/bin/java -classpath /Users/me/.maestro/lib/* maestro.cli.AppKt --device p1 test flows/login.yaml
  700   1 /bin/bash /Users/me/.maestro/bin/maestro --udid=p2 test smoke.yaml
  900   1 Code Helper (Plugin)
  901 900 /bin/bash /Users/me/.maestro/bin/maestro --device p3 test a.yaml
  800   1 /bin/bash /Users/me/.maestro/bin/maestro --version
`;

test('Maestro commands are found per phone, once each, with the session that started them', () => {
  const procs = parsePs(PS);
  assert.equal(procs.length, 10);
  assert.equal(maestroTarget('maestro --device=abc test x', ['p1', 'p2']), 'abc');
  assert.equal(maestroTarget('maestro test x', ['only']), 'only', 'no --device and one phone: that phone');
  assert.equal(maestroTarget('maestro test x', ['p1', 'p2']), undefined);
  assert.ok(isMaestro('/usr/bin/java -cp x maestro.cli.AppKt test a.yaml'));
  assert.ok(!isMaestro('/bin/bash /Users/me/.maestro/bin/maestro --version'));
  assert.ok(!isMaestro('vim maestro-notes.md'));
  const ops = maestroWork(procs, ['p1', 'p2', 'p3'], ['p1', 'p2', 'p3'], new Set([900]), 1000);
  assert.deepEqual(ops.map(o => [o.serial, o.pid, o.ancestors]), [['p1', 511, [510, 500, 1]], ['p2', 700, [1]]],
    'the script counts (not its Java child), p3 is MoTA\'s own run, and --version is not a test');
  assert.match(ops[0].what, /a Maestro command started outside MoTA \(process 511\)/);
});

test('active instrumentations on the phone, ignoring Maestro\'s driver', () => {
  const dump = `  Active instrumentation:
    ActiveInstrumentation{a1b2c3 ComponentInfo{com.shop.test/androidx.test.runner.AndroidJUnitRunner} sourceUid=2000}
    ActiveInstrumentation{d4e5f6 ComponentInfo{dev.mobile.maestro.test/androidx.test.runner.AndroidJUnitRunner} sourceUid=2000}
  instr=ActiveInstrumentation{a1b2c3 ComponentInfo{com.shop.test/androidx.test.runner.AndroidJUnitRunner} sourceUid=2000}`;
  assert.deepEqual(activeInstrumentations(dump), ['com.shop.test']);
  assert.deepEqual(activeInstrumentations(''), []);
});

test('the detector combines this computer and the phones', async () => {
  const adb = {
    devices: async () => [{serial: 'p1', state: 'device'}, {serial: 'p2', state: 'device'}, {serial: 'p9', state: 'offline'}],
    shell: async (s, args) => { assert.match(args.join(' '), /dumpsys activity processes \| grep ActiveInstrumentation/); return s === 'p2' ? 'ActiveInstrumentation{1 ComponentInfo{com.app.test/x.Runner}}' : ''; },
  };
  const detect = externalWorkDetector(adb, async () => PS, () => new Set([900]));
  const ops = await detect(['p1', 'p2', 'p9']);
  assert.deepEqual(ops.map(o => [o.serial, o.what.replace(/ \(process \d+\)/, '')]), [
    ['p1', 'a Maestro command started outside MoTA'], ['p2', 'a Maestro command started outside MoTA'], ['p2', 'an instrumentation test (com.app.test) started outside MoTA']]);
});

async function store(detect) {
  return new LeaseStore({dir: await mkdtemp(join(tmpdir(), 'mota-ext-')), idleSeconds: () => 120, deviceIdleSeconds: () => ({}), alive: () => true, detect});
}

test('a test started outside MoTA keeps others off the phone, but not the session that started it', async () => {
  let calls = 0;
  const s = await store(async () => { calls++; return [{id: 'ext-1', serial: 'p1', what: 'a Maestro command started outside MoTA (process 511)', pid: 511, startedAt: Date.now(), ancestors: [510, 500, 1]}]; });
  assert.deepEqual(await s.claim(A, ['p1']), {ok: true}, 'A started the command from its own terminal, so it may take the phone');
  await s.park(A.id);
  const r = await s.claim(B, ['p1']);
  assert.equal(r.ok, false, 'idle, but a test is running on it');
  assert.match(r.reason, /busy: a Maestro command started outside MoTA \(process 511\) for claude/);
  assert.deepEqual(await s.claim(A, ['p1']), {ok: true}, 'A\'s own command doesn\'t block A');
  const before = calls;
  await s.claim(A, ['p1']);
  assert.equal(calls, before, 'looked for at most every few seconds');
});

test('agents are warned, not stopped, while the user drives a phone in VS Code', async () => {
  const s = await store();
  s.noteUser('p1');
  await new Promise(r => setTimeout(r, 50));
  const gate = leaseGate(s, A);
  const entered = await gate.enter(['p1'], 'tap');
  assert.ok('exit' in entered, 'not refused');
  await entered.exit();
  assert.match(await gate.userNote(['p1', 'p2']), /the user is using p1 in VS Code right now \(last input \d+ s ago\)/);
  assert.match((await gate.describe(['p1'])).get('p1'), /the user is using it in VS Code/);
  assert.equal(await gate.userNote(['p2']), '');
});

test('a busy mark follows a page\'s state', async () => {
  const s = await store();
  const mark = new BusyMark(s);
  await mark.set('p1', 'a MoTA recording');
  assert.equal((await s.use(['p1'])).get('p1').ops[0].what, 'a MoTA recording');
  await mark.set('p1', 'a MoTA recording');
  assert.equal((await s.read()).busy.length, 1, 'setting the same state again changes nothing');
  await mark.set('p1', 'a MoTA replay');
  assert.deepEqual((await s.read()).busy.map(o => o.what), ['a MoTA replay']);
  await mark.set(undefined);
  assert.equal((await s.use(['p1'])).get('p1').state, 'free');
});
