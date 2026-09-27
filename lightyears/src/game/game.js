// The game: owns the renderer, the current star system, and the ship/foot state machine.

import * as THREE from 'three';
import { TerrainWorkerPool } from '../world/workerPool.js';
import { generateSystem, startStar, starById, distanceToCore, CENTER_ID } from '../world/universe.js';
import { BIOMES, HAZARD_LABEL } from '../world/planetgen.js';
import { Planet } from '../render/planet.js';
import { Backdrop } from '../render/backdrop.js';
import { G, makeAtmoUniforms, copyAtmoUniforms } from '../render/shaders.js';
import { setCloudRenderer } from '../render/clouds.js';
import { makeStation } from '../render/stationModel.js';
import { SpaceDust, Beam, Particles, WarpTunnel, Weather } from '../render/effects.js';
import { makeTool } from '../render/toolModel.js';
import { Ship } from './ship.js';
import { Player, EYE } from './player.js';
import { Surface } from './surface.js';
import { Fauna } from './fauna.js';
import { Inventory, RESOURCES } from './inventory.js';
import { Mining } from './mining.js';
import { Asteroids } from './asteroids.js';
import { Traffic } from './traffic.js';
import { Objectives } from './objectives.js';
import { Hud } from '../ui/hud.js';
import { Input } from '../ui/input.js';
import { Menus } from '../ui/menus.js';
import { GalaxyMap } from '../ui/galaxyMap.js';
import { Audio } from '../audio/audio.js';
import { loadSave, writeSave, clearSave, hasGame } from './save.js';

export const QUALITY = {
  low: { pixelRatio: 1.0, chunkRes: 24, leafSpacing: 2.1, splitFactor: 1.75, meshBudget: 380, detail: false, skyRes: 256, stars: 2200, floraDensity: 0.55, floraRange: 0.7, fauna: 6 },
  med: { pixelRatio: 1.5, chunkRes: 28, leafSpacing: 1.6, splitFactor: 2.0, meshBudget: 520, detail: true, skyRes: 512, stars: 3200, floraDensity: 0.85, floraRange: 0.85, fauna: 9 },
  high: { pixelRatio: 2.0, chunkRes: 32, leafSpacing: 1.3, splitFactor: 2.3, meshBudget: 720, detail: true, skyRes: 1024, stars: 4500, floraDensity: 1, floraRange: 1, fauna: 12 },
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export class Game {
  constructor() {
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    const saved = loadSave();
    const lowMem = navigator.deviceMemory && navigator.deviceMemory <= 3;
    this.settings = Object.assign(
      { quality: lowMem ? 'low' : this.isTouch ? 'med' : 'high', invertY: false, sound: true, music: 0.7, sens: 1 },
      saved?.settings || {},
    );
    this.quality = QUALITY[this.settings.quality];
    this.saved = saved;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 1);
    document.getElementById('canvas-host').appendChild(renderer.domElement);
    this.renderer = renderer;
    setCloudRenderer(renderer);
    this.resScale = 1;

    this.farScene = new THREE.Scene();
    this.nearScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.1, 1e6);
    this.fov = 68;

    const cores = navigator.hardwareConcurrency || 4;
    this.pool = new TerrainWorkerPool(Math.max(1, Math.min(3, cores - 1)));
    this.backdrop = new Backdrop(renderer, this.quality);
    this.farScene.add(this.backdrop.group);

    // atmosphere uniforms used by everything that is not terrain (copied from the nearest planet)
    this.objAtmo = makeAtmoUniforms();

    this.inv = new Inventory();
    this.hud = new Hud();
    this.input = new Input(document.getElementById('app'));
    this.input.lookSensitivity = this.settings.sens;
    this.audio = new Audio(this);
    this.ship = new Ship(this);
    this.nearScene.add(this.ship.group);
    this.player = new Player(this);
    this.mining = new Mining(this);
    this.objectives = new Objectives(this);
    this.menus = new Menus(this);
    this.map = new GalaxyMap(this);

    this.dust = new SpaceDust();
    this.nearScene.add(this.dust.points);
    this.beams = new Beam();
    this.nearScene.add(this.beams.group);
    this.particles = new Particles();
    this.nearScene.add(this.particles.points);
    this.warp = new WarpTunnel();
    this.weather = new Weather();
    this.nearScene.add(this.weather.points);
    this.tool = makeTool(this.objAtmo);
    this.toolKick = 0;

    this.planets = [];
    this.system = null;
    this.station = null;
    this.surface = null;
    this.fauna = null;
    this.asteroids = null;
    this.nearest = null;
    this.nearestDist = Infinity;
    this.mode = 'title';
    this.worldTime = 0;
    this.frame = 0;
    this.galaxySeed = 918;
    this.starId = null;
    this.visited = new Set();
    this.jumps = 0;
    this.discovered = { planets: {}, species: {}, systems: {} };
    this.mined = {};
    this.pulseAllowed = false;
    this.fps = 60;
    this.frameTimes = [];
    this.saveTimer = 0;
    this.lastTime = performance.now();
    this.titleT = 0;

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // ---------------------------------------------------------------------------
  // setup and systems

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w;
    this.height = h;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio) * this.resScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // wider view in portrait so the world does not feel like a keyhole
    this.fov = w < h ? 78 : 66;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.pixelRatio = pr;
    this.map?.resize(w, h);
  }

  minedSet(planet) {
    const key = `${this.starId}|${planet.params.index}`;
    if (!this.mined[key]) this.mined[key] = new Set();
    return this.mined[key];
  }

  loadSystem(starId) {
    this.unloadSystem();
    const star = starById(this.galaxySeed, starId) || startStar(this.galaxySeed);
    if (starId !== CENTER_ID && star && !star.home) {
      const home = startStar(this.galaxySeed);
      if (home.id === star.id) { star.name = home.name; star.home = true; }
    }
    this.starId = star.id;
    this.star = star;
    this.visited.add(star.id);
    const sys = generateSystem(star, this.galaxySeed);
    this.system = sys;
    this.backdrop.setSystem(sys.backdrop);
    this.planets = sys.planets.map((p, i) => {
      const planet = new Planet(`${star.id}:${i}`, p, this.pool, this.quality);
      this.farScene.add(planet.group);
      return planet;
    });
    const stModel = makeStation(this.objAtmo, sys.station.seed);
    const st = {
      ...sys.station,
      pos: new THREE.Vector3(...sys.station.pos),
      model: stModel,
      radius: 128,
      quat: new THREE.Quaternion(),
      forward: new THREE.Vector3(),
    };
    // face the dock toward the main planet so arrivals see the lit slot
    const toPlanet = this.planets[0].pos.clone().sub(st.pos).normalize();
    _m.lookAt(new THREE.Vector3(), toPlanet, new THREE.Vector3(0, 1, 0));
    st.quat.setFromRotationMatrix(_m);
    // lookAt points -Z at the target; our dock faces +Z, so flip
    st.quat.multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    st.forward.set(0, 0, 1).applyQuaternion(st.quat);
    stModel.group.position.copy(st.pos);
    stModel.group.quaternion.copy(st.quat);
    this.farScene.add(stModel.group);
    this.station = st;
    this.asteroids = new Asteroids(this, sys);
    this.nearScene.add(this.asteroids.group);
    this.traffic = new Traffic(this, sys);
    this.nearScene.add(this.traffic.group);
    this.starColor = sys.starColor;
    G.uSunColor.value.set(sys.starColor[0] * 2.7, sys.starColor[1] * 2.7, sys.starColor[2] * 2.7);
    this._updateSun(0);
  }

  unloadSystem() {
    this.disposeSurface();
    for (const p of this.planets) p.dispose();
    this.planets = [];
    if (this.station) {
      this.station.model.group.removeFromParent();
      this.station.model.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this.station.model.material.dispose();
      this.station = null;
    }
    if (this.asteroids) { this.asteroids.dispose(); this.asteroids = null; }
    if (this.traffic) { this.traffic.dispose(); this.traffic = null; }
    this.nearest = null;
  }

  disposeSurface() {
    if (this.surface) { this.surface.dispose(); this.surface = null; }
    if (this.fauna) { this.fauna.dispose(); this.fauna = null; }
  }

  // ---------------------------------------------------------------------------
  // new game / continue

  newGame() {
    clearSave();
    this.inv.reset();
    this.galaxySeed = 918;
    this.visited = new Set();
    this.jumps = 0;
    this.discovered = { planets: {}, species: {}, systems: {} };
    this.mined = {};
    this.objectives.reset();
    const home = startStar(this.galaxySeed);
    this.loadSystem(home.id);
    this.discovered.systems[home.id] = home.name;
    this.worldTime = 0;
    const planet = this.planets[0];
    // spawn in the morning: a spot where the sun is about 35 degrees up
    const sun = G.uSunDir.value.clone();
    const side = new THREE.Vector3(0, 1, 0).cross(sun).normalize();
    let dir = sun.clone().multiplyScalar(Math.cos(0.95)).addScaledVector(side, Math.sin(0.95)).normalize();
    dir = this._findLand(planet, dir);
    const heading = sun.clone().addScaledVector(dir, -sun.dot(dir)).normalize();
    this.ship.placeLanded(planet, dir, heading);
    this.inv.fuel.launch = 0;
    this._exitShipTo(planet, true);
    this.enterPlay();
    this.pendingCrashCrystals = true;
    this.hud.setLocation(planet.params.name, `${this.system.name} system`);
    setTimeout(() => this.hud.toast('Your launch thrusters are dry. Find blue Di-hydrogen crystals.', 'warn', 0), 2600);
  }

  continueGame() {
    const s = this.saved;
    if (!hasGame(s)) return this.newGame();
    this.galaxySeed = s.galaxySeed ?? 918;
    this.inv.load(s.inv);
    this.visited = new Set(s.visited || []);
    this.jumps = s.jumps || 0;
    this.discovered = s.discovered || { planets: {}, species: {}, systems: {} };
    this.mined = {};
    for (const [k, arr] of Object.entries(s.mined || {})) this.mined[k] = new Set(arr);
    this.objectives.load(s.objectives);
    this.worldTime = s.worldTime || 0;
    this.loadSystem(s.starId);
    this._updateSun(0);
    const sh = s.ship || {};
    if (sh.state === 'landed' && this.planets[sh.planet]) {
      const planet = this.planets[sh.planet];
      const dir = new THREE.Vector3(...sh.dir);
      this.ship.placeLanded(planet, dir, new THREE.Vector3(...sh.heading));
      if (s.mode === 'foot' && s.player) {
        this.player.spawn(planet, new THREE.Vector3(...s.player.pos), new THREE.Vector3(...s.player.fwd));
        this._setMode('foot');
        this.player.planet = planet;
      } else {
        this._setMode('ship');
      }
    } else {
      this.ship.pos.set(...(sh.pos || this.system.planets[0].pos));
      if (sh.quat) this.ship.quat.set(...sh.quat);
      this.ship.state = 'flying';
      this.ship.model.gear.visible = false;
      this.ship.speed = 0;
      this.input.setThrottle(0);
      this._setMode('ship');
    }
    this.enterPlay();
    this.hud.setLocation(this.system.name, `${Math.round(distanceToCore(this.star)).toLocaleString()} ly to the Center`);
  }

  enterPlay() {
    document.getElementById('title').classList.add('hidden');
    this.hud.show(true);
    this.input.wantsPointerLock = !this.isTouch;
    this.audio.start();
    this.playing = true;
  }

  toTitle() {
    this.save();
    this.playing = false;
    this.mode = 'title';
    this.hud.show(false);
    this.menus.close();
    this.input.releasePointer();
    this.saved = loadSave();
    document.getElementById('title').classList.remove('hidden');
    document.getElementById('btn-continue').classList.toggle('hidden', !hasGame(this.saved));
  }

  _findLand(planet, dir) {
    // spiral outward from dir looking for gentle dry ground
    const tan = new THREE.Vector3(0, 1, 0).cross(dir);
    if (tan.lengthSq() < 1e-6) tan.set(1, 0, 0);
    tan.normalize();
    const bit = new THREE.Vector3().crossVectors(dir, tan);
    const tmp = new THREE.Vector3();
    let fallback = null;
    for (let r = 0; r < 48; r++) {
      const ang = r * 2.39996;
      const dist = r * 0.0075;
      tmp.copy(dir).addScaledVector(tan, Math.cos(ang) * dist).addScaledVector(bit, Math.sin(ang) * dist).normalize();
      const h = planet.sampler.height(tmp.x, tmp.y, tmp.z);
      if (h > 4 && h < 80) {
        const slope = this._slopeAt(planet, tmp, h);
        if (slope < 0.12) return tmp.clone();
        if (!fallback && slope < 0.25) fallback = tmp.clone();
      }
    }
    return fallback || dir.clone();
  }

  _slopeAt(planet, dir, h) {
    const t = new THREE.Vector3(0, 1, 0).cross(dir);
    if (t.lengthSq() < 1e-6) t.set(1, 0, 0);
    t.normalize();
    const b = new THREE.Vector3().crossVectors(dir, t);
    const e = 3 / planet.R;
    const a = dir.clone().addScaledVector(t, e).normalize();
    const c = dir.clone().addScaledVector(b, e).normalize();
    const h1 = planet.heightAt(a.x, a.y, a.z), h2 = planet.heightAt(c.x, c.y, c.z);
    const g = Math.hypot(h1 - h, h2 - h) / 3;
    return 1 - 1 / Math.sqrt(1 + g * g);
  }

  // ---------------------------------------------------------------------------
  // modes and context actions

  _setMode(mode) {
    this.mode = mode;
    this.hud.setMode(mode === 'foot' ? 'foot' : mode === 'ship' ? 'ship' : 'none');
    this.input.clear();
    this.mining.stop();
  }

  _exitShipTo(planet, first = false) {
    const ship = this.ship;
    ship.axes();
    const local = ship.pos.clone().sub(planet.pos);
    const up = local.clone().normalize();
    // step out on the pilot's right side
    const side = ship.left.clone().negate();
    side.addScaledVector(up, -side.dot(up)).normalize();
    const spot = local.clone().addScaledVector(side, 5.5).addScaledVector(ship.forward, -1.5);
    const fwd = ship.forward.clone();
    if (first) fwd.copy(side).negate().applyAxisAngle(up, -0.6);
    this.player.spawn(planet, spot, fwd);
    this._setMode('foot');
    this.audio.sfx('door');
  }

  boardShip() {
    this._setMode('ship');
    this.ship.state = 'landed';
    this.audio.sfx('door');
    if (!this.boardedOnce) {
      this.boardedOnce = true;
      this.hud.toast('Welcome aboard the Golden Driller', 'good', 0);
    }
    this.objectives.event('boarded');
    // suit systems recharge inside the cockpit
    this.inv.suit.hazard = Math.max(this.inv.suit.hazard, 100);
  }

  tryLaunch() {
    const inv = this.inv;
    if (inv.fuel.launch < 25) {
      if (inv.refuel('launch') === 'ok') {
        this.hud.toast('Launch thrusters refueled (-20 Di-hydrogen)', 'res');
        this.objectives.event('refueled');
      } else {
        this.hud.toast('Launch thrusters empty. Need 20 Di-hydrogen from blue crystals.', 'warn', 0);
        this.audio.sfx('deny');
        return;
      }
    }
    inv.fuel.launch -= 25;
    const ship = this.ship;
    const planet = this.nearest;
    const up = ship.pos.clone().sub(planet.pos).normalize();
    ship.axes();
    const fromQuat = ship.quat.clone();
    const toQuat = ship.quat.clone().multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.18));
    ship.startAnim('launch', {
      dur: 2.4,
      fromPos: ship.pos.clone(),
      toPos: ship.pos.clone().addScaledVector(up, 38).addScaledVector(ship.forward, 16),
      fromQuat,
      toQuat,
      onDone: () => {
        ship.state = 'flying';
        ship.speed = 70;
        ship.vel.copy(ship.forward).multiplyScalar(70);
        this.input.setThrottle(0.45);
      },
    });
    ship.state = 'launching';
    ship.shake = 0.6;
    this.audio.sfx('launch');
    this.objectives.event('launched');
  }

  tryLand() {
    const ship = this.ship;
    const planet = this.nearest;
    if (!planet) return;
    const local = ship.pos.clone().sub(planet.pos);
    const dir0 = local.clone().normalize();
    ship.axes();
    const fwdT = ship.forward.clone().addScaledVector(dir0, -ship.forward.dot(dir0)).normalize();
    const sideT = new THREE.Vector3().crossVectors(fwdT, dir0);
    let site = null;
    const cand = new THREE.Vector3();
    outer: for (const dist of [18, 40, 70, 110, 160, 230]) {
      for (let a = 0; a < 10; a++) {
        const ang = (a / 10) * Math.PI * 2;
        cand.copy(dir0).multiplyScalar(planet.R)
          .addScaledVector(fwdT, Math.cos(ang) * dist + 20)
          .addScaledVector(sideT, Math.sin(ang) * dist).normalize();
        const h = planet.sampler.height(cand.x, cand.y, cand.z);
        if (planet.params.liquid && h < 1) continue;
        if (this._slopeAt(planet, cand, h) > 0.2) continue;
        site = cand.clone();
        break outer;
      }
    }
    if (!site) {
      this.hud.toast('No landing site here. Too wet or too steep.', 'warn');
      this.audio.sfx('deny');
      return;
    }
    const r = planet.surfaceRadius(site.x, site.y, site.z);
    const toPos = site.clone().multiplyScalar(r + 2.3).add(planet.pos);
    const fwd = fwdT.clone().addScaledVector(site, -fwdT.dot(site)).normalize();
    const z = fwd, y = site, x = new THREE.Vector3().crossVectors(y, z).normalize();
    _m.makeBasis(x, y, z);
    const toQuat = new THREE.Quaternion().setFromRotationMatrix(_m);
    const dist = ship.pos.distanceTo(toPos);
    ship.startAnim('land', {
      dur: THREE.MathUtils.clamp(dist / 45, 2.2, 5),
      fromPos: ship.pos.clone(),
      toPos,
      fromQuat: ship.quat.clone(),
      toQuat,
      onDone: () => {
        ship.state = 'landed';
        ship.speed = 0;
        ship.vel.set(0, 0, 0);
        ship.landedPlanet = planet;
        this.input.setThrottle(0);
        this.onLanded(planet);
      },
    });
    ship.state = 'landing';
    this.audio.sfx('land');
  }

  onLanded(planet) {
    this.surface?.exclude(this.ship.pos.clone().sub(planet.pos), 13);
    this.discoverPlanet(planet);
    this.objectives.event('landed');
    this.save();
  }

  discoverPlanet(planet) {
    const key = `${this.starId}|${planet.params.index}`;
    if (this.discovered.planets[key]) return;
    this.discovered.planets[key] = planet.params.name;
    const p = planet.params;
    const reward = 600 + Math.round((p.hazardLevel || 0) * 800) + (p.biome === 'exotic' ? 900 : 0);
    this.inv.units += reward;
    this.hud.discovery('Planet discovered', p.name, `${BIOMES[p.biome].label} world  +${reward.toLocaleString()} units`);
    this.audio.sfx('discover');
  }

  tryDock() {
    const st = this.station;
    const ship = this.ship;
    const inside = st.pos.clone().addScaledVector(st.forward, 70);
    const face = st.forward.clone().negate();
    _m.lookAt(new THREE.Vector3(), face, new THREE.Vector3(0, 1, 0).applyQuaternion(st.quat));
    const toQuat = new THREE.Quaternion().setFromRotationMatrix(_m).multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    const entrance = st.pos.clone().addScaledVector(st.forward, 150);
    const d = ship.pos.distanceTo(entrance);
    ship.startAnim('dock', {
      dur: THREE.MathUtils.clamp(d / 150, 2.5, 6),
      fromPos: ship.pos.clone(),
      toPos: entrance,
      fromQuat: ship.quat.clone(),
      toQuat,
      onDone: () => {
        ship.startAnim('dock', {
          dur: 1.6, fromPos: ship.pos.clone(), toPos: inside, fromQuat: ship.quat.clone(), toQuat,
          onDone: () => this.onDocked(),
        });
        this.fade(1, 1.2);
      },
    });
    ship.state = 'docking';
    this.audio.sfx('dock');
  }

  onDocked() {
    this.ship.state = 'docked';
    this.ship.speed = 0;
    this.ship.vel.set(0, 0, 0);
    this.inv.ship.shield = 100;
    this.objectives.event('docked');
    this.menus.openStation();
    this.fade(0, 0.8);
    this.save();
  }

  undock() {
    const st = this.station;
    const ship = this.ship;
    this.fade(1, 0.01);
    const start = st.pos.clone().addScaledVector(st.forward, 80);
    const out = st.pos.clone().addScaledVector(st.forward, 320);
    _m.lookAt(new THREE.Vector3(), st.forward, new THREE.Vector3(0, 1, 0).applyQuaternion(st.quat));
    const q = new THREE.Quaternion().setFromRotationMatrix(_m).multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    ship.pos.copy(start);
    ship.quat.copy(q);
    ship.startAnim('undock', {
      dur: 2.4, fromPos: start, toPos: out, fromQuat: q, toQuat: q,
      onDone: () => {
        ship.state = 'flying';
        ship.speed = 90;
        ship.vel.copy(st.forward).multiplyScalar(90);
        this.input.setThrottle(0.4);
      },
    });
    ship.state = 'undocking';
    this._setMode('ship');
    setTimeout(() => this.fade(0, 1.0), 120);
    this.audio.sfx('launch');
  }

  photoMode(on) {
    this.photo = on;
    document.getElementById('hud').classList.toggle('hidden', on);
    if (on) {
      const exit = (e) => {
        e.preventDefault();
        window.removeEventListener('pointerdown', exit, true);
        window.removeEventListener('keydown', exit, true);
        this.photoMode(false);
      };
      setTimeout(() => {
        window.addEventListener('pointerdown', exit, true);
        window.addEventListener('keydown', exit, true);
      }, 300);
    }
  }

  fade(to, secs = 0.6, white = false) {
    const f = document.getElementById('fade');
    f.classList.toggle('white', white);
    f.style.transition = `opacity ${secs}s`;
    f.style.opacity = String(to);
  }

  damageShip(n) {
    this.inv.ship.shield = Math.max(0, this.inv.ship.shield - n);
    this.hud.setVignette('hurt');
    clearTimeout(this._vigT);
    this._vigT = setTimeout(() => this.hud.setVignette(null), 350);
    this.audio.sfx('hit');
  }

  hurtPlayer(n, cause) {
    const s = this.inv.suit;
    s.health = Math.max(0, s.health - n);
    this.hud.setVignette('hurt');
    clearTimeout(this._vigT);
    this._vigT = setTimeout(() => this.hud.setVignette(null), 300);
    if (s.health <= 0 && !this.respawning) this.blackout(cause);
  }

  blackout(cause) {
    this.respawning = true;
    this.fade(1, 0.8);
    this.hud.toast(cause === 'hazard' ? 'Hazard protection failed. You blacked out.' : 'You blacked out.', 'warn', 0);
    setTimeout(() => {
      const s = this.inv.suit;
      s.health = 100;
      s.life = Math.max(s.life, 60);
      s.hazard = Math.max(s.hazard, 60);
      const planet = this.ship.landedPlanet || this.nearest;
      if (this.ship.state === 'landed' && planet) this._exitShipTo(planet);
      this.fade(0, 1.2);
      this.respawning = false;
      this.hud.toast('Recovered beside your ship', 'good');
    }, 1300);
  }

  // ---------------------------------------------------------------------------
  // warp

  startWarp(star) {
    const inv = this.inv;
    if (inv.warpCells < 1) {
      this.hud.toast('No Warp Cells. Craft one from the inventory.', 'warn', 0);
      return false;
    }
    inv.warpCells--;
    this.map.close();
    this._setMode('warp');
    this.hud.show(false);
    this.warping = { t: 0, star, loaded: false };
    this.warp.start(this.camera);
    this.nearScene.add(this.warp.group);
    this.audio.sfx('warp');
    this.ship.pulseOn = false;
    return true;
  }

  _updateWarp(dt) {
    const w = this.warping;
    w.t += dt;
    this.warp.update(dt, w.t, this.camera);
    if (w.t > 2.2 && !w.loaded) {
      w.loaded = true;
      const prevStar = this.star;
      this.loadSystem(w.star.id);
      this.jumps++;
      // arrive a good way out from the first planet, facing it
      const p0 = this.planets[0];
      const off = new THREE.Vector3(...this.system.station.pos).sub(p0.pos).normalize();
      const arrive = p0.pos.clone().addScaledVector(off, p0.R * 7.5).add(new THREE.Vector3(0, p0.R * 1.2, 0));
      this.ship.pos.copy(arrive);
      _m.lookAt(arrive, p0.pos, new THREE.Vector3(0, 1, 0));
      this.ship.quat.setFromRotationMatrix(_m).multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      this.ship.state = 'flying';
      this.ship.speed = 150;
      this.ship.vel.set(0, 0, 0);
      this.ship.model.gear.visible = false;
      this.input.setThrottle(0.3);
      this.warpFrom = prevStar;
    }
    if (w.t > 4.4) {
      this.warp.group.removeFromParent();
      this.warp.stop();
      this.warping = null;
      this._setMode('ship');
      this.hud.show(true);
      this.fade(1, 0.01, true);
      setTimeout(() => this.fade(0, 1.4, true), 60);
      this.onArrive();
    }
  }

  onArrive() {
    const star = this.star;
    const d = Math.round(distanceToCore(star));
    this.hud.setLocation(this.system.name, this.system.core ? 'You made it' : `${d.toLocaleString()} ly to the Center`);
    if (!this.discovered.systems[star.id]) {
      this.discovered.systems[star.id] = star.name;
      if (!star.home) {
        const reward = 400 + this.planets.length * 150;
        this.inv.units += reward;
        setTimeout(() => this.hud.discovery('System discovered', star.name, `${this.planets.length} planets  +${reward.toLocaleString()} units`), 1500);
      }
    }
    this.objectives.event('warped');
    if (this.system.core) setTimeout(() => this.menus.openFinale(), 5000);
    this.save();
  }

  newGalaxy() {
    this.galaxySeed += 1;
    this.visited = new Set();
    this.mined = {};
    this.discovered.systems = {};
    this.menus.close();
    const home = startStar(this.galaxySeed);
    this.loadSystem(home.id);
    const p0 = this.planets[0];
    const arrive = p0.pos.clone().add(new THREE.Vector3(p0.R * 6, p0.R, p0.R * 2));
    this.ship.pos.copy(arrive);
    _m.lookAt(arrive, p0.pos, new THREE.Vector3(0, 1, 0));
    this.ship.quat.setFromRotationMatrix(_m).multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    this.ship.state = 'flying';
    this._setMode('ship');
    this.inv.warpCells += 2;
    this.fade(1, 0.01, true);
    setTimeout(() => this.fade(0, 2, true), 60);
    this.hud.setLocation('A New Galaxy', 'Tulsa Prime, again');
    this.save();
  }

  // ---------------------------------------------------------------------------
  // main loop

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      let dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (dt > 0.1) dt = 0.1;
      this.tick(dt);
    };
    requestAnimationFrame(loop);
  }

  tick(dt) {
    const t0 = performance.now();
    this._tick(dt);
    const ms = performance.now() - t0;
    this.cpuMs = this.cpuMs ? this.cpuMs * 0.95 + ms * 0.05 : ms;
    if (ms > (this.cpuPeak || 0)) this.cpuPeak = ms;
  }

  _tick(dt) {
    this.frame++;
    this._perf(dt);
    G.uTime.value += dt;
    const input = this.input;
    input.update();
    const pressed = input.consumePressed();

    if (this.mode === 'title') {
      this._titleCamera(dt);
      this._updateWorld(dt);
      this._render();
      return;
    }

    // global buttons
    if (pressed.has('menu')) this.menus.toggleMenu();
    if (pressed.has('inventory')) this.menus.toggleInventory();
    if (pressed.has('map')) this.map.toggle();

    if (this.map.open) {
      this.map.update(dt);
      this.audio.update(dt);
      this.map.render();
      return;
    }
    const paused = this.menus.isOpen;
    if (!paused) {
      this.worldTime += dt;
      if (this.mode === 'warp') this._updateWarp(dt);
      else if (this.mode === 'ship') this._updateShipMode(dt, pressed);
      else if (this.mode === 'foot') {
        const tf0 = performance.now();
        this._updateFootMode(dt, pressed);
        if (this.prof) this.prof.foot = (this.prof.foot || 0) * 0.95 + (performance.now() - tf0) * 0.05;
      }
    } else {
      input.consumeLook();
    }
    const tw0 = performance.now();
    this._updateWorld(paused ? 0 : dt);
    const tw1 = performance.now();
    this._updateHud(dt);
    this.audio.update(dt);
    this.objectives.update(dt);
    const tw2 = performance.now();
    this._render();
    const tw3 = performance.now();
    if (this.prof) {
      const p = this.prof;
      p.world = p.world * 0.95 + (tw1 - tw0) * 0.05;
      p.hud = p.hud * 0.95 + (tw2 - tw1) * 0.05;
      p.render = p.render * 0.95 + (tw3 - tw2) * 0.05;
    }

    this.saveTimer += dt;
    if (this.saveTimer > 25 && !paused && this.mode !== 'warp') {
      this.saveTimer = 0;
      this.save();
    }
  }

  _perf(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length >= 90) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.frameTimes.length = 0;
      this.fps = 1 / avg;
      // dynamic resolution
      if (this.playing && !this.noDynRes) {
        if (this.fps < 40 && this.resScale > 0.6) { this.resScale = Math.max(0.6, this.resScale - 0.1); this.resize(); }
        else if (this.fps > 57 && this.resScale < 1) { this.resScale = Math.min(1, this.resScale + 0.05); this.resize(); }
      }
    }
  }

  _updateNearest(focus) {
    let best = null, bestD = Infinity;
    for (const p of this.planets) {
      const d = focus.distanceTo(p.pos) - p.R;
      if (d < bestD) { bestD = d; best = p; }
    }
    this.nearest = best;
    this.nearestDist = best ? focus.distanceTo(best.pos) : Infinity;
  }

  _updateShipMode(dt, pressed) {
    const ship = this.ship;
    const input = this.input;
    this._updateNearest(ship.pos);
    const planet = this.nearest;
    const atmoR = planet ? (planet.params.atmo ? planet.params.atmo.radius : planet.R * 1.04) : 0;
    const st = this.station;
    const stDist = st ? ship.pos.distanceTo(st.pos) : Infinity;
    // pulse is fine in open space; it cuts out when you are about to reach an atmosphere or the station
    let pulseOk = ship.state === 'flying' && !!planet && !ship.inAtmo;
    if (pulseOk) {
      const gap = this.nearestDist - atmoR;
      const toP = _v.copy(ship.pos).sub(planet.pos).divideScalar(this.nearestDist);
      const closing = -ship.vel.dot(toP);
      if (gap < 300 || (closing > 0 && gap / closing < 1.4)) pulseOk = false;
      if (st) {
        const toS = _v2.copy(ship.pos).sub(st.pos).divideScalar(stDist);
        const cs = -ship.vel.dot(toS);
        if (stDist < 1500 || (cs > 0 && (stDist - 900) / cs < 1.2)) pulseOk = false;
      }
    }
    this.pulseAllowed = pulseOk;

    if (ship.state === 'flying' && !ship.anim) {
      if (pressed.has('pulse')) {
        if (ship.pulseOn) { ship.pulseOn = false; this.audio.pulseStop(); }
        else if (!this.pulseAllowed) this.hud.toast(stDist < 3000 ? 'Too close to the station for the pulse drive' : 'Too close to a planet for the pulse drive', 'warn');
        else if (this.inv.fuel.pulse <= 0) this.hud.toast('Pulse fuel empty. Shoot asteroids for Tritium.', 'warn');
        else { ship.pulseOn = true; this.audio.pulseStart(); this.objectives.event('pulse'); }
      }
      const canLand = planet && ship.altitude < 170 && !ship.pulseOn;
      const canDock = st && stDist < 1100 && !ship.pulseOn;
      if (canDock) {
        this.hud.setContext('Dock', 'E');
        if (pressed.has('interact')) this.tryDock();
      } else if (canLand) {
        this.hud.setContext('Land', 'E');
        if (pressed.has('interact')) this.tryLand();
      } else this.hud.setContext(null);
      this.hud.setContext2(null);
      this.mining.updateShipWeapons(dt, input.held.has('primary'));
    } else if (ship.state === 'landed') {
      this.hud.setContext('Exit ship', 'E');
      this.hud.setContext2('Launch', 'L');
      if (pressed.has('interact')) { this._exitShipTo(this.nearest); return; }
      const throttleUp = input.keys.has('KeyW') || input.keys.has('Space') || (input.throttleTouched && input.throttle > 0.3);
      if (pressed.has('interact2') || throttleUp) { input.throttleTouched = false; this.tryLaunch(); }
      input.consumeLook();
      // recharge suit inside the ship
      const s = this.inv.suit;
      s.hazard = Math.min(100, s.hazard + dt * 15);
      s.life = Math.min(100, s.life + dt * 6);
    } else {
      this.hud.setContext(null);
      this.hud.setContext2(null);
      input.consumeLook();
    }
    this.hud.setPulse(ship.state === 'flying' && !ship.inAtmo, ship.pulseOn);
    const wasIn = ship.inAtmo;
    ship.update(dt, input);
    if (!wasIn && ship.inAtmo && ship.state === 'flying' && ship.speed > 200) {
      ship.shake = Math.max(ship.shake, 0.8);
      this.hud.setVignette('entry');
      clearTimeout(this._vigT);
      this._vigT = setTimeout(() => this.hud.setVignette(null), 1700);
      this.audio.sfx('entry');
    }
    this._chaseCamera(dt);
  }

  _chaseCamera(dt) {
    const ship = this.ship;
    const cam = this.camera;
    ship.axes();
    const speedK = Math.min(1, ship.speed / 700);
    const back = ship.state === 'landed' ? 20 : 17 + speedK * 7 + (ship.pulseOn ? 8 : 0);
    const height = ship.state === 'landed' ? 7 : 4.6;
    const desired = _v.copy(ship.pos).addScaledVector(ship.forward, -back).addScaledVector(ship.up, height);
    if (!this.camInit) { cam.position.copy(desired); this.camInit = true; }
    const k = 1 - Math.exp(-dt * (ship.pulseOn ? 12 : 7));
    cam.position.lerp(desired, k);
    // keep the camera above ground
    const planet = this.nearest;
    if (planet) {
      _v2.copy(cam.position).sub(planet.pos);
      const len = _v2.length();
      _v2.divideScalar(len);
      const g = planet.surfaceRadius(_v2.x, _v2.y, _v2.z) + 1.8;
      if (len < g) cam.position.copy(_v2).multiplyScalar(g).add(planet.pos);
    }
    const target = _v3.copy(ship.pos).addScaledVector(ship.forward, 14).addScaledVector(ship.up, 1.6);
    _m.lookAt(cam.position, target, ship.up);
    _q.setFromRotationMatrix(_m);
    if (!this.camQuatInit) { cam.quaternion.copy(_q); this.camQuatInit = true; }
    cam.quaternion.slerp(_q, 1 - Math.exp(-dt * 8));
    // shake
    if (ship.shake > 0) {
      ship.shake = Math.max(0, ship.shake - dt * 1.8);
      const s = ship.shake * 0.35;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    const wantFov = this.fov + speedK * 8 + (ship.pulseOn ? 14 : 0) + (ship.boosting ? 5 : 0);
    cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 3);
  }

  _updateFootMode(dt, pressed) {
    const player = this.player;
    const input = this.input;
    const planet = player.planet;
    this.nearest = planet;
    this.nearestDist = player.pos.length();
    this.pulseAllowed = false;
    player.update(dt, input);
    const cam = this.camera;
    cam.position.copy(player.eyeWorld);
    cam.quaternion.copy(player.camQuat);
    cam.fov += (this.fov - cam.fov) * Math.min(1, dt * 4);

    // ship proximity
    const shipLocal = _v.copy(this.ship.pos).sub(planet.pos);
    const dShip = shipLocal.distanceTo(player.pos);
    if (this.ship.state === 'landed' && this.ship.landedPlanet === planet && dShip < 9) {
      this.hud.setContext('Board ship', 'E');
      if (pressed.has('interact')) { this.boardShip(); return; }
    } else this.hud.setContext(null);
    this.hud.setContext2(null);

    if (pressed.has('scan')) this.mining.scan();
    this.mining.updateFoot(dt, input.held.has('primary'));
    if (player.jetting && this.frame % 2 === 0) {
      const down = _v.copy(player.up).negate();
      const at = _v2.copy(player.pos).add(planet.pos).addScaledVector(player.up, 0.4).addScaledVector(player.forward, -0.35);
      this.particles.burst(at, [0.5, 0.75, 1.0], 2, 3, 0.35, 0.5, down);
    }

    // suit systems
    const inv = this.inv;
    const s = inv.suit;
    const p = planet.params;
    const hz = p.hazard ? p.hazardLevel : 0;
    // day heat and night cold swing the hazard a little
    const sunUp = player.up.dot(G.uSunDir.value);
    let drain = 0;
    if (p.hazard) {
      const swing = p.hazard.type === 'heat' ? 0.6 + 0.6 * Math.max(0, sunUp) : p.hazard.type === 'cold' ? 0.6 + 0.6 * Math.max(0, -sunUp) : 1;
      drain = hz * 1.5 * swing * (1 - inv.upgrades.hazard * 0.22);
    }
    if (player.inLiquid === 'acid') drain += 5;
    if (drain > 0) s.hazard = Math.max(0, s.hazard - drain * dt);
    else s.hazard = Math.min(100, s.hazard + dt * 2);
    s.life = Math.max(0, s.life - dt * 0.42);
    if (player.inLiquid === 'lava') this.hurtPlayer(dt * 45, 'lava');
    if (s.hazard <= 0 && p.hazard) this.hurtPlayer(dt * 6, 'hazard');
    if (s.life <= 0) this.hurtPlayer(dt * 5, 'oxygen');
    if (s.hazard > 0 && s.life > 0) s.health = Math.min(100, s.health + dt * 1.5);
    this.hud.setVignette(this.hud.vignette.classList.contains('hurt') ? 'hurt' : s.hazard < 25 && p.hazard ? 'hazard' : null);
    if (s.life < 20 && s.life > 0) this.hud.toast('Life support low. Mine red Oxygen plants and refuel it in the inventory.', 'warn', 15000);
    if (p.hazard && s.hazard < 20 && s.hazard > 0) this.hud.toast(`${HAZARD_LABEL[p.hazard.type]}: protection low. Sodium (yellow plants) recharges it.`, 'warn', 15000);

    // first time on a planet on foot counts as a discovery
    this.discoverPlanet(planet);
  }

  _titleCamera(dt) {
    this.titleT += dt;
    if (!this.planets.length) return;
    const p = this.planets[0];
    const sun = G.uSunDir.value;
    // sit about 70 degrees off the sun so the planet shows a fat lit crescent
    const side = _v2.set(0, 1, 0).cross(sun).normalize();
    const a = 1.2 + Math.sin(this.titleT * 0.05) * 0.15;
    const dir = _v3.copy(sun).multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).normalize();
    const r = p.R * 2.5;
    const cam = this.camera;
    cam.position.copy(p.pos).addScaledVector(dir, r).add(_v.set(0, p.R * 0.35, 0));
    cam.up.set(0, 1, 0);
    // look a little past the planet so it sits low and to the side of the logo
    const look = _v.copy(p.pos).addScaledVector(side, -p.R * 0.55).add(new THREE.Vector3(0, p.R * 0.45, 0));
    cam.lookAt(look);
    this._updateNearest(cam.position);
    this.ship.group.visible = false;
  }

  _updateSun(dt) {
    const sys = this.system;
    if (!sys) return;
    const ang = sys.sun.az + (this.worldTime / sys.sun.period) * Math.PI * 2;
    const el = sys.sun.el;
    G.uSunDir.value.set(Math.cos(el) * Math.cos(ang), Math.sin(el), Math.cos(el) * Math.sin(ang)).normalize();
  }

  _updateWorld(dt) {
    const cam = this.camera;
    this._updateSun(dt);
    if (this.mode !== 'title') this.ship.group.visible = this.mode !== 'warp' && this.ship.state !== 'docked';
    const focus = this.mode === 'foot' ? this.player.eyeWorld : this.mode === 'title' ? cam.position : this.ship.pos;
    if (this.mode !== 'foot' && this.mode !== 'ship') this._updateNearest(focus);
    const nearest = this.nearest;

    // choose render pass for each planet and update LOD
    for (const p of this.planets) {
      const inNear = p === nearest && this.nearestDist < p.R * 5;
      const scene = inNear ? this.nearScene : this.farScene;
      if (p.group.parent !== scene) scene.add(p.group);
      p.update(cam.position, this.frame, this.quality.splitFactor);
      if (p.clouds) p.clouds.rotation.y += dt * p.clouds.userData.spin * 0.02;
    }
    this.pool.update();

    // station
    if (this.station) {
      const st = this.station;
      const d = cam.position.distanceTo(st.pos);
      const scene = d < 30000 ? this.nearScene : this.farScene;
      if (st.model.group.parent !== scene) scene.add(st.model.group);
      st.model.ring.rotation.y += dt * 0.05;
    }

    // atmosphere for objects
    if (nearest) {
      copyAtmoUniforms(this.objAtmo, nearest.atmoU);
    }

    // surface detail near the ground
    const focusAlt = nearest ? nearest.altitudeOf(_v.copy(focus).sub(nearest.pos)) : Infinity;
    this.focusAlt = focusAlt;
    if (nearest && focusAlt < 900 && this.mode !== 'title') {
      if (!this.surface || this.surface.planet !== nearest) {
        this.disposeSurface();
        this.surface = new Surface(this, nearest, this.quality);
        this.fauna = new Fauna(this, nearest, this.quality);
        if (this.ship.state === 'landed' && this.ship.landedPlanet === nearest) this.surface.exclude(this.ship.pos.clone().sub(nearest.pos), 13);
        if (this.pendingCrashCrystals && nearest === this.planets[0]) {
          this.pendingCrashCrystals = false;
          this._placeCrashCrystals(nearest);
        }
      }
    } else if (this.surface && (focusAlt > 1400 || this.surface.planet !== nearest)) {
      this.disposeSurface();
    }
    if (this.surface) {
      const local = _v.copy(focus).sub(this.surface.planet.pos);
      this.surface.update(local, this.mode === 'foot' ? 3 : 2);
      this.fauna?.update(dt, local);
    }

    // sky brightness for star fading and the helmet torch
    let skyB = 0;
    let night = 0;
    if (nearest && nearest.params.atmo) {
      const up = _v.copy(cam.position).sub(nearest.pos);
      const alt = up.length() - nearest.R;
      up.normalize();
      const sunUp = up.dot(G.uSunDir.value);
      const thick = nearest.params.atmo.thickness;
      skyB = THREE.MathUtils.smoothstep(sunUp, -0.12, 0.25) * (1 - THREE.MathUtils.smoothstep(alt, thick * 0.35, thick * 1.1));
    }
    if (nearest) {
      const up = _v.copy(cam.position).sub(nearest.pos).normalize();
      night = 1 - THREE.MathUtils.smoothstep(up.dot(G.uSunDir.value), -0.2, 0.08);
    }
    this.skyBrightness = skyB;
    G.uTorch.value = this.mode === 'foot' ? night * 0.9 : this.mode === 'ship' && this.focusAlt < 800 ? night * 0.55 : 0;
    this.backdrop.update(cam, this.pixelRatio, skyB);

    // effects
    const vel = this.mode === 'ship' ? this.ship.vel : _v2.set(0, 0, 0);
    this.dust.update(cam, vel, this.mode === 'ship' && (!nearest || !this.ship.inAtmo) ? 1 : 0.0);
    this.beams.update(dt);
    this.particles.update(dt, cam);
    if (nearest) {
      const up = _v.copy(cam.position).sub(nearest.pos).normalize();
      const wActive = (this.mode === 'foot' || this.mode === 'ship') && this.focusAlt < 260;
      this.weather.update(dt, cam, nearest, up, up.dot(G.uSunDir.value), wActive);
    }
    this.asteroids?.update(dt, cam.position, this.mode === 'ship');
    this.traffic?.update(dt, cam.position);
  }

  _placeCrashCrystals(planet) {
    const ship = this.ship;
    const local = ship.pos.clone().sub(planet.pos);
    const up = local.clone().normalize();
    ship.axes();
    const f = ship.forward.clone().addScaledVector(up, -ship.forward.dot(up)).normalize();
    const r = new THREE.Vector3().crossVectors(f, up);
    const spots = [[16, 10], [24, -14], [-18, 20], [30, 26], [-10, -26]];
    for (const [a, b] of spots) {
      const p = local.clone().addScaledVector(f, a).addScaledVector(r, b);
      this.surface.addExtra('crystal', p, 1.1);
    }
    this.surface.addExtra('oxyplant', local.clone().addScaledVector(f, -12).addScaledVector(r, 9), 1);
    this.surface.addExtra('boulder', local.clone().addScaledVector(f, -22).addScaledVector(r, -12), 1);
  }

  _updateHud(dt) {
    const inv = this.inv;
    const hud = this.hud;
    if (this.mode === 'foot') {
      const s = inv.suit;
      const bars = [
        { id: 'hp', label: 'HP', value: s.health / 100, color: '#f5f0e6' },
        { id: 'life', label: 'O2', value: s.life / 100, color: '#ff7b9a' },
      ];
      const p = this.player.planet.params;
      if (p.hazard) bars.push({ id: 'hz', label: p.hazard.type === 'heat' ? 'HOT' : p.hazard.type === 'cold' ? 'ICE' : p.hazard.type === 'toxic' ? 'TOX' : 'RAD', value: s.hazard / 100, color: '#ffb547' });
      bars.push({ id: 'jet', label: 'JET', value: s.jet / 100, color: '#7fe3ff', noLow: true });
      hud.setBars(bars);
    } else if (this.mode === 'ship') {
      hud.setBars([
        { id: 'sh', label: 'SHD', value: inv.ship.shield / 100, color: '#7fe3ff' },
        { id: 'lf', label: 'LCH', value: inv.fuel.launch / 100, color: '#5fb2ff' },
        { id: 'pf', label: 'PLS', value: inv.fuel.pulse / 100, color: '#a6f0ff' },
        { id: 'bst', label: 'BST', value: this.ship.boostEnergy, color: '#ffb547', noLow: true },
      ]);
      const ship = this.ship;
      let altText = '';
      if (this.nearest && ship.altitude < 20000) altText = `${this.nearest.params.name}  alt ${Math.round(ship.altitude)}`;
      else if (this.nearest) altText = this.system.name;
      hud.setFlight(ship.speed, altText);
      hud.setSpeedLines(ship.pulseOn ? 0.9 : ship.boosting ? 0.35 : 0);
    }
    hud.setObjective(this.objectives.text());

    // markers
    if (this.frame % 2 === 0) {
      const list = [];
      const cam = this.camera;
      if (this.mode === 'ship' && this.ship.state === 'flying') {
        for (const p of this.planets) {
          const d = cam.position.distanceTo(p.pos) - p.R;
          if (p === this.nearest && this.ship.altitude < p.R * 0.6) continue;
          list.push({ id: `p${p.params.index}`, pos: p.pos, label: p.params.name, color: '#f5f0e6', dist: d });
        }
        if (this.station) {
          const d = cam.position.distanceTo(this.station.pos);
          if (d > 400) list.push({ id: 'st', pos: this.station.pos, label: this.station.name, color: '#7fe3ff', dist: d });
        }
      }
      if (this.mode === 'foot' && this.ship.state === 'landed') {
        const d = this.player.eyeWorld.distanceTo(this.ship.pos);
        if (d > 14) list.push({ id: 'ship', pos: _v.copy(this.ship.pos).add(_v2.copy(this.player.up).multiplyScalar(3)), label: 'Ship', color: '#ffb547', dist: d });
      }
      this.mining.addMarkers(list);
      hud.updateMarkers(cam, list, this.width, this.height);
    }
  }

  _render() {
    const r = this.renderer;
    const cam = this.camera;
    r.clear();
    cam.near = 60;
    cam.far = 2e6;
    cam.updateProjectionMatrix();
    r.render(this.farScene, cam);
    r.clearDepth();
    let near = 0.2, far = 40000;
    const p = this.nearest;
    if (this.mode === 'foot') {
      near = 0.12;
      far = 24000;
    } else if (p) {
      const alt = Math.max(1, this.nearestDist - p.R);
      near = THREE.MathUtils.clamp(alt * 0.0015, 0.25, 3);
      far = THREE.MathUtils.clamp(this.nearestDist + p.R * 1.5, 12000, 90000);
    }
    cam.near = near;
    cam.far = far;
    cam.updateProjectionMatrix();
    this.beams.build(cam);
    r.render(this.nearScene, cam);
    if (this.mode === 'foot' && !this.menus.isOpen) {
      this._placeTool();
      r.clearDepth();
      cam.near = 0.01;
      cam.far = 10;
      cam.updateProjectionMatrix();
      r.render(this.tool.scene, cam);
    }
  }

  _placeTool() {
    const cam = this.camera;
    const t = this.tool.mesh;
    const p = this.player;
    const firing = this.mining.firing;
    this.toolKick += ((firing ? 1 : 0) - this.toolKick) * 0.2;
    const bob = Math.sin(p.bob) * 0.012;
    const sway = Math.cos(p.bob * 0.5) * 0.01;
    const jitter = firing ? (Math.random() - 0.5) * 0.006 : 0;
    const portrait = this.height > this.width;
    _v.set((portrait ? 0.15 : 0.23) + sway + jitter, -0.19 + bob + jitter - (portrait ? 0.02 : 0), -0.5 + this.toolKick * 0.025);
    _v.applyQuaternion(cam.quaternion);
    t.position.copy(cam.position).add(_v);
    t.quaternion.copy(cam.quaternion);
    _q.setFromEuler(new THREE.Euler(0.04 - this.toolKick * 0.03, 0.08, 0.02));
    t.quaternion.multiply(_q);
    t.updateMatrixWorld();
  }

  toolMuzzle(out) {
    this._placeTool();
    return out.copy(this.tool.muzzle).applyMatrix4(this.tool.mesh.matrixWorld);
  }

  // ---------------------------------------------------------------------------
  // saving

  saveSoon() {
    this.saveTimer = Math.max(this.saveTimer, 20);
  }

  save() {
    if (!this.playing || !this.system || this.mode === 'warp') return;
    const ship = this.ship;
    const shipData = { state: ship.state === 'landed' ? 'landed' : 'flying' };
    if (ship.state === 'landed' && ship.landedPlanet) {
      const planet = ship.landedPlanet;
      const local = ship.pos.clone().sub(planet.pos).normalize();
      ship.axes();
      shipData.planet = planet.params.index;
      shipData.dir = local.toArray();
      shipData.heading = ship.forward.toArray();
    } else {
      shipData.pos = ship.pos.toArray();
      shipData.quat = ship.quat.toArray();
    }
    const mined = {};
    for (const [k, set] of Object.entries(this.mined)) if (set.size) mined[k] = [...set].slice(-400);
    const data = {
      v: 1,
      galaxySeed: this.galaxySeed,
      starId: this.starId,
      visited: [...this.visited].slice(-300),
      jumps: this.jumps,
      worldTime: this.worldTime,
      mode: this.mode === 'foot' ? 'foot' : 'ship',
      ship: shipData,
      player: this.mode === 'foot' ? { pos: this.player.pos.toArray(), fwd: this.player.forward.toArray() } : null,
      inv: this.inv.toJSON(),
      discovered: this.discovered,
      mined,
      objectives: this.objectives.toJSON(),
      settings: this.settings,
    };
    writeSave(data);
  }

  saveSettings() {
    const s = loadSave();
    if (s) { s.settings = this.settings; writeSave(s); }
    else writeSave({ settingsOnly: true, settings: this.settings });
  }
}
