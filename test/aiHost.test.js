const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {deflateSync} = require('node:zlib');
const {AiHostImpl, resolveClaude, friendlyError, taskTokens} = require('../out/ai/host');
const {compactUiTree} = require('../out/ai/tools');
const {downscalePng, decodePng, encodePng} = require('../out/ai/png');
const {describeCall, systemPrompt} = require('../out/ai/prompts');

/** Fake Agent SDK: `script(options, prompt)` is an async generator of SDK messages. */
function fakeSdk(script) {
  const queries = [];
  const sdk = {
    tool: (name, description, schema, handler, extras) => ({name, handler, extras}),
    createSdkMcpServer: o => ({type: 'sdk', name: o.name, tools: o.tools}),
    query: ({prompt, options}) => {
      queries.push({prompt, options});
      const gen = script(options, prompt);
      gen.supportedModels = async () => [{value: 'claude-opus-5-5', displayName: 'Opus 5.5'}];
      return gen;
    },
  };
  return {sdk, queries};
}

const usage = (input, output) => ({input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000});
const assistant = (id, content, u = usage(100, 50)) => ({type: 'assistant', parent_tool_use_id: null, message: {id, content, usage: u}});
const toolUse = (id, name, input) => ({type: 'tool_use', id, name, input});
const toolResult = (id, text, is_error = false) => ({type: 'user', parent_tool_use_id: null, message: {role: 'user', content: [{type: 'tool_result', tool_use_id: id, content: [{type: 'text', text}], is_error}]}});
const streamText = (id, text) => [
  {type: 'stream_event', parent_tool_use_id: null, event: {type: 'message_start', message: {id}}},
  {type: 'stream_event', parent_tool_use_id: null, event: {type: 'content_block_delta', delta: {type: 'text_delta', text}}},
  {type: 'stream_event', parent_tool_use_id: null, event: {type: 'message_stop'}},
];
const result = (cost = 0.02) => ({type: 'result', subtype: 'success', total_cost_usd: cost});
const init = {type: 'system', subtype: 'init', session_id: 'sdk-session-1'};

async function setup(script) {
  const root = await mkdtemp(join(tmpdir(), 'mota-ai-'));
  const {sdk, queries} = fakeSdk(script);
  let stored = [];
  const adb = {devices: async () => [{serial: 'A', state: 'device', model: 'Pixel 7'}], shell: async () => '', run: async () => ''};
  const host = new AiHostImpl({
    adb, workspaceRoot: () => root, flowsFolder: () => join(root, '.maestro'), runsFolder: () => join(root, '.mota', 'test-runs'),
    maestroPath: () => '', claudePath: () => process.execPath, defaultModel: () => '', effort: () => 'low', screenshotSide: () => 960,
    store: {get: () => stored, set: v => { stored = v; }}, loadSdk: async () => sdk,
  });
  const events = [];
  const link = host.connect(e => events.push(e));
  return {host, link, events, queries, root, stored: () => stored};
}
const send = (link, text, over = {}) => link.handle({type: 'ai/send', text, mode: 'claude', scope: {serials: ['A']}, permission: 'ask-task', model: '', tokenCap: 40000, ...over});
const of = (events, type) => events.filter(e => e.type === type);

test('a turn streams text, tool lines and usage, then finishes; options keep the prompt lean', async () => {
  const {link, events, queries, stored} = await setup(async function* (options) {
    yield init;
    yield* streamText('m1', 'Looking at the phone.');
    yield assistant('m1', [toolUse('t1', 'mcp__mota__ui_tree', {serial: 'A'})]);
    const allowed = await options.canUseTool('mcp__mota__ui_tree', {serial: 'A'}, {signal: options.abortController.signal});
    assert.equal(allowed.behavior, 'allow', 'looking needs no approval');
    yield toolResult('t1', '(540,1200) Button "Pay" clickable');
    yield* streamText('m2', 'It shows a Pay button.');
    yield assistant('m2', [{type: 'text', text: 'It shows a Pay button.'}]);
    yield result(0.0231);
  });
  await send(link, 'What is on screen?');
  assert.equal(events[0].type, 'ai/models');
  const started = of(events, 'ai/started')[0];
  assert.deepEqual([started.title, started.tokenCap, started.scope.serials], ['What is on screen?', 40000, ['A']]);
  assert.equal(of(events, 'ai/text').map(e => e.delta).join(''), 'Looking at the phone.It shows a Pay button.');
  assert.equal(of(events, 'ai/text-end').length, 2);
  const tools = of(events, 'ai/tool');
  assert.deepEqual(tools.map(t => [t.name, t.state]), [['ui_tree', 'running'], ['ui_tree', 'ok']]);
  assert.deepEqual(tools[1].devices, ['A']);
  const lastUsage = of(events, 'ai/usage').pop();
  assert.deepEqual([lastUsage.totalTokens, lastUsage.cacheReadTokens, lastUsage.costUsd], [300, 2000, 0.0231]);
  assert.deepEqual(of(events, 'ai/done').pop(), {type: 'ai/done', convId: started.convId, outcome: 'success'});

  const o = queries[0].options;
  assert.equal(o.pathToClaudeCodeExecutable, process.execPath);
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.strictMcpConfig, true);
  assert.deepEqual(o.tools, ['Read', 'Glob', 'Grep', 'Edit', 'Write'], 'no Bash or web tools');
  assert.deepEqual(o.taskBudget, {total: 40000});
  assert.match(o.systemPrompt, /A \(Pixel 7\)/);
  assert.equal(stored()[0].sdkSessionId, 'sdk-session-1');
});

test('the next message resumes the same Claude session', async () => {
  const {link, events, queries} = await setup(async function* () { yield init; yield result(); });
  await send(link, 'first');
  const convId = of(events, 'ai/started')[0].convId;
  await send(link, 'second', {convId});
  assert.equal(queries[1].options.resume, 'sdk-session-1');
  assert.equal(of(events, 'ai/started').length, 2);
  await link.handle({type: 'ai/list'});
  assert.deepEqual(of(events, 'ai/conversations')[0].items.map(c => c.title), ['first']);
});

test('ask once per task: one plan approval covers small steps; data loss still asks', async () => {
  let host, events;
  const decisions = [];
  const approve = decision => setImmediate(() => { const card = of(events, 'ai/approval').pop(); host.handle({type: 'ai/approve', convId: card.convId, requestId: card.requestId, decision}); });
  const ctx = await setup(async function* (options) {
    yield init;
    const signal = options.abortController.signal;
    approve('once');
    decisions.push((await options.canUseTool('mcp__mota__tap', {serial: 'A', x: 1, y: 2}, {signal})).behavior);
    decisions.push((await options.canUseTool('mcp__mota__swipe', {serial: 'A', x: 1, y: 2, x2: 3, y2: 4}, {signal})).behavior);
    approve('deny');
    decisions.push((await options.canUseTool('mcp__mota__clear_app_data', {serial: 'A', package: 'com.shop'}, {signal})).behavior);
    decisions.push((await options.canUseTool('Bash', {command: 'rm -rf /'}, {signal})).behavior);
    yield result();
  });
  host = {handle: m => ctx.link.handle(m)}; events = ctx.events;
  await send(ctx.link, 'tap it');
  assert.deepEqual(decisions, ['allow', 'allow', 'deny', 'deny']);
  const cards = of(events, 'ai/approval');
  assert.deepEqual(cards.map(c => c.kind), ['plan', 'data-loss'], 'swipe ran without a second card');
  assert.match(cards[1].title, /Clears all data of com\.shop/);
});

test('reaching the token cap stops the task', async () => {
  const {link, events} = await setup(async function* (options) {
    yield init;
    yield assistant('m1', [], usage(30000, 500));
    yield assistant('m2', [], usage(30000, 500));
    if (options.abortController.signal.aborted) throw new Error('aborted');
    yield result();
  });
  await send(link, 'explore', {tokenCap: 50000});
  const done = of(events, 'ai/done').pop();
  assert.equal(done.outcome, 'cap-reached');
  assert.match(done.message, /50K token cap/);
});

test('caps below the API minimum still apply but are not sent as a task budget', async () => {
  const {link, queries} = await setup(async function* () { yield result(); });
  await send(link, 'quick', {tokenCap: 15000});
  assert.equal(queries[0].options.taskBudget, undefined);
});

test('Stop ends the turn and declines a pending approval', async () => {
  let ctx;
  ctx = await setup(async function* (options) {
    yield init;
    setImmediate(() => ctx.link.handle({type: 'ai/stop', convId: of(ctx.events, 'ai/started')[0].convId}));
    const r = await options.canUseTool('mcp__mota__tap', {serial: 'A', x: 1, y: 1}, {signal: options.abortController.signal});
    assert.equal(r.behavior, 'deny');
    throw new Error('aborted');
  });
  await send(ctx.link, 'tap');
  assert.equal(of(ctx.events, 'ai/done').pop().outcome, 'stopped');
});

test('start-up problems are explained', async () => {
  const {link, events} = await setup(async function* () { throw new Error('Invalid API key · Please run /login'); });
  await send(link, 'hi');
  assert.match(of(events, 'ai/done').pop().message, /not signed in/);
  assert.match(friendlyError(new Error('spawn claude ENOENT')), /Could not start Claude Code/);
});

test('test requests report errors as test/error, and flows are listed', async () => {
  const {link, events} = await setup(async function* () {});
  await link.handle({type: 'test/flows'});
  assert.match(of(events, 'test/flows')[0].error, /No flows folder/);
  await link.handle({type: 'test/start', flows: ['missing.yaml'], serials: ['A'], env: {}});
  assert.match(of(events, 'test/error')[0].message, /ENOENT|Not in the flows folder/);
});

test('Claude Code is found in the usual places or explained', () => {
  const home = '/h', exists = p => p === '/h/.local/bin/claude';
  assert.equal(resolveClaude('', home, exists, ''), '/h/.local/bin/claude');
  assert.equal(resolveClaude('', home, p => p === '/opt/bin/claude', '/usr/bin:/opt/bin'), '/opt/bin/claude');
  assert.throws(() => resolveClaude('', home, () => false, ''), /not installed/);
  assert.throws(() => resolveClaude('/nope/claude', home, () => false, ''), /mota\.ai\.claudePath/);
  assert.deepEqual(taskTokens(new Map([['a', {fresh: 10, output: 5, cacheRead: 100}]])), {inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, totalTokens: 15});
});

test('UI dump becomes short lines with tap centres, hiding typed text', () => {
  const xml = `<hierarchy><node index="0" text="" resource-id="" class="android.widget.FrameLayout" content-desc="" clickable="false" bounds="[0,0][1080,2400]">
    <node text="Pay ₹1,249" resource-id="com.shop:id/pay" class="android.widget.Button" content-desc="" clickable="true" enabled="true" bounds="[100,2000][980,2200]"/>
    <node text="secret@mail.com" resource-id="com.shop:id/email" class="android.widget.EditText" content-desc="" clickable="true" focused="true" bounds="[100,500][980,600]"/>
    <node text="" resource-id="" class="android.widget.ImageView" content-desc="Cart" clickable="false" bounds="[0,0][0,0]"/></node></hierarchy>`;
  assert.equal(compactUiTree(xml), '(540,2100) Button "Pay ₹1,249" id=pay clickable\n(540,550) EditText (has text) id=email clickable editable focused');
  assert.match(compactUiTree('<hierarchy/>'), /use a screenshot/);
});

test('screenshots are shrunk by whole factors and stay valid PNGs', () => {
  const w = 1080, h = 2400, rgba = Buffer.alloc(w * h * 4, 200);
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const chunk = (t, d) => { const b = Buffer.alloc(8); b.writeUInt32BE(d.length); b.write(t, 4); return Buffer.concat([b, d, Buffer.alloc(4)]); };
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  const small = downscalePng(png, 960);
  assert.deepEqual([small.width, small.height, small.scale], [360, 800, 3]);
  const back = decodePng(small.png);
  assert.deepEqual([back.width, back.height, back.channels, back.pixels[0]], [360, 800, 3, 200]);
  assert.equal(downscalePng(encodePng(10, 10, Buffer.alloc(300)), 960).scale, 1, 'small images are kept');
});

test('tool calls read as one short line; prompt states permission and budget', () => {
  assert.equal(describeCall('mcp__mota__tap', {serial: 'A', x: 5, y: 6}), 'tap 5,6');
  assert.equal(describeCall('mcp__mota__install_apk', {serials: ['A', 'B'], apk: '/w/app-release.apk'}), 'install_apk app-release.apk → 2 devices');
  const p = systemPrompt({workspaceRoot: '/w', flowsFolder: '/w/.maestro', devices: [], permission: 'read-only', tokenCap: 40000});
  assert.match(p, /read-only/); assert.match(p, /about 40K tokens/); assert.match(p, /flows live in \.maestro/);
  assert.ok(p.length < 5000, 'stays short');
});

test('ui_tree explains animated screens and frees UI automation from Maestro once', async () => {
  const {motaServer} = require('../out/ai/tools');
  let tools; const shells = [];
  const replies = {A: ['ERROR: could not get idle state.'], B: ['', 'UI hierchary dumped to: x\n<hierarchy><node text="OK" class="android.widget.Button" clickable="true" bounds="[0,0][100,50]"/></hierarchy>']};
  const adb = {shell: async (s, args) => { shells.push([s, ...args].join(' ')); return args[0] === 'am' ? '' : replies[s].shift(); }};
  motaServer({tool: (n, d, s, h) => ({n, h}), createSdkMcpServer: o => { tools = o.tools; return o; }},
    {adb, runner: {running: () => []}, flowsFolder: () => '/f', workspaceRoot: () => '/w', screenshotSide: () => 960, requestPlan: async () => true, onScreenshot() {}, onFlowWritten() {}});
  const uiTree = tools.find(t => t.n === 'ui_tree').h;
  const a = await uiTree({serial: 'A'});
  assert.ok(a.isError); assert.match(a.content[0].text, /keeps animating/);
  assert.ok(!shells.some(s => s.includes('force-stop')), 'no pointless retry for animation');
  const b = await uiTree({serial: 'B'});
  assert.equal(b.content[0].text, '(50,25) Button "OK" clickable');
  assert.ok(shells.includes('B am force-stop dev.mobile.maestro'));
});

test('model list folds Claude Code\'s default row into the empty id', () => {
  const {modelChoices} = require('../out/ai/host');
  assert.deepEqual(modelChoices([{value: 'default', displayName: 'Default (recommended)'}, {value: 'opus', displayName: 'Opus 5.5'}, {value: 'haiku'}]),
    [{id: '', label: 'Default (recommended)'}, {id: 'opus', label: 'Opus 5.5'}, {id: 'haiku', label: 'haiku'}]);
});
