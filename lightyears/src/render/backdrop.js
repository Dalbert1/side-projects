// Deep space: baked nebula + galactic band cube map, point stars, and the local sun.
import * as THREE from 'three';
import { bakeCube } from './bake.js';
import { G } from './shaders.js';
import { Rng } from '../core/rng.js';

const NEBULA_BAKE = /* glsl */ `
uniform vec3 uGalDir;
uniform vec3 uGalUp;
uniform vec3 uNebA;
uniform vec3 uNebB;
uniform float uSeed;
uniform float uCore;
uniform float uNeb;
void main() {
  vec3 d = normalize(vDir);
  vec3 o = vec3(uSeed * 0.031, uSeed * 0.017, uSeed * 0.023);
  float lat = dot(d, uGalUp);
  float band = exp(-lat * lat * 22.0);
  float core = pow(max(dot(d, uGalDir), 0.0), 5.0);
  float glow = pow(max(dot(d, uGalDir), 0.0), 40.0);
  float n = fbm3(d * 2.2 + o, 6) * 0.5 + 0.5;
  float n2 = fbm3(d * 4.5 + o * 1.7 + 3.0, 5) * 0.5 + 0.5;
  float dust = fbm3(d * 7.0 + o * 2.3, 5) * 0.5 + 0.5;
  vec3 col = vec3(0.0);
  float neb = pow(smoothstep(0.35, 0.95, n), 2.0) * uNeb;
  col += mix(uNebA, uNebB, n2) * neb * 0.55;
  float lanes = 1.0 - smoothstep(0.5, 0.72, dust) * 0.75;
  col += vec3(0.75, 0.72, 0.68) * band * (0.035 + 0.08 * n2) * lanes;
  col += vec3(1.0, 0.82, 0.58) * (core * band * 0.35 + core * 0.04) * uCore * lanes;
  col += vec3(1.0, 0.9, 0.75) * glow * uCore * 0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

const SKYBOX_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position * 100.0, 1.0);
  gl_Position = p.xyww;
}
`;
const SKYBOX_FRAG = /* glsl */ `
uniform samplerCube uMap;
uniform float uFade;
varying vec3 vDir;
void main() {
  vec3 c = textureCube(uMap, normalize(vDir)).rgb * uFade;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uScale;
uniform float uFade;
uniform float uTime;
varying vec3 vColor;
void main() {
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position * 100.0, 1.0);
  gl_Position = p.xyww;
  float tw = 0.85 + 0.15 * sin(uTime * (1.0 + aSize) + position.x * 50.0);
  gl_PointSize = aSize * uScale;
  vColor = aColor * uFade * tw;
}
`;
const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  float a = exp(-d * 5.0);
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SUN_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = uv - 0.5;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;
const SUN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
void main() {
  float r = length(vUv) * 2.0;
  float core = smoothstep(0.075, 0.06, r);
  float glow = exp(-r * 7.0) * 1.4 + exp(-r * 2.6) * 0.35;
  float ang = atan(vUv.y, vUv.x);
  float rays = pow(abs(sin(ang * 4.0 + uTime * 0.05)), 40.0) * exp(-r * 3.0) * 0.5
             + pow(abs(sin(ang * 7.0 - uTime * 0.03)), 60.0) * exp(-r * 4.0) * 0.3;
  vec3 c = uColor * (core * 30.0 + glow * 3.0 + rays * 2.0);
  float fade = smoothstep(1.0, 0.7, r);
  gl_FragColor = vec4(c * fade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Backdrop {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.renderOrder = -100;

    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: null }, uFade: { value: 1 } },
      vertexShader: SKYBOX_VERT,
      fragmentShader: SKYBOX_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.sky = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -100;
    this.group.add(this.sky);

    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1 }, uFade: { value: 1 }, uTime: G.uTime },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(new THREE.BufferGeometry(), this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -99;
    this.group.add(this.stars);

    this.sunMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Vector3(1, 1, 1) }, uSize: { value: 1 }, uTime: G.uTime },
      vertexShader: SUN_VERT,
      fragmentShader: SUN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.sunMat);
    this.sun.frustumCulled = false;
    this.sun.renderOrder = -98;
    this.group.add(this.sun);
    this.sunDistance = 400000;
  }

  // info: { seed, galDir:[3], galUp:[3], core: 0..1, starColor:[3], nebA, nebB }
  setSystem(info) {
    if (this.cube) this.cube.dispose();
    const size = this.quality.skyRes || 512;
    this.cube = bakeCube(this.renderer, NEBULA_BAKE, size, {
      uGalDir: { value: new THREE.Vector3(...info.galDir).normalize() },
      uGalUp: { value: new THREE.Vector3(...info.galUp).normalize() },
      uNebA: { value: new THREE.Vector3(...info.nebA) },
      uNebB: { value: new THREE.Vector3(...info.nebB) },
      uSeed: { value: (info.seed % 997) + 1 },
      uCore: { value: info.core },
      uNeb: { value: info.nebula ?? 1 },
    });
    this.skyMat.uniforms.uMap.value = this.cube.texture;
    this._buildStars(info);
    const c = info.starColor;
    this.sunMat.uniforms.uColor.value.set(c[0], c[1], c[2]);
  }

  _buildStars(info) {
    const rng = new Rng(info.seed ^ 0xa11);
    const n = this.quality.stars || 3500;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const col = new Float32Array(n * 3);
    const up = new THREE.Vector3(...info.galUp).normalize();
    const v = [0, 0, 0];
    const tmp = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      rng.unitVector(v);
      tmp.set(v[0], v[1], v[2]);
      // pull a share of stars toward the galactic plane
      if (rng.chance(0.45)) {
        const lat = tmp.dot(up);
        tmp.addScaledVector(up, -lat * rng.range(0.6, 0.95)).normalize();
      }
      pos[i * 3] = tmp.x;
      pos[i * 3 + 1] = tmp.y;
      pos[i * 3 + 2] = tmp.z;
      const m = Math.pow(rng.float(), 3.5);
      size[i] = 1.5 + m * 5.5;
      const t = rng.float();
      const c = t < 0.15 ? [0.7, 0.8, 1.3] : t < 0.3 ? [1.3, 0.9, 0.7] : t < 0.33 ? [1.2, 0.6, 0.5] : [1, 1, 1];
      const b = 0.35 + m * 2.2;
      col[i * 3] = c[0] * b;
      col[i * 3 + 1] = c[1] * b;
      col[i * 3 + 2] = c[2] * b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    this.stars.geometry.dispose();
    this.stars.geometry = geo;
  }

  // dayFade: 0 in space/night, 1 under a bright sky (hides stars)
  update(camera, pixelRatio, skyBrightness) {
    this.group.position.copy(camera.position);
    const fade = 1 - Math.min(1, skyBrightness);
    this.starMat.uniforms.uScale.value = pixelRatio;
    this.starMat.uniforms.uFade.value = fade;
    this.skyMat.uniforms.uFade.value = 0.25 + 0.75 * fade;
    const sd = G.uSunDir.value;
    this.sun.position.set(sd.x * this.sunDistance, sd.y * this.sunDistance, sd.z * this.sunDistance);
    this.sunMat.uniforms.uSize.value = this.sunDistance * 0.16;
  }
}
