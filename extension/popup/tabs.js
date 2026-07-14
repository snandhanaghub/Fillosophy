import { TAB_IDS } from './constants.js';
import { state } from './state.js';
import { loadAutofillTab } from './autofill.js';

/**
 * Activates one tab and deactivates all others.
 * Uses the shared state's tabBtns / tabPanels maps.
 *
 * @param {string} tabId - 'upload' | 'profiles' | 'autofill'
 */
export function switchTab(tabId) {
  TAB_IDS.forEach((id) => {
    const btn      = state.tabBtns[id];
    const panel    = state.tabPanels[id];
    const isActive = id === tabId;

    if (!btn || !panel) {
      console.warn(`[Fillosophy] Missing DOM element for tab: "${id}"`);
      return;
    }

    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
    panel.classList.toggle('active', isActive);

    if (isActive) {
      panel.removeAttribute('hidden');
    } else {
      panel.setAttribute('hidden', '');
    }
  });

  const label = tabId.charAt(0).toUpperCase() + tabId.slice(1);
  console.log(`[Fillosophy] Tab switched to: ${label}`);

  // Side-effect: refresh live data whenever the Autofill tab becomes active
  if (tabId === 'autofill') {
    loadAutofillTab();
  }
}

/**
 * Legacy wrapper for switchTab.
 *
 * @param {string} tabId
 */
export function activateTab(tabId) {
  switchTab(tabId);
}
