#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/mobile"
if ! command -v flutter >/dev/null 2>&1; then
  echo 'Flutter is not installed. See https://docs.flutter.dev/get-started/install' >&2
  exit 1
fi
flutter create --project-name relay_walkie --org io.relay.walkie --platforms android,ios .
# flutter create adds a counter-app test that refers to MyApp, which this app does not define.
if grep -q 'MyApp' test/widget_test.dart 2>/dev/null; then rm test/widget_test.dart; fi
python3 tool/configure_native.py
flutter pub get
flutter analyze
printf '\nNative projects and packages configured. See README.md for run commands.\n'
