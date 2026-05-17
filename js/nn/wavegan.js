// Simplified WaveGAN generator in pure JS
// Mirrors the real WaveGAN architecture: z(100) → dense → upsample convolutions → audio
// This is a lightweight inference-only version that generates plausible audio from latent vectors

import { clamp } from '../core/utils.js';

// 1D transposed convolution (upsample by stride)
function convTranspose1d(input, kernel, stride, bias) {
  const outLen = input.length * stride;
  const out = new Float32Array(outLen);
  const kLen = kernel.length;
  const half = (kLen - 1) >> 1;

  for (let i = 0; i < input.length; i++) {
    const center = i * stride;
    for (let k = 0; k < kLen; k++) {
      const j = center + k - half;
      if (j >= 0 && j < outLen) {
        out[j] += input[i] * kernel[k];
      }
    }
  }
  if (bias) for (let i = 0; i < outLen; i++) out[i] += bias;
  return out;
}

// ReLU activation
function relu(arr) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < 0) arr[i] = 0;
  }
  return arr;
}

// Tanh activation
function tanh(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = Math.tanh(arr[i]);
  }
  return arr;
}

// Pseudo-random seeded by latent vector for deterministic generation
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Initialize a kernel from latent-derived seed
function initKernel(size, seed, scale = 0.1) {
  const rng = seededRandom(seed);
  const k = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    k[i] = (rng() * 2 - 1) * scale;
  }
  return k;
}

/**
 * Simplified WaveGAN Generator
 * Architecture: z(100) → dense(256) → 5x upsample conv → audio(16384)
 * Uses deterministic pseudo-random weights seeded from a master seed
 * so the "model" is reproducible without storing weights
 */
export class WaveGANGenerator {
  constructor(opts = {}) {
    this.latentDim = opts.latentDim || 100;
    this.audioLength = opts.audioLength || 16384;
    this.seed = opts.seed || 42;
    this.layers = this._buildLayers();
  }

  _buildLayers() {
    const rng = seededRandom(this.seed);
    const nextSeed = () => Math.floor(rng() * 2147483647);

    // Dense projection: 100 → 256
    const denseW = [];
    for (let i = 0; i < this.latentDim; i++) {
      denseW.push(initKernel(256, nextSeed(), 0.05));
    }

    // Upsample convolutions: 256 → 512 → 1024 → 2048 → 8192 → 16384
    // Each layer: conv kernel + stride
    return {
      denseW,
      convs: [
        { kernel: initKernel(25, nextSeed(), 0.15), stride: 2 },
        { kernel: initKernel(25, nextSeed(), 0.15), stride: 2 },
        { kernel: initKernel(25, nextSeed(), 0.12), stride: 2 },
        { kernel: initKernel(25, nextSeed(), 0.10), stride: 4 },
        { kernel: initKernel(25, nextSeed(), 0.08), stride: 4 },
      ],
    };
  }

  generate(z) {
    // Dense projection
    let x = new Float32Array(256);
    for (let i = 0; i < this.latentDim; i++) {
      const w = this.layers.denseW[i];
      const zi = z[i];
      for (let j = 0; j < 256; j++) {
        x[j] += zi * w[j];
      }
    }
    x = relu(x);

    // Upsample convolutions with ReLU (except last = tanh)
    for (let l = 0; l < this.layers.convs.length; l++) {
      const { kernel, stride } = this.layers.convs[l];
      x = convTranspose1d(x, kernel, stride, 0);
      if (l < this.layers.convs.length - 1) {
        x = relu(x);
      } else {
        x = tanh(x);
      }
    }

    // Trim or pad to target length
    if (x.length > this.audioLength) {
      x = x.slice(0, this.audioLength);
    } else if (x.length < this.audioLength) {
      const padded = new Float32Array(this.audioLength);
      padded.set(x);
      x = padded;
    }

    return x;
  }
}

/**
 * Harmonic generator — more musically interesting fallback
 * Maps latent dimensions to harmonic parameters
 */
export class HarmonicGenerator {
  constructor(opts = {}) {
    this.latentDim = opts.latentDim || 100;
    this.audioLength = opts.audioLength || 16384;
    this.sampleRate = opts.sampleRate || 16000;
  }

  generate(z) {
    const out = new Float32Array(this.audioLength);
    const sr = this.sampleRate;
    const N = this.audioLength;

    // Map latent dims to harmonics
    // dims 0-9: fundamental frequencies (mapped to bird-like range 1000-8000 Hz)
    // dims 10-29: harmonic amplitudes
    // dims 30-49: frequency modulation depths
    // dims 50-69: amplitude envelopes
    // dims 70-89: noise characteristics
    // dims 90-99: global parameters (attack, decay, vibrato)

    const numPartials = 10;
    for (let p = 0; p < numPartials; p++) {
      const baseFreq = 1000 + (z[p] + 1) * 3500; // 1000-8000 Hz
      const amp = Math.max(0, (z[10 + p] + 1) * 0.15);
      const fmDepth = z[30 + p] * 200;
      const fmRate = 3 + z[50 + p] * 10;
      const attack = 0.01 + (z[90] + 1) * 0.05;
      const decay = 0.1 + (z[91] + 1) * 0.4;

      for (let i = 0; i < N; i++) {
        const t = i / sr;
        const env = Math.min(t / attack, 1) * Math.exp(-t / decay);
        const fm = fmDepth * Math.sin(2 * Math.PI * fmRate * t);
        out[i] += amp * env * Math.sin(2 * Math.PI * (baseFreq + fm) * t);
      }
    }

    // Add noise bursts (bird-like)
    const noiseAmp = Math.max(0, (z[70] + 1) * 0.1);
    const noiseDecay = 0.05 + (z[71] + 1) * 0.1;
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      out[i] += noiseAmp * Math.exp(-t / noiseDecay) * (Math.random() * 2 - 1);
    }

    // Normalize
    let maxAbs = 0;
    for (let i = 0; i < N; i++) maxAbs = Math.max(maxAbs, Math.abs(out[i]));
    if (maxAbs > 0) {
      const scale = 0.95 / maxAbs;
      for (let i = 0; i < N; i++) out[i] *= scale;
    }

    return out;
  }
}
