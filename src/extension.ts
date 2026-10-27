import * as vscode from 'vscode';
import * as QRCode from 'qrcode';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { detectApkPackage, validPackage, packageFromFailure, isInstallConflict } from './apk';
import { ChildProcess } from 'node:child_process';
import { Adb, Device, escapeHtml as html, parseServices, validAddress } from './adb';
import { page, actionScript } from './ui';
import { parseMetrics, installArgs, InstallOptions, recoveryHint } from './metrics';

class Tree extends vscode.TreeItem {
  constructor(label: string, public device?: Device, public uri?: vscode.Uri) {
    super(label); this.contextValue = device?.state === 'device' ? 'device' : device?.state === 'remembered' ? 'remembered' : uri ? 'apk' : 'status';
    this.description = device ? `${device.state} · ${device.serial}` : uri ? vscode.workspace.asRelativePath(uri) : undefined;
    this.tooltip = this.description;
    this.iconPath = new vscode.ThemeIcon(device ? 'device-mobile' : 'package');
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
        const merged = [...found.value, ...previous.filter(d => !found.value.some(f => f.serial === d.serial))].slice(0, 30);
        if (JSON.stringify(previous) !== JSON.stringify(merged)) await context.globalState.update('knownDevices', merged);
        const addresses = context.globalState.get<string[]>('addresses',[]);
        const combined = [...new Set([...addresses,...found.value.map(d => d.serial).filter(validAddress)])].slice(0,20);
        if (JSON.stringify(addresses) !== JSON.stringify(combined)) await context.globalState.update('addresses',combined);
        devices.set([...found.value.map(d => new Tree(d.model, d)), ...merged.filter(d => !found.value.some(f => f.serial === d.serial)).map(d => new Tree(d.model, {...d,state:'remembered'}))]);
      } else devices.set([new Tree('ADB unavailable — check mota.adbPath')]);
      if (files.status === 'fulfilled') apks.set(files.value.sort((a,b) => a.fsPath.localeCompare(b.fsPath)).map(f => new Tree(f.path.split('/').pop()!, undefined, f)));
    } finally { refreshing = false; }
  }
  async function choose(item?: Tree): Promise<Device[]> {
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
  command('mota.refresh', refresh);
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
  command('mota.install', async (item?: Tree) => {
    const uri = item?.uri || (await vscode.window.showOpenDialog({filters:{'Android package':['apk']},canSelectMany:false}))?.[0];
    if (!uri) return;
    const targets = await choose();
    if (!targets.length) return;
    const presentation = await vscode.window.showQuickPick([{label:'Editor page',description:'Options, per-device progress and recovery',value:'page'},{label:'Notification',description:'Compact progress with an Open install page action',value:'notification'}],{title:'Where should installation run?'});
    if (!presentation) return;
    const defaults: InstallOptions = {replace:true,test:false,downgrade:false,grant:false,user:'',timeout:180};
    let options = {...defaults,...context.workspaceState.get<InstallOptions>('installOptions',defaults)};
    const roots = [process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,join(homedir(),'Library','Android','sdk'),join(homedir(),'Android','Sdk'),process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA,'Android','Sdk')].filter((v): v is string => Boolean(v));
    const detectedPackage = await detectApkPackage(uri.fsPath,roots);
    let packageName = detectedPackage || '';
    const panel = vscode.window.createWebviewPanel('mota.install','MoTA · Install APK',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true});
    let disposed = false, running = false;
    let confirmation: {indices:number[];pkg:string} | undefined;
    panel.onDidDispose(() => {disposed = true;});
    const statuses = targets.map(d => ({device:d,state:'Ready',detail:''}));
    const button = (action: string,label: string,index?: number) => `<button class="secondary" data-action="${action}" ${index === undefined ? '' : `data-index="${index}"`} ${running || confirmation ? 'disabled' : ''}>${label}</button>`;
    const render = () => {
      if (disposed) return;
      panel.webview.html = page(`<header><div><small>DEPLOY TO ANDROID</small><h1>Install APK</h1></div><span class="badge">${targets.length} devices</span></header><p class="muted">${html(uri.fsPath)}</p>
      ${confirmation ? `<section class="card"><h2>Confirm clean replacement</h2><p>Uninstall <strong>${html(confirmation.pkg)}</strong> from <strong>${confirmation.indices.map(i => html(statuses[i].device.model+' · '+statuses[i].device.serial)).join(', ')}</strong>, then install this APK.</p><p class="error">This deletes the app and its local data. Uninstall applies to all Android users on these devices, even if an install user is selected. If installation fails afterward, the old app remains removed.</p><label><input id="confirm-loss" type="checkbox">I understand that app data will be deleted.</label><div class="actions"><button data-action="confirm-replace">Delete app data &amp; install APK</button><button class="secondary" data-action="cancel-replace">Cancel</button></div></section>` : ''}
      <div class="grid"><section class="card"><h2>Install options</h2><label>Install preset <select id="preset" ${running || confirmation ? 'disabled' : ''}><option value="custom">Custom / current options</option><option value="update">Update existing app · keep data</option><option value="switch">Switch debug / release APK</option></select></label><small>Switch enables replace, test APK and downgrade. Different signing keys still require a confirmed clean replacement.</small>
      ${([['replace','Replace existing app · keep data'],['test','Allow test APK'],['downgrade','Allow downgrade · debuggable apps'],['grant','Grant runtime permissions']] as const).map(([key,label]) => `<label><input type="checkbox" id="${key}" ${options[key] ? 'checked' : ''} ${running || confirmation ? 'disabled' : ''}>${label}</label>`).join('')}
      <label>App package <input id="package" value="${html(packageName)}" placeholder="com.example.app" ${running || confirmation || detectedPackage ? 'disabled' : ''}></label><small>${detectedPackage ? 'Read from selected APK.' : 'Needed for clean replacement. Verify it matches the selected APK; SDK build tools can detect this automatically.'}</small>
      <label>Android user <input id="user" value="${html(options.user)}" placeholder="Default / current / all / user ID" ${running || confirmation ? 'disabled' : ''}></label><label>Timeout (seconds) <input id="timeout" type="number" min="10" max="600" value="${options.timeout}" ${running || confirmation ? 'disabled' : ''}></label>
      <div class="actions"><button data-action="install" ${running || confirmation || statuses.every(s => s.state === 'Installed') ? 'disabled' : ''}>${running ? 'Working…' : statuses.every(s => s.state === 'Installed') ? 'Installed successfully' : statuses.some(s => s.state === 'Failed') ? 'Retry failed devices' : 'Install on devices'}</button>${button('clean','Clean reinstall on selected devices')}${button('choose-apk','Choose another APK')}${button('connect','Reconnect')}${button('settings','ADB settings')}</div><p id="validation" class="error" role="alert"></p></section>
      <section><h2>Device activity</h2>${statuses.map((s,i) => `<article class="card"><div class="row"><strong>${html(s.device.model)}</strong><span class="badge">${html(s.state)}</span></div><small>${html(s.device.serial)}</small>${['Installing','Uninstalling'].includes(s.state) ? '<progress aria-label="Working"></progress>' : ''}${s.detail ? `<p class="${s.state === 'Failed' ? 'error' : 'success'}">${html(s.state === 'Failed' ? recoveryHint(s.detail) : s.detail)}</p>${s.state === 'Failed' ? `<div class="actions">${/ALREADY_EXISTS/.test(s.detail) ? button('retry-replace','Replace existing app & retry',i) : ''}${/VERSION_DOWNGRADE/.test(s.detail) ? button('retry-downgrade','Allow downgrade & retry',i) : ''}${/TEST_ONLY/.test(s.detail) ? button('retry-test','Allow test APK & retry',i) : ''}${isInstallConflict(s.detail) ? button('clean-one','Uninstall conflicting app & reinstall',i) : ''}</div><details><summary>Failure details</summary><pre>${html(s.detail)}</pre></details>` : ''}` : ''}</article>`).join('')}</section></div>`, `
      document.getElementById('preset').addEventListener('change',e=>{const value=e.target.value;if(value==='custom')return;document.getElementById('replace').checked=true;document.getElementById('test').checked=value==='switch';document.getElementById('downgrade').checked=value==='switch';});
      document.addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(!b)return;api.postMessage({action:b.dataset.action,index:b.dataset.index===undefined?undefined:Number(b.dataset.index),confirmed:document.getElementById('confirm-loss')?.checked===true,package:document.getElementById('package').value.trim(),options:{replace:document.getElementById('replace').checked,test:document.getElementById('test').checked,downgrade:document.getElementById('downgrade').checked,grant:document.getElementById('grant').checked,user:document.getElementById('user').value.trim(),timeout:Number(document.getElementById('timeout').value)}});});window.addEventListener('message',e=>{if(e.data.error)document.getElementById('validation').textContent=e.data.error;});`);
    };
    const run = async (indices: number[], cleanPackage?: string) => {
      if (running || disposed) return;
      installArgs(targets[0].serial,uri.fsPath,options);
      running = true;
      indices.forEach(i => {statuses[i].state = cleanPackage ? 'Uninstalling' : 'Installing';statuses[i].detail = '';}); render();
      try {
        await context.workspaceState.update('installOptions',options);
        await Promise.all(indices.map(async i => {
          const s = statuses[i]; let removed = false;
          try {
            if (cleanPackage) {
              const result = await adb.run(['-s',s.device.serial,'uninstall',cleanPackage],options.timeout*1000);
              if (!/\bSuccess\b/.test(result)) throw new Error(`Uninstall failed: ${result}. APK installation was not attempted.`);
              removed = true;s.state = 'Installing';render();
            }
            const result = await adb.run(installArgs(s.device.serial,uri.fsPath,options),options.timeout*1000);
            if (!/\bSuccess\b/.test(result)) throw new Error(result || 'Installation failed');
            s.state = 'Installed';s.detail = removed ? 'Old app removed and APK installed. Local app data was reset.' : 'APK installed successfully.';
          } catch(e) {s.state = 'Failed';s.detail = `${removed ? 'The old app was removed. New APK installation failed. ' : ''}${e instanceof Error ? e.message : String(e)}`;}
          render();
        }));
      } finally {running = false;render();}
    };
    panel.webview.onDidReceiveMessage(async m => {
      try {
        if (running) return;
        if (m?.action === 'cancel-replace') {confirmation = undefined;render();return;}
        if (m?.action === 'confirm-replace') {
          if (!confirmation || m.confirmed !== true) throw new Error('Confirm that app data will be deleted before continuing.');
          const confirmed = confirmation;confirmation = undefined;
          await run(confirmed.indices,confirmed.pkg);return;
        }
        if (confirmation) return;
        if (['install','clean','clean-one','retry-replace','retry-downgrade','retry-test'].includes(m?.action) && m.options) {
          options = {replace:m.options.replace === true,test:m.options.test === true,downgrade:m.options.downgrade === true,grant:m.options.grant === true,user:String(m.options.user ?? ''),timeout:Number(m.options.timeout)};
          installArgs(targets[0].serial,uri.fsPath,options);
          const individual = ['clean-one','retry-replace','retry-downgrade','retry-test'].includes(m.action);
          if (individual && (!Number.isInteger(m.index) || m.index < 0 || m.index >= statuses.length || statuses[m.index].state !== 'Failed')) throw new Error('Choose a failed device to retry.');
          const indices = individual ? [m.index as number] : statuses.flatMap((s,i) => m.action === 'clean' || s.state !== 'Installed' ? [i] : []);
          packageName = detectedPackage || (typeof m.package === 'string' ? m.package.trim() : packageName);
          if (m.action === 'clean' || m.action === 'clean-one') {
            const fromFailure = individual ? packageFromFailure(statuses[m.index].detail) : undefined;
            const pkg = detectedPackage || packageName || fromFailure;
            if (!pkg || !validPackage(pkg)) throw new Error('Enter the app package ID before clean replacement (for example com.example.app).');
            if (fromFailure && pkg !== fromFailure) throw new Error('The package entered differs from the conflicting package. Check the APK and package ID before deleting an app.');
            packageName = pkg;confirmation = {indices,pkg};render();return;
          }
          if (m.action === 'retry-replace') options.replace = true;
          if (m.action === 'retry-downgrade') {options.replace = true;options.downgrade = true;}
          if (m.action === 'retry-test') options.test = true;
          if (presentation.value === 'notification') {
            void vscode.window.showInformationMessage('Installing APK…','Open install page').then(action => {if (action && !disposed) panel.reveal();});
            await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'MoTA · Installing APK'},() => run(indices));
          } else await run(indices);
        } else if (m?.action === 'choose-apk') await vscode.commands.executeCommand('mota.install');
        else if (m?.action === 'connect') await vscode.commands.executeCommand('mota.connect');
        else if (m?.action === 'settings') await vscode.commands.executeCommand('workbench.action.openSettings','mota.adbPath');
      } catch(e) {if (!disposed) void panel.webview.postMessage({error:e instanceof Error ? e.message : String(e)});}
    },undefined,context.subscriptions);
    render();
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
  command('mota.stats', async (item?: Tree) => {
    const targets = await choose(item);
    if (!targets.length) return;
    let packageName = context.workspaceState.get('monitorPackage','');
    const panel = vscode.window.createWebviewPanel('mota.stats','MoTA · Device Monitor',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true});
    let disposed = false, busy = false, paused = false, interval = 5000;
    let lastSample = 0;
    let latest: unknown;
    const history = new Map<string,number[]>();
    const metadata = new Map<string,string>();
    const metric = (key: string,label: string,unit: string,bar = false) => `<div><div class="label">${label}</div><div class="value"><span data-metric="${key}">—</span><span class="unit">${unit}</span></div>${bar ? `<progress data-bar="${key}" max="100" value="0" aria-label="${label}"></progress>` : ''}</div>`;
    panel.webview.html = page(`<header><div><small>ANDROID WORKSPACE</small><h1>Device monitor</h1><p class="muted" id="updated">Waiting for first sample…</p></div><div class="actions"><button data-action="sample">Refresh now</button><button class="secondary" id="pause" data-action="pause">Pause</button><button class="secondary" data-action="connect">Connect device</button></div></header><section class="card row"><label>App package <input id="package" value="${html(packageName)}" placeholder="com.example.app"></label><label>Sample every <select id="interval"><option value="2000">2 seconds</option><option value="5000" selected>5 seconds</option><option value="10000">10 seconds</option><option value="30000">30 seconds</option></select></label><button data-action="apply">Apply</button><small>CPU and frames are Android-reported aggregates.</small></section><p id="error" class="error" role="alert"></p><div class="grid">${targets.map((d,i) => `<article class="card" id="device-${i}"><div class="row"><h2>${html(d.model)}</h2><span class="badge" data-status>Connecting</span></div><small>${html(d.serial)} <span data-version></span></small><div class="metrics">${metric('battery','Battery','%',true)}${metric('cpu','CPU load','%',true)}${metric('memory','Memory used','%',true)}${metric('temperature','Temperature','°C')}${metric('appMb','App memory','MB')}${metric('jank','Janky frames','%')}</div><p class="muted" data-memory></p><svg viewBox="0 0 300 50" preserveAspectRatio="none" role="img" aria-label="CPU history, last 40 samples"><polyline data-chart fill="none" stroke="var(--vscode-charts-blue)" stroke-width="2" points=""></polyline></svg><div class="row"><small>CPU history · last 40 samples</small><small data-frames></small></div><p data-issue class="error"></p><details><summary>Raw diagnostics</summary><pre data-raw>Waiting for sample…</pre></details></article>`).join('')}</div>`, `
      document.addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(b)api.postMessage({action:b.dataset.action,package:document.getElementById('package').value.trim(),interval:Number(document.getElementById('interval').value)});});
      window.addEventListener('message',e=>{const m=e.data;if(m.error!==undefined)document.getElementById('error').textContent=m.error;if(m.paused!==undefined)document.getElementById('pause').textContent=m.paused?'Resume':'Pause';if(!m.devices)return;document.getElementById('updated').textContent='Updated '+m.time+' · '+m.interval/1000+' second interval';m.devices.forEach((d,i)=>{const c=document.getElementById('device-'+i);c.querySelector('[data-status]').textContent=d.ok?'Connected':'Check connection';c.querySelector('[data-version]').textContent=d.version?'· Android '+d.version:'';c.querySelector('[data-issue]').textContent=d.issue;c.querySelector('[data-raw]').textContent=d.raw;for(const [k,v]of Object.entries(d.metrics)){const el=c.querySelector('[data-metric="'+k+'"]');if(el)el.textContent=v===null?'—':typeof v==='number'?v.toFixed(k==='battery'?0:1):String(v);const bar=c.querySelector('[data-bar="'+k+'"]');if(bar)bar.value=v===null?0:Math.min(100,Math.max(0,v));}c.querySelector('[data-memory]').textContent=d.metrics.totalGb===null?'Memory unavailable':(d.metrics.usedGb===null?'—':d.metrics.usedGb.toFixed(1))+' / '+d.metrics.totalGb.toFixed(1)+' GB used · '+(d.metrics.charging?'Charging':'On battery');c.querySelector('[data-frames]').textContent=d.metrics.frames===null?'No app frame data':d.metrics.frames+' frames rendered';c.querySelector('[data-chart]').setAttribute('points',d.history.map((v,j)=>((j/39)*300)+','+(48-Math.min(100,Math.max(0,v))*0.46)).join(' '));});});api.postMessage({action:'ready'});`);
    const sample = async () => {
      if (disposed || busy) return;
      busy = true; lastSample = Date.now();
      try {
        const samples = await Promise.all(targets.map(async d => {
          const queries: [string,string[]][] = [['Battery',['dumpsys','battery']],['Memory',['cat','/proc/meminfo']],['CPU',['dumpsys','cpuinfo']]];
          if (packageName) queries.push(['App memory',['dumpsys','meminfo',packageName]],['Frames',['dumpsys','gfxinfo',packageName]]);
          if (!metadata.has(d.serial)) { try {metadata.set(d.serial,await adb.shell(d.serial,['getprop','ro.build.version.release']));} catch {} }
          const results = await Promise.allSettled(queries.map(([,args]) => adb.shell(d.serial,args)));
          const values = results.map(r => r.status === 'fulfilled' ? r.value : '');
          const metrics = parseMetrics(...[values[0],values[1],values[2]] as [string,string,string],values[3],values[4]);
          const points = history.get(d.serial) || [];
          if (metrics.cpu !== null) points.push(metrics.cpu);
          history.set(d.serial,points.slice(-40));
          const failures = results.flatMap((r,i) => r.status === 'rejected' ? [`${queries[i][0]}: ${r.reason.message}`] : []);
          return {metrics,history:history.get(d.serial),version:metadata.get(d.serial),ok:results.slice(0,3).some(r => r.status === 'fulfilled'),issue:failures.join(' · '),raw:results.map((r,i) => `${queries[i][0]}\n${r.status === 'fulfilled' ? r.value : r.reason.message}`).join('\n\n')};
        }));
        latest = {devices:samples,time:new Date().toLocaleTimeString(),interval};
        if (!disposed) await panel.webview.postMessage(latest);
      } catch(e) {if (!disposed) void panel.webview.postMessage({error:String(e)});}
      finally {busy = false;}
    };
    panel.webview.onDidReceiveMessage(async m => {
      if (m?.action === 'ready') {if (latest) void panel.webview.postMessage(latest);else void sample();}
      else if (m?.action === 'pause') {paused = !paused;void panel.webview.postMessage({paused});if (!paused) void sample();}
      else if (m?.action === 'sample') void sample();
      else if (m?.action === 'connect') await vscode.commands.executeCommand('mota.connect');
      else if (m?.action === 'apply') {
        if (busy) {void panel.webview.postMessage({error:'Wait for the current sample, then apply your options.'});return;}
        if (typeof m.package !== 'string' || (m.package && !/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(m.package)) || ![2000,5000,10000,30000].includes(m.interval)) {void panel.webview.postMessage({error:'Enter a valid Android package and sample interval.'});return;}
        packageName = m.package;interval = m.interval;await context.workspaceState.update('monitorPackage',packageName);void panel.webview.postMessage({error:''});void sample();
      }
    },undefined,context.subscriptions);
    const timer = setInterval(() => {if (!paused && Date.now()-lastSample >= interval) void sample();},1000);
    panel.onDidDispose(() => {disposed = true; clearInterval(timer);});
    context.subscriptions.push({dispose:() => {clearInterval(timer);panel.dispose();}});
    await sample();
  });
  let elapsed = 0;
  const timer = setInterval(() => { if (++elapsed >= Math.max(2,config().get<number>('refreshSeconds',5))) { elapsed = 0; void refresh(); } },1000);
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.apk');
  context.subscriptions.push(watcher,watcher.onDidCreate(refresh),watcher.onDidDelete(refresh),{dispose:() => { clearInterval(timer); stopLogs(); }});
  void refresh();
}
