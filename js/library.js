import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';
import { openAuthModal } from './auth.js';
import { getEffectiveHand } from './notegrid.js';
import { openComposerToComposition } from './song-composer.js';
import { loadPatternByName } from './controls.js';
import { Bus, BUS_EVENT } from './bus.js';

let currentTab = 'phrases';
let sortAscending = false;

export function initLibrary() {
  window.addEventListener('routeChanged', (e) => {
    if (e.detail.route === 'library') renderLibrary();
  });

  document.querySelectorAll('.library-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      document.querySelectorAll('.library-tab').forEach(b =>
        b.classList.toggle('active', b === btn)
      );
      renderLibrary();
    });
  });

  const orderBtn = document.getElementById('librarySortOrder');
  if (orderBtn) {
    orderBtn.addEventListener('click', () => {
      sortAscending = !sortAscending;
      orderBtn.textContent = sortAscending ? 'Oldest first' : 'Newest first';
      renderLibrary();
    });
  }

  Bus.on(BUS_EVENT.AUTH_LOGIN, () => {
    const isLibraryActive = document.getElementById('view-library')?.classList.contains('active');
    if (isLibraryActive) renderLibrary();
  });
}

async function renderLibrary() {
  const grid = document.getElementById('libraryGrid');
  if (!grid) return;

  if (!currentUser) {
    grid.innerHTML = `
      <div class="library-empty">
        <p>Sign in to view your phrases and compositions.</p>
        <button id="librarySignInBtn" class="primary-btn">Sign In</button>
      </div>`;
    document.getElementById('librarySignInBtn').addEventListener('click', openAuthModal);
    return;
  }

  grid.innerHTML = '<div class="library-empty">Loading…</div>';

  if (currentTab === 'phrases') {
    await loadPhrases(grid);
  } else if (currentTab === 'compositions') {
    await loadCompositions(grid);
  } else {
    grid.innerHTML = '<div class="library-empty">Archive coming soon.</div>';
  }
}

async function loadPhrases(grid) {
  const { data, error } = await supabase
    .from('patterns')
    .select('name, data, updated_at')
    .order('updated_at', { ascending: sortAscending });

  if (error || !data?.length) {
    grid.innerHTML = '<div class="library-empty">No phrases saved yet.</div>';
    return;
  }

  grid.innerHTML = '';
  data.forEach(row => grid.appendChild(buildCard({
    title: row.name,
    date: row.updated_at,
    patternData: row.data,
    onClick: () => {
      window.location.hash = '#freeplay';
      setTimeout(() => loadPatternByName(row.name), 120);
    }
  })));
}

async function loadCompositions(grid) {
  const { data, error } = await supabase
    .from('compositions')
    .select('id, title, created_at, composition_sections(position, type, pattern_snapshot)')
    .eq('is_snapshot', false)
    .order('created_at', { ascending: sortAscending });

  if (error || !data?.length) {
    grid.innerHTML = '<div class="library-empty">No compositions saved yet.</div>';
    return;
  }

  grid.innerHTML = '';
  data.forEach(row => {
    const sections = (row.composition_sections || [])
      .sort((a, b) => a.position - b.position);
    const firstPhrase = sections.find(s => s.type === 'phrase' && s.pattern_snapshot);
    grid.appendChild(buildCard({
      title: row.title || 'Untitled',
      date: row.created_at,
      patternData: firstPhrase?.pattern_snapshot ?? null,
      onClick: () => {
        window.location.hash = '#freeplay';
        setTimeout(() => openComposerToComposition(row.id), 120);
      },
    }));
  });
}

function buildCard({ title, date, patternData, onClick }) {
  const card = document.createElement('div');
  card.className = 'library-card';
  if (onClick) {
    card.addEventListener('click', onClick);
    card.style.cursor = 'pointer';
  }

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'library-thumb-wrap';

  const canvas = document.createElement('canvas');
  canvas.className = 'library-thumbnail';
  canvas.width = 320;
  canvas.height = 180;
  thumbWrap.appendChild(canvas);

  const dateStr = date
    ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const body = document.createElement('div');
  body.className = 'library-card-body';
  body.innerHTML = `
    <div class="library-card-title">${escapeHtml(title)}</div>
    <div class="library-card-meta">${dateStr}</div>
  `;

  card.appendChild(thumbWrap);
  card.appendChild(body);

  // Render thumbnail after the element exists in the DOM tree
  requestAnimationFrame(() => renderThumbnail(canvas, patternData));

  return card;
}

function renderPlayIconThumbnail(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const isDark = document.body.classList.contains('dark');

  ctx.fillStyle = isDark ? '#16162a' : '#f0f0f5';
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.28;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = isDark ? '#6366f1' : '#4f46e5';
  ctx.globalAlpha = 0.18;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Triangle play icon
  const ps = r * 0.52;
  ctx.beginPath();
  ctx.moveTo(cx - ps * 0.6, cy - ps);
  ctx.lineTo(cx - ps * 0.6, cy + ps);
  ctx.lineTo(cx + ps, cy);
  ctx.closePath();
  ctx.fillStyle = isDark ? '#6366f1' : '#4f46e5';
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function renderThumbnail(canvas, patternData) {
  if (!patternData) {
    renderPlayIconThumbnail(canvas);
    return;
  }
  const ctx = canvas.getContext('2d');

  const { labels = [], beats = 4, subdivision = 2, hands = [], steps } = patternData;
  const stepsPerMeasure = steps || (beats * subdivision);
  const totalSteps = labels.length;
  if (totalSteps === 0) return;

  const totalMeasures = Math.ceil(totalSteps / stepsPerMeasure);
  const measures = Math.min(4, totalMeasures);
  const stepsToRender = measures * stepsPerMeasure;

  const W = canvas.width;
  const H = canvas.height;
  const isDark = document.body.classList.contains('dark');

  ctx.fillStyle = isDark ? '#16162a' : '#f0f0f5';
  ctx.fillRect(0, 0, W, H);

  const padX = 14, padY = 14;
  const cellW = (W - padX * 2) / stepsPerMeasure;
  const cellH = (H - padY * 2) / measures;
  const radius = Math.min(cellW, cellH) * 0.38;

  // Reuse getEffectiveHand() from notegrid.js via a minimal mock context
  const mockCtx = { innerHands: hands, subdivision };

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Sub-dot layout offsets for the 2×2 quad (matches notegrid.js quad-container)
  // index: 0=lh-index(top-left), 1=lh-thumb(bot-left), 2=rh-index(top-right), 3=rh-thumb(bot-right)
  const subR = radius * 0.42;
  const subOff = radius * 0.5;
  const subOffsets = [
    [-subOff, -subOff], // 0: left top
    [-subOff,  subOff], // 1: left bottom
    [ subOff, -subOff], // 2: right top
    [ subOff,  subOff], // 3: right bottom
  ];
  // Left column (0,1) = L hand (blue), right column (2,3) = R hand (wine)
  const subColors = [
    isDark ? 'rgb(30,121,232)' : 'rgb(2,68,150)',
    isDark ? 'rgb(30,121,232)' : 'rgb(2,68,150)',
    isDark ? '#fd0380' : '#610a42',
    isDark ? '#fd0380' : '#610a42',
  ];

  for (let i = 0; i < stepsToRender; i++) {
    const col = i % stepsPerMeasure;
    const row = Math.floor(i / stepsPerMeasure);
    const x = padX + cellW * col + cellW / 2;
    const y = padY + cellH * row + cellH / 2;

    const label = labels[i];
    const isChord = Array.isArray(label);
    const hasNote = isChord
      ? label.some(l => l && l !== '')
      : (label && label !== '');
    const hand = getEffectiveHand(i, mockCtx);
    const fillColor = hand === 'R'
      ? (isDark ? '#fd0380' : '#610a42')
      : (isDark ? 'rgb(30,121,232)' : 'rgb(2,68,150)');

    if (isChord && hasNote) {
      // Faint background circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.globalAlpha = 0.12;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Draw each of the 4 sub-dots
      const subFontSize = Math.max(6, Math.floor(subR * 0.9));
      ctx.font = `bold ${subFontSize}px Inter, system-ui`;
      label.slice(0, 4).forEach((sl, si) => {
        const [dx, dy] = subOffsets[si];
        const sx = x + dx, sy = y + dy;
        ctx.beginPath();
        ctx.arc(sx, sy, subR, 0, Math.PI * 2);
        if (sl && sl !== '') {
          ctx.fillStyle = subColors[si];
          ctx.globalAlpha = 0.85;
          ctx.fill();
          ctx.globalAlpha = 1;
          const text = (sl === 'Ding' || sl === '0') ? 'D' : String(sl);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(text, sx, sy + 1);
        } else {
          ctx.fillStyle = subColors[si];
          ctx.globalAlpha = 0.2;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      });
      ctx.font = `bold ${Math.max(8, Math.floor(radius * 0.95))}px Inter, system-ui`;

    } else if (!isChord && hasNote) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = `bold ${Math.max(8, Math.floor(radius * 0.95))}px Inter, system-ui`;
      const text = (label === 'Ding' || label === '0') ? 'D' : String(label);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x, y + 1);

    } else {
      // Ghost dot
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.globalAlpha = 0.25;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
