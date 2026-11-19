const {test} = require('node:test');
const assert = require('node:assert/strict');
const {isAiMessage, aiHost} = require('../out/webview/aiLink');
const {claudeBarMarkup} = require('../out/webview/claudeBar');
const {farmHtml} = require('../out/webview/farmView');
const {themedPage, esc} = require('../out/webview/page');
const {TOKEN_CAPS, DEFAULT_PERMISSION} = require('../out/ai/protocol');

const scriptOf = html => html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];

test('AI and test-run messages are routed by their type prefix only', () => {
  for (const m of [{type: 'ai/send'}, {type: 'ai/approve'}, {type: 'test/start'}]) assert.ok(isAiMessage(m));
  for (const m of [{action: 'ai/send'}, {type: 'aix'}, {type: 'console-run'}, null, 'ai/send', {type: 3}]) assert.ok(!isAiMessage(m));
});

test('the stub host answers instead of leaving the Claude bar waiting', () => {
  const posted = [];
  const fakeContext = {}, fakeAdb = {};
  const link = aiHost(fakeContext, fakeAdb).connect(m => posted.push(m));
  link.handle({type: 'ai/send', text: 'hi', mode: 'claude', scope: {serials: []}, permission: 'ask-task', model: '', tokenCap: 40000});
  link.handle({type: 'ai/list'});
  link.handle({type: 'test/flows'});
  link.dispose();
  const types = posted.map(m => m.type);
  assert.ok(types.includes('ai/models'));
  const done = posted.find(m => m.type === 'ai/done');
  assert.equal(done.outcome, 'error');
  assert.match(done.message, /isn't connected/);
  assert.deepEqual(posted.find(m => m.type === 'ai/conversations').items, []);
  assert.ok(posted.find(m => m.type === 'test/flows').error);
});

test('Claude bar offers every token cap and all three permission levels, ADB tab only when asked', () => {
  const html = claudeBarMarkup({adb: true});
  for (const c of TOKEN_CAPS) assert.ok(html.includes(`data-cap="${c.tokens}"`), `cap ${c.tokens}`);
  for (const p of ['ask-task', 'ask-data-loss', 'read-only']) assert.ok(html.includes(`data-perm="${p}"`));
  assert.equal(DEFAULT_PERMISSION, 'ask-task');
  assert.ok(html.includes('id="adbcon" open'), 'console is embedded open');
  assert.ok(!claudeBarMarkup().includes('id="adbcon"'), 'no console without adb');
});

test('farm page keeps the element ids the ADB console and host rely on, and its script parses', () => {
  const html = farmHtml('vscode-resource:');
  for (const id of ['adbcon', 'contarget', 'conline', 'conout', 'conerr', 'conbadge', 'constopall', 'error', 'qrimg', 'provimg', 'provaddr', 'livecanvas', 'liveimg', 'aiText', 'aiDock'])
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  assert.match(html, /script-src 'nonce-[^']+'/);
  assert.match(html, /img-src data: blob: vscode-resource:/);
  assert.doesNotThrow(() => new Function(scriptOf(html)));
});

test('themed pages escape titles and share one nonce between CSP and script', () => {
  const html = themedPage('<b>x</b>', '<p></p>', '', 'void 0;');
  assert.ok(!html.includes('<title><b>'));
  const nonce = html.match(/'nonce-([^']+)'/)[1];
  assert.ok(html.includes(`<script nonce="${nonce}">`));
  assert.equal(esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});

test('tests, install, monitor and controls pages all ship parseable scripts with the Claude bar', () => {
  const {testsHtml} = require('../out/webview/testsView');
  const {installHtml} = require('../out/webview/installView');
  const {monitorHtml} = require('../out/webview/monitorView');
  for (const html of [testsHtml(''), installHtml(''), monitorHtml('')]) {
    assert.ok(html.includes('id="aiDock"'));
    assert.doesNotThrow(() => new Function(scriptOf(html)));
  }
});
