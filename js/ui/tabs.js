// Tab management
import { emit, on } from '../core/events.js';
import { set } from '../core/state.js';
import { $, $$ } from '../core/utils.js';

export function initTabs() {
  const tabBtns = $$('.tab-btn');
  const tabPanes = $$('.tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      activateTab(tab, tabBtns, tabPanes);
    });
  });

  // Keyboard shortcut: 1-5 for tabs
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const num = parseInt(e.key);
    if (num >= 1 && num <= tabBtns.length) {
      const tab = tabBtns[num - 1].dataset.tab;
      activateTab(tab, tabBtns, tabPanes);
    }
  });
}

function activateTab(tab, btns, panes) {
  btns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  panes.forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  set('activeTab', tab);
  emit('tab:changed', tab);
}
