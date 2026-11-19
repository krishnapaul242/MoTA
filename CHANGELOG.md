# Changelog

## 0.7.3
- Fixed the Claude Code setup command for MoTA's MCP server.
- The extension is now bundled, so it installs and starts faster.

## 0.7.2
- The live view streams through scrcpy's server: drag that follows the mouse, mouse-wheel scrolling, fast typing and keys, and correct orientation after rotation. It falls back to Android's screenrecord when scrcpy can't start; the `mota.liveEngine` setting chooses between them.
- Opt-in MCP server on localhost, so other AI agents can use MoTA's device and test tools.

## 0.7.1
- Clear reasons when a Maestro run can't start, such as an unauthorized phone or "Install via USB" turned off on Xiaomi phones.
- Farm cards and the run banner show test errors.

## 0.7.0
- Redesigned device farm, device controls, install and monitor pages.
- Claude assistant on every page, with plan approvals and token caps.
- Maestro test runs across several devices in parallel, with results, screenshots and failure diagnosis.

## 0.6.x
- Device farm with live screens, bulk actions, QR, pairing-code and address connection.
- Live H.264 video in the farm's live view.
- Managed-phone setup by QR and device-owner mode for the recorder helper.
- Remembered devices are no longer listed twice when a wireless serial changes.

## Earlier
- ADB integration, APK installs, metrics, app launching, device monitor, keep-awake controls, screenshots, video capture, and recording and replay through the helper APK.
