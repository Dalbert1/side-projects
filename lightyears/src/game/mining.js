// Multitool mining beam, the scanner pulse, resource markers, and the ship's cannons.

import * as THREE from 'three';
import { RESOURCES } from './inventory.js';
import { speciesName } from '../core/names.js';
import { hashInts } from '../core/rng.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export class Mining {
  constructor(game) {
    this.game = game;
    this.heat = 0;
    this.overheated = 0;
    this.target = null;
    this.firing = false;
    this.scanCooldown = 0;
    this.scanned = [];
    this.scanUntil = 0;
    this.shipCooldown = 0;
    this.shipSide = 1;
    this.sparkT = 0;
  }

  stop() {
    this.firing = false;
    this.game.beams?.setMining(null);
    this.game.audio?.laser(false);
    this.target = null;
  }

  updateFoot(dt, wantFire) {
    const g = this.game;
    const surf = g.surface;
    const player = g.player;
    const planet = player.planet;
    const inv = g.inv;
    const lvl = inv.upgrades.laser;
    this.scanCooldown = Math.max(0, this.scanCooldown - dt);

    // aim ray in planet local space
    const eyeLocal = _v.copy(player.eyeWorld).sub(planet.pos);
    const dir = _dir.copy(player.lookWorld);
    let hit = surf ? surf.raycast(eyeLocal, dir, 34) : null;
    const creature = g.fauna ? g.fauna.raycast(eyeLocal, dir, 40) : null;
    if (creature && (!hit || creature.t < hit.t)) hit = null;
    this.target = hit;
    if (hit) {
      const info = surf.info(hit.obj);
      g.hud.setTarget({ name: RESOURCES[info.res].name, hp: hit.obj.hp / hit.obj.maxHp });
    } else if (creature) {
      g.hud.setTarget({ name: creature.c.species.known ? creature.c.species.name : 'Unknown creature', hp: 1 });
    } else g.hud.setTarget(null);

    // heat
    if (this.overheated > 0) {
      this.overheated -= dt;
      wantFire = false;
      if (this.overheated <= 0) this.heat = 0.5;
    }
    const firing = wantFire;
    if (firing) {
      this.heat += dt * (0.16 - lvl * 0.03);
      if (this.heat >= 1) {
        this.heat = 1;
        this.overheated = 2.2;
        g.hud.toast('Mining beam overheated', 'warn');
        g.audio.sfx('overheat');
      }
    } else this.heat = Math.max(0, this.heat - dt * 0.45);
    g.hud.setHeat(this.heat, this.overheated > 0);

    if (firing !== this.firing) {
      this.firing = firing;
      g.audio.laser(firing);
    }
    if (!firing) {
      g.beams.setMining(null);
      return;
    }

    // beam from the tool (low right of view) to the hit point or into the distance
    const up = player.up;
    const right = _v2.crossVectors(player.lookWorld, up).normalize();
    const muzzle = player.eyeWorld.clone().addScaledVector(right, 0.32).addScaledVector(up, -0.28).addScaledVector(player.lookWorld, 0.7);
    let end;
    if (hit) end = player.eyeWorld.clone().addScaledVector(player.lookWorld, hit.t);
    else {
      // find the ground along the ray
      let t = 34;
      for (let s = 0.5; s < 34; s += 0.5) {
        _v.copy(player.eyeWorld).addScaledVector(player.lookWorld, s).sub(planet.pos);
        if (planet.altitudeOf(_v) < 0) { t = s; break; }
      }
      end = player.eyeWorld.clone().addScaledVector(player.lookWorld, t);
    }
    const res = hit ? RESOURCES[surf.info(hit.obj).res] : null;
    const color = res ? hexToRgb(res.color) : [1, 0.6, 0.25];
    g.beams.setMining(muzzle, end, color);
    this.sparkT -= dt;
    if (this.sparkT <= 0) {
      this.sparkT = 0.05;
      g.particles.burst(end, color, 3, 4, 0.25, 0.5, up);
    }

    if (hit) {
      const o = hit.obj;
      const power = 1 + lvl * 0.45;
      o.hp -= dt * power;
      surf.shake(o, 0.12);
      if (o.hp <= 0) {
        const info = surf.info(o);
        const [a, b] = info.yield;
        const amount = Math.round((a + Math.random() * (b - a)) * (0.7 + o.scale * 0.35));
        const got = inv.add(info.res, amount);
        const center = new THREE.Vector3();
        surf.hitSphere(o, center);
        center.add(planet.pos);
        g.particles.burst(center, color, 26, 7, 0.45, 0.9, up);
        surf.remove(o);
        if (got > 0) {
          g.hud.toast(`+${got} ${RESOURCES[info.res].name}`, 'res', 0);
          g.audio.sfx('collect');
        } else {
          g.hud.toast(`${RESOURCES[info.res].name} storage full`, 'warn');
        }
        g.objectives.event('mined', info.res);
      }
    }
  }

  scan() {
    const g = this.game;
    if (this.scanCooldown > 0) {
      g.hud.toast(`Scanner recharging ${Math.ceil(this.scanCooldown)}s`, '', 1000);
      return;
    }
    this.scanCooldown = 6;
    g.audio.sfx('scan');
    const player = g.player;
    const planet = player.planet;
    // visual pulse
    g.scanPulse?.(player.eyeWorld);
    this.scanned = [];
    if (g.surface) {
      for (const o of g.surface.nearby(player.pos, 110)) {
        const info = g.surface.info(o);
        if (info.cat === 'mineral' || info.cat === 'plant' || g.surface.kindOf(o) === 'boulder') this.scanned.push(o);
      }
    }
    this.scanUntil = performance.now() + 22000;
    const counts = {};
    for (const o of this.scanned) {
      const r = g.surface.info(o).res;
      counts[r] = (counts[r] || 0) + 1;
    }
    const summary = Object.entries(counts).map(([r, n]) => `${n} ${RESOURCES[r].name}`).join(', ');
    g.hud.toast(summary ? `Scan: ${summary}` : 'Scan: no deposits nearby', '', 0);

    // flora and fauna discoveries
    const discovered = g.discovered.species;
    const found = [];
    if (g.surface) {
      const kinds = new Set();
      for (const o of g.surface.nearby(player.pos, 70)) {
        const info = g.surface.info(o);
        if (info.cat === 'tree' || info.cat === 'bush' || info.cat === 'plant') kinds.add(g.surface.kindOf(o));
      }
      for (const k of kinds) {
        const id = `${g.starId}|${planet.params.index}|flora|${k}`;
        if (discovered[id]) continue;
        const name = speciesName(hashInts(planet.params.seed, k.length * 97 + k.charCodeAt(0), 3));
        discovered[id] = name;
        found.push({ kicker: 'Flora discovered', name, reward: 180 });
      }
    }
    if (g.fauna) {
      for (const sp of g.fauna.speciesNear(player.pos, 90)) {
        const id = `${g.starId}|${planet.params.index}|fauna|${sp.index}`;
        sp.known = true;
        if (discovered[id]) continue;
        discovered[id] = sp.name;
        found.push({ kicker: 'Fauna discovered', name: sp.name, reward: 450 });
      }
    }
    for (const f of found.slice(0, 3)) {
      g.inv.units += f.reward;
      g.hud.discovery(f.kicker, f.name, `+${f.reward} units`, 2600);
    }
    if (found.length) g.audio.sfx('discover');
    g.objectives.event('scanned');
  }

  addMarkers(list) {
    const g = this.game;
    if (g.mode !== 'foot' || !g.surface || performance.now() > this.scanUntil) return;
    const planet = g.player.planet;
    let n = 0;
    for (const o of this.scanned) {
      if (o.dead) continue;
      if (n++ > 24) break;
      const info = g.surface.info(o);
      const res = RESOURCES[info.res];
      const pos = new THREE.Vector3().copy(o.pos).addScaledVector(o.up, info.height * o.scale + 0.8).add(planet.pos);
      list.push({ id: `r:${o.id}`, pos, kind: 'res', symbol: res.sym, color: res.color });
    }
  }

  // ---- ship cannons -------------------------------------------------------

  updateShipWeapons(dt, firing) {
    const g = this.game;
    const ship = g.ship;
    this.shipCooldown -= dt;
    if (!firing || this.shipCooldown > 0 || ship.pulseOn) return;
    this.shipCooldown = 0.11;
    ship.axes();
    this.shipSide *= -1;
    const start = ship.pos.clone().addScaledVector(ship.left, 1.35 * this.shipSide).addScaledVector(ship.forward, 4).addScaledVector(ship.up, -0.2);
    const dir = ship.forward.clone();
    const speed = 900 + ship.speed;
    g.beams.fire(start, dir, speed, [1.0, 0.45, 0.2], 1.4);
    g.audio.sfx('shoot');
    g.asteroids?.registerBolt(g.beams.bolts[g.beams.bolts.length - 1]);
  }
}
