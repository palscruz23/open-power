#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ONCE_SCRIPT="$ROOT_DIR/ralph_once.sh"
PRD_FILE="$ROOT_DIR/prd.json"
MAX_ITERATIONS=3

# Each successful loop iteration runs ralph_once.sh, which commits and pushes
# the active PRD branch to origin.

require_file() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    echo "Missing required file: $f" >&2
    exit 1
  fi
}

require_cmd() {
  local c="$1"
  if ! command -v "$c" >/dev/null 2>&1; then
    echo "Required command not found: $c" >&2
    exit 1
  fi
}

remaining_tasks() {
  (
    cd "$ROOT_DIR"
    node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('prd.json','utf8'));const n=(d.tasks||[]).filter(t=>t&&t.passes===false).length;console.log(n);"
  )
}

require_file "$ONCE_SCRIPT"
require_file "$PRD_FILE"
require_cmd node

iteration=1
while [[ "$iteration" -le "$MAX_ITERATIONS" ]]; do
  remaining="$(remaining_tasks)"
  if [[ "$remaining" -eq 0 ]]; then
    echo "<promise>COMPLETE</promise>"
    break
  fi

  echo "=== Ralph Loop Iteration $iteration/$MAX_ITERATIONS (remaining tasks: $remaining) ==="
  bash "$ONCE_SCRIPT"
  echo "=== Iteration $iteration complete and pushed ==="

  remaining_after="$(remaining_tasks)"
  if [[ "$remaining_after" -eq 0 ]]; then
    echo "<promise>COMPLETE</promise>"
    break
  fi

  iteration=$((iteration + 1))
done

if [[ "$iteration" -gt "$MAX_ITERATIONS" ]]; then
  echo "Reached max iterations ($MAX_ITERATIONS)."
fi
