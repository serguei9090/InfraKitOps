#!/bin/bash
# Builds a .deb package for InfraKit Studio.
#
# ** UNTESTED — written on a Windows-only dev machine with no Linux
# environment to verify against. Needs a real run on Linux (or a CI runner)
# before being trusted: `flutter build linux` itself, dpkg-deb's exact
# flags on the target dpkg version, and `dpkg -i`/`apt install ./*.deb`
# actually installing and launching cleanly are all unverified. **
#
# Requires: Flutter SDK with Linux desktop support enabled, dpkg-deb.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUNDLE_DIR="$REPO_ROOT/build/linux/x64/release/bundle"
STAGE_DIR="$REPO_ROOT/build/deb_stage"
PKG_NAME="infrakit-studio"
VERSION="1.0.0"

echo "==> flutter build linux"
(cd "$REPO_ROOT" && flutter build linux)

echo "==> flutter build web"
(cd "$REPO_ROOT" && flutter build web)

echo "==> Copying web/ build into the Linux bundle (adjacent-folder delivery model)"
rm -rf "$BUNDLE_DIR/web"
cp -r "$REPO_ROOT/build/web" "$BUNDLE_DIR/web"

echo "==> Staging .deb tree"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/DEBIAN" \
         "$STAGE_DIR/usr/lib/$PKG_NAME" \
         "$STAGE_DIR/usr/bin" \
         "$STAGE_DIR/usr/share/applications" \
         "$STAGE_DIR/usr/share/icons/hicolor/512x512/apps"

cp -r "$BUNDLE_DIR"/* "$STAGE_DIR/usr/lib/$PKG_NAME/"
cp "$SCRIPT_DIR/debian/control" "$STAGE_DIR/DEBIAN/control"
cp "$SCRIPT_DIR/infrakit-studio.desktop" "$STAGE_DIR/usr/share/applications/"
cp "$REPO_ROOT/web/icons/Icon-512.png" "$STAGE_DIR/usr/share/icons/hicolor/512x512/apps/infrakit-studio.png"

cat > "$STAGE_DIR/usr/bin/$PKG_NAME" <<'WRAPPER'
#!/bin/sh
exec /usr/lib/infrakit-studio/infrakit_studio "$@"
WRAPPER
chmod +x "$STAGE_DIR/usr/bin/$PKG_NAME"
chmod +x "$STAGE_DIR/usr/lib/$PKG_NAME/infrakit_studio"

echo "==> Building .deb"
mkdir -p "$REPO_ROOT/build/installer"
dpkg-deb --build --root-owner-group "$STAGE_DIR" "$REPO_ROOT/build/installer/${PKG_NAME}_${VERSION}_amd64.deb"

echo "==> Done: build/installer/${PKG_NAME}_${VERSION}_amd64.deb"
echo "    Verify with: sudo apt install ./build/installer/${PKG_NAME}_${VERSION}_amd64.deb"
echo "    Then: infrakit-studio           (GUI)"
echo "          infrakit-studio --serve --port 8080   (headless web server)"
