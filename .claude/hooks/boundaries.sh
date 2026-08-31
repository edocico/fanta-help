#!/usr/bin/env bash
# PreToolUse guard for the architectural rules of CLAUDE.md.
#
# Exit 2 blocks the tool call and hands stderr back to Claude as the reason,
# which is why every message below names the rule and the way out.
#
# Only the text the edit ADDS is inspected, never the whole file: editing one
# line of a file that already violates a rule elsewhere is not this hook's
# business.
#
# Every pattern is anchored to the first character of an import specifier.
# Matching bare words instead would fire on prose — CLAUDE.md's own sentence
# "il renderer non importa drizzle" is a comment a source file may quote.
set -uo pipefail

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')
[ -n "$file" ] || exit 0

# Write sends `content`, Edit sends `new_string`, MultiEdit an array of edits.
added=$(printf '%s' "$payload" | jq -r '
  [ .tool_input.content?,
    .tool_input.new_string?,
    ( .tool_input.edits[]?.new_string? )
  ] | map(select(. != null)) | join("\n")
')
[ -n "$added" ] || exit 0

root=${CLAUDE_PROJECT_DIR:-$PWD}
rel=${file#"$root"/}

deny() { printf '%s\n' "$1" >&2; exit 2; }
has()  { printf '%s' "$added" | grep -qE "$1"; }

# True when an ES import or CJS require has a specifier matching $1 from its
# first character. `spec` is what follows the opening quote, so a pattern ending
# in ["'/] means "this package exactly, or a subpath of it" — which is what
# keeps 'electron' from also matching 'electron-vite'.
imports() { has "(from|require\()[[:space:]]*[\"']($1)"; }

case "$rel" in
  src/renderer/*)
    imports 'better-sqlite3|drizzle' && deny \
      "Bloccato — regola 1 del CLAUDE.md: il database vive solo nel main.
Il renderer non importa Drizzle e non sa che esiste un file .db.
Esponi un canale in shared/contracts.ts e chiamalo da window.api."

    imports "electron[\"'/]" && deny \
      "Bloccato — regola 1 del CLAUDE.md: il renderer non importa 'electron'.
Il solo ponte è window.api, esposto dal preload con contextBridge."
    ;;

  src/shared/*)
    imports '(\./|\.\./)*(main|renderer)/' && deny \
      "Bloccato — regola 3 del CLAUDE.md: shared non importa mai da main o renderer.
La dipendenza va nel verso opposto: porta il tipo dentro shared."

    imports "node:|electron[\"'/]|better-sqlite3|drizzle" && deny \
      "Bloccato — regola 3 del CLAUDE.md: shared non dipende da Node né dal DOM.
È compilato sia da tsconfig.node.json sia da tsconfig.web.json, ed è quel
vincolo a rendere testabili le invarianti senza database (documento 6, §3)."
    ;;
esac

case "$rel" in
  src/*)
    # Usage, not the bare word: a comment about the ban must stay writable.
    has '(window\.)?(localStorage|sessionStorage)[.[]' && deny \
      "Bloccato — CLAUDE.md, Non fare: niente localStorage o sessionStorage.
Stato effimero in Zustand, stato persistente nel main via IPC."
    ;;
esac

case "$rel" in
  package.json|*/package.json)
    has '"axios"' && deny \
      "Bloccato — CLAUDE.md, Non fare: niente axios, il main ha fetch nativo.
Le altre dipendenze si aggiungono, ma dicendolo prima."
    ;;
esac

exit 0
