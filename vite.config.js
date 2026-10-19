import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  plugins: [],
  base: '/',
  server: {
    port: 3000,
    host: true, // Expose to local network
    https: fs.existsSync('.certs/localhost-key.pem') && fs.existsSync('.certs/localhost.pem') 
      ? {
          key: fs.readFileSync('.certs/localhost-key.pem'),
          cert: fs.readFileSync('.certs/localhost.pem'),
        } 
      : false, // Required for camera on mobile, but optional for CI build
    open: false,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      input: {
        main:    path.resolve(__dirname, 'index.html'),
        tos:     path.resolve(__dirname, 'tos.html'),
        privacy: path.resolve(__dirname, 'privacy.html'),
      },
      output: {
        // main.js re-exports gridA/renderAllMeasures/etc. (see its own
        // comment) so Playwright can reach live app singletons by
        // dynamically importing the entry chunk's real deployed URL.
        // Rollup renames exported bindings by default when minifying
        // (independent of terser's own mangle.reserved below, which only
        // protects the *internal* variable name, not the public export
        // alias) — off so `import(url).gridA` etc. stay reachable by name
        // in the actual production bundle, not just Vite's dev server.
        minifyInternalExports: false,
      },
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
      mangle: {
        toplevel: true,
        reserved: ['gridA', 'gridB', 'renderAllMeasures', 'duplicateSelection', 'setRange', 'HistoryManager'],
      },
    },
  },
});
