import { defineConfig } from 'vite';

export default defineConfig({
  base: '/Rhythm-Visualizer-App/',
  server: {
    port: 3000,
    open: false,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
});
