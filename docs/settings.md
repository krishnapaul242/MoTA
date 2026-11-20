# Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `mota.adbPath` | `adb` | ADB executable path. Uses Android SDK environment variables when available. |
| `mota.apkGlob` | `**/*.apk` | Workspace APK search pattern; Gradle build folders are included. |
| `mota.refreshSeconds` | `5` | Device list refresh interval. |
| `mota.recordingsDirectory` | *(empty)* | Absolute recording directory. Empty uses `.mota/recordings` in the first workspace folder, or extension storage without a workspace. |
| `mota.liveEngine` | `scrcpy` | How the live view streams a device's screen: `scrcpy` or `screenrecord`. |
| `mota.maestroPath` | *(empty)* | Maestro CLI path. Empty uses `~/.maestro/bin/maestro` when present, otherwise `maestro` on PATH. |
| `mota.maestroFlowsFolder` | `.maestro` | Folder with your Maestro flows, relative to the first workspace folder or absolute. |
| `mota.mcp.enabled` | `false` | Serve MoTA's tools to AI agents over MCP on 127.0.0.1. |
| `mota.mcp.port` | `6682` | Local port for MoTA's MCP server (`http://127.0.0.1:<port>/mcp`). |
| `mota.lease.idleSeconds` | `120` | Seconds without activity after which a phone a session holds counts as idle, so another session may take it. A phone running a Maestro test is never idle. See [Sharing phones](mcp.md#sharing-phones-between-sessions). |
| `mota.lease.deviceIdleSeconds` | `{}` | Idle time per phone, by serial, overriding `mota.lease.idleSeconds`, e.g. `{ "emulator-5554": 300 }`. |
| `mota.lease.maxSessionIdleSeconds` | `900` | The longest idle time an agent may set for its own session with `acquire_device`. Your own settings are not capped. |
| `mota.ai.claudePath` | *(empty)* | Claude Code CLI the assistant runs on. Empty finds `claude` in `~/.local/bin`, `~/.claude/local` or on PATH. |
| `mota.ai.model` | *(empty)* | Model for the assistant. Empty uses Claude Code's default model. |
| `mota.ai.effort` | `medium` | How hard Claude thinks: `low`, `medium`, `high` or `xhigh`. Higher is slower and uses more tokens. |
| `mota.ai.screenshotWidth` | `960` | Longest side, in pixels, of screenshots sent to Claude. Smaller uses fewer tokens. |
