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
    },
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
