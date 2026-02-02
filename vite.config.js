import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 8000, // Keep 8000 to match existing Playwright config
    open: true, // Auto-open browser
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
});
