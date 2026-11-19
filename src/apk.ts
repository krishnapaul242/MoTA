import { execFile } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
export function validPackage(value: string) { return /^[A-Za-z]\w*(?:\.[A-Za-z]\w*)+$/.test(value); }
export function packageFromBadging(output: string): string | undefined {
  const value = output.match(/^package:\s+name='([^']+)'/m)?.[1];
  return value && validPackage(value) ? value : undefined;
}
export function packageFromFailure(output: string): string | undefined {
  const value = output.match(/(?:Existing package|Package)\s+([A-Za-z]\w*(?:\.[A-Za-z]\w*)+)\b/i)?.[1];
  return value && validPackage(value) ? value : undefined;
}
export function isInstallConflict(error: string) { return /INSTALL_(?:FAILED_(?:UPDATE_INCOMPATIBLE|ALREADY_EXISTS|VERSION_DOWNGRADE|SHARED_USER_INCOMPATIBLE)|PARSE_FAILED_INCONSISTENT_CERTIFICATES)/i.test(error); }
export async function detectApkPackage(apk: string, roots: string[]): Promise<string | undefined> {
  for (const root of [...new Set(roots)]) {
    let versions: string[];
    try { versions = readdirSync(join(root,'build-tools')).sort((a,b) => b.localeCompare(a,undefined,{numeric:true})); } catch {continue;}
    for (const version of versions) {
      for (const tool of ['aapt','aapt2']) {
        const executable = join(root,'build-tools',version,tool + (process.platform === 'win32' ? '.exe' : ''));
        if (!existsSync(executable)) continue;
        const output = await new Promise<string>(resolve => execFile(executable,['dump','badging',apk],{timeout:10000,maxBuffer:4*1024*1024,windowsHide:true},(error,stdout) => resolve(error ? '' : stdout)));
        const pkg = packageFromBadging(output);
        if (pkg) return pkg;
      }
    }
  }
  return undefined;
}
export interface ApkBadging { package?: string; versionName?: string; versionCode?: number; label?: string; minSdk?: number; targetSdk?: number; abis: string[]; debuggable: boolean }
/** App details from `aapt dump badging`. */
export function parseBadging(output: string): ApkBadging {
  const pkgLine = output.match(/^package:([^\r\n]*)/m)?.[1] ?? '';
  const attr = (line: string, key: string) => line.match(new RegExp(`\\b${key}='([^']*)'`))?.[1];
  const num = (v?: string) => v && /^\d+$/.test(v) ? +v : undefined;
  const pkg = attr(pkgLine, 'name');
  return {
    package: pkg && validPackage(pkg) ? pkg : undefined,
    versionName: attr(pkgLine, 'versionName') || undefined,
    versionCode: num(attr(pkgLine, 'versionCode')),
    label: output.match(/^application-label:'([^']*)'/m)?.[1] || output.match(/^application: label='([^']*)'/m)?.[1] || undefined,
    minSdk: num(output.match(/^(?:sdkVersion|minSdkVersion):'(\d+)'/m)?.[1]),
    targetSdk: num(output.match(/^targetSdkVersion:'(\d+)'/m)?.[1]),
    abis: (output.match(/^native-code:([^\r\n]*)/m)?.[1].match(/'([^']+)'/g) ?? []).map(s => s.slice(1, -1)),
    debuggable: /^application-debuggable/m.test(output),
  };
}
/** Badging from the newest SDK build-tools aapt/aapt2 found under the given SDK roots; undefined when no tool works. */
export async function readApkBadging(apk: string, roots: string[]): Promise<ApkBadging | undefined> {
  for (const root of [...new Set(roots)]) {
    let versions: string[];
    try { versions = readdirSync(join(root, 'build-tools')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); } catch { continue; }
    for (const version of versions) for (const tool of ['aapt', 'aapt2']) {
      const executable = join(root, 'build-tools', version, tool + (process.platform === 'win32' ? '.exe' : ''));
      if (!existsSync(executable)) continue;
      const output = await new Promise<string>(resolve => execFile(executable, ['dump', 'badging', apk], { timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout) => resolve(error ? '' : stdout)));
      const info = parseBadging(output);
      if (info.package) return info;
    }
  }
  return undefined;
}
