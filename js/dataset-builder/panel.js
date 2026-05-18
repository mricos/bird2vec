// Dataset Builder — load N sonogene archetypes as labeled classes,
// generate K variations of each via Sono, export as HF-flavored files
// (metadata.csv + data/<split>/*.wav). Talks to the same in-memory
// dataset that bird2vec uses for WaveGAN training.

import { sonoSynthesize, perturbSonogene } from '../nn/sono.js';
import state from '../core/state.js';
import { addToDataset } from '../data/fetch-birds.js';

let mounted = false;

// Curated presets — paths assume coilflow-neural is symlinked or served at /coilflow-neural/
// (See bottom of this file for how to wire that on the tetra side.)
const PRESETS = {
    'birdcalls-2species': {
        name: 'birdcalls-2species (z-cruise demo)',
        baseUrl: '/coilflow-neural/datasets/birdcalls-2species/sonogenes/',
        files: ['whistler.json', 'buzzer.json'],
        defaults: { n: 200, sigma: 0.30 },
    },
    'birdcalls-kauai': {
        name: 'birdcalls-kauai (extinct & endangered)',
        baseUrl: '/coilflow-neural/datasets/birdcalls-kauai/sonogenes/',
        files: ['kauai-ooo.json', 'kamao.json', 'pouli.json', 'akikiki.json', 'akekee.json'],
        defaults: { n: 200, sigma: 0.25 },
    },
};

// In-memory builder state — each class is one row in the table.
let classes = [];   // [{ label, gene, n, sigma, generated?: Float32Array[] }]
let lastExport = null;  // { metadata, files: [{ name, audio }] }

export function mountDatasetBuilderTab() {
    if (mounted) return;
    const host = document.getElementById('tab-dataset');
    if (!host) return;

    host.innerHTML = `
      <div class="data-section">
        <h3 class="section-title">Dataset Builder · sonogenes → audio shard</h3>
        <div class="info" style="margin-bottom:6px">
          Load multiple sonogene archetypes as <strong>labeled classes</strong>. For each class,
          Sono generates N variations at σ. Output: a Hugging-Face-flavored dataset directory
          (<code>metadata.csv</code> + <code>data/{train,validation,test}/*.wav</code>) you can download as a zip-via-loop
          or push into bird2vec's in-memory training dataset.
        </div>
        <div class="info" style="font-size:10px">
          Presets fetch sonogene JSONs from <code>/coilflow-neural/datasets/&lt;name&gt;/sonogenes/</code>.
          Symlink the repo into the tetra dashboard's static mount, or load manually with
          <strong>Add JSON</strong>.
        </div>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn btn-primary" data-preset="birdcalls-2species">Load birdcalls-2species</button>
          <button class="btn btn-primary" data-preset="birdcalls-kauai">Load birdcalls-kauai</button>
          <label class="file-label">
            <input type="file" id="db-add-json" accept="application/json,.json" multiple hidden>
            <span class="btn">Add JSON…</span>
          </label>
          <button class="btn" id="db-clear-classes">Clear classes</button>
        </div>
      </div>

      <div class="data-section">
        <h3 class="section-title">Classes</h3>
        <table style="width:100%;font-size:11px;border-collapse:collapse">
          <thead>
            <tr style="text-align:left;color:var(--text-muted);border-bottom:1px solid var(--border)">
              <th style="padding:4px 8px">label</th>
              <th>F0 / vibrato / noisiness</th>
              <th>N</th>
              <th>σ</th>
              <th>generated</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="db-classes"></tbody>
        </table>
        <div id="db-class-empty" class="info" style="font-style:italic">No classes loaded — pick a preset above.</div>
      </div>

      <div class="data-section">
        <h3 class="section-title">Build</h3>
        <div class="synth-row" style="gap:10px;flex-wrap:wrap">
          <label>Default σ</label>
          <input type="range" id="db-sigma" min="0" max="1" step="0.01" value="0.30" style="width:120px">
          <span id="db-sigma-val" class="data-tag">0.30</span>
          <label style="margin-left:8px">Default N</label>
          <input type="number" id="db-n" value="200" min="1" max="2000" style="width:80px" class="text-input">
          <button class="btn" id="db-apply-defaults">Apply to all classes</button>
        </div>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn btn-primary" id="db-build">Build all classes</button>
          <button class="btn" id="db-add-dataset" disabled>Add to bird2vec dataset</button>
          <button class="btn" id="db-download" disabled>Download as HF dataset (metadata.csv + WAVs)</button>
        </div>
        <div id="db-status" class="info" style="margin-top:6px"></div>
      </div>
    `;

    for (const btn of host.querySelectorAll('[data-preset]')) {
        btn.addEventListener('click', () => loadPreset(btn.dataset.preset));
    }
    document.getElementById('db-add-json').addEventListener('change', addJsonFiles);
    document.getElementById('db-clear-classes').addEventListener('click', clearClasses);
    document.getElementById('db-sigma').addEventListener('input', e => {
        document.getElementById('db-sigma-val').textContent = (+e.target.value).toFixed(2);
    });
    document.getElementById('db-apply-defaults').addEventListener('click', applyDefaults);
    document.getElementById('db-build').addEventListener('click', buildAll);
    document.getElementById('db-add-dataset').addEventListener('click', addAllToDataset);
    document.getElementById('db-download').addEventListener('click', downloadHfDataset);

    renderClasses();
    mounted = true;
}

async function loadPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    setStatus(`Fetching ${preset.files.length} sonogenes from ${preset.baseUrl}…`);
    classes = [];
    for (const file of preset.files) {
        try {
            const r = await fetch(preset.baseUrl + file);
            if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
            const gene = await r.json();
            gene._source = gene._source || file;
            classes.push({
                label: file.replace(/\.json$/, ''),
                gene,
                n: preset.defaults.n,
                sigma: preset.defaults.sigma,
                generated: null,
            });
        } catch (e) {
            setStatus(`Failed to fetch ${file}: ${e.message}`);
        }
    }
    renderClasses();
    setStatus(`Loaded ${classes.length} archetypes from ${preset.name}.`);
}

async function addJsonFiles(e) {
    const files = e.target.files;
    if (!files?.length) return;
    for (const f of files) {
        try {
            const gene = JSON.parse(await f.text());
            gene._source = gene._source || f.name;
            classes.push({
                label: f.name.replace(/\.json$/, ''),
                gene,
                n: 200,
                sigma: 0.30,
                generated: null,
            });
        } catch (err) { setStatus(`Skip ${f.name}: ${err.message}`); }
    }
    e.target.value = '';
    renderClasses();
}

function clearClasses() { classes = []; lastExport = null; renderClasses(); }

function applyDefaults() {
    const n = +document.getElementById('db-n').value || 200;
    const s = +document.getElementById('db-sigma').value;
    for (const c of classes) { c.n = n; c.sigma = s; }
    renderClasses();
}

function renderClasses() {
    const tbody = document.getElementById('db-classes');
    const empty = document.getElementById('db-class-empty');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!classes.length) { if (empty) empty.style.display = ''; return; }
    if (empty) empty.style.display = 'none';
    classes.forEach((c, i) => {
        const g = c.gene;
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border)';
        tr.innerHTML = `
          <td style="padding:4px 8px"><code>${c.label}</code></td>
          <td style="color:var(--text-muted)">F0=<code>${g.medianF0}Hz</code> · vib=<code>${g.vibrato?.rate ?? 0}Hz/${g.vibrato?.depth ?? 0}</code> · noise=<code>${g.noisiness}</code></td>
          <td><input type="number" min="1" max="2000" value="${c.n}" data-i="${i}" data-k="n" class="text-input" style="width:64px"></td>
          <td><input type="number" min="0" max="1" step="0.01" value="${c.sigma}" data-i="${i}" data-k="sigma" class="text-input" style="width:64px"></td>
          <td>${c.generated ? `<span class="data-tag">${c.generated.length}</span>` : '—'}</td>
          <td><button class="btn" data-rm="${i}">×</button></td>
        `;
        tbody.appendChild(tr);
    });
    for (const inp of tbody.querySelectorAll('input[data-i]')) {
        inp.addEventListener('change', e => {
            const i = +e.target.dataset.i, k = e.target.dataset.k;
            classes[i][k] = +e.target.value;
        });
    }
    for (const btn of tbody.querySelectorAll('[data-rm]')) {
        btn.addEventListener('click', e => { classes.splice(+e.target.dataset.rm, 1); renderClasses(); });
    }
}

function setStatus(msg) {
    const el = document.getElementById('db-status');
    if (el) el.innerHTML = msg;
}

async function buildAll() {
    if (!classes.length) { setStatus('Load some archetypes first.'); return; }
    setStatus(`Building ${classes.length} classes…`);
    const t0 = performance.now();
    let total = 0;
    for (const c of classes) {
        c.generated = [];
        for (let i = 0; i < c.n; i++) {
            const g = perturbSonogene(c.gene, c.sigma);
            c.generated.push(sonoSynthesize(g, { sampleRate: state.sampleRate, audioLength: state.audioLength }));
            total++;
            if (i % 20 === 19) { setStatus(`Building ${c.label}… ${i+1}/${c.n}`); await new Promise(r => setTimeout(r, 0)); }
        }
    }
    const ms = Math.round(performance.now() - t0);
    setStatus(`<strong>Done</strong> · ${total} chunks across ${classes.length} classes in ${ms} ms`);
    document.getElementById('db-add-dataset').disabled = false;
    document.getElementById('db-download').disabled = false;
    renderClasses();
}

function addAllToDataset() {
    if (!classes.length) return;
    let added = 0;
    for (const c of classes) {
        if (!c.generated) continue;
        addToDataset(c.generated, {
            species: c.label,
            kind: 'synthetic_from_sonogene',
            sigma: c.sigma,
            sonogene_source: c.gene._source,
        });
        added += c.generated.length;
    }
    setStatus(`Added ${added} chunks to bird2vec training dataset.`);
}

// 16-bit PCM mono WAV encoder (matches js/cbp + server encoders).
function encodeWav(samples, sampleRate) {
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    w(0,'RIFF'); v.setUint32(4, 36+n*2, true); w(8,'WAVE');
    w(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true);
    v.setUint16(22,1,true); v.setUint32(24,sampleRate,true);
    v.setUint32(28,sampleRate*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true);
    w(36,'data'); v.setUint32(40,n*2,true);
    for (let i = 0; i < n; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        v.setInt16(44 + i*2, s < 0 ? s*0x8000 : s*0x7FFF, true);
    }
    return buf;
}

function downloadFile(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

// Deterministic train/val/test split per class (80/10/10).
function splitOf(idx, n) {
    const t = idx / n;
    return t < 0.8 ? 'train' : t < 0.9 ? 'validation' : 'test';
}

function downloadHfDataset() {
    if (!classes.length) return;
    const meta = ['file_name,label,sigma,sonogene_source,split,medianF0,noisiness'];
    let total = 0;
    const files = []; // { name, bytes }
    for (const c of classes) {
        if (!c.generated) continue;
        for (let i = 0; i < c.generated.length; i++) {
            const split = splitOf(i, c.generated.length);
            const fname = `data/${split}/${c.label}_${String(i).padStart(4,'0')}.wav`;
            files.push({ name: fname, bytes: encodeWav(c.generated[i], state.sampleRate) });
            meta.push(`${fname},${c.label},${c.sigma},${c.gene._source},${split},${c.gene.medianF0},${c.gene.noisiness}`);
            total++;
        }
    }
    if (!total) { setStatus('Nothing built yet — click Build first.'); return; }

    // Emit metadata.csv first.
    downloadFile('metadata.csv', new Blob([meta.join('\n')], { type: 'text/csv' }));

    if (files.length > 30) {
        if (!confirm(`Downloading ${files.length} WAV files individually (no zip lib bundled). For large batches, use "Add to bird2vec dataset" instead, or wire a server-side zip endpoint. Proceed?`)) return;
    }
    files.forEach((f, i) => setTimeout(() => downloadFile(f.name.split('/').pop(), new Blob([f.bytes], { type: 'audio/wav' })), i * 30));
    setStatus(`Downloading metadata.csv + ${files.length} WAVs (sequenced 30 ms apart to avoid browser throttling).`);
}
