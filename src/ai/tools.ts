import { promises as fs } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';
import type { Adb } from '../adb';
import { captureScreenshot } from '../deviceControl';
import { launchApp } from '../deviceActions';
import type { InputRouter } from '../helperInput';
import { discoverFlows, parseFlowHeader } from '../maestro/flows';
import { describeCommand, latestFlowDir } from '../maestro/results';
import { MAESTRO_DRIVER, type MaestroRunner, type TestRun } from '../maestro/runner';
import { downscalePng } from './png';

type Result = { content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; isError?: boolean };
const text = (t: string, isError = false): Result => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });
const MAX_TEXT = 24_000;
const clip = (s: string, max = MAX_TEXT) => s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more characters cut)` : s;

export interface ToolDeps {
  adb: Adb;
  input: InputRouter;
  runner: MaestroRunner;
  flowsFolder: () => string;
  workspaceRoot: () => string;
  /** Longest side of screenshots sent to Claude. */
  screenshotSide: () => number;
  /** Shows a plan card and resolves with the user's answer. */
  requestPlan: (plan: { title: string; steps: string[]; serials: string[] }) => Promise<boolean>;
  /** A screenshot was taken (full-size file), so the UI can show a thumbnail. */
  onScreenshot: (serial: string, file: string) => void;
  /** A flow was written; `before` is the previous content, if any. */
  onFlowWritten: (file: string, before: string | undefined) => void;
}

const serial = z.string().regex(/^[\w.:@-]{1,128}$/, 'Use a serial from list_devices.');
const serials = z.array(serial).min(1).max(50);
const pkg = z.string().regex(/^[A-Za-z]\w*(?:\.[A-Za-z]\w*)+$/, 'Use an Android package ID, like com.example.app.');
const coord = z.number().int().min(0).max(20000);
const KEYCODES: Record<string, string> = {
  home: 'KEYCODE_HOME', back: 'KEYCODE_BACK', recents: 'KEYCODE_APP_SWITCH', enter: 'KEYCODE_ENTER', delete: 'KEYCODE_DEL', tab: 'KEYCODE_TAB',
  volumeUp: 'KEYCODE_VOLUME_UP', volumeDown: 'KEYCODE_VOLUME_DOWN', wake: 'KEYCODE_WAKEUP', sleep: 'KEYCODE_SLEEP', menu: 'KEYCODE_MENU', search: 'KEYCODE_SEARCH',
};

/** Turns a `uiautomator dump` into one line per useful element, with tap centres in device pixels. */
export function compactUiTree(xml: string, maxLines = 300): string {
  const lines: string[] = [];
  const attr = (node: string, name: string) => /\s(?:"|')?/.test(node) ? (new RegExp(`\\s${name}="([^"]*)"`).exec(node)?.[1] ?? '') : '';
  for (const m of xml.matchAll(/<node\b([^>]*)\/?>/g)) {
    const n = m[1];
    const t = decode(attr(n, 'text')), desc = decode(attr(n, 'content-desc')), id = attr(n, 'resource-id').replace(/^[\w.]+:id\//, '');
    const clickable = attr(n, 'clickable') === 'true', scrollable = attr(n, 'scrollable') === 'true', focused = attr(n, 'focused') === 'true';
    const editable = /EditText/.test(attr(n, 'class'));
    if (!t && !desc && !clickable && !scrollable && !editable) continue;
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr(n, 'bounds'));
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    if (x2 <= x1 || y2 <= y1) continue;
    const cls = attr(n, 'class').replace(/^.*\./, '');
    const flags = [clickable && 'clickable', scrollable && 'scrollable', editable && 'editable', focused && 'focused', attr(n, 'checked') === 'true' && 'checked', attr(n, 'enabled') === 'false' && 'disabled'].filter(Boolean).join(' ');
    // Text typed into fields can be personal; show that a field has text, not what it is.
    const shown = editable && t ? '(has text)' : t ? JSON.stringify(t) : '';
    lines.push(`(${(x1 + x2) >> 1},${(y1 + y2) >> 1}) ${cls}${shown ? ' ' + shown : ''}${desc ? ` desc=${JSON.stringify(desc)}` : ''}${id ? ` id=${id}` : ''}${flags ? ' ' + flags : ''}`);
    if (lines.length >= maxLines) { lines.push(`… more elements cut at ${maxLines}`); break; }
  }
  return lines.length ? lines.join('\n') : 'No visible elements with text, descriptions or actions. The screen may be a game, video, WebView or a protected window: use a screenshot instead.';
}
const decode = (s: string) => s.replace(/&#10;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function insideFolder(folder: string, path: string) {
  const full = resolve(folder, path), r = relative(folder, full);
  if (r === '' || r.startsWith('..') || isAbsolute(r)) throw new Error(`${path} must be inside ${folder}.`);
  return full;
}

/** Summary of a test run for Claude: per device, per flow. */
export function summarizeRun(run: TestRun): string {
  const out = [`Run ${run.runId}: ${run.flows.length} flow(s) on ${run.devices.size} device(s).`];
  for (const d of run.devices.values()) {
    out.push(`\n${d.serial}: ${d.state}${d.message ? ` (${d.message})` : ''}`);
    for (const r of d.results.values()) out.push(`  ${r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '–'} ${r.flow} ${r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : ''}${r.failure ? ` · ${r.failure.step ? r.failure.step + ': ' : ''}${r.failure.message}` : ''}`);
  }
  return out.join('\n');
}

/** Copies a flow's previous content to .mota/ai/flow-backups and returns the backup's path. */
export async function backupFlow(workspaceRoot: string, flowsFolder: string, file: string, before: string): Promise<string> {
  const name = relative(flowsFolder, file);
  const backup = join(workspaceRoot, '.mota', 'ai', 'flow-backups', `${name.replace(/[\\/]/g, '__')}.${Date.now()}.yaml`);
  await fs.mkdir(join(backup, '..'), { recursive: true });
  await fs.writeFile(backup, before);
  return backup;
}

/** MoTA's tool definitions. `tool` is the Agent SDK's helper, or any function that builds the same definition object. */
export function motaTools(tool: typeof Sdk.tool, deps: ToolDeps) {
  const { adb } = deps;
  const read = { annotations: { readOnlyHint: true } };
  const destructive = { annotations: { destructiveHint: true } };
  const safely = <A>(fn: (args: A) => Promise<Result>) => async (args: A) => {
    try { return await fn(args); } catch (e) { return text(e instanceof Error ? e.message : String(e), true); }
  };
  const screenshotResult = async (s: string, note = ''): Promise<Result> => {
    const png = await captureScreenshot(adb, s);
    const dir = join(deps.workspaceRoot(), '.mota', 'ai', 'screens'); await fs.mkdir(dir, { recursive: true });
    const file = join(dir, `${s.replace(/[^\w.-]+/g, '_')}-${Date.now()}.png`); await fs.writeFile(file, png);
    deps.onScreenshot(s, file);
    const small = downscalePng(png, deps.screenshotSide());
    const scale = small.scale > 1 ? `Shown at 1/${small.scale} size (${small.width}×${small.height}); multiply what you see by ${small.scale} to get device pixels for tap/swipe.` : `Shown at device size (${small.width}×${small.height}).`;
    return { content: [{ type: 'image', data: small.png.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: `${note}${scale}` }] };
  };

  const tools = [
    tool('list_devices', 'List connected Android devices with serial, model and state. Only "device" state is usable.', {}, safely(async () => {
      const list = await adb.devices();
      return text(list.length ? list.map(d => `${d.serial} · ${d.model} · ${d.state}`).join('\n') : 'No devices connected.');
    }), read),

    tool('device_info', 'Android version, maker, screen size, battery and the app in the foreground.', { serial }, safely(async ({ serial: s }) => {
      const get = (args: string[]) => adb.shell(s, args).catch(e => `unavailable (${e instanceof Error ? e.message.split('\n')[0] : e})`);
      const [release, maker, model, size, battery, focus] = await Promise.all([get(['getprop', 'ro.build.version.release']), get(['getprop', 'ro.product.manufacturer']), get(['getprop', 'ro.product.model']),
        get(['wm', 'size']), get(['dumpsys', 'battery', '|', 'grep', '-E', "'level|powered: true'"]), get(['dumpsys', 'window', '|', 'grep', '-E', "'mCurrentFocus|mFocusedApp'"])]);
      return text(`${maker} ${model}, Android ${release}\n${size}\nBattery: ${battery.replace(/\s+/g, ' ')}\nForeground: ${focus.trim().split('\n')[0] ?? ''}`);
    }), read),

    tool('screenshot', 'Capture the device screen as an image.', { serial }, safely(async ({ serial: s }) => screenshotResult(s)), read),

    tool('ui_tree', 'The on-screen UI elements (text, content descriptions, ids, clickable/editable) with tap centres in device pixels. Cheaper than a screenshot and exact for tapping; may be empty for games, video and WebViews.',
      { serial }, safely(async ({ serial: s }) => {
        const dump = () => adb.shell(s, ['uiautomator', 'dump', '/data/local/tmp/mota-ui.xml', '2>&1', ';', 'cat', '/data/local/tmp/mota-ui.xml', '2>/dev/null', ';', 'rm', '-f', '/data/local/tmp/mota-ui.xml']).catch(e => String(e));
        const animating = (out: string) => { if (/could not get idle state/i.test(out)) throw new Error('The screen keeps animating, so Android cannot list its elements (uiautomator needs a still screen). Use a screenshot instead.'); };
        let out = await dump();
        animating(out);
        if (!out.includes('<hierarchy')) {
          // Maestro's driver app keeps Android's UI automation connection after a run, which kills uiautomator dump.
          if (deps.runner.running().some(r => ['starting', 'running'].includes(r.devices.get(s)?.state ?? ''))) throw new Error('A Maestro test run is using this phone\'s UI automation right now. Use a screenshot instead.');
          await adb.shell(s, ['am', 'force-stop', MAESTRO_DRIVER]).catch(() => undefined);
          out = await dump();
          animating(out);
        }
        if (!out.includes('<hierarchy')) throw new Error(`UI dump failed: ${out.trim().slice(0, 300) || 'no output'}. Use a screenshot instead.`);
        return text(compactUiTree(out));
      }), read),

    tool('logcat_tail', 'Recent device log lines, optionally only from one app (by package).', { serial, lines: z.number().int().min(10).max(500).default(150), package: pkg.optional() },
      safely(async ({ serial: s, lines, package: p }) => {
        let pid = '';
        if (p) { pid = (await adb.shell(s, ['pidof', p]).catch(() => '')).trim().split(/\s+/)[0] ?? ''; if (!pid) return text(`${p} is not running, so it has no live log. Showing errors from all apps instead.\n` + await adb.run(['-s', s, 'logcat', '-d', '-t', String(lines), '-v', 'threadtime', '*:E'])); }
        return text(clip(await adb.run(['-s', s, 'logcat', '-d', '-t', String(lines), '-v', 'threadtime', ...(pid ? [`--pid=${pid}`] : [])])));
      }), read),

    tool('list_flows', 'List the Maestro flows in the workspace flows folder, with names, tags and app IDs.', {}, safely(async () => {
      const flows = await discoverFlows(deps.flowsFolder());
      return text(flows.length ? flows.map(f => `${f.path} · ${f.name}${f.appId ? ` · ${f.appId}` : ''}${f.tags.length ? ` · tags: ${f.tags.join(', ')}` : ''}`).join('\n') : `No flows in ${deps.flowsFolder()} yet.`);
    }), read),

    tool('read_flow', 'Read a Maestro flow file from the flows folder.', { path: z.string().min(1) }, safely(async ({ path }) => text(clip(await fs.readFile(insideFolder(deps.flowsFolder(), path), 'utf8')))), read),

    tool('run_results', 'Results of a Maestro test run (the latest by default). Give serial and flow to get a failure\'s steps, error, screenshot and log tail.',
      { runId: z.string().optional(), serial: serial.optional(), flow: z.string().optional() }, safely(async ({ runId, serial: s, flow }) => {
        const run = runId ? deps.runner.get(runId) : deps.runner.latest();
        if (!run) return text('No test runs yet in this session.');
        if (!s || !flow) return text(summarizeRun(run));
        const device = run.devices.get(s), result = device?.results.get(flow);
        if (!device || !result) return text(`No result for ${flow} on ${s} in run ${run.runId}.`, true);
        const info = run.flows.find(f => f.path === flow);
        const dir = await latestFlowDir(join(device.dir, 'artifacts'), info?.name ?? flow.replace(/^.*\//, '').replace(/\.ya?ml$/i, ''));
        const parts: string[] = [`${flow} on ${s}: ${result.status}${result.failure ? ` — ${result.failure.message}` : ''}`];
        if (result.status === 'not-run') {
          parts.push(`Device run ended as ${device.state}${device.message ? `: ${device.message}` : ''}.`);
          const consoleLog = await fs.readFile(join(device.dir, 'maestro-console.log'), 'utf8').catch(() => '');
          if (consoleLog.trim()) parts.push('Maestro console (last 30 lines):', consoleLog.trimEnd().split('\n').slice(-30).join('\n'));
        }
        if (dir) {
          const commands = JSON.parse(await fs.readFile(join(dir, 'commands.json'), 'utf8').catch(() => '[]')) as { command: Record<string, unknown>; metadata?: { status?: string } }[];
          parts.push('Steps:', ...commands.filter(c => !('defineVariablesCommand' in c.command || 'applyConfigurationCommand' in c.command)).map(c => `  ${c.metadata?.status === 'FAILED' ? '✗' : c.metadata?.status === 'COMPLETED' ? '✓' : '–'} ${describeCommand(c.command)}`));
          const log = await fs.readFile(join(dir, 'logs', 'device-logcat.txt'), 'utf8').catch(() => '');
          if (log) parts.push('Device log (last 60 lines):', log.trimEnd().split('\n').slice(-60).join('\n'));
        }
        const content: Result['content'] = [{ type: 'text', text: clip(parts.join('\n')) }];
        if (result.failure?.screenshotUri) {
          const small = downscalePng(await fs.readFile(result.failure.screenshotUri), deps.screenshotSide());
          content.push({ type: 'image', data: small.png.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: 'Screen at the failed step.' });
        }
        return { content };
      }), read),

    tool('propose_plan', 'Ask the user to approve what you will do before acting on devices or files. Call once per task with short steps and the devices involved. Wait for the answer; if declined, stop and ask what they want instead.',
      { title: z.string().min(1).max(120), steps: z.array(z.string().min(1).max(200)).min(1).max(20), serials: z.array(serial).max(50) },
      safely(async ({ title, steps, serials: list }) => text(await deps.requestPlan({ title, steps, serials: list }) ? 'Approved. Go ahead with these steps; small device actions no longer need approval in this task.' : 'The user declined this plan. Do not act. Ask what they would like instead.')), read),

    tool('tap', 'Tap at device pixel coordinates.', { serial, x: coord, y: coord }, safely(async ({ serial: s, x, y }) => {
      await deps.input.send(s, ['input', 'tap', String(x), String(y)], { type: 'tap', x, y }); return text(`Tapped ${x},${y}.`);
    })),
    tool('swipe', 'Swipe or long-press (same start and end) between device pixel coordinates.', { serial, x: coord, y: coord, x2: coord, y2: coord, durationMs: z.number().int().min(1).max(10000).default(300) },
      safely(async ({ serial: s, x, y, x2, y2, durationMs }) => {
        await deps.input.send(s, ['input', 'swipe', String(x), String(y), String(x2), String(y2), String(durationMs)], { type: 'swipe', x, y, x2, y2, duration: durationMs }); return text('Swiped.');
      })),
    tool('type_text', 'Type text into the focused field (tap the field first).', { serial, text: z.string().min(1).max(2000) }, safely(async ({ serial: s, text: t }) => {
      await deps.input.send(s, ['input', 'text', t.replace(/ /g, '%s')], { type: 'text', text: t }); return text('Typed.');
    })),
    tool('press_key', 'Press a key: home, back, recents, enter, delete, tab, volumeUp, volumeDown, wake, sleep, menu or search.', { serial, key: z.enum(Object.keys(KEYCODES) as [string, ...string[]]) },
      safely(async ({ serial: s, key }) => { await deps.input.send(s, ['input', 'keyevent', KEYCODES[key]], { type: 'key', key }); return text(`Pressed ${key}.`); })),
    tool('launch_app', 'Open an installed app by package ID.', { serial, package: pkg }, safely(async ({ serial: s, package: p }) => text(await launchApp(adb, s, p)))),
    tool('wake', 'Wake the screen (does not unlock).', { serial }, safely(async ({ serial: s }) => { await adb.shell(s, ['input', 'keyevent', 'KEYCODE_WAKEUP']); return text('Woken.'); })),

    tool('run_flow', 'Run one Maestro flow on one device and wait for the result (about 40 s of Maestro start-up plus the flow). Use it to check a flow you wrote or fixed.',
      { serial, path: z.string().min(1), env: z.record(z.string(), z.string()).optional() }, safely(async ({ serial: s, path, env }) => {
        insideFolder(deps.flowsFolder(), path);
        const info = (await discoverFlows(deps.flowsFolder())).find(f => f.path === path) ?? { path, name: path.replace(/^.*\//, '').replace(/\.ya?ml$/i, ''), tags: [] };
        const run = await deps.runner.start({ flows: [info], serials: [s], env, silent: true });
        await run.done;
        const d = run.devices.get(s)!, r = d.results.get(path);
        if (!r || r.status !== 'fail') return text(`${path}: ${r?.status ?? d.state}${d.message ? ` (${d.message})` : ''} in ${((r?.durationMs ?? 0) / 1000).toFixed(1)} s. Run ${run.runId}.`);
        const content: Result['content'] = [{ type: 'text', text: `${path} failed${r.failure?.step ? ` at ${r.failure.step}` : ''}: ${r.failure?.message}. Run ${run.runId}; call run_results with this runId, serial and flow for steps and logs.` }];
        if (r.failure?.screenshotUri) { const small = downscalePng(await fs.readFile(r.failure.screenshotUri), deps.screenshotSide()); content.push({ type: 'image', data: small.png.toString('base64'), mimeType: 'image/png' }); }
        return { content };
      })),

    tool('install_apk', 'Install (replace, keeping data) an APK from the workspace on devices.', { serials, apk: z.string().min(1) }, safely(async ({ serials: list, apk }) => {
      const file = insideFolder(deps.workspaceRoot(), apk);
      if (extname(file).toLowerCase() !== '.apk') throw new Error('Choose an .apk file.');
      await fs.access(file);
      const results = await Promise.allSettled(list.map(s => adb.run(['-s', s, 'install', '-r', file], 600_000)));
      return text(results.map((r, i) => `${list[i]}: ${r.status === 'fulfilled' ? 'installed' : `failed — ${r.reason instanceof Error ? r.reason.message : r.reason}`}`).join('\n'), results.every(r => r.status === 'rejected'));
    })),
    tool('start_test_run', 'Start Maestro flows on devices; every flow runs on every device. Returns at once; the user sees progress. Use run_results later.',
      { flows: z.array(z.string().min(1)).min(1).max(200), serials, env: z.record(z.string(), z.string()).optional() }, safely(async ({ flows, serials: list, env }) => {
        const all = await discoverFlows(deps.flowsFolder());
        const chosen = flows.map(p => all.find(f => f.path === p) ?? (() => { throw new Error(`${p} is not a flow in ${deps.flowsFolder()}. Use list_flows.`); })());
        const run = await deps.runner.start({ flows: chosen, serials: list, env });
        return text(`Started run ${run.runId}: ${chosen.length} flow(s) on ${list.length} device(s).`);
      })),
    tool('write_flow', 'Create or replace a Maestro flow in the flows folder. Content must start with a header (appId, optional name/tags), then a "---" line, then steps.',
      { path: z.string().regex(/\.ya?ml$/i, 'Use a .yaml file name.'), content: z.string().min(10).max(100_000) }, safely(async ({ path, content }) => {
        const file = insideFolder(deps.flowsFolder(), path);
        if (!/^---\s*$/m.test(content) || !parseFlowHeader(content).appId) throw new Error('A flow needs "appId: <package>" in its header, then a "---" line, then the steps.');
        const before = await fs.readFile(file, 'utf8').catch(() => undefined);
        await fs.mkdir(resolve(file, '..'), { recursive: true });
        await fs.writeFile(file, content.endsWith('\n') ? content : content + '\n');
        deps.onFlowWritten(file, before);
        return text(`${before === undefined ? 'Created' : 'Updated'} ${path}.`);
      })),

    tool('clear_app_data', 'Delete all data of an app on a device (logs the user out, resets it).', { serial, package: pkg }, safely(async ({ serial: s, package: p }) => text(await adb.shell(s, ['pm', 'clear', p]))), destructive),
    tool('uninstall_app', 'Uninstall an app from a device, deleting its data.', { serial, package: pkg }, safely(async ({ serial: s, package: p }) => text(await adb.run(['-s', s, 'uninstall', p]))), destructive),
  ];
  return tools;
}

/** MoTA's tools, served to Claude as the in-process MCP server "mota". */
export function motaServer(sdk: Pick<typeof Sdk, 'tool' | 'createSdkMcpServer'>, deps: ToolDeps) {
  return sdk.createSdkMcpServer({ name: 'mota', version: '1.0.0', tools: motaTools(sdk.tool, deps) });
}
