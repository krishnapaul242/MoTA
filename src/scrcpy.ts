import { ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { connect, Socket } from 'node:net';
import { randomInt } from 'node:crypto';
import { Adb } from './adb';
import { AccessUnit, AnnexBParser, avcCodec, nalType } from './h264';

/**
 * Live mirror and input through scrcpy's server (Apache-2.0, bundled in resources/). The server runs on the
 * phone as `shell` via app_process, encodes the screen with MediaCodec and injects input events directly.
 * The protocol is internal to scrcpy and changes between versions, so the bundled server is pinned to this one.
 */
export const SCRCPY_VERSION = '5.0.1';
export const SCRCPY_REMOTE = `/data/local/tmp/mota-scrcpy-${SCRCPY_VERSION}.jar`;
const CODEC_H264 = 0x68323634;

export type TouchAction = 'down' | 'up' | 'move';
const TOUCH_ACTIONS: Record<TouchAction, number> = { down: 0, up: 1, move: 2 };
/** Android key codes for the keys the live view offers. */
export const SCRCPY_KEYCODES: Record<string, number> = { home: 3, back: 4, volumeUp: 24, volumeDown: 25, recents: 187, sleep: 223, wake: 224, enter: 66, del: 67 };
/** scrcpy's pointer id for a mouse-driven finger: injected as a touchscreen finger, not a mouse. */
export const GENERIC_FINGER = -2n;

/** Server arguments after the class name. */
export function scrcpyArgs(scid: number, maxSize: number, bitRate: number, maxFps = 60) {
  return [SCRCPY_VERSION, `scid=${scid.toString(16).padStart(8, '0')}`, 'log_level=warn', 'audio=false', 'video_codec=h264', 'tunnel_forward=true',
    'control=true', 'send_device_meta=false', 'clipboard_autosync=false', 'cleanup=true', `max_size=${maxSize}`, `video_bit_rate=${bitRate}`, `max_fps=${maxFps}`];
}

export function touchMessage(action: TouchAction, pointerId: bigint, x: number, y: number, width: number, height: number, pressure = action === 'up' ? 0 : 1) {
  const b = Buffer.alloc(32);
  b.writeUInt8(2, 0); b.writeUInt8(TOUCH_ACTIONS[action], 1); b.writeBigInt64BE(pointerId, 2);
  b.writeInt32BE(Math.round(x), 10); b.writeInt32BE(Math.round(y), 14); b.writeUInt16BE(width, 18); b.writeUInt16BE(height, 20);
  b.writeUInt16BE(Math.round(Math.max(0, Math.min(1, pressure)) * 0xffff), 22); b.writeInt32BE(0, 24); b.writeInt32BE(0, 28);
  return b;
}
export function keyMessage(down: boolean, keycode: number, metaState = 0) {
  const b = Buffer.alloc(14);
  b.writeUInt8(0, 0); b.writeUInt8(down ? 0 : 1, 1); b.writeInt32BE(keycode, 2); b.writeInt32BE(0, 6); b.writeInt32BE(metaState, 10);
  return b;
}
/** Inject-text messages, split so each stays under the server's 300-byte limit without cutting a character. */
export function textMessages(text: string) {
  const out: Buffer[] = [];
  let part = '';
  const flush = () => { if (!part) return; const s = Buffer.from(part, 'utf8'); const b = Buffer.alloc(5 + s.length); b.writeUInt8(1, 0); b.writeUInt32BE(s.length, 1); s.copy(b, 5); out.push(b); part = ''; };
  for (const ch of text) { if (Buffer.byteLength(part + ch, 'utf8') > 300) flush(); part += ch; }
  flush();
  return out;
}
/** Scroll by h/v notches (range ±16), at a pixel position in a frame of width×height. */
export function scrollMessage(x: number, y: number, width: number, height: number, h: number, v: number) {
  const b = Buffer.alloc(21), fixed = (n: number) => Math.round(Math.max(-1, Math.min(1, n / 16)) * 0x7fff);
  b.writeUInt8(3, 0); b.writeInt32BE(Math.round(x), 1); b.writeInt32BE(Math.round(y), 5); b.writeUInt16BE(width, 9); b.writeUInt16BE(height, 11);
  b.writeInt16BE(fixed(h), 13); b.writeInt16BE(fixed(v), 15); b.writeInt32BE(0, 17);
  return b;
}
export const resetVideoMessage = () => Buffer.from([17]);

/** Parses scrcpy's video socket after the dummy byte: codec id, then session packets and framed media packets. */
export class ScrcpyVideoParser {
  private buffer: Buffer = Buffer.alloc(0);
  private codecChecked = false;
  private config?: Buffer;
  private codec?: string;
  push(chunk: Buffer): ({ session: { width: number; height: number } } | { unit: AccessUnit })[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const out: ({ session: { width: number; height: number } } | { unit: AccessUnit })[] = [];
    if (!this.codecChecked) {
      if (this.buffer.length < 4) return out;
      const id = this.buffer.readUInt32BE(0);
      if (id !== CODEC_H264) throw new Error(`scrcpy sent codec 0x${id.toString(16)}, expected H.264.`);
      this.buffer = this.buffer.subarray(4); this.codecChecked = true;
    }
    while (this.buffer.length >= 12) {
      if (this.buffer[0] & 0x80) {
        out.push({ session: { width: this.buffer.readUInt32BE(4), height: this.buffer.readUInt32BE(8) } });
        this.buffer = this.buffer.subarray(12); continue;
      }
      const flags = this.buffer.readBigUInt64BE(0), size = this.buffer.readUInt32BE(8);
      if (size > 32 * 1024 * 1024) throw new Error('scrcpy sent an oversized video packet.');
      if (this.buffer.length < 12 + size) break;
      const payload = Buffer.from(this.buffer.subarray(12, 12 + size));
      this.buffer = this.buffer.subarray(12 + size);
      if (flags & (1n << 62n)) { this.config = payload; this.codec = codecOf(payload) ?? this.codec; continue; }
      const key = !!(flags & (1n << 61n));
      const data = key && this.config ? Buffer.concat([this.config, payload]) : payload;
      out.push({ unit: { data: new Uint8Array(data), key, codec: key ? this.codec : undefined } });
    }
    return out;
  }
}
function codecOf(config: Buffer) {
  const parser = new AnnexBParser();
  const nals = [...parser.push(config).nals, parser.flush()].filter((n): n is Buffer => !!n);
  const sps = nals.find(n => nalType(n) === 7);
  try { return sps ? avcCodec(sps) : undefined; } catch { return undefined; }
}

export interface ScrcpyCallbacks {
  onUnit(unit: AccessUnit): void;
  /** A new capture session (start or rotation): the decoder must wait for the next key frame. */
  onSession(width: number, height: number): void;
  /** The stream ended unexpectedly after it had started. */
  onClosed(message: string): void;
}

/** One scrcpy session on one device: video plus control. `start()` rejects if the server can't start, so the caller can fall back. */
export class ScrcpySession {
  private server?: ChildProcess;
  private video?: Socket;
  private control?: Socket;
  private port = 0;
  private stopped = false;
  private stderr = '';
  width = 0;
  height = 0;
  constructor(private adb: Adb, private serial: string, private serverPath: string, private maxSize: number, private bitRate: number, private cb: ScrcpyCallbacks) {}

  get ready() { return !!this.control && !this.control.destroyed && this.width > 0; }

  async start() {
    await this.pushServer();
    if (this.stopped) throw new Error('Stopped.');
    const scid = randomInt(0, 0x7fffffff);
    const forwarded = (await this.adb.run(['-s', this.serial, 'forward', 'tcp:0', `localabstract:scrcpy_${scid.toString(16).padStart(8, '0')}`])).trim();
    this.port = Number(forwarded);
    if (!Number.isInteger(this.port) || this.port <= 0) throw new Error(`adb forward failed: ${forwarded}`);
    const server = this.server = this.adb.stream(['-s', this.serial, 'shell', `CLASSPATH=${SCRCPY_REMOTE}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', ...scrcpyArgs(scid, this.maxSize, this.bitRate)]);
    let exited = false;
    const collect = (b: Buffer) => { this.stderr = (this.stderr + b.toString()).slice(-4000); };
    server.stdout?.on('data', collect); server.stderr?.on('data', collect);
    server.on('error', e => { this.stderr += e.message; });
    server.on('close', () => { exited = true; if (!this.stopped && this.video) this.fail(); });
    let rest: Buffer;
    try {
      ({ socket: this.video, rest } = await this.connectFirst(() => exited));
      this.control = await this.connectSocket();
    } catch (e) { this.stop(); throw new Error(this.reason() || (e instanceof Error ? e.message : String(e))); }
    this.control.on('data', () => { /* device messages (clipboard, acks) are not used */ });
    this.control.on('error', () => { /* reported through the video socket */ });
    const parser = new ScrcpyVideoParser();
    this.video.on('data', chunk => {
      let items;
      try { items = parser.push(chunk); } catch (e) { this.stderr += e instanceof Error ? e.message : String(e); this.fail(); return; }
      for (const item of items) {
        if ('session' in item) { this.width = item.session.width; this.height = item.session.height; this.cb.onSession(this.width, this.height); }
        else this.cb.onUnit(item.unit);
      }
    });
    this.video.on('close', () => this.fail());
    this.video.on('error', () => { /* followed by close */ });
    if (rest.length) this.video.emit('data', rest);
    this.video.resume();
  }

  private async pushServer() {
    const local = await fs.stat(this.serverPath);
    const remote = (await this.adb.shell(this.serial, ['stat', '-c', '%s', SCRCPY_REMOTE]).catch(() => '')).trim();
    if (remote !== String(local.size)) await this.adb.run(['-s', this.serial, 'push', this.serverPath, SCRCPY_REMOTE], 60000);
  }

  /** The forward tunnel accepts connections before the server listens; the server's dummy byte proves it is there. */
  private async connectFirst(exited: () => boolean) {
    const deadline = Date.now() + 10000;
    for (;;) {
      if (this.stopped) throw new Error('Stopped.');
      if (exited()) throw new Error('scrcpy server exited.');
      const socket: Socket | undefined = await this.connectSocket().catch(() => undefined);
      if (socket) {
        const first = await new Promise<Buffer | undefined>(resolve => {
          const done = (b?: Buffer) => { socket.off('data', onData); socket.off('close', onClose); resolve(b); };
          const onData = (b: Buffer) => { socket.pause(); done(b); }, onClose = () => done(undefined);
          socket.on('data', onData); socket.on('close', onClose);
        });
        if (first?.length) return { socket, rest: first.subarray(1) };
        socket.destroy();
      }
      if (Date.now() > deadline) throw new Error('scrcpy server did not start within 10 s.');
      await new Promise(r => setTimeout(r, 100));
    }
  }
  private connectSocket() {
    return new Promise<Socket>((resolve, reject) => {
      const s = connect({ host: '127.0.0.1', port: this.port }, () => { s.off('error', reject); s.setNoDelay(true); resolve(s); });
      s.once('error', reject);
    });
  }

  private reason() {
    const lines = this.stderr.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^\s*at /.test(l));
    return lines.find(l => /ERROR|Exception|Error:/i.test(l)) || lines[lines.length - 1] || '';
  }
  private fail() {
    if (this.stopped) return;
    const message = this.reason() || 'The scrcpy stream closed.';
    this.stop();
    this.cb.onClosed(message);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.video?.destroy(); this.control?.destroy();
    this.server?.kill();
    if (this.port) void this.adb.run(['-s', this.serial, 'forward', '--remove', `tcp:${this.port}`]).catch(() => undefined);
  }

  private write(b: Buffer) { if (!this.control || this.control.destroyed) return false; this.control.write(b); return true; }
  /** Touch at a position given as fractions (0–1) of the video frame. */
  touch(action: TouchAction, fx: number, fy: number, pointerId = GENERIC_FINGER) {
    if (!this.width) return false;
    const c = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
    return this.write(touchMessage(action, pointerId, c(fx) * (this.width - 1), c(fy) * (this.height - 1), this.width, this.height));
  }
  scroll(fx: number, fy: number, h: number, v: number) {
    if (!this.width) return false;
    const c = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
    return this.write(scrollMessage(c(fx) * (this.width - 1), c(fy) * (this.height - 1), this.width, this.height, h, v));
  }
  key(name: string) {
    const code = SCRCPY_KEYCODES[name];
    if (code === undefined) return false;
    return this.write(keyMessage(true, code)) && this.write(keyMessage(false, code));
  }
  text(text: string) {
    const lines = text.split('\n');
    lines.forEach((line, i) => { for (const m of textMessages(line)) this.write(m); if (i < lines.length - 1) this.key('enter'); });
    return this.ready;
  }
  resetVideo() { return this.write(resetVideoMessage()); }
}
