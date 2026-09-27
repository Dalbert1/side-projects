// Procedural critters. Each planet gets a few species built from primitives:
// four legged grazers, bipeds, six legged crawlers, bouncing blobs, and flyers.

import * as THREE from 'three';
import { Rng, hashInts } from '../core/rng.js';
import { MeshBuilder } from '../render/meshBuilder.js';
import { makeObjectMaterial } from '../render/shaders.js';
import { speciesName } from '../core/names.js';
import { hsl } from '../world/color.js';
import { floorAt } from './player.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _x = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

export function makeSpecies(planet, index) {
  const seed = hashInts(planet.params.seed, 404, index);
  const rng = new Rng(seed);
  const biome = planet.params.biome;
  const type = rng.weighted([['quad', 5], ['biped', 2], ['hexa', 2], ['blob', 2], ['flyer', 2]]);
  const hue = rng.float();
  const primary = hsl(hue, rng.range(0.35, 0.75), rng.range(0.35, 0.6));
  const secondary = hsl(hue + rng.range(0.05, 0.5), rng.range(0.3, 0.7), rng.range(0.55, 0.8));
  const accent = hsl(rng.float(), 0.8, 0.6);
  const size = type === 'flyer' ? rng.range(0.6, 1.4) : rng.chance(0.15) ? rng.range(2.4, 4.2) : rng.range(0.55, 1.7);
  const behavior = rng.weighted([['grazer', 5], ['skittish', 2], ['curious', 2]]);
  return {
    index,
    seed,
    type,
    name: speciesName(seed),
    primary, secondary, accent,
    size,
    behavior,
    herd: type === 'flyer' ? rng.int(2, 4) : rng.int(1, 4),
    speed: (type === 'hexa' ? 2.6 : type === 'blob' ? 2.2 : 1.9) * Math.sqrt(size) * rng.range(0.8, 1.25),
    bodyLen: rng.range(1.2, 2.2),
    bodyH: rng.range(0.7, 1.2),
    bodyW: rng.range(0.7, 1.1),
    legLen: type === 'hexa' ? rng.range(0.5, 0.8) : rng.range(0.7, 1.5),
    neck: rng.range(0.2, 1.0),
    head: rng.range(0.45, 0.8),
    tail: rng.chance(0.7) ? rng.range(0.5, 1.4) : 0,
    horns: rng.chance(0.45),
    ears: rng.chance(0.5),
    spikes: rng.chance(0.35),
    snout: rng.range(0.2, 0.6),
    rng,
    biome,
    known: false,
  };
}

function buildSpeciesMeshes(sp, material) {
  const mb = new MeshBuilder();
  const { primary: P, secondary: S, accent: A } = sp;
  const L = sp.legLen;
  const bl = sp.bodyLen, bh = sp.bodyH, bw = sp.bodyW;
  const hipY = sp.type === 'blob' || sp.type === 'flyer' ? 0 : L;
  const legs = [];
  let bodyY = hipY + bh * 0.4;
  if (sp.type === 'blob') bodyY = bh * 0.75;
  if (sp.type === 'flyer') bodyY = 0;

  if (sp.type === 'biped') {
    mb.add(new THREE.SphereGeometry(1, 9, 7), P, { p: [0, bodyY + 0.2, 0], s: [bw * 0.55, bh * 0.8, bl * 0.42], r: [-0.35, 0, 0] });
    mb.add(new THREE.SphereGeometry(1, 8, 6), S, { p: [0, bodyY, 0.18], s: [bw * 0.42, bh * 0.6, bl * 0.3], r: [-0.35, 0, 0] });
    for (const sx of [-1, 1]) mb.add(new THREE.CylinderGeometry(0.08, 0.06, 0.7, 5), P, { p: [sx * bw * 0.5, bodyY + 0.3, 0.35], r: [0.9, 0, sx * 0.3] });
  } else if (sp.type === 'blob') {
    mb.add(new THREE.SphereGeometry(1, 10, 8), P, { p: [0, bodyY, 0], s: [bw * 0.8, bh * 0.75, bw * 0.8] });
    mb.add(new THREE.SphereGeometry(1, 8, 6), S, { p: [0, bodyY - bh * 0.2, 0.15], s: [bw * 0.6, bh * 0.5, bw * 0.6] });
  } else if (sp.type === 'flyer') {
    mb.add(new THREE.SphereGeometry(1, 8, 6), P, { p: [0, 0, 0], s: [0.35, 0.3, 0.8] });
    mb.add(new THREE.ConeGeometry(0.25, 0.9, 5), S, { p: [0, 0, -0.9], r: [-Math.PI / 2, 0, 0] });
  } else {
    // quad and hexa share a horizontal torso
    const len = sp.type === 'hexa' ? bl * 1.3 : bl;
    mb.add(new THREE.SphereGeometry(1, 10, 7), P, { p: [0, bodyY, 0], s: [bw * 0.5, bh * 0.45, len * 0.55] });
    mb.add(new THREE.SphereGeometry(1, 8, 6), S, { p: [0, bodyY - bh * 0.12, 0.05], s: [bw * 0.42, bh * 0.36, len * 0.46] });
    if (sp.spikes) {
      for (let i = 0; i < 5; i++) mb.add(new THREE.ConeGeometry(0.1, 0.35, 4), A, { p: [0, bodyY + bh * 0.42, -len * 0.35 + i * len * 0.17] });
    }
    if (sp.tail) mb.add(new THREE.ConeGeometry(0.14, sp.tail, 5), P, { p: [0, bodyY + 0.05, -len * 0.55 - sp.tail * 0.4], r: [-Math.PI / 2 - 0.4, 0, 0] });
  }

  // head
  if (sp.type !== 'flyer') {
    const front = sp.type === 'biped' ? 0.35 : sp.type === 'blob' ? bw * 0.55 : (sp.type === 'hexa' ? bl * 1.3 : bl) * 0.55;
    const hy = sp.type === 'blob' ? bodyY + 0.1 : bodyY + sp.neck * 0.6 + (sp.type === 'biped' ? 0.55 : 0.1);
    const hz = front + sp.neck * 0.35;
    if (sp.type !== 'blob' && sp.neck > 0.3) mb.add(new THREE.CylinderGeometry(0.14, 0.22, sp.neck, 6), P, { p: [0, (bodyY + hy) / 2, (front + hz) / 2 - 0.1], r: [0.9, 0, 0] });
    const hs = sp.head;
    if (sp.type !== 'blob') mb.add(new THREE.SphereGeometry(hs * 0.55, 9, 7), P, { p: [0, hy, hz] });
    mb.add(new THREE.SphereGeometry(hs * 0.3, 7, 5), S, { p: [0, hy - hs * 0.12, hz + hs * 0.35 + sp.snout * 0.3], s: [1, 0.8, 1 + sp.snout] });
    for (const sx of [-1, 1]) {
      mb.add(new THREE.SphereGeometry(hs * 0.16, 7, 5), [0.98, 0.98, 0.95], { p: [sx * hs * 0.27, hy + hs * 0.15, hz + hs * 0.36] });
      mb.add(new THREE.SphereGeometry(hs * 0.09, 6, 4), A, { p: [sx * hs * 0.29, hy + hs * 0.16, hz + hs * 0.48] }, { emissive: true });
      if (sp.ears) mb.add(new THREE.ConeGeometry(hs * 0.14, hs * 0.6, 4), P, { p: [sx * hs * 0.32, hy + hs * 0.5, hz - hs * 0.05], r: [-0.3, 0, sx * -0.5] });
      if (sp.horns) mb.add(new THREE.ConeGeometry(hs * 0.08, hs * 0.7, 5), [0.9, 0.86, 0.75], { p: [sx * hs * 0.18, hy + hs * 0.55, hz + hs * 0.1], r: [0.4, 0, sx * -0.35] });
    }
  }
  const body = new THREE.Mesh(mb.build(), material);

  // legs: pivot at the hip, hanging down
  const legGeo = new MeshBuilder();
  if (sp.type === 'quad' || sp.type === 'hexa' || sp.type === 'biped') {
    const thick = sp.type === 'biped' ? 0.16 : sp.type === 'hexa' ? 0.06 : 0.11;
    legGeo.add(new THREE.CylinderGeometry(thick * 1.3, thick, L, 5), P, { p: [0, -L / 2, 0] });
    legGeo.add(new THREE.SphereGeometry(thick * 1.5, 5, 4), S, { p: [0, -L, 0.04] });
    const lg = legGeo.build();
    const spots = [];
    const len = sp.type === 'hexa' ? bl * 1.3 : bl;
    if (sp.type === 'quad') for (const z of [0.32, -0.32]) for (const x of [-1, 1]) spots.push([x * bw * 0.32, z * len]);
    if (sp.type === 'hexa') for (const z of [0.35, 0, -0.35]) for (const x of [-1, 1]) spots.push([x * bw * 0.45, z * len]);
    if (sp.type === 'biped') for (const x of [-1, 1]) spots.push([x * bw * 0.3, -0.05]);
    spots.forEach(([x, z], i) => {
      const leg = new THREE.Mesh(lg, material);
      leg.position.set(x, hipY + 0.05, z);
      if (sp.type === 'hexa') leg.rotation.z = x > 0 ? 0.5 : -0.5;
      leg.userData.phase = (i % 2 ? Math.PI : 0) + (sp.type === 'hexa' ? Math.floor(i / 2) * 2.1 : Math.floor(i / 2) * Math.PI);
      legs.push(leg);
    });
  }
  const wings = [];
  if (sp.type === 'flyer') {
    const wb = new MeshBuilder();
    wb.add(new THREE.BoxGeometry(1.6, 0.05, 0.7), S, { p: [0.8, 0, 0] });
    wb.add(new THREE.BoxGeometry(0.9, 0.05, 0.45), A, { p: [1.8, 0, -0.1] });
    const wg = wb.build();
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(wg, material);
      w.scale.x = sx;
      w.position.set(sx * 0.2, 0.08, 0);
      wings.push(w);
    }
    // head for flyer
    const hb = new MeshBuilder();
    hb.add(new THREE.SphereGeometry(0.28, 7, 5), P, { p: [0, 0.08, 0.85] });
    hb.add(new THREE.ConeGeometry(0.08, 0.4, 4), [1, 0.8, 0.3], { p: [0, 0.05, 1.2], r: [Math.PI / 2, 0, 0] });
    hb.add(new THREE.SphereGeometry(0.06, 5, 4), A, { p: [0.12, 0.15, 1.02] }, { emissive: true });
    hb.add(new THREE.SphereGeometry(0.06, 5, 4), A, { p: [-0.12, 0.15, 1.02] }, { emissive: true });
    wings.push(new THREE.Mesh(hb.build(), material));
  }
  return { body, legs, wings, hipY };
}

export class Fauna {
  constructor(game, planet, quality) {
    this.game = game;
    this.planet = planet;
    this.group = new THREE.Group();
    planet.group.add(this.group);
    this.material = makeObjectMaterial(game.objAtmo, { spec: 0.25 });
    const dens = planet.params.fauna.density;
    this.max = Math.round((quality.fauna || 8) * dens);
    const rng = new Rng(hashInts(planet.params.seed, 999));
    const nSpecies = dens > 0 ? rng.int(2, 4) : 0;
    this.species = [];
    for (let i = 0; i < nSpecies; i++) {
      const sp = makeSpecies(planet, i);
      const key = `${game.starId}|${planet.params.index}|fauna|${i}`;
      sp.known = !!game.discovered.species[key];
      this.species.push(sp);
    }
    this.list = [];
    this.spawnT = 0;
    this.rng = new Rng((Math.random() * 1e9) | 0);
  }

  _groundOk(dir) {
    const fl = floorAt(this.planet, dir);
    return !fl.liquid;
  }

  _spawnHerd(playerLocal) {
    if (!this.species.length) return;
    const rng = this.rng;
    const sp = rng.pick(this.species);
    const up = _v.copy(playerLocal).normalize();
    const t1 = new THREE.Vector3(0, 1, 0).cross(up);
    if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
    t1.normalize();
    const t2 = new THREE.Vector3().crossVectors(up, t1);
    const ang = rng.range(0, Math.PI * 2);
    const dist = rng.range(45, 110);
    const center = playerLocal.clone().addScaledVector(t1, Math.cos(ang) * dist).addScaledVector(t2, Math.sin(ang) * dist);
    for (let i = 0; i < sp.herd && this.list.length < this.max; i++) {
      const p = center.clone().addScaledVector(t1, rng.range(-8, 8)).addScaledVector(t2, rng.range(-8, 8));
      const d = p.clone().normalize();
      if (sp.type !== 'flyer' && !this._groundOk(d)) continue;
      this._spawn(sp, d, t1.clone().applyAxisAngle(d, rng.range(0, 6.28)));
    }
  }

  _template(sp) {
    if (!sp.templ) sp.templ = buildSpeciesMeshes(sp, this.material);
    const t = sp.templ;
    return { body: t.body.clone(), legs: t.legs.map((l) => l.clone()), wings: t.wings.map((w) => w.clone()), hipY: t.hipY };
  }

  _spawn(sp, dir, heading) {
    const meshes = this._template(sp);
    const g = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(meshes.body, ...meshes.legs, ...meshes.wings);
    inner.scale.setScalar(sp.size);
    g.add(inner);
    this.group.add(g);
    const p = this.planet;
    const r = p.surfaceRadius(dir.x, dir.y, dir.z);
    const c = {
      species: sp,
      group: g,
      inner,
      meshes,
      pos: dir.clone().multiplyScalar(r + (sp.type === 'flyer' ? this.rng.range(18, 40) : 0)),
      heading: heading.clone().addScaledVector(dir, -heading.dot(dir)).normalize(),
      state: 'idle',
      timer: this.rng.range(0.5, 3),
      phase: this.rng.range(0, 6),
      speed: 0,
      hop: 0,
      flyAlt: this.rng.range(18, 45),
      flyTurn: this.rng.range(0.25, 0.5) * this.rng.sign(),
      callT: this.rng.range(4, 14),
    };
    this.list.push(c);
    return c;
  }

  _despawn(c) {
    c.group.removeFromParent();
  }

  update(dt, playerLocal) {
    if (!this.species.length) return;
    this.spawnT -= dt;
    if (this.list.length < this.max && this.spawnT <= 0) {
      this.spawnT = 1.2;
      this._spawnHerd(playerLocal);
    }
    const p = this.planet;
    const rng = this.rng;
    const g = this.game;
    const onFoot = g.mode === 'foot';
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      const sp = c.species;
      const up = _v.copy(c.pos).normalize();
      const toPlayer = _v2.copy(playerLocal).sub(c.pos);
      const dist = toPlayer.length();
      if (dist > 230) {
        this._despawn(c);
        this.list.splice(i, 1);
        continue;
      }
      toPlayer.addScaledVector(up, -toPlayer.dot(up));
      c.timer -= dt;

      if (sp.type === 'flyer') {
        c.heading.applyAxisAngle(up, c.flyTurn * dt).addScaledVector(up, -c.heading.dot(up)).normalize();
        c.pos.addScaledVector(c.heading, sp.speed * 5 * dt);
        const d = _d.copy(c.pos).normalize();
        const ground = p.R + Math.max(0, p.sampler.height(d.x, d.y, d.z));
        c.pos.copy(d).multiplyScalar(ground + c.flyAlt + Math.sin(c.phase * 0.3) * 3);
        c.phase += dt * 7;
        c.meshes.wings[0].rotation.z = Math.sin(c.phase) * 0.7;
        c.meshes.wings[1].rotation.z = -Math.sin(c.phase) * 0.7;
      } else {
        // behavior
        const scared = onFoot && dist < (sp.behavior === 'skittish' ? 22 : 11) && sp.behavior !== 'curious';
        const laserScare = g.mining.firing && dist < 30;
        if (scared || laserScare) {
          c.state = 'flee';
          c.timer = 2.5;
          c.heading.copy(toPlayer).negate().normalize();
        } else if (onFoot && sp.behavior === 'curious' && dist < 30 && dist > 5 && c.state !== 'flee') {
          c.state = 'approach';
          c.heading.copy(toPlayer).normalize();
          c.timer = Math.max(c.timer, 0.5);
        } else if (c.timer <= 0) {
          if (c.state === 'walk' || c.state === 'flee' || c.state === 'approach') {
            c.state = 'idle';
            c.timer = rng.range(1.5, 5);
          } else {
            c.state = 'walk';
            c.timer = rng.range(2, 7);
            c.heading.applyAxisAngle(up, rng.range(-2, 2));
          }
        }
        if (c.state === 'approach' && dist < 5) { c.state = 'idle'; c.timer = 3; }
        const want = c.state === 'flee' ? sp.speed * 2.6 : c.state === 'walk' || c.state === 'approach' ? sp.speed : 0;
        c.speed += (want - c.speed) * Math.min(1, dt * 4);
        c.heading.addScaledVector(up, -c.heading.dot(up)).normalize();
        if (c.speed > 0.05) {
          const next = _v2.copy(c.pos).addScaledVector(c.heading, c.speed * dt);
          const nd = _n.copy(next).normalize();
          if (!this._groundOk(nd)) {
            c.heading.negate();
            c.timer = rng.range(1, 3);
          } else {
            c.pos.copy(next);
          }
        }
        const d = _d.copy(c.pos).normalize();
        const ground = p.R + p.sampler.height(d.x, d.y, d.z);
        c.phase += dt * c.speed * (2.6 / Math.sqrt(sp.size));
        let lift = 0;
        if (sp.type === 'blob') {
          lift = c.speed > 0.2 ? Math.abs(Math.sin(c.phase * 0.9)) * 0.9 * sp.size : 0;
          const sq = 1 + (c.speed > 0.2 ? Math.sin(c.phase * 1.8) * 0.12 : Math.sin(G_time() * 3) * 0.03);
          c.inner.scale.set(sp.size / Math.sqrt(sq), sp.size * sq, sp.size / Math.sqrt(sq));
        }
        c.pos.copy(d).multiplyScalar(ground + lift);
        const swing = Math.min(1, c.speed / sp.speed) * 0.6;
        for (const leg of c.meshes.legs) leg.rotation.x = Math.sin(c.phase + leg.userData.phase) * swing;
        c.meshes.body.position.y = Math.abs(Math.sin(c.phase)) * 0.04 * swing;
      }

      // orient: +Y up, +Z heading
      const z = c.heading;
      const x = _x.crossVectors(up, z).normalize();
      _m.makeBasis(x, up, z);
      _q.setFromRotationMatrix(_m);
      c.group.quaternion.slerp(_q, Math.min(1, dt * 6));
      c.group.position.copy(c.pos);

      c.callT -= dt;
      if (c.callT <= 0) {
        c.callT = rng.range(6, 16);
        if (dist < 50) g.audio.creature(sp.seed, sp.size, 1 - dist / 50);
      }
    }
  }

  raycast(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const c of this.list) {
      const r = c.species.size * 1.1;
      _v.copy(c.pos).addScaledVector(_v2.copy(c.pos).normalize(), r);
      const ox = origin.x - _v.x, oy = origin.y - _v.y, oz = origin.z - _v.z;
      const b = ox * dir.x + oy * dir.y + oz * dir.z;
      const cc = ox * ox + oy * oy + oz * oz - r * r;
      const disc = b * b - cc;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < bestT) { bestT = t; best = c; }
    }
    return best ? { c: best, t: bestT } : null;
  }

  speciesNear(pos, radius) {
    const out = new Set();
    for (const c of this.list) if (c.pos.distanceTo(pos) < radius) out.add(c.species);
    return [...out];
  }

  dispose() {
    for (const c of this.list) this._despawn(c);
    this.list = [];
    for (const sp of this.species) {
      const t = sp.templ;
      if (!t) continue;
      t.body.geometry.dispose();
      for (const m of [...t.legs, ...t.wings]) m.geometry.dispose();
    }
    this.material.dispose();
    this.group.removeFromParent();
  }
}

function G_time() {
  return performance.now() * 0.001;
}
