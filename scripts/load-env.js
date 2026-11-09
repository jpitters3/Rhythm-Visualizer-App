// Loads .env.prod (production) by default, or .env (staging) with --staging.
// .env.prod is deliberately not a Vite-recognised name, so builds never read it.
// --prod is still accepted (it's the default) so older commands keep working.
const path = require('path');
const fs = require('fs');

const isStaging = process.argv.includes('--staging');
const isProd = !isStaging;
const envFile = path.resolve(__dirname, isStaging ? '../.env' : '../.env.prod');

if (!fs.existsSync(envFile)) {
  console.error(`Missing ${path.basename(envFile)} in the repo root.`);
  process.exit(1);
}

require('dotenv').config({ path: envFile, quiet: true });

// Flags this loader owns, for scripts that read positional arguments.
const ENV_FLAGS = ['--staging', '--prod'];
const scriptArgs = process.argv.slice(2).filter(a => !ENV_FLAGS.includes(a));

const host = (process.env.VITE_SUPABASE_URL || '').replace(/^https?:\/\//, '');
console.error(`→ ${isProd ? 'PRODUCTION' : 'staging'}${host ? ` (${host})` : ''}`);

// Synchronous so nothing in the calling script runs before the answer.
function askSync(question) {
  process.stderr.write(question);
  const buf = Buffer.alloc(256);
  let input = '';
  while (!input.includes('\n')) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (err) {
      if (err.code === 'EAGAIN') continue;
      if (err.code === 'EOF') break;
      throw err;
    }
    if (n === 0) break;
    input += buf.toString('utf8', 0, n);
  }
  return input.trim();
}

if (isProd) {
  const command = [path.basename(process.argv[1]), ...scriptArgs].join(' ');
  const answer = askSync(`Run "${command}" on PRODUCTION? Type "yes" to continue: `);
  if (answer.toLowerCase() !== 'yes') {
    console.error('Cancelled. Nothing was run.');
    process.exit(1);
  }
}

module.exports = { isProd, isStaging, scriptArgs };
