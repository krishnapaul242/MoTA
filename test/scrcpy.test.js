const {test} = require('node:test');
const assert = require('node:assert/strict');
const {existsSync, statSync} = require('node:fs');
const {join} = require('node:path');
const {ScrcpyVideoParser, touchMessage, keyMessage, textMessages, scrollMessage, scrcpyArgs, SCRCPY_VERSION, GENERIC_FINGER} = require('../out/scrcpy');
const {liveTouch, liveEngine} = require('../out/liveMirror');

const header = (flags, size) => { const b = Buffer.alloc(12); b.writeBigUInt64BE(flags, 0); b.writeUInt32BE(size, 8); return b; };
const SPS = Buffer.from([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x29, 0xac]), PPS = Buffer.from([0, 0, 0, 1, 0x68, 0xee, 0x3c]);

test('the bundled scrcpy server matches the pinned protocol version', () => {
  const file = join(__dirname, '..', 'resources', `scrcpy-server-v${SCRCPY_VERSION}`);
  assert.ok(existsSync(file) && statSync(file).size > 100000);
  assert.ok(existsSync(join(__dirname, '..', 'resources', 'scrcpy-LICENSE.txt')));
  const args = scrcpyArgs(0xabc, 1920, 8000000);
  assert.equal(args[0], SCRCPY_VERSION);
  assert.ok(args.includes('scid=00000abc') && args.includes('tunnel_forward=true') && args.includes('audio=false') && args.includes('max_size=1920'));
});

test('video parser reads codec id, session size, config and frames split across chunks', () => {
  const p = new ScrcpyVideoParser();
  const session = Buffer.alloc(12); session.writeUInt32BE(0x80000000, 0); session.writeUInt32BE(720, 4); session.writeUInt32BE(1600, 8);
  const config = Buffer.concat([SPS, PPS]);
  const idr = Buffer.from([0, 0, 0, 1, 0x65, 1, 2, 3]), delta = Buffer.from([0, 0, 0, 1, 0x41, 9]);
  const stream = Buffer.concat([Buffer.from('h264'), session, header(1n << 62n, config.length), config, header((1n << 61n) | 1000n, idr.length), idr, header(2000n, delta.length), delta]);
  const out = [];
  for (let i = 0; i < stream.length; i += 5) out.push(...p.push(stream.subarray(i, i + 5)));
  assert.deepEqual(out[0], {session: {width: 720, height: 1600}});
  assert.equal(out.length, 3);
  assert.equal(out[1].unit.key, true);
  assert.equal(out[1].unit.codec, 'avc1.640029');
  assert.deepEqual(Buffer.from(out[1].unit.data), Buffer.concat([config, idr]), 'key frames carry SPS/PPS');
  assert.equal(out[2].unit.key, false);
  assert.equal(out[2].unit.codec, undefined);
  assert.deepEqual(Buffer.from(out[2].unit.data), delta);
});

test('video parser rejects a non-H.264 stream', () => {
  assert.throws(() => new ScrcpyVideoParser().push(Buffer.from('av1\0'.split('').reverse().join(''))), /expected H.264/);
});

test('control messages follow the scrcpy wire format', () => {
  const t = touchMessage('move', GENERIC_FINGER, 100, 200, 720, 1600);
  assert.equal(t.length, 32);
  assert.deepEqual([t[0], t[1]], [2, 2]);
  assert.equal(t.readBigInt64BE(2), -2n);
  assert.deepEqual([t.readInt32BE(10), t.readInt32BE(14), t.readUInt16BE(18), t.readUInt16BE(20), t.readUInt16BE(22)], [100, 200, 720, 1600, 0xffff]);
  assert.equal(touchMessage('up', 0n, 0, 0, 1, 1).readUInt16BE(22), 0, 'no pressure on release');
  const k = keyMessage(false, 4);
  assert.deepEqual([k.length, k[0], k[1], k.readInt32BE(2)], [14, 0, 1, 4]);
  const s = scrollMessage(10, 20, 720, 1600, 0, -1);
  assert.deepEqual([s.length, s[0], s.readInt16BE(13), s.readInt16BE(15)], [21, 3, 0, Math.round(-0x7fff / 16)]);
});

test('text is split under 300 bytes without cutting a character', () => {
  const parts = textMessages('é'.repeat(200));
  assert.equal(parts.length, 2);
  for (const b of parts) { assert.equal(b[0], 1); assert.ok(b.readUInt32BE(1) <= 300); }
  assert.equal(parts.map(b => b.subarray(5).toString('utf8')).join(''), 'é'.repeat(200));
  assert.deepEqual(textMessages(''), []);
});

test('touch messages from the page are validated', () => {
  assert.deepEqual(liveTouch({type: 'down', x: 0.5, y: 0.25, id: -2}), {type: 'down', x: 0.5, y: 0.25, id: -2});
  for (const bad of [{type: 'tap', x: 0, y: 0}, {type: 'up', x: 'a', y: 0}, {type: 'up', x: 5, y: 0}, {type: 'move', x: 0, y: 0, id: 1e9}, null])
    assert.equal(liveTouch(bad), undefined);
  const cfg = v => ({workspace: {getConfiguration: () => ({get: (_k, d) => v ?? d})}});
  assert.equal(liveEngine(cfg()), 'scrcpy');
  assert.equal(liveEngine(cfg('screenrecord')), 'screenrecord');
  assert.equal(liveEngine(cfg('other')), 'scrcpy');
});
