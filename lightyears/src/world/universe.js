// The galaxy: a spiral of procedurally placed stars around the Center of the Universe.
// Coordinates are in lightyears with the core at the origin and the disk in the XZ plane.

import { Rng, hashInts } from '../core/rng.js';
import { systemName, planetName, stationName } from '../core/names.js';
import { generatePlanet } from './planetgen.js';
import { hsl } from './color.js';

export const SECTOR = 220; // ly per sector cube
export const START_DISTANCE = 9180; // ly from the core, a nod to the 918
export const CORE_RADIUS = 260; // inside this you have reached the Center of the Universe
export const CENTER_ID = 'core';

export const STAR_CLASSES = {
  G: { label: 'Yellow dwarf', color: [1.0, 0.93, 0.8], weight: 30 },
  K: { label: 'Orange dwarf', color: [1.0, 0.78, 0.55], weight: 24 },
  M: { label: 'Red dwarf', color: [1.0, 0.55, 0.42], weight: 20 },
  F: { label: 'White star', color: [0.95, 0.97, 1.0], weight: 12 },
  B: { label: 'Blue giant', color: [0.65, 0.78, 1.0], weight: 8 },
  E: { label: 'Emerald star', color: [0.55, 1.0, 0.6], weight: 6 },
};

function densityAt(x, y, z) {
  const r = Math.sqrt(x * x + z * z);
  const vertical = Math.exp(-Math.abs(y) / (260 + r * 0.02));
  const radial = Math.exp(-r / 6500) + 0.6 * Math.exp(-r / 1500);
  // two logarithmic spiral arms
  const theta = Math.atan2(z, x);
  const armPhase = Math.log(Math.max(r, 200) / 400) / Math.tan(0.28);
  let arm = 0;
  for (let k = 0; k < 2; k++) {
    let d = theta - armPhase - k * Math.PI;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    arm = Math.max(arm, Math.exp(-(d * d) / 0.35));
  }
  return vertical * radial * (0.35 + 0.65 * arm);
}

function starInSector(galaxySeed, ix, iy, iz, i, rng) {
  const px = (ix + rng.float()) * SECTOR;
  const py = (iy + rng.float()) * SECTOR;
  const pz = (iz + rng.float()) * SECTOR;
  const seed = hashInts(galaxySeed, ix, iy, iz, i);
  const srng = new Rng(seed);
  const cls = srng.weighted(Object.entries(STAR_CLASSES).map(([k, v]) => [k, v.weight]));
  return {
    id: `${ix},${iy},${iz},${i}`,
    pos: [px, py, pz],
    seed,
    cls,
    color: STAR_CLASSES[cls].color,
    name: systemName(seed),
    planets: srng.int(2, 5),
  };
}

function sectorStars(galaxySeed, ix, iy, iz) {
  const cx = (ix + 0.5) * SECTOR, cy = (iy + 0.5) * SECTOR, cz = (iz + 0.5) * SECTOR;
  if (Math.hypot(cx, cy, cz) < CORE_RADIUS) return [];
  const rng = new Rng(hashInts(galaxySeed, ix, iy, iz, 99));
  const d = densityAt(cx, cy, cz) * 2.2;
  const count = Math.min(4, Math.floor(d + rng.float()));
  const out = [];
  for (let i = 0; i < count; i++) out.push(starInSector(galaxySeed, ix, iy, iz, i, rng));
  return out;
}

// All stars within `radius` ly of point c
export function starsNear(galaxySeed, c, radius) {
  const out = [];
  const x0 = Math.floor((c[0] - radius) / SECTOR), x1 = Math.floor((c[0] + radius) / SECTOR);
  const y0 = Math.floor((c[1] - radius) / SECTOR), y1 = Math.floor((c[1] + radius) / SECTOR);
  const z0 = Math.floor((c[2] - radius) / SECTOR), z1 = Math.floor((c[2] + radius) / SECTOR);
  const r2 = radius * radius;
  for (let ix = x0; ix <= x1; ix++) {
    for (let iy = y0; iy <= y1; iy++) {
      for (let iz = z0; iz <= z1; iz++) {
        for (const s of sectorStars(galaxySeed, ix, iy, iz)) {
          const dx = s.pos[0] - c[0], dy = s.pos[1] - c[1], dz = s.pos[2] - c[2];
          if (dx * dx + dy * dy + dz * dz <= r2) out.push(s);
        }
      }
    }
  }
  return out;
}

export function coreStar() {
  return {
    id: CENTER_ID,
    pos: [0, 0, 0],
    seed: 918918,
    cls: 'G',
    color: [1, 0.9, 0.7],
    name: 'The Center of the Universe',
    planets: 1,
    core: true,
  };
}

export function starById(galaxySeed, id) {
  if (id === CENTER_ID) return coreStar();
  const [ix, iy, iz, i] = id.split(',').map(Number);
  return sectorStars(galaxySeed, ix, iy, iz)[i] || null;
}

// Pick the start star: nearest to a point START_DISTANCE out on a spiral arm
export function startStar(galaxySeed) {
  const rng = new Rng(hashInts(galaxySeed, 4242));
  const ang = rng.range(0, Math.PI * 2);
  const p = [Math.cos(ang) * START_DISTANCE, 0, Math.sin(ang) * START_DISTANCE];
  let best = null;
  for (let radius = 300; !best && radius < 3000; radius += 300) {
    const stars = starsNear(galaxySeed, p, radius);
    for (const s of stars) {
      const d = Math.hypot(s.pos[0] - p[0], s.pos[1] - p[1], s.pos[2] - p[2]);
      if (!best || d < best.d) best = { s, d };
    }
  }
  const s = best.s;
  s.name = 'Tulsa Prime';
  s.home = true;
  return s;
}

export function distanceToCore(star) {
  return Math.hypot(star.pos[0], star.pos[1], star.pos[2]);
}

// ---------------------------------------------------------------------------
// Star system contents

export function generateSystem(star, galaxySeed) {
  const rng = new Rng(hashInts(star.seed, 777));
  const core = !!star.core;
  const home = !!star.home;
  const count = core ? 1 : home ? 3 : star.planets;
  const planets = [];
  const placed = [];
  const plane = rng.range(-0.15, 0.15);

  for (let i = 0; i < count; i++) {
    const pseed = hashInts(star.seed, 1000 + i);
    let opts = {};
    if (home && i === 0) opts = { biome: 'lush', radius: 3000 };
    if (home && i === 1) opts = { biome: 'barren' };
    if (core) opts = { biome: 'exotic', radius: 3600 };
    const params = generatePlanet(pseed, opts);
    if (home && i === 0) {
      params.hazard = null;
      params.hazardLevel = 0;
      params.flora.density = 0.95;
      params.fauna.density = 0.9;
      params.ring = null;
      params.terrain.landBias = 0.12;
    }
    params.name = home && i === 0 ? 'Brookside' : core ? 'Heart of the Universe' : planetName(star.seed, i);
    params.index = i;
    // place on a rough disk, keep them apart
    let pos;
    for (let tries = 0; tries < 60; tries++) {
      const dist = i === 0 ? rng.range(38000, 52000) : rng.range(30000, 110000);
      const ang = rng.range(0, Math.PI * 2);
      pos = [Math.cos(ang) * dist, dist * plane + rng.range(-4000, 4000), Math.sin(ang) * dist];
      const ok = placed.every((q) => Math.hypot(q[0] - pos[0], q[1] - pos[1], q[2] - pos[2]) > 26000);
      if (ok) break;
    }
    placed.push(pos);
    params.pos = pos;
    planets.push(params);
  }

  // A moon for one of the planets sometimes
  if (!core && !home && rng.chance(0.45) && planets.length < 6) {
    const host = rng.pick(planets);
    const mseed = hashInts(star.seed, 5000);
    const moon = generatePlanet(mseed, { moon: true });
    moon.name = `${host.name} Minor`;
    moon.index = planets.length;
    const off = rng.unitVector([0, 0, 0]);
    off[1] *= 0.3;
    const ol = Math.hypot(off[0], off[1], off[2]);
    const d = host.radius * (host.ring ? 4.4 : 3.4) + moon.radius * 2.2;
    moon.pos = [host.pos[0] + (off[0] / ol) * d, host.pos[1] + (off[1] / ol) * d, host.pos[2] + (off[2] / ol) * d];
    planets.push(moon);
  }

  const main = planets[0];
  const sAng = rng.range(0, Math.PI * 2);
  const sd = main.radius * (main.ring ? 4.4 : 3.2) + 1500;
  const station = {
    name: home ? "Cain's Station" : core ? 'The Last Stop' : stationName(star.seed),
    pos: [main.pos[0] + Math.cos(sAng) * sd, main.pos[1] + rng.range(-600, 600), main.pos[2] + Math.sin(sAng) * sd],
    seed: hashInts(star.seed, 31337),
  };

  const sunAz = rng.range(0, Math.PI * 2);
  const sunEl = rng.range(0.15, 0.5);

  // Where the galactic core sits in this system's sky
  const dCore = Math.hypot(...star.pos);
  const galDir = dCore > 1 ? [-star.pos[0] / dCore, -star.pos[1] / dCore, -star.pos[2] / dCore] : [1, 0, 0];
  const nebHue = rng.float();
  const cls = STAR_CLASSES[star.cls];

  return {
    star,
    name: star.name,
    core,
    home,
    planets,
    station,
    starColor: cls.color,
    sun: { az: sunAz, el: sunEl, period: rng.range(900, 1400) },
    asteroids: rng.range(0.4, 1.0),
    backdrop: {
      seed: star.seed % 100000,
      galDir,
      galUp: [0, 1, 0],
      core: core ? 3 : Math.min(2.2, 0.35 + 2600 / Math.max(dCore, 400)),
      starColor: cls.color,
      nebA: hsl(nebHue, 0.7, 0.35).map((c) => c * 0.8),
      nebB: hsl(nebHue + rng.range(0.15, 0.4), 0.7, 0.3).map((c) => c * 0.8),
      nebula: rng.range(0.5, 1.3),
    },
  };
}
