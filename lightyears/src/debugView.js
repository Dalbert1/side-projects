// Debug harness: render a single planet from a chosen vantage point for screenshots.
import * as THREE from 'three';
import { TerrainWorkerPool } from './world/workerPool.js';
import { generatePlanet } from './world/planetgen.js';
import { Planet } from './render/planet.js';
import { Backdrop } from './render/backdrop.js';
import { G } from './render/shaders.js';
import { setCloudRenderer } from './render/clouds.js';

export function runDebug(params) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.autoClear = false;
  document.body.appendChild(renderer.domElement);
  setCloudRenderer(renderer);

  const quality = { chunkRes: 32, leafSpacing: 1.4, splitFactor: 2.2, meshBudget: 700, skyRes: 256, stars: 3000 };
  const pool = new TerrainWorkerPool(3);
  const farScene = new THREE.Scene();
  const nearScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1e7);

  const backdrop = new Backdrop(renderer, quality);
  backdrop.setSystem({ seed: 7, galDir: [1, 0.1, 0.3], galUp: [0.2, 1, 0.1], core: 0.5, starColor: [1, 0.95, 0.85], nebA: [0.3, 0.1, 0.5], nebB: [0.05, 0.3, 0.5] });
  farScene.add(backdrop.group);

  const seed = +(params.get('seed') || 1234);
  const biome = params.get('biome') || undefined;
  const pp = generatePlanet(seed, { biome });
  pp.pos = [0, 0, 0];
  const planet = new Planet(1, pp, pool, quality);
  nearScene.add(planet.group);
  window.__planet = pp;

  const sun = G.uSunDir.value.set(...(params.get('sun') || '0.5,0.5,0.7').split(',').map(Number)).normalize();
  const view = params.get('view') || 'space';
  const R = pp.radius;
  const dir = new THREE.Vector3(...(params.get('dir') || '0.3,0.6,0.74').split(',').map(Number)).normalize();
  const setCam = () => {
    if (view === 'space') {
      camera.position.copy(dir).multiplyScalar(R * 3.2);
      camera.lookAt(0, 0, 0);
    } else {
      const alt = +(params.get('alt') || (view === 'low' ? 400 : 2));
      const h = planet.heightAt(dir.x, dir.y, dir.z);
      camera.position.copy(dir).multiplyScalar(R + Math.max(h, 0) + alt);
      // look toward the horizon along a tangent
      const up = dir.clone();
      const tangent = new THREE.Vector3(0, 1, 0).cross(up).normalize();
      const pitch = +(params.get('pitch') || (view === 'low' ? -0.35 : -0.05));
      const look = tangent.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
      camera.up.copy(up);
      camera.lookAt(camera.position.clone().add(look));
    }
  };
  setCam();

  let frame = 0;
  let settled = 0;
  function loop() {
    frame++;
    G.uTime.value = frame / 60;
    planet.update(camera.position, frame, quality.splitFactor);
    pool.update();
    if (planet.clouds) planet.clouds.rotation.y += 0.0002;
    backdrop.update(camera, 1, view === 'space' ? 0 : 0.9);
    renderer.clear();
    camera.near = 50; camera.far = 5e6; camera.updateProjectionMatrix();
    renderer.render(farScene, camera);
    renderer.clearDepth();
    camera.near = view === 'space' ? 10 : 0.3; camera.far = R * 8; camera.updateProjectionMatrix();
    renderer.render(nearScene, camera);
    if (pool.inFlight === 0) settled++; else settled = 0;
    window.__settled = settled > 5 && frame > 10;
    window.__stats = { frame, meshes: planet.meshNodes.size, visible: planet.visibleList.length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    requestAnimationFrame(loop);
  }
  loop();
}
