import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { Adb } from './adb';
export const HELPER_PACKAGE = 'dev.mota.recorder';
export const HELPER_VERSION = '0.3.0';
export interface HelperStatus {
  protocol: number; version: string; ready: boolean; mode?: string; recording?: boolean; playing?: boolean;
  paused?: boolean; busy?: boolean; videoActive?: boolean; videoPaused?: boolean; overlayExpanded?: boolean; message?: string; width: number; height: number;
  rotation: number; captureOwner?: string; videoStatus?: string; session?: string; actions?: number; uptimeStartMs?: number; replayIndex?: number; replayTotal?: number;
}
export interface HelperFile { path: string; size: number }
export function parseBootstrap(output: string) {
  const match = output.match(/\bbridge=([A-Za-z0-9+/=]+)/);
  if (!match) throw new Error('Helper bridge unavailable. Run Set up recorder helper, then enable its accessibility service.');
  const value = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  if (value.protocol !== 1 || value.version !== HELPER_VERSION || value.socket !== 'mota.recorder' || typeof value.token !== 'string' || value.token.length < 40) throw new Error('Helper version mismatch. Run Set up recorder helper to update it.');
  return value as { protocol: number; version: string; socket: string; token: string; ready: boolean };
}
/** Short-lived loopback sockets; secrets stay in memory and never enter command arguments. */
export class HelperClient {
  private port?: number;
  private token = '';
  private disposed = false;
  constructor(private adb: Adb, readonly serial: string) {}
  async connect() {
    if (this.disposed) throw new Error('Helper connection closed.');
    const info = parseBootstrap(await this.adb.shell(this.serial, ['content', 'query', '--uri', 'content://dev.mota.recorder.bridge/bootstrap']));
    this.token = info.token;
    const result = await this.adb.run(['-s', this.serial, 'forward', 'tcp:0', `localabstract:${info.socket}`]);
    if (!/^\d+$/.test(result) || +result < 1 || +result > 65535) throw new Error('ADB did not allocate a helper forwarding port.');
    this.port = +result;
    try { return await this.request<HelperStatus>('status'); } catch (e) { await this.dispose(); throw e; }
  }
  request<T = HelperStatus>(op: string, params: object = {}): Promise<T> {
    if (this.disposed || !this.port) return Promise.reject(new Error('Helper is not connected.'));
    const port = this.port;
    const id = randomUUID(), payload = JSON.stringify({ id, token: this.token, op, params }) + '\n';
    if (Buffer.byteLength(payload) > 8 * 1024 * 1024) return Promise.reject(new Error('Helper request exceeds 8 MB.'));
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      const chunks: Buffer[] = []; let size = 0, done = false;
      const finish = (error?: Error, value?: T) => { if (done) return; done = true; socket.destroy(); error ? reject(error) : resolve(value!); };
      socket.setTimeout(15000, () => finish(new Error('Helper timed out. Check the device connection.')));
      socket.on('connect', () => socket.write(payload));
      socket.on('error', () => finish(new Error('Helper disconnected. Reconnect the device and reopen Recordings.')));
      socket.on('data', chunk => {
        chunks.push(chunk); size += chunk.length;
        if (size > 8 * 1024 * 1024) { finish(new Error('Helper response too large.')); return; }
        if (!chunk.includes(10)) return;
        try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8').split('\n')[0]);
          if (value.id !== id) throw new Error('Unexpected helper response.');
          if (typeof value.error === 'string') throw new Error(value.error);
          if (!value.result || typeof value.result !== 'object') throw new Error('Invalid helper response.');
          finish(undefined, value.result);
        } catch (e) { finish(e instanceof Error ? e : new Error('Invalid helper response.')); }
      });
      socket.on('close', () => finish(new Error('Helper closed the connection.')));
    });
  }
  async dispose() {
    if (this.disposed) return; this.disposed = true; this.token = '';
    if (this.port) { const port = this.port; this.port = undefined; await this.adb.run(['-s', this.serial, 'forward', '--remove', `tcp:${port}`]).catch(() => {}); }
  }
}
