# Use MoTA from other AI agents (MCP)

MoTA can serve the same tools to other agents, such as Claude Code in a terminal, Cursor or Codex, over MCP.

## Turn it on

Run **MoTA: Connect AI Agents (MCP)** and choose **Turn on**. The server listens on `http://127.0.0.1:6682/mcp` while VS Code is open (set [`mota.mcp.port`](settings.md) to change the port). Then pick a client:

- **Add to Claude Code** runs `claude mcp add --transport http --scope user …` for you. Start a new `claude` session and ask it to list your devices.
- **Copy Cursor config** gives a `mcpServers` entry for `.cursor/mcp.json`.
- **Copy Codex config** gives a `[mcp_servers.mota]` block for `~/.codex/config.toml`.
- **Copy URL and token** works for any client that supports Streamable HTTP with a bearer token.
- **Install Claude Code hooks** lets Claude Code sessions share phones when they run `adb`, `maestro` or Gradle themselves. See [Share phones between AI sessions](sharing-phones.md#claude-code-hooks).

Click **MoTA MCP** in the status bar to connect another agent or stop serving.

## Tools

Agents get every tool the [Claude assistant](ai-assistant.md#what-claude-can-do) has, except the plan card, which belongs to MoTA's own Claude bar. Test runs an agent starts appear on the Tests page. Every call is logged with the session that made it, for example `claude · ~/Documents/app`.

## Sharing phones between sessions

Several sessions can use the same phones. A session that changes a phone claims it, and other sessions are refused while it is in use or running a test. Idle phones are handed over at once. Sessions wait for a phone, or ask you to hand it over, with `acquire_device`, and give phones back with `release_device`. For Claude Code, **MoTA: Install Claude Code Hooks (Phone Sharing)** also covers the `adb`, `maestro` and Gradle commands a session runs itself.

See [Share phones between AI sessions](sharing-phones.md).

## Security

- Only this computer can connect, and requests from web pages are refused.
- Requests need MoTA's access token, which is kept in VS Code's secret storage.
- The token is written into the client's config, so keep that config out of shared repositories, and use **Reset access token** if it leaks.
- Clearing app data, uninstalling an app and overwriting a flow always wait for you to approve them in VS Code; the previous version of an overwritten flow is kept in `.mota/ai/flow-backups/`.
- The agent's own permission prompts apply to everything else.

Every call is listed in the **MoTA MCP** output channel.
