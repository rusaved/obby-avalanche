#!/usr/bin/env bash
# Chromium for Playwright in the cloud session (docs/02-tech.md 17.2, docs/05 M0 "Окружение").
# The image ships Chromium build 1194 in /opt/pw-browsers, but @playwright/test expects a newer build.
# Path 1: download Chrome for Testing of the exact version Playwright expects
# (node_modules/playwright-core/browsers.json) from storage.googleapis.com, cache it, and write the
# executable path into .cache/chromium-path; playwright.config.ts reads that file (or CHROMIUM_EXECUTABLE).
# In CI (`npx playwright install chromium`) the file is absent and Playwright uses its own browser.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKER_DIR="$ROOT/.cache"
MARKER="$MARKER_DIR/chromium-path"
BROWSERS_JSON="$ROOT/node_modules/playwright-core/browsers.json"

if [ -n "${CHROMIUM_EXECUTABLE:-}" ] && [ -x "$CHROMIUM_EXECUTABLE" ]; then
  mkdir -p "$MARKER_DIR"; printf '%s\n' "$CHROMIUM_EXECUTABLE" > "$MARKER"
  echo "ensure-chromium: using CHROMIUM_EXECUTABLE=$CHROMIUM_EXECUTABLE"; exit 0
fi

if [ ! -f "$BROWSERS_JSON" ]; then
  echo "ensure-chromium: $BROWSERS_JSON not found, run npm ci first" >&2; exit 1
fi

VERSION="$(node -e "const b=require('$BROWSERS_JSON').browsers.find(x=>x.name==='chromium');process.stdout.write(b.browserVersion)")"
REVISION="$(node -e "const b=require('$BROWSERS_JSON').browsers.find(x=>x.name==='chromium');process.stdout.write(b.revision)")"

# Playwright's own download already present (CI or local `playwright install`): nothing to do.
PW_DIR="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if [ -x "$PW_DIR/chromium-$REVISION/chrome-linux/chrome" ]; then
  rm -f "$MARKER"; echo "ensure-chromium: Playwright chromium-$REVISION already installed"; exit 0
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) PLATFORM=linux64 ;;
  *) echo "ensure-chromium: unsupported arch $ARCH" >&2; exit 1 ;;
esac

CACHE_BASE="$PW_DIR"
if ! mkdir -p "$CACHE_BASE" 2>/dev/null || [ ! -w "$CACHE_BASE" ]; then
  CACHE_BASE="$HOME/.cache/chrome-for-testing"; mkdir -p "$CACHE_BASE"
fi
DEST="$CACHE_BASE/cft-$VERSION"
BIN="$DEST/chrome-$PLATFORM/chrome"

if [ ! -x "$BIN" ]; then
  URL="https://storage.googleapis.com/chrome-for-testing-public/$VERSION/$PLATFORM/chrome-$PLATFORM.zip"
  echo "ensure-chromium: downloading Chrome for Testing $VERSION (Playwright chromium build $REVISION)"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  for attempt in 1 2 3; do
    if curl -fsSL --retry 2 -o "$TMP/chrome.zip" "$URL"; then break; fi
    echo "ensure-chromium: download attempt $attempt failed" >&2; sleep $((attempt * 2))
    [ "$attempt" = 3 ] && exit 1
  done
  rm -rf "$DEST"; mkdir -p "$DEST"
  if command -v unzip >/dev/null 2>&1; then unzip -q "$TMP/chrome.zip" -d "$DEST"
  else python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$TMP/chrome.zip" "$DEST"; chmod -R u+x "$DEST"; fi
  [ -x "$BIN" ] || chmod +x "$BIN"
fi

"$BIN" --version >/dev/null 2>&1 || { echo "ensure-chromium: $BIN does not start" >&2; "$BIN" --version; exit 1; }
mkdir -p "$MARKER_DIR"; printf '%s\n' "$BIN" > "$MARKER"
echo "ensure-chromium: ok $("$BIN" --version) at $BIN"
