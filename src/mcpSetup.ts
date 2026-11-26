import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import type * as VSCode from 'vscode';
import type { Adb } from './adb';
import { aiHost, resolveClaude } from './ai/host';
import { CLEANUP_TOOLS, CleanupApprovals, cleanupPurpose, cleanupPurposeText, cleanupWhat } from './cleanupApprovals';
import { MCP_PATH, McpHttpServer } from './ai/mcpHttp';
import { backupFlow } from './ai/tools';
import { hookHeaderExists, installHooks, removeHooks, writeHookHeader } from './hookSetup';

const TOKEN_KEY = 'mota.mcp.token';
export const DEFAULT_MCP_PORT = 6682;

export const mcpUrl = (port: number) => `http://127.0.0.1:${port}${MCP_PATH}`;

/** Client configuration snippets for the URL and token. */
export function clientConfigs(url: string, token: string) {
  return {
    // --header takes several values, so it goes after the name and URL or it swallows them.
    claudeArgs: ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'mota', url, '--header', `Authorization: Bearer ${token}`],
    claudeCommand: `claude mcp add --transport http --scope user mota ${url} --header "Authorization: Bearer ${token}"`,
    cursor: JSON.stringify({ mcpServers: { mota: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    codex: `[mcp_servers.mota]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${token}" }\n`,
  };
}

/** Serves MoTA's tools to outside agents over local MCP while mota.mcp.enabled is on. */
export function registerMcp(vscode: typeof VSCode, context: VSCode.ExtensionContext, adb: Adb) {
  const config = () => vscode.workspace.getConfiguration('mota');
  const workspaceRoot = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.globalStorageUri.fsPath;
  const flowsFolder = () => { const f = config().get<string>('maestroFlowsFolder', '.maestro') || '.maestro'; return isAbsolute(f) ? f : join(workspaceRoot(), f); };
  const output = vscode.window.createOutputChannel('MoTA MCP');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  status.command = 'mota.mcpSetup';
  const cleanup = new CleanupApprovals(context.globalState);
  const ALWAYS = 'Always allow cleanup';
  let token = '';
  let http: McpHttpServer | undefined;
  let syncing = Promise.resolve();

  async function loadToken(reset = false) {
    token = (!reset && await context.secrets.get(TOKEN_KEY)) || '';
    if (!token) { token = randomBytes(32).toString('base64url'); await context.secrets.store(TOKEN_KEY, token); }
    return token;
  }

  function server() {
    const host = aiHost(context, adb);
    return new McpHttpServer({
      adb, input: host.input, runner: host.runner, leases: host.leases, flowsFolder, workspaceRoot,
      screenshotSide: () => config().get<number>('ai.screenshotWidth', 960),
      loadAppsDir: () => context.asAbsolutePath('resources/load'),
      onFlowWritten: (file, before) => { if (before !== undefined) void backupFlow(workspaceRoot(), flowsFolder(), file, before).then(b => output.appendLine(`  previous version saved to ${b}`)); },
      token: () => token,
      log: line => output.appendLine(`${new Date().toLocaleTimeString()}  ${line}`),
      cleanup,
      confirm: async (tool, summary, args, who) => {
        const devices = [args.serial, ...(Array.isArray(args.serials) ? args.serials : [])].filter(Boolean).join(', ');
        const isCleanup = CLEANUP_TOOLS.has(tool);
        const detail = isCleanup ? `${cleanupPurposeText(cleanupPurpose(args), who)}\n\nThis deletes data and cannot be undone.` : 'This deletes data and cannot be undone.';
        const answer = await vscode.window.showWarningMessage(`An AI agent connected to MoTA wants to ${summary}${devices ? ` on ${devices}` : ''}.`,
          { modal: true, detail }, 'Allow', ...(isCleanup ? [ALWAYS] : []));
        if (answer === ALWAYS) {
          await cleanup.setStanding(true);
          void vscode.window.showInformationMessage('Device cleanup by AI agents no longer asks. Each call is recorded; see or turn this off in “MoTA: Device Cleanup Approvals”.', 'Open').then(a => { if (a) void vscode.commands.executeCommand('mota.cleanupApprovals'); });
        }
        return answer === 'Allow' || answer === ALWAYS;
      },
    }, String(context.extension?.packageJSON?.version ?? '0.0.0'));
  }

  async function apply() {
    const enabled = config().get<boolean>('mcp.enabled', false);
    const port = config().get<number>('mcp.port', DEFAULT_MCP_PORT);
    if (http && (!enabled || http.port !== port)) { await http.stop(); http = undefined; output.appendLine('Stopped serving MCP.'); }
    if (enabled && !http) {
      await loadToken();
      const next = server();
      try { await next.start(port); http = next; output.appendLine(`Serving MoTA's tools at ${mcpUrl(port)}`); }
      catch (e) {
        const inUse = (e as NodeJS.ErrnoException).code === 'EADDRINUSE';
        void vscode.window.showErrorMessage(inUse ? `MoTA can't serve MCP: port ${port} is in use. Choose another port in mota.mcp.port.` : `MoTA can't serve MCP: ${e instanceof Error ? e.message : e}`, 'Open setting')
          .then(a => { if (a) void vscode.commands.executeCommand('workbench.action.openSettings', 'mota.mcp.port'); });
      }
    }
    if (http) { status.text = '$(plug) MoTA MCP'; status.tooltip = `MoTA's tools are served to AI agents at ${mcpUrl(http.port!)}. Click to connect an agent.`; status.show(); }
    else status.hide();
  }
  const sync = () => (syncing = syncing.then(apply, apply));

  async function setup() {
    if (!config().get<boolean>('mcp.enabled', false)) {
      const port = config().get<number>('mcp.port', DEFAULT_MCP_PORT);
      const on = await vscode.window.showInformationMessage(`Serve MoTA's tools to AI agents at ${mcpUrl(port)}?`, {
        modal: true, detail: 'Agents such as Claude Code, Cursor or Codex can then list your phones, take screenshots, tap and type, install APKs, and write and run Maestro flows. Only this computer can connect, and only with MoTA\'s access token. Deleting app data always asks you here first.',
      }, 'Turn on');
      if (!on) return;
      await config().update('mcp.enabled', true, vscode.ConfigurationTarget.Global);
    }
    await sync();
    if (!http) return;
    const configs = clientConfigs(mcpUrl(http.port!), token);
    const copy = async (text: string, what: string) => { await vscode.env.clipboard.writeText(text); void vscode.window.showInformationMessage(`Copied ${what}. It contains MoTA's access token, so keep it out of shared files and repositories.`); };
    const pick = await vscode.window.showQuickPick([
      { label: '$(add) Add to Claude Code', description: 'runs claude mcp add for your user', id: 'claude' },
      { label: '$(copy) Copy Claude Code command', id: 'claude-copy' },
      { label: '$(copy) Copy Cursor config', description: 'for .cursor/mcp.json or ~/.cursor/mcp.json', id: 'cursor' },
      { label: '$(copy) Copy Codex config', description: 'for ~/.codex/config.toml', id: 'codex' },
      { label: '$(copy) Copy URL and token', description: 'for other MCP clients (Streamable HTTP, bearer token)', id: 'raw' },
      { label: '$(shield) Install Claude Code hooks', description: 'share phones when sessions run adb, maestro or gradle themselves', id: 'hooks' },
      { label: '$(trash) Remove Claude Code hooks', id: 'unhooks' },
      { label: '$(output) Show agent activity', id: 'log' },
      { label: '$(key) Reset access token', description: 'agents set up before must be set up again', id: 'reset' },
      { label: '$(circle-slash) Stop serving', id: 'off' },
    ], { title: `MoTA MCP · ${mcpUrl(http.port!)}` });
    switch (pick?.id) {
      case 'claude': {
        let claude: string;
        try { claude = resolveClaude(config().get<string>('ai.claudePath', '')); } catch (e) { void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e)); return; }
        const run = (args: string[]) => new Promise<string>((ok, fail) => execFile(claude, args, { timeout: 30_000 }, (err, stdout, stderr) => err ? fail(new Error((stderr || err.message).trim())) : ok(stdout)));
        await run(['mcp', 'remove', '--scope', 'user', 'mota']).catch(() => undefined);
        try { await run(configs.claudeArgs); void vscode.window.showInformationMessage('Added MoTA to Claude Code. Start a new claude session and ask it to list your devices.'); }
        catch (e) { await copy(configs.claudeCommand, 'the Claude Code command instead, because adding failed'); output.appendLine(`claude mcp add failed: ${e instanceof Error ? e.message : e}`); }
        return;
      }
      case 'claude-copy': return copy(configs.claudeCommand, 'the Claude Code command');
      case 'cursor': return copy(configs.cursor, 'the Cursor config');
      case 'codex': return copy(configs.codex, 'the Codex config');
      case 'raw': return copy(`URL: ${mcpUrl(http.port!)}\nHeader: Authorization: Bearer ${token}`, 'the URL and token');
      case 'log': output.show(); return;
      case 'reset': {
        const sure = await vscode.window.showWarningMessage('Reset MoTA\'s access token?', { modal: true, detail: 'Agents you already connected will be refused until you add MoTA to them again.' }, 'Reset');
        if (sure) { await loadToken(true); if (await hookHeaderExists()) await writeHookHeader(token); void vscode.window.showInformationMessage('MoTA has a new access token. Run this command again to connect your agents.'); }
        return;
      }
      case 'off': await config().update('mcp.enabled', false, vscode.ConfigurationTarget.Global); return;
      case 'hooks': return hooks(http.port!);
      case 'unhooks': {
        try { const file = await removeHooks(); void vscode.window.showInformationMessage(`Removed MoTA's hooks from ${file}. Restart Claude Code sessions for it to take effect.`); }
        catch (e) { void vscode.window.showErrorMessage(`Couldn't remove MoTA's hooks: ${e instanceof Error ? e.message : e}`); }
        return;
      }
    }
  }

  /** Adds MoTA's hooks to Claude Code's user settings, after the user agrees. */
  async function hooks(port: number) {
    if (process.platform === 'win32') { void vscode.window.showWarningMessage('MoTA\'s Claude Code hooks need macOS or Linux for now.'); return; }
    const ok = await vscode.window.showInformationMessage('Add MoTA\'s hooks to Claude Code (~/.claude/settings.json)?', {
      modal: true,
      detail: 'Before a Claude Code session runs adb, maestro or a Gradle device task itself, MoTA claims that phone for it, and asks you here when another session is using it. When a session finishes a reply or waits for you, its phones are free to others. Your other settings and hooks are kept, with a backup in settings.json.mota-backup. If MoTA is not running, the hooks do nothing.',
    }, 'Add hooks');
    if (ok !== 'Add hooks') return;
    try {
      const file = await installHooks(port, token);
      output.appendLine(`Installed Claude Code hooks in ${file}`);
      void vscode.window.showInformationMessage('Added MoTA\'s hooks to Claude Code. They apply to sessions started from now on.');
    } catch (e) { void vscode.window.showErrorMessage(`Couldn't add MoTA's hooks: ${e instanceof Error ? e.message : e}`); }
  }

  /** Turn the standing approval on or off, and look through what was cleaned up, why and for which task. */
  async function cleanupApprovals() {
    for (;;) {
      const since = cleanup.standingSince();
      const time = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const history = cleanup.history();
      type Item = VSCode.QuickPickItem & { toggle?: boolean };
      const items: Item[] = [
        { label: `${since ? '$(pass-filled)' : '$(circle-large-outline)'} Clear app data and uninstall apps without asking`, toggle: true,
          description: since ? `on since ${time(since)} — select to ask every time again` : 'asks every time — select to approve all at once',
          detail: 'For test phones. Cleanup cannot be undone; every call is recorded below.' },
        { label: 'History', kind: vscode.QuickPickItemKind.Separator },
        ...history.map((e): Item => ({
          label: `${e.decision === 'declined' ? '$(circle-slash) Declined:' : e.result === 'error' ? '$(error) Failed:' : '$(check)'} ${e.decision === 'declined' || e.result === 'error' ? `${e.tool} ${e.package} on ${e.serial}` : cleanupWhat(e)}`,
          description: `${time(e.at)} · ${e.decision === 'standing' ? 'standing approval' : e.decision === 'allowed' ? 'approved' : 'declined'} · ${e.who}`,
          detail: `Why: ${e.reason || 'no reason given'} · For: ${e.taskId ? `task ${e.taskId}` : 'no task named'}`,
        })),
        ...(history.length ? [] : [{ label: 'No cleanup recorded yet' }]),
      ];
      const picked = await vscode.window.showQuickPick(items, { title: 'Device cleanup by AI agents', placeHolder: 'Cleanup calls from agents, newest first', matchOnDescription: true, matchOnDetail: true });
      if (!picked?.toggle) return;
      if (!since) {
        const ok = await vscode.window.showWarningMessage('Let AI agents clear app data and uninstall apps without asking?', { modal: true, detail: 'This applies to every phone connected to this computer. Cleanup cannot be undone. Each call is recorded with its reason and task, and you can turn this off here.' }, 'Allow all');
        if (ok !== 'Allow all') continue;
      }
      await cleanup.setStanding(!since);
    }
  }

  context.subscriptions.push(output, status,
    vscode.commands.registerCommand('mota.mcpSetup', setup),
    vscode.commands.registerCommand('mota.cleanupApprovals', cleanupApprovals),
    vscode.commands.registerCommand('mota.installHooks', async () => {
      if (!config().get<boolean>('mcp.enabled', false)) { await setup(); return; }
      await sync(); if (http) await hooks(http.port!);
    }),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('mota.mcp')) void sync(); }),
    { dispose: () => { void http?.stop(); http = undefined; } });
  void sync();
}
