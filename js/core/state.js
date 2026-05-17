// Global state — single source of truth
import { emit } from './events.js';

const state = {
  // Latent space
  latentDim: 100,
  latentVector: new Float32Array(100),
  latentHistory: [],

  // Audio
  sampleRate: 16000,
  audioLength: 16384,  // ~1 second at 16kHz
  generatedAudio: null,
  spectrogramData: null,
  isPlaying: false,

  // Generator network (simplified WaveGAN)
  generator: null,
  modelLoaded: false,

  // Training metrics (for display)
  metrics: {
    genLoss: [],
    discLoss: [],
    epoch: 0,
  },

  // Jewels — basis vectors for latent space exploration
  jewels: [],
  currentJewel: 0,

  // Interpolation
  interpA: null,
  interpB: null,
  interpT: 0,

  // Dataset
  dataset: null,
  datasetSize: 0,

  // UI
  activeTab: 'generate',
  sidebarWidth: 240,
};

export function get(key) {
  return key ? state[key] : state;
}

export function set(key, value) {
  state[key] = value;
  emit('state:change', { key, value });
  emit(`state:${key}`, value);
}

export function update(patch) {
  Object.assign(state, patch);
  emit('state:change', patch);
}

export default state;
