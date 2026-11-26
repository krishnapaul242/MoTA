// One view of all artificial pressure on a phone (storage fill, load apps), and one way to end it all.
import type { Adb } from './adb';
import { describeLoad, loadStatus, loadSummary, readLoadMeta, stopLoad, type LoadMeta } from './loadApps';
import { clearStorageFill, describeFill, formatKb, storageState, type StorageState } from './pressure';

export interface PressureState {
  /** Anything artificial is on: a storage fill, or load apps that were started and not stopped. */
  active: boolean;
  storage?: StorageState;
  /** "storage filled: 44 GB by X, 500 MB free", or ''. */
  fill: string;
  /** "load apps: 5 of 8 running by X", or ''. */
  load: string;
  loadRunning: number;
  loadTotal: number;
  scenario: string;
}

/** The load apps' metadata, or undefined when they are not bundled. */
export function tryLoadMeta(dir: string | undefined): LoadMeta | undefined {
  try { return dir ? readLoadMeta(dir) : undefined; } catch { return undefined; }
}

export async function pressureState(adb: Adb, serial: string, meta?: LoadMeta): Promise<PressureState> {
  const [storage, load] = await Promise.all([
    storageState(adb, serial).catch(() => undefined),
    meta ? loadSummary(adb, serial, meta).catch(() => undefined) : undefined,
  ]);
  const fill = storage ? describeFill(storage) : '';
  return { active: !!fill || !!load?.text, storage, fill, load: load?.text ?? '', loadRunning: load?.running ?? 0, loadTotal: load?.total ?? 0, scenario: load?.scenario ?? '' };
}

/** The load apps one by one, with why any of them ended, as text. */
export async function pressureDetail(adb: Adb, serial: string, meta?: LoadMeta): Promise<string> {
  return meta ? describeLoad(await loadStatus(adb, serial, meta)) : '';
}

export interface Stopped { freedKb: number; stoppedApps: number; errors: string[] }

/** Removes the storage fill and stops every load app, whoever started them. */
export async function stopAllPressure(adb: Adb, serial: string, meta?: LoadMeta): Promise<Stopped> {
  const errors: string[] = [];
  const note = (e: unknown) => { errors.push(e instanceof Error ? e.message : String(e)); return undefined; };
  const [cleared, stopped] = await Promise.all([
    clearStorageFill(adb, serial).catch(note),
    meta ? stopLoad(adb, serial, meta).catch(note) : 0,
  ]);
  return { freedKb: cleared?.freedKb ?? 0, stoppedApps: stopped ?? 0, errors };
}

/** "freed 44 GB of storage, stopped 8 load apps", or "no pressure was on". */
export function describeStopped(s: Stopped): string {
  const parts = [s.freedKb ? `freed ${formatKb(s.freedKb)} of storage` : '', s.stoppedApps ? `stopped ${s.stoppedApps} load app${s.stoppedApps === 1 ? '' : 's'}` : '', ...s.errors.map(e => `failed: ${e.split('\n')[0]}`)].filter(Boolean);
  return parts.length ? parts.join(', ') : 'no pressure was on';
}
