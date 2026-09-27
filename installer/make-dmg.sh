#!/usr/bin/env bash
# Build release/Spaces-<version>.dmg: an "Install Spaces" app carrying the built extension.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
STAGE=release/dmg-stage
APP="$STAGE/Install Spaces.app"
DMG="release/Spaces-${VERSION}.dmg"

npm run -s build
rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"

sed "s/__VERSION__/${VERSION}/" installer/install.applescript > release/install.applescript
osacompile -o "$APP" release/install.applescript
cp -R dist "$APP/Contents/Resources/extension"
. installer/update.conf
sed "s#__UPDATE_URL__#https://storage.googleapis.com/${BUCKET}/latest.json#" installer/updater.sh > "$APP/Contents/Resources/updater.sh"
cp installer/updater.plist "$APP/Contents/Resources/updater.plist"
# Adding resources invalidates the applet's signature; re-sign ad hoc so macOS
# doesn't report the app as damaged.
codesign --force --deep --sign - "$APP"

cat > "$STAGE/Read me.txt" <<TXT
Spaces ${VERSION}

Open "Install Spaces" to install or update the Spaces Chrome extension.

First time: macOS may say the app is from an unidentified developer. Right-click
"Install Spaces", choose Open, then Open again. Chrome then needs one confirmation
(Developer mode, Load unpacked); the installer walks you through it.

Updates are automatic. A small background task checks for new versions at login
and every 6 hours, and Chrome switches to them within 10 minutes (or on restart).
Log: ~/Library/Logs/Spaces-updater.log

The extension lives in ~/Library/Application Support/Spaces/extension.

To turn off automatic updates:
  launchctl bootout gui/\$(id -u) ~/Library/LaunchAgents/com.bhagathon.spaces.updater.plist
  rm ~/Library/LaunchAgents/com.bhagathon.spaces.updater.plist
TXT

hdiutil create -quiet -volname "Spaces ${VERSION}" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
rm -rf "$STAGE" release/install.applescript
echo "$DMG"
