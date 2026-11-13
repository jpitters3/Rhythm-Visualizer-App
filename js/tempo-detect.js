// Tempo and metre from note times (ms). Shared by Free record and Chord listen.

// Dominant inter-onset interval, folded into 40–180 BPM
export function detectBpm(times) {
  if (times.length < 4) return null;

  // Consecutive inter-onset intervals, ignoring pauses > 3 s and glitches < 60 ms
  const iois = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d >= 60 && d <= 3000) iois.push(d);
  }
  if (iois.length < 3) return null;

  // Histogram with 10 ms bins, triangle-smoothed so nearby bins share weight
  const BIN = 10;
  const bins = new Float32Array(301); // 0..3000 ms
  iois.forEach(d => {
    const b = Math.round(d / BIN);
    if (b >= bins.length) return;
    bins[b]     += 1;
    if (b > 0)  bins[b - 1] += 0.5;
    if (b > 1)  bins[b - 2] += 0.25;
    if (b < bins.length - 1) bins[b + 1] += 0.5;
    if (b < bins.length - 2) bins[b + 2] += 0.25;
  });

  let peak = 1, peakVal = 0;
  for (let i = 1; i < bins.length; i++) {
    if (bins[i] > peakVal) { peakVal = bins[i]; peak = i; }
  }

  const ioi = peak * BIN; // dominant IOI in ms
  if (ioi < 60) return null;

  let bpm = 60000 / ioi;
  while (bpm > 180) bpm /= 2;
  while (bpm < 40)  bpm *= 2;

  return Math.round(bpm);
}

// Beats per bar from how long each chord lasted: the metre (4 or 3) that more
// chords last a whole number of bars in. Counting fits, rather than adding up
// how far off each chord is, keeps a few freely played chords from outvoting a
// steady groove. Ties: the closer overall fit, then 4.
export function detectBeatsPerBar(chordBeats) {
  const lengths = chordBeats.filter(b => b >= 2);
  if (lengths.length < 2) return null;
  const fits = m => lengths.filter(b => b % m === 0).length;
  if (fits(3) !== fits(4)) return fits(3) > fits(4) ? 3 : 4;
  const misfit = m => lengths.reduce((sum, b) => sum + Math.abs(b - m * Math.max(1, Math.round(b / m))), 0);
  return misfit(3) < misfit(4) ? 3 : 4;
}
