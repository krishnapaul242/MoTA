// Load apps: a set of small apps (dev.mota.load.a01, a02, …) that stand in for the other apps on a phone.
// Each holds memory, burns CPU, writes to disk or keeps files as told, in the state a real app would be in:
// open in recents, working in the background, or just cached. Android then kills and keeps apps as it would on a busy phone.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adb } from './adb';
import { shellQuote } from './deviceControl';

/** resources/load/load.json, written by load-apk/build.sh next to the APKs. */
export interface LoadMeta { version: string; versionCode: number; count: number; packagePrefix: string }
/** Where a load app sits in Android's kill order: cached (killed first), recent (an app the user left), service (background work, killed late). */
export type LoadState = 'cached' | 'recent' | 'service';
export interface AppLoad {
  memMb: number;
  state: LoadState;
  /** How much of the held memory is random; the rest is zeros that Android compresses to nothing. Real app memory is around 40. */
  randomPercent?: number;
  cpuThreads?: number;
  cpuPercent?: number;
  /** MB written and synced to disk per second. */
  ioMbps?: number;
  filesMb?: number;
  filesIn?: 'data' | 'cache';
  /** Come back after being killed (services only), as apps with background work do. */
  respawn?: boolean;
}
/** What is running on a phone, kept on the phone so every session and window sees the same. */
export interface LoadRecord { owner: string; scenario: string; startedAt: string; apps: (AppLoad & { package: string })[] }
export interface ExitInfo { timestamp: string; reason: string; subreason: string; description: string }
export interface Memory { totalKb: number; availableKb: number }
export interface AppStatus { package: string; load: AppLoad; alive: boolean; adj?: number; exit?: ExitInfo }
export interface LoadStatus { record?: LoadRecord; apps: AppStatus[]; memory: Memory; watched?: { package: string; alive: boolean; adj?: number; exit?: ExitInfo } }

export const LOAD_RECORD_PATH = '/data/local/tmp/mota-load.json';
export const SCENARIOS = ['open-apps', 'heavy-app', 'busy-background', 'squeeze'] as const;
export type Scenario = typeof SCENARIOS[number];
export interface ScenarioOptions { apps?: number; memoryMbEach?: number; leaveAvailableMb?: number }

export function readLoadMeta(dir: string): LoadMeta {
  let meta: LoadMeta;
  try { meta = JSON.parse(readFileSync(join(dir, 'load.json'), 'utf8')) as LoadMeta; } catch { throw new Error('The load apps are not built. Run load-apk/build.sh.'); }
  if (!Number.isInteger(meta.count) || meta.count < 1 || !/^[a-z][\w.]*$/.test(meta.packagePrefix ?? '')) throw new Error('resources/load/load.json is not valid. Run load-apk/build.sh.');
  return meta;
}
const id = (n: number) => String(n).padStart(2, '0');
export const loadPackage = (meta: LoadMeta, n: number) => `${meta.packagePrefix}${id(n)}`;
export const loadPackages = (meta: LoadMeta, count = meta.count) => Array.from({ length: Math.min(count, meta.count) }, (_, i) => loadPackage(meta, i + 1));

export function parseMemory(meminfo: string): Memory {
  const kb = (name: string) => +(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(meminfo)?.[1] ?? 0);
  return { totalKb: kb('MemTotal'), availableKb: kb('MemAvailable') };
}

/** The apps a scenario starts, sized to the phone's memory so the same scenario means the same thing on a 3 GB and a 12 GB phone. */
export function planScenario(scenario: Scenario, memory: Memory, max: number, o: ScenarioOptions = {}): AppLoad[] {
  const totalMb = memory.totalKb / 1024, share = (fraction: number) => Math.max(32, Math.round(totalMb * fraction / 16) * 16);
  const count = (byDefault: number) => Math.max(1, Math.min(max, o.apps ?? byDefault));
  const each = (byDefault: number) => Math.max(16, Math.min(8192, o.memoryMbEach ?? byDefault));
  switch (scenario) {
    // Apps the user opened and left: typical size, in recents.
    case 'open-apps': return Array.from({ length: count(8) }, () => ({ memMb: each(share(0.04)), state: 'recent' as const }));
    // One big app left open, such as a game.
    case 'heavy-app': return Array.from({ length: count(1) }, () => ({ memMb: each(share(0.25)), state: 'recent' as const }));
    // Apps working in the background (sync, playback, uploads): they use CPU and disk too, and come back when killed.
    case 'busy-background': return Array.from({ length: count(3) }, () => ({ memMb: each(share(0.05)), state: 'service' as const, cpuThreads: 2, cpuPercent: 30, ioMbps: 5, respawn: true }));
    // Take memory until about leaveAvailableMb is left, and hold on to it: services that come back when killed.
    case 'squeeze': {
      const n = count(Math.min(max, 6)), takeMb = Math.max(0, memory.availableKb / 1024 - (o.leaveAvailableMb ?? 300));
      return Array.from({ length: n }, () => ({ memMb: each(Math.max(16, Math.round(takeMb / n / 16) * 16)), state: 'service' as const, randomPercent: 100, respawn: true }));
    }
  }
}

/** Version codes of the load apps on the phone, by package. */
export async function installedLoadApps(adb: Adb, serial: string, meta: LoadMeta): Promise<Map<string, number>> {
  const out = await adb.shell(serial, ['pm', 'list', 'packages', '--show-versioncode', meta.packagePrefix]);
  return new Map([...out.matchAll(/^package:(\S+)\s+versionCode:(\d+)/gm)].map(m => [m[1], +m[2]] as const).filter(([p]) => p.startsWith(meta.packagePrefix)));
}

/** What the user must do when a phone refuses a load app, or the phone's own message. */
export function installAdvice(error: string): string {
  if (/VERIFICATION_FAILURE/i.test(error)) return 'Play Protect blocked it: it checks apps installed over USB and asks on the phone, and nobody answered. Install once by hand and choose "Install anyway" on the phone, or turn off "Verify apps over USB" in Developer options on this test phone.';
  if (/USER_RESTRICTED/i.test(error)) return 'The phone asked to confirm the install and nobody did. On Xiaomi phones, tap Install on the phone when asked, or turn on "Install via USB" in Developer options.';
  if (/INSUFFICIENT_STORAGE/i.test(error)) return 'The phone is out of storage. Remove a storage fill (clear_storage_fill) or free space, then retry.';
  if (/UPDATE_INCOMPATIBLE|INCONSISTENT_CERTIFICATES/i.test(error)) return 'Load apps signed with another key are installed. Uninstall them (adb uninstall), then retry.';
  return error.split('\n').find(l => /Failure|failed|error/i.test(l))?.trim() ?? error.trim().slice(0, 300);
}

/** Installs the first `count` load apps where missing or out of date. Returns the packages it installed. */
export async function ensureLoadApps(adb: Adb, serial: string, dir: string, meta: LoadMeta, count: number): Promise<string[]> {
  const have = await installedLoadApps(adb, serial, meta);
  const missing = Array.from({ length: Math.min(count, meta.count) }, (_, i) => i + 1).filter(n => have.get(loadPackage(meta, n)) !== meta.versionCode);
  for (const n of missing) {
    try { await adb.run(['-s', serial, 'install', '-r', join(dir, `mota-load-${id(n)}.apk`)], 120_000); }
    catch (e) { throw new Error(`Could not install load app ${loadPackage(meta, n)} on ${serial}. ${installAdvice(e instanceof Error ? e.message : String(e))}`); }
  }
  return missing.map(n => loadPackage(meta, n));
}

/** The most recent exits in `dumpsys activity exit-info <package>` output, newest first. */
export function parseExitInfo(output: string): ExitInfo[] {
  return output.split(/ApplicationExitInfo #\d+:/).slice(1).map(block => ({
    timestamp: /timestamp=(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/.exec(block)?.[1] ?? '',
    reason: /\breason=\d+ \(([^)]*)\)/.exec(block)?.[1] ?? '',
    subreason: /\bsubreason=\d+ \(([^)]*)\)/.exec(block)?.[1] ?? '',
    description: (/\bdescription=(.*?) state=/.exec(block)?.[1] ?? '').replace(/^null$/, ''),
  })).filter(e => e.timestamp);
}

/** Why a process ended, in plain words. */
export function describeExit(e: ExitInfo): string {
  const time = e.timestamp.slice(11);
  const sub = e.subreason && e.subreason !== 'UNKNOWN' ? e.subreason.toLowerCase() : '';
  switch (e.reason) {
    case 'LOW_MEMORY': return `killed by Android for low memory at ${time}`;
    // Phones that do not report low-memory kills show them as a plain kill signal.
    case 'SIGNALED': return `killed by a signal at ${time} (on many phones this is how a low-memory kill shows)`;
    case 'CRASH': case 'CRASH_NATIVE': return `crashed at ${time}`;
    case 'ANR': return `stopped responding (ANR) at ${time}`;
    case 'USER REQUESTED': case 'USER_REQUESTED': return `stopped on request at ${time}${sub ? ` (${sub})` : ''}`;
    case 'EXCESSIVE_RESOURCE_USAGE': case 'EXCESSIVE RESOURCE USAGE': return `killed by Android for using too many resources at ${time}`;
    case 'EXIT_SELF': case 'EXIT SELF': return `exited by itself at ${time}`;
    default: return `ended at ${time}: ${e.reason.toLowerCase()}${sub ? `, ${sub}` : ''}`;
  }
}

const callProvider = async (adb: Adb, serial: string, pkg: string, method: string, arg?: string) => {
  const out = await adb.shell(serial, ['content', 'call', '--uri', `content://${pkg}.ctl`, '--method', method, ...(arg ? ['--arg', shellQuote(arg)] : [])]);
  const json = /json=(\{.*\})\}\]\s*$/s.exec(out)?.[1];
  if (!json) throw new Error(`${pkg} did not answer: ${out.trim().slice(0, 200) || 'no output'}`);
  return JSON.parse(json) as { pid?: number; memHeldMb?: number; error?: string };
};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const pidOf = async (adb: Adb, serial: string, pkg: string) => (await adb.shell(serial, ['pidof', pkg]).catch(() => '')).trim().split(/\s+/)[0] ?? '';
const forEachPackage = (packages: string[], command: string) => `for p in ${packages.join(' ')}; do ${command}; done`;

export interface StartOptions { owner?: string; scenario?: string; wait?: (ms: number) => Promise<void>; installed?: (packages: string[]) => void }

/**
 * Stops any earlier load, installs what is missing, and starts one load app per entry of `plan`, oldest first, so the first
 * is the first Android kills. Waits for each to hold its memory. Returns the status once all are started.
 */
export async function startLoad(adb: Adb, serial: string, dir: string, plan: AppLoad[], options: StartOptions = {}): Promise<LoadStatus> {
  const meta = readLoadMeta(dir), wait = options.wait ?? sleep;
  if (!plan.length) throw new Error('Nothing to start.');
  if (plan.length > meta.count) throw new Error(`There are ${meta.count} load apps; ${plan.length} were asked for.`);
  await stopLoad(adb, serial, meta);
  const installed = await ensureLoadApps(adb, serial, dir, meta, plan.length);
  options.installed?.(installed);
  const startedAt = (await adb.shell(serial, ['date', shellQuote('+%Y-%m-%d %H:%M:%S')])).trim();
  const apps = plan.map((load, i) => ({ ...load, package: loadPackage(meta, i + 1) }));
  const record: LoadRecord = { owner: options.owner ?? '', scenario: options.scenario ?? 'custom', startedAt, apps };
  await adb.shell(serial, [`echo ${shellQuote(JSON.stringify(record))} > ${LOAD_RECORD_PATH}`]);
  for (const app of apps) {
    const { package: pkg, ...load } = app;
    try {
      // A recent app is one the user opened: its screen comes up first, and the next app covers it.
      if (load.state === 'recent') await adb.shell(serial, ['am', 'start', '-n', `${pkg}/dev.mota.load.LoadActivity`]);
      await callProvider(adb, serial, pkg, 'set', JSON.stringify(load));
      // Filling memory takes a moment. An app that Android kills meanwhile is left dead: that is the pressure working.
      for (let waited = 0, limit = 10_000 + load.memMb * 100; waited < limit; waited += 700) {
        await wait(700);
        if (!await pidOf(adb, serial, pkg)) break;
        const s = await callProvider(adb, serial, pkg, 'status').catch(() => undefined);
        if (!s || s.error || (s.memHeldMb ?? 0) >= load.memMb - 16) break;
      }
    } catch { /* reported as not running by the status below */ }
  }
  // Home, so the last app opened is in the background like the others; a moment lets Android settle its place.
  if (apps.some(a => a.state === 'recent')) { await adb.shell(serial, ['input', 'keyevent', 'KEYCODE_HOME']); await wait(1500); }
  return loadStatus(adb, serial, meta);
}

/** Which load apps are still running, why the others ended, and the same for `watch` (the app under test). */
export async function loadStatus(adb: Adb, serial: string, meta: LoadMeta, watch?: string): Promise<LoadStatus> {
  const out = await adb.shell(serial, [`cat ${LOAD_RECORD_PATH} 2>/dev/null; echo; echo ==mem; cat /proc/meminfo; echo ==pids; ${forEachPackage([...loadPackages(meta), ...(watch ? [watch] : [])], 'i=$(pidof $p); i=${i%% *}; echo "$p=$i=$(cat /proc/$i/oom_score_adj 2>/dev/null)"')}`]);
  const [head, rest = ''] = out.split('==mem'), [meminfo, pids = ''] = rest.split('==pids');
  let record: LoadRecord | undefined;
  try { const r = JSON.parse(head.trim()) as LoadRecord; if (Array.isArray(r.apps)) record = r; } catch { /* no load was started */ }
  const live = new Map([...pids.matchAll(/^(\S+?)=(\d*)=(-?\d*)\s*$/gm)].map(m => [m[1], { alive: !!m[2], adj: m[3] ? +m[3] : undefined }] as const));
  const exitOf = async (pkg: string): Promise<ExitInfo | undefined> => {
    const exits = parseExitInfo(await adb.shell(serial, ['dumpsys', 'activity', 'exit-info', pkg]).catch(() => ''));
    // Only an exit since this load started says anything about it.
    return exits.find(e => !record || e.timestamp >= record.startedAt);
  };
  const apps = await Promise.all((record?.apps ?? []).map(async ({ package: pkg, ...load }): Promise<AppStatus> => {
    const state = live.get(pkg) ?? { alive: false };
    return { package: pkg, load, ...state, ...(state.alive ? {} : { exit: await exitOf(pkg) }) };
  }));
  const w = watch ? live.get(watch) ?? { alive: false } : undefined;
  return { record, apps, memory: parseMemory(meminfo), ...(watch && w ? { watched: { package: watch, ...w, exit: await exitOf(watch) } } : {}) };
}

/** Stops every load app and deletes what they stored. Returns how many were running. */
export async function stopLoad(adb: Adb, serial: string, meta: LoadMeta): Promise<number> {
  const installed = [...(await installedLoadApps(adb, serial, meta)).keys()];
  if (!installed.length) { await adb.shell(serial, [`rm -f ${LOAD_RECORD_PATH}`]); return 0; }
  // Clearing an app also stops it and forgets a request to come back, so nothing restarts.
  const out = await adb.run(['-s', serial, 'shell', `${forEachPackage(installed, 'pidof $p >/dev/null && echo running; pm clear $p >/dev/null')}; rm -f ${LOAD_RECORD_PATH}`], 120_000);
  return (out.match(/running/g) ?? []).length;
}

/** Removes the load apps from the phone. */
export async function uninstallLoadApps(adb: Adb, serial: string, meta: LoadMeta): Promise<number> {
  const installed = [...(await installedLoadApps(adb, serial, meta)).keys()];
  if (installed.length) await adb.run(['-s', serial, 'shell', `${forEachPackage(installed, 'pm uninstall $p >/dev/null')}; rm -f ${LOAD_RECORD_PATH}`], 120_000);
  return installed.length;
}

const ADJ: [number, string][] = [[0, 'on screen'], [200, 'background work'], [700, 'last app used'], [900, 'in recents'], [1001, 'cached']];
const adjText = (adj?: number) => adj === undefined ? '' : ADJ.find(([limit]) => adj <= limit)?.[1] ?? 'cached';
const mb = (kb: number) => `${Math.round(kb / 1024)} MB`;

/** "load apps: 5 of 8 running by X", or '' when no load was started on the phone. */
export async function loadSummary(adb: Adb, serial: string, meta: LoadMeta): Promise<{ text: string; owner: string }> {
  const out = await adb.shell(serial, [`cat ${LOAD_RECORD_PATH} 2>/dev/null || exit 0; echo; echo ==pids; ${forEachPackage(loadPackages(meta), 'pidof $p >/dev/null && echo $p')}; true`]);
  const [head, pids = ''] = out.split('==pids');
  try {
    const record = JSON.parse(head.trim()) as LoadRecord, running = record.apps.filter(a => new RegExp(`^${a.package.replace(/\./g, '\\.')}\\s*$`, 'm').test(pids)).length;
    return { text: `load apps: ${running} of ${record.apps.length} running${record.owner ? ` by ${record.owner}` : ''}`, owner: record.owner };
  } catch { return { text: '', owner: '' }; }
}

/** The status as text for an agent or the user. */
export function describeLoad(status: LoadStatus): string {
  const lines: string[] = [];
  if (!status.record) lines.push('No load apps are running on this phone.');
  else {
    const alive = status.apps.filter(a => a.alive).length;
    lines.push(`${status.record.scenario}: ${alive} of ${status.apps.length} load apps running${status.record.owner ? `, started by ${status.record.owner}` : ''} at ${status.record.startedAt.slice(11)}.`);
    for (const a of status.apps) {
      const extra = [a.load.cpuPercent ? `${a.load.cpuThreads ?? 0}×${a.load.cpuPercent}% CPU` : '', a.load.ioMbps ? `${a.load.ioMbps} MB/s disk` : '', a.load.filesMb ? `${a.load.filesMb} MB files` : '', a.load.respawn ? 'comes back' : ''].filter(Boolean).join(', ');
      lines.push(`  ${a.package} · ${a.load.memMb} MB${extra ? `, ${extra}` : ''} · ${a.alive ? `running (${adjText(a.adj)})` : a.exit ? describeExit(a.exit) : 'not running'}`);
    }
  }
  lines.push(`Memory: ${mb(status.memory.availableKb)} available of ${mb(status.memory.totalKb)}.`);
  const w = status.watched;
  if (w) lines.push(`${w.package}: ${w.alive ? `running (${adjText(w.adj)})` : 'not running'}${w.exit ? `; ${w.alive ? 'its last process was ' : ''}${describeExit(w.exit)}` : ''}.`);
  return lines.join('\n');
}
