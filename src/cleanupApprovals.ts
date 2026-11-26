// Device cleanup (clearing an app's data, uninstalling an app) asked for by AI agents:
// the standing approval that lets it run without asking, and the history of what ran.
// Cleanup cannot be undone, so the history is a record only.

/** Tools that count as device cleanup. */
export const CLEANUP_TOOLS: ReadonlySet<string> = new Set(['clear_app_data', 'uninstall_app']);

export interface CleanupEntry {
  /** ISO time. */
  at: string;
  tool: string;
  serial: string;
  package: string;
  /** The session that asked, e.g. "claude · ~/project". */
  who: string;
  /** Why the agent needed it. */
  reason: string;
  /** The task the session is working on, when it named one. */
  taskId?: string;
  /** allowed: approved in the prompt; standing: not asked. */
  decision: 'allowed' | 'standing' | 'declined';
  result?: 'ok' | 'error';
}

/** vscode.Memento, or anything shaped like it. */
export interface CleanupState {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

const STANDING_KEY = 'cleanup.standingApproval';
const HISTORY_KEY = 'cleanup.history';
export const CLEANUP_HISTORY_LIMIT = 300;

export class CleanupApprovals {
  constructor(private readonly state: CleanupState) {}

  /** When cleanup was approved for all later calls, if it is. */
  standingSince(): string | undefined { return this.state.get<string | undefined>(STANDING_KEY, undefined); }
  standing(): boolean { return !!this.standingSince(); }
  async setStanding(on: boolean): Promise<void> { await this.state.update(STANDING_KEY, on ? new Date().toISOString() : undefined); }

  /** Newest first. */
  history(): CleanupEntry[] { return this.state.get<CleanupEntry[]>(HISTORY_KEY, []); }
  record(entry: Omit<CleanupEntry, 'at'>): void {
    void this.state.update(HISTORY_KEY, [{ ...entry, at: new Date().toISOString() }, ...this.history()].slice(0, CLEANUP_HISTORY_LIMIT));
  }
}

/** The reason and task of a cleanup call, from its arguments. */
export function cleanupPurpose(args: Record<string, unknown>): { reason: string; taskId?: string } {
  const reason = typeof args.reason === 'string' ? args.reason.replace(/\s+/g, ' ').trim() : '';
  const task = args.taskId === undefined || args.taskId === null ? '' : String(args.taskId).trim();
  return { reason, ...(task ? { taskId: task } : {}) };
}

/** "Why: … / For: task 142 / Asked by: claude · ~/project" for the approval prompt. */
export function cleanupPurposeText(p: { reason: string; taskId?: string }, who?: string): string {
  return [`Why: ${p.reason || 'no reason given'}`, `For: ${p.taskId ? `task ${p.taskId}` : 'no task named'}`, who ? `Asked by: ${who}` : ''].filter(Boolean).join('\n');
}

export function cleanupWhat(e: Pick<CleanupEntry, 'tool' | 'package' | 'serial'>): string {
  return `${e.tool === 'uninstall_app' ? 'Uninstalled' : 'Cleared data of'} ${e.package} on ${e.serial}`;
}
