#!/usr/bin/env bash
# Rompi una guardia apposta e guarda se i test se ne accorgono. Uso:
#   muta.sh <file-da-mutare> <file-mutazioni> [file-di-test]
#
# Il file delle mutazioni è TSV: descrizione <TAB> espressione per `perl -0pi -e`.
# Le righe vuote e quelle che iniziano con # si saltano.
#
# Quattro cose che un ciclo scritto a mano dimentica, e che sono il motivo per
# cui questo script esiste:
#
# 1. **Il totale, non solo i falliti.** Se la mutazione rompe la sintassi, Vitest
#    scarta il file e mostra *meno* test: `21 passed (21)` dove prima erano 29
#    non è una guardia che ha retto, è una prova che non è stata eseguita.
# 2. **L'espressione che non combacia.** Un `perl` che non sostituisce niente
#    lascia il file identico, i test passano, e sembra una guardia inerte quando
#    invece è la mutazione a non essere mai stata applicata. Qui il file viene
#    confrontato prima e dopo.
# 3. **Il ripristino.** Un `trap` rimette il file a posto anche se Vitest muore o
#    se interrompi a metà: mutato il codice, dimenticato il ripristino, e ci si
#    ritrova a fare debug su una funzione rotta apposta.
# 4. **Il binario locale.** `npx vitest` senza vitest installato scarica un
#    pacchetto qualsiasi da internet e muore in modo illeggibile (CLAUDE.md).
set -uo pipefail

TARGET=${1:?serve il file da mutare}
MUTATIONS=${2:?serve il file delle mutazioni}
TESTFILE=${3:-}

ROOT=${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}
cd "$ROOT" || exit 1

[ -f "$TARGET" ] || { echo "non trovo $TARGET" >&2; exit 1; }
[ -f "$MUTATIONS" ] || { echo "non trovo $MUTATIONS" >&2; exit 1; }
[ -x node_modules/.bin/vitest ] || {
  echo "vitest non è installato: npm ci" >&2; exit 1
}

BACKUP=$(mktemp)
cp "$TARGET" "$BACKUP"
trap 'cp "$BACKUP" "$TARGET"; rm -f "$BACKUP"' EXIT

# L'ultima riga «Tests …» di Vitest, che porta sia i falliti sia il totale:
#   Tests  102 passed (102)
#   Tests  1 failed | 101 passed (102)
run_tests() {
  node_modules/.bin/vitest run ${TESTFILE:+"$TESTFILE"} 2>&1 |
    grep -E '^ *Tests +' | tail -1
}
totale() { printf '%s' "$1" | sed -n 's/.*(\([0-9]\+\)).*/\1/p'; }
falliti() { printf '%s' "$1" | sed -n 's/.*Tests *\([0-9]\+\) failed.*/\1/p'; }

base=$(run_tests)
BASE_TOT=$(totale "$base")
[ -n "$BASE_TOT" ] || { echo "non riesco a leggere il totale dei test:
$base" >&2; exit 1; }
printf 'base: %s test\n\n' "$BASE_TOT"

sopravvissute=0
guaste=0

while IFS=$'\t' read -r desc expr; do
  case "$desc" in ''|'#'*) continue ;; esac
  [ -n "${expr:-}" ] || { printf '%-52s  MANCA L'"'"'ESPRESSIONE\n' "$desc"; continue; }

  cp "$BACKUP" "$TARGET"
  perl -0pi -e "$expr" "$TARGET" 2>/dev/null

  if cmp -s "$BACKUP" "$TARGET"; then
    printf '%-52s  ESPRESSIONE NON APPLICATA (il file non è cambiato)\n' "$desc"
    guaste=$((guaste + 1))
    continue
  fi

  out=$(run_tests)
  tot=$(totale "$out")
  fail=$(falliti "$out")

  if [ "$tot" != "$BASE_TOT" ]; then
    printf '%-52s  FILE SCARTATO: %s test invece di %s — %s\n' \
      "$desc" "${tot:-nessun}" "$BASE_TOT" "$out"
    guaste=$((guaste + 1))
  elif [ -z "$fail" ]; then
    printf '%-52s  SOPRAVVISSUTA — nessun test se ne accorge\n' "$desc"
    sopravvissute=$((sopravvissute + 1))
  else
    printf '%-52s  uccisa (%s falliti)\n' "$desc" "$fail"
  fi
done < "$MUTATIONS"

cp "$BACKUP" "$TARGET"
echo
if [ "$sopravvissute" -gt 0 ] || [ "$guaste" -gt 0 ]; then
  printf 'da guardare: %s sopravvissute, %s prove non valide\n' "$sopravvissute" "$guaste"
  exit 1
fi
echo 'tutte uccise, e il totale non si è mosso'
