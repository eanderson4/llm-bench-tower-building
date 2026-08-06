// Re-simulates a replay with the exact Episode procedure (ground friction 0.8,
// step() then settle() per placement) and prints final block poses as JSONL.
// Usage: npx tsx scripts/final-pose.ts replays/<file>.json
import { readFileSync } from 'fs';
import { Sim } from '../src/core/sim';
import { placementQuat } from '../src/core/blocks';
import { getChallenge } from '../src/core/challenges';

const file = process.argv[2];
const replay = JSON.parse(readFileSync(file, 'utf8'));
const challenge = getChallenge(replay.challengeId);
const sim = await Sim.create(challenge.gravity);
sim.addGround(challenge.groundSize, 0.8);
const defs = new Map(replay.inventory.map((it: any) => [it.id, it.def]));
for (const p of replay.placements) {
  const def = defs.get(p.req.blockId)!;
  const quat = placementQuat(def.shape, p.req.yawDeg ?? 0, p.req.orientation, p.req.quat);
  sim.addBlock(p.req.blockId, def, p.actual.position, quat, p.actual.velocity);
  sim.step();
  sim.settle();
}
for (const s of sim.states()) {
  const def: any = defs.get(s.id);
  console.log(JSON.stringify({ id: s.id, size: def.shape.size ?? [def.shape.radius, def.shape.height], pos: s.position.map((v: number) => +v.toFixed(3)), quat: s.quat.map((v: number) => +v.toFixed(3)) }));
}
