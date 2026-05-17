// Sonogene UI panel — drop an audio file, see the extracted "DNA."
// Loads the panel into #tab-sonogene; mounts on first tab visit.

import { extractSonogene, sonogeneVector } from './extract.js';
import state from '../core/state.js';

let mounted = false;
let lastGene = null;

export function mountSonogeneTab() {
    if (mounted) return;
    const host = document.getElementById('tab-sonogene');
    if (!host) return;
    host.innerHTML = `
      <div class="data-section">
        <h3 class="section-title">Sonogene · DNA of the sound</h3>
        <div class="info" style="margin-bottom:6px">
          Drop one audio file (or paste a recording from <strong>Local Audio</strong>) — Sonogene extracts a structured
          parameter record (pitch contour, energy envelope, ADSR, harmonic series, syllable map, AM/FM modulation, noisiness)
          and renders it. Save the JSON to seed the future <strong>Sono</strong> synthesizer pak.
        </div>
        <label class="file-label">
          <input type="file" id="sg-file" accept="audio/*" hidden>
          <span class="btn btn-primary">Choose audio file</span>
        </label>
        <button class="btn" id="sg-from-generated" style="margin-left:8px">Use current generated audio</button>
        <button class="btn" id="sg-save" style="margin-left:8px" disabled>Save sonogene.json</button>
        <button class="btn" id="sg-log-cbp" style="margin-left:8px" disabled>Log to Coilboard as embedding</button>
        <div id="sg-status" class="info" style="margin-top:6px"></div>
      </div>

      <div id="sg-results" style="display:none">
        <div class="data-section">
          <h3 class="section-title">Meta</h3>
          <div id="sg-meta" class="info"></div>
        </div>

        <div class="canvas-row">
          <div class="canvas-wrap"><canvas id="sg-energy" height="100"></canvas></div>
          <div class="canvas-wrap"><canvas id="sg-pitch"  height="100"></canvas></div>
        </div>
        <div class="canvas-row">
          <div class="canvas-wrap"><canvas id="sg-centroid" height="100"></canvas></div>
          <div class="canvas-wrap"><canvas id="sg-spectrum" height="100"></canvas></div>
        </div>

        <div class="data-section">
          <h3 class="section-title">Derived features</h3>
          <div id="sg-features" style="font-size:11px"></div>
        </div>

        <div class="data-section">
          <h3 class="section-title">JSON record</h3>
          <pre id="sg-json" style="background:var(--bg-inset);border:1px solid var(--border);padding:8px;border-radius:3px;font-size:10px;max-height:240px;overflow:auto"></pre>
        </div>
      </div>
    `;

    document.getElementById('sg-file').addEventListener('change', onFile);
    document.getElementById('sg-from-generated').addEventListener('click', onFromGenerated);
    document.getElementById('sg-save').addEventListener('click', saveJson);
    document.getElementById('sg-log-cbp').addEventListener('click', logToCbp);
    mounted = true;
}

function setStatus(msg) {
    const el = document.getElementById('sg-status');
    if (el) el.textContent = msg;
}

async function decodeFile(file) {
    const ab = await file.arrayBuffer();
    const ctx = new AudioContext({ sampleRate: state.sampleRate });
    const decoded = await ctx.decodeAudioData(ab);
    ctx.close();
    return { samples: decoded.getChannelData(0), sampleRate: decoded.sampleRate };
}

async function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setStatus(`Decoding ${f.name}…`);
    try {
        const { samples, sampleRate } = await decodeFile(f);
        runExtract(samples, sampleRate, f.name);
    } catch (err) { setStatus(`Error: ${err.message}`); }
}

function onFromGenerated() {
    if (!state.generatedAudio) { setStatus('No generated audio yet — press Generate.'); return; }
    runExtract(state.generatedAudio, state.sampleRate, 'generated');
}

function runExtract(samples, sampleRate, label) {
    setStatus(`Extracting sonogene from ${samples.length} samples @ ${sampleRate} Hz…`);
    const t0 = performance.now();
    const gene = extractSonogene(samples, sampleRate);
    gene._source = label;
    lastGene = gene;
    const ms = Math.round(performance.now() - t0);
    setStatus(`Extracted in ${ms} ms · ${gene.meta.nFrames} frames · median F0 ${gene.medianF0} Hz · ${gene.syllables.length} syllables`);
    document.getElementById('sg-results').style.display = '';
    document.getElementById('sg-save').disabled = false;
    document.getElementById('sg-log-cbp').disabled = false;
    render(gene);
}

function render(gene) {
    document.getElementById('sg-meta').innerHTML = `
      <code>source=${gene._source}</code> · sample rate <code>${gene.meta.sampleRate}</code>
      · duration <code>${gene.meta.duration}s</code> · frames <code>${gene.meta.nFrames}</code>
      (${gene.meta.frameMs} ms / ${gene.meta.hopMs} ms hop)
    `;

    drawLine('sg-energy',   gene.energy,    'energy (RMS)',          '#3fb950');
    drawLine('sg-pitch',    gene.pitch.map(p => p || NaN), 'pitch (Hz, voiced)', '#58a6ff');
    drawLine('sg-centroid', gene.centroid,  'spectral centroid (Hz)','#bc8cff');
    drawBars('sg-spectrum', gene.spectrum,  'spectrum (12 log-bands)');

    const hs = gene.harmonics.map(h => `<span class="data-tag">×${h.ratio}: ${(h.strength*100).toFixed(0)}%</span>`).join(' ');
    const syl = gene.syllables.map((s,i) => `<span class="data-tag">${i+1}: ${s.start}–${s.end}s</span>`).join(' ');
    document.getElementById('sg-features').innerHTML = `
      <div><strong>median F0</strong> <code>${gene.medianF0} Hz</code> &nbsp;
           <strong>noisiness</strong> <code>${gene.noisiness}</code></div>
      <div style="margin-top:4px"><strong>ADSR</strong>
        A=<code>${gene.adsr.attack}s</code>
        D=<code>${gene.adsr.decay}s</code>
        S=<code>${gene.adsr.sustain}</code>
        R=<code>${gene.adsr.release}s</code></div>
      <div style="margin-top:4px"><strong>vibrato</strong>
        rate=<code>${gene.vibrato.rate} Hz</code> depth=<code>${gene.vibrato.depth}</code>
        &nbsp; <strong>AM</strong> rate=<code>${gene.am.rate} Hz</code> depth=<code>${gene.am.depth}</code></div>
      <div style="margin-top:4px"><strong>harmonics</strong> ${hs || '<em>none detected (unvoiced)</em>'}</div>
      <div style="margin-top:4px"><strong>syllables</strong> (${gene.syllables.length}) ${syl || '<em>—</em>'}</div>
    `;

    document.getElementById('sg-json').textContent = JSON.stringify(gene, null, 2);
}

function drawLine(id, values, label, color) {
    const cv = document.getElementById(id); if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 320, h = cv.clientHeight || 100;
    if (cv.width !== w*dpr) { cv.width = w*dpr; cv.height = h*dpr; }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle = '#010409'; ctx.fillRect(0,0,w,h);
    const valid = values.filter(v => Number.isFinite(v));
    if (!valid.length) { ctx.fillStyle = '#8b949e'; ctx.font='10px monospace'; ctx.fillText(label + ' — no data', 8, 16); return; }
    const mn = Math.min(...valid), mx = Math.max(...valid);
    const pad = { l: 30, r: 6, t: 14, b: 12 };
    const X = i => pad.l + (w-pad.l-pad.r) * i / Math.max(1, values.length - 1);
    const Y = v => h-pad.b - (h-pad.t-pad.b) * (v - mn) / Math.max(1e-6, mx - mn);
    ctx.fillStyle = '#8b949e'; ctx.font = '9px monospace';
    ctx.fillText(label, pad.l, 10);
    ctx.fillText(mx.toFixed(2), 2, pad.t + 6);
    ctx.fillText(mn.toFixed(2), 2, h - pad.b);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
    let started = false;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (!Number.isFinite(v)) { started = false; continue; }
        const x = X(i), y = Y(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

function drawBars(id, spectrum, label) {
    const cv = document.getElementById(id); if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 320, h = cv.clientHeight || 100;
    if (cv.width !== w*dpr) { cv.width = w*dpr; cv.height = h*dpr; }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle = '#010409'; ctx.fillRect(0,0,w,h);
    if (!spectrum.length) return;
    const max = Math.max(...spectrum.map(s => s.energy)) || 1;
    const pad = { l: 26, r: 6, t: 14, b: 14 };
    const bw = (w - pad.l - pad.r) / spectrum.length;
    ctx.fillStyle = '#8b949e'; ctx.font = '9px monospace';
    ctx.fillText(label, pad.l, 10);
    for (let i = 0; i < spectrum.length; i++) {
        const e = spectrum[i].energy / max;
        const x = pad.l + i * bw, y = h - pad.b - e * (h - pad.t - pad.b);
        ctx.fillStyle = `hsl(${280 - i*16}, 65%, 60%)`;
        ctx.fillRect(x + 1, y, bw - 2, h - pad.b - y);
        if (i % 2 === 0) { ctx.fillStyle = '#8b949e'; ctx.fillText(spectrum[i].band, x, h - 3); }
    }
}

function saveJson() {
    if (!lastGene) return;
    const blob = new Blob([JSON.stringify(lastGene, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sonogene-${Date.now()}.json`;
    a.click();
}

async function logToCbp() {
    if (!lastGene) return;
    try {
        const { getRun } = await import('../cbp/wiring.js');
        const run = getRun();
        if (!run) { setStatus('CBP run not active.'); return; }
        const v = sonogeneVector(lastGene);
        const { logEmbedding } = await import('../cbp/cbp-client.js');
        const step = lastGene.meta.nFrames;
        logEmbedding(run, step, 'sonogene.fingerprint', v, {
            kind: 'sonogene',
            src: lastGene._source,
            medianF0: lastGene.medianF0,
            noisiness: lastGene.noisiness,
        });
        setStatus(`Logged sonogene fingerprint (dim=${v.length}) to Coilboard as embedding "sonogene.fingerprint".`);
    } catch (e) { setStatus('CBP log failed: ' + e.message); }
}
