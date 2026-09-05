#!/usr/bin/env bash
# Esegue i controlli che le note d'ambiente dichiarano, e dice quali sono
# invecchiate.
#
# Ogni riga e' un fatto scritto da qualche parte in `CLAUDE.md` o
# `.claude.local.md`, il comando che lo verifica, e cosa ci si aspetta. Il
# `CLAUDE.md` impone che una nota d'ambiente dica **come si controlla**: questo
# file e' quella regola resa eseguibile.
#
# Aggiungendo una nota d'ambiente, aggiungi una riga qui.

set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT" || exit 1

verdi=0; rossi=0; avvisi=0

# Due cose diverse, e confonderle e' stato il primo difetto di questo script.
# Un FATTO e' cio' che una nota afferma sulla macchina: se non combacia, la nota
# e' invecchiata e va riscritta. Una CONDIZIONE e' uno stato di cui una nota
# avverte: se e' presente, la nota ha ragione **adesso** e va obbedita, non
# corretta.
esito() {  # <atteso: si|no> <descrizione> <cosa-ne-segue>
  local atteso=$1 desc=$2 segue=$3 vero=$4
  if [ "$atteso" = "$vero" ]; then
    printf '  ok      %s\n' "$desc"; verdi=$((verdi + 1))
  else
    printf '  CAMBIATO  %s\n            la nota dice «%s», ma ora e %s\n            → %s\n' \
      "$desc" "$atteso" "$vero" "$segue"; rossi=$((rossi + 1))
  fi
}

ha() { command -v "$1" >/dev/null 2>&1 && echo si || echo no; }
rpmha() { rpm -q "$1" >/dev/null 2>&1 && echo si || echo no; }

echo "== pacchetti di sistema (Fedora) =="
esito si "libxcrypt-compat installato" \
  "il .deb SI costruisce; se torna no, l'fpm incluso muore su libcrypt.so.1" \
  "$(rpmha libxcrypt-compat)"
esito si "wine installato" \
  "Windows SI costruisce da qui; se torna no, NSIS muore con «wine is required»" \
  "$(ha wine)"
esito si "libfuse.so.2 disponibile (pacchetto fuse-libs)" \
  "le AppImage partono native e impostano APPIMAGE; senza serve --appimage-extract-and-run, e allora il download di un aggiornamento viene rifiutato" \
  "$(ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2' && echo si || echo no)"

echo
echo "== strumenti =="
esito si "gh installato" "senza, niente Release ne workflow da riga di comando" "$(ha gh)"
esito si "gh autenticato" \
  "senza, gh chiede il login e ogni comando sulla repo fallisce" \
  "$(gh auth status >/dev/null 2>&1 && echo si || echo no)"
esito si "actionlint installato" \
  "senza, l'hook dei workflow non valida niente e lo dice" \
  "$(ha actionlint)"


echo
echo "== condizioni attive adesso =="
if [ -n "${ELECTRON_RUN_AS_NODE:-}" ]; then
  printf '  ATTIVA  ELECTRON_RUN_AS_NODE=%s in questa shell\n' "$ELECTRON_RUN_AS_NODE"
  printf '          VS Code la esporta nei suoi terminali. Electron esegue il main\n'
  printf '          come Node, require("electron").app e undefined e l app muore su\n'
  printf '          isPackaged. Lanciare con: env -u ELECTRON_RUN_AS_NODE\n'
  avvisi=$((avvisi + 1))
else
  printf '  ok      ELECTRON_RUN_AS_NODE non esportata\n'
fi

echo
echo "== il modulo nativo =="
elettrone=""
[ -f node_modules/electron/path.txt ] &&
  elettrone="node_modules/electron/dist/$(cat node_modules/electron/path.txt)"
if [ -n "$elettrone" ] && [ -x "$elettrone" ]; then
  esito si "better-sqlite3 si istanzia sotto l'ABI di Electron" \
    "se torna no, una build per un'altra piattaforma ha lasciato il .node sbagliato: npx electron-builder install-app-deps" \
    "$(ELECTRON_RUN_AS_NODE=1 "$elettrone" -e "new (require('better-sqlite3'))(':memory:')" >/dev/null 2>&1 && echo si || echo no)"
  esito si "il .node e un ELF, non un PE32+ o un Mach-O" \
    "una cross-build lo sostituisce col binario dell'altro sistema, e npm run dev muore su un header illeggibile" \
    "$(file -b node_modules/better-sqlite3/build/Release/better_sqlite3.node 2>/dev/null | grep -q '^ELF' && echo si || echo no)"
else
  printf '  saltato   il modulo nativo: node_modules incompleto (npm ci)\n'
fi

echo
if [ "$rossi" -eq 0 ]; then
  echo "Tutte le note corrispondono alla macchina ($verdi controlli)."
  [ "$avvisi" -gt 0 ] && echo "$avvisi condizione/i attiva/e: le note hanno ragione adesso, obbediscile."
else
  echo "$rossi note su $((verdi + rossi)) non corrispondono piu: vanno riscritte dove sono."
  echo "Cercale con: grep -rn 'wine\\|fuse\\|libxcrypt\\|actionlint' CLAUDE.md .claude.local.md .claude/skills/"
fi
exit 0
