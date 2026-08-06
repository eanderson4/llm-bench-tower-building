import { localVertices, rotateVec, shapeVolume, topY } from './blocks';
import type { Sim } from './sim';
import type { BlockDef, TowerStats, Vec3 } from './types';

/**
 * Tower height = max top-y over blocks with a contact chain to the ground.
 * A lone block lying on the ground is supported (its own top counts), so the
 * way to real height is stacking — single blocks cap out at their own size.
 *
 * Also computes structural analytics over the supported structure: center of
 * mass (mass = volume x density), the base footprint (union AABB of
 * ground-touching blocks), and comMargin — how far the COM projection sits
 * inside that footprint (negative = overhanging, likely to topple).
 */
export function computeTower(sim: Sim, defs: Map<string, BlockDef>, blocksUsed: number): TowerStats {
  const empty: TowerStats = { height: 0, supportedBlocks: 0, blocksUsed, com: null, comMargin: 0, baseWidth: 0 };
  const states = sim.states().filter((s) => defs.has(s.id));
  if (states.length === 0) return empty;

  // BFS over block-block contacts, seeded by ground-touching blocks.
  const adj = new Map<string, string[]>();
  for (const [a, b] of sim.touchingPairs()) {
    if (!defs.has(a) || !defs.has(b)) continue;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const supported = new Set<string>();
  const queue: string[] = [];
  for (const s of states) {
    if (sim.isTouchingGround(s.id)) {
      supported.add(s.id);
      queue.push(s.id);
    }
  }
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const next of adj.get(id) ?? []) {
      if (!supported.has(next)) {
        supported.add(next);
        queue.push(next);
      }
    }
  }
  if (supported.size === 0) return empty;

  let height = 0;
  let massSum = 0;
  const com: Vec3 = [0, 0, 0];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of states) {
    if (!supported.has(s.id)) continue;
    const def = defs.get(s.id)!;
    height = Math.max(height, topY(def, s.position, s.quat));
    const m = shapeVolume(def.shape) * def.material.density;
    massSum += m;
    com[0] += m * s.position[0];
    com[1] += m * s.position[1];
    com[2] += m * s.position[2];
    if (sim.isTouchingGround(s.id)) {
      for (const v of localVertices(def.shape)) {
        const r = rotateVec(s.quat, v);
        minX = Math.min(minX, s.position[0] + r[0]);
        maxX = Math.max(maxX, s.position[0] + r[0]);
        minZ = Math.min(minZ, s.position[2] + r[2]);
        maxZ = Math.max(maxZ, s.position[2] + r[2]);
      }
    }
  }
  com[0] /= massSum;
  com[1] /= massSum;
  com[2] /= massSum;

  let comMargin = 0;
  let baseWidth = 0;
  if (Number.isFinite(minX)) {
    baseWidth = Math.min(maxX - minX, maxZ - minZ);
    const dx = Math.max(minX - com[0], 0, com[0] - maxX);
    const dz = Math.max(minZ - com[2], 0, com[2] - maxZ);
    comMargin =
      dx === 0 && dz === 0
        ? Math.min(com[0] - minX, maxX - com[0], com[2] - minZ, maxZ - com[2])
        : -Math.hypot(dx, dz);
  }

  return { height, supportedBlocks: supported.size, blocksUsed, com, comMargin, baseWidth };
}
