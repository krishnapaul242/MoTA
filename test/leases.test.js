const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp, readFile} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {LeaseStore, leaseGate, useOf, idleSecondsFor} = require('../out/leases');
const {callerOf, parseLsofPids, UNKNOWN_AGENT} = require('../out/ai/caller');

const A = {id: 'agent:101', label: 'claude · ~/a', pid: 101};
const B = {id: 'agent:202', label: 'codex · ~/b', pid: 202};

async function store({idle = 120, perPhone = {}, dead = new Set()} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'mota-leases-'));
  let now = 1_000_000;
  const s = new LeaseStore({dir, idleSeconds: () => idle, deviceIdleSeconds: () => perPhone, now: () => now, alive: pid => !dead.has(pid)});
  return {s, dir, dead, advance: sec => { now += sec * 1000; }};
}

test('a free phone is claimed; another session is refused while it is active', async () => {
  const {s} = await store();
  assert.deepEqual(await s.claim(A, ['p1']), {ok: true});
  const r = await s.claim(B, ['p1']);
  assert.equal(r.ok, false);
  assert.match(r.reason, /p1 is in use by claude · ~\/a .*frees up after 120 s/);
  assert.deepEqual(await s.claim(A, ['p1']), {ok: true}, 'the holder keeps using it');
});

test('an idle phone is handed over at once and the old holder is told', async () => {
  const {s, advance} = await store();
  await s.claim(A, ['p1']);
  advance(121);
  assert.equal((await s.use(['p1'])).get('p1').state, 'idle');
  assert.deepEqual(await s.claim(B, ['p1']), {ok: true});
  const notes = await s.takeNotices(A.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].by, B.label);
  assert.deepEqual(await s.takeNotices(A.id), [], 'notices are shown once');
});

test('a phone running a test is busy, never idle, whoever holds it', async () => {
  const {s, advance} = await store();
  await s.claim(A, ['p1']);
  const end = await s.begin(['p1'], 'a Maestro test run (r1)');
  advance(1000);
  const use = (await s.use(['p1'])).get('p1');
  assert.equal(use.state, 'busy');
  const r = await s.claim(B, ['p1']);
  assert.match(r.reason, /p1 is busy: a Maestro test run \(r1\)/);
  assert.equal((await s.claim(A, ['p1'])).ok, false, 'even the holder can\'t act on a phone mid-test');
  await end();
  assert.deepEqual(await s.claim(B, ['p1']), {ok: true}, 'idle once the run ends');
});

test('a holder\'s own call does not block itself, but blocks others', async () => {
  const {s} = await store();
  const gateA = leaseGate(s, A), gateB = leaseGate(s, B);
  const inA = await gateA.enter(['p1'], 'run_flow');
  assert.ok('exit' in inA);
  assert.ok('exit' in await gateA.enter(['p1'], 'screenshot'));
  const inB = await gateB.enter(['p1'], 'tap');
  assert.match(inB.refused, /busy: run_flow for claude/);
  assert.match(inB.refused, /Use a free phone from list_devices/);
  await inA.exit();
});

test('claims are all or nothing', async () => {
  const {s} = await store();
  await s.claim(A, ['p2']);
  assert.equal((await s.claim(B, ['p1', 'p2'])).ok, false);
  assert.equal((await s.use(['p1'])).get('p1').state, 'free', 'p1 was not taken either');
});

test('leases of ended processes do not count', async () => {
  const {s, dead} = await store();
  await s.claim(A, ['p1']);
  await s.begin(['p2'], 'a Maestro test run', undefined, 555);
  dead.add(101); dead.add(555);
  assert.equal((await s.use(['p1'])).get('p1').state, 'free');
  assert.equal((await s.use(['p2'])).get('p2').state, 'free');
  assert.deepEqual(await s.claim(B, ['p1', 'p2']), {ok: true});
  assert.deepEqual(await s.takeNotices(A.id), [], 'no notice for a session that is gone');
});

test('parking makes a holder\'s phones idle at once; activity wakes them', async () => {
  const {s} = await store();
  await s.claim(A, ['p1']);
  await s.park(A.id);
  assert.equal((await s.use(['p1'])).get('p1').state, 'idle');
  await s.touch(A.id, ['p1']);
  assert.equal((await s.use(['p1'])).get('p1').state, 'active');
});

test('idle time: session, then phone, then global', async () => {
  const {s, advance} = await store({idle: 120, perPhone: {p1: 300}});
  const file = await s.read();
  const opts = {idleSeconds: () => 120, deviceIdleSeconds: () => ({p1: 300})};
  assert.equal(idleSecondsFor(file, 'p2', A.id, opts), 120);
  assert.equal(idleSecondsFor(file, 'p1', A.id, opts), 300);
  await s.setSessionIdle(A, 600);
  assert.equal(idleSecondsFor(await s.read(), 'p1', A.id, opts), 600);
  await s.claim(A, ['p1']);
  advance(400);
  assert.equal((await s.use(['p1'])).get('p1').state, 'active', 'the session\'s 600 s wins over the phone\'s 300 s');
  advance(201);
  assert.equal((await s.use(['p1'])).get('p1').state, 'idle');
});

test('parallel writers from several windows don\'t lose updates', async () => {
  const {s, dir} = await store();
  const other = new LeaseStore({dir, idleSeconds: () => 120, deviceIdleSeconds: () => ({}), alive: () => true});
  await Promise.all(Array.from({length: 20}, (_, i) => (i % 2 ? s : other).claim({id: `agent:${i}`, label: `s${i}`, pid: 1000 + i}, [`p${i}`])));
  const file = JSON.parse(await readFile(join(dir, 'devices.json'), 'utf8'));
  assert.equal(Object.keys(file.leases).length, 20);
});

test('describe tells the caller who uses each phone', async () => {
  const {s, advance} = await store();
  await s.claim(A, ['p1']);
  await s.claim(B, ['p2']);
  advance(130);
  await s.claim(B, ['p3']);
  const d = await leaseGate(s, B).describe(['p1', 'p2', 'p3', 'p4']);
  assert.match(d.get('p1'), /idle for 2 min, last used by claude · ~\/a; free to take/);
  assert.match(d.get('p2'), /yours, idle/);
  assert.equal(d.get('p3'), 'yours');
  assert.equal(d.get('p4'), 'free');
  const d2 = await leaseGate(s, A).describe(['p3']);
  assert.match(d2.get('p3'), /in use by codex · ~\/b \(last action 0 s ago\)/);
});

test('useOf ignores a corrupt or missing file', async () => {
  const {s} = await store();
  const file = await s.read();
  assert.equal(useOf(file, 'p1', 0, {idleSeconds: () => 120, deviceIdleSeconds: () => ({})}).state, 'free');
});

test('the caller is the process on the other end of the connection', async () => {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args].join(' '));
    if (file === 'lsof' && args.includes('-sTCP:ESTABLISHED')) return 'p928\nf31\np28974\nf17\n';
    if (file === 'ps') return '/Users/me/.local/share/claude/versions/claude\n';
    return 'p28974\nfcwd\nn/Users/me/Documents/app\n';
  };
  const holder = await callerOf(60720, run, 928, 'darwin');
  assert.equal(holder.id, 'agent:28974');
  assert.equal(holder.pid, 28974);
  assert.match(holder.label, /^claude · .*Documents\/app$/);
  assert.match(calls[0], /-iTCP:60720/);
  assert.deepEqual(parseLsofPids('p1\nf2\np1\np3\n'), [1, 3]);
  assert.equal(await callerOf(60720, async () => { throw new Error('no lsof'); }, 928, 'darwin'), UNKNOWN_AGENT);
  assert.equal(await callerOf(60720, run, 928, 'win32'), UNKNOWN_AGENT);
});
