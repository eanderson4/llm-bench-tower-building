# TowerBench playbook — adding a model / refreshing a benchmark

The protocol is frozen per benchmark generation. For the `main-1` generation:
challenge `pillarsxl`, seeds `11–15`, 3 attempts per seed, `--mode episodic`
(default), group `main-1`. Any run with those parameters is directly
comparable to the published table — that's what makes adding a model later
legitimate.

## 1. Run the new model (one command per seed)

```sh
for seed in 11 12 13 14 15; do
  npm run bench -- --model <model> --challenge pillarsxl --seeds 3x$seed --group main-1
done
```

- `claude*` models use `ANTHROPIC_API_KEY`; everything else is
  OpenAI-compatible: set `OPENAI_API_KEY` and pass `--base-url` for
  non-OpenAI providers (see lanes in `scripts/main-run.sh` for the exact
  base URLs used in main-1).
- Slow/verbose reasoning models may need
  `BENCH_HTTP_TIMEOUT_MS=600000 BENCH_MAX_TOKENS=16384` (k3 did).
- Seeds are sequential per model (notebook carries across attempts of a
  seed, never across models). Different models can run in parallel.
- A failed seed-run can be rerun solo; `scripts/aggregate.ts` keeps the most
  recent run per (model, seed).

## 2. Rebuild the data

```sh
npm run board                                # replays/index.json for the local board
npx tsx scripts/aggregate.ts --group main-1  # markdown table + replays/agg-main-1.json
```

Paste the printed table over the Results table in `README.md`.

## 3. Refresh the "related benchmarks" columns

One-off lookups, no automation. For the new model find:

- **Artificial Analysis Intelligence Index** — artificialanalysis.ai model
  page (use the highest-reasoning variant; index version matters, note it).
- **SWE-bench Verified** — vendor launch post, else vals.ai leaderboard;
  note the scaffold if stated.
- **ARC-AGI-2** — arcprize.org/results/<model> (semi-private preferred;
  mark public-eval numbers with the ¹ footnote).

Use `—` when no credible number exists. Never interpolate. Record sources in
the release notes.

## 4. Regenerate artifacts

```sh
OUT=/tmp/towerbench-info && mkdir -p $OUT
# hero frames for the tower gallery (dev server must be running: npm run dev)
npx tsx scripts/final-frame.ts "http://localhost:5173/src/race/?capture=1&replays=/replays/<file>.json&labels=<Name>" $OUT/tower-x.png 560 640
# infographics (towers arg: "path|caption;path|caption;...")
npx tsx scripts/infographic.ts --group main-1 --outdir $OUT --towers "..."
for p in leaderboard peakfinal learning; do
  npx tsx scripts/shot.ts --url file://$OUT/$p.html --out media/infographic-$p.png
done
```

Race video (side-by-side, for shorts): `scripts/capture.ts` steps the race
page frame-by-frame; assemble with ffmpeg — see the capture pipeline notes in
that script's header. Model display names/colors live in
`scripts/infographic.ts` (`NAME`, `COLOR`) — add the new model there.

## 5. Publish

- Update the GitHub release for the generation (`main-1`): new results table
  in the notes, refreshed infographic PNGs + replay bundle
  (`replays/*-pillarsxl-*` for the group) as assets. Releases = official
  benchmark runs.
- Shareable artifacts carry only the repo URL. The README footer carries the
  math-vs-vibes plug.

## Protocol changes are a new generation

Anything that touches the system prompt, SDK docs, challenge, scoring, or
noise contract invalidates comparability — that's a `main-2`, run fresh for
every model, and the old table stays published as v1 history (see issues
labeled `v2`).
