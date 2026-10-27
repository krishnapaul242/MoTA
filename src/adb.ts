import { execFile, spawn } from 'node:child_process';
export interface Device { serial: string; state: string; model: string }
export function parseDevices(output: string): Device[] {
  return output.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('List ') && !l.startsWith('*')).flatMap(l => {
    const [serial, state, ...details] = l.trim().split(/\s+/);
    return serial && state ? [{ serial, state, model: details.find(d => d.startsWith('model:'))?.slice(6).replace(/_/g, ' ') || serial }] : [];
  });
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
  async devices() { return parseDevices(await this.run(['devices', '-l'])); }
}
export function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
