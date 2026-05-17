// Training data fetcher — xeno-canto bird recordings + local files + synthetic
import { emit } from '../core/events.js';
import state, { set } from '../core/state.js';

const XC_API = 'https://xeno-canto.org/api/3/recordings';

let xcKey = null;

// Set xeno-canto API key (required for v3)
export function setXcKey(key) { xcKey = key; }
export function getXcKey() { return xcKey; }

// Fetch bird recordings metadata from xeno-canto v3
// Query must use tag syntax: en:"common blackbird", gen:turdus sp:merula, etc.
export async function searchXenoCanto(query = 'en:"common blackbird"', opts = {}) {
  if (!xcKey) throw new Error('xeno-canto API key required. Set it in the Data tab.');
  const page = opts.page || 1;
  const perPage = opts.perPage || 20;
  const url = `${XC_API}?query=${encodeURIComponent(query)}&key=${encodeURIComponent(xcKey)}&page=${page}&per_page=${perPage}`;

  emit('data:status', { msg: `Searching xeno-canto: ${query}...` });

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`xeno-canto API: ${resp.status}`);

  const json = await resp.json();
  if (json.error) throw new Error(`xeno-canto: ${json.error.message || JSON.stringify(json.error)}`);

  const recordings = (json.recordings || []).map(r => ({
    id: r.id,
    species: r.en,
    sciName: `${r.gen} ${r.sp}`,
    country: r.cnt,
    location: r.loc,
    duration: r.length,
    quality: r.q,
    type: r.type,
    url: r.file?.startsWith('//') ? 'https:' + r.file : r.file,
    sono: r.sono?.small,
    license: r.lic,
    recordist: r.rec,
  }));

  emit('data:status', {
    msg: `Found ${json.numRecordings} recordings (showing ${recordings.length})`,
  });

  return {
    total: parseInt(json.numRecordings),
    page: parseInt(json.page),
    numPages: parseInt(json.numPages),
    recordings,
  };
}

// Download and decode a single recording to Float32Array
export async function fetchRecording(recording) {
  emit('data:status', { msg: `Downloading: ${recording.species} #${recording.id}...` });

  const resp = await fetch(recording.url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);

  const arrayBuf = await resp.arrayBuffer();
  const audioCtx = new AudioContext({ sampleRate: state.sampleRate });
  const decoded = await audioCtx.decodeAudioData(arrayBuf);
  audioCtx.close();

  // Extract mono channel
  const samples = decoded.getChannelData(0);

  emit('data:status', {
    msg: `Decoded: ${samples.length} samples (${(samples.length / decoded.sampleRate).toFixed(1)}s @ ${decoded.sampleRate}Hz)`,
  });

  return {
    samples: new Float32Array(samples),
    sampleRate: decoded.sampleRate,
    duration: decoded.duration,
    meta: recording,
  };
}

// Slice a long recording into fixed-length training chunks
export function sliceIntoChunks(samples, chunkLen, overlap = 0.5) {
  const hop = Math.floor(chunkLen * (1 - overlap));
  const chunks = [];

  for (let offset = 0; offset + chunkLen <= samples.length; offset += hop) {
    const chunk = new Float32Array(chunkLen);
    chunk.set(samples.subarray(offset, offset + chunkLen));

    // Normalize chunk
    let maxAbs = 0;
    for (let i = 0; i < chunkLen; i++) maxAbs = Math.max(maxAbs, Math.abs(chunk[i]));
    if (maxAbs > 0.01) {
      const scale = 0.95 / maxAbs;
      for (let i = 0; i < chunkLen; i++) chunk[i] *= scale;
    }

    chunks.push(chunk);
  }

  return chunks;
}

// Load local audio file (WAV, MP3, OGG, FLAC) via file input
export async function loadLocalFile(file) {
  emit('data:status', { msg: `Loading: ${file.name} (${(file.size / 1024).toFixed(0)} KB)...` });

  const arrayBuf = await file.arrayBuffer();
  const audioCtx = new AudioContext({ sampleRate: state.sampleRate });
  const decoded = await audioCtx.decodeAudioData(arrayBuf);
  audioCtx.close();

  const samples = new Float32Array(decoded.getChannelData(0));

  emit('data:status', {
    msg: `Loaded: ${file.name} — ${samples.length} samples (${decoded.duration.toFixed(1)}s)`,
  });

  return {
    samples,
    sampleRate: decoded.sampleRate,
    duration: decoded.duration,
    meta: { id: file.name, species: 'local', file: file.name },
  };
}

// Load multiple local files
export async function loadLocalFiles(fileList) {
  const results = [];
  for (const file of fileList) {
    const result = await loadLocalFile(file);
    results.push(result);
  }
  return results;
}

// Generate synthetic bird-like training data
export function generateSyntheticDataset(numSamples = 50, chunkLen = 16384, sampleRate = 16000) {
  emit('data:status', { msg: `Generating ${numSamples} synthetic bird samples...` });

  const chunks = [];
  for (let s = 0; s < numSamples; s++) {
    const chunk = new Float32Array(chunkLen);

    // Random bird-like parameters
    const numCalls = 1 + Math.floor(Math.random() * 4);

    for (let c = 0; c < numCalls; c++) {
      const startTime = Math.random() * 0.6;
      const callDur = 0.05 + Math.random() * 0.3;
      const freq0 = 1500 + Math.random() * 5000;
      const freq1 = freq0 + (Math.random() - 0.5) * 3000; // frequency sweep
      const amp = 0.3 + Math.random() * 0.7;
      const harmonics = 1 + Math.floor(Math.random() * 4);

      const startSample = Math.floor(startTime * sampleRate);
      const callSamples = Math.floor(callDur * sampleRate);

      for (let i = 0; i < callSamples && (startSample + i) < chunkLen; i++) {
        const t = i / sampleRate;
        const env = Math.sin(Math.PI * i / callSamples); // smooth envelope
        const freqT = freq0 + (freq1 - freq0) * (i / callSamples); // sweep

        let val = 0;
        for (let h = 1; h <= harmonics; h++) {
          val += (1 / h) * Math.sin(2 * Math.PI * freqT * h * t);
        }

        // AM modulation (trills)
        const trillRate = 10 + Math.random() * 40;
        const am = 0.7 + 0.3 * Math.sin(2 * Math.PI * trillRate * t);

        chunk[startSample + i] += amp * env * am * val;
      }
    }

    // Light noise floor
    for (let i = 0; i < chunkLen; i++) {
      chunk[i] += (Math.random() - 0.5) * 0.02;
    }

    // Normalize
    let maxAbs = 0;
    for (let i = 0; i < chunkLen; i++) maxAbs = Math.max(maxAbs, Math.abs(chunk[i]));
    if (maxAbs > 0) {
      const scale = 0.95 / maxAbs;
      for (let i = 0; i < chunkLen; i++) chunk[i] *= scale;
    }

    chunks.push(chunk);
  }

  emit('data:status', { msg: `Generated ${chunks.length} synthetic chunks (${chunkLen} samples each)` });
  return chunks;
}

// Add chunks to the training dataset in state
export function addToDataset(chunks, meta = {}) {
  if (!state.dataset) {
    state.dataset = { chunks: [], meta: [] };
  }
  for (const chunk of chunks) {
    state.dataset.chunks.push(chunk);
    state.dataset.meta.push(meta);
  }
  set('datasetSize', state.dataset.chunks.length);
  emit('data:updated', { size: state.dataset.chunks.length });
}

// Clear dataset
export function clearDataset() {
  state.dataset = { chunks: [], meta: [] };
  set('datasetSize', 0);
  emit('data:updated', { size: 0 });
  emit('data:status', { msg: 'Dataset cleared' });
}

// Get a random training batch
export function sampleBatch(batchSize = 16) {
  if (!state.dataset || state.dataset.chunks.length === 0) return null;
  const batch = [];
  for (let i = 0; i < batchSize; i++) {
    const idx = Math.floor(Math.random() * state.dataset.chunks.length);
    batch.push(state.dataset.chunks[idx]);
  }
  return batch;
}
