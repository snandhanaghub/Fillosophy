(function () {
  'use strict';
  window.Fillosophy = window.Fillosophy || {};

  // LABEL RESOLUTION

  /**
   * Resolves the human-readable label for a form element.
   * Tries five strategies in order and returns the first non-empty result.
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
      const referred = document.getElementById(labelledBy);
      if (referred) {
        const text = referred.innerText.trim();
        if (text) return text;
      }
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

    return null;
  }

  // FIELD DETECTION

  /**
   * Determines if an element is visible to the user.
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return (
      style.display    !== 'none'   &&
      style.visibility !== 'hidden' &&
      el.offsetParent  !== null
    );
  }

  /**
   * Queries all fillable form elements on the page, builds a structured
   * descriptor for each one, and filters out those with no identifiable context.
   *
   * @returns {Object[]} Array of field descriptor objects.
   */
  function detectFormFields() {
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
      const descriptor = {
        index:       i,
        tag:         element.tagName,
        type:        element.type        ?? null,
        name:        element.name        || null,
        id:          element.id          || null,
        placeholder: element.placeholder || null,
        label:       getLabelText(element),
        ariaLabel:   element.getAttribute('aria-label') ?? null,
        required:    element.required    ?? false,
        value:       element.value       ?? null,
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

  // SPA RESILIENCE — waitForStableForm

  /**
   * Waits until the number of form fields on the page is stable
   * for two consecutive 300ms debounce cycles, or until timeoutMs
   * has elapsed — whichever comes first.
   *
   * Designed for SPA portals (React / Vue / Angular) where forms render
   * asynchronously after the initial page load.
   *
   * @param {number} timeoutMs - Maximum wait time in milliseconds.
   * @returns {Promise<void>}
   */
  function waitForStableForm(timeoutMs = 3000) {
    return new Promise((resolve) => {
      const startTime  = Date.now();
      // Wait for DOM to stabilise
      let lastCount   = 0;
      let stableCount = 0;
      let debounceTid = null;

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

          const elapsed = Date.now() - startTime;

          // Resolve when stable for 2 consecutive cycles, or on timeout
          if (stableCount >= 2 || elapsed >= timeoutMs) {
            observer.disconnect();
            clearTimeout(debounceTid);
            console.log(
              `[Fillosophy Content] Form stabilized after ${elapsed}ms`,
              `(${lastCount} fields found)`
            );
            resolve();
          } else {
            // Kick off the next check manually in case there are no mutations (static pages)
            checkStability();
          }
        }, 300);
      };

      const observer = new MutationObserver(() => {
        // Reset stability counter if a mutation happens
        stableCount = 0;
        checkStability();
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Start the first check cycle immediately
      checkStability();

      // Hard timeout fallback — always disconnect and resolve
      setTimeout(() => {
        observer.disconnect();
        clearTimeout(debounceTid);
        const elapsed = Date.now() - startTime;
        console.log(
          `[Fillosophy Content] Form stabilized after ${elapsed}ms (timeout),`,
          `${detectFormFields().length} fields found`
        );
        resolve();
      }, timeoutMs);
    });
  }

  // Publish to Fillosophy namespace
  window.Fillosophy.getLabelText = getLabelText;
  window.Fillosophy.isVisible = isVisible;
  window.Fillosophy.detectFormFields = detectFormFields;
  window.Fillosophy.waitForStableForm = waitForStableForm;

})();
