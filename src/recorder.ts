import { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { Adb, Device } from './adb';
import { HelperClient, HelperFile, HelperStatus } from './helperClient';
import { Action, Display, InputDecoder, TouchDevice, touchDevices } from './inputEvents';
export interface SessionData extends Display { schemaVersion: 1; actions: Action[]; screenshots?: { file: string; atMs: number; actionIndex: number }[]; [key: string]: unknown }
export interface RecordingMeta { id: string; name: string; device: string; identity: string; model: string; createdAt: string; mode: string; targetPackage?: string; complete: boolean; error?: string }
export interface Recording { dir: string; meta: RecordingMeta; data: SessionData }
const MAX_JSON = 7 * 1024 * 1024;
const fileAllowed = (p: string) => /^(actions\.json|session\.json|screen\.mp4|screenshots\/\d+\.png)$/.test(p);
export function validateSession(value: unknown): SessionData {
  const d = value as SessionData;
  const integer = (x: unknown, min: number, max: number) => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;
  if (!d || d.schemaVersion !== 1 || !integer(d.width, 1, 20000) || !integer(d.height, 1, 20000) || !integer(d.rotation, 0, 3) || !Array.isArray(d.actions) || d.actions.length > 10000) throw new Error('Invalid recording schema or display dimensions.');
  let duration = 0;
  for (const a of d.actions) {
    if (!a || !integer(a.atMs, 0, 86400000) || !integer(a.delayMs, 0, 86400000)) throw new Error('Invalid action timing.');
    duration += a.delayMs;
    if (a.type === 'gesture') {
      if (a.width !== d.width || a.height !== d.height || a.rotation !== d.rotation || a.dispatch !== 'completed' || !Array.isArray(a.strokes) || !a.strokes.length || a.strokes.length > 10) throw new Error('Incomplete gesture or mismatched display.');
      let count = 0, end = 0;
      for (const s of a.strokes) {
        if (!integer(s.startMs, 0, 59000) || !integer(s.durationMs, 1, 60000) || s.startMs + s.durationMs > 60000 || !Array.isArray(s.points) || !s.points.length) throw new Error('Invalid gesture stroke.');
        let t = -1;
        for (const p of s.points) {
          if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite) || p[0] < 0 || p[0] >= d.width || p[1] < 0 || p[1] >= d.height || p[2] < t || p[2] < s.startMs || p[2] > s.startMs + s.durationMs) throw new Error('Invalid touch samples.');
          t = p[2]; if (++count > 20000) throw new Error('Too many gesture samples.');
        }
        end = Math.max(end, s.startMs + s.durationMs);
      }
      duration += end;
    } else if (a.type === 'global') { if (![1, 2, 3].includes(a.action)) throw new Error('Unsupported navigation action.'); }
    else if (a.type === 'volume') { if (![24, 25].includes(a.keyCode)) throw new Error('Unsupported volume key.'); }
    else if (a.type === 'text') { if (typeof a.text !== 'string' || a.text.length > 100000) throw new Error('Invalid text action.'); }
    else throw new Error('Unsupported action type.');
  }
  if (duration > 86400000 || Buffer.byteLength(JSON.stringify(d)) > MAX_JSON) throw new Error('Recording is too large or longer than 24 hours.');
  if (d.screenshots !== undefined && (!Array.isArray(d.screenshots) || d.screenshots.length > 10000 || d.screenshots.some(s => !s || !/^screenshots\/\d+\.png$/.test(s.file) || !Number.isFinite(s.atMs) || !Number.isInteger(s.actionIndex)))) throw new Error('Invalid screenshot references.');
  return d;
}
export async function readJson(path: string) {
  if ((await fs.stat(path)).size > MAX_JSON) throw new Error('Recording JSON exceeds 7 MB.');
  return JSON.parse(await fs.readFile(path, 'utf8'));
}
export async function atomicJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); await fs.rename(temp, path);
}
export function assertReplay(record: Recording, device: Device, identity: string, display: Display) {
  if (!record.meta.complete) throw new Error('This recording is incomplete and cannot be replayed.');
  if (record.meta.identity !== identity) throw new Error('Replay is restricted to the device this recording belongs to.');
  if (!record.data.actions.length) throw new Error('Recording contains no replayable actions.');
  if (record.data.width !== display.width || record.data.height !== display.height || record.data.rotation !== display.rotation) throw new Error('Restore the recorded screen size and orientation before replay.');
  validateSession(record.data);
}
export class RecordingStore {
  constructor(readonly root: string) {}
  async create(meta: Omit<RecordingMeta, 'id' | 'createdAt'>) {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const id = `${Date.now()}-${randomUUID()}`, dir = join(this.root, id); await fs.mkdir(dir, { mode: 0o700 });
    const result: RecordingMeta = { ...meta, id, createdAt: new Date().toISOString() };
    await atomicJson(join(dir, 'session.json'), result); return { dir, meta: result };
  }
  async list(): Promise<Recording[]> {
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    const list = await Promise.all(entries.filter(e => e.isDirectory() && /^\d+-[\da-f-]+$/.test(e.name)).map(async e => {
      const dir = join(this.root, e.name);
      try { const meta = await readJson(join(dir, 'session.json')) as RecordingMeta;
        if (meta.id !== e.name || typeof meta.identity !== 'string' || typeof meta.name !== 'string') return undefined;
        try{return {dir,meta,data:validateSession(await readJson(join(dir,'actions.json')))};}
        catch(e){return {dir,meta:{...meta,complete:false,error:meta.error || (e instanceof Error?e.message:String(e))},data:{schemaVersion:1 as const,width:1,height:1,rotation:0,actions:[]}};}
      } catch { return undefined; }
    }));
    return list.filter((s): s is Recording => !!s).sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
  }
  async importZip(path: string, bound: Omit<RecordingMeta, 'id' | 'createdAt'>): Promise<Recording> {
    const staged = await this.create(bound);
    try {
      if ((await fs.stat(path)).size > 2 * 1024 ** 3) throw new Error('ZIP exceeds 2 GB.');
      await extractSessionZip(path, staged.dir);
      const data = validateSession(await readJson(join(staged.dir, 'actions.json')));
      const previous = await readJson(join(staged.dir, 'session.json')).catch(() => null);
      // Imports of a MoTA archive retain their device binding, never silently rebind it.
      if (previous?.identity && previous.identity !== bound.identity) throw new Error('Archive belongs to another device.');
      staged.meta.complete = true; await atomicJson(join(staged.dir, 'session.json'), staged.meta);
      return { ...staged, data };
    } catch (e) { await fs.rm(staged.dir, { recursive: true, force: true }); throw e; }
  }
}
async function extractSessionZip(path: string, destination: string): Promise<void> {
  const yauzl = require('yauzl');
  await new Promise<void>((resolve, reject) => yauzl.open(path, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error: Error | null, zip: any) => {
    if (error) { reject(error); return; }
    let total = 0, count = 0, failed = false; const seen = new Set<string>();
    const fail = (e: unknown) => { if (failed) return; failed = true; zip.close(); reject(e); };
    zip.on('error', fail); zip.on('end', () => { if (!failed) seen.has('actions.json') ? resolve() : reject(new Error('ZIP is missing actions.json.')); });
    zip.on('entry', (entry: any) => { void (async () => {
      const name: string = entry.fileName;
      if(++count > 10002)throw new Error('ZIP exceeds the entry limit.');
      if (name === 'screenshots/') { zip.readEntry(); return; }
      if (!fileAllowed(name) || seen.has(name) || ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) throw new Error('ZIP contains an unexpected, duplicate, or unsafe path.');
      seen.add(name); total += entry.uncompressedSize;
      if (total > 2 * 1024 ** 3 || (name.endsWith('.json') && entry.uncompressedSize > MAX_JSON)) throw new Error('ZIP exceeds the session size limit.');
      const stream = await new Promise<NodeJS.ReadableStream>((yes, no) => zip.openReadStream(entry, (e: Error | null, s: NodeJS.ReadableStream) => e ? no(e) : yes(s)));
      await fs.mkdir(join(destination, name, '..'), { recursive: true });
      await pipeline(stream, createWriteStream(join(destination, name), { mode: 0o600 }));
      if (!failed) zip.readEntry();
    })().catch(fail); }); zip.readEntry();
  }));
}
export async function deviceIdentity(adb: Adb, serial: string) {
  const id = (await adb.shell(serial, ['settings', 'get', 'secure', 'android_id'])).trim();
  if (!/^[\da-f]{16}$/i.test(id)) throw new Error('Cannot read a stable device identity; recording/replay is unavailable.');
  return id.toLowerCase() + (serial.startsWith('emulator-') ? '@' + serial : '');
}
export async function downloadSession(client: HelperClient, id: string, dir: string) {
  const { files } = await client.request<{ files: HelperFile[] }>('files', { session: id });
  if (!Array.isArray(files) || files.length > 10002) throw new Error('Invalid helper file list.');
  let total = 0; const seen = new Set<string>();
  for (const f of files) {
    if (!fileAllowed(f.path) || f.path === 'session.json' || seen.has(f.path) || !Number.isSafeInteger(f.size) || f.size < 0 || (total += f.size) > 2 * 1024 ** 3 || (f.path.endsWith('.json') && f.size > MAX_JSON)) throw new Error('Invalid helper session file.');
    seen.add(f.path); await fs.mkdir(join(dir, f.path, '..'), { recursive: true });
    const handle = await fs.open(join(dir, f.path), 'w', 0o600);
    try { let offset = 0;
      while (offset < f.size) {
        const chunk = await client.request<{ data: string; eof: boolean }>('read', { session: id, path: f.path, offset });
        if (typeof chunk.data !== 'string' || chunk.data.length > 350000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.data)) throw new Error('Invalid helper file chunk.');
        const bytes = Buffer.from(chunk.data, 'base64');
        if (!bytes.length || offset + bytes.length > f.size) throw new Error('Truncated or oversized helper file.');
        await handle.writeFile(bytes); offset += bytes.length;
      }
    } finally { await handle.close(); }
  }
  if (!seen.has('actions.json')) throw new Error('Helper session is missing actions.json.');
}
export class RawRecording {
  private child?: ChildProcess;
  private decoder?: InputDecoder;
  private lines?: ReturnType<typeof createInterface>;
  private actions: Action[] = [];
  private stopped = false;
  private stopPromise?: Promise<void>;
  private writeTail: Promise<unknown> = Promise.resolve();
  private screenshotAt = 0;
  private screenshotInFlight = false;
  private actionBytes = 0;
  private error?: string;
  private stderr = '';
  private eventLines = 0;
  constructor(private adb: Adb, private client: HelperClient, public display: HelperStatus, readonly touch: TouchDevice | TouchDevice[],
    readonly dir: string, readonly meta: RecordingMeta, private changed: () => void) {}
  get failure() { return this.error; }
  get count() { return this.actions.length; }
  get inputDevice() { return this.decoder?.activeDevice; }
  get inputDiagnostics() { return `${this.eventLines} event lines received; ${this.inputDevice ? "selected " + this.inputDevice.name + " (" + this.inputDevice.path + ")" : "no active touchscreen detected"}`; }
  abort(message:string){this.error ||= message;return this.stop();}
  async start(existing?: HelperStatus) {
    const started = existing || await this.client.request<HelperStatus>('start', { mode: 'adb' });
    if (!started.session || !Number.isFinite(started.uptimeStartMs)) throw new Error('Helper did not start the capture session.');
    this.display = started;
    this.decoder = new InputDecoder(this.touch, started, started.uptimeStartMs!, action => {
      this.actionBytes += Buffer.byteLength(JSON.stringify(action));
      if(this.actionBytes > MAX_JSON - 65536){this.error="Recording exceeds the 7 MB replay limit.";void this.stop();return;}
      this.actions.push(action);
      if (this.actions.length > 10000) { this.error = 'Recording exceeds 10,000 actions.'; void this.stop(); return; }
      this.writeTail = this.writeTail.then(() => atomicJson(join(this.dir, 'actions.json'), this.data())).catch(e => { this.error = String(e); void this.stop(); });
      if (!this.screenshotInFlight && Date.now() - this.screenshotAt > 1100) { this.screenshotInFlight=true;this.screenshotAt = Date.now(); void this.client.request('shot', { actionIndex: this.actions.length - 1 }).catch(() => {}).finally(()=>{this.screenshotInFlight=false;}); }
      this.changed();
    });
    this.child = this.adb.stream(['-s', this.client.serial, 'shell', 'getevent', '-lt']);
    this.lines = createInterface({ input: this.child.stdout! });
    this.lines.on('line', line => { if (this.stopped) return; if(line.trimStart().startsWith('['))this.eventLines++;try { this.decoder!.line(line); } catch (e) { this.error = e instanceof Error ? e.message : String(e); void this.stop(); this.changed(); } });
    this.child.stderr?.on('data', chunk => { this.stderr = (this.stderr + chunk.toString()).slice(-4096); });
    this.child.on('error', e => { this.error = e.message; void this.stop(); this.changed(); });
    this.child.on('close', () => { if (!this.stopped) { this.error = 'Input stream disconnected. ' + this.stderr; void this.stop(); this.changed(); } });
    await new Promise(resolve => setTimeout(resolve, 250));
    if (this.error) throw new Error(this.error);
  }
  data(): SessionData { return { schemaVersion: 1, width: this.display.width, height: this.display.height, rotation: this.display.rotation, captureMode: 'adb-events', inputDevice: this.inputDevice, actions: this.actions }; }
  stop() { return this.stopPromise ||= this.finishStop(); }
  private async finishStop() {
    if (this.stopped) return; this.stopped = true; this.lines?.close(); this.child?.kill();
    if (!this.actions.length && !this.decoder?.incomplete && !this.error) this.error = 'No touch or supported key events were captured. Interact directly with the selected phone or emulator screen. ' + this.inputDiagnostics;
    if (this.decoder?.incomplete && !this.error) this.error = 'Recording stopped while a finger was still down.';
    await this.client.request('stop').catch(e => { this.error ||= e.message; });
    await this.writeTail;
    await atomicJson(join(this.dir, 'actions.json'), this.data());
    this.meta.complete = !this.error; this.meta.error = this.error;
    await atomicJson(join(this.dir, 'session.json'), this.meta);
  }
}
export async function probeInput(adb: Adb, serial: string) { return touchDevices(await adb.shell(serial, ['getevent', '-lp'])); }
