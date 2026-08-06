#!/usr/bin/env bash
# Main headline run: every model on pillarsxl, 5 seeds x 3 episodic attempts
# per seed (each seed is an independent "3 attempts + notebook" trial), group
# "main-1". Lane structure mirrors coverage.sh / precision-1.sh: one lane per
# provider account so runs within a lane are sequential.
set -u
cd "$(dirname "$0")/.."
mkdir -p logs

SEEDS=(11 12 13 14 15)
CHALLENGE=pillarsxl
GROUP=main-1

run_model() {
  local lane=$1 model=$2
  for seed in "${SEEDS[@]}"; do
    local log="logs/main-${model}-s${seed}.log"
    echo "[$lane] START $model seed=$seed $(date +%T)"
    if npm run bench -- --model "$model" --challenge "$CHALLENGE" --seeds "3x${seed}" --group "$GROUP" >"$log" 2>&1; then
      echo "[$lane] OK    $model seed=$seed  $(grep -E '^best=' "$log" | tail -1)"
    else
      echo "[$lane] FAIL  $model seed=$seed (log: $log)"
    fi
  done
  echo "[$lane] $model done"
}

lane() {
  local name=$1; shift
  for model in "$@"; do
    run_model "$name" "$model"
  done
  echo "[$name] lane done"
}

# Naive baseline on every seed (local, fast) for the chart's floor line.
for seed in "${SEEDS[@]}"; do
  npm run agent:naive -- --challenge "$CHALLENGE" --seed "$seed" >"logs/main-naive-s${seed}.log" 2>&1 || true
done

lane anthropic-1 claude-fable-5 &
lane anthropic-2 claude-opus-5 &
lane anthropic-3 claude-sonnet-5 claude-haiku-4-5-20251001 &
lane openai-1 gpt-5.6-sol &
lane openai-2 gpt-5.5 gpt-5.4-mini &
lane zai glm-5.2 &
lane deepseek deepseek-v4-flash &
BENCH_HTTP_TIMEOUT_MS=600000 BENCH_MAX_TOKENS=16384 lane kimi k3 &

wait
echo "=== all lanes done $(date +%T) — rebuilding board manifest ==="
npm run board
