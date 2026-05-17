// Wiki/reference panel — right-side iframe or styled content
import { on, emit } from '../core/events.js';
import state, { set } from '../core/state.js';
import { $ } from '../core/utils.js';

// Link registry — sidebar links map to content sources
const LINKS = [
  {
    id: 'wavegan-paper',
    label: 'WaveGAN Paper',
    type: 'iframe',
    url: 'https://arxiv.org/pdf/1802.04208',
    tags: ['paper', 'gan'],
  },
  {
    id: 'wavegan-github',
    label: 'WaveGAN Code',
    type: 'iframe',
    url: 'https://github.com/chrisdonahue/wavegan',
    tags: ['code', 'gan'],
  },
  {
    id: 'xeno-canto',
    label: 'Xeno-Canto',
    type: 'iframe',
    url: 'https://xeno-canto.org',
    tags: ['data', 'birds'],
  },
  {
    id: 'latent-space',
    label: 'Latent Space',
    type: 'wiki',
    tags: ['concept'],
    content: `
      <h2>Latent Space</h2>
      <p>A <strong>latent space</strong> is a compressed representation of data
      learned by a neural network. In WaveGAN, the latent space is a
      100-dimensional vector <code>z ∈ [-1, 1]^100</code>.</p>
      <h3>Key Properties</h3>
      <ul>
        <li><strong>Continuity</strong> — nearby points produce similar audio</li>
        <li><strong>Interpolation</strong> — linear paths between points create
        smooth morphs between sounds</li>
        <li><strong>Disentanglement</strong> — individual dimensions may control
        distinct audio features (pitch, timbre, duration)</li>
      </ul>
      <h3>Jewel Vectors</h3>
      <p>Basis vectors that activate single dimensions, useful for understanding
      what each latent dimension controls.</p>
      <pre>z = [0, 0, ..., 1, ..., 0]  // only dim k active</pre>
    `,
  },
  {
    id: 'gan-training',
    label: 'GAN Training',
    type: 'wiki',
    tags: ['concept'],
    content: `
      <h2>GAN Training</h2>
      <p>Generative Adversarial Networks train two networks simultaneously:</p>
      <dl>
        <dt>Generator G(z)</dt>
        <dd>Maps latent vectors to audio waveforms. Tries to fool the discriminator.</dd>
        <dt>Discriminator D(x)</dt>
        <dd>Classifies audio as real (from dataset) or fake (from generator).</dd>
      </dl>
      <h3>Loss Functions</h3>
      <pre>L_D = -E[log D(x)] - E[log(1 - D(G(z)))]
L_G = -E[log D(G(z))]</pre>
      <h3>WaveGAN Architecture</h3>
      <p>Uses 1D transposed convolutions to upsample from 100D latent to 16384
      audio samples. 5 layers with stride-4 upsampling, ReLU activations
      (tanh on final layer).</p>
    `,
  },
  {
    id: 'spectrogram',
    label: 'Spectrograms',
    type: 'wiki',
    tags: ['concept', 'audio'],
    content: `
      <h2>Spectrograms</h2>
      <p>A spectrogram shows how the frequency content of a signal changes over time.</p>
      <h3>Computation</h3>
      <ol>
        <li>Divide signal into overlapping frames (512 samples, 128 hop)</li>
        <li>Apply Hann window to each frame</li>
        <li>Compute DFT magnitude for each frame</li>
        <li>Convert to dB scale: <code>20 * log10(|X[k]|)</code></li>
      </ol>
      <h3>Reading Spectrograms</h3>
      <ul>
        <li><strong>X-axis</strong> — time</li>
        <li><strong>Y-axis</strong> — frequency (0 to Nyquist = sr/2)</li>
        <li><strong>Color</strong> — magnitude (dB)</li>
      </ul>
      <p>Bird calls typically show characteristic frequency sweeps
      (ascending/descending) in the 1-8 kHz range with harmonic overtones.</p>
    `,
  },
  {
    id: 'bird-acoustics',
    label: 'Bird Acoustics',
    type: 'wiki',
    tags: ['domain', 'birds'],
    content: `
      <h2>Bird Acoustics</h2>
      <p>Birds produce sound via the <strong>syrinx</strong>, a vocal organ
      unique to birds, located at the junction of the trachea and bronchi.</p>
      <h3>Sound Characteristics</h3>
      <ul>
        <li><strong>Frequency</strong>: 1-10 kHz (most energy 2-6 kHz)</li>
        <li><strong>Duration</strong>: 50ms - 2s per note</li>
        <li><strong>Modulation</strong>: Rapid FM sweeps, AM trills</li>
        <li><strong>Harmonics</strong>: 2-8 harmonic overtones typical</li>
      </ul>
      <h3>Call Types</h3>
      <dl>
        <dt>Song</dt><dd>Complex, learned, territorial/mating</dd>
        <dt>Call</dt><dd>Simple, innate, alarm/contact</dd>
        <dt>Subsong</dt><dd>Quiet, variable, practice/development</dd>
      </dl>
    `,
  },
  {
    id: 'fm-synthesis',
    label: 'FM Synthesis',
    type: 'wiki',
    tags: ['audio', 'synthesis'],
    content: `
      <h2>Frequency Modulation Synthesis</h2>
      <p>The harmonic generator maps latent dimensions to FM synthesis parameters:</p>
      <pre>y(t) = A(t) · sin(2π · (f₀ + d·sin(2π·fₘ·t)) · t)</pre>
      <h3>Latent Mapping</h3>
      <table>
        <tr><th>Dims</th><th>Parameter</th><th>Range</th></tr>
        <tr><td>z[0-9]</td><td>Fundamental freq</td><td>1-8 kHz</td></tr>
        <tr><td>z[10-29]</td><td>Partial amplitudes</td><td>0-0.3</td></tr>
        <tr><td>z[30-49]</td><td>FM depth</td><td>±200 Hz</td></tr>
        <tr><td>z[50-69]</td><td>FM rate</td><td>3-13 Hz</td></tr>
        <tr><td>z[70-89]</td><td>Noise character</td><td>0-0.2</td></tr>
        <tr><td>z[90-99]</td><td>Envelope (atk/dec)</td><td>10-100ms / 100-500ms</td></tr>
      </table>
    `,
  },
];

let panelVisible = false;

export function getLinks() { return LINKS; }

export function initWikiPanel() {
  const panel = $('wiki-panel');
  const closeBtn = $('wiki-close');

  closeBtn?.addEventListener('click', () => {
    hidePanel();
  });

  // ESC to close
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panelVisible) hidePanel();
  });

  on('wiki:open', ({ id }) => openLink(id));
  on('wiki:close', hidePanel);

  // Draggable left edge to resize wiki panel
  const handle = $('wiki-handle');
  if (handle) {
    let dragging = false;
    handle.addEventListener('mousedown', e => {
      dragging = true;
      panel.classList.add('dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const containerRight = panel.parentElement.getBoundingClientRect().right;
      const w = Math.max(200, Math.min(containerRight - e.clientX, containerRight * 0.8));
      panel.style.width = w + 'px';
      emit('resize');
    });
    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        panel.classList.remove('dragging');
      }
    });
  }
}

export function openLink(id) {
  const link = LINKS.find(l => l.id === id);
  if (!link) return;

  const panel = $('wiki-panel');
  const body = $('wiki-body');
  const title = $('wiki-title');

  title.textContent = link.label;

  if (link.type === 'iframe') {
    body.innerHTML = `<iframe src="${link.url}" class="wiki-iframe"></iframe>`;
  } else {
    body.innerHTML = `<div class="wiki-content">${link.content}</div>`;
  }

  showPanel();
}

export function openUrl(url, title = 'Reference') {
  const panel = $('wiki-panel');
  const body = $('wiki-body');
  const titleEl = $('wiki-title');

  titleEl.textContent = title;
  body.innerHTML = `<iframe src="${url}" class="wiki-iframe"></iframe>`;
  showPanel();
}

function showPanel() {
  const panel = $('wiki-panel');
  panel.classList.add('open');
  panelVisible = true;
  emit('resize');
}

function hidePanel() {
  const panel = $('wiki-panel');
  panel.classList.remove('open');
  panelVisible = false;
  emit('resize');
}
