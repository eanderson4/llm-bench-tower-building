import type { NoiseParams, Vec3 } from './types';

export const FOCUS_MIN = 0.02;
export const FOCUS_MAX = 0.98;

export interface Sigmas {
  sigmaX: number;
  sigmaV: number;
  focus: number; // clamped focus actually applied
}

/**
 * The uncertainty contract: sigmaX * sigmaV = sigmaX0 * sigmaV0 = K, constant
 * per challenge. focus = 1 trades everything for position precision (sigmaX -> 0,
 * sigmaV -> inf); focus = 0 does the reverse. focus = 0.5 gives (sigmaX0, sigmaV0).
 */
export function sigmasForFocus(focus: number, noise: NoiseParams): Sigmas {
  const f = Math.min(FOCUS_MAX, Math.max(FOCUS_MIN, focus));
  return {
    sigmaX: (noise.sigmaX0 * (1 - f)) / f,
    sigmaV: (noise.sigmaV0 * f) / (1 - f),
    focus: f,
  };
}

/** Sample an isotropic 3D Gaussian around mean with per-axis sigma. */
export function sampleVec3(gauss: () => number, mean: Vec3, sigma: number): Vec3 {
  return [mean[0] + gauss() * sigma, mean[1] + gauss() * sigma, mean[2] + gauss() * sigma];
}
