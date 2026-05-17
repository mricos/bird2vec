// Training metrics visualization (TensorBoard-lite style)
import { sizeCanvas, clear, plotLine, plotMulti, drawLabel, drawGrid, COLORS, PALETTE } from './plot-core.js';

export function drawLossCurves(canvas, metrics) {
  const { ctx, w, h } = sizeCanvas(canvas);
  const pad = { top: 25, right: 10, bottom: 30, left: 55 };
  const bounds = {
    x: pad.left, y: pad.top,
    width: w - pad.left - pad.right,
    height: h - pad.top - pad.bottom,
  };

  clear(ctx, w, h);
  drawGrid(ctx, bounds);

  if (metrics.genLoss.length > 0) {
    plotLine(ctx, metrics.genLoss, bounds, { color: COLORS.blue });
  }
  if (metrics.discLoss.length > 0) {
    plotLine(ctx, metrics.discLoss, bounds, { color: COLORS.red });
  }

  drawLabel(ctx, 'Loss', pad.left, 6, {
    color: COLORS.text, font: '12px "SF Mono", monospace',
  });

  // Legend
  const legendX = pad.left + 8;
  const legendY = pad.top + 8;
  ctx.fillStyle = COLORS.blue;
  ctx.fillRect(legendX, legendY, 12, 3);
  drawLabel(ctx, 'Gen', legendX + 16, legendY - 2, { color: COLORS.blue });

  ctx.fillStyle = COLORS.red;
  ctx.fillRect(legendX + 60, legendY, 12, 3);
  drawLabel(ctx, 'Disc', legendX + 76, legendY - 2, { color: COLORS.red });

  // Epoch count
  drawLabel(ctx, `Epoch ${metrics.epoch}`, w - pad.right, 6, {
    align: 'right', color: COLORS.textMuted,
  });
}

// Histogram of latent vector values (distribution check)
export function drawLatentHistogram(canvas, z, opts = {}) {
  const { ctx, w, h } = sizeCanvas(canvas);
  const pad = { top: 25, right: 10, bottom: 25, left: 10 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  clear(ctx, w, h);

  const numBins = opts.bins || 30;
  const counts = new Array(numBins).fill(0);
  const lo = -1, hi = 1;
  const binWidth = (hi - lo) / numBins;

  for (let i = 0; i < z.length; i++) {
    const bin = Math.min(numBins - 1, Math.max(0, Math.floor((z[i] - lo) / binWidth)));
    counts[bin]++;
  }

  const maxCount = Math.max(...counts, 1);
  const barW = plotW / numBins;

  for (let i = 0; i < numBins; i++) {
    const barH = (counts[i] / maxCount) * plotH;
    ctx.fillStyle = COLORS.purple;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(pad.left + i * barW, pad.top + plotH - barH, barW - 1, barH);
  }
  ctx.globalAlpha = 1;

  drawLabel(ctx, 'z Distribution', pad.left, 6, {
    color: COLORS.text, font: '12px "SF Mono", monospace',
  });
}
