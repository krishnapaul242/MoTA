import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import type * as VSCode from 'vscode';
import type { Adb } from './adb';
import { aiHost, resolveClaude } from './ai/host';
import { MCP_PATH, McpHttpServer } from './ai/mcpHttp';
import { backupFlow } from './ai/tools';

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
      adb, input: host.input, runner: host.runner, flowsFolder, workspaceRoot,
      screenshotSide: () => config().get<number>('ai.screenshotWidth', 960),
      onFlowWritten: (file, before) => { if (before !== undefined) void backupFlow(workspaceRoot(), flowsFolder(), file, before).then(b => output.appendLine(`  previous version saved to ${b}`)); },
      token: () => token,
      log: line => output.appendLine(`${new Date().toLocaleTimeString()}  ${line}`),
      confirm: async (_tool, summary, args) => {
        const devices = [args.serial, ...(Array.isArray(args.serials) ? args.serials : [])].filter(Boolean).join(', ');
        const answer = await vscode.window.showWarningMessage(`An AI agent connected to MoTA wants to ${summary}${devices ? ` on ${devices}` : ''}.`,
          { modal: true, detail: 'This deletes data and cannot be undone.' }, 'Allow');
        return answer === 'Allow';
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
        if (sure) { await loadToken(true); void vscode.window.showInformationMessage('MoTA has a new access token. Run this command again to connect your agents.'); }
        return;
      }
      case 'off': await config().update('mcp.enabled', false, vscode.ConfigurationTarget.Global); return;
    }
  }

  context.subscriptions.push(output, status,
    vscode.commands.registerCommand('mota.mcpSetup', setup),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('mota.mcp')) void sync(); }),
    { dispose: () => { void http?.stop(); http = undefined; } });
  void sync();
}
