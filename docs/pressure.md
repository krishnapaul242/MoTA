# Test under storage and memory pressure

Claude, and other agents over [MCP](mcp.md), can put a phone under pressure to see how your app copes: almost no free storage, a low-memory signal, or being killed in the background. None of it needs root.

## Storage pressure

Ask for it in plain words, for example "leave 200 MB free on the Nokia and run the download flow". The agent uses two tools:

| Tool | What it does |
|---|---|
| `fill_storage` | Fills the phone until about `leaveFreeMb` is free. `0` fills it completely. A second call replaces the first fill. |
| `clear_storage_fill` | Removes the fill and gives the space back. |

- **Real errors:** apps, `/sdcard` and downloads share the filled partition, so the app gets real out-of-space errors. Android may also show its own low-storage warning.
- **One file:** the fill is a single file, `/data/local/tmp/mota-fill`. Nothing else on the phone is touched, and removing the file undoes it.
- **Speed:** filling tens of GB takes about a second on most phones. Phones that refuse the fast way are filled by writing zeros, which takes longer.
- **Order:** install the app and anything else that needs space first. Installs and Maestro's own driver fail on a full phone.

### A fill left behind

A fill that stays on a phone makes installs and tests fail for whoever uses it next, so MoTA keeps it visible and cleans up where it can:

- `list_devices` shows the fill, its size, the free space left and the session that made it.
- `release_device` removes the fill the releasing session made.
- Any session can remove a fill with `clear_storage_fill`.

A fill is not removed when a phone is handed to another session because its holder went idle, or when the phone is unplugged. Remove it by hand with `adb shell rm /data/local/tmp/mota-fill` if no agent is around.

## Memory pressure

| Tool | What it does | What it tests |
|---|---|---|
| `trim_memory` | Sends the app a low-memory signal (`onTrimMemory`). No memory is taken. | That the app frees caches when asked |
| `kill_background_app` | Presses Home, kills the app's process the way Android does when memory runs out, and reopens it. | That the app comes back to the same screen with its data |

### Memory signal levels

| For an app in use on screen | For an app in the background |
|---|---|
| `RUNNING_MODERATE`, `RUNNING_LOW`, `RUNNING_CRITICAL` | `HIDDEN`, `BACKGROUND`, `MODERATE`, `COMPLETE` |

Android refuses a background level for an app on screen, and refuses a weaker level than the last one the process got. MoTA says which of the two happened.

### Background kill

- **Saved state is kept:** the kill is `am kill`, not a force stop, so Android keeps the app's saved state and restores it when the app reopens. Anything the app held only in memory is lost, as on a real phone.
- **Apps Android protects:** a system app, or an app with a foreground service, playback or a call, is not killed, because a real low-memory kill would spare it too. MoTA reports that instead of forcing it.
- **Without reopening:** `relaunch: false` leaves the app killed, so a flow can reopen it from recents or a notification.

## Permissions

Filling and clearing storage count as device changes; the memory signal and background kill count as input. Under **Ask once per task** they run after you approve the plan. None of them deletes data, so they never raise the data-loss prompt.
