# Changelog

## Unreleased
- Load apps for real multi-app pressure: `start_load_apps` runs up to 12 small stand-in apps that hold memory and can use CPU and disk, in scenarios sized to the phone's memory (`open-apps`, `heavy-app`, `busy-background`, `squeeze`). `load_apps_status` shows which ones Android killed and why, also for the app under test, and `stop_load_apps` ends it.
- Storage and memory pressure for Claude and MCP agents: `fill_storage` leaves a phone with little or no free storage and `clear_storage_fill` undoes it; `trim_memory` sends an app a low-memory signal; `kill_background_app` kills an app in the background as Android does when memory is low, then reopens it. `list_devices` shows a fill and who made it, and `release_device` removes the session's own fill.
- Device cleanup by AI agents (`clear_app_data`, `uninstall_app`) now carries a reason and the task the session is working on, shown when you approve. **Always allow cleanup** approves it once for all later calls, and **MoTA: Device Cleanup Approvals** shows what was cleaned up, when, by which session and why, and turns the standing approval off.
- Phones are shared safely between AI sessions: a session that changes a phone claims it, other sessions are refused while it is in use or running a test, and idle phones (120 s by default, `mota.lease.idleSeconds`) are handed over at once. `list_devices` and the farm show who uses each phone. Works across VS Code windows.
- New `acquire_device` and `release_device` tools: wait in line for a phone, or ask the user (a VS Code notification) to hand it over now. A session that loses its phone is put first in line to get it back.
- Phones also count as busy during MoTA recordings and replays, Maestro commands started outside MoTA, and instrumentation tests. Agents get a warning while you use a phone yourself in VS Code.
- **MoTA: Install Claude Code Hooks (Phone Sharing)**: Claude Code sessions claim a phone before changing it with their own adb, maestro or Gradle commands, and MoTA asks you when another session is using it. Phones are freed when a session finishes a reply or ends.

## 0.7.4
- Claude features can use an Anthropic API key: run **MoTA: Set Anthropic API Key**. The key is kept in VS Code's secret storage. Without a key, Claude Code's own sign-in is used.
- New extension icon.

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
