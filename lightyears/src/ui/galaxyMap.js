// Galaxy map: the local star neighborhood in 3D, the galaxy's spiral behind it,
// and a card for choosing your next jump. 1 map unit = 100 lightyears.

import * as THREE from 'three';
import { starsNear, coreStar, distanceToCore, STAR_CLASSES, CORE_RADIUS } from '../world/universe.js';
import { Rng } from '../core/rng.js';

const SCALE = 0.01;
const VIEW_RADIUS = 2800;
const _v = new THREE.Vector3();

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uScale;
uniform float uMin;
uniform float uMax;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / -mv.z, uMin, uMax);
  vColor = aColor;
}`;
const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  float core = smoothstep(0.35, 0.0, d);
  gl_FragColor = vec4(vColor * (a * 0.7 + core * 1.3), 1.0);
}`;

export class GalaxyMap {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
    this.target = new THREE.Vector3();
    this.targetGoal = new THREE.Vector3();
    this.az = 0.6;
    this.el = 0.55;
    this.dist = 22;
    this.distGoal = 22;
    this.selected = null;
    this.stars = [];
    this.ui = document.getElementById('map-ui');
    this.labels = document.getElementById('map-labels');
    this.card = document.getElementById('map-card');
    this.warpBtn = document.getElementById('map-warp');
    this.pointers = new Map();

    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 30 }, uMin: { value: 3 }, uMax: { value: 26 } },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.starMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    this.dustMat = this.starMat.clone();
    this.dustMat.uniforms.uMin.value = 1;
    this.dustMat.uniforms.uMax.value = 3;
    this.galaxyPts = new THREE.Points(new THREE.BufferGeometry(), this.dustMat);
    this.galaxyPts.frustumCulled = false;
    this.scene.add(this.galaxyPts);

    // range ring on the galactic plane and a faint sphere
    this.rangeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1, 96),
      new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.rangeRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.rangeRing);
    this.rangeSphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.03, depthWrite: false, wireframe: true }),
    );
    this.scene.add(this.rangeSphere);

    // selection line and markers
    this.lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.line = new THREE.Line(this.lineGeo, new THREE.LineBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.9 }));
    this.scene.add(this.line);
    const ringMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false });
    this.hereRing = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 40), ringMat(0x7fe3ff));
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 40), ringMat(0xffb547));
    this.scene.add(this.hereRing, this.selRing);

    // arrow toward the core
    this.coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._glowTex(), color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.coreGlow);

    this._bind();
  }

  _glowTex() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,220,170,0.6)');
    g.addColorStop(1, 'rgba(255,200,120,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _bind() {
    const layer = document.getElementById('map-gesture');
    let tapStart = null;
    layer.addEventListener('pointerdown', (e) => {
      layer.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      tapStart = this.pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
      this.pinch = null;
    });
    layer.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1) {
        this.az -= dx * 0.006;
        this.el = THREE.MathUtils.clamp(this.el + dy * 0.005, -1.35, 1.35);
      } else if (this.pointers.size === 2) {
        const pts = [...this.pointers.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this.pinch) this.distGoal = THREE.MathUtils.clamp(this.distGoal * (this.pinch / d), 4, 260);
        this.pinch = d;
      }
    });
    const up = (e) => {
      if (tapStart && this.pointers.size === 1) {
        const moved = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y);
        if (moved < 10 && performance.now() - tapStart.t < 500) this._tap(e.clientX, e.clientY);
      }
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      tapStart = null;
    };
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', up);
    layer.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distGoal = THREE.MathUtils.clamp(this.distGoal * Math.exp(e.deltaY * 0.0012), 4, 260);
    }, { passive: false });
    document.getElementById('map-close').addEventListener('click', () => this.close());
    this.warpBtn.addEventListener('click', () => this._warp());
    document.getElementById('map-core-btn').addEventListener('click', () => this._towardCore());
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    const g = this.game;
    if (g.menus.isOpen && g.menus.kind !== 'station') return;
    if (g.mode === 'warp' || !g.star) return;
    this.open = true;
    g.input.clear();
    g.input.enabled = false;
    g.input.releasePointer();
    g.mining.stop();
    this.ui.classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
    this._build();
    this.select(null);
    this.target.set(0, 0, 0);
    this.targetGoal.set(0, 0, 0);
    this.dist = 40;
    this.distGoal = 20;
    const d = distanceToCore(g.star);
    document.getElementById('map-core').textContent = g.system.core ? 'You are at the Center of the Universe' : `Center of the Universe: ${Math.round(d).toLocaleString()} ly`;
    g.objectives.event('map');
  }

  close() {
    if (!this.open) return;
    const g = this.game;
    this.open = false;
    g.input.enabled = true;
    this.ui.classList.add('hidden');
    this.labels.innerHTML = '';
    if (g.playing && g.mode !== 'warp') document.getElementById('hud').classList.remove('hidden');
  }

  _build() {
    const g = this.game;
    let here = g.star;
    const list = starsNear(g.galaxySeed, here.pos, VIEW_RADIUS);
    const core = coreStar();
    if (distanceToCore(here) < VIEW_RADIUS + 200 && !here.core) list.push(core);
    // use the list's own object for the current star so it carries a map position
    const same = list.find((s) => s.id === here.id);
    if (same) { same.name = here.name; here = same; } else list.push(here);
    this.here = here;
    this.stars = list;
    const n = list.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    list.forEach((s, i) => {
      pos[i * 3] = (s.pos[0] - here.pos[0]) * SCALE;
      pos[i * 3 + 1] = (s.pos[1] - here.pos[1]) * SCALE;
      pos[i * 3 + 2] = (s.pos[2] - here.pos[2]) * SCALE;
      const c = s.core ? [1, 0.9, 0.6] : s.color;
      const visited = g.visited.has(s.id);
      const k = visited ? 0.55 : 1;
      col[i * 3] = c[0] * k;
      col[i * 3 + 1] = c[1] * k;
      col[i * 3 + 2] = c[2] * k;
      size[i] = s.core ? 40 : s.id === here.id ? 16 : 10 + (s.cls === 'B' ? 5 : 0);
      s.mapPos = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.points.geometry.dispose();
    this.points.geometry = geo;

    // the wider galaxy as faint dust, relative to here
    if (!this.galaxyBuilt || this.galaxySeed !== g.galaxySeed || this.galaxyFrom !== here.id) {
      this.galaxySeed = g.galaxySeed;
      this.galaxyFrom = here.id;
      const rng = new Rng(g.galaxySeed * 7 + 1);
      const N = 9000;
      const gp = new Float32Array(N * 3);
      const gc = new Float32Array(N * 3);
      const gs = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        // sample the two arm spiral plus a bulge
        let x, y, z;
        if (i < N * 0.22) {
          const r = Math.abs(rng.gauss()) * 1600;
          const a = rng.range(0, Math.PI * 2);
          x = Math.cos(a) * r;
          z = Math.sin(a) * r;
          y = rng.gauss() * 350;
        } else {
          const r = 500 + Math.pow(rng.float(), 0.8) * 12500;
          const arm = rng.chance(0.5) ? 0 : Math.PI;
          const a = Math.log(r / 400) / Math.tan(0.28) + arm + rng.gauss() * 0.35;
          x = Math.cos(a) * r;
          z = Math.sin(a) * r;
          y = rng.gauss() * 180;
        }
        gp[i * 3] = (x - here.pos[0]) * SCALE;
        gp[i * 3 + 1] = (y - here.pos[1]) * SCALE;
        gp[i * 3 + 2] = (z - here.pos[2]) * SCALE;
        const t = rng.float();
        const c = t < 0.3 ? [0.55, 0.65, 1] : t < 0.6 ? [1, 0.8, 0.6] : [0.9, 0.85, 1];
        const b = 0.35 + rng.float() * 0.4;
        gc[i * 3] = c[0] * b;
        gc[i * 3 + 1] = c[1] * b;
        gc[i * 3 + 2] = c[2] * b;
        gs[i] = 12 + rng.float() * 20;
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
      gg.setAttribute('aColor', new THREE.BufferAttribute(gc, 3));
      gg.setAttribute('aSize', new THREE.BufferAttribute(gs, 1));
      this.galaxyPts.geometry.dispose();
      this.galaxyPts.geometry = gg;
      this.galaxyBuilt = true;
    }
    this.coreGlow.position.set(-here.pos[0] * SCALE, -here.pos[1] * SCALE, -here.pos[2] * SCALE);
    this.coreGlow.scale.setScalar(40);
    const range = g.inv.jumpRange * SCALE;
    this.rangeRing.scale.setScalar(range);
    this.rangeSphere.scale.setScalar(range);
    this.hereRing.position.set(0, 0, 0);
  }

  _tap(x, y) {
    const w = window.innerWidth, h = window.innerHeight;
    let best = null, bestD = 34 * 34;
    for (const s of this.stars) {
      _v.copy(s.mapPos).project(this.camera);
      if (_v.z > 1) continue;
      const sx = (_v.x * 0.5 + 0.5) * w, sy = (-_v.y * 0.5 + 0.5) * h;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) this.select(best);
  }

  _towardCore() {
    const g = this.game;
    const range = g.inv.jumpRange;
    let best = null, bestD = Infinity;
    for (const s of this.stars) {
      if (s.id === this.here.id) continue;
      const d = this._dist(s);
      if (d > range) continue;
      const dc = distanceToCore(s);
      if (dc < bestD) { bestD = dc; best = s; }
    }
    if (best) this.select(best);
    else g.hud.toast('No stars in range. Upgrade your hyperdrive at a station.', 'warn');
  }

  _dist(s) {
    const h = this.here.pos;
    return Math.hypot(s.pos[0] - h[0], s.pos[1] - h[1], s.pos[2] - h[2]);
  }

  select(s) {
    this.selected = s && s.id !== this.here?.id ? s : null;
    const g = this.game;
    if (!this.selected) {
      this.card.classList.add('hidden');
      this.selRing.visible = false;
      this.line.visible = false;
      return;
    }
    s = this.selected;
    this.targetGoal.copy(s.mapPos);
    const d = this._dist(s);
    const range = g.inv.jumpRange;
    const inRange = d <= range;
    const visited = g.visited.has(s.id);
    const dc = distanceToCore(s);
    const cls = STAR_CLASSES[s.cls];
    document.getElementById('map-star-name').textContent = s.name;
    document.getElementById('map-star-info').innerHTML = s.core
      ? `The galactic core. ${Math.round(d).toLocaleString()} ly away.<br>${inRange ? 'In range.' : `Out of range (your drive reaches ${range.toLocaleString()} ly).`}`
      : `${cls.label}, ${s.planets} planets${visited ? ', visited' : ''}<br>${Math.round(d).toLocaleString()} ly away &middot; ${Math.round(dc).toLocaleString()} ly from the Center${inRange ? '' : `<br><span style="color:var(--red)">Out of range. Drive reaches ${range.toLocaleString()} ly.</span>`}`;
    const canWarpHere = g.mode === 'ship' && g.ship.state === 'flying' && !g.ship.inAtmo;
    let label = 'Warp';
    let ok = inRange;
    if (!inRange) label = 'Out of range';
    else if (g.inv.warpCells < 1) { label = 'Need a Warp Cell'; ok = false; }
    else if (!canWarpHere) { label = 'Warp from space in your ship'; ok = false; }
    this.warpBtn.textContent = label;
    this.warpBtn.disabled = !ok;
    this.card.classList.remove('hidden');
    this.selRing.visible = true;
    this.line.visible = true;
    const arr = this.lineGeo.attributes.position.array;
    arr[0] = 0; arr[1] = 0; arr[2] = 0;
    arr[3] = s.mapPos.x; arr[4] = s.mapPos.y; arr[5] = s.mapPos.z;
    this.lineGeo.attributes.position.needsUpdate = true;
    this.lineGeo.computeBoundingSphere();
    this.line.material.color.set(inRange ? 0xffb547 : 0xff5d5d);
  }

  _warp() {
    const s = this.selected;
    if (!s) return;
    this.game.startWarp(s);
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 5);
    this.target.lerp(this.targetGoal, k);
    this.dist += (this.distGoal - this.dist) * k;
    const cam = this.camera;
    cam.position.set(
      this.target.x + Math.cos(this.el) * Math.sin(this.az) * this.dist,
      this.target.y + Math.sin(this.el) * this.dist,
      this.target.z + Math.cos(this.el) * Math.cos(this.az) * this.dist,
    );
    cam.lookAt(this.target);
    this.starMat.uniforms.uScale.value = window.innerHeight * 0.045;
    this.dustMat.uniforms.uScale.value = window.innerHeight * 0.02;
    this.hereRing.quaternion.copy(cam.quaternion);
    this.hereRing.scale.setScalar(Math.max(0.6, this.dist * 0.03));
    if (this.selected) {
      this.selRing.position.copy(this.selected.mapPos);
      this.selRing.quaternion.copy(cam.quaternion);
      this.selRing.scale.setScalar(Math.max(0.6, this.dist * 0.035) * (1 + Math.sin(performance.now() * 0.006) * 0.08));
    }
    this._labels();
  }

  _labels() {
    const w = window.innerWidth, h = window.innerHeight;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const show = [];
    if (this.here) show.push({ s: this.here, cls: 'here', text: `${this.here.name} (you)` });
    if (this.selected) show.push({ s: this.selected, cls: 'sel', text: this.selected.name });
    // a few bright neighbors near the view center
    const scored = [];
    for (const s of this.stars) {
      if (s === this.here || s === this.selected) continue;
      const d = s.mapPos.distanceTo(this.target);
      if (s.core || d < this.dist * 0.45) scored.push({ s, d: s.core ? -1 : d });
    }
    scored.sort((a, b) => a.d - b.d);
    for (const x of scored.slice(0, 6)) show.push({ s: x.s, cls: '', text: x.s.name });
    let html = '';
    for (const it of show) {
      _v.copy(it.s.mapPos).project(cam);
      if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) continue;
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      html += `<div class="map-label ${it.cls}" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px">${it.text}</div>`;
    }
    if (html !== this._lastLabels) {
      this.labels.innerHTML = html;
      this._lastLabels = html;
    }
  }

  render() {
    const r = this.game.renderer;
    r.setClearColor(0x02030a, 1);
    r.clear();
    r.render(this.scene, this.camera);
    r.setClearColor(0x000000, 1);
  }
}
