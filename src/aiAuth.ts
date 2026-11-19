import type * as VSCode from 'vscode';
import { API_KEY_SECRET } from './ai/host';

/** Rough shape check for an Anthropic API key; the API itself is the real check. */
export function apiKeyProblem(key: string): string | undefined {
  const k = key.trim();
  if (!k) return 'Paste your API key.';
  if (/\s/.test(k)) return 'The key must not contain spaces.';
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) return 'Anthropic API keys start with sk-ant-. Create one at platform.claude.com.';
  return undefined;
}

/** Commands to store or remove the Anthropic API key used by MoTA's Claude features. The key lives only in VS Code's secret storage. */
export function registerAiAuth(vscode: typeof VSCode, context: VSCode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('mota.ai.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        title: 'Anthropic API key for MoTA',
        prompt: 'Claude features use this key instead of your Claude Code sign-in. Usage is billed to the key. It is stored in VS Code\'s secret storage.',
        placeHolder: 'sk-ant-…', password: true, ignoreFocusOut: true, validateInput: apiKeyProblem,
      });
      if (key === undefined) return;
      await context.secrets.store(API_KEY_SECRET, key.trim());
      void vscode.window.showInformationMessage('MoTA: API key saved. Claude features will use it from the next request.');
    }),
    vscode.commands.registerCommand('mota.ai.clearApiKey', async () => {
      if (!(await context.secrets.get(API_KEY_SECRET))) { void vscode.window.showInformationMessage('MoTA: No API key is stored.'); return; }
      await context.secrets.delete(API_KEY_SECRET);
      void vscode.window.showInformationMessage('MoTA: API key removed. Claude features will use your Claude Code sign-in.');
    }),
  );
}
