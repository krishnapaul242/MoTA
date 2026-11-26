import { relative } from 'node:path';
import type { Permission } from './protocol';
import { targetSerials } from './policy';

export interface PromptContext {
  workspaceRoot: string;
  flowsFolder: string;
  devices: { serial: string; model: string }[];
  permission: Permission;
  tokenCap: number;
}

const PERMISSION_TEXT: Record<Permission, string> = {
  'ask-task': 'Before you act on a device (input, installs, test runs) or change files, call propose_plan once with short steps and the devices involved, and wait for approval. Looking (screenshots, UI tree, logs, results, reading files) never needs approval. Clearing app data, uninstalling and overwriting a flow are confirmed by the user separately.',
  'ask-data-loss': 'You may act on devices and create files without asking. Clearing app data, uninstalling and overwriting a flow are confirmed by the user.',
  'read-only': 'This conversation is read-only: look and explain, but do not touch devices or files. Say what you would do instead.',
};

/**
 * Kept short on purpose: Claude Code's default system prompt is ~60K tokens; this one is under 1K,
 * which makes a small task cost about 5K tokens instead of 65K.
 */
export function systemPrompt(ctx: PromptContext): string {
  const flows = relative(ctx.workspaceRoot, ctx.flowsFolder) || ctx.flowsFolder;
  const devices = ctx.devices.length ? ctx.devices.map(d => `- ${d.serial} (${d.model})`).join('\n') : '- none selected; use list_devices and ask which to use before acting';
  return `You are MoTA, an assistant inside VS Code that operates Android test phones and Maestro UI tests for the user's team.

Devices in scope for this conversation:
${devices}

Workspace: ${ctx.workspaceRoot}
Maestro flows folder: ${flows}

How to work:
- Use the mota tools for anything on a device. There is no shell.
- ${PERMISSION_TEXT[ctx.permission]}
- Prefer ui_tree for finding things to tap (exact centres in device pixels); use screenshot to see layout, images or games. Screenshots may be scaled: the tool says the factor.
- Other sessions and AI agents share these phones. If a call is refused because someone else is using a phone, tell the user who has it and offer to wait (acquire_device mode "wait") or ask for it (mode "takeover"); don't retry in a loop.
- Pressure tests: fill_storage leaves little free storage (install first; always clear_storage_fill when done), trim_memory sends a low-memory signal, kill_background_app kills the app in the background as Android does and reopens it.
- Never try to unlock a PIN, pattern or password, or sign in with real personal accounts. If a phone is locked or needs a person, say so.
- Maestro: flows live in ${flows}. A flow is a header (appId, optional name and tags), a "---" line, then steps such as launchApp, tapOn, inputText, assertVisible, scrollUntilVisible, back. Prefer text or id selectors over coordinates. After writing or fixing a flow, check it with run_flow on one device; at most 3 attempts, then report what blocks it.
- Diagnosing a failed flow: use run_results for steps, error, screenshot and log; read the flow; classify it as app bug, flaky, broken test (selector/text changed) or device/environment problem (system dialog, lock screen, network), with the evidence. For a broken test, propose the corrected flow. For an app bug, write a short bug report: steps, expected, actual, device, log lines.
- You have a budget of about ${Math.round(ctx.tokenCap / 1000)}K tokens for this task. Be economical: don't take screenshots you don't need, and wrap up with what you found if you are running out.
- Answer briefly and plainly. Report outcomes per device.`;
}

export function diagnosisPrompt(runId: string, serial: string, flow: string): string {
  return `The Maestro flow ${flow} failed on device ${serial} in test run ${runId}. Diagnose it: get the details with run_results (runId ${runId}, serial ${serial}, flow ${flow}), read the flow, and look at the device only if needed. Then give the category, the evidence, and the fix (a corrected flow, a bug report, or what to do on the phone). Don't change any files or run anything yet; I'll decide after reading your diagnosis.`;
}

/** One-line description of a tool call for the conversation panel, e.g. "tap 540,1200". */
export function describeCall(tool: string, input: Record<string, unknown>): string {
  const name = tool.replace(/^mcp__mota__/, '');
  const devices = targetSerials(input);
  const on = devices.length > 1 ? ` → ${devices.length} devices` : '';
  switch (name) {
    case 'tap': return `tap ${input.x},${input.y}`;
    case 'swipe': return `swipe ${input.x},${input.y} → ${input.x2},${input.y2}`;
    case 'type_text': return `type ${JSON.stringify(String(input.text ?? '').slice(0, 40))}`;
    case 'press_key': return `press ${input.key}`;
    case 'launch_app': case 'clear_app_data': case 'uninstall_app': case 'kill_background_app': return `${name} ${input.package}`;
    case 'trim_memory': return `trim_memory ${input.package} ${input.level}`;
    case 'fill_storage': return `fill_storage leave ${input.leaveFreeMb} MB free`;
    case 'run_flow': case 'read_flow': case 'write_flow': return `${name} ${input.path}`;
    case 'install_apk': return `install_apk ${String(input.apk ?? '').replace(/^.*\//, '')}${on}`;
    case 'start_test_run': return `start_test_run ${(input.flows as unknown[] | undefined)?.length ?? 0} flows${on}`;
    case 'propose_plan': return `plan: ${input.title}`;
    case 'Read': case 'Edit': case 'Write': return `${name} ${String(input.file_path ?? '').replace(/^.*\//, '')}`;
    case 'Glob': case 'Grep': return `${name} ${input.pattern ?? ''}`;
    default: return name + on;
  }
}
