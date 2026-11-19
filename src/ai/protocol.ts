/**
 * Messages between MoTA webviews (the Claude bar, test pages) and the extension host.
 * The webview side is owned by the UI; the host side by src/ai and src/maestro.
 * Every message has a `type`; unknown types are ignored by both sides.
 */

// ── Claude conversations ────────────────────────────────────────────────

/** How much Claude may do before asking. */
export type Permission =
  /** One approval per task (a plan card); data-loss actions ask again. Default. */
  | 'ask-task'
  /** Only data-loss actions ask (clear data, uninstall, overwrite a flow…). */
  | 'ask-data-loss'
  /** Look only: screenshots, UI tree, logs, results. No input, installs or file writes. */
  | 'read-only';

export const DEFAULT_PERMISSION: Permission = 'ask-task';

/** Token cap choices offered in the UI, with what fits in each. Estimates except `quick`. */
export const TOKEN_CAPS = [
  { tokens: 15_000, hint: 'Quick action or question (5–15K)' },
  { tokens: 40_000, hint: 'Diagnose one failure (15–40K) or summarise a run (10–30K)' },
  { tokens: 150_000, hint: 'Write or fix one flow (60–150K)' },
  { tokens: 300_000, hint: 'Explore the app for about 10 minutes (200K+)' },
] as const;
export const DEFAULT_TOKEN_CAP = 40_000;
export const DIAGNOSIS_TOKEN_CAP = 150_000;
/** Below this the model isn't told its budget (API minimum); MoTA still stops the task at the cap. */
export const MIN_TOKEN_CAP = 20_000;

export interface Scope { serials: string[] }

export type ApprovalDecision = 'once' | 'conversation' | 'deny';

export type WebviewToHost =
  | { type: 'ai/send'; convId?: string; text: string; mode: 'claude' | 'adb'; scope: Scope; permission: Permission; model: string; tokenCap: number }
  | { type: 'ai/approve'; convId: string; requestId: string; decision: ApprovalDecision }
  | { type: 'ai/stop'; convId: string }
  | { type: 'ai/new' }
  | { type: 'ai/list' }
  | { type: 'ai/models' }
  | TestRequest;

export type ToolState = 'running' | 'ok' | 'error';
export type ApprovalKind = 'plan' | 'data-loss' | 'device-change';
export type Outcome = 'success' | 'cap-reached' | 'stopped' | 'denied' | 'error';

export interface Usage { inputTokens: number; outputTokens: number; cacheReadTokens: number; totalTokens: number; tokenCap: number; costUsd: number }
export interface ConversationSummary { convId: string; title: string; updatedAt: number; totalTokens: number }
export interface ModelChoice { id: string; label: string }

export type HostToWebview =
  | { type: 'ai/started'; convId: string; title: string; model: string; tokenCap: number; scope: Scope }
  | { type: 'ai/text'; convId: string; messageId: string; delta: string }
  | { type: 'ai/text-end'; convId: string; messageId: string }
  /** One line per tool call, e.g. "✓ install_apk → 2 devices · 41 s". The same callId updates the line. */
  | { type: 'ai/tool'; convId: string; callId: string; name: string; summary: string; devices?: string[]; state: ToolState; durationMs?: number; detail?: string; thumbUri?: string }
  | { type: 'ai/approval'; convId: string; requestId: string; kind: ApprovalKind; title: string; steps?: string[]; devices: string[]; tool?: string; tokenCapEstimate?: number }
  | { type: 'ai/usage'; convId: string } & Usage
  | { type: 'ai/attachment'; convId: string; callId?: string; kind: 'screenshot' | 'flow-diff' | 'report'; uri: string; caption?: string }
  | { type: 'ai/done'; convId: string; outcome: Outcome; message?: string }
  | { type: 'ai/conversations'; items: ConversationSummary[] }
  | { type: 'ai/models'; items: ModelChoice[] }
  | TestEvent;

// ── Maestro test runs ───────────────────────────────────────────────────

export type TestRequest =
  | { type: 'test/flows' }
  | { type: 'test/start'; flows: string[]; serials: string[]; env: Record<string, string>; includeTags?: string[]; excludeTags?: string[]; installApk?: string; clearData?: string }
  | { type: 'test/cancel'; runId: string; serial?: string }
  | { type: 'test/diagnose'; runId: string; serial: string; flow: string };

export type DeviceRunState = 'starting' | 'running' | 'done' | 'cancelled' | 'lost' | 'error';
export type FlowStatus = 'pass' | 'fail' | 'not-run';

export interface FlowInfo { path: string; name: string; tags: string[]; appId?: string }
export interface FlowFailure { step?: string; message: string; screenshotUri?: string }

export type TestEvent =
  | { type: 'test/flows'; folder: string; items: FlowInfo[]; error?: string }
  | { type: 'test/started'; runId: string; flows: string[]; serials: string[]; dir: string; devices: { serial: string; model: string }[] }
  | { type: 'test/progress'; runId: string; serial: string; state: DeviceRunState; startedAt: number; currentFlow?: string; passed: number; failed: number; total: number; message?: string }
  | { type: 'test/flow'; runId: string; serial: string; flow: string; status: FlowStatus; durationMs: number; failure?: FlowFailure }
  | { type: 'test/done'; runId: string; passed: number; failed: number; notRun: number }
  /** A test request could not start or be handled (no Maestro, device not ready, bad flow…). */
  | { type: 'test/error'; message: string; runId?: string };
