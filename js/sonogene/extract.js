// Sonogene — "DNA of the sound."
// Extracts a structured parameter record from one audio buffer.
// Output: a JSON-serializable object that fully describes the sound's
// timbral, temporal, pitch, and noise character — enough to seed a
// synthesizer (Sono pak, later) or fingerprint a recording.
//
// Spec sketch (sonogene v0.1):
//   {
//     meta: { sampleRate, duration, frameMs, hopMs, nFrames },
//     energy:    [...]                  // RMS per frame
//     zcr:       [...]                  // zero-crossing rate per frame
//     centroid:  [...]                  // spectral centroid (Hz) per frame
//     pitch:     [...]                  // f0 (Hz) per frame; 0 = unvoiced
//     spectrum:  [{ band, energy }]     // averaged log-spaced bands (12 bands)
//     harmonics: [{ ratio, strength }]  // first 6 harmonic ratios + strengths
//     adsr:      { attack, decay, sustain, release }   // global envelope (sec)
//     syllables: [{ start, end, energy }]              // onset-based segmentation
//     vibrato:   { rate, depth }        // FM modulation on pitch contour
//     am:        { rate, depth }        // AM modulation on energy envelope
//     noisiness: number                 // 0..1, higher = more aperiodic
//   }
//
// All computations are pure JS, no Web Audio dependencies — works on a
// Float32Array of mono samples plus a sample rate.

const FRAME_MS = 25;
const HOP_MS   = 10;

function frameify(samples, sampleRate) {
    const frameLen = Math.round(sampleRate * FRAME_MS / 1000);
    const hopLen   = Math.round(sampleRate * HOP_MS / 1000);
    const n = Math.max(0, Math.floor((samples.length - frameLen) / hopLen) + 1);
    return { frameLen, hopLen, nFrames: n };
}

function rms(buf, off, len) {
    let s = 0;
    for (let i = 0; i < len; i++) { const v = buf[off + i]; s += v * v; }
    return Math.sqrt(s / len);
}

function zcrFrame(buf, off, len) {
    let z = 0;
    for (let i = 1; i < len; i++) if ((buf[off + i] >= 0) !== (buf[off + i - 1] >= 0)) z++;
    return z / len;
}

// Autocorrelation-based pitch (YIN-lite). Returns Hz or 0 if unvoiced.
function pitchFrame(buf, off, len, sampleRate) {
    const minLag = Math.floor(sampleRate / 2000); // 2 kHz max
    const maxLag = Math.floor(sampleRate / 60);   // 60 Hz min
    const top = Math.min(maxLag, len - 1);
    let best = 0, bestVal = 0;
    let energy = 0;
    for (let i = 0; i < len; i++) energy += buf[off + i] * buf[off + i];
    if (energy < 1e-6) return 0;
    for (let lag = minLag; lag <= top; lag++) {
        let s = 0;
        for (let i = 0; i < len - lag; i++) s += buf[off + i] * buf[off + i + lag];
        s /= (len - lag);
        if (s > bestVal) { bestVal = s; best = lag; }
    }
    // Voiced if autocorr peak > 30% of energy
    if (bestVal / (energy / len) < 0.3) return 0;
    return best > 0 ? sampleRate / best : 0;
}

// Goertzel-like band energies at log-spaced frequencies (12 bands, 60 Hz..8 kHz).
function bandEnergies(buf, off, len, sampleRate) {
    const bands = [60, 90, 140, 220, 350, 550, 880, 1400, 2200, 3500, 5500, 8000];
    const out = new Array(bands.length).fill(0);
    for (let bi = 0; bi < bands.length; bi++) {
        const f = bands[bi];
        let re = 0, im = 0;
        for (let n = 0; n < len; n++) {
            const t = 2 * Math.PI * f * n / sampleRate;
            re += buf[off + n] * Math.cos(t);
            im += buf[off + n] * Math.sin(t);
        }
        out[bi] = (re * re + im * im) / len;
    }
    return { bands, energies: out };
}

function spectralCentroid(bands, energies) {
    let num = 0, den = 0;
    for (let i = 0; i < bands.length; i++) { num += bands[i] * energies[i]; den += energies[i]; }
    return den > 0 ? num / den : 0;
}

function avgVec(rows) {
    if (!rows.length) return [];
    const d = rows[0].length;
    const out = new Array(d).fill(0);
    for (const r of rows) for (let i = 0; i < d; i++) out[i] += r[i];
    for (let i = 0; i < d; i++) out[i] /= rows.length;
    return out;
}

// Estimate harmonics from averaged band energies + median pitch.
function harmonicsFromBands(bands, energies, f0) {
    const out = [];
    if (!f0) return out;
    for (let k = 1; k <= 6; k++) {
        const target = f0 * k;
        // pick nearest band
        let bi = 0, bd = Infinity;
        for (let i = 0; i < bands.length; i++) {
            const d = Math.abs(bands[i] - target);
            if (d < bd) { bd = d; bi = i; }
        }
        out.push({ ratio: k, strength: energies[bi] });
    }
    // normalize
    const m = Math.max(...out.map(h => h.strength)) || 1;
    for (const h of out) h.strength = +(h.strength / m).toFixed(4);
    return out;
}

// Estimate global ADSR from energy envelope.
function adsrFromEnergy(energy, hopSec) {
    if (energy.length < 4) return { attack: 0, decay: 0, sustain: 0, release: 0 };
    const peak = Math.max(...energy);
    if (peak < 1e-6) return { attack: 0, decay: 0, sustain: 0, release: 0 };
    const attackEnd = energy.findIndex(e => e >= 0.9 * peak);
    let decayEnd = attackEnd;
    for (let i = attackEnd; i < energy.length; i++) {
        if (energy[i] < 0.7 * peak) { decayEnd = i; break; }
        decayEnd = i;
    }
    let releaseStart = energy.length - 1;
    for (let i = energy.length - 1; i >= 0; i--) {
        if (energy[i] >= 0.3 * peak) { releaseStart = i; break; }
    }
    const sustainLevel = energy.slice(decayEnd, releaseStart).reduce((a,b)=>a+b, 0) / Math.max(1, releaseStart - decayEnd);
    return {
        attack:  +(attackEnd * hopSec).toFixed(3),
        decay:   +((decayEnd - attackEnd) * hopSec).toFixed(3),
        sustain: +(sustainLevel / peak).toFixed(3),
        release: +((energy.length - 1 - releaseStart) * hopSec).toFixed(3),
    };
}

// Onset-based syllable segmentation: spikes in dE/dt above threshold.
function syllablesFromEnergy(energy, hopSec) {
    const N = energy.length;
    if (N < 3) return [];
    const max = Math.max(...energy);
    if (max < 1e-6) return [];
    const norm = energy.map(e => e / max);
    const onsets = [];
    const thresh = 0.15;
    let inSyl = false, start = 0;
    for (let i = 1; i < N; i++) {
        if (!inSyl && norm[i] > thresh) { inSyl = true; start = i; }
        else if (inSyl && norm[i] < thresh * 0.5) { inSyl = false; onsets.push({ start, end: i }); }
    }
    if (inSyl) onsets.push({ start, end: N - 1 });
    return onsets.map(o => ({
        start: +(o.start * hopSec).toFixed(3),
        end:   +(o.end   * hopSec).toFixed(3),
        energy: +(Math.max(...energy.slice(o.start, o.end + 1)) / max).toFixed(3),
    }));
}

// Modulation rate via autocorrelation peak of a signal.
function modulationRate(signal, hopSec) {
    if (signal.length < 8) return { rate: 0, depth: 0 };
    const m = signal.reduce((a,b)=>a+b,0) / signal.length;
    const c = signal.map(x => x - m);
    const minLag = 2, maxLag = Math.min(60, c.length - 1);   // up to 600 ms / ~1.7 Hz
    let bestLag = 0, bestVal = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
        let s = 0; for (let i = 0; i < c.length - lag; i++) s += c[i] * c[i + lag];
        if (s > bestVal) { bestVal = s; bestLag = lag; }
    }
    const energy = c.reduce((a,b)=>a + b*b, 0) || 1;
    const rate = bestLag > 0 ? 1 / (bestLag * hopSec) : 0;
    const depth = Math.min(1, bestVal / energy);
    return { rate: +rate.toFixed(2), depth: +depth.toFixed(3) };
}

/**
 * Extract a sonogene from a mono Float32Array audio buffer.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {object}  the sonogene record
 */
export function extractSonogene(samples, sampleRate) {
    const { frameLen, hopLen, nFrames } = frameify(samples, sampleRate);
    const energy = [], zcr = [], pitch = [], centroid = [];
    const bandRows = [];
    let lastBands = null;
    for (let i = 0; i < nFrames; i++) {
        const off = i * hopLen;
        energy.push(rms(samples, off, frameLen));
        zcr.push(zcrFrame(samples, off, frameLen));
        pitch.push(pitchFrame(samples, off, frameLen, sampleRate));
        const { bands, energies } = bandEnergies(samples, off, frameLen, sampleRate);
        centroid.push(spectralCentroid(bands, energies));
        bandRows.push(energies);
        lastBands = bands;
    }
    const avgEnergies = avgVec(bandRows);
    const voicedPitches = pitch.filter(p => p > 0);
    const medianF0 = voicedPitches.length ? voicedPitches.sort((a,b)=>a-b)[Math.floor(voicedPitches.length/2)] : 0;
    const harmonics = harmonicsFromBands(lastBands || [], avgEnergies, medianF0);

    const hopSec = HOP_MS / 1000;
    const adsr = adsrFromEnergy(energy, hopSec);
    const syllables = syllablesFromEnergy(energy, hopSec);
    const vibrato = modulationRate(pitch.filter(p => p > 0), hopSec);
    const am      = modulationRate(energy, hopSec);
    const voicedRatio = voicedPitches.length / Math.max(1, nFrames);
    const noisiness = +(1 - voicedRatio).toFixed(3);

    return {
        meta: {
            sampleRate,
            duration: +(samples.length / sampleRate).toFixed(3),
            frameMs: FRAME_MS,
            hopMs: HOP_MS,
            nFrames,
        },
        energy:   energy.map(v => +v.toFixed(4)),
        zcr:      zcr.map(v => +v.toFixed(4)),
        centroid: centroid.map(v => Math.round(v)),
        pitch:    pitch.map(v => Math.round(v)),
        spectrum: (lastBands || []).map((b, i) => ({ band: b, energy: +avgEnergies[i].toFixed(6) })),
        harmonics,
        medianF0: Math.round(medianF0),
        adsr,
        syllables,
        vibrato,
        am,
        noisiness,
    };
}

/**
 * Reduce a sonogene to a fixed-length numeric vector — useful as a
 * fingerprint or as a search key.
 * Length: 12 (spectrum) + 6 (harmonics) + 4 (ADSR) + 4 (mod, noisiness, f0, syllable count) = 26.
 */
export function sonogeneVector(gene) {
    const v = [];
    for (const s of gene.spectrum) v.push(Math.log1p(s.energy));
    while (v.length < 12) v.push(0);
    for (const h of gene.harmonics) v.push(h.strength);
    while (v.length < 18) v.push(0);
    v.push(gene.adsr.attack, gene.adsr.decay, gene.adsr.sustain, gene.adsr.release);
    v.push(gene.vibrato.rate, gene.am.rate, gene.noisiness, gene.medianF0 / 1000);
    return v;
}
