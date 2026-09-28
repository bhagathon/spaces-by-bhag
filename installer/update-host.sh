#!/bin/sh
# Native messaging host for Settings → Updates → "Update now" in the Spaces extension.
# Chrome can launch this (and only for the Spaces extension ID) but an extension can't
# replace its own files, so this runs the same updater the LaunchAgent runs, right away.
# Protocol: one message in, one out, each a 4-byte little-endian length then JSON.
set -u
DIR="$HOME/Library/Application Support/Spaces"
UPDATER="${SPACES_UPDATER:-$DIR/updater.sh}"
EXT_DIR="${SPACES_EXT_DIR:-$DIR/extension}"
LOG="${SPACES_LOG:-$HOME/Library/Logs/Spaces-updater.log}"
export SPACES_EXT_DIR="$EXT_DIR" SPACES_LOG="$LOG"

version() { /usr/bin/plutil -extract version raw -o - "$EXT_DIR/manifest.json" 2>/dev/null || true; }

# Read and discard the request; there is only one command.
/usr/bin/perl -e 'read(STDIN, $l, 4) == 4 or exit; read(STDIN, $m, unpack("V", $l));'

BEFORE=$(version)
/bin/sh "$UPDATER" >/dev/null 2>&1
STATUS=$?
AFTER=$(version)
LAST=$(tail -1 "$LOG" 2>/dev/null || true)

# perl's core JSON::PP does the escaping; the updater's log line can contain anything.
/usr/bin/perl -MJSON::PP -e '
  my ($status, $before, $after, $last) = @ARGV;
  my $out = JSON::PP->new->utf8->canonical->encode({
    ok => $status == 0 ? JSON::PP::true : JSON::PP::false,
    before => $before, after => $after,
    updated => ($before ne $after) ? JSON::PP::true : JSON::PP::false,
    message => $last,
  });
  binmode STDOUT;
  print pack("V", length $out), $out;
' "$STATUS" "$BEFORE" "$AFTER" "$LAST"
