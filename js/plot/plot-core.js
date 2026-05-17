// Canvas plotting core — GitHub dark theme (fftnn pattern)

export const COLORS = {
  bg:       '#0d1117',
  bgAlt:    '#161b22',
  border:   '#30363d',
  text:     '#c9d1d9',
  textMuted:'#8b949e',
  blue:     '#58a6ff',
  green:    '#3fb950',
  red:      '#f85149',
  orange:   '#f0883e',
  purple:   '#bc8cff',
  cyan:     '#39d2c0',
  yellow:   '#d29922',
  pink:     '#f778ba',
};

export const PALETTE = [
  COLORS.blue, COLORS.green, COLORS.orange, COLORS.purple,
  COLORS.cyan, COLORS.red, COLORS.yellow, COLORS.pink,
];

// Size canvas for DPR and return context + dimensions
export function sizeCanvas(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  const width = w || canvas.parentElement?.clientWidth || canvas.width;
  const height = h || canvas.parentElement?.clientHeight || canvas.height;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, w: width, h: height, dpr };
}

// Clear with background
export function clear(ctx, w, h, color = COLORS.bg) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

// Draw a line plot
export function plotLine(ctx, data, bounds, opts = {}) {
  const { x, y, width, height } = bounds;
  const color = opts.color || COLORS.blue;
  const lineWidth = opts.lineWidth || 1.5;

  if (!data || data.length === 0) return;

  let yMin = opts.yMin ?? Infinity;
  let yMax = opts.yMax ?? -Infinity;
  if (yMin === Infinity || yMax === -Infinity) {
    for (let i = 0; i < data.length; i++) {
      if (data[i] < yMin) yMin = data[i];
      if (data[i] > yMax) yMax = data[i];
    }
  }
  if (yMax === yMin) { yMin -= 1; yMax += 1; }

  const scaleX = width / (data.length - 1 || 1);
  const scaleY = height / (yMax - yMin);

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;

  for (let i = 0; i < data.length; i++) {
    const px = x + i * scaleX;
    const py = y + height - (data[i] - yMin) * scaleY;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

// Draw axis labels
export function drawLabel(ctx, text, x, y, opts = {}) {
  ctx.fillStyle = opts.color || COLORS.textMuted;
  ctx.font = opts.font || '11px "SF Mono", Consolas, monospace';
  ctx.textAlign = opts.align || 'left';
  ctx.textBaseline = opts.baseline || 'top';
  ctx.fillText(text, x, y);
}

// Draw grid lines
export function drawGrid(ctx, bounds, opts = {}) {
  const { x, y, width, height } = bounds;
  const rows = opts.rows || 4;
  const cols = opts.cols || 6;

  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 0.5;

  for (let i = 0; i <= rows; i++) {
    const py = y + (height / rows) * i;
    ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x + width, py); ctx.stroke();
  }
  for (let i = 0; i <= cols; i++) {
    const px = x + (width / cols) * i;
    ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + height); ctx.stroke();
  }
}

// Multi-series line plot
export function plotMulti(ctx, datasets, bounds, opts = {}) {
  for (let i = 0; i < datasets.length; i++) {
    plotLine(ctx, datasets[i], bounds, {
      ...opts,
      color: opts.colors?.[i] || PALETTE[i % PALETTE.length],
    });
  }
}
