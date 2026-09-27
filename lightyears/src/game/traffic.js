// Other travelers: a handful of ships shuttling between the station and the planets.
import * as THREE from 'three';
import { makeShip } from '../render/shipModel.js';
import { Rng, hashInts } from '../core/rng.js';
import { hsl } from '../world/color.js';

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (t) => t * t * (3 - 2 * t);

export class Traffic {
  constructor(game, sys) {
    this.game = game;
    this.group = new THREE.Group();
    this.rng = new Rng(hashInts(sys.star.seed, 8080));
    this.ships = [];
    const count = sys.core ? 7 : this.rng.int(3, 6);
    for (let i = 0; i < count; i++) {
      const model = makeShip(game.objAtmo);
      const tint = hsl(this.rng.float(), this.rng.range(0.2, 0.6), this.rng.range(0.55, 0.8));
      const mat = model.material.clone();
      mat.uniforms.uTint.value.setRGB(tint[0] * 1.2, tint[1] * 1.2, tint[2] * 1.2);
      model.hull.material = mat;
      model.drill.material = mat;
      model.group.remove(model.gear);
      model.gear.geometry.dispose();
      const scale = this.rng.range(0.8, 1.6);
      model.group.scale.setScalar(scale);
      this.group.add(model.group);
      const s = { model, mat, t: 0, dur: 1, from: new THREE.Vector3(), to: new THREE.Vector3(), quat: new THREE.Quaternion() };
      this._route(s, true);
      this.ships.push(s);
    }
  }

  _route(s, first) {
    const g = this.game;
    const rng = this.rng;
    const st = g.station;
    const dock = st.pos.clone().addScaledVector(st.forward, 140);
    const planet = rng.pick(g.planets);
    const dir = new THREE.Vector3(...rng.unitVector([0, 0, 0]));
    const atmo = planet.params.atmo ? planet.params.atmo.radius : planet.R * 1.05;
    const nearPlanet = planet.pos.clone().addScaledVector(dir, atmo + rng.range(400, 1500));
    const deepSpace = st.pos.clone().add(new THREE.Vector3(...rng.unitVector([0, 0, 0])).multiplyScalar(rng.range(20000, 40000)));
    const other = rng.chance(0.7) ? nearPlanet : deepSpace;
    if (rng.chance(0.5)) {
      s.from.copy(dock);
      s.to.copy(other);
    } else {
      s.from.copy(other);
      s.to.copy(dock);
    }
    const speed = rng.range(380, 700);
    s.dur = s.from.distanceTo(s.to) / speed + 6;
    s.t = first ? rng.range(0, s.dur) : 0;
    const fwd = _v.copy(s.to).sub(s.from).normalize();
    _m.lookAt(new THREE.Vector3(), fwd, UP);
    s.quat.setFromRotationMatrix(_m).multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI));
  }

  update(dt, camPos) {
    for (const s of this.ships) {
      s.t += dt;
      if (s.t >= s.dur) this._route(s, false);
      const k = smooth(Math.min(1, s.t / s.dur));
      const g = s.model.group;
      g.position.lerpVectors(s.from, s.to, k);
      g.quaternion.copy(s.quat);
      // fade in and out at the ends so ships appear to arrive and leave
      const edge = Math.min(s.t, s.dur - s.t);
      const vis = Math.min(1, edge / 1.5);
      g.visible = vis > 0.02 && g.position.distanceTo(camPos) < 40000;
      g.scale.setScalar(Math.max(0.01, vis) * (g.userData.baseScale || (g.userData.baseScale = g.scale.x)));
      s.model.drill.rotation.z += dt * 6;
      s.model.glowMat.uniforms.uPower.value = 0.8;
    }
  }

  dispose() {
    for (const s of this.ships) {
      s.model.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      s.mat.dispose();
      s.model.material.dispose();
      s.model.glowMat.dispose();
    }
    this.group.removeFromParent();
  }
}
