// Space dust streaks, laser beams and bolts, spark particles, and the hyperspace tunnel.
// Everything here is drawn camera-relative so huge system coordinates never jitter.

import * as THREE from 'three';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export class SpaceDust {
  constructor(count = 700, box = 180) {
    this.box = box;
    const pos = new Float32Array(count * 2 * 3);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * box, y = Math.random() * box, z = Math.random() * box;
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uOffset: { value: new THREE.Vector3() },
        uVel: { value: new THREE.Vector3() },
        uBox: { value: box },
        uAlpha: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uOffset;
        uniform vec3 uVel;
        uniform float uBox;
        uniform float uAlpha;
        attribute float aEnd;
        varying float vA;
        void main() {
          vec3 p = mod(position - uOffset, uBox) - uBox * 0.5;
          float sp = length(uVel);
          vec3 dir = sp > 0.01 ? uVel / sp : vec3(0.0, 0.0, 1.0);
          float len = clamp(sp * 0.03, 0.15, 45.0);
          p -= dir * len * aEnd;
          vec4 cp = projectionMatrix * vec4(mat3(viewMatrix) * p, 1.0);
          gl_Position = cp;
          float d = length(p) / (uBox * 0.5);
          vA = uAlpha * (1.0 - smoothstep(0.55, 1.0, d)) * (1.0 - aEnd * 0.9) * clamp(sp / 60.0, 0.15, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * vA, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.LineSegments(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 15;
    this.alpha = 0;
  }

  update(camera, vel, target) {
    const b = this.box;
    const c = camera.position;
    const mod = (x) => ((x % b) + b) % b;
    this.mat.uniforms.uOffset.value.set(mod(c.x), mod(c.y), mod(c.z));
    this.mat.uniforms.uVel.value.copy(vel);
    this.alpha += (target - this.alpha) * 0.05;
    this.mat.uniforms.uAlpha.value = this.alpha * 0.8;
    this.points.visible = this.alpha > 0.01;
  }
}

// Camera facing ribbons for the mining beam and ship bolts
export class Beam {
  constructor() {
    this.group = new THREE.Group();
    this.maxQuads = 64;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.maxQuads * 4 * 3);
    this.uv = new Float32Array(this.maxQuads * 4 * 2);
    this.col = new Float32Array(this.maxQuads * 4 * 3);
    const idx = [];
    for (let i = 0; i < this.maxQuads; i++) {
      const o = i * 4;
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      this.uv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    geo.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aCol;
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          vUv = uv;
          vCol = aCol;
          gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          float d = abs(vUv.x - 0.5) * 2.0;
          float core = exp(-d * d * 18.0);
          float glow = exp(-d * 3.0) * 0.5;
          float flick = 0.8 + 0.2 * sin(vUv.y * 60.0 - uTime * 90.0);
          vec3 c = (vCol * glow + vec3(1.0) * core * 0.9) * flick * 2.2;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
    this.group.add(this.mesh);
    this.mining = null;
    this.bolts = [];
    this.camPos = new THREE.Vector3();
  }

  setMining(start, end, color) {
    this.mining = start ? { start: start.clone(), end: end.clone(), color } : null;
  }

  fire(start, dir, speed, color, life = 1.2) {
    if (this.bolts.length > 40) this.bolts.shift();
    this.bolts.push({ pos: start.clone(), dir: dir.clone(), speed, color, life, age: 0 });
  }

  update(dt) {
    this.mat.uniforms.uTime.value += dt;
    for (const b of this.bolts) {
      b.pos.addScaledVector(b.dir, b.speed * dt);
      b.age += dt;
    }
    this.bolts = this.bolts.filter((b) => b.age < b.life && !b.dead);
  }

  // fill the ribbon buffer; call right before rendering
  build(camera) {
    const cp = camera.position;
    let n = 0;
    const quad = (a, b, w, color) => {
      if (n >= this.maxQuads) return;
      // camera relative endpoints
      const ax = a.x - cp.x, ay = a.y - cp.y, az = a.z - cp.z;
      const bx = b.x - cp.x, by = b.y - cp.y, bz = b.z - cp.z;
      _v.set(bx - ax, by - ay, bz - az);
      _v2.set(ax, ay, az);
      _v3.crossVectors(_v, _v2).normalize().multiplyScalar(w);
      const o = n * 12;
      this.pos[o] = ax - _v3.x; this.pos[o + 1] = ay - _v3.y; this.pos[o + 2] = az - _v3.z;
      this.pos[o + 3] = ax + _v3.x; this.pos[o + 4] = ay + _v3.y; this.pos[o + 5] = az + _v3.z;
      this.pos[o + 6] = bx - _v3.x; this.pos[o + 7] = by - _v3.y; this.pos[o + 8] = bz - _v3.z;
      this.pos[o + 9] = bx + _v3.x; this.pos[o + 10] = by + _v3.y; this.pos[o + 11] = bz + _v3.z;
      for (let k = 0; k < 4; k++) this.col.set(color, n * 12 + k * 3);
      n++;
    };
    if (this.mining) quad(this.mining.start, this.mining.end, 0.07, this.mining.color);
    for (const b of this.bolts) {
      const tail = _v2.copy(b.pos).addScaledVector(b.dir, -Math.min(24, b.speed * 0.03));
      quad(tail.clone(), b.pos, 0.55, b.color);
    }
    for (let i = n * 12; i < this.maxQuads * 12; i++) this.pos[i] = 0;
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aCol.needsUpdate = true;
    g.setDrawRange(0, n * 6);
    this.mesh.visible = n > 0;
  }
}

export class Particles {
  constructor(max = 400) {
    this.max = max;
    this.list = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 } },
      vertexShader: /* glsl */ `
        attribute vec3 aCol;
        attribute float aSize;
        uniform float uScale;
        varying vec3 vCol;
        void main() {
          vCol = aCol;
          vec4 mv = vec4(mat3(viewMatrix) * position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = exp(-dot(c, c) * 14.0);
          gl_FragColor = vec4(vCol * a * 1.8, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 19;
  }

  burst(pos, color, count = 12, speed = 6, size = 0.3, life = 0.8, gravityUp = null) {
    for (let i = 0; i < count; i++) {
      if (this.list.length >= this.max) this.list.shift();
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      if (gravityUp) v.addScaledVector(gravityUp, speed * 0.5);
      this.list.push({ pos: pos.clone(), vel: v, color, life: life * (0.6 + Math.random() * 0.6), age: 0, size: size * (0.6 + Math.random() * 0.8), up: gravityUp });
    }
  }

  update(dt, camera) {
    const cp = camera.position;
    let n = 0;
    for (const p of this.list) {
      p.age += dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.up) p.vel.addScaledVector(p.up, -9 * dt);
      p.vel.multiplyScalar(1 - dt * 1.5);
    }
    this.list = this.list.filter((p) => p.age < p.life);
    for (const p of this.list) {
      const k = 1 - p.age / p.life;
      this.pos[n * 3] = p.pos.x - cp.x;
      this.pos[n * 3 + 1] = p.pos.y - cp.y;
      this.pos[n * 3 + 2] = p.pos.z - cp.z;
      this.col[n * 3] = p.color[0] * k;
      this.col[n * 3 + 1] = p.color[1] * k;
      this.col[n * 3 + 2] = p.color[2] * k;
      this.size[n] = p.size;
      n++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    g.attributes.aCol.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    this.mat.uniforms.uScale.value = (window.innerHeight * (camera.pixelRatioHint || 1)) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
}

export class WarpTunnel {
  constructor() {
    this.group = new THREE.Group();
    const geo = new THREE.CylinderGeometry(22, 22, 900, 48, 1, true);
    geo.rotateX(Math.PI / 2);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uI: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uI;
        varying vec2 vUv;
        void main() {
          float a = vUv.x * 6.2831853;
          float z = vUv.y;
          float s = 0.0;
          for (int i = 0; i < 4; i++) {
            float fi = float(i);
            float band = sin(a * (5.0 + fi * 4.0) + sin(a * (3.0 + fi) + uTime * 0.7) * 2.0);
            float streak = 0.5 + 0.5 * sin(z * (30.0 + fi * 13.0) + uTime * (26.0 + fi * 9.0) + band * 3.0);
            s += pow(streak, 10.0) * (0.6 + 0.4 * band);
          }
          vec3 c1 = vec3(0.25, 0.55, 1.0);
          vec3 c2 = vec3(1.0, 0.3, 0.75);
          vec3 c3 = vec3(1.0, 0.75, 0.3);
          vec3 col = mix(c1, c2, 0.5 + 0.5 * sin(z * 7.0 - uTime * 3.0 + a));
          col = mix(col, c3, 0.5 + 0.5 * sin(a * 2.0 + uTime * 1.3));
          float fade = smoothstep(0.0, 0.2, z) * smoothstep(1.0, 0.75, z);
          gl_FragColor = vec4(col * s * uI * fade * 1.8 + col * 0.12 * uI * fade, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.tube = new THREE.Mesh(geo, this.mat);
    this.tube.frustumCulled = false;
    this.group.add(this.tube);
    // bright point at the end of the tunnel
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv - 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uI;
        varying vec2 vUv;
        void main() {
          float r = length(vUv) * 2.0;
          float a = exp(-r * 5.0) * uI;
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.9) * a * 3.0, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), this.glowMat);
    this.glow.position.z = -420;
    this.group.add(this.glow);
    this.group.renderOrder = 25;
  }

  start(camera) {
    this.t = 0;
    this.place(camera);
  }

  place(camera) {
    this.group.position.copy(camera.position);
    this.group.quaternion.copy(camera.quaternion);
  }

  update(dt, t, camera) {
    this.place(camera);
    this.mat.uniforms.uTime.value = t;
    const inI = Math.min(1, t / 0.8);
    const outI = t > 3.6 ? Math.max(0, 1 - (t - 3.6) / 0.6) : 1;
    this.mat.uniforms.uI.value = inI * outI;
    this.glowMat.uniforms.uI.value = Math.min(1, t / 3) * (t > 3.8 ? 3 : 1);
  }

  stop() {
    this.mat.uniforms.uI.value = 0;
  }
}
