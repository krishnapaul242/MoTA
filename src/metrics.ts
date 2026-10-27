export function parseMetrics(battery: string, memory: string, cpu: string, app = '', frames = '') {
  const num = (text: string, pattern: RegExp) => { const m = text.match(pattern); return m ? Number(m[1].replace(/,/g, '')) : null; };
  const level = num(battery, /\blevel:\s*(\d+)/), scale = num(battery, /\bscale:\s*(\d+)/);
  const total = num(memory, /MemTotal:\s*(\d+)/), available = num(memory, /MemAvailable:\s*(\d+)/);
  const pss = num(app, /TOTAL PSS:\s*([\d,]+)/) ?? num(app, /^\s*TOTAL\s+(\d+)/m);
  return {
    battery: level !== null && scale ? level / scale * 100 : null,
    temperature: (() => { const t = num(battery, /temperature:\s*(-?\d+)/); return t === null ? null : t / 10; })(),
    charging: /(?:AC|USB|Wireless|Dock) powered:\s*true/i.test(battery),
    memory: total && available !== null ? (total - available) / total * 100 : null,
    usedGb: total && available !== null ? (total - available) / 1048576 : null,
    totalGb: total ? total / 1048576 : null,
    cpu: num(cpu, /([\d.]+)%\s+TOTAL/),
    appMb: pss === null ? null : pss / 1024,
    frames: num(frames, /Total frames rendered:\s*(\d+)/),
    jank: num(frames, /Janky frames:\s*\d+\s*\(([\d.]+)%\)/)
  };
}
export interface InstallOptions { replace: boolean; test: boolean; downgrade: boolean; grant: boolean; user: string; timeout: number }
export function installArgs(serial: string, apk: string, o: InstallOptions) {
  if (!/^(?:|current|all|\d+)$/.test(o.user)) throw new Error('User must be current, all, or a numeric user ID.');
  if (!Number.isFinite(o.timeout) || o.timeout < 10 || o.timeout > 600) throw new Error('Timeout must be between 10 and 600 seconds.');
  return ['-s', serial, 'install', ...(o.replace ? ['-r'] : []), ...(o.test ? ['-t'] : []), ...(o.downgrade ? ['-d'] : []), ...(o.grant ? ['-g'] : []), ...(o.user ? ['--user', o.user] : []), apk];
}
export function recoveryHint(error: string) {
  if (/VERSION_DOWNGRADE/i.test(error)) return 'The installed version is newer. Enable Allow downgrade if this is a debuggable app, then retry.';
  if (/UPDATE_INCOMPATIBLE|INCONSISTENT_CERTIFICATES/i.test(error)) return 'The installed app has a different signing key. Use an APK signed with the same key, or choose Uninstall conflicting app & reinstall. Clean replacement deletes local app data.';
  if (/ALREADY_EXISTS/i.test(error)) return 'An app with this package is already installed. Choose Replace existing app & retry to keep its data, or clean reinstall to remove it first.';
  if (/TEST_ONLY/i.test(error)) return 'Enable Allow test APK, then retry.';
  if (/INSUFFICIENT_STORAGE/i.test(error)) return 'Free storage on the device, then retry.';
  if (/unauthorized/i.test(error)) return 'Unlock the device and accept the USB debugging authorization prompt.';
  if (/offline|no devices|not found|failed to connect|cannot connect/i.test(error)) return 'Check USB or Wireless debugging, reconnect the device, then retry. Wireless ports can change.';
  return 'Check the device connection and options. You can retry, reconnect, or open ADB settings.';
}
