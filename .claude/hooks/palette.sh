#!/usr/bin/env bash
# PostToolUse: amber is money, and nothing else.
#
# Document 2 §2 commits the colour: "Se un numero è ambra è un credito.
# Nient'altro usa quel colore, mai per decorazione." Twice in two tasks it was
# broken anyway — the coherence warnings of T12, the rating stars of T13 — and
# both times the review caught it, which means after the work was finished. No
# test can: the palette is not arithmetic.
#
# The discriminator is `figures`. Money in this app is always a figure, so the
# two classes travel together; the two real violations were both on a line with
# `text-credit` and no `figures`. Measured on the codebase at the time this was
# written: 13 correct uses, all with `figures`, and exactly one hit without —
# the "rigorista" mark of T9, which is the open item the T13 review named.
#
# **Exit 0, always.** This does not block and must not: amber on money is
# correct and frequent, and a guard that refuses it would be worked around
# inside a task. It only makes you look up. `additionalContext` says it without
# dressing it as an error, which is what the typecheck hook's exit 2 is for.
set -uo pipefail

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -n "$file" ] || exit 0

root=${CLAUDE_PROJECT_DIR:-$PWD}
rel=${file#"$root"/}
case "$rel" in
  src/renderer/*) ;;
  *) exit 0 ;;
esac

# Only what the edit adds, like boundaries.sh: a file that already carries an
# older violation elsewhere is not this hook's business.
added=$(printf '%s' "$payload" | jq -r '
  [ .tool_input.content?,
    .tool_input.new_string?,
    ( .tool_input.edits[]?.new_string? )
  ] | map(select(. != null)) | join("\n")
')
[ -n "$added" ] || exit 0

# Comment lines are dropped: this file, and the comments that explain the rule,
# name the class without using it.
suspect=$(printf '%s' "$added" \
  | grep -F 'text-credit' \
  | grep -Fv 'figures' \
  | sed 's/^[[:space:]]*//' \
  | grep -v '^\(//\|\*\|/\*\)' \
  | head -3)
[ -n "$suspect" ] || exit 0

note=$(printf 'Ambra su una riga senza `figures`, in %s:\n%s\n\nDocumento 2 §2: «Se un numero è ambra è un credito. Nient'"'"'altro usa quel colore, mai per decorazione.» Se è denaro va bene ed è probabile che sia già giusto — questa riga non blocca niente. Se non lo è, il colore giusto è `text-target` per gli obiettivi, `text-chalk` per un avviso.' "$rel" "$suspect")

jq -cn --arg note "$note" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $note,
  },
}'
exit 0
