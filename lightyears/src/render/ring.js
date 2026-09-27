// Planetary rings with bands, gaps, and the planet's shadow falling across them.
import * as THREE from 'three';
import { ATMO_PARS, G } from './shaders.js';

const RING_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vRel;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vRel = mv.xyz * mat3(viewMatrix);
  gl_Position = projectionMatrix * mv;
}
`;

const RING_FRAG = /* glsl */ `
#define ATMO_STEPS 4
${ATMO_PARS}
uniform vec3 uRingColor;
uniform float uInner;
uniform float uOuter;
uniform float uSeed;
varying vec3 vLocal;
varying vec3 vRel;
float h1(float x) { return fract(sin(x * 91.7 + uSeed) * 43758.5453); }
float bandNoise(float t) {
  float i = floor(t);
  float f = fract(t);
  return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f));
}
void main() {
  float r = length(vLocal.xy);
  float t = (r - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  float b = bandNoise(t * 40.0) * 0.55 + bandNoise(t * 130.0) * 0.3 + bandNoise(t * 9.0) * 0.4;
  float edge = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.88, t);
  float gap = smoothstep(0.012, 0.03, abs(t - (0.45 + h1(3.0) * 0.2)));
  float alpha = clamp(b * 1.1 - 0.15, 0.0, 1.0) * edge * gap * 0.8;
  if (alpha < 0.01) discard;
  vec3 pl = vRel - uPlanetPos;
  vec2 hit = raySphere(pl, uSunDir, uPlanetR);
  float shadow = hit.x > 0.0 ? 0.08 : 1.0;
  vec3 col = uRingColor * (uSunColor * 0.55 * shadow + uNightAmbient * 2.0) * (0.75 + 0.5 * b);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function makeRing(params, atmoU) {
  const r = params.ring;
  const geo = new THREE.RingGeometry(r.inner, r.outer, 160, 1);
  const lin = r.color.map((c) => Math.pow(c, 2.2));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...atmoU,
      uSunDir: G.uSunDir,
      uSunColor: G.uSunColor,
      uNightAmbient: G.uNightAmbient,
      uTime: G.uTime,
      uTorch: G.uTorch,
      uRingColor: { value: new THREE.Vector3(...lin) },
      uInner: { value: r.inner },
      uOuter: { value: r.outer },
      uSeed: { value: (r.seed % 1000) * 0.37 },
    },
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // RingGeometry lies in XY, its normal is +Z. Turn +Z to the ring normal.
  const n = new THREE.Vector3(...r.normal).normalize();
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  mesh.frustumCulled = false;
  return mesh;
}
