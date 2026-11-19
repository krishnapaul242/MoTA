import type * as VSCode from 'vscode';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { promises as fs } from 'node:fs';
import { Adb, Device } from './adb';
import { validPackage } from './apk';
import { connectionKind } from './deviceFarm';
import { parseMetrics } from './metrics';
import { aiHost, AiLink, aiPoster, isAiMessage } from './webview/aiLink';
import { monitorHtml } from './webview/monitorView';

export const MONITOR_METRICS = ['cpu', 'memory', 'appMb', 'jank', 'temperature'] as const;
type Metric = typeof MONITOR_METRICS[number];
const HISTORY = 60;
export const INTERVALS = [1000, 2000, 5000, 10000];

/** Threshold flags shown beside a value: the device needs attention when one is set. */
export function metricFlags(m: ReturnType<typeof parseMetrics>) {
  const flags: Record<string, string> = {};
  if (m.cpu !== null && m.cpu >= 80) flags.cpu = 'High';
  if (m.memory !== null && m.memory >= 90) flags.memory = 'High';
  if (m.jank !== null && m.jank >= 10) flags.jank = 'Janky';
  if (m.temperature !== null && m.temperature >= 42) flags.temperature = 'Hot';
  if (m.battery !== null && m.battery <= 20 && !m.charging) flags.battery = 'Low';
  return flags;
}

/** CSV of every sample kept in history, one row per device and time. */
export function monitorCsv(rows: { model: string; serial: string; samples: { time: number; metrics: Record<string, number | boolean | null> }[] }[]) {
  const cols = ['cpu', 'memory', 'usedGb', 'totalGb', 'appMb', 'frames', 'jank', 'battery', 'charging', 'temperature'];
  const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [['time', 'device', 'serial', ...cols].join(',')];
  for (const r of rows) for (const s of r.samples) lines.push([new Date(s.time).toISOString(), r.model, r.serial, ...cols.map(c => s.metrics[c])].map(cell).join(','));
  return lines.join('\n') + '\n';
}

export function registerMonitorPage(vscode: typeof VSCode, context: VSCode.ExtensionContext, adb: Adb, choose: (item?: { device?: Device; targets?: Device[] }) => Promise<Device[]>) {
  context.subscriptions.push(vscode.commands.registerCommand('mota.stats', async (item?: { device?: Device; targets?: Device[] }) => {
    try {
      const targets = await choose(item);
      if (targets.length) new MonitorPage(targets);
    } catch (e) { void vscode.window.showErrorMessage(`MoTA: ${e instanceof Error ? e.message : String(e)}`); }
  }));

  class MonitorPage {
    private readonly panel: VSCode.WebviewPanel;
    private ai: AiLink;
    private packageName = context.workspaceState.get<string>('monitorPackage', '');
    private interval = INTERVALS.includes(context.workspaceState.get<number>('monitorInterval', 2000)) ? context.workspaceState.get<number>('monitorInterval', 2000) : 2000;
    private paused = false;
    private busy = false;
    private lastSample = 0;
    private closed = false;
    private timer: ReturnType<typeof setInterval>;
    private versions = new Map<string, string>();
    private samples = new Map<string, { time: number; metrics: ReturnType<typeof parseMetrics> }[]>();
    private raw = new Map<string, string>();
    private issues = new Map<string, string>();
    private packages: string[] = [];

    constructor(private targets: Device[]) {
      this.panel = vscode.window.createWebviewPanel('mota.stats', 'MoTA · Device monitor', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.webview.html = monitorHtml(this.panel.webview.cspSource);
      this.ai = aiHost(context, adb).connect(aiPoster(vscode, this.panel, () => this.closed));
      this.panel.webview.onDidReceiveMessage(m => { void this.message(m).catch(e => this.post({ kind: 'notice', text: e instanceof Error ? e.message : String(e), error: true })); });
      this.timer = setInterval(() => { if (!this.paused && Date.now() - this.lastSample >= this.interval) void this.sample(); }, 250);
      this.panel.onDidDispose(() => { this.closed = true; clearInterval(this.timer); this.ai.dispose(); });
      void this.loadPackages();
    }
    private post(m: unknown) { if (!this.closed) void this.panel.webview.postMessage(m); }

    private async loadPackages() {
      const lists = await Promise.all(this.targets.map(d => adb.shell(d.serial, ['pm', 'list', 'packages', '-3']).catch(() => '')));
      this.packages = [...new Set(lists.flatMap(l => l.split(/\r?\n/).map(x => x.trim().replace(/^package:/, '')).filter(validPackage)))].sort();
      this.send();
    }

    private async sample() {
      if (this.closed || this.busy) return;
      this.busy = true; this.lastSample = Date.now();
      try {
        await Promise.all(this.targets.map(async d => {
          const queries: [string, string[]][] = [['Battery', ['dumpsys', 'battery']], ['Memory', ['cat', '/proc/meminfo']], ['CPU', ['dumpsys', 'cpuinfo']]];
          if (this.packageName) queries.push(['App memory', ['dumpsys', 'meminfo', this.packageName]], ['Frames', ['dumpsys', 'gfxinfo', this.packageName]]);
          if (!this.versions.has(d.serial)) { try { this.versions.set(d.serial, (await adb.shell(d.serial, ['getprop', 'ro.build.version.release'])).trim()); } catch { /* unknown */ } }
          const results = await Promise.allSettled(queries.map(([, args]) => adb.shell(d.serial, args)));
          const values = results.map(r => r.status === 'fulfilled' ? r.value : '');
          const metrics = parseMetrics(values[0], values[1], values[2], values[3], values[4]);
          const list = this.samples.get(d.serial) ?? [];
          if (results.slice(0, 3).some(r => r.status === 'fulfilled')) list.push({ time: Date.now(), metrics });
          this.samples.set(d.serial, list.slice(-HISTORY));
          this.issues.set(d.serial, results.flatMap((r, i) => r.status === 'rejected' ? [`${queries[i][0]}: ${(r.reason as Error).message}`] : []).join(' · '));
          this.raw.set(d.serial, results.map((r, i) => `${queries[i][0]}\n${r.status === 'fulfilled' ? r.value : (r.reason as Error).message}`).join('\n\n').slice(0, 60000));
        }));
        this.send();
      } finally { this.busy = false; }
    }

    private send() {
      this.post({
        kind: 'sample', time: Date.now(), interval: this.interval, paused: this.paused, packageName: this.packageName, packages: this.packages, intervals: INTERVALS,
        devices: this.targets.map(d => {
          const list = this.samples.get(d.serial) ?? [], last = list[list.length - 1]?.metrics;
          const series = (k: Metric) => list.map(s => s.metrics[k]).map(v => typeof v === 'number' ? v : null);
          return {
            serial: d.serial, model: d.model, sub: [this.versions.get(d.serial) && `Android ${this.versions.get(d.serial)}`, connectionKind(d.serial)].filter(Boolean).join(' · '),
            ok: !!last, issue: this.issues.get(d.serial) ?? '', metrics: last ?? null, flags: last ? metricFlags(last) : {},
            times: list.map(s => s.time), history: Object.fromEntries(MONITOR_METRICS.map(k => [k, series(k)])), raw: this.raw.get(d.serial) ?? '',
          };
        }),
      });
    }

    private async message(m: any) {
      if (this.closed) return;
      if (isAiMessage(m)) return this.ai.handle(m);
      if (!m || typeof m.action !== 'string') return;
      switch (m.action) {
        case 'ready': this.send(); if (!this.lastSample) void this.sample(); return;
        case 'pause': this.paused = !this.paused; this.send(); if (!this.paused) void this.sample(); return;
        case 'interval': if (INTERVALS.includes(m.interval)) { this.interval = m.interval; await context.workspaceState.update('monitorInterval', this.interval); this.send(); } return;
        case 'package': {
          const pkg = String(m.package ?? '');
          if (pkg && !validPackage(pkg)) throw new Error('Choose a valid app package.');
          this.packageName = pkg; await context.workspaceState.update('monitorPackage', pkg); this.samples.clear(); this.send(); void this.sample(); return;
        }
        case 'remove': this.targets = this.targets.filter(d => d.serial !== m.serial); this.samples.delete(m.serial); this.send(); return;
        case 'add': {
          const online = (await adb.devices()).filter(d => d.state === 'device' && !this.targets.some(t => t.serial === d.serial));
          if (!online.length) { this.post({ kind: 'notice', text: 'Every ready device is already in the monitor.' }); return; }
          const picks = await vscode.window.showQuickPick(online.map(d => ({ label: d.model, description: d.serial, d })), { canPickMany: true, title: 'Add devices to the monitor' });
          if (picks?.length) { this.targets.push(...picks.map(p => p.d)); void this.loadPackages(); void this.sample(); }
          return;
        }
        case 'export': {
          const target = await vscode.window.showSaveDialog({ title: 'Export monitor samples', defaultUri: vscode.Uri.file(join(homedir(), 'Downloads', `mota-monitor-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`)), filters: { CSV: ['csv'] } });
          if (!target) return;
          await fs.writeFile(target.fsPath, monitorCsv(this.targets.map(d => ({ model: d.model, serial: d.serial, samples: (this.samples.get(d.serial) ?? []).map(s => ({ time: s.time, metrics: s.metrics as unknown as Record<string, number | boolean | null> })) }))));
          this.post({ kind: 'notice', text: `Exported to ${target.fsPath}` }); return;
        }
        case 'connect': await vscode.commands.executeCommand('mota.farm'); return;
      }
    }
  }
}
