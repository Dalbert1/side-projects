// A whole planet: quadtree LOD terrain on a cube sphere, atmosphere shell,
// optional cloud layer and ring. Terrain chunks are built by the worker pool.

import * as THREE from 'three';
import { createSampler, cubeToSphere, buildChunkIndices } from '../world/planetgen.js';
import { Rng } from '../core/rng.js';
import {
  makeAtmoUniforms, setAtmoFromParams, makeTerrainMaterial, makeSkyMaterial, LIQUID_TYPE,
} from './shaders.js';
import { makeClouds } from './clouds.js';
import { makeRing } from './ring.js';

const indexCache = new Map();
function sharedIndex(N) {
  let idx = indexCache.get(N);
  if (!idx) {
    const raw = buildChunkIndices(N);
    idx = new THREE.BufferAttribute(new Uint16Array(raw), 1);
    indexCache.set(N, idx);
  }
  return idx;
}

const tmpDir = [0, 0, 0];

class Node {
  constructor(planet, face, level, ix, iy, parent) {
    this.planet = planet;
    this.face = face;
    this.level = level;
    this.ix = ix;
    this.iy = iy;
    this.parent = parent;
    this.children = null;
    this.mesh = null;
    this.ready = false;
    this.pending = false;
    this.lastUsed = 0;
    const size = 2 / (1 << level);
    cubeToSphere(face, -1 + (ix + 0.5) * size, -1 + (iy + 0.5) * size, tmpDir, 0);
    this.dx = tmpDir[0];
    this.dy = tmpDir[1];
    this.dz = tmpDir[2];
    this.worldSize = planet.faceArc / (1 << level);
    this.midR = planet.R + (planet.minH + planet.maxH) * 0.5;
  }

  ensureChildren() {
    if (this.children) return this.children;
    const l = this.level + 1;
    const x = this.ix * 2;
    const y = this.iy * 2;
    this.children = [
      new Node(this.planet, this.face, l, x, y, this),
      new Node(this.planet, this.face, l, x + 1, y, this),
      new Node(this.planet, this.face, l, x, y + 1, this),
      new Node(this.planet, this.face, l, x + 1, y + 1, this),
    ];
    return this.children;
  }
}

export class Planet {
  constructor(id, params, pool, quality) {
    this.id = id;
    this.params = params;
    this.pool = pool;
    this.quality = quality;
    this.R = params.radius;
    this.sampler = createSampler(params);
    this.pos = new THREE.Vector3(...(params.pos || [0, 0, 0]));
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.terrain = new THREE.Group();
    this.group.add(this.terrain);
    this.atmoU = makeAtmoUniforms();
    setAtmoFromParams(this.atmoU, params);
    this.material = makeTerrainMaterial(this.atmoU, LIQUID_TYPE[params.liquid] ?? 0, quality.detail !== false);
    this.N = quality.chunkRes;
    this.index = sharedIndex(this.N);
    this.faceArc = (Math.PI / 2) * this.R;
    const rootSpacing = this.faceArc / this.N;
    this.maxLevel = Math.max(3, Math.ceil(Math.log2(rootSpacing / quality.leafSpacing)));
    this._estimateHeights();
    this.roots = [];
    for (let f = 0; f < 6; f++) this.roots.push(new Node(this, f, 0, 0, 0, null));
    this.meshNodes = new Set();
    this.visibleList = [];
    this.frame = 0;
    pool.registerPlanet(id, params);

    if (params.atmo) {
      const geo = new THREE.SphereGeometry(params.atmo.radius, 64, 40);
      this.sky = new THREE.Mesh(geo, makeSkyMaterial(this.atmoU));
      this.sky.renderOrder = 5;
      this.sky.frustumCulled = false;
      this.group.add(this.sky);
    }
    if (params.clouds && quality.clouds !== false) {
      this.clouds = makeClouds(params, this.atmoU);
      this.clouds.renderOrder = 6;
      this.group.add(this.clouds);
    }
    if (params.ring) {
      this.ring = makeRing(params, this.atmoU);
      this.ring.renderOrder = 4;
      this.group.add(this.ring);
    }
    this.camLocal = new THREE.Vector3();
    this.altitude = Infinity;
  }

  _estimateHeights() {
    const rng = new Rng(this.params.seed ^ 0x5eed);
    let mn = Infinity, mx = -Infinity;
    const v = [0, 0, 0];
    for (let i = 0; i < 700; i++) {
      rng.unitVector(v);
      const h = this.sampler.groundHeight(v[0], v[1], v[2]);
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
    const t = this.params.terrain;
    this.minH = mn - 20 - (t.craters ? 40 : 0);
    this.maxH = mx + 40 + (t.spires ? t.spires.amp : 0);
    if (this.params.liquid) this.minH = Math.min(this.minH, -1);
  }

  // Ground radius (distance from center) under a unit direction
  surfaceRadius(x, y, z) {
    return this.R + this.sampler.groundHeight(x, y, z);
  }

  heightAt(x, y, z) {
    return this.sampler.groundHeight(x, y, z);
  }

  // Altitude of a planet local point above the displayed ground
  altitudeOf(p) {
    const len = p.length();
    return len - this.surfaceRadius(p.x / len, p.y / len, p.z / len);
  }

  update(cameraWorld, frame, splitFactor) {
    this.frame = frame;
    const cam = this.camLocal.copy(cameraWorld).sub(this.pos);
    const D = cam.length();
    this.distance = D;
    this.altitude = this.altitudeOf(cam);
    this.atmoU.uPlanetPos.value.copy(this.pos).sub(cameraWorld);

    for (const m of this.visibleList) m.visible = false;
    this.visibleList.length = 0;

    const Ro = this.R + this.minH;
    this._hx = cam.x / D;
    this._hy = cam.y / D;
    this._hz = cam.z / D;
    this._horizon = D > Ro ? Math.acos(Ro / D) + Math.acos(Math.min(1, Ro / (this.R + this.maxH))) : Math.PI;
    this._split = splitFactor;
    this._cam = cam;

    for (const r of this.roots) this._select(r);
    if (this.meshNodes.size > this.quality.meshBudget) this._evict();
  }

  _culled(node) {
    const c = this._hx * node.dx + this._hy * node.dy + this._hz * node.dz;
    const ang = Math.acos(Math.max(-1, Math.min(1, c)));
    const nodeAng = (node.worldSize * 0.75) / this.R;
    return ang - nodeAng > this._horizon;
  }

  _distance(node) {
    const cam = this._cam;
    const r = node.midR;
    const dx = cam.x - node.dx * r, dy = cam.y - node.dy * r, dz = cam.z - node.dz * r;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _request(node, dist) {
    if (node.ready || node.pending) return;
    this.pool.enqueue({
      planetId: this.id,
      node,
      N: this.N,
      priority: dist / (node.worldSize + 1) + node.level * 0.01 - (node.level === 0 ? 100 : 0),
      onDone: (chunk) => this._attach(node, chunk),
    });
  }

  _select(node) {
    node.lastUsed = this.frame;
    if (node.level > 0 && this._culled(node)) return;
    const dist = this._distance(node);
    const wantSplit = node.level < this.maxLevel && dist < node.worldSize * this._split;
    if (wantSplit) {
      const kids = node.ensureChildren();
      let all = true;
      for (const k of kids) {
        if (!k.ready) {
          all = false;
          this._request(k, this._distance(k));
        }
      }
      if (all) {
        for (const k of kids) this._select(k);
        return;
      }
    }
    if (node.ready) {
      node.mesh.visible = true;
      this.visibleList.push(node.mesh);
      return;
    }
    this._request(node, dist);
    // not built yet (or evicted): fall back to children if they can cover
    if (node.children && node.children.every((k) => k.ready)) {
      for (const k of node.children) this._select(k);
    }
  }

  _attach(node, chunk) {
    if (this.disposed) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(chunk.normals, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(chunk.colors, 4, true));
    geo.setIndex(this.index);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), chunk.radius);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(chunk.center[0], chunk.center[1], chunk.center[2]);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    this.terrain.add(mesh);
    node.mesh = mesh;
    node.ready = true;
    node.minR = chunk.minR;
    node.maxR = chunk.maxR;
    node.midR = (chunk.minR + chunk.maxR) * 0.5;
    this.meshNodes.add(node);
  }

  _disposeNode(node) {
    if (!node.mesh) return;
    this.terrain.remove(node.mesh);
    const geo = node.mesh.geometry;
    geo.setIndex(null); // shared, never dispose it
    geo.dispose();
    node.mesh = null;
    node.ready = false;
    this.meshNodes.delete(node);
  }

  _evict() {
    const budget = this.quality.meshBudget;
    const candidates = [];
    for (const n of this.meshNodes) {
      if (n.level <= 1 || n.mesh.visible || n.lastUsed === this.frame) continue;
      candidates.push(n);
    }
    candidates.sort((a, b) => a.lastUsed - b.lastUsed);
    let over = this.meshNodes.size - budget * 0.85;
    for (const n of candidates) {
      if (over <= 0) break;
      this._disposeNode(n);
      over--;
    }
  }

  // Coarse loading progress for nodes around the camera (used by loading gates)
  get loadedRoots() {
    return this.roots.every((r) => r.ready);
  }

  dispose() {
    this.disposed = true;
    for (const n of [...this.meshNodes]) this._disposeNode(n);
    this.pool.dropPlanet(this.id);
    this.material.dispose();
    if (this.sky) { this.sky.geometry.dispose(); this.sky.material.dispose(); }
    if (this.clouds) this.clouds.userData.dispose?.();
    if (this.ring) { this.ring.geometry.dispose(); this.ring.material.dispose(); }
    this.group.removeFromParent();
  }
}
