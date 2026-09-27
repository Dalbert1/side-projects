// First person multitool, drawn in its own pass so it never clips into the world.
import * as THREE from 'three';
import { MeshBuilder } from './meshBuilder.js';
import { makeObjectMaterial } from './shaders.js';

const DARK = [0.16, 0.17, 0.2];
const MID = [0.42, 0.44, 0.48];
const GOLD = [0.95, 0.7, 0.22];
const GLOW = [0.45, 0.85, 1.0];

export function makeTool(atmoU) {
  const mb = new MeshBuilder();
  const X = Math.PI / 2;
  // body and barrel point down -Z (camera forward)
  mb.add(new THREE.BoxGeometry(0.075, 0.09, 0.3), DARK, { p: [0, 0, -0.05] });
  mb.add(new THREE.BoxGeometry(0.08, 0.02, 0.26), GOLD, { p: [0, 0.052, -0.06] });
  mb.add(new THREE.CylinderGeometry(0.022, 0.03, 0.2, 8), MID, { r: [X, 0, 0], p: [0, 0.01, -0.28] });
  mb.add(new THREE.CylinderGeometry(0.034, 0.034, 0.03, 8), GOLD, { r: [X, 0, 0], p: [0, 0.01, -0.2] });
  mb.add(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 8), GLOW, { r: [X, 0, 0], p: [0, 0.01, -0.385] }, { emissive: true });
  // glowing canister on top
  mb.add(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8), GLOW, { r: [X, 0, 0], p: [0, 0.075, 0.02] }, { emissive: true });
  mb.add(new THREE.BoxGeometry(0.05, 0.02, 0.15), DARK, { p: [0, 0.098, 0.02] });
  // grip and fins
  mb.add(new THREE.BoxGeometry(0.05, 0.14, 0.06), DARK, { p: [0, -0.1, 0.05], r: [-0.35, 0, 0] });
  for (const s of [-1, 1]) mb.add(new THREE.BoxGeometry(0.012, 0.06, 0.12), GOLD, { p: [s * 0.043, 0.02, 0.02], r: [0, 0, s * 0.15] });
  const mat = makeObjectMaterial(atmoU, { spec: 0.8 });
  const geo = mb.build();
  geo.scale(0.72, 0.72, 0.72);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { scene, mesh, material: mat, muzzle: new THREE.Vector3(0, 0.0072, -0.28) };
}
