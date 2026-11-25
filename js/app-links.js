// Links from a lesson into the rest of Panafide (lessons.app_link):
//   'game:<id>'     a Handpan Game, opened straight into the game
//   'page:<route>'  an app page (#route)
//   anything else   a Panafide URL or '#route' link, typed by the course author

import { navigate } from './router.js';
import { DOMAIN_GAMES, findGame, openGame } from './handpan-games.js';

const PAGES = [
  { route: 'games', name: 'The Handpan Games', icon: '🎮' },
  { route: 'studio', name: 'Studio', icon: '🎛️' },
  { route: 'listen', name: 'Chord Listen', icon: '🎙️' },
  { route: 'library', name: 'Library', icon: '📚' },
  { route: 'practice', name: 'Practice', icon: '🗓️' },
  { route: 'community', name: 'Community', icon: '👥' },
  { route: 'dashboard', name: 'Dashboard', icon: '🏠' },
];

const PANAFIDE_HOSTS = ['panafide.com', 'www.panafide.com'];

// Choices for the Course Creator's "Open in Panafide" picker.
export function appLinkChoices() {
  return [
    { group: 'Games', options: Object.values(DOMAIN_GAMES).flat().map(g => ({ value: `game:${g.id}`, label: `${g.icon} ${g.name}` })) },
    { group: 'Pages', options: PAGES.map(p => ({ value: `page:${p.route}`, label: `${p.icon} ${p.name}` })) },
  ];
}

export const isPickedLink = (link) =>
  appLinkChoices().some(group => group.options.some(o => o.value === link));

// A typed link must stay inside Panafide: '#route', '/path', or a panafide.com
// (or this site's own) URL. Returns the cleaned link, or null.
export function cleanCustomLink(text) {
  const link = String(text ?? '').trim();
  if (!link) return null;
  if (link.startsWith('#') || (link.startsWith('/') && !link.startsWith('//'))) return link;
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (PANAFIDE_HOSTS.includes(url.hostname) || url.host === location.host) return url.toString();
  } catch { /* not a URL */ }
  return null;
}

// What the lesson's button says.
export function appLinkLabel(link) {
  if (!link) return '';
  if (link.startsWith('game:')) {
    const game = findGame(link.slice(5));
    return game ? `${game.icon} Play ${game.name}` : '';
  }
  if (link.startsWith('page:')) {
    const page = PAGES.find(p => p.route === link.slice(5));
    return page ? `${page.icon} Open ${page.name}` : '';
  }
  return cleanCustomLink(link) ? '🔗 Open in Panafide' : '';
}

export function openAppLink(link) {
  if (!link) return;
  if (link.startsWith('game:')) {
    openGame(link.slice(5));
  } else if (link.startsWith('page:')) {
    navigate(link.slice(5));
  } else {
    const clean = cleanCustomLink(link);
    if (!clean) return;
    if (clean.startsWith('#')) {
      location.hash = clean;
      return;
    }
    // Same page on whichever site this is (staging links stay on staging).
    const url = new URL(clean, location.href);
    location.assign(`${location.origin}${url.pathname}${url.search}${url.hash}`);
  }
}
