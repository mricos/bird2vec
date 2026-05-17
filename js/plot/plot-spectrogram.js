// Spectrogram rendering
import { sizeCanvas, clear, drawLabel, COLORS } from './plot-core.js';

// Viridis-like colormap
const VIRIDIS = [
  [68,   1, 84],
  [72,  35, 116],
  [64,  67, 135],
  [52,  94, 141],
  [41, 120, 142],
  [32, 144, 140],
  [34, 167, 132],
  [68, 190, 112],
  [121, 209,  81],
  [189, 222,  38],
  [253, 231,  37],
];

function viridisColor(t) {
  t = Math.max(0, Math.min(1, t));
  const idx = t * (VIRIDIS.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, VIRIDIS.length - 1);
  const f = idx - lo;
  const r = VIRIDIS[lo][0] + f * (VIRIDIS[hi][0] - VIRIDIS[lo][0]);
  const g = VIRIDIS[lo][1] + f * (VIRIDIS[hi][1] - VIRIDIS[lo][1]);
  const b = VIRIDIS[lo][2] + f * (VIRIDIS[hi][2] - VIRIDIS[lo][2]);
  return `rgb(${r|0},${g|0},${b|0})`;
}

export function drawSpectrogram(canvas, specData, opts = {}) {
  const { data, numFrames, numBins } = specData;
  const { ctx, w, h } = sizeCanvas(canvas);

  const pad = { top: 25, right: 10, bottom: 30, left: 50 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  clear(ctx, w, h);

  // Find data range
  let dMin = Infinity, dMax = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (isFinite(data[i])) {
      if (data[i] < dMin) dMin = data[i];
      if (data[i] > dMax) dMax = data[i];
    }
  }
  const dRange = dMax - dMin || 1;

  // Draw spectrogram pixels
  const cellW = plotW / numFrames;
  const cellH = plotH / numBins;

  for (let f = 0; f < numFrames; f++) {
    for (let b = 0; b < numBins; b++) {
      const val = data[f * numBins + b];
      const t = isFinite(val) ? (val - dMin) / dRange : 0;
      ctx.fillStyle = viridisColor(t);
      // Flip Y so low frequencies are at bottom
      ctx.fillRect(
        pad.left + f * cellW,
        pad.top + (numBins - 1 - b) * cellH,
        Math.ceil(cellW),
        Math.ceil(cellH)
      );
    }
  }

  // Labels
  drawLabel(ctx, 'Spectrogram (dB)', pad.left, 6, { color: COLORS.text, font: '12px "SF Mono", monospace' });
  drawLabel(ctx, 'Time', w / 2, h - 6, { align: 'center', baseline: 'bottom' });
  ctx.save();
  ctx.translate(12, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  drawLabel(ctx, 'Frequency', 0, 0, { align: 'center' });
  ctx.restore();

  // Frequency axis ticks
  const sr = opts.sampleRate || 16000;
  const maxFreq = sr / 2;
  for (let i = 0; i <= 4; i++) {
    const freq = (maxFreq * i / 4 / 1000).toFixed(1) + 'k';
    const py = pad.top + plotH - (plotH * i / 4);
    drawLabel(ctx, freq, pad.left - 4, py, { align: 'right', baseline: 'middle' });
  }
}
