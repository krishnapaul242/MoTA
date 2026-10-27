import * as vscode from 'vscode';
import * as QRCode from 'qrcode';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ChildProcess } from 'node:child_process';
import { Adb, Device, escapeHtml as html, parseServices, validAddress } from './adb';

class Tree extends vscode.TreeItem {
  constructor(label: string, public device?: Device, public uri?: vscode.Uri) {
    super(label); this.contextValue = device?.state === 'device' ? 'device' : uri ? 'apk' : 'status';
    this.description = device ? `${device.state} · ${device.serial}` : uri ? vscode.workspace.asRelativePath(uri) : undefined;
    this.tooltip = this.description;
    this.iconPath = new vscode.ThemeIcon(device ? 'device-mobile' : 'package');
    if (uri) this.command = { command: 'mota.install', title: 'Install APK', arguments: [this] };
  }
}
class Provider implements vscode.TreeDataProvider<Tree> {
  private change = new vscode.EventEmitter<void>();
  onDidChangeTreeData = this.change.event;
  items: Tree[] = [];
  getTreeItem(item: Tree) { return item; }
  getChildren() { return this.items; }
  set(items: Tree[]) { this.items = items; this.change.fire(); }
  dispose() { this.change.dispose(); }
}
const style = `<style>body{font-family:var(--vscode-font-family);padding:24px;line-height:1.6}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--vscode-textCodeBlock-background);padding:16px}img{background:white;padding:16px;max-width:280px}h2{font-weight:500}small{color:var(--vscode-descriptionForeground)}</style>`;
function page(body: string) { return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">${style}</head><body>${body}</body></html>`; }

export function activate(context: vscode.ExtensionContext) {
  const config = () => vscode.workspace.getConfiguration('mota');
  const adb = new Adb(() => {
    const configured = config().get<string>('adbPath', 'adb');
    if (configured !== 'adb') return configured;
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    const candidate = sdk && join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
    return candidate && existsSync(candidate) ? candidate : 'adb';
  });
  const devices = new Provider(), apks = new Provider();
  const logs = new Map<string, { child: ChildProcess; output: vscode.OutputChannel }>();
  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const [found, files] = await Promise.allSettled([adb.devices(), vscode.workspace.findFiles(config().get('apkGlob', '**/*.apk'), '**/{node_modules,.git}/**')]);
      devices.set(found.status === 'fulfilled' ? found.value.map(d => new Tree(d.model, d)) : [new Tree('ADB unavailable — check mota.adbPath')]);
      if (files.status === 'fulfilled') apks.set(files.value.sort((a,b) => a.fsPath.localeCompare(b.fsPath)).map(f => new Tree(f.path.split('/').pop()!, undefined, f)));
    } finally { refreshing = false; }
  }
  async function choose(item?: Tree): Promise<Device[]> {
    if (item?.device?.state === 'device') return [item.device];
    const all = (await adb.devices()).filter(d => d.state === 'device');
    if (!all.length) throw new Error('No ready devices. Connect a device and accept its debugging prompt.');
    const picked = await vscode.window.showQuickPick(all.map(d => ({label:d.model, description:d.serial, device:d})), {canPickMany:true, title:'Select target devices'});
    return picked?.map(p => p.device) || [];
  }
  function command(name: string, action: (...args: any[]) => unknown) {
    context.subscriptions.push(vscode.commands.registerCommand(name, async (...args) => { try { await action(...args); } catch(e) { void vscode.window.showErrorMessage(`MoTA: ${e instanceof Error ? e.message : String(e)}`); } }));
  }
  context.subscriptions.push(devices, apks, vscode.window.registerTreeDataProvider('mota.devices', devices), vscode.window.registerTreeDataProvider('mota.apks', apks));
  command('mota.refresh', refresh);
  command('mota.connect', async () => {
    const address = await vscode.window.showInputBox({title:'ADB connection address (not pairing port)', placeHolder:'192.168.1.10:37123', validateInput:v => validAddress(v) ? undefined : 'Enter host:port'});
    if (address) { const result = await adb.run(['connect', address]); void vscode.window.showInformationMessage(result); await refresh(); }
  });
  command('mota.pair', async () => {
    await adb.run(['start-server']);
    const service = `studio-${randomBytes(5).toString('hex')}`, password = String(randomInt(1000000000, 10000000000));
    const qr = await QRCode.toDataURL(`WIFI:T:ADB;S:${service};P:${password};;`, {margin:2, width:320});
    const panel = vscode.window.createWebviewPanel('mota.pair','MoTA · Pair Android',vscode.ViewColumn.One,{});
    const instructions = '<h2>Pair your Android device</h2><p>On Android 11+, open <b>Developer options → Wireless debugging → Pair device with QR code</b>.</p><p>Use the same Wi-Fi network as this computer.</p>';
    panel.webview.html = page(`${instructions}<img alt="ADB pairing QR code" src="${qr}"><p>Waiting for scan… This code expires in two minutes.</p>`);
    let closed = false;
    panel.onDidDispose(() => { closed = true; });
    const deadline = Date.now() + 120000;
    while (!closed && Date.now() < deadline) {
      const services = parseServices(await adb.run(['mdns','services']));
      const match = services.find(s => s.name.replace(/\.$/, '') === service && s.type.includes('pairing'));
      if (match) {
        const result = await adb.run(['pair', match.address, password], 30000);
        if (closed) return;
        if (!/successfully paired/i.test(result)) throw new Error(result || 'Pairing failed');
        panel.webview.html = page('<h2>Paired successfully</h2><p>ADB will connect automatically. If the device does not appear, run <b>MoTA: Connect by Address</b> using the address on the main Wireless debugging screen.</p>');
        await refresh(); return;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!closed) panel.webview.html = page('<h2>QR code expired</h2><p>Run MoTA: Pair Device with QR again. Check that mDNS is allowed on your Wi-Fi network.</p>');
  });
  command('mota.install', async (item?: Tree) => {
    const uri = item?.uri || (await vscode.window.showOpenDialog({filters:{'Android package':['apk']},canSelectMany:false}))?.[0];
    if (!uri) return;
    const targets = await choose();
    if (!targets.length) return;
    await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'Installing APK'}, async progress => {
      const results = await Promise.allSettled(targets.map(async d => {
        progress.report({message:d.model});
        const result = await adb.run(['-s',d.serial,'install','-r',uri.fsPath],180000);
        if (!/\bSuccess\b/.test(result)) throw new Error(result);
      }));
      const failures = results.flatMap((r,i) => r.status === 'rejected' ? [`${targets[i].model}: ${r.reason.message}`] : []);
      if (failures.length) throw new Error(failures.join('\n'));
      void vscode.window.showInformationMessage(`APK installed on ${targets.length} device(s).`);
    });
  });
  function stopLogs() { for (const {child,output} of logs.values()) { child.kill(); output.dispose(); } logs.clear(); }
  command('mota.stopLogs', stopLogs);
  command('mota.logcat', async (item?: Tree) => {
    const targets = await choose(item);
    if (!targets.length) return;
    const filter = await vscode.window.showInputBox({title:'Logcat tag filters',value:'*:I',prompt:'For React Native: ReactNative:V ReactNativeJS:V *:S',validateInput:v => v.trim().split(/\s+/).every(s => /^[\w.*-]+:[VDIWEFS]$/.test(s)) ? undefined : 'Use tag:priority, e.g. *:I'});
    if (filter === undefined) return;
    for (const d of targets) {
      const previous = logs.get(d.serial); previous?.child.kill(); previous?.output.dispose();
      const output = vscode.window.createOutputChannel(`MoTA · ${d.model} · ${d.serial}`);
      const child = adb.stream(['-s',d.serial,'logcat','-v','threadtime',...filter.trim().split(/\s+/)]);
      logs.set(d.serial,{child,output}); output.show(true);
      child.stdout?.on('data',data => output.append(data.toString()));
      child.stderr?.on('data',data => output.append(data.toString()));
      child.on('error',e => output.appendLine(e.message));
      child.on('close',code => { output.appendLine(`\nLogcat ended (${code}).`); if (logs.get(d.serial)?.child === child) logs.delete(d.serial); });
      context.subscriptions.push(output);
    }
  });
  command('mota.stats', async (item?: Tree) => {
    const targets = await choose(item);
    if (!targets.length) return;
    const packageName = await vscode.window.showInputBox({title:'Optional app package for memory and frame stats',placeHolder:'com.example.app',validateInput:v => !v || /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(v) ? undefined : 'Enter an Android package name'});
    if (packageName === undefined) return;
    const panel = vscode.window.createWebviewPanel('mota.stats','MoTA · Live Device Stats',vscode.ViewColumn.One,{});
    let disposed = false, busy = false;
    const sample = async () => {
      if (disposed || busy) return; busy = true;
      try {
        const cards = await Promise.all(targets.map(async d => {
          const queries: [string,string[]][] = [['Android',['getprop','ro.build.version.release']],['Model',['getprop','ro.product.model']],['Battery',['dumpsys','battery']],['Memory',['cat','/proc/meminfo']],['CPU summary',['dumpsys','cpuinfo']]];
          if (packageName) queries.push(['App memory',['dumpsys','meminfo',packageName]],['Frame stats (cumulative)',['dumpsys','gfxinfo',packageName]]);
          const results = await Promise.allSettled(queries.map(([,args]) => adb.shell(d.serial,args)));
          return `<h2>${html(d.model)} <small>${html(d.serial)}</small></h2>${results.map((r,i) => `<details ${i < 3 ? 'open' : ''}><summary>${html(queries[i][0])}</summary><pre>${html(r.status === 'fulfilled' ? r.value : r.reason.message)}</pre></details>`).join('')}`;
        }));
        if (!disposed) panel.webview.html = page(`<h1>Device monitor</h1><p>Updated ${html(new Date().toLocaleTimeString())} · samples every 5 seconds. CPU and frame figures are Android's reported aggregates.</p>${cards.join('<hr>')}`);
      } finally { busy = false; }
    };
    const timer = setInterval(() => { void sample(); },5000);
    panel.onDidDispose(() => { disposed = true; clearInterval(timer); });
    context.subscriptions.push({dispose:() => {clearInterval(timer); panel.dispose();}});
    await sample();
  });
  let elapsed = 0;
  const timer = setInterval(() => { if (++elapsed >= Math.max(2,config().get<number>('refreshSeconds',5))) { elapsed = 0; void refresh(); } },1000);
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.apk');
  context.subscriptions.push(watcher,watcher.onDidCreate(refresh),watcher.onDidDelete(refresh),{dispose:() => { clearInterval(timer); stopLogs(); }});
  void refresh();
}
