# MoTA Recorder helper

An original, dependency-free Android helper for recording actions **performed directly on an unrooted phone or emulator**, replaying them, and exporting screenshots and optional screen video. Android 11 / API 30 or newer. MIT license, inherited from the repository. No third-party source or APK is bundled.

## Install and use

Install `dist/mota-recorder-0.1.0.apk` on the device, open **MoTA Recorder**, and enable its accessibility service using **Open accessibility settings**. Android may require **App info → ⋮ → Allow restricted settings** for a sideloaded accessibility app before it can be enabled. No root, Shizuku, device-owner setup, overlay permission, or ADB connection is required at runtime: controls use an accessibility overlay.

1. Open your target app at the starting screen.
2. Open MoTA, then choose **Show floating controls** and return to the target. Move the controls by dragging their status label. Tap **Record** to start without video. To include video, use **New recording** in the app with **Include screen video** checked and approve Android's screen-capture dialog. Choose the entire screen for flows that cross apps.
3. Perform taps, holds, swipes, or pinches. The overlay captures a whole gesture, then sends it to the app **after all fingers lift**. Wait for it to finish before the next gesture. For a long press, hold, lift, and wait for the app to respond.
4. Use the toolbar's **Back**, **Home**, and **Recents** to record navigation. **Pause** removes the recording overlay so you can interact normally without recording; **Resume** reinstates it. **Text** replaces the currently focused non-password editable field and records the text. Keyboard taps are just coordinate gestures; Text is more reliable for replaying text.
5. **Shot** takes a screenshot. Automatic screenshots are attempted after gestures, limited to once per second and skipped while another gesture is in progress. Screenshots are indexed to their corresponding action.
6. **Stop** saves. Open MoTA and select a saved session. Prepare the same starting screen/app state, show the controls, and press **Play**. Playback starts after three seconds. **Stop** cancels pending playback; a gesture already dispatched may finish.
7. After recording and capture finish, use **Export selected session as ZIP** and choose a destination in Android's file picker. Export includes `actions.json`, `screenshots/*.png`, and `screen.mp4` when video succeeded.

The included **Practice pad** lets you check taps, long press, drawing, multitouch and text without affecting other apps. Use Pause while navigating to it, then Resume. For replay, restore the same starting state before pressing Play.

## What is and is not preserved

- Tap position, gesture path shape, per-finger start time, total per-finger duration, and gap between completed actions are recorded. Raw sample timestamps are exported. Android's `dispatchGesture` determines velocity along the path; this version does **not** reproduce per-sample velocity, touch pressure, tool type, or physical hardware-event timing exactly.
- Up to Android's `GestureDescription.getMaxStrokeCount()` strokes per gesture (currently 10), maximum gesture duration as reported by the API (currently 60 seconds), and 20,000 samples. Unsupported gestures are rejected visibly.
- The recording overlay intercepts application-area touches. It cannot transparently observe arbitrary system gestures or restricted windows. System bars, screen edges and permission dialogs may be outside its control. Use Pause when necessary; those interactions will not be replayed.
- Back/Home/Recents are recorded only through the helper toolbar. Volume presses are recorded when Android delivers key events to the service; replay changes the suggested audio stream. Power, fingerprint, arbitrary hardware keys, keyboard composition state, and exact system navigation gestures are not recorded.
- This is coordinate replay. Display dimensions and rotation must match; replay refuses a mismatch. It does not reset app state, locate elements semantically, or wait for network/app readiness. Captured UI text is limited to explicit Text insertion, not a background keylogger.
- Rotation during a session stops recording/replay. Continuous video uses a fixed resolution, up to a 1920-pixel longest edge, H.264, 30 fps, with no audio. Video continues through Pause and may show the helper controls. Android's sharing indicator/Stop sharing also stops video; gesture recording can continue.
- Apps using secure/protected windows can deny screenshots or video. Failures are written into session notes, not bypassed.

## Session format and privacy

Sessions are stored in internal app storage (`files/sessions/<timestamp>/`). `actions.json` is written atomically after each action; abrupt termination may leave the last gesture/video incomplete. Uninstalling removes sessions. The app has no internet permission, analytics, boot receiver, microphone permission, or externally callable recording endpoints. The accessibility service is protected by Android's `BIND_ACCESSIBILITY_SERVICE` permission; the video service is not exported. This development APK is debuggable and signed with a local development key, so authorized ADB can inspect its files. Do not use it for sensitive data collection.

JSON schema version 1:

- `width`, `height`, `rotation`: required replay display configuration.
- `actions[]`: `gesture`, `global`, `volume`, or `text`. `atMs` is elapsed active recording time at the start of input. `delayMs` is the gap since the previous action completed, excluding explicit pauses. For gestures, `strokes[]` contains pointer ID, start/duration and `[x,y,tMs]` samples; `dispatch` and `completedAtMs` report injection outcome.
- `screenshots[]`: file, active recording timestamp, wall elapsed timestamp and action index (`-1` for manual captures).
- `videoStartWallMs` / `videoEndWallMs`: video timing relative to session creation, including pauses. Pause/resume boundaries appear in notes with wall time. Replay excludes paused intervals; video includes them.
- `notes[]`, `videoStatus`, `finished`: diagnostics and lifecycle state. A successful APK build does not guarantee every OEM/app permits every operation.

Sessions may include typed test data and visible screen content. Export is explicit using the system file picker. No automatic credential collection is implemented; password fields are rejected by the Text control.

## Build offline

Requires an installed Android SDK (platform 36, build tools 36.0.0) and JDK 17 or newer. Android Studio's bundled JDK is used by default on macOS.

```sh
./helper-apk/build.sh
```

Override `ANDROID_SDK_ROOT`, `JAVA_HOME`, `ANDROID_PLATFORM` or `BUILD_TOOLS_VERSION` as needed. The script uses aapt2, javac, D8, zipalign and apksigner directly: no Gradle, remote artifacts or external libraries. It creates a local ignored development key at `helper-apk/debug.keystore`; keep it if you want to install future updates without uninstalling. The resulting APK and checksum are in `helper-apk/dist/`.

## References

The architecture follows public Android APIs. External recorder projects were reviewed as references; their code was not copied.

- [GestureDescription](https://developer.android.com/reference/android/accessibilityservice/GestureDescription) and [dispatchGesture](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#dispatchGesture(android.accessibilityservice.GestureDescription,android.accessibilityservice.AccessibilityService.GestureResultCallback,android.os.Handler))
- [Accessibility screenshot API](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#takeScreenshot(int,java.util.concurrent.Executor,android.accessibilityservice.AccessibilityService.TakeScreenshotCallback))
- [MediaProjection lifecycle and session consent](https://developer.android.com/media/grow/media-projection)
- [AndroTask](https://github.com/BorgorNinja/AndroTask), [TapMacro](https://github.com/schrodinger-leb/TapMacro), and [adb-recorder](https://github.com/darelleluntao/adb-recorder)

## Validation

The development APK is compiled offline, zip-aligned and verified by Android's `apksigner`. An initial Android 17 / API 37 emulator integration run passed 39 checks for taps, swipes, two-finger gestures, PNG screenshots, pause, coordinate replay, queued replay cancellation, ZIP contents and display mismatch rejection. Expanded final-build testing encountered emulator stalls, accessibility rebinding timeouts and an instrumentation process that failed to attach. Therefore the final APK's full end-to-end behavior, Unicode text workflow and MP4 capture are **not yet fully validated**. No physical device has been modified or tested.

The test sources are separate from the shipped helper. To rerun on a dedicated emulator:

```sh
./helper-apk/build.sh
./helper-apk/tests/build.sh
./helper-apk/tests/run.sh emulator-5554
adb -s emulator-5554 shell am instrument -w dev.mota.recorder.tests/dev.mota.recorder.VideoTest
```

The script enables the helper accessibility service on that emulator. The gesture test uses an isolated practice surface; the video test interacts with Android's actual capture-consent dialog and checks MP4 duration and frame decoding. Test sessions stay on the emulator. Do not install the test APK for ordinary use.

## MoTA bridge (0.2.0)

The extension now bundles helper 0.2.0 at `resources/mota-recorder.apk`. The build script refreshes that file. Earlier standalone 0.1.0 links above describe the first development build; install/update through **MoTA: Set Up Recorder Helper** for integration.

`content://dev.mota.recorder.bridge/bootstrap` is a read-only ContentProvider guarded by `android.permission.DUMP` and caller UID 2000 (ADB shell) or 0. It returns a base64 JSON bootstrap containing protocol 1, version, socket name and an installation token. Do not log or publish this response. The abstract `mota.recorder` socket also checks peer UID and authenticates each request. There is no network listener or INTERNET permission. Requests are JSON lines `{id, token, op, params}`; replies are `{id, result}` or `{id, error}`.

Supported operations: `status`, `controls`, `start` (`mode: adb|overlay`), `stop`, `cancel`, `cancelVideo`, `shot` (`actionIndex`), `sessions`, `files` (`session`), `read` (`session`, `path`, `offset`, up to 256 KiB), and `replay` (`session` JSON). File paths and session IDs are restricted; active/finalizing sessions cannot be downloaded. Replay validates action types and display configuration before importing. Status polling supplies capture state and replay progress. MediaProjection still requires Android's consent UI; the extension launches MainActivity to request it and can cancel a pending remote consent request.

ADB mode creates a helper session for screenshots/video but removes its touch overlay and floating controls. The desktop reads physical input through ADB and writes the replayable actions locally, then combines them with helper media on Stop. The helper does not receive raw-device permissions or root privileges.

The final bridge smoke test can run on an emulator using:

```sh
node helper-apk/tests/bridge-smoke.js emulator-5554
```

Pass `--exercise-service` to temporarily enable this helper's accessibility service and test remote passive start, active-file access rejection, Stop, finalized metadata and display mismatch rejection. The script restores the prior accessibility setting and never prints authentication tokens. This option is for dedicated emulator testing, not normal setup.

Integration validation: the MoTA 0.3.0 desktop suite passes 46 tests, and helper 0.2.0 passed 14 real-emulator bridge checks (authentication, path restrictions, passive start/stop, finalized files and display mismatch rejection). These do not establish full physical-input or MediaProjection coverage on every device; the standalone capture limitations above still apply.
