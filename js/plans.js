/* Plans: Free, Panafide+ and Panafide Pro side by side */
import { Modal } from './modal.js';
import { FREE_LIMIT, activeTierRank } from './gated-feature.js';

const YES = true;
const NO = false;

// Each value is [Free, Panafide+, Panafide Pro]: true/false for a tick or a
// dash, or text. Only list what the app actually enforces.
const PLAN_SECTIONS = [
  {
    title: 'Create',
    rows: [
      ['Saved phrases', [FREE_LIMIT.unlimited_patterns, 'Unlimited', 'Unlimited']],
      ['Compositions', [FREE_LIMIT.unlimited_compositions, 'Unlimited', 'Unlimited']],
      ['Custom handpan scales', [FREE_LIMIT.custom_scales, 'Unlimited', 'Unlimited'], 'Calibrated to your own pan'],
      ['Download audio', [NO, YES, YES]],
    ],
  },
  {
    title: 'Play and practise',
    rows: [
      ['Studio, playback and metronome', [YES, YES, YES]],
      ['All standard scales', [YES, YES, YES]],
      ['The Handpan Games', [YES, YES, YES]],
      ['Pan Hero', [NO, YES, YES], 'Play along to falling notes'],
    ],
  },
  {
    title: 'AI and early access',
    rows: [
      ['AI Assistant', [NO, NO, YES], 'Chord and composition suggestions'],
      ['Early access to new features', [NO, NO, YES]],
    ],
  },
];

let plansModal, plansPanel;

export function initPlans({ onUpgrade }) {
  plansModal = document.getElementById('plansModal');
  if (!plansModal) return;
  plansPanel = new Modal(plansModal);

  renderPlanTable(plansModal.querySelector('.plans-table'));

  document.getElementById('closePlansBtn')?.addEventListener('click', () => plansPanel.close());
  document.querySelectorAll('[data-open-plans]').forEach(btn =>
    btn.addEventListener('click', openPlansModal));

  const upgradeBtn = document.getElementById('plansUpgradeBtn');
  upgradeBtn?.addEventListener('click', () => onUpgrade(upgradeBtn));
}

export function openPlansModal() {
  if (!plansPanel) return;
  const rank = activeTierRank();
  plansModal.querySelectorAll('[data-plan-rank]').forEach(el => {
    el.classList.toggle('is-current', Number(el.dataset.planRank) === rank);
  });
  document.getElementById('plansUpgradeBtn')?.toggleAttribute('hidden', rank >= 1);
  plansPanel.open();
}

function cellContent(value) {
  if (value === YES) return '<span class="plans-yes" aria-label="Included">✓</span>';
  if (value === NO) return '<span class="plans-no" aria-label="Not included">–</span>';
  return `<span class="plans-text">${value}</span>`;
}

function renderPlanTable(table) {
  if (!table) return;
  table.querySelector('tbody')?.remove();
  const body = document.createElement('tbody');
  body.innerHTML = PLAN_SECTIONS.map(section => `
    <tr class="plans-section"><th colspan="4" scope="colgroup">${section.title}</th></tr>
    ${section.rows.map(([name, values, note]) => `
      <tr>
        <th scope="row">${name}${note ? `<small>${note}</small>` : ''}</th>
        ${values.map((v, i) => `<td data-plan-rank="${i}">${cellContent(v)}</td>`).join('')}
      </tr>`).join('')}
  `).join('');
  table.appendChild(body);
}
