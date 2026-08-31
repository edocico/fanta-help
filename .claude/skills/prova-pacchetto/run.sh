#!/usr/bin/env bash
# Launch the app and print what it renders. Usage:
#   run.sh dev  [port]   build, then run out/ with the local electron
#   run.sh pack [port]   build + package for the host, then run it
#                        (macOS: dmg, then the .app · Linux: AppImage)
#
# Three traps are encoded here; none of them announce themselves when hit.
#
# 1. ELECTRON_RUN_AS_NODE=1 is exported by VS Code into its terminals. Left set,
#    Electron runs the main script as plain Node, `require('electron').app` is
#    undefined, and the app dies on `isPackaged` without ever naming the cause.
# 2. `pkill -f <pattern>` kills the calling shell: Claude Code's Bash tool wraps
#    each command in `bash -c 'eval "<full text>"'`, so the pattern string is in
#    the wrapper's own cmdline and matches itself. Everything here kills by PID.
# 3. Fedora ships no FUSE2, so the AppImage needs --appimage-extract-and-run.
set -uo pipefail

MODE=${1:-dev}
PORT=${2:-9222}
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)

# The electron package records its own binary path, which differs per platform:
# `electron` on Linux, `Electron.app/Contents/MacOS/Electron` on macOS. Reading
# it beats any `case $(uname)`.
ELECTRON_BIN=""
[ -f "$ROOT/node_modules/electron/path.txt" ] &&
  ELECTRON_BIN="$ROOT/node_modules/electron/dist/$(cat "$ROOT/node_modules/electron/path.txt")"

# Always package for the host architecture. The point is not x64 as such: a
# cross-arch build rebuilds better-sqlite3 for the wrong ABI and leaves it
# there, breaking `npm run dev` until `electron-builder install-app-deps` runs.
case "$(uname -m)" in
  arm64 | aarch64) ARCH_FLAG=--arm64 ;;
  *) ARCH_FLAG=--x64 ;;
esac
HERE=$(cd "$(dirname "$0")" && pwd)
RUNTIME=$HERE/.run
mkdir -p "$RUNTIME"
cd "$ROOT" || exit 1

# --- stop whatever the previous run left behind, by PID only ----------------
if [ -f "$RUNTIME/app.pid" ]; then
  old=$(cat "$RUNTIME/app.pid")
  if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
    pkill -P "$old" 2>/dev/null   # children, matched by parent — never by pattern
    kill "$old" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 "$old" 2>/dev/null || break; sleep 0.25; done
    kill -9 "$old" 2>/dev/null
  fi
  rm -f "$RUNTIME/app.pid"
fi

echo "== build =="
npm run build 2>&1 | tail -4 || exit 1

if [ "$MODE" = "pack" ]; then
  echo "== packaging ($ARCH_FLAG, architettura dell'host) =="
  if [ "$(uname -s)" = "Darwin" ]; then
    npx electron-builder --mac dmg "$ARCH_FLAG" 2>&1 | tail -6
    APP=$(ls -td "$ROOT"/release/mac*/*.app 2>/dev/null | head -1)
    [ -n "$APP" ] || { echo ".app non prodotta: guarda le righe ⨯ qui sopra"; exit 1; }
    # The executable inside the bundle carries the productName, not the file name.
    BIN="$APP/Contents/MacOS/$(basename "${APP%.app}")"
    echo "== avvio del pacchetto: $(basename "$APP") =="
    env -u ELECTRON_RUN_AS_NODE nohup "$BIN" \
      --remote-debugging-port="$PORT" > "$RUNTIME/app.log" 2>&1 &
  else
    npx electron-builder --linux AppImage "$ARCH_FLAG" 2>&1 | tail -6
    APP=$(ls -t "$ROOT"/release/*.AppImage 2>/dev/null | head -1)
    [ -n "$APP" ] || { echo "AppImage non prodotta: guarda le righe ⨯ qui sopra"; exit 1; }
    echo "== avvio del pacchetto: $(basename "$APP") =="
    env -u ELECTRON_RUN_AS_NODE nohup "$APP" --appimage-extract-and-run \
      --remote-debugging-port="$PORT" > "$RUNTIME/app.log" 2>&1 &
  fi
else
  echo "== avvio in sviluppo =="
  [ -n "$ELECTRON_BIN" ] || { echo "electron non installato: manca node_modules/electron/path.txt"; exit 1; }
  env -u ELECTRON_RUN_AS_NODE nohup "$ELECTRON_BIN" . \
    --remote-debugging-port="$PORT" > "$RUNTIME/app.log" 2>&1 &
fi

echo $! > "$RUNTIME/app.pid"
sleep 3
PORT="$PORT" node "$HERE/probe.mjs"
rc=$?

echo
echo "== log (prime righe) =="
head -6 "$RUNTIME/app.log"
echo
echo "L'app resta aperta. Per chiuderla:  kill \$(cat '$RUNTIME/app.pid')"
exit $rc
