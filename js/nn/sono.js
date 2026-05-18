// Sono — synthetic bird-call generator. Input: a sonogene record (from
// js/sonogene/extract.js). Output: a Float32Array of audio samples.
//
// Sono has nothing to do with WaveGAN's z. It reads the sonogene's
// structured fields (medianF0, harmonics, vibrato, am, adsr, noisiness)
// and resynthesizes audio that fits that parameter signature. Perturb the
// sonogene first to get a *cloud* of variations — that's the path from
// one real bird recording to a WaveGAN training shard.
//
// Perturbation bounds — single source of truth, mirrored in the Sono tab UI:
//   medianF0    ∈ 1000–8000 Hz   (log-jitter)
//   harmonics   ∈ 0–1.0         (per-partial, clamped)
//   vibrato.rate∈ 3–13 Hz
//   vibrato.depth∈ 0–1
//   am.rate     ∈ 3–13 Hz
//   am.depth    ∈ 0–1
//   noisiness   ∈ 0–0.5
//   adsr.attack ∈ 0.010–0.100 s
//   adsr.decay  ∈ 0.100–0.500 s

export const SONO_BOUNDS = Object.freeze({
    f0Hz:        [1000, 8000],
    harmonic:    [0, 1],
    vibratoRate: [3, 13],
    vibratoDepth:[0, 1],
    amRate:      [3, 13],
    amDepth:     [0, 1],
    noisiness:   [0, 0.5],
    attackSec:   [0.010, 0.100],
    decaySec:    [0.100, 0.500],
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const lerp  = (a, b, t) => a + (b - a) * t;

// Standard normal via Box-Muller.
function randn() {
    const u = Math.max(1e-12, Math.random());
    const v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Produce a perturbed copy of a sonogene. `sigma` ∈ [0..1] scales the
 * jitter range from 0 (identity) to full-range (independent samples
 * uniform within each bound).
 *
 * Each field gets noise proportional to sigma × half-range, then clamped
 * to the field's bounds. medianF0 is jittered in log space.
 */
export function perturbSonogene(gene, sigma = 0.3) {
    const s = clamp(sigma, 0, 1);
    const out = JSON.parse(JSON.stringify(gene));

    // medianF0 — log-jitter inside [1000, 8000]
    const f0Lo = SONO_BOUNDS.f0Hz[0], f0Hi = SONO_BOUNDS.f0Hz[1];
    const f0 = clamp(gene.medianF0 || 2000, f0Lo, f0Hi);
    const lf = Math.log(f0) + randn() * s * (Math.log(f0Hi) - Math.log(f0Lo)) * 0.25;
    out.medianF0 = Math.round(clamp(Math.exp(lf), f0Lo, f0Hi));

    // Harmonics — jitter per-partial strength, clamp [0..1]
    if (Array.isArray(out.harmonics)) {
        for (const h of out.harmonics) h.strength = clamp((h.strength || 0) + randn() * s * 0.3, 0, 1);
    }

    // Vibrato + AM — rate (Hz) + depth (0..1)
    if (out.vibrato) {
        out.vibrato.rate  = clamp((gene.vibrato.rate  || 5)   + randn() * s * 5,   ...SONO_BOUNDS.vibratoRate);
        out.vibrato.depth = clamp((gene.vibrato.depth || 0.1) + randn() * s * 0.4, ...SONO_BOUNDS.vibratoDepth);
    }
    if (out.am) {
        out.am.rate  = clamp((gene.am.rate  || 5)   + randn() * s * 5,   ...SONO_BOUNDS.amRate);
        out.am.depth = clamp((gene.am.depth || 0.1) + randn() * s * 0.4, ...SONO_BOUNDS.amDepth);
    }

    // Noisiness
    out.noisiness = clamp((gene.noisiness || 0.05) + randn() * s * 0.2, ...SONO_BOUNDS.noisiness);

    // ADSR
    if (out.adsr) {
        out.adsr.attack = clamp((gene.adsr.attack || 0.03) + randn() * s * 0.04, ...SONO_BOUNDS.attackSec);
        out.adsr.decay  = clamp((gene.adsr.decay  || 0.20) + randn() * s * 0.15, ...SONO_BOUNDS.decaySec);
    }

    out._perturbedFrom = gene._source || null;
    out._sigma = s;
    return out;
}

/**
 * Synthesize audio from a sonogene record.
 *
 * @param {object} gene  sonogene (from extract.js or perturbSonogene)
 * @param {object} opts  { sampleRate, audioLength }
 * @returns {Float32Array} mono samples
 */
export function sonoSynthesize(gene, opts = {}) {
    const sampleRate = opts.sampleRate || 16000;
    const T          = opts.audioLength || 16384;
    const out = new Float32Array(T);

    const f0       = gene.medianF0 || 2000;
    const harmonics = (gene.harmonics && gene.harmonics.length)
        ? gene.harmonics.map(h => ({ ratio: h.ratio, strength: h.strength }))
        : [{ ratio: 1, strength: 1 }];
    const vRate    = (gene.vibrato && gene.vibrato.rate)  || 0;
    const vDepth   = (gene.vibrato && gene.vibrato.depth) || 0;     // 0..1 scaling factor
    const aRate    = (gene.am && gene.am.rate)            || 0;
    const aDepth   = (gene.am && gene.am.depth)           || 0;
    const noisy    = gene.noisiness || 0;
    const attackN  = Math.max(1, Math.floor(((gene.adsr && gene.adsr.attack) || 0.03) * sampleRate));
    const decayN   = Math.max(1, Math.floor(((gene.adsr && gene.adsr.decay)  || 0.20) * sampleRate));

    // Envelope — attack ramp up, decay ramp down, then silence.
    const env = new Float32Array(T);
    for (let i = 0; i < T; i++) {
        if (i < attackN)               env[i] = i / attackN;
        else if (i < attackN + decayN) env[i] = 1 - (i - attackN) / decayN;
        else                            env[i] = 0;
    }

    // FM depth in Hz scales with vibrato.depth — convention: depth=1 → ±200 Hz (matches earlier table)
    const fmDepthHz = vDepth * 200;
    // AM depth 0..1 — convention: full depth = pure tremolo
    const amDepth   = aDepth;

    let carrier = 0;
    const fm  = 2 * Math.PI * vRate / sampleRate;
    const am  = 2 * Math.PI * aRate / sampleRate;

    for (let i = 0; i < T; i++) {
        const fmSig = Math.sin(fm * i);
        const amSig = 1 - amDepth + amDepth * (0.5 + 0.5 * Math.sin(am * i));
        const fInst = f0 + fmDepthHz * fmSig;
        carrier += 2 * Math.PI * fInst / sampleRate;
        // Sum partial bank, skipping above Nyquist
        let s = 0;
        for (const h of harmonics) {
            const f = fInst * h.ratio;
            if (f > sampleRate * 0.5) break;
            s += h.strength * Math.sin(carrier * h.ratio);
        }
        // Mix noise
        if (noisy > 0) s += noisy * (Math.random() * 2 - 1);
        out[i] = env[i] * amSig * s;
    }

    // Peak-normalize to ~0.95 so every variation lands at consistent loudness.
    let peak = 0;
    for (let i = 0; i < T; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
    if (peak > 1e-6) { const g = 0.95 / peak; for (let i = 0; i < T; i++) out[i] *= g; }

    return out;
}

// Convenience: produce N variations from one sonogene.
export function batchVariations(gene, n, sigma, opts) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const g = perturbSonogene(gene, sigma);
        out.push({ gene: g, audio: sonoSynthesize(g, opts) });
    }
    return out;
}
