/** Which phones a shell command an agent is about to run would change: raw adb, Maestro and Gradle device tasks. */

export interface PhoneUse { serials: string[]; what: string }

/** adb subcommands that don't act on one phone. */
const ADB_GLOBAL = new Set(['devices', 'start-server', 'kill-server', 'version', 'connect', 'disconnect', 'pair', 'mdns', 'help', 'keygen', 'reconnect', 'host-features', 'track-devices']);
/** adb subcommands that only read from a phone. */
const ADB_READ = new Set(['logcat', 'pull', 'bugreport', 'get-state', 'get-serialno', 'get-devpath', 'wait-for-device', 'features', 'forward', 'reverse', 'jdwp']);
/** `adb shell …` commands that only read (first word, or first two words). */
const SHELL_READ = /^(getprop|dumpsys|cat|ls|ps|top|df|du|id|whoami|uname|date|echo|pidof|ping|netstat|ip|ifconfig|screencap|uiautomator dump|pm list|pm path|pm dump|wm size|wm density|settings get|cmd package list|logcat|find|grep|stat|head|tail|wc|uptime|getenforce|true)\b/;

/** Splits a command line into simple commands (on ; && || | and newlines), each into words, with quotes removed. */
export function simpleCommands(line: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [], word = '', quote: string | undefined, has = false;
  const end = () => { if (has) words.push(word); word = ''; has = false; };
  const flush = () => { end(); if (words.length) out.push(words); words = []; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = undefined; else if (c === '\\' && quote === '"' && i + 1 < line.length) word += line[++i]; else word += c; has = true; continue; }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (c === '\\' && i + 1 < line.length) { word += line[++i]; has = true; continue; }
    if (c === ' ' || c === '\t') { end(); continue; }
    if (c === ';' || c === '\n' || c === '|' || c === '&' || c === '(' || c === ')' || c === '`') { flush(); continue; }
    word += c; has = true;
  }
  flush();
  return out;
}

const base = (w: string) => w.replace(/^.*[\\/]/, '').replace(/\.(exe|bat|cmd)$/i, '');

/** Leading VAR=value words, and the rest. */
function splitEnv(words: string[]): { env: Record<string, string>; rest: string[] } {
  const env: Record<string, string> = {};
  let i = 0;
  for (; i < words.length; i++) {
    const m = /^([A-Za-z_]\w*)=(.*)$/.exec(words[i]);
    if (!m) break;
    env[m[1]] = m[2];
  }
  // `env FOO=bar cmd`, `sudo`, `time`, `exec`, `nohup` wrap the real command.
  if (i < words.length && ['env', 'time', 'exec', 'nohup', 'command'].includes(words[i])) { const inner = splitEnv(words.slice(i + 1)); return { env: { ...env, ...inner.env }, rest: inner.rest }; }
  return { env, rest: words.slice(i) };
}

function adbUse(args: string[], env: Record<string, string>, connected: string[]): PhoneUse | undefined {
  let serial: string | undefined = env.ANDROID_SERIAL;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '-s' && i + 1 < args.length) { serial = args[++i]; continue; }
    if (a.startsWith('-s') && a.length > 2 && !a.startsWith('--')) { serial = a.slice(2); continue; }
    if (a === '-d' || a === '-e') { serial = undefined; continue; }
    if ((a === '-t' || a === '-H' || a === '-P' || a === '-L') && i + 1 < args.length) { i++; continue; }
    if (a.startsWith('-')) continue;
    break;
  }
  const sub = args[i];
  if (!sub || ADB_GLOBAL.has(sub) || ADB_READ.has(sub)) return undefined;
  if (sub === 'shell' || sub === 'exec-out') {
    const rest = args.slice(i + 1).filter(a => !/^-[tTxn]$/.test(a)).join(' ').trim();
    if (rest && SHELL_READ.test(rest)) return undefined;
    if (!rest) return undefined; // an interactive shell: nothing to judge
  }
  const target = serial ?? (connected.length === 1 ? connected[0] : undefined);
  if (!target) return undefined; // adb refuses to guess between phones
  return { serials: [target], what: `adb ${sub}` };
}

function maestroUse(args: string[], connected: string[]): PhoneUse | undefined {
  const sub = args.find(a => !a.startsWith('-') && !/^\S+=/.test(a));
  let serial: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const m = /^--(?:device|udid)(?:=(.+))?$/.exec(args[i]);
    if (m) serial = m[1] ?? args[i + 1];
  }
  const subIndex = args.findIndex(a => a === sub);
  const real = args.slice(subIndex).find(a => ['test', 'record', 'studio', 'start-device', 'hierarchy'].includes(a));
  if (!real || real === 'hierarchy') return undefined;
  const target = serial ?? (connected.length === 1 ? connected[0] : undefined);
  return target ? { serials: [target], what: `maestro ${real}` } : undefined;
}

/** Gradle tasks that install on or run tests on connected phones; they use every connected phone unless ANDROID_SERIAL is set. */
const GRADLE_DEVICE = /^(?::?[\w-]+:)*(connected\w*|install\w*|uninstall\w*|deviceCheck|connectedCheck)$/;

function gradleUse(args: string[], env: Record<string, string>, connected: string[]): PhoneUse | undefined {
  const tasks = args.filter(a => !a.startsWith('-') && GRADLE_DEVICE.test(a));
  if (!tasks.length) return undefined;
  const serials = env.ANDROID_SERIAL ? [env.ANDROID_SERIAL] : connected;
  return serials.length ? { serials, what: `gradle ${tasks.join(' ')}` } : undefined;
}

/** Phones a command line would change, or undefined. `connected` are the serials of phones ready now. */
export function phonesTouchedBy(line: string, connected: string[]): PhoneUse | undefined {
  const serials = new Set<string>(), what: string[] = [];
  for (const words of simpleCommands(line)) {
    const { env, rest } = splitEnv(words);
    if (!rest.length) continue;
    const cmd = base(rest[0]);
    const use = cmd === 'adb' ? adbUse(rest.slice(1), env, connected)
      : cmd === 'maestro' ? maestroUse(rest.slice(1), connected)
      : cmd === 'gradlew' || cmd === 'gradle' ? gradleUse(rest.slice(1), env, connected)
      : undefined;
    if (use) { use.serials.forEach(s => serials.add(s)); what.push(use.what); }
  }
  return serials.size ? { serials: [...serials], what: [...new Set(what)].join(', ') } : undefined;
}
