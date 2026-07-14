// Fillosophy — Content Script | Form field detection & autofill
// Injected into every active tab via manifest.json content_scripts

(function () {
  'use strict';

  // Guard against multiple injections on the same page
  if (window.__fillosophyLoaded) return;
  window.__fillosophyLoaded = true;

  console.log('[Fillosophy Content] Content script loaded on:', window.location.href);

  window.Fillosophy = window.Fillosophy || {};

  // MESSAGE LISTENER

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

    // PING — lets the popup verify the content script is alive
    if (message.type === 'PING') {
      console.log('[Fillosophy Content] PING received — responding ready.');
      sendResponse({ status: 'content_script_ready' });
      return true;
    }

    // DETECT_FIELDS — wait for SPA form to stabilise, then scan
    if (message.type === 'DETECT_FIELDS') {
      console.log('[Fillosophy Content] DETECT_FIELDS received — waiting for form to stabilise…');
      if (typeof window.Fillosophy.waitForStableForm !== 'function' || 
          typeof window.Fillosophy.detectFormFields !== 'function') {
        console.error('[Fillosophy Content] Error: Detector modules not fully loaded.');
        sendResponse({ status: 'error', message: 'Modules not ready' });
        return true;
      }

      window.Fillosophy.waitForStableForm(3000)
        .then(() => {
          const fields = window.Fillosophy.detectFormFields();

          // Deduplicate labels: if two fields resolve to the same label string,
          // append the field index to make it unique. Must stay in sync with
          // the same logic in applyAutofill().
          const seenLabels = new Set();
          for (const field of fields) {
            const baseLabel =
              field.label       ??
              field.placeholder ??
              field.ariaLabel   ??
              field.name        ??
              field.id          ??
              `field_${field.index}`;

            if (seenLabels.has(baseLabel)) {
              // Override the descriptor's label so the label sent to /match
              // matches the key used in applyAutofill()
              field.label = `${baseLabel} (${field.index})`;
            } else {
              seenLabels.add(baseLabel);
            }
          }

          sendResponse({ status: 'ok', fields: fields, count: fields.length });
        })
        .catch((err) => {
          console.error('[Fillosophy Content] waitForStableForm error:', err);
          const fields = window.Fillosophy.detectFormFields();

          // Deduplicate labels (same logic as the success path above)
          const seenLabels = new Set();
          for (const field of fields) {
            const baseLabel =
              field.label       ??
              field.placeholder ??
              field.ariaLabel   ??
              field.name        ??
              field.id          ??
              `field_${field.index}`;

            if (seenLabels.has(baseLabel)) {
              field.label = `${baseLabel} (${field.index})`;
            } else {
              seenLabels.add(baseLabel);
            }
          }

          sendResponse({ status: 'ok', fields: fields, count: fields.length });
        });
      return true; // async — keep port open
    }

    // GET_PAGE_INFO — lightweight metadata about the current page
    if (message.type === 'GET_PAGE_INFO') {
      console.log('[Fillosophy Content] GET_PAGE_INFO received.');
      if (typeof window.Fillosophy.detectFormFields !== 'function') {
        sendResponse({ status: 'error', url: window.location.href, fieldCount: 0 });
        return true;
      }
      sendResponse({
        url:        window.location.href,
        title:      document.title,
        fieldCount: window.Fillosophy.detectFormFields().length,
      });
      return true;
    }

    // FILLOSOPHY_AUTOFILL — trigger form autofill with the active profile
    if (message.type === 'FILLOSOPHY_AUTOFILL') {
      if (typeof window.Fillosophy.handleAutofill !== 'function') {
        sendResponse({ success: false, error: 'Autofill module not loaded' });
        return true;
      }
      window.Fillosophy.handleAutofill(message.profile)
        .then((result) => sendResponse({ success: true, result }))
        .catch((err) => {
          console.error('[Fillosophy Content] Autofill error:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // async response — keep port open
    }

    // APPLY_AUTOFILL — actual AI form filling
    if (message.type === 'APPLY_AUTOFILL') {
      console.log('[Fillosophy Content] APPLY_AUTOFILL received.');
      if (typeof window.Fillosophy.applyAutofill !== 'function') {
        sendResponse({ status: 'error', message: 'Autofill module not loaded' });
        return true;
      }
      try {
        const summary = window.Fillosophy.applyAutofill(message.mapping, message.fields);
        sendResponse({ status: 'ok', summary });
      } catch (err) {
        console.error('[Fillosophy Content] applyAutofill error:', err);
        sendResponse({ status: 'error', message: err.message });
      }
      return true;
    }

    return true; // always return true for async safety
  });

})();
