#!/bin/sh
# Copies the freshly built Spoon.app into /Applications (or ~/Applications if that isn't
# writable), quitting a running copy first. Spotlight picks it up from either place.
# SPOON_INSTALL_DIR installs somewhere else instead (and leaves a running Spoon alone), for testing.
set -e
cd "$(dirname "$0")/.."

APP="dist.noindex/mac-arm64/Spoon.app"
[ -d "$APP" ] || { echo "No build found at $APP. Run: npm run dist:mac"; exit 1; }

DEST="${SPOON_INSTALL_DIR:-/Applications}"
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
TARGET="$DEST/Spoon.app"

if [ -z "$SPOON_INSTALL_DIR" ]; then
  osascript -e 'tell application id "com.sokratis.spoon" to quit' >/dev/null 2>&1 || true
  sleep 1
fi

# macOS checks an app it hasn't seen before on its first launch, which takes ~2.5 s for an Electron
# app. When the Electron framework is unchanged (any Spoon update that isn't an Electron upgrade),
# only Spoon's own files (Resources and Info.plist) are swapped inside the installed app and its
# signature renewed, so the already-checked framework and helpers stay as they are.
FW="Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework"
full_copy() {
  rm -rf "$TARGET"
  ditto "$APP" "$TARGET"
}
if [ -d "$TARGET" ] && cmp -s "$APP/$FW" "$TARGET/$FW"; then
  rsync -a --checksum --delete "$APP/Contents/Resources/" "$TARGET/Contents/Resources/"
  cp "$APP/Contents/Info.plist" "$TARGET/Contents/Info.plist"
  if codesign --force --sign - "$TARGET" 2>/dev/null && codesign --verify --deep --strict "$TARGET" 2>/dev/null; then
    echo "Updated Spoon's files in place"
  else
    echo "In-place update didn't verify; installing the whole app"
    full_copy
  fi
else
  full_copy
fi
mdimport "$TARGET" 2>/dev/null || true # index right away so Spotlight finds it
echo "Installed $TARGET"
