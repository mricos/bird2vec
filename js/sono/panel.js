// Sono panel — synthetic generator that turns one sonogene into a cloud
// of variations, ready to feed into the WaveGAN training dataset.

import { sonoSynthesize, perturbSonogene, batchVariations, SONO_BOUNDS } from '../nn/sono.js';
import { getSonogene, onSonogeneChange } from '../sonogene/store.js';
import state from '../core/state.js';
import { addToDataset } from '../data/fetch-birds.js';
import { playAudio } from '../audio/audio.js';
import { drawWaveform } from '../plot/plot-waveform.js';

let mounted = false;
let lastBatch = [];   // [{ gene, audio }]
let unsubscribe = null;

const BOUND_ROWS = [
    ['Fundamental F0',   `${SONO_BOUNDS.f0Hz[0]}–${SONO_BOUNDS.f0Hz[1]} Hz (log-jitter)`],
    ['Partial strength', `${SONO_BOUNDS.harmonic[0]}–${SONO_BOUNDS.harmonic[1]} per partial`],
    ['Vibrato rate',     `${SONO_BOUNDS.vibratoRate[0]}–${SONO_BOUNDS.vibratoRate[1]} Hz`],
    ['Vibrato depth',    `${SONO_BOUNDS.vibratoDepth[0]}–${SONO_BOUNDS.vibratoDepth[1]} (→ ±200 Hz FM)`],
    ['AM rate / depth',  `${SONO_BOUNDS.amRate[0]}–${SONO_BOUNDS.amRate[1]} Hz / ${SONO_BOUNDS.amDepth[0]}–${SONO_BOUNDS.amDepth[1]}`],
    ['Noisiness',        `${SONO_BOUNDS.noisiness[0]}–${SONO_BOUNDS.noisiness[1]}`],
    ['Attack / Decay',   `${SONO_BOUNDS.attackSec[0]*1000}–${SONO_BOUNDS.attackSec[1]*1000} ms / ${SONO_BOUNDS.decaySec[0]*1000}–${SONO_BOUNDS.decaySec[1]*1000} ms`],
];

export function mountSonoTab() {
    if (mounted) return;
    const host = document.getElementById('tab-sono');
    if (!host) return;

    host.innerHTML = `
      <div class="data-section">
        <h3 class="section-title">Sono · synthetic generator for GAN training</h3>
        <div class="info" style="margin-bottom:8px">
          Sono takes a <strong>sonogene</strong> (extract one from a recording in the
          <em>Sonogene</em> tab) and synthesizes audio matching its parameter signature.
          Perturb the sonogene before synthesis to get a <em>cloud</em> of variations —
          that's the path from one extinct-bird recording to a WaveGAN training shard.
          <br><br>
          <strong>Sono does not touch <code>z</code>.</strong> WaveGAN's <code>z</code> stays a learned latent.
          Sono is pure DSP, driven by structured features.
        </div>
      </div>

      <div class="data-section">
        <h3 class="section-title">Source sonogene</h3>
        <div id="sono-source" class="info">No sonogene loaded — extract one in the <strong>Sonogene</strong> tab.</div>
        <div class="btn-row" style="margin-top:6px">
          <label class="file-label">
            <input type="file" id="sono-file" accept="application/json,.json" hidden>
            <span class="btn">Load sonogene.json</span>
          </label>
          <button class="btn" id="sono-refresh">Refresh from Sonogene tab</button>
        </div>
      </div>

      <div class="data-section">
        <h3 class="section-title">Single preview</h3>
        <div class="btn-row">
          <button class="btn btn-primary" id="sono-preview">Synthesize once</button>
          <button class="btn" id="sono-perturb-preview">Synthesize one perturbed</button>
          <button class="btn" id="sono-play">Play</button>
        </div>
        <div class="canvas-row" style="margin-top:8px">
          <div class="canvas-wrap"><canvas id="sono-preview-canvas" height="120"></canvas></div>
        </div>
      </div>

      <div class="data-section">
        <h3 class="section-title">Batch — generate a WaveGAN-training shard</h3>
        <div class="synth-row" style="gap:12px;flex-wrap:wrap">
          <label>σ (perturbation)</label>
          <input type="range" id="sono-sigma" min="0" max="1" step="0.01" value="0.3" style="width:140px">
          <span id="sono-sigma-val" class="data-tag">0.30</span>
          <label style="margin-left:12px">N</label>
          <input type="number" id="sono-n" value="50" min="1" max="2000" style="width:80px" class="text-input">
          <button class="btn btn-primary" id="sono-batch">Generate variations</button>
        </div>
        <div id="sono-batch-status" class="info" style="margin-top:6px"></div>
        <div class="btn-row" style="margin-top:6px">
          <button class="btn" id="sono-add" disabled>Add to dataset</button>
          <button class="btn" id="sono-cbp"  disabled>Log batch to Coilboard</button>
          <button class="btn" id="sono-zip"  disabled>Download batch as WAVs</button>
          <button class="btn" id="sono-clear" disabled>Clear batch</button>
        </div>
      </div>

      <div class="data-section">
        <h3 class="section-title">Sono operating space (perturbation bounds)</h3>
        <table style="font-size:11px;border-collapse:collapse">
          <tbody id="sono-bounds-tbl"></tbody>
        </table>
        <div class="info" style="margin-top:6px;font-size:10px">
          These bounds match the table you provided. σ=0 → identity. σ=1 → samples
          can land anywhere in the bounded box (Gaussian-jitter, clamped).
        </div>
      </div>
    `;

    // Wire bounds table
    const tbody = document.getElementById('sono-bounds-tbl');
    tbody.innerHTML = BOUND_ROWS.map(r => `
      <tr><td style="padding:2px 12px 2px 0;color:var(--text-muted)">${r[0]}</td>
          <td style="padding:2px 0"><code>${r[1]}</code></td></tr>
    `).join('');

    // Live source readout + auto-update when sonogene store changes
    refreshSource();
    unsubscribe = onSonogeneChange(refreshSource);

    document.getElementById('sono-file').addEventListener('change', loadFromJsonFile);
    document.getElementById('sono-refresh').addEventListener('click', refreshSource);
    document.getElementById('sono-preview').addEventListener('click', () => previewOnce(false));
    document.getElementById('sono-perturb-preview').addEventListener('click', () => previewOnce(true));
    document.getElementById('sono-play').addEventListener('click', playLast);
    document.getElementById('sono-sigma').addEventListener('input', e => {
        document.getElementById('sono-sigma-val').textContent = (+e.target.value).toFixed(2);
    });
    document.getElementById('sono-batch').addEventListener('click', runBatch);
    document.getElementById('sono-add').addEventListener('click', addBatchToDataset);
    document.getElementById('sono-cbp').addEventListener('click', logBatchToCbp);
    document.getElementById('sono-zip').addEventListener('click', downloadBatchAsWavs);
    document.getElementById('sono-clear').addEventListener('click', clearBatch);

    mounted = true;
}

function refreshSource() {
    const gene = getSonogene();
    const el = document.getElementById('sono-source');
    if (!el) return;
    if (!gene) { el.innerHTML = 'No sonogene loaded — extract one in the <strong>Sonogene</strong> tab.'; return; }
    el.innerHTML = `
      <strong>Loaded:</strong> <code>${gene._source || 'unknown'}</code><br>
      median F0 <code>${gene.medianF0} Hz</code> · vibrato <code>${gene.vibrato?.rate ?? 0} Hz</code>/<code>${gene.vibrato?.depth ?? 0}</code> ·
      AM <code>${gene.am?.rate ?? 0} Hz</code>/<code>${gene.am?.depth ?? 0}</code> ·
      noisiness <code>${gene.noisiness}</code> · ADSR
      A=<code>${gene.adsr?.attack ?? 0}s</code> D=<code>${gene.adsr?.decay ?? 0}s</code> ·
      ${gene.harmonics?.length || 0} harmonics · ${gene.syllables?.length || 0} syllables
    `;
}

async function loadFromJsonFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    try {
        const gene = JSON.parse(await f.text());
        gene._source = gene._source || f.name;
        // route via store so other tabs see it too
        const { setSonogene } = await import('../sonogene/store.js');
        setSonogene(gene);
    } catch (err) { alert('Invalid sonogene JSON: ' + err.message); }
}

let lastPreviewAudio = null;
function previewOnce(perturb) {
    const gene = getSonogene();
    if (!gene) { document.getElementById('sono-batch-status').textContent = 'Load a sonogene first.'; return; }
    const sigma = +document.getElementById('sono-sigma').value;
    const g = perturb ? perturbSonogene(gene, sigma) : gene;
    const audio = sonoSynthesize(g, { sampleRate: state.sampleRate, audioLength: state.audioLength });
    lastPreviewAudio = audio;
    const cv = document.getElementById('sono-preview-canvas');
    if (cv) drawWaveform(cv, audio, { sampleRate: state.sampleRate, title: `Sono · ${perturb ? `σ=${sigma}` : 'identity'} · F0=${g.medianF0}Hz` });
}

function playLast() {
    if (lastPreviewAudio) playAudio(lastPreviewAudio, state.sampleRate);
}

async function runBatch() {
    const gene = getSonogene();
    const sigma = +document.getElementById('sono-sigma').value;
    const n = Math.max(1, Math.min(2000, +document.getElementById('sono-n').value || 50));
    const status = document.getElementById('sono-batch-status');
    if (!gene) { status.textContent = 'Load a sonogene first.'; return; }
    status.textContent = `Generating ${n} variations at σ=${sigma}…`;
    // Yield to UI between chunks so the browser stays responsive.
    lastBatch = [];
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
        const g = perturbSonogene(gene, sigma);
        const audio = sonoSynthesize(g, { sampleRate: state.sampleRate, audioLength: state.audioLength });
        lastBatch.push({ gene: g, audio });
        if (i % 10 === 9) {
            status.textContent = `Generating… ${i+1}/${n}`;
            await new Promise(r => setTimeout(r, 0));
        }
    }
    const ms = Math.round(performance.now() - t0);
    status.innerHTML = `<strong>Done</strong> · ${n} variations · ${ms} ms (~${(ms/n).toFixed(1)} ms each)`;
    for (const id of ['sono-add', 'sono-cbp', 'sono-zip', 'sono-clear']) document.getElementById(id).disabled = false;
    // Preview the first one
    lastPreviewAudio = lastBatch[0].audio;
    drawWaveform(document.getElementById('sono-preview-canvas'), lastPreviewAudio, {
        sampleRate: state.sampleRate, title: `Sono · batch[0] · σ=${sigma} · F0=${lastBatch[0].gene.medianF0}Hz`,
    });
}

function addBatchToDataset() {
    if (!lastBatch.length) return;
    const gene = getSonogene();
    const sigma = +document.getElementById('sono-sigma').value;
    const baseMeta = {
        species: 'synthetic',
        file: `sono-from-${gene?._source || 'unknown'}`,
        kind: 'synthetic_from_sonogene',
        sigma,
        sourceSonogene: gene?._source || null,
    };
    addToDataset(lastBatch.map(b => b.audio), baseMeta);
    document.getElementById('sono-batch-status').innerHTML += `<br>→ Added ${lastBatch.length} chunks to dataset.`;
}

async function logBatchToCbp() {
    if (!lastBatch.length) return;
    try {
        const { getRun } = await import('../cbp/wiring.js');
        const run = getRun();
        if (!run) { document.getElementById('sono-batch-status').innerHTML += '<br>CBP run not active.'; return; }
        const { logEmbedding, logAudio, logSample } = await import('../cbp/cbp-client.js');
        const { sonogeneVector } = await import('../sonogene/extract.js');
        const startStep = 1000000;     // out-of-band step range so it doesn't collide with Generate steps
        for (let i = 0; i < lastBatch.length; i++) {
            const { gene, audio } = lastBatch[i];
            const step = startStep + i;
            const v = sonogeneVector(gene);
            logEmbedding(run, step, 'sonogene.fingerprint', v, {
                kind: 'synthetic_from_sonogene',
                sigma: gene._sigma,
                src: gene._perturbedFrom || gene._source,
                medianF0: gene.medianF0,
                noisiness: gene.noisiness,
            });
            // Only upload audio for the first 8 so we don't flood the server.
            if (i < 8) {
                const file = await logAudio(run, step, `sono_${i}`, audio, state.sampleRate);
                logSample(run, step, file, 'sonogene.fingerprint', 'synthetic_from_sonogene', { sigma: gene._sigma, index: i });
            }
        }
        document.getElementById('sono-batch-status').innerHTML += `<br>→ Logged ${lastBatch.length} fingerprints (first 8 with audio) to Coilboard.`;
    } catch (e) {
        document.getElementById('sono-batch-status').innerHTML += `<br>CBP log failed: ${e.message}`;
    }
}

function clearBatch() {
    lastBatch = [];
    for (const id of ['sono-add', 'sono-cbp', 'sono-zip', 'sono-clear']) document.getElementById(id).disabled = true;
    document.getElementById('sono-batch-status').textContent = 'Batch cleared.';
}

// Encode a Float32Array as a 16-bit PCM mono WAV (matches server-side encoder).
function encodeWav(samples, sampleRate) {
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    function s(o, t) { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); }
    s(0, 'RIFF'); v.setUint32(4, 36 + n*2, true); s(8, 'WAVE');
    s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate*2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    s(36, 'data'); v.setUint32(40, n*2, true);
    for (let i = 0; i < n; i++) {
        const x = Math.max(-1, Math.min(1, samples[i]));
        v.setInt16(44 + i*2, x < 0 ? x * 0x8000 : x * 0x7FFF, true);
    }
    return buf;
}

function downloadBatchAsWavs() {
    if (!lastBatch.length) return;
    // No zip lib — drop them one at a time. For >20 files, recommend "Add to dataset" instead.
    if (lastBatch.length > 20) {
        if (!confirm(`Downloading ${lastBatch.length} files individually. Use "Add to dataset" for larger batches. Continue?`)) return;
    }
    for (let i = 0; i < lastBatch.length; i++) {
        const wav = encodeWav(lastBatch[i].audio, state.sampleRate);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
        a.download = `sono_${String(i).padStart(4,'0')}.wav`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
}
