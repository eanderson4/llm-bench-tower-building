#!/usr/bin/env bash
# Precision experiment: every model on bricks50k2 (K halved) and bricks50k4
# (K quartered) — same 50-brick inventory as bricks50, so results isolate the
# effect of placement precision on tower outcomes. Each combo = 2 attempts on
# seed 11, episodic mode, group "prec-1". Lane structure mirrors coverage.sh.
set -u
cd "$(dirname "$0")/.."
mkdir -p logs

run_combo() {
  local lane=$1 model=$2 challenge=$3
  local log="logs/prec-${model}-${challenge}.log"
  echo "[$lane] START $model x $challenge $(date +%T)"
  if npm run bench -- --model "$model" --challenge "$challenge" --seeds 2x11 --group prec-1 >"$log" 2>&1; then
    echo "[$lane] OK    $model x $challenge  $(grep -E '^best=' "$log" | tail -1)"
  else
    echo "[$lane] FAIL  $model x $challenge (log: $log)"
  fi
}

lane() {
  local name=$1; shift
  while [ $# -ge 2 ]; do
    run_combo "$name" "$1" "$2"
    shift 2
  done
  echo "[$name] lane done"
}

lane anthropic-1 claude-fable-5 bricks50k2 claude-fable-5 bricks50k4 &
lane anthropic-2 \
  claude-sonnet-5 bricks50k2 claude-sonnet-5 bricks50k4 \
  claude-haiku-4-5-20251001 bricks50k2 claude-haiku-4-5-20251001 bricks50k4 &
lane openai-1 gpt-5.6-sol bricks50k2 gpt-5.6-sol bricks50k4 &
lane openai-2 gpt-5.5 bricks50k2 gpt-5.5 bricks50k4 &
lane openai-3 gpt-5.4-mini bricks50k2 gpt-5.4-mini bricks50k4 &
lane zai glm-5.2 bricks50k2 glm-5.2 bricks50k4 &
lane deepseek deepseek-v4-flash bricks50k2 deepseek-v4-flash bricks50k4 &
lane kimi k3 bricks50k2 k3 bricks50k4 &

wait
echo "=== all lanes done $(date +%T) — rebuilding board manifest ==="
npm run board
