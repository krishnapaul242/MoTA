const {test} = require('node:test');
const assert = require('node:assert/strict');
const {decide, riskOf, targetSerials, MOTA_TOOL_RISK} = require('../out/ai/policy');

const existing = new Set(['/ws/.maestro/login.yaml']);
const ctx = (over = {}) => ({permission: 'ask-task', planApproved: false, allowedForConversation: new Set(), scope: [], workspaceRoot: '/ws', flowsFolder: '/ws/.maestro', exists: p => existing.has(p), ...over});
const mota = name => `mcp__mota__${name}`;

test('reads always run; read-only refuses everything else', () => {
  for (const name of ['screenshot', 'ui_tree', 'logcat_tail', 'run_results', 'propose_plan']) assert.deepEqual(decide(mota(name), {serial: 'A'}, ctx({permission: 'read-only'})), {action: 'allow'});
  assert.equal(decide(mota('tap'), {serial: 'A'}, ctx({permission: 'read-only'})).action, 'deny');
  assert.equal(decide('Read', {file_path: '/ws/src/app.ts'}, ctx()).action, 'allow');
});

test('ask once per task: input and changes wait for the plan, then run', () => {
  assert.deepEqual(decide(mota('tap'), {serial: 'A'}, ctx()), {action: 'ask', kind: 'plan', reason: 'Claude wants to act before a plan was approved.'});
  assert.deepEqual(decide(mota('tap'), {serial: 'A'}, ctx({planApproved: true})), {action: 'allow'});
  assert.deepEqual(decide(mota('install_apk'), {serials: ['A']}, ctx({planApproved: true})), {action: 'allow'});
});

test('data loss asks even after the plan, unless allowed for the conversation', () => {
  const d = decide(mota('clear_app_data'), {serial: 'A', package: 'com.shop'}, ctx({planApproved: true}));
  assert.equal(d.kind, 'data-loss'); assert.match(d.reason, /Clears all data of com\.shop/);
  assert.equal(decide(mota('clear_app_data'), {serial: 'A'}, ctx({planApproved: true, allowedForConversation: new Set([mota('clear_app_data')])})).action, 'allow');
  assert.equal(decide(mota('uninstall_app'), {serial: 'A'}, ctx({permission: 'ask-data-loss'})).kind, 'data-loss');
});

test('ask only for data loss lets input and changes run without a plan', () => {
  assert.deepEqual(decide(mota('swipe'), {serial: 'A'}, ctx({permission: 'ask-data-loss'})), {action: 'allow'});
  assert.deepEqual(decide(mota('write_flow'), {path: 'new.yaml'}, ctx({permission: 'ask-data-loss'})), {action: 'allow'});
});

test('writing flows: new files are changes, overwrites are data loss, outside .maestro is refused', () => {
  const c = {workspaceRoot: '/ws', flowsFolder: '/ws/.maestro', exists: p => existing.has(p)};
  assert.equal(riskOf(mota('write_flow'), {path: 'new.yaml'}, c), 'change');
  assert.equal(riskOf(mota('write_flow'), {path: 'login.yaml'}, c), 'data-loss');
  assert.equal(riskOf('Edit', {file_path: '/ws/.maestro/login.yaml'}, c), 'data-loss');
  assert.equal(riskOf('Write', {file_path: '/ws/.maestro/sub/new.yaml'}, c), 'change');
  assert.equal(decide('Write', {file_path: '/ws/src/app.ts'}, ctx({planApproved: true})).action, 'deny');
  assert.equal(decide('Write', {file_path: '/ws/.maestro/../src/x.yaml'}, ctx({planApproved: true})).action, 'deny');
  assert.equal(decide('Read', {file_path: '/etc/passwd'}, ctx()).action, 'deny');
});

test('anything else is refused: shell, web, unknown MoTA tools', () => {
  assert.equal(decide('Bash', {command: 'ls'}, ctx({permission: 'ask-data-loss'})).action, 'deny');
  assert.equal(decide('WebFetch', {url: 'x'}, ctx({permission: 'ask-data-loss'})).action, 'deny');
  assert.equal(decide(mota('format_phone'), {}, ctx({permission: 'ask-data-loss'})).action, 'deny');
});

test('devices outside the selected scope always ask', () => {
  const d = decide(mota('tap'), {serial: 'B'}, ctx({planApproved: true, scope: ['A']}));
  assert.equal(d.kind, 'device-change'); assert.match(d.reason, /B is outside the selected devices/);
  assert.equal(decide(mota('screenshot'), {serial: 'B'}, ctx({scope: ['A']})).action, 'allow', 'looking is fine');
  assert.deepEqual(targetSerials({serial: 'A', serials: ['A', 'C', 3]}), ['A', 'C']);
});

test('every MoTA tool has a risk level', () => {
  for (const [name, risk] of Object.entries(MOTA_TOOL_RISK)) assert.ok(['read', 'input', 'change', 'data-loss'].includes(risk), name);
});
