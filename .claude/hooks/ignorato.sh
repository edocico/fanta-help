#!/usr/bin/env bash
# PostToolUse: hai appena scritto un file che git ignora.
#
# `tools/release/bump.ts` e il suo test sono esistiti per venti minuti senza che
# git li vedesse. Il `.gitignore` aveva `release` **nudo**, e un pattern senza
# barre combacia con qualunque componente di percorso a qualsiasi profondita':
# messo per la cartella di output di electron-builder, si portava via anche
# `tools/release/`.
#
# I file c'erano, il typecheck passava, i test passavano — e in CI non sarebbero
# mai arrivati. L'errore che ne sarebbe uscito («cannot find module») si legge
# come un percorso sbagliato, non come una regola di ignore.
#
# `untracked-guard` non poteva dirlo: copre i file **non tracciati**, e questi
# erano **ignorati**, che e' la categoria su cui `git status` tace per progetto.
# Una guardia copre la categoria per cui e' stata scritta, non quella che le
# somiglia.
#
# Avvisa e basta: un file locale ignorato di proposito e' legittimo — appunti,
# scratch, output di build — ed e' la stessa ragione per cui `untracked-guard`
# non blocca.

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -n "$file" ] || exit 0

root=${CLAUDE_PROJECT_DIR:-$PWD}
cd "$root" 2>/dev/null || exit 0

# Solo i file nuovi: uno gia' tracciato non puo' essere ignorato, e uno che
# esisteva prima non l'ho creato io in questo turno.
git -C "$root" ls-files --error-unmatch "$file" >/dev/null 2>&1 && exit 0

git -C "$root" check-ignore -q "$file" 2>/dev/null || exit 0

# Quale riga del .gitignore lo prende: senza, il messaggio dice che c'e' un
# problema e non dove ripararlo.
regola=$(git -C "$root" check-ignore -v "$file" 2>/dev/null | cut -f1,2 | tr '\t' ' ')

testo="Il file appena scritto e ignorato da git:

  ${file}
  lo prende: ${regola:-(regola non identificata)}

Quindi non finira in nessun commit e non arrivera in CI, e ne il typecheck ne i
test se ne accorgeranno. \`git status\` tace su entrambi i fronti: per git non e
un file non tracciato, e ignorato.

Se e voluto va bene. Se non lo e, guarda se la regola e un pattern **senza
barre**: \`release\` combacia con qualunque componente di percorso a qualsiasi
profondita, \`/release/\` solo con la cartella di radice."

jq -cn --arg t "$testo" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $t
  }
}'
