# llm-bench-tower-building

<!-- TODO: hero video/gif — screen capture of the viewer replaying a top run
     (e.g. fable-5 pillarsk2: 7.07m perfect build, or the 6.60m caught-mid-fall
     leaning tower). Record once the headline runs are final. -->

An LLM benchmark: build the tallest tower you can by placing blocks through a
small SDK — under a position/velocity **uncertainty contract**. You can place a
block precisely, or control its velocity precisely, but not both:

```
sigmaX * sigmaV = K        (constant per challenge)

focus = 1   -> exact position, wild velocity (block may kick sideways at spawn)
focus = 0   -> exact velocity, wild position (block may appear off-target)
focus = 0.5 -> balanced      (sigmaX = sigmaX0, sigmaV = sigmaV0)
```

The requested velocity is the *mean* of the sampled velocity, so allocating
some focus to velocity lets an agent "press" a block gently into place instead
of gambling on a sideways kick — the trade-off is the benchmark's core skill.

Physics is simulated headlessly (rapier3d, deterministic with a seeded RNG).
three.js is a **viewer only** — replays re-simulate from
`(challengeId, seed, placement log)` with the same core code the scorer used.

## Quickstart

```sh
npm install
npm test                              # unit + determinism + scoring tests
npm run agent:naive -- --challenge bricks --seed 1   # scripted baseline, writes replays/
npm run dev                           # viewer -> http://localhost:5173/src/viewer/
```

The viewer loads `?replay=/replays/<file>.json` (defaults to the naive baseline
run). Play/pause, speed, and a scrub slider are at the bottom.

## Running LLM agents

```sh
npm run bench -- --model claude-fable-5 --challenge bricks --seeds 3x11
npm run bench -- --model gpt-5.6-sol  --challenge mixed --seeds 11,12,13
```

`--seeds 3x11` = three attempts on seed 11 (same seed across attempts measures
in-context improvement); `--seeds 11,12,13` = one attempt per seed. Models
starting with `claude` use the Anthropic API (`ANTHROPIC_API_KEY` /
`ANTHROPIC_API_KEY_PERSONAL`); everything else uses OpenAI-compatible chat
completions (`OPENAI_API_KEY`, `--base-url` for other providers).

`--mode episodic` (default) starts each attempt with a fresh conversation: when
an attempt ends the model distills what it learned into a persistent notebook
(`update_notebook`), the context resets, and the next attempt begins with only
the system prompt, the harness-kept history table, and that notebook — so the
live context stays ~10–15k tokens no matter how many attempts. `--mode session`
is the original single-conversation behavior, kept for comparison.

Provider knobs (env): `BENCH_HTTP_TIMEOUT_MS` (per-request timeout, default
300000) and `BENCH_MAX_TOKENS` (cap completion length) — both default off/unset
and exist for slow or non-terminating reasoning models (e.g. k3, whose server
can otherwise generate past every timeout on long planning turns).

`scripts/coverage.sh` runs a model × challenge coverage matrix in parallel
lanes (one concurrent run per model) — edit the lane lists to taste.

Per run the harness writes: one replay per attempt (viewable in the viewer), a
`run-<label>-<challenge>-<runId>.json` score summary (including mode and
notebook entries), and a full `transcript-*.json` of every turn. Attempts
auto-advance when the inventory is exhausted; the model can also abandon early
via `next_episode`.

## Layout

```
src/core/    authoritative headless sim (no DOM): physics, uncertainty, scoring
  types.ts       shared interfaces (blocks, placement API, challenges, replay)
  sim.ts         rapier world wrapper: step, settle detection, contact queries
  uncertainty.ts focus -> sigmas (sigmaX * sigmaV = K), Gaussian sampling
  episode.ts     validation -> sample -> simulate-to-settle -> replay log
  scoring.ts     tower height via contact chain to the ground
  challenges.ts  10 challenges: bricks, bricks50, bricks100, bricks50k2, bricks50k4, mixed, sparse, storm, pillars, slick
src/sdk/     what an agent (LLM or scripted) drives
  tools.ts       tool schemas (get_inventory / observe / place_block) + SDK_DOC
  utils.ts       spatial helpers (rotatedExtents, stackCenterY, footprint, ...)
  client.ts      EpisodeClient: typed wrapper + callTool dispatch
src/viewer/  three.js replay viewer (re-simulates replays, scrub playback)
src/agents/  naive.ts — scripted baseline agent, writes replays/*.json
tests/       vitest: rng, uncertainty contract, episode validation, determinism, scoring
```

## Placement API (summary)

```ts
place_block({
  blockId: 'b1',
  position: [0, 0.31, 0],   // desired center, meters, y-up
  yawDeg: 90,               // optional, default 0
  orientation: 'upright',   // optional named pose: box flat|side|upright, cylinder upright|flat
  quat: [0, 0, 0.7071, 0.7071], // optional full-resolution rotation (precedence over orientation/yaw)
  velocity: [0, -0.3, 0],   // optional desired MEAN velocity, |v| <= maxSpeed
  focus: 0.6,               // required: precision allocation, [0, 1]
})
// -> { ok, actual: { position, velocity, sigma: {x, v} },
//      settle: { outcome, tower, spawnOverlap, spawnPenetration, ... } }
// or { ok: false, error } — validation errors are retryable and free
```

Score = max top-y over blocks with a contact chain to the ground, after the
whole inventory settles. Peak height is tracked separately. Blocks that fall
off the ground plane are lost. Spawning inside another block is not an error —
physics resolves it (violently); the result reports `spawnOverlap`.

## Leaderboard

`http://localhost:5173/src/board/` lists every attempt (sortable, filterable by
challenge and group) with watch links into the viewer. It reads
`replays/index.json`, regenerated automatically after every run or via
`npm run board`. Tag related runs with `--group <name>` to compare them as a set.

## Status

Working: core sim, 10 challenges, SDK + spatial utilities, naive baseline agent,
replay viewer, LLM harness (episodic + session modes), leaderboard board. Full
model × challenge coverage matrix lives in `replays/` (group `cov-1`); known
tuning knobs (settle thresholds, per-challenge K) are listed as open decisions
in the project plan.

## License

MIT — see [LICENSE](LICENSE).

---

A [math vs vibes](https://mathvsvibes.com) project.
