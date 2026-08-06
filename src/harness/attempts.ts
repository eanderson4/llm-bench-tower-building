import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EpisodeClient } from '../sdk/client';
import type { PlaceRequest, Score } from '../core/types';

export interface AttemptSummary {
  attempt: number; // 1-based
  seed: number;
  score: Score;
  placements: number;
  replayPath: string;
  endReason: 'completed' | 'abandoned';
}

/** session = one continuous conversation; episodic = fresh context per attempt + notebook. */
export type HarnessMode = 'session' | 'episodic';

export interface NotebookEntry {
  attempt: number; // attempt after which the notes were written
  notes: string;
}

export interface RunSummary {
  label: string;
  challengeId: string;
  seeds: number[];
  runId: string;
  group: string; // freeform tag for grouping related runs on the board (e.g. "fable-vs-sol")
  mode: HarnessMode;
  notebook?: NotebookEntry[];
  attempts: AttemptSummary[];
}

export const MAX_BATCH = 6;

/** Round all floats in a tool response — full-precision JSON doubles token count for no benefit. */
function roundDeep(v: unknown, digits = 4): unknown {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Number(v.toFixed(digits));
  if (Array.isArray(v)) return v.map((x) => roundDeep(x, digits));
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, roundDeep(x, digits)]));
  }
  return v;
}

/**
 * Multi-attempt episode driver, model-agnostic. The agent calls get_inventory /
 * observe / place_block (or place_blocks for batches); when an episode's
 * inventory runs out the attempt auto-finalizes (replay + summary written) and
 * the next attempt starts — the agent can also abandon early via next_episode.
 */
export class AttemptRunner {
  private client: EpisodeClient | null = null;
  private summaries: AttemptSummary[] = [];
  private finished = false;

  private notebookEntries: NotebookEntry[] = [];

  constructor(
    private readonly challengeId: string,
    private readonly seeds: number[], // one entry per attempt
    private readonly label: string, // model label, used in file names
    private readonly runId: string, // distinguishes repeated runs of same label
    private readonly outDir = 'replays',
    private readonly group = '',
    private readonly mode: HarnessMode = 'session',
  ) {}

  /** Record a notebook snapshot written by the agent (episodic mode carries it across attempts). */
  recordNotes(attempt: number, notes: string): void {
    this.notebookEntries.push({ attempt, notes });
    this.writeRunSummary();
  }

  get attemptsTotal(): number {
    return this.seeds.length;
  }

  get attemptNumber(): number {
    return Math.min(this.summaries.length + 1, this.seeds.length);
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get attempts(): AttemptSummary[] {
    return this.summaries;
  }

  private async ensureStarted(): Promise<EpisodeClient> {
    if (this.finished) throw new Error('Run is finished — all attempts are complete.');
    if (!this.client) {
      this.client = await EpisodeClient.create(this.challengeId, this.seeds[this.summaries.length]);
    }
    return this.client;
  }

  async handleTool(name: string, args: unknown): Promise<unknown> {
    if (name === 'next_episode') return this.advance('abandoned');
    if (this.finished) {
      return { ok: false, error: 'Benchmark complete: all attempts are done. No more tool calls are needed.' };
    }
    if (name === 'place_blocks') return this.placeBatch(args);
    const client = await this.ensureStarted();
    switch (name) {
      case 'get_inventory':
        return this.wrap({ inventory: client.getInventory() });
      case 'observe':
        return this.wrap(client.observe());
      case 'place_block': {
        const res = client.placeBlock(args as PlaceRequest);
        const out: Record<string, unknown> = this.wrap(res);
        if (res.ok && client.observe().status === 'done') {
          out.episodeComplete = await this.advance('completed');
        }
        return out;
      }
      default:
        return { ok: false, error: `Unknown tool "${name}". Available: get_inventory, observe, place_block, place_blocks, next_episode.` };
    }
  }

  /** Sequential batch of place_block calls (max MAX_BATCH). Stops early on episode completion. */
  private async placeBatch(args: unknown): Promise<unknown> {
    const list = (args as { placements?: unknown[] } | null)?.placements;
    if (!Array.isArray(list) || list.length === 0) {
      return { ok: false, error: `"placements" must be a non-empty array of place_block requests (max ${MAX_BATCH}).` };
    }
    if (list.length > MAX_BATCH) {
      return { ok: false, error: `Batch too large: ${list.length} placements (max ${MAX_BATCH}). Smaller batches let you adapt to actual outcomes.` };
    }
    const results: unknown[] = [];
    let episodeComplete: unknown;
    for (const req of list) {
      if (this.finished) break;
      const client = await this.ensureStarted();
      const res = client.placeBlock(req as PlaceRequest);
      results.push(this.wrap(res));
      if (res.ok && client.observe().status === 'done') {
        episodeComplete = await this.advance('completed');
        break;
      }
    }
    return this.wrap({ results, ...(episodeComplete ? { episodeComplete } : {}) });
  }

  /** Prepend attempt context to every tool response so the agent stays oriented. */
  private wrap(payload: unknown): Record<string, unknown> {
    return roundDeep({
      attempt: this.attemptNumber,
      attemptsTotal: this.attemptsTotal,
      attemptsCompleted: this.summaries.map((s) => ({ attempt: s.attempt, height: s.score.height })),
      ...((typeof payload === 'object' && payload !== null ? payload : { value: payload }) as object),
    }) as Record<string, unknown>;
  }

  /** Finalize the current attempt and start the next one (or finish the run). */
  private async advance(reason: 'completed' | 'abandoned'): Promise<Record<string, unknown>> {
    const summary = await this.finalizeCurrent(reason);
    const h = summary.score.height.toFixed(3);
    const peak = summary.score.peakHeight.toFixed(3);
    if (this.summaries.length >= this.seeds.length) {
      this.finished = true;
      this.client = null;
      const heights = this.summaries.map((s) => s.score.height);
      return roundDeep({
        finalizedAttempt: summary,
        benchmarkComplete: true,
        finalHeights: heights,
        message: `Attempt ${summary.attempt} scored ${h}m. Benchmark complete — heights: ${heights.map((x) => x.toFixed(3)).join(', ')}m. Best: ${Math.max(...heights).toFixed(3)}m.`,
      }) as Record<string, unknown>;
    }
    this.client = await EpisodeClient.create(this.challengeId, this.seeds[this.summaries.length]);
    const best = Math.max(...this.summaries.map((s) => s.score.height));
    return roundDeep({
      finalizedAttempt: summary,
      benchmarkComplete: false,
      message: `Attempt ${summary.attempt} scored ${h}m (peak ${peak}m, ${reason}). Attempt ${this.attemptNumber}/${this.attemptsTotal} started — same seed ${this.seeds[this.summaries.length]}, fresh inventory. Best so far: ${best.toFixed(3)}m. Call get_inventory to begin.`,
    }) as Record<string, unknown>;
  }

  private async finalizeCurrent(reason: 'completed' | 'abandoned'): Promise<AttemptSummary> {
    const client = await this.ensureStarted();
    const attempt = this.attemptNumber;
    const seed = this.seeds[this.summaries.length];
    const replayPath = join(this.outDir, `${this.label}-${this.challengeId}-a${attempt}-${this.runId}.json`);
    mkdirSync(this.outDir, { recursive: true });
    writeFileSync(replayPath, JSON.stringify(client.replay(), null, 2));

    const summary: AttemptSummary = {
      attempt,
      seed,
      score: client.score(),
      placements: client.observe().placements,
      replayPath,
      endReason: reason,
    };
    this.summaries.push(summary);
    this.writeRunSummary();
    return summary;
  }

  private writeRunSummary(): void {
    const summary: RunSummary = {
      label: this.label,
      challengeId: this.challengeId,
      seeds: this.seeds,
      runId: this.runId,
      group: this.group,
      mode: this.mode,
      ...(this.notebookEntries.length > 0 ? { notebook: this.notebookEntries } : {}),
      attempts: this.summaries,
    };
    writeFileSync(join(this.outDir, `run-${this.label}-${this.challengeId}-${this.runId}.json`), JSON.stringify(summary, null, 2));
  }
}

/** Parse "11,12,13" or "3x11" (three attempts on seed 11) seed specs. */
export function parseSeeds(spec: string): number[] {
  if (/^\d+x\d+$/.test(spec)) {
    const [n, seed] = spec.split('x').map(Number);
    return Array.from({ length: n }, () => seed);
  }
  const seeds = spec.split(',').map((s) => Number(s.trim()));
  if (seeds.length === 0 || seeds.some((s) => !Number.isFinite(s))) {
    throw new Error(`bad --seeds value "${spec}" (want "11,12,13" or "3x11")`);
  }
  return seeds;
}
