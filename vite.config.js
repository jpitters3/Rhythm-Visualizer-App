import { defineConfig } from 'vite';

export default defineConfig({
  base: '/Rhythm-Visualizer-App/',
  server: {
    port: 3000,
    open: false, // Disable auto-open so it doesn't conflict with VS Code debugger
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
  optimizeDeps: {
    include: ['fix-webm-duration'],
  },
});
