import { spawn as nodeSpawn, ChildProcess, SpawnOptions } from 'node:child_process';
import { createWriteStream, existsSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Adb } from '../adb';
import type { DeviceRunState, FlowFailure, FlowInfo, FlowStatus, TestEvent } from '../ai/protocol';
import { parseJUnit, parseProgressLine, readFailureDetail } from './results';

export type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface StartRequest {
  flows: FlowInfo[];
  serials: string[];
  env?: Record<string, string>;
  /** APK to install (replacing, keeping data) before the flows run. */
  installApk?: string;
  /** Package whose data is cleared before the flows run. */
  clearData?: string;
  /** Don't send test events to the UI (Claude's own single-flow checks). */
  silent?: boolean;
}

export interface FlowOutcome { flow: string; status: FlowStatus; durationMs: number; failure?: FlowFailure }
export interface DeviceRun { serial: string; state: DeviceRunState; startedAt: number; endedAt?: number; dir: string; results: Map<string, FlowOutcome>; message?: string; child?: ChildProcess; cancelled?: boolean; release?: () => Promise<void> }
export interface TestRun { runId: string; dir: string; flows: FlowInfo[]; devices: Map<string, DeviceRun>; models: Record<string, string>; startedAt: number; done: Promise<void>; silent: boolean; emit: (event: TestEvent) => void }

/** Maestro's on-device driver app. It stays running after a run and holds UI automation. */
export const MAESTRO_DRIVER = 'dev.mobile.maestro';
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PACKAGE = /^[A-Za-z]\w*(?:\.[A-Za-z]\w*)+$/;
const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_');

/** The Maestro CLI: the setting, else the installer's default location, else PATH. */
export function resolveMaestro(configured = '', home = homedir(), exists = existsSync): string {
  if (configured.trim()) return configured.trim();
  const installed = join(home, '.maestro', 'bin', process.platform === 'win32' ? 'maestro.bat' : 'maestro');
  return exists(installed) ? installed : 'maestro';
}

/** Arguments for one device's Maestro process. Flow paths are relative to the flows folder (the process cwd). */
export function maestroArgs(serial: string, flows: string[], reportFile: string, artifactsDir: string, env: Record<string, string> = {}): string[] {
  for (const key of Object.keys(env)) if (!ENV_KEY.test(key)) throw new Error(`Invalid variable name ${key}.`);
  return ['--device', serial, 'test', ...flows, '--no-ansi', '--format', 'junit', '--output', reportFile, '--test-output-dir', artifactsDir,
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])];
}

/** Runs Maestro flows on several devices at once, one Maestro process per device. */
/** What the user can do about common Maestro start-up failures. */
export function hintFor(message: string): string {
  if (/INSTALL_FAILED_USER_RESTRICTED/.test(message)) return ' Maestro installs a driver app each run: on Xiaomi/Redmi/POCO turn on Developer options › Install via USB (and USB debugging (Security settings)); on other phones accept the install prompt.';
  if (/INSTALL_FAILED_VERIFICATION_FAILURE|verif/i.test(message)) return ' Turn off "Verify apps over USB" in Developer options so Maestro can install its driver app.';
  return '';
}

export class MaestroRunner {
  private runs = new Map<string, TestRun>();
  constructor(private opts: {
    adb: Adb;
    maestro: () => string;
    flowsFolder: () => string;
    runsFolder: () => string;
    emit: (event: TestEvent) => void;
    spawn?: Spawn;
    now?: () => number;
    /** Marks a phone busy (for other sessions and windows) until the returned function is called. */
    busy?: (serial: string, what: string) => Promise<() => Promise<void>>;
  }) {}

  get(runId: string) { return this.runs.get(runId); }
  /** The most recent run the user started (not Claude's own silent checks). */
  latest() { return [...this.runs.values()].filter(r => !r.silent).pop(); }
  running() { return [...this.runs.values()].filter(r => !r.silent && [...r.devices.values()].some(d => d.state === 'starting' || d.state === 'running')); }

  async start(request: StartRequest): Promise<TestRun> {
    const { adb } = this.opts;
    const emit = request.silent ? () => undefined : this.opts.emit;
    const now = this.opts.now ?? Date.now;
    if (!request.flows.length) throw new Error('Select at least one flow.');
    if (!request.serials.length) throw new Error('Select at least one device.');
    if (request.clearData && !PACKAGE.test(request.clearData)) throw new Error('Enter a valid app package to clear.');
    const folder = this.opts.flowsFolder();
    for (const f of request.flows) { const abs = resolve(folder, f.path); const r = relative(folder, abs); if (r.startsWith('..') || isAbsolute(r)) throw new Error(`${f.path} is outside the flows folder.`); }
    const all = await adb.devices();
    const connected = all.filter(d => d.state === 'device');
    const ready = new Set(connected.map(d => d.serial));
    const models = Object.fromEntries(request.serials.map(s => [s, connected.find(d => d.serial === s)?.model ?? s]));
    const missing = request.serials.filter(s => !ready.has(s));
    if (missing.length) throw new Error(`Not ready: ${missing.join(', ')}. Reconnect or deselect these devices.`);
    // Maestro (dadb 2.0) stops listing devices at the first one it can't open, then sees none at all.
    const blocking = all.filter(d => /^(unauthorized|offline|authorizing|connecting)$/.test(d.state));
    if (blocking.length) throw new Error(`Maestro can't see any phone while ${blocking.map(d => `${d.serial} is ${d.state}`).join(', ')}. Allow USB debugging on ${blocking.length > 1 ? 'those phones' : 'that phone'} or unplug ${blocking.length > 1 ? 'them' : 'it'}, then run again.`);

    const startedAt = now();
    const runId = new Date(startedAt).toISOString().replace(/[:.]/g, '-').replace('Z', '');
    const dir = join(this.opts.runsFolder(), runId);
    await fs.mkdir(dir, { recursive: true });
    const devices = new Map<string, DeviceRun>(request.serials.map(serial => [serial, { serial, state: 'starting' as DeviceRunState, startedAt, dir: join(dir, safeName(serial)), results: new Map<string, FlowOutcome>() }]));
    const run: TestRun = { runId, dir, flows: request.flows, devices, models, startedAt, done: Promise.resolve(), silent: !!request.silent, emit };
    this.runs.set(runId, run);
    emit({ type: 'test/started', runId, flows: request.flows.map(f => f.path), serials: request.serials, dir, devices: request.serials.map(serial => ({ serial, model: models[serial] })) });
    run.done = Promise.all([...devices.values()].map(d => this.runDevice(run, d, request).catch(e => this.finishDevice(run, d, 'error', e instanceof Error ? e.message : String(e)))))
      .then(() => this.finishRun(run));
    return run;
  }

  cancel(runId: string, serial?: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    for (const d of run.devices.values()) {
      if (serial && d.serial !== serial) continue;
      if (d.state !== 'starting' && d.state !== 'running') continue;
      d.cancelled = true;
      if (d.child?.pid) killTree(d.child);
    }
  }

  private progress(run: TestRun, d: DeviceRun, currentFlow?: string) {
    const values = [...d.results.values()];
    run.emit({ type: 'test/progress', runId: run.runId, serial: d.serial, state: d.state, startedAt: d.startedAt, currentFlow,
      passed: values.filter(r => r.status === 'pass').length, failed: values.filter(r => r.status === 'fail').length, total: run.flows.length, message: d.message });
  }

  private async runDevice(run: TestRun, d: DeviceRun, request: StartRequest) {
    const { adb } = this.opts;
    d.release = await this.opts.busy?.(d.serial, run.silent ? 'a Maestro flow check' : `a Maestro test run (${run.runId})`).catch(() => undefined);
    await fs.mkdir(d.dir, { recursive: true });
    this.progress(run, d);
    await adb.shell(d.serial, ['input', 'keyevent', 'KEYCODE_WAKEUP']).catch(() => undefined);
    if (request.installApk) { d.message = 'Installing APK…'; this.progress(run, d); await adb.run(['-s', d.serial, 'install', '-r', request.installApk], 600_000); }
    if (request.clearData) { d.message = `Clearing data of ${request.clearData}…`; this.progress(run, d); await adb.shell(d.serial, ['pm', 'clear', request.clearData]); }
    d.message = undefined;
    if (d.cancelled) return this.finishDevice(run, d, 'cancelled');

    const report = join(d.dir, 'report.xml'), artifacts = join(d.dir, 'artifacts');
    const byName = new Map(run.flows.map(f => [f.name, f.path]));
    const order = run.flows.map(f => f.path);
    const next = () => order.find(p => !d.results.has(p));
    const spawn = this.opts.spawn ?? nodeSpawn;
    const child = spawn(this.opts.maestro(), maestroArgs(d.serial, order, report, artifacts, request.env), {
      cwd: this.opts.flowsFolder(), detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' },
    });
    d.child = child;
    const log = createWriteStream(join(d.dir, 'maestro-console.log'));
    let buffer = '';
    const tail: string[] = [];
    const onData = (chunk: Buffer) => {
      log.write(chunk);
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (t && !/^(at |\.\.\. \d+ more|Caused by:|The stack trace was:|\[?\s*(INFO|DEBUG)\b)|Debug output path/.test(t)) { tail.push(t); if (tail.length > 5) tail.shift(); }
        if (d.state === 'starting' && /Waiting for flows|Running on|\[(Passed|Failed)\]/.test(line)) { d.state = 'running'; this.progress(run, d, next()); }
        const p = parseProgressLine(line);
        if (!p) continue;
        const flow = byName.get(p.name) ?? order.find(o => o.replace(/^.*\//, '').replace(/\.ya?ml$/i, '') === p.name) ?? p.name;
        const outcome: FlowOutcome = { flow, status: p.status, durationMs: p.durationMs ?? 0, failure: p.status === 'fail' ? { message: p.message ?? 'Flow failed.' } : undefined };
        d.results.set(flow, outcome);
        run.emit({ type: 'test/flow', runId: run.runId, serial: d.serial, flow, status: outcome.status, durationMs: outcome.durationMs, failure: outcome.failure });
        this.progress(run, d, next());
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    const code = await new Promise<number | null>((res, rej) => { child.once('error', rej); child.once('close', c => res(c)); });
    log.end();
    d.child = undefined;
    // Free UI automation for MoTA's own tools (uiautomator dump fails while the driver runs).
    await adb.shell(d.serial, ['am', 'force-stop', MAESTRO_DRIVER]).catch(() => undefined);

    // The JUnit report is the source of truth; console lines only drive live progress.
    const xml = await fs.readFile(report, 'utf8').catch(() => '');
    for (const r of parseJUnit(xml)) {
      const flow = (r.file && order.find(o => o === r.file || r.file!.endsWith('/' + o))) ?? byName.get(r.name) ?? r.name;
      const failure = r.status === 'fail' ? { message: r.message ?? 'Flow failed.', ...(await readFailureDetail(artifacts, r.name)) } : undefined;
      if (failure && !failure.message) failure.message = r.message ?? 'Flow failed.';
      d.results.set(flow, { flow, status: r.status, durationMs: r.durationMs, failure });
      run.emit({ type: 'test/flow', runId: run.runId, serial: d.serial, flow, status: r.status, durationMs: r.durationMs, failure });
    }
    if (d.cancelled) return this.finishDevice(run, d, 'cancelled');
    if (code !== 0 && !(await adb.devices().catch(() => [])).some(x => x.serial === d.serial && x.state === 'device')) return this.finishDevice(run, d, 'lost', 'The device disconnected during the run.');
    if (code !== 0 && !xml) {
      const said = tail.find(l => /fail|error|exception|not connected|denied|refused/i.test(l)) ?? tail[tail.length - 1];
      return this.finishDevice(run, d, 'error', said ? `Maestro stopped: ${said.replace(/^[\w.]+(Exception|Error):\s*/, '')}${hintFor(said)}` : `Maestro exited with code ${code}. See maestro-console.log.`);
    }
    return this.finishDevice(run, d, 'done');
  }

  private async finishDevice(run: TestRun, d: DeviceRun, state: DeviceRunState, message?: string) {
    const now = this.opts.now ?? Date.now;
    d.state = state; d.message = message; d.endedAt = now();
    const release = d.release; d.release = undefined;
    await release?.().catch(() => undefined);
    for (const f of run.flows) if (!d.results.has(f.path)) {
      d.results.set(f.path, { flow: f.path, status: 'not-run', durationMs: 0 });
      run.emit({ type: 'test/flow', runId: run.runId, serial: d.serial, flow: f.path, status: 'not-run', durationMs: 0 });
    }
    this.progress(run, d);
    await fs.writeFile(join(d.dir, 'results.json'), JSON.stringify({ serial: d.serial, state, message, startedAt: d.startedAt, endedAt: d.endedAt, results: [...d.results.values()] }, null, 2)).catch(() => undefined);
  }

  private async finishRun(run: TestRun) {
    const all = [...run.devices.values()].flatMap(d => [...d.results.values()]);
    const count = (s: FlowStatus) => all.filter(r => r.status === s).length;
    const summary = { runId: run.runId, startedAt: run.startedAt, flows: run.flows.map(f => f.path), devices: [...run.devices.values()].map(d => ({ serial: d.serial, state: d.state, message: d.message, results: [...d.results.values()] })) };
    await fs.writeFile(join(run.dir, 'run.json'), JSON.stringify(summary, null, 2)).catch(() => undefined);
    run.emit({ type: 'test/done', runId: run.runId, passed: count('pass'), failed: count('fail'), notRun: count('not-run') });
  }
}

/** Maestro is a shell script that starts Java: stop the whole process group. */
function killTree(child: ChildProcess) {
  try {
    if (process.platform === 'win32') nodeSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid!, 'SIGTERM');
  } catch { child.kill('SIGTERM'); }
}
