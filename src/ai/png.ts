import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface Raw { width: number; height: number; channels: number; pixels: Buffer }

/** Decodes an 8-bit, non-interlaced RGB/RGBA PNG (what Android `screencap -p` produces). */
export function decodePng(png: Buffer): Raw | undefined {
  if (!png.subarray(0, 8).equals(SIGNATURE)) return undefined;
  let offset = 8, width = 0, height = 0, channels = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      const depth = data[8], color = data[9], interlace = data[12];
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) return undefined;
      channels = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!width || !height || !channels || width * height > 64_000_000) return undefined;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels, pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride, prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[out + x - channels] : 0, b = y ? pixels[prev + x] : 0, c = y && x >= channels ? pixels[prev + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      pixels[out + x] = v & 255;
    }
  }
  return { width, height, channels, pixels };
}

/** Encodes RGB pixels as a PNG. */
export function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Shrinks a screenshot so its longest side is at most `maxSide`, averaging pixel blocks.
 * Image tokens grow with pixel count, so this keeps each screenshot to roughly 500–1,300 tokens.
 * Returns the original when it is already small or in a format this decoder does not handle.
 */
export function downscalePng(png: Buffer, maxSide: number): { png: Buffer; width: number; height: number; scale: number } {
  const img = decodePng(png);
  const original = { png, width: img?.width ?? 0, height: img?.height ?? 0, scale: 1 };
  if (!img || Math.max(img.width, img.height) <= maxSide) return original;
  const k = Math.ceil(Math.max(img.width, img.height) / maxSide);
  const w = Math.floor(img.width / k), h = Math.floor(img.height / k), out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
      const i = ((y * k + dy) * img.width + (x * k + dx)) * img.channels;
      r += img.pixels[i]; g += img.pixels[i + 1]; b += img.pixels[i + 2];
    }
    const o = (y * w + x) * 3, n = k * k;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return { png: encodePng(w, h, out), width: w, height: h, scale: k };
}

let table: Int32Array | undefined;
function crc32(data: Buffer) {
  table ??= Int32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  let c = -1;
  for (const byte of data) c = table[(c ^ byte) & 255] ^ (c >>> 8);
  return c ^ -1;
}
