import { execFile, spawn } from 'node:child_process';
export interface Device { serial: string; state: string; model: string }
export function parseDevices(output: string): Device[] {
  return output.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('List ') && !l.startsWith('*')).flatMap(l => {
    const [serial, state, ...details] = l.trim().split(/\s+/);
    return serial && state ? [{ serial, state, model: details.find(d => d.startsWith('model:'))?.slice(6).replace(/_/g, ' ') || serial }] : [];
  });
}
/** Merge live devices into history. Wireless debugging gives one phone a new serial (IP:port or mDNS name) on each connection, so history keeps one entry per model, most recent first, and offline entries without a known model are not remembered. */
export function mergeKnownDevices(found: Device[], previous: Device[], limit = 30): Device[] {
  const key = (d: Device) => d.model === d.serial ? `serial:${d.serial}` : `model:${d.model}`;
  const seen = new Set(found.flatMap(d => [key(d), `serial:${d.serial}`]));
  const remembered = previous.filter(d => {
    if (d.model === d.serial || seen.has(key(d)) || seen.has(`serial:${d.serial}`)) return false;
    seen.add(key(d)); seen.add(`serial:${d.serial}`);
    return true;
  });
  return [...found, ...remembered].slice(0, Math.max(limit, found.length));
}
export function parseServices(output: string) {
  return output.split(/\r?\n/).flatMap(l => {
    const [name, type, address] = l.trim().split(/\s+/);
    return type?.startsWith('_adb') && address ? [{ name, type, address }] : [];
  });
}
export function validAddress(value: string): boolean {
  return /^(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\]):\d{1,5}$/.test(value) && +value.slice(value.lastIndexOf(':') + 1) > 0 && +value.slice(value.lastIndexOf(':') + 1) <= 65535;
}
export class Adb {
  constructor(private executable: () => string) {}
  run(args: string[], timeout = 15000): Promise<string> {
    return new Promise((resolve, reject) => execFile(this.executable(), args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || stdout.trim() || err.message)); else resolve(stdout.trim());
    }));
  }
  shell(serial: string, args: string[]) { return this.run(['-s', serial, 'shell', ...args]); }
  stream(args: string[]) { return spawn(this.executable(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  terminalOptions(serial:string){return {shellPath:this.executable(),shellArgs:['-s',serial,'shell']};}
  async devices() { return parseDevices(await this.run(['devices', '-l'])); }
}
export function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
