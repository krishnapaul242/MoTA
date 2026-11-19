# Managed test phones

Some phones restrict ADB. For example, Xiaomi's "USB debugging (Security settings)" needs a SIM and Mi account before `adb install`, `pm grant` or input injection work. A dedicated test phone can instead have the MoTA helper as its **device owner**.

## Set up a managed phone

1. In the device farm, choose **Add device → Managed setup**.
2. Optionally enter Wi-Fi details, then select **Create setup QR**.
3. Factory reset the phone, tap its first setup screen six times, and scan the code. Don't add a Google or Mi account.
4. The phone downloads the helper from this computer and finishes setup with it.
5. Afterwards, turn on Developer options, USB debugging and the helper's accessibility service on the phone.

The farm tags the phone **Managed**.

## How the setup is served

The extension serves only the bundled helper, at a random path on the chosen local address, for 15 minutes or until you select **Stop serving** or close the farm. The QR pins the helper's signing certificate, so the phone rejects any other file. The phone must reach this computer on the local network, and macOS may ask to allow incoming connections.

!!! warning
    A Wi-Fi password in the QR is readable by anyone who scans it.

## Behaviour on managed phones

- **Farm defaults** keeps managed phones awake while charging and postpones system updates for 30 days.
- On phones that reject `adb shell input` (Xiaomi's `INJECT_EVENTS` error), taps, swipes, keys and text in the farm and device pages go through the helper's accessibility service instead. MIUI also blocks enabling that service over ADB, so turn it on once on the phone.
- **MoTA: Set Up Recorder Helper** updates a managed phone's helper through the helper itself when `adb install` is blocked.

Device-owner setup needs Android 10 or newer and is undone by a factory reset. Some regional firmware omits the six-tap QR option.
