// Notebook renderer — DOM construction and cell rendering
import {
  getCells, getContext, addCell, removeCell, moveCell,
  runCell, runAll, defaultNotebook
} from './notebook.js';

const VIRIDIS = [
  [68,1,84],[72,35,116],[64,67,135],[52,94,141],[41,120,142],
  [32,144,140],[34,167,132],[68,190,112],[121,209,81],[189,222,38],[253,231,37],
];

function viridis(t) {
  t = Math.max(0, Math.min(1, t));
  const i = t * (VIRIDIS.length - 1);
  const lo = Math.floor(i), hi = Math.min(lo + 1, VIRIDIS.length - 1), f = i - lo;
  return `rgb(${VIRIDIS[lo][0]+f*(VIRIDIS[hi][0]-VIRIDIS[lo][0])|0},${VIRIDIS[lo][1]+f*(VIRIDIS[hi][1]-VIRIDIS[lo][1])|0},${VIRIDIS[lo][2]+f*(VIRIDIS[hi][2]-VIRIDIS[lo][2])|0})`;
}

let container;

export function initNotebook() {
  container = document.getElementById('notebook');
  defaultNotebook();
  renderAllCells();
  bindToolbar();
}

function bindToolbar() {
  document.getElementById('nb-run-all')?.addEventListener('click', async () => {
    await runAll();
    renderAllCells();
  });
  document.getElementById('nb-add-code')?.addEventListener('click', () => {
    addCell('code', '');
    renderAllCells();
  });
  document.getElementById('nb-add-md')?.addEventListener('click', () => {
    addCell('markdown', '');
    renderAllCells();
  });
  document.getElementById('nb-reset')?.addEventListener('click', () => {
    defaultNotebook();
    renderAllCells();
  });
}

function renderAllCells() {
  container.innerHTML = '';
  getCells().forEach((cell, idx) => {
    const el = buildCellElement(cell, idx);
    cell.el = el;
    container.appendChild(el);
  });
}

function buildCellElement(cell, idx) {
  const el = document.createElement('div');
  el.className = `nb-cell nb-cell-${cell.type} nb-${cell.state}`;
  el.dataset.id = cell.id;

  const gutter = document.createElement('div');
  gutter.className = 'nb-gutter';
  gutter.innerHTML = cell.type === 'code'
    ? `<span class="nb-idx">[${idx}]</span>`
    : `<span class="nb-idx">md</span>`;

  const body = document.createElement('div');
  body.className = 'nb-body';

  // Source editor
  const source = document.createElement('textarea');
  source.className = 'nb-source';
  source.value = cell.source;
  source.rows = Math.max(2, cell.source.split('\n').length);
  source.spellcheck = false;
  source.addEventListener('input', e => {
    cell.source = e.target.value;
    e.target.rows = Math.max(2, e.target.value.split('\n').length);
  });
  // Shift+Enter to run
  source.addEventListener('keydown', async e => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      await runCell(cell);
      renderOutput(cell);
      // Auto-advance: focus next cell's source
      const nextEl = el.nextElementSibling;
      if (nextEl) nextEl.querySelector('.nb-source')?.focus();
    }
    // Tab inserts 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = source.selectionStart;
      source.value = source.value.substring(0, start) + '  ' + source.value.substring(source.selectionEnd);
      source.selectionStart = source.selectionEnd = start + 2;
      cell.source = source.value;
    }
  });

  body.appendChild(source);

  // Output area
  const output = document.createElement('div');
  output.className = 'nb-output';
  body.appendChild(output);

  // Cell toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'nb-cell-toolbar';
  toolbar.innerHTML = `
    <button class="nb-btn" data-action="run" title="Run (Shift+Enter)">▶</button>
    <button class="nb-btn" data-action="up" title="Move up">↑</button>
    <button class="nb-btn" data-action="down" title="Move down">↓</button>
    <button class="nb-btn" data-action="add" title="Add cell below">+</button>
    <button class="nb-btn nb-btn-danger" data-action="delete" title="Delete">✕</button>
  `;
  toolbar.addEventListener('click', async e => {
    const action = e.target.dataset.action;
    if (action === 'run') { await runCell(cell); renderOutput(cell); }
    if (action === 'up') { moveCell(cell.id, -1); renderAllCells(); }
    if (action === 'down') { moveCell(cell.id, 1); renderAllCells(); }
    if (action === 'add') { addCell('code', '', getCells().indexOf(cell) + 1); renderAllCells(); }
    if (action === 'delete') { removeCell(cell.id); renderAllCells(); }
  });

  el.appendChild(gutter);
  el.appendChild(body);
  el.appendChild(toolbar);

  // Render existing output
  if (cell.output) renderOutput(cell);
  // Render markdown preview
  if (cell.type === 'markdown' && cell.source) renderMarkdown(cell, output);

  return el;
}

function renderOutput(cell) {
  const output = cell.el?.querySelector('.nb-output');
  if (!output) return;
  output.innerHTML = '';

  cell.el.className = `nb-cell nb-cell-${cell.type} nb-${cell.state}`;

  if (!cell.output) return;

  cell.output.forEach(item => {
    if (item.type === 'text') {
      const pre = document.createElement('pre');
      pre.className = 'nb-text';
      pre.textContent = item.value;
      output.appendChild(pre);
    }
    if (item.type === 'html') {
      const div = document.createElement('div');
      div.className = 'nb-html';
      div.innerHTML = item.value;
      output.appendChild(div);
    }
    if (item.type === 'error') {
      const pre = document.createElement('pre');
      pre.className = 'nb-error';
      pre.textContent = item.value;
      output.appendChild(pre);
    }
    if (item.type === 'waveform') {
      const wrap = document.createElement('div');
      wrap.className = 'nb-canvas-wrap';
      const canvas = document.createElement('canvas');
      canvas.width = 700; canvas.height = 120;
      wrap.appendChild(canvas);
      if (item.label) {
        const lbl = document.createElement('div');
        lbl.className = 'nb-canvas-label';
        lbl.textContent = item.label;
        wrap.appendChild(lbl);
      }
      // Play button
      const playBtn = document.createElement('button');
      playBtn.className = 'nb-btn nb-play-inline';
      playBtn.textContent = '▶ Play';
      playBtn.addEventListener('click', () => getContext().play(item.value));
      wrap.appendChild(playBtn);
      output.appendChild(wrap);
      drawWaveform(canvas, item.value);
    }
    if (item.type === 'spectrogram') {
      const wrap = document.createElement('div');
      wrap.className = 'nb-canvas-wrap';
      const canvas = document.createElement('canvas');
      canvas.width = 700; canvas.height = 180;
      wrap.appendChild(canvas);
      if (item.label) {
        const lbl = document.createElement('div');
        lbl.className = 'nb-canvas-label';
        lbl.textContent = item.label;
        wrap.appendChild(lbl);
      }
      output.appendChild(wrap);
      const spec = getContext().spectrogram(item.value);
      drawSpectrogram(canvas, spec);
    }
  });
}

function renderMarkdown(cell, output) {
  // Simple markdown: # headings, **bold**, `code`, newlines
  let h = cell.source
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
  const div = document.createElement('div');
  div.className = 'nb-markdown';
  div.innerHTML = h;
  output.appendChild(div);
}

// --- Inline canvas renderers ---

function drawWaveform(canvas, samples) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, w, h);

  // Zero line
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();

  if (!samples || samples.length === 0) return;
  const step = Math.max(1, Math.floor(samples.length / w));
  ctx.strokeStyle = '#39d2c0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < w; i++) {
    const idx = Math.floor(i * samples.length / w);
    let min = 1, max = -1;
    for (let j = 0; j < step && idx + j < samples.length; j++) {
      const v = samples[idx + j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const y1 = h/2 - max * h/2;
    const y2 = h/2 - min * h/2;
    ctx.moveTo(i, y1);
    ctx.lineTo(i, y2);
  }
  ctx.stroke();
}

function drawSpectrogram(canvas, spec) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, w, h);

  const { data, numFrames, numBins } = spec;
  let dMin = Infinity, dMax = -Infinity;
  for (const frame of data) {
    for (let i = 0; i < frame.length; i++) {
      if (isFinite(frame[i])) {
        if (frame[i] < dMin) dMin = frame[i];
        if (frame[i] > dMax) dMax = frame[i];
      }
    }
  }
  const range = dMax - dMin || 1;
  const cellW = w / numFrames;
  const cellH = h / numBins;

  for (let f = 0; f < numFrames; f++) {
    for (let b = 0; b < numBins; b++) {
      const v = data[f][b];
      const t = isFinite(v) ? (v - dMin) / range : 0;
      ctx.fillStyle = viridis(t);
      ctx.fillRect(f * cellW, (numBins - 1 - b) * cellH, Math.ceil(cellW), Math.ceil(cellH));
    }
  }
}
