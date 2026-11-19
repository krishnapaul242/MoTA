import type * as VSCode from 'vscode';
import type { Adb } from '../adb';
import type { HostToWebview, WebviewToHost } from '../ai/protocol';

/** One page's connection to the shared Claude / test-run host (src/ai/host.ts, owned by the AI work). */
export interface AiLink { handle(msg: WebviewToHost): void | Promise<void>; dispose(): void }
interface AiHost { connect(post: (msg: HostToWebview) => void): AiLink }

/** Posts host events to a webview, turning the local file paths in thumbUri / uri / failure.screenshotUri into webview URIs. */
export function aiPoster(vscode: typeof VSCode, panel: VSCode.WebviewPanel, isClosed: () => boolean) {
  const conv = (p: unknown) => typeof p === 'string' && /^(?:\/|[A-Za-z]:[\\/])/.test(p) ? panel.webview.asWebviewUri(vscode.Uri.file(p)).toString() : p;
  return (m: HostToWebview) => {
    if (isClosed()) return;
    const out: Record<string, unknown> = { ...m };
    if ('thumbUri' in out) out.thumbUri = conv(out.thumbUri);
    if (m.type === 'ai/attachment') out.uri = conv(m.uri);
    if (m.type === 'test/flow' && m.failure) out.failure = { ...m.failure, screenshotUri: conv(m.failure.screenshotUri) };
    void panel.webview.postMessage(out);
  };
}

/** True for webview messages that belong to the Claude bar or test runs. */
export function isAiMessage(m: unknown): m is WebviewToHost {
  const type = (m as { type?: unknown } | null)?.type;
  return typeof type === 'string' && (type.startsWith('ai/') || type.startsWith('test/'));
}

/** Used until src/ai/host.ts exists: the bar renders, and every request says Claude isn't connected. */
class StubHost implements AiHost {
  connect(post: (msg: HostToWebview) => void): AiLink {
    post({ type: 'ai/models', items: [] });
    return {
      handle(msg) {
        if (msg.type === 'ai/send') post({ type: 'ai/done', convId: msg.convId ?? 'local', outcome: 'error', message: "Claude isn't connected yet. This part of MoTA is still being built." });
        else if (msg.type === 'ai/list') post({ type: 'ai/conversations', items: [] });
        else if (msg.type === 'test/flows') post({ type: 'test/flows', folder: '', items: [], error: "Test runs aren't available yet." });
      },
      dispose() { /* nothing to release */ },
    };
  }
}

let shared: AiHost | undefined;
/** The shared host: the real one when src/ai/host.ts is compiled in, otherwise the stub. */
export function aiHost(context: VSCode.ExtensionContext, adb: Adb): AiHost {
  if (shared) return shared;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../ai/host') as { aiHost?: (c: VSCode.ExtensionContext, a: Adb) => AiHost };
    if (typeof mod.aiHost === 'function') return shared = mod.aiHost(context, adb);
  } catch { /* not built yet */ }
  return shared = new StubHost();
}
