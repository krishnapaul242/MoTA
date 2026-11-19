#!/bin/bash
# Run on a dedicated emulator only. Enables this helper's accessibility service.
set -euo pipefail
cd "$(dirname "$0")/.."
SDK_PATH="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
ADB="$SDK_PATH/platform-tools/adb"
SERIAL="${1:?Usage: tests/run.sh emulator-SERIAL}"
case "$SERIAL" in emulator-*) ;; *) echo 'Use a dedicated emulator; this script changes accessibility settings.' >&2;exit 1;; esac
"$ADB" -s "$SERIAL" wait-for-device
for i in {1..60}; do
  if [[ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed | tr -d '\r')" == 1 ]]; then break; fi
  sleep 1
done
"$ADB" -s "$SERIAL" install --no-incremental -r dist/mota-recorder-0.4.0.apk
"$ADB" -s "$SERIAL" install --no-incremental -r dist/mota-recorder-tests.apk
PREVIOUS="$("$ADB" -s "$SERIAL" shell settings get secure enabled_accessibility_services | tr -d '\r')"
SERVICE=dev.mota.recorder/dev.mota.recorder.RecorderService
if [[ "$PREVIOUS" == null || -z "$PREVIOUS" ]]; then
  ENABLED="$SERVICE"
elif [[ "$PREVIOUS" == *"$SERVICE"* ]]; then
  ENABLED="$PREVIOUS"
else
  ENABLED="$PREVIOUS:$SERVICE"
fi
"$ADB" -s "$SERIAL" shell settings put secure enabled_accessibility_services "$ENABLED"
"$ADB" -s "$SERIAL" shell settings put secure accessibility_enabled 1
TEST_OUTPUT="$("$ADB" -s "$SERIAL" shell am instrument -w dev.mota.recorder.tests/dev.mota.recorder.SmokeTest)"
printf '%s\n' "$TEST_OUTPUT"
[[ "$TEST_OUTPUT" == *"PASS:"* ]]
