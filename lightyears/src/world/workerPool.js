// Small pool of terrain workers with a priority queue that planets refill every frame.
// Falls back to building on the main thread (with a time budget) if workers are unavailable.

import { createSampler, buildChunk } from './planetgen.js';

export class TerrainWorkerPool {
  constructor(count) {
    this.workers = [];
    this.jobs = new Map();
    this.nextJob = 1;
    this.queue = [];
    this.planets = new Map();
    this.localSamplers = new Map();
    this.perWorker = 2;
    try {
      for (let i = 0; i < count; i++) {
        const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
        w.busy = 0;
        w.onmessage = (e) => this._onMessage(w, e.data);
        w.onerror = (err) => {
          console.warn('terrain worker failed, using main thread', err.message);
          this._disableWorkers();
        };
        this.workers.push(w);
      }
    } catch (err) {
      console.warn('workers unavailable, building terrain on main thread', err);
      this.workers = [];
    }
  }

  _disableWorkers() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    // any in-flight jobs are lost; let planets re-request
    for (const job of this.jobs.values()) job.onFail?.();
    this.jobs.clear();
  }

  registerPlanet(id, params) {
    this.planets.set(id, params);
    for (const w of this.workers) w.postMessage({ type: 'planet', id, params });
  }

  dropPlanet(id) {
    this.planets.delete(id);
    this.localSamplers.delete(id);
    for (const w of this.workers) w.postMessage({ type: 'drop', id });
    for (const [jobId, job] of this.jobs) {
      if (job.planetId === id) this.jobs.delete(jobId);
    }
    this.queue = this.queue.filter((q) => q.planetId !== id);
  }

  // Planets call this every frame for nodes they want. Lower priority value = sooner.
  enqueue(req) {
    this.queue.push(req);
  }

  update(budgetMs = 6) {
    if (!this.queue.length) return;
    this.queue.sort((a, b) => a.priority - b.priority);
    if (this.workers.length) {
      for (const req of this.queue) {
        const w = this._freeWorker();
        if (!w) break;
        if (req.node.pending || req.node.ready) continue;
        this._dispatch(w, req);
      }
    } else {
      const t0 = performance.now();
      for (const req of this.queue) {
        if (performance.now() - t0 > budgetMs) break;
        if (req.node.pending || req.node.ready) continue;
        let sampler = this.localSamplers.get(req.planetId);
        if (!sampler) {
          const params = this.planets.get(req.planetId);
          if (!params) continue;
          sampler = createSampler(params);
          this.localSamplers.set(req.planetId, sampler);
        }
        const n = req.node;
        const chunk = buildChunk(sampler, n.face, n.level, n.ix, n.iy, req.N);
        req.onDone(chunk);
      }
    }
    this.queue.length = 0;
  }

  _freeWorker() {
    let best = null;
    for (const w of this.workers) {
      if (w.busy < this.perWorker && (!best || w.busy < best.busy)) best = w;
    }
    return best;
  }

  _dispatch(w, req) {
    const jobId = this.nextJob++;
    const n = req.node;
    n.pending = true;
    w.busy++;
    this.jobs.set(jobId, { ...req, worker: w, onFail: () => { n.pending = false; } });
    w.postMessage({ type: 'chunk', jobId, planetId: req.planetId, face: n.face, level: n.level, ix: n.ix, iy: n.iy, N: req.N });
  }

  _onMessage(w, msg) {
    if (msg.type !== 'chunk') return;
    w.busy = Math.max(0, w.busy - 1);
    const job = this.jobs.get(msg.jobId);
    if (!job) return; // planet was dropped
    this.jobs.delete(msg.jobId);
    job.node.pending = false;
    if (msg.error) return;
    job.onDone(msg.chunk);
  }

  get inFlight() {
    return this.jobs.size;
  }
}
