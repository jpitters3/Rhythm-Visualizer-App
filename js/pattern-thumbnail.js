// Standalone canvas rendering for pattern thumbnails.
// No imports from modules that could create circular dependencies.

function effectiveHand(index, hands, subdivision) {
  if (hands[index]) return hands[index];
  const stride = (subdivision || 2) >= 4 ? 2 : 1;
  return (Math.floor(index / stride) % 2 === 0) ? 'R' : 'L';
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

export function renderThumbnail(canvas, patternData) {
  if (!patternData) { renderPlayIconThumbnail(canvas); return; }

  const ctx = canvas.getContext('2d');
  const { labels = [], beats = 4, subdivision = 2, hands = [], steps } = patternData;
  const stepsPerMeasure = steps || (beats * subdivision);
  const totalSteps = labels.length;
  if (totalSteps === 0) return;

  const totalMeasures = Math.ceil(totalSteps / stepsPerMeasure);
  const measures = Math.min(4, totalMeasures);
  const stepsToRender = measures * stepsPerMeasure;
  const W = canvas.width, H = canvas.height;
  const isDark = document.body.classList.contains('dark');

  ctx.fillStyle = isDark ? '#16162a' : '#f0f0f5';
  ctx.fillRect(0, 0, W, H);

  const padX = 14, padY = 14;
  const cellW = (W - padX * 2) / stepsPerMeasure;
  const cellH = (H - padY * 2) / measures;
  const radius = Math.min(cellW, cellH) * 0.38;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const subR = radius * 0.42;
  const subOff = radius * 0.5;
  const subOffsets = [[-subOff, -subOff], [-subOff, subOff], [subOff, -subOff], [subOff, subOff]];
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
    const hasNote = isChord ? label.some(l => l && l !== '') : (label && label !== '');
    const hand = effectiveHand(i, hands, subdivision);
    const fillColor = hand === 'R'
      ? (isDark ? '#fd0380' : '#610a42')
      : (isDark ? 'rgb(30,121,232)' : 'rgb(2,68,150)');

    if (isChord && hasNote) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.globalAlpha = 0.12;
      ctx.fill();
      ctx.globalAlpha = 1;

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
          ctx.fillStyle = '#ffffff';
          ctx.fillText((sl === 'Ding' || sl === '0') ? 'D' : String(sl), sx, sy + 1);
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
      ctx.fillStyle = '#ffffff';
      ctx.fillText((label === 'Ding' || label === '0') ? 'D' : String(label), x, y + 1);

    } else {
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.globalAlpha = 0.25;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}
