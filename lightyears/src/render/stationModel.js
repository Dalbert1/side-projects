// Space station: faceted hull, a turning habitat ring, and a lit docking slot on +Z.
import * as THREE from 'three';
import { MeshBuilder } from './meshBuilder.js';
import { makeObjectMaterial } from './shaders.js';
import { Rng } from '../core/rng.js';

export function makeStation(atmoU, seed) {
  const rng = new Rng(seed);
  const hullA = [0.62, 0.64, 0.68];
  const hullB = [0.42, 0.44, 0.5];
  const accent = rng.pick([[0.95, 0.72, 0.2], [0.9, 0.35, 0.2], [0.3, 0.7, 0.9], [0.6, 0.9, 0.4]]);
  const mb = new MeshBuilder();

  // faceted core with alternating panel colors
  const core = new THREE.IcosahedronGeometry(110, 1);
  const nFaces = core.attributes.position.count / 3;
  const cols = [];
  for (let i = 0; i < nFaces; i++) cols.push(rng.chance(0.2) ? accent : i % 3 ? hullA : hullB);
  mb.add(core, cols, { s: [1, 0.82, 1] });

  // docking slot: dark recess framed by lights
  mb.add(new THREE.BoxGeometry(64, 26, 30), [0.04, 0.05, 0.07], { p: [0, 0, 98] });
  for (const y of [-15, 15]) mb.add(new THREE.BoxGeometry(70, 2.2, 3), [0.4, 0.95, 1.0], { p: [0, y, 113] }, { emissive: true });
  for (const x of [-35, 35]) mb.add(new THREE.BoxGeometry(2.2, 30, 3), [0.4, 0.95, 1.0], { p: [x, 0, 113] }, { emissive: true });
  // inside glow
  mb.add(new THREE.PlaneGeometry(60, 22), [1.0, 0.8, 0.45], { p: [0, 0, 84] }, { emissive: true });

  // top and bottom towers
  for (const sy of [-1, 1]) {
    mb.add(new THREE.CylinderGeometry(14, 24, 60, 8), hullB, { p: [0, sy * 110, 0] });
    mb.add(new THREE.CylinderGeometry(3, 3, 60, 6), hullA, { p: [0, sy * 165, 0] });
    mb.add(new THREE.SphereGeometry(4, 8, 6), [1, 0.3, 0.2], { p: [0, sy * 197, 0] }, { emissive: true });
  }
  // side pods
  for (const sx of [-1, 1]) {
    mb.add(new THREE.BoxGeometry(40, 30, 70), hullB, { p: [sx * 115, 0, -10] });
    mb.add(new THREE.BoxGeometry(42, 4, 72), accent, { p: [sx * 115, 12, -10] });
    for (let k = 0; k < 4; k++) mb.add(new THREE.BoxGeometry(2, 2, 2), [1, 0.9, 0.6], { p: [sx * 136, -4 + (k % 2) * 8, -30 + k * 14] }, { emissive: true });
  }
  const mat = makeObjectMaterial(atmoU, { spec: 0.5 });
  const hull = new THREE.Mesh(mb.build(), mat);

  // turning ring with spokes
  const rb = new MeshBuilder();
  rb.add(new THREE.TorusGeometry(185, 12, 8, 56), hullA, { r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    rb.add(new THREE.BoxGeometry(80, 5, 5), hullB, { p: [Math.cos(a) * 140, 0, Math.sin(a) * 140], r: [0, -a, 0] });
    rb.add(new THREE.BoxGeometry(8, 3, 8), [1, 0.85, 0.5], { p: [Math.cos(a) * 185, 13, Math.sin(a) * 185] }, { emissive: true });
  }
  const ring = new THREE.Mesh(rb.build(), mat);
  ring.rotation.x = 0.12;

  const group = new THREE.Group();
  group.add(hull, ring);
  return { group, ring, material: mat };
}
