// bird2vec — TensorBoard-lite interface
// Main application entry point
import { on, emit } from './core/events.js';
import state, { set } from './core/state.js';
import { $, fillRandom, lerp } from './core/utils.js';
import { HarmonicGenerator, WaveGANGenerator } from './nn/wavegan.js';
import { playAudio, stopAudio, computeSpectrogram, downloadWav } from './audio/audio.js';
import { drawWaveform } from './plot/plot-waveform.js';
import { drawSpectrogram } from './plot/plot-spectrogram.js';
import { drawLatentBars, drawLatentScatter, drawInterpPath } from './plot/plot-latent.js';
import { drawLossCurves, drawLatentHistogram } from './plot/plot-metrics.js';
import { initSidebar, buildDimSliders } from './ui/sidebar.js';
import { initTabs } from './ui/tabs.js';
import { initDataPanel, renderDataTab } from './ui/data-panel.js';
import { initWikiPanel } from './ui/wiki-panel.js';
import { startSession, syntheticTrain, getRun } from './cbp/wiring.js';
import { mountSonogeneTab } from './sonogene/panel.js';
import { togglePanel, restoreIfOpen } from './cbp/mini-panel.js';

// Generators
let harmonicGen, waveganGen;

function init() {
  // Initialize generators
  harmonicGen = new HarmonicGenerator({
    latentDim: state.latentDim,
    audioLength: state.audioLength,
    sampleRate: state.sampleRate,
  });
  waveganGen = new WaveGANGenerator({
    latentDim: state.latentDim,
    audioLength: state.audioLength,
  });

  // Initialize jewel basis vectors (from bird2vec_generate.ipynb)
  initJewels();

  // Build UI
  initSidebar();
  initTabs();
  initDataPanel();
  initWikiPanel();
  buildDimSliders($('dim-sliders'), 20);

  // Wire up events
  on('generate', generate);
  on('latent:changed', onLatentChanged);
  on('audio:play', () => state.generatedAudio && playAudio(state.generatedAudio, state.sampleRate));
  on('audio:stop', stopAudio);
  on('audio:download', () => state.generatedAudio && downloadWav(state.generatedAudio, state.sampleRate));
  on('interp:changed', onInterpChanged);
  on('tab:changed', renderActiveTab);
  on('resize', renderActiveTab);

  // Start with random latent vector and generate
  fillRandom(state.latentVector, -1, 1);
  emit('latent:changed');
  generate();

  // Resize handler
  window.addEventListener('resize', () => emit('resize'));

  updateStats();

  // CBP: start a session run (fire-and-forget; tolerates absent /api/coilboard)
  startSession().catch(e => console.warn('[cbp] session start failed:', e.message));

  // Wire the Synthetic Train demo button if present (Metrics tab).
  document.getElementById('btn-synthetic-train')?.addEventListener('click', () => syntheticTrain(200));
  document.getElementById('btn-open-coilboard')?.addEventListener('click', () => {
    window.open('/coilboard/iframes/coilboard.iframe.html', '_blank');
  });
  document.getElementById('btn-mini-coilboard')?.addEventListener('click', () => {
    const run = getRun();
    togglePanel(run ? run.id : null);
  });

  // Restore the floating mini-Coilboard if user had it open last session.
  restoreIfOpen(() => getRun()?.id);
}

function initJewels() {
  const dim = state.latentDim;
  const jewels = [];

  // Jewel 0: all zeros
  jewels.push(new Float32Array(dim));

  // Jewel 1: dim 0 = 1
  const j1 = new Float32Array(dim); j1[0] = 1.0;
  jewels.push(j1);

  // Jewel 2: dim 50 = 1
  const j2 = new Float32Array(dim); j2[50] = 1.0;
  jewels.push(j2);

  // Jewel 3: dim 99 = 0.99
  const j3 = new Float32Array(dim); j3[99] = 0.99;
  jewels.push(j3);

  // Jewel 4: all 0.5
  const j4 = new Float32Array(dim); j4.fill(0.5);
  jewels.push(j4);

  // Jewel 5: all -0.5
  const j5 = new Float32Array(dim); j5.fill(-0.5);
  jewels.push(j5);

  // Jewel 6: random in small range
  const j6 = new Float32Array(dim);
  fillRandom(j6, -0.25, 0.25);
  jewels.push(j6);

  // Jewel 7: chirp pattern (ascending dims)
  const j7 = new Float32Array(dim);
  for (let i = 0; i < dim; i++) j7[i] = Math.sin(i * 0.2) * (i / dim);
  jewels.push(j7);

  state.jewels = jewels;
  set('interpA', jewels[1].slice());
  set('interpB', jewels[4].slice());
}

function getGenerator() {
  const mode = state.genMode || 'harmonic';
  return mode === 'wavegan' ? waveganGen : harmonicGen;
}

function generate() {
  const gen = getGenerator();
  const audio = gen.generate(state.latentVector);
  set('generatedAudio', audio);

  const spec = computeSpectrogram(audio, 512, 128);
  set('spectrogramData', spec);

  // Track in history
  state.latentHistory.push(state.latentVector.slice());
  if (state.latentHistory.length > 200) state.latentHistory.shift();

  renderActiveTab();
  updateStats();

  // CBP: record this step (z, audio, derived scalars). No-op if proxy is down.
  emit('audio:generated');
}

function onLatentChanged() {
  renderLatentBars();
}

function onInterpChanged() {
  if (!state.interpA || !state.interpB) return;
  const t = state.interpT;
  for (let i = 0; i < state.latentDim; i++) {
    state.latentVector[i] = lerp(state.interpA[i], state.interpB[i], t);
  }
  emit('latent:changed');
  generate();
}

function renderActiveTab() {
  const tab = state.activeTab;

  if (tab === 'generate') {
    renderLatentBars();
    if (state.generatedAudio) drawWaveform($('canvas-waveform'), state.generatedAudio, { sampleRate: state.sampleRate });
    if (state.spectrogramData) drawSpectrogram($('canvas-spectrogram'), state.spectrogramData, { sampleRate: state.sampleRate });
  }

  if (tab === 'explore') {
    renderLatentBars();
    if (state.latentHistory.length > 1) {
      drawLatentScatter($('canvas-scatter'), state.latentHistory, {
        activeIdx: state.latentHistory.length - 1,
      });
    }
    if (state.interpA && state.interpB) {
      drawInterpPath($('canvas-interp'), state.interpA, state.interpB, state.interpT);
    }
  }

  if (tab === 'spectrogram') {
    if (state.spectrogramData) drawSpectrogram($('canvas-spec-full'), state.spectrogramData, { sampleRate: state.sampleRate });
  }

  if (tab === 'metrics') {
    drawLossCurves($('canvas-loss'), state.metrics);
    if (state.latentVector) drawLatentHistogram($('canvas-hist'), state.latentVector);
  }

  if (tab === 'data') {
    renderDataTab();
  }

  if (tab === 'sonogene') {
    mountSonogeneTab();
  }

  if (tab === 'jewels') {
    renderJewelGrid();
  }
}

function renderLatentBars() {
  const canvas = $('canvas-latent');
  if (canvas) drawLatentBars(canvas, state.latentVector);
}

function renderJewelGrid() {
  const container = $('jewel-grid');
  if (!container) return;

  // Ensure canvases exist
  if (container.children.length !== state.jewels.length) {
    container.innerHTML = '';
    state.jewels.forEach((_, i) => {
      const card = document.createElement('div');
      card.className = 'jewel-card';
      card.innerHTML = `
        <canvas id="jewel-canvas-${i}" width="200" height="80"></canvas>
        <div class="jewel-info">Jewel ${i}</div>
        <button class="btn-sm" data-jewel="${i}">Load</button>
      `;
      card.querySelector('button').addEventListener('click', () => {
        state.latentVector.set(state.jewels[i]);
        state.currentJewel = i;
        emit('latent:changed');
        generate();
        $('jewel-label').textContent = `Jewel ${i}`;
      });
      container.appendChild(card);
    });
  }

  state.jewels.forEach((jewel, i) => {
    const c = $(`jewel-canvas-${i}`);
    if (c) drawLatentBars(c, jewel, { title: `Jewel ${i}` });
  });
}

function updateStats() {
  const el = $('stats');
  if (!el) return;

  const z = state.latentVector;
  let norm = 0;
  for (let i = 0; i < z.length; i++) norm += z[i] * z[i];
  norm = Math.sqrt(norm);

  const audioLen = state.generatedAudio?.length || 0;
  const duration = (audioLen / state.sampleRate).toFixed(2);

  el.innerHTML = `
    <span>||z|| = ${norm.toFixed(2)}</span>
    <span>${state.sampleRate / 1000}kHz</span>
    <span>${duration}s</span>
    <span>${state.latentHistory.length} samples</span>
  `;
}

// Boot
document.addEventListener('DOMContentLoaded', init);
