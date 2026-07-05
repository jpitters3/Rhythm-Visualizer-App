import { supabase } from './supabase-client.js';
import { metroClick } from './noteplayer.js';
import { currentProfile } from './profile.js';
import { confirm } from './alert.js';

const SETTINGS_KEY = 'panafide_flash_card_settings';
const INTERVALS = [3, 5, 10, 15];
const METRO_SOUNDS = [ 'Shaker', 'Click', 'Off'];

const CATEGORY_ACCENTS = {
  'Special Touch':     { bg: 'rgba(147,51,234,0.1)',  color: '#9333ea' },
  'Dynamics':          { bg: 'rgba(59,130,246,0.1)',  color: '#3b82f6' },
  'Ding Articulation': { bg: 'rgba(249,115,22,0.1)',  color: '#f97316' },
  'Rolls':             { bg: 'rgba(34,197,94,0.1)',   color: '#22c55e' },
  'Subdivisions':      { bg: 'rgba(20,184,166,0.1)',  color: '#14b8a6' },
  'Patterns':          { bg: 'rgba(236,72,153,0.1)',  color: '#ec4899' },
  'Flashy Techniques': { bg: 'rgba(239,68,68,0.1)',   color: '#ef4444' },
  'Time Signature':    { bg: 'rgba(99,102,241,0.1)',  color: '#6366f1' },
};

let allCards = [];
let deck = [];
let deckIndex = 0;
let timer = null;
let progressAnimation = null;
let isPaused = false;
let settings = loadSettings();

// Metronome state
let metroBpm = 90;
let metroSoundIdx = 0;   // 0=Off, 1=Click, 2=Shaker
let metroTimer = null;
let metroBeat = 0;

// DOM refs
let overlay, cardInner, cardCategory, cardName, cardFace,
    deckCountEl, progressBar, toggleBtn, settingsPanel, settingsBody;
let metroBtn, metroLabel, fcBpmControls, fcBpmValue, disableBtn;

// Admin
let adminModal, adminBody, techEditorModal;
let editingTechId = null;

export function initFlashCards() {
  overlay        = document.getElementById('flashCardOverlay');
  cardInner      = document.getElementById('fcCardInner');
  cardCategory   = document.getElementById('fcCardCategory');
  cardName       = document.getElementById('fcCardName');
  cardFace       = document.getElementById('fcCardFace');
  deckCountEl    = document.getElementById('fcDeckCount');
  progressBar    = document.getElementById('fcProgressBar');
  toggleBtn      = document.getElementById('fcToggleBtn');
  settingsPanel  = document.getElementById('fcSettingsPanel');
  settingsBody   = document.getElementById('fcSettingsBody');

  document.getElementById('fcCloseBtn')?.addEventListener('click', closeFlashCards);
  document.getElementById('fcNextBtn')?.addEventListener('click', () => advance(1));
  document.getElementById('fcPrevBtn')?.addEventListener('click', () => advance(-1));
  toggleBtn?.addEventListener('click', togglePause);
  document.getElementById('fcSettingsBtn')?.addEventListener('click', toggleSettings);
  document.getElementById('fcSettingsCloseBtn')?.addEventListener('click', closeSettings);

  // Metronome
  metroBtn      = document.getElementById('fcMetroBtn');
  metroLabel    = document.getElementById('fcMetroLabel');
  fcBpmControls = document.getElementById('fcBpmControls');
  fcBpmValue    = document.getElementById('fcBpmValue');
  metroBtn?.addEventListener('click', cycleMetronome);
  document.getElementById('fcBpmDown')?.addEventListener('click', () => adjustBpm(-5));
  document.getElementById('fcBpmUp')?.addEventListener('click',   () => adjustBpm(5));

  disableBtn = document.getElementById('fcDisableBtn');
  disableBtn?.addEventListener('click', disableCurrentCard);

  // Admin
  adminModal     = document.getElementById('fcAdminModal');
  adminBody      = document.getElementById('fcAdminBody');
  techEditorModal = document.getElementById('fcTechEditorModal');
  document.getElementById('fcManageTechniquesBtn')?.addEventListener('click', openAdminModal);
  document.getElementById('fcAdminClose')?.addEventListener('click', closeAdminModal);
  document.getElementById('fcAdminAddBtn')?.addEventListener('click', () => openTechEditor(null));
  document.getElementById('fcTechEditorClose')?.addEventListener('click', closeTechEditor);
  document.getElementById('fcTechCancelBtn')?.addEventListener('click', closeTechEditor);
  document.getElementById('fcTechSaveBtn')?.addEventListener('click', saveTech);
  document.getElementById('fcTechDeleteBtn')?.addEventListener('click', deleteTech);

  document.addEventListener('keydown', onKeydown);
}

export async function openFlashCards(bpm = 90) {
  metroBpm = bpm;
  if (!allCards.length) {
    const { data, error } = await supabase
      .from('technique_flash_cards')
      .select('id, category, name, is_default_enabled, sort_order')
      .order('category').order('sort_order');

    if (error) { console.error('[FlashCards] fetch error:', error); return; }
    allCards = data || [];
  }

  buildDeck();

  if (!deck.length) {
    alert('No cards in your deck. Enable some techniques in Settings.');
    return;
  }

  deckIndex = 0;
  isPaused = false;
  metroSoundIdx = METRO_SOUNDS.findIndex(s => s !== 'Off');

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');

  renderCard(deck[0], false);
  startTimer();
  startMetronome();
  syncMetroUI();
}

function closeFlashCards() {
  stopTimer();
  stopMetronome();
  closeSettings();
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

// ── Metronome engine ──────────────────────────────────────────────────────

function cycleMetronome() {
  metroSoundIdx = (metroSoundIdx + 1) % METRO_SOUNDS.length;
  if (isMetroOn()) {
    startMetronome();
  } else {
    stopMetronome();
  }
  syncMetroUI();
}

function isMetroOn() {
  return METRO_SOUNDS[metroSoundIdx] !== 'Off';
}

function syncMetroUI() {
  const sound = METRO_SOUNDS[metroSoundIdx];
  const on    = isMetroOn();
  metroBtn.classList.toggle('active', on);
  metroLabel.textContent = sound;
  fcBpmControls.style.display = on ? 'flex' : 'none';
  if (fcBpmValue) fcBpmValue.textContent = metroBpm;
}

function disableCurrentCard() {
  const card = deck[deckIndex];
  if (!card) return;
  settings.cardEnabled = settings.cardEnabled ?? {};
  settings.cardEnabled[card.id] = false;
  saveSettings();
  deck.splice(deckIndex, 1);
  if (!deck.length) {
    closeFlashCards();
    return;
  }
  deckIndex = deckIndex % deck.length;
  renderCard(deck[deckIndex]);
  if (!isPaused) startTimer();
}

function adjustBpm(delta) {
  metroBpm = Math.min(300, Math.max(30, metroBpm + delta));
  if (fcBpmValue) fcBpmValue.textContent = metroBpm;
  if (isMetroOn()) startMetronome();
}

function startMetronome() {
  stopMetronome();
  metroBeat = 0;
  const intervalMs = (60 / metroBpm) * 1000;
  metroTimer = setInterval(tickMetro, intervalMs);
  tickMetro(); // immediate first tick
}

function stopMetronome() {
  clearInterval(metroTimer);
  metroTimer = null;
}

function tickMetro() {
  const kind  = metroBeat % 4 === 0 ? 'downbeat' : 'beat';
  const sound = METRO_SOUNDS[metroSoundIdx];
  metroBeat++;
  metroClick(kind, 0, sound);
}

// ── Deck ──────────────────────────────────────────────────────────────────

function buildDeck() {
  const enabled = settings.categoryEnabled ?? {};
  const cardEnabled = settings.cardEnabled ?? {};

  const active = allCards.filter(card => {
    // Category-level check
    const catDefault = isDefaultEnabled(card);
    const catOn = enabled[card.category] ?? (isCategoryDefaultEnabled(card.category));
    if (!catOn) return false;

    // Card-level check
    if (cardEnabled[card.id] !== undefined) return cardEnabled[card.id];
    return card.is_default_enabled;
  });

  deck = shuffle([...active]);
}

function isCategoryDefaultEnabled(category) {
  // A category is disabled by default if ALL its cards are is_default_enabled=false
  const cats = allCards.filter(c => c.category === category);
  return cats.some(c => c.is_default_enabled);
}

function isDefaultEnabled(card) {
  return card.is_default_enabled;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Card rendering ────────────────────────────────────────────────────────

function renderCard(card, animate = true) {
  const accent = CATEGORY_ACCENTS[card.category] ?? { bg: 'rgba(255,209,102,0.1)', color: '#ffd166' };

  if (animate) {
    // Phase 1: flip out
    cardInner.classList.add('flip-out');
    cardInner.addEventListener('transitionend', () => {
      updateCardContent(card, accent);
      // Phase 2: start from opposite side instantly
      cardInner.classList.remove('flip-out');
      cardInner.classList.add('flip-in');
      // Force reflow
      void cardInner.offsetWidth;
      // Phase 3: settle in
      cardInner.classList.remove('flip-in');
      cardInner.classList.add('flip-settle');
      cardInner.addEventListener('transitionend', () => {
        cardInner.classList.remove('flip-settle');
      }, { once: true });
    }, { once: true });
  } else {
    updateCardContent(card, accent);
  }

  deckCountEl.textContent = `${deckIndex + 1} / ${deck.length}`;
}

function updateCardContent(card, accent) {
  cardCategory.textContent = card.category;
  cardName.textContent = card.name;
  cardFace.style.setProperty('--fc-accent-bg', accent.bg);
  cardFace.style.setProperty('--fc-accent', accent.color);
  progressBar.style.background = accent.color;
}

// ── Timer & progress ──────────────────────────────────────────────────────

function startTimer() {
  stopTimer();
  if (isPaused) return;

  const duration = (settings.interval ?? 5) * 1000;

  // Animate progress bar from full → empty
  progressBar.style.transition = 'none';
  progressBar.style.transform = 'scaleX(1)';
  void progressBar.offsetWidth; // reflow
  progressBar.style.transition = `transform ${duration}ms linear`;
  progressBar.style.transform = 'scaleX(0)';

  timer = setTimeout(() => {
    advance(1);
  }, duration);
}

function stopTimer() {
  clearTimeout(timer);
  timer = null;
  cancelAnimationFrame(progressAnimation);
  progressBar.style.transition = 'none';
  progressBar.style.transform = 'scaleX(1)';
}

function advance(direction) {
  stopTimer();
  deckIndex = (deckIndex + direction + deck.length) % deck.length;

  // Re-shuffle at end of deck
  if (direction === 1 && deckIndex === 0) deck = shuffle(deck);

  renderCard(deck[deckIndex]);
  if (!isPaused) startTimer();
}

function togglePause() {
  isPaused = !isPaused;
  toggleBtn.textContent = isPaused ? '▶' : '⏸';
  if (isPaused) {
    stopTimer();
    stopMetronome();
  } else {
    startTimer();
    if (isMetroOn()) startMetronome();
  }
}

// ── Settings ─────────────────────────────────────────────────────────────

function toggleSettings() {
  const isOpen = settingsPanel.classList.contains('open');
  if (isOpen) closeSettings();
  else openSettings();
}

function openSettings() {
  renderSettings();
  settingsPanel.classList.add('open');
  settingsPanel.setAttribute('aria-hidden', 'false');
  document.getElementById('fcSettingsBtn').classList.add('active');
}

function closeSettings() {
  settingsPanel.classList.remove('open');
  settingsPanel.setAttribute('aria-hidden', 'true');
  document.getElementById('fcSettingsBtn')?.classList.remove('active');
}

function renderSettings() {
  const categories = [...new Set(allCards.map(c => c.category))];
  const catEnabled = settings.categoryEnabled ?? {};
  const cardEnabled = settings.cardEnabled ?? {};

  const intervalHtml = `
    <div class="fc-interval-group">
      <div class="fc-settings-label">Interval</div>
      <div class="fc-interval-options">
        ${INTERVALS.map(s => `
          <button class="fc-interval-btn${(settings.interval ?? 5) === s ? ' active' : ''}"
                  data-interval="${s}">${s}s</button>
        `).join('')}
      </div>
    </div>
  `;

  const categoriesHtml = categories.map(cat => {
    const catOn = catEnabled[cat] ?? isCategoryDefaultEnabled(cat);
    const cards = allCards.filter(c => c.category === cat);
    const accent = CATEGORY_ACCENTS[cat]?.color ?? '#ffd166';

    return `
      <div class="fc-settings-category">
        <div class="fc-settings-cat-header">
          <span class="fc-settings-cat-name" style="color:${accent}">${cat}</span>
          <label class="fc-toggle">
            <input type="checkbox" data-type="category" data-category="${cat}" ${catOn ? 'checked' : ''}>
            <span class="fc-toggle-track"></span>
          </label>
        </div>
        ${cards.map(card => {
          const on = cardEnabled[card.id] !== undefined ? cardEnabled[card.id] : card.is_default_enabled;
          return `
            <div class="fc-card-toggle-row">
              <span class="fc-card-toggle-name">${card.name}</span>
              <label class="fc-toggle">
                <input type="checkbox" data-type="card" data-id="${card.id}" ${on ? 'checked' : ''}>
                <span class="fc-toggle-track"></span>
              </label>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');

  settingsBody.innerHTML = intervalHtml + `<div class="fc-settings-label" style="margin-bottom:12px;">Techniques</div>` + categoriesHtml;

  const role = currentProfile?.role;
  const isAdmin = role === 'teacher' || role === 'admin';
  const adminFooter = document.getElementById('fcSettingsAdminFooter');
  if (adminFooter) adminFooter.style.display = isAdmin ? 'block' : 'none';

  // Wire interval buttons
  settingsBody.querySelectorAll('.fc-interval-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.interval = parseInt(btn.dataset.interval, 10);
      saveSettings();
      settingsBody.querySelectorAll('.fc-interval-btn').forEach(b => b.classList.toggle('active', b === btn));
      if (!isPaused) startTimer();
    });
  });

  // Wire toggles
  settingsBody.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      if (chk.dataset.type === 'category') {
        settings.categoryEnabled = settings.categoryEnabled ?? {};
        settings.categoryEnabled[chk.dataset.category] = chk.checked;
      } else {
        settings.cardEnabled = settings.cardEnabled ?? {};
        settings.cardEnabled[chk.dataset.id] = chk.checked;
      }
      saveSettings();
      buildDeck();
      deckIndex = Math.min(deckIndex, Math.max(0, deck.length - 1));
      deckCountEl.textContent = deck.length ? `${deckIndex + 1} / ${deck.length}` : '0 / 0';
    });
  });
}

// ── Persistence ───────────────────────────────────────────────────────────

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ── Keyboard ─────────────────────────────────────────────────────────────

function onKeydown(e) {
  if (!overlay.classList.contains('open')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === ' ') { e.preventDefault(); togglePause(); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); advance(1); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); advance(-1); }
  if (e.key === 'p')          togglePause();
  if (e.key === 'Escape')     { if (settingsPanel.classList.contains('open')) closeSettings(); else closeFlashCards(); }
}

// ── Admin ─────────────────────────────────────────────────────────────────

function isTeacherOrAdmin() {
  const role = currentProfile?.role;
  return role === 'teacher' || role === 'admin';
}

async function openAdminModal() {
  if (!isTeacherOrAdmin()) return;
  adminModal.classList.add('open');
  adminModal.setAttribute('aria-hidden', 'false');
  await renderAdminList();
}

function closeAdminModal() {
  adminModal.classList.remove('open');
  adminModal.setAttribute('aria-hidden', 'true');
  closeTechEditor();
}

async function renderAdminList() {
  const { data, error } = await supabase
    .from('technique_flash_cards')
    .select('id, category, name, is_default_enabled, sort_order')
    .order('category').order('sort_order');

  if (error) { console.error('[FlashCards admin] fetch error:', error); return; }

  // Refresh in-memory cards so the deck is up to date
  allCards = data || [];

  // Populate category datalist
  const categories = [...new Set(allCards.map(c => c.category))];
  const datalist = document.getElementById('fcTechCategoryList');
  if (datalist) datalist.innerHTML = categories.map(c => `<option value="${c}">`).join('');

  // Build list HTML grouped by category
  const grouped = {};
  for (const card of allCards) {
    (grouped[card.category] = grouped[card.category] || []).push(card);
  }

  adminBody.innerHTML = Object.entries(grouped).map(([cat, cards]) => `
    <div class="fc-admin-category-section">
      <div class="fc-admin-category-label">${cat}</div>
      ${cards.map(card => `
        <div class="fc-admin-row" data-id="${card.id}">
          <span class="fc-admin-row-name">${card.name}</span>
          <label class="fc-toggle" title="Enabled by default">
            <input type="checkbox" class="fc-admin-default-toggle" data-id="${card.id}" ${card.is_default_enabled ? 'checked' : ''}>
            <span class="fc-toggle-track"></span>
          </label>
          <button class="fc-admin-row-edit" data-id="${card.id}">Edit</button>
        </div>
      `).join('')}
    </div>
  `).join('');

  // Wire default-enabled toggles
  adminBody.querySelectorAll('.fc-admin-default-toggle').forEach(chk => {
    chk.addEventListener('change', async () => {
      const id = chk.dataset.id;
      await supabase.from('technique_flash_cards')
        .update({ is_default_enabled: chk.checked })
        .eq('id', id);
      const card = allCards.find(c => c.id === id);
      if (card) card.is_default_enabled = chk.checked;
    });
  });

  // Wire edit buttons
  adminBody.querySelectorAll('.fc-admin-row-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = allCards.find(c => c.id === btn.dataset.id);
      if (card) openTechEditor(card);
    });
  });
}

function openTechEditor(card) {
  editingTechId = card?.id ?? null;
  document.getElementById('fcTechEditorTitle').textContent = card ? 'Edit Technique' : 'Add Technique';
  document.getElementById('fcTechCategory').value = card?.category ?? '';
  document.getElementById('fcTechName').value = card?.name ?? '';
  document.getElementById('fcTechEnabled').checked = card ? card.is_default_enabled : true;
  document.getElementById('fcTechDeleteBtn').style.display = card ? '' : 'none';
  techEditorModal.classList.add('open');
  techEditorModal.setAttribute('aria-hidden', 'false');
  document.getElementById('fcTechName').focus();
}

function closeTechEditor() {
  techEditorModal.classList.remove('open');
  techEditorModal.setAttribute('aria-hidden', 'true');
  editingTechId = null;
}

async function saveTech() {
  const category = document.getElementById('fcTechCategory').value.trim();
  const name     = document.getElementById('fcTechName').value.trim();
  const enabled  = document.getElementById('fcTechEnabled').checked;

  if (!category || !name) {
    document.getElementById(category ? 'fcTechName' : 'fcTechCategory').focus();
    return;
  }

  if (editingTechId) {
    await supabase.from('technique_flash_cards')
      .update({ category, name, is_default_enabled: enabled })
      .eq('id', editingTechId);
  } else {
    await supabase.from('technique_flash_cards')
      .insert({ category, name, is_default_enabled: enabled, sort_order: 999 });
  }

  closeTechEditor();
  await renderAdminList();
}

async function deleteTech() {
  if (!editingTechId) return;
  if (!await confirm('Delete this technique?')) return;
  await supabase.from('technique_flash_cards').delete().eq('id', editingTechId);
  closeTechEditor();
  await renderAdminList();
}
