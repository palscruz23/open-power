#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ONCE_SCRIPT="$ROOT_DIR/ralph_once.sh"
PRD_FILE="$ROOT_DIR/prd.json"
MAX_ITERATIONS=20
MAX_FAILURES=3

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
    node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('prd.json','utf8'));const isImplemented=t=>Boolean(t&&((typeof t.implemented==='boolean'&&t.implemented)||((typeof t.implemented!=='boolean')&&t.passes===true)));const n=(d.tasks||[]).filter(t=>t&&!isImplemented(t)).length;console.log(n);"
  )
}

require_file "$ONCE_SCRIPT"
require_file "$PRD_FILE"
require_cmd node

iteration=1
failure_count=0
while [[ "$iteration" -le "$MAX_ITERATIONS" ]]; do
  remaining="$(remaining_tasks)"
  if [[ "$remaining" -eq 0 ]]; then
    echo "<promise>COMPLETE</promise>"
    break
  fi

  echo "[ralph] Iteration $iteration/$MAX_ITERATIONS ($remaining remaining)"
  set +e
  bash "$ONCE_SCRIPT"
  run_exit=$?
  set -e

  if [[ "$run_exit" -ne 0 ]]; then
    failure_count=$((failure_count + 1))
    echo "[ralph] Iteration $iteration failed (attempt $failure_count/$MAX_FAILURES)" >&2
    if [[ "$failure_count" -ge "$MAX_FAILURES" ]]; then
      echo "[ralph] Escalation required: Ralph failed $MAX_FAILURES times. Manual review needed." >&2
      exit 1
    fi
    iteration=$((iteration + 1))
    continue
  fi

  failure_count=0

  remaining_after="$(remaining_tasks)"
  if [[ "$remaining_after" -eq 0 ]]; then
    echo "<promise>COMPLETE</promise>"
    break
  fi

  echo "[ralph] Iteration $iteration finished ($remaining_after task(s) remaining)"
  iteration=$((iteration + 1))
done

if [[ "$iteration" -gt "$MAX_ITERATIONS" ]]; then
  echo "[ralph] Reached max iterations ($MAX_ITERATIONS)." >&2
fi
