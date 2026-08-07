export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

/** Body orientation. box: flat = h up, side = d up, upright = w up (standing on
 * end). cylinder: upright = axis vertical, flat = lying (rolls; yaw picks the
 * axis). wedge: flat only. Default: box/wedge flat, cylinder upright. */
export type Orientation = 'flat' | 'side' | 'upright';

export interface Material {
  density: number; // kg/m^3
  friction: number; // Coulomb coefficient, 0 = ice, ~0.6 = wood
  restitution: number; // bounciness, 0 = none
}

export const WOOD: Material = { density: 600, friction: 0.6, restitution: 0.05 };

export type BlockShape =
  | { kind: 'box'; size: Vec3 } // full extents w, h, d
  | { kind: 'cylinder'; radius: number; height: number } // axis along local y
  | { kind: 'wedge'; size: Vec3 }; // right-triangle prism, ramp ascends toward -x

export interface BlockDef {
  shape: BlockShape;
  material: Material;
}

export interface InventoryItem {
  id: string;
  def: BlockDef;
}

export interface PlaceRequest {
  blockId: string;
  position: Vec3; // desired center, world frame, y-up, meters
  yawDeg?: number; // rotation about the vertical axis, applied AFTER orientation, default 0
  orientation?: Orientation; // default: box/wedge 'flat', cylinder 'upright'
  quat?: Quat; // full-resolution rotation — takes precedence over yaw/orientation
  velocity?: Vec3; // desired initial velocity (mean of the sampled velocity), default [0,0,0]
  focus: number; // 0..1 — 1 = max position precision, 0 = max velocity precision
}

export interface BlockState {
  id: string;
  position: Vec3;
  quat: Quat;
  resting: boolean; // ~zero velocity at settle time
  onGround: boolean; // touching the ground collider
}

export interface TowerStats {
  height: number; // max top-y over blocks with a contact chain to the ground
  supportedBlocks: number;
  blocksUsed: number;
  com: Vec3 | null; // center of mass of the supported structure, null when empty
  comMargin: number; // distance (m) from the COM projection to the base footprint edge; negative = overhanging
  baseWidth: number; // min side length (m) of the base footprint AABB in x/z
}

export interface PlaceResult {
  ok: boolean;
  error?: string; // validation failure; always retryable
  actual?: {
    position: Vec3;
    velocity: Vec3;
    sigma: { x: number; v: number };
  };
  settle?: {
    outcome: 'settled' | 'toppled';
    blockFinal: BlockState;
    tower: TowerStats;
    spawnOverlap: boolean; // true if the sampled spawn interpenetrated something
    spawnPenetration: number; // deepest overlap at spawn (m, 0 if none)
    settleCapHit: boolean; // true if the world was still moving at the settle time cap
  };
}

export interface Observation {
  status: 'active' | 'done';
  inventory: InventoryItem[]; // remaining
  blocks: BlockState[]; // placed blocks, current poses
  tower: TowerStats;
  placements: number; // used so far
}

export interface Score {
  height: number; // settled supported height at episode end
  peakHeight: number; // best settled supported height at any point
  blocksUsed: number;
}

export interface NoiseParams {
  sigmaX0: number; // position sigma (m) at focus = 0.5
  sigmaV0: number; // velocity sigma (m/s) at focus = 0.5
}

export interface ChallengeDef {
  id: string;
  name: string;
  description: string;
  gravity: number; // y component, m/s^2
  groundSize: number; // square ground plane edge length, m
  noise: NoiseParams;
  maxSpeed: number; // cap on requested velocity magnitude, m/s
  inventory: InventoryItem[];
}

export interface ReplayPlacement {
  req: PlaceRequest;
  actual: { position: Vec3; velocity: Vec3; sigma: { x: number; v: number } };
  settleCapHit?: boolean; // true if this placement's settle hit the time cap (absent in pre-v2 replays)
}

export interface ReplayFile {
  version: 1;
  challengeId: string;
  seed: number;
  noise: NoiseParams; // the uncertainty environment these placements were made under
  inventory: InventoryItem[];
  placements: ReplayPlacement[];
  score: Score;
}
