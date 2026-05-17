// Sidebar controls — collapsible accordion sections with adaptive text
import { emit, on } from '../core/events.js';
import state, { set } from '../core/state.js';
import { $, fillRandom } from '../core/utils.js';
import { getLinks } from './wiki-panel.js';

// Adaptive font sizing based on sidebar width
function adaptText(sidebar) {
  const w = sidebar.offsetWidth;
  // Scale font from 10px at 180px width to 13px at 400px+
  const base = Math.max(10, Math.min(13, 10 + (w - 180) * 0.0136));
  sidebar.style.fontSize = base + 'px';

  // Hide labels below threshold, show abbreviations
  const compact = w < 220;
  sidebar.classList.toggle('compact', compact);
}

export function initSidebar() {
  const sidebar = $('sidebar');

  // Initial text adaptation
  adaptText(sidebar);

  // Randomize button
  $('btn-randomize')?.addEventListener('click', () => {
    fillRandom(state.latentVector, -1, 1);
    emit('latent:changed');
    updateSliders();
  });

  // Zero button
  $('btn-zero')?.addEventListener('click', () => {
    state.latentVector.fill(0);
    emit('latent:changed');
    updateSliders();
  });

  // Jewel presets
  $('btn-jewel-next')?.addEventListener('click', () => {
    state.currentJewel = (state.currentJewel + 1) % state.jewels.length;
    state.latentVector.set(state.jewels[state.currentJewel]);
    emit('latent:changed');
    updateSliders();
    $('jewel-label').textContent = `Jewel ${state.currentJewel}`;
  });

  // Generate button
  $('btn-generate')?.addEventListener('click', () => emit('generate'));

  // Play/Stop
  $('btn-play')?.addEventListener('click', () => emit('audio:play'));
  $('btn-stop')?.addEventListener('click', () => emit('audio:stop'));
  $('btn-download')?.addEventListener('click', () => emit('audio:download'));

  // Interpolation slider
  $('interp-slider')?.addEventListener('input', e => {
    set('interpT', parseFloat(e.target.value));
    $('interp-val').textContent = parseFloat(e.target.value).toFixed(2);
    emit('interp:changed');
  });

  // Generator mode
  $('gen-mode')?.addEventListener('change', e => {
    set('genMode', e.target.value);
    emit('generate');
  });

  // Audio length
  $('audio-length')?.addEventListener('change', e => {
    set('audioLength', parseInt(e.target.value));
  });

  // Sidebar resize with adaptive text
  const handle = $('sidebar-handle');
  if (handle) {
    let dragging = false;
    handle.addEventListener('mousedown', () => dragging = true);
    document.addEventListener('mousemove', e => {
      if (dragging) {
        const w = Math.max(180, Math.min(500, e.clientX));
        sidebar.style.width = w + 'px';
        set('sidebarWidth', w);
        adaptText(sidebar);
        emit('resize');
      }
    });
    document.addEventListener('mouseup', () => dragging = false);
  }

  // Build reference links
  buildRefLinks($('ref-links'));

  // Listen for state changes
  on('state:isPlaying', playing => {
    const btn = $('btn-play');
    if (btn) btn.textContent = playing ? 'Playing...' : 'Play';
  });

  // Re-adapt on window resize
  on('resize', () => adaptText(sidebar));
}

function updateSliders() {
  const sliders = document.querySelectorAll('.dim-slider');
  sliders.forEach(s => {
    const dim = parseInt(s.dataset.dim);
    if (dim < state.latentVector.length) {
      s.value = state.latentVector[dim];
      s.nextElementSibling.textContent = state.latentVector[dim].toFixed(2);
    }
  });
}

// Build the first N latent dimension sliders dynamically
export function buildDimSliders(container, n = 20) {
  container.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'dim-row';
    row.innerHTML = `
      <label>z[${i}]</label>
      <input type="range" class="dim-slider" data-dim="${i}"
             min="-1" max="1" step="0.01" value="0">
      <span class="dim-val">0.00</span>
    `;
    container.appendChild(row);
  }

  // Attach events
  container.querySelectorAll('.dim-slider').forEach(slider => {
    slider.addEventListener('input', e => {
      const dim = parseInt(e.target.dataset.dim);
      state.latentVector[dim] = parseFloat(e.target.value);
      e.target.nextElementSibling.textContent = parseFloat(e.target.value).toFixed(2);
      emit('latent:changed');
    });
  });
}

// Build clickable reference links in sidebar
function buildRefLinks(container) {
  if (!container) return;
  const links = getLinks();

  // Group by tag
  const groups = {};
  links.forEach(link => {
    const tag = link.tags[0] || 'other';
    (groups[tag] ??= []).push(link);
  });

  container.innerHTML = '';
  for (const [tag, items] of Object.entries(groups)) {
    const group = document.createElement('div');
    group.className = 'ref-group';
    group.innerHTML = `<div class="ref-tag">${tag}</div>`;

    items.forEach(link => {
      const a = document.createElement('a');
      a.className = 'ref-link';
      a.href = '#';
      a.textContent = link.label;
      a.dataset.type = link.type;
      a.addEventListener('click', e => {
        e.preventDefault();
        emit('wiki:open', { id: link.id });
      });
      group.appendChild(a);
    });

    container.appendChild(group);
  }
}
