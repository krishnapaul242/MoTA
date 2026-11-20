import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { HOOK_PATH } from './ai/mcpHttp';

/** The header file the hooks send (kept out of Claude Code's settings so the token isn't written there). Also marks MoTA's hooks. */
export const HOOK_HEADER = join('.mota', 'hook.header');

/** The shell command each hook runs: it posts the hook input to MoTA, prints MoTA's answer, and does nothing if MoTA isn't running. */
export function hookCommand(port: number): string {
  return `curl -s --max-time 170 -H @"$HOME/${HOOK_HEADER}" -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${port}${HOOK_PATH} || true`;
}

type HookEntry = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };
type Settings = Record<string, unknown> & { hooks?: Record<string, HookEntry[]> };

const isMota = (e: HookEntry) => e?.hooks?.some(h => typeof h?.command === 'string' && h.command.includes(HOOK_HEADER));

/** Settings without MoTA's hooks; other hooks are kept. */
export function withoutMotaHooks(settings: Settings): Settings {
  if (!settings.hooks || typeof settings.hooks !== 'object') return settings;
  const hooks: Record<string, HookEntry[]> = {};
  for (const [event, list] of Object.entries(settings.hooks)) {
    const kept = Array.isArray(list) ? list.filter(e => !isMota(e)) : list;
    if (!Array.isArray(kept) || kept.length) hooks[event] = kept;
  }
  const { hooks: _old, ...rest } = settings;
  return Object.keys(hooks).length ? { ...rest, hooks } : rest;
}

/**
 * Settings with MoTA's hooks (replacing older ones):
 * - PreToolUse on Bash: claims phones a shell command changes, or asks the user in VS Code to hand them over.
 * - Stop (the turn ended) and Notification idle_prompt (waiting for the user's next message): the session's phones count as idle at once.
 *   Not permission prompts: the command waiting for approval is about to use the phone.
 * - SessionEnd: the session's phones are released.
 */
export function withMotaHooks(settings: Settings, port: number): Settings {
  const clean = withoutMotaHooks(settings);
  const command = hookCommand(port);
  const hooks = { ...(clean.hooks ?? {}) };
  const add = (event: string, entry: HookEntry) => { hooks[event] = [...(hooks[event] ?? []), entry]; };
  add('PreToolUse', { matcher: 'Bash', hooks: [{ type: 'command', command, timeout: 180 }] });
  add('Stop', { hooks: [{ type: 'command', command, timeout: 10 }] });
  add('Notification', { matcher: 'idle_prompt', hooks: [{ type: 'command', command, timeout: 10 }] });
  add('SessionEnd', { hooks: [{ type: 'command', command, timeout: 5 }] });
  return { ...clean, hooks };
}

export const claudeSettingsPath = (home = homedir()) => join(home, '.claude', 'settings.json');

async function readSettings(file: string): Promise<Settings> {
  const text = await fs.readFile(file, 'utf8').catch(e => { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw e; });
  if (!text.trim()) return {};
  const data = JSON.parse(text) as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${file} is not a JSON object.`);
  return data as Settings;
}

async function writeSettings(file: string, settings: Settings) {
  await fs.mkdir(dirname(file), { recursive: true });
  await fs.copyFile(file, `${file}.mota-backup`).catch(() => undefined);
  const tmp = `${file}.mota-tmp`;
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2) + '\n');
  await fs.rename(tmp, file);
}

/** Writes the header file with MoTA's token, readable only by this user. */
export async function writeHookHeader(token: string, home = homedir()) {
  const file = join(home, HOOK_HEADER);
  await fs.mkdir(dirname(file), { recursive: true });
  await fs.writeFile(file, `Authorization: Bearer ${token}\n`, { mode: 0o600 });
  await fs.chmod(file, 0o600);
}

export async function hookHeaderExists(home = homedir()) { return fs.access(join(home, HOOK_HEADER)).then(() => true, () => false); }

/** Adds MoTA's hooks to Claude Code's user settings (keeping a backup and every other setting). */
export async function installHooks(port: number, token: string, home = homedir()) {
  const file = claudeSettingsPath(home);
  const settings = await readSettings(file);
  await writeHookHeader(token, home);
  await writeSettings(file, withMotaHooks(settings, port));
  return file;
}

export async function removeHooks(home = homedir()) {
  const file = claudeSettingsPath(home);
  const settings = await readSettings(file);
  await writeSettings(file, withoutMotaHooks(settings));
  await fs.unlink(join(home, HOOK_HEADER)).catch(() => undefined);
  return file;
}
