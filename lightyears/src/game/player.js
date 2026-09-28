// First person explorer on a round planet. Positions are planet local; "up" is
// always away from the planet's center, and the heading is carried along the surface.

import * as THREE from 'three';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _right = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _f = new THREE.Vector3();
const _nz = new THREE.Vector3();
const _m = new THREE.Matrix4();

export const EYE = 1.7;

// Floor radius under a direction. Water and acid can be swum through down to the
// bed; ice and lava are solid surfaces at sea level.
export function floorAt(p, d) {
  const h = p.sampler.height(d.x, d.y, d.z);
  const L = p.params.liquid;
  if (L && h < 0) {
    if (L === 'ice' || L === 'lava') return { r: p.R, liquid: L };
    return { r: p.R + h, liquid: L };
  }
  return { r: p.R + h, liquid: null };
}

export class Player {
  constructor(game) {
    this.game = game;
    this.planet = null;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.forward = new THREE.Vector3(1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.pitch = 0;
    this.grounded = false;
    this.swimming = false;
    this.bob = 0;
    this.jetting = false;
    this.fallSpeed = 0;
    this.inLiquid = null;
    this.camQuat = new THREE.Quaternion();
    this.eyeWorld = new THREE.Vector3();
    this.lookWorld = new THREE.Vector3();
  }

  spawn(planet, localPos, forward) {
    this.planet = planet;
    this.pos.copy(localPos);
    this.vel.set(0, 0, 0);
    this.up.copy(localPos).normalize();
    this.forward.copy(forward).addScaledVector(this.up, -forward.dot(this.up)).normalize();
    if (this.forward.lengthSq() < 0.5) this.forward.set(1, 0, 0).addScaledVector(this.up, -this.up.x).normalize();
    this.pitch = 0;
    this.snapToGround();
  }

  snapToGround() {
    const p = this.planet;
    const d = _v.copy(this.pos).normalize();
    const r = p.surfaceRadius(d.x, d.y, d.z);
    this.pos.copy(d).multiplyScalar(r + 0.05);
  }

  get speedMul() {
    return 1;
  }

  update(dt, input) {
    const g = this.game;
    const p = this.planet;
    const inv = g.inv;
    const up = this.up.copy(this.pos).normalize();

    // carry the heading along the sphere
    this.forward.addScaledVector(up, -this.forward.dot(up)).normalize();

    // look
    const look = input.consumeLook();
    const sens = 0.0042;
    const yaw = -look.x * sens;
    if (yaw) this.forward.applyAxisAngle(up, yaw).normalize();
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.y * sens * (g.settings.invertY ? -1 : 1), -1.45, 1.45);
    _right.crossVectors(this.forward, up).normalize();

    // ground and liquids
    const dir = _v.copy(this.pos).normalize();
    const fl = floorAt(p, dir);
    const r = this.pos.length();
    const liquid = fl.liquid;
    this.swimming = (liquid === 'water' || liquid === 'acid') && r < p.R + 0.35;
    this.inLiquid = this.swimming ? liquid : liquid === 'lava' && r - p.R < 0.3 ? 'lava' : null;

    // horizontal intent
    let mx = input.move.x;
    let my = -input.move.y;
    const mlen = Math.hypot(mx, my);
    const sprint = input.held.has('boost') || mlen > 0.94;
    let speed = (sprint ? 10.5 : 6.2) * (this.swimming ? 0.55 : 1);
    const want = _v2.set(0, 0, 0).addScaledVector(this.forward, my * speed).addScaledVector(_right, mx * speed);

    // split velocity into vertical and tangent parts
    const vUp = this.vel.dot(up);
    const tangent = _tan.copy(this.vel).addScaledVector(up, -vUp);
    const control = this.grounded || this.swimming ? 14 : 3.2;
    tangent.lerp(want, 1 - Math.exp(-dt * control));

    let vy = vUp;
    const gravity = 16;
    this.grounded = r - fl.r <= 0.08 && vy <= 0.5;

    // jetpack
    const jetLevel = inv.upgrades.jetpack;
    const jetHeld = input.held.has('jump');
    this.jetting = false;
    if (jetHeld && inv.suit.jet > 0) {
      if (this.grounded) vy = Math.max(vy, 5.5);
      vy += (26 + jetLevel * 4) * dt;
      vy = Math.min(vy, 9 + jetLevel * 2);
      // a little forward push, like the real thing
      tangent.addScaledVector(this.forward, (my > 0 ? 7 : 2) * dt);
      inv.suit.jet = Math.max(0, inv.suit.jet - dt * (22 - jetLevel * 4));
      this.jetting = true;
    } else if (this.grounded || this.swimming) {
      inv.suit.jet = Math.min(100, inv.suit.jet + dt * 45);
    }

    if (this.swimming) {
      // float at the surface
      const target = p.R - 1.1;
      vy += (target - r) * 6 * dt - vy * 3 * dt;
    } else {
      vy -= gravity * dt;
    }

    this.vel.copy(tangent).addScaledVector(up, vy);
    this.pos.addScaledVector(this.vel, dt);

    // resolve ground
    const d2 = _v.copy(this.pos).normalize();
    const fl2 = floorAt(p, d2);
    const r2 = this.pos.length();
    if (r2 < fl2.r) {
      const impact = -this.vel.dot(d2);
      this.pos.copy(d2).multiplyScalar(fl2.r);
      if (impact > 0) this.vel.addScaledVector(d2, impact);
      if (impact > 17 && !this.swimming) g.hurtPlayer((impact - 17) * 4, 'impact');
    }

    // push out of trees and boulders
    g.surface?.collidePlayer(this.pos, 0.45);

    // head bob
    const moving = this.grounded && tangent.length() > 1;
    this.bob += dt * (moving ? tangent.length() * 1.3 : 0);

    this._updateCamera();
  }

  _updateCamera() {
    const up = this.up.copy(this.pos).normalize();
    const bobY = Math.sin(this.bob) * 0.05;
    this.eyeWorld.copy(this.pos).addScaledVector(up, EYE + bobY).add(this.planet.pos);
    _right.crossVectors(this.forward, up).normalize();
    const f = _f.copy(this.forward).multiplyScalar(Math.cos(this.pitch)).addScaledVector(up, Math.sin(this.pitch));
    this.lookWorld.copy(f);
    const camUp = _v2.crossVectors(_right, f).normalize();
    // camera looks down -Z: basis x = right, y = up, z = -forward
    _m.makeBasis(_right, camUp, _nz.copy(f).negate());
    this.camQuat.setFromRotationMatrix(_m);
  }
}
