import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import type { Socket } from 'node:net';
import type { Holder } from '../leases';

export type Exec = (file: string, args: string[]) => Promise<string>;
const exec: Exec = (file, args) => new Promise((ok, fail) => execFile(file, args, { timeout: 3000 }, (err, stdout) => err ? fail(err) : ok(stdout)));

/** Used when the calling process can't be found (no lsof, Windows): such agents share one identity. */
export const UNKNOWN_AGENT: Holder = { id: 'agent:unknown', label: 'an AI agent', pid: 0 };

const tildify = (path: string, home = homedir()) => path === home ? '~' : path.startsWith(home + '/') ? '~' + path.slice(home.length) : path;

/** PIDs of processes with a TCP connection on local `port`, from `lsof -F p` output. */
export function parseLsofPids(output: string): number[] {
  return [...new Set(output.split('\n').filter(l => l.startsWith('p')).map(l => Number(l.slice(1))).filter(n => Number.isInteger(n) && n > 0))];
}

/**
 * The agent process on the other end of a loopback connection: its PID (from the connection's source port), name and working folder.
 * Claude Code, Codex and Cursor open MCP connections from their own process, so one session is one holder.
 */
export async function callerOf(remotePort: number | undefined, run: Exec = exec, self = process.pid, platform = process.platform): Promise<Holder> {
  if (!remotePort || platform === 'win32') return UNKNOWN_AGENT;
  try {
    const pid = parseLsofPids(await run('lsof', ['-nP', `-iTCP:${remotePort}`, '-sTCP:ESTABLISHED', '-Fp'])).find(p => p !== self);
    if (!pid) return UNKNOWN_AGENT;
    const [name, cwd] = await Promise.all([
      run('ps', ['-o', 'comm=', '-p', String(pid)]).then(s => basename(s.trim()) || 'agent', () => 'agent'),
      run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).then(s => s.split('\n').find(l => l.startsWith('n'))?.slice(1) ?? '', () => ''),
    ]);
    return { id: `agent:${pid}`, label: cwd ? `${name} · ${tildify(cwd)}` : `${name} (pid ${pid})`, pid };
  } catch { return UNKNOWN_AGENT; }
}

const bySocket = new WeakMap<Socket, Promise<Holder>>();
/** callerOf, once per connection (clients reuse keep-alive connections). */
export function callerOfSocket(socket: Socket, run?: Exec): Promise<Holder> {
  let found = bySocket.get(socket);
  if (!found) { found = callerOf(socket.remotePort, run); bySocket.set(socket, found); }
  return found;
}
