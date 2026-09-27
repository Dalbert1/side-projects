// Merge simple primitives into one flat shaded, vertex colored geometry.
// Color alpha of 255 marks self lit parts (engine glow, lights, crystals).

import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class MeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
  }

  // transform: { p:[x,y,z], r:[rx,ry,rz], s:[sx,sy,sz] } or a Matrix4
  add(geo, color, transform, opts = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (transform) {
      if (transform.isMatrix4) _m.copy(transform);
      else {
        _p.set(...(transform.p || [0, 0, 0]));
        _e.set(...(transform.r || [0, 0, 0]));
        _q.setFromEuler(_e);
        const s = transform.s ?? 1;
        if (typeof s === 'number') _s.set(s, s, s);
        else _s.set(...s);
        _m.compose(_p, _q, _s);
      }
      g.applyMatrix4(_m);
    }
    if (opts.jitter) {
      const pa = g.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const k = opts.jitter;
        pa.setXYZ(i, pa.getX(i) + (hash(i * 3.1 + pa.getX(i)) - 0.5) * k, pa.getY(i) + (hash(i * 7.3 + pa.getY(i)) - 0.5) * k, pa.getZ(i) + (hash(i * 5.7 + pa.getZ(i)) - 0.5) * k);
      }
    }
    if (!opts.smooth) g.computeVertexNormals();
    const pa = g.attributes.position;
    const na = g.attributes.normal;
    const emit = opts.emissive ? 1 : 0;
    const cols = Array.isArray(color[0]) ? color : null;
    for (let i = 0; i < pa.count; i++) {
      this.positions.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      this.normals.push(na.getX(i), na.getY(i), na.getZ(i));
      let c = color;
      if (cols) c = cols[Math.floor(i / 3) % cols.length];
      else if (opts.shade) {
        // darken toward the bottom for a bit of fake occlusion
        const t = Math.max(0, Math.min(1, (pa.getY(i) - opts.shade[0]) / (opts.shade[1] - opts.shade[0])));
        const k = 0.55 + 0.45 * t;
        c = [color[0] * k, color[1] * k, color[2] * k];
      }
      this.colors.push(c[0], c[1], c[2], emit);
    }
    g.dispose();
    return this;
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    const c = new Uint8Array(this.colors.length);
    for (let i = 0; i < this.colors.length; i++) c[i] = Math.round(Math.max(0, Math.min(1, this.colors[i])) * 255);
    geo.setAttribute('aColor', new THREE.BufferAttribute(c, 4, true));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}

function hash(x) {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
