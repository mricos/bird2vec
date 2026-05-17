// CBP (Coilflow Board Protocol) — browser-side writer.
// Spec: ~/src/devops/tetra/docs/specs/CBP_Coilflow_Board_Protocol.md
// Posts to /api/coilboard/* (same-origin via the tetra dashboard host).
//
// Usage (mirrors lib/tbp-node.js):
//   const run = await createRun({ pak: 'bird2vec', label: '…', hparams: { … } });
//   logScalar(run, step, 'gen.rms', 0.18);
//   logEmbedding(run, step, 'z.current', vector, { kind: 'generated' });
//   const file = await logAudio(run, step, 'sample', float32, 16000);
//   logSample(run, step, file, 'z.current', 'generated', { jewel: 4 });
//   await finishRun(run, 'done');
//
// Scalars and embeddings batch in memory and flush every 1s or 50 rows;
// audio + finish are flushed immediately.

const API = '/api/coilboard';
const FLUSH_MS = 1000;
const FLUSH_ROWS = 50;

async function jpost(path, body) {
    const r = await fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
    });
    if (!r.ok) throw new Error(`POST ${path} ${r.status}`);
    return r.json();
}

async function jput(path, body) {
    const r = await fetch(API + path, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
    });
    if (!r.ok) throw new Error(`PUT ${path} ${r.status}`);
    return r.json();
}

export async function isCbpAvailable() {
    try {
        const r = await fetch(`${API}/health`);
        if (!r.ok) return false;
        const j = await r.json();
        return Boolean(j.ok);
    } catch { return false; }
}

export async function createRun({ pak, label = '', hparams = {}, tags = [] }) {
    const meta = await jpost('/runs', { pak, label, hparams, tags });
    return {
        id: meta.id,
        timestamp: meta.timestamp,
        dirName: meta.dirName,
        // batched buffers
        _scalars: [],
        _embeddings: [],
        _samples: [],
        _timer: null,
    };
}

function scheduleFlush(run) {
    if (run._timer) return;
    run._timer = setTimeout(() => flushRun(run), FLUSH_MS);
}

export async function flushRun(run) {
    clearTimeout(run._timer); run._timer = null;
    const tasks = [];
    if (run._scalars.length)    { tasks.push(jpost(`/runs/${run.id}/scalars`,    { rows: run._scalars }));    run._scalars = []; }
    if (run._embeddings.length) { tasks.push(jpost(`/runs/${run.id}/embeddings`, { rows: run._embeddings })); run._embeddings = []; }
    if (run._samples.length)    { tasks.push(jpost(`/runs/${run.id}/samples`,    { rows: run._samples }));    run._samples = []; }
    await Promise.all(tasks).catch(e => console.warn('[cbp flush]', e.message));
}

export function logScalar(run, step, name, value) {
    run._scalars.push({ step, name, value, wall: new Date().toISOString() });
    if (run._scalars.length >= FLUSH_ROWS) flushRun(run); else scheduleFlush(run);
}

export function logEmbedding(run, step, name, vector, labels = {}) {
    const arr = vector instanceof Float32Array || ArrayBuffer.isView(vector) ? Array.from(vector) : vector;
    run._embeddings.push({ step, name, vector: arr, labels });
    if (run._embeddings.length >= FLUSH_ROWS) flushRun(run); else scheduleFlush(run);
}

export function logSample(run, step, audioFile, embeddingName, kind, notes = {}) {
    run._samples.push({ step, audioFile, embeddingName, kind, notes });
    if (run._samples.length >= FLUSH_ROWS) flushRun(run); else scheduleFlush(run);
}

// Audio uploads bypass the batch (one HTTP POST per file). Returns the
// relative path so you can hand it to logSample().
export async function logAudio(run, step, name, samples, sampleRate = 16000) {
    const arr = samples instanceof Float32Array ? Array.from(samples) : samples;
    const r = await jpost(`/runs/${run.id}/audio`, { step, name, samples: arr, sampleRate });
    return r.file;
}

export async function finishRun(run, status = 'done') {
    await flushRun(run);
    await jput(`/runs/${run.id}/status`, { status });
}
