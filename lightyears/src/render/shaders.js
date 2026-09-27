// Shared GLSL and material factories. Every lit thing in the game goes through these
// so terrain, plants, critters, and the ship all sit in the same atmosphere.

import * as THREE from 'three';

// Global uniforms shared by reference across all materials
export const G = {
  uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.7).normalize() },
  uSunColor: { value: new THREE.Vector3(3.2, 3.1, 2.9) },
  uTime: { value: 0 },
  uTorch: { value: 0 },
  uNightAmbient: { value: new THREE.Vector3(0.03, 0.035, 0.05) },
  uFlash: { value: 0 },
};

// Per-planet atmosphere uniforms. Objects on the surface use a copy of the current planet's.
export function makeAtmoUniforms() {
  return {
    uPlanetPos: { value: new THREE.Vector3() },
    uPlanetR: { value: 1000 },
    uAtmoR: { value: 1100 },
    uBetaR: { value: new THREE.Vector3() },
    uBetaM: { value: 0 },
    uHR: { value: 30 },
    uHM: { value: 10 },
    uMieG: { value: 0.76 },
    uHasAtmo: { value: 0 },
    uAmbient: { value: new THREE.Vector3(0.1, 0.1, 0.1) },
    uSkyColor: { value: new THREE.Vector3(0.3, 0.5, 0.9) },
  };
}

export function setAtmoFromParams(u, params) {
  u.uPlanetR.value = params.radius;
  const a = params.atmo;
  if (a) {
    u.uAtmoR.value = a.radius;
    u.uBetaR.value.set(a.betaR[0], a.betaR[1], a.betaR[2]);
    u.uBetaM.value = a.betaM;
    u.uHR.value = a.hR;
    u.uHM.value = a.hM;
    u.uMieG.value = a.mieG;
    u.uHasAtmo.value = 1;
    // ambient sky light, loosely the zenith color
    const t = a.tint;
    const k = 0.34;
    u.uAmbient.value.set(0.05 + t[0] * k, 0.05 + t[1] * k, 0.05 + t[2] * k);
    u.uSkyColor.value.set(t[0] * 0.6, t[1] * 0.6, t[2] * 0.6);
  } else {
    u.uAtmoR.value = params.radius * 1.001;
    u.uBetaR.value.set(0, 0, 0);
    u.uBetaM.value = 0;
    u.uHasAtmo.value = 0;
    u.uAmbient.value.set(0.035, 0.035, 0.04);
    u.uSkyColor.value.set(0, 0, 0);
  }
}

export function copyAtmoUniforms(dst, src) {
  for (const k in src) {
    const v = src[k].value;
    if (v && v.isVector3) dst[k].value.copy(v);
    else dst[k].value = v;
  }
}

export const ATMO_PARS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uPlanetPos;
uniform float uPlanetR;
uniform float uAtmoR;
uniform vec3 uBetaR;
uniform float uBetaM;
uniform float uHR;
uniform float uHM;
uniform float uMieG;
uniform float uHasAtmo;
uniform vec3 uAmbient;
uniform vec3 uSkyColor;
uniform vec3 uNightAmbient;
uniform float uTime;
uniform float uTorch;

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

// Schuler's approximation of the Chapman grazing incidence function
float chapman(float X, float h, float coschi) {
  float c = sqrt(X + h);
  if (coschi >= 0.0) {
    return c / (c * coschi + 1.0) * exp(-h);
  }
  float x0 = sqrt(max(0.0, 1.0 - coschi * coschi)) * (X + h);
  float c0 = sqrt(x0);
  return min(2.0 * c0 * exp(min(X - x0, 40.0)) - c / (1.0 - c * coschi) * exp(-h), 1e12);
}

vec3 sunTransmittance(vec3 p) {
  if (uHasAtmo < 0.5) {
    // airless: hard terminator only
    return vec3(1.0);
  }
  float r = length(p);
  float h = max(r - uPlanetR, 0.0);
  float mu = dot(p, uSunDir) / r;
  float odR = uHR * chapman(uPlanetR / uHR, h / uHR, mu);
  float odM = uHM * chapman(uPlanetR / uHM, h / uHM, mu);
  return exp(-(uBetaR * odR + uBetaM * 1.1 * odM));
}

void scatter(vec3 ro, vec3 rd, float tMax, out vec3 inscatter, out vec3 trans) {
  inscatter = vec3(0.0);
  trans = vec3(1.0);
  if (uHasAtmo < 0.5) return;
  vec2 ta = raySphere(ro, rd, uAtmoR);
  float t0 = max(ta.x, 0.0);
  float t1 = min(ta.y, tMax);
  if (t1 <= t0) return;
  float ds = (t1 - t0) / float(ATMO_STEPS);
  float mu = dot(rd, uSunDir);
  float mu2 = mu * mu;
  float g = uMieG;
  float g2 = g * g;
  float phaseR = 0.0596831 * (1.0 + mu2);
  float phaseM = 0.1193662 * (1.0 - g2) * (1.0 + mu2) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
  float odR = 0.0;
  float odM = 0.0;
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float XR = uPlanetR / uHR;
  float XM = uPlanetR / uHM;
  for (int i = 0; i < ATMO_STEPS; i++) {
    vec3 p = ro + rd * (t0 + ds * (float(i) + 0.5));
    float r = length(p);
    float h = max(r - uPlanetR, 0.0);
    float dR = exp(-h / uHR) * ds;
    float dM = exp(-h / uHM) * ds;
    float muS = dot(p, uSunDir) / r;
    float sR = uHR * chapman(XR, h / uHR, muS);
    float sM = uHM * chapman(XM, h / uHM, muS);
    vec3 att = exp(-(uBetaR * (odR + 0.5 * dR + sR) + uBetaM * 1.1 * (odM + 0.5 * dM + sM)));
    sumR += dR * att;
    sumM += dM * att;
    odR += dR;
    odM += dM;
  }
  inscatter = uSunColor * (sumR * uBetaR * phaseR + sumM * uBetaM * phaseM);
  trans = exp(-(uBetaR * odR + uBetaM * 1.1 * odM));
}

vec3 ambientAt(vec3 up, vec3 N) {
  float day = smoothstep(-0.28, 0.3, dot(up, uSunDir));
  float sky = 0.55 + 0.45 * dot(N, up);
  return uAmbient * sky * (0.06 + 0.94 * day) + uNightAmbient;
}
`;

// ---------------------------------------------------------------------------
// Terrain

const TERRAIN_VERT = /* glsl */ `
#define ATMO_STEPS 5
${ATMO_PARS}
attribute vec4 aColor;
varying vec3 vColor;
varying float vLiquid;
varying vec3 vNormal;
varying vec3 vRel;
varying vec3 vPL;
varying vec3 vInscatter;
varying vec3 vTrans;
varying vec3 vSunT;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 rel = mv.xyz * mat3(viewMatrix);
  vRel = rel;
  vec3 pl = rel - uPlanetPos;
  vPL = pl;
  vNormal = normal;
  vColor = pow(aColor.rgb, vec3(2.2));
  vLiquid = aColor.a;
  float dist = length(rel);
  vec3 ins; vec3 tr;
  scatter(-uPlanetPos, rel / max(dist, 1e-4), dist, ins, tr);
  vInscatter = ins;
  vTrans = tr;
  vSunT = sunTransmittance(pl);
}
`;

const TERRAIN_FRAG = /* glsl */ `
#define ATMO_STEPS 5
${ATMO_PARS}
uniform float uLiquidType;
uniform float uDetail;
varying vec3 vColor;
varying float vLiquid;
varying vec3 vNormal;
varying vec3 vRel;
varying vec3 vPL;
varying vec3 vInscatter;
varying vec3 vTrans;
varying vec3 vSunT;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash13(i);
  float b = hash13(i + vec3(1, 0, 0));
  float c = hash13(i + vec3(0, 1, 0));
  float d = hash13(i + vec3(1, 1, 0));
  float e = hash13(i + vec3(0, 0, 1));
  float f1 = hash13(i + vec3(1, 0, 1));
  float g = hash13(i + vec3(0, 1, 1));
  float h = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, f1, f.x), mix(g, h, f.x), f.y), f.z);
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 up = normalize(vPL);
  vec3 V = normalize(-vRel);
  float dist = length(vRel);
  vec3 albedo = vColor;

  // close range grain so the ground does not look like flat vertex color
  if (uDetail > 0.5 && dist < 220.0) {
    float fade = 1.0 - smoothstep(60.0, 220.0, dist);
    float n = vnoise(vPL * 0.9) * 0.6 + vnoise(vPL * 3.1) * 0.4;
    albedo *= 1.0 + (n - 0.5) * 0.35 * fade;
  }

  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 sun = uSunColor * vSunT * ndl;
  vec3 amb = ambientAt(up, N);
  vec3 col = albedo * (sun + amb);

  float wet = smoothstep(0.35, 0.65, vLiquid);
  if (wet > 0.0) {
    vec3 p = vPL;
    float t = uTime;
    // three directional swells with incommensurate frequencies, summed as a gradient
    vec3 k1 = vec3(0.31, 0.12, -0.27);
    vec3 k2 = vec3(-0.17, 0.33, 0.21) * 1.37;
    vec3 k3 = vec3(0.23, -0.29, 0.14) * 2.11;
    vec3 rip = k1 * cos(dot(p, k1) + t * 1.3) + k2 * cos(dot(p, k2) - t * 1.1) * 0.6 + k3 * cos(dot(p, k3) + t * 1.7) * 0.35;
    float far = smoothstep(15.0, 260.0, dist);
    vec3 wn = normalize(up + (rip - up * dot(rip, up)) * 0.18 * (1.0 - far));
    vec3 H = normalize(uSunDir + V);
    float shin = mix(160.0, 45.0, far);
    float spec = pow(max(dot(wn, H), 0.0), shin) * (shin + 8.0) / 50.0;
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(V, wn), 0.0), 5.0);
    float day = smoothstep(-0.2, 0.3, dot(up, uSunDir));
    vec3 liquid;
    if (uLiquidType < 0.5) {
      // water
      vec3 sky = uSkyColor * (0.15 + 0.85 * day) + uNightAmbient;
      liquid = albedo * (sun * 0.6 + amb) ;
      liquid = mix(liquid, sky, fres * 0.8) + uSunColor * vSunT * spec;
    } else if (uLiquidType < 1.5) {
      // lava glows by itself
      float pulse = 0.75 + 0.25 * sin(t * 1.7 + vnoise(p * 0.08) * 6.28);
      float crust = smoothstep(0.55, 0.75, vnoise(p * 0.25 + vec3(t * 0.05)));
      liquid = mix(albedo * 2.6 * pulse, albedo * 0.12 * (sun + amb), crust * 0.7);
    } else if (uLiquidType < 2.5) {
      // acid, a little self lit
      liquid = albedo * (sun * 0.6 + amb) + albedo * 0.25;
      liquid = mix(liquid, uSkyColor * day, fres * 0.5) + uSunColor * vSunT * spec;
    } else {
      // ice sheet
      liquid = albedo * (sun + amb) + uSunColor * vSunT * spec * 0.4;
    }
    col = mix(col, liquid, wet);
  }

  // helmet torch at night
  if (uTorch > 0.0) {
    float fall = 1.0 / (1.0 + dist * dist * 0.004);
    col += albedo * uTorch * fall * max(dot(N, V), 0.0) * vec3(1.0, 0.95, 0.85);
  }

  col = col * vTrans + vInscatter;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function makeTerrainMaterial(atmoU, liquidType, detail = true) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...atmoU,
      uSunDir: G.uSunDir,
      uSunColor: G.uSunColor,
      uNightAmbient: G.uNightAmbient,
      uTime: G.uTime,
      uTorch: G.uTorch,
      uLiquidType: { value: liquidType },
      uDetail: { value: detail ? 1 : 0 },
    },
    vertexShader: TERRAIN_VERT,
    fragmentShader: TERRAIN_FRAG,
  });
}

export const LIQUID_TYPE = { water: 0, lava: 1, acid: 2, ice: 3 };

// ---------------------------------------------------------------------------
// Atmosphere shell (sky from inside, rim glow from outside)

const SKY_VERT = /* glsl */ `
varying vec3 vRel;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vRel = mv.xyz * mat3(viewMatrix);
}
`;

const SKY_FRAG = /* glsl */ `
#define ATMO_STEPS 10
${ATMO_PARS}
uniform float uSkyGain;
varying vec3 vRel;
void main() {
  vec3 rd = normalize(vRel);
  vec3 ro = -uPlanetPos;
  float tMax = 1e9;
  vec2 tp = raySphere(ro, rd, uPlanetR);
  if (tp.x > 0.0) tMax = tp.x;
  vec3 ins; vec3 tr;
  scatter(ro, rd, tMax, ins, tr);
  ins *= uSkyGain;
  float a = 1.0 - clamp(dot(tr, vec3(0.3333)), 0.0, 1.0);
  gl_FragColor = vec4(ins, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.a = a;
}
`;

export function makeSkyMaterial(atmoU) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...atmoU,
      uSunDir: G.uSunDir,
      uSunColor: G.uSunColor,
      uNightAmbient: G.uNightAmbient,
      uTime: G.uTime,
      uTorch: G.uTorch,
      uSkyGain: { value: 2.4 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

// ---------------------------------------------------------------------------
// Lit objects: plants, rocks, critters, ship, station. Vertex colors, optional
// instancing, optional wind sway, optional emissive via vertex alpha.

const OBJ_VERT = /* glsl */ `
#define ATMO_STEPS 4
${ATMO_PARS}
attribute vec4 aColor;
uniform float uWind;
uniform float uSwing;
uniform float uPhase;
varying vec3 vColor;
varying float vEmit;
varying vec3 vNormal;
varying vec3 vRel;
varying vec3 vInscatter;
varying vec3 vTrans;
varying vec3 vSunT;
varying vec3 vUp;

void main() {
  vec3 p = position;
  vec3 n = normal;
  #ifdef USE_LEGS
    // aColor.a > 0.5 and < 0.9 marks leg vertices, swing about the hip line (y = uHip)
  #endif
  if (uWind > 0.0) {
    float sway = uWind * max(p.y, 0.0) * 0.04;
    #ifdef USE_INSTANCING
      float ph = instanceMatrix[3][0] * 0.13 + instanceMatrix[3][2] * 0.17;
    #else
      float ph = 0.0;
    #endif
    p.x += sin(uTime * 1.3 + ph) * sway;
    p.z += cos(uTime * 1.1 + ph * 1.3) * sway * 0.6;
  }
  vec4 local = vec4(p, 1.0);
  vec3 ln = n;
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    ln = mat3(instanceMatrix) * ln;
  #endif
  vec4 mv = modelViewMatrix * local;
  gl_Position = projectionMatrix * mv;
  vec3 rel = mv.xyz * mat3(viewMatrix);
  vRel = rel;
  vNormal = normalize(mat3(modelMatrix) * ln);
  vColor = pow(aColor.rgb, vec3(2.2));
  #ifdef USE_INSTANCING_COLOR
    vColor *= instanceColor;
  #endif
  vEmit = aColor.a;
  vec3 pl = rel - uPlanetPos;
  vUp = normalize(pl);
  float dist = length(rel);
  vec3 ins; vec3 tr;
  scatter(-uPlanetPos, rel / max(dist, 1e-4), dist, ins, tr);
  vInscatter = ins;
  vTrans = tr;
  vSunT = sunTransmittance(pl);
}
`;

const OBJ_FRAG = /* glsl */ `
#define ATMO_STEPS 4
${ATMO_PARS}
uniform float uSpec;
uniform float uEmissive;
uniform vec3 uTint;
uniform float uFade;
varying vec3 vColor;
varying float vEmit;
varying vec3 vNormal;
varying vec3 vRel;
varying vec3 vInscatter;
varying vec3 vTrans;
varying vec3 vSunT;
varying vec3 vUp;
void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(-vRel);
  vec3 albedo = vColor * uTint;
  float ndl = dot(N, uSunDir);
  float wrap = max((ndl + 0.25) / 1.25, 0.0);
  vec3 sun = uSunColor * vSunT * wrap;
  vec3 amb = ambientAt(vUp, N);
  vec3 col = albedo * (sun + amb);
  if (uSpec > 0.0) {
    vec3 H = normalize(uSunDir + V);
    float s = pow(max(dot(N, H), 0.0), 48.0) * uSpec;
    col += uSunColor * vSunT * s * step(0.0, ndl);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    col += uSkyColor * rim * uSpec * 0.3;
  }
  // vertex alpha > 0.95 means self lit (lights, crystals, engine glow)
  float emit = smoothstep(0.9, 1.0, vEmit) * uEmissive;
  col = mix(col, albedo * 2.2, emit);
  if (uTorch > 0.0) {
    float d = length(vRel);
    col += albedo * uTorch * max(dot(N, V), 0.0) / (1.0 + d * d * 0.004);
  }
  col = col * vTrans + vInscatter;
  gl_FragColor = vec4(col, uFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function makeObjectMaterial(atmoU, opts = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...atmoU,
      uSunDir: G.uSunDir,
      uSunColor: G.uSunColor,
      uNightAmbient: G.uNightAmbient,
      uTime: G.uTime,
      uTorch: G.uTorch,
      uWind: { value: opts.wind ?? 0 },
      uSwing: { value: 0 },
      uPhase: { value: 0 },
      uSpec: { value: opts.spec ?? 0 },
      uEmissive: { value: opts.emissive ?? 1 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uFade: { value: 1 },
    },
    vertexShader: OBJ_VERT,
    fragmentShader: OBJ_FRAG,
    side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    transparent: !!opts.transparent,
  });
  return mat;
}
