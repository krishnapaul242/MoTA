import { Adb } from './adb';
import { AccessUnit, ScreenMirror } from './h264';
import { GENERIC_FINGER, ScrcpySession, TouchAction } from './scrcpy';

export type LiveEngine = 'scrcpy' | 'screenrecord';
export interface LiveMirrorCallbacks {
  onUnit(unit: AccessUnit): void;
  /** The decoder must wait for a key frame; `session` means the frame size may have changed (start, rotation). */
  onReset(session: boolean): void;
  /** Which engine is streaming: scrcpy also takes live touch, keys and text. */
  onMode(engine: LiveEngine, note?: string): void;
  /** Neither engine can stream; the page falls back to screenshots. */
  onFail(message: string): void;
}

/**
 * Live screen for one device: scrcpy's server when it starts (video plus fast input), otherwise Android's
 * screenrecord (video only; input then goes through `adb shell input`).
 */
export class LiveMirror {
  private scrcpy?: ScrcpySession;
  private fallback?: ScreenMirror;
  private stopped = false;
  constructor(private adb: Adb, private serial: string, private opts: { serverPath: string; size?: [number, number]; bitRate: number; engine: LiveEngine }, private cb: LiveMirrorCallbacks) {}

  get engine(): LiveEngine | undefined { return this.scrcpy ? 'scrcpy' : this.fallback ? 'screenrecord' : undefined; }

  start() {
    if (this.opts.engine === 'screenrecord') { this.startFallback(); return; }
    const maxSize = this.opts.size ? Math.max(...this.opts.size) : 1920;
    const session = this.scrcpy = new ScrcpySession(this.adb, this.serial, this.opts.serverPath, maxSize, this.opts.bitRate, {
      onUnit: u => { if (this.scrcpy === session) this.cb.onUnit(u); },
      onSession: () => { if (this.scrcpy === session) this.cb.onReset(true); },
      onClosed: message => { if (this.scrcpy !== session || this.stopped) return; this.scrcpy = undefined; this.startFallback(`scrcpy stopped (${message}), so the view switched to screenrecord.`); },
    });
    session.start().then(
      () => { if (this.scrcpy === session && !this.stopped) this.cb.onMode('scrcpy'); },
      e => { if (this.scrcpy !== session || this.stopped) return; this.scrcpy = undefined; this.startFallback(`scrcpy couldn't start (${e instanceof Error ? e.message : String(e)}), so the view uses screenrecord.`); });
  }
  private startFallback(note?: string) {
    if (this.stopped) return;
    const mirror = this.fallback = new ScreenMirror(this.adb, this.serial, this.opts.size, this.opts.bitRate,
      u => { if (this.fallback === mirror) this.cb.onUnit(u); },
      () => { if (this.fallback === mirror) this.cb.onReset(false); },
      text => { if (this.fallback !== mirror) return; this.fallback = undefined; this.cb.onFail(text); });
    mirror.start();
    this.cb.onMode('screenrecord', note);
  }
  stop() { this.stopped = true; this.scrcpy?.stop(); this.scrcpy = undefined; this.fallback?.stop(); this.fallback = undefined; }
  /** After a decoder error: ask for a fresh key frame. */
  restart() { if (this.scrcpy) this.scrcpy.resetVideo(); else this.fallback?.restart(); }

  /** Input through scrcpy; each returns false when scrcpy isn't streaming, so the caller uses adb input instead. */
  touch(action: TouchAction, fx: number, fy: number, id: number) { return !!this.scrcpy?.ready && this.scrcpy.touch(action, fx, fy, id < 0 ? GENERIC_FINGER : BigInt(Math.trunc(id))); }
  scroll(fx: number, fy: number, h: number, v: number) { return !!this.scrcpy?.ready && this.scrcpy.scroll(fx, fy, h, v); }
  key(name: string) { return !!this.scrcpy?.ready && this.scrcpy.key(name); }
  text(text: string) { return !!this.scrcpy?.ready && this.scrcpy.text(text); }
}

/** The `mota.liveEngine` setting: scrcpy (default) or screenrecord. */
export function liveEngine(vscode: { workspace: { getConfiguration(section: string): { get<T>(key: string, fallback: T): T } } }): LiveEngine {
  return vscode.workspace.getConfiguration('mota').get<string>('liveEngine', 'scrcpy') === 'screenrecord' ? 'screenrecord' : 'scrcpy';
}

/** Validates a webview touch/scroll message; returns undefined when malformed. */
export function liveTouch(m: any): { type: TouchAction; x: number; y: number; id: number } | undefined {
  if (!m || !['down', 'up', 'move'].includes(m.type)) return undefined;
  const x = Number(m.x), y = Number(m.y), id = Number(m.id ?? -2);
  if (![x, y, id].every(Number.isFinite) || x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1 || Math.abs(id) > 1e6) return undefined;
  return { type: m.type, x, y, id };
}
