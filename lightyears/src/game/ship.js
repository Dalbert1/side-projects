// Ship flight: arcade handling with throttle, boost, pulse drive, terrain avoidance,
// and autopilot sequences for landing, launching, and docking.

import * as THREE from 'three';
import { makeShip } from '../render/shipModel.js';

const FWD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const LEFT = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// Landing gear pads (ship local x, z) and the height of their feet
const PADS = [[0, 2.6], [-1.6, -2.6], [1.6, -2.6]];
const PAD_Y = -2.17;
// Low points of the hull (x, z, y) that must stay above the ground when landed
const HULL = [
  [0, 6.9, -0.2], [0, 3.8, -0.95], [0, 2.4, -1.05], [0, -3.0, -1.05],
  [1.35, -5.1, -0.8], [-1.35, -5.1, -0.8], [4.8, -1.9, -0.45], [-4.8, -1.9, -0.45],
  [3.0, -1.2, -0.35], [-3.0, -1.2, -0.35],
];
const MAX_TILT = 0.2; // about 11 degrees

export class Ship {
  constructor(game) {
    this.game = game;
    const model = makeShip(game.objAtmo);
    this.model = model;
    this.group = model.group;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.speed = 0;
    this.pitchRate = 0;
    this.yawRate = 0;
    this.bank = 0;
    this.state = 'flying';
    this.pulse = 0; // 0..1 spool
    this.pulseOn = false;
    this.anim = null;
    this.drillSpin = 0;
    this.shake = 0;
    this.inAtmo = false;
    this.altitude = Infinity;
    this.forward = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.left = new THREE.Vector3(1, 0, 0);
    this.hitCooldown = 0;
  }

  get stats() {
    const u = this.game.inv.upgrades;
    return {
      maxSpeed: 230 + u.engine * 40,
      boostSpeed: 620 + u.engine * 120,
      pulseSpeed: 5200 + u.pulse * 1800,
    };
  }

  axes() {
    this.forward.copy(FWD).applyQuaternion(this.quat);
    this.up.copy(UP).applyQuaternion(this.quat);
    this.left.copy(LEFT).applyQuaternion(this.quat);
  }

  // How the ship would sit if landed at planet-local direction `dirLocal`, nose along
  // `heading`: the pads are fitted to the ground (tilting on gentle slopes) and the
  // whole ship is raised if any part of the hull would otherwise dip into a bump.
  landingPose(planet, dirLocal, heading) {
    const up0 = dirLocal.clone().normalize();
    const f0 = heading ? heading.clone() : new THREE.Vector3(1, 0, 0);
    f0.addScaledVector(up0, -f0.dot(up0));
    if (f0.lengthSq() < 1e-6) f0.set(1, 0, 0).addScaledVector(up0, -up0.x);
    if (f0.lengthSq() < 1e-6) f0.set(0, 0, 1).addScaledVector(up0, -up0.z);
    f0.normalize();
    const l0 = new THREE.Vector3().crossVectors(up0, f0);
    const base = up0.clone().multiplyScalar(planet.R);
    const sampler = planet.sampler;
    const liquid = planet.params.liquid;
    const tmp = new THREE.Vector3();
    let wet = false;
    let lava = false;
    const ground = (x, z) => {
      tmp.copy(base).addScaledVector(l0, x).addScaledVector(f0, z).normalize();
      const h = sampler.height(tmp.x, tmp.y, tmp.z);
      if (liquid && h < 0) {
        wet = true;
        if (liquid === 'lava') lava = true;
        return 0; // liquids are flat at sea level
      }
      return h;
    };
    // plane through the three pads, in the tangent frame (x = left, y = up, z = forward)
    const P = PADS.map(([x, z]) => new THREE.Vector3(x, ground(x, z), z));
    const n = new THREE.Vector3().crossVectors(P[1].clone().sub(P[0]), P[2].clone().sub(P[0]));
    if (n.y < 0) n.negate();
    n.normalize();
    const tiltRaw = Math.acos(Math.min(1, n.y));
    if (tiltRaw > MAX_TILT) {
      const k = Math.sin(MAX_TILT) / Math.max(1e-6, Math.hypot(n.x, n.z));
      n.set(n.x * k, Math.cos(MAX_TILT), n.z * k);
    }
    const up = new THREE.Vector3().addScaledVector(l0, n.x).addScaledVector(up0, n.y).addScaledVector(f0, n.z).normalize();
    const fwd = f0.clone().addScaledVector(up, -f0.dot(up)).normalize();
    const left = new THREE.Vector3().crossVectors(up, fwd);
    // lowest height (above the base radius) that keeps every point clear of the ground
    const off = new THREE.Vector3();
    const need = (x, y, z, margin) => {
      off.set(0, 0, 0).addScaledVector(left, x).addScaledVector(up, y).addScaledVector(fwd, z);
      const yt = off.dot(up0);
      return ground(off.dot(l0), off.dot(f0)) + margin - yt;
    };
    let H = -Infinity;
    for (const [x, z] of PADS) H = Math.max(H, need(x, PAD_Y, z, 0.03));
    let hull = -Infinity;
    for (const [x, z, y] of HULL) hull = Math.max(hull, need(x, y, z, 0.15));
    const raise = Math.max(0, hull - H);
    H += raise;
    _m.makeBasis(left, up, fwd);
    const quat = new THREE.Quaternion().setFromRotationMatrix(_m);
    const pos = up0.multiplyScalar(planet.R + H).add(planet.pos);
    const score = raise + Math.max(0, tiltRaw - MAX_TILT) * 8 + (wet ? 6 : 0) + (lava ? 1000 : 0);
    return { planet, dir: dirLocal.clone().normalize(), heading: fwd.clone(), pos, quat, raise, tiltRaw, wet, lava, score };
  }

  // Search rings around `originDir` for a spot to set down. Takes the closest good dry
  // site; otherwise the least bad one (a raised ship on bumpy ground, or floating on
  // water). Never lava.
  findLandingSite(planet, originDir, heading, rings = [0, 15, 30, 50, 80, 120, 170, 240]) {
    const up0 = originDir.clone().normalize();
    const f0 = heading.clone().addScaledVector(up0, -heading.dot(up0));
    if (f0.lengthSq() < 1e-6) f0.set(1, 0, 0).addScaledVector(up0, -up0.x);
    f0.normalize();
    const s0 = new THREE.Vector3().crossVectors(f0, up0);
    const cand = new THREE.Vector3();
    let best = null;
    for (const dist of rings) {
      const count = dist === 0 ? 1 : Math.min(16, 6 + Math.round(dist / 20));
      for (let a = 0; a < count; a++) {
        const ang = (a / count) * Math.PI * 2;
        cand.copy(up0).multiplyScalar(planet.R).addScaledVector(f0, Math.cos(ang) * dist).addScaledVector(s0, Math.sin(ang) * dist);
        const pose = this.landingPose(planet, cand, heading);
        if (pose.lava) continue;
        if (!pose.wet && pose.raise < 0.3 && pose.tiltRaw < 0.24) return pose;
        if (!best || pose.score < best.score) best = pose;
      }
    }
    return best;
  }

  // Put the ship down (instantly) at a pose from landingPose, or compute one here
  placeLanded(planet, dirLocal, heading, pose = null) {
    const g = this.game;
    const p = pose || this.landingPose(planet, dirLocal, heading);
    this.pos.copy(p.pos);
    this.quat.copy(p.quat);
    this.state = 'landed';
    this.speed = 0;
    this.vel.set(0, 0, 0);
    this.model.gear.visible = true;
    this.landedPlanet = planet;
    this.bank = 0;
    this.syncModel();
    g.input.setThrottle(0);
  }

  _orient(forward, up) {
    // build a basis with +Z = forward, +Y = up
    const z = forward.clone().normalize();
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    _m.makeBasis(x, y, z);
    this.quat.setFromRotationMatrix(_m);
  }

  update(dt, input) {
    const g = this.game;
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.axes();
    const planet = g.nearest;
    this.inAtmo = !!(planet && planet.params.atmo && g.nearestDist < planet.params.atmo.radius);
    if (planet) {
      _v.copy(this.pos).sub(planet.pos);
      this.altitude = planet.altitudeOf(_v);
    } else this.altitude = Infinity;

    if (this.anim) {
      this._runAnim(dt);
    } else if (this.state === 'flying') {
      this._fly(dt, input);
    }

    this.drillSpin += dt * (1 + this.speed * 0.04 + (this.pulseOn ? 30 : 0));
    this.model.drill.rotation.z = this.drillSpin;
    const power = this.state === 'landed' ? 0.05 : Math.min(1.5, 0.25 + this.speed / 300 + (this.pulseOn ? 1 : 0));
    this.model.glowMat.uniforms.uPower.value += (power - this.model.glowMat.uniforms.uPower.value) * Math.min(1, dt * 6);

    this.syncModel();
  }

  // Put the visible model where the ship is (with the visual-only bank)
  syncModel() {
    this.group.position.copy(this.pos);
    _q.setFromAxisAngle(FWD, this.bank);
    this.group.quaternion.copy(this.quat).multiply(_q);
  }

  _fly(dt, input) {
    const g = this.game;
    const st = this.stats;
    const planet = g.nearest;
    const inAtmo = this.inAtmo;
    const invert = g.settings.invertY ? -1 : 1;

    // throttle: keyboard nudges it, touch sets it with the slider
    if (input.keys.has('KeyW')) input.setThrottle(input.throttle + dt * 0.8);
    if (input.keys.has('KeyS')) input.setThrottle(input.throttle - dt * 0.8);

    // steering: stick, plus mouse or right-side drag
    const look = input.consumeLook();
    let pitchIn = -input.stick.y * invert;
    let yawIn = input.stick.x;
    if (input.keys.has('ArrowUp')) pitchIn -= invert;
    if (input.keys.has('ArrowDown')) pitchIn += invert;
    if (input.keys.has('ArrowLeft') || input.keys.has('KeyA')) yawIn -= 1;
    if (input.keys.has('ArrowRight') || input.keys.has('KeyD')) yawIn += 1;
    pitchIn += -look.y * 0.012 * invert;
    yawIn += look.x * 0.012;
    pitchIn = THREE.MathUtils.clamp(pitchIn, -1, 1);
    yawIn = THREE.MathUtils.clamp(yawIn, -1, 1);

    const turnScale = this.pulseOn ? 0.35 : 1;
    const maxPitch = 1.35 * turnScale;
    const maxYaw = 1.05 * turnScale;
    const resp = 1 - Math.exp(-dt * 5);
    this.pitchRate += (pitchIn * maxPitch - this.pitchRate) * resp;
    this.yawRate += (-yawIn * maxYaw - this.yawRate) * resp;

    _q.setFromAxisAngle(LEFT, -this.pitchRate * dt);
    this.quat.multiply(_q);
    _q.setFromAxisAngle(UP, this.yawRate * dt);
    this.quat.multiply(_q);
    this.bank += (-this.yawRate * 0.55 - this.bank) * Math.min(1, dt * 3);

    this.axes();

    // auto level inside an atmosphere: roll the ship's up toward the planet's up
    if (planet && (inAtmo || this.altitude < 1500)) {
      _v.copy(this.pos).sub(planet.pos).normalize();
      _v2.copy(_v).addScaledVector(this.forward, -_v.dot(this.forward));
      if (_v2.lengthSq() > 1e-4) {
        _v2.normalize();
        const cur = this.up.dot(_v2);
        const side = this.left.dot(_v2);
        const ang = Math.atan2(side, cur);
        _q.setFromAxisAngle(FWD, -ang * Math.min(1, dt * 2.2));
        this.quat.multiply(_q);
        this.axes();
      }
    }

    // speed
    const boosting = (input.held.has('boost') || input.held.has('jump')) && !this.pulseOn;
    this.boosting = boosting;
    const minSpeed = inAtmo ? 28 : 0;
    const maxSpeed = inAtmo ? Math.min(st.maxSpeed, 150) : st.maxSpeed;
    let target = minSpeed + (maxSpeed - minSpeed) * input.throttle;
    if (boosting) target = inAtmo ? 300 : st.boostSpeed;
    if (input.held.has('brake')) target = minSpeed;

    // pulse drive
    const canPulse = g.pulseAllowed;
    if (this.pulseOn) {
      if (!canPulse) {
        this.pulseOn = false;
        g.hud.toast('Pulse drive disengaged', 'warn');
        g.audio?.pulseStop();
        this.speed = Math.min(this.speed, st.boostSpeed);
      } else {
        this.pulse = Math.min(1, this.pulse + dt * 0.8);
        target = st.pulseSpeed * this.pulse;
      }
    } else this.pulse = 0;

    const accel = this.pulseOn ? 3000 : boosting ? 380 : 120;
    const decel = this.pulseOn ? 3000 : 260;
    if (this.speed < target) this.speed = Math.min(target, this.speed + accel * dt);
    else this.speed = Math.max(target, this.speed - decel * dt * (this.speed > 1000 ? 6 : 1));

    // limit the speed based on how close the ground is (keeps LOD happy and crashes survivable)
    if (planet && this.altitude < 400 && !this.pulseOn) {
      const cap = 90 + this.altitude * 1.2 + (boosting ? 120 : 0);
      if (this.speed > cap) this.speed += (cap - this.speed) * Math.min(1, dt * 2);
    }

    const want = _v3.copy(this.forward).multiplyScalar(this.speed);
    this.vel.lerp(want, 1 - Math.exp(-dt * (this.pulseOn ? 8 : 3.5)));

    // terrain avoidance: pull up when a dive would hit the ground soon
    if (planet) {
      _v.copy(this.pos).sub(planet.pos);
      const upv = _v2.copy(_v).normalize();
      const vDown = -this.vel.dot(upv);
      const alt = this.altitude;
      if (vDown > 0 && alt < 80) {
        const tHit = alt / Math.max(vDown, 1);
        if (tHit < 1.4) {
          const urgency = THREE.MathUtils.clamp((1.4 - tHit) / 1.4, 0, 1);
          // rotate nose toward the horizon
          const fwdUp = this.forward.dot(upv);
          if (fwdUp < 0.15) {
            _q.setFromAxisAngle(LEFT, -urgency * 2.2 * dt);
            this.quat.multiply(_q);
          }
          this.vel.addScaledVector(upv, vDown * urgency * Math.min(1, dt * 6));
        }
      }
    }

    this.pos.addScaledVector(this.vel, dt);
    this._collide(dt);
  }

  _collide(dt) {
    const g = this.game;
    const planet = g.nearest;
    if (planet) {
      _v.copy(this.pos).sub(planet.pos);
      const len = _v.length();
      _v2.copy(_v).divideScalar(len);
      const ground = planet.surfaceRadius(_v2.x, _v2.y, _v2.z);
      const clearance = 3.2;
      if (len < ground + clearance) {
        const into = -this.vel.dot(_v2);
        this.pos.copy(_v2).multiplyScalar(ground + clearance).add(planet.pos);
        if (into > 0) this.vel.addScaledVector(_v2, into * 1.2);
        if (into > 35 && this.hitCooldown <= 0) {
          this.hitCooldown = 1.2;
          g.damageShip(Math.min(35, into * 0.25));
          this.shake = 1;
          this.speed *= 0.5;
        }
      }
    }
    const st = g.station;
    if (st && !this.anim) {
      _v.copy(this.pos).sub(st.pos);
      const d = _v.length();
      const r = st.radius;
      if (d < r) {
        _v.divideScalar(d || 1);
        this.pos.copy(st.pos).addScaledVector(_v, r);
        const into = -this.vel.dot(_v);
        if (into > 0) this.vel.addScaledVector(_v, into * 1.5);
        this.speed *= 0.4;
        if (into > 30 && this.hitCooldown <= 0) {
          this.hitCooldown = 1.2;
          g.damageShip(10);
          this.shake = 0.8;
        }
      }
    }
  }

  // ---- autopilot sequences -------------------------------------------------

  startAnim(kind, data) {
    this.anim = { kind, t: 0, ...data };
    this.pulseOn = false;
  }

  _runAnim(dt) {
    const a = this.anim;
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    const e = ease(k);
    if (a.kind === 'land' || a.kind === 'launch' || a.kind === 'dock' || a.kind === 'undock' || a.kind === 'summon') {
      this.pos.lerpVectors(a.fromPos, a.toPos, a.kind === 'launch' ? k * (2 - k) : e);
      if (a.arc) this.pos.addScaledVector(a.up, Math.sin(Math.PI * k) * a.arc);
      if (a.kind === 'summon' && k > 0.8) this.model.gear.visible = true;
      this.quat.slerpQuaternions(a.fromQuat, a.toQuat, Math.min(1, e * 1.4));
      this.speed = a.fromPos.distanceTo(a.toPos) / a.dur;
      this.bank *= 1 - Math.min(1, dt * 3);
      if (a.kind === 'land' && k > 0.55) this.model.gear.visible = true;
      if (a.kind === 'launch' && k > 0.3) this.model.gear.visible = false;
    }
    if (k >= 1) {
      const done = a.onDone;
      this.anim = null;
      this.axes();
      done?.();
    }
  }
}
