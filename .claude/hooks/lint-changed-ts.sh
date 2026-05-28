#!/usr/bin/env bash
# PostToolUse hook — lint the file just edited if it's a TS/TSX file under web/.
# Set TOOLBOX_LINT_HOOK_DISABLED=1 to bypass.
# Worktree-safe: derives the web/ dir from the edited file path.

set -u

[[ "${TOOLBOX_LINT_HOOK_DISABLED:-0}" == "1" ]] && exit 0

HOOK_INPUT=$(cat)
FILE=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

[[ -z "$FILE" ]] && exit 0
[[ ! "$FILE" =~ \.(ts|tsx)$ ]] && exit 0
[[ ! "$FILE" =~ /web/ ]] && exit 0
[[ ! -f "$FILE" ]] && exit 0

# Find the web/ dir that contains the file (worktree-safe)
WEB_DIR=$(printf '%s' "$FILE" | sed 's|\(.*/web\)/.*|\1|')
[[ ! -d "$WEB_DIR" ]] && exit 0
[[ ! -f "$WEB_DIR/package.json" ]] && exit 0

# Run eslint on the single file, short timeout, no auto-fix.
# Output is shown to Claude; non-zero exit code from eslint is intentionally NOT propagated
# (we want a soft signal, not a blocked turn).
OUTPUT=$(cd "$WEB_DIR" && timeout 20 npx --no-install eslint --no-warn-ignored --format compact "$FILE" 2>&1)
STATUS=$?

if [[ $STATUS -eq 124 ]]; then
  printf 'lint-hook: timeout (20s) on %s — skipped\n' "$FILE" >&2
  exit 0
fi

if [[ $STATUS -ne 0 ]]; then
  printf 'lint-hook: eslint issues on %s\n%s\n' "$FILE" "$OUTPUT" >&2
fi

exit 0
