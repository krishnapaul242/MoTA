import { ChildProcess } from 'node:child_process';
import { Adb } from './adb';

/** Splits an H.264 Annex B byte stream into NAL units (returned without start codes). */
export class AnnexBParser {
  private buffer: Buffer = Buffer.alloc(0);
  /** The buffer begins with a start code. */
  private synced = false;
  /** The previous NAL was emitted by flush(), so it may have been cut short. */
  private flushed = false;
  /** Returns NAL units completed by this chunk. `corrupt` means bytes arrived that continue a NAL already flushed as complete. */
  push(chunk: Buffer): { nals: Buffer[]; corrupt: boolean } {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const starts: number[] = [];
    for (let i = 0; i + 2 < this.buffer.length; i++) if (this.buffer[i] === 0 && this.buffer[i + 1] === 0 && this.buffer[i + 2] === 1) { starts.push(i); i += 2; }
    const leading = this.synced ? 0 : starts.length ? starts[0] : Math.max(0, this.buffer.length - 2);
    const corrupt = this.flushed && trimZeros(this.buffer.subarray(0, leading)).length > 0;
    if (!starts.length) { if (!this.synced) this.buffer = this.buffer.subarray(leading); return { nals: [], corrupt }; }
    const nals: Buffer[] = [];
    for (let i = 0; i < starts.length - 1; i++) {
      const nal = trimZeros(this.buffer.subarray(starts[i] + 3, starts[i + 1]));
      if (nal.length) nals.push(Buffer.from(nal));
    }
    this.buffer = this.buffer.subarray(starts[starts.length - 1]);
    this.synced = true; this.flushed = false;
    return { nals, corrupt };
  }
  /** Treats the buffered tail as a complete NAL. Call when the stream goes idle, so the last frame of a burst is shown. */
  flush(): Buffer | undefined {
    if (!this.synced) return undefined;
    const nal = trimZeros(this.buffer.subarray(3));
    this.buffer = Buffer.alloc(0); this.synced = false; this.flushed = true;
    return nal.length ? Buffer.from(nal) : undefined;
  }
}
function trimZeros(b: Buffer) { let end = b.length; while (end > 0 && b[end - 1] === 0) end--; return b.subarray(0, end); }

export const nalType = (nal: Buffer) => nal[0] & 0x1f;
/** WebCodecs codec string (avc1.PPCCLL) from an SPS NAL unit. */
export function avcCodec(sps: Buffer) {
  if (sps.length < 4 || nalType(sps) !== 7) throw new Error('Not an SPS NAL unit.');
  return 'avc1.' + [1, 2, 3].map(i => sps[i].toString(16).padStart(2, '0')).join('');
}
/** Encoder-friendly stream size: native when small enough, otherwise scaled to `max` on the long side; even dimensions. */
export function streamSize(width: number, height: number, max = 1920): [number, number] {
  const scale = Math.min(1, max / Math.max(width, height));
  const even = (v: number) => Math.max(2, Math.round(v * scale / 2) * 2);
  return [even(width), even(height)];
}

export interface AccessUnit { data: Uint8Array; key: boolean; codec?: string }
const START = Buffer.from([0, 0, 0, 1]);

/** Groups NAL units into decodable access units: parameter sets and SEI travel with the next picture. */
export class AccessUnitBuilder {
  private pending: Buffer[] = [];
  private codec?: string;
  push(nal: Buffer): AccessUnit | undefined {
    const type = nalType(nal);
    if (type === 7) { try { this.codec = avcCodec(nal); } catch { /* keep previous */ } }
    if (type === 9) return undefined; // access unit delimiter
    if (type !== 1 && type !== 5) { this.pending.push(nal); return undefined; }
    const data = Buffer.concat([...this.pending, nal].flatMap(n => [START, n]));
    this.pending = [];
    return { data: new Uint8Array(data), key: type === 5, codec: type === 5 ? this.codec : undefined };
  }
}

/**
 * Live H.264 mirror using Android's built-in screenrecord. screenrecord stops after its time limit, so the
 * stream restarts while active; each start begins with SPS/PPS and a key frame.
 */
export class ScreenMirror {
  private child?: ChildProcess;
  private stopped = false;
  private quickFailures = 0;
  private useSize = true;
  constructor(private adb: Adb, private serial: string, private size: [number, number] | undefined, private bitRate: number,
    private onUnit: (unit: AccessUnit) => void, private onRestart: () => void, private onFail: (message: string) => void) {}
  start() { this.stopped = false; this.spawn(); }
  stop() { this.stopped = true; this.child?.kill(); this.child = undefined; }
  /** Restart to get a fresh key frame (after a decoder error or a corrupt NAL). */
  restart() { this.child?.kill(); }
  private spawn() {
    const args = ['-s', this.serial, 'exec-out', 'screenrecord', '--output-format=h264', '--bit-rate', String(this.bitRate)];
    if (this.size && this.useSize) args.push('--size', `${this.size[0]}x${this.size[1]}`);
    args.push('-');
    const child = this.child = this.adb.stream(args);
    const parser = new AnnexBParser(), units = new AccessUnitBuilder();
    const started = Date.now();
    let stderr = '', idle: ReturnType<typeof setTimeout> | undefined, received = false;
    const emit = (nal: Buffer) => { const unit = units.push(nal); if (unit) this.onUnit(unit); };
    this.onRestart();
    child.stdout?.on('data', (chunk: Buffer) => {
      received = true;
      if (idle) clearTimeout(idle);
      const { nals, corrupt } = parser.push(chunk);
      if (corrupt) { child.kill(); return; }
      nals.forEach(emit);
      idle = setTimeout(() => { const nal = parser.flush(); if (nal) emit(nal); }, 30);
    });
    child.stderr?.on('data', b => { stderr = (stderr + b.toString()).slice(-2000); });
    child.on('error', e => { stderr = e.message; });
    child.on('close', () => {
      if (idle) clearTimeout(idle);
      if (this.stopped || this.child !== child) return;
      if (Date.now() - started < 3000 && !received) {
        if (this.useSize && this.size) { this.useSize = false; this.spawn(); return; } // encoder rejected the size
        if (++this.quickFailures >= 3) { this.onFail(stderr.trim() || 'screenrecord stopped. This device may not support H.264 streaming.'); return; }
      } else this.quickFailures = 0;
      setTimeout(() => { if (!this.stopped && this.child === child) this.spawn(); }, 200);
    });
  }
}
