#!/usr/bin/env bash
# Coverage pass: run every model on every challenge it has not completed yet.
# Each combo = `npm run bench -- --seeds 2x11` (2 attempts on seed 11, episodic
# mode -> the model writes its notebook between attempts), group "cov-1".
# Lanes run in parallel (one concurrent run per model/provider); combos within
# a lane are sequential. Per-run logs land in logs/cov-<model>-<challenge>.log.
set -u
cd "$(dirname "$0")/.."
mkdir -p logs

run_combo() {
  local lane=$1 model=$2 challenge=$3
  local log="logs/cov-${model}-${challenge}.log"
  echo "[$lane] START $model x $challenge $(date +%T)"
  if npm run bench -- --model "$model" --challenge "$challenge" --seeds 2x11 --group cov-1 >"$log" 2>&1; then
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

lane anthropic-1 \
  claude-fable-5 sparse claude-fable-5 slick \
  claude-sonnet-5 sparse claude-sonnet-5 pillars claude-sonnet-5 slick &
lane anthropic-2 \
  claude-haiku-4-5-20251001 bricks50 claude-haiku-4-5-20251001 bricks100 \
  claude-haiku-4-5-20251001 sparse claude-haiku-4-5-20251001 pillars \
  claude-haiku-4-5-20251001 slick &
lane openai-1 gpt-5.6-sol sparse gpt-5.6-sol slick &
lane openai-2 \
  gpt-5.5 bricks50 gpt-5.5 bricks100 gpt-5.5 sparse gpt-5.5 pillars gpt-5.5 slick &
lane openai-3 \
  gpt-5.4-mini bricks50 gpt-5.4-mini bricks100 gpt-5.4-mini sparse gpt-5.4-mini pillars gpt-5.4-mini slick &
lane zai glm-5.2 mixed glm-5.2 sparse glm-5.2 storm glm-5.2 pillars glm-5.2 slick &
lane deepseek \
  deepseek-v4-flash bricks50 deepseek-v4-flash bricks100 deepseek-v4-flash mixed \
  deepseek-v4-flash sparse deepseek-v4-flash storm deepseek-v4-flash pillars deepseek-v4-flash slick &
lane kimi k3 bricks k3 mixed k3 sparse k3 storm k3 pillars k3 slick &

wait
echo "=== all lanes done $(date +%T) — rebuilding board manifest ==="
npm run board
