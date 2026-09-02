#!/usr/bin/env bash
# PreToolUse: the new file the commit does not take.
#
# A file that git has never seen is invisible twice over. `git commit -a` stages
# "modified", not "untracked", so it goes straight past it; and the `git diff` a
# reviewer reads does not show it either. The commit succeeds, says nothing, and
# is missing the two files the task was about — which is the same shape as the
# "Comando Bash negato" trap already in CLAUDE.md: a step that looks like it
# worked.
#
# It happened in T15. The phase review closed on exactly this note, about
# `stores/projection.ts` and `features/auction/CalledPlayer.tsx` — the two files
# that *were* the task.
#
# **Exit 0, always.** Creating a file you do not mean to commit is legitimate
# (a scratch script, a local note), so this only makes you look at `git status`
# before the commit rather than after the push. Blocking would be wrong, and a
# guard that blocks something legitimate gets worked around inside a task.
#
# Only the four directories git is expected to carry are inspected. Tool
# droppings at the root — `.playwright-mcp/` and friends — are noise here, and a
# hook that cried about them every time would be muted by the second week.
set -uo pipefail

payload=$(cat)
command=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')
[ -n "$command" ] || exit 0

# `git commit` anywhere in the line, including behind an `&&`, which is how it is
# usually written.
printf '%s' "$command" | grep -q 'git[[:space:]]\+commit' || exit 0

root=${CLAUDE_PROJECT_DIR:-$PWD}
cd "$root" 2>/dev/null || exit 0

list=$(git status --porcelain 2>/dev/null \
  | grep '^??' \
  | sed 's/^?? //' \
  | grep -E '^(src|tools|docs|\.claude)/' \
  | head -8)
[ -n "$list" ] || exit 0

note=$(printf 'File nuovi mai visti da git, e il comando che stai per lanciare contiene un commit:\n\n%s\n\nUn file non tracciato è invisibile a `git commit -a` e al `git diff` che una revisione legge: il commit riesce, non dice niente, e gli mancano proprio i file nuovi. In T15 erano `stores/projection.ts` e `CalledPlayer.tsx`, cioè il task.\n\nSe fanno parte di questo lavoro, `git add` prima. Se non c'"'"'entrano, vai pure — questa riga non blocca niente.' "$list")

jq -cn --arg note "$note" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: $note,
  },
}'
exit 0
