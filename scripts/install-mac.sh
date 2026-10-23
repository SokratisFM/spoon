#!/bin/sh
# Copies the freshly built Spoon.app into /Applications (or ~/Applications if that isn't
# writable), quitting a running copy first. Spotlight picks it up from either place.
set -e
cd "$(dirname "$0")/.."

APP="dist.noindex/mac-arm64/Spoon.app"
[ -d "$APP" ] || { echo "No build found at $APP. Run: npm run dist:mac"; exit 1; }

DEST=/Applications
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }

osascript -e 'tell application id "com.sokratis.spoon" to quit' >/dev/null 2>&1 || true
sleep 1
rm -rf "$DEST/Spoon.app"
ditto "$APP" "$DEST/Spoon.app"
mdimport "$DEST/Spoon.app" 2>/dev/null || true # index right away so Spotlight finds it
echo "Installed $DEST/Spoon.app"
