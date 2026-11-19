# Getting started

## Install ADB

Install Node.js 22+ and Android SDK Platform Tools. Make `adb` available on PATH, set `ANDROID_HOME` / `ANDROID_SDK_ROOT`, or set [`mota.adbPath`](settings.md) to its full executable path.

## Install the extension

Build an installable package from a checkout and install it:

```sh
npm install
npm run package
code --install-extension mota-android-<version>.vsix
```

## First steps

1. Open your Android or React Native project in VS Code.
2. In Explorer, expand **Devices** and **APKs**.
3. Connect a phone over USB, or run **MoTA: Pair Device with QR** (see [Pair and connect](connecting.md)).
4. Click a ready device to open its [device control page](device-controls.md).

!!! note
    MoTA requires a trusted workspace. With Remote SSH or containers, ADB runs on the remote extension host, which needs network access to the phone.
