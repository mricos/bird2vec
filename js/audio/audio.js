// Web Audio API — playback, recording, and analysis
import { emit } from '../core/events.js';
import state, { set } from '../core/state.js';

let audioCtx = null;
let analyserNode = null;
let sourceNode = null;

export function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext({ sampleRate: state.sampleRate });
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.connect(audioCtx.destination);
  }
  return audioCtx;
}

export function getAnalyser() {
  getAudioContext();
  return analyserNode;
}

// Play a Float32Array as audio
export function playAudio(samples, sampleRate) {
  const ctx = getAudioContext();
  const sr = sampleRate || state.sampleRate;

  if (sourceNode) {
    sourceNode.stop();
    sourceNode.disconnect();
  }

  const buffer = ctx.createBuffer(1, samples.length, sr);
  buffer.copyToChannel(samples, 0);

  sourceNode = ctx.createBufferSource();
  sourceNode.buffer = buffer;
  sourceNode.connect(analyserNode);

  set('isPlaying', true);
  sourceNode.onended = () => {
    set('isPlaying', false);
    emit('audio:ended');
  };

  sourceNode.start();
  emit('audio:playing');
}

export function stopAudio() {
  if (sourceNode) {
    sourceNode.stop();
    sourceNode.disconnect();
    sourceNode = null;
    set('isPlaying', false);
  }
}

// Compute spectrogram from audio samples
export function computeSpectrogram(samples, fftSize = 512, hopSize = 128) {
  const numFrames = Math.floor((samples.length - fftSize) / hopSize) + 1;
  const numBins = fftSize / 2;
  const spec = new Float32Array(numFrames * numBins);

  // Hann window
  const win = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
  }

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hopSize;

    // Windowed frame
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      real[i] = (samples[offset + i] || 0) * win[i];
    }

    // DFT (small N, acceptable perf)
    for (let k = 0; k < numBins; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < fftSize; n++) {
        const angle = -2 * Math.PI * k * n / fftSize;
        re += real[n] * Math.cos(angle);
        im += real[n] * Math.sin(angle);
      }
      const mag = Math.sqrt(re * re + im * im);
      spec[f * numBins + k] = 20 * Math.log10(mag + 1e-10); // dB
    }
  }

  return { data: spec, numFrames, numBins, fftSize, hopSize };
}

// Export audio as WAV file download
export function downloadWav(samples, sampleRate, filename = 'bird2vec.wav') {
  const sr = sampleRate || state.sampleRate;
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // WAV header
  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);       // chunk size
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sr, true);       // sample rate
  view.setUint32(28, sr * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);       // bits per sample

  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s * 32767, true);
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
