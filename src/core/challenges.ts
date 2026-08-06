import { WOOD } from './types';
import type { BlockDef, ChallengeDef, InventoryItem } from './types';

function items(prefix: string, defs: BlockDef[]): InventoryItem[] {
  return defs.map((def, i) => ({ id: `${prefix}${i + 1}`, def }));
}

function repeat(def: BlockDef, n: number): BlockDef[] {
  return Array.from({ length: n }, () => def);
}

const BRICK: BlockDef = { shape: { kind: 'box', size: [0.9, 0.2, 0.3] }, material: WOOD };

const BASE = {
  gravity: -9.81,
  groundSize: 40,
  maxSpeed: 3,
  // Default mode: gentle uncertainty — the game is about tower building.
  noise: { sigmaX0: 0.02, sigmaV0: 0.3 },
};

const BRICKS_INVENTORY = items('b', repeat(BRICK, 20));

const PILLARS_INVENTORY = (pillars = 8, lintels = 6, cubes = 4) =>
  items('p', [
    ...repeat({ shape: { kind: 'box', size: [0.3, 1.2, 0.3] }, material: WOOD }, pillars),
    ...repeat({ shape: { kind: 'box', size: [1.2, 0.15, 0.4] }, material: WOOD }, lintels),
    ...repeat({ shape: { kind: 'box', size: [0.35, 0.35, 0.35] }, material: WOOD }, cubes),
  ]);

export const CHALLENGES: Record<string, ChallengeDef> = {
  bricks: {
    ...BASE,
    id: 'bricks',
    name: 'Bricks',
    description: '20 identical wooden bricks. The baseline: pure stacking strategy and focus allocation.',
    inventory: BRICKS_INVENTORY,
  },
  bricks50: {
    ...BASE,
    id: 'bricks50',
    name: 'Bricks XL',
    description: '50 identical wooden bricks. Long-game stacking: base design and error budget matter more than single placements.',
    inventory: items('b', repeat(BRICK, 50)),
  },
  bricks100: {
    ...BASE,
    id: 'bricks100',
    name: 'Bricks XXL',
    description: '100 identical wooden bricks. Endurance architecture: one bad layer can kill a tall tower 60 placements later.',
    inventory: items('b', repeat(BRICK, 100)),
  },
  bricks50k2: {
    ...BASE,
    id: 'bricks50k2',
    name: 'Bricks XL · K/2',
    description: 'Same 50 bricks as bricks50, but the uncertainty constant K is ~2x smaller (sigmaX0=0.015, sigmaV0=0.2). Medium precision: how much of bricks50 collapse is noise vs planning?',
    noise: { sigmaX0: 0.015, sigmaV0: 0.2 },
    inventory: items('b', repeat(BRICK, 50)),
  },
  bricks50k4: {
    ...BASE,
    id: 'bricks50k4',
    name: 'Bricks XL · K/4',
    description: 'Same 50 bricks as bricks50, but the uncertainty constant K is ~4x smaller (sigmaX0=0.01, sigmaV0=0.15). High precision: near-deterministic placement.',
    noise: { sigmaX0: 0.01, sigmaV0: 0.15 },
    inventory: items('b', repeat(BRICK, 50)),
  },
  mixed: {
    ...BASE,
    id: 'mixed',
    name: 'Mixed shapes',
    description: 'Boxes, cylinders, and wedges. Irregular centers of mass reward creative structure.',
    inventory: items('m', [
      ...repeat({ shape: { kind: 'box', size: [0.8, 0.2, 0.4] }, material: WOOD }, 4),
      { shape: { kind: 'box', size: [0.4, 0.4, 0.4] }, material: WOOD },
      ...repeat({ shape: { kind: 'cylinder', radius: 0.18, height: 0.6 }, material: WOOD }, 2),
      ...repeat({ shape: { kind: 'wedge', size: [0.6, 0.3, 0.4] }, material: WOOD }, 2),
      ...repeat({ shape: { kind: 'box', size: [0.3, 0.15, 0.3] }, material: WOOD }, 3),
    ]),
  },
  sparse: {
    ...BASE,
    id: 'sparse',
    name: 'Sparse',
    description: '2 large platform blocks and 10 small cubes. Resource planning: platforms are precious.',
    inventory: items('s', [
      ...repeat({ shape: { kind: 'box', size: [2.0, 0.4, 2.0] }, material: WOOD }, 2),
      ...repeat({ shape: { kind: 'box', size: [0.35, 0.15, 0.35] }, material: WOOD }, 10),
    ]),
  },
  storm: {
    ...BASE,
    id: 'storm',
    name: 'Storm',
    description: 'Same 20 bricks, but the uncertainty constant K is ~4x larger. Robustness strategies required.',
    noise: { sigmaX0: 0.05, sigmaV0: 0.5 },
    inventory: BRICKS_INVENTORY,
  },
  pillars: {
    ...BASE,
    id: 'pillars',
    name: 'Pillars',
    description: 'Tall 1.2m columns plus lintel slabs and cubes — post-and-lintel architecture on a small footprint.',
    inventory: PILLARS_INVENTORY(),
  },
  pillarsk2: {
    ...BASE,
    id: 'pillarsk2',
    name: 'Pillars · K/2',
    description: 'Same post-and-lintel inventory as pillars, but the uncertainty constant K is ~2x smaller (sigmaX0=0.015, sigmaV0=0.2). Less collapse lottery, more architecture.',
    noise: { sigmaX0: 0.015, sigmaV0: 0.2 },
    inventory: PILLARS_INVENTORY(),
  },
  pillarsxl: {
    ...BASE,
    id: 'pillarsxl',
    name: 'Pillars XL · K/2',
    description: 'Post-and-lintel at scale: 14 columns, 10 lintels, 6 cubes (30 blocks) at K/2 precision (sigmaX0=0.015, sigmaV0=0.2). Enough material that a perfect build is statistically out of reach — the score measures how far you get, not whether you finish.',
    noise: { sigmaX0: 0.015, sigmaV0: 0.2 },
    inventory: PILLARS_INVENTORY(14, 10, 6),
  },
  slick: {
    ...BASE,
    id: 'slick',
    name: 'Slick',
    description: 'Same 20 bricks with friction 0.15 (polished stone). Horizontal velocity errors punish hard.',
    inventory: items('b', repeat({ ...BRICK, material: { density: 600, friction: 0.15, restitution: 0.05 } }, 20)),
  },
};

export function getChallenge(id: string): ChallengeDef {
  const c = CHALLENGES[id];
  if (!c) throw new Error(`unknown challenge "${id}". Available: ${Object.keys(CHALLENGES).join(', ')}`);
  return c;
}
