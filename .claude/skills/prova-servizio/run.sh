#!/usr/bin/env bash
# Esegue un harness contro un database vero, sotto l'ABI di Electron. Uso:
#   run.sh <harness.ts>
#
# I test girano su Node e non possono toccare il database (documento 6 §2): è il
# guardrail, e vale per Vitest. Questa è l'altra strada, quella che il documento
# 6 §5 indica — «uno script separato eseguito sotto Electron, non Vitest» — per i
# difetti che le funzioni pure non possono avere e i tipi non vedono: un rifiuto
# che perde il proprio messaggio, una transazione che non torna indietro, una
# guardia che non scatta perché la query che la alimenta guarda altrove.
#
# Tre dettagli, ognuno costato un giro:
#
# 1. **Il binario di Electron non si scrive a mano.** Il pacchetto registra il
#    proprio percorso in dist/path.txt, che differisce fra Linux e macOS: un
#    percorso cablato funziona su una macchina e muore sull'altra con un «No such
#    file or directory» che sembra un'installazione rotta (CLAUDE.md, Due macchine).
# 2. **NODE_PATH esplicito.** Il bundle finisce fuori dal progetto, e da lì
#    `require('better-sqlite3')` non risolve.
# 3. **better-sqlite3 e drizzle restano esterni.** Impacchettarli dentro il
#    bundle vorrebbe dire portarsi appresso un modulo nativo compilato altrove.
set -uo pipefail

HARNESS=${1:?serve il percorso del file .ts da eseguire}
ROOT=${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}
cd "$ROOT" || exit 1

[ -f "$HARNESS" ] || { echo "non trovo $HARNESS" >&2; exit 1; }
[ -x node_modules/.bin/esbuild ] || { echo "esbuild non c'è: npm ci" >&2; exit 1; }

# `path.txt` sta in node_modules/electron/, non sotto dist/, e contiene il nome
# del binario dentro dist/ — `electron` su Linux, Electron.app/… su macOS.
ELECTRON_BIN=""
if [ -f node_modules/electron/path.txt ]; then
  ELECTRON_BIN="node_modules/electron/dist/$(cat node_modules/electron/path.txt)"
fi
[ -x "$ELECTRON_BIN" ] || {
  echo "il binario di Electron non c'è: npm ci && npx electron-builder install-app-deps" >&2
  exit 1
}

OUT=$(mktemp -d)/harness.cjs
trap 'rm -rf "$(dirname "$OUT")"' EXIT

node_modules/.bin/esbuild "$HARNESS" \
  --bundle --platform=node --format=cjs \
  --external:better-sqlite3 --external:drizzle-orm \
  --outfile="$OUT" --log-level=error || exit 1

# `env -u` non serve qui — al contrario delle app, questo *vuole* essere Node.
NODE_PATH="$ROOT/node_modules" ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" "$OUT"
