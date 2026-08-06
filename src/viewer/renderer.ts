import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { wedgeVertices } from '../core/blocks';
import type { BlockDef } from '../core/types';

export interface SceneCtx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
}

export function createScene(container: HTMLElement): SceneCtx {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101418);

  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.05, 200);
  camera.position.set(3.2, 2.4, 4.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.6, 0);
  controls.update();

  scene.add(new THREE.HemisphereLight(0xbdd3ff, 0x3a2f22, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(5, 10, 4);
  scene.add(sun);

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  return { scene, camera, renderer, controls };
}

export function groundMesh(size: number): THREE.Group {
  const group = new THREE.Group();
  const plane = new THREE.Mesh(
    new THREE.BoxGeometry(size, 1, size),
    new THREE.MeshStandardMaterial({ color: 0x2c3540, roughness: 0.95 }),
  );
  plane.position.y = -0.5; // top surface at y = 0, matching the collider
  group.add(plane);
  const grid = new THREE.GridHelper(size, size, 0x4a5665, 0x333d49);
  grid.position.y = 0.002;
  group.add(grid);
  return group;
}

const SHAPE_COLORS: Record<BlockDef['shape']['kind'], number> = {
  box: 0xc98f4e,
  cylinder: 0x6fa8dc,
  wedge: 0x93c47d,
};

export function blockMeshFor(def: BlockDef): THREE.Mesh {
  const { shape } = def;
  let geometry: THREE.BufferGeometry;
  switch (shape.kind) {
    case 'box':
      geometry = new THREE.BoxGeometry(shape.size[0], shape.size[1], shape.size[2]);
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(shape.radius, shape.radius, shape.height, 24);
      break;
    case 'wedge':
      geometry = new ConvexGeometry(wedgeVertices(shape.size).map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      break;
  }
  const friction = def.material.friction;
  const material = new THREE.MeshStandardMaterial({
    color: SHAPE_COLORS[shape.kind],
    roughness: THREE.MathUtils.clamp(1 - friction, 0.15, 1),
    metalness: 0.05,
  });
  return new THREE.Mesh(geometry, material);
}
