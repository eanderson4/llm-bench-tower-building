import { placementQuat } from '../core/blocks';
import { getChallenge } from '../core/challenges';
import { computeTower } from '../core/scoring';
import { Sim } from '../core/sim';
import type { BlockDef, ChallengeDef, ReplayFile } from '../core/types';

export type Pose7 = [number, number, number, number, number, number, number];
export type Frame = (Pose7 | null)[]; // parallel to the replay inventory; null = culled

export interface ReplayFrames {
  replay: ReplayFile;
  challenge: ChallengeDef;
  ids: string[];
  defs: Map<string, BlockDef>;
  frames: Frame[];
  placementStarts: number[]; // frame index where placement i spawns
  heights: number[]; // scorer height after placement i settles
}

/**
 * Deterministic re-simulation of a replay, recording one frame per physics
 * step. Mirrors Episode.place exactly (step() to resolve spawn contacts, then
 * settle()) so the recorded heights match what the scorer reported.
 */
export async function simulateReplay(replay: ReplayFile): Promise<ReplayFrames> {
  const challenge = getChallenge(replay.challengeId);
  const defs = new Map(replay.inventory.map((item) => [item.id, item.def]));
  const ids = replay.inventory.map((item) => item.id);

  const sim = await Sim.create(challenge.gravity);
  sim.addGround(challenge.groundSize, 0.8);

  const frames: Frame[] = [];
  const placementStarts: number[] = [];
  const heights: number[] = [];
  const placed = new Map<string, BlockDef>();
  const snapshot = (): Frame =>
    ids.map((id) => {
      const p = sim.pose(id);
      return p ? ([...p.position, ...p.quat] as Pose7) : null;
    });
  sim.onStep = () => frames.push(snapshot());

  for (const p of replay.placements) {
    const def = defs.get(p.req.blockId);
    if (!def) throw new Error(`replay references unknown block ${p.req.blockId}`);
    placementStarts.push(frames.length);
    const quat = placementQuat(def.shape, p.req.yawDeg ?? 0, p.req.orientation, p.req.quat);
    sim.addBlock(p.req.blockId, def, p.actual.position, quat, p.actual.velocity);
    placed.set(p.req.blockId, def);
    sim.step();
    sim.settle();
    heights.push(computeTower(sim, placed, placed.size).height);
  }
  sim.onStep = undefined;
  if (frames.length === 0) throw new Error('replay has no placements');

  return { replay, challenge, ids, defs, frames, placementStarts, heights };
}
