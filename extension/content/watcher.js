(function () {
  'use strict';
  window.Fillosophy = window.Fillosophy || {};

  let lastFieldCount = 0;
  let spaDebounceTid = null;

  const spaObserver = new MutationObserver(() => {
    if (!window.Fillosophy.autofillHasRun) return; // silent until first autofill
    clearTimeout(spaDebounceTid);
    spaDebounceTid = setTimeout(() => {
      if (typeof window.Fillosophy.detectFormFields !== 'function') return;
      const newCount = window.Fillosophy.detectFormFields().length;
      if (newCount !== lastFieldCount && newCount > 0) {
        lastFieldCount = newCount;
        console.log('[Fillosophy Content] Page form changed — reopen popup to rescan.');
      }
    }, 600);
  });

  spaObserver.observe(document.body, { childList: true, subtree: true });
})();
