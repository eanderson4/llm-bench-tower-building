/**
 * Aggregate a benchmark group's runs into per-model stats.
 *
 * Reads replays/run-*.json (score summaries) and their transcripts, filters by
 * --group, and emits:
 *   - a markdown leaderboard (stdout) for README / release notes
 *   - replays/agg-<group>.json with the full per-model breakdown (consumed by
 *     the infographic pipeline)
 *
 * Headline metric: mean over seeds of the best-of-N-attempts final height.
 *
 * Usage: npx tsx scripts/aggregate.ts --group main-1 [--challenge pillarsxl]
 */
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

interface RunFile {
  label: string;
  challengeId: string;
  seeds: number[];
  runId: string;
  group?: string;
  mode: string;
  notebook?: { notes?: string }[];
  attempts: {
    attempt: number;
    seed: number;
    score: { height: number; peakHeight: number; blocksUsed: number };
    placements: number;
    endReason: string;
    replayPath: string;
  }[];
}

function arg(name: string, dflt?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (dflt !== undefined) return dflt;
  throw new Error(`missing --${name}`);
}

const group = arg('group');
const challenge = arg('challenge', '');
const dir = 'replays';

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const r2 = (x: number): number => Math.round(x * 1000) / 1000;

interface SeedResult {
  seed: number;
  runId: string;
  best: number;
  attempts: { attempt: number; height: number; peak: number; blocksUsed: number; endReason: string }[];
  tokens: { output: number; turns: number } | null;
  notes: { entries: number; chars: number };
  capHits: number; // placements whose settle hit the time cap (world still moving)
}

/** Count settleCapHit flags across a run's attempt replays (0 if unreadable or pre-v2). */
function countCapHits(run: RunFile): number {
  let hits = 0;
  for (const a of run.attempts) {
    try {
      const replay = JSON.parse(readFileSync(a.replayPath, 'utf8')) as { placements?: { settleCapHit?: boolean }[] };
      hits += (replay.placements ?? []).filter((p) => p.settleCapHit).length;
    } catch {
      /* replay missing: cap-hit stats omitted */
    }
  }
  return hits;
}

const bySeedKey = new Map<string, SeedResult>(); // label\0seed -> latest run wins
const labels = new Set<string>();

for (const f of readdirSync(dir).filter((f) => f.startsWith('run-') && f.endsWith('.json'))) {
  const run = JSON.parse(readFileSync(join(dir, f), 'utf8')) as RunFile;
  if (run.group !== group) continue;
  if (challenge && run.challengeId !== challenge) continue;
  const seed = run.seeds[0];
  let tokens: SeedResult['tokens'] = null;
  try {
    const turns = JSON.parse(
      readFileSync(join(dir, `transcript-${run.label}-${run.challengeId}-${run.runId}.json`), 'utf8'),
    ) as { usage?: { output?: number } }[];
    tokens = { output: turns.reduce((a, t) => a + (t.usage?.output ?? 0), 0), turns: turns.length };
  } catch {
    /* transcript missing: token stats omitted for this seed */
  }
  const key = `${run.label}\0${seed}`;
  const prev = bySeedKey.get(key);
  if (prev && prev.runId > run.runId) continue; // keep the most recent rerun
  labels.add(run.label);
  bySeedKey.set(key, {
    seed,
    runId: run.runId,
    best: Math.max(...run.attempts.map((a) => a.score.height)),
    attempts: run.attempts.map((a) => ({
      attempt: a.attempt,
      height: a.score.height,
      peak: a.score.peakHeight,
      blocksUsed: a.score.blocksUsed,
      endReason: a.endReason,
    })),
    tokens,
    capHits: countCapHits(run),
    notes: {
      entries: (run.notebook ?? []).length,
      chars: (run.notebook ?? []).reduce((a, e) => a + (e.notes?.length ?? 0), 0),
    },
  });
}

const models = [...labels]
  .map((label) => {
    const seeds = [...bySeedKey.entries()]
      .filter(([k]) => k.startsWith(`${label}\0`))
      .map(([, v]) => v)
      .sort((a, b) => a.seed - b.seed);
    const all = seeds.flatMap((s) => s.attempts);
    const attemptNums = [...new Set(all.map((a) => a.attempt))].sort((a, b) => a - b);
    const byAttempt = attemptNums.map((n) => {
      const xs = all.filter((a) => a.attempt === n).map((a) => a.height);
      return xs.length ? r2(mean(xs)) : null;
    });
    const withTokens = seeds.filter((s) => s.tokens);
    const bests = seeds.map((s) => s.best);
    const sd =
      bests.length > 1
        ? Math.sqrt(bests.reduce((a, b) => a + (b - mean(bests)) ** 2, 0) / (bests.length - 1))
        : 0;
    return {
      label,
      seeds: seeds.map((s) => ({
        seed: s.seed,
        best: r2(s.best),
        heights: [...s.attempts].sort((a, b) => a.attempt - b.attempt).map((a) => r2(a.height)),
      })),
      headline: r2(mean(seeds.map((s) => s.best))),
      sd: r2(sd),
      tallest: r2(Math.max(...all.map((a) => a.height))),
      meanFinal: r2(mean(all.map((a) => a.height))),
      meanPeak: r2(mean(all.map((a) => a.peak))),
      attemptMeans: byAttempt,
      attemptsPerSeed: attemptNums.length,
      abandoned: all.filter((a) => a.endReason === 'abandoned').length,
      attempts: all.length,
      outputTokens: withTokens.length ? withTokens.reduce((a, s) => a + s.tokens!.output, 0) : null,
      turns: withTokens.length ? withTokens.reduce((a, s) => a + s.tokens!.turns, 0) : null,
      noteEntries: seeds.reduce((a, s) => a + s.notes.entries, 0),
      noteChars: seeds.reduce((a, s) => a + s.notes.chars, 0),
      capHits: seeds.reduce((a, s) => a + s.capHits, 0),
    };
  })
  .sort((a, b) => b.headline - a.headline);

const out = { group, challenge: challenge || models[0] ? undefined : undefined, generated: 'aggregate.ts', models };
writeFileSync(join(dir, `agg-${group}.json`), JSON.stringify(out, null, 2));

console.log(`# ${group} leaderboard\n`);
console.log('| # | model | height (m)* | tallest | attempt means (mean height) | peak→final gap | output tokens | m / 100k tok |');
console.log('|---|-------|------------|---------|----------------------|----------------|---------------|--------------|');
// Long curves (e.g. 20-attempt generations) are compressed to first 3 … last 2.
const fmtCurve = (xs: (number | null)[]): string => {
  const fmt = (x: number | null): string => (x === null ? '—' : x.toFixed(2));
  if (xs.length <= 6) return xs.map(fmt).join(' → ');
  return [...xs.slice(0, 3).map(fmt), '…', ...xs.slice(-2).map(fmt)].join(' → ');
};
models.forEach((m, i) => {
  const curve = fmtCurve(m.attemptMeans);
  const gap = (m.meanPeak - m.meanFinal).toFixed(2);
  const tok = m.outputTokens === null ? '—' : `${Math.round(m.outputTokens / 1000)}k`;
  const eff = m.outputTokens === null ? '—' : (m.headline / (m.outputTokens / 100_000)).toFixed(1);
  console.log(
    `| ${i + 1} | ${m.label}${m.capHits > 0 ? ' †' : ''} | **${m.headline.toFixed(2)}** | ${m.tallest.toFixed(2)} | ${curve} | ${gap} | ${tok} | ${eff} |`,
  );
});
const nAttempts = Math.max(...models.map((m) => m.attemptsPerSeed), 0);
console.log(`\n\\* mean over ${models[0]?.seeds.length ?? '?'} seeds of the best of ${nAttempts} attempts (final standing height).`);
const flagged = models.filter((m) => m.capHits > 0);
if (flagged.length > 0) {
  console.log(
    `\n† ${flagged.map((m) => `${m.label} (${m.capHits})`).join(', ')}: placements that hit the settle time cap ` +
      `with the world still moving — recorded heights are snapshots of a non-settled system. Review those replays by hand.`,
  );
}
console.log(`\nwrote ${join(dir, `agg-${group}.json`)}`);
