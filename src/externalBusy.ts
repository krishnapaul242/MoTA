import { execFile } from 'node:child_process';
import type { Adb } from './adb';
import type { BusyOp } from './leases';

/** Package prefix of Maestro's on-device driver. It stays running after a run, so on the phone it doesn't mean a test is running. */
const MAESTRO_DRIVER = 'dev.mobile.maestro';

export interface Proc { pid: number; ppid: number; args: string }

/** Rows of `ps -axo pid=,ppid=,args=`. */
export function parsePs(output: string): Proc[] {
  return output.split('\n').map(l => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
    .map(m => ({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] }));
}

/** The phone a Maestro command targets: --device/--udid, else the only connected phone. */
export function maestroTarget(args: string, connected: string[]): string | undefined {
  const m = /(?:^|\s)--(?:device|udid)(?:=|\s+)(\S+)/.exec(args);
  if (m) return m[1];
  return connected.length === 1 ? connected[0] : undefined;
}

/** A running Maestro CLI (its Java process, or the launcher script before Java starts). */
export const isMaestro = (args: string) => /maestro\.cli\.AppKt/.test(args) || /(?:^|\/)maestro(?:\.bat)?\s+(?:.*\s)?(test|record|studio|start-device)\b/.test(args);

/**
 * Maestro commands running on this computer, per phone. Commands MoTA runs itself are skipped (they are already marked). Each carries
 * its parent processes, so a command a session started counts as that session's own work.
 */
export function maestroWork(procs: Proc[], connected: string[], targets: string[], mota: Set<number>, now: number): BusyOp[] {
  const parent = new Map(procs.map(p => [p.pid, p.ppid]));
  const ancestors = (pid: number) => { const out: number[] = []; for (let p = parent.get(pid), i = 0; p && i < 64; p = parent.get(p), i++) out.push(p); return out; };
  const ops: BusyOp[] = [];
  const seen = new Set<string>();
  for (const p of procs) {
    if (!isMaestro(p.args)) continue;
    const chain = ancestors(p.pid);
    if (chain.some(a => mota.has(a))) continue;
    const serial = maestroTarget(p.args, connected);
    if (!serial || !targets.includes(serial)) continue;
    // The script and its Java process are one command: count the outermost one.
    if (chain.some(a => procs.find(x => x.pid === a && isMaestro(x.args)))) continue;
    const key = `${serial}:${p.pid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ops.push({ id: `ext-maestro-${p.pid}`, serial, what: `a Maestro command started outside MoTA (process ${p.pid})`, pid: p.pid, startedAt: now, ancestors: chain });
  }
  return ops;
}

/** Test packages with an active instrumentation, from `dumpsys activity processes`. */
export function activeInstrumentations(dump: string): string[] {
  const found = new Set<string>();
  for (const m of dump.matchAll(/ActiveInstrumentation\{[^}]*?ComponentInfo\{([\w.]+)\//g)) found.add(m[1]);
  return [...found].filter(pkg => !pkg.startsWith(MAESTRO_DRIVER));
}

const run = (file: string, args: string[]) => new Promise<string>((ok, fail) => execFile(file, args, { timeout: 3000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => err ? fail(err) : ok(stdout)));

/** Finds tests MoTA didn't start: Maestro commands on this computer, and instrumentation tests (Espresso, connectedAndroidTest) on the phones. */
export function externalWorkDetector(adb: Adb, exec: (file: string, args: string[]) => Promise<string> = run, mota: () => Set<number> = () => new Set([process.pid])) {
  return async (serials: string[]): Promise<BusyOp[]> => {
    const now = Date.now();
    const connected = (await adb.devices().catch(() => [])).filter(d => d.state === 'device').map(d => d.serial);
    const targets = serials.filter(s => connected.includes(s));
    const host = process.platform === 'win32' ? [] : await exec('ps', ['-axo', 'pid=,ppid=,args=']).then(o => maestroWork(parsePs(o), connected, targets, mota(), now), () => []);
    const device = await Promise.all(targets.map(async serial => {
      const dump = await adb.shell(serial, ['dumpsys', 'activity', 'processes', '|', 'grep', 'ActiveInstrumentation', ';', 'true']).catch(() => '');
      return activeInstrumentations(dump).map((pkg): BusyOp => ({ id: `ext-instr-${serial}-${pkg}`, serial, what: `an instrumentation test (${pkg}) started outside MoTA`, pid: 0, startedAt: now }));
    }));
    return [...host, ...device.flat()];
  };
}
