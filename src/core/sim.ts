import RAPIER from '@dimforge/rapier3d-compat';
import { colliderDescFor } from './blocks';
import type { BlockDef, BlockState, Quat, Vec3 } from './types';

export const DT = 1 / 60;
const LIN_EPS = 0.05; // m/s — below this a body counts as at rest
const ANG_EPS = 0.1; // rad/s
const SETTLE_STREAK = 8; // consecutive slow steps required to call the world settled
const KILL_Y = -5; // bodies below this fell off the ground and are removed

export interface SettleResult {
  settled: boolean; // false if the step cap was hit first
  steps: number;
}

let rapierReady: Promise<unknown> | null = null;
function initRapier(): Promise<unknown> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

/**
 * Headless physics world: a ground plane plus dynamic block bodies.
 * Deterministic for a fixed sequence of operations (fixed dt, seeded upstream).
 */
export class Sim {
  readonly world: RAPIER.World;
  private bodies = new Map<string, RAPIER.RigidBody>();
  private colliderToId = new Map<number, string>();
  private lostStates = new Map<string, BlockState>();
  private groundCollider!: RAPIER.Collider;
  /** Hook called after every physics step (used by the viewer to record frames). */
  onStep?: () => void;

  private constructor(world: RAPIER.World) {
    this.world = world;
  }

  static async create(gravity: number): Promise<Sim> {
    await initRapier();
    const world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    world.timestep = DT;
    return new Sim(world);
  }

  addGround(size: number, friction: number): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.cuboid(size / 2, 0.5, size / 2)
      .setTranslation(0, -0.5, 0) // top surface at y = 0
      .setFriction(friction);
    this.groundCollider = this.world.createCollider(desc, body);
  }

  addBlock(id: string, def: BlockDef, position: Vec3, quat: Quat, velocity: Vec3): void {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position[0], position[1], position[2])
      .setRotation({ x: quat[0], y: quat[1], z: quat[2], w: quat[3] })
      .setLinvel(velocity[0], velocity[1], velocity[2])
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = colliderDescFor(def)
      .setDensity(def.material.density)
      .setFriction(def.material.friction)
      .setRestitution(def.material.restitution);
    const collider = this.world.createCollider(colliderDesc, body);
    this.bodies.set(id, body);
    this.colliderToId.set(collider.handle, id);
  }

  step(): void {
    this.world.step();
    this.cullFallen();
    this.onStep?.();
  }

  /** Step until every dynamic body is slow for SETTLE_STREAK steps, or the cap. */
  settle(maxSeconds = 3): SettleResult {
    const maxSteps = Math.round(maxSeconds / DT);
    let streak = 0;
    for (let i = 1; i <= maxSteps; i++) {
      this.step();
      streak = this.allSlow() ? streak + 1 : 0;
      if (streak >= SETTLE_STREAK) return { settled: true, steps: i };
    }
    return { settled: false, steps: maxSteps };
  }

  private allSlow(): boolean {
    for (const body of this.bodies.values()) {
      const lv = body.linvel();
      const av = body.angvel();
      if (Math.hypot(lv.x, lv.y, lv.z) > LIN_EPS) return false;
      if (Math.hypot(av.x, av.y, av.z) > ANG_EPS) return false;
    }
    return true;
  }

  private cullFallen(): void {
    for (const [id, body] of this.bodies) {
      if (body.translation().y < KILL_Y) {
        this.lostStates.set(id, this.readState(id, false));
        this.world.removeRigidBody(body);
        this.bodies.delete(id);
      }
    }
  }

  private readState(id: string, resting: boolean): BlockState {
    const body = this.bodies.get(id);
    if (!body) throw new Error(`no body for block ${id}`);
    const t = body.translation();
    const r = body.rotation();
    return {
      id,
      position: [t.x, t.y, t.z],
      quat: [r.x, r.y, r.z, r.w],
      resting,
      onGround: this.isTouchingGround(id),
    };
  }

  /** Current states of all placed blocks, including culled ones (last known pose). */
  states(): BlockState[] {
    const out: BlockState[] = [];
    for (const id of this.bodies.keys()) out.push(this.readState(id, false));
    for (const s of this.lostStates.values()) out.push(s);
    return out;
  }

  /** Pose of a live block, or null if it has been culled. Used by the viewer. */
  pose(id: string): { position: Vec3; quat: Quat } | null {
    const body = this.bodies.get(id);
    if (!body) return null;
    const t = body.translation();
    const r = body.rotation();
    return { position: [t.x, t.y, t.z], quat: [r.x, r.y, r.z, r.w] };
  }

  /** Deepest interpenetration (m) between the block and anything it touches; 0 if none. */
  penetrationDepth(id: string): number {
    const body = this.bodies.get(id);
    if (!body) return 0;
    let deepest = 0;
    const collider = body.collider(0);
    this.world.contactPairsWith(collider, (other) => {
      this.world.contactPair(collider, other, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i++) {
          const d = manifold.contactDist(i);
          if (-d > deepest) deepest = -d;
        }
      });
    });
    return deepest;
  }

  /** Pairs of block ids with at least one active solver contact. */
  touchingPairs(): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    const seen = new Set<string>();
    for (const [id, body] of this.bodies) {
      const collider = body.collider(0);
      this.world.contactPairsWith(collider, (other) => {
        const otherId = this.colliderToId.get(other.handle);
        if (otherId === undefined || otherId === id) return;
        const key = id < otherId ? `${id}|${otherId}` : `${otherId}|${id}`;
        if (seen.has(key)) return;
        if (this.hasSolverContact(collider, other)) {
          seen.add(key);
          pairs.push(id < otherId ? [id, otherId] : [otherId, id]);
        }
      });
    }
    return pairs;
  }

  isTouchingGround(id: string): boolean {
    const body = this.bodies.get(id);
    if (!body || !this.groundCollider) return false;
    let touching = false;
    const collider = body.collider(0);
    this.world.contactPairsWith(collider, (other) => {
      if (other.handle === this.groundCollider.handle && this.hasSolverContact(collider, other)) {
        touching = true;
      }
    });
    return touching;
  }

  private hasSolverContact(a: RAPIER.Collider, b: RAPIER.Collider): boolean {
    let touching = false;
    this.world.contactPair(a, b, (manifold) => {
      const n = manifold.numSolverContacts();
      if (n > 0) touching = true;
    });
    return touching;
  }
}
