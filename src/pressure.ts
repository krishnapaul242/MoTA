// Storage and memory pressure on a phone, without root:
// a fill file that leaves little free storage, a memory-trim signal to an app, and killing an app in the background as Android does when memory is low.
import type { Adb } from './adb';
import { validPackage } from './apk';
import { launchApp } from './deviceActions';
import { shellQuote } from './deviceControl';

/** The one file MoTA fills storage with. It is on the data partition, which apps and /sdcard share. */
export const FILL_PATH = '/data/local/tmp/mota-fill';
/** Who made the fill, so other sessions can tell whose it is. */
export const FILL_OWNER_PATH = `${FILL_PATH}.owner`;
const MB = 1024;

export interface StorageState {
  totalKb: number;
  /** Space apps can still write, as `df` reports it. */
  freeKb: number;
  /** Size of MoTA's fill file, 0 without one. */
  fillKb: number;
  /** Who made the fill, when recorded. */
  owner?: string;
}

/** Total and available KB from `df -k <path>` output. */
export function parseDf(output: string): { totalKb: number; freeKb: number } | undefined {
  for (const line of output.split(/\r?\n/).reverse()) {
    const m = /^\S+\s+(\d+)\s+\d+\s+(\d+)\s+\d+%/.exec(line.trim());
    if (m) return { totalKb: +m[1], freeKb: +m[2] };
  }
  return undefined;
}

export function formatKb(kb: number): string {
  return kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(kb >= 10 * 1024 * 1024 ? 0 : 1)} GB` : `${Math.round(kb / 1024)} MB`;
}

const STATE_SCRIPT = `df -k /data/local/tmp; echo fill=$(stat -c %s ${FILL_PATH} 2>/dev/null); echo owner=$(cat ${FILL_OWNER_PATH} 2>/dev/null)`;

export async function storageState(adb: Adb, serial: string): Promise<StorageState> {
  const out = await adb.shell(serial, [STATE_SCRIPT]);
  const df = parseDf(out);
  if (!df) throw new Error(`Could not read free storage on ${serial}: ${out.trim().slice(0, 200) || 'no output'}`);
  const owner = /^owner=(.+)$/m.exec(out)?.[1].trim();
  return { ...df, fillKb: Math.round(+(/^fill=(\d+)/m.exec(out)?.[1] ?? 0) / 1024), ...(owner ? { owner } : {}) };
}

/** "storage filled: 3.2 GB by X, 200 MB free", or '' without a fill. */
export function describeFill(state: StorageState): string {
  return state.fillKb ? `storage filled: ${formatKb(state.fillKb)}${state.owner ? ` by ${state.owner}` : ''}, ${formatKb(state.freeKb)} free` : '';
}

/** How far above the target free space still counts as reached (file systems round, and keep some blocks back). */
const slackKb = (targetKb: number) => Math.max(8 * MB, Math.round(targetKb * 0.02));

/**
 * Fills storage until about `leaveFreeMb` is free, replacing an earlier fill. Uses fallocate (instant), and writes zeros
 * for what is left when the phone's file system refuses it.
 */
export async function fillStorage(adb: Adb, serial: string, leaveFreeMb: number, owner = ''): Promise<{ before: StorageState; after: StorageState }> {
  if (!Number.isInteger(leaveFreeMb) || leaveFreeMb < 0) throw new Error('Give the free space to leave as a whole number of MB, 0 or more.');
  const before = await storageState(adb, serial);
  const targetKb = leaveFreeMb * MB, withoutFill = before.freeKb + before.fillKb;
  if (withoutFill <= targetKb) {
    if (before.fillKb) await clearStorageFill(adb, serial);
    throw new Error(`${serial} has only ${formatKb(withoutFill)} free${before.fillKb ? ' without the fill' : ''}, which is already at or below ${formatKb(targetKb)}. ${before.fillKb ? 'Removed the earlier fill; nothing' : 'Nothing'} to fill.`);
  }
  const needKb = withoutFill - targetKb;
  // fallocate only grows a file, so an earlier fill is removed first.
  await adb.run(['-s', serial, 'shell', `rm -f ${FILL_PATH}; fallocate -l ${needKb * 1024} ${FILL_PATH} 2>&1; echo ${shellQuote(owner.replace(/\s+/g, ' ').slice(0, 120))} > ${FILL_OWNER_PATH}`], 120_000).catch(() => '');
  let after = await storageState(adb, serial);
  if (after.freeKb > targetKb + slackKb(targetKb)) {
    // Appends zeros for the rest. Stops by itself when storage is full.
    const restMb = Math.ceil((after.freeKb - targetKb) / MB);
    await adb.run(['-s', serial, 'shell', `dd if=/dev/zero bs=1048576 count=${restMb} >> ${FILL_PATH} 2>/dev/null`], 60_000 + restMb * 100).catch(() => '');
    after = await storageState(adb, serial);
  }
  if (!after.fillKb) throw new Error(`Could not create the fill file on ${serial}. Android refused writing to ${FILL_PATH}.`);
  if (after.freeKb > targetKb + slackKb(targetKb)) throw new Error(`Filled ${formatKb(after.fillKb)} on ${serial}, but ${formatKb(after.freeKb)} is still free (wanted ${formatKb(targetKb)}). The fill is in place; remove it with clear_storage_fill.`);
  return { before, after };
}

/** Removes MoTA's fill file. Returns the KB it freed (0 when there was none). */
export async function clearStorageFill(adb: Adb, serial: string): Promise<{ freedKb: number; after: StorageState }> {
  const before = await storageState(adb, serial);
  await adb.shell(serial, [`rm -f ${FILL_PATH} ${FILL_OWNER_PATH}`]);
  const after = await storageState(adb, serial);
  if (after.fillKb) throw new Error(`Could not remove ${FILL_PATH} on ${serial}.`);
  return { freedKb: before.fillKb, after };
}

/** Levels of `am send-trim-memory`. The RUNNING_ ones are for an app in use; the others for an app in the background. */
export const TRIM_LEVELS = ['RUNNING_MODERATE', 'RUNNING_LOW', 'RUNNING_CRITICAL', 'HIDDEN', 'BACKGROUND', 'MODERATE', 'COMPLETE'] as const;
export type TrimLevel = typeof TRIM_LEVELS[number];

const mainPid = async (adb: Adb, serial: string, pkg: string) => (await adb.shell(serial, ['pidof', pkg]).catch(() => '')).trim().split(/\s+/)[0] ?? '';

/** Tells a running app that memory is low (its onTrimMemory callback). No memory is taken. */
export async function trimMemory(adb: Adb, serial: string, pkg: string, level: TrimLevel): Promise<string> {
  if (!validPackage(pkg)) throw new Error('Enter a valid app package ID.');
  if (!TRIM_LEVELS.includes(level)) throw new Error(`Use one of ${TRIM_LEVELS.join(', ')}.`);
  if (!await mainPid(adb, serial, pkg)) throw new Error(`${pkg} is not running, so it cannot receive a memory signal. Open it first.`);
  // Android answers a refused level with an exception and a stack trace; only its first line says why.
  const out = (await adb.shell(serial, ['am', 'send-trim-memory', pkg, level, '2>&1']).catch(e => e instanceof Error ? e.message : String(e))).trim();
  if (/background trim level on a foreground process/i.test(out)) throw new Error(`Android refused ${level} because ${pkg} is in use on screen. Use a RUNNING_ level, or send the app to the background first.`);
  if (/higher trim level than current level/i.test(out)) throw new Error(`Android refused ${level} because ${pkg} already got a stronger memory signal, and a process only accepts the same level or a stronger one. Send a stronger level (COMPLETE is the strongest), or restart the app to start over.`);
  if (/Error|Exception|Unknown/i.test(out)) throw new Error(/(?:Exception|Error): (.+)/.exec(out)?.[1] ?? out.split('\n')[0]);
  return `Sent ${level} to ${pkg}.`;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Sends the app to the background and kills its process the way Android does when memory is low (saved state is kept),
 * then reopens it unless `relaunch` is false. The app should come back to the same screen with its data.
 */
export async function killInBackground(adb: Adb, serial: string, pkg: string, relaunch = true, wait: (ms: number) => Promise<void> = sleep): Promise<string> {
  if (!validPackage(pkg)) throw new Error('Enter a valid app package ID.');
  if (!await mainPid(adb, serial, pkg)) throw new Error(`${pkg} is not running. Open it and go to the screen you want to test first.`);
  await adb.shell(serial, ['input', 'keyevent', 'KEYCODE_HOME']);
  // The app saves its state as it goes to the background; killing sooner would test a crash, not a low-memory kill.
  await wait(1500);
  let alive = true;
  for (let i = 0; i < 6 && alive; i++) {
    await adb.shell(serial, ['am', 'kill', pkg]);
    await wait(500);
    alive = !!await mainPid(adb, serial, pkg);
  }
  if (alive) throw new Error(`Android kept ${pkg} alive in the background: it is a system app, or is doing work the system protects (a foreground service, playback, a call), so a low-memory kill would spare it too. It is now in the background.`);
  if (!relaunch) return `${pkg} was killed in the background. Reopen it (launch_app, or from recents) to check that it restores its screen and data.`;
  await launchApp(adb, serial, pkg);
  return `${pkg} was killed in the background and reopened. Check that it restored its screen and data.`;
}
