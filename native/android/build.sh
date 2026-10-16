#!/usr/bin/env bash
#
# Builds the Studio AutoPilot Android app (an APK to share and install by hand)
# with the Android SDK's own tools -- aidl, aapt2, javac, d8, zipalign,
# apksigner. No Gradle and nothing downloaded, so it builds the same on a
# laptop, in CI and offline.
#
#   ANDROID_HOME=~/Android/Sdk bash native/android/build.sh
#
# Signing (the same key every time, or phones refuse the update and Chrome
# shows the address bar):
#   ANDROID_KEYSTORE           path to the release keystore (.jks / .p12)
#   ANDROID_KEYSTORE_PASSWORD  its password
#   ANDROID_KEY_ALIAS          default: studioautopilot
#   ANDROID_KEY_PASSWORD       default: the keystore password
# Without ANDROID_KEYSTORE it signs with a throwaway key and says so: fine for
# a test, never for studios.
#
# Out: native/android/build/Studio-AutoPilot-<version>.apk
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION_NAME="${VERSION_NAME:-1.0.0}"
VERSION_CODE="${VERSION_CODE:-1}"
MIN_SDK=21
TARGET_SDK=35

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
  echo "Set ANDROID_HOME to the Android SDK." >&2
  exit 1
fi
# The newest stable build-tools (an -rc only when nothing else is installed).
BT_VERSION="$(ls "$SDK/build-tools" | grep -v -- '-rc' | sort -V | tail -1)"
BT="$SDK/build-tools/${BT_VERSION:-$(ls "$SDK/build-tools" | sort -V | tail -1)}"
PLATFORM="$SDK/platforms/android-$TARGET_SDK"
if [ ! -f "$PLATFORM/android.jar" ]; then
  PLATFORM="$SDK/platforms/$(ls "$SDK/platforms" | sort -V | tail -1)"
fi
echo "build-tools: $BT"
echo "platform:    $PLATFORM"

OUT="$HERE/build"
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

# 1. The Custom Tabs service interface (vendored from androidx.browser) -> Java.
for f in "$HERE"/app/aidl/android/support/customtabs/*.aidl; do
  "$BT/aidl" "-p$PLATFORM/framework.aidl" "-I$HERE/app/aidl" "-o$OUT/gen" "$f"
done

# 2. Resources and the manifest -> a resource APK, plus R.java.
"$BT/aapt2" compile --dir "$HERE/app/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/unaligned.apk" \
  -I "$PLATFORM/android.jar" \
  --manifest "$HERE/app/AndroidManifest.xml" \
  --java "$OUT/gen" \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  "$OUT/res.zip"

# 3. Java -> classes -> dex.
find "$HERE/app/java" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options \
  -bootclasspath "$PLATFORM/android.jar" -d "$OUT/classes" @"$OUT/sources.txt"
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
"$BT/d8" --release --min-api "$MIN_SDK" --lib "$PLATFORM/android.jar" --output "$OUT/dex" @"$OUT/classes.txt"
(cd "$OUT/dex" && zip -q -X "$OUT/unaligned.apk" classes.dex)

# 4. Align, then sign (v1 for old phones, v2/v3 for new ones).
"$BT/zipalign" -p -f 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"

APK="$OUT/Studio-AutoPilot-$VERSION_NAME.apk"
if [ -n "${ANDROID_KEYSTORE:-}" ]; then
  : "${ANDROID_KEYSTORE_PASSWORD:?Set ANDROID_KEYSTORE_PASSWORD}"
  export SA_KS_PASS="$ANDROID_KEYSTORE_PASSWORD"
  export SA_KEY_PASS="${ANDROID_KEY_PASSWORD:-$ANDROID_KEYSTORE_PASSWORD}"
  "$BT/apksigner" sign \
    --ks "$ANDROID_KEYSTORE" --ks-key-alias "${ANDROID_KEY_ALIAS:-studioautopilot}" \
    --ks-pass env:SA_KS_PASS --key-pass env:SA_KEY_PASS \
    --min-sdk-version "$MIN_SDK" --out "$APK" "$OUT/aligned.apk"
else
  echo "No ANDROID_KEYSTORE: signing with a throwaway test key." >&2
  APK="$OUT/Studio-AutoPilot-$VERSION_NAME-test-key.apk"
  keytool -genkeypair -keystore "$OUT/test.p12" -storetype PKCS12 -alias test \
    -keyalg RSA -keysize 2048 -validity 365 -storepass testtest -keypass testtest \
    -dname "CN=Studio AutoPilot test key" >/dev/null 2>&1
  "$BT/apksigner" sign --ks "$OUT/test.p12" --ks-key-alias test \
    --ks-pass pass:testtest --key-pass pass:testtest \
    --min-sdk-version "$MIN_SDK" --out "$APK" "$OUT/aligned.apk"
fi

"$BT/apksigner" verify --min-sdk-version "$MIN_SDK" "$APK"
rm -f "$OUT/unaligned.apk" "$OUT/aligned.apk" "$OUT/test.p12"
echo "Built $APK ($(du -h "$APK" | cut -f1))"
