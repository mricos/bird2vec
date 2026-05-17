// Wires bird2vec → CBP. Every iframe session becomes a "run":
//   - on init: createRun({ pak: 'bird2vec', label: '<gen-mode> session', hparams: { latent_dim, audio_length, sample_rate } })
//   - on 'generate' (after audio is on state): step++, logEmbedding(z, kind='generated') + logAudio + logSample + logScalar(rms,peak,centroid)
//   - on beforeunload / explicit stop: finishRun
//
// If /api/coilboard isn't available the wiring is a no-op (standalone-dev mode).

import { on } from '../core/events.js';
import state from '../core/state.js';
import { isCbpAvailable, createRun, logScalar, logEmbedding, logAudio, logSample, finishRun, flushRun } from './cbp-client.js';

let run = null;
let step = 0;
let unloadBound = false;

function audioStats(samples) {
    let sumSq = 0, peak = 0;
    for (let i = 0; i < samples.length; i++) {
        const a = Math.abs(samples[i]);
        if (a > peak) peak = a;
        sumSq += samples[i] * samples[i];
    }
    return { rms: Math.sqrt(sumSq / samples.length), peak };
}

// Cheap spectral centroid via Goertzel-style band energies.
function spectralCentroid(samples, sampleRate) {
    const N = Math.min(samples.length, 4096);
    const bands = [250, 500, 1000, 2000, 4000, 8000];
    let num = 0, den = 0;
    for (const f of bands) {
        let re = 0, im = 0;
        for (let n = 0; n < N; n++) {
            const t = 2 * Math.PI * f * n / sampleRate;
            re += samples[n] * Math.cos(t);
            im += samples[n] * Math.sin(t);
        }
        const e = re * re + im * im;
        num += f * e;
        den += e;
    }
    return den > 0 ? num / den : 0;
}

async function onGenerated() {
    if (!run || !state.generatedAudio) return;
    step += 1;
    const z = state.latentVector;
    const audio = state.generatedAudio;
    const { rms, peak } = audioStats(audio);
    const centroid = spectralCentroid(audio, state.sampleRate);

    const t = new Date().toISOString();
    logScalar(run, step, 'gen.rms',      Number(rms.toFixed(6)));
    logScalar(run, step, 'gen.peak',     Number(peak.toFixed(6)));
    logScalar(run, step, 'gen.centroid', Math.round(centroid));

    const embName = `z.step_${step}`;
    const genMode = (document.getElementById('gen-mode') || {}).value || 'unknown';
    const labels = {
        kind: 'generated',
        gen_mode: genMode,
        jewel: state.currentJewel ?? null,
    };
    logEmbedding(run, step, embName, z, labels);

    try {
        const file = await logAudio(run, step, `sample`, audio, state.sampleRate);
        logSample(run, step, file, embName, 'generated', { gen_mode: genMode });
    } catch (e) {
        // Audio upload may be 20mb-ish for 2-sec clips; tolerate failure.
        console.warn('[cbp] audio upload failed:', e.message);
    }
}

export async function startSession() {
    if (run) return run;
    const available = await isCbpAvailable();
    if (!available) {
        console.info('[cbp] /api/coilboard unavailable — wiring disabled (standalone mode)');
        return null;
    }
    const genMode = (document.getElementById('gen-mode') || {}).value || 'harmonic';
    run = await createRun({
        pak: 'bird2vec',
        label: `${genMode} session`,
        hparams: {
            latent_dim:   state.latentDim,
            audio_length: state.audioLength,
            sample_rate:  state.sampleRate,
        },
        tags: ['session', genMode],
    });
    step = 0;
    console.info(`[cbp] session run ${run.id} — see Coilboard`);

    on('audio:generated', onGenerated);
    // Fallback if main.js doesn't emit audio:generated yet — listen to state changes
    on('state:generatedAudio', onGenerated);

    if (!unloadBound) {
        window.addEventListener('beforeunload', () => {
            // best-effort sync flush via sendBeacon
            try {
                navigator.sendBeacon(
                    `/api/coilboard/runs/${run.id}/status`,
                    new Blob([JSON.stringify({ status: 'done' })], { type: 'application/json' })
                );
            } catch {}
        });
        unloadBound = true;
    }
    return run;
}

export async function endSession(status = 'done') {
    if (!run) return;
    await finishRun(run, status);
    run = null;
}

// Helper exposed for the UI: log a chunk of synthetic training scalars
// so users can see the Coilboard charts populate with no real trainer wired.
export async function syntheticTrain(steps = 200) {
    if (!run) await startSession();
    if (!run) return;
    const base = step;
    for (let s = 1; s <= steps; s++) {
        const st = base + s;
        logScalar(run, st, 'train.g_loss', 3.0 * Math.exp(-s/40) + 0.2 + 0.05 * Math.random());
        logScalar(run, st, 'train.d_loss', 0.5 * Math.exp(-s/60) + 0.1 + 0.03 * Math.random());
        if (s % 5 === 0) await new Promise(r => setTimeout(r, 16));
    }
    step = base + steps;
    await flushRun(run);
}

export function getRun() { return run; }
