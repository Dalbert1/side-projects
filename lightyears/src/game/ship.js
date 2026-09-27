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
    this.boostEnergy = 1;
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

  // Place the ship landed at planet-local point on `planet`
  placeLanded(planet, dirLocal, heading) {
    const g = this.game;
    const d = dirLocal.clone().normalize();
    const r = planet.surfaceRadius(d.x, d.y, d.z);
    this.pos.copy(d).multiplyScalar(r + 2.3).add(planet.pos);
    const fwd = heading ? heading.clone() : new THREE.Vector3(0, 0, 1);
    fwd.addScaledVector(d, -fwd.dot(d)).normalize();
    if (fwd.lengthSq() < 0.1) fwd.set(1, 0, 0).addScaledVector(d, -d.x).normalize();
    this._orient(fwd, d);
    this.state = 'landed';
    this.speed = 0;
    this.vel.set(0, 0, 0);
    this.model.gear.visible = true;
    this.landedPlanet = planet;
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

    // visual bank on the model only
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
    const boosting = (input.held.has('boost') || input.held.has('jump')) && this.boostEnergy > 0.02 && !this.pulseOn;
    if (boosting) this.boostEnergy = Math.max(0, this.boostEnergy - dt * 0.18);
    else this.boostEnergy = Math.min(1, this.boostEnergy + dt * 0.12);
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
        g.inv.drainPulse(dt);
        if (g.inv.fuel.pulse <= 0) {
          this.pulseOn = false;
          g.hud.toast('Pulse fuel empty. Mine asteroids for Tritium', 'warn');
          g.audio?.pulseStop();
        }
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
    if (a.kind === 'land' || a.kind === 'launch' || a.kind === 'dock' || a.kind === 'undock') {
      this.pos.lerpVectors(a.fromPos, a.toPos, a.kind === 'launch' ? k * (2 - k) : e);
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
