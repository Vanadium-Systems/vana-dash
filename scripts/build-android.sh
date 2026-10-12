#!/usr/bin/env bash
# Builds the Android APK (the native Capacitor shell).
#
# Native rebuilds are rare (only when plugins or the Capacitor config change); web content
# reaches the phone without one, when the app is reopened (remote server.url).
#
# Needs, once per machine:
#   - JAVA_HOME:    a JDK 21
#   - ANDROID_HOME: an Android SDK with cmdline-tools, platforms;android-36, build-tools;36.0.0
#     Both can be set in scripts/build-android.local.env, which git ignores.
#   - the signing key: ~/vana-dash-secrets/vanadash-release.keystore + vanadash-signing.properties
#     (chmod 600, never in git; PKCS12, so keyPassword == storePassword)
#
# Output: frontend/android/app/build/outputs/apk/release/app-release.apk
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f scripts/build-android.local.env ]; then
  # shellcheck disable=SC1091
  . scripts/build-android.local.env
fi
: "${JAVA_HOME:?Set JAVA_HOME to a JDK 21 (see the header of this script)}"
: "${ANDROID_HOME:?Set ANDROID_HOME to an Android SDK (see the header of this script)}"
export JAVA_HOME ANDROID_HOME

pnpm --filter @vana-dash/frontend build
pnpm --filter @vana-dash/frontend exec cap sync android

cd frontend/android
./gradlew assembleRelease
