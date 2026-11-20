import type * as VSCode from 'vscode';
import * as QRCode from 'qrcode';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Adb, Device, mergeKnownDevices, parseServices, validAddress } from './adb';
import { captureScreenshot, deepLinkArgs, shellLiteral } from './deviceControl';
import { devicePresets } from './devicePage';
import { validPackage } from './apk';
import { launchApp } from './deviceActions';
import { farmHtml } from './webview/farmView';
import { aiHost, AiLink, aiPoster, isAiMessage } from './webview/aiLink';
import { streamSize } from './h264';
import { liveEngine, LiveMirror, liveTouch } from './liveMirror';
import { HelperClient, HELPER_PACKAGE } from './helperClient';
import { gestureParams, InputRouter } from './helperInput';
import { AdbConsole } from './adbConsole';
import { aiHost as sharedHost } from './ai/host';
import { ago, type DeviceUse } from './leases';
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

/** What the farm shows about who uses a phone, or undefined when it is free. */
export function farmUse(use: DeviceUse | undefined, now: number): { state: 'active' | 'idle' | 'busy' | 'free'; text: string; title: string } | undefined {
  const r = farmUseBase(use, now);
  if (!r || !use) return r;
  const extra = [use.queue.length ? `${use.queue.length} waiting: ${use.queue.map(e => e.holder.label).join(', ')}` : '', use.takeover ? `${use.takeover.requester.label} asked you to hand it over` : ''].filter(Boolean);
  return extra.length ? { ...r, text: r.text + (use.takeover ? ' · takeover asked' : ` · ${use.queue.length} waiting`), title: `${r.title}\n${extra.join('\n')}` } : r;
}
function farmUseBase(use: DeviceUse | undefined, now: number): { state: 'active' | 'idle' | 'busy' | 'free'; text: string; title: string } | undefined {
  if (!use) return undefined;
  if (use.state === 'free') return use.queue.length ? { state: 'free', text: `Kept for ${use.queue[0].holder.label}`, title: `${use.queue[0].holder.label} is first in line for this phone.` } : undefined;
  if (use.state === 'busy') { const o = use.ops[0]; return { state: 'busy', text: 'Busy', title: `${o.what}${o.holderLabel ? ` for ${o.holderLabel}` : ''}, for ${ago(now - o.startedAt)}` }; }
  const who = use.holder!.label, since = ago(now - (use.lastActivity ?? now));
  return use.state === 'active'
    ? { state: 'active', text: who, title: `In use by ${who}; last action ${since} ago. Free to others after ${use.idleSeconds} s without activity.` }
    : { state: 'idle', text: `${who} · idle ${since}`, title: `Last used by ${who} ${since} ago. Other sessions may take it.` };
}

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
    private mirror?: LiveMirror;
    private live = true;
    private closed = false;
    private listing = false;
    private lastList = 0;
    private timer: ReturnType<typeof setInterval>;
    private qrToken = 0;
    private input = new InputRouter(adb);
    private provisioning?: HelperDownloadServer;
    private console = new AdbConsole(adb, m => this.post(m),
      async (message, detail, action) => await vscode.window.showWarningMessage(message, { modal: true, detail }, action) === action,
      () => this.afterChange());
    private ai: AiLink;

    constructor() {
      this.panel = vscode.window.createWebviewPanel('mota.farm', 'MoTA · Device farm', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.webview.html = farmHtml(this.panel.webview.cspSource);
      this.ai = aiHost(context, adb).connect(aiPoster(vscode, this.panel, () => this.closed));
      this.panel.webview.onDidReceiveMessage(m => { void this.message(m).catch(e => this.notice(e instanceof Error ? e.message : String(e), true)); });
      this.timer = setInterval(() => this.tick(), 400);
    }
    dispose() { this.closed = true; this.qrToken++; this.provisioning?.close('closed'); void this.input.dispose(); this.console.dispose(); this.ai.dispose(); this.stopMirror(); clearInterval(this.timer); }
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
        const uses = await sharedHost(context, adb).leases?.use(found.map(d => d.serial)).catch(() => undefined);
        this.post({ kind: 'devices', devices: all.map(d => ({ ...d, kind: connectionKind(d.serial), info: this.info.get(d.serial)?.value, use: uses && farmUse(uses.get(d.serial), now) })) });
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
      if (this.closed) return;
      if (isAiMessage(m)) return this.ai.handle(m);
      if (!m || typeof m.action !== 'string') return;
      if (m.action.startsWith('console-')) return this.console.message(m, [...this.devices.values()].filter(d => d.state === 'device'));
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
        case 'touch': { const t = liveTouch(m); if (t && m.serial === this.focus) this.mirror?.touch(t.type, t.x, t.y, t.id); return; }
        case 'scroll': { const t = liveTouch({ ...m, type: 'move' }); if (t && m.serial === this.focus) this.mirror?.scroll(t.x, t.y, Number(m.h) || 0, Number(m.v) || 0); return; }
        case 'gesture': case 'key': case 'text': {
          const d = this.online(m.serial); if (!d) throw new Error('The device is no longer available.');
          if (d.serial === this.focus && m.action === 'key' && KEYS.includes(m.key) && this.mirror?.key(m.key)) return;
          if (d.serial === this.focus && m.action === 'text' && typeof m.text === 'string' && m.text && m.text.length <= 4096 && this.mirror?.text(m.text)) return;
          if (m.action === 'gesture') { const args = gestureArgs(m); await this.input.send(d.serial, args, gestureParams(args)); }
          else if (m.action === 'key') { if (!KEYS.includes(m.key)) throw new Error('Unknown key.'); await this.input.send(d.serial, devicePresets[m.key].args, { type: 'key', key: m.key }); }
          else { if (typeof m.text !== 'string' || !m.text || m.text.length > 4096) throw new Error('Enter up to 4096 characters.'); await this.input.send(d.serial, ['input', 'text', m.text.replace(/ /g, '%s')], { type: 'text', text: m.text }); }
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
        case 'open-tests': await vscode.commands.executeCommand('mota.tests'); return;
        case 'copy': await vscode.env.clipboard.writeText(String(m.text ?? '').slice(0, 500)); this.notice('Copied to the clipboard.'); return;
        case 'packages': {
          const d = this.online(m.serial); if (!d) return;
          try {
            const list = (await adb.shell(d.serial, ['pm', 'list', 'packages', '-3'])).split(/\r?\n/).map(l => l.trim().replace(/^package:/, '')).filter(validPackage).sort();
            this.post({ kind: 'packages', serial: d.serial, list, last: context.workspaceState.get('launchPackage', '') });
          } catch (e) { this.post({ kind: 'packages', serial: d.serial, list: [], error: `Couldn't list apps: ${errorText(e)}` }); }
          return;
        }
        case 'app-launch': case 'app-stop': {
          const d = this.online(m.serial); if (!d) throw new Error('The device is no longer available.');
          const pkg = String(m.package ?? ''); if (!validPackage(pkg)) throw new Error('Choose an installed app first.');
          await context.workspaceState.update('launchPackage', pkg);
          if (m.action === 'app-launch') this.notice(await launchApp(adb, d.serial, pkg));
          else { await shellLiteral(adb, d.serial, ['am', 'force-stop', pkg]); this.notice(`${pkg} stopped.`); }
          this.lastFrame.set(d.serial, 0); return;
        }
        case 'deep-link': {
          const d = this.online(m.serial); if (!d) throw new Error('The device is no longer available.');
          const pkg = typeof m.package === 'string' && validPackage(m.package) ? m.package : '';
          const out = await shellLiteral(adb, d.serial, deepLinkArgs(String(m.uri ?? ''), pkg));
          if (/Error:|Exception|unable to resolve|Status:\s*(?!ok\b)\w+/i.test(out)) throw new Error(out.split(/\r?\n/).find(l => /Error|Exception|unable|Status/i.test(l)) || out);
          this.notice('Deep link opened.'); return;
        }
      }
    }
    private startMirror(d: Device) {
      const info = this.info.get(d.serial)?.value;
      const size = info?.width && info.height ? streamSize(info.width, info.height) : undefined;
      const serial = d.serial;
      const mirror = this.mirror = new LiveMirror(adb, serial, { serverPath: context.asAbsolutePath('resources/scrcpy-server-v5.0.1'), size, bitRate: connectionKind(serial) === 'USB' ? 8_000_000 : 4_000_000, engine: liveEngine(vscode) }, {
        onUnit: unit => { if (this.mirror === mirror) this.post({ kind: 'video', serial, ...unit }); },
        onReset: session => { if (this.mirror === mirror) this.post({ kind: 'video-reset', serial, session }); },
        onMode: (engine, note) => { if (this.mirror === mirror) this.post({ kind: 'live-mode', serial, engine, note }); },
        onFail: text => { if (this.mirror !== mirror) return; this.mirror = undefined; this.lastFrame.set(serial, 0); this.post({ kind: 'video-failed', serial, text }); },
      });
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
      const delegated: Record<string, string> = { tests: 'mota.tests', install: 'mota.install', launch: 'mota.launch', monitor: 'mota.stats', logs: 'mota.logcat', awake: 'mota.awake', controls: 'mota.device' };
      if (delegated[command]) { await vscode.commands.executeCommand(delegated[command], { targets }); return; }
      let run: (d: Device) => Promise<unknown>;
      let label: string;
      if (KEYS.includes(command)) { label = devicePresets[command].label; run = d => this.input.send(d.serial, devicePresets[command].args, { type: 'key', key: command }); }
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

