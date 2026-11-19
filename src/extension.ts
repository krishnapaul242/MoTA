import * as vscode from 'vscode';
import * as QRCode from 'qrcode';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { validPackage } from './apk';
import { ChildProcess } from 'node:child_process';
import { Adb, Device, escapeHtml as html, mergeKnownDevices, parseServices, validAddress } from './adb';
import { registerDevicePage } from './devicePage';
import { registerDeviceFarm } from './deviceFarm';
import { registerInstallPage } from './installPage';
import { registerMonitorPage } from './monitorPage';
import { registerTestsPage } from './testsPage';
import { registerMcp } from './mcpSetup';
import { registerAiAuth } from './aiAuth';
import { registerRecordings } from './recordingsView';
import { launchApp, setStayAwake, setScreenTimeout } from './deviceActions';
import { page, actionScript } from './ui';
import { recoveryHint } from './metrics';

class Tree extends vscode.TreeItem {
  constructor(label: string, public device?: Device, public uri?: vscode.Uri) {
    super(label); this.contextValue = device?.state === 'device' ? 'device' : device?.state === 'remembered' ? 'remembered' : uri ? 'apk' : 'status';
    this.description = device ? `${device.state} · ${device.serial}` : uri ? vscode.workspace.asRelativePath(uri) : undefined;
    this.tooltip = this.description;
    this.iconPath = new vscode.ThemeIcon(device ? 'device-mobile' : 'package');
    if(device?.state==='device')this.command={command:'mota.device',title:'Device controls',arguments:[this]};
    if (device?.state === 'remembered') this.command = {command:'mota.connect',title:'Reconnect',arguments:[device.serial]};
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
      if (found.status === 'fulfilled') {
        const previous = context.globalState.get<Device[]>('knownDevices', []);
        const merged = mergeKnownDevices(found.value, previous);
        if (JSON.stringify(previous) !== JSON.stringify(merged)) await context.globalState.update('knownDevices', merged);
        const addresses = context.globalState.get<string[]>('addresses',[]);
        const combined = [...new Set([...addresses,...found.value.map(d => d.serial).filter(validAddress)])].slice(0,20);
        if (JSON.stringify(addresses) !== JSON.stringify(combined)) await context.globalState.update('addresses',combined);
        devices.set([...found.value.map(d => new Tree(d.model, d)), ...merged.filter(d => !found.value.includes(d)).map(d => new Tree(d.model, {...d,state:'remembered'}))]);
      } else devices.set([new Tree('ADB unavailable — check mota.adbPath')]);
      if (files.status === 'fulfilled') apks.set(files.value.sort((a,b) => a.fsPath.localeCompare(b.fsPath)).map(f => new Tree(f.path.split('/').pop()!, undefined, f)));
    } finally { refreshing = false; }
  }
  async function choose(item?: {device?: Device; targets?: Device[]}): Promise<Device[]> {
    if (item?.targets) return item.targets.filter(d => d.state === 'device');
    if (item?.device?.state === 'device') return [item.device];
    const all = (await adb.devices()).filter(d => d.state === 'device');
    if (!all.length) throw new Error('No ready devices. Connect a device and accept its debugging prompt.');
    const picked = await vscode.window.showQuickPick(all.map(d => ({label:d.model, description:d.serial, picked:context.globalState.get<string[]>('selectedDevices',[]).includes(d.serial), device:d})), {canPickMany:true, title:'Select target devices'});
    if (picked?.length) await context.globalState.update('selectedDevices',picked.map(p => p.device.serial));
    return picked?.map(p => p.device) || [];
  }
  function failure(error: unknown, retry: () => unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const panel = vscode.window.createWebviewPanel('mota.error','MoTA · Recovery',vscode.ViewColumn.One,{enableScripts:true});
    panel.webview.html = page(`<header><h1>Let’s get this working</h1><span class="badge">Action needed</span></header><section class="card"><p>${html(recoveryHint(message))}</p><pre>${html(message)}</pre><div class="actions"><button data-action="retry">Retry</button><button class="secondary" data-action="connect">Reconnect device</button><button class="secondary" data-action="pair">Pair with QR</button><button class="secondary" data-action="settings">ADB settings</button></div></section>`,actionScript);
    let retrying = false;
    panel.webview.onDidReceiveMessage(async m => {
      if (m?.action === 'retry' && !retrying) { retrying = true; try { await retry(); panel.dispose(); } catch(e) { panel.dispose(); failure(e,retry); } finally { retrying = false; } }
      else if (m?.action === 'connect') await vscode.commands.executeCommand('mota.connect');
      else if (m?.action === 'pair') await vscode.commands.executeCommand('mota.pair');
      else if (m?.action === 'settings') await vscode.commands.executeCommand('workbench.action.openSettings','mota.adbPath');
    },undefined,context.subscriptions);
  }
  function command(name: string, action: (...args: any[]) => unknown) {
    context.subscriptions.push(vscode.commands.registerCommand(name, async (...args) => { try { await action(...args); } catch(e) { failure(e,() => action(...args)); } }));
  }
  context.subscriptions.push(devices, apks, vscode.window.registerTreeDataProvider('mota.devices', devices), vscode.window.registerTreeDataProvider('mota.apks', apks));
  registerRecordings(vscode, context, adb, choose);
  registerDevicePage(vscode, context, adb, choose);
  registerDeviceFarm(vscode, context, adb, refresh);
  registerInstallPage(vscode, context, adb);
  registerMonitorPage(vscode, context, adb, choose);
  registerTestsPage(vscode, context, adb);
  registerMcp(vscode, context, adb);
  registerAiAuth(vscode, context);
  command('mota.refresh', refresh);
  async function deviceResults(title: string, targets: Device[], action: (d: Device) => Promise<string>) {
    if (!targets.length) return;
    const panel = vscode.window.createWebviewPanel('mota.actions',`MoTA · ${title}`,vscode.ViewColumn.One,{enableScripts:true});
    let disposed = false;
    panel.onDidDispose(() => {disposed = true;});
    const rows = targets.map(d => ({d,ok:false,detail:'Working…'}));
    const render = () => {if (!disposed) panel.webview.html = page(`<header><h1>${html(title)}</h1></header><div class="grid">${rows.map(r => `<section class="card"><h2>${html(r.d.model)}</h2><small>${html(r.d.serial)}</small><p class="${r.ok ? 'success' : r.detail === 'Working…' ? 'muted' : 'error'}">${html(r.detail)}</p></section>`).join('')}</div>`);};
    render();
    await Promise.all(rows.map(async r => {try {r.detail = await action(r.d);r.ok = true;}catch(e){r.detail = e instanceof Error ? e.message : String(e);}render();}));
  }
  command('mota.launch', async (item?: Tree) => {
    const targets = await choose(item);
    if (!targets.length) return;
    const pkg = await vscode.window.showInputBox({title:'Launch app on selected devices',value:context.workspaceState.get('launchPackage',''),placeHolder:'com.example.app',validateInput:v => validPackage(v) ? undefined : 'Enter the installed app package ID'});
    if (pkg === undefined) return;
    if (!validPackage(pkg)) throw new Error('Enter a valid app package ID.');
    await context.workspaceState.update('launchPackage',pkg);
    await deviceResults('Launch app',targets,d => launchApp(adb,d.serial,pkg));
  });
  command('mota.awake', async (item?: Tree) => {
    const targets = await choose(item);
    if (!targets.length) return;
    const mode = await vscode.window.showQuickPick([{label:'Keep awake while charging',description:'USB, AC or wireless charging; setting stays active until restored',value:'on'},{label:'Keep awake on battery · 1-hour screen timeout',description:'Extend inactivity timeout; restore it when you finish',value:'battery'},{label:'Restore previous sleep setting',description:'Restore the value saved before MoTA enabled keep-awake',value:'restore'},{label:'Wake screen now',description:'Wake the screen once, including when on battery',value:'wake'}],{title:'Device screen · keep awake'});
    if (!mode) return;
    await deviceResults('Device screen',targets,async d => {
      if (mode.value === 'wake') {const result = await adb.shell(d.serial,['input','keyevent','KEYCODE_WAKEUP']);if (/error|exception|permission denial/i.test(result)) throw new Error(result);return 'Wake request sent. Unlock the device if needed.';}
      const key = `awake.${encodeURIComponent(d.serial)}`;
      const timeoutKey = `sleep.${encodeURIComponent(d.serial)}`;
      if (mode.value === 'battery') {
        const original = (await adb.shell(d.serial,['settings','get','system','screen_off_timeout'])).trim();
        if (!/^\d+$/.test(original) || +original > 2147483647) throw new Error('Unable to read the current screen timeout. No setting was changed.');
        if (context.globalState.get<number>(timeoutKey) === undefined) await context.globalState.update(timeoutKey,+original);
        await setScreenTimeout(adb,d.serial,3600000);
        await adb.shell(d.serial,['input','keyevent','KEYCODE_WAKEUP']);
        return 'Screen inactivity timeout set to one hour, including on battery. Device policy may limit this. Use Restore previous sleep setting when finished.';
      }
      if (mode.value === 'on') {
        const original = (await adb.shell(d.serial,['settings','get','global','stay_on_while_plugged_in'])).trim();
        if (!/^\d+$/.test(original) || +original > 15) throw new Error('Unable to read the current sleep setting. No setting was changed.');
        if (context.globalState.get<number>(key) === undefined) await context.globalState.update(key,+original);
        await setStayAwake(adb,d.serial,7);
        await adb.shell(d.serial,['input','keyevent','KEYCODE_WAKEUP']);
        return 'Keep-awake enabled while charging. On battery, normal sleep rules apply. Use Restore previous sleep setting to undo.';
      }
      const previous = context.globalState.get<number>(key);
      const previousTimeout = context.globalState.get<number>(timeoutKey);
      if (previous === undefined && previousTimeout === undefined) return 'No previous MoTA sleep setting was saved for this connection. Nothing changed.';
      if (previous !== undefined) {await setStayAwake(adb,d.serial,previous);await context.globalState.update(key,undefined);}
      if (previousTimeout !== undefined) {await setScreenTimeout(adb,d.serial,previousTimeout);await context.globalState.update(timeoutKey,undefined);}
      return 'Previous sleep setting restored.';
    });
  });

  command('mota.forget', async () => {
    const choice = await vscode.window.showQuickPick(['Forget saved addresses and device history','Cancel'],{title:'Clear MoTA connection history'});
    if (choice?.startsWith('Forget')) { for (const key of ['addresses','knownDevices','selectedDevices']) await context.globalState.update(key,[]); await refresh(); }
  });
  command('mota.connect', async (saved?: string) => {
    let address = typeof saved === 'string' && validAddress(saved) ? saved : undefined;
    if (!address) {
      const history = context.globalState.get<string[]>('addresses',[]);
      const pick = await vscode.window.showQuickPick([{label:'Enter a new address',address:''},...history.map(a => ({label:a,address:a}))],{title:'Connect to Android · recent addresses'});
      if (!pick) return;
      address = pick.address || await vscode.window.showInputBox({title:'ADB connection address (not pairing port)', value:history[0],placeHolder:'192.168.1.10:37123',validateInput:v => validAddress(v) ? undefined : 'Enter host:port'});
    }
    if (!address) return;
    const result = await adb.run(['connect',address]);
    if (!/connected to|already connected/i.test(result)) throw new Error(result || 'Connection failed');
    await context.globalState.update('addresses',[address,...context.globalState.get<string[]>('addresses',[]).filter(a => a !== address)].slice(0,20));
    await refresh();
  });
  command('mota.pair', async () => {
    await adb.run(['start-server']);
    const service = `studio-${randomBytes(5).toString('hex')}`, password = String(randomInt(1000000000, 10000000000));
    const qr = await QRCode.toDataURL(`WIFI:T:ADB;S:${service};P:${password};;`, {margin:2, width:320});
    const panel = vscode.window.createWebviewPanel('mota.pair','MoTA · Pair Android',vscode.ViewColumn.One,{enableScripts:true});
    panel.webview.onDidReceiveMessage(async m => {
      if (m?.action === 'pair') {panel.dispose();await vscode.commands.executeCommand('mota.pair');}
      else if (m?.action === 'connect') await vscode.commands.executeCommand('mota.connect');
    },undefined,context.subscriptions);
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
        panel.webview.html = page('<h2>Paired successfully</h2><p>ADB will connect automatically. If the device does not appear, use the address on the main Wireless debugging screen.</p><button data-action="connect">Connect by address</button>',actionScript);
        await refresh(); return;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!closed) panel.webview.html = page('<h2>QR code expired</h2><p>Check that mDNS is allowed on your Wi-Fi network, then try a fresh code.</p><div class="actions"><button data-action="pair">Generate new QR</button><button class="secondary" data-action="connect">Connect by address</button></div>',actionScript);
  });
  function stopLogs() { const active = [...logs.values()]; logs.clear(); for (const {child,output} of active) { child.kill(); output.dispose(); } }
  command('mota.stopLogs', stopLogs);
  command('mota.logcat', async (item?: Tree) => {
    const targets = await choose(item);
    if (!targets.length) return;
    const filter = await vscode.window.showInputBox({title:'Logcat tag filters',value:context.workspaceState.get('logFilter','*:I'),prompt:'For React Native: ReactNative:V ReactNativeJS:V *:S',validateInput:v => v.trim().split(/\s+/).every(s => /^[\w.*-]+:[VDIWEFS]$/.test(s)) ? undefined : 'Use tag:priority, e.g. *:I'});
    if (filter === undefined) return;
    const format = await vscode.window.showQuickPick(['threadtime','brief','time','long','raw'],{title:'Logcat output format'});
    if (!format) return;
    const buffer = await vscode.window.showQuickPick(['default','main','system','crash','events','all'],{title:'Logcat buffer'});
    if (!buffer) return;
    const tail = await vscode.window.showInputBox({title:'Previous log lines to include',value:'100',validateInput:v => /^\d+$/.test(v) && +v >= 1 && +v <= 10000 ? undefined : 'Enter 1–10000 previous lines'});
    if (tail === undefined) return;
    const app = await vscode.window.showInputBox({title:'Optional app package · log only its current process',value:context.workspaceState.get('logPackage',''),validateInput:v => !v || /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(v) ? undefined : 'Enter an Android package name'});
    if (app === undefined) return;
    await context.workspaceState.update('logFilter',filter);
    await context.workspaceState.update('logPackage',app);
    const processes = new Map<string,string>();
    if (app) await Promise.all(targets.map(async d => {
      let pids: string;
      try {pids = await adb.shell(d.serial,['pidof',app]);} catch {throw new Error(`${app} is not running on ${d.model}. Launch it and retry.`);}
      const pid = pids.trim().split(/\s+/)[0];
      if (!/^\d+$/.test(pid)) throw new Error(`${app} is not running on ${d.model}. Launch it and retry.`);
      processes.set(d.serial,pid);
    }));
    for (const d of targets) {
      const pid = processes.get(d.serial);
      const previous = logs.get(d.serial); logs.delete(d.serial); previous?.child.kill(); previous?.output.dispose();
      const output = vscode.window.createOutputChannel(`MoTA · ${d.model} · ${d.serial}`);
      const child = adb.stream(['-s',d.serial,'logcat','-v',format,...(buffer !== 'default' ? ['-b',buffer] : []),'-T',tail,...(pid ? [`--pid=${pid}`] : []),...filter.trim().split(/\s+/)]);
      logs.set(d.serial,{child,output}); output.show(true);
      child.stdout?.on('data',data => {if (logs.get(d.serial)?.child === child) output.append(data.toString());});
      child.stderr?.on('data',data => {if (logs.get(d.serial)?.child === child) output.append(data.toString());});
      child.on('error',e => {if (logs.get(d.serial)?.child === child) {output.appendLine(e.message); failure(e,() => vscode.commands.executeCommand('mota.logcat',item));}});
      child.on('close',code => {if (logs.get(d.serial)?.child !== child) return; output.appendLine(`\nLogcat ended (${code}).`); logs.delete(d.serial); if (code) failure(new Error(`Logcat stopped on ${d.model} (exit ${code}). Check the output channel for details.`),() => vscode.commands.executeCommand('mota.logcat',item));});
      context.subscriptions.push(output);
    }
  });
  let elapsed = 0;
  const timer = setInterval(() => { if (++elapsed >= Math.max(2,config().get<number>('refreshSeconds',5))) { elapsed = 0; void refresh(); } },1000);
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.apk');
  context.subscriptions.push(watcher,watcher.onDidCreate(refresh),watcher.onDidDelete(refresh),{dispose:() => { clearInterval(timer); stopLogs(); }});
  void refresh();
}
