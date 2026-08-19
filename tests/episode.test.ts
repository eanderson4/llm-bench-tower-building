import { describe, expect, it } from 'vitest';
import { getChallenge } from '../src/core/challenges';
import { Episode } from '../src/core/episode';

const bricks = () => getChallenge('bricks');

async function freshEpisode(seed = 42): Promise<Episode> {
  return Episode.create(bricks(), seed);
}

describe('validation', () => {
  it('rejects an unknown block id and names the valid ones', async () => {
    const ep = await freshEpisode();
    const res = ep.place({ blockId: 'nope', position: [0, 1, 0], focus: 0.5 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not in the remaining inventory/);
    expect(res.error).toMatch(/b1/);
  });

  it('rejects focus outside [0, 1]', async () => {
    const ep = await freshEpisode();
    const res = ep.place({ blockId: 'b1', position: [0, 1, 0], focus: 1.5 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/focus/);
  });

  it('rejects out-of-bounds positions', async () => {
    const ep = await freshEpisode();
    const res = ep.place({ blockId: 'b1', position: [100, 1, 0], focus: 0.5 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ground plane/);
  });

  it('rejects velocity above maxSpeed with the actual numbers', async () => {
    const ep = await freshEpisode();
    const res = ep.place({ blockId: 'b1', position: [0, 1, 0], velocity: [0, -99, 0], focus: 0.5 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/maxSpeed 3/);
  });

  it('rejects malformed positions', async () => {
    const ep = await freshEpisode();
    const res = ep.place({ blockId: 'b1', position: [0, Number.NaN, 0] as never, focus: 0.5 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/position/);
  });

  it('rejects placements after the inventory is exhausted', async () => {
    const ep = await freshEpisode();
    for (const item of [...ep.inventory()]) {
      const res = ep.place({ blockId: item.id, position: [0, 0.4, 0], focus: 0.9 });
      expect(res.ok).toBe(true);
    }
    const res = ep.place({ blockId: 'b1', position: [0, 0.4, 0], focus: 0.5 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/done/);
  });

  it('does not consume inventory on rejected placements', async () => {
    const ep = await freshEpisode();
    const before = ep.inventory().length;
    ep.place({ blockId: 'nope', position: [0, 1, 0], focus: 0.5 });
    ep.place({ blockId: 'b1', position: [0, 1, 0], focus: 2 });
    expect(ep.inventory().length).toBe(before);
  });
});

describe('placement', () => {
  it('places a valid block, reveals actuals, and consumes inventory', async () => {
    const ep = await freshEpisode();
    const res = ep.place({ blockId: 'b1', position: [0, 0.5, 0], velocity: [0, -0.3, 0], focus: 0.9 });
    expect(res.ok).toBe(true);
    expect(res.actual).toBeDefined();
    expect(res.actual!.position).toHaveLength(3);
    expect(res.actual!.velocity).toHaveLength(3);
    expect(res.actual!.sigma.x).toBeLessThan(res.actual!.sigma.v / 10); // focus 0.9 favors position
    expect(res.settle).toBeDefined();
    expect(['settled', 'toppled']).toContain(res.settle!.outcome);
    expect(ep.inventory().find((i) => i.id === 'b1')).toBeUndefined();
    expect(ep.observe().placements).toBe(1);
  });

  it('a block placed low with high focus ends up resting on the ground', async () => {
    const ep = await freshEpisode(3);
    const res = ep.place({ blockId: 'b1', position: [0, 0.15, 0], velocity: [0, -0.2, 0], focus: 0.95 });
    expect(res.ok).toBe(true);
    expect(res.settle!.outcome).toBe('settled');
    expect(res.settle!.blockFinal.onGround).toBe(true);
    expect(res.settle!.tower.height).toBeGreaterThan(0.1);
    expect(res.settle!.tower.height).toBeLessThan(0.3);
  });

  it('records settleCapHit in the result and replay (false for a normal placement)', async () => {
    const ep = await freshEpisode(3);
    const res = ep.place({ blockId: 'b1', position: [0, 0.15, 0], velocity: [0, -0.2, 0], focus: 0.95 });
    expect(res.ok).toBe(true);
    expect(res.settle!.settleCapHit).toBe(false);
    expect(ep.replay().placements[0]!.settleCapHit).toBe(false);
  });

  it('sigma contract shows up in actuals: focus 0.2 is velocity-precise', async () => {
    const ep = await freshEpisode(11);
    const res = ep.place({ blockId: 'b1', position: [0, 0.5, 0], focus: 0.2 });
    // bricks noise is sigmaX0=0.02, sigmaV0=0.3.
    // f=0.2: sigmaX = 0.02 * 0.8/0.2 = 0.08, sigmaV = 0.3 * 0.2/0.8 = 0.075
    expect(res.actual!.sigma.x).toBeCloseTo(0.08, 10);
    expect(res.actual!.sigma.v).toBeCloseTo(0.075, 10);
  });
});

describe('determinism', () => {
  const script = [
    { blockId: 'b1', position: [0, 0.15, 0] as [number, number, number], velocity: [0, -0.2, 0] as [number, number, number], focus: 0.9 },
    { blockId: 'b2', position: [0, 0.4, 0] as [number, number, number], yawDeg: 90, velocity: [0, -0.2, 0] as [number, number, number], focus: 0.7 },
    { blockId: 'b3', position: [0, 0.65, 0] as [number, number, number], focus: 0.5 },
  ];

  it('same seed + same requests => identical outcomes', async () => {
    const run = async () => {
      const ep = await freshEpisode(123);
      const actuals = script.map((req) => ep.place({ ...req }).actual);
      return { actuals, score: ep.score(), states: ep.observe().blocks };
    };
    const a = await run();
    const b = await run();
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('different seeds => different sampled actuals', async () => {
    const run = async (seed: number) => {
      const ep = await freshEpisode(seed);
      return script.map((req) => ep.place({ ...req }).actual);
    };
    const a = await run(1);
    const b = await run(2);
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });
});

describe('scoring', () => {
  // Sane strategy: low spawn, slight downward velocity, balanced focus.
  // (focus 0.95 here would mean sigmaV = 9.5 m/s — the block kicks itself off.)
  it('two stacked bricks beat one brick alone', async () => {
    const ep = await freshEpisode(5);
    ep.place({ blockId: 'b1', position: [0, 0.12, 0], velocity: [0, -0.2, 0], focus: 0.5 });
    const two = ep.place({ blockId: 'b2', position: [0, 0.31, 0], velocity: [0, -0.2, 0], focus: 0.5 });
    expect(two.settle!.tower.height).toBeGreaterThan(0.35);
    expect(two.settle!.tower.height).toBeLessThan(0.5);
    expect(two.settle!.tower.supportedBlocks).toBe(2);
  });

  it('a far-away lone block is supported but caps out at its own height', async () => {
    const ep = await freshEpisode(6);
    ep.place({ blockId: 'b1', position: [0, 0.12, 0], velocity: [0, -0.2, 0], focus: 0.5 });
    ep.place({ blockId: 'b2', position: [0, 0.31, 0], velocity: [0, -0.2, 0], focus: 0.5 });
    const far = ep.place({ blockId: 'b3', position: [10, 0.12, 10], velocity: [0, -0.2, 0], focus: 0.5 });
    // b3 lies flat on the ground at (10, 10): supported, but only 0.2m tall;
    // the 2-brick stack at the origin still defines the tower height.
    expect(far.settle!.tower.height).toBeGreaterThan(0.35);
    expect(far.settle!.tower.supportedBlocks).toBe(3);
  });

  it('reports COM analytics for a centered stack', async () => {
    const ep = await freshEpisode(9);
    ep.place({ blockId: 'b1', position: [0, 0.12, 0], velocity: [0, -0.2, 0], focus: 0.5 });
    const two = ep.place({ blockId: 'b2', position: [0, 0.31, 0], velocity: [0, -0.2, 0], focus: 0.5 });
    const t = two.settle!.tower;
    expect(t.com).not.toBeNull();
    expect(t.com![1]).toBeGreaterThan(0.1);
    expect(t.com![1]).toBeLessThan(0.35);
    expect(Math.abs(t.com![0])).toBeLessThan(0.1);
    expect(t.comMargin).toBeGreaterThan(0.05); // centered stack has margin to the base edge
    expect(t.baseWidth).toBeGreaterThan(0.25); // brick depth is 0.3
  });

  it('score tracks peak height even after a collapse', async () => {
    const ep = await freshEpisode(8);
    ep.place({ blockId: 'b1', position: [0, 0.15, 0], velocity: [0, -0.2, 0], focus: 0.95 });
    ep.place({ blockId: 'b2', position: [0, 0.4, 0], velocity: [0, -0.2, 0], focus: 0.95 });
    const peakAfterTwo = ep.score().peakHeight;
    // Slam b3 sideways into the stack at max allowed speed.
    ep.place({ blockId: 'b3', position: [1.5, 0.35, 0], velocity: [-3, 0, 0], focus: 0.98 });
    const score = ep.score();
    expect(score.peakHeight).toBeGreaterThanOrEqual(peakAfterTwo);
    expect(score.peakHeight).toBeGreaterThanOrEqual(score.height);
  });
});
