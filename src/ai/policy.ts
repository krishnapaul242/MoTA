import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ApprovalKind, Permission } from './protocol';

/** What a tool can do, from harmless to destructive. */
export type Risk = 'read' | 'input' | 'change' | 'data-loss';

/** MoTA's own tools (served as mcp__mota__<name>). */
export const MOTA_TOOL_RISK: Record<string, Risk> = {
  list_devices: 'read', device_info: 'read', screenshot: 'read', ui_tree: 'read', logcat_tail: 'read',
  list_flows: 'read', read_flow: 'read', run_results: 'read', propose_plan: 'read', acquire_device: 'read', release_device: 'read',
  tap: 'input', swipe: 'input', type_text: 'input', press_key: 'input', launch_app: 'input', wake: 'input',
  run_flow: 'input', trim_memory: 'input', kill_background_app: 'input',
  install_apk: 'change', start_test_run: 'change', write_flow: 'change', fill_storage: 'change', clear_storage_fill: 'change',
  clear_app_data: 'data-loss', uninstall_app: 'data-loss',
};

/** Claude Code built-in tools MoTA enables. Everything else (Bash, web, agents…) is not loaded at all. */
export const BUILTIN_TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write'] as const;

export interface PolicyContext {
  permission: Permission;
  /** The user approved this task's plan card. */
  planApproved: boolean;
  /** Tools the user allowed "for this conversation" from an approval card. */
  allowedForConversation: ReadonlySet<string>;
  /** Devices the conversation is scoped to; empty means any connected device. */
  scope: readonly string[];
  workspaceRoot: string;
  flowsFolder: string;
  /** Whether a path already exists (overwriting a file counts as data loss). */
  exists: (path: string) => boolean;
}

export type Decision =
  | { action: 'allow' }
  | { action: 'ask'; kind: ApprovalKind; reason: string }
  | { action: 'deny'; reason: string };

const inside = (root: string, path: string) => { const r = relative(root, path); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

/** Risk of a call, or undefined for tools MoTA never permits. */
export function riskOf(tool: string, input: Record<string, unknown>, ctx: Pick<PolicyContext, 'workspaceRoot' | 'flowsFolder' | 'exists'>): Risk | { deny: string } {
  if (tool.startsWith('mcp__mota__')) {
    const name = tool.slice('mcp__mota__'.length);
    const risk = MOTA_TOOL_RISK[name];
    if (!risk) return { deny: `Unknown MoTA tool ${name}.` };
    if (name === 'write_flow') return ctx.exists(resolve(ctx.flowsFolder, String(input.path ?? ''))) ? 'data-loss' : 'change';
    return risk;
  }
  if (tool === 'Read' || tool === 'Glob' || tool === 'Grep') {
    const target = String(input.file_path ?? input.path ?? ctx.workspaceRoot);
    return inside(ctx.workspaceRoot, resolve(ctx.workspaceRoot, target)) ? 'read' : { deny: 'MoTA only reads files inside this workspace.' };
  }
  if (tool === 'Edit' || tool === 'Write') {
    const target = resolve(ctx.workspaceRoot, String(input.file_path ?? ''));
    if (!inside(ctx.flowsFolder, target)) return { deny: `MoTA only writes Maestro flows, inside ${relative(ctx.workspaceRoot, ctx.flowsFolder) || ctx.flowsFolder}${sep}.` };
    return ctx.exists(target) ? 'data-loss' : 'change';
  }
  return { deny: `${tool} is not available in MoTA.` };
}

/** Devices a call targets, from its `serial` or `serials` argument. */
export function targetSerials(input: Record<string, unknown>): string[] {
  const one = typeof input.serial === 'string' ? [input.serial] : [];
  const many = Array.isArray(input.serials) ? input.serials.filter((s): s is string => typeof s === 'string') : [];
  return [...new Set([...one, ...many])];
}

/**
 * Decides whether a tool call runs, asks, or is refused.
 * - read-only: only reads.
 * - ask-task: reads run; device input and changes run once the task's plan is approved; data loss always asks.
 * - ask-data-loss: everything runs except data loss, which asks.
 * Calls on devices outside the conversation's scope always ask. "Allow for this conversation" skips later asks for that tool.
 */
export function decide(tool: string, input: Record<string, unknown>, ctx: PolicyContext): Decision {
  const risk = riskOf(tool, input, ctx);
  if (typeof risk === 'object') return { action: 'deny', reason: risk.deny };
  if (risk === 'read') return { action: 'allow' };
  if (ctx.permission === 'read-only') return { action: 'deny', reason: 'The conversation is read-only. Switch the permission to let Claude act on devices or files.' };
  const outside = ctx.scope.length ? targetSerials(input).filter(s => !ctx.scope.includes(s)) : [];
  if (outside.length) return { action: 'ask', kind: 'device-change', reason: `${outside.join(', ')} is outside the selected devices.` };
  if (ctx.allowedForConversation.has(tool)) return { action: 'allow' };
  if (risk === 'data-loss') return { action: 'ask', kind: 'data-loss', reason: dataLossReason(tool, input) };
  if (ctx.permission === 'ask-data-loss' || ctx.planApproved) return { action: 'allow' };
  return { action: 'ask', kind: 'plan', reason: 'Claude wants to act before a plan was approved.' };
}

function dataLossReason(tool: string, input: Record<string, unknown>) {
  const name = tool.replace(/^mcp__mota__/, '');
  if (name === 'clear_app_data') return `Clears all data of ${input.package ?? 'the app'}.`;
  if (name === 'uninstall_app') return `Uninstalls ${input.package ?? 'the app'} and deletes its data.`;
  return `Overwrites ${String(input.path ?? input.file_path ?? 'a file')}.`;
}
