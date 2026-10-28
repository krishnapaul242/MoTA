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

Run **MoTA: Recordings**, or choose **Recordings** from a ready device's context menu. Use **Set up helper** to install the bundled MoTA Recorder 0.2.0 APK (Android 11+). On the device, enable its accessibility service. Android may require **App info → Allow restricted settings** for a sideloaded accessibility app. MoTA does not enable accessibility or approve screen sharing for you.

**Start recording** asks for a mode, name, optional target app package, and capture options:

- **ADB input recording** reads physical multitouch events without intercepting them, so interaction feels normal. MoTA checks `getevent -lp` for readable protocol-B touchscreen devices and calibrated X/Y ranges. This mode currently requires the natural display orientation (`rotation = 0`). If Android denies access or exposes an unsupported input protocol, choose overlay mode. The helper's floating controls are hidden in ADB mode; stop from MoTA.
- **Overlay recording** uses the helper's existing capture overlay. Each gesture reaches the app after all fingers lift. Use its toolbar for Back, Home, Recents, explicit text insertion, pause and screenshots.
- **Screen video** opens Android's capture-consent dialog. Approve it on the device and choose the entire screen for flows across apps. Video is H.264 MP4 without audio. Protected windows may block capture. Screenshots are attempted at most about once a second; capture errors are retained in helper metadata.

**Stop** finalizes the helper session and downloads available screenshots/video. The page lists saved sessions with a timestamped action timeline and screenshot thumbnails. Video appears with playback controls when supported by the VS Code webview; use **Open recordings folder** to open it externally. **Download device session** retrieves an already completed helper recording. **Import ZIP** imports the APK's manual export and explicitly binds a legacy archive to the selected device. Archives carrying a different MoTA device binding are rejected.

Replay checks the device identity, display dimensions, rotation, session completeness and supported action schema before sending anything to the helper. Physical device identity survives changing wireless ADB addresses. Emulator identity also includes its ADB serial, so a different emulator port requires a new recording/import. Prepare the original starting screen and app state, then choose **Replay on original device** and confirm. An optional target package is launched; this does not reset application data or navigate to the original screen. **Stop** cancels queued actions; an in-flight gesture may finish. `replay-results.json` records completion, cancellation or disconnection and the last reported action index.

Recordings default to `.mota/recordings` in the first workspace folder, or extension storage when no folder is open. Set **mota.recordingsDirectory** to an absolute path to choose another location (reopen Recordings after changing it). Each session contains `session.json`, `actions.json`, available `screenshots/*.png`, optional `screen.mp4`, and the latest replay result. Recording content can include test text and visible screen content; `.mota/` is ignored by this repository. Files are never uploaded. Closing the page stops its active operation. A disconnect leaves the desktop recording incomplete and blocks replay; open the recordings folder or download the finalized helper session to recover available files.

The bridge uses authenticated JSON over an Android abstract socket forwarded through the existing ADB connection. Its bootstrap provider requires Android's DUMP permission and the ADB shell UID. MoTA holds the token in memory, creates a dynamic loopback forwarding port and removes that forwarding when the page closes. The helper does not open a LAN server. The extension package includes only the built helper APK; helper source, test APKs and the development signing key are excluded.

ADB mode decodes touch paths, per-finger start/duration and supported navigation/volume key events. It does not reconstruct arbitrary keyboard text, pressure or exact pointer velocity. Android controls replay velocity along each accessibility stroke. Input axes are assumed to align with the natural display; verify a short flow on each device/OEM before relying on longer recordings. Unsupported or dropped input and gestures exceeding ten strokes or 59 seconds stop recording as incomplete. Replay is limited to 10,000 actions and 7 MB of JSON; sessions and archives have a 2 GB media limit. Permissions, system navigation and protected windows can differ by Android version and OEM.

Build the helper with `./helper-apk/build.sh`; this also refreshes `resources/mota-recorder.apk`. Run `npm test`, then `npm run package` to produce the extension. See `helper-apk/README.md` in the source checkout for the APK's standalone workflow.
