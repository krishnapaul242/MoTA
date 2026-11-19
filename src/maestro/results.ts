import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { FlowFailure, FlowStatus } from '../ai/protocol';

export interface FlowResult { name: string; file?: string; status: FlowStatus; durationMs: number; message?: string; tags: string[] }

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? unescapeXml(m[1]) : undefined; };

/** Reads a Maestro `--format junit` report. */
export function parseJUnit(xml: string): FlowResult[] {
  const results: FlowResult[] = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (let m; (m = re.exec(xml));) {
    const tag = m[1], body = m[3] ?? '';
    const failure = /<(failure|error)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1>)/.exec(body);
    const status = attr(tag, 'status');
    const failed = !!failure || (status !== undefined && status !== 'SUCCESS');
    const tags = /<property\s+name="tags"\s+value="([^"]*)"/.exec(body)?.[1];
    results.push({
      name: attr(tag, 'name') ?? attr(tag, 'id') ?? 'flow',
      file: attr(tag, 'file'),
      status: failed ? 'fail' : 'pass',
      durationMs: Math.round(Number(attr(tag, 'time') ?? 0) * 1000),
      message: failure ? unescapeXml((failure[2] ?? '').trim()) || status : undefined,
      tags: tags ? unescapeXml(tags).split(',').map(t => t.trim()).filter(Boolean) : [],
    });
  }
  return results;
}

/** Parses Maestro's per-flow console lines: `[Passed] name (10s)` / `[Failed] name (28s) (message)`. */
export function parseProgressLine(line: string): { status: FlowStatus; name: string; durationMs?: number; message?: string } | undefined {
  const m = /^\[(Passed|Failed|Skipped|Stopped|Canceled|Cancelled)\]\s+(.+?)(?:\s+\((?:(\d+)m\s*)?(\d+(?:\.\d+)?)s\))?(?:\s+\((.*)\))?\s*$/.exec(line.trim());
  if (!m) return undefined;
  const secs = (m[3] ? Number(m[3]) * 60 : 0) + (m[4] ? Number(m[4]) : 0);
  return { status: m[1] === 'Passed' ? 'pass' : m[1] === 'Failed' ? 'fail' : 'not-run', name: m[2], durationMs: m[4] ? Math.round(secs * 1000) : undefined, message: m[5] };
}

/** One readable line for a Maestro command from commands.json, e.g. `assertVisible "Results"`. */
export function describeCommand(command: Record<string, unknown>): string {
  const [key, value] = Object.entries(command)[0] ?? ['command', {}];
  const name = key.replace(/Command$/, '');
  const v = (value ?? {}) as Record<string, unknown>;
  const visible = (v.condition as Record<string, Record<string, unknown>> | undefined)?.visible;
  const notVisible = (v.condition as Record<string, Record<string, unknown>> | undefined)?.notVisible;
  const selector = (v.selector ?? visible ?? notVisible) as Record<string, unknown> | undefined;
  const target = selector ? (selector.textRegex ?? selector.idRegex ?? selector.text ?? selector.id) : (v.text ?? v.appId ?? v.link);
  const verb = visible ? 'assertVisible' : notVisible ? 'assertNotVisible' : name;
  return target !== undefined ? `${verb} ${JSON.stringify(String(target))}` : verb;
}

/** Finds the failed step, its error and its screenshot in a flow's `--test-output-dir` folder. */
export async function readFailureDetail(artifactsDir: string, flowName: string): Promise<FlowFailure | undefined> {
  const flowDir = await latestFlowDir(artifactsDir, flowName);
  if (!flowDir) return undefined;
  let step: string | undefined, message = '';
  try {
    const commands = JSON.parse(await fs.readFile(join(flowDir, 'commands.json'), 'utf8')) as { command: Record<string, unknown>; metadata?: { status?: string; error?: { message?: string } } }[];
    const failed = commands.find(c => c.metadata?.status === 'FAILED');
    if (failed) { step = describeCommand(failed.command); message = failed.metadata?.error?.message ?? ''; }
  } catch { /* commands.json is optional */ }
  const shots = await fs.readdir(join(flowDir, 'screenshots')).catch(() => [] as string[]);
  const shot = shots.filter(f => f.endsWith('.png')).sort().pop();
  return { step, message, screenshotUri: shot ? join(flowDir, 'screenshots', shot) : undefined };
}

/** Maestro writes `<dir>/<timestamp>/<flow>/`; the newest timestamp folder holding that flow wins. */
export async function latestFlowDir(artifactsDir: string, flowName: string): Promise<string | undefined> {
  const runs = (await fs.readdir(artifactsDir, { withFileTypes: true }).catch(() => [])).filter(e => e.isDirectory()).map(e => e.name).sort().reverse();
  for (const run of runs) {
    const dir = join(artifactsDir, run, flowName);
    if (await fs.stat(dir).then(s => s.isDirectory(), () => false)) return dir;
  }
  return undefined;
}
