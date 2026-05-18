// Mini Coilboard — floating draggable panel that embeds the coilboard iframe
// in ?mini=1 mode so users see live charts of the current bird2vec session
// without leaving the page. Panel state (position, size, open) persists in
// localStorage.

const LS_KEY = 'bird2vec.miniCoilboard';
const IFRAME_BASE = '/coilboard/iframes/coilboard.iframe.html';

let panel = null;

function loadState() {
    try {
        return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    } catch { return {}; }
}
function saveState(s) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

function ensureStyles() {
    if (document.getElementById('mini-cb-styles')) return;
    const css = document.createElement('style');
    css.id = 'mini-cb-styles';
    css.textContent = `
      .mini-cb {
        position: fixed;
        background: #0d1117;
        border: 1px solid #30363d;
        border-radius: 4px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        display: flex; flex-direction: column;
        z-index: 9999;
        font: 11px 'SF Mono', Consolas, monospace;
        color: #c9d1d9;
        min-width: 280px; min-height: 200px;
        user-select: none;
      }
      .mini-cb header {
        display: flex; align-items: center; gap: 6px;
        padding: 5px 8px;
        background: #161b22;
        border-bottom: 1px solid #30363d;
        cursor: move;
        border-radius: 4px 4px 0 0;
      }
      .mini-cb header .title { color: #58a6ff; font-weight: bold; }
      .mini-cb header .meta  { color: #8b949e; font-size: 9px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mini-cb header button {
        background: transparent; border: 1px solid #30363d; color: #c9d1d9;
        padding: 1px 6px; border-radius: 3px; cursor: pointer; font: 10px monospace;
      }
      .mini-cb header button:hover { border-color: #58a6ff; color: #58a6ff; }
      .mini-cb iframe {
        flex: 1; border: 0; width: 100%; height: 100%;
        background: #0d1117;
      }
      .mini-cb .resize {
        position: absolute; right: 0; bottom: 0;
        width: 14px; height: 14px;
        cursor: nwse-resize;
        background: linear-gradient(135deg, transparent 50%, #30363d 50%, #30363d 60%, transparent 60%, transparent 70%, #30363d 70%, #30363d 80%, transparent 80%);
      }
      .mini-cb.dragging, .mini-cb.resizing { opacity: 0.85; }
    `;
    document.head.appendChild(css);
}

function makeDraggable(el, header, onChange) {
    let dx = 0, dy = 0, startX = 0, startY = 0, dragging = false;
    header.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        dragging = true;
        el.classList.add('dragging');
        startX = e.clientX; startY = e.clientY;
        const r = el.getBoundingClientRect();
        dx = r.left; dy = r.top;
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const nx = Math.max(0, Math.min(window.innerWidth - 80, dx + e.clientX - startX));
        const ny = Math.max(0, Math.min(window.innerHeight - 40, dy + e.clientY - startY));
        el.style.left = nx + 'px';
        el.style.top  = ny + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('dragging');
        const r = el.getBoundingClientRect();
        onChange({ left: r.left, top: r.top });
    });
}

function makeResizable(el, handle, onChange) {
    let dragging = false, startX = 0, startY = 0, startW = 0, startH = 0;
    handle.addEventListener('mousedown', (e) => {
        dragging = true; el.classList.add('resizing');
        startX = e.clientX; startY = e.clientY;
        startW = el.offsetWidth; startH = el.offsetHeight;
        e.preventDefault(); e.stopPropagation();
    });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const w = Math.max(280, startW + (e.clientX - startX));
        const h = Math.max(200, startH + (e.clientY - startY));
        el.style.width  = w + 'px';
        el.style.height = h + 'px';
    });
    window.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false; el.classList.remove('resizing');
        onChange({ width: el.offsetWidth, height: el.offsetHeight });
    });
}

function buildPanel(runId, view) {
    ensureStyles();
    const saved = loadState();
    const el = document.createElement('div');
    el.className = 'mini-cb';
    el.style.left   = (saved.left   ?? Math.max(20, window.innerWidth - 460)) + 'px';
    el.style.top    = (saved.top    ?? 60) + 'px';
    el.style.width  = (saved.width  ?? 420) + 'px';
    el.style.height = (saved.height ?? 360) + 'px';

    const src = `${IFRAME_BASE}?mini=1&view=${encodeURIComponent(view || 'scalars')}${runId ? `&run=${encodeURIComponent(runId)}` : ''}`;
    el.innerHTML = `
      <header>
        <span class="title">Coilboard</span>
        <span class="meta" title="Embedded mini iframe">${runId ? '· ' + runId : '· newest run'}</span>
        <button data-act="view">${view === 'embeddings' ? 'scalars' : 'embed'}</button>
        <button data-act="open" title="Open full Coilboard in a new tab">↗</button>
        <button data-act="close" title="Close">×</button>
      </header>
      <iframe src="${src}"></iframe>
      <div class="resize"></div>
    `;
    document.body.appendChild(el);

    el.querySelector('[data-act="close"]').addEventListener('click', () => closePanel());
    el.querySelector('[data-act="open"]').addEventListener('click', () => window.open(IFRAME_BASE, '_blank'));
    el.querySelector('[data-act="view"]').addEventListener('click', () => {
        const next = view === 'embeddings' ? 'scalars' : 'embeddings';
        closePanel();
        openPanel(runId, next);
    });

    makeDraggable(el, el.querySelector('header'), (pos) => saveState({ ...loadState(), ...pos, open: true, view, runId }));
    makeResizable(el, el.querySelector('.resize'), (sz) => saveState({ ...loadState(), ...sz, open: true, view, runId }));

    saveState({ ...loadState(), open: true, view, runId });
    return el;
}

export function openPanel(runId, view = 'scalars') {
    if (panel) return panel;
    panel = buildPanel(runId, view);
    return panel;
}

export function closePanel() {
    if (panel) { panel.remove(); panel = null; }
    saveState({ ...loadState(), open: false });
}

export function togglePanel(runId) {
    if (panel) closePanel();
    else openPanel(runId, loadState().view || 'scalars');
}

// Restore on load if previously open.
export function restoreIfOpen(runIdProvider) {
    const s = loadState();
    if (s.open) openPanel(runIdProvider?.() || s.runId, s.view || 'scalars');
}
