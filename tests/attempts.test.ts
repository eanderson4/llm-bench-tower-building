import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AttemptRunner, parseSeeds } from '../src/harness/attempts';
import type { RunSummary } from '../src/harness/attempts';

function makeRunner(seeds: number[], outDir: string): AttemptRunner {
  return new AttemptRunner('bricks', seeds, 'test', 'run1', outDir);
}

/** Place every remaining block somewhere safe (laid out on the ground in a grid). */
async function playOutAttempt(runner: AttemptRunner): Promise<void> {
  const inv = (await runner.handleTool('get_inventory', {})) as { inventory: Array<{ id: string }> };
  let i = 0;
  for (const item of inv.inventory) {
    const res = (await runner.handleTool('place_block', {
      blockId: item.id,
      position: [(i % 5) * 2 - 4, 0.12, Math.floor(i / 5) * 2 + 4],
      velocity: [0, -0.2, 0],
      focus: 0.5,
    })) as { ok: boolean; episodeComplete?: { benchmarkComplete: boolean } };
    expect(res.ok).toBe(true);
    i++;
  }
}

describe('parseSeeds', () => {
  it('parses lists and NxS specs', () => {
    expect(parseSeeds('11,12,13')).toEqual([11, 12, 13]);
    expect(parseSeeds('3x11')).toEqual([11, 11, 11]);
    expect(parseSeeds('20x11')).toHaveLength(20);
    expect(parseSeeds('20x11').every((s) => s === 11)).toBe(true);
  });
  it('rejects garbage', () => {
    expect(() => parseSeeds('abc')).toThrow(/bad --seeds/);
  });
});

describe('AttemptRunner', () => {
  it('auto-advances when an attempt completes and finishes the run', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'attempts-'));
    const runner = makeRunner([11, 11], outDir);

    await playOutAttempt(runner); // attempt 1
    expect(runner.isFinished).toBe(false);
    expect(runner.attempts).toHaveLength(1);
    expect(runner.attempts[0]!.endReason).toBe('completed');

    await playOutAttempt(runner); // attempt 2 — last seed, finishes the run
    expect(runner.isFinished).toBe(true);
    expect(runner.attempts).toHaveLength(2);

    // Same seed both attempts => identical outcomes.
    expect(runner.attempts[0]!.score.height).toEqual(runner.attempts[1]!.score.height);

    // Replays + run summary were written.
    const files = readdirSync(outDir);
    expect(files.filter((f) => f.startsWith('test-bricks-a')).length).toBe(2);
    const summary = JSON.parse(readFileSync(join(outDir, 'run-test-bricks-run1.json'), 'utf8')) as RunSummary;
    expect(summary.attempts).toHaveLength(2);

    // Tools refuse further use.
    const res = (await runner.handleTool('place_block', { blockId: 'b1', position: [0, 1, 0], focus: 0.5 })) as { ok: boolean };
    expect(res.ok).toBe(false);
  });

  it('same seed produces identical heights across two runs (cross-run determinism)', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'attempts-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'attempts-b-'));
    const a = makeRunner([7], dirA);
    const b = makeRunner([7], dirB);
    await playOutAttempt(a);
    await playOutAttempt(b);
    expect(a.attempts[0]!.score).toEqual(b.attempts[0]!.score);
  });

  it('next_episode abandons an attempt early and scores it as-is', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'attempts-'));
    const runner = makeRunner([11, 12], outDir);

    await runner.handleTool('place_block', { blockId: 'b1', position: [0, 0.12, 0], velocity: [0, -0.2, 0], focus: 0.5 });
    const res = (await runner.handleTool('next_episode', {})) as { benchmarkComplete: boolean; message: string };
    expect(res.benchmarkComplete).toBe(false);
    expect(runner.attempts).toHaveLength(1);
    expect(runner.attempts[0]!.endReason).toBe('abandoned');
    expect(runner.attempts[0]!.placements).toBe(1);
    expect(runner.attempts[0]!.seed).toBe(11);

    // Attempt 2 uses the second seed with a fresh full inventory.
    const inv = (await runner.handleTool('get_inventory', {})) as { inventory: unknown[] };
    expect(inv.inventory).toHaveLength(20);
  });

  it('includes attempt context in every response', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'attempts-'));
    const runner = makeRunner([11, 11, 11], outDir);
    const res = (await runner.handleTool('get_inventory', {})) as Record<string, unknown>;
    expect(res.attempt).toBe(1);
    expect(res.attemptsTotal).toBe(3);
    expect(res.attemptsCompleted).toEqual([]);
  });

  it('place_blocks executes a batch sequentially and completes the episode', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'attempts-'));
    const runner = makeRunner([11], outDir);
    const inv = (await runner.handleTool('get_inventory', {})) as { inventory: Array<{ id: string }> };
    expect(inv.inventory).toHaveLength(20);

    // Two batches of 6, then one of 8? No — max 6: 6+6+6+2 = 20.
    const batches = [
      inv.inventory.slice(0, 6).map((b, i) => ({ blockId: b.id, position: [i * 2 - 5, 0.12, 4], velocity: [0, -0.2, 0], focus: 0.5 })),
      inv.inventory.slice(6, 12).map((b, i) => ({ blockId: b.id, position: [i * 2 - 5, 0.12, 6], velocity: [0, -0.2, 0], focus: 0.5 })),
      inv.inventory.slice(12, 18).map((b, i) => ({ blockId: b.id, position: [i * 2 - 5, 0.12, 8], velocity: [0, -0.2, 0], focus: 0.5 })),
      inv.inventory.slice(18, 20).map((b, i) => ({ blockId: b.id, position: [i * 2 - 1, 0.12, 10], velocity: [0, -0.2, 0], focus: 0.5 })),
    ];
    let completed = false;
    for (const placements of batches) {
      const res = (await runner.handleTool('place_blocks', { placements })) as {
        results: Array<{ ok: boolean }>;
        episodeComplete?: { benchmarkComplete: boolean };
      };
      for (const r of res.results) expect(r.ok).toBe(true);
      if (res.episodeComplete?.benchmarkComplete) completed = true;
    }
    expect(completed).toBe(true);
    expect(runner.isFinished).toBe(true);
    expect(runner.attempts[0]!.placements).toBe(20);
  });

  it('place_blocks rejects oversized batches and bad items mid-batch', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'attempts-'));
    const runner = makeRunner([11], outDir);

    const tooBig = (await runner.handleTool('place_blocks', {
      placements: Array.from({ length: 7 }, (_, i) => ({ blockId: `b${i + 1}`, position: [0, 0.12, 0], focus: 0.5 })),
    })) as { ok: boolean; error: string };
    expect(tooBig.ok).toBe(false);
    expect(tooBig.error).toMatch(/max 6/);

    const res = (await runner.handleTool('place_blocks', {
      placements: [
        { blockId: 'b1', position: [-2, 0.12, 4], velocity: [0, -0.2, 0], focus: 0.5 },
        { blockId: 'nope', position: [0, 0.12, 4], velocity: [0, -0.2, 0], focus: 0.5 },
        { blockId: 'b2', position: [2, 0.12, 4], velocity: [0, -0.2, 0], focus: 0.5 },
      ],
    })) as { results: Array<{ ok: boolean }> };
    expect(res.results.map((r) => r.ok)).toEqual([true, false, true]);
  });

  it('reports the score prominently when an attempt completes', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'attempts-'));
    const runner = makeRunner([11, 11], outDir);
    let message = '';
    const inv = (await runner.handleTool('get_inventory', {})) as { inventory: Array<{ id: string }> };
    let i = 0;
    for (const item of inv.inventory) {
      const res = (await runner.handleTool('place_block', {
        blockId: item.id,
        position: [(i % 5) * 2 - 4, 0.12, Math.floor(i / 5) * 2 + 4],
        velocity: [0, -0.2, 0],
        focus: 0.5,
      })) as { episodeComplete?: { message: string } };
      if (res.episodeComplete) message = res.episodeComplete.message;
      i++;
    }
    expect(message).toMatch(/Attempt 1 scored \d+\.\d{3}m/);
    expect(message).toMatch(/Attempt 2\/2 started/);
    expect(message).toMatch(/Best so far/);
  });

  it('records notebook entries and mode in the run summary', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'attempts-'));
    const runner = new AttemptRunner('bricks', [11], 'test', 'run1', outDir, '', 'episodic');
    runner.recordNotes(1, 'focus 0.7 drifts +x on seed 11');
    await playOutAttempt(runner);
    const summary = JSON.parse(readFileSync(join(outDir, 'run-test-bricks-run1.json'), 'utf8')) as RunSummary;
    expect(summary.mode).toBe('episodic');
    expect(summary.notebook).toEqual([{ attempt: 1, notes: 'focus 0.7 drifts +x on seed 11' }]);
  });
});
