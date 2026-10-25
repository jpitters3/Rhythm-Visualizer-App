// Loads .env (staging) by default, or .env.prod when --prod is passed.
// .env.prod is deliberately not a Vite-recognised name, so builds never read it.
const path = require('path');
const fs = require('fs');

const isProd = process.argv.includes('--prod');
const envFile = path.resolve(__dirname, isProd ? '../.env.prod' : '../.env');

if (isProd && !fs.existsSync(envFile)) {
  console.error('--prod needs a .env.prod file in the repo root.');
  process.exit(1);
}

require('dotenv').config({ path: envFile });

module.exports = { isProd };
