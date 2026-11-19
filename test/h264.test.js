const {test} = require('node:test');
const assert = require('node:assert/strict');
const {AnnexBParser,AccessUnitBuilder,avcCodec,streamSize} = require('../out/h264');
const nal = (type, len, fill = 7) => Buffer.from([type, ...Array(len).fill(fill)]);
const stream = nals => Buffer.concat(nals.flatMap((n, i) => [Buffer.from(i % 2 ? [0,0,1] : [0,0,0,1]), n]));
const sps = Buffer.from([0x67,0x64,0x00,0x2a,0xac,0x2b]), pps = Buffer.from([0x68,0xee,0x3c,0x80]);
test('Annex B parser yields identical NAL units however the stream is chunked', () => {
  const nals = [sps, pps, nal(0x65, 900), nal(0x41, 50), nal(0x41, 3000, 0), nal(0x41, 20)].map(n => n[n.length-1] === 0 ? Buffer.concat([n, Buffer.from([9])]) : n);
  const data = stream(nals);
  for (const size of [1, 2, 3, 5, 64, 1000, data.length]) {
    const p = new AnnexBParser(), out = [];
    for (let i = 0; i < data.length; i += size) { const r = p.push(data.subarray(i, i + size)); assert.equal(r.corrupt, false); out.push(...r.nals); }
    out.push(p.flush());
    assert.deepEqual(out, nals, `chunk size ${size}`);
  }
});
test('idle flush emits the last frame and detects a frame that was cut short', () => {
  const p = new AnnexBParser();
  assert.deepEqual(p.push(stream([nal(0x41, 10)])).nals, []);
  assert.deepEqual(p.flush(), nal(0x41, 10));
  assert.equal(p.push(stream([nal(0x41, 4)])).corrupt, false, 'next frame after a clean flush');
  p.flush();
  assert.equal(p.push(Buffer.from([5,5,0,0,1,0x41,1])).corrupt, true, 'leftover bytes of a flushed frame');
});
test('access units carry parameter sets with the key frame and expose the codec', () => {
  const b = new AccessUnitBuilder();
  assert.equal(b.push(sps), undefined); assert.equal(b.push(pps), undefined);
  const key = b.push(nal(0x65, 4));
  assert.equal(key.key, true); assert.equal(key.codec, 'avc1.64002a');
  assert.deepEqual(Buffer.from(key.data), Buffer.concat([sps, pps, nal(0x65, 4)].flatMap(n => [Buffer.from([0,0,0,1]), n])));
  const delta = b.push(nal(0x41, 4));
  assert.equal(delta.key, false); assert.equal(delta.codec, undefined);
  assert.throws(() => avcCodec(pps));
});
test('stream size keeps native resolution when small and scales large screens evenly', () => {
  assert.deepEqual(streamSize(720, 1560), [720, 1560]);
  assert.deepEqual(streamSize(1440, 3200), [864, 1920]);
  assert.deepEqual(streamSize(1081, 2401), [864, 1920]);
});
