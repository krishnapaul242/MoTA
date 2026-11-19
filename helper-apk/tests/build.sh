#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
SDK_PATH="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
JDK_PATH="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
TOOLS="$SDK_PATH/build-tools/${BUILD_TOOLS_VERSION:-36.0.0}"
ANDROID_JAR="$SDK_PATH/platforms/${ANDROID_PLATFORM:-android-36}/android.jar"
mkdir -p build/test-classes build/test-dex
"$TOOLS/aapt2" link -o build/test-base.apk -I "$ANDROID_JAR" --manifest tests/AndroidManifest.xml
"$JDK_PATH/bin/javac" -encoding UTF-8 -source 8 -target 8 -bootclasspath "$TOOLS/core-lambda-stubs.jar:$ANDROID_JAR" -cp build/classes -d build/test-classes tests/SmokeTest.java tests/VideoTest.java
"$JDK_PATH/bin/jar" cf build/test-classes.jar -C build/test-classes .
"$JDK_PATH/bin/java" -cp "$TOOLS/lib/d8.jar" com.android.tools.r8.D8 --lib "$ANDROID_JAR" --classpath build/classes.jar --min-api 29 --output build/test-dex build/test-classes.jar
cp build/test-base.apk build/test-unsigned.apk
(cd build/test-dex && /usr/bin/zip -q ../test-unsigned.apk classes*.dex)
"$TOOLS/zipalign" -f -p 4 build/test-unsigned.apk build/test-aligned.apk
"$JDK_PATH/bin/java" -jar "$TOOLS/lib/apksigner.jar" sign --ks debug.keystore --ks-pass pass:android --out dist/mota-recorder-tests.apk build/test-aligned.apk
