// The Handpan Games — a fullscreen hub (route #games) for skill-sharpening
// games grouped by competency domain. Phase 0: the home + the 10 domain
// tiles. Individual games, the competency graph and progress tracking come
// later; see the plan / project_handpan_games memo.

import { navigate } from './router.js';

// The ten domains of the Handpan Pathway. `status`: 'soon' until a domain
// has at least one playable game.
const DOMAINS = [
  { id: 'technique',     name: 'Technique',             icon: '🎯', blurb: 'Cleaner strikes, better tone, more control.',    status: 'soon' },
  { id: 'rhythm',        name: 'Rhythm',                icon: '🥁', blurb: 'Lock the pulse, subdivide, displace, groove.',    status: 'soon' },
  { id: 'coordination',  name: 'Coordination',          icon: '🤹', blurb: 'Hand independence and interplay.',                status: 'soon' },
  { id: 'patterns',      name: 'Patterns & Vocabulary', icon: '🧩', blurb: 'Build a library of go-to phrases.',               status: 'soon' },
  { id: 'harmony',       name: 'Harmony',               icon: '🎶', blurb: 'Chords, tension, and resolution.',                status: 'soon' },
  { id: 'melody',        name: 'Melody',                icon: '🎵', blurb: 'Sing on the pan; shape a line.',                  status: 'soon' },
  { id: 'composition',   name: 'Composition',           icon: '✍️', blurb: 'Turn ideas into finished pieces.',                status: 'soon' },
  { id: 'improvisation', name: 'Improvisation',         icon: '⚡', blurb: 'Play freely without freezing up.',                status: 'soon' },
  { id: 'expression',    name: 'Expression',            icon: '💫', blurb: 'Dynamics, phrasing, feel.',                       status: 'soon' },
  { id: 'collaboration', name: 'Collaboration',         icon: '👥', blurb: 'Play with others and hold your part.',            status: 'soon' },
];

let rendered = false;

export function initHandpanGames() {
  const view = document.getElementById('view-games');
  if (!view) return;

  // Lazy-render on first navigation to the route.
  window.addEventListener('routeChanged', (e) => {
    if (e.detail.route === 'games' && !rendered) render(view);
  });
  if (document.body.classList.contains('route-games')) render(view);
}

function render(view) {
  rendered = true;

  const tiles = DOMAINS.map(d => `
    <button class="hg-tile" data-domain="${d.id}" data-status="${d.status}" type="button">
      <span class="hg-tile-icon" aria-hidden="true">${d.icon}</span>
      <span class="hg-tile-body">
        <span class="hg-tile-topline">
          <span class="hg-tile-name">${d.name}</span>
          ${d.status === 'soon' ? '<span class="hg-tile-pill">Soon</span>' : ''}
        </span>
        <span class="hg-tile-blurb">${d.blurb}</span>
      </span>
    </button>
  `).join('');

  view.innerHTML = `
    <div class="hg-container">
      <button class="hg-back" type="button" aria-label="Back">← Back</button>
      <header class="hg-header">
        <p class="hg-eyebrow">The Handpan Games</p>
        <h1 class="hg-title">Sharpen your handpan game</h1>
        <p class="hg-subtitle">A growing set of games across ten skills. Pick a domain to begin.</p>
      </header>
      <div class="hg-grid">${tiles}</div>
    </div>
  `;

  view.querySelector('.hg-back')?.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else navigate('dashboard');
  });

  view.querySelectorAll('.hg-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      if (tile.dataset.status === 'soon') {
        tile.classList.remove('hg-nudge');
        void tile.offsetWidth; // restart the animation
        tile.classList.add('hg-nudge');
        return;
      }
      // Future: navigate into the domain's game path.
    });
  });
}
