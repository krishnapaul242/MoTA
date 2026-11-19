import type * as VSCode from 'vscode';
import { isAbsolute, join, relative } from 'node:path';
import { Adb, Device } from './adb';
import { connectionKind } from './deviceFarm';
import { aiHost, AiLink, aiPoster, isAiMessage } from './webview/aiLink';
import { testsHtml } from './webview/testsView';

/**
 * Maestro test runs page: setup → running → results. The run itself is owned by the shared AI host
 * (src/ai/host.ts → src/maestro/runner.ts); this page only lists devices and talks test/* messages to it.
 */
export function registerTestsPage(vscode: typeof VSCode, context: VSCode.ExtensionContext, adb: Adb) {
  let current: TestsPage | undefined;
  context.subscriptions.push(vscode.commands.registerCommand('mota.tests', (item?: { targets?: Device[]; device?: Device }) => {
    const preselect = (item?.targets ?? (item?.device ? [item.device] : [])).map(d => d.serial);
    if (current) { current.panel.reveal(); if (preselect.length) current.select(preselect); return; }
    const page = current = new TestsPage(preselect);
    page.panel.onDidDispose(() => { page.dispose(); if (current === page) current = undefined; });
  }), { dispose: () => current?.panel.dispose() });

  class TestsPage {
    readonly panel: VSCode.WebviewPanel;
    private ai: AiLink;
    private closed = false;

    constructor(private preselect: string[]) {
      const roots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri);
      this.panel = vscode.window.createWebviewPanel('mota.tests', 'MoTA · Tests', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: roots });
      this.panel.webview.html = testsHtml(this.panel.webview.cspSource);
      this.ai = aiHost(context, adb).connect(aiPoster(vscode, this.panel, () => this.closed));
      this.panel.webview.onDidReceiveMessage(m => { void this.message(m).catch(e => this.post({ kind: 'notice', text: e instanceof Error ? e.message : String(e), error: true })); });
    }
    dispose() { this.closed = true; this.ai.dispose(); }
    private post(m: unknown) { if (!this.closed) void this.panel.webview.postMessage(m); }
    select(serials: string[]) { this.preselect = serials; this.post({ kind: 'select', serials }); }

    private async devices() {
      const all = await adb.devices();
      const known = context.globalState.get<Device[]>('knownDevices', []);
      const rows = await Promise.all(all.map(async d => {
        let android = '';
        if (d.state === 'device') { try { android = (await adb.shell(d.serial, ['getprop', 'ro.build.version.release'])).trim(); } catch { /* unknown */ } }
        return { serial: d.serial, model: d.model, state: d.state, kind: connectionKind(d.serial), android };
      }));
      for (const k of known) if (!rows.some(r => r.serial === k.serial)) rows.push({ serial: k.serial, model: k.model, state: 'remembered', kind: connectionKind(k.serial), android: '' });
      this.post({ kind: 'devices', devices: rows, preselect: this.preselect });
    }

    private async message(m: any) {
      if (this.closed) return;
      if (isAiMessage(m)) return this.ai.handle(m);
      if (!m || typeof m.action !== 'string') return;
      switch (m.action) {
        case 'ready': await this.devices(); this.post({ kind: 'settings', env: context.workspaceState.get('maestroEnv', ''), apk: context.workspaceState.get('maestroApk', ''), clearData: context.workspaceState.get('maestroClearData', '') }); return;
        case 'devices': await this.devices(); return;
        case 'remember': {
          if (typeof m.env === 'string' && m.env.length < 20000) await context.workspaceState.update('maestroEnv', m.env);
          if (typeof m.apk === 'string' && m.apk.length < 4096) await context.workspaceState.update('maestroApk', m.apk);
          if (typeof m.clearData === 'string' && m.clearData.length < 256) await context.workspaceState.update('maestroClearData', m.clearData);
          return;
        }
        case 'choose-apk': {
          const pick = (await vscode.window.showOpenDialog({ filters: { 'Android package': ['apk'] }, canSelectMany: false, title: 'APK to install before the run' }))?.[0];
          if (!pick) return;
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          const rel = root && !relative(root, pick.fsPath).startsWith('..') ? relative(root, pick.fsPath) : pick.fsPath;
          this.post({ kind: 'apk', path: rel }); return;
        }
        case 'open-flow': {
          const folder = String(m.folder ?? ''), flow = String(m.flow ?? '');
          if (!folder || !flow || flow.includes('..')) return;
          const file = isAbsolute(flow) ? flow : join(folder, flow);
          await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false, viewColumn: vscode.ViewColumn.Beside }); return;
        }
        case 'open-dir': if (typeof m.dir === 'string' && m.dir) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(m.dir)); return;
        case 'open-file': if (typeof m.path === 'string' && m.path) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(m.path)); return;
        case 'farm': await vscode.commands.executeCommand('mota.farm'); return;
        case 'settings': await vscode.commands.executeCommand('workbench.action.openSettings', 'mota.maestro'); return;
      }
    }
  }
}
