import RAPIER from '@dimforge/rapier3d-compat';
import type { BlockDef, BlockShape, Orientation, Quat, Vec3 } from './types';

export function yawToQuat(yawDeg: number): Quat {
  const half = (yawDeg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

/** Hamilton product a ⊗ b — applies b first, then a (both unit quaternions). */
export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotate a vector by a quaternion. */
export function rotateVec(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

const IDENTITY: Quat = [0, 0, 0, 1];
const RX90: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // local +z -> world -y (d up)
const RZ90: Quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2]; // local +x -> world +y (w up)

export function defaultOrientation(shape: BlockShape): Orientation {
  return shape.kind === 'cylinder' ? 'upright' : 'flat';
}

export function supportedOrientations(shape: BlockShape): Orientation[] {
  switch (shape.kind) {
    case 'box':
      return ['flat', 'side', 'upright'];
    case 'cylinder':
      return ['upright', 'flat'];
    case 'wedge':
      return ['flat'];
  }
}

/** Orientation quaternion (before yaw), or null if unsupported for the shape. */
export function orientationQuat(shape: BlockShape, orientation: Orientation): Quat | null {
  switch (shape.kind) {
    case 'box':
      if (orientation === 'flat') return IDENTITY;
      if (orientation === 'side') return RX90;
      return RZ90; // upright
    case 'cylinder':
      if (orientation === 'upright') return IDENTITY;
      if (orientation === 'flat') return RX90; // axis vertical -> horizontal along z
      return null;
    case 'wedge':
      return orientation === 'flat' ? IDENTITY : null;
  }
}

/** Full spawn rotation. Precedence: explicit quat (normalized) > orientation + yaw > shape default. */
export function placementQuat(shape: BlockShape, yawDeg = 0, orientation?: Orientation, quat?: Quat): Quat {
  if (quat) {
    const n = Math.hypot(quat[0], quat[1], quat[2], quat[3]);
    return [quat[0] / n, quat[1] / n, quat[2] / n, quat[3] / n];
  }
  const oq = orientationQuat(shape, orientation ?? defaultOrientation(shape));
  if (!oq) throw new Error(`orientation ${orientation} not supported for ${shape.kind}`);
  return quatMultiply(yawToQuat(yawDeg), oq);
}

/** Corner/surface points of a shape in its local frame. Used for AABB/top-y queries. */
export function localVertices(shape: BlockShape): Vec3[] {
  switch (shape.kind) {
    case 'box': {
      const [x, y, z] = [shape.size[0] / 2, shape.size[1] / 2, shape.size[2] / 2];
      return [
        [-x, -y, -z], [x, -y, -z], [-x, y, -z], [x, y, -z],
        [-x, -y, z], [x, -y, z], [-x, y, z], [x, y, z],
      ];
    }
    case 'cylinder': {
      const pts: Vec3[] = [];
      const y = shape.height / 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const cx = Math.cos(a) * shape.radius;
        const cz = Math.sin(a) * shape.radius;
        pts.push([cx, -y, cz], [cx, y, cz]);
      }
      return pts;
    }
    case 'wedge':
      return wedgeVertices(shape.size);
  }
}

/** Right-triangle prism: right angle at (-x, -y), ramp ascends toward -x. */
export function wedgeVertices(size: Vec3): Vec3[] {
  const [x, y, z] = [size[0] / 2, size[1] / 2, size[2] / 2];
  return [
    [-x, -y, -z], [x, -y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [-x, y, z],
  ];
}

/** Half of the shape's vertical extent in a given orientation. */
export function orientedHalfHeight(shape: BlockShape, orientation?: Orientation): number {
  const oq = orientationQuat(shape, orientation ?? defaultOrientation(shape))!;
  return quatHalfHeight(shape, oq);
}

/** Half of the shape's vertical extent under an arbitrary rotation. */
export function quatHalfHeight(shape: BlockShape, quat: Quat): number {
  let max = 0;
  for (const v of localVertices(shape)) {
    max = Math.max(max, Math.abs(rotateVec(quat, v)[1]));
  }
  return max;
}

/** Half of the shape's vertical extent in its default orientation. */
export function halfHeight(shape: BlockShape): number {
  return orientedHalfHeight(shape);
}

/** Highest world-space y of the shape at a given pose. */
export function topY(def: BlockDef, position: Vec3, quat: Quat): number {
  let max = -Infinity;
  for (const v of localVertices(def.shape)) {
    const r = rotateVec(quat, v);
    if (position[1] + r[1] > max) max = position[1] + r[1];
  }
  return max;
}

export function colliderDescFor(def: BlockDef): RAPIER.ColliderDesc {
  const { shape } = def;
  switch (shape.kind) {
    case 'box':
      return RAPIER.ColliderDesc.cuboid(shape.size[0] / 2, shape.size[1] / 2, shape.size[2] / 2);
    case 'cylinder':
      return RAPIER.ColliderDesc.cylinder(shape.height / 2, shape.radius);
    case 'wedge': {
      const pts = new Float32Array(wedgeVertices(shape.size).flat());
      const desc = RAPIER.ColliderDesc.convexHull(pts);
      if (!desc) throw new Error('failed to build wedge convex hull');
      return desc;
    }
  }
}

/** Volume in m^3 (wedge = right-triangular prism = half its bounding box). */
export function shapeVolume(shape: BlockShape): number {
  switch (shape.kind) {
    case 'box':
      return shape.size[0] * shape.size[1] * shape.size[2];
    case 'cylinder':
      return Math.PI * shape.radius ** 2 * shape.height;
    case 'wedge':
      return 0.5 * shape.size[0] * shape.size[1] * shape.size[2];
  }
}
