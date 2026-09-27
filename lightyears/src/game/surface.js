// Plants, rocks, and resource deposits around the player. The planet is carved into
// 3D grid cells; each cell deterministically seeds its own objects so walking back
// to a spot finds the same trees (minus anything you mined).

import * as THREE from 'three';
import { Rng, hashInts } from '../core/rng.js';
import { Simplex } from '../core/noise.js';
import { buildFloraGeometry, KIND_INFO } from '../render/floraModels.js';
import { makeObjectMaterial } from '../render/shaders.js';

const S = 48; // cell size
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

export class Surface {
  constructor(game, planet, quality) {
    this.game = game;
    this.planet = planet;
    this.params = planet.params;
    this.sampler = planet.sampler;
    this.R = planet.R;
    this.quality = quality;
    this.cells = new Map();
    this.active = [];
    this.queue = [];
    this.lastCell = '';
    this.lastRebuildPos = new THREE.Vector3(1e9, 0, 0);
    this.dirty = true;
    this.mined = game.minedSet(planet);
    this.mask = new Simplex(hashInts(planet.params.seed, 0xf10a));
    this.extras = [];
    this.exclusions = [];
    this.group = new THREE.Group();
    planet.group.add(this.group);
    this._buildKinds();
  }

  _buildKinds() {
    const p = this.params;
    const fd = p.flora.density * (this.quality.floraDensity ?? 1);
    const res = p.resources;
    const K = [];
    const add = (kind, density, radius, extra = {}) => {
      if (density <= 0) return;
      K.push({ kind, info: KIND_INFO[kind], density, radius: radius * (this.quality.floraRange ?? 1), ...extra });
    };
    for (const t of p.flora.trees) add(t, (1.05e-3 * fd) / p.flora.trees.length, 240, { wind: 0.6 });
    for (const b of p.flora.bushes) add(b, (2.6e-3 * fd) / p.flora.bushes.length, 130, { wind: 1 });
    if (p.flora.grass) add('grass', 16e-3 * fd, 64, { wind: 1.6 });
    add('rock', 1.2e-3, 110);
    add('boulder', 0.3e-3, 240);
    add('crystal', 0.34e-3 * res.crystal, 240);
    add('gold', 0.9e-3 * res.gold, 240);
    add('oxyplant', 0.5e-3 * res.oxygen, 150);
    add('sodiumplant', 0.5e-3 * res.sodium, 150);

    const atmoU = this.game.objAtmo;
    const hasAir = !!p.atmo;
    K.forEach((k, i) => {
      k.index = i;
      const geo = buildFloraGeometry(k.kind, p.palette, hashInts(p.seed, i, 77));
      const mat = makeObjectMaterial(atmoU, { wind: hasAir ? k.wind || 0 : 0, doubleSide: k.kind === 'grass' || k.kind === 'fern' || k.kind === 'palm' });
      const cap = k.kind === 'grass' ? 2600 : k.info.cat === 'bush' ? 1200 : 900;
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, _c.setRGB(1, 1, 1));
      mesh.renderOrder = 1;
      this.group.add(mesh);
      k.mesh = mesh;
      k.cap = cap;
      k.r2 = k.radius * k.radius;
    });
    this.kinds = K;
    this.maxRadius = Math.max(...K.map((k) => k.radius));
  }

  // Keep an area clear (the landed ship and where you step out)
  exclude(localPos, radius) {
    this.exclusions.push({ p: localPos.clone(), r2: radius * radius });
    this.dirty = true;
  }

  _excluded(p) {
    for (const e of this.exclusions) if (p.distanceToSquared(e.p) < e.r2) return true;
    return false;
  }

  // Extra objects placed by the game (tutorial crystals around the crash site)
  addExtra(kind, localPos, scale = 1) {
    const k = this.kinds.find((q) => q.kind === kind);
    if (!k) return;
    const id = `x:${this.extras.length}:${kind}`;
    if (this.mined.has(id)) return;
    const d = localPos.clone().normalize();
    const r = this.R + this.sampler.groundHeight(d.x, d.y, d.z);
    const obj = this._makeObj(k, d.clone().multiplyScalar(r), d, scale, Math.random() * 6.28, id);
    obj.extra = true;
    this.extras.push(obj);
    this.dirty = true;
  }

  _makeObj(k, pos, up, scale, rot, id) {
    const info = k.info;
    _q.setFromUnitVectors(_Y, up);
    _q2.setFromAxisAngle(_Y, rot);
    _q.multiply(_q2);
    _s.set(scale, scale, scale);
    _m.compose(pos, _q, _s);
    const hp = (info.hp || 1) * (0.7 + scale * 0.3);
    return {
      k: k.index,
      pos,
      up,
      scale,
      id,
      hp,
      maxHp: hp,
      matrix: new Float32Array(_m.elements),
      tint: 0.85 + ((hashInts(id.length, pos.x * 10, pos.z * 10) % 1000) / 1000) * 0.3,
    };
  }

  _genCell(ix, iy, iz, key) {
    const rng = new Rng(hashInts(this.params.seed, ix, iy, iz));
    const x0 = ix * S, y0 = iy * S, z0 = iz * S;
    const objs = [];
    const sampler = this.sampler;
    const R = this.R;
    const liquid = this.params.liquid;
    const snowLine = this.params.terrain.snowLine;
    const beach = this.params.terrain.beach;
    const area = S * S;
    let serial = 0;
    for (const k of this.kinds) {
      const expected = k.density * area;
      let n = Math.floor(expected + rng.float());
      const cat = k.info.cat;
      let attempts = Math.ceil(n * 1.5) + (n > 0 ? 1 : 0);
      while (n > 0 && attempts-- > 0) {
        const px = x0 + rng.float() * S, py = y0 + rng.float() * S, pz = z0 + rng.float() * S;
        const len = Math.hypot(px, py, pz);
        const dx = px / len, dy = py / len, dz = pz / len;
        const h = sampler.height(dx, dy, dz);
        serial++;
        if (liquid && h < 0.6) continue;
        const r = R + h;
        const sx = dx * r, sy = dy * r, sz = dz * r;
        if (sx < x0 || sx >= x0 + S || sy < y0 || sy >= y0 + S || sz < z0 || sz >= z0 + S) continue;
        // slope from two nearby samples
        const slope = this._slope(dx, dy, dz, h);
        const maxSlope = cat === 'rock' ? 0.8 : cat === 'mineral' ? 0.45 : cat === 'grass' ? 0.22 : 0.3;
        if (slope > maxSlope) continue;
        if (cat !== 'rock' && cat !== 'mineral' && h > snowLine + 20 && k.kind !== 'cone' && k.kind !== 'frost') continue;
        if ((cat === 'tree' || cat === 'grass') && beach > 0 && h < beach * 1.2) continue;
        // clumping: forests and clearings
        if (cat === 'tree' || cat === 'bush' || cat === 'grass') {
          const m = this.mask.noise(dx * R / 220 + k.index * 7.1, dy * R / 220, dz * R / 220);
          if (m < -0.15 && rng.float() < 0.85) { n--; continue; }
        }
        const scale = cat === 'grass' ? rng.range(0.7, 1.3) : cat === 'tree' ? rng.range(0.7, 1.35) : rng.range(0.75, 1.3);
        const id = `${key}:${k.index}:${serial}`;
        n--;
        if (this.mined.has(id)) continue;
        const up = cat === 'rock' || cat === 'mineral' ? this._normalish(dx, dy, dz, h) : new THREE.Vector3(dx, dy, dz);
        objs.push(this._makeObj(k, new THREE.Vector3(sx, sy, sz), up, scale, rng.float() * Math.PI * 2, id));
      }
    }
    return objs;
  }

  _slope(dx, dy, dz, h) {
    // tangent basis
    let tx = -dz, ty = 0, tz = dx;
    let tl = Math.hypot(tx, tz);
    if (tl < 1e-3) { tx = 1; tz = 0; tl = 1; }
    tx /= tl; tz /= tl;
    const bx = dy * tz - dz * ty, by = dz * tx - dx * tz, bz = dx * ty - dy * tx;
    const e = 1.6 / this.R;
    const h1 = this.sampler.height(dx + tx * e, dy + ty * e, dz + tz * e);
    const h2 = this.sampler.height(dx + bx * e, dy + by * e, dz + bz * e);
    const g = Math.hypot(h1 - h, h2 - h) / 1.6;
    return 1 - 1 / Math.sqrt(1 + g * g);
  }

  _normalish(dx, dy, dz, h) {
    // blend of radial up and a gentle tilt with the slope
    const up = new THREE.Vector3(dx, dy, dz);
    const e = 1.5 / this.R;
    let tx = -dz, tz = dx;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const h1 = this.sampler.height(dx + tx * e, dy, dz + tz * e);
    const t = new THREE.Vector3(tx, 0, tz);
    const b = new THREE.Vector3().crossVectors(up, t);
    const h2 = this.sampler.height(dx + b.x * e, dy + b.y * e, dz + b.z * e);
    up.addScaledVector(t, -(h1 - h) / 1.5 * 0.5).addScaledVector(b, -(h2 - h) / 1.5 * 0.5).normalize();
    return up;
  }

  update(playerLocal, budgetMs = 3) {
    const cx = Math.floor(playerLocal.x / S), cy = Math.floor(playerLocal.y / S), cz = Math.floor(playerLocal.z / S);
    const cellKey = `${cx},${cy},${cz}`;
    if (cellKey !== this.lastCell) {
      this.lastCell = cellKey;
      this._planCells(playerLocal);
    }
    // generate queued cells within budget
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const c = this.queue.shift();
      if (!this.cells.has(c.key)) {
        this.cells.set(c.key, { key: c.key, objs: this._genCell(c.ix, c.iy, c.iz, c.key) });
        this.dirty = true;
      }
    }
    if (this.dirty || this.lastRebuildPos.distanceToSquared(playerLocal) > 144) {
      this._rebuild(playerLocal);
    }
  }

  _planCells(p) {
    const rad = this.maxRadius + S;
    const R = this.R;
    const minR = R + this.planet.minH - S, maxR = R + this.planet.maxH + S;
    const x0 = Math.floor((p.x - rad) / S), x1 = Math.floor((p.x + rad) / S);
    const y0 = Math.floor((p.y - rad) / S), y1 = Math.floor((p.y + rad) / S);
    const z0 = Math.floor((p.z - rad) / S), z1 = Math.floor((p.z + rad) / S);
    const want = [];
    const keep = new Set();
    const up = _v2.copy(p).normalize();
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const mx = (ix + 0.5) * S, my = (iy + 0.5) * S, mz = (iz + 0.5) * S;
          const dxp = mx - p.x, dyp = my - p.y, dzp = mz - p.z;
          const dist2 = dxp * dxp + dyp * dyp + dzp * dzp;
          if (dist2 > rad * rad) continue;
          const rr = Math.hypot(mx, my, mz);
          if (rr < minR || rr > maxR) continue;
          // cheap check against the ground right under the cell center
          const g = R + this.sampler.groundHeight(mx / rr, my / rr, mz / rr);
          if (Math.abs(rr - g) > S * 0.9 + 30) continue;
          const key = `${ix},${iy},${iz}`;
          keep.add(key);
          if (!this.cells.has(key)) want.push({ key, ix, iy, iz, d: dist2 });
        }
      }
    }
    want.sort((a, b) => a.d - b.d);
    this.queue = want;
    for (const key of this.cells.keys()) if (!keep.has(key)) this.cells.delete(key);
    this.dirty = true;
  }

  _rebuild(p) {
    this.dirty = false;
    this.lastRebuildPos.copy(p);
    const counts = new Array(this.kinds.length).fill(0);
    const visit = (o) => {
      if (o.dead) return;
      if (!o.extra && this.exclusions.length && this._excluded(o.pos)) { o.slot = -1; return; }
      const k = this.kinds[o.k];
      if (o.pos.distanceToSquared(p) > k.r2) { o.slot = -1; return; }
      const n = counts[o.k];
      if (n >= k.cap) { o.slot = -1; return; }
      k.mesh.instanceMatrix.array.set(o.matrix, n * 16);
      _c.setScalar(o.tint);
      k.mesh.setColorAt(n, _c);
      o.slot = n;
      counts[o.k] = n + 1;
    };
    for (const c of this.cells.values()) for (const o of c.objs) visit(o);
    for (const o of this.extras) visit(o);
    this.kinds.forEach((k, i) => {
      k.mesh.count = counts[i];
      k.mesh.instanceMatrix.needsUpdate = true;
      if (k.mesh.instanceColor) k.mesh.instanceColor.needsUpdate = true;
    });
  }

  *nearby(p, radius) {
    const r2 = radius * radius;
    for (const c of this.cells.values()) {
      for (const o of c.objs) if (!o.dead && o.slot !== -1 && o.pos.distanceToSquared(p) < r2) yield o;
    }
    for (const o of this.extras) if (!o.dead && o.pos.distanceToSquared(p) < r2) yield o;
  }

  info(o) {
    return this.kinds[o.k].info;
  }

  kindOf(o) {
    return this.kinds[o.k].kind;
  }

  // center and radius of an object's hit sphere
  hitSphere(o, out) {
    const info = this.kinds[o.k].info;
    const h = info.height * o.scale;
    out.copy(o.pos).addScaledVector(o.up, h * 0.45);
    return Math.max(h * 0.5, (info.collide || 0.4) * o.scale * 1.4, 0.6);
  }

  raycast(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const o of this.nearby(origin, maxDist + 12)) {
      if (!this.kinds[o.k].info.res) continue;
      const r = this.hitSphere(o, _v);
      const ox = origin.x - _v.x, oy = origin.y - _v.y, oz = origin.z - _v.z;
      const b = ox * dir.x + oy * dir.y + oz * dir.z;
      const c = ox * ox + oy * oy + oz * oz - r * r;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < bestT) { bestT = t; best = o; }
    }
    return best ? { obj: best, t: bestT } : null;
  }

  // wiggle an object's instance while it is being mined
  shake(o, amount) {
    if (o.slot < 0) return;
    const k = this.kinds[o.k];
    const arr = k.mesh.instanceMatrix.array;
    arr.set(o.matrix, o.slot * 16);
    arr[o.slot * 16 + 12] += (Math.random() - 0.5) * amount;
    arr[o.slot * 16 + 13] += (Math.random() - 0.5) * amount;
    arr[o.slot * 16 + 14] += (Math.random() - 0.5) * amount;
    k.mesh.instanceMatrix.needsUpdate = true;
  }

  remove(o) {
    o.dead = true;
    this.mined.add(o.id);
    this.dirty = true;
    this.game.saveSoon();
  }

  collidePlayer(pos, radius) {
    for (const o of this.nearby(pos, 6)) {
      const info = this.kinds[o.k].info;
      if (!info.collide) continue;
      const cr = info.collide * o.scale + radius;
      // horizontal distance from the trunk axis
      _v.copy(pos).sub(o.pos);
      const along = _v.dot(o.up);
      if (along < -0.5 || along > info.height * o.scale) continue;
      _v.addScaledVector(o.up, -along);
      const d = _v.length();
      if (d < cr && d > 1e-4) pos.addScaledVector(_v, (cr - d) / d);
    }
  }

  dispose() {
    for (const k of this.kinds) {
      k.mesh.geometry.dispose();
      k.mesh.material.dispose();
      k.mesh.dispose?.();
    }
    this.group.removeFromParent();
  }
}
