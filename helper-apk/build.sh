#!/bin/bash
# Offline, dependency-free Android build using installed SDK tools and a JDK.
set -euo pipefail
cd "$(dirname "$0")"
SDK_PATH="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
JDK_PATH="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
TOOLS="$SDK_PATH/build-tools/${BUILD_TOOLS_VERSION:-36.0.0}"
ANDROID_JAR="$SDK_PATH/platforms/${ANDROID_PLATFORM:-android-36}/android.jar"
for tool in "$TOOLS/aapt2" "$TOOLS/zipalign" "$JDK_PATH/bin/javac"; do
  if [[ ! -x "$tool" ]]; then echo "Missing tool: $tool" >&2; exit 1; fi
done
mkdir -p build/generated build/classes build/dex dist
"$TOOLS/aapt2" compile --dir res -o build/resources.zip
"$TOOLS/aapt2" link --debug-mode -o build/base.apk -I "$ANDROID_JAR" --manifest AndroidManifest.xml --java build/generated build/resources.zip
find src build/generated -name '*.java' -print > build/sources.txt
"$JDK_PATH/bin/javac" -encoding UTF-8 -source 8 -target 8 -bootclasspath "$TOOLS/core-lambda-stubs.jar:$ANDROID_JAR" -d build/classes @build/sources.txt
"$JDK_PATH/bin/jar" cf build/classes.jar -C build/classes .
"$JDK_PATH/bin/java" -cp "$TOOLS/lib/d8.jar" com.android.tools.r8.D8 --lib "$ANDROID_JAR" --min-api 30 --output build/dex build/classes.jar
cp build/base.apk build/unsigned.apk
(cd build/dex && /usr/bin/zip -q ../unsigned.apk classes*.dex)
"$TOOLS/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk
if [[ ! -f debug.keystore ]]; then
  "$JDK_PATH/bin/keytool" -genkeypair -keystore debug.keystore -storepass android -keypass android -alias androiddebugkey -dname 'CN=MoTA Development,O=MoTA,C=IN' -keyalg RSA -keysize 2048 -validity 10000 -noprompt
fi
"$JDK_PATH/bin/java" -jar "$TOOLS/lib/apksigner.jar" sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android --out dist/mota-recorder-0.2.2.apk build/aligned.apk
"$JDK_PATH/bin/java" -jar "$TOOLS/lib/apksigner.jar" verify --verbose dist/mota-recorder-0.2.2.apk
shasum -a 256 dist/mota-recorder-0.2.2.apk > dist/SHA256SUMS
printf '\nAPK: %s/dist/mota-recorder-0.2.2.apk\n' "$PWD"

mkdir -p ../resources
cp dist/mota-recorder-0.2.2.apk ../resources/mota-recorder.apk
