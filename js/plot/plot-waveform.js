// Waveform visualization
import { sizeCanvas, clear, plotLine, drawLabel, drawGrid, COLORS } from './plot-core.js';

export function drawWaveform(canvas, samples, opts = {}) {
  const { ctx, w, h } = sizeCanvas(canvas);
  const pad = { top: 25, right: 10, bottom: 30, left: 50 };
  const bounds = {
    x: pad.left, y: pad.top,
    width: w - pad.left - pad.right,
    height: h - pad.top - pad.bottom,
  };

  clear(ctx, w, h);
  drawGrid(ctx, bounds);
  plotLine(ctx, samples, bounds, {
    color: opts.color || COLORS.cyan,
    yMin: -1, yMax: 1,
  });

  // Labels
  drawLabel(ctx, opts.title || 'Waveform', pad.left, 6, {
    color: COLORS.text, font: '12px "SF Mono", monospace',
  });

  // Time axis
  const duration = (samples.length / (opts.sampleRate || 16000)).toFixed(2);
  drawLabel(ctx, `${duration}s`, w - pad.right, h - 6, {
    align: 'right', baseline: 'bottom',
  });
  drawLabel(ctx, '0s', pad.left, h - 6, { baseline: 'bottom' });

  // Amplitude axis
  drawLabel(ctx, '+1', pad.left - 4, pad.top, { align: 'right', baseline: 'top' });
  drawLabel(ctx, ' 0', pad.left - 4, pad.top + bounds.height / 2, { align: 'right', baseline: 'middle' });
  drawLabel(ctx, '-1', pad.left - 4, pad.top + bounds.height, { align: 'right', baseline: 'bottom' });
}
