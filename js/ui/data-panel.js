// Data panel — UI for the Data tab
import { on, emit } from '../core/events.js';
import state from '../core/state.js';
import { $ } from '../core/utils.js';
import {
  searchXenoCanto, fetchRecording, sliceIntoChunks,
  loadLocalFiles, generateSyntheticDataset,
  addToDataset, clearDataset, setXcKey,
} from '../data/fetch-birds.js';
import { drawWaveform } from '../plot/plot-waveform.js';
import { playAudio } from '../audio/audio.js';
import { computeSpectrogram } from '../audio/audio.js';
import { drawSpectrogram } from '../plot/plot-spectrogram.js';

let searchResults = [];

// Curated extinct + critically-endangered species with known Xeno-Canto
// recordings. `query` uses XC v3 tag syntax. Status legend:
//   EX  = extinct (IUCN)
//   EW  = extinct in the wild
//   CR  = critically endangered (some flagged "possibly extinct")
// Year = last confirmed wild recording / sighting (approximate).
//
// Kauaʻi species first — this pak's existing checkpoint was trained on
// Kauaʻi field recordings, so acoustic context aligns.
const EXTINCT_BIRDS = [
  { en: 'Kauaʻi ʻōʻō',            sci: 'Moho braccatus',          status: 'EX',  year: 1987, query: 'gen:moho sp:braccatus q:A',           note: 'Famous solitary-male duet recordings (Halloween 1987).' },
  { en: 'Kamaʻo',                 sci: 'Myadestes myadestinus',   status: 'EX',  year: 1989, query: 'gen:myadestes sp:myadestinus',        note: 'Large Kauaʻi thrush. Same forest as ʻōʻō.' },
  { en: 'Olomaʻo',                sci: 'Myadestes lanaiensis',    status: 'EX',  year: 1980, query: 'gen:myadestes sp:lanaiensis',         note: 'Molokaʻi thrush.' },
  { en: 'Poʻouli',                sci: 'Melamprosops phaeosoma',  status: 'EX',  year: 2004, query: 'gen:melamprosops',                    note: 'Last individual died in captivity 2004.' },
  { en: 'ʻAkialoa (Kauaʻi)',      sci: 'Akialoa stejnegeri',      status: 'EX',  year: 1969, query: 'gen:akialoa',                         note: 'Long-billed honeycreeper. Few recordings exist.' },
  { en: 'Ivory-billed Woodpecker',sci: 'Campephilus principalis', status: 'CR',  year: 1944, query: 'gen:campephilus sp:principalis',      note: 'Cornell 1935 Singer Tract recordings. Status disputed.' },
  { en: 'Imperial Woodpecker',    sci: 'Campephilus imperialis',  status: 'CR',  year: 1956, query: 'gen:campephilus sp:imperialis',       note: 'Largest woodpecker ever. 1956 film has audio.' },
  { en: 'Spixʼs Macaw',           sci: 'Cyanopsitta spixii',      status: 'EW',  year: 2000, query: 'gen:cyanopsitta sp:spixii',           note: 'Extinct in wild; captive population reintroducing.' },
  { en: 'ʻAkikiki',               sci: 'Oreomystis bairdi',       status: 'CR',  year: 2024, query: 'gen:oreomystis sp:bairdi',            note: 'Kauaʻi creeper. Wild population ~5 birds (2024).' },
  { en: 'ʻAkekeʻe',               sci: 'Loxops caeruleirostris',  status: 'CR',  year: 2024, query: 'gen:loxops sp:caeruleirostris',       note: 'Kauaʻi. Acoustic neighbour of the ʻōʻō.' },
  { en: 'ʻAkiapōlāʻau',           sci: 'Hemignathus wilsoni',     status: 'CR',  year: null, query: 'gen:hemignathus sp:wilsoni',           note: 'Big Island. Asymmetric bill, unique calls.' },
  { en: 'Regent Honeyeater',      sci: 'Anthochaera phrygia',     status: 'CR',  year: null, query: 'gen:anthochaera sp:phrygia',          note: 'AUS. Song dialect being lost — Crates et al. 2021.' },
];

function renderExtinctChips() {
  const host = $('extinct-chips');
  if (!host) return;
  host.innerHTML = '';
  EXTINCT_BIRDS.forEach(b => {
    const chip = document.createElement('button');
    chip.className = 'btn';
    chip.style.cssText = 'font-size:10px;padding:4px 8px;line-height:1.4;text-align:left';
    const color = b.status === 'EX' ? 'var(--red)' : b.status === 'EW' ? 'var(--orange)' : 'var(--purple)';
    const yr = b.year ? ` · ${b.year}` : '';
    chip.innerHTML = `<span style="color:${color};font-weight:bold">${b.status}</span>${yr} · ${b.en}<br><span style="color:var(--text-muted);font-size:9px">${b.sci}</span>`;
    chip.title = b.note;
    chip.addEventListener('click', () => {
      const q = $('xc-query');
      if (q) { q.value = b.query; }
      setStatus(`Loading ${b.en} (${b.sci})…`);
      $('btn-xc-search')?.click();
    });
    host.appendChild(chip);
  });
}

async function addAllResults() {
  if (!searchResults.length) { setStatus('No search results to add. Run a query first.'); return; }
  const btn = $('btn-xc-add-all');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  let added = 0, failed = 0;
  for (const rec of searchResults) {
    try {
      const result = await fetchRecording(rec);
      const chunks = sliceIntoChunks(result.samples, state.audioLength);
      addToDataset(chunks, rec);
      added += chunks.length;
      setStatus(`Added ${chunks.length} chunks from ${rec.species} #${rec.id} (running total ${added})`);
    } catch (e) {
      failed++;
      // continue — CORS or 404 on some XC files
    }
  }
  setStatus(`Done · ${added} chunks added · ${failed} failed (CORS/404)`);
  if (btn) { btn.disabled = false; btn.textContent = 'Add all results to dataset'; }
  renderDatasetInfo();
}

function recommendPrep() {
  const out = $('extinct-prep-out');
  if (!out) return;
  const ds = state.dataset;
  const have = ds ? ds.chunks.length : 0;
  const target = 200;          // minimum useful per species for WaveGAN fine-tune
  const chunkSec = state.audioLength / state.sampleRate;
  out.innerHTML = `
    <strong>Prep checklist for WaveGAN on extinct-bird audio:</strong><br>
    1. <strong>Quality filter</strong> — append <code>q:A</code> to XC queries (clean field recordings only). Most extinct-bird recordings are pre-2000 reel-to-reel: also try <code>q:B</code>.<br>
    2. <strong>Resample to 16 kHz mono</strong> — done automatically by the XC ingest path; WaveGAN expects 16384 samples = <strong>${chunkSec.toFixed(2)} s</strong> @ 16 kHz.<br>
    3. <strong>Trim silence / non-target species</strong> — extinct-bird tapes are often noisy; recommend a hand-edit pass in Audacity before <em>Local Audio Files</em> import.<br>
    4. <strong>Per-species chunks</strong> — aim for ≥ <strong>${target}</strong>; you currently have <strong>${have}</strong>${have >= target ? ' ✓' : ` (need ${target - have} more)`}.<br>
    5. <strong>Balance the set</strong> — WaveGAN will over-fit toward whichever species dominates the chunk count. Keep ±20% across species or use the WGAN-GP gradient penalty's natural smoothing.<br>
    6. <strong>Augment sparingly</strong> — pitch ±2 semitones and time-stretch ±5% can 4× a tiny extinct corpus without phantom artifacts. Avoid heavy noise injection (the recordings already carry historical noise as signal).<br>
    7. <strong>Train</strong> — use the existing <code>wgtrain-stream-kauai-6-2sec</code> checkpoint as a starting point and fine-tune; from scratch needs ~10k+ chunks.
  `;
}

// ── Quickstart + source-card wiring (tightened UI, 2026-05-17) ───────────────

async function probeXcProxy() {
    try {
        const r = await fetch('/api/bird2vec/health');
        if (!r.ok) return { ok: false, hasKey: false };
        return await r.json();
    } catch { return { ok: false, hasKey: false }; }
}

async function refreshXcStatus() {
    const pill   = $('xc-status-pill');
    const banner = $('xc-key-banner');
    if (!pill) return;
    const h = await probeXcProxy();
    if (h.ok && h.hasKey) {
        pill.textContent = 'proxy ✓ key ✓';
        pill.style.background = 'var(--green)'; pill.style.color = '#000';
        if (banner) banner.innerHTML = '<strong>Server proxy is configured</strong> — your XC key never touches this page. Searches route through <code>/api/bird2vec/search</code> with a proper User-Agent (avoids Cloudflare bot block).';
    } else if (h.ok) {
        pill.textContent = 'proxy ✓ key ✗';
        pill.style.background = 'var(--orange)'; pill.style.color = '#000';
        if (banner) banner.innerHTML = '<strong>Server proxy is running but no key is set.</strong> Either drop one in <code>~/tetra/bird2vec/keys.toml</code> + restart <code>tetra-4444</code>, or paste it in the field below (browser-side, will trip Cloudflare on heavy use).';
    } else {
        pill.textContent = 'proxy ✗';
        pill.style.background = 'var(--red)'; pill.style.color = '#fff';
        if (banner) banner.innerHTML = '<strong>Server proxy unreachable</strong> (paks/bird2vec/api/router.js not loaded). Restart tetra-4444 to enable the proxy, or paste a client-side key below.';
    }
}

function renderDatasetInline() {
    const el = $('dataset-info-inline');
    if (!el) return;
    const ds = state.dataset;
    if (!ds || !ds.chunks.length) { el.textContent = 'No training data loaded'; return; }
    const species = {};
    for (const m of ds.meta) {
        const k = m.species || m.file || 'unknown';
        species[k] = (species[k] || 0) + 1;
    }
    const sec = (ds.chunks.length * state.audioLength / state.sampleRate).toFixed(1);
    const tags = Object.entries(species).map(([k, n]) => `<span class="data-tag">${k} (${n})</span>`).join(' ');
    el.innerHTML = `<strong>${ds.chunks.length} chunks</strong> · ${sec}s total · ${tags}`;
}

async function runQuickbuild(presetName, statusElId = 'quickstart-status') {
    const el = $(statusElId);
    const presets = {
        'birdcalls-2species': { files: ['whistler.json', 'buzzer.json'],                                                  defaultsN: 200, sigma: 0.30 },
        'birdcalls-kauai':    { files: ['kauai-ooo.json', 'kamao.json', 'pouli.json', 'akikiki.json', 'akekee.json'],     defaultsN: 200, sigma: 0.25 },
    };
    const preset = presets[presetName];
    if (!preset) return;
    if (el) el.textContent = `Loading ${preset.files.length} archetypes from /coilflow-neural/datasets/${presetName}/sonogenes/…`;

    // Lazy-import sono so the Data tab doesn't carry sono weight for everyone
    const [{ sonoSynthesize, perturbSonogene }, { addToDataset }] = await Promise.all([
        import('../nn/sono.js'),
        import('../data/fetch-birds.js'),
    ]);

    let totalChunks = 0;
    for (const file of preset.files) {
        try {
            const r = await fetch(`/coilflow-neural/datasets/${presetName}/sonogenes/${file}`);
            if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
            const gene = await r.json();
            gene._source = gene._source || file;
            const label = file.replace(/\.json$/, '');
            const chunks = [];
            for (let i = 0; i < preset.defaultsN; i++) {
                const g = perturbSonogene(gene, preset.sigma);
                chunks.push(sonoSynthesize(g, { sampleRate: state.sampleRate, audioLength: state.audioLength }));
            }
            addToDataset(chunks, { species: label, kind: 'synthetic_from_sonogene', sigma: preset.sigma, sonogene_source: gene._source });
            totalChunks += chunks.length;
            if (el) el.textContent = `Built ${label}: ${chunks.length} chunks · running total ${totalChunks}…`;
            // yield to UI between classes
            await new Promise(rr => setTimeout(rr, 0));
        } catch (e) {
            if (el) el.innerHTML = `<span style="color:var(--red)">Failed on ${file}: ${e.message}</span> — is <code>/coilflow-neural/</code> mounted? (Check pak.json + tetra-4444 restart.)`;
            return;
        }
    }
    if (el) el.innerHTML = `<strong style="color:var(--green)">Done</strong> · ${totalChunks} chunks added across ${preset.files.length} classes. Now: switch to <strong>Metrics</strong> for live training scalars, or use the <strong>Dataset</strong> tab for more control.`;
    renderDatasetInline();
}

export function initDataPanel() {
  renderExtinctChips();
  refreshXcStatus();
  renderDatasetInline();
  $('btn-quickstart')?.addEventListener('click', () => runQuickbuild('birdcalls-2species', 'quickstart-status'));
  for (const btn of document.querySelectorAll('[data-quickbuild]')) {
      btn.addEventListener('click', () => runQuickbuild(btn.dataset.quickbuild, 'synth-status'));
  }
  $('btn-xc-add-all')?.addEventListener('click', addAllResults);
  $('btn-extinct-prep')?.addEventListener('click', recommendPrep);
  // API key
  $('xc-key')?.addEventListener('change', e => {
    setXcKey(e.target.value.trim());
    setStatus('API key set');
  });

  // Search xeno-canto
  $('btn-xc-search')?.addEventListener('click', async () => {
    const query = $('xc-query').value.trim();
    if (!query) return;
    try {
      const results = await searchXenoCanto(query);
      searchResults = results.recordings;
      renderSearchResults(results.recordings);
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
  });

  // Enter key in search box
  $('xc-query')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-xc-search')?.click();
  });

  // Local file upload
  $('file-input')?.addEventListener('change', async e => {
    const files = e.target.files;
    if (!files.length) return;
    try {
      const results = await loadLocalFiles(files);
      const chunkLen = state.audioLength;
      for (const result of results) {
        const chunks = sliceIntoChunks(result.samples, chunkLen);
        addToDataset(chunks, result.meta);
        setStatus(`Added ${chunks.length} chunks from ${result.meta.file}`);
      }
      renderDatasetInfo();
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
  });

  // Synthetic data
  $('btn-synthetic')?.addEventListener('click', () => {
    const n = parseInt($('synthetic-count')?.value || '50');
    const chunks = generateSyntheticDataset(n, state.audioLength, state.sampleRate);
    addToDataset(chunks, { species: 'synthetic' });
    renderDatasetInfo();
  });

  // Clear dataset
  $('btn-clear-data')?.addEventListener('click', () => {
    clearDataset();
    renderDatasetInfo();
  });

  // Status updates
  on('data:status', ({ msg }) => setStatus(msg));
  on('data:updated', () => { renderDatasetInfo(); renderDatasetInline(); });
}

function setStatus(msg) {
  const el = $('data-status');
  if (el) el.textContent = msg;
}

function renderSearchResults(recordings) {
  const container = $('xc-results');
  if (!container) return;

  container.innerHTML = '';

  if (recordings.length === 0) {
    container.innerHTML = '<div class="info">No recordings found</div>';
    return;
  }

  recordings.slice(0, 20).forEach((rec, i) => {
    const row = document.createElement('div');
    row.className = 'xc-row';
    row.innerHTML = `
      <div class="xc-info">
        <span class="xc-species">${rec.species}</span>
        <span class="xc-meta">${rec.sciName} · ${rec.country} · ${rec.duration} · Q:${rec.quality}</span>
      </div>
      <div class="xc-actions">
        <button class="btn-sm" data-action="preview" data-idx="${i}">Preview</button>
        <button class="btn-sm" data-action="add" data-idx="${i}">+ Add</button>
      </div>
    `;
    container.appendChild(row);
  });

  // Event delegation
  container.addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    const rec = searchResults[idx];
    if (!rec) return;

    btn.textContent = '...';
    btn.disabled = true;

    try {
      const result = await fetchRecording(rec);

      if (btn.dataset.action === 'preview') {
        // Show waveform + spectrogram in preview canvases, play audio
        const previewCanvas = $('canvas-data-preview');
        const specCanvas = $('canvas-data-spec');
        if (previewCanvas) {
          // Show first audioLength samples
          const preview = result.samples.subarray(0, state.audioLength);
          drawWaveform(previewCanvas, preview, {
            sampleRate: result.sampleRate,
            title: `${rec.species} #${rec.id}`,
          });
          if (specCanvas) {
            const spec = computeSpectrogram(preview, 512, 128);
            drawSpectrogram(specCanvas, spec, { sampleRate: result.sampleRate });
          }
          playAudio(preview, result.sampleRate);
        }
        btn.textContent = 'Preview';
        btn.disabled = false;

      } else if (btn.dataset.action === 'add') {
        const chunks = sliceIntoChunks(result.samples, state.audioLength);
        addToDataset(chunks, rec);
        setStatus(`Added ${chunks.length} chunks from ${rec.species} #${rec.id}`);
        renderDatasetInfo();
        btn.textContent = `+${chunks.length}`;
      }
    } catch (e) {
      setStatus(`Error: ${e.message} (CORS? Try local files instead)`);
      btn.textContent = 'Err';
      btn.disabled = false;
    }
  }, { once: false });
}

function renderDatasetInfo() {
  const el = $('dataset-info');
  if (!el) return;

  const ds = state.dataset;
  if (!ds || ds.chunks.length === 0) {
    el.innerHTML = '<span class="info">No training data loaded</span>';
    return;
  }

  // Count species
  const species = {};
  ds.meta.forEach(m => {
    const name = m.species || m.file || 'unknown';
    species[name] = (species[name] || 0) + 1;
  });

  const speciesList = Object.entries(species)
    .map(([name, count]) => `<span class="data-tag">${name} (${count})</span>`)
    .join(' ');

  const totalDuration = (ds.chunks.length * state.audioLength / state.sampleRate).toFixed(1);

  el.innerHTML = `
    <div class="data-stats">
      <span>${ds.chunks.length} chunks</span>
      <span>${totalDuration}s total</span>
      <span>${state.audioLength} samples/chunk</span>
    </div>
    <div class="data-species">${speciesList}</div>
  `;

  // Draw a random chunk preview
  if (ds.chunks.length > 0) {
    const idx = Math.floor(Math.random() * ds.chunks.length);
    const canvas = $('canvas-data-preview');
    if (canvas) {
      drawWaveform(canvas, ds.chunks[idx], {
        sampleRate: state.sampleRate,
        title: `Chunk ${idx} / ${ds.chunks.length}`,
      });
    }
  }
}

export function renderDataTab() {
  renderDatasetInfo();
}
