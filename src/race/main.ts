import * as THREE from 'three';
import type { ReplayFile } from '../core/types';
import { simulateReplay, type ReplayFrames } from '../viewer/frames';
import { blockMeshFor, groundMesh } from '../viewer/renderer';

/**
 * Tower race: several replays re-simulated and played back side by side,
 * frame-locked, each pane with a live scorer-accurate height counter and a
 * camera that rises with the tower. Built for screen-recording shorts.
 *
 * Open: /src/race/?replays=/replays/a.json,/replays/b.json&labels=fable-5,k3
 * (labels are optional; they default to the replay filename's model prefix.)
 */

const DEFAULT_REPLAYS = [
  '/replays/claude-fable-5-pillars-a2-202607171843.json',
  '/replays/k3-pillars-a1-202607190619.json',
  '/replays/gpt-5.6-sol-pillars-a2-202607171843.json',
];

const errorEl = document.getElementById('error')!;
const raceEl = document.getElementById('race')!;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const restartBtn = document.getElementById('restart') as HTMLButtonElement;
const speedEl = document.getElementById('speed') as HTMLSelectElement;

function fail(msg: string): void {
  errorEl.style.display = 'block';
  errorEl.textContent = msg;
}

function labelFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/-(?:[a-z0-9]+)?-a\d+-\d+\.json$/i, '').replace(/\.json$/, '');
}

interface Pane {
  data: ReplayFrames;
  label: string;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  meshes: Map<string, THREE.Mesh>;
  heightEl: HTMLElement;
  statusEl: HTMLElement;
  rootEl: HTMLElement;
  camY: number; // smoothed camera focus height
}

async function buildPane(path: string, label: string): Promise<Pane> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  const replay = (await res.json()) as ReplayFile;
  const data = await simulateReplay(replay);

  const rootEl = document.createElement('div');
  rootEl.className = 'pane';
  rootEl.innerHTML =
    `<div class="head"><div class="label"></div><div class="height">0.00 m</div><div class="status"></div></div>`;
  raceEl.appendChild(rootEl);
  rootEl.querySelector<HTMLElement>('.label')!.textContent = label;
  const heightEl = rootEl.querySelector<HTMLElement>('.height')!;
  const statusEl = rootEl.querySelector<HTMLElement>('.status')!;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101418);
  scene.add(new THREE.HemisphereLight(0xbdd3ff, 0x3a2f22, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(5, 10, 4);
  scene.add(sun);
  scene.add(groundMesh(data.challenge.groundSize));

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  rootEl.appendChild(renderer.domElement);

  const meshes = new Map(
    data.ids.map((id) => {
      const mesh = blockMeshFor(data.defs.get(id)!);
      mesh.visible = false;
      scene.add(mesh);
      return [id, mesh] as const;
    }),
  );

  return { data, label, renderer, scene, camera, meshes, heightEl, statusEl, rootEl, camY: 0.6 };
}

function resizePane(pane: Pane): void {
  const w = pane.rootEl.clientWidth;
  const h = pane.rootEl.clientHeight;
  pane.camera.aspect = w / h;
  pane.camera.updateProjectionMatrix();
  pane.renderer.setSize(w, h);
}

function applyFrame(pane: Pane, i: number): void {
  const { frames, ids, placementStarts, heights, replay } = pane.data;
  const clamped = Math.min(i, frames.length - 1);
  const frame = frames[clamped];
  for (let k = 0; k < ids.length; k++) {
    const mesh = pane.meshes.get(ids[k])!;
    const pose = frame[k];
    mesh.visible = pose !== null;
    if (pose) {
      mesh.position.set(pose[0], pose[1], pose[2]);
      mesh.quaternion.set(pose[3], pose[4], pose[5], pose[6]);
    }
  }
  const placement = placementStarts.filter((s) => s <= clamped).length;
  // Height counter shows the last *settled* scorer height — during a block's
  // spawn-and-settle window it holds the previous placement's value.
  const shown = placement >= 2 ? heights[placement - 2] : 0;
  const done = clamped >= frames.length - 1;
  const height = done ? replay.score.height : shown;
  pane.heightEl.textContent = `${height.toFixed(2)} m`;
  pane.statusEl.textContent = done
    ? `FINAL ${replay.score.height.toFixed(2)} m · ${replay.score.blocksUsed} blocks`
    : `block ${placement}/${replay.placements.length}`;
  pane.rootEl.classList.toggle('done', done);

  // Camera rises with the settled height and pulls back as the tower grows.
  const focus = Math.max(0.6, height * 0.55);
  pane.camY += (focus - pane.camY) * 0.04;
  const dist = 4.2 + height * 0.55;
  pane.camera.position.set(dist * 0.6, pane.camY + dist * 0.35, dist * 0.85);
  pane.camera.lookAt(0, pane.camY, 0);
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const paths = (params.get('replays')?.split(',') ?? DEFAULT_REPLAYS).map((s) => s.trim()).filter(Boolean);
  const labels = params.get('labels')?.split(',').map((s) => s.trim());
  if (paths.length < 1) throw new Error('need replays: ?replays=/replays/a.json,/replays/b.json');

  const panes = await Promise.all(paths.map((p, i) => buildPane(p, labels?.[i] ?? labelFromPath(p))));
  const maxFrames = Math.max(...panes.map((p) => p.data.frames.length));
  const best = Math.max(...panes.map((p) => p.data.replay.score.height));

  // Capture mode (?capture=1): no animation loop — an external driver (see
  // scripts/capture.ts) steps frames via window.__race and screenshots each.
  if (params.has('capture')) {
    document.getElementById('controls')!.style.display = 'none';
    const onResizeCapture = (): void => panes.forEach(resizePane);
    window.addEventListener('resize', onResizeCapture);
    onResizeCapture();
    (window as unknown as Record<string, unknown>).__race = {
      maxFrames,
      goto: (i: number): void => {
        for (const pane of panes) {
          if (i >= maxFrames - 1) pane.rootEl.classList.toggle('winner', pane.data.replay.score.height === best);
          applyFrame(pane, i);
          pane.renderer.render(pane.scene, pane.camera);
        }
      },
    };
    return;
  }

  let frameIndex = 0;
  let playing = true;
  let speed = Number(speedEl.value);
  let carry = 0;

  playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? 'pause' : 'play';
  });
  restartBtn.addEventListener('click', () => {
    frameIndex = 0;
    carry = 0;
    playing = true;
    playBtn.textContent = 'pause';
    for (const pane of panes) {
      pane.camY = 0.6;
      pane.rootEl.classList.remove('winner');
    }
  });
  speedEl.addEventListener('change', () => {
    speed = Number(speedEl.value);
  });

  const onResize = (): void => panes.forEach(resizePane);
  window.addEventListener('resize', onResize);
  onResize();

  const tick = (): void => {
    if (playing) {
      carry += speed;
      const advance = Math.floor(carry);
      carry -= advance;
      frameIndex = Math.min(frameIndex + advance, maxFrames - 1);
      if (frameIndex >= maxFrames - 1) {
        playing = false;
        playBtn.textContent = 'play';
        for (const pane of panes) {
          pane.rootEl.classList.toggle('winner', pane.data.replay.score.height === best);
        }
      }
    }
    for (const pane of panes) {
      applyFrame(pane, frameIndex);
      pane.renderer.render(pane.scene, pane.camera);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
