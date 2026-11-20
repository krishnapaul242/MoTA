import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Who holds a phone: an outside agent (by its process), a MoTA assistant conversation, … */
export interface Holder { id: string; label: string; pid: number }
export interface Lease { holder: Holder; claimedAt: number; lastActivity: number; parked?: boolean; parkedAt?: number }
/** Work that keeps a phone busy whoever holds it: a test run, a long tool call. */
export interface BusyOp { id: string; serial: string; what: string; pid: number; holderId?: string; holderLabel?: string; startedAt: number }
export interface Notice { serial: string; by: string; at: number; kind?: 'idle' | 'takeover' }
/** A session waiting for a phone. `at` is when it joined, or was put back after losing the phone. */
export interface QueueEntry { holder: Holder; at: number }
/** A session asking the user to hand it a phone someone else is using. `pid` is the window that shows the prompt. */
export interface Takeover { id: string; serial: string; requester: Holder; at: number; pid: number; status: 'pending' | 'granted' | 'declined'; decidedAt?: number; why?: string }
export interface LeaseFile {
  version: 1;
  leases: Record<string, Lease>;
  busy: BusyOp[];
  /** Per-session settings, by holder id. */
  sessions: Record<string, { pid: number; idleSeconds?: number }>;
  /** Messages a holder sees on its next call, e.g. that its phone was handed to someone else. */
  notices: Record<string, Notice[]>;
  queues: Record<string, QueueEntry[]>;
  takeovers: Takeover[];
  /** When each phone last stopped being held or busy. */
  freedAt: Record<string, number>;
}

export type UseState = 'free' | 'active' | 'idle' | 'busy';
export interface DeviceUse {
  serial: string; state: UseState; holder?: Holder; lastActivity?: number; idleSeconds: number; ops: BusyOp[];
  /** Waiting sessions, first in line first (expired turns already dropped). */
  queue: QueueEntry[];
  /** While free or idle with a queue: the first in line has the phone to itself until then. */
  reservedUntil?: number;
  takeover?: Takeover;
}

/** What the window shows the user for a takeover request. */
export interface TakeoverPrompt { serial: string; requester: string; holder: string; busy?: string }
export type Answer = 'allow' | 'decline' | undefined;

export interface LeaseOptions {
  /** Folder of devices.json, shared by every VS Code window. */
  dir?: string;
  idleSeconds: () => number;
  deviceIdleSeconds: () => Record<string, number>;
  /** The most a session may set its own idle time to (the user's settings have no cap). */
  maxSessionIdleSeconds?: () => number;
  /** Asks the user to hand a phone over; `decided` says (after a late click) that it was already settled. */
  prompt?: (p: TakeoverPrompt, decided: () => string | undefined) => Promise<Answer>;
  /** Stops this window's work on a phone (a test run) after the user handed it over. */
  cancelWork?: (serial: string) => void;
  now?: () => number;
  alive?: (pid: number) => boolean;
  /** How long one acquire_device call waits before answering "still waiting" (clients time tool calls out). */
  waitMs?: number;
  pollMs?: number;
  /** How long a takeover prompt waits for an answer before the phone's state decides it. */
  takeoverMs?: number;
}
type Timeouts = Pick<LeaseOptions, 'idleSeconds' | 'deviceIdleSeconds'>;

const empty = (): LeaseFile => ({ version: 1, leases: {}, busy: [], sessions: {}, notices: {}, queues: {}, takeovers: [], freedAt: {} });
const NOTICE_TTL = 24 * 3600_000;
const DECIDED_TTL = 10 * 60_000;
const LOCK_STALE = 10_000;
export const TAKEOVER_MS = 120_000;

export function pidAlive(pid: number): boolean {
  if (!pid) return true; // unknown process: only the idle timeout frees its phones
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

const positive = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;

/** Seconds without activity before a holder's phone counts as idle: the session's own setting, then the phone's, then the global one. */
export function idleSecondsFor(file: LeaseFile, serial: string, holderId: string | undefined, opts: Timeouts): number {
  return positive(holderId ? file.sessions[holderId]?.idleSeconds : undefined) ?? positive(opts.deviceIdleSeconds()?.[serial]) ?? positive(opts.idleSeconds()) ?? 120;
}

/** How a phone is used right now. Leases, work and queue places of processes that have ended don't count. */
export function useOf(file: LeaseFile, serial: string, now: number, opts: Timeouts, alive: (pid: number) => boolean = pidAlive): DeviceUse {
  const ops = file.busy.filter(o => o.serial === serial && alive(o.pid));
  const lease = file.leases[serial];
  const holder = lease && alive(lease.holder.pid) ? lease.holder : undefined;
  const idleSeconds = idleSecondsFor(file, serial, holder?.id, opts);
  const state: UseState = ops.length ? 'busy' : !holder ? 'free' : lease!.parked || now - lease!.lastActivity >= idleSeconds * 1000 ? 'idle' : 'active';
  // A free or idle phone is kept for the first in line for one idle period; if it doesn't come for it, the next one gets the turn.
  const queue = (file.queues[serial] ?? []).filter(e => alive(e.holder.pid) && e.holder.id !== holder?.id);
  let reservedUntil: number | undefined;
  if (state === 'free' || state === 'idle') {
    const since = Math.max(file.freedAt[serial] ?? 0, state === 'idle' ? (lease!.parked ? lease!.parkedAt ?? lease!.lastActivity : lease!.lastActivity + idleSeconds * 1000) : 0);
    while (queue.length) {
      const until = Math.max(since, queue[0].at) + idleSecondsFor(file, serial, queue[0].holder.id, opts) * 1000;
      if (now < until) { reservedUntil = until; break; }
      queue.shift();
    }
  }
  const takeover = file.takeovers.find(t => t.serial === serial && t.status === 'pending' && alive(t.pid));
  return { serial, state, idleSeconds, ops, queue, ...(reservedUntil ? { reservedUntil } : {}), ...(takeover ? { takeover } : {}), ...(holder ? { holder, lastActivity: lease!.lastActivity } : {}) };
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
}

const opText = (o: BusyOp, now: number) => `${o.what}${o.holderLabel ? ` for ${o.holderLabel}` : ''}, started ${ago(now - o.startedAt)} ago`;

/** Why `holderId` can't use a phone now, or undefined when it can. With `force`, only the phone's own state counts, not the queue. */
export function blockedReason(use: DeviceUse, holderId: string, now: number, force = false): string | undefined {
  const others = use.ops.filter(o => o.holderId !== holderId);
  if (others.length) return `${use.serial} is busy: ${opText(others[0], now)}.`;
  if (use.state === 'active' && use.holder && use.holder.id !== holderId)
    return `${use.serial} is in use by ${use.holder.label} (last action ${ago(now - (use.lastActivity ?? now))} ago). It frees up after ${use.idleSeconds} s without activity.`;
  const first = use.queue[0];
  if (!force && first && first.holder.id !== holderId && use.holder?.id !== holderId)
    return `${use.serial} is kept for ${first.holder.label}, first in line for it, for up to ${ago((use.reservedUntil ?? now) - now)} more.`;
  return undefined;
}

/** One line about a phone's use, from the point of view of `holderId`. */
export function describeUse(use: DeviceUse, holderId: string | undefined, now: number): string {
  const mine = !!use.holder && use.holder.id === holderId;
  const since = use.lastActivity ? ago(now - use.lastActivity) : '';
  const place = use.queue.findIndex(e => e.holder.id === holderId);
  const line = use.queue.length ? `; ${use.queue.length} waiting${place >= 0 ? `, you are number ${place + 1}` : ''}` : '';
  const asked = use.takeover ? `; ${use.takeover.requester.id === holderId ? 'you have' : `${use.takeover.requester.label} has`} asked the user to take it over` : '';
  switch (use.state) {
    case 'free': return (use.queue.length && use.queue[0].holder.id !== holderId ? `free, but kept for ${use.queue[0].holder.label} for now` : 'free') + line + asked;
    case 'busy': return `busy: ${opText(use.ops[0], now)}` + line + asked;
    case 'active': return (mine ? 'yours' : `in use by ${use.holder!.label} (last action ${since} ago)`) + line + asked;
    case 'idle': return (mine ? `yours, idle for ${since} (others may take it)` : use.queue.length && use.queue[0].holder.id !== holderId ? `idle, kept for ${use.queue[0].holder.label} for now` : `idle for ${since}, last used by ${use.holder!.label}; free to take`) + line + asked;
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Phone leases shared by every MoTA window and agent session through one file, ~/.mota/devices.json. */
export class LeaseStore {
  readonly file: string;
  /** The store's clock (injectable for tests). */
  readonly now: () => number;
  private readonly alive: (pid: number) => boolean;
  /** Takeover requests this window is settling. */
  private settling = new Set<string>();

  constructor(readonly opts: LeaseOptions) {
    const dir = opts.dir ?? join(homedir(), '.mota');
    this.file = join(dir, 'devices.json');
    this.now = opts.now ?? Date.now;
    this.alive = opts.alive ?? pidAlive;
  }

  async read(): Promise<LeaseFile> {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<LeaseFile>;
      if (data?.version !== 1) return empty();
      const e = empty();
      return { ...e, ...data, busy: Array.isArray(data.busy) ? data.busy : [], takeovers: Array.isArray(data.takeovers) ? data.takeovers : [],
        leases: data.leases ?? {}, sessions: data.sessions ?? {}, notices: data.notices ?? {}, queues: data.queues ?? {}, freedAt: data.freedAt ?? {} };
    } catch { return empty(); }
  }

  private useIn(file: LeaseFile, serial: string) { return useOf(file, serial, this.now(), this.opts, this.alive); }

  async use(serials: string[]): Promise<Map<string, DeviceUse>> {
    const file = await this.read();
    return new Map(serials.map(s => [s, this.useIn(file, s)]));
  }

  /** Why the holder can't use these phones now, or undefined. Changes nothing. */
  async check(holder: Holder, serials: string[]): Promise<string | undefined> {
    const file = await this.read(), now = this.now();
    const reasons = serials.map(s => blockedReason(this.useIn(file, s), holder.id, now)).filter(Boolean);
    return reasons.length ? reasons.join('\n') : undefined;
  }

  /** Hands a phone to `holder`. Whoever held it is told, and put first in line to get it back. */
  private give(file: LeaseFile, serial: string, holder: Holder, kind: 'idle' | 'takeover') {
    const now = this.now();
    const prev = file.leases[serial];
    // The line as it stands now: sessions whose turn already passed are dropped.
    const queue = this.useIn(file, serial).queue.filter(e => e.holder.id !== holder.id);
    if (prev && prev.holder.id !== holder.id && this.alive(prev.holder.pid)) {
      (file.notices[prev.holder.id] ??= []).push({ serial, by: holder.label, at: now, kind });
      queue.unshift({ holder: prev.holder, at: now });
    }
    if (queue.length) file.queues[serial] = queue; else delete file.queues[serial];
    file.leases[serial] = { holder, claimedAt: prev?.holder.id === holder.id ? prev.claimedAt : now, lastActivity: now };
  }

  /**
   * Gives the holder all of these phones, or none. Free and idle phones are taken at once (an idle holder is told on its next call
   * and put first in line); phones in active use, busy with others' work, or kept for whoever is first in line are refused.
   */
  claim(holder: Holder, serials: string[]): Promise<{ ok: true } | { ok: false; reason: string }> {
    return this.update(file => {
      const now = this.now();
      const reasons = serials.map(s => blockedReason(this.useIn(file, s), holder.id, now)).filter(Boolean);
      if (reasons.length) return { ok: false, reason: reasons.join('\n') };
      for (const serial of serials) this.give(file, serial, holder, 'idle');
      return { ok: true };
    });
  }

  /** Records activity on phones the holder still holds. */
  touch(holderId: string, serials: string[]): Promise<void> {
    return this.update(file => { const now = this.now(); for (const s of serials) { const l = file.leases[s]; if (l?.holder.id === holderId) { l.lastActivity = now; l.parked = false; } } });
  }

  /** The holder stopped working (finished, waiting for the user): its phones count as idle now. */
  park(holderId: string): Promise<void> {
    return this.update(file => { const now = this.now(); for (const l of Object.values(file.leases)) if (l.holder.id === holderId && !l.parked) { l.parked = true; l.parkedAt = now; } });
  }

  /** Gives phones back (all of the holder's without `serials`) and leaves their queues. Returns the phones it held. */
  release(holderId: string, serials?: string[]): Promise<string[]> {
    return this.update(file => {
      const now = this.now(), released: string[] = [];
      for (const [s, l] of Object.entries(file.leases)) if (l.holder.id === holderId && (!serials || serials.includes(s))) { delete file.leases[s]; file.freedAt[s] = now; released.push(s); }
      for (const [s, q] of Object.entries(file.queues)) if (!serials || serials.includes(s)) file.queues[s] = q.filter(e => e.holder.id !== holderId);
      return released;
    });
  }

  /** Puts the holder in line for a phone (keeping its place if it is already there). Returns its place, from 1. */
  join(holder: Holder, serial: string): Promise<number> {
    return this.update(file => {
      const queue = file.queues[serial] ??= [];
      if (!queue.some(e => e.holder.id === holder.id)) queue.push({ holder, at: this.now() });
      return this.useIn(file, serial).queue.findIndex(e => e.holder.id === holder.id) + 1;
    });
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
        const now = this.now();
        file.busy = file.busy.filter(o => !ids.includes(o.id));
        for (const s of serials) {
          file.freedAt[s] = now;
          const l = file.leases[s];
          if (holder && l?.holder.id === holder.id) { l.lastActivity = now; l.parked = false; }
        }
      });
    };
  }

  /** Sets (or clears, with undefined) a session's own idle timeout, capped by maxSessionIdleSeconds unless `byUser`. Returns the value set. */
  setSessionIdle(holder: Holder, seconds: number | undefined, byUser = false): Promise<number | undefined> {
    const cap = positive(this.opts.maxSessionIdleSeconds?.()) ?? 900;
    const value = seconds === undefined ? undefined : Math.max(10, byUser ? seconds : Math.min(seconds, cap));
    return this.update(file => { if (value === undefined) delete file.sessions[holder.id]; else file.sessions[holder.id] = { pid: holder.pid, idleSeconds: value }; return value; });
  }

  /** Notices for the holder, removed once read. */
  takeNotices(holderId: string): Promise<Notice[]> {
    return this.update(file => { const list = file.notices[holderId] ?? []; delete file.notices[holderId]; return list; });
  }

  /**
   * Asks the user (in this window) to hand `serial` to `requester` now. Settles by itself: yes as soon as the phone is idle,
   * and when the time runs out, yes if it is idle then and no if it is still in use. Returns the request (an existing one is reused).
   */
  async requestTakeover(requester: Holder, serial: string): Promise<Takeover> {
    const made = await this.update(file => {
      const existing = file.takeovers.find(t => t.serial === serial && t.requester.id === requester.id && this.alive(t.pid));
      if (existing) return { t: existing, fresh: false };
      const t: Takeover = { id: randomBytes(6).toString('hex'), serial, requester, at: this.now(), pid: process.pid, status: 'pending' };
      file.takeovers.push(t);
      return { t, fresh: true };
    });
    if (made.fresh || (made.t.status === 'pending' && made.t.pid === process.pid && !this.settling.has(made.t.id))) void this.settle(made.t);
    return made.t;
  }

  /** The takeover request of `requester` for `serial`, if any; a decided one is removed once read. */
  takeoverOf(requester: Holder, serial: string): Promise<Takeover | undefined> {
    return this.update(file => {
      const t = file.takeovers.find(x => x.serial === serial && x.requester.id === requester.id && this.alive(x.pid));
      if (t && t.status !== 'pending') file.takeovers = file.takeovers.filter(x => x !== t);
      return t;
    });
  }

  private async settle(request: Takeover) {
    this.settling.add(request.id);
    const limit = this.opts.takeoverMs ?? TAKEOVER_MS, poll = this.opts.pollMs ?? 1000;
    let decided: string | undefined, answer: Answer;
    try {
      const use = (await this.use([request.serial])).get(request.serial)!;
      const busy = use.ops.find(o => o.holderId !== request.requester.id);
      void this.opts.prompt?.({ serial: request.serial, requester: request.requester.label, holder: use.holder?.label ?? 'nobody', ...(busy ? { busy: opText(busy, this.now()) } : {}) }, () => decided)
        .then(a => { answer = a; }, () => undefined);
      for (;;) {
        const result = await this.update(file => {
          const t = file.takeovers.find(x => x.id === request.id);
          if (!t || t.status !== 'pending') return 'gone';
          const now = this.now(), u = this.useIn(file, t.serial);
          const free = !blockedReason(u, t.requester.id, now, true);
          const decide = (status: 'granted' | 'declined', why: string) => { t.status = status; t.why = why; t.decidedAt = now; if (status === 'granted') this.give(file, t.serial, t.requester, 'takeover'); return status; };
          if (answer === 'allow') return decide('granted', 'the user agreed');
          if (answer === 'decline') return decide('declined', 'the user said no');
          if (free) return decide('granted', `${t.serial} became idle`);
          if (now - t.at >= limit) return decide('declined', `nobody answered within ${Math.round(limit / 1000)} s and ${t.serial} was still in use`);
          return 'pending';
        });
        if (result === 'gone') { decided ??= 'it was withdrawn'; return; }
        if (result !== 'pending') {
          decided = result === 'granted' ? `handed to ${request.requester.label}` : `kept, because ${answer === 'decline' ? 'you said no' : 'it was still in use when the time ran out'}`;
          // Work on the phone stops when the user hands it over in the middle of it.
          if (result === 'granted' && answer === 'allow') this.opts.cancelWork?.(request.serial);
          return;
        }
        await sleep(poll);
      }
    } finally { this.settling.delete(request.id); }
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
    for (const [s, l] of Object.entries(file.leases)) if (!this.alive(l.holder.pid)) { delete file.leases[s]; file.freedAt[s] = now; }
    file.busy = file.busy.filter(o => { if (this.alive(o.pid)) return true; file.freedAt[o.serial] = now; return false; });
    for (const [id, s] of Object.entries(file.sessions)) if (!this.alive(s.pid)) delete file.sessions[id];
    for (const [id, list] of Object.entries(file.notices)) { const kept = list.filter(n => now - n.at < NOTICE_TTL); if (kept.length) file.notices[id] = kept; else delete file.notices[id]; }
    for (const s of Object.keys(file.queues)) { const kept = this.useIn(file, s).queue; if (kept.length) file.queues[s] = kept; else delete file.queues[s]; }
    file.takeovers = file.takeovers.filter(t => this.alive(t.pid) && this.alive(t.requester.pid) && (t.status === 'pending' || now - (t.decidedAt ?? now) < DECIDED_TTL));
    for (const [s, at] of Object.entries(file.freedAt)) if (now - at > NOTICE_TTL) delete file.freedAt[s];
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
        await sleep(15 + Math.random() * 20);
      }
    }
  }
}

export type AcquireMode = 'wait' | 'takeover';
export type AcquireResult =
  | { status: 'granted'; serial: string; text: string }
  | { status: 'waiting' | 'asking' | 'declined' | 'none'; serial?: string; text: string };

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
  /** Waits in line for a phone, or asks the user to hand it over. Without a serial, takes any free phone from `candidates`. */
  acquire(request: { serial?: string; candidates: string[]; mode: AcquireMode; idleSeconds?: number }): Promise<AcquireResult>;
  release(serials?: string[]): Promise<string[]>;
}

export function noticeText(list: Notice[], now = Date.now()): string {
  return list.map(n => n.kind === 'takeover'
    ? `Note: the user handed ${n.serial} to ${n.by} ${ago(now - n.at)} ago, so it is no longer yours. You are first in line to get it back: call acquire_device with mode "wait", or use another phone. Its app state may have changed.`
    : `Note: ${n.serial} was idle, so it was handed to ${n.by} ${ago(now - n.at)} ago. You are first in line to get it back: call acquire_device with mode "wait", or use another phone. Its app state may have changed.`).join('\n');
}

const OPTIONS = 'To get it, call acquire_device with this serial and mode "wait" (wait in line for it) or mode "takeover" (ask the user to hand it to you now), or use a free phone from list_devices.';

export function leaseGate(store: LeaseStore, who: Holder | (() => Promise<Holder>)): LeaseGate {
  const now = store.now;
  let cached: Promise<Holder> | undefined;
  const holder = () => cached ??= typeof who === 'function' ? who() : Promise.resolve(who);
  const waitMs = store.opts.waitMs ?? 45_000, pollMs = store.opts.pollMs ?? 1000;
  const granted = (serial: string, how: string): AcquireResult => ({ status: 'granted', serial, text: `${serial} is yours${how}. Other sessions can't change it while you use it; it frees up after a while without activity, or when you call release_device.` });

  async function waitInLine(h: Holder, serial: string): Promise<AcquireResult> {
    const deadline = now() + waitMs;
    for (;;) {
      const claimed = await store.claim(h, [serial]);
      if (claimed.ok) return granted(serial, '');
      const place = await store.join(h, serial);
      if (now() >= deadline) {
        const use = (await store.use([serial])).get(serial)!;
        return { status: 'waiting', serial, text: `Still waiting for ${serial}: you are number ${place} in line. ${describeUse(use, h.id, now())}. Call acquire_device again with mode "wait" to keep waiting; your place is kept.` };
      }
      await sleep(pollMs);
    }
  }

  async function askUser(h: Holder, serial: string): Promise<AcquireResult> {
    const deadline = now() + waitMs;
    let t = await store.takeoverOf(h, serial);
    if (t && t.status !== 'pending') return t.status === 'granted' ? granted(serial, `: ${t.why}`) : declined(serial, t.why);
    const claimed = await store.claim(h, [serial]);
    if (claimed.ok) return granted(serial, '');
    t = await store.requestTakeover(h, serial);
    for (;;) {
      await sleep(pollMs);
      const current = await store.takeoverOf(h, serial);
      if (!current) return declined(serial, 'the request was withdrawn');
      if (current.status === 'granted') return granted(serial, `: ${current.why}`);
      if (current.status === 'declined') return declined(serial, current.why);
      if (now() >= deadline) {
        const left = Math.max(0, Math.round(((store.opts.takeoverMs ?? TAKEOVER_MS) - (now() - current.at)) / 1000));
        return { status: 'asking', serial, text: `Asked the user in VS Code to hand ${serial} to you; no answer yet. If nobody answers within ${left} s, you get it if it is idle by then. Call acquire_device again with mode "takeover" for the answer.` };
      }
    }
  }
  const declined = (serial: string, why = ''): AcquireResult => ({ status: 'declined', serial, text: `You did not get ${serial}${why ? `: ${why}` : ''}. Call acquire_device with mode "wait" to wait in line for it, or use another phone.` });

  return {
    holder,
    async check(serials) { const r = await store.check(await holder(), serials); return r && `${r}\n${OPTIONS}`; },
    async enter(serials, what) {
      const h = await holder();
      const claimed = await store.claim(h, serials);
      if (!claimed.ok) return { refused: `${claimed.reason}\n${OPTIONS}` };
      return { exit: await store.begin(serials, what, h) };
    },
    async notes() { return noticeText(await store.takeNotices((await holder()).id), now()); },
    async describe(serials) {
      const h = await holder(), t = now();
      return new Map([...(await store.use(serials))].map(([s, u]) => [s, describeUse(u, h.id, t)]));
    },
    async acquire({ serial, candidates, mode, idleSeconds }) {
      const h = await holder();
      const idle = idleSeconds === undefined ? undefined : await store.setSessionIdle(h, idleSeconds);
      const set = idle ? ` Your phones now count as idle after ${idle} s without activity.` : '';
      let result: AcquireResult;
      if (serial) result = mode === 'takeover' ? await askUser(h, serial) : await waitInLine(h, serial);
      else {
        result = { status: 'none', text: '' };
        for (const s of candidates) if ((await store.claim(h, [s])).ok) { result = granted(s, ''); break; }
        if (result.status === 'none') {
          const uses = await store.use(candidates);
          result.text = candidates.length
            ? `No phone is free now:\n${candidates.map(s => `${s} · ${describeUse(uses.get(s)!, h.id, now())}`).join('\n')}\nCall acquire_device with one of these serials and mode "wait" or "takeover".`
            : 'No phones are connected.';
        }
      }
      return { ...result, text: result.text + set };
    },
    release: async serials => store.release((await holder()).id, serials),
  };
}
