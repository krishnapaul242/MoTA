import { createServer, Server } from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { networkInterfaces, NetworkInterfaceInfo } from 'node:os';

/** Device-owner QR provisioning: a fresh phone scans the QR during setup, downloads the helper from this computer and makes it device owner. */

export const OWNER_COMPONENT = 'dev.mota.recorder/dev.mota.recorder.DeviceOwnerReceiver';
const E = 'android.app.extra.';

export interface HelperMetadata { version: string; sha256: string; signatureChecksum: string }

/** Reads resources/mota-recorder.json, written by helper-apk/build.sh next to the bundled APK. */
export function readHelperMetadata(path: string): HelperMetadata {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof value.version !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256) || !/^[A-Za-z0-9_-]{43}$/.test(value.signatureChecksum)) throw new Error('Helper metadata is missing or invalid. Rebuild the helper.');
  return value;
}

export interface WifiConfig { ssid: string; password?: string }

/** Android Enterprise QR payload. The checksum pins the helper's signing certificate, so the phone rejects any other APK at that URL. */
export function provisioningPayload(apkUrl: string, signatureChecksum: string, wifi?: WifiConfig): string {
  if (!/^https?:\/\/[^\s/]+\/\S+$/.test(apkUrl)) throw new Error('Invalid helper download address.');
  if (!/^[A-Za-z0-9_-]{43}$/.test(signatureChecksum)) throw new Error('Invalid helper signature checksum.');
  const payload: Record<string, unknown> = {
    [E + 'PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME']: OWNER_COMPONENT,
    [E + 'PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION']: apkUrl,
    [E + 'PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM']: signatureChecksum,
    // Fully managed setup otherwise disables most preinstalled apps.
    [E + 'PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED']: true,
  };
  if (wifi) {
    if (!wifi.ssid || wifi.ssid.length > 32) throw new Error('Wi-Fi name must be 1 to 32 characters.');
    if (wifi.password !== undefined && (wifi.password.length < 8 || wifi.password.length > 63)) throw new Error('WPA Wi-Fi passwords are 8 to 63 characters.');
    payload[E + 'PROVISIONING_WIFI_SSID'] = wifi.ssid;
    payload[E + 'PROVISIONING_WIFI_SECURITY_TYPE'] = wifi.password ? 'WPA' : 'NONE';
    if (wifi.password) payload[E + 'PROVISIONING_WIFI_PASSWORD'] = wifi.password;
  }
  return JSON.stringify(payload);
}

/** IPv4 addresses a phone on the same LAN can reach, private ranges first. */
export function lanAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): { name: string; address: string }[] {
  const priv = (a: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  return Object.entries(interfaces).flatMap(([name, list]) => (list || [])
    .filter(i => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map(i => ({ name, address: i.address })))
    .sort((a, b) => Number(priv(b.address)) - Number(priv(a.address)));
}

/** Serves one APK at an unguessable path on one interface. Everything else is 404. */
export class HelperDownloadServer {
  readonly url: Promise<string>;
  private server: Server;
  private timer: ReturnType<typeof setTimeout>;
  readonly path = `/${randomBytes(16).toString('hex')}/mota-recorder.apk`;
  closed = false;
  constructor(private apk: string, host: string, onDownload: (from: string) => void, private onClose: (reason: string) => void, lifetimeMs = 15 * 60 * 1000) {
    const size = statSync(apk).size;
    this.server = createServer((req, res) => {
      if (req.url !== this.path) { res.writeHead(404).end(); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': size, 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') { res.end(); return; }
      res.on('finish', () => onDownload(req.socket.remoteAddress?.replace(/^::ffff:/, '') || 'unknown'));
      createReadStream(this.apk).on('error', () => res.destroy()).pipe(res);
    });
    this.timer = setTimeout(() => this.close('expired'), lifetimeMs);
    this.server.on('close', () => { clearTimeout(this.timer); });
    this.url = new Promise((resolve, reject) => {
      this.server.once('error', e => { this.close('error'); reject(e); });
      this.server.listen(0, host, () => {
        const port = (this.server.address() as { port: number }).port;
        resolve(`http://${host}:${port}${this.path}`);
      });
    });
  }
  close(reason = 'stopped') {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer);
    this.server.close(); this.server.closeAllConnections?.();
    this.onClose(reason);
  }
}

/** Device owner shown by `dumpsys device_policy` (works on Android 10+, unlike `dpm list-owners`). */
export function parseDeviceOwner(dumpsys: string): string | undefined {
  const section = dumpsys.split(/\r?\n/).findIndex(l => /^\s*Device Owner:?\s*$/.test(l) || /^\s*Device Owner\b/.test(l));
  if (section < 0) return undefined;
  for (const line of dumpsys.split(/\r?\n/).slice(section, section + 6)) {
    const m = line.match(/admin=ComponentInfo\{([\w.]+)\/[\w.$]+\}/);
    if (m) return m[1];
  }
  return undefined;
}
