#!/usr/bin/env bash
# Launch the app and print what it renders. Usage:
#   run.sh dev  [port]   build, then run out/ with the local electron
#   run.sh pack [port]   build + package (x64), then run the AppImage
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
  echo "== packaging (solo x64) =="
  # x64 only on purpose: electron-builder.yml pins [x64, arm64], and a cross-arch
  # build rebuilds better-sqlite3 for the wrong ABI and leaves it there, which
  # breaks `npm run dev` until `electron-builder install-app-deps` is re-run.
  npx electron-builder --linux AppImage --x64 2>&1 | tail -6
  APP=$(ls -t "$ROOT"/release/*.AppImage 2>/dev/null | head -1)
  [ -n "$APP" ] || { echo "AppImage non prodotta: guarda le righe ⨯ qui sopra"; exit 1; }
  echo "== avvio del pacchetto: $(basename "$APP") =="
  env -u ELECTRON_RUN_AS_NODE nohup "$APP" --appimage-extract-and-run \
    --remote-debugging-port="$PORT" > "$RUNTIME/app.log" 2>&1 &
else
  echo "== avvio in sviluppo =="
  env -u ELECTRON_RUN_AS_NODE nohup node_modules/electron/dist/electron . \
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
