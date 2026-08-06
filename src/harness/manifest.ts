import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BoardRow {
  model: string;
  challenge: string;
  group: string;
  attempt: number;
  seed: number;
  height: number;
  peakHeight: number;
  placements: number;
  endReason: string;
  replay: string; // URL path for the viewer's ?replay= param
  runId: string;
  mtime: number;
}

/**
 * Scans the replays dir and rebuilds replays/index.json — the manifest the
 * board page (/src/board/) renders. Covers both harness run summaries
 * (run-*.json, one row per attempt) and standalone replays (naive agent).
 * Called automatically at the end of `npm run bench` and `npm run agent:naive`,
 * or directly via `npm run board`.
 */
export function updateManifest(dir = 'replays'): BoardRow[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const rows: BoardRow[] = [];
  const claimed = new Set<string>(); // replay files already covered by a run summary

  for (const f of files) {
    if (!f.startsWith('run-')) continue;
    try {
      const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
        label: string;
        challengeId: string;
        runId: string;
        group?: string;
        attempts: Array<{
          attempt: number;
          seed: number;
          score: { height: number; peakHeight: number };
          placements: number;
          endReason: string;
          replayPath: string;
        }>;
      };
      if (!Array.isArray(j.attempts)) continue;
      const mtime = statSync(join(dir, f)).mtimeMs;
      for (const a of j.attempts) {
        claimed.add(a.replayPath);
        rows.push({
          model: j.label,
          challenge: j.challengeId,
          group: j.group ?? '',
          attempt: a.attempt,
          seed: a.seed,
          height: a.score.height,
          peakHeight: a.score.peakHeight,
          placements: a.placements,
          endReason: a.endReason,
          replay: `/${a.replayPath.replace(/^\/+/, '')}`,
          runId: j.runId,
          mtime,
        });
      }
    } catch {
      // unreadable/partial summary — skip
    }
  }

  for (const f of files) {
    if (f.startsWith('run-') || f.startsWith('transcript-') || f === 'index.json') continue;
    const rel = join(dir, f);
    if (claimed.has(rel)) continue;
    try {
      const j = JSON.parse(readFileSync(rel, 'utf8')) as {
        version: number;
        challengeId: string;
        seed: number;
        score: { height: number; peakHeight: number };
        placements: unknown[];
      };
      if (j.version !== 1 || !j.score || !Array.isArray(j.placements)) continue;
      rows.push({
        model: f.replace(/\.json$/, ''),
        challenge: j.challengeId,
        group: 'naive',
        attempt: 1,
        seed: j.seed,
        height: j.score.height,
        peakHeight: j.score.peakHeight,
        placements: j.placements.length,
        endReason: 'completed',
        replay: `/${rel}`,
        runId: '',
        mtime: statSync(rel).mtimeMs,
      });
    } catch {
      // not a replay file — skip
    }
  }

  rows.sort((a, b) => b.height - a.height);
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
  return rows;
}

if (process.argv[1]?.endsWith('manifest.ts')) {
  const rows = updateManifest();
  console.log(`board manifest: ${rows.length} attempts indexed -> replays/index.json`);
}
