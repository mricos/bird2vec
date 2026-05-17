// Latent space visualization
import { sizeCanvas, clear, drawLabel, COLORS, PALETTE } from './plot-core.js';

// Bar chart of latent vector dimensions
export function drawLatentBars(canvas, z, opts = {}) {
  const { ctx, w, h } = sizeCanvas(canvas);
  const pad = { top: 25, right: 10, bottom: 25, left: 10 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  clear(ctx, w, h);

  const barW = plotW / z.length;
  const midY = pad.top + plotH / 2;

  // Zero line
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.left, midY); ctx.lineTo(pad.left + plotW, midY); ctx.stroke();

  // Bars
  for (let i = 0; i < z.length; i++) {
    const val = z[i];
    const barH = (val / 1) * (plotH / 2);
    const x = pad.left + i * barW;

    ctx.fillStyle = val >= 0 ? COLORS.blue : COLORS.orange;
    ctx.globalAlpha = 0.3 + Math.abs(val) * 0.7;

    if (val >= 0) {
      ctx.fillRect(x, midY - barH, Math.max(barW - 0.5, 0.5), barH);
    } else {
      ctx.fillRect(x, midY, Math.max(barW - 0.5, 0.5), -barH);
    }
  }
  ctx.globalAlpha = 1;

  drawLabel(ctx, opts.title || `Latent Vector (${z.length}D)`, pad.left, 6, {
    color: COLORS.text, font: '12px "SF Mono", monospace',
  });
  drawLabel(ctx, '+1', pad.left, pad.top, { baseline: 'top' });
  drawLabel(ctx, '-1', pad.left, h - pad.bottom, { baseline: 'bottom' });
}

// 2D scatter of latent space (first 2 PCA components or selected dims)
export function drawLatentScatter(canvas, points, opts = {}) {
  const { ctx, w, h } = sizeCanvas(canvas);
  const pad = { top: 25, right: 10, bottom: 25, left: 40 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  clear(ctx, w, h);

  const dimX = opts.dimX ?? 0;
  const dimY = opts.dimY ?? 1;

  // Draw points
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const x = pad.left + ((pt[dimX] + 1) / 2) * plotW;
    const y = pad.top + plotH - ((pt[dimY] + 1) / 2) * plotH;
    const isActive = i === opts.activeIdx;

    ctx.beginPath();
    ctx.arc(x, y, isActive ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? COLORS.green : COLORS.blue;
    ctx.globalAlpha = isActive ? 1 : 0.5;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  drawLabel(ctx, `z[${dimX}] vs z[${dimY}]`, pad.left, 6, {
    color: COLORS.text, font: '12px "SF Mono", monospace',
  });
}

// Interpolation path visualization
export function drawInterpPath(canvas, audioA, audioB, t, opts = {}) {
  const { ctx, w, h } = sizeCanvas(canvas);
  const pad = { top: 25, right: 10, bottom: 10, left: 10 };
  const plotW = w - pad.left - pad.right;

  clear(ctx, w, h);

  drawLabel(ctx, 'Interpolation', pad.left, 6, {
    color: COLORS.text, font: '12px "SF Mono", monospace',
  });

  // Draw interpolation slider track
  const trackY = pad.top + 20;
  const trackH = 6;
  ctx.fillStyle = COLORS.bgAlt;
  ctx.fillRect(pad.left, trackY, plotW, trackH);

  // A and B markers
  ctx.fillStyle = COLORS.orange;
  ctx.fillRect(pad.left, trackY, 8, trackH);
  ctx.fillStyle = COLORS.purple;
  ctx.fillRect(pad.left + plotW - 8, trackY, 8, trackH);

  // Current position
  const posX = pad.left + t * plotW;
  ctx.fillStyle = COLORS.green;
  ctx.beginPath();
  ctx.arc(posX, trackY + trackH / 2, 8, 0, Math.PI * 2);
  ctx.fill();

  drawLabel(ctx, 'A', pad.left, trackY + trackH + 4, { color: COLORS.orange });
  drawLabel(ctx, 'B', pad.left + plotW - 8, trackY + trackH + 4, { color: COLORS.purple, align: 'right' });
  drawLabel(ctx, `t=${t.toFixed(2)}`, posX, trackY + trackH + 4, { color: COLORS.green, align: 'center' });
}
