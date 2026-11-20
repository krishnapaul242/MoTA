# Use MoTA from other AI agents (MCP)

MoTA can serve the same tools to other agents, such as Claude Code in a terminal, Cursor or Codex, over MCP.

## Turn it on

Run **MoTA: Connect AI Agents (MCP)** and choose **Turn on**. The server listens on `http://127.0.0.1:6682/mcp` while VS Code is open (set [`mota.mcp.port`](settings.md) to change the port). Then pick a client:

- **Add to Claude Code** runs `claude mcp add --transport http --scope user …` for you. Start a new `claude` session and ask it to list your devices.
- **Copy Cursor config** gives a `mcpServers` entry for `.cursor/mcp.json`.
- **Copy Codex config** gives a `[mcp_servers.mota]` block for `~/.codex/config.toml`.
- **Copy URL and token** works for any client that supports Streamable HTTP with a bearer token.

Click **MoTA MCP** in the status bar to connect another agent or stop serving.

## Tools

Agents get every tool the [Claude assistant](ai-assistant.md#what-claude-can-do) has, except the plan card, which belongs to MoTA's own Claude bar. Test runs an agent starts appear on the Tests page.

## Sharing phones between sessions

Several Claude Code, Codex or Cursor sessions, and MoTA's own assistant, can use the same phones. MoTA keeps track of who is using each one, across all VS Code windows, in `~/.mota/devices.json`:

- A call that changes a phone (tap, type, install, run a flow…) claims it for that session. Reading a phone (screenshot, UI tree, logs) never claims it.
- While a session is using a phone, other sessions' calls that change it are refused with the name of the session that has it. `list_devices` shows each phone as free, yours, in use by someone else, idle or busy.
- A phone becomes **idle** after `mota.lease.idleSeconds` (120 s by default) without activity, for example while the session builds an APK or waits for your answer. Another session can then take it at once; the first session is told on its next call.
- A phone is **busy**, never idle, while it runs:
    - a Maestro test or flow check started from MoTA, or a MoTA recording or replay;
    - a Maestro command started outside MoTA, for example from a terminal or a session's shell. MoTA finds it on this computer and reads which phone it targets. A command a session started itself doesn't keep that session off its own phone;
    - an instrumentation test such as Espresso or `connectedAndroidTest`, which MoTA finds on the phone.
- When you use a phone yourself in VS Code (live screen, device page), agents are not stopped, but they get a warning that you are using it.
- When a session ends or crashes, its phones are free straight away. When MoTA's assistant finishes a reply, its phones become idle.
- A session that needs a phone someone else is using calls `acquire_device`:
    - **wait** puts it in line. When the phone becomes free or idle, the first in line gets it; the phone is kept for that session for one idle period, then the next in line gets its turn.
    - **takeover** asks you in a VS Code notification to hand it over. If you don't answer, it is handed over as soon as it is idle, and kept if it is still in use after 2 minutes. Handing over a phone that is running a MoTA test stops that test.
    - Without a serial, it takes any free phone. With `idleSeconds`, a session sets its own idle time, up to `mota.lease.maxSessionIdleSeconds`.
- A session that loses its phone, by idling or by takeover, is told on its next call and put first in line to get it back.
- `release_device` gives phones back at once.
- The farm shows who uses each phone, who is waiting, and pending takeover requests on its card.

Sessions are told apart by their process: one Claude Code or Codex window is one session, labelled with its program and folder. On Windows, all outside agents share one identity for now.

## Security

- Only this computer can connect, and requests from web pages are refused.
- Requests need MoTA's access token, which is kept in VS Code's secret storage.
- The token is written into the client's config, so keep that config out of shared repositories, and use **Reset access token** if it leaks.
- Clearing app data, uninstalling an app and overwriting a flow always wait for you to approve them in VS Code; the previous version of an overwritten flow is kept in `.mota/ai/flow-backups/`.
- The agent's own permission prompts apply to everything else.

Every call is listed in the **MoTA MCP** output channel.
