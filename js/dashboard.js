import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';
import { gridA } from './grid-context.js';
import { playNoteByLabel, intervalMs, resolveHand } from './noteplayer.js';
import { dbLoadPatternByName } from './pattern-crud.js';
import { fetchCourses, openSidebar, setActiveCourse } from './courses.js';
import { updateDashboardMute } from './profile.js';
import { openAuthModal } from './auth.js';
import { navigate } from './router.js';

// Note positions — matches HANDPAN_MAP_BRONZE in handpanmap.js (calibrated for handpan-for-groovepan.png)
const PREVIEW_HP_MAP = {
  'Ding': { x: 48.1, y: 45.6, r: 12 },
  '1':    { x: 58.9, y: 75.7, r: 10 },
  '2':    { x: 34.4, y: 75.3, r: 10 },
  '3':    { x: 77.9, y: 59.2, r: 10 },
  '4':    { x: 17.9, y: 55.9, r: 10 },
  '5':    { x: 77.5, y: 34.8, r: 9  },
  '6':    { x: 21.1, y: 32.6, r: 9  },
  '7':    { x: 60,   y: 18.8, r: 8  },
  '8':    { x: 38.3, y: 18.6, r: 8  },
  'T':    { x: 61.1, y: 56.3, r: 7  },
  'S':    { x: 93.3, y: 47.9, r: 6  },
};

// Set to a YouTube video ID when ready, e.g. 'dQw4w9WgXcQ'
const GETTING_STARTED_VIDEO_ID = '';

let hpPreviewInterval = null;
const hpPreviewDots = new Map();
let previewCardEl = null;
let welcomeModalInitialized = false;
let previewMuted = false;

// ── Public API ────────────────────────────────────────────────────────────────

export function initDashboard() {
  if (localStorage.getItem('noWelcome') === '1') return;
  openWelcomeDashboard();
}

export function openWelcomeDashboard() {
  if (new URLSearchParams(window.location.search).has('noWelcome')) return;
  const welcomeModal = document.getElementById('welcomeModal');
  if (!welcomeModal) return;
  welcomeModal.classList.add('open');
  welcomeModal.setAttribute('aria-hidden', 'false');
  if (!welcomeModalInitialized) {
    welcomeModalInitialized = true;
    initWelcomeModal(welcomeModal);
  }
  updateAuthBtn(welcomeModal);
  // Show correct section based on auth state
  const dashboard   = welcomeModal.querySelector('#welcomeDashboard');
  const videoPreview = welcomeModal.querySelector('#welcomeVideoPreview');
  if (currentUser) {
    if (dashboard)    dashboard.style.display = '';
    if (videoPreview) videoPreview.style.display = 'none';
    loadWelcomeDashboard(welcomeModal);
  } else {
    if (dashboard)    dashboard.style.display = 'none';
    if (videoPreview) videoPreview.style.display = '';
  }
}

// ── Internal ──────────────────────────────────────────────────────────────────

function closeWelcomeModal() {
  const modal = document.getElementById('welcomeModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  clearInterval(hpPreviewInterval);
  hpPreviewInterval = null;
  hpPreviewDots.clear();
  previewCardEl = null;
}

function buildWelcomeHandpan(modal, override = {}) {
  const overlay = modal.querySelector('#welcomeHpOverlay');
  if (!overlay) return;

  clearInterval(hpPreviewInterval);
  hpPreviewInterval = null;
  overlay.innerHTML = '';
  hpPreviewDots.clear();

  // Build dots
  for (const [note, p] of Object.entries(PREVIEW_HP_MAP)) {
    const dot = document.createElement('div');
    dot.className = 'hp-dot';
    dot.dataset.note = note;
    dot.style.cssText = `left:${p.x}%;top:${p.y}%;width:${p.r * 2}%;height:${p.r * 2}%;transform:translate(-50%,-50%)`;
    const visual = document.createElement('div');
    visual.className = 'hp-visual';
    dot.appendChild(visual);
    overlay.appendChild(dot);
    hpPreviewDots.set(note, dot);
  }

  // Build sequence from ALL steps (including empty ones) so the rhythm is preserved.
  // Ghost notes (empty steps) advance the timer silently — no highlight, no sound.
  const rawLabels = override.labels ?? gridA?.innerLabels ?? [];
  const rawHands  = override.hands  ?? gridA?.innerHands  ?? [];
  // (serialized patterns use `labels`/`hands`; live grid uses `innerLabels`/`innerHands`)

  const sequence = rawLabels.map((l, stepIndex) => {
    if (!l) return { note: null, rawLabel: null, stepIndex };
    // Chord: preserve originalIdx so hand lookup stays aligned with rawHands[stepIndex]
    if (Array.isArray(l)) {
      const notes = l.map((s, originalIdx) => {
        const u = String(s).toUpperCase();
        const n = (u === 'D' || u === 'DING') ? 'Ding' : s;
        return PREVIEW_HP_MAP[n] ? { note: n, originalIdx } : null;
      }).filter(Boolean);
      return { note: notes.length ? notes : null, rawLabel: l, stepIndex };
    }
    const u = String(l).toUpperCase();
    const n = (u === 'D' || u === 'DING') ? 'Ding' : l;
    return { note: PREVIEW_HP_MAP[n] ? n : null, rawLabel: l, stepIndex };
  });

  // Fall back to circular demo (plays each tonefield in order) if pattern has no notes
  const hasNotes = sequence.some(s => s.note);
  const playSequence = hasNotes
    ? sequence
    : Object.keys(PREVIEW_HP_MAP).map((note, stepIndex) => ({ note, rawLabel: note, stepIndex }));

  const msCtx = override.bpm ? { bpm: override.bpm, subdivision: override.subdivision ?? 2 } : gridA;
  const ms = Math.max(80, intervalMs(msCtx));
  const animDuration = Math.max(200, ms * 3.2);

  let i = 0;
  hpPreviewInterval = setInterval(() => {
    const { note, rawLabel, stepIndex } = playSequence[i % playSequence.length];
    i++;

    // Play sound only when explicitly enabled (i.e. a card was clicked) and not muted
    if (rawLabel && override.sound && !previewMuted) {
      if (Array.isArray(rawLabel)) {
        rawLabel.forEach(l => { if (l) playNoteByLabel(l, stepIndex); });
      } else {
        playNoteByLabel(rawLabel, stepIndex);
      }
    }

    if (!note) return;

    // Chords: note is [{note, originalIdx}, ...]; single: note is a string
    const isChord = Array.isArray(note);
    const notesToHighlight = isChord ? note : [{ note, originalIdx: 0 }];
    const stepHandData = rawHands[stepIndex];
    const sub = override.subdivision ?? 2;
    for (const { note: n, originalIdx } of notesToHighlight) {
      const dot = hpPreviewDots.get(n);
      const visual = dot?.querySelector('.hp-visual');
      if (!visual) continue;

      const hand = resolveHand(stepIndex, stepHandData, originalIdx, isChord, sub);
      const down = hand === 'R';

      const shadowColor = down ? 'var(--down-fill)' : 'var(--up-fill)';
      visual.animate([
        { transform: 'scale(1)',   backgroundColor: 'rgba(255,255,255,0.4)', boxShadow: `0 0 20px 10px ${shadowColor}`, opacity: 1 },
        { transform: 'scale(1.5)', backgroundColor: 'transparent',           boxShadow: '0 0 0 0 transparent',          opacity: 0 },
      ], { duration: animDuration, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' });
    }
  }, ms);
}

function updateAuthBtn(modal) {
  const btn = modal.querySelector('#welcomeAuthBtn');
  if (!btn) return;
  btn.textContent = currentUser ? 'Sign Out' : 'Sign In';
}

function initWelcomeModal(modal) {
  modal.querySelector('#welcomeCloseBtn')?.addEventListener('click', closeWelcomeModal);

  // Mute toggle
  const muteBtn = modal.querySelector('#welcomeMuteBtn');
  muteBtn?.addEventListener('click', () => {
    previewMuted = !previewMuted;
    muteBtn.textContent = previewMuted ? '🔇' : '🔊';
    updateDashboardMute(previewMuted);
  });

  // Sign in / Sign out
  const authBtn = modal.querySelector('#welcomeAuthBtn');
  updateAuthBtn(modal);
  authBtn?.addEventListener('click', async () => {
    if (currentUser) {
      await supabase.auth.signOut();
    } else {
      closeWelcomeModal();
      openAuthModal();
    }
  });

  // Don't show on load
  const noShowCheck = modal.querySelector('#welcomeNoShowCheck');
  if (noShowCheck) {
    noShowCheck.checked = localStorage.getItem('noWelcome') === '1';
    noShowCheck.addEventListener('change', () => {
      localStorage.setItem('noWelcome', noShowCheck.checked ? '1' : '0');
    });
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeWelcomeModal();
  });

  // New Phrase
  modal.querySelector('#newPhraseWelcomeBtn')?.addEventListener('click', () => {
    closeWelcomeModal();
    document.getElementById('newPhraseBtn')?.click();
  });

  // Just Play
  modal.querySelector('#justPlayWelcomeBtn')?.addEventListener('click', () => {
    closeWelcomeModal();
  });

  // Courses
  modal.querySelector('#coursesWelcomeBtn')?.addEventListener('click', () => {
    closeWelcomeModal();
    document.getElementById('toggleSidebarBtn')?.click();
  });

  // Play button: inject YouTube iframe on click
  const playBtn = modal.querySelector('#welcomePlayBtn');
  const videoPlayer = modal.querySelector('#welcomeVideo');
  playBtn?.addEventListener('click', () => {
    if (!GETTING_STARTED_VIDEO_ID) return;
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${GETTING_STARTED_VIDEO_ID}?autoplay=1`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.allowFullscreen = true;
    videoPlayer.innerHTML = '';
    videoPlayer.appendChild(iframe);
  });
}

async function loadWelcomeDashboard(modal) {
  if (!currentUser) return;

  previewCardEl = null;
  buildWelcomeHandpan(modal);

  // Prefetch courses in the background so the sidebar opens instantly
  fetchCourses();

  // Greet by first name → username → email prefix; load mute preference
  const { currentProfile } = await import('./profile.js');
  const greetEl = modal.querySelector('#welcomeGreetName');
  if (greetEl) {
    greetEl.textContent = currentProfile?.first_name || currentProfile?.username || currentUser.email.split('@')[0];
  }

  // Restore mute preference
  if (currentProfile?.dashboard_mute != null) {
    previewMuted = !!currentProfile.dashboard_mute;
    const muteBtn = modal.querySelector('#welcomeMuteBtn');
    if (muteBtn) muteBtn.textContent = previewMuted ? '🔇' : '🔊';
  }

  const itemLimit = window.innerWidth <= 768 ? 1 : 3;

  const [phrasesRes, coursesRes, practiceRes] = await Promise.all([
    supabase.from('patterns').select('name, updated_at')
      .eq('user_id', currentUser.id)
      .order('updated_at', { ascending: false })
      .limit(itemLimit),
    supabase.from('user_courses').select('course_id')
      .eq('user_id', currentUser.id)
      .neq('is_archived', true)
      .limit(itemLimit),
    supabase.from('practice_items').select('id, title, item_type, reference_id')
      .eq('user_id', currentUser.id)
      .order('sort_order', { ascending: true })
      .limit(itemLimit),
  ]);

  // Resolve course titles in a second query (mirrors courses.js approach)
  let coursesData = [];
  const courseIds = (coursesRes.data || []).map(r => r.course_id);
  if (courseIds.length > 0) {
    const { data, error } = await supabase.from('courses')
      .select('id, title')
      .in('id', courseIds);
    if (error) console.error('[Dashboard] courses fetch error:', error);
    else coursesData = data || [];
  }

  renderDashItems(
    modal.querySelector('#dashRecentPhrases'),
    phrasesRes.data || [],
    (p) => ({ icon: '🎵', name: p.name, meta: formatDashDate(p.updated_at) }),
    (p) => {
      const sel = document.getElementById('patternSelect');
      const loadBtn = document.getElementById('loadBtn');
      if (sel && loadBtn) { sel.value = p.name; loadBtn.click(); }
      navigate('studio');
      closeWelcomeModal();
    },
    'No saved phrases yet',
    async (p) => {
      const data = await dbLoadPatternByName(p.name);
      if (data) buildWelcomeHandpan(modal, { ...data, sound: true });
    }
  );

  // Resolve last accessed lesson (title + pattern) per course
  const lastLessonByCourse = {};
  if (courseIds.length > 0) {
    const { data: progressData } = await supabase
      .from('user_lesson_progress')
      .select('lesson_id, lessons(title, pattern_json, sections(course_id))')
      .eq('user_id', currentUser.id)
      .order('completed_at', { ascending: false })
      .limit(50);
    for (const entry of (progressData || [])) {
      const courseId = entry.lessons?.sections?.course_id;
      if (courseId && courseIds.includes(courseId) && !lastLessonByCourse[courseId]) {
        lastLessonByCourse[courseId] = {
          title:   entry.lessons?.title        || '',
          pattern: entry.lessons?.pattern_json || null,
        };
      }
    }
  }

  renderDashItems(
    modal.querySelector('#dashRecentCourses'),
    coursesData,
    (c) => ({ icon: '📚', name: c.title, meta: lastLessonByCourse[c.id]?.title || '' }),
    (c) => { openSidebar(); setActiveCourse(c.id); closeWelcomeModal(); },
    'No enrolled courses yet',
    (c) => {
      const pattern = lastLessonByCourse[c.id]?.pattern;
      if (pattern) buildWelcomeHandpan(modal, { ...pattern, sound: true });
    }
  );

  renderDashItems(
    modal.querySelector('#dashRecentPractice'),
    practiceRes.data || [],
    (p) => ({ icon: p.item_type === 'pattern' ? '🎵' : '📖', name: p.title, meta: '' }),
    () => { document.getElementById('togglePracticeBtn')?.click(); closeWelcomeModal(); },
    'Practice plan is empty',
    async (p) => {
      const table = p.item_type === 'pattern' ? 'shared_patterns' : 'lessons';
      const { data } = await supabase.from(table).select('pattern_json').eq('id', p.reference_id).maybeSingle();
      if (data?.pattern_json) buildWelcomeHandpan(modal, { ...data.pattern_json, sound: true });
    }
  );
}

function renderDashItems(container, items, mapFn, onClickFn, emptyText, onPreviewFn = null) {
  if (!container) return;
  if (items.length === 0) {
    container.innerHTML = `<span class="welcome-dash-empty">${emptyText}</span>`;
    return;
  }
  container.innerHTML = '';
  items.forEach(item => {
    const { icon, name, meta } = mapFn(item);
    const card = document.createElement('button');
    card.className = 'welcome-item-card';
    card.innerHTML = `
      <span class="welcome-item-icon">${icon}</span>
      <span class="welcome-item-text">
        <span class="welcome-item-name">${name}</span>
        ${meta ? `<span class="welcome-item-meta">${meta}</span>` : ''}
      </span>
    `;
    card.addEventListener('click', () => {
      if (previewCardEl === card) {
        // Second click on the same card — open it
        onClickFn(item);
      } else {
        // First click — highlight and preview
        previewCardEl?.classList.remove('active');
        previewCardEl = card;
        card.classList.add('active');
        onPreviewFn?.(item);
      }
    });
    container.appendChild(card);
  });
}

function formatDashDate(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
