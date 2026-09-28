#!/bin/sh
# Register update-host.sh with Chrome as the native messaging host behind the
# extension's "Update now" button. Run by the installer; safe to run again.
#   install-update-host.sh <folder holding update-host.sh>
set -eu
SRC="$1"
DIR="$HOME/Library/Application Support/Spaces"
EXT_DIR="$DIR/extension"
HOST="$DIR/update-host.sh"
NAME=com.bhagathon.spaces.updater

mkdir -p "$DIR"
cp "$SRC/update-host.sh" "$HOST"
chmod 755 "$HOST"

# Chrome derives an unpacked extension's ID from its folder path: the first 32 hex
# digits of the path's SHA-256, spelled with the letters a-p.
EXT_ID=$(printf %s "$EXT_DIR" | shasum -a 256 | cut -c1-32 | tr '0-9a-f' 'a-p')

for browser in "Google/Chrome" "Google/Chrome Beta" "Chromium"; do
  base="$HOME/Library/Application Support/$browser"
  [ -d "$base" ] || continue
  mkdir -p "$base/NativeMessagingHosts"
  cat > "$base/NativeMessagingHosts/$NAME.json" <<JSON
{
  "name": "$NAME",
  "description": "Spaces updater",
  "path": "$HOST",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON
done
echo "$EXT_ID"
