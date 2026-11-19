import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';
import type * as VSCode from 'vscode';
import type { Adb } from '../adb';
import { InputRouter } from '../helperInput';
import { discoverFlows, filterByTags } from '../maestro/flows';
import { MaestroRunner, resolveMaestro } from '../maestro/runner';
import { BUILTIN_TOOLS, decide, targetSerials, type PolicyContext } from './policy';
import { describeCall, diagnosisPrompt, systemPrompt } from './prompts';
import {
  DEFAULT_PERMISSION, DIAGNOSIS_TOKEN_CAP, MIN_TOKEN_CAP, type ApprovalDecision, type ApprovalKind, type ConversationSummary, type HostToWebview,
  type ModelChoice, type Outcome, type Permission, type TestEvent,
} from './protocol';
import { backupFlow, motaServer } from './tools';

export type Post = (message: HostToWebview) => unknown;
export interface Link { handle(message: unknown): Promise<void>; dispose(): void }
export interface AiHost { connect(post: Post): Link; readonly runner: MaestroRunner; readonly input: InputRouter; dispose(): void }

export interface HostDeps {
  adb: Adb;
  workspaceRoot: () => string;
  flowsFolder: () => string;
  runsFolder: () => string;
  maestroPath: () => string;
  claudePath: () => string;
  defaultModel: () => string;
  effort: () => 'low' | 'medium' | 'high' | 'xhigh';
  screenshotSide: () => number;
  store: { get(): StoredConversation[]; set(items: StoredConversation[]): unknown };
  loadSdk: () => Promise<typeof Sdk>;
  input?: InputRouter;
}

export interface StoredConversation extends ConversationSummary { sdkSessionId?: string; model: string; permission: Permission; scope: string[]; tokenCap: number }

interface Turn {
  abort: AbortController;
  planApproved: boolean;
  outcome?: Outcome;
  message?: string;
  messageId?: string;
  textOpen: boolean;
  usage: Map<string, { fresh: number; output: number; cacheRead: number }>;
  calls: Map<string, { name: string; input: Record<string, unknown>; start: number }>;
  costUsd: number;
}
interface Conversation extends StoredConversation {
  allowed: Set<string>;
  planForConversation: boolean;
  pending: Map<string, (d: ApprovalDecision) => void>;
  turn?: Turn;
}

const PERMISSIONS: Permission[] = ['ask-task', 'ask-data-loss', 'read-only'];
const DECISIONS: ApprovalDecision[] = ['once', 'conversation', 'deny'];
export const DEFAULT_MODELS: ModelChoice[] = [{ id: '', label: 'Default' }, { id: 'opus', label: 'Opus' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'haiku', label: 'Haiku' }];
const MAX_TURNS = 60;

/** Model dropdown entries from Claude Code's list; its "default" row becomes our '' (use the setting / Claude Code default). */
export function modelChoices(list: { value: string; displayName?: string }[]): ModelChoice[] {
  const def = list.find(m => m.value === 'default');
  return [{ id: '', label: def?.displayName || 'Default' }, ...list.filter(m => m.value !== 'default').map(m => ({ id: m.value, label: m.displayName || m.value }))];
}
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Native `import()` (TypeScript would turn it into `require`, which can't load the ESM-only SDK). */
const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
let sdkModule: Promise<typeof Sdk> | undefined;
/** The SDK bundled next to dist/extension.js (scripts/bundle.js), or the installed package when running from out/. */
export function sdkPath(dir = __dirname, exists = existsSync): string {
  const bundled = join(dir, 'agent-sdk.mjs');
  return exists(bundled) ? bundled : require.resolve('@anthropic-ai/claude-agent-sdk');
}
export function loadSdk(): Promise<typeof Sdk> {
  return sdkModule ??= nativeImport(pathToFileURL(sdkPath()).href) as Promise<typeof Sdk>;
}

/** The local Claude Code CLI: the setting, the installer's locations, then PATH. */
export function resolveClaude(configured = '', home = homedir(), exists = existsSync, path = process.env.PATH ?? ''): string {
  if (configured.trim()) { if (!exists(configured.trim())) throw new Error(`Claude Code was not found at ${configured.trim()} (mota.ai.claudePath).`); return configured.trim(); }
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const candidates = [join(home, '.local', 'bin', exe), join(home, '.claude', 'local', exe), ...path.split(delimiter).filter(Boolean).map(d => join(d, exe))];
  const found = candidates.find(c => exists(c));
  if (!found) throw new Error('Claude Code is not installed on this computer. Install it, run `claude` once in a terminal to sign in, then try again. If it is installed somewhere else, set mota.ai.claudePath.');
  return found;
}

/** Explains SDK start-up failures in terms of what to do. */
export function friendlyError(error: unknown): string {
  const text = errorText(error);
  if (/not logged in|login|authenticat|401|invalid api key|OAuth/i.test(text)) return `Claude Code is not signed in. Run \`claude\` in a terminal and sign in, then try again. (${text.split('\n')[0]})`;
  if (/ENOENT|spawn/i.test(text)) return `Could not start Claude Code. Check mota.ai.claudePath. (${text.split('\n')[0]})`;
  if (/rate limit|429|usage limit/i.test(text)) return `Your Claude usage limit was reached. Try again later. (${text.split('\n')[0]})`;
  return text;
}

/** Token use of one task: new input (uncached + cache writes) and output, per API call; cache reads are counted separately. */
export function taskTokens(usage: Turn['usage']) {
  let fresh = 0, output = 0, cacheRead = 0;
  for (const u of usage.values()) { fresh += u.fresh; output += u.output; cacheRead += u.cacheRead; }
  return { inputTokens: fresh, outputTokens: output, cacheReadTokens: cacheRead, totalTokens: fresh + output };
}

export class AiHostImpl implements AiHost {
  readonly runner: MaestroRunner;
  private links = new Set<Post>();
  private convs = new Map<string, Conversation>();
  private models: ModelChoice[] = DEFAULT_MODELS;
  private modelsLoaded = false;
  private lastShot = new Map<string, string>();
  readonly input: InputRouter;

  constructor(private deps: HostDeps) {
    this.input = deps.input ?? new InputRouter(deps.adb);
    this.runner = new MaestroRunner({ adb: deps.adb, maestro: () => resolveMaestro(deps.maestroPath()), flowsFolder: deps.flowsFolder, runsFolder: deps.runsFolder, emit: e => this.broadcast(e) });
    for (const c of deps.store.get()) this.convs.set(c.convId, { ...c, allowed: new Set(), planForConversation: false, pending: new Map() });
  }

  connect(post: Post): Link {
    this.links.add(post);
    post({ type: 'ai/models', items: this.models });
    for (const run of this.runner.running()) for (const e of this.replay(run.runId)) post(e);
    return { handle: m => this.handle(m, post), dispose: () => { this.links.delete(post); } };
  }

  dispose() {
    for (const c of this.convs.values()) if (c.turn) { c.turn.outcome = 'stopped'; c.turn.abort.abort(); }
    for (const run of this.runner.running()) this.runner.cancel(run.runId);
    this.links.clear();
  }

  private broadcast(message: HostToWebview) { for (const post of this.links) { try { post(message); } catch { /* a closed webview */ } } }

  private async handle(raw: unknown, post: Post) {
    const m = (raw ?? {}) as Record<string, unknown>;
    try {
      switch (m.type) {
        case 'ai/models': post({ type: 'ai/models', items: this.models }); return;
        case 'ai/list': post({ type: 'ai/conversations', items: this.summaries() }); return;
        case 'ai/new': return;
        case 'ai/stop': return this.stop(String(m.convId));
        case 'ai/approve': {
          const decision = DECISIONS.includes(m.decision as ApprovalDecision) ? m.decision as ApprovalDecision : 'deny';
          this.convs.get(String(m.convId))?.pending.get(String(m.requestId))?.(decision);
          return;
        }
        case 'ai/send': {
          if (m.mode === 'adb') return; // The ADB tab runs commands itself.
          const text = typeof m.text === 'string' ? m.text.trim() : '';
          if (!text || text.length > 20_000) throw new Error('Write a request of up to 20,000 characters.');
          const scope = Array.isArray((m.scope as { serials?: unknown })?.serials) ? ((m.scope as { serials: unknown[] }).serials.filter(s => typeof s === 'string' && /^[\w.:@-]{1,128}$/.test(s)) as string[]) : [];
          const permission = PERMISSIONS.includes(m.permission as Permission) ? m.permission as Permission : DEFAULT_PERMISSION;
          const tokenCap = Math.min(Math.max(Number(m.tokenCap) || 40_000, 5_000), 1_000_000);
          const model = typeof m.model === 'string' && m.model.length <= 100 ? m.model : this.deps.defaultModel();
          return this.send(typeof m.convId === 'string' ? m.convId : undefined, text, { scope, permission, tokenCap, model });
        }
        case 'test/flows': {
          const folder = this.deps.flowsFolder();
          try { post({ type: 'test/flows', folder, items: await discoverFlows(folder) }); }
          catch (e) { post({ type: 'test/flows', folder, items: [], error: /ENOENT/.test(errorText(e)) ? `No flows folder at ${folder}. Create it or set mota.maestroFlowsFolder.` : errorText(e) }); }
          return;
        }
        case 'test/start': return await this.startTests(m);
        case 'test/cancel': this.runner.cancel(String(m.runId), typeof m.serial === 'string' ? m.serial : undefined); return;
        case 'test/diagnose': {
          const runId = String(m.runId), serial = String(m.serial), flow = String(m.flow);
          if (!this.runner.get(runId)?.devices.get(serial)?.results.has(flow)) throw new Error('That result is no longer available. Run the tests again.');
          return this.send(undefined, diagnosisPrompt(runId, serial, flow), { scope: [serial], permission: DEFAULT_PERMISSION, tokenCap: DIAGNOSIS_TOKEN_CAP, model: this.deps.defaultModel(), title: `Why ${flow.replace(/^.*\//, '')} failed on ${serial}` });
        }
      }
    } catch (e) {
      if (String(m.type).startsWith('test/')) post({ type: 'test/error', message: errorText(e), runId: typeof m.runId === 'string' ? m.runId : undefined });
      else post({ type: 'ai/done', convId: typeof m.convId === 'string' ? m.convId : '', outcome: 'error', message: errorText(e) });
    }
  }

  private async startTests(m: Record<string, unknown>) {
    const all = await discoverFlows(this.deps.flowsFolder());
    const paths = Array.isArray(m.flows) ? m.flows.filter((f): f is string => typeof f === 'string') : [];
    const unknown = paths.filter(p => !all.some(f => f.path === p));
    if (unknown.length) throw new Error(`Not in the flows folder: ${unknown.join(', ')}.`);
    const strings = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const flows = filterByTags(all.filter(f => paths.includes(f.path)), strings(m.includeTags), strings(m.excludeTags));
    if (!flows.length) throw new Error('No selected flow matches the tag filters.');
    const env = Object.fromEntries(Object.entries((m.env ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    let installApk: string | undefined;
    if (typeof m.installApk === 'string' && m.installApk) {
      installApk = resolve(this.deps.workspaceRoot(), m.installApk);
      if (extname(installApk).toLowerCase() !== '.apk' || !existsSync(installApk)) throw new Error(`APK not found: ${m.installApk}.`);
    }
    await this.runner.start({ flows, serials: strings(m.serials), env, installApk, clearData: typeof m.clearData === 'string' && m.clearData ? m.clearData : undefined });
  }

  /** Events that rebuild a run's state in a page that connected (or reloaded) mid-run. */
  private replay(runId: string): TestEvent[] {
    const run = this.runner.get(runId);
    if (!run) return [];
    const events: TestEvent[] = [{ type: 'test/started', runId, flows: run.flows.map(f => f.path), serials: [...run.devices.keys()], dir: run.dir, devices: [...run.devices.keys()].map(serial => ({ serial, model: run.models[serial] ?? serial })) }];
    for (const d of run.devices.values()) {
      const values = [...d.results.values()];
      events.push({ type: 'test/progress', runId, serial: d.serial, state: d.state, startedAt: d.startedAt, passed: values.filter(r => r.status === 'pass').length, failed: values.filter(r => r.status === 'fail').length, total: run.flows.length, message: d.message });
      for (const r of values) events.push({ type: 'test/flow', runId, serial: d.serial, flow: r.flow, status: r.status, durationMs: r.durationMs, failure: r.failure });
    }
    return events;
  }

  private summaries(): ConversationSummary[] {
    return [...this.convs.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(({ convId, title, updatedAt, totalTokens }) => ({ convId, title, updatedAt, totalTokens }));
  }

  private persist() {
    const items = [...this.convs.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50)
      .map(({ convId, title, updatedAt, totalTokens, sdkSessionId, model, permission, scope, tokenCap }) => ({ convId, title, updatedAt, totalTokens, sdkSessionId, model, permission, scope, tokenCap }));
    void this.deps.store.set(items);
  }

  private stop(convId: string) {
    const turn = this.convs.get(convId)?.turn;
    if (!turn) return;
    turn.outcome ??= 'stopped';
    turn.abort.abort();
  }

  private async send(convId: string | undefined, text: string, settings: { scope: string[]; permission: Permission; tokenCap: number; model: string; title?: string }) {
    let conv = convId ? this.convs.get(convId) : undefined;
    if (conv?.turn) throw new Error('Claude is still working on the last request. Stop it or wait for it to finish.');
    if (!conv) {
      const title = settings.title ?? (text.length > 60 ? text.slice(0, 57).trimEnd() + '…' : text);
      conv = { convId: convId ?? randomUUID(), title, updatedAt: Date.now(), totalTokens: 0, model: settings.model, permission: settings.permission, scope: settings.scope, tokenCap: settings.tokenCap, allowed: new Set(), planForConversation: false, pending: new Map() };
      this.convs.set(conv.convId, conv);
    } else Object.assign(conv, { model: settings.model, permission: settings.permission, scope: settings.scope, tokenCap: settings.tokenCap });
    await this.runTurn(conv, text);
  }

  private async runTurn(conv: Conversation, prompt: string) {
    const turn: Turn = { abort: new AbortController(), planApproved: conv.permission === 'ask-data-loss' || conv.planForConversation, textOpen: false, usage: new Map(), calls: new Map(), costUsd: 0 };
    conv.turn = turn;
    const convId = conv.convId;
    this.broadcast({ type: 'ai/started', convId, title: conv.title, model: conv.model || 'default', tokenCap: conv.tokenCap, scope: { serials: conv.scope } });
    try {
      const sdk = await this.deps.loadSdk();
      const claude = resolveClaude(this.deps.claudePath());
      const ready = await this.deps.adb.devices().catch(() => []);
      const workspaceRoot = this.deps.workspaceRoot(), flowsFolder = this.deps.flowsFolder();
      const server = motaServer(sdk, {
        adb: this.deps.adb, input: this.input, runner: this.runner, flowsFolder: this.deps.flowsFolder, workspaceRoot: this.deps.workspaceRoot, screenshotSide: this.deps.screenshotSide,
        requestPlan: plan => this.requestPlan(conv, turn, plan),
        onScreenshot: (serial, file) => this.lastShot.set(serial, file),
        onFlowWritten: (file, before) => this.onFlowWritten(conv, file, before),
      });
      const q = sdk.query({
        prompt,
        options: {
          pathToClaudeCodeExecutable: claude,
          cwd: workspaceRoot,
          settingSources: [],
          strictMcpConfig: true,
          systemPrompt: systemPrompt({ workspaceRoot, flowsFolder, devices: conv.scope.map(s => ({ serial: s, model: ready.find(d => d.serial === s)?.model ?? 'not connected' })), permission: conv.permission, tokenCap: conv.tokenCap }),
          tools: [...BUILTIN_TOOLS],
          mcpServers: { mota: server },
          permissionMode: 'default',
          canUseTool: (tool, input, { signal }) => this.canUseTool(conv, turn, tool, input, signal),
          ...(conv.model ? { model: conv.model } : {}),
          effort: this.deps.effort(),
          maxTurns: MAX_TURNS,
          ...(conv.tokenCap >= MIN_TOKEN_CAP ? { taskBudget: { total: conv.tokenCap } } : {}),
          includePartialMessages: true,
          abortController: turn.abort,
          ...(conv.sdkSessionId ? { resume: conv.sdkSessionId } : {}),
        },
      });
      if (!this.modelsLoaded) q.supportedModels().then(list => { this.modelsLoaded = true; this.models = modelChoices(list); this.broadcast({ type: 'ai/models', items: this.models }); }, () => undefined);
      for await (const message of q) this.onMessage(conv, turn, message);
      turn.outcome ??= 'success';
    } catch (e) {
      if (!turn.abort.signal.aborted) { turn.outcome = 'error'; turn.message = friendlyError(e); }
      turn.outcome ??= 'stopped';
    } finally {
      for (const resolveApproval of conv.pending.values()) resolveApproval('deny');
      conv.pending.clear();
      if (turn.textOpen && turn.messageId) this.broadcast({ type: 'ai/text-end', convId, messageId: turn.messageId });
      const tokens = taskTokens(turn.usage);
      conv.totalTokens += tokens.totalTokens;
      conv.updatedAt = Date.now();
      conv.turn = undefined;
      this.persist();
      this.broadcast({ type: 'ai/usage', convId, ...tokens, tokenCap: conv.tokenCap, costUsd: turn.costUsd });
      const message = turn.outcome === 'cap-reached' ? `Stopped at the ${Math.round(conv.tokenCap / 1000)}K token cap. Raise the cap and send "continue" to carry on.` : turn.message;
      this.broadcast({ type: 'ai/done', convId, outcome: turn.outcome ?? 'success', ...(message ? { message } : {}) });
    }
  }

  private onMessage(conv: Conversation, turn: Turn, m: Sdk.SDKMessage) {
    const convId = conv.convId;
    if (m.type === 'system' && m.subtype === 'init') { conv.sdkSessionId = m.session_id; return; }
    if (m.type === 'stream_event') {
      if (m.parent_tool_use_id) return;
      const e = m.event;
      if (e.type === 'message_start') turn.messageId = e.message.id;
      else if (e.type === 'content_block_delta' && e.delta.type === 'text_delta' && turn.messageId) { turn.textOpen = true; this.broadcast({ type: 'ai/text', convId, messageId: turn.messageId, delta: e.delta.text }); }
      else if (e.type === 'message_stop' && turn.textOpen && turn.messageId) { turn.textOpen = false; this.broadcast({ type: 'ai/text-end', convId, messageId: turn.messageId }); }
      return;
    }
    if (m.type === 'assistant') {
      const u = m.message.usage;
      if (u) {
        turn.usage.set(m.message.id, { fresh: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 });
        const tokens = taskTokens(turn.usage);
        this.broadcast({ type: 'ai/usage', convId, ...tokens, tokenCap: conv.tokenCap, costUsd: turn.costUsd });
        if (tokens.totalTokens >= conv.tokenCap && !turn.outcome) { turn.outcome = 'cap-reached'; turn.abort.abort(); }
      }
      for (const block of m.message.content) {
        if (block.type !== 'tool_use' || turn.calls.has(block.id)) continue;
        const input = (block.input ?? {}) as Record<string, unknown>;
        turn.calls.set(block.id, { name: block.name, input, start: Date.now() });
        const devices = targetSerials(input);
        this.broadcast({ type: 'ai/tool', convId, callId: block.id, name: block.name.replace(/^mcp__mota__/, ''), summary: describeCall(block.name, input), ...(devices.length ? { devices } : {}), state: 'running' });
      }
      return;
    }
    if (m.type === 'user' && Array.isArray(m.message.content)) {
      for (const block of m.message.content) {
        if (block.type !== 'tool_result') continue;
        const call = turn.calls.get(block.tool_use_id);
        if (!call) continue;
        const name = call.name.replace(/^mcp__mota__/, '');
        const detail = (typeof block.content === 'string' ? block.content : (block.content ?? []).map(c => c.type === 'text' ? c.text : '').join('\n')).trim().slice(0, 600);
        const devices = targetSerials(call.input);
        const thumbUri = name === 'screenshot' && typeof call.input.serial === 'string' ? this.lastShot.get(call.input.serial) : undefined;
        this.broadcast({ type: 'ai/tool', convId, callId: block.tool_use_id, name, summary: describeCall(call.name, call.input), ...(devices.length ? { devices } : {}), state: block.is_error ? 'error' : 'ok', durationMs: Date.now() - call.start, ...(detail ? { detail } : {}), ...(thumbUri ? { thumbUri } : {}) });
        if (thumbUri) this.broadcast({ type: 'ai/attachment', convId, callId: block.tool_use_id, kind: 'screenshot', uri: thumbUri, caption: `Screen of ${call.input.serial}` });
      }
      return;
    }
    if (m.type === 'result') {
      turn.costUsd = m.total_cost_usd ?? 0;
      if (m.subtype !== 'success' && !turn.outcome) {
        turn.outcome = 'error';
        turn.message = m.subtype === 'error_max_turns' ? `Stopped after ${MAX_TURNS} steps. Send "continue" to carry on.` : `Claude stopped: ${m.subtype}${'errors' in m && m.errors?.length ? ` (${m.errors.join('; ')})` : ''}.`;
      }
    }
  }

  private async canUseTool(conv: Conversation, turn: Turn, tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<Sdk.PermissionResult> {
    const ctx: PolicyContext = { permission: conv.permission, planApproved: turn.planApproved, allowedForConversation: conv.allowed, scope: conv.scope, workspaceRoot: this.deps.workspaceRoot(), flowsFolder: this.deps.flowsFolder(), exists: existsSync };
    const d = decide(tool, input, ctx);
    if (d.action === 'allow') return { behavior: 'allow', updatedInput: input };
    if (d.action === 'deny') return { behavior: 'deny', message: d.reason };
    const call = describeCall(tool, input);
    const decision = await this.ask(conv, signal, { kind: d.kind, title: d.kind === 'plan' ? `Let Claude ${call}?` : d.reason, steps: [call], devices: targetSerials(input), tool: tool.replace(/^mcp__mota__/, '') });
    if (decision === 'deny') return { behavior: 'deny', message: 'The user declined this action. Do not retry it; ask what they want instead.' };
    if (d.kind === 'plan') { turn.planApproved = true; if (decision === 'conversation') conv.planForConversation = true; }
    if (decision === 'conversation') {
      if (d.kind === 'device-change') conv.scope = [...new Set([...conv.scope, ...targetSerials(input)])];
      else conv.allowed.add(tool);
    }
    return { behavior: 'allow', updatedInput: input };
  }

  private async requestPlan(conv: Conversation, turn: Turn, plan: { title: string; steps: string[]; serials: string[] }) {
    if (conv.permission === 'read-only') return false;
    if (turn.planApproved) return true;
    const decision = await this.ask(conv, turn.abort.signal, { kind: 'plan', title: plan.title, steps: plan.steps, devices: plan.serials, tokenCapEstimate: conv.tokenCap });
    if (decision === 'deny') return false;
    turn.planApproved = true;
    if (decision === 'conversation') conv.planForConversation = true;
    return true;
  }

  private ask(conv: Conversation, signal: AbortSignal, card: { kind: ApprovalKind; title: string; steps?: string[]; devices: string[]; tool?: string; tokenCapEstimate?: number }) {
    const requestId = randomUUID();
    return new Promise<ApprovalDecision>(resolveDecision => {
      const done = (d: ApprovalDecision) => { conv.pending.delete(requestId); signal.removeEventListener('abort', onAbort); resolveDecision(d); };
      const onAbort = () => done('deny');
      if (signal.aborted) return done('deny');
      signal.addEventListener('abort', onAbort);
      conv.pending.set(requestId, done);
      this.broadcast({ type: 'ai/approval', convId: conv.convId, requestId, ...card });
    });
  }

  private onFlowWritten(conv: Conversation, file: string, before: string | undefined) {
    const name = relative(this.deps.flowsFolder(), file);
    if (before === undefined) { this.broadcast({ type: 'ai/attachment', convId: conv.convId, kind: 'flow-diff', uri: file, caption: `Created ${name}` }); return; }
    void backupFlow(this.deps.workspaceRoot(), this.deps.flowsFolder(), file, before).then(backup =>
      this.broadcast({ type: 'ai/attachment', convId: conv.convId, kind: 'flow-diff', uri: file, caption: `Updated ${name}; the previous version is in ${relative(this.deps.workspaceRoot(), backup)}` }));
  }
}

let instance: AiHostImpl | undefined;

/** The extension's single AI and test host. Pages connect to it; conversations and runs outlive any one page. */
export function aiHost(context: VSCode.ExtensionContext, adb: Adb): AiHost {
  if (instance) return instance;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vscode = require('vscode') as typeof VSCode;
  const config = () => vscode.workspace.getConfiguration('mota');
  const workspaceRoot = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.globalStorageUri.fsPath;
  const flowsFolder = () => { const f = config().get<string>('maestroFlowsFolder', '.maestro') || '.maestro'; return isAbsolute(f) ? f : join(workspaceRoot(), f); };
  instance = new AiHostImpl({
    adb, workspaceRoot, flowsFolder,
    runsFolder: () => join(workspaceRoot(), '.mota', 'test-runs'),
    maestroPath: () => config().get<string>('maestroPath', ''),
    claudePath: () => config().get<string>('ai.claudePath', ''),
    defaultModel: () => config().get<string>('ai.model', ''),
    effort: () => config().get<'low' | 'medium' | 'high' | 'xhigh'>('ai.effort', 'medium'),
    screenshotSide: () => config().get<number>('ai.screenshotWidth', 960),
    store: { get: () => context.workspaceState.get<StoredConversation[]>('mota.ai.conversations', []), set: items => context.workspaceState.update('mota.ai.conversations', items) },
    loadSdk,
  });
  const created = instance;
  context.subscriptions.push({ dispose: () => { created.dispose(); if (instance === created) instance = undefined; } });
  return instance;
}
