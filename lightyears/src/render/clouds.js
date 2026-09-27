// Cloud layer: a baked noise cube map on a slowly turning sphere.
import * as THREE from 'three';
import { ATMO_PARS, G } from './shaders.js';
import { bakeCube } from './bake.js';

let rendererRef = null;
export function setCloudRenderer(r) { rendererRef = r; }

const CLOUD_BAKE = /* glsl */ `
uniform float uSeed;
void main() {
  vec3 d = normalize(vDir);
  vec3 o = vec3(uSeed * 0.013, uSeed * 0.007, uSeed * 0.011);
  // warped fbm gives swirly weather fronts
  vec3 w = vec3(fbm3(d * 1.7 + o, 3), fbm3(d * 1.7 + o + 5.2, 3), fbm3(d * 1.7 + o + 9.1, 3));
  float n = fbm3(d * 3.2 + w * 0.9 + o, 7);
  float lat = abs(d.y);
  n += 0.08 * sin(lat * 18.0 + w.x * 3.0);
  gl_FragColor = vec4(vec3(n * 0.5 + 0.5), 1.0);
}
`;

const CLOUD_VERT = /* glsl */ `
#define ATMO_STEPS 4
${ATMO_PARS}
varying vec3 vDir;
varying vec3 vN;
varying vec3 vIns;
varying vec3 vTr;
varying vec3 vSunT;
void main() {
  vDir = normalize(position);
  vN = normalize(mat3(modelMatrix) * vDir);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 rel = mv.xyz * mat3(viewMatrix);
  gl_Position = projectionMatrix * mv;
  float dist = length(rel);
  vec3 ins; vec3 tr;
  scatter(-uPlanetPos, rel / max(dist, 1e-4), dist, ins, tr);
  vIns = ins;
  vTr = tr;
  vSunT = sunTransmittance(rel - uPlanetPos);
}
`;

const CLOUD_FRAG = /* glsl */ `
#define ATMO_STEPS 4
${ATMO_PARS}
uniform samplerCube uMap;
uniform float uCoverage;
uniform vec3 uCloudColor;
varying vec3 vDir;
varying vec3 vN;
varying vec3 vIns;
varying vec3 vTr;
varying vec3 vSunT;
void main() {
  float c = textureCube(uMap, vDir).r;
  float lo = 1.0 - uCoverage;
  float d = smoothstep(lo, lo + 0.2, c);
  if (d < 0.004) discard;
  vec3 N = normalize(vN);
  float ndl = dot(N, uSunDir);
  float lit = smoothstep(-0.2, 0.45, ndl);
  float thick = smoothstep(lo, lo + 0.45, c);
  vec3 col = uCloudColor * (uSunColor * vSunT * (0.2 + 0.8 * lit) * (1.0 - thick * 0.35) + uAmbient * 0.8 + uNightAmbient);
  col = col * vTr + vIns;
  gl_FragColor = vec4(col, d * 0.93);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function makeClouds(params, atmoU) {
  const c = params.clouds;
  const radius = params.radius * (1 + c.alt);
  const rt = bakeCube(rendererRef, CLOUD_BAKE, 256, { uSeed: { value: (params.seed % 1000) + 1 } });
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...atmoU,
      uSunDir: G.uSunDir,
      uSunColor: G.uSunColor,
      uNightAmbient: G.uNightAmbient,
      uTime: G.uTime,
      uTorch: G.uTorch,
      uMap: { value: rt.texture },
      uCoverage: { value: c.coverage },
      uCloudColor: { value: new THREE.Vector3(...c.color) },
    },
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), mat);
  mesh.frustumCulled = false;
  mesh.userData.spin = 0.004 + (params.seed % 7) * 0.001;
  mesh.userData.dispose = () => {
    rt.dispose();
    mesh.geometry.dispose();
    mat.dispose();
  };
  return mesh;
}
