#!/usr/bin/env bash
# PostToolUse: the two copy rules that keep escaping.
#
# CLAUDE.md fixes the conventions and the reviews keep catching them anyway,
# which is the signature of a rule no test can hold: "intestazioni di colonna e
# valori in minuscolo, titoli di vista e di sezione in sentence case" and "mai
# maiuscolo spaziato". T15 shipped `<h2>in asta</h2>` next to four sibling `h2`
# that all read `Assegna`, `Rose`, `Obiettivi ancora liberi`, `Cronologia`; the
# review found it after the work was done, which is the only moment nobody has
# left.
#
# Two detectors, both narrow on purpose:
#
#   1. `<h1>` or `<h2>` whose literal text starts with a lower-case letter. A
#      heading built from an expression — `<h2>{title}</h2>` — starts with `{`
#      and is left alone, because what it will say is not visible here.
#   2. `uppercase` and `tracking-` in the same class string. That pair *is*
#      spaced capitals in Tailwind, and §2 calls it "il tic più riconoscibile
#      delle interfacce generate".
#
# Newlines are collapsed before matching: JSX puts the `>` and the text on
# different lines as often as not, and a line-anchored pattern would see neither.
#
# **Exit 0, always**, like palette.sh. A lower-case heading can be right — the
# label beside a value is lower case on purpose, `turno` in the auction bar — so
# this makes you look, it does not decide.
set -uo pipefail

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -n "$file" ] || exit 0

case "$file" in
  *.tsx) ;;
  *) exit 0 ;;
esac

root=${CLAUDE_PROJECT_DIR:-$PWD}
rel=${file#"$root"/}

# Only what the edit adds, like boundaries.sh and palette.sh.
added=$(printf '%s' "$payload" | jq -r '
  [ .tool_input.content?,
    .tool_input.new_string?,
    ( .tool_input.edits[]?.new_string? )
  ] | map(select(. != null)) | join("\n")
')
[ -n "$added" ] || exit 0

flat=$(printf '%s' "$added" | tr '\n\t' '  ' | sed 's/  */ /g')

heading=$(printf '%s' "$flat" \
  | grep -oE '<h[12][^>]*> ?[a-zàèéìòù][^<]{0,40}' \
  | head -3)

spaced=$(printf '%s' "$flat" \
  | grep -oE '[^"]*\buppercase\b[^"]*\btracking-[a-z]+[^"]*|[^"]*\btracking-[a-z]+[^"]*\buppercase\b[^"]*' \
  | head -2)

[ -n "$heading$spaced" ] || exit 0

note="Copy da guardare in $rel:"
[ -n "$heading" ] && note=$(printf '%s\n\nIntestazione con iniziale minuscola:\n%s\n\nIl CLAUDE.md separa due casi: «intestazioni di colonna e valori in minuscolo, titoli di vista e di sezione in sentence case». Un `h1`/`h2` è un titolo di sezione. Il minuscolo è giusto per una etichetta accanto a un valore — `turno`, `prezzo`, `max` — che però non si scrive dentro una intestazione.' "$note" "$heading")
[ -n "$spaced" ] && note=$(printf '%s\n\nMaiuscolo spaziato:\n%s\n\nDocumento 2 §2: è «il tic più riconoscibile delle interfacce generate», e su una tabella da quindici colonne rallenta anche la lettura. La classe `label` fa il lavoro senza spaziare.' "$note" "$spaced")

note=$(printf '%s\n\nSe è voluto va bene — questa riga non blocca niente.' "$note")

jq -cn --arg note "$note" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $note,
  },
}'
exit 0
