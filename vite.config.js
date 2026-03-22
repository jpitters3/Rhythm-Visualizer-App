import { defineConfig } from 'vite';
import fs from 'fs';

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
