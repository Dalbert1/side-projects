// Planet recipes. A planet is a plain serializable object (so it can be posted to
// workers) plus a sampler built from it that answers "how high is the ground here"
// and "what color is it". The same sampler runs on the main thread for collision,
// scattering flora, and walking around.

import { Rng, hashInts } from '../core/rng.js';
import { Simplex, smoothstep, clamp } from '../core/noise.js';
import { hsl, mixColor } from './color.js';

export const BIOMES = {
  lush: { label: 'Lush', weight: 22 },
  ocean: { label: 'Ocean', weight: 7 },
  desert: { label: 'Scorched', weight: 13 },
  frozen: { label: 'Frozen', weight: 12 },
  toxic: { label: 'Toxic', weight: 10 },
  barren: { label: 'Barren', weight: 12 },
  volcanic: { label: 'Volcanic', weight: 8 },
  exotic: { label: 'Exotic', weight: 9 },
};

export const HAZARD_LABEL = {
  heat: 'Extreme Heat',
  cold: 'Deep Freeze',
  toxic: 'Toxic Air',
  radiation: 'Radiation',
};

const r3 = (rng) => rng.unitVector([0, 0, 0]);

// Rayleigh coefficients from a desired zenith sky tint. Tuned for our tiny planets.
function makeAtmosphere(rng, R, tint, opts = {}) {
  const thickness = R * (opts.thickness ?? rng.range(0.11, 0.14));
  const hR = thickness * 0.24;
  const hM = thickness * 0.09;
  const strength = opts.strength ?? rng.range(0.26, 0.36);
  const mx = Math.max(tint[0], tint[1], tint[2], 1e-3);
  const t = [tint[0] / mx, tint[1] / mx, tint[2] / mx];
  const betaR = [(t[0] * strength) / hR, (t[1] * strength) / hR, (t[2] * strength) / hR];
  const haze = opts.haze ?? rng.range(0.04, 0.12);
  const betaM = haze / hM;
  return {
    radius: R + thickness,
    thickness,
    hR,
    hM,
    betaR,
    betaM,
    mieG: opts.mieG ?? rng.range(0.72, 0.84),
    tint: t,
  };
}

function pickSkyTint(rng, kind) {
  switch (kind) {
    case 'blue':
      return [rng.range(0.14, 0.26), rng.range(0.38, 0.52), 1.0];
    case 'warm':
      return [1.0, rng.range(0.55, 0.8), rng.range(0.25, 0.45)];
    case 'pale':
      return [rng.range(0.45, 0.6), rng.range(0.65, 0.8), 1.0];
    case 'toxic':
      return [rng.range(0.6, 0.85), 1.0, rng.range(0.15, 0.35)];
    case 'red':
      return [1.0, rng.range(0.3, 0.45), rng.range(0.2, 0.3)];
    default: {
      const c = hsl(rng.float(), rng.range(0.55, 0.85), 0.55);
      return [c[0] * c[0], c[1] * c[1], c[2] * c[2]];
    }
  }
}

function baseTerrain(rng, R) {
  return {
    contFreq: rng.range(1.1, 2.0),
    contAmp: rng.range(70, 140),
    landBias: rng.range(-0.08, 0.2),
    mountFreq: R / rng.range(420, 800),
    mountAmp: rng.range(90, 220),
    mountSharp: rng.range(1.6, 2.6),
    mountMaskLo: rng.range(-0.1, 0.1),
    hillFreq: R / rng.range(90, 180),
    hillAmp: rng.range(10, 32),
    detailFreq: R / rng.range(11, 16),
    detailAmp: rng.range(0.6, 1.6),
    warp: rng.range(0.04, 0.18),
    oceanDepth: rng.range(1.6, 2.6),
    dunes: null,
    terrace: null,
    craters: null,
    spires: null,
    snowLine: rng.range(140, 220),
    polarCap: rng.range(0.82, 0.95),
    beach: rng.range(2.5, 6),
  };
}

function makeCraters(rng, R, count, minR, maxR) {
  const list = [];
  for (let i = 0; i < count; i++) {
    const d = r3(rng);
    const radius = Math.pow(rng.float(), 2.2) * (maxR - minR) + minR; // many small, few large
    const ang = radius / R;
    list.push({ d, ang, depth: radius * rng.range(0.18, 0.3) });
  }
  return list;
}

export function generatePlanet(seed, opts = {}) {
  const rng = new Rng(hashInts(seed, 0xbeef));
  let biome = opts.biome;
  if (!biome) {
    const entries = Object.entries(BIOMES).map(([k, v]) => [k, v.weight]);
    biome = rng.weighted(entries);
    if (opts.moon && (biome === 'lush' || biome === 'ocean')) biome = rng.pick(['barren', 'frozen', 'barren', 'volcanic']);
  }
  const R = opts.radius ?? (opts.moon ? rng.range(1300, 1900) : rng.range(2600, 4000));
  const terrain = baseTerrain(rng, R);
  const pal = {};
  let liquid = null;
  let atmo = null;
  let clouds = null;
  let hazard = null;
  let flora = { density: 0, trees: [], bushes: [], grass: false };
  let fauna = { density: 0 };
  const res = { ferrite: 1, crystal: 0.6, gold: 0.08, oxygen: 0, sodium: 0 };
  const accent = rng.float();

  const rockColor = () => hsl(rng.float(), rng.range(0.04, 0.16), rng.range(0.28, 0.4));

  switch (biome) {
    case 'lush':
    case 'ocean': {
      const hue = rng.chance(0.68)
        ? rng.range(0.2, 0.37)
        : rng.pick([rng.range(0.0, 0.07), rng.range(0.07, 0.13), rng.range(0.4, 0.48), rng.range(0.78, 0.95)]);
      pal.groundA = hsl(hue, rng.range(0.34, 0.52), rng.range(0.27, 0.34));
      pal.groundB = hsl(hue + rng.range(-0.06, 0.06), rng.range(0.3, 0.5), rng.range(0.2, 0.28));
      pal.sand = hsl(rng.range(0.09, 0.14), rng.range(0.3, 0.48), rng.range(0.6, 0.7));
      pal.rock = rockColor();
      pal.highland = mixColor(pal.groundB, pal.rock, 0.4);
      pal.snow = [0.92, 0.95, 0.98];
      liquid = 'water';
      pal.liquidShallow = hsl(rng.range(0.44, 0.52), rng.range(0.5, 0.7), rng.range(0.38, 0.46));
      pal.liquidDeep = hsl(rng.range(0.55, 0.63), rng.range(0.6, 0.8), rng.range(0.1, 0.16));
      atmo = makeAtmosphere(rng, R, pickSkyTint(rng, rng.chance(0.7) ? 'blue' : 'any'));
      clouds = rng.chance(0.85) ? { coverage: rng.range(0.42, 0.62), color: [1, 1, 1], alt: rng.range(0.075, 0.1) } : null;
      pal.foliage = [
        hsl(hue + rng.range(-0.04, 0.04), rng.range(0.5, 0.7), rng.range(0.26, 0.34)),
        hsl(hue + rng.range(-0.1, 0.1), rng.range(0.5, 0.75), rng.range(0.32, 0.42)),
        hsl(accent, rng.range(0.55, 0.8), rng.range(0.45, 0.6)),
      ];
      pal.trunk = hsl(rng.range(0.04, 0.1), rng.range(0.25, 0.45), rng.range(0.17, 0.25));
      flora = {
        density: rng.range(0.75, 1.0),
        trees: pickSome(rng, ['round', 'cone', 'palm', 'mushroom', 'tall'], 2),
        bushes: pickSome(rng, ['bush', 'fern', 'bulb'], 2),
        grass: true,
      };
      fauna = { density: rng.range(0.7, 1.0) };
      hazard = rng.chance(0.25) ? { type: rng.pick(['heat', 'cold']), level: rng.range(0.1, 0.3) } : null;
      res.oxygen = 1;
      res.sodium = 0.3;
      if (biome === 'ocean') {
        terrain.landBias = rng.range(-0.36, -0.22);
        terrain.contAmp = rng.range(90, 150);
        terrain.mountAmp *= 0.6;
      }
      break;
    }
    case 'desert': {
      const hue = rng.range(0.035, 0.11);
      pal.groundA = hsl(hue, rng.range(0.45, 0.65), rng.range(0.5, 0.6));
      pal.groundB = hsl(hue + rng.range(-0.02, 0.03), rng.range(0.4, 0.6), rng.range(0.4, 0.5));
      pal.sand = pal.groundA;
      pal.rock = hsl(hue - rng.range(0, 0.03), rng.range(0.3, 0.45), rng.range(0.28, 0.36));
      pal.highland = hsl(hue - 0.02, rng.range(0.4, 0.55), rng.range(0.32, 0.4));
      pal.snow = [0.95, 0.92, 0.86];
      terrain.dunes = { amp: rng.range(7, 16), scale: rng.range(55, 110), axis: r3(rng) };
      terrain.terrace = rng.chance(0.7) ? { step: rng.range(14, 30), strength: rng.range(0.6, 1) } : null;
      terrain.snowLine = 9999;
      terrain.polarCap = 2;
      if (rng.chance(0.12)) {
        liquid = 'water';
        pal.liquidShallow = hsl(0.47, 0.55, 0.42);
        pal.liquidDeep = hsl(0.56, 0.6, 0.18);
        terrain.landBias = rng.range(0.1, 0.3);
      }
      atmo = makeAtmosphere(rng, R, pickSkyTint(rng, rng.chance(0.6) ? 'warm' : 'pale'), { haze: rng.range(0.1, 0.2) });
      clouds = rng.chance(0.2) ? { coverage: rng.range(0.3, 0.45), color: [1, 0.95, 0.88], alt: 0.085 } : null;
      pal.foliage = [hsl(rng.range(0.2, 0.33), 0.35, 0.32), hsl(rng.range(0.06, 0.12), 0.45, 0.35), hsl(accent, 0.7, 0.55)];
      pal.trunk = hsl(0.07, 0.3, 0.3);
      flora = { density: rng.range(0.15, 0.3), trees: ['cactus'], bushes: ['deadbush', 'bulb'], grass: false };
      fauna = { density: rng.range(0.25, 0.5) };
      hazard = { type: 'heat', level: rng.range(0.5, 0.9) };
      res.sodium = 1;
      res.gold = 0.14;
      break;
    }
    case 'frozen': {
      const hue = rng.range(0.52, 0.64);
      pal.groundA = hsl(hue, rng.range(0.15, 0.3), rng.range(0.82, 0.9));
      pal.groundB = hsl(hue, rng.range(0.2, 0.35), rng.range(0.7, 0.8));
      pal.sand = hsl(hue, 0.2, 0.75);
      pal.rock = hsl(rng.range(0.55, 0.72), rng.range(0.05, 0.15), rng.range(0.3, 0.4));
      pal.highland = hsl(hue, 0.15, 0.9);
      pal.snow = [0.96, 0.98, 1.0];
      if (rng.chance(0.65)) {
        liquid = 'ice';
        pal.liquidShallow = hsl(rng.range(0.5, 0.56), 0.45, 0.78);
        pal.liquidDeep = hsl(rng.range(0.55, 0.6), 0.5, 0.62);
      }
      terrain.snowLine = rng.range(20, 60);
      terrain.polarCap = 0.5;
      atmo = makeAtmosphere(rng, R, pickSkyTint(rng, 'pale'), { haze: rng.range(0.06, 0.14) });
      clouds = rng.chance(0.7) ? { coverage: rng.range(0.45, 0.65), color: [0.95, 0.97, 1], alt: 0.08 } : null;
      pal.foliage = [hsl(rng.range(0.4, 0.55), 0.35, 0.3), hsl(rng.range(0.55, 0.7), 0.4, 0.55), hsl(accent, 0.6, 0.6)];
      pal.trunk = hsl(0.08, 0.2, 0.2);
      flora = { density: rng.range(0.2, 0.4), trees: ['cone'], bushes: ['frost', 'fern'], grass: false };
      fauna = { density: rng.range(0.3, 0.55) };
      hazard = { type: 'cold', level: rng.range(0.5, 0.9) };
      res.sodium = 1;
      res.crystal = 0.9;
      break;
    }
    case 'toxic': {
      const hue = rng.chance(0.65) ? rng.range(0.13, 0.26) : rng.range(0.74, 0.86);
      pal.groundA = hsl(hue, rng.range(0.45, 0.65), rng.range(0.3, 0.4));
      pal.groundB = hsl(hue + rng.range(-0.05, 0.05), rng.range(0.35, 0.55), rng.range(0.22, 0.3));
      pal.sand = hsl(hue + 0.03, 0.4, 0.5);
      pal.rock = hsl(hue + 0.5, rng.range(0.1, 0.2), rng.range(0.25, 0.32));
      pal.highland = mixColor(pal.groundA, pal.rock, 0.5);
      pal.snow = hsl(hue, 0.3, 0.8);
      terrain.snowLine = 9999;
      terrain.polarCap = 2;
      terrain.hillAmp *= 1.4;
      if (rng.chance(0.65)) {
        liquid = 'acid';
        const lh = rng.range(0.16, 0.3);
        pal.liquidShallow = hsl(lh, 0.85, 0.5);
        pal.liquidDeep = hsl(lh + 0.05, 0.8, 0.25);
      }
      atmo = makeAtmosphere(rng, R, pickSkyTint(rng, 'toxic'), { haze: rng.range(0.2, 0.35), strength: rng.range(0.3, 0.42) });
      clouds = rng.chance(0.6) ? { coverage: rng.range(0.4, 0.6), color: [0.9, 1, 0.7], alt: 0.08 } : null;
      pal.foliage = [hsl(hue + 0.1, 0.6, 0.35), hsl(hue + 0.45, 0.55, 0.45), hsl(accent, 0.8, 0.55)];
      pal.trunk = hsl(hue + 0.5, 0.3, 0.25);
      flora = { density: rng.range(0.45, 0.7), trees: pickSome(rng, ['mushroom', 'tube', 'bulbtree'], 2), bushes: ['bulb', 'shroom'], grass: false };
      fauna = { density: rng.range(0.25, 0.5) };
      hazard = { type: rng.chance(0.7) ? 'toxic' : 'radiation', level: rng.range(0.55, 0.9) };
      res.oxygen = 0.6;
      res.sodium = 0.6;
      break;
    }
    case 'barren': {
      const hue = rng.range(0, 0.14);
      pal.groundA = hsl(hue, rng.range(0.02, 0.2), rng.range(0.38, 0.5));
      pal.groundB = hsl(hue, rng.range(0.02, 0.18), rng.range(0.3, 0.38));
      pal.sand = pal.groundA;
      pal.rock = hsl(hue, 0.08, 0.26);
      pal.highland = hsl(hue, 0.08, 0.55);
      pal.snow = [0.85, 0.85, 0.85];
      terrain.mountAmp *= 0.6;
      terrain.contAmp *= 0.6;
      terrain.craters = makeCraters(rng, R, rng.int(30, 60), 25, 380);
      terrain.snowLine = 9999;
      terrain.polarCap = rng.chance(0.4) ? 0.88 : 2;
      atmo = rng.chance(0.45) ? makeAtmosphere(rng, R, pickSkyTint(rng, 'any'), { strength: rng.range(0.08, 0.14), haze: 0.03 }) : null;
      pal.foliage = [hsl(0.1, 0.1, 0.3), hsl(0.08, 0.2, 0.25), hsl(accent, 0.6, 0.5)];
      pal.trunk = hsl(0.08, 0.1, 0.2);
      flora = { density: rng.range(0.03, 0.08), trees: [], bushes: ['deadbush'], grass: false };
      fauna = { density: rng.chance(0.15) ? 0.2 : 0 };
      hazard = rng.chance(0.4) ? { type: 'radiation', level: rng.range(0.3, 0.7) } : null;
      res.gold = 0.22;
      res.crystal = 0.8;
      break;
    }
    case 'volcanic': {
      const hue = rng.range(0, 0.08);
      pal.groundA = hsl(hue, rng.range(0.1, 0.22), rng.range(0.24, 0.3));
      pal.groundB = hsl(hue, rng.range(0.12, 0.26), rng.range(0.16, 0.21));
      pal.sand = hsl(0.05, 0.25, 0.28);
      pal.rock = hsl(0.02, 0.22, 0.17);
      pal.highland = hsl(0.06, 0.08, 0.46);
      pal.snow = hsl(0.1, 0.05, 0.62);
      terrain.mountAmp *= 1.2;
      terrain.mountSharp = 2.8;
      terrain.snowLine = rng.range(160, 220);
      terrain.polarCap = 2;
      if (rng.chance(0.85)) {
        liquid = 'lava';
        pal.liquidShallow = [1.0, 0.55, 0.12];
        pal.liquidDeep = [0.85, 0.18, 0.03];
      }
      atmo = makeAtmosphere(rng, R, pickSkyTint(rng, 'red'), { haze: rng.range(0.18, 0.3) });
      clouds = rng.chance(0.5) ? { coverage: rng.range(0.4, 0.55), color: [0.45, 0.4, 0.4], alt: 0.085 } : null;
      pal.foliage = [hsl(0.02, 0.5, 0.25), hsl(0.1, 0.6, 0.35), hsl(accent, 0.7, 0.5)];
      pal.trunk = hsl(0, 0.1, 0.12);
      flora = { density: rng.range(0.06, 0.15), trees: ['spike'], bushes: ['deadbush'], grass: false };
      fauna = { density: rng.chance(0.3) ? 0.2 : 0 };
      hazard = { type: 'heat', level: rng.range(0.75, 1.0) };
      res.gold = 0.25;
      res.sodium = 0.8;
      break;
    }
    case 'exotic':
    default: {
      const hue = rng.float();
      pal.groundA = hsl(hue, rng.range(0.55, 0.8), rng.range(0.38, 0.5));
      pal.groundB = hsl(hue + rng.range(0.08, 0.3) * rng.sign(), rng.range(0.5, 0.75), rng.range(0.3, 0.42));
      pal.sand = hsl(hue + 0.5, 0.4, 0.7);
      pal.rock = hsl(hue + 0.5, rng.range(0.15, 0.35), rng.range(0.2, 0.3));
      pal.highland = hsl(hue + 0.15, 0.6, 0.6);
      pal.snow = hsl(hue + 0.25, 0.4, 0.9);
      terrain.spires = { amp: rng.range(30, 70), freq: R / rng.range(35, 70), threshold: rng.range(0.55, 0.7) };
      terrain.terrace = rng.chance(0.5) ? { step: rng.range(10, 24), strength: 1 } : null;
      if (rng.chance(0.5)) {
        liquid = 'water';
        const wh = rng.float();
        pal.liquidShallow = hsl(wh, 0.6, 0.5);
        pal.liquidDeep = hsl(wh + 0.05, 0.7, 0.18);
      }
      atmo = makeAtmosphere(rng, R, pickSkyTint(rng, 'any'), { haze: rng.range(0.06, 0.16) });
      clouds = rng.chance(0.5) ? { coverage: rng.range(0.35, 0.55), color: hsl(rng.float(), 0.4, 0.9), alt: 0.08 } : null;
      pal.foliage = [hsl(hue + 0.3, 0.7, 0.45), hsl(hue + 0.55, 0.7, 0.5), hsl(accent, 0.8, 0.6)];
      pal.trunk = hsl(hue + 0.6, 0.4, 0.3);
      flora = { density: rng.range(0.5, 0.75), trees: pickSome(rng, ['crystaltree', 'spiral', 'bulbtree', 'mushroom'], 2), bushes: ['bulb', 'frost'], grass: rng.chance(0.5) };
      fauna = { density: rng.range(0.4, 0.8) };
      hazard = rng.chance(0.3) ? { type: rng.pick(['radiation', 'toxic']), level: rng.range(0.2, 0.5) } : null;
      res.oxygen = 0.7;
      res.gold = 0.12;
      break;
    }
  }

  if (!liquid) terrain.beach = 0;

  const ring = !opts.moon && rng.chance(0.28)
    ? {
        inner: R * rng.range(1.55, 1.9),
        outer: R * rng.range(2.3, 3.1),
        color: hsl(rng.float(), rng.range(0.1, 0.35), rng.range(0.6, 0.8)),
        normal: tiltedAxis(rng),
        seed: rng.int(1, 1e9),
      }
    : null;

  const hazardLevel = hazard ? hazard.level : 0;

  return {
    seed: seed >>> 0,
    biome,
    moon: !!opts.moon,
    radius: R,
    terrain,
    liquid,
    palette: pal,
    atmo,
    clouds,
    ring,
    flora,
    fauna,
    hazard,
    hazardLevel,
    resources: res,
    sentinel: rng.range(0, 1),
  };
}

function pickSome(rng, arr, n) {
  const copy = arr.slice();
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rng.float() * copy.length), 1)[0]);
  return out;
}

function tiltedAxis(rng) {
  const tilt = rng.range(0.1, 0.5);
  const az = rng.range(0, Math.PI * 2);
  return [Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)];
}

// ---------------------------------------------------------------------------
// Sampler

export function createSampler(params) {
  const t = params.terrain;
  const R = params.radius;
  const s = params.seed;
  const nCont = new Simplex(hashInts(s, 1));
  const nMount = new Simplex(hashInts(s, 2));
  const nHill = new Simplex(hashInts(s, 3));
  const nWarp = new Simplex(hashInts(s, 4));
  const nMisc = new Simplex(hashInts(s, 5));
  const hasLiquid = !!params.liquid;

  const contFreq = t.contFreq, contAmp = t.contAmp, landBias = t.landBias;
  const mountFreq = t.mountFreq, mountAmp = t.mountAmp, mountSharp = t.mountSharp, mLo = t.mountMaskLo;
  const hillFreq = t.hillFreq, hillAmp = t.hillAmp;
  const detailFreq = t.detailFreq, detailAmp = t.detailAmp;
  const warp = t.warp, oceanDepth = t.oceanDepth;
  const dunes = t.dunes, terrace = t.terrace, spires = t.spires;
  const craters = t.craters;
  const craterDirs = craters ? new Float64Array(craters.length * 3) : null;
  const craterCos = craters ? new Float64Array(craters.length) : null;
  if (craters) {
    craters.forEach((c, i) => {
      craterDirs[i * 3] = c.d[0];
      craterDirs[i * 3 + 1] = c.d[1];
      craterDirs[i * 3 + 2] = c.d[2];
      craterCos[i] = Math.cos(c.ang * 1.7);
    });
  }

  // Octaves whose features are smaller than ~2 vertex spacings are faded out.
  // spacing 0 means full detail (collision, flora, the finest chunks).
  function octLimit(freq, octaves, spacing) {
    if (!spacing) return octaves;
    const n = Math.log2(R / freq / (2.2 * spacing)) + 1;
    return n < 0 ? 0 : n > octaves ? octaves : n;
  }

  function height(x, y, z, spacing = 0) {
    let qx = x, qy = y, qz = z;
    if (warp > 0) {
      qx += warp * nWarp.noise(x * 2.3 + 3.3, y * 2.3, z * 2.3);
      qy += warp * nWarp.noise(x * 2.3, y * 2.3 + 7.7, z * 2.3);
      qz += warp * nWarp.noise(x * 2.3, y * 2.3, z * 2.3 + 1.9);
    }
    const c = nCont.fbm(qx * contFreq, qy * contFreq, qz * contFreq, 5) + landBias;
    let h = c * contAmp;
    const mmask = smoothstep(mLo, mLo + 0.35, c);
    if (mmask > 0.001) {
      const r = nMount.ridged(qx * mountFreq, qy * mountFreq, qz * mountFreq, 5, 2.0, 0.5, mountSharp, octLimit(mountFreq, 5, spacing));
      h += mmask * r * r * mountAmp;
    }
    const hl = octLimit(hillFreq, 4, spacing);
    if (hl > 0) h += nHill.fbm(x * hillFreq, y * hillFreq, z * hillFreq, 4, 2, 0.5, hl) * hillAmp;

    if (dunes) {
      const ax = dunes.axis;
      const along = (x * ax[0] + y * ax[1] + z * ax[2]) * (R / dunes.scale);
      const wob = nMisc.noise(x * R / 300, y * R / 300, z * R / 300) * 2.5;
      let f = along + wob;
      f = f - Math.floor(f);
      const prof = f < 0.72 ? f / 0.72 : (1 - f) / 0.28;
      const mask = smoothstep(-0.2, 0.3, nMisc.noise(x * 3.1 + 9, y * 3.1, z * 3.1));
      h += prof * prof * dunes.amp * mask;
    }

    if (spires) {
      const n = nMisc.noise(x * spires.freq, y * spires.freq, z * spires.freq);
      if (n > spires.threshold) {
        const k = (n - spires.threshold) / (1 - spires.threshold);
        h += Math.sqrt(k) * spires.amp;
      }
    }

    if (terrace && h > 0) {
      const st = terrace.step;
      const tt = h / st;
      const fl = Math.floor(tt);
      const fr = tt - fl;
      const stepped = (fl + smoothstep(0.3, 0.7, fr)) * st;
      const mask = smoothstep(-0.1, 0.25, nMisc.noise(x * 4.7 + 3, y * 4.7, z * 4.7)) * terrace.strength;
      h = h + (stepped - h) * mask;
    }

    if (craterDirs) {
      const n = craterCos.length;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const d = x * craterDirs[i3] + y * craterDirs[i3 + 1] + z * craterDirs[i3 + 2];
        if (d < craterCos[i]) continue;
        const cr = craters[i];
        const dist = Math.acos(Math.min(1, d)) / cr.ang;
        if (dist < 1) h += cr.depth * (dist * dist - 1);
        const rim = (dist - 1) / 0.28;
        h += cr.depth * 0.32 * Math.exp(-rim * rim);
      }
    }

    const dl = octLimit(detailFreq, 2, spacing);
    if (dl > 0) h += nHill.fbm(x * detailFreq + 11.1, y * detailFreq, z * detailFreq, 2, 2, 0.5, dl) * detailAmp;

    if (hasLiquid && h < 0) h *= oceanDepth;
    return h;
  }

  // Displayed ground height, liquids flatten to sea level.
  function groundHeight(x, y, z) {
    const h = height(x, y, z);
    return hasLiquid && h < 0 ? 0 : h;
  }

  const pal = params.palette;
  const snowLine = t.snowLine;
  const polarCap = t.polarCap;
  const beach = t.beach;
  const out = [0, 0, 0];

  // Surface color in sRGB 0..1 given direction, raw height, and slope (0 flat .. 1 vertical)
  function colorAt(x, y, z, h, slope, target = out, spacing = 0) {
    if (hasLiquid && h < 0) {
      const d = clamp(-h / 60, 0, 1);
      const k = Math.sqrt(d);
      target[0] = pal.liquidShallow[0] + (pal.liquidDeep[0] - pal.liquidShallow[0]) * k;
      target[1] = pal.liquidShallow[1] + (pal.liquidDeep[1] - pal.liquidShallow[1]) * k;
      target[2] = pal.liquidShallow[2] + (pal.liquidDeep[2] - pal.liquidShallow[2]) * k;
      return target;
    }
    const m = nMisc.fbm(x * 9 + 2.2, y * 9, z * 9, 3) * 0.5 + 0.5;
    const fineW = spacing ? clamp(18 / (2.2 * spacing) - 0.5, 0, 1) : 1;
    const fine = fineW > 0 ? nMisc.noise(x * R / 18, y * R / 18, z * R / 18) * fineW : 0;
    let r = pal.groundA[0] + (pal.groundB[0] - pal.groundA[0]) * m;
    let g = pal.groundA[1] + (pal.groundB[1] - pal.groundA[1]) * m;
    let b = pal.groundA[2] + (pal.groundB[2] - pal.groundA[2]) * m;
    // highlands
    const ht = smoothstep(snowLine * 0.35, snowLine * 0.75, h + fine * 12);
    if (ht > 0) {
      r += (pal.highland[0] - r) * ht;
      g += (pal.highland[1] - g) * ht;
      b += (pal.highland[2] - b) * ht;
    }
    // beaches
    if (beach > 0) {
      const bt = 1 - smoothstep(beach * 0.5, beach * 1.25, h + fine * 1.5);
      if (bt > 0) {
        r += (pal.sand[0] - r) * bt;
        g += (pal.sand[1] - g) * bt;
        b += (pal.sand[2] - b) * bt;
      }
    }
    // cliffs
    const rt = smoothstep(0.22, 0.42, slope + fine * 0.05);
    if (rt > 0) {
      r += (pal.rock[0] - r) * rt;
      g += (pal.rock[1] - g) * rt;
      b += (pal.rock[2] - b) * rt;
    }
    // snow
    const lat = Math.abs(y);
    let st = Math.max(smoothstep(snowLine, snowLine + 30, h + fine * 20), smoothstep(polarCap, polarCap + 0.04, lat + fine * 0.02));
    st *= 1 - smoothstep(0.3, 0.5, slope);
    if (st > 0) {
      r += (pal.snow[0] - r) * st;
      g += (pal.snow[1] - g) * st;
      b += (pal.snow[2] - b) * st;
    }
    const v = 0.93 + fine * 0.07;
    target[0] = r * v;
    target[1] = g * v;
    target[2] = b * v;
    return target;
  }

  return { params, R, hasLiquid, height, groundHeight, colorAt };
}

// ---------------------------------------------------------------------------
// Cube sphere mapping. Faces are right handed so (a x b) points outward.

export function cubeToSphere(face, u, v, out, o) {
  let x, y, z;
  switch (face) {
    case 0: x = 1; y = v; z = -u; break;
    case 1: x = -1; y = v; z = u; break;
    case 2: x = u; y = 1; z = -v; break;
    case 3: x = u; y = -1; z = v; break;
    case 4: x = u; y = v; z = 1; break;
    default: x = -u; y = v; z = -1; break;
  }
  const x2 = x * x, y2 = y * y, z2 = z * z;
  out[o] = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3);
  out[o + 1] = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3);
  out[o + 2] = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3);
}

// Build one terrain chunk. Returns typed arrays ready to become a BufferGeometry.
// Grid is (N+1)^2 vertices plus a skirt of 4*(N+1) vertices hanging below the edges.
export function buildChunk(sampler, face, level, ix, iy, N) {
  const R = sampler.R;
  const size = 2 / (1 << level);
  const u0 = -1 + ix * size;
  const v0 = -1 + iy * size;
  const step = size / N;
  const G = N + 3;
  const dirs = new Float64Array(G * G * 3);
  const hts = new Float64Array(G * G);
  const pos = new Float64Array(G * G * 3);
  const liquid = sampler.hasLiquid;
  const worldSpacing = (Math.PI / 2) * R * (size / 2) / N;
  const lodSpacing = level >= 5 ? worldSpacing * 0.5 : worldSpacing;

  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const k = j * G + i;
      cubeToSphere(face, u0 + (i - 1) * step, v0 + (j - 1) * step, dirs, k * 3);
      const x = dirs[k * 3], y = dirs[k * 3 + 1], z = dirs[k * 3 + 2];
      const h = sampler.height(x, y, z, lodSpacing);
      hts[k] = h;
      const r = R + (liquid && h < 0 ? 0 : h);
      pos[k * 3] = x * r;
      pos[k * 3 + 1] = y * r;
      pos[k * 3 + 2] = z * r;
    }
  }

  // chunk origin: center direction at base radius (keeps float32 offsets small)
  const cdir = [0, 0, 0];
  cubeToSphere(face, u0 + size / 2, v0 + size / 2, cdir, 0);
  const cx = cdir[0] * R, cy = cdir[1] * R, cz = cdir[2] * R;

  const V = (N + 1) * (N + 1);
  const S = 4 * (N + 1);
  const positions = new Float32Array((V + S) * 3);
  const normals = new Float32Array((V + S) * 3);
  const colors = new Uint8Array((V + S) * 4);
  const col = [0, 0, 0];
  let minR = Infinity, maxR = -Infinity, maxD2 = 0;
  let hasWater = false;

  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const g = (j + 1) * G + (i + 1);
      const gL = g - 1, gR = g + 1, gD = g - G, gU = g + G;
      const dux = pos[gR * 3] - pos[gL * 3], duy = pos[gR * 3 + 1] - pos[gL * 3 + 1], duz = pos[gR * 3 + 2] - pos[gL * 3 + 2];
      const dvx = pos[gU * 3] - pos[gD * 3], dvy = pos[gU * 3 + 1] - pos[gD * 3 + 1], dvz = pos[gU * 3 + 2] - pos[gD * 3 + 2];
      let nx = duy * dvz - duz * dvy;
      let ny = duz * dvx - dux * dvz;
      let nz = dux * dvy - duy * dvx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const v = j * (N + 1) + i;
      const px = pos[g * 3] - cx, py = pos[g * 3 + 1] - cy, pz = pos[g * 3 + 2] - cz;
      positions[v * 3] = px;
      positions[v * 3 + 1] = py;
      positions[v * 3 + 2] = pz;
      normals[v * 3] = nx;
      normals[v * 3 + 1] = ny;
      normals[v * 3 + 2] = nz;
      const dx = dirs[g * 3], dy = dirs[g * 3 + 1], dz = dirs[g * 3 + 2];
      const slope = 1 - (nx * dx + ny * dy + nz * dz);
      const h = hts[g];
      sampler.colorAt(dx, dy, dz, h, slope, col, lodSpacing);
      colors[v * 4] = Math.round(clamp(col[0], 0, 1) * 255);
      colors[v * 4 + 1] = Math.round(clamp(col[1], 0, 1) * 255);
      colors[v * 4 + 2] = Math.round(clamp(col[2], 0, 1) * 255);
      const wet = liquid && h < 0;
      if (wet) hasWater = true;
      colors[v * 4 + 3] = wet ? 255 : 0;
      const r = R + (wet ? 0 : h);
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      const d2 = px * px + py * py + pz * pz;
      if (d2 > maxD2) maxD2 = d2;
    }
  }

  // Skirts: bottom edge (j=0), top edge (j=N), left (i=0), right (i=N)
  const skirt = worldSpacing * 1.6 + 1.5;
  let s = V;
  const edge = (i, j) => {
    const v = j * (N + 1) + i;
    const g = (j + 1) * G + (i + 1);
    positions[s * 3] = positions[v * 3] - dirs[g * 3] * skirt;
    positions[s * 3 + 1] = positions[v * 3 + 1] - dirs[g * 3 + 1] * skirt;
    positions[s * 3 + 2] = positions[v * 3 + 2] - dirs[g * 3 + 2] * skirt;
    normals[s * 3] = normals[v * 3];
    normals[s * 3 + 1] = normals[v * 3 + 1];
    normals[s * 3 + 2] = normals[v * 3 + 2];
    colors[s * 4] = colors[v * 4];
    colors[s * 4 + 1] = colors[v * 4 + 1];
    colors[s * 4 + 2] = colors[v * 4 + 2];
    colors[s * 4 + 3] = colors[v * 4 + 3];
    s++;
  };
  for (let i = 0; i <= N; i++) edge(i, 0);
  for (let i = 0; i <= N; i++) edge(i, N);
  for (let j = 0; j <= N; j++) edge(0, j);
  for (let j = 0; j <= N; j++) edge(N, j);

  return {
    positions,
    normals,
    colors,
    center: [cx, cy, cz],
    radius: Math.sqrt(maxD2) + skirt,
    minR,
    maxR,
    hasWater,
  };
}

// Index buffer shared by every chunk with the same N (grid + skirts)
export function buildChunkIndices(N) {
  const V = (N + 1) * (N + 1);
  const tris = N * N * 2 + 4 * N * 2;
  const idx = new Uint32Array(tris * 3);
  let o = 0;
  const vi = (i, j) => j * (N + 1) + i;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = vi(i, j), b = vi(i + 1, j), c = vi(i, j + 1), d = vi(i + 1, j + 1);
      idx[o++] = a; idx[o++] = b; idx[o++] = c;
      idx[o++] = b; idx[o++] = d; idx[o++] = c;
    }
  }
  const sBottom = V, sTop = V + (N + 1), sLeft = V + 2 * (N + 1), sRight = V + 3 * (N + 1);
  for (let i = 0; i < N; i++) {
    // bottom edge faces -b
    let e0 = vi(i, 0), e1 = vi(i + 1, 0), s0 = sBottom + i, s1 = sBottom + i + 1;
    idx[o++] = e0; idx[o++] = s0; idx[o++] = e1;
    idx[o++] = e1; idx[o++] = s0; idx[o++] = s1;
    // top edge faces +b
    e0 = vi(i, N); e1 = vi(i + 1, N); s0 = sTop + i; s1 = sTop + i + 1;
    idx[o++] = e0; idx[o++] = e1; idx[o++] = s0;
    idx[o++] = e1; idx[o++] = s1; idx[o++] = s0;
  }
  for (let j = 0; j < N; j++) {
    // left edge faces -a
    let e0 = vi(0, j), e1 = vi(0, j + 1), s0 = sLeft + j, s1 = sLeft + j + 1;
    idx[o++] = e0; idx[o++] = e1; idx[o++] = s0;
    idx[o++] = e1; idx[o++] = s1; idx[o++] = s0;
    // right edge faces +a
    e0 = vi(N, j); e1 = vi(N, j + 1); s0 = sRight + j; s1 = sRight + j + 1;
    idx[o++] = e0; idx[o++] = s0; idx[o++] = e1;
    idx[o++] = e1; idx[o++] = s0; idx[o++] = s1;
  }
  return idx;
}
