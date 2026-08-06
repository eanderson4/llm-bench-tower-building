import { describe, expect, it } from 'vitest';
import { FOCUS_MAX, FOCUS_MIN, sigmasForFocus } from '../src/core/uncertainty';

const noise = { sigmaX0: 0.05, sigmaV0: 0.5 };

describe('sigmasForFocus', () => {
  it('keeps sigmaX * sigmaV = K constant across focus values', () => {
    const K = noise.sigmaX0 * noise.sigmaV0;
    for (const f of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const { sigmaX, sigmaV } = sigmasForFocus(f, noise);
      expect(sigmaX * sigmaV).toBeCloseTo(K, 10);
    }
  });

  it('gives exactly (sigmaX0, sigmaV0) at focus = 0.5', () => {
    const { sigmaX, sigmaV } = sigmasForFocus(0.5, noise);
    expect(sigmaX).toBeCloseTo(noise.sigmaX0, 12);
    expect(sigmaV).toBeCloseTo(noise.sigmaV0, 12);
  });

  it('position sigma decreases and velocity sigma increases with focus', () => {
    let prevX = Infinity;
    let prevV = -Infinity;
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const { sigmaX, sigmaV } = sigmasForFocus(f, noise);
      expect(sigmaX).toBeLessThan(prevX);
      expect(sigmaV).toBeGreaterThan(prevV);
      prevX = sigmaX;
      prevV = sigmaV;
    }
  });

  it('clamps focus to keep sigmas finite at the edges', () => {
    expect(sigmasForFocus(0, noise).focus).toBe(FOCUS_MIN);
    expect(sigmasForFocus(1, noise).focus).toBe(FOCUS_MAX);
    expect(Number.isFinite(sigmasForFocus(0, noise).sigmaX)).toBe(true);
    expect(Number.isFinite(sigmasForFocus(1, noise).sigmaV)).toBe(true);
  });
});
