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

[ "$(uname -m)" = arm64 ] || { echo "Spoon is built for Apple Silicon Macs only."; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# INSTALLERS lists "<sha256>  <link>": the full app (in the release that last changed Electron) and,
# when this release only changed Spoon's code, that code, which goes over the app.
curl -fsSL "$BASE/INSTALLERS" -o "$TMP/INSTALLERS"
fetch() { # fetch <pattern> <dest>: download the matching file and check its checksum
  line=$(grep -E "$1\$" "$TMP/INSTALLERS" | head -n 1)
  [ -n "$line" ] || return 1
  url=$(echo "$line" | cut -d' ' -f3)
  expected=$(echo "$line" | cut -d' ' -f1)
  echo "Downloading ${url##*/}…"
  curl -fL --progress-bar "$url" -o "$2"
  actual=$(shasum -a 256 "$2" | cut -d' ' -f1)
  [ "$expected" = "$actual" ] || { echo "The download doesn't match its checksum. Nothing was installed."; exit 1; }
}
fetch '/Spoon-[0-9][^ /]*-mac-arm64\.zip' "$TMP/Spoon.zip" || { echo "This release has no Mac download."; exit 1; }

ditto -x -k "$TMP/Spoon.zip" "$TMP/unpacked"
if fetch '/Spoon-[0-9][^ /]*-mac-arm64-code\.zip' "$TMP/code.zip"; then
  ditto -x -k "$TMP/code.zip" "$TMP/code"
  rsync -a --delete "$TMP/code/Resources/" "$TMP/unpacked/Spoon.app/Contents/Resources/"
  cp "$TMP/code/Info.plist" "$TMP/unpacked/Spoon.app/Contents/Info.plist"
  codesign --force --sign - "$TMP/unpacked/Spoon.app" 2>/dev/null
fi
osascript -e 'tell application id "com.sokratis.spoon" to quit' >/dev/null 2>&1 || true
rm -rf "$DEST/Spoon.app"
ditto "$TMP/unpacked/Spoon.app" "$DEST/Spoon.app"
xattr -dr com.apple.quarantine "$DEST/Spoon.app" 2>/dev/null || true

echo "Installed $DEST/Spoon.app"
[ -n "$SPOON_NO_LAUNCH" ] || open "$DEST/Spoon.app"
