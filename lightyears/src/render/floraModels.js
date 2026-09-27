// Low poly plants, rocks, and resource deposits, colored from each planet's palette.
// Every model has its base at y = 0 and grows along +Y.

import * as THREE from 'three';
import { MeshBuilder } from './meshBuilder.js';
import { Rng } from '../core/rng.js';
import { mixColor, scaleColor } from '../world/color.js';

const X = Math.PI / 2;

function blob(mb, r, color, p, s = [1, 1, 1], detail = 0) {
  mb.add(new THREE.IcosahedronGeometry(r, detail), color, { p, s }, { jitter: r * 0.25 });
}

export const KIND_INFO = {
  // trees
  round: { cat: 'tree', res: 'carbon', yield: [18, 34], hp: 2.2, collide: 0.5, height: 9 },
  cone: { cat: 'tree', res: 'carbon', yield: [18, 34], hp: 2.2, collide: 0.5, height: 11 },
  palm: { cat: 'tree', res: 'carbon', yield: [16, 30], hp: 2.0, collide: 0.4, height: 8 },
  mushroom: { cat: 'tree', res: 'carbon', yield: [20, 36], hp: 2.2, collide: 0.8, height: 7 },
  tall: { cat: 'tree', res: 'carbon', yield: [18, 32], hp: 2.2, collide: 0.4, height: 14 },
  cactus: { cat: 'tree', res: 'carbon', yield: [12, 24], hp: 1.6, collide: 0.5, height: 4.5 },
  tube: { cat: 'tree', res: 'carbon', yield: [14, 26], hp: 1.6, collide: 0.6, height: 4 },
  bulbtree: { cat: 'tree', res: 'carbon', yield: [16, 30], hp: 2.0, collide: 0.5, height: 7 },
  crystaltree: { cat: 'tree', res: 'carbon', yield: [16, 28], hp: 2.4, collide: 0.6, height: 6 },
  spiral: { cat: 'tree', res: 'carbon', yield: [18, 30], hp: 2.2, collide: 0.5, height: 9 },
  spike: { cat: 'tree', res: 'carbon', yield: [10, 20], hp: 1.8, collide: 0.5, height: 4.5 },
  // bushes
  bush: { cat: 'bush', res: 'carbon', yield: [6, 12], hp: 0.7, height: 1.4 },
  fern: { cat: 'bush', res: 'carbon', yield: [5, 10], hp: 0.6, height: 1.2 },
  bulb: { cat: 'bush', res: 'carbon', yield: [6, 11], hp: 0.6, height: 1.3 },
  deadbush: { cat: 'bush', res: 'carbon', yield: [3, 7], hp: 0.5, height: 1.1 },
  frost: { cat: 'bush', res: 'carbon', yield: [4, 9], hp: 0.7, height: 1.0 },
  shroom: { cat: 'bush', res: 'carbon', yield: [6, 11], hp: 0.6, height: 0.9 },
  grass: { cat: 'grass', height: 0.7 },
  // minerals
  rock: { cat: 'rock', res: 'ferrite', yield: [6, 12], hp: 0.8, height: 0.9 },
  boulder: { cat: 'rock', res: 'ferrite', yield: [30, 60], hp: 3.2, collide: 1.6, height: 3.2 },
  crystal: { cat: 'mineral', res: 'dihydrogen', yield: [16, 26], hp: 1.4, collide: 0.7, height: 2.2 },
  gold: { cat: 'mineral', res: 'gold', yield: [7, 14], hp: 3.0, collide: 1.2, height: 2 },
  oxyplant: { cat: 'plant', res: 'oxygen', yield: [10, 18], hp: 0.8, height: 1.3 },
  sodiumplant: { cat: 'plant', res: 'sodium', yield: [10, 18], hp: 0.8, height: 1.2 },
};

export function buildFloraGeometry(kind, pal, seed) {
  const rng = new Rng(seed);
  const mb = new MeshBuilder();
  const f0 = pal.foliage[0], f1 = pal.foliage[1], f2 = pal.foliage[2];
  const trunk = pal.trunk;
  const shade = (c, k) => scaleColor(c, k);
  switch (kind) {
    case 'round': {
      mb.add(new THREE.CylinderGeometry(0.22, 0.38, 4.2, 6), trunk, { p: [0, 2.1, 0] });
      blob(mb, 2.3, f0, [0, 5.4, 0], [1, 0.85, 1], 1);
      blob(mb, 1.6, shade(f0, 1.12), [1.3, 4.6, 0.4]);
      blob(mb, 1.5, shade(f1, 1.0), [-1.1, 4.8, -0.6]);
      blob(mb, 1.3, shade(f0, 0.9), [0.2, 6.9, 0.3]);
      break;
    }
    case 'cone': {
      mb.add(new THREE.CylinderGeometry(0.2, 0.32, 2.4, 6), trunk, { p: [0, 1.2, 0] });
      const layers = 4;
      for (let i = 0; i < layers; i++) {
        const r = 2.4 - i * 0.48;
        const c = i % 2 ? f0 : shade(f0, 0.85);
        mb.add(new THREE.ConeGeometry(r, 3.0, 7), c, { p: [0, 2.6 + i * 1.9, 0], r: [0, i * 0.5, 0] });
      }
      break;
    }
    case 'palm': {
      let x = 0, y = 0;
      const lean = rng.range(0.1, 0.22);
      for (let i = 0; i < 5; i++) {
        mb.add(new THREE.CylinderGeometry(0.2, 0.26, 1.6, 6), i % 2 ? trunk : shade(trunk, 1.25), { p: [x, y + 0.8, 0], r: [0, 0, -lean * i * 0.6] });
        x += Math.sin(lean * i * 0.6) * 1.55;
        y += Math.cos(lean * i * 0.6) * 1.55;
      }
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        mb.add(new THREE.ConeGeometry(0.5, 3.6, 4), k % 2 ? f0 : f1, { p: [x + Math.cos(a) * 1.5, y - 0.2, Math.sin(a) * 1.5], r: [Math.sin(a) * 1.7, 0, -Math.cos(a) * 1.7], s: [1, 1, 0.25] });
      }
      blob(mb, 0.45, f2, [x, y - 0.3, 0]);
      break;
    }
    case 'mushroom': {
      mb.add(new THREE.CylinderGeometry(0.45, 0.7, 4.2, 7), mixColor(trunk, [0.9, 0.88, 0.8], 0.6), { p: [0, 2.1, 0] });
      mb.add(new THREE.SphereGeometry(2.8, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), f1, { p: [0, 3.9, 0], s: [1, 0.7, 1] });
      mb.add(new THREE.CylinderGeometry(2.75, 2.2, 0.3, 10), shade(f1, 0.6), { p: [0, 3.85, 0] });
      for (let k = 0; k < 6; k++) {
        const a = rng.range(0, Math.PI * 2), rr = rng.range(0.6, 2.1);
        mb.add(new THREE.SphereGeometry(0.28, 5, 4), f2, { p: [Math.cos(a) * rr, 3.9 + Math.sqrt(Math.max(0, 7.8 - rr * rr)) * 0.62, Math.sin(a) * rr] }, { emissive: true });
      }
      break;
    }
    case 'tall': {
      mb.add(new THREE.CylinderGeometry(0.16, 0.34, 11, 6), trunk, { p: [0, 5.5, 0] });
      blob(mb, 1.5, f0, [0, 11.5, 0], [1.3, 0.7, 1.3]);
      blob(mb, 1.0, f1, [0.9, 10.4, 0.3], [1.2, 0.6, 1.2]);
      blob(mb, 0.9, f1, [-0.8, 9.2, -0.2], [1.2, 0.6, 1.2]);
      break;
    }
    case 'cactus': {
      const c = mixColor(f0, [0.3, 0.55, 0.25], 0.5);
      mb.add(new THREE.CylinderGeometry(0.45, 0.55, 4.2, 8), c, { p: [0, 2.1, 0] });
      mb.add(new THREE.SphereGeometry(0.45, 8, 5), c, { p: [0, 4.2, 0] });
      for (const sx of [-1, 1]) {
        const h = rng.range(1.6, 2.6);
        mb.add(new THREE.CylinderGeometry(0.28, 0.28, 1.0, 7), c, { p: [sx * 0.8, h, 0], r: [0, 0, X] });
        mb.add(new THREE.CylinderGeometry(0.28, 0.3, 1.5, 7), c, { p: [sx * 1.25, h + 0.7, 0] });
      }
      mb.add(new THREE.SphereGeometry(0.22, 6, 4), f2, { p: [0, 4.6, 0] }, { emissive: true });
      break;
    }
    case 'tube': {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + rng.range(0, 0.6);
        const h = rng.range(2, 4.2);
        const rr = k === 0 ? 0 : 0.8;
        mb.add(new THREE.CylinderGeometry(0.35, 0.3, h, 7, 1, true), k % 2 ? f0 : f1, { p: [Math.cos(a) * rr, h / 2, Math.sin(a) * rr], r: [Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15] });
        mb.add(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 7), f2, { p: [Math.cos(a) * rr * 1.1, h, Math.sin(a) * rr * 1.1] }, { emissive: true });
      }
      break;
    }
    case 'bulbtree': {
      mb.add(new THREE.CylinderGeometry(0.2, 0.4, 5, 6), trunk, { p: [0, 2.5, 0], r: [0.1, 0, 0.05] });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const h = rng.range(3.5, 6);
        mb.add(new THREE.CylinderGeometry(0.06, 0.08, 1.8, 4), trunk, { p: [Math.cos(a) * 0.7, h, Math.sin(a) * 0.7], r: [Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8] });
        mb.add(new THREE.SphereGeometry(rng.range(0.4, 0.65), 7, 5), k % 2 ? f2 : f1, { p: [Math.cos(a) * 1.4, h + 0.6, Math.sin(a) * 1.4] }, { emissive: k % 2 === 0 });
      }
      blob(mb, 0.9, f0, [0, 6.2, 0]);
      break;
    }
    case 'crystaltree': {
      for (let k = 0; k < 6; k++) {
        const a = rng.range(0, Math.PI * 2);
        const tilt = k === 0 ? 0 : rng.range(0.2, 0.55);
        const h = k === 0 ? 6 : rng.range(2.5, 4.5);
        mb.add(new THREE.OctahedronGeometry(1, 0), k % 2 ? f0 : f2, { p: [Math.cos(a) * tilt * 2, h * 0.5, Math.sin(a) * tilt * 2], r: [Math.sin(a) * tilt, a, -Math.cos(a) * tilt], s: [0.55, h * 0.55, 0.55] }, { emissive: k % 3 === 0 });
      }
      break;
    }
    case 'spiral': {
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        mb.add(new THREE.BoxGeometry(1.4 - t * 0.9, 0.9, 1.4 - t * 0.9), i % 2 ? f0 : f1, { p: [Math.sin(t * 5) * 0.6, 0.5 + i * 0.95, Math.cos(t * 5) * 0.6], r: [0, t * 3, 0.2] });
      }
      mb.add(new THREE.SphereGeometry(0.6, 7, 5), f2, { p: [0, 9.2, 0.6] }, { emissive: true });
      break;
    }
    case 'spike': {
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const tilt = k === 0 ? 0 : 0.5;
        const h = k === 0 ? 4.5 : rng.range(2, 3.5);
        mb.add(new THREE.ConeGeometry(0.35, h, 5), k % 2 ? trunk : f0, { p: [Math.cos(a) * 0.4, h * 0.45, Math.sin(a) * 0.4], r: [Math.sin(a) * tilt, 0, -Math.cos(a) * tilt] });
      }
      break;
    }
    case 'bush': {
      blob(mb, 0.8, f0, [0, 0.55, 0], [1.2, 0.8, 1.2]);
      blob(mb, 0.6, shade(f0, 1.15), [0.6, 0.45, 0.3]);
      blob(mb, 0.55, f1, [-0.5, 0.4, -0.3]);
      break;
    }
    case 'fern': {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        mb.add(new THREE.ConeGeometry(0.3, 1.8, 3), k % 2 ? f0 : f1, { p: [Math.cos(a) * 0.55, 0.55, Math.sin(a) * 0.55], r: [Math.sin(a) * 1.0, 0, -Math.cos(a) * 1.0], s: [1, 1, 0.3] });
      }
      break;
    }
    case 'bulb': {
      mb.add(new THREE.CylinderGeometry(0.06, 0.1, 0.9, 4), f0, { p: [0, 0.45, 0] });
      mb.add(new THREE.SphereGeometry(0.38, 7, 5), f2, { p: [0, 1.0, 0], s: [1, 1.2, 1] }, { emissive: true });
      mb.add(new THREE.ConeGeometry(0.25, 0.8, 3), f0, { p: [0.25, 0.3, 0], r: [0, 0, -0.8], s: [1, 1, 0.3] });
      mb.add(new THREE.ConeGeometry(0.25, 0.8, 3), f0, { p: [-0.25, 0.3, 0], r: [0, 0, 0.8], s: [1, 1, 0.3] });
      break;
    }
    case 'deadbush': {
      for (let k = 0; k < 6; k++) {
        const a = rng.range(0, Math.PI * 2);
        mb.add(new THREE.CylinderGeometry(0.03, 0.06, 1.2, 3), shade(trunk, 1.4), { p: [Math.cos(a) * 0.25, 0.5, Math.sin(a) * 0.25], r: [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6] });
      }
      break;
    }
    case 'frost': {
      for (let k = 0; k < 5; k++) {
        const a = rng.range(0, Math.PI * 2);
        mb.add(new THREE.OctahedronGeometry(0.3, 0), k % 2 ? f1 : [0.85, 0.95, 1], { p: [Math.cos(a) * 0.3, 0.35, Math.sin(a) * 0.3], r: [Math.sin(a) * 0.4, a, 0], s: [0.6, 1.6, 0.6] });
      }
      break;
    }
    case 'shroom': {
      for (let k = 0; k < 4; k++) {
        const a = rng.range(0, Math.PI * 2), rr = k ? 0.4 : 0;
        const h = rng.range(0.4, 0.9);
        mb.add(new THREE.CylinderGeometry(0.06, 0.08, h, 5), [0.85, 0.82, 0.75], { p: [Math.cos(a) * rr, h / 2, Math.sin(a) * rr] });
        mb.add(new THREE.SphereGeometry(0.25, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), f1, { p: [Math.cos(a) * rr, h, Math.sin(a) * rr], s: [1, 0.7, 1] }, { emissive: k === 0 });
      }
      break;
    }
    case 'grass': {
      const g0 = mixColor(pal.groundA, f0, 0.35), g1 = scaleColor(g0, 1.25);
      for (let k = 0; k < 6; k++) {
        const a = rng.range(0, Math.PI * 2), rr = rng.range(0, 0.45);
        const h = rng.range(0.45, 0.85);
        mb.add(new THREE.ConeGeometry(0.07, h, 3), [g0, g1, g0], { p: [Math.cos(a) * rr, h / 2, Math.sin(a) * rr], r: [rng.range(-0.3, 0.3), a, rng.range(-0.3, 0.3)], s: [1, 1, 0.35] });
      }
      break;
    }
    case 'rock': {
      mb.add(new THREE.IcosahedronGeometry(0.6, 0), pal.rock, { p: [0, 0.25, 0], s: [1.2, 0.7, 1] }, { jitter: 0.25 });
      mb.add(new THREE.IcosahedronGeometry(0.35, 0), shade(pal.rock, 1.2), { p: [0.6, 0.1, 0.2] }, { jitter: 0.15 });
      break;
    }
    case 'boulder': {
      const c = mixColor(pal.rock, [0.55, 0.56, 0.6], 0.5);
      mb.add(new THREE.IcosahedronGeometry(1.8, 1), c, { p: [0, 1.2, 0], s: [1.2, 0.85, 1] }, { jitter: 0.55 });
      mb.add(new THREE.IcosahedronGeometry(0.5, 0), [0.78, 0.8, 0.86], { p: [0.9, 1.9, 0.8] }, { jitter: 0.1 });
      mb.add(new THREE.IcosahedronGeometry(0.4, 0), [0.78, 0.8, 0.86], { p: [-1.1, 1.2, 0.9] }, { jitter: 0.1 });
      break;
    }
    case 'crystal': {
      const cA = [0.25, 0.6, 1.0], cB = [0.55, 0.85, 1.0];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + rng.range(0, 0.5);
        const tilt = k === 0 ? 0 : rng.range(0.3, 0.6);
        const h = k === 0 ? 2.4 : rng.range(1.1, 1.9);
        mb.add(new THREE.OctahedronGeometry(1, 0), k % 2 ? cA : cB, { p: [Math.cos(a) * tilt * 0.9, h * 0.42, Math.sin(a) * tilt * 0.9], r: [Math.sin(a) * tilt, a, -Math.cos(a) * tilt], s: [0.32, h * 0.5, 0.32] }, { emissive: true });
      }
      mb.add(new THREE.IcosahedronGeometry(0.7, 0), pal.rock, { p: [0, 0.1, 0], s: [1.4, 0.5, 1.4] }, { jitter: 0.2 });
      break;
    }
    case 'gold': {
      const c = mixColor(pal.rock, [0.35, 0.3, 0.25], 0.5);
      mb.add(new THREE.IcosahedronGeometry(1.3, 1), c, { p: [0, 0.9, 0], s: [1.1, 0.9, 1] }, { jitter: 0.4 });
      for (let k = 0; k < 7; k++) {
        const a = rng.range(0, Math.PI * 2), e = rng.range(-0.2, 0.9);
        mb.add(new THREE.OctahedronGeometry(0.3, 0), [1.0, 0.8, 0.25], { p: [Math.cos(a) * 1.25 * Math.cos(e), 0.9 + Math.sin(e) * 1.1, Math.sin(a) * 1.25 * Math.cos(e)] }, { emissive: true });
      }
      break;
    }
    case 'oxyplant': {
      mb.add(new THREE.CylinderGeometry(0.06, 0.09, 1.0, 4), [0.25, 0.45, 0.2], { p: [0, 0.5, 0] });
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        mb.add(new THREE.SphereGeometry(0.3, 6, 4), [1.0, 0.18, 0.28], { p: [Math.cos(a) * 0.3, 1.1, Math.sin(a) * 0.3], s: [1, 0.5, 1] });
      }
      mb.add(new THREE.SphereGeometry(0.18, 6, 4), [1.0, 0.85, 0.5], { p: [0, 1.18, 0] }, { emissive: true });
      break;
    }
    case 'sodiumplant': {
      mb.add(new THREE.CylinderGeometry(0.08, 0.12, 0.6, 5), [0.5, 0.4, 0.15], { p: [0, 0.3, 0] });
      mb.add(new THREE.SphereGeometry(0.5, 8, 6), [1.0, 0.72, 0.05], { p: [0, 0.85, 0], s: [1, 0.8, 1] }, { emissive: true });
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        mb.add(new THREE.ConeGeometry(0.22, 0.9, 3), [0.8, 0.55, 0.1], { p: [Math.cos(a) * 0.35, 0.3, Math.sin(a) * 0.35], r: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], s: [1, 1, 0.35] });
      }
      break;
    }
    default:
      blob(mb, 0.5, f0, [0, 0.5, 0]);
  }
  return mb.build();
}
