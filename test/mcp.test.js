const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp, mkdir, writeFile, readFile, readdir} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StreamableHTTPClientTransport} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {McpHttpServer, validBearer, loopbackHost} = require('../out/ai/mcpHttp');
const {clientConfigs} = require('../out/mcpSetup');

const TOKEN = 'secret-token-123';

async function start({confirm = async () => true, leases, cleanup} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mota-mcp-'));
  const flows = join(root, '.maestro');
  await mkdir(flows);
  const lines = [], asked = [], shells = [];
  const adb = {
    devices: async () => [{serial: 'emulator-5554', model: 'Pixel 9', state: 'device'}],
    shell: async (s, args) => { shells.push([s, ...args].join(' ')); return 'Success'; },
    run: async (args) => { shells.push(args.join(' ')); return 'Success'; },
  };
  const server = new McpHttpServer({
    adb, input: {send: async () => undefined}, runner: {running: () => [], latest: () => undefined},
    flowsFolder: () => flows, workspaceRoot: () => root, screenshotSide: () => 960,
    onFlowWritten() {}, token: () => TOKEN, log: l => lines.push(l), leases, cleanup,
    confirm: async (tool, summary) => { asked.push(summary); return confirm(tool); },
  }, '9.9.9');
  const port = await server.start(0);
  return {server, port, root, flows, lines, asked, shells, url: `http://127.0.0.1:${port}/mcp`};
}

async function connect(url, token = TOKEN) {
  const client = new Client({name: 'test', version: '1'});
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {requestInit: {headers: {Authorization: `Bearer ${token}`}}}));
  return client;
}

test('an MCP client lists MoTA tools and calls one', async () => {
  const s = await start();
  try {
    const client = await connect(s.url);
    assert.equal(client.getServerVersion().name, 'mota');
    assert.match(client.getInstructions(), /list_devices/);
    const {tools} = await client.listTools();
    const names = tools.map(t => t.name);
    for (const n of ['list_devices', 'screenshot', 'ui_tree', 'tap', 'write_flow', 'run_flow', 'uninstall_app']) assert.ok(names.includes(n), n);
    assert.ok(!names.includes('propose_plan'), 'the plan card belongs to MoTA\'s own bar');
    assert.ok(tools.find(t => t.name === 'tap').inputSchema.properties.serial, 'schemas are served');
    assert.equal(tools.find(t => t.name === 'uninstall_app').annotations.destructiveHint, true);
    const r = await client.callTool({name: 'list_devices', arguments: {}});
    assert.equal(r.content[0].text, 'emulator-5554 · Pixel 9 · device');
    assert.match(s.lines[0], /list_devices — ok/);
    const bad = await client.callTool({name: 'tap', arguments: {serial: 'x', x: -1, y: 0}});
    assert.ok(bad.isError, 'arguments are validated');
    await client.close();
  } finally { await s.server.stop(); }
});

test('data-loss calls wait for the user in VS Code', async () => {
  let allow = false;
  const s = await start({confirm: async () => allow});
  try {
    const client = await connect(s.url);
    const declined = await client.callTool({name: 'uninstall_app', arguments: {serial: 'emulator-5554', package: 'com.example.app', reason: 'Start the login test from a clean state'}});
    assert.ok(declined.isError); assert.match(declined.content[0].text, /declined/);
    assert.ok(!s.shells.some(c => c.includes('uninstall')), 'nothing ran');
    allow = true;
    const ok = await client.callTool({name: 'uninstall_app', arguments: {serial: 'emulator-5554', package: 'com.example.app', reason: 'Start the login test from a clean state'}});
    assert.ok(!ok.isError);
    assert.ok(s.shells.some(c => c.includes('uninstall com.example.app')));
    assert.deepEqual(s.asked, ['uninstall_app com.example.app', 'uninstall_app com.example.app']);

    // A new flow is not data loss; overwriting one is.
    const flow = 'appId: com.example.app\n---\n- launchApp\n';
    allow = false;
    assert.ok(!(await client.callTool({name: 'write_flow', arguments: {path: 'login.yaml', content: flow}})).isError);
    assert.equal(s.asked.length, 2, 'creating a flow does not ask');
    const over = await client.callTool({name: 'write_flow', arguments: {path: 'login.yaml', content: flow + '- back\n'}});
    assert.ok(over.isError); assert.equal(s.asked.length, 3);
    assert.equal(await readFile(join(s.flows, 'login.yaml'), 'utf8'), flow);
    const escape = await client.callTool({name: 'write_flow', arguments: {path: '../evil.yaml', content: flow}});
    assert.ok(escape.isError, 'writes stay inside the flows folder');
    assert.ok(!(await readdir(s.root)).includes('evil.yaml'));
    await client.close();
  } finally { await s.server.stop(); }
});

test('requests without the token, from web pages or to other hosts are refused', async () => {
  const s = await start();
  try {
    const body = JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}});
    const headers = {'content-type': 'application/json', accept: 'application/json, text/event-stream'};
    const post = (h) => fetch(s.url, {method: 'POST', headers: {...headers, ...h}, body});
    assert.equal((await post({})).status, 401);
    assert.equal((await post({authorization: 'Bearer wrong'})).status, 401);
    assert.equal((await post({authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example'})).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/other`, {method: 'POST', headers, body})).status, 404);
    await assert.rejects(connect(s.url, 'nope'));
  } finally { await s.server.stop(); }
});

test('bearer and host checks', () => {
  assert.ok(validBearer('Bearer abc', 'abc'));
  assert.ok(validBearer('bearer abc ', 'abc'));
  assert.ok(!validBearer('Bearer abcd', 'abc'));
  assert.ok(!validBearer('abc', 'abc'));
  assert.ok(!validBearer('Bearer ', ''));
  assert.ok(!validBearer(undefined, 'abc'));
  for (const h of ['127.0.0.1:6682', 'localhost:6682', '[::1]:6682', 'LOCALHOST']) assert.ok(loopbackHost(h), h);
  for (const h of ['evil.example:6682', '192.168.1.5:6682', undefined, '127.0.0.1.evil.example']) assert.ok(!loopbackHost(h), String(h));
});

test('client configs carry the URL and token', () => {
  const c = clientConfigs('http://127.0.0.1:6682/mcp', 'T');
  // Name and URL come before --header, whose values are variadic.
  assert.deepEqual(c.claudeArgs.slice(-4), ['mota', 'http://127.0.0.1:6682/mcp', '--header', 'Authorization: Bearer T']);
  assert.match(c.claudeCommand, /mota http:\/\/127\.0\.0\.1:6682\/mcp --header "Authorization: Bearer T"$/);
  assert.deepEqual(JSON.parse(c.cursor), {mcpServers: {mota: {url: 'http://127.0.0.1:6682/mcp', headers: {Authorization: 'Bearer T'}}}});
  assert.match(c.codex, /\[mcp_servers\.mota\]\nurl = "http:\/\/127\.0\.0\.1:6682\/mcp"/);
});

test('phones in use by another session are refused, and list_devices says who has them', async () => {
  const {LeaseStore} = require('../out/leases');
  const leases = new LeaseStore({dir: await mkdtemp(join(tmpdir(), 'mota-mcp-leases-')), idleSeconds: () => 120, deviceIdleSeconds: () => ({})});
  // A session in another process (our parent, which is alive) holds the phone.
  await leases.claim({id: `agent:${process.ppid}`, label: 'codex · ~/other', pid: process.ppid}, ['emulator-5554']);
  let asked = 0;
  const s = await start({leases, confirm: async () => { asked++; return true; }});
  try {
    const client = await connect(s.url);
    const list = await client.callTool({name: 'list_devices', arguments: {}});
    assert.match(list.content[0].text, /emulator-5554 · Pixel 9 · device · in use by codex · ~\/other/);
    const tap = await client.callTool({name: 'tap', arguments: {serial: 'emulator-5554', x: 1, y: 2}});
    assert.ok(tap.isError);
    assert.match(tap.content[0].text, /in use by codex · ~\/other/);
    const clear = await client.callTool({name: 'clear_app_data', arguments: {serial: 'emulator-5554', package: 'com.example.app', reason: 'Start the login test from a clean state'}});
    assert.ok(clear.isError);
    assert.equal(asked, 0, 'the user is not asked about a call that would be refused');
    assert.ok(!s.shells.some(c => /pm clear/.test(c)));
    // Once the other session lets go, the phone is this caller's.
    await leases.release(`agent:${process.ppid}`);
    const ok = await client.callTool({name: 'wake', arguments: {serial: 'emulator-5554'}});
    assert.ok(!ok.isError, ok.content[0].text);
    const after = await client.callTool({name: 'list_devices', arguments: {}});
    assert.match(after.content[0].text, /· yours/);
    await client.close();
  } finally { await s.server.stop(); }
});

test('acquire_device waits in line and release_device gives phones back', async () => {
  const {LeaseStore} = require('../out/leases');
  const leases = new LeaseStore({dir: await mkdtemp(join(tmpdir(), 'mota-mcp-acq-')), idleSeconds: () => 120, deviceIdleSeconds: () => ({}), waitMs: 100, pollMs: 10});
  const other = {id: `agent:${process.ppid}`, label: 'codex · ~/other', pid: process.ppid};
  await leases.claim(other, ['emulator-5554']);
  const s = await start({leases});
  try {
    const client = await connect(s.url);
    const names = (await client.listTools()).tools.map(t => t.name);
    assert.ok(names.includes('acquire_device') && names.includes('release_device'));
    const wait = await client.callTool({name: 'acquire_device', arguments: {serial: 'emulator-5554'}});
    assert.match(wait.content[0].text, /Still waiting for emulator-5554: you are number 1 in line/);
    await leases.park(other.id);
    const got = await client.callTool({name: 'acquire_device', arguments: {serial: 'emulator-5554', mode: 'wait'}});
    assert.match(got.content[0].text, /emulator-5554 is yours/);
    const rel = await client.callTool({name: 'release_device', arguments: {}});
    assert.match(rel.content[0].text, /Released emulator-5554/);
    const gone = await client.callTool({name: 'acquire_device', arguments: {serial: 'nope-1'}});
    assert.ok(gone.isError);
    await client.close();
  } finally { await s.server.stop(); }
});

test('the takeover notification maps buttons to answers and only reports a late click', async () => {
  const {takeoverPrompt} = require('../out/ai/host');
  const shown = [];
  const vscode = pick => ({window: {showWarningMessage: async (msg, ...items) => { shown.push(msg); return pick; }, showInformationMessage: async m => { shown.push(m); }}});
  const p = {serial: 'p1', requester: 'codex · ~/b', holder: 'claude · ~/a', busy: 'a Maestro test run, started 5 s ago'};
  assert.equal(await takeoverPrompt(vscode('Hand over'), p, () => undefined), 'allow');
  assert.equal(await takeoverPrompt(vscode('Keep'), p, () => undefined), 'decline');
  assert.equal(await takeoverPrompt(vscode(undefined), p, () => undefined), undefined);
  assert.match(shown[0], /codex · ~\/b asks for p1, which claude · ~\/a is using \(busy: a Maestro test run/);
  assert.equal(await takeoverPrompt(vscode('Keep'), p, () => 'handed to codex · ~/b'), undefined);
  assert.equal(shown.at(-1), 'p1 was already handed to codex · ~/b.');
});

test('device cleanup carries a reason and task, can be approved once for all calls, and is recorded', async () => {
  const {CleanupApprovals, cleanupPurposeText} = require('../out/cleanupApprovals');
  const mem = new Map();
  const cleanup = new CleanupApprovals({get: (k, d) => mem.has(k) ? mem.get(k) : d, update: async (k, v) => { mem.set(k, v); }});
  let asked = 0, seen;
  const s = await start({cleanup, confirm: async () => { asked++; return true; }});
  try {
    const client = await connect(s.url);
    const args = {serial: 'emulator-5554', package: 'com.example.app'};
    const bare = await client.callTool({name: 'clear_app_data', arguments: args});
    assert.ok(bare.isError, 'a reason is required');
    assert.equal(asked, 0);
    const first = await client.callTool({name: 'clear_app_data', arguments: {...args, reason: 'Reset before the login flow', taskId: 142}});
    assert.ok(!first.isError);
    assert.equal(asked, 1, 'asked while there is no standing approval');
    await cleanup.setStanding(true);
    const second = await client.callTool({name: 'uninstall_app', arguments: {...args, reason: 'Install a fresh build'}});
    assert.ok(!second.isError);
    assert.equal(asked, 1, 'not asked once cleanup is approved for all calls');
    assert.ok(s.shells.some(c => c.includes('uninstall com.example.app')));
    // Overwriting a flow is not cleanup: it still asks.
    const flow = 'appId: com.example.app\n---\n- launchApp\n';
    await client.callTool({name: 'write_flow', arguments: {path: 'a.yaml', content: flow}});
    await client.callTool({name: 'write_flow', arguments: {path: 'a.yaml', content: flow}});
    assert.equal(asked, 2);
    const history = cleanup.history();
    assert.deepEqual(history.map(e => [e.tool, e.decision, e.result, e.reason, e.taskId]), [
      ['uninstall_app', 'standing', 'ok', 'Install a fresh build', undefined],
      ['clear_app_data', 'allowed', 'ok', 'Reset before the login flow', '142'],
    ]);
    assert.ok(history.every(e => e.serial === 'emulator-5554' && e.package === 'com.example.app' && !Number.isNaN(Date.parse(e.at))));
    assert.match(s.lines.find(l => /uninstall_app/.test(l)), /standing approval · why: Install a fresh build/);
    assert.equal(cleanupPurposeText({reason: 'x', taskId: '7'}, 'claude · ~/app'), 'Why: x\nFor: task 7\nAsked by: claude · ~/app');
    await client.close();
  } finally { await s.server.stop(); }
});
