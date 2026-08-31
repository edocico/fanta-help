#!/usr/bin/env bash
# PostToolUse: type-check the TS project that actually compiles the edited file.
#
# The repo has two separate TS projects, and src/shared is deliberately in BOTH
# (tsconfig.node.json and tsconfig.web.json). That double compilation is the
# mechanism enforcing rule 3 — "shared depends on neither Node nor the DOM" —
# so an edit under shared/ is checked twice, on purpose.
#
# Exit 2 hands stderr back to Claude. The edit is already written; this only
# reports, it does not revert.
set -uo pipefail

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')
case "$file" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

root=${CLAUDE_PROJECT_DIR:-$PWD}
cd "$root" 2>/dev/null || exit 0
[ -x node_modules/.bin/tsc ] || exit 0   # deps not installed: stay quiet
rel=${file#"$root"/}

case "$rel" in
  src/renderer/*)          projects="tsconfig.web.json" ;;
  src/main/*|src/preload/*) projects="tsconfig.node.json" ;;
  src/shared/*)            projects="tsconfig.node.json tsconfig.web.json" ;;
  *)                       exit 0 ;;
esac

report=""
for p in $projects; do
  if ! errors=$(node_modules/.bin/tsc --noEmit --pretty false -p "$p" 2>&1); then
    report="$report
--- $p ---
$errors"
  fi
done

[ -n "$report" ] || exit 0

printf 'typecheck fallito dopo la modifica di %s:%s\n' "$rel" "$report" >&2
exit 2
