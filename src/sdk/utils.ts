import {
  halfHeight,
  localVertices,
  placementQuat,
  quatHalfHeight,
  quatMultiply,
  rotateVec,
  topY,
  yawToQuat,
} from '../core/blocks';
import { sigmasForFocus } from '../core/uncertainty';
import type { BlockDef, BlockShape, NoiseParams, Orientation, Quat, Vec3 } from '../core/types';

export { halfHeight, quatMultiply, topY, yawToQuat };

/**
 * Spatial utility functions for agents. These are deliberately trivial to call:
 * the benchmark measures how well a model *chooses* placements, not whether it
 * can redo quaternion trig. All are pure.
 */

/** Quaternion for rotating `angleDeg` degrees about `axis` (need not be unit). */
export function quatFromAxisAngle(axis: Vec3, angleDeg: number): Quat {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (n === 0) throw new Error('axis must be non-zero');
  const half = (angleDeg * Math.PI) / 360;
  const s = Math.sin(half) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

/** Full spawn rotation from placement-style params (quat > orientation+yaw > default). */
export function resolveQuat(shape: BlockShape, opts: { yawDeg?: number; orientation?: Orientation; quat?: Quat }): Quat {
  return placementQuat(shape, opts.yawDeg ?? 0, opts.orientation, opts.quat);
}

/** Half-extents [hx, hy, hz] of a shape's AABB under a rotation (yaw and/or orientation). */
export function rotatedExtents(shape: BlockShape, yawDeg = 0, orientation?: Orientation): Vec3 {
  const q = placementQuat(shape, yawDeg, orientation);
  let hx = 0;
  let hy = 0;
  let hz = 0;
  for (const v of localVertices(shape)) {
    const r = rotateVec(q, v);
    hx = Math.max(hx, Math.abs(r[0]));
    hy = Math.max(hy, Math.abs(r[1]));
    hz = Math.max(hz, Math.abs(r[2]));
  }
  return [hx, hy, hz];
}

/**
 * Center-y at which a block's bottom sits exactly `clearance` above a support
 * whose top surface is at `supportTopY`. Pair with a small downward velocity to
 * place gently instead of dropping.
 */
export function stackCenterY(shape: BlockShape, supportTopY: number, clearance = 0.05, orientation?: Orientation): number {
  const q = placementQuat(shape, 0, orientation);
  return supportTopY + quatHalfHeight(shape, q) + clearance;
}

/** World-space top-y of a shape placed with its center at `centerY` (in the given orientation). */
export function topYAt(shape: BlockShape, centerY: number, orientation?: Orientation): number {
  const q = placementQuat(shape, 0, orientation);
  return centerY + quatHalfHeight(shape, q);
}

/** Horizontal distance from (x, z) to the vertical line through (cx, cz). */
export function horizontalDistance(from: Vec3, to: Vec3): number {
  return Math.hypot(from[0] - to[0], from[2] - to[2]);
}

/**
 * Footprint of a block at a pose: center and half-extents of its rotated
 * AABB in the x/z plane. Useful for overlap checks against existing blocks.
 */
export function footprint(
  shape: BlockShape,
  center: Vec3,
  yawDeg: number,
  orientation?: Orientation,
): { cx: number; cz: number; hx: number; hz: number } {
  const [hx, , hz] = rotatedExtents(shape, yawDeg, orientation);
  return { cx: center[0], cz: center[2], hx, hz };
}

/** Do two footprints overlap (with an optional margin)? */
export function footprintsOverlap(
  a: { cx: number; cz: number; hx: number; hz: number },
  b: { cx: number; cz: number; hx: number; hz: number },
  margin = 0,
): boolean {
  return Math.abs(a.cx - b.cx) < a.hx + b.hx + margin && Math.abs(a.cz - b.cz) < a.hz + b.hz + margin;
}

/**
 * Preview the noise a focus value buys under a challenge's noise params.
 * sigmaX is the per-axis position stddev (m), sigmaV the per-axis velocity
 * stddev (m/s). Their product is the challenge constant K.
 */
export function previewSigmas(focus: number, noise: NoiseParams): { sigmaX: number; sigmaV: number } {
  const { sigmaX, sigmaV } = sigmasForFocus(focus, noise);
  return { sigmaX, sigmaV };
}

/**
 * Rotate a local offset (e.g. "half a block length to the left") by yaw into
 * world x/z, so offsets can be composed in the block's own frame.
 */
export function rotateOffsetY(offset: Vec3, yawDeg: number): Vec3 {
  return rotateVec(yawToQuat(yawDeg), offset);
}

/** All local corner/surface points of a def (advanced use: precise overlap math). */
export function shapeVertices(def: BlockDef): Vec3[] {
  return localVertices(def.shape);
}
