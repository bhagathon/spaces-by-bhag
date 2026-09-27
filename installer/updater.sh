#!/bin/sh
# Spaces updater: keeps ~/Library/Application Support/Spaces/extension at the
# latest version published to Google Cloud Storage. Run by a LaunchAgent at login
# and every few hours. Chrome picks the new files up when the extension reloads
# itself (it checks its own manifest) or at the next Chrome restart.
set -u
UPDATE_URL="${SPACES_UPDATE_URL:-__UPDATE_URL__}"
EXT_DIR="${SPACES_EXT_DIR:-$HOME/Library/Application Support/Spaces/extension}"
LOG="${SPACES_LOG:-$HOME/Library/Logs/Spaces-updater.log}"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }
field() { /usr/bin/plutil -extract "$2" raw -o - "$1" 2>/dev/null; }

TMP=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP"' EXIT

if ! curl -fsSL --max-time 30 -o "$TMP/latest.json" "$UPDATE_URL"; then
  log "check failed: could not fetch $UPDATE_URL"
  exit 0
fi
LATEST=$(field "$TMP/latest.json" version)
ZIP_URL=$(field "$TMP/latest.json" url)
SHA=$(field "$TMP/latest.json" sha256)
CURRENT=$(field "$EXT_DIR/manifest.json" version || true)
[ -n "$CURRENT" ] || CURRENT=0

if [ -z "$LATEST" ] || [ -z "$ZIP_URL" ] || [ -z "$SHA" ]; then
  log "check failed: latest.json is missing version, url or sha256"
  exit 0
fi
# Only ever move forward (sort -V orders versions numerically).
NEWEST=$(printf '%s\n%s\n' "$CURRENT" "$LATEST" | sort -V | tail -1)
if [ "$LATEST" = "$CURRENT" ] || [ "$NEWEST" != "$LATEST" ]; then
  exit 0
fi

if ! curl -fsSL --max-time 300 -o "$TMP/ext.zip" "$ZIP_URL"; then
  log "update $CURRENT -> $LATEST failed: download error"
  exit 0
fi
GOT=$(shasum -a 256 "$TMP/ext.zip" | cut -d' ' -f1)
if [ "$GOT" != "$SHA" ]; then
  log "update $CURRENT -> $LATEST refused: checksum mismatch"
  exit 0
fi
mkdir -p "$TMP/new" && /usr/bin/ditto -x -k "$TMP/ext.zip" "$TMP/new" || { log "update $CURRENT -> $LATEST failed: bad zip"; exit 0; }
if [ "$(field "$TMP/new/manifest.json" version)" != "$LATEST" ]; then
  log "update $CURRENT -> $LATEST refused: zip holds a different version"
  exit 0
fi
mkdir -p "$EXT_DIR"
# Same folder path, new contents: Chrome keeps the extension (and its data) attached.
rsync -a --delete "$TMP/new/" "$EXT_DIR/" || { log "update $CURRENT -> $LATEST failed: copy error"; exit 0; }
log "updated $CURRENT -> $LATEST"
