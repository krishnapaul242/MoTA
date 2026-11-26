# Recordings and replay

Run **MoTA: Recordings**, or choose **Recordings** from a ready device's context menu.

## Set up the helper

Use **Set up helper** to install the bundled MoTA Recorder 0.2.2 APK (Android 11+). On the device, enable its accessibility service. Android may require **App info → Allow restricted settings** for a sideloaded accessibility app. MoTA does not enable accessibility or approve screen sharing for you.

## Recording modes

**Start recording** asks for a mode, name, optional target app package, and capture options.

=== "ADB input recording"

    Reads physical multitouch events without intercepting them, so interaction feels normal. MoTA checks `getevent -lp` for readable protocol-A or protocol-B touchscreen devices and calibrated X/Y ranges, then detects the active touchscreen from the first contact.

    This mode currently requires the natural display orientation (`rotation = 0`). If Android denies access or exposes an unsupported input protocol, choose overlay mode. The helper's floating controls are hidden in ADB mode; stop from MoTA.

=== "Overlay recording"

    Uses the helper's capture overlay. Each gesture reaches the app after all fingers lift. Use its toolbar for Back, Home, Recents, explicit text insertion, pause and screenshots.

    The overlay has collapsed and expanded layouts. Collapsed shows only a record/stop button and an expand chevron; expanded shows all controls. Expand the menu and drag its status label to reposition it.

=== "Screen video"

    Opens Android's capture-consent dialog. Approve it on the device and choose the entire screen for flows across apps. Video is H.264 MP4 without audio. Protected windows may block capture. Screenshots are attempted at most about once a second.

**Stop** finalizes the helper session and downloads available screenshots/video. The page lists saved sessions with a timestamped action timeline and screenshot thumbnails.

- **Download device session** retrieves an already completed helper recording.
- **Import ZIP** imports the APK's manual export and binds a legacy archive to the selected device. Archives carrying a different MoTA device binding are rejected.

## Replay

Replay checks the device identity, display dimensions, rotation, session completeness and supported action schema before sending anything to the helper. Physical device identity survives changing wireless ADB addresses. Emulator identity also includes its ADB serial, so a different emulator port requires a new recording/import.

Prepare the original starting screen and app state, then choose **Replay on original device** and confirm. An optional target package is launched; this does not reset application data or navigate to the original screen. **Stop** cancels queued actions; an in-flight gesture may finish. `replay-results.json` records completion, cancellation or disconnection and the last reported action index.

While a recording or replay runs, AI sessions can't change that phone. See [Share phones between AI sessions](sharing-phones.md).

## Where recordings are stored

Recordings default to `.mota/recordings` in the first workspace folder, or extension storage when no folder is open. Set [`mota.recordingsDirectory`](settings.md) to an absolute path to choose another location. Each session contains:

- `session.json`, `actions.json`
- available `screenshots/*.png`
- optional `screen.mp4`
- the latest replay result

Recording content can include test text and visible screen content. Files are never uploaded.

## Security

The bridge uses authenticated JSON over an Android abstract socket forwarded through the existing ADB connection. Its bootstrap provider requires Android's DUMP permission and the ADB shell UID. MoTA holds the token in memory, creates a dynamic loopback forwarding port and removes that forwarding when the page closes. The helper does not open a LAN server.

## Limits

- ADB mode decodes touch paths, per-finger start/duration and supported navigation/volume key events. It does not reconstruct arbitrary keyboard text, pressure or exact pointer velocity.
- Input axes are assumed to align with the natural display; verify a short flow on each device/OEM before relying on longer recordings.
- Unsupported or dropped input and gestures exceeding ten strokes or 59 seconds stop recording as incomplete.
- Replay is limited to 10,000 actions and 7 MB of JSON; sessions and archives have a 2 GB media limit.

Recording failures display selectable diagnostic text and a **Copy error details** button with the operation, device, helper state, detected input device and error.
