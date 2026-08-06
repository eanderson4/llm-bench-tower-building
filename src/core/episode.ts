import {
  defaultOrientation,
  orientationQuat,
  placementQuat,
  quatHalfHeight,
  supportedOrientations,
} from './blocks';
import { mulberry32, gaussianFactory } from './rng';
import { computeTower } from './scoring';
import { Sim } from './sim';
import { sigmasForFocus, sampleVec3 } from './uncertainty';
import type {
  BlockDef,
  ChallengeDef,
  InventoryItem,
  Observation,
  PlaceRequest,
  PlaceResult,
  ReplayFile,
  ReplayPlacement,
  Score,
  TowerStats,
  Vec3,
} from './types';

const MAX_SPAWN_Y = 20;

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/**
 * One tower-building episode: validates placement requests, applies the
 * uncertainty model, simulates to rest, and records a deterministic replay.
 */
export class Episode {
  private sim!: Sim;
  private remaining = new Map<string, InventoryItem>();
  private defs = new Map<string, BlockDef>(); // placed blocks, for scoring
  private gauss!: () => number;
  private placementsLog: ReplayPlacement[] = [];
  private peakHeight = 0;
  private tower: TowerStats = { height: 0, supportedBlocks: 0, blocksUsed: 0, com: null, comMargin: 0, baseWidth: 0 };

  private constructor(
    readonly challenge: ChallengeDef,
    readonly seed: number,
  ) {}

  static async create(challenge: ChallengeDef, seed: number): Promise<Episode> {
    const ep = new Episode(challenge, seed);
    ep.sim = await Sim.create(challenge.gravity);
    ep.sim.addGround(challenge.groundSize, 0.8);
    ep.gauss = gaussianFactory(mulberry32(seed));
    for (const item of challenge.inventory) ep.remaining.set(item.id, item);
    return ep;
  }

  inventory(): InventoryItem[] {
    return [...this.remaining.values()];
  }

  status(): 'active' | 'done' {
    return this.remaining.size === 0 ? 'done' : 'active';
  }

  observe(): Observation {
    return {
      status: this.status(),
      inventory: this.inventory(),
      blocks: this.sim.states(),
      tower: this.tower,
      placements: this.placementsLog.length,
    };
  }

  score(): Score {
    return { height: this.tower.height, peakHeight: this.peakHeight, blocksUsed: this.defs.size };
  }

  place(req: PlaceRequest): PlaceResult {
    const err = this.validate(req);
    if (err) return { ok: false, error: err };

    const item = this.remaining.get(req.blockId)!;
    const orientation = req.orientation ?? defaultOrientation(item.def.shape);
    const quat = placementQuat(item.def.shape, req.yawDeg ?? 0, req.orientation, req.quat);
    const { sigmaX, sigmaV } = sigmasForFocus(req.focus, this.challenge.noise);
    const position = sampleVec3(this.gauss, req.position, sigmaX);
    const velocity = sampleVec3(this.gauss, req.velocity ?? [0, 0, 0], sigmaV);
    // Keep the block bottom above the ground plane; tower-collision risk stays.
    position[1] = Math.max(position[1], quatHalfHeight(item.def.shape, quat) + 0.001);

    const towerBefore = this.tower;
    this.sim.addBlock(item.id, item.def, position, quat, velocity);
    this.remaining.delete(item.id);
    this.defs.set(item.id, item.def);

    this.sim.step(); // resolve spawn contacts so overlap is measurable
    const spawnPenetration = this.sim.penetrationDepth(item.id);
    const { settled } = this.sim.settle();
    this.tower = computeTower(this.sim, this.defs, this.defs.size);
    this.peakHeight = Math.max(this.peakHeight, this.tower.height);

    const toppled = !settled || this.tower.height < towerBefore.height - 0.01;
    const blockFinal = this.sim.states().find((s) => s.id === item.id)!;
    blockFinal.resting = settled;

    this.placementsLog.push({
      req: { ...req, velocity: req.velocity ?? [0, 0, 0], yawDeg: req.yawDeg ?? 0, orientation },
      actual: { position, velocity, sigma: { x: sigmaX, v: sigmaV } },
    });

    return {
      ok: true,
      actual: { position, velocity, sigma: { x: sigmaX, v: sigmaV } },
      settle: {
        outcome: toppled ? 'toppled' : 'settled',
        blockFinal,
        tower: this.tower,
        spawnOverlap: spawnPenetration > 0.003,
        spawnPenetration,
      },
    };
  }

  replay(): ReplayFile {
    return {
      version: 1,
      challengeId: this.challenge.id,
      seed: this.seed,
      noise: this.challenge.noise,
      inventory: [...this.challenge.inventory],
      placements: [...this.placementsLog],
      score: this.score(),
    };
  }

  /** Returns an error string (retryable, LLM-friendly) or null if valid. */
  private validate(req: PlaceRequest): string | null {
    if (this.status() === 'done') {
      return 'Episode is done: the inventory is empty. No further placements are accepted.';
    }
    if (req === null || typeof req !== 'object') {
      return 'Request must be an object like {"blockId": "b1", "position": [x,y,z], "focus": 0.5}.';
    }
    const { blockId, position, yawDeg, orientation, quat, velocity, focus } = req;

    if (typeof blockId !== 'string') return 'Missing "blockId" (string).';
    if (!this.remaining.has(blockId)) {
      const ids = [...this.remaining.keys()].join(', ');
      return `"${blockId}" is not in the remaining inventory. Remaining block ids: [${ids}].`;
    }
    if (!isVec3(position)) {
      return '"position" must be an array of 3 finite numbers [x, y, z] in meters (y is up).';
    }
    const half = this.challenge.groundSize / 2;
    if (Math.abs(position[0]) > half || Math.abs(position[2]) > half) {
      return `position x and z must be within ±${half} m (the ground plane is ${this.challenge.groundSize}x${this.challenge.groundSize} m). Got [${position[0]}, ${position[2]}].`;
    }
    if (position[1] < 0 || position[1] > MAX_SPAWN_Y) {
      return `position y must be within [0, ${MAX_SPAWN_Y}] m. Got ${position[1]}.`;
    }
    if (yawDeg !== undefined && (typeof yawDeg !== 'number' || !Number.isFinite(yawDeg))) {
      return '"yawDeg" must be a finite number of degrees, or omitted (defaults to 0).';
    }
    if (orientation !== undefined) {
      if (orientation !== 'flat' && orientation !== 'side' && orientation !== 'upright') {
        return `"orientation" must be 'flat', 'side', or 'upright' (or omitted to use the shape default).`;
      }
      const item = this.remaining.get(blockId)!;
      const supported = supportedOrientations(item.def.shape);
      if (!supported.includes(orientation)) {
        return `orientation "${orientation}" is not supported for a ${item.def.shape.kind}. Supported: ${supported.join(', ')}.`;
      }
      if (orientationQuat(item.def.shape, orientation) === null) {
        return `orientation "${orientation}" is not supported for a ${item.def.shape.kind}. Supported: ${supported.join(', ')}.`;
      }
    }
    if (quat !== undefined) {
      if (!Array.isArray(quat) || quat.length !== 4 || !quat.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        return '"quat" must be an array of 4 finite numbers [x, y, z, w]. It takes precedence over yaw/orientation.';
      }
      const n = Math.hypot(quat[0], quat[1], quat[2], quat[3]);
      if (n < 0.5 || n > 2) {
        return `"quat" should be approximately unit length (got norm ${n.toFixed(3)}). It is normalized before use.`;
      }
    }
    if (velocity !== undefined) {
      if (!isVec3(velocity)) return '"velocity" must be an array of 3 finite numbers [vx, vy, vz] in m/s, or omitted.';
      const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
      if (speed > this.challenge.maxSpeed) {
        return `Requested speed ${speed.toFixed(2)} m/s exceeds maxSpeed ${this.challenge.maxSpeed} m/s. Reduce the velocity magnitude.`;
      }
    }
    if (typeof focus !== 'number' || !Number.isFinite(focus) || focus < 0 || focus > 1) {
      return '"focus" must be a number in [0, 1]: 1 = max position precision, 0 = max velocity precision, 0.5 = balanced.';
    }
    return null;
  }
}
