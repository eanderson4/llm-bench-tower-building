import { placementQuat } from '../core/blocks';
import { getChallenge } from '../core/challenges';
import { Sim } from '../core/sim';
import type { ReplayFile } from '../core/types';
import { blockMeshFor, createScene, groundMesh } from './renderer';

/**
 * Replay viewer: re-simulates a replay deterministically (same core code the
 * scorer used), records every physics step, then offers free scrubbing.
 *
 * Open: /src/viewer/?replay=/replays/naive-bricks-1.json
 */

type Pose7 = [number, number, number, number, number, number, number];
type Frame = (Pose7 | null)[]; // parallel to the replay inventory; null = culled

const infoEl = document.getElementById('info')!;
const errorEl = document.getElementById('error')!;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const scrubEl = document.getElementById('scrub') as HTMLInputElement;
const speedEl = document.getElementById('speed') as HTMLSelectElement;

function fail(msg: string): void {
  errorEl.style.display = 'block';
  errorEl.textContent = msg;
  infoEl.textContent = 'failed to load replay';
}

/** Human label for the uncertainty constant K = sigmaX0 * sigmaV0. */
function precisionLabel(K: number): string {
  if (K >= 0.02) return 'low precision';
  if (K >= 0.01) return 'standard precision';
  return 'high precision';
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const replayPath = params.get('replay') ?? '/replays/naive-bricks-1.json';

  const res = await fetch(replayPath);
  if (!res.ok) throw new Error(`GET ${replayPath} -> ${res.status}. Run: npm run agent:naive`);
  const replay = (await res.json()) as ReplayFile;

  const challenge = getChallenge(replay.challengeId);
  const defs = new Map(replay.inventory.map((item) => [item.id, item.def]));
  const ids = replay.inventory.map((item) => item.id);

  // --- Deterministic re-simulation, recording one frame per physics step ---
  const sim = await Sim.create(challenge.gravity);
  sim.addGround(challenge.groundSize, 0.8);

  const frames: Frame[] = [];
  const placementStarts: number[] = [];
  const snapshot = (): Frame =>
    ids.map((id) => {
      const p = sim.pose(id);
      return p ? [...p.position, ...p.quat] : null;
    });
  sim.onStep = () => frames.push(snapshot());

  for (const p of replay.placements) {
    const def = defs.get(p.req.blockId);
    if (!def) throw new Error(`replay references unknown block ${p.req.blockId}`);
    placementStarts.push(frames.length);
    const quat = placementQuat(def.shape, p.req.yawDeg ?? 0, p.req.orientation, p.req.quat);
    sim.addBlock(p.req.blockId, def, p.actual.position, quat, p.actual.velocity);
    frames.push(snapshot());
    sim.settle();
  }
  sim.onStep = undefined;
  if (frames.length === 0) throw new Error('replay has no placements');

  // --- Scene ---
  const app = document.getElementById('app')!;
  const { scene, renderer, camera, controls } = createScene(app);
  scene.add(groundMesh(challenge.groundSize));
  const meshes = new Map(ids.map((id) => {
    const mesh = blockMeshFor(defs.get(id)!);
    scene.add(mesh);
    return [id, mesh] as const;
  }));

  // --- Header ---
  const noise = replay.noise;
  const noiseLine = noise
    ? `noise: sigmaX0=${noise.sigmaX0}m  sigmaV0=${noise.sigmaV0}m/s  K=${(noise.sigmaX0 * noise.sigmaV0).toPrecision(3)} (${precisionLabel(noise.sigmaX0 * noise.sigmaV0)})\n`
    : '';
  const header =
    `${challenge.name} (${replay.challengeId})  seed=${replay.seed}\n` +
    noiseLine +
    `final score: height=${replay.score.height.toFixed(3)}m  peak=${replay.score.peakHeight.toFixed(3)}m\n`;

  // --- Playback ---
  let frameIndex = 0;
  let playing = true;
  let speed = 1;
  let carry = 0;
  scrubEl.max = String(frames.length - 1);

  const applyFrame = (i: number): void => {
    const frame = frames[i];
    for (let k = 0; k < ids.length; k++) {
      const mesh = meshes.get(ids[k])!;
      const pose = frame[k];
      mesh.visible = pose !== null;
      if (pose) {
        mesh.position.set(pose[0], pose[1], pose[2]);
        mesh.quaternion.set(pose[3], pose[4], pose[5], pose[6]);
      }
    }
    const placement = placementStarts.filter((s) => s <= i).length; // 0 = before first spawn
    const p = placement > 0 ? replay.placements[placement - 1] : null;
    infoEl.textContent =
      header +
      `frame ${i}/${frames.length - 1}   placement ${placement}/${replay.placements.length}` +
      (p
        ? `\nlast placed: ${p.req.blockId}  focus=${p.req.focus}` +
          `${p.req.orientation ? `  orientation=${p.req.orientation}` : ''}${p.req.quat ? '  quat' : ''}\n` +
          `  sigmaX=${p.actual.sigma.x.toFixed(3)}  sigmaV=${p.actual.sigma.v.toFixed(3)}\n` +
          `  wanted y=${p.req.position[1].toFixed(2)}  got [${p.actual.position.map((v) => v.toFixed(2)).join(', ')}]`
        : '');
  };

  playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? 'pause' : 'play';
  });
  speedEl.addEventListener('change', () => {
    speed = Number(speedEl.value);
  });
  scrubEl.addEventListener('input', () => {
    frameIndex = Number(scrubEl.value);
    applyFrame(frameIndex);
  });

  applyFrame(0);
  renderer.setAnimationLoop(() => {
    if (playing && frames.length > 1) {
      carry += speed;
      const advance = Math.floor(carry);
      carry -= advance;
      frameIndex = Math.min(frameIndex + advance, frames.length - 1);
      if (frameIndex >= frames.length - 1) {
        playing = false;
        playBtn.textContent = 'play';
      }
      scrubEl.value = String(frameIndex);
      applyFrame(frameIndex);
    }
    controls.update();
    renderer.render(scene, camera);
  });
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
