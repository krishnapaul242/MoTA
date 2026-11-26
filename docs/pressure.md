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

## Load apps: real multi-app pressure

The signal and the background kill test one app's reaction. Load apps put the whole phone under pressure, the way a phone full of other apps does. They are 12 small apps (`dev.mota.load.a01` to `a12`, named "MoTA Load 01" and so on) that stand in for other apps: each holds memory and can also use CPU, write to disk and keep files. Android then keeps and kills apps, yours included, as it would on a busy phone.

| Tool | What it does |
|---|---|
| `start_load_apps` | Starts a scenario, replacing any load already running. The first start on a phone installs the load apps. |
| `load_apps_status` | Shows which load apps still run, why the others ended, and the memory available. With `package`, the same for your app. |
| `stop_load_apps` | Stops all load apps and deletes what they stored. They stay installed. |

### Scenarios

Sizes follow the phone's memory, so a scenario means the same on a 3 GB and a 12 GB phone.

| Scenario | Load apps | What it is like |
|---|---|---|
| `open-apps` | 8 in recents, about 4% of memory each | Apps the user opened and left |
| `heavy-app` | 1 in recents, 25% of memory | A game left open |
| `busy-background` | 3 doing background work, 5% of memory each, with CPU and disk load | Sync, playback or uploads running; they come back when killed |
| `squeeze` | 6 doing background work, sized to leave about `leaveAvailableMb` (300 by default) | Memory stays taken however many apps Android kills |

`apps` and `memoryMbEach` change the number of load apps and the memory each holds.

### What you see

Start the load after installing your app, use your app, then ask for the status. For example, with eight 224 MB load apps on a 2.5 GB phone:

```
open-apps: 7 of 8 load apps running, started by claude · ~/app at 16:32:38.
  dev.mota.load.a01 · 224 MB · killed by Android for low memory at 16:32:56
  dev.mota.load.a02 · 224 MB · running (cached)
  ...
Memory: 268 MB available of 2478 MB.
com.android.settings: not running; killed by Android for low memory at 16:32:56.
```

- **Kill order:** load apps are opened oldest first, so the first is the first Android kills. Your app competes with them by how recently it was used.
- **Exit reasons:** these come from Android's own record (Android 11 and later). Phones that do not report low-memory kills show them as "killed by a signal".
- **Available memory is approximate:** Android compresses and swaps memory, so the amount left is near the target, not exact.

### Cleaning up

- `list_devices` shows a running load and the session that started it.
- `release_device` stops the load the releasing session started.
- A load is not stopped when its phone is handed to another session for being idle, or when the phone is unplugged. Any session can stop it with `stop_load_apps`.

### Phones that refuse the load apps

The load apps are installed over USB like any test build, and some phones ask a person first:

| Phone says | What to do |
|---|---|
| `INSTALL_FAILED_VERIFICATION_FAILURE` | Play Protect checks apps installed over USB. Install one by hand and choose **Install anyway**, or turn off **Verify apps over USB** in Developer options. |
| `INSTALL_FAILED_USER_RESTRICTED` | On Xiaomi phones, tap **Install** on the phone when asked, or turn on **Install via USB** in Developer options. |

### Limits

- Load apps do not use GPU memory or load system services the way real apps do.
- Phone makers add their own rules for background apps, so the same scenario can end differently on different brands.

## Permissions

Filling and clearing storage and starting or stopping load apps count as device changes; the memory signal and background kill count as input. Under **Ask once per task** they run after you approve the plan. None of them deletes data, so they never raise the data-loss prompt.
