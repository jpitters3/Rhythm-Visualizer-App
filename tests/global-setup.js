// Runs once before the suite: clears test courses that killed runs left behind.
const { sweepTestCourses } = require('./utils/seed-helper');

module.exports = async function globalSetup() {
  try {
    const swept = await sweepTestCourses();
    if (swept) console.log(`[global-setup] removed ${swept} leftover test course(s)`);
  } catch (err) {
    console.warn('[global-setup] test course sweep skipped:', err.message);
  }
};
