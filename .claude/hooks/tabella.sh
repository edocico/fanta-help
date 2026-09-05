#!/usr/bin/env bash
# PostToolUse: le righe della tabella delle trappole devono avere tre pipe.
#
# La tabella delle trappole e' la memoria del progetto: ottanta righe che
# esistono per non far riscoprire cose gia' pagate. Una riga con una pipe nuda
# in mezzo apre una terza colonna e viene troncata li': la meta' che si perde e'
# sempre la seconda, cioe' il *perche'* e il rimedio.
#
# Non e' un caso di scuola. La riga di `pgrep -f` conteneva
# `pgrep -f <pattern> \| while read p; ...` senza protezione, e da quando e'
# stata scritta mostrava 212 caratteri su 500: 288 caratteri di spiegazione
# invisibili a chiunque rendesse il file. Nel sorgente non si vede, e nessuno
# rende il CLAUDE.md — quindi non se ne sarebbe accorto nessuno mai.
#
# E' la forma tipica di questo progetto — una guardia che tace — applicata al
# file che contiene tutte le altre guardie.
#
# Avvisa e basta, come palette e copy: una tabella si puo' anche voler rompere.

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -n "$file" ] || exit 0

case "$file" in
  *CLAUDE.md) ;;
  *) exit 0 ;;
esac

root=${CLAUDE_PROJECT_DIR:-$PWD}
[ -f "$file" ] || file="$root/${file#"$root"/}"
[ -f "$file" ] || exit 0

# Il file intero e non le sole righe aggiunte: una tabella e' una proprieta'
# dell'insieme, e la riga rotta puo' essere arrivata da un altro commit.
note=$(python3 - "$file" <<'PY'
import io, re, sys

righe = io.open(sys.argv[1], encoding='utf-8').read().split('\n')

# Solo la tabella delle trappole: quella dei documenti in cima ha tre colonne
# per progetto, e contarla come rotta sarebbe un falso positivo a ogni modifica.
try:
    inizio = next(i for i, l in enumerate(righe) if l.startswith('| Trappola |'))
except StopIteration:
    sys.exit(0)

rotte = []
for i in range(inizio + 1, len(righe)):
    l = righe[i]
    # La tabella finisce alla prima riga che non comincia per pipe. La riga
    # separatrice, `|---|---|`, non ha lo spazio dopo la pipe: interrompere su
    # `startswith('| ')` fermava il ciclo subito dopo l'intestazione e la
    # guardia non scattava mai. Presa provandola nei due versi.
    if not l.startswith('|'):
        break
    if re.fullmatch(r'\|[-:\s|]+\|', l):
        continue
    n = len(re.findall(r'(?<!\\)\|', l))
    if n != 3:
        titolo = l.split('|')[1].strip()[:48] if '|' in l else l[:48]
        rotte.append((i + 1, n, titolo))

for riga, n, titolo in rotte:
    print(f'riga {riga}: {n} pipe invece di 3 — «{titolo}»')
PY
)

[ -n "$note" ] || exit 0

testo="Righe della tabella delle trappole con una pipe non protetta:

$note

Una pipe nuda apre una colonna in piu' e tronca la riga li': si perde la
seconda meta', che e' dove sta il rimedio. Nel sorgente non si vede. Si
protegge con \\| dentro il testo, anche in mezzo a un blocco di codice
in linea.

Se e' voluto va bene — questa riga non blocca niente."

jq -cn --arg note "$testo" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $note
  }
}'
