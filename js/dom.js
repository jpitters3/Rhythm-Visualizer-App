// Visibility helpers — the one sanctioned way to show/hide an element.
//
// Replaces the scattered `el.style.display = 'none' | '' | 'block' | ...`
// pattern (see the sizing-ownership lesson in js/panel-resize.js: layout
// controlled from many places is where the bugs live). Elements declare
// their visible display in CSS; these just flip the `hidden` attribute.
//
// css/layout.css has `[hidden] { display: none !important; }` so `hidden`
// wins even over an element whose CSS display is flex/grid. `show()` also
// clears a lingering inline `display` so elements still carrying the old
// `style="display:none"` markup reveal correctly during the migration.

export function show(el) {
  if (!el) return;
  el.hidden = false;
  if (el.style.display === 'none') el.style.display = '';
}

export function hide(el) {
  if (!el) return;
  el.hidden = true;
}

// force omitted → flip; force true → show; force false → hide.
export function toggle(el, force) {
  if (!el) return;
  const shouldShow = force === undefined ? el.hidden : force;
  if (shouldShow) show(el); else hide(el);
}

// Convenience for the common `el.style.display = cond ? '' : 'none'` line.
export function setVisible(el, visible) {
  if (visible) show(el); else hide(el);
}

export function isHidden(el) {
  return !el || el.hidden;
}
