import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CLEANUP_TOOLS, cleanupPurpose, type CleanupEntry } from '../cleanupApprovals';
import { leaseGate, type Holder, type LeaseGate, type LeaseStore } from '../leases';
import { callerOfSocket, peerPid, sessionAbove, UNKNOWN_AGENT } from './caller';
import { handleHook } from './hooks';
import { riskOf, targetSerials } from './policy';
import { describeCall } from './prompts';
import { motaTools, type ToolDeps } from './tools';

export const MCP_PATH = '/mcp';
/** Where Claude Code hooks (installed by "MoTA: Install Claude Code Hooks") send their events. */
export const HOOK_PATH = '/hook';

/** propose_plan shows a card in MoTA's own Claude bar; outside agents have their own approval prompts. */
const NOT_SERVED = new Set(['propose_plan']);

const INSTRUCTIONS = `MoTA controls the Android phones connected to the user's computer and runs Maestro tests on them.
Start with list_devices and use the serials it returns. Prefer ui_tree over screenshots for finding what to tap: it is cheaper and gives exact tap centres in device pixels.
Maestro flows live in the workspace flows folder; write_flow can only write there. run_flow takes about 40 s of Maestro start-up before the flow runs.
Calls that delete data (clear_app_data, uninstall_app, overwriting a flow) wait for the user to approve them in VS Code. clear_app_data and uninstall_app need a reason (why you need it) and take taskId (the task your session is working on); the user may have approved device cleanup once for all calls, in which case they run at once and are recorded.
To test an app under pressure: fill_storage leaves little free storage (remove it with clear_storage_fill when done; a fill left behind makes installs and tests fail for everyone, and list_devices shows it), trim_memory sends a low-memory signal, and kill_background_app kills the app in the background as Android does when memory is low, then reopens it.
Other sessions and agents share these phones. list_devices shows who is using each one. A call that changes a phone claims it for you; it is refused while someone else is using that phone or a test is running on it. To get such a phone, call acquire_device: mode "wait" waits in line, mode "takeover" asks the user to hand it over. Phones you stop using become free to others after a while; call release_device when you are done.
Before you change a phone with your own shell commands (adb, maestro, gradle install or connected tests), call acquire_device for it, so other sessions know it is in use.`;

export interface McpDeps extends Omit<ToolDeps, 'requestPlan' | 'onScreenshot' | 'lease'> {
  /** Phone leases shared with other sessions and windows; without it, any caller may use any phone. */
  leases?: LeaseStore;
  /** The bearer token clients must send. */
  token: () => string;
  /** Asks the user in VS Code before a call that deletes data; true lets it run. `who` is the session asking. */
  confirm: (tool: string, summary: string, args: Record<string, unknown>, who?: string) => Promise<boolean>;
  /** Device cleanup (clear data, uninstall): whether the user approved it for all calls, and the record of each call. */
  cleanup?: { standing(): boolean; record(entry: Omit<CleanupEntry, 'at'>): void };
  /** One line per tool call, for the user to see what agents do. */
  log: (line: string) => void;
  /** Finds the session above a hook's process (tests replace it). */
  sessionAbove?: (pid: number | undefined) => Promise<Holder>;
}

/** Builds the same tool definitions the Agent SDK's `tool()` would, without loading the SDK. */
const defineTool = ((name: string, description: string, inputSchema: unknown, handler: unknown, extras?: { annotations?: unknown }) =>
  ({ name, description, inputSchema, handler, ...(extras?.annotations ? { annotations: extras.annotations } : {}) })) as unknown as typeof Sdk.tool;

/** An MCP server with MoTA's tools for outside agents (Claude Code, Cursor, Codex…). Data-loss calls need the user's approval. */
export function buildMcpServer(deps: McpDeps, version: string, lease?: LeaseGate): McpServer {
  const server = new McpServer({ name: 'mota', version }, { instructions: INSTRUCTIONS });
  const defs = motaTools(defineTool, { ...deps, lease, requestPlan: async () => true, onScreenshot: () => undefined });
  for (const def of defs) {
    if (NOT_SERVED.has(def.name)) continue;
    const handler = def.handler as (args: Record<string, unknown>, extra: unknown) => Promise<{ isError?: boolean }>;
    server.registerTool(def.name, { description: def.description, inputSchema: def.inputSchema, ...(def.annotations ? { annotations: def.annotations } : {}) },
      (async (args: Record<string, unknown>, extra: unknown) => {
        const summary = describeCall(def.name, args);
        const risk = riskOf(`mcp__mota__${def.name}`, args, { workspaceRoot: deps.workspaceRoot(), flowsFolder: deps.flowsFolder(), exists: existsSync });
        const who = lease ? ` (${(await lease.holder()).label})` : '';
        // Don't ask the user about a call the lease would refuse anyway.
        const blocked = risk === 'data-loss' && lease ? await lease.check(targetSerials(args)) : undefined;
        if (blocked) { deps.log(`${summary}${who} — refused, phone in use`); return { content: [{ type: 'text', text: blocked }], isError: true }; }
        const cleanup = risk === 'data-loss' && CLEANUP_TOOLS.has(def.name);
        const purpose = cleanupPurpose(args);
        const holder = who.slice(2, -1);
        const record = (decision: CleanupEntry['decision'], result?: CleanupEntry['result']) => {
          if (cleanup) deps.cleanup?.record({ tool: def.name, serial: String(args.serial ?? ''), package: String(args.package ?? ''), who: holder || 'an AI agent', ...purpose, decision, ...(result ? { result } : {}) });
        };
        // Cleanup the user approved once for all calls runs without asking; everything else that deletes data asks.
        const standing = cleanup && !!deps.cleanup?.standing();
        if (risk === 'data-loss' && !standing && !(await deps.confirm(def.name, summary, args, holder || undefined))) {
          record('declined');
          deps.log(`${summary}${who} — declined${cleanup ? ` · why: ${purpose.reason}` : ''}`);
          return { content: [{ type: 'text', text: 'The user declined this in VS Code. Do not retry it; ask them what they want instead.' }], isError: true };
        }
        const started = Date.now();
        const result = await handler(args, extra);
        record(standing ? 'standing' : 'allowed', result?.isError ? 'error' : 'ok');
        deps.log(`${summary}${'serial' in args ? ` on ${args.serial}` : ''}${who} — ${result?.isError ? 'error' : 'ok'} in ${((Date.now() - started) / 1000).toFixed(1)} s${cleanup ? ` · ${standing ? 'standing approval' : 'approved'} · why: ${purpose.reason}${purpose.taskId ? ` · task ${purpose.taskId}` : ''}` : ''}`);
        return result;
      }) as never);
  }
  return server;
}

const digest = (s: string) => createHash('sha256').update(s).digest();
/** Constant-time check of an `Authorization: Bearer <token>` header. */
export function validBearer(header: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return !!m && !!token && timingSafeEqual(digest(m[1]), digest(token));
}

/** Only loopback host names, so a web page can't reach the server through DNS rebinding. */
export function loopbackHost(host: string | undefined): boolean {
  const name = (host ?? '').replace(/:\d+$/, '').toLowerCase();
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

function reply(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

/** Streamable HTTP MCP endpoint on 127.0.0.1, stateless: each request gets its own server and transport. */
export class McpHttpServer {
  private server?: Server;
  constructor(private deps: McpDeps, private version: string) {}

  get port(): number | undefined { return (this.server?.address() as AddressInfo | null)?.port; }

  async start(port: number): Promise<number> {
    if (this.server) throw new Error('The MCP server is already running.');
    const server = createServer((req, res) => { void this.handle(req, res).catch(e => { if (!res.headersSent) reply(res, 500, e instanceof Error ? e.message : String(e)); else res.end(); }); });
    await new Promise<void>((ok, fail) => {
      server.once('error', fail);
      server.listen(port, '127.0.0.1', () => { server.off('error', fail); ok(); });
    });
    this.server = server;
    return this.port!;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>(ok => server.close(() => ok()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (path !== MCP_PATH && path !== HOOK_PATH) return reply(res, 404, `MoTA serves MCP at ${MCP_PATH}.`);
    if (!loopbackHost(req.headers.host)) return reply(res, 403, 'Only local connections are allowed.');
    // MCP clients don't send Origin; browsers always do on cross-site requests.
    if (req.headers.origin) return reply(res, 403, 'Requests from web pages are not allowed.');
    if (!validBearer(req.headers.authorization, this.deps.token())) return reply(res, 401, 'Missing or wrong MoTA access token. Run "MoTA: Connect AI Agents (MCP)" in VS Code to get it.');
    if (req.method !== 'POST') return reply(res, 405, 'This server is stateless; send JSON-RPC with POST.');
    if (path === HOOK_PATH) return this.hook(req, res);
    const lease = this.deps.leases ? leaseGate(this.deps.leases, () => callerOfSocket(req.socket)) : undefined;
    const server = buildMcpServer(this.deps, this.version, lease);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport as never);
    await transport.handleRequest(req, res);
  }

  /** A Claude Code hook event: JSON in, the hook's JSON output back. The session is the agent above the hook's curl process. */
  private async hook(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) { size += (chunk as Buffer).length; if (size > 1024 * 1024) return reply(res, 413, 'Hook input is too large.'); chunks.push(chunk as Buffer); }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return reply(res, 400, 'Send the hook input as JSON.'); }
    const leases = this.deps.leases;
    const port = req.socket.remotePort;
    const find = this.deps.sessionAbove ?? (async (pid: number | undefined) => pid ? sessionAbove(pid) : UNKNOWN_AGENT);
    let session: Promise<Holder> | undefined;
    const out = leases ? await handleHook(input, () => session ??= peerPid(port).then(find), { adb: this.deps.adb, leases, log: this.deps.log }).catch(e => {
      this.deps.log(`hook failed: ${e instanceof Error ? e.message : e}`); return {};
    }) : {};
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  }
}
