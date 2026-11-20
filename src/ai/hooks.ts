import type { Adb } from '../adb';
import { leaseGate, type Holder, type LeaseStore } from '../leases';
import { phonesTouchedBy } from '../rawCommands';

export interface HookDeps {
  adb: Pick<Adb, 'devices'>;
  leases: LeaseStore;
  log: (line: string) => void;
}

/** What a hook prints: {} lets Claude Code carry on as usual. */
export type HookOutput = Record<string, unknown>;

const deny = (reason: string): HookOutput => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

/**
 * Handles a Claude Code hook call. Before a shell command that changes a phone (raw adb, maestro, gradle device tasks), the session claims
 * it; if someone else is using it, the user is asked in VS Code to hand it over. When a session stops or waits for the user, its phones
 * count as idle at once; when it ends, they are released.
 */
export async function handleHook(input: unknown, session: () => Promise<Holder>, deps: HookDeps): Promise<HookOutput> {
  const body = (input ?? {}) as { hook_event_name?: unknown; tool_name?: unknown; tool_input?: { command?: unknown } };
  const event = String(body.hook_event_name ?? '');
  if (event === 'Stop' || event === 'Notification') { const h = await session(); await deps.leases.park(h.id); return {}; }
  if (event === 'SessionEnd') { const h = await session(); const released = await deps.leases.release(h.id); if (released.length) deps.log(`${h.label} ended; released ${released.join(', ')}`); return {}; }
  if (event !== 'PreToolUse' || body.tool_name !== 'Bash' || typeof body.tool_input?.command !== 'string') return {};

  const connected = (await deps.adb.devices().catch(() => [])).filter(d => d.state === 'device').map(d => d.serial);
  const use = phonesTouchedBy(body.tool_input.command, connected);
  if (!use) return {};
  const h = await session();
  const first = await deps.leases.claim(h, use.serials);
  if (first.ok) return {};

  // Someone else is using some of these phones: ask the user to hand each one over, as acquire_device's "takeover" does.
  deps.log(`${h.label} wants to run ${use.what} on ${use.serials.join(', ')}, which another session is using; asking you in VS Code`);
  const gate = leaseGate(deps.leases, h);
  const blocked = [];
  for (const serial of use.serials) if (!(await deps.leases.claim(h, [serial])).ok) blocked.push(serial);
  const results = await Promise.all(blocked.map(async serial => {
    for (let i = 0; i < 10; i++) {
      const r = await gate.acquire({ serial, candidates: connected, mode: 'takeover' });
      if (r.status !== 'asking') return r;
    }
    return { status: 'declined' as const, serial, text: `No answer about ${serial}.` };
  }));
  const refused = results.filter(r => r.status !== 'granted');
  if (!refused.length && (await deps.leases.claim(h, use.serials)).ok) return {};
  return deny(`MoTA: this command (${use.what}) would change ${refused.map(r => r.serial).join(', ') || use.serials.join(', ')}, which another session is using.\n${refused.map(r => r.text).join('\n') || first.reason}\nDon't run it on that phone. Use another phone (see the mota list_devices tool), or wait for it with acquire_device mode "wait".`);
}
