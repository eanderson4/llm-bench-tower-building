import { describe, expect, it } from 'vitest';
import {
  halfHeight,
  orientedHalfHeight,
  placementQuat,
  quatMultiply,
  rotateVec,
  yawToQuat,
} from '../src/core/blocks';
import { getChallenge } from '../src/core/challenges';
import { Episode } from '../src/core/episode';
import { quatFromAxisAngle } from '../src/sdk/utils';
import type { BlockShape, Quat } from '../src/core/types';

const BRICK: BlockShape = { kind: 'box', size: [0.9, 0.2, 0.3] };
const S = Math.SQRT1_2;

describe('quaternion math', () => {
  it('quatFromAxisAngle builds unit quaternions regardless of axis magnitude', () => {
    const q1 = quatFromAxisAngle([0, 0, 1], 90);
    const q5 = quatFromAxisAngle([0, 0, 5], 90);
    for (let i = 0; i < 4; i++) {
      expect(q1[i]).toBeCloseTo(i === 2 || i === 3 ? S : 0, 12);
      expect(q5[i]).toBeCloseTo(q1[i]!, 12);
    }
  });

  it('quatMultiply applies b before a', () => {
    // yaw 90 about y, then check a point along local x maps to world -z... after quatMultiply(yaw, orient)
    const q = quatMultiply(yawToQuat(90), [0, 0, 0, 1]);
    const v = rotateVec(q, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 10);
    expect(Math.abs(v[2])).toBeCloseTo(1, 10);
  });

  it('orientedHalfHeight matches the brick poses', () => {
    expect(halfHeight(BRICK)).toBeCloseTo(0.1, 10); // flat: h up
    expect(orientedHalfHeight(BRICK, 'flat')).toBeCloseTo(0.1, 10);
    expect(orientedHalfHeight(BRICK, 'side')).toBeCloseTo(0.15, 10); // d up
    expect(orientedHalfHeight(BRICK, 'upright')).toBeCloseTo(0.45, 10); // w up
  });

  it('placementQuat: explicit quat takes precedence and is normalized', () => {
    const q = placementQuat(BRICK, 45, 'upright', [1, 0, 0, 1] as Quat);
    expect(q[0]).toBeCloseTo(S, 10);
    expect(q[3]).toBeCloseTo(S, 10);
    // and it equals a pure x-axis 90-degree rotation, not upright-about-z
    const v = rotateVec(q, [0, 1, 0]);
    expect(v[1]).toBeCloseTo(0, 10);
    expect(Math.abs(v[2])).toBeCloseTo(1, 10);
  });
});

describe('orientation validation', () => {
  it('rejects unsupported orientations with a helpful message', async () => {
    const ep = await Episode.create(getChallenge('mixed'), 1);
    const cyl = ep.inventory().find((i) => i.def.shape.kind === 'cylinder')!;
    const res = ep.place({ blockId: cyl.id, position: [0, 1, 0], orientation: 'upright' as never, focus: 0.5 });
    // cylinder supports upright; wedge does not support upright
    expect(res.ok).toBe(true);
    const wedge = ep.inventory().find((i) => i.def.shape.kind === 'wedge')!;
    const res2 = ep.place({ blockId: wedge.id, position: [0, 1, 0], orientation: 'upright', focus: 0.5 });
    expect(res2.ok).toBe(false);
    expect(res2.error).toMatch(/not supported for a wedge/);
    expect(res2.error).toMatch(/flat/);
  });

  it('rejects a wildly non-unit quat', async () => {
    const ep = await Episode.create(getChallenge('bricks'), 1);
    const res = ep.place({ blockId: 'b1', position: [0, 1, 0], quat: [5, 0, 0, 5], focus: 0.5 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unit length/);
  });
});

describe('orientation physics', () => {
  it('an upright brick placed gently stands and scores ~0.9m', async () => {
    const ep = await Episode.create(getChallenge('bricks'), 42);
    const res = ep.place({ blockId: 'b1', position: [0, 0.47, 0], orientation: 'upright', velocity: [0, -0.2, 0], focus: 0.5 });
    expect(res.ok).toBe(true);
    expect(res.settle!.outcome).toBe('settled');
    expect(res.settle!.tower.height).toBeGreaterThan(0.7);
    expect(res.settle!.tower.height).toBeLessThan(1.0);
  });

  it('a quat-rotated brick uses the submitted rotation (side pose => 0.3m)', async () => {
    const ep = await Episode.create(getChallenge('bricks'), 43);
    const res = ep.place({ blockId: 'b1', position: [0, 0.17, 0], quat: [S, 0, 0, S], velocity: [0, -0.2, 0], focus: 0.5 });
    expect(res.ok).toBe(true);
    const [qx, , , qw] = res.settle!.blockFinal.quat;
    expect(Math.abs(qx)).toBeCloseTo(S, 1); // rotation survived (may differ by sign/noise)
    expect(Math.abs(qw)).toBeCloseTo(S, 1);
    expect(res.settle!.tower.height).toBeGreaterThan(0.24);
    expect(res.settle!.tower.height).toBeLessThan(0.36);
  });
});

describe('spawn overlap feedback', () => {
  it('flags a placement that spawns inside another block', async () => {
    const ep = await Episode.create(getChallenge('bricks'), 7);
    const r1 = ep.place({ blockId: 'b1', position: [0, 0.11, 0], velocity: [0, -0.2, 0], focus: 0.5 });
    expect(r1.ok).toBe(true);
    // Drop b2 right into b1's settled position (high position focus => tiny spawn noise).
    const p = r1.settle!.blockFinal.position;
    const res = ep.place({ blockId: 'b2', position: [p[0], p[1] + 0.05, p[2]], velocity: [0, 0, 0], focus: 0.98 });
    expect(res.ok).toBe(true);
    expect(res.settle!.spawnOverlap).toBe(true);
    expect(res.settle!.spawnPenetration).toBeGreaterThan(0.01);
  });

  it('does not flag a clean placement', async () => {
    const ep = await Episode.create(getChallenge('bricks'), 7);
    const res = ep.place({ blockId: 'b1', position: [0, 0.5, 0], velocity: [0, -0.2, 0], focus: 0.5 });
    expect(res.settle!.spawnOverlap).toBe(false);
  });
});

describe('replay noise visibility', () => {
  it('replay carries the challenge noise params', async () => {
    const ep = await Episode.create(getChallenge('bricks'), 1);
    ep.place({ blockId: 'b1', position: [0, 0.12, 0], velocity: [0, -0.2, 0], focus: 0.5 });
    expect(ep.replay().noise).toEqual({ sigmaX0: 0.02, sigmaV0: 0.3 });
  });
});
