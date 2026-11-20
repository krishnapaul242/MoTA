const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp, readFile, writeFile, mkdir, stat} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {execFile} = require('node:child_process');
const {phonesTouchedBy, simpleCommands} = require('../out/rawCommands');
const {handleHook} = require('../out/ai/hooks');
const {sessionAbove, parseProcs} = require('../out/ai/caller');
const {withMotaHooks, withoutMotaHooks, installHooks, removeHooks, hookCommand} = require('../out/hookSetup');
const {LeaseStore} = require('../out/leases');
const {McpHttpServer} = require('../out/ai/mcpHttp');

const ONE = ['p1'], TWO = ['p1', 'p2'];

test('which phones a shell command changes', () => {
  const t = (cmd, connected = TWO) => phonesTouchedBy(cmd, connected)?.serials ?? [];
  assert.deepEqual(t('adb -s p1 install -r app.apk'), ['p1']);
  assert.deepEqual(t('adb -s p2 shell input tap 10 20'), ['p2']);
  assert.deepEqual(t('ANDROID_SERIAL=p2 adb shell am start -n com.a/.Main'), ['p2']);
  assert.deepEqual(t('adb shell input tap 1 1', ONE), ['p1'], 'one phone: adb uses it');
  assert.deepEqual(t('adb shell input tap 1 1'), [], 'several phones and no serial: adb refuses, nothing to claim');
  assert.deepEqual(t('/opt/sdk/platform-tools/adb -s p1 uninstall com.a'), ['p1']);
  assert.deepEqual(t('cd app && ./gradlew :app:connectedDebugAndroidTest'), ['p1', 'p2'], 'Gradle uses every connected phone');
  assert.deepEqual(t('ANDROID_SERIAL=p1 ./gradlew installDebug'), ['p1']);
  assert.deepEqual(t('maestro --device p2 test flows/'), ['p2']);
  assert.deepEqual(t('maestro test flows/login.yaml', ONE), ['p1']);
  assert.deepEqual(t('adb -s p1 shell input tap 1 1 && adb -s p2 shell input keyevent 3'), ['p1', 'p2']);
  for (const read of ['adb devices', 'adb -s p1 logcat -d', 'adb -s p1 shell getprop ro.product.model', 'adb -s p1 shell dumpsys battery | grep level',
    'adb -s p1 pull /sdcard/a.png', 'adb -s p1 exec-out screencap -p > s.png', 'adb -s p1 shell pm list packages', 'adb connect 10.0.0.2:5555',
    './gradlew assembleDebug', 'maestro --version', 'grep adb notes.txt', 'echo "adb -s p1 install x"', 'adb -s p1 shell'])
    assert.deepEqual(t(read), [], read);
  assert.deepEqual(simpleCommands(`a "b c" 'd;e' f\\ g; h|i`), [['a', 'b c', 'd;e', 'f g'], ['h'], ['i']]);
  assert.match(phonesTouchedBy('adb -s p1 install a.apk; maestro --device p1 test x', TWO).what, /adb install, maestro test/);
});

test('the session above a hook is the first parent that is not a shell or curl', async () => {
  const ps = `  1 0 /sbin/launchd\n 400 1 /Applications/Terminal\n 401 400 -zsh\n 500 401 /Users/me/.local/share/claude/versions/2.1.329\n 510 500 /bin/sh\n 511 510 /usr/bin/curl\n`;
  assert.equal(parseProcs(ps).get(500).name, '2.1.329');
  const run = async (file, args) => file === 'ps' && args[0] === '-axo' ? ps : file === 'ps' ? 'claude\n' : 'p500\nfcwd\nn/Users/me/app\n';
  const h = await sessionAbove(511, run, 'darwin');
  assert.equal(h.id, 'agent:500');
  assert.match(h.label, /^claude · /);
});

const A = {id: 'agent:500', label: 'claude · ~/a', pid: 500};
const B = {id: 'agent:600', label: 'codex · ~/b', pid: 600};
const adb = {devices: async () => [{serial: 'p1', state: 'device'}, {serial: 'p2', state: 'device'}]};
async function store(extra = {}) {
  return new LeaseStore({dir: await mkdtemp(join(tmpdir(), 'mota-hooks-')), idleSeconds: () => 120, deviceIdleSeconds: () => ({}), alive: () => true, waitMs: 200, pollMs: 10, takeoverMs: 2000, ...extra});
}
const pre = command => ({hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {command}});

test('a shell command on a free phone claims it; other commands are left alone without looking up the session', async () => {
  const leases = await store();
  let looked = 0;
  const session = async () => { looked++; return A; };
  assert.deepEqual(await handleHook(pre('npm test'), session, {adb, leases, log() {}}), {});
  assert.equal(looked, 0);
  assert.deepEqual(await handleHook(pre('adb -s p1 install -r a.apk'), session, {adb, leases, log() {}}), {});
  assert.equal((await leases.use(['p1'])).get('p1').holder.id, A.id);
});

test('a shell command on a phone in use asks the user; a no denies the command with the reason', async () => {
  const asked = [];
  const leases = await store({prompt: async p => { asked.push(p); return 'decline'; }});
  await leases.claim(B, ['p1']);
  const out = await handleHook(pre('adb -s p1 shell input tap 5 5'), async () => A, {adb, leases, log() {}});
  assert.equal(asked.length, 1);
  assert.equal(asked[0].requester, A.label);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /adb shell.*would change p1.*the user said no/s);
});

test('a yes lets the command run on the phone', async () => {
  const leases = await store({prompt: async () => 'allow'});
  await leases.claim(B, ['p1']);
  assert.deepEqual(await handleHook(pre('maestro --device p1 test x.yaml'), async () => A, {adb, leases, log() {}}), {});
  assert.equal((await leases.use(['p1'])).get('p1').holder.id, A.id);
});

test('Stop and idle prompts free the session\'s phones for others; SessionEnd releases them', async () => {
  const leases = await store();
  await leases.claim(A, ['p1', 'p2']);
  await handleHook({hook_event_name: 'Stop'}, async () => A, {adb, leases, log() {}});
  assert.equal((await leases.use(['p1'])).get('p1').state, 'idle');
  await leases.touch(A.id, ['p1']);
  await handleHook({hook_event_name: 'Notification', notification_type: 'idle_prompt'}, async () => A, {adb, leases, log() {}});
  assert.equal((await leases.use(['p1'])).get('p1').state, 'idle');
  await handleHook({hook_event_name: 'SessionEnd', reason: 'prompt_input_exit'}, async () => A, {adb, leases, log() {}});
  assert.equal((await leases.use(['p2'])).get('p2').state, 'free');
});

test('installing hooks keeps other settings and hooks, replaces older MoTA hooks, and removes cleanly', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mota-home-'));
  await mkdir(join(home, '.claude'));
  const mine = {matcher: 'Bash', hooks: [{type: 'command', command: '~/guard.sh'}]};
  await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({model: 'opus', hooks: {PreToolUse: [mine]}}));
  await installHooks(6682, 'tok', home);
  await installHooks(7000, 'tok2', home);
  const s = JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf8'));
  assert.equal(s.model, 'opus');
  assert.equal(s.hooks.PreToolUse.length, 2, 'the user\'s hook plus one MoTA hook, not two');
  assert.deepEqual(s.hooks.PreToolUse[0], mine);
  assert.equal(s.hooks.PreToolUse[1].matcher, 'Bash');
  assert.equal(s.hooks.PreToolUse[1].hooks[0].timeout, 180);
  assert.match(s.hooks.PreToolUse[1].hooks[0].command, /127\.0\.0\.1:7000\/hook \|\| true$/);
  assert.ok(!JSON.stringify(s).includes('tok2'), 'the token is not written into Claude Code\'s settings');
  assert.equal(s.hooks.Notification[0].matcher, 'idle_prompt');
  assert.ok(s.hooks.Stop && s.hooks.SessionEnd);
  const header = join(home, '.mota', 'hook.header');
  assert.equal(await readFile(header, 'utf8'), 'Authorization: Bearer tok2\n');
  assert.equal((await stat(header)).mode & 0o777, 0o600);
  await removeHooks(home);
  const after = JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(after, {model: 'opus', hooks: {PreToolUse: [mine]}});
  assert.deepEqual(withoutMotaHooks({}), {});
  assert.deepEqual(Object.keys(withMotaHooks({}, 1).hooks), ['PreToolUse', 'Stop', 'Notification', 'SessionEnd']);
});

test('the real hook command reaches MoTA, which answers with the hook\'s output', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mota-home2-'));
  const leases = await store({prompt: async () => 'decline'});
  await leases.claim(B, ['p1']);
  const server = new McpHttpServer({adb, input: {}, runner: {}, flowsFolder: () => home, workspaceRoot: () => home, screenshotSide: () => 960,
    onFlowWritten() {}, token: () => 'secret', log() {}, confirm: async () => true, leases, sessionAbove: async () => A}, '1');
  const port = await server.start(0);
  try {
    await mkdir(join(home, '.mota'));
    await writeFile(join(home, '.mota', 'hook.header'), 'Authorization: Bearer secret\n');
    const run = input => new Promise((ok, fail) => {
      const child = execFile('/bin/sh', ['-c', hookCommand(port)], {env: {...process.env, HOME: home}}, (err, stdout) => err ? fail(err) : ok(stdout));
      child.stdin.end(JSON.stringify(input));
    });
    const denied = JSON.parse(await run(pre('adb -s p1 install a.apk')));
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(await run(pre('ls')), '{}');
    await server.stop();
    assert.equal(await run(pre('adb -s p1 install a.apk')), '', 'with MoTA not running, the hook prints nothing and the command goes ahead');
  } finally { await server.stop(); }
});
