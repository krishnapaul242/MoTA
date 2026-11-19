const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp, mkdir, writeFile, readFile} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {parseFlowHeader, selectFlowFiles, globToRegExp, discoverFlows, filterByTags} = require('../out/maestro/flows');
const {parseJUnit, parseProgressLine, describeCommand, readFailureDetail} = require('../out/maestro/results');
const {MaestroRunner, maestroArgs, resolveMaestro} = require('../out/maestro/runner');

// Real Maestro 2.11 output from a run with one failing and one passing flow.
const JUNIT = `<?xml version='1.0' encoding='UTF-8'?>
<testsuites>
  <testsuite name="Test Suite" device="R9ZTC06GPWZ" tests="2" failures="1" time="37.937" timestamp="2026-11-19T19:16:25">
    <testcase id="fails" name="fails" classname="fails" file="flows/fails.yaml" time="28.103" timestamp="2026-11-19T19:16:25" status="ERROR">
      <properties>
        <property name="tags" value="smoke"/>
      </properties>
      <failure>Assertion is false: &quot;Definitely Not On Screen 123&quot; is visible</failure>
    </testcase>
    <testcase id="settings" name="settings" classname="settings" file="flows/settings.yaml" time="9.808" timestamp="2026-11-19T19:16:53" status="SUCCESS"/>
  </testsuite>
</testsuites>`;

test('flow headers give app ID, name and tags in both list styles', () => {
  assert.deepEqual(parseFlowHeader('appId: com.example.shop\ntags:\n  - smoke\n  - "checkout"\n---\n- launchApp\n'), {appId: 'com.example.shop', name: undefined, tags: ['smoke', 'checkout']});
  assert.deepEqual(parseFlowHeader("appId: 'a.b'\nname: Log in\ntags: [smoke, slow]\n---\n"), {appId: 'a.b', name: 'Log in', tags: ['smoke', 'slow']});
  assert.deepEqual(parseFlowHeader('- launchApp\n'), {tags: []});
});

test('flow selection follows Maestro: top-level by default, config globs otherwise', () => {
  const files = ['login.yaml', 'config.yaml', 'checkout/pay.yaml', 'checkout/cart.yml', 'helpers/sub/util.yaml', 'notes.txt'];
  assert.deepEqual(selectFlowFiles(files), ['login.yaml']);
  assert.deepEqual(selectFlowFiles(files, 'flows:\n  - "*"\n  - checkout/*\n'), ['checkout/cart.yml', 'checkout/pay.yaml', 'login.yaml']);
  assert.deepEqual(selectFlowFiles(files, 'flows: ["**"]\n'), ['checkout/cart.yml', 'checkout/pay.yaml', 'helpers/sub/util.yaml', 'login.yaml']);
  assert.ok(globToRegExp('**/x.yaml').test('a/b/x.yaml') && globToRegExp('**/x.yaml').test('x.yaml'));
  assert.ok(!globToRegExp('*.yaml').test('a/b.yaml'));
});

test('discovers flows on disk and filters by tags like Maestro', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mota-flows-'));
  await writeFile(join(dir, 'login.yaml'), 'appId: com.shop\ntags:\n  - smoke\n---\n- launchApp\n');
  await writeFile(join(dir, 'pay.yaml'), 'appId: com.shop\nname: Pay with UPI\ntags: [slow]\n---\n- launchApp\n');
  await writeFile(join(dir, 'config.yaml'), 'executionOrder: {}\n');
  await mkdir(join(dir, '.hidden')); await writeFile(join(dir, '.hidden', 'x.yaml'), '---\n');
  const flows = await discoverFlows(dir);
  assert.deepEqual(flows.map(f => [f.path, f.name, f.tags.join()]), [['login.yaml', 'login', 'smoke'], ['pay.yaml', 'Pay with UPI', 'slow']]);
  assert.deepEqual(filterByTags(flows, [], ['slow']).map(f => f.path), ['login.yaml']);
  assert.deepEqual(filterByTags(flows, ['smoke', 'slow'], []).length, 2);
});

test('JUnit report gives per-flow status, duration, tags and the failure message', () => {
  assert.deepEqual(parseJUnit(JUNIT), [
    {name: 'fails', file: 'flows/fails.yaml', status: 'fail', durationMs: 28103, message: 'Assertion is false: "Definitely Not On Screen 123" is visible', tags: ['smoke']},
    {name: 'settings', file: 'flows/settings.yaml', status: 'pass', durationMs: 9808, message: undefined, tags: []},
  ]);
});

test('console progress lines are parsed, others ignored', () => {
  assert.deepEqual(parseProgressLine('[Failed] fails (28s) (Assertion is false: "X" is visible)'), {status: 'fail', name: 'fails', durationMs: 28000, message: 'Assertion is false: "X" is visible'});
  assert.deepEqual(parseProgressLine('[Passed] log in flow (1m 5s)'), {status: 'pass', name: 'log in flow', durationMs: 65000, message: undefined});
  assert.equal(parseProgressLine('Waiting for flows to complete...'), undefined);
  assert.equal(parseProgressLine('1/2 Flow Failed'), undefined);
});

test('failed step, message and screenshot come from the artifacts folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mota-art-'));
  const flow = join(dir, '2026-11-19_191608', 'fails');
  await mkdir(join(flow, 'screenshots'), {recursive: true});
  await writeFile(join(flow, 'screenshots', 'step-004-assertCondition.png'), 'png');
  await writeFile(join(flow, 'commands.json'), JSON.stringify([
    {command: {launchAppCommand: {appId: 'com.android.settings'}}, metadata: {status: 'COMPLETED'}},
    {command: {assertConditionCommand: {condition: {visible: {textRegex: 'Results'}}}}, metadata: {status: 'FAILED', error: {message: 'Assertion is false: "Results" is visible'}}},
  ]));
  const detail = await readFailureDetail(dir, 'fails');
  assert.equal(detail.step, 'assertVisible "Results"');
  assert.equal(detail.message, 'Assertion is false: "Results" is visible');
  assert.equal(detail.screenshotUri, join(flow, 'screenshots', 'step-004-assertCondition.png'));
  assert.equal(await readFailureDetail(dir, 'missing'), undefined);
  assert.equal(describeCommand({tapOnElementCommand: {selector: {textRegex: 'Pay'}}}), 'tapOnElement "Pay"');
});

test('Maestro arguments are literal, per device, and reject bad variable names', () => {
  assert.deepEqual(maestroArgs('abc', ['a.yaml', 'b.yaml'], '/r.xml', '/art', {USER: 'q a'}),
    ['--device', 'abc', 'test', 'a.yaml', 'b.yaml', '--no-ansi', '--format', 'junit', '--output', '/r.xml', '--test-output-dir', '/art', '-e', 'USER=q a']);
  assert.throws(() => maestroArgs('abc', ['a.yaml'], '/r', '/a', {'A;rm': 'x'}), /Invalid variable name/);
  assert.equal(resolveMaestro(' /opt/maestro '), '/opt/maestro');
  assert.equal(resolveMaestro('', '/home/u', p => p === '/home/u/.maestro/bin/maestro'), '/home/u/.maestro/bin/maestro');
  assert.equal(resolveMaestro('', '/home/u', () => false), 'maestro');
});

/** Fake Maestro: prints progress lines and writes a JUnit report, per device. */
function fakeMaestro(script) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({cmd, args, opts});
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 4242;
    const serial = args[1], report = args[args.indexOf('--output') + 1];
    setImmediate(async () => {
      const {lines, xml, code} = script(serial);
      for (const l of lines) child.stdout.write(l + '\n');
      if (xml) await writeFile(report, xml);
      child.stdout.end(); child.emit('close', code);
    });
    return child;
  };
  return {spawn, calls};
}

test('runs selected flows on every selected device and reconciles with JUnit', async () => {
  const flowsDir = await mkdtemp(join(tmpdir(), 'mota-run-flows-'));
  const runsDir = await mkdtemp(join(tmpdir(), 'mota-runs-'));
  let online = ['A', 'B'];
  const shells = [];
  const adb = {
    devices: async () => online.map(serial => ({serial, state: 'device', model: serial})),
    shell: async (serial, args) => { shells.push([serial, ...args]); return ''; },
    run: async () => '',
  };
  const ok = `<testsuites><testsuite><testcase name="login" file="login.yaml" time="3.5" status="SUCCESS"/><testcase name="pay" file="pay.yaml" time="1" status="ERROR"><failure>Element not found: Text matching regex: Pay</failure></testcase></testsuite></testsuites>`;
  const {spawn, calls} = fakeMaestro(serial => serial === 'A'
    ? {lines: ['Waiting for flows to complete...', '[Passed] login (4s)', '[Failed] pay (1s) (Element not found)'], xml: ok, code: 1}
    : (online = ['A'], {lines: ['Waiting for flows to complete...', '[Passed] login (5s)'], xml: '', code: 1}));
  const events = [];
  const runner = new MaestroRunner({adb, maestro: () => '/bin/maestro', flowsFolder: () => flowsDir, runsFolder: () => runsDir, emit: e => events.push(e), spawn});
  const flows = [{path: 'login.yaml', name: 'login', tags: []}, {path: 'pay.yaml', name: 'pay', tags: []}];
  const run = await runner.start({flows, serials: ['A', 'B'], env: {USER: 'qa'}, clearData: 'com.shop'});
  await run.done;

  assert.equal(calls.length, 2, 'one Maestro process per device');
  const callA = calls.find(c => c.args[1] === 'A');
  assert.deepEqual(callA.args.slice(0, 5), ['--device', 'A', 'test', 'login.yaml', 'pay.yaml']);
  assert.equal(callA.opts.cwd, flowsDir);
  assert.ok(shells.some(s => s.join(' ') === 'A pm clear com.shop'), 'clears data before running');

  const a = run.devices.get('A'), b = run.devices.get('B');
  assert.equal(a.state, 'done');
  assert.deepEqual([...a.results.values()].map(r => [r.flow, r.status]), [['login.yaml', 'pass'], ['pay.yaml', 'fail']]);
  assert.equal(a.results.get('login.yaml').durationMs, 3500, 'JUnit duration wins over the console');
  assert.match(a.results.get('pay.yaml').failure.message, /Element not found/);
  assert.equal(b.state, 'lost', 'device gone after a failed exit');
  assert.equal(b.results.get('pay.yaml').status, 'not-run');

  assert.deepEqual(events.find(e => e.type === 'test/started').devices, [{serial: 'A', model: 'A'}, {serial: 'B', model: 'B'}]);
  const done = events.find(e => e.type === 'test/done');
  assert.deepEqual([done.passed, done.failed, done.notRun], [2, 1, 1]);
  assert.ok(events.some(e => e.type === 'test/progress' && e.serial === 'A' && e.state === 'running'));
  const saved = JSON.parse(await readFile(join(run.dir, 'run.json'), 'utf8'));
  assert.deepEqual(saved.devices.map(d => d.state), ['done', 'lost']);
});

test('refuses devices that are not ready and flows outside the folder', async () => {
  const adb = {devices: async () => [{serial: 'A', state: 'device'}, {serial: 'B', state: 'offline'}], shell: async () => '', run: async () => ''};
  const runner = new MaestroRunner({adb, maestro: () => 'm', flowsFolder: () => '/flows', runsFolder: () => tmpdir(), emit: () => {}});
  await assert.rejects(runner.start({flows: [{path: 'a.yaml', name: 'a', tags: []}], serials: ['A', 'B']}), /Not ready: B/);
  await assert.rejects(runner.start({flows: [{path: '../x.yaml', name: 'x', tags: []}], serials: ['A']}), /outside the flows folder/);
  await assert.rejects(runner.start({flows: [], serials: ['A']}), /at least one flow/);
});
