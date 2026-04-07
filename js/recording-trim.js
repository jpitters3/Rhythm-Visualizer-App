// recording-trim.js
// Non-destructive trim editor for composition recording sections.
// Renders a waveform canvas with draggable start/end handles and a playhead.
// On Apply: renders the trimmed region via OfflineAudioContext, encodes to WAV,
// and overwrites the file in Supabase Storage (destructive, no extra DB columns needed).

import { supabase } from './supabase-client.js';

// ── State ──────────────────────────────────────────────────────────────────
let audioPath  = null;   // storage path (section.audio_url)
let sectionId  = null;
let trimStart  = 0;
let trimEnd    = null;   // set once audio is decoded
let duration   = 0;
let buffer     = null;   // AudioBuffer — waveform + rendering
let dragging   = null;   // 'start' | 'end'
let preview    = null;   // HTMLAudioElement for preview
let previewRaf = null;   // rAF handle for playhead animation
let signedUrl  = null;
let closeCallback    = null;
let applyCallback    = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const panel    = () => document.getElementById('composerTrimPanel');
const canvas   = () => document.getElementById('composerWaveform');
const seekRow  = () => document.getElementById('composerSeekRow');
const controls = () => document.querySelector('.playbar-controls');

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(secs) {
  if (!isFinite(secs) || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Waveform + playhead drawing ────────────────────────────────────────────
function draw() {
  const cvs = canvas();
  if (!cvs || !buffer) return;

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
  const data         = buffer.getChannelData(0);
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
  const startX = (trimStart / duration) * W;
  const endX   = ((trimEnd  ?? duration) / duration) * W;

  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  if (startX > 0) ctx.fillRect(0,    0, startX,   H);
  if (endX   < W) ctx.fillRect(endX, 0, W - endX, H);

  // Trim handles
  drawHandle(ctx, startX, W, H, 'start');
  drawHandle(ctx, endX,   W, H, 'end');

  // Playhead (drawn last so it's always on top)
  if (preview && isFinite(preview.currentTime) && duration > 0) {
    const px = (preview.currentTime / duration) * W;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();
  }
}

function drawHandle(ctx, x, W, H, side) {
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
  roundRect(ctx, tabX, tabY, tabW, tabH, 3);
  ctx.fill();

  ctx.fillStyle    = '#fff';
  ctx.font         = '10px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(side === 'start' ? '◀' : '▶', cx + (side === 'start' ? tabW / 2 : -tabW / 2), H / 2);
}

function roundRect(ctx, x, y, w, h, r) {
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
function updateTimes() {
  document.getElementById('trimStartDisplay').textContent = fmt(trimStart);
  document.getElementById('trimEndDisplay').textContent   = fmt(trimEnd ?? duration);
}

// ── Canvas pointer interaction ─────────────────────────────────────────────
const HIT = 14;

function xToTime(x, W) {
  return Math.max(0, Math.min(duration, (x / W) * duration));
}

function hitHandle(x, W) {
  const startX = (trimStart / duration) * W;
  const endX   = ((trimEnd  ?? duration) / duration) * W;
  if (Math.abs(x - startX) <= HIT) return 'start';
  if (Math.abs(x - endX)   <= HIT) return 'end';
  return null;
}

function clientX(e) {
  const rect = canvas().getBoundingClientRect();
  const cx   = e.touches ? e.touches[0].clientX : e.clientX;
  return cx - rect.left;
}

function onDown(e) {
  const W = canvas().getBoundingClientRect().width;
  dragging = hitHandle(clientX(e), W);
  if (dragging) e.preventDefault();
}

function onMove(e) {
  const cvs = canvas();
  const W   = cvs.getBoundingClientRect().width;
  const x   = clientX(e);

  cvs.style.cursor = hitHandle(x, W) ? 'ew-resize' : 'default';

  if (!dragging) return;
  e.preventDefault();

  const t = xToTime(x, W);
  if (dragging === 'start') {
    trimStart = Math.min(t, (trimEnd ?? duration) - 0.05);
  } else {
    trimEnd = Math.max(t, trimStart + 0.05);
  }

  draw();
  updateTimes();
}

function onUp() { dragging = null; }

// ── Preview ────────────────────────────────────────────────────────────────
function stopPreviewRaf() {
  if (previewRaf) { cancelAnimationFrame(previewRaf); previewRaf = null; }
}

function animatePlayhead() {
  draw();
  if (preview && !preview.paused) {
    previewRaf = requestAnimationFrame(animatePlayhead);
  } else {
    previewRaf = null;
    draw(); // final draw without playhead running
  }
}

function stopPreview() {
  stopPreviewRaf();
  if (preview) { preview.pause(); preview = null; }
  const btn = document.getElementById('trimPreviewBtn');
  if (btn) btn.textContent = '▶ Preview';
  draw(); // clear playhead
}

function togglePreview() {
  if (preview && !preview.paused) { stopPreview(); return; }
  stopPreview();

  preview = new Audio(signedUrl);
  preview.currentTime = trimStart;

  preview.ontimeupdate = () => {
    if (preview && preview.currentTime >= (trimEnd ?? duration)) stopPreview();
  };
  preview.onended = stopPreview;

  preview.play();
  document.getElementById('trimPreviewBtn').textContent = '■ Stop';

  previewRaf = requestAnimationFrame(animatePlayhead);
}

// ── WAV encoder ────────────────────────────────────────────────────────────
function encodeWav(audioBuffer) {
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
async function applyTrim() {
  const applyBtn = document.getElementById('trimApplyBtn');
  if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Applying…'; }

  try {
    // 1. Render trimmed region into a new AudioBuffer
    const trimLen = (trimEnd ?? duration) - trimStart;
    const offline = new OfflineAudioContext(
      buffer.numberOfChannels,
      Math.ceil(trimLen * buffer.sampleRate),
      buffer.sampleRate,
    );
    const src = offline.createBufferSource();
    src.buffer = buffer;
    src.connect(offline.destination);
    src.start(0, trimStart, trimLen);
    const rendered = await offline.startRendering();

    // 2. Encode to WAV
    const wavBlob = encodeWav(rendered);

    // 3. Upload to a unique .wav path — timestamp ensures no CDN cache collision
    const oldPath = audioPath;
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
      .eq('id', sectionId);

    if (dbErr) throw dbErr;

    // 5. Delete the original file (best-effort — don't fail if it errors)
    if (oldPath !== newPath) {
      await supabase.storage.from('composition-audio').remove([oldPath]);
    }

    // 6. Tell song-composer to update local state with the new path
    applyCallback?.(newPath);
    closeTrimUI();
  } catch (e) {
    console.error('[Trim] apply failed', e);
    if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = 'Apply'; }
  }
}

// ── ResizeObserver ─────────────────────────────────────────────────────────
let resizeObserver = null;

function attachResize() {
  resizeObserver = new ResizeObserver(() => draw());
  resizeObserver.observe(canvas());
}

function detachResize() {
  resizeObserver?.disconnect();
  resizeObserver = null;
}

// ── Canvas event attach / detach ───────────────────────────────────────────
function attachCanvas() {
  const cvs = canvas();
  cvs.addEventListener('mousedown',  onDown);
  cvs.addEventListener('mousemove',  onMove);
  cvs.addEventListener('mouseup',    onUp);
  cvs.addEventListener('mouseleave', onUp);
  cvs.addEventListener('touchstart', onDown,  { passive: false });
  cvs.addEventListener('touchmove',  onMove,  { passive: false });
  cvs.addEventListener('touchend',   onUp);
}

function detachCanvas() {
  const cvs = canvas();
  if (!cvs) return;
  cvs.removeEventListener('mousedown',  onDown);
  cvs.removeEventListener('mousemove',  onMove);
  cvs.removeEventListener('mouseup',    onUp);
  cvs.removeEventListener('mouseleave', onUp);
  cvs.removeEventListener('touchstart', onDown);
  cvs.removeEventListener('touchmove',  onMove);
  cvs.removeEventListener('touchend',   onUp);
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
export async function openTrimUI(inputSectionId, { section, compTitle, signedUrl: inputSignedUrl, onClose, onApply }) {
  sectionId = inputSectionId;
  signedUrl = inputSignedUrl;
  audioPath = section.audio_url;

  closeCallback   = onClose;
  applyCallback   = onApply;

  // Decode audio into an AudioBuffer for waveform drawing and OfflineAudioContext rendering
  try {
    const response    = await fetch(signedUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioCtx    = new AudioContext();
    buffer           = await audioCtx.decodeAudioData(arrayBuffer);
    audioCtx.close();
  } catch (e) {
    console.error('[Trim] audio decode failed', e);
    return;
  }

  duration  = buffer.duration;
  trimStart = 0;
  trimEnd   = duration;

  // Swap playbar into trim mode
  seekRow()?.style.setProperty('display', 'none');
  controls()?.style.setProperty('display', 'none');
  panel().style.display = '';

  const bar = document.getElementById('composerPlaybar');
  bar.style.display = '';
  bar.removeAttribute('aria-hidden');
  document.getElementById('composerPlaybarTitle').textContent   = compTitle;
  document.getElementById('composerPlaybarSection').textContent = section.title || '(untitled recording)';

  // Reset Apply button in case it was left in loading state
  const applyBtn = document.getElementById('trimApplyBtn');
  if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = 'Apply'; }

  updateTimes();
  attachCanvas();
  attachResize();
  requestAnimationFrame(draw);
}

export function closeTrimUI() {
  stopPreview();
  detachCanvas();
  detachResize();

  panel().style.display = 'none';
  controls()?.style.setProperty('display', '');

  sectionId = null;
  audioPath = null;
  buffer    = null;
  dragging  = null;
  signedUrl = null;

  closeCallback?.();
  closeCallback = null;
  applyCallback = null;
}

// ── Button wiring ──────────────────────────────────────────────────────────
document.getElementById('trimCancelBtn')?.addEventListener('click', closeTrimUI);
document.getElementById('trimPreviewBtn')?.addEventListener('click', togglePreview);
document.getElementById('trimApplyBtn')?.addEventListener('click', applyTrim);
