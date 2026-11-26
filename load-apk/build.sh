#!/bin/bash
# Builds the MoTA load apps: one small app, packaged COUNT times under different package IDs
# (dev.mota.load.a01, a02, …), so Android treats them as separate apps. Offline; uses installed SDK tools and a JDK.
set -euo pipefail
cd "$(dirname "$0")"
VERSION=0.1.1
VERSION_CODE=2
COUNT="${COUNT:-12}"
PREFIX=dev.mota.load.a
SDK_PATH="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
JDK_PATH="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
TOOLS="$SDK_PATH/build-tools/${BUILD_TOOLS_VERSION:-36.0.0}"
ANDROID_JAR="$SDK_PATH/platforms/${ANDROID_PLATFORM:-android-36}/android.jar"
# The same key as the helper app, so both come from one signer.
KEYSTORE=../helper-apk/debug.keystore
for tool in "$TOOLS/aapt2" "$TOOLS/zipalign" "$JDK_PATH/bin/javac"; do
  if [[ ! -x "$tool" ]]; then echo "Missing tool: $tool" >&2; exit 1; fi
done
if [[ ! -f "$KEYSTORE" ]]; then echo "Missing $KEYSTORE: run helper-apk/build.sh once to create it." >&2; exit 1; fi
rm -rf build && mkdir -p build/classes build/dex
find src -name '*.java' -print > build/sources.txt
"$JDK_PATH/bin/javac" -encoding UTF-8 -source 8 -target 8 -Xlint:-options -bootclasspath "$TOOLS/core-lambda-stubs.jar:$ANDROID_JAR" -d build/classes @build/sources.txt
"$JDK_PATH/bin/jar" cf build/classes.jar -C build/classes .
"$JDK_PATH/bin/java" -cp "$TOOLS/lib/d8.jar" com.android.tools.r8.D8 --release --lib "$ANDROID_JAR" --min-api 29 --output build/dex build/classes.jar
OUT=../resources/load
rm -rf "$OUT" && mkdir -p "$OUT"
for n in $(seq 1 "$COUNT"); do
  id=$(printf '%02d' "$n")
  mkdir -p "build/$id"
  sed -e "s/__PKG__/$PREFIX$id/g" -e "s/__LABEL__/MoTA Load $id/g" -e "s/__VERSION_CODE__/$VERSION_CODE/g" -e "s/__VERSION__/$VERSION/g" AndroidManifest.xml > "build/$id/AndroidManifest.xml"
  "$TOOLS/aapt2" link -o "build/$id/unsigned.apk" -I "$ANDROID_JAR" --manifest "build/$id/AndroidManifest.xml"
  (cd build/dex && /usr/bin/zip -q "../$id/unsigned.apk" classes*.dex)
  "$TOOLS/zipalign" -f -p 4 "build/$id/unsigned.apk" "build/$id/aligned.apk"
  "$JDK_PATH/bin/java" -jar "$TOOLS/lib/apksigner.jar" sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android --out "$OUT/mota-load-$id.apk" "build/$id/aligned.apk"
  rm -f "$OUT/mota-load-$id.apk.idsig"
done
"$JDK_PATH/bin/java" -jar "$TOOLS/lib/apksigner.jar" verify "$OUT/mota-load-01.apk"
printf '{"version":"%s","versionCode":%s,"count":%s,"packagePrefix":"%s"}\n' "$VERSION" "$VERSION_CODE" "$COUNT" "$PREFIX" > "$OUT/load.json"
printf '\n%s load apps in %s\n' "$COUNT" "$(cd "$OUT" && pwd)"
ls -l "$OUT" | head -5
