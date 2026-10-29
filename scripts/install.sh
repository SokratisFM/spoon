#!/bin/sh
# Installs (or reinstalls) Spoon on macOS:
#   curl -fsSL https://github.com/__REPO__/releases/latest/download/install.sh | sh
# Downloading with curl keeps macOS from flagging the app, so it opens without a security prompt.
set -e

BASE="${SPOON_DOWNLOAD_BASE:-https://github.com/__REPO__/releases/latest/download}"
DEST="${SPOON_INSTALL_DIR:-/Applications}"

[ "$(uname)" = Darwin ] || { echo "This installer is for macOS. On Windows, use install.ps1."; exit 1; }
if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi

case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  *) ARCH=x64 ;;
esac
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# The release's checksum list names its one zip per chip (Spoon-<version>-mac-<chip>.zip).
curl -fsSL "$BASE/SHA256SUMS" -o "$TMP/SHA256SUMS"
line=$(grep -E " Spoon-[0-9][^ ]*-mac-$ARCH\.zip\$" "$TMP/SHA256SUMS" | head -n 1)
ZIP=$(echo "$line" | cut -d' ' -f3)
expected=$(echo "$line" | cut -d' ' -f1)
[ -n "$ZIP" ] || { echo "This release has no Mac download for $ARCH."; exit 1; }

echo "Downloading $ZIP…"
curl -fL --progress-bar "$BASE/$ZIP" -o "$TMP/Spoon.zip"
actual=$(shasum -a 256 "$TMP/Spoon.zip" | cut -d' ' -f1)
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  echo "The download doesn't match its checksum. Nothing was installed."
  exit 1
fi

ditto -x -k "$TMP/Spoon.zip" "$TMP/unpacked"
osascript -e 'tell application id "com.sokratis.spoon" to quit' >/dev/null 2>&1 || true
rm -rf "$DEST/Spoon.app"
ditto "$TMP/unpacked/Spoon.app" "$DEST/Spoon.app"
xattr -dr com.apple.quarantine "$DEST/Spoon.app" 2>/dev/null || true

echo "Installed $DEST/Spoon.app"
[ -n "$SPOON_NO_LAUNCH" ] || open "$DEST/Spoon.app"
