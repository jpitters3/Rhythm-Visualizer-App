// Table of Contents
// + Helper Functions
// + Event Listeners

// HELPER FUNTIONS

// GROOVE MODAL FUNCTIONS //
 function openGrooveModal() {
  grooveModal.classList.add('open');
  grooveModal.setAttribute('aria-hidden', 'false');
  updateGroovePickerLimits();
  updateGrooveHint();
}

// ===== GROOVE GEN (Patch 3) =====
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clearAllBeatsAndLabels() {
  pattern.fill(false);
  innerLabels.fill('');
  cells().forEach((c) => {
    c.classList.remove('label-d', 'label-t', 'label-s', 'label-n', 'selected', 'play');
    const inner = c.querySelector('.inner');
    if (inner) inner.textContent = '';
  });
  selectedIndex = null;
}

function neighbors(i, steps) {
  const out = [];
  if (i - 1 >= 0) out.push(i - 1);
  if (i + 1 < steps) out.push(i + 1);
  return out;
}

// strength: 'strict' | 'soft' | 'none'
function pickPositions({ pool, count, used, strength }) {
  if (count <= 0) return [];
  const picks = [];

  const candidates = pool.filter(i => !used.has(i));
  shuffle(candidates);

  for (const i of candidates) {
    if (picks.length >= count) break;

    const hasAdj = neighbors(i, STEPS).some(j => used.has(j) || picks.includes(j));

    if (strength === 'strict' && hasAdj) continue;
    if (strength === 'soft' && hasAdj && Math.random() < 0.7) continue;

    picks.push(i);
    used.add(i);
  }

  // If we didn't fill due to neighbor rules, fill remaining without rules
  if (picks.length < count) {
    const remaining = pool.filter(i => !used.has(i));
    shuffle(remaining);
    for (const i of remaining) {
      if (picks.length >= count) break;
      picks.push(i);
      used.add(i);
    }
  }

  return picks;
}

// Applies D/T/S accents to the grid:
// - Beat 1 (index 0) is always Ding
// - No downbeat/upbeat bias (anything goes)
function applyGroove({ D, T, S, placement = 'none', completelyRandom = false, enforceThreeEmpty = false }) {
  const maxAccents = 8; // your rule: accents never exceed 8 in 8-step grid
  const minEmpty = 3;

  // clamp
  D = Math.max(0, Math.min(maxAccents, Math.floor(D)));
  T = Math.max(0, Math.min(maxAccents, Math.floor(T)));
  S = Math.max(0, Math.min(maxAccents, Math.floor(S)));

  // beat 1 always Ding
  if (D < 1) D = 1;

  if (enforceThreeEmpty) {
    const cap = Math.max(1, maxAccents - minEmpty); // keep >= 3 empty beats
    let total = D + T + S;
    if (total > cap) {
      let overflow = total - cap;
      while (overflow > 0 && S > 0) { S--; overflow--; }
      while (overflow > 0 && T > 0) { T--; overflow--; }
      while (overflow > 0 && D > 1) { D--; overflow--; }
    }
  }

  clearAllBeatsAndLabels();

  const all = cells();
  if (!all.length) return;

  // force beat 1
  pattern[0] = true;
  setInnerLabel(0, 'D');

  let dLeft = Math.max(0, D - 1);
  let tLeft = Math.max(0, T);
  let sLeft = Math.max(0, S);

  const pool = Array.from({ length: STEPS }, (_, i) => i).slice(1);
  const used = new Set([0]);

  if (completelyRandom) {
    const totalLeft = dLeft + tLeft + sLeft;
    shuffle(pool);
    const picks = pool.slice(0, totalLeft);

    const labelsArr = [];
    for (let i = 0; i < dLeft; i++) labelsArr.push('D');
    for (let i = 0; i < tLeft; i++) labelsArr.push('T');
    for (let i = 0; i < sLeft; i++) labelsArr.push('S');
    shuffle(labelsArr);

    for (let i = 0; i < picks.length; i++) {
      const idx = picks[i];
      pattern[idx] = true;
      setInnerLabel(idx, labelsArr[i] || '');
    }

    clearSelection();
    return;
  }

  const strength = placement; // 'strict' | 'soft' | 'none'

  const dPos = pickPositions({ pool, count: dLeft, used, strength });
  const tPos = pickPositions({ pool, count: tLeft, used, strength });
  const sPos = pickPositions({ pool, count: sLeft, used, strength });

  for (const idx of dPos) {
    pattern[idx] = true;
    setInnerLabel(idx, 'D');
  }
  for (const idx of tPos) {
    pattern[idx] = true;
    setInnerLabel(idx, 'T');
  }
  for (const idx of sPos) {
    pattern[idx] = true;
    setInnerLabel(idx, 'S');
  }

  clearSelection();
}

function closeGrooveModal() {
  grooveModal.classList.remove('open');
  grooveModal.setAttribute('aria-hidden', 'true');
}

function parseCount(inputEl) {
  const v = String(inputEl.value || '').trim();
  if (v === '') return null; // Auto
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(8, Math.floor(n))) : null;
}

function setCountClamped(inputEl, n) {
  const clamped = Math.max(0, Math.min(Number(inputEl.max || 8), Math.floor(n)));
  inputEl.value = String(clamped);
}

function updateGroovePickerLimits() {
  const d = parseCount(dingCount) ?? 0;
  const t = parseCount(takCount) ?? 0;
  const s = parseCount(slapCount) ?? 0;

  const maxD = Math.max(0, 8 - (t + s));
  const maxT = Math.max(0, 8 - (d + s));
  const maxS = Math.max(0, 8 - (d + t));

  dingCount.max = String(maxD);
  takCount.max = String(maxT);
  slapCount.max = String(maxS);

  // If user typed something above the new max, clamp it
  if (dingCount.value !== '' && Number(dingCount.value) > maxD) setCountClamped(dingCount, maxD);
  if (takCount.value !== '' && Number(takCount.value) > maxT) setCountClamped(takCount, maxT);
  if (slapCount.value !== '' && Number(slapCount.value) > maxS) setCountClamped(slapCount, maxS);
}

function updateGrooveHint() {
  const d = parseCount(dingCount);
  const t = parseCount(takCount);
  const s = parseCount(slapCount);

  const touched = (d !== null) || (t !== null) || (s !== null);
  if (!touched) {
    grooveHint.textContent = 'Auto mode: will generate a groove with at least 3 non-accented beats.';
    return;
  }
  const dd = d ?? 0, tt = t ?? 0, ss = s ?? 0;
  grooveHint.textContent = `Total accents: ${dd + tt + ss} / 8`;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickUniqueIndices(n, fromN) {
  const idx = Array.from({ length: fromN }, (_, i) => i);
  shuffle(idx);
  return idx.slice(0, n);
}

function clearAllBeatsAndLabels() {
  pattern.fill(false);
  innerLabels.fill('');
  cells().forEach((c, i) => {
    c.classList.remove('on', 'label-d', 'label-t', 'label-s', 'label-n', 'has-label', 'selected', 'play');
    const inner = c.querySelector('.inner');
    if (inner) inner.textContent = '';
  });
  selectedIndex = null;
}

// ===== GROOVE MODAL ===== //

function neighbors(i, slots) {
  const out = [];
  if (i - 1 >= 0) out.push(i - 1);
  if (i + 1 < slots) out.push(i + 1);
  return out;
}

function pickWithRules({ pool, n, slots, used, avoidAdjacency = true }) {
  const picks = [];
  const available = pool.filter(i => !used.has(i));

  // Try strict first (avoid adjacency), then relax if needed
  for (let pass = 0; pass < 2 && picks.length < n; pass++) {
    const strict = (pass === 0) && avoidAdjacency;

    // Recompute candidates each time
    let candidates = available.filter(i => !used.has(i));
    shuffle(candidates);

    for (const i of candidates) {
      if (picks.length >= n) break;

      if (strict) {
        const adj = neighbors(i, slots);
        const hasAdj = adj.some(j => used.has(j) || picks.includes(j));
        if (hasAdj) continue;
      }

      picks.push(i);
      used.add(i);
    }
  }

  // If still short, fill remaining without adjacency rules
  if (picks.length < n) {
    const remaining = available.filter(i => !used.has(i));
    shuffle(remaining);
    for (const i of remaining) {
      if (picks.length >= n) break;
      picks.push(i);
      used.add(i);
    }
  }

  return picks;
}

function generateGroove(dCount, tCount, sCount) {
  const slots = Math.min(8, STEPS);
  clearAllBeatsAndLabels();

  const allCells = cells();
  const used = new Set();

  // Step pools (8-step groove rules)
  const downbeats = [];
  const upbeats = [];
  for (let i = 0; i < slots; i++) {
    const isDown = (mode === '8') ? (i % 2 === 0) : ((i % 4) === 0);
    (isDown ? downbeats : upbeats).push(i);
  }

  // 1) Force "1" to be a Ding (step 0)
  const root = 0;
  pattern[root] = true;
  allCells[root]?.classList.add('on');
  setInnerLabel(root, 'D');
  used.add(root);

  // We already placed 1 Ding at step 0
  const remainingD = Math.max(0, dCount - 1);

  // 2) Place remaining Dings preferably on downbeats (musical anchor)
  const dIdx = pickWithRules({
    pool: downbeats.filter(i => i !== root),
    n: remainingD,
    slots,
    used,
    avoidAdjacency: true,
  });

  // 3) Place Taks mostly on upbeats (lighter syncopation), avoid adjacency
  const tIdx = pickWithRules({
    pool: upbeats,
    n: tCount,
    slots,
    used,
    avoidAdjacency: true,
  });

  // 4) Place Slaps also on upbeats, but allow some adjacency if needed
  // (slaps can be percussive “flair”, but still try to avoid clumps)
  const sIdx = pickWithRules({
    pool: upbeats,
    n: sCount,
    slots,
    used,
    avoidAdjacency: true,
  });

  // Apply Dings
  for (const i of dIdx) {
    pattern[i] = true;
    setInnerLabel(i, 'D');
  }

  // Apply Taks
  for (const i of tIdx) {
    pattern[i] = true;
    setInnerLabel(i, 'T');
  }

  // Apply Slaps
  for (const i of sIdx) {
    pattern[i] = true;
    setInnerLabel(i, 'S');
  }

  clearSelection();
}

// ===== GROOVE MODAL EVENTS =====
grooveBtn?.addEventListener('click', () => openGrooveModal());
grooveCancel?.addEventListener('click', () => closeGrooveModal());
grooveModal?.addEventListener('click', (e) => {
  if (e.target === grooveModal) closeGrooveModal();
});

;[dingCount, takCount, slapCount, complexitySelect].forEach((el) => {
  el?.addEventListener('input', updateGrooveHint);
  el?.addEventListener('change', updateGrooveHint);
});

grooveGo?.addEventListener('click', () => {
  const d = parseCount(dingCount);
  const t = parseCount(takCount);
  const s = parseCount(slapCount);
  const manual = (d !== null) || (t !== null) || (s !== null);

  // ===== Manual mode: ignore complexity =====
  if (manual) {
    let D = d ?? 0;
    let T = t ?? 0;
    let S = s ?? 0;

    if (D < 1) D = 1; // beat 1 ding

    if (D + T + S > 8) {
      alert('D + T + S cannot exceed 8.');
      return;
    }

    applyGroove({ D, T, S, placement: 'none', completelyRandom: false, enforceThreeEmpty: false });
    closeGrooveModal();
    return;
  }

  // ===== Complexity mode: ignore manual counts =====
  const c = complexitySelect?.value || '1';

  if (c === 'R') {
    // Completely random: no rules except beat 1 Ding
    const totalAccents = randInt(1, 8);
    const remaining = totalAccents - 1;

    const a = randInt(0, remaining);
    const b = randInt(0, remaining - a);
    const c2 = remaining - a - b;
    const parts = shuffle([a, b, c2]);

    const D = 1 + parts[0];
    const T = parts[1];
    const S = parts[2];

    applyGroove({ D, T, S, completelyRandom: true, enforceThreeEmpty: true });
    closeGrooveModal();
    return;
  }

  const level = (c === '2') ? 2 : (c === '3') ? 3 : 1;
  const maxTotal = (level === 1) ? 2 : (level === 2) ? 4 : 8;
  const placement = (level === 1) ? 'strict' : (level === 2) ? 'soft' : 'none';

  const totalAccents = randInt(1, maxTotal);
  const remaining = totalAccents - 1;

  const a = randInt(0, remaining);
  const b = randInt(0, remaining - a);
  const c3 = remaining - a - b;
  const parts = shuffle([a, b, c3]);

  const D = 1 + parts[0];
  const T = parts[1];
  const S = parts[2];

  applyGroove({ D, T, S, placement, completelyRandom: false, enforceThreeEmpty: true });
  closeGrooveModal();
});