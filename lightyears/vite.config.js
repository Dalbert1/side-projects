import { defineConfig } from 'vite'

export default defineConfig({
  base: '/side-projects/lightyears/',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  worker: {
    format: 'es',
  },
})
