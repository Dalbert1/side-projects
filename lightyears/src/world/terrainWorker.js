// Builds terrain chunks off the main thread.
import { createSampler, buildChunk } from './planetgen.js';

const samplers = new Map();

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'planet') {
    samplers.set(msg.id, createSampler(msg.params));
    if (samplers.size > 12) {
      const first = samplers.keys().next().value;
      samplers.delete(first);
    }
    return;
  }
  if (msg.type === 'drop') {
    samplers.delete(msg.id);
    return;
  }
  if (msg.type === 'chunk') {
    const sampler = samplers.get(msg.planetId);
    if (!sampler) {
      self.postMessage({ type: 'chunk', jobId: msg.jobId, error: 'no-planet' });
      return;
    }
    const c = buildChunk(sampler, msg.face, msg.level, msg.ix, msg.iy, msg.N);
    self.postMessage(
      { type: 'chunk', jobId: msg.jobId, chunk: c },
      [c.positions.buffer, c.normals.buffer, c.colors.buffer],
    );
  }
};
