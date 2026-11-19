#!/usr/bin/env node
// Prints the Android Enterprise QR provisioning payload that makes MoTA Recorder the device owner.
// Usage: node helper-apk/provisioning-qr.js --url https://host/mota-recorder-0.3.0.apk [--apk path] [--wifi-ssid NAME]
// The Wi-Fi password, if any, is read from MOTA_WIFI_PASSWORD so it stays out of shell history.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const url = arg('--url');
const apk = arg('--apk') || path.join(__dirname, 'dist', 'mota-recorder-0.3.0.apk');
const ssid = arg('--wifi-ssid');
if (!url || !/^https?:\/\/\S+$/.test(url)) { console.error('Pass --url with the http(s) address the phone downloads the APK from.'); process.exit(1); }
if (!fs.existsSync(apk)) { console.error(`APK not found: ${apk}. Run helper-apk/build.sh first.`); process.exit(1); }

const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
const tools = path.join(sdk, 'build-tools', process.env.BUILD_TOOLS_VERSION || '36.0.0');
const java = path.join(process.env.JAVA_HOME || '/Applications/Android Studio.app/Contents/jbr/Contents/Home', 'bin', 'java');
const certs = execFileSync(java, ['-jar', path.join(tools, 'lib/apksigner.jar'), 'verify', '--print-certs', apk], { encoding: 'utf8' });
const digest = /Signer #1 certificate SHA-256 digest: ([0-9a-f]{64})/.exec(certs);
if (!digest) { console.error('Could not read the APK signing certificate.'); process.exit(1); }

const E = 'android.app.extra.';
const payload = {
  [E + 'PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME']: 'dev.mota.recorder/dev.mota.recorder.DeviceOwnerReceiver',
  [E + 'PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION']: url,
  // URL-safe base64 of the signing certificate's SHA-256, without padding. Stable across rebuilds with the same key.
  [E + 'PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM']: Buffer.from(digest[1], 'hex').toString('base64url'),
  // Otherwise fully managed setup disables most preinstalled apps.
  [E + 'PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED']: true,
};
if (ssid) {
  payload[E + 'PROVISIONING_WIFI_SSID'] = ssid;
  const password = process.env.MOTA_WIFI_PASSWORD;
  payload[E + 'PROVISIONING_WIFI_SECURITY_TYPE'] = password ? 'WPA' : 'NONE';
  if (password) payload[E + 'PROVISIONING_WIFI_PASSWORD'] = password;
}
process.stdout.write(JSON.stringify(payload) + '\n');
