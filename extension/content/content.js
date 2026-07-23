// Fillosophy — Content Script | Form field detection & autofill
// Injected into every active tab via manifest.json content_scripts

(function () {
  'use strict';

  // Guard against multiple injections on the same page
  if (window.__fillosophyLoaded) return;
  window.__fillosophyLoaded = true;

  console.log('[Fillosophy Content] Content script loaded on:', window.location.href);

  // ════════════════════════════════════════════════════════════
  // SPA RESILIENCE — persistent post-autofill form-change watcher
  // ════════════════════════════════════════════════════════════

  /**
   * Tracks whether autofill has run at least once on this page load.
   * Set to true by applyAutofill() so the watcher only activates after
   * the first real fill, avoiding noise on initial page load.
   */
  let autofillHasRun = false;

  /**
   * Persistent MutationObserver that watches for major DOM changes
   * AFTER autofill has already run. Notifies the user (via console) that
   * they should reopen the popup to rescan — e.g. on multi-step forms.
   * Non-intrusive: never auto-fills or auto-detects again.
   */
  (function installSpaChangeWatcher() {
    let lastFieldCount = 0;
    let spaDebounceTid = null;

    const spaObserver = new MutationObserver(() => {
      if (!autofillHasRun) return; // silent until first autofill
      clearTimeout(spaDebounceTid);
      spaDebounceTid = setTimeout(() => {
        const newCount = detectFormFields().length;
        if (newCount !== lastFieldCount && newCount > 0) {
          lastFieldCount = newCount;
          console.log('[Fillosophy Content] Page form changed — reopen popup to rescan.');
        }
      }, 600);
    });

    spaObserver.observe(document.body, { childList: true, subtree: true });
  })();

  // ════════════════════════════════════════════════════════════
  // GOOGLE FORMS DETECTION
  // ════════════════════════════════════════════════════════════

  /**
   * Returns true if the current page is a Google Form.
   * @returns {boolean}
   */
  function isGoogleForm() {
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;
    return hostname.includes('docs.google.com') && pathname.includes('/forms/');
  }

  // Alias for backward compatibility
  const isGoogleForms = isGoogleForm;

  console.log(`[Fillosophy Content] Google Form detected: ${isGoogleForm()}`);

  // ════════════════════════════════════════════════════════════
  // LABEL RESOLUTION
  // ════════════════════════════════════════════════════════════

  /**
   * Resolves the human-readable label for a form element.
   * Tries six strategies in order and returns the first non-empty result.
   * Strategy 6 handles Google Forms' non-standard DOM.
   *
   * @param {HTMLElement} element
   * @returns {string|null}
   */
  function getLabelText(element) {
    // Strategy 1 — Explicit <label for="id">
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) {
        const text = label.innerText.trim();
        if (text) return text;
      }
    }

    // Strategy 2 — Element is wrapped inside a <label>
    const wrappingLabel = element.closest('label');
    if (wrappingLabel) {
      const text = wrappingLabel.innerText.trim();
      if (text) return text;
    }

    // Strategy 3 — Preceding sibling <label> (up to 3 steps back)
    let sibling = element.previousElementSibling;
    for (let step = 0; step < 3 && sibling; step++) {
      if (sibling.tagName === 'LABEL') {
        const text = sibling.innerText.trim();
        if (text) return text;
      }
      sibling = sibling.previousElementSibling;
    }

    // Strategy 4 — aria-labelledby attribute
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      // aria-labelledby can be a space-separated list of IDs
      const ids = labelledBy.trim().split(/\s+/);
      const parts = ids
        .map((id) => document.getElementById(id)?.innerText?.trim())
        .filter(Boolean);
      if (parts.length) return parts.join(' ');
    }

    // Strategy 5 — Closest ancestor whose className contains a label-like word
    const labelClasses = ['label', 'field-name', 'form-label', 'input-label'];
    let ancestor = element.parentElement;
    for (let level = 0; level < 4 && ancestor; level++) {
      const cls = (ancestor.className || '').toLowerCase();
      if (labelClasses.some((lc) => cls.includes(lc))) {
        const text = ancestor.innerText.trim();
        if (text) return text;
      }
      ancestor = ancestor.parentElement;
    }

    // Strategy 6 — Google Forms specific: walk up to find the question title.
    // GForms renders question text in .freebirdFormviewerComponentsQuestionBaseTitle
    // or inside the nearest ancestor that has [data-params], then grabs its first span.
    if (isGoogleForms()) {
      // Try GForms question title class (stable across recent versions)
      const questionBlock = element.closest('[data-params], .freebirdFormviewerViewItemsItemItem');
      if (questionBlock) {
        const titleEl =
          questionBlock.querySelector('.freebirdFormviewerComponentsQuestionBaseTitle') ||
          questionBlock.querySelector('[role="heading"]') ||
          questionBlock.querySelector('span[dir]');
        if (titleEl) {
          const text = titleEl.innerText.trim();
          if (text) return text;
        }
      }
      // Fallback: use aria-label on the input itself (GForms often sets this)
      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
    }

    return null;
  }

  // ════════════════════════════════════════════════════════════
  // FIELD DETECTION
  // ════════════════════════════════════════════════════════════

  /**
   * Determines if an element is visible to the user.
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    // offsetParent is null for fixed/absolute positioned elements and on Google Forms.
    // Fall back to bounding rect height as a more reliable visibility check.
    if (el.offsetParent !== null) return true;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  /**
   * Queries all fillable form elements on the page, builds a structured
   * descriptor for each one, and filters out those with no identifiable context.
   *
   * @returns {Object[]} Array of field descriptor objects.
   */
  function detectFormFields() {
    // Google Forms uses a completely custom DOM — try the specialised detector first.
    if (isGoogleForms()) {
      const gformsFields = detectGoogleFormFields();
      if (gformsFields.length > 0) return gformsFields;
      // Fall through to standard detection if GForms detector found nothing
      // (e.g. form not fully loaded, or unusual structure).
      console.warn('[Fillosophy Content] GForms detector found 0 fields — falling back to standard detection.');
    }

    // Step 1 — Query all interactive elements (excludes hidden/submit/button/reset/image/file)
    const elements = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"])' +
      ':not([type="reset"]):not([type="image"]):not([type="file"]),' +
      'select, textarea'
    );

    const fields = [];

    Array.from(elements).forEach((element, i) => {
      // Skip invisible elements — they are not user-facing fields
      if (!isVisible(element)) return;

      // Step 2 — Build descriptor object
      const label = getLabelText(element);
      const isPhone = isPhoneField(label, element.type);
      const phoneContext = isPhone ? detectPhoneNumberContext(element) : { hasCountryCodePrefix: false, extractedCountryCode: null, expectedFormat: 'unknown' };

      const descriptor = {
        index:       i,
        tag:         element.tagName,
        type:        element.type        ?? null,
        name:        element.name        || null,
        id:          element.id          || null,
        placeholder: element.placeholder || null,
        label:       label,
        ariaLabel:   element.getAttribute('aria-label') ?? null,
        required:    element.required    ?? false,
        value:       element.value       ?? null,
        hasCountryCodePrefix: phoneContext.hasCountryCodePrefix,
        countryCodeValue: phoneContext.extractedCountryCode,
        expectedFormat: phoneContext.expectedFormat
      };
      Object.defineProperty(descriptor, 'element', { value: element, enumerable: false });

      // Step 3 — Skip fields with no identifiable context whatsoever
      const hasContext =
        descriptor.name      !== null ||
        descriptor.id        !== null ||
        descriptor.placeholder !== null ||
        descriptor.label     !== null ||
        descriptor.ariaLabel !== null;

      if (hasContext) {
        fields.push(descriptor);
      }
    });

    // Step 4 — Log summary and table for easy debugging in DevTools
    console.log(`[Fillosophy Content] Detected ${fields.length} form fields`);
    console.table(fields.map((f) => ({
      label:       f.label,
      name:        f.name,
      type:        f.type,
      placeholder: f.placeholder,
    })));

    return fields;
  }

  // ════════════════════════════════════════════════════════════
  // SPA RESILIENCE — waitForStableForm
  // ════════════════════════════════════════════════════════════

  /**
   * Waits until the number of form fields on the page is stable,
   * or resolves immediately if the DOM is already settled.
   *
   * Fast-path: if fields are found on the first check and no DOM
   * mutations occur within 150ms, resolves in ~150ms (static pages).
   *
   * Slow-path: for SPAs where forms render asynchronously, watches
   * for DOM stability with 150ms debounce cycles, up to 1500ms max.
   *
   * @param {number} timeoutMs - Maximum wait time in milliseconds.
   * @returns {Promise<void>}
   */
  function waitForStableForm(timeoutMs = 1500) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let lastCount   = 0;
      let stableCount = 0;
      let debounceTid = null;
      let resolved    = false;

      const done = () => {
        if (resolved) return;
        resolved = true;
        observer.disconnect();
        clearTimeout(debounceTid);
        console.log(
          `[Fillosophy Content] Form stabilized after ${Date.now() - startTime}ms`,
          `(${lastCount} fields found)`
        );
        resolve();
      };

      const checkStability = () => {
        clearTimeout(debounceTid);
        debounceTid = setTimeout(() => {
          const newCount = detectFormFields().length;

          if (newCount === lastCount) {
            stableCount++;
          } else {
            stableCount = 0;
            lastCount   = newCount;
          }

          // Fast resolve: if fields exist and stable for 1 cycle, done
          // Full resolve: stable for 2 cycles (handles dynamic rendering)
          const neededCycles = lastCount > 0 ? 1 : 2;

          if (stableCount >= neededCycles || (Date.now() - startTime) >= timeoutMs) {
            done();
          } else {
            checkStability();
          }
        }, 150); // 150ms debounce (was 300ms)
      };

      const observer = new MutationObserver(() => {
        if (resolved) return;
        stableCount = 0;
        checkStability();
      });

      observer.observe(document.body, { childList: true, subtree: true });
      checkStability();

      // Hard timeout fallback
      setTimeout(done, timeoutMs);
    });
  }

  // MESSAGE LISTENER
  // ════════════════════════════════════════════════════════════

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
      waitForStableForm(3000)
        .then(() => {
          const fields = detectFormFields();

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
          const fields = detectFormFields();

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
      sendResponse({
        url:        window.location.href,
        title:      document.title,
        fieldCount: detectFormFields().length,
      });
      return true;
    }

    // FILLOSOPHY_AUTOFILL — trigger form autofill with the active profile
    if (message.type === 'FILLOSOPHY_AUTOFILL') {
      handleAutofill(message.profile)
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
      try {
        const summary = applyAutofill(message.mapping, message.fields);
        sendResponse({ status: 'ok', summary });
      } catch (err) {
        console.error('[Fillosophy Content] applyAutofill error:', err);
        sendResponse({ status: 'error', message: err.message });
      }
      return true;
    }

    return true; // always return true for async safety
  });

  // ════════════════════════════════════════════════════════════
  // AUTOFILL HANDLER
  // ════════════════════════════════════════════════════════════

  /**
   * Main autofill flow.
   * Detects form fields, then fills each one with the matching profile value.
   *
   * @param {Object|null} profile - Parsed resume profile from storage.
   * @returns {Promise<{ filledCount: number }>}
   */
  async function handleAutofill(profile) {
    if (!profile) {
      console.warn('[Fillosophy Content] No profile provided for autofill.');
      return { filledCount: 0 };
    }

    const fields = detectFormFields();
    let filledCount = 0;

    for (const field of fields) {
      const value = matchFieldToProfile(field, profile);
      if (value !== null) {
        const el = document.querySelectorAll(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"])' +
          ':not([type="reset"]):not([type="image"]):not([type="file"]),' +
          'select, textarea'
        )[field.index];
        if (el) {
          fillField(el, value);
          filledCount++;
        }
      }
    }

    console.log(`[Fillosophy Content] Filled ${filledCount} field(s).`);
    return { filledCount };
  }

  /**
   * Applies the AI field mapping to the actual DOM elements.
   *
   * @param {Object} mapping - AI response from /match.
   * @param {Object[]} fieldDescriptors - DetectFormFields array.
   * @returns {Object} Autofill summary.
   */
  function applyAutofill(mapping, fieldDescriptors) {
    // ── Build label → descriptor map (supports both standard and GForms descriptors) ──
    const labelToDescriptorMap = {};

    // For standard (non-GForms) pages we also need the element NodeList to resolve by index
    const standardElements = isGoogleForms() ? [] : Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"])' +
      ':not([type="reset"]):not([type="image"]):not([type="file"]),' +
      'select, textarea'
    ));

    for (const descriptor of fieldDescriptors) {
      // MUST use the exact same priority as collectFieldLabels() in popup.js
      let label =
        descriptor.label       ??
        descriptor.placeholder ??
        descriptor.ariaLabel   ??
        descriptor.name        ??
        descriptor.id          ??
        `field_${descriptor.index}`;

      if (label in labelToDescriptorMap) {
        label = `${label} (${descriptor.index})`;
      }

      labelToDescriptorMap[label] = descriptor;
    }

    // Debug — surface the map so mismatches can be spotted in DevTools
    console.log('[Fillosophy Content] labelToDescriptorMap keys:', Object.keys(labelToDescriptorMap));
    console.log('[Fillosophy Content] mapping keys:', Object.keys(mapping));

    const results = [];
    const summary = { filled: 0, flagged: 0, skipped: 0, details: [] };

    for (const [label, fieldData] of Object.entries(mapping)) {
      const descriptor = labelToDescriptorMap[label];
      if (!descriptor || fieldData.value == null) continue;

      let status = 'filled';

      // ── Google Forms path ────────────────────────────────────────────────
      if (descriptor._gforms) {
        const ok = fillGoogleFormField(descriptor, String(fieldData.value));
        if (!ok) status = 'skipped';
        const resObj = { label, status, confidence: fieldData.confidence, value: fieldData.value };
        results.push(resObj);
        if (status === 'filled') summary.filled++;
        else summary.skipped++;
        continue;
      }

      // ── Standard DOM path ────────────────────────────────────────────────
      const element = standardElements[descriptor.index];
      if (!element || element.disabled || element.readOnly) continue;

      if (fieldData.confidence < 70) {
        element.setAttribute('data-fillosophy-flag', 'low-confidence');
        element.style.border = '2px solid #D97706';
        element.style.backgroundColor = '#FEF3C7';
        status = 'low_confidence';
      }

      const tagName = element.tagName.toLowerCase();
      const type = (element.type || '').toLowerCase();

      try {
        if (tagName === 'input' && (type === 'checkbox' || type === 'radio')) {
          if (type === 'checkbox') {
            const valStr = String(fieldData.value).toLowerCase();
            element.checked = ['yes', 'true', '1'].includes(valStr) || fieldData.value === true;
            element.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (type === 'radio') {
            const radios = document.querySelectorAll(`input[type="radio"][name="${element.name}"]`);
            let matched = false;
            for (const radio of radios) {
              if (radio.value.toLowerCase() === String(fieldData.value).toLowerCase()) {
                radio.checked = true;
                radio.dispatchEvent(new Event('change', { bubbles: true }));
                matched = true;
                break;
              }
            }
            if (!matched) status = 'skipped';
          }
        } else if (tagName === 'select') {
          let matched = false;
          const options = element.options;
          const targetValue = String(fieldData.value).toLowerCase();
          for (let i = 0; i < options.length; i++) {
            const optVal = options[i].value.toLowerCase();
            const optText = options[i].text.toLowerCase();
            if (!optVal) continue;
            if (optVal === targetValue ||
                optText === targetValue ||
                optText.includes(targetValue) ||
                targetValue.includes(optVal) ||
                targetValue.includes(optText) ||
                (targetValue.includes('b.tech') && optVal.includes('bachelor')) ||
                (targetValue.includes('b.e')    && optVal.includes('bachelor')) ||
                (targetValue.includes('master') && optVal.includes('master'))   ||
                (targetValue.includes('phd')    && optVal.includes('phd'))) {
              element.value = options[i].value;
              element.dispatchEvent(new Event('change', { bubbles: true }));
              matched = true;
              break;
            }
          }
          if (!matched) status = 'skipped';
        } else if (isPhoneField(label, type)) {
          const phoneRes = fillPhoneNumberField(element, fieldData.value, descriptor);
          if (phoneRes.status === 'skipped') status = 'skipped';
        } else {
          fillField(element, String(fieldData.value));
        }
      } catch (err) {
        console.error(`[Fillosophy Content] Error filling ${label}:`, err);
        status = 'skipped';
      }

      // ── Visual outline highlighting ──────────────────────────────────────
      if (status === "filled") {
        element.style.outline = "2px solid #16a34a";
        element.style.outlineOffset = "1px";
      } else if (status === "low_confidence") {
        element.style.outline = "2px solid #d97706";
        element.style.outlineOffset = "1px";
        element.style.backgroundColor = "#fffbeb";
      }

      const resObj = {
        label: label,
        status: status,
        confidence: fieldData.confidence,
        value: fieldData.value
      };
      results.push(resObj);

      if (status === "filled") summary.filled++;
      else if (status === "low_confidence") summary.flagged++;
      else if (status === "skipped") summary.skipped++;
    }

    summary.details = results;
    // Activate the SPA change watcher from this point on
    autofillHasRun = true;
    console.log(`[Fillosophy Content] Autofill complete:`, summary);

    // ── Auto-clear outlines after 8 s OR on next page click ───────────────
    const allFilled = document.querySelectorAll(
      'input[style*="outline"], select[style*="outline"], textarea[style*="outline"]'
    );

    const clearOutlines = () => {
      allFilled.forEach((el) => {
        el.style.outline = '';
        el.style.outlineOffset = '';
      });
      document.querySelectorAll('[data-fillosophy-flag]').forEach((el) => {
        el.style.outline = '';
        el.style.outlineOffset = '';
      });
    };

    const autoTimer = setTimeout(clearOutlines, 8000);

    const clickHandler = () => {
      clearOutlines();
      clearTimeout(autoTimer);
      document.removeEventListener('click', clickHandler, { capture: true });
    };
    // Use capture so even clicks inside form elements fire this
    document.addEventListener('click', clickHandler, { capture: true, once: true });

    // Disable injecting overlay popups into host webpage DOM
    // renderOverlay(summary);
    return summary;
  }

  /**
   * Sets a field's value and dispatches synthetic input + change events
   * so React / Vue / Angular frameworks register the update.
   *
   * @param {HTMLElement} field
   * @param {string}      value
   */
  function fillField(field, value) {
    let proto = window.HTMLInputElement.prototype;
    if (field.tagName === 'TEXTAREA') {
      proto = window.HTMLTextAreaElement.prototype;
    } else if (field.tagName === 'SELECT') {
      proto = window.HTMLSelectElement.prototype;
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(field, value);
    } else {
      field.value = value;
    }

    field.dispatchEvent(new Event('input',  { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  // ════════════════════════════════════════════════════════════
  // PHONE NUMBER — CONTEXT DETECTION & SMART FILLING
  // ════════════════════════════════════════════════════════════

  /** Country-code patterns: +91, +1, +44 … */
  const _CC_PATTERN = /^\+\d{1,3}$/;
  /** Labels that imply the field wants ONLY the local number portion. */
  const _NUMBER_ONLY_HINTS = ['mobile number', 'phone number', 'contact number', 'whatsapp', 'mobile no', 'phone no', 'enter number', 'enter mobile', 'your number'];
  /** Labels that imply the field wants the full international format. */
  const _FULL_PHONE_HINTS  = ['with country code', 'international', 'full phone', 'full number'];

  /**
   * Inspects the DOM context around a phone input to determine whether a
   * separate country-code prefix exists nearby, and which phone format the
   * field expects.
   *
   * @param {HTMLElement} element   - The phone input element.
   * @returns {{ hasCountryCodePrefix: boolean, extractedCountryCode: string|null, expectedFormat: string }}
   */
  function detectPhoneNumberContext(element) {
    let hasCountryCodePrefix = false;
    let extractedCountryCode = null;
    let expectedFormat = 'number_only'; // default: most phone fields want just the number

    // ── Check 1: Inspect siblings & parent for a country-code selector ───────
    const parent = element.parentElement;
    const grandParent = parent?.parentElement;

    const checkContainer = (container) => {
      if (!container) return;
      // Look for a <select> whose options contain country-code patterns
      const selects = container.querySelectorAll('select');
      for (const sel of selects) {
        if (sel === element) continue;
        const opts = Array.from(sel.options);
        const hasCC = opts.some(o =>
          _CC_PATTERN.test((o.value || '').trim()) ||
          _CC_PATTERN.test((o.text  || '').trim().split(' ')[0])
        );
        if (hasCC) {
          hasCountryCodePrefix = true;
          // Try to read what's currently selected
          const selectedText = sel.options[sel.selectedIndex]?.text?.trim() ?? '';
          const ccMatch = selectedText.match(/\+\d{1,3}/);
          if (ccMatch) extractedCountryCode = ccMatch[0];
          return;
        }
        // A select whose placeholder/first option says "country code"
        if (opts[0] && /country.?code|code/i.test(opts[0].text)) {
          hasCountryCodePrefix = true;
          return;
        }
      }

      // Look for an <input> with a country-code placeholder or a static element showing "+XX"
      const inputs = container.querySelectorAll('input');
      for (const inp of inputs) {
        if (inp === element) continue;
        const ph = (inp.placeholder || '').toLowerCase();
        if (ph.includes('country code') || ph.includes('code')) {
          hasCountryCodePrefix = true;
          return;
        }
        // Input whose current value IS a country code (e.g. "+91")
        if (_CC_PATTERN.test((inp.value || '').trim())) {
          hasCountryCodePrefix = true;
          extractedCountryCode = inp.value.trim();
          return;
        }
      }

      // Look for any static text element displaying just a country code
      const allText = Array.from(container.querySelectorAll('span, div, p, label, button'))
        .map(el => el.innerText?.trim())
        .filter(t => t && _CC_PATTERN.test(t));
      if (allText.length) {
        hasCountryCodePrefix = true;
        extractedCountryCode = allText[0];
      }
    };

    // Search in increasing radius: parent → grandparent → 3 levels up
    let ancestor = element.parentElement;
    for (let i = 0; i < 5 && ancestor && ancestor !== document.body; i++) {
      checkContainer(ancestor);
      if (hasCountryCodePrefix) break;
      ancestor = ancestor.parentElement;
    }

    // ── Check 2: Label / placeholder hints ───────────────────────────────────
    const label = (element.getAttribute('aria-label') || element.placeholder || '').toLowerCase();

    if (_FULL_PHONE_HINTS.some(h => label.includes(h))) {
      expectedFormat = 'with_country_code';
      hasCountryCodePrefix = false; // doesn't need separate filling
    } else if (hasCountryCodePrefix) {
      expectedFormat = 'number_only';
    } else if (_NUMBER_ONLY_HINTS.some(h => label.includes(h))) {
      expectedFormat = 'number_only';
    } else {
      // Default: if the input type is "tel" and we see no CC prefix, return number_only
      // to avoid duplicating any code the user may have manually typed
      expectedFormat = (element.type === 'tel') ? 'number_only' : 'unknown';
    }

    return { hasCountryCodePrefix, extractedCountryCode, expectedFormat };
  }

  /**
   * Finds a sibling country-code input or select relative to a phone field.
   *
   * @param {HTMLElement} phoneElement
   * @returns {HTMLElement|null}
   */
  function findCountryCodeField(phoneElement) {
    let ancestor = phoneElement.parentElement;
    for (let i = 0; i < 2 && ancestor && ancestor !== document.body; i++) {
      // Prefer a <select> with country-code options
      const sel = Array.from(ancestor.querySelectorAll('select')).find(s => {
        if (s === phoneElement) return false;
        return Array.from(s.options).some(o =>
          _CC_PATTERN.test((o.value || '').trim()) ||
          _CC_PATTERN.test((o.text  || '').trim().split(' ')[0]) ||
          /country.?code|dial.?code|calling.?code/i.test(o.text)
        );
      });
      if (sel) { console.log('[Fillosophy] Country code field found:', sel); return sel; }

      // Or an <input> flagged strictly as country/dial code
      const inp = Array.from(ancestor.querySelectorAll('input')).find(inp => {
        if (inp === phoneElement) return false;
        const type = (inp.type || '').toLowerCase();
        if (type === 'email' || type === 'password' || type === 'hidden') return false;
        const ph = (inp.placeholder || '').toLowerCase();
        const name = (inp.name || '').toLowerCase();
        const isCC = ph.includes('country code') || ph.includes('dial code') || ph.includes('calling code') ||
                     name.includes('country_code') || name.includes('dial_code') ||
                     _CC_PATTERN.test((inp.value || '').trim());
        return isCC;
      });
      if (inp) { console.log('[Fillosophy] Country code field found:', inp); return inp; }

      ancestor = ancestor.parentElement;
    }
    return null;
  }

  /**
   * Fills a country-code selector with the numeric code (e.g. "91").
   *
   * @param {HTMLElement} element              - The CC select or input.
   * @param {string}      countryCodeNumeric   - Digits only, e.g. "91".
   */
  function fillCountryCodeField(element, countryCodeNumeric) {
    if (!element || !countryCodeNumeric) return;

    if (element.tagName === 'SELECT') {
      const opts = Array.from(element.options);
      const target = countryCodeNumeric.replace(/^\+/, '');
      // Try matching option value or text that contains the numeric code
      const match = opts.find(o =>
        o.value === target || o.value === `+${target}` ||
        o.text.includes(`+${target}`) || o.text.includes(target)
      );
      if (match) {
        element.value = match.value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`[Fillosophy] Country code set to: ${match.value}`);
      }
    } else if (element.tagName === 'INPUT') {
      fillField(element, countryCodeNumeric);
    }
  }

  /**
   * Smart phone filling: chooses the right format (full / number_only) based
   * on field context and also fills any sibling country-code selector.
   *
   * @param {HTMLElement} element      - The phone input element.
   * @param {any}         phoneData    - profile.phone (object or string).
   * @param {Object}      descriptor   - Field descriptor (for context hints).
   * @returns {{ status: string, value: string|null }}
   */
  function fillPhoneNumberField(element, phoneData, descriptor) {
    if (!phoneData) return { status: 'skipped', value: null };

    // Guard: if value is an email address or string with letters, fill directly as text
    if (typeof phoneData === 'string' && (phoneData.includes('@') || /[a-zA-Z]/.test(phoneData))) {
      fillField(element, phoneData);
      return { status: 'filled', value: phoneData };
    }

    // Normalise: handle both structured object and legacy plain string
    let phoneObj;
    if (typeof phoneData === 'object' && phoneData !== null && phoneData.number_only) {
      phoneObj = phoneData;
    } else {
      // Legacy string — parse it on the fly
      const str = String(phoneData).trim();
      const ccMatch = str.match(/^(\+\d{1,3})\s*(.*)/);
      if (ccMatch) {
        phoneObj = {
          full: str,
          country_code: ccMatch[1],
          country_code_numeric: ccMatch[1].replace('+', ''),
          number_only: ccMatch[2].replace(/\D/g, ''),
        };
      } else {
        phoneObj = { full: str, country_code: '+91', country_code_numeric: '91', number_only: str.replace(/\D/g, '') };
      }
    }

    const context = detectPhoneNumberContext(element);
    let valueToFill;

    if (context.expectedFormat === 'with_country_code') {
      valueToFill = phoneObj.full;
    } else {
      // Default: fill number only, handle country code separately
      valueToFill = phoneObj.number_only || phoneObj.full;

      // If there's a separate CC field, fill it too
      if (context.hasCountryCodePrefix) {
        const ccField = findCountryCodeField(element);
        if (ccField) {
          fillCountryCodeField(ccField, phoneObj.country_code_numeric);
        }
      }
    }

    try {
      fillField(element, valueToFill);
      console.log(`[Fillosophy] Phone filled: "${valueToFill}" (format: ${context.expectedFormat})`);
      return { status: 'filled', value: valueToFill };
    } catch (err) {
      console.error('[Fillosophy] Phone fill error:', err);
      return { status: 'skipped', value: null };
    }
  }

  /**
   * Returns true if the field label or type indicates a phone number field.
   * @param {string} label
   * @param {string} type
   * @returns {boolean}
   */
  function isPhoneField(label, type) {
    if (type === 'tel') return true;
    const l = (label || '').toLowerCase();
    return l.includes('phone') || l.includes('mobile') ||
           l.includes('contact number') || l.includes('whatsapp') ||
           l.includes('cell');
  }

  // ════════════════════════════════════════════════════════════
  // GOOGLE FORMS — SPECIALISED DETECTION & FILL
  // ════════════════════════════════════════════════════════════

  /**
   * Detects all question blocks in a Google Form and returns field descriptors
   * compatible with the standard detectFormFields() format.
   *
   * Google Forms does NOT use semantic <input name="..."> elements for all
   * question types. The DOM structure is:
   *
   *   .freebirdFormviewerViewItemsItemItem   ← one per question
   *     .freebirdFormviewerComponentsQuestionBaseTitle  ← question label
   *     input[name^="entry."]  /  textarea[name^="entry."]  ← short answer / paragraph
   *     div[role="radiogroup"] > div[role="radio"]          ← multiple choice
   *     div[role="group"] > div[role="checkbox"]            ← checkboxes
   *     div[role="listbox"]                                 ← dropdown
   *
   * @returns {Object[]} Array of field descriptor objects.
   */
  /**
   * Detects all question blocks in a Google Form and returns field descriptors.
   * @returns {Object[]} Array of field descriptor objects.
   */
  function detectGoogleFormFields() {
    const fields = [];
    let index = 0;

    // 1. Query all form items using [data-item-id] or fallback container selectors
    let items = document.querySelectorAll('[data-item-id]');
    if (items.length === 0) {
      items = document.querySelectorAll('.freebirdFormviewerViewItemsItemItem, [role="listitem"], [data-params]');
    }

    items.forEach((item) => {
      // 2a. Extract question label
      let label = null;
      const heading = item.querySelector('[role="heading"]');
      if (heading && heading.textContent.trim()) {
        label = heading.textContent.trim();
      } else {
        const classTitle = item.querySelector('.M0yp7e, .freebirdFormviewerComponentsQuestionBaseTitle');
        if (classTitle && classTitle.textContent.trim()) {
          label = classTitle.textContent.trim();
        } else {
          label = `Question ${index + 1}`;
        }
      }
      label = label.replace(/\s*\*\s*$/, '').trim();

      // 2b/c. Look for text input / textarea
      const textInput = item.querySelector('input[type="text"], input:not([type="hidden"]), [role="textbox"]');
      const textareaInput = item.querySelector('textarea');

      // 2d. Look for dropdown
      const listbox = item.querySelector('[role="listbox"], [role="button"][jsname]');

      // 2e. Look for radio / checkbox groups
      const radios = item.querySelectorAll('[role="radio"]');
      const checkboxes = item.querySelectorAll('[role="checkbox"]');

      if (textInput || textareaInput) {
        const inp = textInput || textareaInput;
        const descriptor = {
          index: index++,
          itemId: item.getAttribute('data-item-id') || null,
          tag: inp.tagName,
          type: inp.tagName === 'TEXTAREA' ? 'textarea' : 'text',
          label: label,
          name: inp.name || null,
          id: inp.id || null,
          placeholder: inp.placeholder || null,
          element: inp,
          fieldType: inp.tagName === 'TEXTAREA' ? 'googleforms_textarea' : 'googleforms_text',
          _gforms: { kind: 'text', element: inp }
        };
        Object.defineProperty(descriptor, 'element', { value: inp, enumerable: false });
        fields.push(descriptor);

      } else if (listbox) {
        const optionEls = Array.from(item.querySelectorAll('[role="option"]'));
        const options = optionEls.map(o => ({
          value: o.getAttribute('data-value') || o.innerText.trim(),
          element: o
        })).filter(o => o.value);

        const descriptor = {
          index: index++,
          itemId: item.getAttribute('data-item-id') || null,
          tag: 'DIV',
          type: 'select',
          label: label,
          name: null,
          id: listbox.id || null,
          element: listbox,
          fieldType: 'googleforms_dropdown',
          options: options,
          _gforms: { kind: 'listbox', element: listbox, options: options.map(o => o.value) }
        };
        Object.defineProperty(descriptor, 'element', { value: listbox, enumerable: false });
        fields.push(descriptor);

      } else if (radios.length > 0 || checkboxes.length > 0) {
        const isRadio = radios.length > 0;
        const choiceEls = isRadio ? radios : checkboxes;
        const options = Array.from(choiceEls).map(el => ({
          value: el.getAttribute('data-value') || el.innerText.trim(),
          element: el
        })).filter(o => o.value);

        const container = isRadio
          ? (item.querySelector('[role="radiogroup"]') || item)
          : (item.querySelector('[role="group"]') || item);

        const descriptor = {
          index: index++,
          itemId: item.getAttribute('data-item-id') || null,
          tag: 'DIV',
          type: isRadio ? 'radio' : 'checkbox',
          label: label,
          name: null,
          id: container.id || null,
          element: container,
          fieldType: 'googleforms_choice',
          options: options,
          _gforms: {
            kind: isRadio ? 'radio' : 'checkbox',
            container: container,
            options: options.map(o => o.value)
          }
        };
        Object.defineProperty(descriptor, 'element', { value: container, enumerable: false });
        fields.push(descriptor);
      }
    });

    // Fallback: if 0 fields found by items, scan direct input elements
    if (fields.length === 0) {
      const allInputs = document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]), textarea'
      );
      allInputs.forEach((el) => {
        if (!isVisible(el)) return;
        const label = getGFormsLabel(el);
        if (!label) return;
        const descriptor = {
          index: index++,
          itemId: null,
          tag: el.tagName,
          type: el.tagName === 'TEXTAREA' ? 'textarea' : 'text',
          label: label,
          name: el.name || null,
          id: el.id || null,
          placeholder: el.placeholder || null,
          element: el,
          fieldType: el.tagName === 'TEXTAREA' ? 'googleforms_textarea' : 'googleforms_text',
          _gforms: { kind: 'text', element: el }
        };
        Object.defineProperty(descriptor, 'element', { value: el, enumerable: false });
        fields.push(descriptor);
      });
    }

    console.log(`[Fillosophy Content] Detected ${fields.length} Google Form fields`);
    return fields;
  }

  /**
   * Resolves the label for a Google Forms element by walking up its DOM ancestors.
   * Uses multiple strategies since GForms class names change across renderer versions.
   *
   * @param {HTMLElement} el
   * @returns {string|null}
   */
  function getGFormsLabel(el) {
    // Strategy 1 — aria-label directly on the element.
    // GForms always sets aria-label on text inputs to the question title.
    // We check this FIRST because it's clean (just the title, no description).
    // aria-labelledby is checked second because it often joins title + description + "*".
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) {
      // Strip trailing " *" that GForms appends to required question labels
      return ariaLabel.trim().replace(/\s*\*\s*$/, '').trim();
    }

    // Strategy 2 — aria-labelledby: use ONLY THE FIRST referenced element.
    // GForms sets aria-labelledby="title-id description-id required-id" — joining
    // all of them gives "Full Name Some description here *" which is too long.
    // Taking only the first ID gives just the question title.
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const firstId = labelledBy.trim().split(/\s+/)[0];
      const titleEl = document.getElementById(firstId);
      if (titleEl) {
        const text = titleEl.innerText?.trim().replace(/\s*\*\s*$/, '').trim();
        if (text && text.length > 0 && text.length < 150) return text;
      }
    }

    // Strategy 3 — Walk up ancestors, checking DIRECT CHILDREN for a heading.
    // Uses Array.from(children).find() NOT querySelector() to avoid picking up
    // page-level headings from the full subtree search.
    let ancestor = el.parentElement;
    for (let depth = 0; depth < 12 && ancestor && ancestor !== document.body; depth++) {
      const directHeading = Array.from(ancestor.children).find(
        child =>
          child.getAttribute('role') === 'heading' ||
          /^H[1-6]$/.test(child.tagName)
      );
      if (directHeading) {
        const text = directHeading.innerText.trim().replace(/\s*\*\s*$/, '').trim();
        if (text && text.length > 0 && text.length < 150) return text;
      }
      ancestor = ancestor.parentElement;
    }

    return null;
  }

  /**
   * Fills a Google Forms text field or textarea with full event dispatching.
   *
   * @param {HTMLElement} element - The text input or textarea DOM element.
   * @param {string}      value   - The string value to fill.
   * @returns {{ status: string, value: string, error?: string }}
   */
  function fillGoogleFormTextField(element, value) {
    try {
      if (!element) return { status: 'skipped', value: null };

      console.log('[Fillosophy] Step: Attempting to fill text field');
      console.log('[Fillosophy] Found element:', element);
      console.log('[Fillosophy] Setting value to:', value);

      element.focus();

      // Native setter call
      const proto = element.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(element, value);
      } else {
        element.value = value;
      }

      // execCommand as primary interaction
      try {
        if (element.select) element.select();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, value);
      } catch (cmdErr) {
        // Fallback if execCommand is unsupported
      }

      // Dispatch events in exact order: input, change, keydown, keyup, blur
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));

      // Framework / React synthetic event dispatching
      if (element.__reactFiber$ || element.__ngContext$) {
        const evt = new Event('input', { bubbles: true });
        Object.defineProperty(evt, 'target', {
          value: element,
          enumerable: true,
        });
        element.dispatchEvent(evt);
      }

      // Verification check after 100ms
      setTimeout(() => {
        if (element.value !== value) {
          console.warn(`[Fillosophy] Value mismatch: expected "${value}", got "${element.value}"`);
        }
      }, 100);

      const result = { status: 'filled', value: value };
      console.log('[Fillosophy] Result:', result);
      return result;
    } catch (error) {
      console.error('[Fillosophy] fillGoogleFormTextField failed:', error);
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Fills a single Google Forms field using the appropriate interaction method.
   * GForms uses Angular internals that require InputEvent (not Event) for text,
   * and real DOM clicks for radio/checkbox/dropdown.
   *
   * @param {Object} descriptor - Field descriptor from detectGoogleFormFields().
   * @param {string} value      - Value to fill.
   * @returns {boolean} True if successfully filled.
   */
  function fillGoogleFormField(descriptor, value) {
    try {
      const gf = descriptor._gforms;
      if (!gf) return false;

      if (gf.kind === 'text') {
        const el = gf.element;
        el.focus();
        // Select all existing content and replace
        el.select && el.select();
        // Use execCommand as primary method — works reliably in GForms
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, value);
        // Also set via native setter + InputEvent as fallback
        const proto = el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, value);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      if (gf.kind === 'radio') {
        const target = String(value).toLowerCase();
        const radios = gf.container.querySelectorAll('[role="radio"]');
        for (const radio of radios) {
          const optVal = (radio.getAttribute('data-value') || radio.innerText).toLowerCase().trim();
          if (optVal === target || optVal.includes(target) || target.includes(optVal)) {
            radio.click();
            return true;
          }
        }
        return false;
      }

      if (gf.kind === 'checkbox') {
        const targets = String(value).toLowerCase().split(/[,;]/).map((s) => s.trim());
        const checkboxes = gf.container.querySelectorAll('[role="checkbox"]');
        let filled = false;
        for (const cb of checkboxes) {
          const optVal = (cb.getAttribute('data-value') || cb.innerText).toLowerCase().trim();
          const shouldCheck = targets.some(
            (t) => t === optVal || t.includes(optVal) || optVal.includes(t)
          );
          const isChecked = cb.getAttribute('aria-checked') === 'true';
          if (shouldCheck && !isChecked) { cb.click(); filled = true; }
        }
        return filled;
      }

      if (gf.kind === 'listbox') {
        // Open the dropdown
        gf.element.click();
        const target = String(value).toLowerCase();
        // Wait a tick for options to render, then click the matching option
        setTimeout(() => {
          const options = document.querySelectorAll('[role="option"]');
          for (const opt of options) {
            const optText = (opt.getAttribute('data-value') || opt.innerText).toLowerCase().trim();
            if (optText === target || optText.includes(target) || target.includes(optText)) {
              opt.click();
              return;
            }
          }
        }, 150);
        return true;
      }
    } catch (err) {
      console.error('[Fillosophy Content] fillGoogleFormField error:', err);
    }
    return false;
  }

  // ════════════════════════════════════════════════════════════
  // OVERLAY RENDERER
  // ════════════════════════════════════════════════════════════

  /**
   * Renders the Fillosophy confidence overlay panel anchored to the
   * bottom-right of the page, matching the SmartFill preview design.
   *
   * @param {Object} summary - Result object from applyAutofill().
   */
  function renderOverlay(summary) {
    // Step 1 — Remove any existing overlay
    const existing = document.getElementById('fillosophy-overlay');
    if (existing) existing.remove();

    // Step 2 — Inject CSS once
    if (!document.getElementById('fillosophy-overlay-styles')) {
      const style = document.createElement('style');
      style.id = 'fillosophy-overlay-styles';
      style.textContent = `
        #fillosophy-overlay {
          position: fixed;
          bottom: 16px;
          right: 16px;
          width: 320px;
          max-height: 420px;
          overflow-y: auto;
          background: #ffffff;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.15);
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 13px;
          z-index: 2147483647;
          border: 1px solid #e5e7eb;
          animation: fillosophy-slide-in 0.25s ease;
        }
        @keyframes fillosophy-slide-in {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fillosophy-overlay-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: #2563EB;
          color: white;
          border-radius: 12px 12px 0 0;
          font-weight: 600;
          font-size: 13px;
          position: sticky;
          top: 0;
        }
        .fillosophy-overlay-close {
          cursor: pointer;
          font-size: 18px;
          background: none;
          border: none;
          color: white;
          line-height: 1;
          padding: 0 2px;
          opacity: 0.85;
        }
        .fillosophy-overlay-close:hover { opacity: 1; }
        .fillosophy-stats-bar {
          display: flex;
          gap: 0;
          background: #f0f7ff;
          border-bottom: 1px solid #e5e7eb;
        }
        .fillosophy-stat-pill {
          flex: 1;
          text-align: center;
          padding: 6px 4px;
          font-size: 11px;
          font-weight: 600;
          color: #374151;
        }
        .fillosophy-stat-pill span {
          display: block;
          font-size: 16px;
          font-weight: 700;
        }
        .fillosophy-stat-pill.green span { color: #16a34a; }
        .fillosophy-stat-pill.amber span { color: #d97706; }
        .fillosophy-stat-pill.gray span  { color: #6b7280; }
        .fillosophy-field-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 9px 16px;
          border-bottom: 1px solid #f3f4f6;
          gap: 8px;
        }
        .fillosophy-field-left {
          display: flex;
          flex-direction: column;
          min-width: 0;
          flex: 1;
        }
        .fillosophy-field-label {
          font-weight: 500;
          color: #111827;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fillosophy-field-value {
          color: #6b7280;
          font-size: 11px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fillosophy-badge {
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 99px;
        }
        .fillosophy-confidence-high {
          color: #16a34a;
          background: #dcfce7;
        }
        .fillosophy-confidence-mid {
          color: #374151;
          background: #f3f4f6;
        }
        .fillosophy-confidence-low {
          color: #d97706;
          background: #fef3c7;
        }
        .fillosophy-overlay-footer {
          display: flex;
          gap: 8px;
          padding: 12px 16px;
          background: #fafafa;
          border-top: 1px solid #e5e7eb;
          border-radius: 0 0 12px 12px;
          position: sticky;
          bottom: 0;
        }
        .fillosophy-btn-primary {
          flex: 1;
          background: #2563EB;
          color: white;
          border: none;
          border-radius: 6px;
          padding: 8px;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          font-family: inherit;
          transition: background 0.15s;
        }
        .fillosophy-btn-primary:hover { background: #1d4ed8; }
        .fillosophy-btn-secondary {
          flex: 1;
          background: #fef3c7;
          color: #92400e;
          border: none;
          border-radius: 6px;
          padding: 8px;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          font-family: inherit;
          transition: background 0.15s;
        }
        .fillosophy-btn-secondary:hover { background: #fde68a; }
      `;
      document.head.appendChild(style);
    }

    // Step 3 — Build overlay DOM
    const overlay = document.createElement('div');
    overlay.id = 'fillosophy-overlay';

    // Header
    const header = document.createElement('div');
    header.className = 'fillosophy-overlay-header';
    header.innerHTML = `<span>🧠 Fillosophy — Autofill Preview</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'fillosophy-overlay-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    header.appendChild(closeBtn);
    overlay.appendChild(header);

    // Stats bar
    const statsBar = document.createElement('div');
    statsBar.className = 'fillosophy-stats-bar';
    statsBar.innerHTML = `
      <div class="fillosophy-stat-pill green"><span>${summary.filled}</span>Filled</div>
      <div class="fillosophy-stat-pill amber"><span>${summary.flagged}</span>Flagged</div>
      <div class="fillosophy-stat-pill gray"><span>${summary.skipped}</span>Skipped</div>
    `;
    overlay.appendChild(statsBar);

    // Field rows
    const scrollArea = document.createElement('div');
    for (const detail of summary.details) {
      const row = document.createElement('div');
      row.className = 'fillosophy-field-row';

      const truncatedValue = detail.value != null && String(detail.value).length > 30
        ? String(detail.value).slice(0, 30) + '…'
        : String(detail.value ?? '—');

      let badgeClass = 'fillosophy-confidence-high';
      if (detail.confidence < 70) badgeClass = 'fillosophy-confidence-low';
      else if (detail.confidence < 80) badgeClass = 'fillosophy-confidence-mid';

      row.innerHTML = `
        <div class="fillosophy-field-left">
          <span class="fillosophy-field-label">${detail.label}</span>
          <span class="fillosophy-field-value">${truncatedValue}</span>
        </div>
        <span class="fillosophy-badge ${badgeClass}">${detail.confidence}%</span>
      `;
      scrollArea.appendChild(row);
    }
    overlay.appendChild(scrollArea);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'fillosophy-overlay-footer';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'fillosophy-btn-primary';
    applyBtn.textContent = `Apply All (${summary.filled + summary.flagged})`;
    footer.appendChild(applyBtn);

    if (summary.flagged > 0) {
      const reviewBtn = document.createElement('button');
      reviewBtn.className = 'fillosophy-btn-secondary';
      reviewBtn.textContent = `Review (${summary.flagged}) ⚠`;
      reviewBtn.addEventListener('click', () => {
        scrollToFlaggedFields();
      });
      footer.appendChild(reviewBtn);
    }

    overlay.appendChild(footer);

    // Step 4 — Event listeners
    closeBtn.addEventListener('click', () => overlay.remove());
    applyBtn.addEventListener('click', () => {
      confirmAllFields();
      overlay.remove();
    });

    // Step 5 — Mount
    document.body.appendChild(overlay);
    console.log(`[Fillosophy Content] Overlay rendered with ${summary.details.length} fields`);
  }

  // ════════════════════════════════════════════════════════════
  // OVERLAY HELPERS
  // ════════════════════════════════════════════════════════════

  /**
   * Confirms all flagged low-confidence fields — removes amber highlight,
   * applies a green confirmed state, clears all outlines, removes overlay.
   */
  function confirmAllFields() {
    const flagged = document.querySelectorAll('[data-fillosophy-flag="low-confidence"]');
    flagged.forEach((el) => {
      el.removeAttribute('data-fillosophy-flag');
      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.border = '2px solid #16a34a';
      el.style.backgroundColor = '#f0fdf4';
    });
    // Also clear any remaining green outlines from high-confidence fields
    document.querySelectorAll('input[style*="outline"], select[style*="outline"], textarea[style*="outline"]')
      .forEach((el) => { el.style.outline = ''; el.style.outlineOffset = ''; });
    // Remove the overlay
    const overlay = document.getElementById('fillosophy-overlay');
    if (overlay) overlay.remove();
    console.log(`[Fillosophy Content] All fields confirmed by user (${flagged.length} flagged cleared).`);
  }

  /**
   * Scrolls to the first low-confidence field and pulses all flagged
   * fields with a CSS animation for 2 seconds.
   */
  function scrollToFlaggedFields() {
    const flaggedEls = document.querySelectorAll('[data-fillosophy-flag="low-confidence"]');
    if (!flaggedEls.length) return;

    // Inject pulse keyframes once
    if (!document.getElementById('fillosophy-pulse-styles')) {
      const ps = document.createElement('style');
      ps.id = 'fillosophy-pulse-styles';
      ps.textContent = `
        @keyframes fillosophy-pulse-anim {
          0%, 100% { box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.4); }
          50%       { box-shadow: 0 0 0 6px rgba(217, 119, 6, 0); }
        }
        .fillosophy-pulse {
          animation: fillosophy-pulse-anim 0.6s ease-in-out 3;
        }
      `;
      document.head.appendChild(ps);
    }

    // Scroll to the first flagged element
    flaggedEls[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Add pulse class to all flagged elements, remove after 2 s
    flaggedEls.forEach((el) => el.classList.add('fillosophy-pulse'));
    setTimeout(() => {
      flaggedEls.forEach((el) => el.classList.remove('fillosophy-pulse'));
    }, 2000);

    console.log(`[Fillosophy Content] Scrolled to ${flaggedEls.length} flagged fields`);
    // NOTE: Overlay intentionally left open so user can continue reviewing
  }

})();
