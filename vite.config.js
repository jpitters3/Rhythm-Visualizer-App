import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000, // Change port to avoid cache/conflict on 8000
    open: true, // Auto-open browser
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
});
