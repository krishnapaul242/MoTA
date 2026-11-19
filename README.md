# MoTA Android

A small desktop VS Code extension for Android and React Native projects.

- QR pairing through Android wireless debugging (Android 11+).
- USB, wireless and emulator devices in an Explorer sidebar.
- Workspace APK discovery, including `android/app/build/outputs/apk`.
- Install an APK on multiple selected devices concurrently.
- Separate logcat output channels per device, with tag/priority filters.
- Live multi-device battery, Android version, model, memory and CPU reports.
- Optional package-specific memory and cumulative frame rendering diagnostics.

## Run locally

Install Node.js 22+ and Android SDK Platform Tools. Make `adb` available on PATH, set `ANDROID_HOME` / `ANDROID_SDK_ROOT`, or set `mota.adbPath` to its full executable path.

```
npm install
npm test
```

Open this directory in VS Code and press F5 to launch an Extension Development Host. Open your React Native project in that host. Expand **Devices** and **APKs** in Explorer.

To build an installable extension:

```
npm run package
code --install-extension mota-android-0.2.3.vsix
```

## Pair and connect

Run **MoTA: Pair Device with QR** from the Command Palette. On the phone, enable Developer options and Wireless debugging, then choose **Pair device with QR code**. Scan the displayed code. Keep the phone and the machine running this extension on the same Wi-Fi network. Codes expire after two minutes; closing the panel stops discovery. Pairing credentials are ephemeral and are never saved in extension settings.

ADB uses mDNS to discover the pairing endpoint and automatically connect after successful pairing. If the device does not appear, run **MoTA: Connect by Address** and enter the IP and port from the main Wireless debugging screen. That connection port differs from the pairing port. If discovery fails, check firewall rules, multicast support and network client isolation. With Remote SSH/containers, ADB runs on the remote extension host, which needs network access to the phone.

For USB, enable USB debugging and accept the phone's authorization prompt. Offline and unauthorized devices remain visible but cannot be selected for operations.

## Managed test phones (device owner)

Some phones restrict ADB. For example, Xiaomi's "USB debugging (Security settings)" needs a SIM and Mi account before `adb install`, `pm grant` or input injection work. A dedicated test phone can instead have the MoTA helper as its device owner. In the device farm, choose **Add device → Managed setup**, optionally enter Wi-Fi details, and select **Create setup QR**. Factory reset the phone, tap its first setup screen six times, and scan the code. Don't add a Google or Mi account. The phone downloads the helper from this computer and finishes setup with it.

The extension serves only the bundled helper, at a random path on the chosen local address, for 15 minutes or until you select **Stop serving** or close the farm. The QR pins the helper's signing certificate, so the phone rejects any other file. The phone must reach this computer on the local network, and macOS may ask to allow incoming connections. A Wi-Fi password in the QR is readable by anyone who scans it. Afterwards, turn on Developer options, USB debugging and the helper's accessibility service on the phone. The farm tags it **Managed**. **Farm defaults** keeps managed phones awake while charging and postpones system updates for 30 days. On phones that reject `adb shell input` (Xiaomi's `INJECT_EVENTS` error), taps, swipes, keys and text in the farm and device pages go through the helper's accessibility service instead. MIUI also blocks enabling that service over ADB, so turn it on once on the phone. **MoTA: Set Up Recorder Helper** updates a managed phone's helper through the helper itself when `adb install` is blocked. Device-owner setup needs Android 10 or newer and is undone by a factory reset. Some regional firmware omits the six-tap QR option.

## APKs, logs and performance

Build APKs with your project's normal Gradle/React Native workflow; this extension does not invoke builds. Click an APK to choose one or more ready devices, or run **MoTA: Install APK on Devices** to browse for one. Choose **Editor page** (the default) for per-device progress and recovery, or **Notification** for compact progress with an **Open install page** action. Review install options before starting: replace while keeping data, allow test APKs, permit downgrades for debuggable apps, grant runtime permissions, Android user ID, and a 10–600 second timeout. Options are remembered per workspace. Retry runs only on devices that have not succeeded; failures offer tailored guidance, reconnect and ADB settings actions. Standalone APKs are supported; split APK sets and AAB bundles are not.

Run **MoTA: Start Logcat** to select multiple devices, or use a device's context menu. The default filter is `*:I`; React Native users can use `ReactNative:V ReactNativeJS:V *:S`. You can also choose output format, log buffer, previous line count and an optional app package. App filtering follows the current PID; restart logcat after the app restarts. The last tag filter and package are remembered. Output channels retain independent device streams. Run **MoTA: Stop All Logcat Streams** to stop them.

Run **MoTA: Device Info and Live Stats** and optionally enter your app's package ID. The monitor shows battery, temperature, CPU, memory, app memory and janky-frame cards, plus a 40-sample CPU trend for each device. Change the app package and sampling interval (2, 5, 10 or 30 seconds) inside the page; pause/resume or refresh manually. Raw diagnostics are available in expandable details. Missing metrics display as unavailable. The app package is remembered per workspace. CPU data comes from `dumpsys cpuinfo`; memory comes from `/proc/meminfo` and `dumpsys meminfo`; frame data comes from `dumpsys gfxinfo`. These are Android diagnostics, not a precise real-time FPS profiler. Availability and format vary by device and Android version. No root access is requested.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `mota.adbPath` | `adb` | ADB executable |
| `mota.apkGlob` | `**/*.apk` | Workspace APK search |
| `mota.refreshSeconds` | `5` | Device list polling interval |

This extension requires a trusted workspace and desktop VS Code. It does not support browser-only VS Code.

## Verification

`npm test` compiles TypeScript and checks discovery parsing, endpoint validation, safe HTML output, literal process arguments, metric conversion, recovery hints, install flag validation, and mocked VS Code interactions for install retries, saved connections and monitor controls. Physical-device QR pairing, installs, logcat and diagnostics require a manual device smoke test.

Implementation references: [ADB guide](https://developer.android.com/tools/adb), [ADB Wi-Fi architecture](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/dev/adb_wifi.md), [VS Code extension API](https://code.visualstudio.com/api/references/vscode-api).

### Current validation status

Full TypeScript compilation and all 32 tests pass. No physical-device smoke test has been performed.

## Remembered connections

Successful connection addresses, discovered device identities and selected targets are stored locally in VS Code extension global state. Previously seen devices stay in the sidebar as **remembered** when disconnected; click a saved wireless address to reconnect, or reconnect USB physically. Only ready devices can be selected for installs, logs or monitoring. Ports can change, so recent addresses are suggestions rather than automatic reconnections. Run **MoTA: Forget Connection History** to clear saved addresses, device history and target selections. Pairing secrets are never stored.

## Debug/release replacement and blocked installs

The install page includes **Update existing app · keep data** and **Switch debug / release APK** presets. Switching enables replace, test APK and downgrade options; Android still checks signing keys and restricts downgrades of release apps.

When an install fails, each affected device offers relevant actions: **Replace existing app & retry**, **Allow downgrade & retry**, **Allow test APK & retry**, or **Uninstall conflicting app & reinstall**. Successful devices are left alone during targeted retries. **Choose another APK** opens a new installation flow.

**Clean reinstall on selected devices** is also available before an install. MoTA reads the application ID with SDK build tools (`aapt` / `aapt2`) when available. Otherwise, enter and verify the package ID; a signature failure can supply the conflicting package ID. A confirmation page lists the exact package and devices and requires acknowledgement of data deletion. It then runs uninstall followed by install. Clean uninstall applies to all Android users on the targeted device and deletes local app data; selecting an install user does not narrow uninstall scope. Cancellation makes no device changes. Uninstall failure stops that device before installation; if installation fails after removal, the old app stays removed. MoTA never automatically uninstalls just because installation failed.

## Launch apps and control the device screen

Use the **play** icon in the Devices header to select devices and launch an installed app by package ID. Each device also has a launch action, and successful install cards offer **Launch app** or **Launch on installed devices**. The last package ID is remembered per workspace. MoTA resolves the MAIN/LAUNCHER activity and uses Android's activity manager to open it. Install-page launch uses the selected install user; an empty or `all` user launches the current user. Standalone launch uses the current Android user. Apps without an enabled launcher activity report an error per device.

The **dashboard** icon in the Devices header opens the multi-device monitor directly.

Use the **lightbulb** icon or **MoTA: Device Keep Awake** for:

- **Keep awake while charging**: prevent normal sleep while USB, AC or wireless charging is connected.
- **Keep awake on battery**: set a one-hour screen inactivity timeout and wake the screen once.
- **Wake screen now**: send a single wake request, without unlocking the phone.
- **Restore previous sleep setting**: restore the charging and timeout settings saved before MoTA changed them.

Sleep settings remain active after VS Code closes until restored; the one-hour option is an inactivity timeout, not an automatic restoration timer. Restore using the same device connection identity. Repeated enables preserve the original values. Android device policies can limit screen behavior. Each device reports its own result.

## Record device input, screenshots and video

Run **MoTA: Recordings**, or choose **Recordings** from a ready device's context menu. Use **Set up helper** to install the bundled MoTA Recorder 0.2.2 APK (Android 11+). On the device, enable its accessibility service. Android may require **App info → Allow restricted settings** for a sideloaded accessibility app. MoTA does not enable accessibility or approve screen sharing for you.

**Start recording** asks for a mode, name, optional target app package, and capture options:

- **ADB input recording** reads physical multitouch events without intercepting them, so interaction feels normal. MoTA checks `getevent -lp` for readable protocol-A or protocol-B touchscreen devices and calibrated X/Y ranges, then detects the active touchscreen from the first contact instead of asking you to select an event device. This mode currently requires the natural display orientation (`rotation = 0`). If Android denies access or exposes an unsupported input protocol, choose overlay mode. The helper's floating controls are hidden in ADB mode; stop from MoTA.
- **Overlay recording** uses the helper's existing capture overlay. Each gesture reaches the app after all fingers lift. Use its toolbar for Back, Home, Recents, explicit text insertion, pause and screenshots.
- **Screen video** opens Android's capture-consent dialog. Approve it on the device and choose the entire screen for flows across apps. Video is H.264 MP4 without audio. Protected windows may block capture. Screenshots are attempted at most about once a second; capture errors are retained in helper metadata.

**Stop** finalizes the helper session and downloads available screenshots/video. The page lists saved sessions with a timestamped action timeline and screenshot thumbnails. Video appears with playback controls when supported by the VS Code webview; use **Open recordings folder** to open it externally. **Download device session** retrieves an already completed helper recording. **Import ZIP** imports the APK's manual export and explicitly binds a legacy archive to the selected device. Archives carrying a different MoTA device binding are rejected.

Replay checks the device identity, display dimensions, rotation, session completeness and supported action schema before sending anything to the helper. Physical device identity survives changing wireless ADB addresses. Emulator identity also includes its ADB serial, so a different emulator port requires a new recording/import. Prepare the original starting screen and app state, then choose **Replay on original device** and confirm. An optional target package is launched; this does not reset application data or navigate to the original screen. **Stop** cancels queued actions; an in-flight gesture may finish. `replay-results.json` records completion, cancellation or disconnection and the last reported action index.

Recordings default to `.mota/recordings` in the first workspace folder, or extension storage when no folder is open. Set **mota.recordingsDirectory** to an absolute path to choose another location (reopen Recordings after changing it). Each session contains `session.json`, `actions.json`, available `screenshots/*.png`, optional `screen.mp4`, and the latest replay result. Recording content can include test text and visible screen content; `.mota/` is ignored by this repository. Files are never uploaded. Closing the page stops its active operation. A disconnect leaves the desktop recording incomplete and blocks replay; open the recordings folder or download the finalized helper session to recover available files.

The bridge uses authenticated JSON over an Android abstract socket forwarded through the existing ADB connection. Its bootstrap provider requires Android's DUMP permission and the ADB shell UID. MoTA holds the token in memory, creates a dynamic loopback forwarding port and removes that forwarding when the page closes. The helper does not open a LAN server. The extension package includes only the built helper APK; helper source, test APKs and the development signing key are excluded.

ADB mode decodes touch paths, per-finger start/duration and supported navigation/volume key events. It does not reconstruct arbitrary keyboard text, pressure or exact pointer velocity. Android controls replay velocity along each accessibility stroke. Input axes are assumed to align with the natural display; verify a short flow on each device/OEM before relying on longer recordings. Unsupported or dropped input and gestures exceeding ten strokes or 59 seconds stop recording as incomplete. Replay is limited to 10,000 actions and 7 MB of JSON; sessions and archives have a 2 GB media limit. Permissions, system navigation and protected windows can differ by Android version and OEM.

Build the helper with `./helper-apk/build.sh`; this also refreshes `resources/mota-recorder.apk`. Run `npm test`, then `npm run package` to produce the extension. See `helper-apk/README.md` in the source checkout for the APK's standalone workflow.

Recording failures display selectable diagnostic text and a **Copy error details** button. The report includes the operation, device, helper state, detected input device and error message/stack.

The floating overlay has collapsed and expanded layouts. Collapsed shows only a record/stop button and an expand chevron; expanded shows all controls and a collapse chevron. Expand the menu and drag its status label to reposition it. The selected layout is remembered and expansion stays within screen bounds.

## Device control page

Click a ready device in the Devices list, or run **MoTA: Device Controls**. Its page groups Capture, Apps & deep links, Input, Diagnostics, and ADB & files. Capture screenshots without a helper, copy them as PNG images, or save them. Screen recording uses helper 0.2.2 and Android capture consent; capture can pause/resume into one MP4. Finished videos have playback/pause, seeking, PNG frame copy and frame save controls. Copy works through the webview image clipboard with a native desktop fallback; Linux fallback needs wl-copy or xclip. Remote hosts may require saving an image for local copying.

Deep links accept an optional package and preserve URI query parameters. App controls support launch, force stop, install, clear data and uninstall; destructive presets ask for confirmation. Device inputs include navigation, volume, wake/sleep, taps, swipes and basic text. Diagnostics reuse logcat and live stats. File actions push/pull a chosen file. The advanced runner accepts Android shell commands or device-scoped ADB arguments; it always fixes the selected serial and never invokes a host shell. An interactive device shell is available for long-running work.

Video capture is separate from input record/replay. The page owns only the screen capture it started and cancels it when closed. Captures stay in extension storage until explicitly saved elsewhere. Protected screens can block capture; H.264 playback depends on the VS Code build. If frame copying is attempted while seeking, wait for the seek to finish first.

## Maestro test runs

Put your Maestro flows in `.maestro/` (or set **mota.maestroFlowsFolder**). MoTA lists the top-level flows, or the ones matched by `flows:` in `config.yaml`, with their tags. Select devices and flows and run them: every selected flow runs on every selected device. Each device gets one Maestro process, which takes about 40 seconds to start before the first flow. Progress comes from Maestro's output, and the final result for each flow comes from its JUnit report. Failures show the failed step, its error and a screenshot. A device that disconnects is marked as lost, and its remaining flows are marked as not run. Cancel stops the whole Maestro process tree.

Runs are saved in `.mota/test-runs/<run>/<device>/`: `report.xml`, `maestro-console.log`, `results.json` and Maestro's `artifacts/` (screenshots, screen hierarchy, device log and `commands.json`). After each run, MoTA stops Maestro's driver app on the phone so that MoTA's own UI tools can use UI automation again. Install the Maestro CLI first; MoTA uses `~/.maestro/bin/maestro`, the `maestro` command on PATH, or **mota.maestroPath**.

## Claude assistant

The Claude bar runs on the Claude Code installed on this computer, through the Claude Agent SDK, and uses that installation's login. Usage counts against that account. Install Claude Code and run `claude` once to sign in. MoTA looks for it in `~/.local/bin`, `~/.claude/local` or on PATH, or you can set **mota.ai.claudePath**.

Claude works through MoTA's own tools:
- devices: list, info, screenshot, UI tree, log tail
- input: tap, swipe, text, keys, launch app, wake
- Maestro: list, read and write flows, run one flow, start a test run, read results
- apps: install APK, clear data, uninstall

Claude can read files in the workspace, but it can write only inside the flows folder. It has no shell and no web access, and it loads none of your other Claude Code settings or connectors.

Permissions:
- **Ask once per task** (default): Claude shows a plan card before acting on a device or changing files. After you approve it, small steps run without further prompts.
- **Ask only for data loss**: Claude acts without asking, except as below.
- **Read-only**: Claude only looks and explains.

Clearing app data, uninstalling and overwriting a flow always ask again, unless you chose *Allow for this conversation*. Devices outside the conversation's selection always ask. A replaced flow's previous version is saved in `.mota/ai/flow-backups/`.

The token cap is a hard stop. As a guide:
- a quick action or question: 5–15K tokens
- diagnosing a failure: 15–40K
- a run summary: 10–30K
- writing or fixing a flow: 60–150K
- exploring the app: 200K or more

Claude is also told its budget so it can pace itself. MoTA's short system prompt keeps a small task to about 2–10K tokens. Screenshots are shrunk so their longest side is at most **mota.ai.screenshotWidth** (960) pixels, which is about 500–1,300 tokens each. Screenshots and logs go to Claude, so use test accounts on farm phones. The UI tree hides text typed into fields.

Android can't list the elements of a screen that keeps animating (`could not get idle state`). In that case Claude uses screenshots instead.
