#!/usr/bin/env bash
# PostToolUse: un workflow di GitHub Actions dev'essere un workflow valido.
#
# YAML valido e workflow valido sono due domande diverse, e il progetto ha pagato
# la differenza. Spingendo `main` la prima volta, GitHub ha creato una run
# fallita in **0 secondi** con «This run likely failed because of a workflow file
# issue»: non un job andato male, il file scartato in blocco — e per questo la
# run era partita su un push di ramo che i trigger non prevedono.
#
# La causa era un `env:` senza figli. `yaml.safe_load` taceva, perche' una chiave
# con valore nullo e' YAML perfettamente valido; `actionlint` l'ha detto in una
# riga, col numero:
#
#   release.yml:253:13: expecting a single ${{...}} expression or mapping value
#   for "env" section, but found plain text node [syntax-check]
#
# **Blocca**, a differenza di `palette` e `copy`. Quelli avvisano perche' un
# titolo minuscolo puo' essere voluto; qui no: un workflow invalido non fa niente
# di utile, e l'unico posto dove te ne accorgi e' una run rossa dopo il push.
#
# Se actionlint manca, blocca lo stesso e dice come installarlo. Una guardia che
# passa in silenzio quando il suo strumento non c'e' e' peggio di nessuna
# guardia: e' indistinguibile da un file sano.

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -n "$file" ] || exit 0

case "$file" in
  *.github/workflows/*.yml | *.github/workflows/*.yaml) ;;
  *) exit 0 ;;
esac

root=${CLAUDE_PROJECT_DIR:-$PWD}
[ -f "$file" ] || file="$root/${file#"$root"/}"
[ -f "$file" ] || exit 0

if ! command -v actionlint >/dev/null 2>&1; then
  manca="actionlint non e installato, quindi questo workflow NON e stato validato.

Non e un via libera: yaml.safe_load direbbe che il file va bene anche con un
env: vuoto, che e esattamente il difetto per cui GitHub ha scartato il workflow.

Su Fedora si scarica il binario singolo dalle release di rhysd/actionlint in
~/.local/bin; su macOS: brew install actionlint."
  jq -cn --arg t "$manca" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $t
    }
  }'
  exit 0
fi

rilievi=$(actionlint -no-color "$file" 2>&1) || true

[ -n "$rilievi" ] || exit 0

testo="actionlint ha rifiutato ${file##*/}:

${rilievi}

GitHub scarta un workflow invalido in blocco: la run fallisce in 0 secondi con
«This run likely failed because of a workflow file issue», che non nomina nessuna
riga. Meglio saperlo adesso."

jq -cn --arg t "$testo" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $t
  },
  decision: "block",
  reason: $t
}'
