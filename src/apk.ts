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
