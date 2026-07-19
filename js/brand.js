// Brand colours — single source of truth for JS/canvas contexts.
// CSS counterparts live in theme.css as --accent, --accent-dark, --accent-light.
// Mutable so the user's chosen accent (Account Settings > Appearance) can be
// applied to canvas/print contexts too, not just CSS. Importers get the
// live value automatically via ES module bindings.
const ACCENT_PRESETS = {
  blue:   { accent: '#024496', dark: '#013270', light: '#1e79e8' },
  purple: { accent: '#4a2e8c', dark: '#341f66', light: '#7c5cff' },
};

// Match the pre-set class already applied to <body> by the anti-flash inline
// script in index.html, so canvas/print colours agree with CSS on first paint.
const initialPreset = ACCENT_PRESETS[localStorage.getItem('accentColor')] || ACCENT_PRESETS.blue;

export let ACCENT       = initialPreset.accent;
export let ACCENT_DARK  = initialPreset.dark;
export let ACCENT_LIGHT = initialPreset.light;

export function setAccentPreset(name) {
  const preset = ACCENT_PRESETS[name] || ACCENT_PRESETS.blue;
  ACCENT       = preset.accent;
  ACCENT_DARK  = preset.dark;
  ACCENT_LIGHT = preset.light;
}

// Music notation colours — independent of brand accent.
// CSS counterparts: --down-fill (#610a42) and --up-fill in grid-and-labels.css.
export const DOWN = '#610a42'; // wine red — right hand / downbeat
export const UP   = '#024496'; // blue — left hand / upbeat (same as ACCENT in light mode)
