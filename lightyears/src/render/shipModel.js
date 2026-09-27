// The Golden Driller: a gold and white fighter with a spinning drill for a nose.
// Local frame: +Z forward, +Y up, +X to the pilot's left (port). About 11 units nose to tail.

import * as THREE from 'three';
import { MeshBuilder } from './meshBuilder.js';
import { makeObjectMaterial } from './shaders.js';

const GOLD = [0.95, 0.72, 0.2];
const GOLD_DARK = [0.62, 0.42, 0.1];
const WHITE = [0.9, 0.91, 0.9];
const DARK = [0.15, 0.15, 0.18];
const GLASS = [0.05, 0.09, 0.16];
const ORANGE = [1.0, 0.5, 0.12];

function drillGeometry() {
  // twisted cone: helical ridges like a drill bit
  const geo = new THREE.ConeGeometry(0.95, 3.4, 6, 10, false);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + 1.7) / 3.4; // 0 base .. 1 tip
    const ang = t * Math.PI * 1.6;
    const x = pos.getX(i), z = pos.getZ(i);
    const c = Math.cos(ang), s = Math.sin(ang);
    pos.setXYZ(i, x * c - z * s, y, x * s + z * c);
  }
  const mb = new MeshBuilder();
  const flat = geo.toNonIndexed();
  const n = flat.attributes.position.count / 3;
  const cols = [];
  for (let f = 0; f < n; f++) cols.push(f % 2 ? GOLD : GOLD_DARK);
  mb.add(flat, cols, { r: [Math.PI / 2, 0, 0] });
  // collar
  mb.add(new THREE.CylinderGeometry(1.0, 1.05, 0.4, 10), DARK, { r: [Math.PI / 2, 0, 0], p: [0, 0, -1.8] });
  geo.dispose();
  return mb.build();
}

export function makeShip(atmoU) {
  const mb = new MeshBuilder();
  const X = Math.PI / 2;
  // hull
  mb.add(new THREE.CylinderGeometry(0.95, 1.3, 7.2, 8), WHITE, { r: [X, 0, 0], s: [1.25, 1, 0.8], p: [0, 0, 0] });
  // gold spine
  mb.add(new THREE.BoxGeometry(0.5, 0.35, 6.4), GOLD, { p: [0, 0.95, -0.4] });
  // belly
  mb.add(new THREE.BoxGeometry(1.6, 0.4, 5.6), DARK, { p: [0, -0.85, -0.3] });
  // cockpit canopy
  mb.add(new THREE.SphereGeometry(1, 12, 8), GLASS, { p: [0, 0.62, 1.1], s: [0.72, 0.55, 1.5] });
  // wings
  for (const sx of [-1, 1]) {
    mb.add(new THREE.BoxGeometry(4.4, 0.18, 2.3), WHITE, { p: [sx * 2.8, -0.2, -1.1], r: [0, sx * 0.38, sx * -0.1] });
    mb.add(new THREE.BoxGeometry(3.6, 0.06, 0.5), GOLD, { p: [sx * 2.8, -0.08, -0.7], r: [0, sx * 0.38, sx * -0.1] });
    // tip fin
    mb.add(new THREE.BoxGeometry(0.16, 1.4, 1.5), GOLD, { p: [sx * 4.75, 0.25, -2.35], r: [-0.3, 0, 0] });
    // running light
    mb.add(new THREE.SphereGeometry(0.16, 6, 4), sx > 0 ? [1, 0.15, 0.1] : [0.2, 1, 0.3], { p: [sx * 4.8, 0.95, -2.7] }, { emissive: true });
    // engine pod
    mb.add(new THREE.CylinderGeometry(0.55, 0.72, 3.3, 10), DARK, { r: [X, 0, 0], p: [sx * 1.35, -0.1, -3.5] });
    mb.add(new THREE.CylinderGeometry(0.6, 0.6, 0.35, 10), GOLD, { r: [X, 0, 0], p: [sx * 1.35, -0.1, -2.0] });
    mb.add(new THREE.CylinderGeometry(0.48, 0.48, 0.1, 10), ORANGE, { r: [X, 0, 0], p: [sx * 1.35, -0.1, -5.18] }, { emissive: true });
    // side intakes
    mb.add(new THREE.BoxGeometry(0.3, 0.5, 1.6), DARK, { p: [sx * 1.25, 0.1, 0.9] });
  }
  // tail
  mb.add(new THREE.BoxGeometry(0.2, 1.9, 2.1), GOLD, { p: [0, 1.25, -3.3], r: [-0.4, 0, 0] });
  mb.add(new THREE.SphereGeometry(0.14, 6, 4), [1, 1, 0.9], { p: [0, 2.05, -3.9] }, { emissive: true });

  const mat = makeObjectMaterial(atmoU, { spec: 0.7 });
  const hull = new THREE.Mesh(mb.build(), mat);

  const drill = new THREE.Mesh(drillGeometry(), mat);
  drill.position.set(0, 0, 5.3);

  // landing gear
  const gb = new MeshBuilder();
  for (const [x, z] of [[0, 2.6], [-1.6, -2.6], [1.6, -2.6]]) {
    gb.add(new THREE.CylinderGeometry(0.12, 0.12, 1.3, 6), DARK, { p: [x, -1.45, z] });
    gb.add(new THREE.CylinderGeometry(0.38, 0.45, 0.14, 8), GOLD, { p: [x, -2.1, z] });
  }
  const gear = new THREE.Mesh(gb.build(), mat);
  gear.visible = false;

  // engine glow billboards
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uPower: { value: 0.3 }, uColor: { value: new THREE.Vector3(1.0, 0.55, 0.2) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uPower;
      void main() {
        vUv = uv - 0.5;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * (1.2 + uPower * 1.6);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uPower;
      uniform vec3 uColor;
      void main() {
        float r = length(vUv) * 2.0;
        float a = exp(-r * 4.0) * (0.4 + uPower * 1.4);
        gl_FragColor = vec4(uColor * a * 2.0 + vec3(a * a), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glows = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
    g.position.set(sx * 1.35, -0.1, -5.4);
    g.frustumCulled = false;
    g.renderOrder = 20;
    glows.push(g);
  }

  const group = new THREE.Group();
  group.add(hull, drill, gear, ...glows);
  return { group, hull, drill, gear, glowMat, material: mat };
}
