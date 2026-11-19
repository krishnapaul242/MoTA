import { readFile } from 'node:fs/promises';
import { Adb } from './adb';
import { shellLiteral } from './deviceControl';
import { HelperClient, HELPER_PACKAGE, HELPER_VERSION } from './helperClient';
import { parseDeviceOwner } from './provisioning';

const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Xiaomi without "USB debugging (Security settings)" rejects `adb shell input` with this. */
export function isInputBlocked(error: unknown) { return /INJECT_EVENTS|Injecting to another application/i.test(errorText(error)); }

export type HelperInputParams =
  | { type: 'tap'; x: number; y: number }
  | { type: 'swipe'; x: number; y: number; x2: number; y2: number; duration: number }
  | { type: 'key'; key: string }
  | { type: 'text'; text: string };

/** Helper parameters for validated `input tap|swipe ...` arguments. */
export function gestureParams(args: string[]): HelperInputParams {
  const n = args.slice(2).map(Number);
  return args[1] === 'tap' ? { type: 'tap', x: n[0], y: n[1] } : { type: 'swipe', x: n[0], y: n[1], x2: n[2], y2: n[3], duration: n[4] ?? 300 };
}

/** Explains why the helper could not take over input, with what to do on the phone. */
export function helperInputError(error: unknown) {
  const text = errorText(error);
  const why = 'This phone blocks ADB input, so MoTA sends it through the recorder helper instead.';
  if (/Accessibility settings/i.test(text)) return `${why} Turn on MoTA Recorder in the phone's Accessibility settings.`;
  if (/bridge unavailable|version mismatch/i.test(text)) return `${why} Run MoTA: Set Up Recorder Helper for this phone to install or update the helper (${HELPER_VERSION}).`;
  return `${why} ${text}`;
}

/** Sends input with `adb shell input`, and through the helper's accessibility service on phones that block it. */
export class InputRouter {
  private clients = new Map<string, Promise<HelperClient>>();
  private viaHelper = new Set<string>();
  constructor(private adb: Adb) {}
  usesHelper(serial: string) { return this.viaHelper.has(serial); }
  async send(serial: string, adbArgs: string[], params: HelperInputParams) {
    if (!this.viaHelper.has(serial)) {
      try { return await shellLiteral(this.adb, serial, adbArgs); }
      catch (e) { if (!isInputBlocked(e)) throw e; this.viaHelper.add(serial); }
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const client = await this.client(serial);
        await client.request('input', params);
        return '';
      } catch (e) {
        await this.drop(serial);
        // A cached connection goes stale when the helper restarts; reconnect once.
        if (attempt === 0 && /closed|disconnected|not connected/i.test(errorText(e))) continue;
        throw new Error(helperInputError(e));
      }
    }
  }
  private client(serial: string) {
    let pending = this.clients.get(serial);
    if (!pending) {
      const client = new HelperClient(this.adb, serial);
      pending = client.connect().then(() => client);
      this.clients.set(serial, pending);
    }
    return pending;
  }
  private async drop(serial: string) {
    const pending = this.clients.get(serial); this.clients.delete(serial);
    await pending?.then(c => c.dispose(), () => {});
  }
  async dispose() { await Promise.all([...this.clients.keys()].map(s => this.drop(s))); }
}

/** Installs the bundled helper. Where `adb install` is blocked and the helper is device owner, the installed helper updates itself. */
export async function installHelper(adb: Adb, serial: string, apk: string): Promise<'adb' | 'device-owner'> {
  let failure: string;
  try {
    const result = await adb.run(['-s', serial, 'install', '--no-incremental', '-r', apk], 180000);
    if (/\bSuccess\b/.test(result)) return 'adb';
    failure = result || 'Helper installation was not confirmed.';
  } catch (e) { failure = errorText(e); }
  const owner = parseDeviceOwner(await adb.shell(serial, ['dumpsys device_policy | grep -A3 "Device Owner";true']).catch(() => ''));
  if (owner !== HELPER_PACKAGE) throw new Error(failure);
  const client = new HelperClient(adb, serial);
  try {
    await client.connect({ anyVersion: true });
    const bytes = await readFile(apk), chunk = 2 * 1024 * 1024;
    const { session } = await client.request<{ session: number }>('adminInstallBegin', { size: bytes.length, packageName: HELPER_PACKAGE });
    for (let offset = 0; offset < bytes.length; offset += chunk)
      await client.request('adminInstallWrite', { session, offset, data: bytes.subarray(offset, offset + chunk).toString('base64') });
    await client.request('adminInstallCommit', { session });
  } catch (e) {
    throw new Error(`adb install failed (${failure}) and the device-owner update failed: ${errorText(e)}`);
  } finally { await client.dispose(); }
  // Committing restarts the helper, so confirm by the installed version rather than asking the old process.
  for (let i = 0; i < 60; i++) {
    const version = (await adb.shell(serial, ['dumpsys', 'package', HELPER_PACKAGE]).catch(() => '')).match(/versionName=(\S+)/)?.[1];
    if (version === HELPER_VERSION) return 'device-owner';
    await sleep(1000);
  }
  throw new Error(`The helper did not finish updating itself to ${HELPER_VERSION}. Check the phone and try again.`);
}
