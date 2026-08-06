import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EpisodeClient } from '../sdk/client';
import { stackCenterY } from '../sdk/utils';
import { updateManifest } from '../harness/manifest';

/**
 * Scripted baseline agent: stacks blocks straight up the origin, alternating
 * yaw each layer, low spawn with gentle downward velocity, balanced-ish focus.
 * Doubles as the end-to-end smoke test: it writes a replay the viewer can load.
 *
 * Usage: npm run agent:naive -- --challenge bricks --seed 1 [--out path]
 */

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const challengeId = arg('challenge', 'bricks');
const seed = Number(arg('seed', '1'));
const out = arg('out', `replays/naive-${challengeId}-${seed}.json`);

const client = await EpisodeClient.create(challengeId, seed);

const inventory = client.getInventory();
console.log(`challenge=${challengeId} seed=${seed} blocks=${inventory.length}`);

let i = 0;
for (const item of inventory) {
  const obs = client.observe();
  const y = stackCenterY(item.def.shape, obs.tower.height, 0.3);
  const res = client.placeBlock({
    blockId: item.id,
    position: [0, y, 0],
    yawDeg: (i % 2) * 90,
    velocity: [0, -0.3, 0],
    focus: 0.75,
  });
  if (!res.ok) {
    console.error(`placement ${i} rejected: ${res.error}`);
    process.exitCode = 1;
    break;
  }
  const s = res.settle!;
  console.log(
    `#${i} ${item.id} ${s.outcome}  tower=${s.tower.height.toFixed(3)}m  ` +
      `sigmaX=${res.actual!.sigma.x.toFixed(3)} sigmaV=${res.actual!.sigma.v.toFixed(3)}`,
  );
  i++;
}

const score = client.score();
console.log(`final: height=${score.height.toFixed(3)}m peak=${score.peakHeight.toFixed(3)}m used=${score.blocksUsed}`);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(client.replay(), null, 2));
updateManifest();
console.log(`replay written to ${out}`);
