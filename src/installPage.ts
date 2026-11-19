import type * as VSCode from 'vscode';
import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { Adb, Device } from './adb';
import { ApkBadging, isInstallConflict, packageFromFailure, readApkBadging, validPackage } from './apk';
import { launchApp } from './deviceActions';
import { connectionKind } from './deviceFarm';
import { parsePackageDump } from './devicePage';
import { installArgs, InstallOptions, recoveryHint } from './metrics';
import { aiHost, AiLink, aiPoster, isAiMessage } from './webview/aiLink';
import { installHtml } from './webview/installView';

type RowState = 'ready' | 'installing' | 'uninstalling' | 'installed' | 'failed';
type Fix = 'replace' | 'downgrade' | 'test' | 'clean';
interface Row {
  serial: string; model: string; kind: string; android?: string; sdk?: number; selected: boolean;
  installed?: { version: string; code?: number } | null; state: RowState; detail: string; hint: string; fixes: Fix[]; error: string;
}

/** What installing the APK will do on a device, shown before the install runs. */
export function installPlan(apk: ApkBadging | undefined, row: Pick<Row, 'installed' | 'sdk'>, mode: 'update' | 'clean', options: Pick<InstallOptions, 'downgrade'>): { text: string; warn: boolean } {
  if (apk?.minSdk && row.sdk && row.sdk < apk.minSdk) return { text: `Needs Android API ${apk.minSdk}+ (this phone has ${row.sdk})`, warn: true };
  if (mode === 'clean') return { text: 'Uninstall, then install (erases app data)', warn: true };
  if (row.installed === undefined) return { text: apk?.package ? 'Checking…' : 'Install', warn: false };
  if (row.installed === null) return { text: 'Fresh install', warn: false };
  const from = row.installed.version, to = apk?.versionName ? `${apk.versionName}${apk.versionCode ? ` (${apk.versionCode})` : ''}` : 'this APK';
  if (apk?.versionCode && row.installed.code) {
    if (apk.versionCode < row.installed.code) return options.downgrade ? { text: `Downgrade ${from} → ${to}`, warn: true } : { text: `Older than installed ${from}: turn on Allow downgrade`, warn: true };
    if (apk.versionCode === row.installed.code) return { text: `Reinstall ${to}, keeps data`, warn: false };
  }
  return { text: `Update ${from} → ${to}`, warn: false };
}

/** Which one-click fixes to offer for an install error. */
export function fixesFor(error: string): Fix[] {
  const fixes: Fix[] = [];
  if (/ALREADY_EXISTS/.test(error)) fixes.push('replace');
  if (/VERSION_DOWNGRADE/.test(error)) fixes.push('downgrade');
  if (/TEST_ONLY/.test(error)) fixes.push('test');
  if (isInstallConflict(error)) fixes.push('clean');
  return fixes;
}

export function registerInstallPage(vscode: typeof VSCode, context: VSCode.ExtensionContext, adb: Adb) {
  context.subscriptions.push(vscode.commands.registerCommand('mota.install', async (item?: { uri?: VSCode.Uri; targets?: Device[]; device?: Device }) => {
    try {
      const uri = item?.uri || (await vscode.window.showOpenDialog({ filters: { 'Android package': ['apk'] }, canSelectMany: false, title: 'Choose an APK to install' }))?.[0];
      if (!uri) return;
      const preselect = (item?.targets ?? (item?.device ? [item.device] : [])).map(d => d.serial);
      new InstallPage(uri.fsPath, preselect);
    } catch (e) { void vscode.window.showErrorMessage(`MoTA: ${e instanceof Error ? e.message : String(e)}`); }
  }));

  const sdkRoots = () => [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), 'Library', 'Android', 'sdk'), join(homedir(), 'Android', 'Sdk'), process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk')].filter((v): v is string => Boolean(v));
  const defaults: InstallOptions = { replace: true, test: false, downgrade: false, grant: false, user: '', timeout: 180 };

  class InstallPage {
    private readonly panel: VSCode.WebviewPanel;
    private ai: AiLink;
    private apk?: ApkBadging;
    private apkFile = { size: 0, mtime: 0 };
    private rows = new Map<string, Row>();
    private options: InstallOptions = { ...defaults, ...context.workspaceState.get<InstallOptions>('installOptions', defaults) };
    private mode: 'update' | 'clean' = 'update';
    private launchAfter = context.workspaceState.get<boolean>('installLaunchAfter', true);
    private running = false;
    private closed = false;
    private notice = '';

    constructor(private path: string, private preselect: string[]) {
      this.panel = vscode.window.createWebviewPanel('mota.install', 'MoTA · Install APK', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.webview.html = installHtml(this.panel.webview.cspSource);
      this.ai = aiHost(context, adb).connect(aiPoster(vscode, this.panel, () => this.closed));
      this.panel.onDidDispose(() => { this.closed = true; this.ai.dispose(); });
      this.panel.webview.onDidReceiveMessage(m => { void this.message(m).catch(e => { this.notice = e instanceof Error ? e.message : String(e); this.render(); }); });
      void this.loadApk().then(() => this.loadDevices());
    }
    private post(m: unknown) { if (!this.closed) void this.panel.webview.postMessage(m); }

    private async loadApk() {
      const stat = await fs.stat(this.path).catch(() => undefined);
      this.apkFile = { size: stat?.size ?? 0, mtime: stat?.mtimeMs ?? 0 };
      this.apk = await readApkBadging(this.path, sdkRoots());
      this.render();
    }
    private async loadDevices() {
      const online = (await adb.devices()).filter(d => d.state === 'device');
      const keep = new Map(this.rows);
      this.rows = new Map(online.map(d => [d.serial, keep.get(d.serial) ?? { serial: d.serial, model: d.model, kind: connectionKind(d.serial), selected: this.preselect.length ? this.preselect.includes(d.serial) : online.length === 1, state: 'ready' as RowState, detail: '', hint: '', fixes: [], error: '' }]));
      this.render();
      await Promise.all([...this.rows.values()].map(async row => {
        try {
          const props = (await adb.shell(row.serial, ['getprop ro.build.version.release; getprop ro.build.version.sdk'])).split(/\r?\n/).map(s => s.trim());
          row.android = props[0]; row.sdk = +props[1] || undefined;
        } catch { /* shown without version */ }
        await this.refreshInstalled(row);
      }));
      this.render();
    }
    private async refreshInstalled(row: Row) {
      if (!this.apk?.package) { row.installed = undefined; return; }
      try {
        const info = parsePackageDump(await adb.shell(row.serial, ['dumpsys', 'package', this.apk.package]));
        row.installed = info ? { version: info.version, code: +(info.version.match(/\((\d+)\)/)?.[1] ?? '') || undefined } : null;
      } catch { row.installed = undefined; }
    }

    private render() {
      if (this.closed) return;
      const rows = [...this.rows.values()];
      this.post({
        kind: 'state',
        apk: { path: this.path, file: basename(this.path), size: this.apkFile.size, mtime: this.apkFile.mtime, info: this.apk ?? null },
        rows: rows.map(r => ({ ...r, plan: installPlan(this.apk, r, this.mode, this.options) })),
        options: this.options, mode: this.mode, launchAfter: this.launchAfter, running: this.running, notice: this.notice,
      });
      this.notice = '';
    }

    private async message(m: any) {
      if (this.closed) return;
      if (isAiMessage(m)) return this.ai.handle(m);
      if (!m || typeof m.action !== 'string') return;
      const row = typeof m.serial === 'string' ? this.rows.get(m.serial) : undefined;
      switch (m.action) {
        case 'ready': this.render(); return;
        case 'refresh': await this.loadDevices(); return;
        case 'select': if (row && !this.running) { row.selected = !!m.on; this.render(); } return;
        case 'select-all': if (!this.running) { for (const r of this.rows.values()) r.selected = !!m.on; this.render(); } return;
        case 'mode': if (m.mode === 'update' || m.mode === 'clean') { this.mode = m.mode; this.render(); } return;
        case 'launch-after': this.launchAfter = !!m.on; await context.workspaceState.update('installLaunchAfter', this.launchAfter); return;
        case 'options': {
          const o = m.options ?? {};
          const next: InstallOptions = { replace: true, test: o.test === true, downgrade: o.downgrade === true, grant: o.grant === true, user: String(o.user ?? ''), timeout: Number(o.timeout) };
          installArgs('x', this.path, next); // validates user and timeout
          this.options = next; await context.workspaceState.update('installOptions', next); this.render(); return;
        }
        case 'choose-apk': {
          const pick = (await vscode.window.showOpenDialog({ filters: { 'Android package': ['apk'] }, canSelectMany: false, title: 'Choose another APK' }))?.[0];
          if (!pick || this.running) return;
          this.path = pick.fsPath; for (const r of this.rows.values()) Object.assign(r, { state: 'ready', detail: '', hint: '', fixes: [], error: '', installed: undefined });
          await this.loadApk(); await Promise.all([...this.rows.values()].map(r => this.refreshInstalled(r))); this.render(); return;
        }
        case 'install': return this.install([...this.rows.values()].filter(r => r.selected).map(r => r.serial), this.mode === 'clean' ? 'clean' : undefined);
        case 'retry-failed': return this.install([...this.rows.values()].filter(r => r.state === 'failed').map(r => r.serial));
        case 'fix': if (row && ['replace', 'downgrade', 'test', 'clean'].includes(m.fix)) return this.install([row.serial], m.fix); return;
        case 'launch': return this.launch(row ? [row] : [...this.rows.values()].filter(r => r.state === 'installed'));
        case 'copy-error': if (row?.error) { await vscode.env.clipboard.writeText(row.error); this.notice = 'Error details copied.'; this.render(); } return;
        case 'reveal': await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(this.path)); return;
      }
    }

    private async packageForClean(serials: string[]) {
      const fromFailure = serials.map(s => packageFromFailure(this.rows.get(s)?.error ?? '')).find(Boolean);
      if (this.apk?.package) {
        if (fromFailure && fromFailure !== this.apk.package) throw new Error(`The conflicting app (${fromFailure}) isn't the one in this APK (${this.apk.package}). Check the APK before deleting an app.`);
        return this.apk.package;
      }
      const typed = await vscode.window.showInputBox({ title: 'Package to uninstall first', value: fromFailure ?? '', placeHolder: 'com.example.app', prompt: "The APK's package couldn't be read. Enter the app's package ID.", validateInput: v => validPackage(v) ? undefined : 'Enter a package ID such as com.example.app' });
      return typed && validPackage(typed) ? typed : undefined;
    }

    private async install(serials: string[], fix?: Fix) {
      if (this.running || !serials.length) { if (!serials.length) { this.notice = 'Select at least one device.'; this.render(); } return; }
      const options = { ...this.options };
      if (fix === 'replace') options.replace = true;
      if (fix === 'downgrade') { options.replace = true; options.downgrade = true; }
      if (fix === 'test') options.test = true;
      let clean: string | undefined;
      if (fix === 'clean') {
        clean = await this.packageForClean(serials);
        if (!clean) return;
        const names = serials.map(s => this.rows.get(s)?.model ?? s);
        const ok = await vscode.window.showWarningMessage(`Uninstall ${clean} from ${names.length === 1 ? names[0] : `${names.length} devices`}, then install this APK?`, { modal: true, detail: `This deletes the app and all its data on:\n${names.join('\n')}\n\nUninstall applies to every Android user on those devices. If installing fails afterwards, the old app stays removed.` }, 'Uninstall & install');
        if (ok !== 'Uninstall & install') return;
      }
      this.running = true;
      for (const s of serials) Object.assign(this.rows.get(s)!, { state: clean ? 'uninstalling' : 'installing', detail: '', hint: '', fixes: [], error: '' });
      this.render();
      try {
        await Promise.all(serials.map(async serial => {
          const row = this.rows.get(serial)!; const started = Date.now(); let removed = false;
          try {
            if (clean) {
              const out = await adb.run(['-s', serial, 'uninstall', clean], options.timeout * 1000);
              if (!/\bSuccess\b/.test(out)) throw new Error(`Uninstall failed: ${out}. The APK was not installed.`);
              removed = true; row.state = 'installing'; this.render();
            }
            const out = await adb.run(installArgs(serial, this.path, options), options.timeout * 1000);
            if (!/\bSuccess\b/.test(out)) throw new Error(out || 'Installation failed');
            row.state = 'installed';
            row.detail = `Installed in ${Math.max(1, Math.round((Date.now() - started) / 1000))} s${removed ? ' · app data was reset' : ''}`;
            await this.refreshInstalled(row);
          } catch (e) {
            const text = e instanceof Error ? e.message : String(e);
            Object.assign(row, { state: 'failed', error: `${removed ? 'The old app was removed, then installing failed. ' : ''}${text}`, hint: recoveryHint(text), fixes: fixesFor(text), detail: '' });
          }
          this.render();
        }));
      } finally { this.running = false; this.render(); }
      const installed = serials.map(s => this.rows.get(s)!).filter(r => r.state === 'installed');
      if (this.launchAfter && installed.length) await this.launch(installed);
    }

    private async launch(rows: Row[]) {
      const pkg = this.apk?.package ?? context.workspaceState.get<string>('launchPackage', '');
      if (!pkg || !validPackage(pkg)) { this.notice = "The APK's package couldn't be read, so MoTA can't launch it. Use Launch app on the device farm."; this.render(); return; }
      await context.workspaceState.update('launchPackage', pkg);
      const user = this.options.user === 'all' || !this.options.user ? 'current' : this.options.user;
      await Promise.all(rows.map(async row => {
        try { await launchApp(adb, row.serial, pkg, user); row.detail = (row.detail ? row.detail + ' · ' : '') + 'launched'; }
        catch (e) { row.detail = (row.detail ? row.detail + ' · ' : '') + `launch failed: ${e instanceof Error ? e.message : String(e)}`; }
      }));
      this.render();
    }
  }
}
