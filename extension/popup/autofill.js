import { state } from './state.js';
import { sendMessage } from './utils.js';
import { applyTemplateMatching } from '../utils/templates.js';

/**
 * Called every time the Autofill tab becomes active.
 * Fetches live page info from the content script and the active profile
 * from chrome.storage via the service worker, then updates the UI.
 */
export async function loadAutofillTab() {
  // Grab all the elements we'll update
  const urlEl            = document.getElementById('current-page-url');
  const fieldsFoundEl    = document.getElementById('stat-fields-found');
  const highConfidenceEl = document.getElementById('stat-high-confidence');
  const needsReviewEl    = document.getElementById('stat-needs-review');
  const activeProfileEl  = document.getElementById('active-profile-name');
  const autofillBtn      = document.getElementById('autofill-btn');
  const tabStatus        = document.getElementById('autofill-tab-status');

  // Step 1: loading state
  if (urlEl)         urlEl.textContent         = 'Scanning page…';
  if (fieldsFoundEl) fieldsFoundEl.textContent = '—';
  if (highConfidenceEl) highConfidenceEl.textContent = '—';
  if (needsReviewEl)    needsReviewEl.textContent    = '—';
  if (tabStatus)     { tabStatus.textContent = ''; tabStatus.className = 'upload-status'; }
  if (autofillBtn)   autofillBtn.disabled      = true; // Disable until everything is ready

  // Step 1a: PING — verify content script is reachable before proceeding
  try {
    const ping = await sendMessage('PING_CONTENT');
    if (ping?.status !== 'content_script_ready') {
      throw new Error(ping?.message ?? 'Content script did not respond');
    }
  } catch (pingErr) {
    console.warn('[Fillosophy] PING_CONTENT failed:', pingErr.message);
    if (urlEl)     urlEl.textContent     = 'Unavailable';
    if (tabStatus) {
      tabStatus.textContent = '⚠ Fillosophy cannot access this page. Navigate to a website with a form and try again.';
      tabStatus.className   = 'upload-status error';
    }
    if (autofillBtn) autofillBtn.disabled = true;
    return; // abort — no point calling GET_PAGE_INFO or DETECT_FIELDS
  }

  // Step 2: GET_PAGE_INFO via service worker
  try {
    const pageInfo = await sendMessage('GET_PAGE_INFO');
    if (pageInfo?.status === 'error') {
      throw new Error(pageInfo.message ?? 'Content script not reachable');
    }
    state.currentPageUrl = pageInfo.url ?? null;
    if (urlEl) urlEl.textContent = state.currentPageUrl ?? 'Unknown URL';
    console.log(`[Fillosophy] Page info loaded — ${pageInfo.fieldCount} field(s) on ${state.currentPageUrl}`);
  } catch (pageErr) {
    console.warn('[Fillosophy] GET_PAGE_INFO failed:', pageErr.message);
    if (urlEl)       urlEl.textContent       = 'Unavailable';
    if (tabStatus) {
      tabStatus.textContent = '⚠ Fillosophy cannot read this page. Try refreshing or navigate to a page with a form.';
      tabStatus.className   = 'upload-status error';
    }
    if (autofillBtn) autofillBtn.disabled = true;
    return;
  }

  // Step 3: GET_ACTIVE_PROFILE via service worker
  try {
    const profileRes = await sendMessage('GET_ACTIVE_PROFILE');
    if (profileRes?.status === 'ok') {
      const name = profileRes.profileName ?? 'Unknown';
      if (activeProfileEl) activeProfileEl.textContent = name;
      state.currentProfile = profileRes.profile;
      console.log(`[Fillosophy] Active profile loaded: ${name}`);
    } else {
      if (activeProfileEl) activeProfileEl.textContent = 'None';
      if (tabStatus) {
        tabStatus.textContent = '⚠ No profile loaded. Upload a resume first.';
        tabStatus.className   = 'upload-status error';
      }
      if (autofillBtn) autofillBtn.disabled = true;
      console.warn('[Fillosophy] No active profile found in storage.');
      return;
    }
  } catch (profileErr) {
    console.warn('[Fillosophy] GET_ACTIVE_PROFILE failed:', profileErr.message);
    if (activeProfileEl) activeProfileEl.textContent = 'Unknown';
    if (tabStatus) {
      tabStatus.textContent = '⚠ Could not load profile data.';
      tabStatus.className   = 'upload-status error';
    }
    if (autofillBtn) autofillBtn.disabled = true;
    return;
  }

  // Step 4: Collect full field labels
  try {
    state.fieldLabels = await collectFieldLabels();
    if (fieldsFoundEl) fieldsFoundEl.textContent = state.fieldLabels.length;
    console.log('[Fillosophy] Field labels:', state.fieldLabels);

    if (state.fieldLabels.length === 0) {
      if (fieldsFoundEl) fieldsFoundEl.textContent = '0';
      if (tabStatus) {
        tabStatus.textContent = '⚠ No form fields detected on this page.';
        tabStatus.className   = 'upload-status error';
      }
      if (autofillBtn) autofillBtn.disabled = true;
      console.log('[Fillosophy] No fields detected — autofill disabled');
      return;
    }
  } catch (labelErr) {
    console.warn('[Fillosophy] collectFieldLabels failed:', labelErr.message);
    if (tabStatus) {
      tabStatus.textContent = '⚠ Failed to detect form fields on this page.';
      tabStatus.className   = 'upload-status error';
    }
    if (autofillBtn) autofillBtn.disabled = true;
    return;
  }

  // Step 5: previewMatch — skip if mapping is fresh (< 60 s old)
  const isStale = !state.lastMatchTimestamp || (Date.now() - state.lastMatchTimestamp > 60_000);
  if (isStale) {
    await previewMatch();
  } else {
    console.log('[Fillosophy] Using cached mapping — last match was < 60 s ago.');
    // Still re-enable the button with the cached mapping
    if (autofillBtn) autofillBtn.disabled = false;
  }
}

/**
 * Calls the /match endpoint to get a preview of the fill confidence.
 * Records lastMatchTimestamp on success and wires the Autofill button.
 *
 * Template-first strategy:
 *   1. Try applyTemplateMatching() for the current page URL.
 *   2. If ALL fields matched via template → skip the /match API call.
 *   3. If SOME matched → send only unmatched fields to /match, then merge.
 *   4. If no template exists → full AI matching (original behaviour).
 */
export async function previewMatch() {
  if (state.fieldLabels.length === 0 || !state.currentProfile) return;

  const highConfidenceEl = document.getElementById('stat-high-confidence');
  const needsReviewEl    = document.getElementById('stat-needs-review');
  const tabStatus        = document.getElementById('autofill-tab-status');
  const autofillBtn      = document.getElementById('autofill-btn');
  const fieldsFoundEl    = document.getElementById('stat-fields-found');

  if (highConfidenceEl) highConfidenceEl.textContent = '...';
  if (needsReviewEl)    needsReviewEl.textContent    = '...';

  try {
    // Step A: Try template matching first
    const templateResult = applyTemplateMatching(state.fieldLabels, state.currentProfile, state.currentPageUrl);

    if (templateResult && templateResult.unmatched.length === 0) {
      // Fully matched via template — skip AI entirely
      state.fieldMapping       = templateResult.matched;
      state.lastMatchTimestamp = Date.now();

      const totalFields    = Object.keys(state.fieldMapping).length;
      const highConfidence = totalFields; // template confidence is always high
      const needsReview    = 0;

      if (fieldsFoundEl)    fieldsFoundEl.textContent    = totalFields;
      if (highConfidenceEl) highConfidenceEl.textContent = highConfidence;
      if (needsReviewEl)    needsReviewEl.textContent    = needsReview;

      if (tabStatus) {
        tabStatus.textContent = 'All fields matched via template — no AI call needed.';
        tabStatus.className   = 'upload-status success';
      }

      console.log(`[Fillosophy] Fully matched via template, skipping AI call (${totalFields} fields)`);

    } else {
      // Determine which fields to send to AI
      const fieldsForAI       = templateResult ? templateResult.unmatched : state.fieldLabels;
      const templateMatched   = templateResult ? templateResult.matched   : {};
      const templateMatchCount = Object.keys(templateMatched).length;

      if (templateResult) {
        console.log(
          `[Fillosophy] ${templateMatchCount} matched via template, ` +
          `${fieldsForAI.length} sent to AI`
        );
      }

      // Call /match with only the fields that need AI
      const response = await fetch('http://localhost:8000/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: state.currentProfile, fields: fieldsForAI }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data     = await response.json();
      const aiMapping = data.mapping || {};

      // Merge: template matches (high confidence) + AI matches
      state.fieldMapping       = { ...templateMatched, ...aiMapping };
      state.lastMatchTimestamp  = Date.now();

      // Recompute stats from the merged mapping
      const totalFields    = Object.keys(state.fieldMapping).length;
      const highConfidence = Object.values(state.fieldMapping)
        .filter((m) => (m.confidence ?? 0) >= 80).length;
      const needsReview    = totalFields - highConfidence;

      if (fieldsFoundEl)    fieldsFoundEl.textContent    = totalFields;
      if (highConfidenceEl) highConfidenceEl.textContent = highConfidence;
      if (needsReviewEl)    needsReviewEl.textContent    = needsReview;

      if (needsReview > 0) {
        if (tabStatus) {
          tabStatus.textContent = `⚠ ${needsReview} field(s) will be flagged for review.`;
          tabStatus.className   = 'upload-status amber';
        }
      } else {
        if (tabStatus) {
          const extra = templateMatchCount > 0
            ? ` (${templateMatchCount} via template)`
            : '';
          tabStatus.textContent = `All fields matched with high confidence${extra}.`;
          tabStatus.className   = 'upload-status success';
        }
      }

      console.log('[Fillosophy] Match preview complete. Mapping ready.');
    }

    // Wire autofill button (shared for both template-only and AI paths)
    if (autofillBtn) {
      autofillBtn.disabled = false;

      // Clone to remove any previous listener before attaching a fresh one
      const freshBtn = autofillBtn.cloneNode(true);
      autofillBtn.parentNode.replaceChild(freshBtn, autofillBtn);

      freshBtn.addEventListener('click', async () => {
        const showError = (msg) => {
          const el = document.getElementById('autofill-tab-status');
          if (el) { el.textContent = msg; el.className = 'upload-status error'; }
        };

        // Guard 1 — mapping must exist
        if (!state.fieldMapping || Object.keys(state.fieldMapping).length === 0) {
          showError('⚠ No field matches available. Reopen this tab to rescan.');
          return;
        }
        // Guard 2 — fields must be detected
        if (!state.detectedFields || state.detectedFields.length === 0) {
          showError('⚠ No fields detected on this page.');
          return;
        }

        // Loading state
        freshBtn.disabled    = true;
        freshBtn.textContent = 'Filling form…';
        // Always re-query — the clone swap may have detached the old reference
        const getStatus = () => document.getElementById('autofill-tab-status');
        const st = getStatus();
        if (st) { st.textContent = ''; st.className = 'upload-status'; }

        try {
          const res = await sendMessage('APPLY_AUTOFILL', {
            mapping: state.fieldMapping,
            fields:  state.detectedFields
          });

          const summary = res?.summary ?? {};
          const filled  = summary.filled  ?? 0;
          const flagged = summary.flagged ?? 0;

          // Update stats row with post-fill numbers
          const hcEl = document.getElementById('stat-high-confidence');
          const nrEl = document.getElementById('stat-needs-review');
          if (hcEl) hcEl.textContent = filled;
          if (nrEl) nrEl.textContent = flagged;

          // Status message
          const st2 = getStatus();
          if (st2) {
            if (flagged > 0) {
              st2.textContent = `Filled ${filled} field(s). ${flagged} flagged for your review on the page.`;
              st2.className   = 'upload-status amber';
            } else {
              st2.textContent = `All ${filled} field(s) filled successfully!`;
              st2.className   = 'upload-status success';
            }
          }

          console.log('[Fillosophy] Autofill applied:', summary);

        } catch (err) {
          console.error('[Fillosophy] Autofill failed:', err);
          const st3 = getStatus();
          if (st3) {
            st3.textContent = `✗ Autofill failed. ${err.message}`;
            st3.className   = 'upload-status error';
          }
        } finally {
          freshBtn.disabled    = false;
          freshBtn.textContent = 'Autofill This Form';
        }
      });
    }

  } catch (err) {
    console.error('[Fillosophy] Match preview failed:', err);
    if (tabStatus) {
      tabStatus.textContent = '⚠️ The backend server is offline. Please start it to map fields.';
      tabStatus.className   = 'upload-status error';
    }
    if (autofillBtn) autofillBtn.disabled = true;
  }
}

/**
 * Sends DETECT_FIELDS to the service worker, stores the full descriptor
 * objects in state.detectedFields, and returns a flat array of best-available
 * label strings for the AI /match endpoint.
 *
 * Priority order per descriptor:
 *   label → placeholder → ariaLabel → name → id → "field_{index}"
 *
 * @returns {Promise<string[]>} One label string per detected field.
 */
export async function collectFieldLabels() {
  const response = await sendMessage('DETECT_FIELDS');

  if (response?.status !== 'ok') {
    throw new Error(`DETECT_FIELDS returned status: ${response?.status ?? 'undefined'}`);
  }

  // Store full descriptors
  state.detectedFields = response.fields ?? [];

  // Build the label list using the specified priority order
  const labels = state.detectedFields.map((d) =>
    d.label       ??
    d.placeholder ??
    d.ariaLabel   ??
    d.name        ??
    d.id          ??
    `field_${d.index}`
  );

  console.log(`[Fillosophy] Collected ${labels.length} field labels for matching`);
  return labels;
}
