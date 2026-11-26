# Claude assistant

The Claude bar runs on the Claude Code installed on this computer, through the Claude Agent SDK, and uses that installation's login. Usage counts against that account.

## Set up

Install Claude Code and run `claude` once to sign in. MoTA looks for it in `~/.local/bin`, `~/.claude/local` or on PATH, or you can set [`mota.ai.claudePath`](settings.md).

## What Claude can do

Claude works through MoTA's own tools:

- **Devices:** list, info, screenshot, UI tree, log tail
- **Input:** tap, swipe, text, keys, launch app, wake
- **Maestro:** list, read and write flows, run one flow, start a test run, read results
- **Apps:** install APK, clear data, uninstall
- **Pressure:** fill storage, send a low-memory signal, kill an app in the background and reopen it. See [Test under storage and memory pressure](pressure.md).
- **Sharing:** wait for a phone another session is using, ask you to hand it over, give phones back

Claude can read files in the workspace, but it can write only inside the flows folder. It has no shell and no web access, and it loads none of your other Claude Code settings or connectors.

Other sessions may be using the same phones. If one is, Claude tells you who has the phone and offers to wait for it or ask for it. When Claude finishes a reply, its phones are free to others. See [Share phones between AI sessions](sharing-phones.md).

## Permissions

| Mode | Behaviour |
| --- | --- |
| **Ask once per task** (default) | Claude shows a plan card before acting on a device or changing files. After you approve it, small steps run without further prompts. |
| **Ask only for data loss** | Claude acts without asking, except as below. |
| **Read-only** | Claude only looks and explains. |

Clearing app data, uninstalling and overwriting a flow always ask again, unless you chose *Allow for this conversation*. Devices outside the conversation's selection always ask. A replaced flow's previous version is saved in `.mota/ai/flow-backups/`.

## Token budget

The token cap is a hard stop. As a guide:

| Task | Tokens |
| --- | --- |
| A quick action or question | 5–15K |
| Diagnosing a failure | 15–40K |
| A run summary | 10–30K |
| Writing or fixing a flow | 60–150K |
| Exploring the app | 200K or more |

Claude is also told its budget so it can pace itself. MoTA's short system prompt keeps a small task to about 2–10K tokens. Screenshots are shrunk so their longest side is at most [`mota.ai.screenshotWidth`](settings.md) (960) pixels, which is about 500–1,300 tokens each.

!!! warning
    Screenshots and logs go to Claude, so use test accounts on farm phones. The UI tree hides text typed into fields.

Android can't list the elements of a screen that keeps animating (`could not get idle state`). In that case Claude uses screenshots instead.
