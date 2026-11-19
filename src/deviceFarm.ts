import type * as VSCode from 'vscode';
import * as QRCode from 'qrcode';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Adb, Device, mergeKnownDevices, parseServices, validAddress } from './adb';
import { captureScreenshot, shellLiteral } from './deviceControl';
import { devicePresets } from './devicePage';
import { page } from './ui';
import { ScreenMirror, streamSize } from './h264';
import { HelperClient, HELPER_PACKAGE } from './helperClient';
import { HelperDownloadServer, lanAddresses, parseDeviceOwner, provisioningPayload, readHelperMetadata } from './provisioning';

export interface FarmInfo { manufacturer: string; android: string; sdk: string; width: number | null; height: number | null; battery: number | null; charging: boolean; managed: boolean }
export const FARM_INFO_SCRIPT = 'echo @mfr;getprop ro.product.manufacturer;echo @rel;getprop ro.build.version.release;echo @sdk;getprop ro.build.version.sdk;echo @size;wm size;echo @bat;dumpsys battery;echo @owner;dumpsys device_policy | grep -A3 "Device Owner";true';

/** Parses the sectioned output of FARM_INFO_SCRIPT. */
export function parseFarmInfo(text: string): FarmInfo {
  const sections: Record<string, string> = {};
  let key = '';
  for (const line of text.split(/\r?\n/)) {
    const marker = line.trim().match(/^@(\w+)$/);
    if (marker) { key = marker[1]; sections[key] = ''; } else if (key) sections[key] += line + '\n';
  }
  const size = (sections.size || '').match(/Override size:\s*(\d+)x(\d+)/) || (sections.size || '').match(/Physical size:\s*(\d+)x(\d+)/);
  const bat = sections.bat || '';
  const level = bat.match(/\blevel:\s*(\d+)/), scale = bat.match(/\bscale:\s*(\d+)/);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    manufacturer: cap((sections.mfr || '').trim()),
    android: (sections.rel || '').trim(),
    sdk: (sections.sdk || '').trim(),
    width: size ? +size[1] : null,
    height: size ? +size[2] : null,
    battery: level && scale && +scale[1] ? Math.round(+level[1] / +scale[1] * 100) : null,
    charging: /(?:AC|USB|Wireless|Dock) powered:\s*true/i.test(bat),
    managed: parseDeviceOwner(sections.owner || '') === HELPER_PACKAGE,
  };
}
export function connectionKind(serial: string): 'Emulator' | 'Wi-Fi' | 'USB' {
  if (/^emulator-\d+$/.test(serial)) return 'Emulator';
  if (/:\d+$/.test(serial) || /_adb-tls-connect/.test(serial)) return 'Wi-Fi';
  return 'USB';
}
/** Validates a pointer gesture from the webview and returns `input` arguments. */
export function gestureArgs(m: any): string[] {
  const coords = (m?.type === 'tap' ? [m.x, m.y] : m?.type === 'swipe' ? [m.x, m.y, m.x2, m.y2] : []).map(Number);
  if (!coords.length || coords.some(v => !Number.isInteger(v) || v < 0 || v > 20000)) throw new Error('Invalid screen coordinates.');
  if (m.type === 'tap') return ['input', 'tap', ...coords.map(String)];
  const duration = Math.round(Number(m.duration));
  if (!Number.isFinite(duration)) throw new Error('Invalid swipe duration.');
  return ['input', 'swipe', ...coords.map(String), String(Math.min(5000, Math.max(50, duration)))];
}

/** Payload Android's "Pair device with QR code" scanner expects. */
export function pairingQr(service: string, password: string) {
  if (!/^[\w-]{1,64}$/.test(service) || !/^\w{6,64}$/.test(password)) throw new Error('Invalid pairing service or password.');
  return `WIFI:T:ADB;S:${service};P:${password};;`;
}
export function validPairingCode(code: unknown): code is string { return typeof code === 'string' && /^\d{6}$/.test(code); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Managed (device-owner) phones only: stay awake while charging and postpone system updates for 30 days. */
export async function applyFarmDefaults(adb: Adb, serial: string) {
  const client = new HelperClient(adb, serial);
  try {
    await client.connect();
    await client.request('adminStayAwake', { enabled: true });
    await client.request('adminUpdatePolicy', { policy: 'postpone' });
  } finally { await client.dispose(); }
}

const KEYS = ['back', 'home', 'recents', 'volumeUp', 'volumeDown', 'wake', 'sleep'];
const THUMBNAIL_MS = 5000, LIST_MS = 3000, INFO_MS = 60000;

export function registerDeviceFarm(vscode: typeof VSCode, context: VSCode.ExtensionContext, adb: Adb, refreshTree: () => Promise<void>) {
  let current: Farm | undefined;
  context.subscriptions.push(
    vscode.commands.registerCommand('mota.farm', () => {
      if (current) { current.panel.reveal(); return; }
      const farm = current = new Farm();
      farm.panel.onDidDispose(() => { farm.dispose(); if (current === farm) current = undefined; });
    }),
    { dispose: () => current?.panel.dispose() },
  );

  class Farm {
    readonly panel: VSCode.WebviewPanel;
    private devices = new Map<string, Device>();
    private info = new Map<string, { at: number; value: FarmInfo }>();
    private lastFrame = new Map<string, number>();
    private capturing = new Set<string>();
    private focus: string | undefined;
    private mirror?: ScreenMirror;
    private live = true;
    private closed = false;
    private listing = false;
    private lastList = 0;
    private timer: ReturnType<typeof setInterval>;
    private qrToken = 0;
    private provisioning?: HelperDownloadServer;

    constructor() {
      this.panel = vscode.window.createWebviewPanel('mota.farm', 'MoTA · Device farm', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.webview.html = page(body, script);
      this.panel.webview.onDidReceiveMessage(m => { void this.message(m).catch(e => this.notice(e instanceof Error ? e.message : String(e), true)); });
      this.timer = setInterval(() => this.tick(), 400);
    }
    dispose() { this.closed = true; this.qrToken++; this.provisioning?.close('closed'); this.stopMirror(); clearInterval(this.timer); }
    private stopMirror() { this.mirror?.stop(); this.mirror = undefined; }
    private post(m: unknown) { if (!this.closed) void this.panel.webview.postMessage(m); }
    private notice(text: string, error = false) { this.post({ kind: 'notice', text, error }); }
    private online(serial: unknown) { const d = typeof serial === 'string' ? this.devices.get(serial) : undefined; return d?.state === 'device' ? d : undefined; }

    private async list() {
      if (this.listing || this.closed) return;
      this.listing = true;
      try {
        const found = await adb.devices();
        const merged = mergeKnownDevices(found, context.globalState.get<Device[]>('knownDevices', []));
        const all = [...found, ...merged.filter(d => !found.includes(d)).map(d => ({ ...d, state: 'remembered' }))];
        this.devices = new Map(all.map(d => [d.serial, d]));
        if (this.focus && !this.online(this.focus)) { this.focus = undefined; this.stopMirror(); this.post({ kind: 'focus-lost' }); }
        const now = Date.now();
        await Promise.all(found.filter(d => d.state === 'device' && now - (this.info.get(d.serial)?.at || 0) > INFO_MS).map(async d => {
          try { this.info.set(d.serial, { at: now, value: parseFarmInfo(await adb.shell(d.serial, [FARM_INFO_SCRIPT])) }); } catch { /* shown without details */ }
        }));
        this.post({ kind: 'devices', devices: all.map(d => ({ ...d, kind: connectionKind(d.serial), info: this.info.get(d.serial)?.value })) });
      } catch (e) {
        this.post({ kind: 'devices', devices: [], error: e instanceof Error ? e.message : String(e) });
      } finally { this.listing = false; this.lastList = Date.now(); }
    }

    private tick() {
      if (this.closed || !this.panel.visible) return;
      if (Date.now() - this.lastList > LIST_MS) void this.list();
      const now = Date.now();
      for (const d of this.devices.values()) {
        if (d.state !== 'device' || this.capturing.has(d.serial)) continue;
        const focused = d.serial === this.focus;
        if (focused && this.mirror) continue; // live video replaces screenshots
        // While a live view is open, thumbnails pause so the focused device gets the bandwidth.
        if (!focused && (!this.live || this.focus || this.capturing.size >= 2 || now - (this.lastFrame.get(d.serial) || 0) < THUMBNAIL_MS)) continue;
        void this.capture(d.serial);
      }
    }
    private async capture(serial: string) {
      this.capturing.add(serial);
      try {
        const png = await captureScreenshot(adb, serial);
        this.post({ kind: 'frame', serial, src: 'data:image/png;base64,' + png.toString('base64') });
      } catch (e) {
        this.post({ kind: 'frame-error', serial, text: e instanceof Error ? e.message : String(e) });
      } finally { this.capturing.delete(serial); this.lastFrame.set(serial, Date.now()); }
    }

    private async message(m: any) {
      if (!m || typeof m.action !== 'string' || this.closed) return;
      switch (m.action) {
        case 'ready': case 'refresh': this.lastList = 0; await this.list(); return;
        case 'live': this.live = !!m.on; return;
        case 'focus': {
          this.stopMirror();
          const d = this.online(m.serial);
          this.focus = d?.serial;
          if (!d) return;
          this.lastFrame.set(d.serial, 0);
          if (m.stream) this.startMirror(d);
          return;
        }
        case 'video-error': this.mirror?.restart(); return;
        case 'video-unsupported': this.stopMirror(); if (this.focus) this.lastFrame.set(this.focus, 0); return;
        case 'gesture': case 'key': case 'text': {
          const d = this.online(m.serial); if (!d) throw new Error('The device is no longer available.');
          if (m.action === 'gesture') await shellLiteral(adb, d.serial, gestureArgs(m));
          else if (m.action === 'key') { if (!KEYS.includes(m.key)) throw new Error('Unknown key.'); await shellLiteral(adb, d.serial, devicePresets[m.key].args); }
          else { if (typeof m.text !== 'string' || !m.text || m.text.length > 4096) throw new Error('Enter up to 4096 characters.'); await shellLiteral(adb, d.serial, ['input', 'text', m.text.replace(/ /g, '%s')]); }
          return;
        }
        case 'reconnect': {
          const d = typeof m.serial === 'string' ? this.devices.get(m.serial) : undefined;
          if (!d) return;
          await vscode.commands.executeCommand('mota.connect', d.serial);
          await this.afterChange(); return;
        }
        case 'addresses': this.post({ kind: 'addresses', list: context.globalState.get<string[]>('addresses', []) }); return;
        case 'qr-start': return this.qrStart();
        case 'qr-stop': this.qrToken++; return;
        case 'connect-address': return this.withStatus('address', () => this.connectAddress(String(m.address ?? '').trim()));
        case 'pair-code': return this.withStatus('code', () => this.pairCode(String(m.address ?? '').trim(), m.code));
        case 'bulk': return this.bulk(String(m.command), Array.isArray(m.serials) ? m.serials : []);
        case 'provision-addresses': this.post({ kind: 'provision-addresses', list: lanAddresses(), serving: !!this.provisioning }); return;
        case 'provision-start': return this.provisionStart(m);
        case 'provision-stop': this.provisioning?.close('stopped'); return;
      }
    }
    private startMirror(d: Device) {
      const info = this.info.get(d.serial)?.value;
      const size = info?.width && info.height ? streamSize(info.width, info.height) : undefined;
      const serial = d.serial;
      const mirror = this.mirror = new ScreenMirror(adb, serial, size, connectionKind(serial) === 'USB' ? 8_000_000 : 4_000_000,
        unit => { if (this.mirror === mirror) this.post({ kind: 'video', serial, ...unit }); },
        () => { if (this.mirror === mirror) this.post({ kind: 'video-reset', serial }); },
        text => { if (this.mirror !== mirror) return; this.mirror = undefined; this.lastFrame.set(serial, 0); this.post({ kind: 'video-failed', serial, text }); });
      mirror.start();
    }
    private status(tab: string, state: 'working' | 'ok' | 'error', text: string) { this.post({ kind: 'add-status', tab, state, text }); }
    private async withStatus(tab: string, run: () => Promise<string>) {
      try { this.status(tab, 'ok', await run()); } catch (e) { this.status(tab, 'error', e instanceof Error ? e.message : String(e)); }
    }
    private async remember(address: string) {
      await context.globalState.update('addresses', [address, ...context.globalState.get<string[]>('addresses', []).filter(a => a !== address)].slice(0, 20));
      this.post({ kind: 'addresses', list: context.globalState.get<string[]>('addresses', []) });
    }
    private async connectAddress(address: string) {
      if (!validAddress(address)) throw new Error('Enter the IP address and port, for example 192.168.1.10:41235.');
      this.status('address', 'working', `Connecting to ${address}…`);
      const result = await adb.run(['connect', address], 20000);
      if (!/connected to|already connected/i.test(result)) throw new Error(result || 'Connection failed. Check that Wireless debugging is on and the port is current.');
      await this.remember(address); await this.afterChange();
      return `Connected to ${address}.`;
    }
    private async pairCode(address: string, code: unknown) {
      if (!validAddress(address)) throw new Error('Enter the pairing IP address and port shown under "Pair device with pairing code".');
      if (!validPairingCode(code)) throw new Error('Enter the 6-digit pairing code.');
      this.status('code', 'working', 'Pairing…');
      const before = new Set((await adb.devices()).map(d => d.serial));
      const result = await adb.run(['pair', address, code], 30000);
      if (!/successfully paired/i.test(result)) throw new Error(result || 'Pairing failed. Codes expire quickly, so generate a new one and retry.');
      return this.afterPairing('code', address.slice(0, address.lastIndexOf(':')), before);
    }
    /** adb usually connects to a newly paired device by itself over mDNS; help it along when it does not. */
    private async afterPairing(tab: string, host: string, before: Set<string>) {
      this.status(tab, 'working', 'Paired. Connecting…');
      for (let i = 0; i < 15 && !this.closed; i++) {
        const fresh = (await adb.devices()).find(d => d.state === 'device' && !before.has(d.serial));
        if (fresh) { if (validAddress(fresh.serial)) await this.remember(fresh.serial); await this.afterChange(); return `Paired and connected ${fresh.model}.`; }
        const service = parseServices(await adb.run(['mdns', 'services']).catch(() => '')).find(s => s.type.includes('connect') && s.address.startsWith(host + ':'));
        if (service) await adb.run(['connect', service.address], 20000).catch(() => '');
        await sleep(1000);
      }
      await this.afterChange();
      return 'Paired, but not connected yet. Use IP address with the address and port on the main Wireless debugging screen.';
    }
    private async qrStart() {
      const token = ++this.qrToken;
      try {
        await adb.run(['start-server']);
        const service = `mota-${randomBytes(5).toString('hex')}`, password = String(randomInt(100000000, 1000000000));
        const deadline = Date.now() + 120000;
        this.post({ kind: 'qr', src: await QRCode.toDataURL(pairingQr(service, password), { margin: 2, width: 280 }) });
        this.status('qr', 'working', 'Waiting for the phone to scan…');
        while (token === this.qrToken && !this.closed && Date.now() < deadline) {
          const match = parseServices(await adb.run(['mdns', 'services'])).find(s => s.name.replace(/\.$/, '') === service && s.type.includes('pairing'));
          if (match) {
            this.status('qr', 'working', 'Phone found. Pairing…');
            const before = new Set((await adb.devices()).map(d => d.serial));
            const result = await adb.run(['pair', match.address, password], 30000);
            if (!/successfully paired/i.test(result)) throw new Error(result || 'Pairing failed.');
            const text = await this.afterPairing('qr', match.address.slice(0, match.address.lastIndexOf(':')), before);
            if (token === this.qrToken) this.status('qr', 'ok', text);
            return;
          }
          await sleep(1000);
        }
        if (token === this.qrToken && !this.closed) this.status('qr', 'error', 'QR code expired. Check that the phone is on the same Wi-Fi and that the network allows mDNS, then generate a new code.');
      } catch (e) {
        if (token === this.qrToken) this.status('qr', 'error', e instanceof Error ? e.message : String(e));
      }
    }
    /** Serves the bundled helper on the LAN and shows the device-owner setup QR. */
    private async provisionStart(m: any) {
      this.provisioning?.close('replaced');
      try {
        const addresses = lanAddresses();
        const address = addresses.find(a => a.address === m.address)?.address ?? addresses[0]?.address;
        if (!address) throw new Error('This computer has no local network address. Connect it to the same Wi-Fi as the phone.');
        const ssid = typeof m.ssid === 'string' ? m.ssid.trim() : '', password = typeof m.password === 'string' ? m.password : '';
        if (!ssid && password) throw new Error('Enter the Wi-Fi name for this password.');
        const meta = readHelperMetadata(context.asAbsolutePath('resources/mota-recorder.json'));
        const apk = context.asAbsolutePath('resources/mota-recorder.apk');
        if (createHash('sha256').update(readFileSync(apk)).digest('hex') !== meta.sha256) throw new Error('The bundled helper does not match its metadata. Rebuild the helper.');
        let downloads = 0;
        const server: HelperDownloadServer = this.provisioning = new HelperDownloadServer(apk, address,
          from => {
            if (this.provisioning !== server) return;
            downloads++;
            this.status('managed', 'ok', `Phone ${from} downloaded the helper${downloads > 1 ? ` (${downloads} downloads)` : ''}. Finish setup on the phone, turn on USB debugging and plug it in. It shows as Managed here.`);
          },
          reason => {
            if (this.provisioning !== server) return;
            this.provisioning = undefined;
            this.post({ kind: 'provision-qr', src: '' });
            if (reason === 'expired') this.status('managed', 'error', 'The setup QR expired. Create a new one.');
            else if (reason === 'stopped' && !downloads) this.status('managed', 'working', 'Stopped serving the helper.');
          });
        const url = await server.url;
        const payload = provisioningPayload(url, meta.signatureChecksum, ssid ? { ssid, password: password || undefined } : undefined);
        if (this.provisioning !== server) return;
        this.post({ kind: 'provision-qr', src: await QRCode.toDataURL(payload, { margin: 2, width: 320, errorCorrectionLevel: 'M' }) });
        this.status('managed', 'working', `Serving the helper from ${address} for 15 minutes. Scan the code on the phone's first setup screen.`);
      } catch (e) {
        this.provisioning?.close('error');
        this.status('managed', 'error', errorText(e));
      }
    }
    private async afterChange() { this.info.clear(); await refreshTree(); this.lastList = 0; await this.list(); }

    private async bulk(command: string, serials: unknown[]) {
      const targets = [...new Set(serials)].map(s => this.online(s)).filter((d): d is Device => !!d);
      if (!targets.length) { this.notice('Select at least one available device.', true); return; }
      const delegated: Record<string, string> = { install: 'mota.install', launch: 'mota.launch', monitor: 'mota.stats', logs: 'mota.logcat', awake: 'mota.awake', controls: 'mota.device' };
      if (delegated[command]) { await vscode.commands.executeCommand(delegated[command], { targets }); return; }
      let run: (d: Device) => Promise<unknown>;
      let label: string;
      if (KEYS.includes(command)) { label = devicePresets[command].label; run = d => shellLiteral(adb, d.serial, devicePresets[command].args); }
      else if (command === 'reboot') {
        const ok = await vscode.window.showWarningMessage(`Reboot ${targets.length} device${targets.length > 1 ? 's' : ''}?`, { modal: true, detail: targets.map(d => `${d.model} (${d.serial})`).join('\n') }, 'Reboot');
        if (ok !== 'Reboot') return;
        label = 'Reboot'; run = d => adb.run(['-s', d.serial, 'reboot']);
      } else if (command === 'disconnect') {
        const wifi = targets.filter(d => connectionKind(d.serial) === 'Wi-Fi');
        if (!wifi.length) { this.notice('Only Wi-Fi devices can be disconnected. Unplug USB devices instead.', true); return; }
        targets.splice(0, targets.length, ...wifi);
        label = 'Disconnect'; run = d => adb.run(['disconnect', d.serial]);
      } else if (command === 'managed') {
        const managed = targets.filter(d => this.info.get(d.serial)?.value.managed);
        if (!managed.length) { this.notice('None of the selected devices is managed by MoTA. Set phones up with Add device → Managed setup.', true); return; }
        targets.splice(0, targets.length, ...managed);
        label = 'Farm defaults'; run = d => applyFarmDefaults(adb, d.serial);
      } else throw new Error('Unknown action.');
      const results = await Promise.allSettled(targets.map(run));
      const failed = results.flatMap((r, i) => r.status === 'rejected' ? [`${targets[i].model}: ${r.reason instanceof Error ? r.reason.message : r.reason}`] : []);
      this.notice(failed.length ? `${label} failed on ${failed.length} of ${targets.length}: ${failed.join(' · ')}` : `${label} sent to ${targets.length} device${targets.length > 1 ? 's' : ''}.`, failed.length > 0);
      if (command === 'reboot' || command === 'disconnect') await this.afterChange();
      else for (const d of targets) this.lastFrame.set(d.serial, 0);
    }
  }
}

const body = `<style>
body{max-width:none;padding:24px}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.toolbar input[type=search]{flex:1;min-width:200px}
.toolbar label{display:flex;gap:6px;align-items:center;font-size:13px}
.selbar{position:sticky;top:0;z-index:2;display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 12px;margin-bottom:16px;border-radius:10px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-focusBorder)}
.selbar[hidden]{display:none}.selbar b{margin-right:6px}
button.small{padding:5px 10px;font-size:12px}
.farm{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.dev{background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.dev.selected{border-color:var(--vscode-focusBorder);box-shadow:0 0 0 1px var(--vscode-focusBorder)}
.screen{position:relative;background:#000;display:flex;align-items:center;justify-content:center;height:300px;cursor:pointer}
.screen img{max-width:100%;max-height:100%;object-fit:contain}
.screen .msg{color:#bbb;font-size:12px;padding:16px;text-align:center}
.dev:not(.device) .screen{cursor:default;background:var(--vscode-editor-background)}
.status{position:absolute;top:8px;left:8px;font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(0,0,0,.65);color:#fff;display:flex;gap:5px;align-items:center}
.status i{width:8px;height:8px;border-radius:50%;display:inline-block}
.s-device i{background:#3fb950}.s-unauthorized i{background:#d29922}.s-offline i{background:#f85149}.s-remembered i{background:#8b949e}.s-focus i{background:#58a6ff}
.pick{position:absolute;top:6px;right:8px;width:18px;height:18px;cursor:pointer}
.meta{padding:12px 14px;display:flex;flex-direction:column;gap:4px;flex:1}
.meta h3{margin:0;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub{font-size:12px;color:var(--vscode-descriptionForeground)}
.tags{display:flex;gap:5px;flex-wrap:wrap;margin:4px 0}
.tag{font-size:11px;padding:1px 7px;border-radius:9px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.serial{font-family:var(--vscode-editor-font-family);font-size:11px;color:var(--vscode-descriptionForeground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cardacts{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:8px}
.empty{padding:40px;text-align:center;border:1px dashed var(--vscode-panel-border);border-radius:12px}
#notice{position:fixed;bottom:16px;right:16px;max-width:520px;padding:10px 14px;border-radius:8px;background:var(--vscode-notifications-background,var(--vscode-editorWidget-background));border:1px solid var(--vscode-panel-border);font-size:13px;z-index:20}
#notice.error{border-color:var(--vscode-errorForeground);color:var(--vscode-errorForeground)}
#overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10;display:flex;align-items:center;justify-content:center;padding:20px}
#overlay[hidden],#add[hidden]{display:none}
#add{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:11;display:flex;align-items:center;justify-content:center;padding:20px}
.dialog{background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:14px;padding:20px 22px;width:min(560px,100%);max-height:100%;overflow:auto}
.addtabs{display:flex;gap:4px;border-bottom:1px solid var(--vscode-panel-border);margin:12px 0 16px}
.addtabs button{background:none;color:var(--vscode-foreground);border-radius:0;border-bottom:2px solid transparent;padding:8px 12px}
.addtabs button[aria-selected=true]{border-bottom-color:var(--vscode-focusBorder);font-weight:600}
.dialog form{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}.dialog form label{display:flex;flex-direction:column;gap:4px;font-size:12px;flex:1;min-width:150px}
.qrbox{display:flex;justify-content:center;margin:8px 0}.qrbox img{background:#fff;border-radius:10px;width:240px;height:240px}.qrbox img.big{width:300px;height:300px}
.dialog select{width:100%}
.st{min-height:1.5em;font-size:13px}.st.ok{color:var(--vscode-testing-iconPassed,#3fb950)}.st.error{color:var(--vscode-errorForeground)}.st.working{color:var(--vscode-descriptionForeground)}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.dialog ol{padding-left:20px;margin:6px 0 12px}
.viewer{display:flex;gap:20px;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:14px;padding:18px;max-height:100%;max-width:100%}
.live{position:relative;background:#000;border-radius:10px;display:flex;align-items:center;justify-content:center;min-width:200px}
.live img,.live canvas{max-height:calc(100vh - 80px);max-width:min(60vw,700px);touch-action:none;user-select:none;-webkit-user-drag:none;cursor:crosshair;border-radius:10px}
.side{display:flex;flex-direction:column;gap:10px;width:240px}
.side .keys{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.side input{width:100%}
@media (max-width:700px){.viewer{flex-direction:column}.side{width:auto}.live img,.live canvas{max-width:100%}}
</style>
<header><div><small>ANDROID WORKSPACE</small><h1>Device farm</h1><p class="muted" id="summary">Looking for devices…</p></div>
<div class="actions"><button data-top="add">Add device</button><button class="secondary" data-top="refresh">Refresh</button></div></header>
<div class="toolbar">
<input type="search" id="search" placeholder="Search model, manufacturer, Android version or serial" aria-label="Search devices">
<select id="status" aria-label="Status filter"><option value="all">All devices</option><option value="device">Available</option><option value="attention">Needs attention</option><option value="remembered">Disconnected</option></select>
<button class="secondary small" data-top="select-all">Select all available</button>
<label><input type="checkbox" id="live" checked> Live screens</label>
</div>
<div class="selbar" id="selbar" hidden><b id="selcount"></b>
<button class="small" data-bulk="install">Install APK</button><button class="small" data-bulk="launch">Launch app</button>
<button class="small secondary" data-bulk="home">Home</button><button class="small secondary" data-bulk="back">Back</button><button class="small secondary" data-bulk="wake">Wake</button><button class="small secondary" data-bulk="sleep">Sleep</button>
<button class="small secondary" data-bulk="monitor">Monitor</button><button class="small secondary" data-bulk="logs">Logs</button><button class="small secondary" data-bulk="awake">Keep awake</button><button class="small secondary" data-bulk="managed" title="Managed phones only: stay awake while charging and postpone system updates for 30 days">Farm defaults</button>
<button class="small secondary" data-bulk="disconnect">Disconnect</button><button class="small secondary" data-bulk="reboot">Reboot</button>
<button class="small secondary" data-top="clear">Clear selection</button></div>
<p class="error" id="error"></p>
<div class="farm" id="farm"></div>
<div id="overlay" hidden><div class="viewer" role="dialog" aria-modal="true" aria-labelledby="vtitle">
<div class="live"><canvas id="livecanvas" hidden role="img" aria-label="Live device video. Click to tap, drag to swipe."></canvas><img id="liveimg" alt="Live device screen. Click to tap, drag to swipe." draggable="false"><span class="msg" id="livemsg">Connecting…</span></div>
<div class="side"><div><h2 id="vtitle"></h2><div class="sub" id="vsub"></div></div>
<small class="muted">Click to tap · drag to swipe. <span id="livemode"></span></small>
<div class="keys"><button class="secondary small" data-key="back">Back</button><button class="secondary small" data-key="home">Home</button><button class="secondary small" data-key="recents">Recents</button><button class="secondary small" data-key="wake">Wake</button><button class="secondary small" data-key="volumeUp">Volume +</button><button class="secondary small" data-key="volumeDown">Volume −</button><button class="secondary small" data-key="sleep">Sleep</button></div>
<form id="textform" class="row" style="gap:6px;flex-wrap:nowrap"><input id="text" placeholder="Type text on device" aria-label="Text to type"><button class="small">Send</button></form>
<button class="secondary" data-view="controls">Full controls</button><button class="secondary" data-view="logs">Logs</button><button data-view="close">Close</button>
</div></div></div>
<div id="add" hidden><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="addtitle">
<div class="row"><h2 id="addtitle" style="margin:0">Add a device</h2><button class="secondary small" data-add="close">Close</button></div>
<nav class="addtabs" role="tablist"><button role="tab" data-tab="qr" aria-selected="true">QR code</button><button role="tab" data-tab="code" aria-selected="false">Pairing code</button><button role="tab" data-tab="address" aria-selected="false">IP address</button><button role="tab" data-tab="usb" aria-selected="false">USB</button><button role="tab" data-tab="managed" aria-selected="false">Managed setup</button></nav>
<section data-pane="qr"><ol><li>Connect the phone to the same Wi-Fi as this computer.</li><li>On the phone (Android 11+), open <b>Developer options → Wireless debugging → Pair device with QR code</b>.</li><li>Scan this code.</li></ol>
<div class="qrbox"><img id="qrimg" alt="ADB pairing QR code" hidden></div><p class="st" id="st-qr" role="status"></p><button class="secondary small" data-add="qr-new">New QR code</button></section>
<section data-pane="code" hidden><ol><li>On the phone, open <b>Developer options → Wireless debugging → Pair device with pairing code</b>.</li><li>Enter the IP address &amp; port and the 6-digit code it shows.</li></ol>
<form id="codeform"><label>IP address &amp; port<input id="pairaddr" placeholder="192.168.1.10:37099" autocomplete="off"></label><label style="max-width:130px">Pairing code<input id="paircode" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="off"></label><button>Pair</button></form><p class="st" id="st-code" role="status"></p></section>
<section data-pane="address" hidden><p class="muted">For a phone that is already paired, or one switched to <code>adb tcpip</code> mode. Use the IP address &amp; port on the main <b>Wireless debugging</b> screen, not the pairing port. The port changes whenever Wireless debugging restarts.</p>
<form id="addrform"><label>IP address &amp; port<input id="addr" placeholder="192.168.1.10:41235" autocomplete="off"></label><button>Connect</button></form><div class="chips" id="recent"></div><p class="st" id="st-address" role="status"></p></section>
<section data-pane="usb" hidden><ol><li>On the phone, open <b>Settings → About phone</b> and tap <b>Build number</b> seven times to enable Developer options.</li><li>Turn on <b>Developer options → USB debugging</b>.</li><li>Plug the phone in and accept the <b>Allow USB debugging</b> prompt.</li></ol><p class="muted">USB devices appear in the farm automatically.</p></section>
<section data-pane="managed" hidden><p class="muted">Makes MoTA the device owner of a dedicated test phone, so it can install apps and grant permissions without a SIM, Mi account or USB security settings. <b>This needs a factory reset.</b></p>
<ol><li>Factory reset the phone. Don't add a Google or Mi account.</li><li>On the first setup screen, tap the same spot six times to open the QR scanner.</li><li>Scan the code. The phone downloads the MoTA helper from this computer and finishes setup with it.</li><li>Turn on Developer options and USB debugging, plug the phone in, and turn on MoTA Recorder in Accessibility settings.</li></ol>
<form id="provform"><label>This computer's address<select id="provaddr" aria-label="Network address the phone downloads from"></select></label><label>Wi-Fi name (optional)<input id="provssid" autocomplete="off" maxlength="32"></label><label>Wi-Fi password<input id="provpass" type="password" autocomplete="off" maxlength="63"></label><button>Create setup QR</button></form>
<p class="muted">The phone must reach this computer on the same network. macOS may ask whether VS Code can accept incoming connections. Anyone who scans the code can read a Wi-Fi password in it.</p>
<div class="qrbox"><img id="provimg" class="big" alt="Device-owner setup QR code" hidden></div><p class="st" id="st-managed" role="status"></p><button class="secondary small" data-add="prov-stop" id="provstop" hidden>Stop serving</button></section>
</div></div>
<div id="notice" hidden role="status"></div>`;

const script = `
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let devices=[],last='',focus=null,noticeTimer;const selected=new Set(),frames={},frameErrors={};
const label={device:'Available',unauthorized:'Unauthorized',offline:'Offline',remembered:'Disconnected'};
function matches(d){const q=$('search').value.trim().toLowerCase(),f=$('status').value;
 if(f==='device'&&d.state!=='device')return false;if(f==='remembered'&&d.state!=='remembered')return false;if(f==='attention'&&!['unauthorized','offline'].includes(d.state))return false;
 const i=d.info||{};return !q||[d.model,d.serial,d.kind,i.manufacturer,i.android&&'android '+i.android,i.managed&&'managed'].some(v=>v&&String(v).toLowerCase().includes(q));}
function card(d){const i=d.info||{},on=d.state==='device',st=focus===d.serial?'focus':d.state;
 const screen=on?(frames[d.serial]?'<img data-serial="'+esc(d.serial)+'" src="'+frames[d.serial]+'" alt="Screen of '+esc(d.model)+'">':'<span class="msg">'+esc(frameErrors[d.serial]||($('live').checked?'Loading screen…':'Live screens off'))+'</span>')
  :'<span class="msg">'+(d.state==='unauthorized'?'Unlock the device and accept the USB debugging prompt.':d.state==='offline'?'Device is offline. Reconnect it or restart ADB.':'Not connected. Wireless ports change, so reconnect or pair again.')+'</span>';
 const tags=[d.kind,i.managed?'Managed':'',i.battery!=null?i.battery+'%'+(i.charging?' ⚡':''):'',i.width?i.width+'×'+i.height:''].filter(Boolean).map(t=>'<span class="tag">'+esc(t)+'</span>').join('');
 const sub=[i.manufacturer,i.android&&'Android '+i.android,i.sdk&&'API '+i.sdk].filter(Boolean).join(' · ');
 const acts=on?'<button class="small" data-card="use">Use</button><button class="small secondary" data-card="controls">Controls</button><button class="small secondary" data-card="logs">Logs</button>'
  :(d.state==='remembered'||d.kind==='Wi-Fi')?'<button class="small" data-card="reconnect">Reconnect</button>':'';
 return '<article class="dev '+esc(d.state)+(selected.has(d.serial)?' selected':'')+'" data-serial="'+esc(d.serial)+'"><div class="screen"'+(on?' data-card="use" title="Open live view"':'')+'>'+screen
  +'<span class="status s-'+esc(st)+'"><i></i>'+(st==='focus'?'In use':label[d.state]||esc(d.state))+'</span>'
  +(on?'<input type="checkbox" class="pick" data-select aria-label="Select '+esc(d.model)+'"'+(selected.has(d.serial)?' checked':'')+'>':'')+'</div>'
  +'<div class="meta"><h3 title="'+esc(d.model)+'">'+esc(d.model)+'</h3>'+(sub?'<div class="sub">'+esc(sub)+'</div>':'')+'<div class="tags">'+tags+'</div><div class="serial" title="'+esc(d.serial)+'">'+esc(d.serial)+'</div><div class="cardacts">'+acts+'</div></div></article>';}
function render(){const shown=devices.filter(matches);
 const c={device:0,attention:0,remembered:0};for(const d of devices)c[d.state==='device'?'device':d.state==='remembered'?'remembered':'attention']++;
 $('summary').textContent=devices.length?c.device+' available · '+c.attention+' need attention · '+c.remembered+' disconnected':'No devices yet.';
 $('farm').innerHTML=shown.map(card).join('')||'<div class="empty">'+(devices.length?'No devices match the current filter.':'No devices yet. <button class=\"small\" data-top=\"add\">Add device</button>')+'</div>';
 $('selbar').hidden=!selected.size;$('selcount').textContent=selected.size+' selected';}
const serialOf=el=>el.closest('[data-serial]')?.dataset.serial;
const device=s=>devices.find(d=>d.serial===s);
function notice(text,error){const n=$('notice');n.textContent=text;n.className=error?'error':'';n.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>n.hidden=true,error?10000:4000);}
function openView(s){const d=device(s);if(!d)return;focus=s;const i=d.info||{};$('vtitle').textContent=d.model;$('vsub').textContent=[i.manufacturer,i.android&&'Android '+i.android,d.kind,d.serial].filter(Boolean).join(' · ');
 const img=$('liveimg');if(frames[s]){img.src=frames[s];img.hidden=false;$('livemsg').hidden=true;}else{img.hidden=true;$('livemsg').hidden=false;$('livemsg').textContent='Connecting…';}
 canvas.hidden=true;resetDecoder();decodeErrors=0;$('overlay').hidden=false;render();
 videoSupported().then(ok=>{if(focus!==s)return;$('livemode').textContent=ok?'Live video.':'Screenshot mode (this VS Code cannot decode H.264).';api.postMessage({action:'focus',serial:s,stream:ok});});}
function closeView(){if(!focus)return;focus=null;resetDecoder();$('overlay').hidden=true;api.postMessage({action:'focus',serial:null});render();}
document.addEventListener('click',e=>{const t=e.target;
 if(t.matches('[data-select]')){const s=serialOf(t);t.checked?selected.add(s):selected.delete(s);render();return;}
 const b=t.closest('[data-card],[data-top],[data-bulk],[data-key],[data-view],[data-tab],[data-add],[data-recent]');if(!b)return;
 if(b.dataset.top==='add'){openAdd();return;}
 if(b.dataset.tab){showTab(b.dataset.tab);return;}
 if(b.dataset.add==='close'){closeAdd();return;}
 if(b.dataset.add==='qr-new'){startQr();return;}
 if(b.dataset.add==='prov-stop'){api.postMessage({action:'provision-stop'});return;}
 if(b.dataset.recent){$('addr').value=b.dataset.recent;connectAddr();return;}
 if(b.dataset.card){const s=serialOf(b);if(b.dataset.card==='use')openView(s);else if(b.dataset.card==='reconnect')api.postMessage({action:'reconnect',serial:s});else api.postMessage({action:'bulk',command:b.dataset.card,serials:[s]});}
 else if(b.dataset.top==='refresh')api.postMessage({action:'refresh'});
 else if(b.dataset.top==='select-all'){devices.filter(d=>d.state==='device'&&matches(d)).forEach(d=>selected.add(d.serial));render();}
 else if(b.dataset.top==='clear'){selected.clear();render();}
 else if(b.dataset.bulk)api.postMessage({action:'bulk',command:b.dataset.bulk,serials:[...selected]});
 else if(b.dataset.key)api.postMessage({action:'key',serial:focus,key:b.dataset.key});
 else if(b.dataset.view==='close')closeView();
 else if(b.dataset.view)api.postMessage({action:'bulk',command:b.dataset.view,serials:[focus]});});
$('overlay').addEventListener('click',e=>{if(e.target===$('overlay'))closeView();});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!$('add').hidden)closeAdd();else closeView();});
let tab='qr';
function setStatus(t,state,text){const el=$('st-'+t);if(el){el.className='st '+state;el.textContent=text;}}
function startQr(){$('qrimg').hidden=true;setStatus('qr','working','Generating code…');api.postMessage({action:'qr-start'});}
function showTab(t){if(tab==='qr'&&t!=='qr')api.postMessage({action:'qr-stop'});tab=t;
 document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===t)));
 document.querySelectorAll('[data-pane]').forEach(p=>p.hidden=p.dataset.pane!==t);
 if(t==='qr')startQr();if(t==='managed'){api.postMessage({action:'provision-addresses'});$('provssid').focus();}if(t==='address'){api.postMessage({action:'addresses'});$('addr').focus();}if(t==='code')$('pairaddr').focus();}
function openAdd(){$('add').hidden=false;showTab('qr');}
function closeAdd(){$('add').hidden=true;api.postMessage({action:'qr-stop'});}
function connectAddr(){const a=$('addr').value.trim();if(a){setStatus('address','working','Connecting…');api.postMessage({action:'connect-address',address:a});}}
$('add').addEventListener('click',e=>{if(e.target===$('add'))closeAdd();});
$('addrform').addEventListener('submit',e=>{e.preventDefault();connectAddr();});
$('codeform').addEventListener('submit',e=>{e.preventDefault();const code=$('paircode').value.trim();if(!/^\\d{6}$/.test(code)){setStatus('code','error','Enter the 6-digit pairing code.');return;}setStatus('code','working','Pairing…');api.postMessage({action:'pair-code',address:$('pairaddr').value.trim(),code});});
$('provform').addEventListener('submit',e=>{e.preventDefault();$('provimg').hidden=true;setStatus('managed','working','Starting…');api.postMessage({action:'provision-start',address:$('provaddr').value,ssid:$('provssid').value,password:$('provpass').value});});
$('search').addEventListener('input',render);$('status').addEventListener('change',render);
$('live').addEventListener('change',e=>{api.postMessage({action:'live',on:e.target.checked});render();});
$('textform').addEventListener('submit',e=>{e.preventDefault();const v=$('text').value;if(v&&focus){api.postMessage({action:'text',serial:focus,text:v});$('text').value='';}});
let down=null;const img=$('liveimg'),canvas=$('livecanvas'),ctx=canvas.getContext('2d');
// --- live H.264 video (WebCodecs); screenshots are the fallback
let decoder=null,decoderCodec='',waitKey=true,timestamp=0,decodeErrors=0,supported;
function videoSupported(){if(supported!==undefined)return Promise.resolve(supported);if(typeof VideoDecoder!=='function')return Promise.resolve(supported=false);
 return VideoDecoder.isConfigSupported({codec:'avc1.42e01f',optimizeForLatency:true}).then(r=>supported=!!r.supported,()=>supported=false);}
function resetDecoder(){try{if(decoder&&decoder.state!=='closed')decoder.close();}catch{}decoder=null;decoderCodec='';waitKey=true;}
function drawFrame(frame){if(!focus){frame.close();return;}
 if(canvas.width!==frame.displayWidth||canvas.height!==frame.displayHeight){canvas.width=frame.displayWidth;canvas.height=frame.displayHeight;}
 ctx.drawImage(frame,0,0);frame.close();if(canvas.hidden){canvas.hidden=false;img.hidden=true;$('livemsg').hidden=true;}}
function decoderFailed(e){resetDecoder();if(++decodeErrors>=3){api.postMessage({action:'video-unsupported'});$('livemode').textContent='Screenshot mode (video decoding failed: '+(e&&e.message||e)+').';canvas.hidden=true;}else api.postMessage({action:'video-error'});}
function onVideo(m){if(m.serial!==focus||decodeErrors>=3)return;
 if(m.key&&m.codec&&(!decoder||decoderCodec!==m.codec)){resetDecoder();
  try{decoder=new VideoDecoder({output:drawFrame,error:decoderFailed});decoder.configure({codec:m.codec,optimizeForLatency:true});decoderCodec=m.codec;}catch(e){decoderFailed(e);return;}}
 if(!decoder||(waitKey&&!m.key))return;waitKey=false;
 try{decoder.decode(new EncodedVideoChunk({type:m.key?'key':'delta',timestamp:(timestamp++)*33333,data:bytes(m.data)}));}catch(e){decoderFailed(e);}}
function bytes(d){return d instanceof Uint8Array?d:d instanceof ArrayBuffer?new Uint8Array(d):ArrayBuffer.isView(d)?new Uint8Array(d.buffer,d.byteOffset,d.byteLength):new Uint8Array(Array.isArray(d)?d:Object.values(d||{}));}
// --- pointer input on whichever surface is showing
function surface(){if(!canvas.hidden&&canvas.width){const i=(device(focus)||{}).info||{};let w=i.width||canvas.width,h=i.height||canvas.height;
  if((canvas.width>canvas.height)!==(w>h))[w,h]=[h,w];return{el:canvas,w,h};}
 return img.naturalWidth?{el:img,w:img.naturalWidth,h:img.naturalHeight}:null;}
const point=(e,s)=>{const r=s.el.getBoundingClientRect();return{x:Math.round((e.clientX-r.left)*s.w/r.width),y:Math.round((e.clientY-r.top)*s.h/r.height),cx:e.clientX,cy:e.clientY};};
for(const el of [img,canvas]){
 el.style.touchAction='none';el.style.cursor='crosshair';
 el.addEventListener('pointerdown',e=>{const s=surface();if(!s||s.el!==el)return;el.setPointerCapture(e.pointerId);down={...point(e,s),t:performance.now(),s};e.preventDefault();});
 el.addEventListener('pointerup',e=>{if(!down||!focus)return;const s=down.s,p=point(e,s),clamp=(v,m)=>Math.max(0,Math.min(m-1,v));
  const x=clamp(down.x,s.w),y=clamp(down.y,s.h),x2=clamp(p.x,s.w),y2=clamp(p.y,s.h);
  if(Math.hypot(p.cx-down.cx,p.cy-down.cy)<8)api.postMessage({action:'gesture',serial:focus,type:'tap',x,y});
  else api.postMessage({action:'gesture',serial:focus,type:'swipe',x,y,x2,y2,duration:performance.now()-down.t});down=null;});
 el.addEventListener('pointercancel',()=>{down=null;});}
window.addEventListener('message',e=>{const m=e.data;
 if(m.kind==='devices'){$('error').textContent=m.error?'ADB unavailable: '+m.error:'';const json=JSON.stringify(m.devices);
  devices=m.devices;for(const s of [...selected])if(!devices.some(d=>d.serial===s&&d.state==='device'))selected.delete(s);if(json!==last){last=json;render();}}
 else if(m.kind==='frame'){frames[m.serial]=m.src;delete frameErrors[m.serial];
  const el=document.querySelector('.dev[data-serial="'+CSS.escape(m.serial)+'"] .screen');
  if(el){const i=el.querySelector('img');if(i)i.src=m.src;else{const msg=el.querySelector('.msg');if(msg)msg.outerHTML='<img data-serial="'+esc(m.serial)+'" src="'+m.src+'" alt="Screen">';}}
  if(m.serial===focus&&canvas.hidden){img.src=m.src;img.hidden=false;$('livemsg').hidden=true;}}
 else if(m.kind==='video')onVideo(m);
 else if(m.kind==='video-reset'){if(m.serial===focus)waitKey=true;}
 else if(m.kind==='video-failed'){if(m.serial===focus){resetDecoder();canvas.hidden=true;$('livemode').textContent='Screenshot mode (video stream unavailable).';notice('Live video stopped: '+m.text,true);}}
 else if(m.kind==='frame-error'){frameErrors[m.serial]=m.text;if(m.serial===focus&&!frames[m.serial]){$('livemsg').textContent=m.text;}if(!frames[m.serial])render();}
 else if(m.kind==='focus-lost'){notice('The device disconnected.',true);closeView();}
 else if(m.kind==='notice')notice(m.text,m.error);
 else if(m.kind==='qr'){$('qrimg').src=m.src;$('qrimg').hidden=false;}
 else if(m.kind==='provision-qr'){$('provimg').hidden=!m.src;if(m.src)$('provimg').src=m.src;$('provstop').hidden=!m.src;}
 else if(m.kind==='provision-addresses'){const sel=$('provaddr'),prev=sel.value;sel.innerHTML=m.list.map(a=>'<option value="'+esc(a.address)+'">'+esc(a.address+' ('+a.name+')')+'</option>').join('');if(m.list.some(a=>a.address===prev))sel.value=prev;if(!m.list.length)setStatus('managed','error','No local network address found. Connect this computer to the same Wi-Fi as the phone.');$('provstop').hidden=!m.serving;}
 else if(m.kind==='add-status'){setStatus(m.tab,m.state,m.text);if(m.state==='ok'&&m.tab==='qr')$('qrimg').hidden=true;}
 else if(m.kind==='addresses')$('recent').innerHTML=m.list.length?'<small class="muted" style="width:100%">Recent</small>'+m.list.map(a=>'<button class="secondary small" data-recent="'+esc(a)+'">'+esc(a)+'</button>').join(''):'';});
api.postMessage({action:'ready'});
`;
