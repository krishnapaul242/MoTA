import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Who holds a phone: an outside agent (by its process), a MoTA assistant conversation, … */
export interface Holder { id: string; label: string; pid: number }
export interface Lease { holder: Holder; claimedAt: number; lastActivity: number; parked?: boolean }
/** Work that keeps a phone busy whoever holds it: a test run, a long tool call. */
export interface BusyOp { id: string; serial: string; what: string; pid: number; holderId?: string; holderLabel?: string; startedAt: number }
export interface Notice { serial: string; by: string; at: number }
export interface LeaseFile {
  version: 1;
  leases: Record<string, Lease>;
  busy: BusyOp[];
  /** Per-session settings, by holder id. */
  sessions: Record<string, { pid: number; idleSeconds?: number }>;
  /** Messages a holder sees on its next call, e.g. that an idle phone was handed to someone else. */
  notices: Record<string, Notice[]>;
}

export type UseState = 'free' | 'active' | 'idle' | 'busy';
export interface DeviceUse { serial: string; state: UseState; holder?: Holder; lastActivity?: number; idleSeconds: number; ops: BusyOp[] }

export interface LeaseOptions {
  /** Folder of devices.json, shared by every VS Code window. */
  dir?: string;
  idleSeconds: () => number;
  deviceIdleSeconds: () => Record<string, number>;
  now?: () => number;
  alive?: (pid: number) => boolean;
}

const empty = (): LeaseFile => ({ version: 1, leases: {}, busy: [], sessions: {}, notices: {} });
const NOTICE_TTL = 24 * 3600_000;
const LOCK_STALE = 10_000;

export function pidAlive(pid: number): boolean {
  if (!pid) return true; // unknown process: only the idle timeout frees its phones
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

const positive = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;

/** Seconds without activity before a holder's phone counts as idle: the session's own setting, then the phone's, then the global one. */
export function idleSecondsFor(file: LeaseFile, serial: string, holderId: string | undefined, opts: Pick<LeaseOptions, 'idleSeconds' | 'deviceIdleSeconds'>): number {
  return positive(holderId ? file.sessions[holderId]?.idleSeconds : undefined) ?? positive(opts.deviceIdleSeconds()?.[serial]) ?? positive(opts.idleSeconds()) ?? 120;
}

/** How a phone is used right now. Leases and work of processes that have ended don't count. */
export function useOf(file: LeaseFile, serial: string, now: number, opts: Pick<LeaseOptions, 'idleSeconds' | 'deviceIdleSeconds'>, alive: (pid: number) => boolean = pidAlive): DeviceUse {
  const ops = file.busy.filter(o => o.serial === serial && alive(o.pid));
  const lease = file.leases[serial];
  const holder = lease && alive(lease.holder.pid) ? lease.holder : undefined;
  const idleSeconds = idleSecondsFor(file, serial, holder?.id, opts);
  const base = { serial, idleSeconds, ops, ...(holder ? { holder, lastActivity: lease!.lastActivity } : {}) };
  if (ops.length) return { ...base, state: 'busy' };
  if (!holder) return { ...base, state: 'free' };
  return { ...base, state: lease!.parked || now - lease!.lastActivity >= idleSeconds * 1000 ? 'idle' : 'active' };
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
}

/** Why `holderId` can't use a phone now, or undefined when it can. */
export function blockedReason(use: DeviceUse, holderId: string, now: number): string | undefined {
  const others = use.ops.filter(o => o.holderId !== holderId);
  if (others.length) {
    const o = others[0];
    return `${use.serial} is busy: ${o.what}${o.holderLabel ? ` for ${o.holderLabel}` : ''}, started ${ago(now - o.startedAt)} ago.`;
  }
  if (use.state === 'active' && use.holder && use.holder.id !== holderId)
    return `${use.serial} is in use by ${use.holder.label} (last action ${ago(now - (use.lastActivity ?? now))} ago). It frees up after ${use.idleSeconds} s without activity.`;
  return undefined;
}

/** One line about a phone's use, from the point of view of `holderId`. */
export function describeUse(use: DeviceUse, holderId: string | undefined, now: number): string {
  const mine = !!use.holder && use.holder.id === holderId;
  const since = use.lastActivity ? ago(now - use.lastActivity) : '';
  switch (use.state) {
    case 'free': return 'free';
    case 'busy': {
      const o = use.ops[0];
      return `busy: ${o.what}${o.holderLabel ? ` for ${o.holderLabel}` : ''}`;
    }
    case 'active': return mine ? 'yours' : `in use by ${use.holder!.label} (last action ${since} ago)`;
    case 'idle': return mine ? `yours, idle for ${since} (others may take it)` : `idle for ${since}, last used by ${use.holder!.label}; free to take`;
  }
}

/** Phone leases shared by every MoTA window and agent session through one file, ~/.mota/devices.json. */
export class LeaseStore {
  readonly file: string;
  /** The store's clock (injectable for tests). */
  readonly now: () => number;
  private readonly alive: (pid: number) => boolean;

  constructor(private opts: LeaseOptions) {
    const dir = opts.dir ?? join(homedir(), '.mota');
    this.file = join(dir, 'devices.json');
    this.now = opts.now ?? Date.now;
    this.alive = opts.alive ?? pidAlive;
  }

  async read(): Promise<LeaseFile> {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<LeaseFile>;
      if (data?.version !== 1) return empty();
      return { ...empty(), ...data, leases: data.leases ?? {}, busy: Array.isArray(data.busy) ? data.busy : [], sessions: data.sessions ?? {}, notices: data.notices ?? {} };
    } catch { return empty(); }
  }

  async use(serials: string[]): Promise<Map<string, DeviceUse>> {
    const file = await this.read(), now = this.now();
    return new Map(serials.map(s => [s, useOf(file, s, now, this.opts, this.alive)]));
  }

  /** Why the holder can't use these phones now, or undefined. Changes nothing. */
  async check(holder: Holder, serials: string[]): Promise<string | undefined> {
    const file = await this.read(), now = this.now();
    const reasons = serials.map(s => blockedReason(useOf(file, s, now, this.opts, this.alive), holder.id, now)).filter(Boolean);
    return reasons.length ? reasons.join('\n') : undefined;
  }

  /**
   * Gives the holder all of these phones, or none. Free and idle phones are taken at once (an idle holder is told on its next call);
   * phones in active use or busy with others' work are refused.
   */
  claim(holder: Holder, serials: string[]): Promise<{ ok: true } | { ok: false; reason: string }> {
    return this.update(file => {
      const now = this.now();
      const reasons = serials.map(s => blockedReason(useOf(file, s, now, this.opts, this.alive), holder.id, now)).filter(Boolean);
      if (reasons.length) return { ok: false, reason: reasons.join('\n') };
      for (const serial of serials) {
        const prev = file.leases[serial];
        if (prev && prev.holder.id !== holder.id && this.alive(prev.holder.pid)) (file.notices[prev.holder.id] ??= []).push({ serial, by: holder.label, at: now });
        file.leases[serial] = { holder, claimedAt: prev?.holder.id === holder.id ? prev.claimedAt : now, lastActivity: now };
      }
      return { ok: true };
    });
  }

  /** Records activity on phones the holder still holds. */
  touch(holderId: string, serials: string[]): Promise<void> {
    return this.update(file => { const now = this.now(); for (const s of serials) { const l = file.leases[s]; if (l?.holder.id === holderId) { l.lastActivity = now; l.parked = false; } } });
  }

  /** The holder stopped working (finished, waiting for the user): its phones count as idle now. */
  park(holderId: string): Promise<void> {
    return this.update(file => { for (const l of Object.values(file.leases)) if (l.holder.id === holderId) l.parked = true; });
  }

  release(holderId: string, serials?: string[]): Promise<void> {
    return this.update(file => { for (const [s, l] of Object.entries(file.leases)) if (l.holder.id === holderId && (!serials || serials.includes(s))) delete file.leases[s]; });
  }

  /** Marks phones busy with some work until the returned function is called. `pid` is the process doing the work. */
  async begin(serials: string[], what: string, holder?: Holder, pid = process.pid): Promise<() => Promise<void>> {
    const ids = serials.map(() => randomBytes(6).toString('hex'));
    const startedAt = this.now();
    await this.update(file => { serials.forEach((serial, i) => file.busy.push({ id: ids[i], serial, what, pid, startedAt, ...(holder ? { holderId: holder.id, holderLabel: holder.label } : {}) })); });
    let ended = false;
    return async () => {
      if (ended) return;
      ended = true;
      await this.update(file => {
        file.busy = file.busy.filter(o => !ids.includes(o.id));
        if (holder) { const now = this.now(); for (const s of serials) { const l = file.leases[s]; if (l?.holder.id === holder.id) { l.lastActivity = now; l.parked = false; } } }
      });
    };
  }

  /** Sets (or clears, with undefined) a session's own idle timeout. */
  setSessionIdle(holder: Holder, seconds: number | undefined): Promise<void> {
    return this.update(file => { if (seconds === undefined) delete file.sessions[holder.id]; else file.sessions[holder.id] = { pid: holder.pid, idleSeconds: seconds }; });
  }

  /** Notices for the holder, removed once read. */
  takeNotices(holderId: string): Promise<Notice[]> {
    return this.update(file => { const list = file.notices[holderId] ?? []; delete file.notices[holderId]; return list; });
  }

  /** Read-modify-write under a lock file, so windows and processes don't overwrite each other. Also drops entries of ended processes. */
  async update<T>(change: (file: LeaseFile) => T): Promise<T> {
    await fs.mkdir(join(this.file, '..'), { recursive: true });
    const unlock = await this.lock();
    try {
      const file = await this.read();
      const result = change(file);
      this.prune(file);
      const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(file, null, 1));
      await fs.rename(tmp, this.file);
      return result;
    } finally { await unlock(); }
  }

  private prune(file: LeaseFile) {
    const now = this.now();
    for (const [s, l] of Object.entries(file.leases)) if (!this.alive(l.holder.pid)) delete file.leases[s];
    file.busy = file.busy.filter(o => this.alive(o.pid));
    for (const [id, s] of Object.entries(file.sessions)) if (!this.alive(s.pid)) delete file.sessions[id];
    for (const [id, list] of Object.entries(file.notices)) { const kept = list.filter(n => now - n.at < NOTICE_TTL); if (kept.length) file.notices[id] = kept; else delete file.notices[id]; }
  }

  private async lock(): Promise<() => Promise<void>> {
    const path = `${this.file}.lock`;
    for (let attempt = 0; ; attempt++) {
      try {
        const handle = await fs.open(path, 'wx');
        await handle.close();
        return () => fs.unlink(path).catch(() => undefined);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        const stat = await fs.stat(path).catch(() => undefined);
        if (stat && Date.now() - stat.mtimeMs > LOCK_STALE) { await fs.unlink(path).catch(() => undefined); continue; }
        if (attempt > 200) throw new Error(`MoTA's device lease file is locked (${path}). Delete that file if no MoTA window is running.`);
        await new Promise(r => setTimeout(r, 15 + Math.random() * 20));
      }
    }
  }
}

/** What a tool layer needs: refuse, or hold the phones for the length of a call. Bound to one caller. */
export interface LeaseGate {
  holder(): Promise<Holder>;
  /** Why the caller can't change these phones now, or undefined. */
  check(serials: string[]): Promise<string | undefined>;
  /** Claims the phones and marks them busy for the call; `refused` explains why it couldn't. */
  enter(serials: string[], what: string): Promise<{ refused: string } | { exit: () => Promise<void> }>;
  /** Notices for the caller (shown once), as text. */
  notes(): Promise<string>;
  describe(serials: string[]): Promise<Map<string, string>>;
}

export function noticeText(list: Notice[], now = Date.now()): string {
  return list.map(n => `Note: ${n.serial} was idle, so it was handed to ${n.by} ${ago(now - n.at)} ago. Check list_devices before using it again.`).join('\n');
}

export function leaseGate(store: LeaseStore, who: Holder | (() => Promise<Holder>)): LeaseGate {
  const now = store.now;
  let cached: Promise<Holder> | undefined;
  const holder = () => cached ??= typeof who === 'function' ? who() : Promise.resolve(who);
  const refusal = (reason: string) => `${reason}\nUse a free phone from list_devices, or try this one again later.`;
  return {
    holder,
    async check(serials) { const r = await store.check(await holder(), serials); return r && refusal(r); },
    async enter(serials, what) {
      const h = await holder();
      const claimed = await store.claim(h, serials);
      if (!claimed.ok) return { refused: refusal(claimed.reason) };
      return { exit: await store.begin(serials, what, h) };
    },
    async notes() { return noticeText(await store.takeNotices((await holder()).id), now()); },
    async describe(serials) {
      const h = await holder(), t = now();
      return new Map([...(await store.use(serials))].map(([s, u]) => [s, describeUse(u, h.id, t)]));
    },
  };
}
