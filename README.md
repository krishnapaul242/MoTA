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
code --install-extension mota-android-0.2.2.vsix
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

Full TypeScript compilation and all 23 tests pass. No physical-device smoke test has been performed.

## Remembered connections

Successful connection addresses, discovered device identities and selected targets are stored locally in VS Code extension global state. Previously seen devices stay in the sidebar as **remembered** when disconnected; click a saved wireless address to reconnect, or reconnect USB physically. Only ready devices can be selected for installs, logs or monitoring. Ports can change, so recent addresses are suggestions rather than automatic reconnections. Run **MoTA: Forget Connection History** to clear saved addresses, device history and target selections. Pairing secrets are never stored.

## Debug/release replacement and blocked installs

The install page includes **Update existing app · keep data** and **Switch debug / release APK** presets. Switching enables replace, test APK and downgrade options; Android still checks signing keys and restricts downgrades of release apps.

When an install fails, each affected device offers relevant actions: **Replace existing app & retry**, **Allow downgrade & retry**, **Allow test APK & retry**, or **Uninstall conflicting app & reinstall**. Successful devices are left alone during targeted retries. **Choose another APK** opens a new installation flow.

**Clean reinstall on selected devices** is also available before an install. MoTA reads the application ID with SDK build tools (`aapt` / `aapt2`) when available. Otherwise, enter and verify the package ID; a signature failure can supply the conflicting package ID. A confirmation page lists the exact package and devices and requires acknowledgement of data deletion. It then runs uninstall followed by install. Clean uninstall applies to all Android users on the targeted device and deletes local app data; selecting an install user does not narrow uninstall scope. Cancellation makes no device changes. Uninstall failure stops that device before installation; if installation fails after removal, the old app stays removed. MoTA never automatically uninstalls just because installation failed.
