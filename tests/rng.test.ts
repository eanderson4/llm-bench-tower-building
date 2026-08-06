import { describe, expect, it } from 'vitest';
import { gaussianFactory, mulberry32 } from '../src/core/rng';

describe('mulberry32', () => {
  it('is deterministic for a fixed seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, a);
    const seqB = Array.from({ length: 10 }, b);
    expect(seqA).toEqual(seqB);
  });

  it('differs across seeds and stays in [0, 1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 100 }, a);
    const seqB = Array.from({ length: 100 }, b);
    expect(seqA).not.toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('gaussianFactory', () => {
  it('has ~zero mean and ~unit variance over many samples', () => {
    const g = gaussianFactory(mulberry32(7));
    const n = 20_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = g();
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(variance).toBeGreaterThan(0.96);
    expect(variance).toBeLessThan(1.04);
  });

  it('is deterministic for a fixed seed', () => {
    const a = gaussianFactory(mulberry32(99));
    const b = gaussianFactory(mulberry32(99));
    expect(Array.from({ length: 10 }, a)).toEqual(Array.from({ length: 10 }, b));
  });
});
