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
  assert.match(inB.refused, /call acquire_device with this serial and mode "wait".*or use a free phone from list_devices/);
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

// Phase 2: waiting in line, takeovers, release.
const C = {id: 'agent:303', label: 'cursor · ~/c', pid: 303};
async function live(extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'mota-leases2-'));
  return new LeaseStore({dir, idleSeconds: () => 120, deviceIdleSeconds: () => ({}), alive: () => true, waitMs: 120, pollMs: 10, takeoverMs: 200, ...extra});
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };

test('waiting in line: refused while in use, granted once the holder goes idle, and the old holder is next in line', async () => {
  const s = await live();
  await s.claim(A, ['p1']);
  const b = leaseGate(s, B);
  const first = await b.acquire({serial: 'p1', candidates: ['p1'], mode: 'wait'});
  assert.equal(first.status, 'waiting');
  assert.match(first.text, /number 1 in line.*your place is kept/s);
  await s.park(A.id);
  const second = await b.acquire({serial: 'p1', candidates: ['p1'], mode: 'wait'});
  assert.equal(second.status, 'granted');
  assert.match(await leaseGate(s, A).notes(), /handed to codex.*first in line to get it back/);
  const use = (await s.use(['p1'])).get('p1');
  assert.deepEqual(use.queue.map(e => e.holder.id), [A.id], 'A was put back in line');
});

test('a free phone is kept for the first in line; others are refused until that turn passes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mota-leases3-'));
  let now = 5_000_000;
  const s = new LeaseStore({dir, idleSeconds: () => 120, deviceIdleSeconds: () => ({}), alive: () => true, now: () => now});
  await s.claim(A, ['p1']);
  assert.equal(await s.join(B, 'p1'), 1);
  await s.release(A.id);
  const refused = await s.claim(C, ['p1']);
  assert.match(refused.reason, /kept for codex · ~\/b, first in line/);
  now += 121_000;
  assert.deepEqual(await s.claim(C, ['p1']), {ok: true}, 'B did not come for it in time');
  assert.equal((await s.use(['p1'])).get('p1').queue.length, 0);
});

test('takeover: the user hands the phone over; the holder is told, put first in line, and its test stops', async () => {
  const asked = [], cancelled = [];
  const answer = deferred();
  const s = await live({takeoverMs: 5000, prompt: async p => { asked.push(p); return answer.promise; }, cancelWork: serial => cancelled.push(serial)});
  await s.claim(A, ['p1']);
  const pending = leaseGate(s, B).acquire({serial: 'p1', candidates: ['p1'], mode: 'takeover'});
  await new Promise(r => setTimeout(r, 30));
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0], {serial: 'p1', requester: B.label, holder: A.label});
  answer.resolve('allow');
  const r = await pending;
  assert.equal(r.status, 'granted');
  assert.match(r.text, /the user agreed/);
  assert.deepEqual(cancelled, ['p1']);
  assert.match(await leaseGate(s, A).notes(), /the user handed p1 to codex/);
  assert.deepEqual((await s.use(['p1'])).get('p1').queue.map(e => e.holder.id), [A.id]);
});

test('takeover: the user says no', async () => {
  const s = await live({takeoverMs: 5000, prompt: async () => 'decline'});
  await s.claim(A, ['p1']);
  const r = await leaseGate(s, B).acquire({serial: 'p1', candidates: ['p1'], mode: 'takeover'});
  assert.equal(r.status, 'declined');
  assert.match(r.text, /the user said no.*mode "wait"/s);
  assert.equal((await s.use(['p1'])).get('p1').holder.id, A.id);
});

test('takeover without an answer: kept while still in use when time runs out', async () => {
  const s = await live({waitMs: 1000, takeoverMs: 150, prompt: () => new Promise(() => {})});
  await s.claim(A, ['p1']);
  const r = await leaseGate(s, B).acquire({serial: 'p1', candidates: ['p1'], mode: 'takeover'});
  assert.equal(r.status, 'declined');
  assert.match(r.text, /nobody answered within 0 s and p1 was still in use|still in use/);
});

test('takeover without an answer: handed over as soon as the phone is idle; a late click only says how it went', async () => {
  const late = deferred();
  let decided;
  const s = await live({waitMs: 2000, takeoverMs: 5000, prompt: async (p, d) => { decided = d; return late.promise; }});
  await s.claim(A, ['p1']);
  const pending = leaseGate(s, B).acquire({serial: 'p1', candidates: ['p1'], mode: 'takeover'});
  await new Promise(r => setTimeout(r, 40));
  await s.park(A.id);
  const r = await pending;
  assert.equal(r.status, 'granted');
  assert.match(r.text, /p1 became idle/);
  assert.match(decided(), /handed to codex/);
});

test('a takeover still pending when the call returns is answered on the next call', async () => {
  const answer = deferred();
  const s = await live({waitMs: 50, takeoverMs: 5000, prompt: () => answer.promise});
  await s.claim(A, ['p1']);
  const b = leaseGate(s, B);
  const first = await b.acquire({serial: 'p1', candidates: ['p1'], mode: 'takeover'});
  assert.equal(first.status, 'asking');
  assert.match(first.text, /no answer yet.*call acquire_device again/is);
  answer.resolve('allow');
  await new Promise(r => setTimeout(r, 40));
  const second = await b.acquire({serial: 'p1', candidates: ['p1'], mode: 'takeover'});
  assert.equal(second.status, 'granted');
});

test('without a serial, the first free phone is taken; with none free, holders are listed', async () => {
  const s = await live();
  await s.claim(A, ['p1']);
  const b = leaseGate(s, B);
  const r = await b.acquire({candidates: ['p1', 'p2'], mode: 'wait'});
  assert.equal(r.status, 'granted');
  assert.equal(r.serial, 'p2');
  const none = await leaseGate(s, C).acquire({candidates: ['p1', 'p2'], mode: 'wait'});
  assert.equal(none.status, 'none');
  assert.match(none.text, /p1 · in use by claude[\s\S]*p2 · in use by codex/);
});

test('a session may set its own idle time, up to the cap', async () => {
  const s = await live({maxSessionIdleSeconds: () => 900});
  const r = await leaseGate(s, A).acquire({serial: 'p1', candidates: ['p1'], mode: 'wait', idleSeconds: 5000});
  assert.match(r.text, /idle after 900 s/);
  assert.equal((await s.read()).sessions[A.id].idleSeconds, 900);
  assert.equal(await s.setSessionIdle(A, 5000, true), 5000, 'the user is not capped');
});

test('release gives phones back and leaves lines', async () => {
  const s = await live();
  await s.claim(A, ['p1', 'p2']);
  await s.claim(B, ['p3']);
  await s.join(A, 'p3');
  assert.deepEqual((await leaseGate(s, A).release(['p1'])).sort(), ['p1']);
  assert.deepEqual(await leaseGate(s, A).release(), ['p2']);
  const use = await s.use(['p1', 'p2', 'p3']);
  assert.equal(use.get('p1').state, 'free');
  assert.equal(use.get('p3').queue.length, 0);
});
