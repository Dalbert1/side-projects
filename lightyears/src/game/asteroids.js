// Asteroid fields in open space. Shoot them for Tritium to sell, sometimes Gold.
import * as THREE from 'three';
import { Rng, hashInts } from '../core/rng.js';
import { MeshBuilder } from '../render/meshBuilder.js';
import { makeObjectMaterial } from '../render/shaders.js';

const CELL = 900;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();

export class Asteroids {
  constructor(game, sys) {
    this.game = game;
    this.seed = sys.star.seed;
    this.density = sys.asteroids;
    this.group = new THREE.Group();
    const mb = new MeshBuilder();
    mb.add(new THREE.IcosahedronGeometry(1, 1), [0.42, 0.4, 0.38], null, { jitter: 0.35 });
    mb.add(new THREE.IcosahedronGeometry(0.35, 0), [0.62, 0.8, 0.9], { p: [0.7, 0.4, 0.2] }, { jitter: 0.1, emissive: true });
    mb.add(new THREE.IcosahedronGeometry(0.4, 0), [0.35, 0.33, 0.3], { p: [-0.6, -0.5, 0.3] }, { jitter: 0.1 });
    this.mat = makeObjectMaterial(game.objAtmo, { spec: 0.15 });
    this.mesh = new THREE.InstancedMesh(mb.build(), this.mat, 700);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
    this.cells = new Map();
    this.lastKey = '';
    this.list = [];
    this.bolts = [];
    this.destroyed = new Set();
    this.origin = new THREE.Vector3();
    this.dirty = true;
  }

  _blocked(p) {
    for (const pl of this.game.planets) {
      if (p.distanceTo(pl.pos) < pl.R * 4.2) return true;
    }
    const st = this.game.station;
    if (st && p.distanceTo(st.pos) < 3000) return true;
    return false;
  }

  _cell(ix, iy, iz) {
    const key = `${ix},${iy},${iz}`;
    let c = this.cells.get(key);
    if (c) return c;
    const rng = new Rng(hashInts(this.seed, ix, iy, iz, 5));
    const list = [];
    // fields: most cells empty, some dense
    const field = rng.float() < 0.35 * this.density;
    const n = field ? rng.int(3, 9) : rng.chance(0.25) ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const pos = new THREE.Vector3((ix + rng.float()) * CELL, (iy + rng.float()) * CELL, (iz + rng.float()) * CELL);
      const id = `${key}:${i}`;
      if (this.destroyed.has(id) || this._blocked(pos)) continue;
      const r = rng.range(6, 26) * (rng.chance(0.1) ? 2.2 : 1);
      list.push({ id, pos, r, rot: [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)], spin: rng.range(-0.2, 0.2), hp: r * 0.12, gold: rng.chance(0.12) });
    }
    c = { key, list };
    this.cells.set(key, c);
    return c;
  }

  update(dt, camPos, active) {
    const g = this.game;
    this.mesh.visible = active;
    if (!active) return;
    const ix = Math.floor(camPos.x / CELL), iy = Math.floor(camPos.y / CELL), iz = Math.floor(camPos.z / CELL);
    const key = `${ix},${iy},${iz}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.list = [];
      const keep = new Set();
      for (let x = -2; x <= 2; x++) for (let y = -1; y <= 1; y++) for (let z = -2; z <= 2; z++) {
        const c = this._cell(ix + x, iy + y, iz + z);
        keep.add(c.key);
        this.list.push(...c.list);
      }
      for (const k of this.cells.keys()) if (!keep.has(k)) this.cells.delete(k);
      this.origin.set(ix * CELL, iy * CELL, iz * CELL);
      this.group.position.copy(this.origin);
      this.dirty = true;
    }
    // spin and write instances relative to the group origin
    let n = 0;
    const t = performance.now() * 0.001;
    for (const a of this.list) {
      if (a.dead) continue;
      if (n >= 700) break;
      _e.set(a.rot[0] + t * a.spin, a.rot[1] + t * a.spin * 0.7, a.rot[2]);
      _q.setFromEuler(_e);
      _s.set(a.r, a.r * 0.8, a.r * 0.9);
      _v.copy(a.pos).sub(this.origin);
      _m.compose(_v, _q, _s);
      this.mesh.setMatrixAt(n++, _m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;

    // bolts vs rocks
    for (const b of this.bolts) {
      if (b.dead || b.age >= b.life) continue;
      for (const a of this.list) {
        if (a.dead) continue;
        if (b.pos.distanceToSquared(a.pos) < (a.r + 2) * (a.r + 2)) {
          b.dead = true;
          a.hp -= 1;
          g.particles.burst(b.pos, [1, 0.6, 0.3], 5, 20, 1.2, 0.5);
          if (a.hp <= 0) this._break(a);
          break;
        }
      }
    }
    this.bolts = this.bolts.filter((b) => !b.dead && b.age < b.life);

    // ship bumps
    const ship = g.ship;
    if (g.mode === 'ship' && ship.state === 'flying') {
      for (const a of this.list) {
        if (a.dead) continue;
        const rr = a.r + 3;
        if (ship.pos.distanceToSquared(a.pos) < rr * rr) {
          _v.copy(ship.pos).sub(a.pos).normalize();
          ship.pos.copy(a.pos).addScaledVector(_v, rr);
          const into = -ship.vel.dot(_v);
          if (into > 0) ship.vel.addScaledVector(_v, into * 1.6);
          if (ship.hitCooldown <= 0) {
            ship.hitCooldown = 1;
            ship.speed *= 0.4;
            ship.pulseOn = false;
            ship.shake = 0.9;
            g.damageShip(Math.min(30, 6 + into * 0.05));
          }
        }
      }
    }
  }

  registerBolt(b) {
    if (b) this.bolts.push(b);
  }

  _break(a) {
    const g = this.game;
    a.dead = true;
    this.destroyed.add(a.id);
    g.particles.burst(a.pos, [0.7, 0.9, 1.0], 30, 35, 2.2, 1.3);
    g.particles.burst(a.pos, [1, 0.7, 0.35], 16, 25, 1.6, 0.9);
    g.audio.sfx('boom');
    const tr = Math.round(a.r * 1.6 + 10);
    const got = g.inv.add('tritium', tr);
    let msg = `+${got} Tritium`;
    if (a.gold) {
      const au = g.inv.add('gold', Math.round(3 + a.r * 0.3));
      msg += `, +${au} Gold`;
    }
    g.hud.toast(msg, 'res', 0);
    g.objectives.event('asteroid');
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.group.removeFromParent();
  }
}
