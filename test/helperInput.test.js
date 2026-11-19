const {test} = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const {isInputBlocked, gestureParams, helperInputError, InputRouter} = require('../out/helperInput');

const XIAOMI = 'java.lang.SecurityException: Injecting to another application requires INJECT_EVENTS permission\n\tat android.os.Parcel.createException(Parcel.java:2074)';

test('only the Xiaomi injection error switches input to the helper', () => {
  assert.ok(isInputBlocked(new Error(XIAOMI)));
  assert.ok(!isInputBlocked(new Error('error: device offline')));
  assert.ok(!isInputBlocked(new Error('Invalid screen coordinates.')));
});

test('gesture parameters mirror validated input arguments', () => {
  assert.deepEqual(gestureParams(['input', 'tap', '10', '20']), {type: 'tap', x: 10, y: 20});
  assert.deepEqual(gestureParams(['input', 'swipe', '1', '2', '3', '4', '250']), {type: 'swipe', x: 1, y: 2, x2: 3, y2: 4, duration: 250});
});

test('helper failures say what to fix on the phone', () => {
  assert.match(helperInputError(new Error('Enable MoTA Recorder in Accessibility settings')), /Turn on MoTA Recorder in the phone's Accessibility settings/);
  assert.match(helperInputError(new Error('Helper bridge unavailable. Run Set up recorder helper')), /Set Up Recorder Helper/);
  assert.match(helperInputError(new Error('Tap a text field on the device first')), /Tap a text field/);
});

/** Fake phone: `adb shell input` fails like Xiaomi; the helper bridge records requests. */
async function fakePhone(reply = () => ({ok: true})) {
  const requests = [];
  const server = net.createServer(socket => { let buffer = ''; socket.on('data', chunk => { buffer += chunk; if (!buffer.includes('\n')) return;
    const r = JSON.parse(buffer); requests.push(r);
    const result = r.op === 'status' ? {protocol: 1, version: '0.4.0', ready: true} : reply(r);
    socket.end(JSON.stringify(result.error ? {id: r.id, error: result.error} : {id: r.id, result}) + '\n'); }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const bootstrap = {protocol: 1, version: '0.4.0', socket: 'mota.recorder', token: 'x'.repeat(44), ready: true};
  const shells = [];
  const adb = {
    shell: async (serial, args) => {
      if (args[0] === 'content') return 'Row: 0 bridge=' + Buffer.from(JSON.stringify(bootstrap)).toString('base64');
      shells.push(args); throw new Error(XIAOMI);
    },
    run: async args => args.includes('--remove') ? '' : String(server.address().port),
  };
  return {adb, requests, shells, close: () => new Promise(r => server.close(r))};
}

test('blocked adb input falls back to the helper and stays there', async () => {
  const phone = await fakePhone();
  const router = new InputRouter(phone.adb);
  try {
    await router.send('redmi', ['input', 'tap', '5', '6'], {type: 'tap', x: 5, y: 6});
    await router.send('redmi', ['input', 'keyevent', 'KEYCODE_HOME'], {type: 'key', key: 'home'});
    assert.equal(phone.shells.length, 1, 'adb input is tried once, then skipped');
    assert.ok(router.usesHelper('redmi'));
    const inputs = phone.requests.filter(r => r.op === 'input').map(r => r.params);
    assert.deepEqual(inputs, [{type: 'tap', x: 5, y: 6}, {type: 'key', key: 'home'}]);
  } finally { await router.dispose(); await phone.close(); }
});

test('helper errors are explained, and other adb errors are not hidden', async () => {
  const phone = await fakePhone(() => ({error: 'Enable MoTA Recorder in Accessibility settings'}));
  const router = new InputRouter(phone.adb);
  try { await assert.rejects(router.send('redmi', ['input', 'tap', '1', '1'], {type: 'tap', x: 1, y: 1}), /Turn on MoTA Recorder/); }
  finally { await router.dispose(); await phone.close(); }
  const offline = new InputRouter({shell: async () => { throw new Error('error: device offline'); }, run: async () => ''});
  await assert.rejects(offline.send('x', ['input', 'tap', '1', '1'], {type: 'tap', x: 1, y: 1}), /device offline/);
  assert.ok(!offline.usesHelper('x'));
});
