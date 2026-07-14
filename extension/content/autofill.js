(function () {
  'use strict';
  window.Fillosophy = window.Fillosophy || {};

  /**
   * Tracks whether autofill has run at least once on this page load.
   * Used by the watcher to only trigger rescan logs after the first fill.
   */
  window.Fillosophy.autofillHasRun = false;

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
  }

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

    if (typeof window.Fillosophy.detectFormFields !== 'function') {
      console.warn('[Fillosophy Content] detectFormFields not available.');
      return { filledCount: 0 };
    }

    const fields = window.Fillosophy.detectFormFields();
    let filledCount = 0;

    for (const field of fields) {
      // Note: matchFieldToProfile is a legacy call that remains preserved
      const value = typeof window.Fillosophy.matchFieldToProfile === 'function'
        ? window.Fillosophy.matchFieldToProfile(field, profile)
        : (typeof matchFieldToProfile === 'function' ? matchFieldToProfile(field, profile) : null);

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
    const elements = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"])' +
      ':not([type="reset"]):not([type="image"]):not([type="file"]),' +
      'select, textarea'
    );

    const labelToElementMap = {};
    for (const descriptor of fieldDescriptors) {
      const el = elements[descriptor.index];
      if (!el) continue;

      // MUST use the exact same priority as collectFieldLabels() in popup.js
      // so that mapping keys from /match line up with the right elements.
      let label =
        descriptor.label       ??
        descriptor.placeholder ??
        descriptor.ariaLabel   ??
        descriptor.name        ??
        descriptor.id          ??
        `field_${descriptor.index}`;

      // Deduplicate: if this label already exists in the map, append
      // the field index to make it unique. This must match the same
      // deduplication logic in the DETECT_FIELDS handler.
      if (label in labelToElementMap) {
        label = `${label} (${descriptor.index})`;
      }

      labelToElementMap[label] = el;
    }

    // Debug — surface the map so mismatches can be spotted in DevTools
    console.log('[Fillosophy Content] labelToElementMap keys:', Object.keys(labelToElementMap));
    console.log('[Fillosophy Content] mapping keys:', Object.keys(mapping));

    const results = [];
    const summary = { filled: 0, flagged: 0, skipped: 0, details: [] };

    for (const [label, fieldData] of Object.entries(mapping)) {
      const element = labelToElementMap[label];

      if (!element || fieldData.value == null || element.disabled || element.readOnly) {
        continue;
      }

      let status = "filled";

      if (fieldData.confidence < 70) {
        element.setAttribute("data-fillosophy-flag", "low-confidence");
        element.style.border = "2px solid #D97706";
        element.style.backgroundColor = "#FEF3C7";
        status = "low_confidence";
      }

      const tagName = element.tagName.toLowerCase();
      const type = (element.type || "").toLowerCase();

      try {
        if (tagName === 'input' && (type === 'checkbox' || type === 'radio')) {
          if (type === 'checkbox') {
            const valStr = String(fieldData.value).toLowerCase();
            element.checked = ["yes", "true", "1"].includes(valStr) || fieldData.value === true;
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
            if (!matched) status = "skipped";
          }
        } else if (tagName === 'select') {
          let matched = false;
          const options = element.options;
          const targetValue = String(fieldData.value).toLowerCase();
          for (let i = 0; i < options.length; i++) {
            const optVal = options[i].value.toLowerCase();
            const optText = options[i].text.toLowerCase();
            if (!optVal) continue; // Skip default empty options like "Select a degree"

            if (optVal === targetValue || 
                optText === targetValue || 
                optText.includes(targetValue) ||
                targetValue.includes(optVal) ||
                targetValue.includes(optText) ||
                // Basic degree fuzzy mapping
                (targetValue.includes('b.tech') && optVal.includes('bachelor')) ||
                (targetValue.includes('b.e') && optVal.includes('bachelor')) ||
                (targetValue.includes('master') && optVal.includes('master')) ||
                (targetValue.includes('phd') && optVal.includes('phd'))) {
              element.value = options[i].value;
              element.dispatchEvent(new Event('change', { bubbles: true }));
              matched = true;
              break;
            }
          }
          if (!matched) status = "skipped";
        } else {
          fillField(element, String(fieldData.value));
        }
      } catch (err) {
        console.error(`[Fillosophy Content] Error filling ${label}:`, err);
        status = "skipped";
      }

      // Visual outline highlighting
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
    window.Fillosophy.autofillHasRun = true;
    console.log(`[Fillosophy Content] Autofill complete:`, summary);

    // Auto-clear outlines after 8 s OR on next page click
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

    if (typeof window.Fillosophy.renderOverlay === 'function') {
      window.Fillosophy.renderOverlay(summary);
    }

    return summary;
  }

  // Publish to Fillosophy namespace
  window.Fillosophy.fillField = fillField;
  window.Fillosophy.handleAutofill = handleAutofill;
  window.Fillosophy.applyAutofill = applyAutofill;

})();
