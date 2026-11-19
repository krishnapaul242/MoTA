import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { FlowInfo } from '../ai/protocol';

const YAML = /\.ya?ml$/i;
const CONFIG = /^config\.ya?ml$/i;
const MAX_FILES = 2000;

/** Reads the header (the part before the first `---` line) of a Maestro flow. */
export function parseFlowHeader(text: string): { appId?: string; name?: string; tags: string[] } {
  const lines = text.split(/\r?\n/);
  const end = lines.findIndex(l => /^---\s*$/.test(l));
  if (end < 0) return { tags: [] };
  const header = lines.slice(0, end);
  const scalar = (key: string) => {
    const line = header.find(l => new RegExp(`^${key}:\\s*\\S`).test(l));
    return line ? unquote(line.slice(line.indexOf(':') + 1).trim()) : undefined;
  };
  return { appId: scalar('appId'), name: scalar('name'), tags: listValue(header, 'tags') };
}

/** Values of a top-level YAML list key, in block (`- a`) or flow (`[a, b]`) style. */
export function listValue(lines: string[], key: string): string[] {
  const at = lines.findIndex(l => new RegExp(`^${key}:`).test(l));
  if (at < 0) return [];
  const inline = lines[at].slice(key.length + 1).trim();
  if (inline.startsWith('[')) return inline.replace(/^\[|\]\s*$/g, '').split(',').map(s => unquote(s.trim())).filter(Boolean);
  if (inline) return [unquote(inline)];
  const values: string[] = [];
  for (const line of lines.slice(at + 1)) {
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (item) values.push(unquote(item[1]));
    else if (/^\S/.test(line)) break;
  }
  return values;
}

function unquote(value: string) { return value.replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2'); }

/** Converts a Maestro `flows:` glob (`*`, `**`, `?`) into a regular expression over `/`-separated paths. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Which flow files Maestro runs for a folder: top-level files by default, or the config's `flows:` globs. */
export function selectFlowFiles(files: string[], configText?: string): string[] {
  const candidates = files.filter(f => YAML.test(f) && !CONFIG.test(f));
  const globs = configText ? listValue(configText.split(/\r?\n/), 'flows') : [];
  if (!globs.length) return candidates.filter(f => !f.includes('/')).sort();
  const patterns = globs.map(g => globToRegExp(g.replace(/^\.\//, '')));
  return candidates.filter(f => patterns.some(p => p.test(f) || (!YAML.test(p.source) && p.test(f.replace(YAML, ''))))).sort();
}

async function walk(root: string, dir = root, out: string[] = []): Promise<string[]> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (out.length >= MAX_FILES) break;
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(root, full, out);
    else if (entry.isFile() && YAML.test(entry.name)) out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/** Lists the flows in a Maestro folder, with their names, tags and app IDs. */
export async function discoverFlows(folder: string): Promise<FlowInfo[]> {
  const files = await walk(folder);
  const config = files.find(f => CONFIG.test(f));
  const configText = config ? await fs.readFile(join(folder, config), 'utf8') : undefined;
  return Promise.all(selectFlowFiles(files, configText).map(async path => {
    const header = parseFlowHeader(await fs.readFile(join(folder, path), 'utf8'));
    return { path, name: header.name || path.replace(/^.*\//, '').replace(YAML, ''), tags: header.tags, appId: header.appId };
  }));
}

/** Applies include/exclude tag filters the way Maestro does: a flow needs any include tag and no exclude tag. */
export function filterByTags(flows: FlowInfo[], include: string[] = [], exclude: string[] = []): FlowInfo[] {
  return flows.filter(f => (!include.length || f.tags.some(t => include.includes(t))) && !f.tags.some(t => exclude.includes(t)));
}
