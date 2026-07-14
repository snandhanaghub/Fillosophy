import { ACCEPTED_MIME, EXTRACT_URL } from './constants.js';
import { state } from './state.js';
import { setStatus, setLoadingState } from './utils.js';
import { saveProfile, setActiveProfile, getActiveProfile } from '../utils/storage.js';
import { displayProfile } from './profiles.js';
import { switchTab } from './tabs.js';

/**
 * Wires all dropzone interactions.
 * Both drag-drop and file-input change call applyFileSelection(file).
 *
 * @param {Object} els - Named DOM references.
 */
export function initDropzone(els) {
  const { dropzone, fileInput, dropzoneTitle, dropzoneSub,
          extractBtn, uploadStatus } = els;

  if (!dropzone || !fileInput) {
    console.warn('[Fillosophy Upload] Dropzone or file input not found.');
    return;
  }

  // Click anywhere on the zone → open file picker
  dropzone.addEventListener('click', () => fileInput.click());

  // Keyboard access (Enter / Space)
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  // dragover → visual highlight
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  // dragleave → remove highlight
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  // drop → validate and accept
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    console.log(`[Fillosophy Upload] File dropped: ${file?.name ?? 'none'}`);
    applyFileSelection(file, { dropzone, dropzoneTitle, dropzoneSub,
                               extractBtn, uploadStatus });
  });

  // File picker selection
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    console.log(`[Fillosophy Upload] File selected via picker: ${file?.name ?? 'none'}`);
    applyFileSelection(file, { dropzone, dropzoneTitle, dropzoneSub,
                               extractBtn, uploadStatus });
    // Reset so the same file can be re-selected
    fileInput.value = '';
  });
}

/**
 * Validates the chosen file (must be a PDF), stores it in state.selectedFile,
 * and updates the dropzone UI.
 *
 * @param {File|undefined} file - The file to validate.
 * @param {Object}         els  - DOM element references.
 */
export function applyFileSelection(file, els) {
  const { dropzone, dropzoneTitle, dropzoneSub, extractBtn, uploadStatus } = els;

  // Clear any previous status
  setStatus(uploadStatus, '', '');

  if (!file) {
    console.warn('[Fillosophy Upload] No file provided.');
    return;
  }

  // PDF-only validation
  if (file.type !== ACCEPTED_MIME && !file.name.toLowerCase().endsWith('.pdf')) {
    console.warn(`[Fillosophy Upload] Rejected — not a PDF: ${file.name} (${file.type})`);
    setStatus(uploadStatus, '✗ Only PDF files are supported.', 'error');
    return;
  }

  // Accept
  state.selectedFile = file;
  console.log(`[Fillosophy Upload] File accepted: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

  dropzone.classList.add('has-file');
  dropzoneTitle.textContent = `${file.name}`;
  dropzoneSub.textContent   = `${(file.size / 1024).toFixed(1)} KB · Click to change`;

  extractBtn.disabled = false;
}

/**
 * POSTs the selected PDF to the /extract endpoint.
 * On success: stores the profile, updates the Profiles tab, and switches to it.
 * On failure: surfaces the error in the status bar.
 *
 * @param {Object} els - Named DOM element references.
 */
export async function handleExtract(els) {
  const { extractBtn, extractBtnLabel,
          extractBtnIcon, uploadStatus } = els;

  if (!state.selectedFile) {
    console.warn('[Fillosophy Upload] handleExtract called without a selected file.');
    return;
  }

  const profileName = await getActiveProfile() || 'personal';
  console.log(`[Fillosophy Upload] Starting extract — file: "${state.selectedFile.name}", profile: "${profileName}"`);

  // Loading state
  setLoadingState(extractBtn, extractBtnLabel, extractBtnIcon, true);
  setStatus(uploadStatus, '', '');

  // Build multipart payload
  const formData = new FormData();
  formData.append('file', state.selectedFile, state.selectedFile.name);
  formData.append('profile_name', profileName);

  try {
    console.log(`[Fillosophy Upload] POST ${EXTRACT_URL}`);

    const response = await fetch(EXTRACT_URL, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      let detail = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errBody = await response.json();
        if (errBody?.detail) detail = errBody.detail;
      } catch { /* ignore JSON parse errors on error body */ }
      throw new Error(detail);
    }

    const data = await response.json();
    console.log('[Fillosophy Upload] Extract success:', data);

    // Store and display the profile
    state.currentProfile = data.profile;
    displayProfile(data.profile);

    // Persist to chrome.storage
    try {
      await saveProfile(profileName, data.profile);
      await setActiveProfile(profileName);
      console.log(`[Fillosophy] Profile saved to chrome.storage`);
    } catch (storageErr) {
      console.warn('[Fillosophy] chrome.storage save failed:', storageErr.message);
    }

    // Update status & switch tab
    setStatus(
      uploadStatus,
      'Profile saved!',
      'success'
    );

    // Keep button disabled
    extractBtn.disabled = true;

    // Switch to Profiles tab after a short delay
    setTimeout(() => switchTab('profiles'), 1200);

  } catch (err) {
    const isNetworkError = err instanceof TypeError;
    const message = isNetworkError
      ? '⚠️ The backend server is currently offline. Please start it to extract profiles.'
      : `✗ Error: ${err.message}`;

    console.error('[Fillosophy Upload] Extract failed:', err.message);
    setStatus(uploadStatus, message, 'error');

    // Re-enable button
    extractBtn.disabled = false;

  } finally {
    setLoadingState(extractBtn, extractBtnLabel, extractBtnIcon, false);
  }
}
