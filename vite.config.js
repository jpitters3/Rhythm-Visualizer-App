import { defineConfig, loadEnv } from 'vite';
import fs from 'fs';
import path from 'path';

const REQUIRED_BUILD_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

export default defineConfig(({ command, mode }) => {
  // js/supabase-client.js throws at startup when these are missing, and since
  // that throw is unconditional in such a build, the minifier strips everything
  // after it as dead code. The result still builds and deploys, but the site is
  // blank. Fail the build instead, so a missing CI secret can't ship.
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const missing = REQUIRED_BUILD_ENV.filter(name => !env[name]?.trim());
    if (missing.length) {
      throw new Error(
        `Build stopped: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing or empty. ` +
        'Set it in .env for local builds, or as a secret in the deploy workflow\'s environment.'
      );
    }
  }

  return {
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
  };
});
