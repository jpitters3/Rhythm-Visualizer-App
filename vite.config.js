import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import fs from 'fs';

export default defineConfig({
  plugins: [],
  base: '/',
  server: {
    port: 3000,
    host: true, // Expose to local network
    https: {
      key: fs.readFileSync('.certs/localhost-key.pem'),
      cert: fs.readFileSync('.certs/localhost.pem'),
    }, // Required for camera on mobile
    open: false,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
      mangle: {
        toplevel: true,
      },
    },
  },
});
