# Share phones between AI sessions

Several Claude Code, Codex or Cursor sessions, and MoTA's own assistant, can work on the same phones without getting in each other's way. MoTA tracks who is using each phone, hands idle phones to whoever needs them, and asks you when two sessions want the same phone at once.

It works across every VS Code window that runs MoTA. The shared state is kept in `~/.mota/devices.json`.

## Set up

1. Turn on MoTA's MCP server and connect your agents: see [MCP for other agents](mcp.md).
2. For Claude Code, run **MoTA: Install Claude Code Hooks (Phone Sharing)**. This is also in the **MoTA MCP** status bar menu. With the hooks installed, MoTA also sees when a session uses `adb`, `maestro` or Gradle from its own shell, and frees a session's phones as soon as it stops working. See [Claude Code hooks](#claude-code-hooks).
3. Restart running `claude` sessions so they pick up the hooks.

Nothing else is needed. Agents learn the rules from MoTA's instructions and tool descriptions.

## How it works

### Who is using a phone

- A session that **changes** a phone, by tapping, typing, pressing keys, launching or installing apps, or running a flow, claims that phone.
- **Looking** never claims a phone. That covers `list_devices`, `device_info`, screenshots, the UI tree and logs.
- While a session is using a phone, other sessions' changes to it are refused. The refusal names the session that has the phone.

Sessions are told apart by their process. One `claude` or `codex` terminal is one session, shown with its program and folder, for example `claude · ~/Documents/app`. Subagents of a session count as that session. MoTA's own assistant shows as `MoTA's assistant ("<conversation title>")`.

### Phone states

`list_devices` and the farm show each phone in one of these states:

| State | Meaning | Can another session use it? |
|---|---|---|
| **free** | Nobody holds it | Yes |
| **in use** | A session changed it recently | No: wait in line or ask for a takeover |
| **idle** | Its session hasn't touched it for the idle time | Yes, at once. The old session is told and put first in line |
| **busy** | Something is running on it (see below) | No, not even the session that holds it |

A phone becomes **idle** when its session has done nothing on it for the idle time (120 s by default). That happens while the session builds an APK, thinks, or waits for your answer. With the [Claude Code hooks](#claude-code-hooks), it happens straight away when a Claude Code session finishes a reply or waits for your next message. MoTA's own assistant frees its phones when it finishes a reply.

A phone is **busy**, never idle, while it runs:

- a Maestro test run or flow check started from MoTA;
- a MoTA recording or replay;
- a Maestro command started outside MoTA, from a terminal or a session's shell. MoTA finds it on this computer and reads which phone it targets (`--device` / `--udid`, or the only connected phone). A command a session started itself doesn't keep that session off its own phone;
- an instrumentation test, such as Espresso or `connectedAndroidTest`, which MoTA finds on the phone. Maestro's own driver doesn't count, because it stays running after a run ends.

When a session ends or crashes, its phones are free straight away.

### Getting a phone someone else is using

A refused session is offered two options through the `acquire_device` tool:

- **Wait** (`mode: "wait"`) puts the session in line.
    - When the phone becomes free or idle, the first in line gets it.
    - The phone is kept for that session for one idle period. If the session doesn't come for it in that time, the next one in line gets its turn.
    - Each call waits up to about 45 s and then reports the session's place in line. Calling again keeps that place.
- **Takeover** (`mode: "takeover"`) shows you a VS Code notification: *"codex · ~/b asks for a7bbc444, which claude · ~/a is using. Hand it over?"*
    - **Hand over** gives the phone to the asking session. If a MoTA test is running on it in this window, that test stops.
    - **Keep** refuses the request.
    - If you don't answer, the phone is handed over as soon as it goes idle, and kept if it is still in use after 2 minutes.
    - A takeover skips the line.

A session that loses its phone, because it went idle or was taken over, is told on its next call. It is also put **first in line** to get the phone back, with a warning that the app state may have changed.

Other tool options:

- `acquire_device` without a serial takes any free phone.
- `acquire_device` with `idleSeconds` sets the session's own idle time, capped at `mota.lease.maxSessionIdleSeconds`.
- `release_device` gives phones back at once.

### When you use a phone yourself

Driving a phone from the farm's live screen or the device page doesn't block agents, but warns them. For 30 s after your last input:

- their calls on that phone carry a note that you are using it;
- `list_devices` says so too.

## Claude Code hooks

**MoTA: Install Claude Code Hooks (Phone Sharing)** adds four hooks to `~/.claude/settings.json`. Your other settings and hooks are kept, and the previous file is saved as `settings.json.mota-backup`.

| Hook | What MoTA does |
|---|---|
| **PreToolUse** on Bash | Before a shell command that changes a phone, the session claims that phone. If another session is using it, you get the takeover notification. If the answer is no, or the phone is still in use after 2 minutes, the command is blocked and Claude is told why. |
| **Stop** | The session finished a reply: its phones are free to others at once. |
| **Notification** (`idle_prompt`) | The session is waiting for your next message: same as Stop. |
| **SessionEnd** | The session ended: its phones are released. |

Commands that **claim** a phone:

- `adb install`, `uninstall`, `push`, `reboot`;
- `adb shell` / `exec-out` with a command that changes the phone (`input`, `am`, `pm install`, `pm clear` …);
- `maestro test`, `record`, `studio`;
- Gradle `connected…`, `install…`, `uninstall…`, `deviceCheck`. Gradle uses every connected phone unless `ANDROID_SERIAL` is set.

Commands that **don't** claim a phone:

- `adb devices`, `connect`, `logcat`, `pull`, `bugreport`;
- `adb shell` reads (`getprop`, `dumpsys`, `pm list`, `screencap`, `cat`, `ls` …);
- `./gradlew assembleDebug`, `maestro --version`;
- `adb` with several phones connected and no serial, because adb refuses it anyway.

Some details:

- **Permission prompts don't free phones.** Hooks run before Claude Code asks you to approve a command, and the command waiting for approval is about to use the phone.
- **The token stays out of Claude Code's settings.** The hooks send their events to MoTA with `curl`, using a token kept in `~/.mota/hook.header`, which only you can read. Resetting MoTA's token updates that file.
- **If MoTA isn't running**, the hooks do nothing and commands run as usual.
- **Scope:** macOS and Linux only for now. The hooks apply to sessions started after installing. **Remove Claude Code hooks** in the **MoTA MCP** menu takes them out again.

Codex and other agents have no hooks. MoTA's instructions tell them to call `acquire_device` before changing a phone with their own commands, and MoTA notices the Maestro and instrumentation tests they start.

## Settings

| Setting | Default | |
|---|---|---|
| `mota.lease.idleSeconds` | `120` | Seconds without activity before a session's phone counts as idle. |
| `mota.lease.deviceIdleSeconds` | `{}` | Idle time per phone, by serial, e.g. `{ "emulator-5554": 300 }`. |
| `mota.lease.maxSessionIdleSeconds` | `900` | The longest idle time an agent may set for itself with `acquire_device`. |

When more than one applies, the session's own setting wins, then the phone's, then the global one.

## Try it

Set `mota.lease.idleSeconds` to `20` so you don't wait long, and start `claude` in two terminals, **A** and **B**. Use a phone serial from `list_devices` in place of `PHONE`.

| # | Do this | You should see |
|---|---|---|
| 1 | A: "press home on PHONE with mota" | It works. The farm card shows A's name |
| 2 | Straight away, B: "press back on PHONE" | Refused, naming A, with the wait and takeover options |
| 3 | Wait about 25 s with A doing nothing, then retry in B | It works. A's next mota call says the phone was handed over and A is first in line |
| 4 | A: "acquire PHONE and wait for it", then let B finish its reply | A gets the phone when B's reply ends |
| 5 | While A is working, B: "acquire PHONE with mode takeover" | The notification appears: try **Hand over**, **Keep**, and not answering |
| 6 | Run tests on PHONE from the Tests page, then have B tap it | Refused as busy until the run ends |
| 7 | In a terminal: `maestro --device PHONE test <flow>`, then have B tap it | Refused: a Maestro command started outside MoTA |
| 8 | While A holds PHONE, B: "run `adb -s PHONE shell input keyevent 3`" | The notification appears before the command runs. **Keep** blocks it |
| 9 | B: "run `adb -s PHONE logcat -d \| tail`" | Runs with no prompt |
| 10 | Tap PHONE yourself in the farm's live view, then have A tap it | A's tap works, with a note that you are using the phone |
| 11 | Quit A while it holds PHONE | The phone is free at once |

Set `mota.lease.idleSeconds` back afterwards.

## Troubleshooting

**See what MoTA thinks.**

- The **MoTA MCP** output channel logs every agent call with the session's name. It also logs refusals and takeover requests.
- `cat ~/.mota/devices.json` shows the raw state: who holds what, the lines, busy work and pending takeovers.

**A phone stays "in use" after a session is gone.** MoTA frees phones of processes that have ended, so the holder is still running. Check that the session isn't still open in another terminal or tmux pane. Otherwise wait for the idle time, or ask for a takeover.

**Agents see a phone as busy with no test running.**

- A Maestro process may still be running: check with `ps aux | grep maestro`.
- Or an instrumentation test is still active on the phone: check with `adb -s PHONE shell dumpsys activity processes | grep ActiveInstrumentation`.

**Hooks don't seem to run.**

- Check that `~/.claude/settings.json` contains MoTA's hooks, and that the session started after you installed them. `/hooks` in Claude Code lists them.
- Check that MoTA's MCP server is on: the status bar shows **MoTA MCP**.
- Check that `~/.mota/hook.header` exists. If you reset the token, run **Install Claude Code Hooks** again.

**"MoTA's device lease file is locked".** A window was killed while writing. If no MoTA window is open, delete `~/.mota/devices.json.lock`.

**Every outside agent shows as "an AI agent".** MoTA couldn't find the calling process. It uses `lsof` and `ps` for this, so it doesn't work on Windows yet.
