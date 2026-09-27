// Bake a procedural shader into a cube map once (clouds, nebula skies).
import * as THREE from 'three';
import { SNOISE_GLSL } from './noiseGLSL.js';

const BAKE_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export function bakeCube(renderer, fragBody, size, uniforms = {}) {
  const rt = new THREE.WebGLCubeRenderTarget(size, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const cam = new THREE.CubeCamera(0.1, 10, rt);
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms,
    vertexShader: BAKE_VERT,
    fragmentShader: `${SNOISE_GLSL}\nvarying vec3 vDir;\n${fragBody}`,
    toneMapped: false,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat);
  scene.add(box);
  const prevAuto = renderer.autoClear;
  renderer.autoClear = true;
  cam.update(renderer, scene);
  renderer.autoClear = prevAuto;
  box.geometry.dispose();
  mat.dispose();
  return rt;
}
