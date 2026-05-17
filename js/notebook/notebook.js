// Notebook engine — Jupyter-lite cell execution runtime
// Cells are executable JS with access to a `nb` context object

const SAMPLE_RATE = 16000;
const XC_API = 'https://xeno-canto.org/api/3/recordings';

// Shared notebook context — available to all cells as `nb`
const nb = {
  sampleRate: SAMPLE_RATE,
  audioCtx: null,
  recordings: [],
  audio: {},       // named audio buffers
  results: {},     // named results from cells

  xcKey: null,  // set via nb.setKey("your-key")

  setKey(key) { nb.xcKey = key; },

  // Search xeno-canto v3 (requires API key + tag syntax)
  async search(query, maxResults = 10) {
    if (!nb.xcKey) throw new Error('Set your xeno-canto API key first: nb.setKey("your-key")');
    const url = `${XC_API}?query=${encodeURIComponent(query)}&key=${encodeURIComponent(nb.xcKey)}&per_page=${maxResults}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`xeno-canto ${resp.status}: ${body.slice(0, 200)}`);
    }
    const json = await resp.json();
    if (json.error) throw new Error(`xeno-canto: ${json.error.message || JSON.stringify(json.error)}`);
    nb.recordings = (json.recordings || []).map(r => ({
      id: r.id,
      species: r.en,
      sciName: `${r.gen} ${r.sp}`,
      country: r.cnt,
      loc: r.loc,
      duration: r.length,
      quality: r.q,
      type: r.type,
      url: r.file?.startsWith('//') ? 'https:' + r.file : r.file,
      sono: r.sono?.small,
      rec: r.rec,
    }));
    return nb.recordings;
  },

  // Download + decode a recording to Float32Array
  async fetch(recording) {
    if (typeof recording === 'number') recording = nb.recordings[recording];
    const resp = await fetch(recording.url);
    if (!resp.ok) throw new Error(`Download: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    if (!nb.audioCtx) nb.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const decoded = await nb.audioCtx.decodeAudioData(buf);
    const samples = new Float32Array(decoded.getChannelData(0));
    return { samples, sampleRate: decoded.sampleRate, duration: decoded.duration, meta: recording };
  },

  // Play Float32Array audio
  play(samples, sr) {
    if (!nb.audioCtx) nb.audioCtx = new AudioContext({ sampleRate: sr || SAMPLE_RATE });
    const ctx = nb.audioCtx;
    const buf = ctx.createBuffer(1, samples.length, sr || SAMPLE_RATE);
    buf.copyToChannel(samples instanceof Float32Array ? samples : new Float32Array(samples), 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    return src;
  },

  // Slice audio into chunks
  slice(samples, chunkLen = 16384, overlap = 0.5) {
    const hop = Math.floor(chunkLen * (1 - overlap));
    const chunks = [];
    for (let i = 0; i + chunkLen <= samples.length; i += hop) {
      const c = samples.slice(i, i + chunkLen);
      let mx = 0;
      for (let j = 0; j < c.length; j++) mx = Math.max(mx, Math.abs(c[j]));
      if (mx > 0.01) { const s = 0.95 / mx; for (let j = 0; j < c.length; j++) c[j] *= s; }
      chunks.push(c);
    }
    return chunks;
  },

  // Compute spectrogram
  spectrogram(samples, fftSize = 512, hopSize = 128) {
    const numFrames = Math.floor((samples.length - fftSize) / hopSize) + 1;
    const numBins = fftSize / 2;
    const win = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
    const spec = [];
    for (let f = 0; f < numFrames; f++) {
      const off = f * hopSize;
      const frame = new Float32Array(numBins);
      for (let k = 0; k < numBins; k++) {
        let re = 0, im = 0;
        for (let n = 0; n < fftSize; n++) {
          const v = (samples[off + n] || 0) * win[n];
          const a = -2 * Math.PI * k * n / fftSize;
          re += v * Math.cos(a);
          im += v * Math.sin(a);
        }
        frame[k] = 20 * Math.log10(Math.sqrt(re * re + im * im) + 1e-10);
      }
      spec.push(frame);
    }
    return { data: spec, numFrames, numBins, fftSize, hopSize };
  },

  // Store named result
  store(name, value) { nb.results[name] = value; return value; },
  get(name) { return nb.results[name]; },
};

// --- Cell management ---

let cells = [];
let cellIdCounter = 0;

export function getCells() { return cells; }
export function getContext() { return nb; }

export function addCell(type = 'code', source = '', position = -1) {
  const cell = {
    id: ++cellIdCounter,
    type,           // 'code' | 'markdown'
    source,
    output: null,   // rendered output
    state: 'idle',  // 'idle' | 'running' | 'done' | 'error'
    el: null,
  };
  if (position >= 0 && position < cells.length) {
    cells.splice(position, 0, cell);
  } else {
    cells.push(cell);
  }
  return cell;
}

export function removeCell(id) {
  const idx = cells.findIndex(c => c.id === id);
  if (idx >= 0) {
    cells[idx].el?.remove();
    cells.splice(idx, 1);
  }
}

export function moveCell(id, dir) {
  const idx = cells.findIndex(c => c.id === id);
  const newIdx = idx + dir;
  if (idx < 0 || newIdx < 0 || newIdx >= cells.length) return;
  [cells[idx], cells[newIdx]] = [cells[newIdx], cells[idx]];
}

// Execute a code cell
export async function runCell(cell) {
  if (cell.type !== 'code') return;
  cell.state = 'running';
  cell.output = null;

  try {
    // Wrap source in async function with nb context
    const fn = new Function('nb', 'print', 'html', 'table', 'waveform', 'spectrogram', `
      return (async () => {
        ${cell.source}
      })();
    `);

    const outputs = [];

    const print = (...args) => {
      outputs.push({ type: 'text', value: args.map(a =>
        typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
      ).join(' ') });
    };

    const html = (markup) => {
      outputs.push({ type: 'html', value: markup });
    };

    const table = (data) => {
      if (!Array.isArray(data) || data.length === 0) { print(data); return; }
      const keys = Object.keys(data[0]);
      let h = '<table class="nb-table"><tr>' + keys.map(k => `<th>${k}</th>`).join('') + '</tr>';
      data.forEach(row => {
        h += '<tr>' + keys.map(k => `<td>${row[k] ?? ''}</td>`).join('') + '</tr>';
      });
      h += '</table>';
      outputs.push({ type: 'html', value: h });
    };

    const waveform = (samples, label = '') => {
      outputs.push({ type: 'waveform', value: samples, label });
    };

    const spectrogram = (samples, label = '') => {
      outputs.push({ type: 'spectrogram', value: samples, label });
    };

    const result = await fn(nb, print, html, table, waveform, spectrogram);

    // Auto-display return value if no explicit output
    if (result !== undefined && outputs.length === 0) {
      if (result instanceof Float32Array || (Array.isArray(result) && typeof result[0] === 'number')) {
        outputs.push({ type: 'waveform', value: result, label: '' });
      } else {
        print(result);
      }
    }

    cell.output = outputs;
    cell.state = 'done';
  } catch (e) {
    cell.output = [{ type: 'error', value: e.message }];
    cell.state = 'error';
  }
}

// Run all cells sequentially
export async function runAll() {
  for (const cell of cells) {
    if (cell.type === 'code') await runCell(cell);
  }
}

// Default notebook — bird sounds workflow
export function defaultNotebook() {
  cells = [];
  cellIdCounter = 0;

  addCell('markdown', `# Bird2Vec Notebook\nFetch, listen to, and analyze bird recordings from xeno-canto.\n\n**API v3** requires a key and tag-based queries.\nGet your key at xeno-canto.org (free account).`);

  addCell('code', `// Set your xeno-canto API key (run this first)
nb.setKey("YOUR_KEY_HERE");
print("Key set. Ready to search.");`);

  addCell('code', `// Search for common blackbird recordings
// v3 tag syntax: en: gen: sp: cnt: q: type:
const results = await nb.search('en:"common blackbird" q:A', 8);
table(results.map(r => ({
  species: r.species,
  country: r.country,
  duration: r.duration,
  quality: r.quality,
  type: r.type,
})));
print(results.length + " recordings found");`);

  addCell('code', `// Download the first recording
const rec = await nb.fetch(0);
nb.store("bird1", rec);
print("Downloaded:", rec.meta.species, "#" + rec.meta.id);
print("Duration:", rec.duration.toFixed(1) + "s");
print("Samples:", rec.samples.length);
waveform(rec.samples, rec.meta.species);`);

  addCell('code', `// Play the recording
const rec = nb.get("bird1");
nb.play(rec.samples, rec.sampleRate);
print("Playing:", rec.meta.species);`);

  addCell('code', `// Show spectrogram
const rec = nb.get("bird1");
const first2s = rec.samples.slice(0, rec.sampleRate * 2);
spectrogram(first2s, "First 2 seconds");`);

  addCell('code', `// Slice into training chunks
const rec = nb.get("bird1");
const chunks = nb.slice(rec.samples, 16384);
nb.store("chunks", chunks);
print(chunks.length + " chunks of 16384 samples each");
print("Total:", (chunks.length * 16384 / nb.sampleRate).toFixed(1) + "s of training data");
waveform(chunks[0], "Chunk 0");`);

  addCell('code', `// Play a random chunk
const chunks = nb.get("chunks");
const idx = Math.floor(Math.random() * chunks.length);
nb.play(chunks[idx]);
print("Playing chunk", idx, "of", chunks.length);
waveform(chunks[idx], "Chunk " + idx);`);

  addCell('code', `// Search for European robin
const results = await nb.search('en:"european robin" type:song', 5);
table(results.map(r => ({
  species: r.species,
  loc: r.loc,
  duration: r.duration,
  quality: r.quality,
})));`);

  addCell('code', `// Download and compare
const rec2 = await nb.fetch(0);
nb.store("bird2", rec2);
print("Downloaded:", rec2.meta.species);
waveform(rec2.samples.slice(0, 32000), rec2.meta.species);`);

  return cells;
}
