// recording-trim.js
// Non-destructive trim editor for composition recording sections.
// Renders a waveform canvas with draggable start/end handles and a playhead.
// On Apply: renders the trimmed region via OfflineAudioContext, encodes to WAV,
// and overwrites the file in Supabase Storage (destructive, no extra DB columns needed).

import { supabase } from './supabase-client.js';

// ── State ──────────────────────────────────────────────────────────────────
let _audioPath  = null;   // storage path (section.audio_url)
let _sectionId  = null;
let _trimStart  = 0;
let _trimEnd    = null;   // set once audio is decoded
let _duration   = 0;
let _buffer     = null;   // AudioBuffer — waveform + rendering
let _dragging   = null;   // 'start' | 'end'
let _preview    = null;   // HTMLAudioElement for preview
let _previewRaf = null;   // rAF handle for playhead animation
let _signedUrl  = null;
let _onClose    = null;
let _onApply    = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const _panel    = () => document.getElementById('composerTrimPanel');
const _canvas   = () => document.getElementById('composerWaveform');
const _seekRow  = () => document.getElementById('composerSeekRow');
const _controls = () => document.querySelector('.playbar-controls');

// ── Helpers ────────────────────────────────────────────────────────────────
function _fmt(secs) {
  if (!isFinite(secs) || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Waveform + playhead drawing ────────────────────────────────────────────
function _draw() {
  const cvs = _canvas();
  if (!cvs || !_buffer) return;

  const rect = cvs.getBoundingClientRect();
  if (!rect.width) return;

  const dpr  = window.devicePixelRatio || 1;
  cvs.width  = rect.width  * dpr;
  cvs.height = rect.height * dpr;

  const ctx = cvs.getContext('2d');
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;

  // Background
  ctx.fillStyle = '#12121e';
  ctx.fillRect(0, 0, W, H);

  // Centre line
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();

  // Waveform bars (min/max amplitude per pixel column)
  const data         = _buffer.getChannelData(0);
  const samplesPerPx = data.length / W;

  for (let x = 0; x < W; x++) {
    const s0 = Math.floor(x * samplesPerPx);
    const s1 = Math.floor((x + 1) * samplesPerPx);
    let min = 0, max = 0;
    for (let i = s0; i < s1; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
    const yTop = ((1 - max) / 2) * H;
    const yBot = ((1 - min) / 2) * H;
    ctx.fillStyle = '#4a90e2';
    ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
  }

  // Trimmed-out overlays
  const startX = (_trimStart / _duration) * W;
  const endX   = ((_trimEnd  ?? _duration) / _duration) * W;

  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  if (startX > 0) ctx.fillRect(0,    0, startX,   H);
  if (endX   < W) ctx.fillRect(endX, 0, W - endX, H);

  // Trim handles
  _drawHandle(ctx, startX, W, H, 'start');
  _drawHandle(ctx, endX,   W, H, 'end');

  // Playhead (drawn last so it's always on top)
  if (_preview && isFinite(_preview.currentTime) && _duration > 0) {
    const px = (_preview.currentTime / _duration) * W;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();
  }
}

function _drawHandle(ctx, x, W, H, side) {
  const color = '#e2714a';
  const cx    = Math.max(1, Math.min(W - 1, x));

  ctx.strokeStyle = color;
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, H);
  ctx.stroke();

  const tabW = 14;
  const tabH = 22;
  const tabX = side === 'start' ? cx : cx - tabW;
  const tabY = H / 2 - tabH / 2;

  ctx.fillStyle = color;
  _roundRect(ctx, tabX, tabY, tabW, tabH, 3);
  ctx.fill();

  ctx.fillStyle    = '#fff';
  ctx.font         = '10px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(side === 'start' ? '◀' : '▶', cx + (side === 'start' ? tabW / 2 : -tabW / 2), H / 2);
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Time display ───────────────────────────────────────────────────────────
function _updateTimes() {
  document.getElementById('trimStartDisplay').textContent = _fmt(_trimStart);
  document.getElementById('trimEndDisplay').textContent   = _fmt(_trimEnd ?? _duration);
}

// ── Canvas pointer interaction ─────────────────────────────────────────────
const HIT = 14;

function _xToTime(x, W) {
  return Math.max(0, Math.min(_duration, (x / W) * _duration));
}

function _hitHandle(x, W) {
  const startX = (_trimStart / _duration) * W;
  const endX   = ((_trimEnd  ?? _duration) / _duration) * W;
  if (Math.abs(x - startX) <= HIT) return 'start';
  if (Math.abs(x - endX)   <= HIT) return 'end';
  return null;
}

function _clientX(e) {
  const rect = _canvas().getBoundingClientRect();
  const cx   = e.touches ? e.touches[0].clientX : e.clientX;
  return cx - rect.left;
}

function _onDown(e) {
  const W = _canvas().getBoundingClientRect().width;
  _dragging = _hitHandle(_clientX(e), W);
  if (_dragging) e.preventDefault();
}

function _onMove(e) {
  const cvs = _canvas();
  const W   = cvs.getBoundingClientRect().width;
  const x   = _clientX(e);

  cvs.style.cursor = _hitHandle(x, W) ? 'ew-resize' : 'default';

  if (!_dragging) return;
  e.preventDefault();

  const t = _xToTime(x, W);
  if (_dragging === 'start') {
    _trimStart = Math.min(t, (_trimEnd ?? _duration) - 0.05);
  } else {
    _trimEnd = Math.max(t, _trimStart + 0.05);
  }

  _draw();
  _updateTimes();
}

function _onUp() { _dragging = null; }

// ── Preview ────────────────────────────────────────────────────────────────
function _stopPreviewRaf() {
  if (_previewRaf) { cancelAnimationFrame(_previewRaf); _previewRaf = null; }
}

function _animatePlayhead() {
  _draw();
  if (_preview && !_preview.paused) {
    _previewRaf = requestAnimationFrame(_animatePlayhead);
  } else {
    _previewRaf = null;
    _draw(); // final draw without playhead running
  }
}

function _stopPreview() {
  _stopPreviewRaf();
  if (_preview) { _preview.pause(); _preview = null; }
  const btn = document.getElementById('trimPreviewBtn');
  if (btn) btn.textContent = '▶ Preview';
  _draw(); // clear playhead
}

function _togglePreview() {
  if (_preview && !_preview.paused) { _stopPreview(); return; }
  _stopPreview();

  _preview = new Audio(_signedUrl);
  _preview.currentTime = _trimStart;

  _preview.ontimeupdate = () => {
    if (_preview && _preview.currentTime >= (_trimEnd ?? _duration)) _stopPreview();
  };
  _preview.onended = _stopPreview;

  _preview.play();
  document.getElementById('trimPreviewBtn').textContent = '■ Stop';

  _previewRaf = requestAnimationFrame(_animatePlayhead);
}

// ── WAV encoder ────────────────────────────────────────────────────────────
function _encodeWav(audioBuffer) {
  const numCh     = audioBuffer.numberOfChannels;
  const rate      = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const bps       = 16;
  const blockAlign = numCh * (bps / 8);
  const dataSize   = numFrames * blockAlign;

  const buf  = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  str(0,  'RIFF');
  view.setUint32(4,  36 + dataSize, true);
  str(8,  'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1,  true);              // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bps, true);
  str(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([buf], { type: 'audio/wav' });
}

// ── Apply (destructive) ────────────────────────────────────────────────────
async function _applyTrim() {
  const applyBtn = document.getElementById('trimApplyBtn');
  if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Applying…'; }

  try {
    // 1. Render trimmed region into a new AudioBuffer
    const trimLen = (_trimEnd ?? _duration) - _trimStart;
    const offline = new OfflineAudioContext(
      _buffer.numberOfChannels,
      Math.ceil(trimLen * _buffer.sampleRate),
      _buffer.sampleRate,
    );
    const src = offline.createBufferSource();
    src.buffer = _buffer;
    src.connect(offline.destination);
    src.start(0, _trimStart, trimLen);
    const rendered = await offline.startRendering();

    // 2. Encode to WAV
    const wavBlob = _encodeWav(rendered);

    // 3. Upload to a unique .wav path — timestamp ensures no CDN cache collision
    const oldPath = _audioPath;
    const base    = oldPath.replace(/\.[^/.]+$/, '').replace(/_\d{13}$/, ''); // strip prev timestamp
    const newPath = `${base}_${Date.now()}.wav`;

    const { error: uploadErr } = await supabase.storage
      .from('composition-audio')
      .upload(newPath, wavBlob, { contentType: 'audio/wav', upsert: true });

    if (uploadErr) throw uploadErr;

    // 4. Update the DB so the section points to the new file
    const { error: dbErr } = await supabase
      .from('composition_sections')
      .update({ audio_url: newPath })
      .eq('id', _sectionId);

    if (dbErr) throw dbErr;

    // 5. Delete the original file (best-effort — don't fail if it errors)
    if (oldPath !== newPath) {
      await supabase.storage.from('composition-audio').remove([oldPath]);
    }

    // 6. Tell song-composer to update local state with the new path
    _onApply?.(newPath);
    closeTrimUI();
  } catch (e) {
    console.error('[Trim] apply failed', e);
    if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = 'Apply'; }
  }
}

// ── ResizeObserver ─────────────────────────────────────────────────────────
let _resizeObserver = null;

function _attachResize() {
  _resizeObserver = new ResizeObserver(() => _draw());
  _resizeObserver.observe(_canvas());
}

function _detachResize() {
  _resizeObserver?.disconnect();
  _resizeObserver = null;
}

// ── Canvas event attach / detach ───────────────────────────────────────────
function _attachCanvas() {
  const cvs = _canvas();
  cvs.addEventListener('mousedown',  _onDown);
  cvs.addEventListener('mousemove',  _onMove);
  cvs.addEventListener('mouseup',    _onUp);
  cvs.addEventListener('mouseleave', _onUp);
  cvs.addEventListener('touchstart', _onDown,  { passive: false });
  cvs.addEventListener('touchmove',  _onMove,  { passive: false });
  cvs.addEventListener('touchend',   _onUp);
}

function _detachCanvas() {
  const cvs = _canvas();
  if (!cvs) return;
  cvs.removeEventListener('mousedown',  _onDown);
  cvs.removeEventListener('mousemove',  _onMove);
  cvs.removeEventListener('mouseup',    _onUp);
  cvs.removeEventListener('mouseleave', _onUp);
  cvs.removeEventListener('touchstart', _onDown);
  cvs.removeEventListener('touchmove',  _onMove);
  cvs.removeEventListener('touchend',   _onUp);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Open the trim UI for a recording section.
 *
 * @param {string} sectionId
 * @param {object} opts
 * @param {object}   opts.section    - section row from compositions state
 * @param {string}   opts.compTitle  - composition title for playbar header
 * @param {string}   opts.signedUrl  - pre-fetched signed URL for audio playback/preview
 * @param {Function} opts.onClose    - called when trim UI closes
 * @param {Function} opts.onApply    - called with (newAudioUrl | null) on successful apply
 */
export async function openTrimUI(sectionId, { section, compTitle, signedUrl, onClose, onApply }) {
  _sectionId = sectionId;
  _signedUrl = signedUrl;
  _audioPath = section.audio_url;

  _onClose   = onClose;
  _onApply   = onApply;

  // Decode audio into an AudioBuffer for waveform drawing and OfflineAudioContext rendering
  try {
    const response    = await fetch(signedUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioCtx    = new AudioContext();
    _buffer           = await audioCtx.decodeAudioData(arrayBuffer);
    audioCtx.close();
  } catch (e) {
    console.error('[Trim] audio decode failed', e);
    return;
  }

  _duration  = _buffer.duration;
  _trimStart = 0;
  _trimEnd   = _duration;

  // Swap playbar into trim mode
  _seekRow()?.style.setProperty('display', 'none');
  _controls()?.style.setProperty('display', 'none');
  _panel().style.display = '';

  const bar = document.getElementById('composerPlaybar');
  bar.style.display = '';
  bar.removeAttribute('aria-hidden');
  document.getElementById('composerPlaybarTitle').textContent   = compTitle;
  document.getElementById('composerPlaybarSection').textContent = section.title || '(untitled recording)';

  // Reset Apply button in case it was left in loading state
  const applyBtn = document.getElementById('trimApplyBtn');
  if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = 'Apply'; }

  _updateTimes();
  _attachCanvas();
  _attachResize();
  requestAnimationFrame(_draw);
}

export function closeTrimUI() {
  _stopPreview();
  _detachCanvas();
  _detachResize();

  _panel().style.display = 'none';
  _controls()?.style.setProperty('display', '');

  _sectionId = null;
  _audioPath = null;
  _buffer    = null;
  _dragging  = null;
  _signedUrl = null;

  _onClose?.();
  _onClose = null;
  _onApply = null;
}

// ── Button wiring ──────────────────────────────────────────────────────────
document.getElementById('trimCancelBtn')?.addEventListener('click', closeTrimUI);
document.getElementById('trimPreviewBtn')?.addEventListener('click', _togglePreview);
document.getElementById('trimApplyBtn')?.addEventListener('click', _applyTrim);
