#!/bin/bash
# Builds an AppImage for InfraKit Studio.
#
# ** UNTESTED — written on a Windows-only dev machine with no Linux
# environment to verify against. Needs a real run on Linux (or a CI
# runner) before being trusted. **
#
# Requires: Flutter SDK with Linux desktop support enabled, and
# `appimagetool` on PATH — get it from
# https://github.com/AppImage/AppImageKit/releases (download the
# appimagetool-x86_64.AppImage, chmod +x it, put it on PATH as
# `appimagetool`).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUNDLE_DIR="$REPO_ROOT/build/linux/x64/release/bundle"
APPDIR="$REPO_ROOT/build/AppDir"

echo "==> flutter build linux"
(cd "$REPO_ROOT" && flutter build linux)

echo "==> flutter build web"
(cd "$REPO_ROOT" && flutter build web)

echo "==> Copying web/ build into the Linux bundle (adjacent-folder delivery model)"
rm -rf "$BUNDLE_DIR/web"
cp -r "$REPO_ROOT/build/web" "$BUNDLE_DIR/web"

echo "==> Staging AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin"
cp -r "$BUNDLE_DIR"/* "$APPDIR/usr/bin/"
cp "$SCRIPT_DIR/AppRun" "$APPDIR/AppRun"
chmod +x "$APPDIR/AppRun"
cp "$SCRIPT_DIR/infrakit-studio.desktop" "$APPDIR/infrakit-studio.desktop"
cp "$REPO_ROOT/web/icons/Icon-512.png" "$APPDIR/infrakit-studio.png"

echo "==> Building AppImage"
mkdir -p "$REPO_ROOT/build/installer"
appimagetool "$APPDIR" "$REPO_ROOT/build/installer/InfraKitStudio-x86_64.AppImage"

echo "==> Done: build/installer/InfraKitStudio-x86_64.AppImage"
echo "    Verify with: chmod +x build/installer/InfraKitStudio-x86_64.AppImage"
echo "                 ./build/installer/InfraKitStudio-x86_64.AppImage          (GUI)"
echo "                 ./build/installer/InfraKitStudio-x86_64.AppImage --serve --port 8080"
