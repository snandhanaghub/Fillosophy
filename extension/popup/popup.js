// Fillosophy — Popup controller | Tab switching, PDF upload, backend fetch
// Wires the nand-redesigned HTML to main's backend endpoints and extension logic.

import { saveProfile, setActiveProfile, getProfile, getActiveProfile, listProfiles, deleteProfile, clearAllProfiles } from '../utils/storage.js';
import { applyTemplateMatching } from '../utils/templates.js';

// ════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════

/** Tab IDs — left-to-right order matches the DOM. */
const TAB_IDS = ['upload', 'profiles', 'autofill'];

/** Tab shown when the popup first opens. */
const DEFAULT_TAB = 'upload';

/** Backend endpoint for resume extraction. */
const EXTRACT_URL = 'http://localhost:8000/extract/';

/** Backend endpoint for profile import sync. */
const IMPORT_URL = 'http://localhost:8000/profiles/import/';

/** Only PDFs are accepted by the upload flow. */
const ACCEPTED_MIME = 'application/pdf';

/** Motion timings (must stay aligned with popup.css duration scale). */
const PANEL_SWITCH_DURATION_MS = 240;
const PANEL_SWITCH_STAGGER_MS = 30;

// ════════════════════════════════════════════════════════════
// CHROME MESSAGING HELPER
// ════════════════════════════════════════════════════════════

/**
 * Promise-based wrapper around chrome.runtime.sendMessage.
 * Rejects if chrome.runtime.lastError is set (e.g. no listener,
 * service worker not active) so callers can use async/await cleanly.
 *
 * @param {string} type    - Message type string.
 * @param {Object} payload - Optional extra fields merged into the message.
 * @returns {Promise<any>}
 */
function sendMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type, ...payload },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      }
    );
  });
}

// ════════════════════════════════════════════════════════════
// MODULE STATE
// ════════════════════════════════════════════════════════════

/**
 * Holds the currently selected File object.
 * Set by applyFileSelection(); consumed by handleExtract().
 * @type {File|null}
 */
let selectedFile = null;

/**
 * Holds the most recently extracted profile dict returned by the backend.
 * Set on successful POST /extract; used by displayProfile().
 * @type {Object|null}
 */
let currentProfile = null;
let currentProfileName = null;
let pendingExtractedProfileData = null;
let lastUploadTimestamp = null;
let fieldMatchingCacheTimestamp = null;

/**
 * Module-level maps so switchTab() can be called from anywhere in the file
 * without needing to pass DOM refs as arguments every time.
 * Populated in DOMContentLoaded.
 */
let _tabBtns = {};
let _tabPanels = {};
const panelHideTimers = new Map();
let previewSectionHideTimer = null;

/**
 * Full descriptor objects returned by the last DETECT_FIELDS call.
 * Consumed by the autofill handler to map matches back to elements.
 * @type {Object[]}
 */
let detectedFields = [];

/**
 * Best-available label string for each detected field.
 * Sent to the AI /match endpoint as the "fields" payload.
 * @type {string[]}
 */
let fieldLabels = [];

/**
 * Mapping object returned by the last successful /match call.
 * Key: field label, Value: { value, confidence }
 * @type {Object}
 */
let fieldMapping = {};

/**
 * Unix timestamp (ms) of the last successful previewMatch() call.
 * Used to detect stale mappings when the user re-opens the Autofill tab.
 * @type {number|null}
 */
let lastMatchTimestamp = null;

/**
 * URL of the page in the active tab.  Set by loadAutofillTab() after a
 * successful GET_PAGE_INFO call; consumed by previewMatch() to look up
 * portal-specific templates before falling back to AI matching.
 * @type {string|null}
 */
let currentPageUrl = null;

/**
 * Logs current profile and field mapping cache state for debugging.
 */
function logProfileState() {
  console.log(`
  [Fillosophy Debug] Profile State:
  ├─ Current Profile Name: ${currentProfileName}
  ├─ Current Profile Data: ${currentProfile ? 'loaded' : 'empty'}
  ├─ Last Upload: ${lastUploadTimestamp ? new Date(lastUploadTimestamp).toISOString() : 'never'}
  ├─ Field Matching Cached: ${fieldMatchingCacheTimestamp ? new Date(fieldMatchingCacheTimestamp).toISOString() : 'never'}
  ├─ Cache is Stale: ${fieldMatchingCacheTimestamp && lastUploadTimestamp ? lastUploadTimestamp > fieldMatchingCacheTimestamp : 'N/A'}
  └─ Field Mapping Keys: ${Object.keys(fieldMapping || {}).length}
  `);
}

// ════════════════════════════════════════════════════════════
// INITIALISATION
// ════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {

  // ── Tab elements ────────────────────────────────────────
  _tabBtns = Object.fromEntries(
    TAB_IDS.map((id) => [id, document.getElementById(`tab-${id}`)])
  );
  _tabPanels = Object.fromEntries(
    TAB_IDS.map((id) => [id, document.getElementById(`panel-${id}`)])
  );

  // ── Upload tab elements ─────────────────────────────────
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('resume-file-input');
  const dropzoneTitle = document.getElementById('dropzone-title');
  const dropzoneSub = document.getElementById('dropzone-sub');
  const extractBtn = document.getElementById('extract-btn');
  const extractBtnLabel = document.getElementById('extract-btn-label');
  const uploadStatus = document.getElementById('upload-status');

  // ── Initial state ───────────────────────────────────────
  extractBtn.disabled = true;   // enabled only after a valid file is chosen
  uploadStatus.textContent = '';

  // ── Wire tabs ───────────────────────────────────────────
  TAB_IDS.forEach((id) => {
    if (_tabBtns[id]) {
      _tabBtns[id].addEventListener('click', () => switchTab(id));
    }
  });

  // ── Check Auth state ────────────────────────────────────
  checkAuthState();

  // ── Wire dropzone ───────────────────────────────────────
  initDropzone({
    dropzone, fileInput, dropzoneTitle, dropzoneSub,
    extractBtn, uploadStatus
  });

  // ── Wire extract button ────────────────────────────────────────
  // Nand redesign removed the profile-name select dropdown.
  // We use the currently active profile from storage, or default to 'personal'.
  extractBtn.addEventListener('click', () => {
    handleExtract({ extractBtn, extractBtnLabel, uploadStatus });
  });

  // ── Wire header refresh button ─────────────────────────────────
  const headerRefreshBtn = document.getElementById('header-refresh-btn');
  if (headerRefreshBtn) {
    headerRefreshBtn.addEventListener('click', () => location.reload());
  }

  // ── Wire export-JSON button ────────────────────────────────────
  const exportJsonBtn = document.getElementById('export-json-btn');
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', handleExportJson);
  }

  // ── Wire Save Profile button ───────────────────────────────────
  const saveProfileBtn = document.getElementById('save-profile-btn');
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', handleSaveProfile);
  }

  // ── Wire Delete Profile button ─────────────────────────────────
  const deleteProfileBtn = document.getElementById('delete-profile-btn');
  if (deleteProfileBtn) {
    deleteProfileBtn.addEventListener('click', handleDeleteProfile);
  }

  // ── Wire Add Experience & Add Project buttons ──────────────────
  const addExpBtn = document.getElementById('add-experience-btn');
  if (addExpBtn) {
    addExpBtn.addEventListener('click', () => {
      const container = document.getElementById('profile-experience-list');
      if (container) {
        container.appendChild(createExperienceCardElement({}, container.children.length));
      }
    });
  }

  const addProjBtn = document.getElementById('add-project-btn');
  if (addProjBtn) {
    addProjBtn.addEventListener('click', () => {
      const container = document.getElementById('profile-projects-list');
      if (container) {
        container.appendChild(createProjectCardElement({}, container.children.length));
      }
    });
  }

  // ── Wire Switch profile link (Autofill tab → Profiles tab) ─────
  const switchProfileBtn = document.getElementById('switch-profile-btn');
  if (switchProfileBtn) {
    switchProfileBtn.addEventListener('click', () => {
      switchTab('profiles');
    });
  }

  // ── Load profile chips on startup ──────────────────────────────
  renderProfileChips();

  // ── Wire login form ─────────────────────────────────────
  const loginForm = document.getElementById('login-form');
  const loginStatus = document.getElementById('login-status');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const loginBtn = document.getElementById('login-btn');

      setStatus(loginStatus, '', '');
      setAuthButtonLoading(loginBtn, true, 'Log In');

      try {
        const response = await fetch('http://localhost:8000/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok && data.status === 'success') {
          chrome.storage.local.set({ supabase_session: data.session }, () => {
            enterApp();
          });
        } else {
          setStatus(loginStatus, data.detail || 'Login failed.', 'error');
        }
      } catch (err) {
        setStatus(loginStatus, 'Server offline.', 'error');
      } finally {
        setAuthButtonLoading(loginBtn, false, 'Log In');
      }
    });
  }

  // ── Wire signup form ─────────────────────────────────────
  const signupForm = document.getElementById('signup-form');
  const signupStatus = document.getElementById('signup-status');
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('signup-name').value;
      const email = document.getElementById('signup-email').value;
      const password = document.getElementById('signup-password').value;
      const signupBtn = document.getElementById('signup-btn');

      setStatus(signupStatus, '', '');
      setAuthButtonLoading(signupBtn, true, 'Create Account');

      try {
        const response = await fetch('http://localhost:8000/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password })
        });

        const data = await response.json();

        if (response.ok && data.status === 'success') {
          setStatus(signupStatus, 'Account created. Check email to verify.', 'success');
        } else {
          setStatus(signupStatus, data.detail || 'Signup failed.', 'error');
        }
      } catch (err) {
        setStatus(signupStatus, 'Server offline.', 'error');
      } finally {
        setAuthButtonLoading(signupBtn, false, 'Create Account');
      }
    });
  }

  // ── Wire switch screen links ──────────────────────────────
  const toSignup = document.getElementById('to-signup');
  const toLogin = document.getElementById('to-login');
  if (toSignup) {
    toSignup.addEventListener('click', (e) => {
      e.preventDefault();
      showAuthScreen('signup');
    });
  }
  if (toLogin) {
    toLogin.addEventListener('click', (e) => {
      e.preventDefault();
      showAuthScreen('login');
    });
  }

  // ── Wire password visibility toggles ──────────────────────
  const loginPassToggle = document.getElementById('login-password-toggle');
  const loginPassInput = document.getElementById('login-password');
  if (loginPassToggle && loginPassInput) {
    loginPassToggle.addEventListener('click', () => {
      const isPass = loginPassInput.type === 'password';
      loginPassInput.type = isPass ? 'text' : 'password';
      loginPassToggle.classList.toggle('active', !isPass);
    });
  }

  const signupPassToggle = document.getElementById('signup-password-toggle');
  const signupPassInput = document.getElementById('signup-password');
  if (signupPassToggle && signupPassInput) {
    signupPassToggle.addEventListener('click', () => {
      const isPass = signupPassInput.type === 'password';
      signupPassInput.type = isPass ? 'text' : 'password';
      signupPassToggle.classList.toggle('active', !isPass);
    });
  }

  // ── Wire Logout button ────────────────────────────────────
  const logoutBtn = document.getElementById('header-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      chrome.storage.local.remove(['supabase_session'], async () => {
        try {
          await fetch('http://localhost:8000/auth/logout', { method: 'POST' });
        } catch (err) {
          // ignore offline logout failure
        }
        try {
          await clearAllProfiles();
        } catch (err) {
          console.warn('[Fillosophy] Failed to clear local profiles on logout:', err.message);
        }
        currentProfile = null;
        currentProfileName = null;
        fieldMapping = {};
        lastMatchTimestamp = null;
        showAuthScreen('login');
      });
    });
  }
});

// ════════════════════════════════════════════════════════════
// TAB SWITCHING
// ════════════════════════════════════════════════════════════

/**
 * Activates one tab and deactivates all others.
 * Uses the module-level _tabBtns / _tabPanels maps.
 *
 * @param {string} tabId - 'upload' | 'profiles' | 'autofill'
 */
function switchTab(tabId) {
  const currentTabId = TAB_IDS.find((id) => _tabPanels[id]?.classList.contains('active'));
  const isSameTab = currentTabId === tabId;

  TAB_IDS.forEach((id) => {
    const btn = _tabBtns[id];
    const isActive = id === tabId;

    if (!btn) {
      console.warn(`[Fillosophy] Missing DOM element for tab: "${id}"`);
      return;
    }

    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  const incomingPanel = _tabPanels[tabId];
  if (!incomingPanel) {
    console.warn(`[Fillosophy] Missing panel element for tab: "${tabId}"`);
    return;
  }

  if (!isSameTab) {
    const outgoingTabId = currentTabId;
    const outgoingPanel = outgoingTabId ? _tabPanels[outgoingTabId] : null;

    if (outgoingPanel) {
      const pendingHide = panelHideTimers.get(outgoingTabId);
      if (pendingHide) {
        clearTimeout(pendingHide);
        panelHideTimers.delete(outgoingTabId);
      }

      outgoingPanel.classList.remove('active', 'is-entering');
      outgoingPanel.classList.add('is-exiting');
    }

    const pendingIncomingHide = panelHideTimers.get(tabId);
    if (pendingIncomingHide) {
      clearTimeout(pendingIncomingHide);
      panelHideTimers.delete(tabId);
    }

    incomingPanel.removeAttribute('hidden');
    incomingPanel.classList.remove('is-exiting');
    incomingPanel.classList.add('is-entering');

    requestAnimationFrame(() => {
      incomingPanel.classList.add('active');
      incomingPanel.classList.remove('is-entering');
    });

    if (outgoingPanel && outgoingTabId) {
      const hideTimer = setTimeout(() => {
        if (!outgoingPanel.classList.contains('active')) {
          outgoingPanel.classList.remove('is-exiting', 'is-entering');
          outgoingPanel.setAttribute('hidden', '');
        }
        panelHideTimers.delete(outgoingTabId);
      }, PANEL_SWITCH_DURATION_MS + PANEL_SWITCH_STAGGER_MS);

      panelHideTimers.set(outgoingTabId, hideTimer);
    }
  }

  const appContainer = document.getElementById('app');
  if (appContainer) appContainer.scrollTop = 0;

  const label = tabId.charAt(0).toUpperCase() + tabId.slice(1);
  console.log(`[Fillosophy] Tab switched to: ${label}`);


  // Side-effect: refresh live data whenever the Autofill tab becomes active
  if (tabId === 'autofill') {
    loadAutofillTab();
  }

  // Side-effect: refresh profile chips when the Profiles tab becomes active
  if (tabId === 'profiles') {
    syncProfilesFromBackend().then(() => {
      renderProfileChips();
    });
  }
}

// Keep the old name around in case other code calls activateTab directly
function activateTab(tabId, tabBtns, tabPanels) {
  switchTab(tabId);
}

// ════════════════════════════════════════════════════════════
// PROFILE CHIP PICKER  (replaces main's radio-group system)
// ════════════════════════════════════════════════════════════

/**
 * Renders profile chips inside the #profiles-profile-picker container.
 * Queries chrome.storage for saved profiles via listProfiles(), then
 * builds clickable chips with the active one highlighted.
 * Also appends a "+ Add" chip for creating new profile slots.
 */
/**
 * Synchronises local storage with the Supabase database.
 * Fetches all profiles from the backend list endpoint, retrieves their data,
 * and updates chrome.storage.local to match.
 */
async function syncProfilesFromBackend() {
  try {
    const token = await getAuthToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const resList = await fetch('http://localhost:8000/profiles/list', { headers });
    if (!resList.ok) throw new Error(`HTTP ${resList.status}`);
    const dataList = await resList.json();
    if (dataList.status === 'success' && Array.isArray(dataList.profiles)) {
      const dbProfiles = dataList.profiles;

      // Clear local profiles to enforce logged-in user data isolation
      await clearAllProfiles();

      // Fetch each profile for the logged-in user from backend and save locally
      for (const name of dbProfiles) {
        try {
          const resSingle = await fetch(`http://localhost:8000/profiles/${name}`, { headers });
          if (resSingle.ok) {
            const dataSingle = await resSingle.json();
            const profileData = dataSingle.profile || dataSingle.profile_data;
            if (dataSingle.status === 'success' && profileData) {
              await saveProfile(name, profileData);
            }
          }
        } catch (singleErr) {
          console.warn(`[Fillosophy] Failed to fetch data for ${name}:`, singleErr.message);
        }
      }

      // Automatically activate first profile if active profile is unset or not owned by user
      const activeName = await getActiveProfile();
      if ((!activeName || !dbProfiles.includes(activeName)) && dbProfiles.length > 0) {
        await setActiveProfile(dbProfiles[0]);
      }

      console.log('[Fillosophy] Profiles sync from backend complete for logged-in user');
    }
  } catch (err) {
    console.warn('[Fillosophy] Profiles sync from backend failed (server offline?):', err.message);
  }
}

/**
 * Ensures the Save Profile button label is always 'Save Profile'.
 */
function updateSaveProfileButton() {
  const labelEl = document.getElementById('save-profile-btn-label');
  if (labelEl) {
    labelEl.textContent = 'Save Profile';
  }
}

let deleteConfirmTimer = null;

/**
 * Resets the Delete Profile button back to its non-confirmation default state.
 */
function resetDeleteButtonState() {
  if (deleteConfirmTimer) {
    clearTimeout(deleteConfirmTimer);
    deleteConfirmTimer = null;
  }
  const deleteBtn = document.getElementById('delete-profile-btn');
  const deleteLabel = document.getElementById('delete-profile-btn-label');
  if (deleteBtn) {
    deleteBtn.classList.remove('btn-danger-confirm');
  }
  if (deleteLabel) {
    deleteLabel.textContent = 'Delete';
  }
}

/**
 * Disables or enables the Delete Profile button based on total profile count.
 */
async function updateDeleteButtonState() {
  const deleteBtn = document.getElementById('delete-profile-btn');
  if (!deleteBtn) return;

  try {
    const profiles = await listProfiles();
    if (profiles.length <= 1) {
      deleteBtn.disabled = true;
      deleteBtn.title = 'Cannot delete the last remaining profile.';
    } else {
      deleteBtn.disabled = false;
      deleteBtn.title = 'Delete currently active profile';
    }
  } catch (err) {
    console.warn('[Fillosophy] Failed to update delete button state:', err.message);
  }
}

async function renderProfileChips() {
  const container = document.getElementById('profiles-profile-picker');
  if (!container) return;

  // Reset delete button confirmation state and update disabled status
  resetDeleteButtonState();
  await updateDeleteButtonState();

  // Fetch saved profile names and the active one
  let profileNames = [];
  let activeName = null;

  try {
    profileNames = await listProfiles();
    activeName = await getActiveProfile();
  } catch (err) {
    console.warn('[Fillosophy] Failed to load profiles for chips:', err.message);
  }

  // Determine if the add (+) chip should be active
  const isAddActive = (!activeName || activeName === '+' || activeName === '__add__' || !profileNames.includes(activeName));

  // Clear container
  container.innerHTML = '';

  // Build a chip for each profile (no options button inside)
  for (const name of profileNames) {
    const isChipActive = (!isAddActive && name === activeName);
    const chip = document.createElement('button');
    chip.className = 'profile-chip' + (isChipActive ? ' active' : '');
    chip.type = 'button';

    // Capitalise label for display
    const displayName = name.charAt(0).toUpperCase() + name.slice(1);
    chip.textContent = displayName;

    chip.addEventListener('click', () => handleChipSelect(name));
    container.appendChild(chip);
  }

  // Append the "+" chip (text is strictly '+')
  const addChip = document.createElement('button');
  addChip.className = 'profile-chip add-chip' + (isAddActive ? ' active' : '');
  addChip.type = 'button';
  addChip.textContent = '+';
  addChip.title = 'Add new profile';
  addChip.addEventListener('click', () => {
    handleAddProfileChip(container, null);
  });
  container.appendChild(addChip);

  // If there is a draft extracted profile waiting to be named, trigger the naming flow automatically!
  if (pendingExtractedProfileData) {
    const draft = pendingExtractedProfileData;
    handleAddProfileChip(container, draft);
    return;
  }

  // Load active profile data into preview and update button label
  if (!isAddActive && activeName && profileNames.includes(activeName)) {
    try {
      const profileData = await getProfile(activeName);
      if (profileData && Object.keys(profileData).length > 0) {
        currentProfile = profileData;
        displayProfile(profileData);
      } else if (currentProfile && Object.keys(currentProfile).length > 0) {
        displayProfile(currentProfile);
      } else {
        currentProfile = null;
        displayProfile(null);
      }
    } catch (err) {
      console.warn('[Fillosophy] Failed to load active profile data:', err.message);
      if (currentProfile) displayProfile(currentProfile);
    }
    updateSaveProfileButton(true);
  } else {
    // Add chip is active (new profile or freshly extracted resume)
    if (currentProfile && Object.keys(currentProfile).length > 0) {
      displayProfile(currentProfile);
    } else {
      currentProfile = null;
      displayProfile(null);
    }
    updateSaveProfileButton(false);
  }
}

/**
 * Handles clicking a profile chip — sets it as active and refreshes the UI.
 *
 * @param {string} name - Profile name to activate.
 */
async function handleChipSelect(name) {
  const profilesTabStatus = document.getElementById('profiles-tab-status');

  // Discard draft extraction if switching to an existing chip before naming
  if (pendingExtractedProfileData) {
    pendingExtractedProfileData = null;
    if (profilesTabStatus) {
      setStatus(profilesTabStatus, 'Profile discarded.', 'error');
    }
  }

  try {
    const profileData = await getProfile(name);

    if (!profileData) {
      setStatus(profilesTabStatus,
        `No profile data found for "${name}".`, 'error');
      console.warn(`[Fillosophy] No profile data found for: ${name}`);
      // Still set as active so extracts go to this slot
      await setActiveProfile(name);
      renderProfileChips();
      return;
    }

    // Apply the selected profile
    currentProfile = profileData;
    await setActiveProfile(name);
    displayProfile(profileData);
    console.log(`[Fillosophy] Switched active profile to: ${name}`);

    // Invalidate cached field mapping — forces fresh match on next Autofill tab open
    fieldMapping = {};
    lastMatchTimestamp = null;
    console.log('[Fillosophy] Field mapping invalidated due to profile switch');

    setStatus(profilesTabStatus, '', '');

  } catch (err) {
    console.warn('[Fillosophy] Profile switch failed:', err.message);
    setStatus(profilesTabStatus, `Failed to switch profile: ${err.message}`, 'error');
  }

  // Re-render chips to update active state
  renderProfileChips();
}

/**
 * Handles the "+ Add" chip — replaces it in-place with an inline text input.
 * On Enter or blur with non-empty text, validates and creates the new profile slot.
 * On Escape or blur with empty text, cancels and reverts.
 *
 * @param {HTMLElement} container - The profile picker container.
 */
function handleAddProfileChip(container, initialProfileData = null) {
  // Check if an input already exists
  if (container.querySelector('.profile-chip-input')) return;

  // Find the add-chip element to replace in-place
  const addChip = container.querySelector('.add-chip');
  if (!addChip) return;

  // Create inline input element
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'profile-chip-input';
  input.placeholder = 'Profile name…';
  input.maxLength = 30;
  input.ariaLabel = 'New profile name';

  // Replace addChip in-place (same position in flex row)
  container.replaceChild(input, addChip);
  input.focus();

  const draftData = initialProfileData || pendingExtractedProfileData;

  // If draft extracted data is available, populate the preview section immediately
  if (draftData) {
    displayProfile(draftData);
    updateSaveProfileButton(false);
  }

  let isProcessing = false;

  const showError = (message) => {
    input.classList.remove('chip-input-error');
    void input.offsetWidth; // Force animation restart
    input.classList.add('chip-input-error');
    input.focus();
    const profilesTabStatus = document.getElementById('profiles-tab-status');
    if (profilesTabStatus) {
      setStatus(profilesTabStatus, message, 'error');
    }
  };

  const cancelAdd = async () => {
    if (isProcessing) return;
    isProcessing = true;

    const profilesTabStatus = document.getElementById('profiles-tab-status');

    if (draftData || pendingExtractedProfileData) {
      pendingExtractedProfileData = null;
      if (profilesTabStatus) {
        setStatus(profilesTabStatus, 'Profile discarded.', 'error');
      }
    } else {
      if (profilesTabStatus && profilesTabStatus.textContent.includes('already exists')) {
        setStatus(profilesTabStatus, '', '');
      }
    }

    // Revert preview back to active profile (or clear if none)
    const activeName = await getActiveProfile();
    if (activeName && activeName !== '+' && activeName !== '__add__') {
      const activeData = await getProfile(activeName);
      currentProfile = activeData;
      displayProfile(activeData);
    } else {
      currentProfile = null;
      displayProfile(null);
    }

    renderProfileChips();
  };

  const submitAdd = async () => {
    if (isProcessing) return;
    const trimmedVal = input.value.trim();

    if (!trimmedVal) {
      cancelAdd();
      return;
    }

    // Validate case-insensitive exact duplicate names
    let existingProfiles = [];
    try {
      existingProfiles = await listProfiles();
    } catch (err) {
      console.warn('[Fillosophy] Failed to list profiles for validation:', err.message);
    }

    const isDuplicate = existingProfiles.some(
      (p) => p.toLowerCase() === trimmedVal.toLowerCase()
    );

    if (isDuplicate) {
      showError(`Profile "${trimmedVal}" already exists.`);
      return;
    }

    // Valid input!
    isProcessing = true;
    const newProfileName = trimmedVal.toLowerCase();

    const profileDataToSave = draftData
      ? draftData
      : {
          full_name: null,
          preferred_name: null,
          email: null,
          phone: null,
          address: null,
          date_of_birth: null,
          gender: null,
          degree: null,
          institution: null,
          cgpa: null,
          graduation_year: null,
          links: [],
          skills: [],
          experience: [],
          projects: [],
          certifications: []
        };

    // Clear draft reference on successful commit
    pendingExtractedProfileData = null;

    try {
      await saveProfile(newProfileName, profileDataToSave);
      await setActiveProfile(newProfileName);
      currentProfile = profileDataToSave;
      displayProfile(profileDataToSave);

      // Sync to backend DB if reachable
      const token = await getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      await fetch(IMPORT_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          profile_name: newProfileName,
          profile_data: profileDataToSave,
        }),
      });

      console.log(`[Fillosophy] New profile created & synced: ${newProfileName}`);
      const profilesTabStatus = document.getElementById('profiles-tab-status');
      if (profilesTabStatus) {
        setStatus(profilesTabStatus, `Profile "${trimmedVal}" saved.`, 'success');
      }
    } catch (err) {
      console.warn('[Fillosophy] Failed to create new profile:', err.message);
    }

    renderProfileChips();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAdd();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelAdd();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!isProcessing) {
        if (input.value.trim()) {
          submitAdd();
        } else {
          cancelAdd();
        }
      }
    }, 150);
  });
}

/**
 * Handles the dedicated Delete Profile button in the Profiles tab.
 * Implements lightweight 2-step inline confirmation.
 */
async function handleDeleteProfile() {
  const deleteBtn = document.getElementById('delete-profile-btn');
  const deleteLabel = document.getElementById('delete-profile-btn-label');
  const profilesTabStatus = document.getElementById('profiles-tab-status');
  if (!deleteBtn || deleteBtn.disabled) return;

  const activeName = await getActiveProfile();
  if (!activeName || activeName === '+' || activeName === '__add__') {
    if (profilesTabStatus) {
      setStatus(profilesTabStatus, 'Select a profile to delete.', 'error');
    }
    return;
  }

  // Ensure there is more than 1 profile remaining
  const profiles = await listProfiles();
  if (profiles.length <= 1) {
    if (profilesTabStatus) {
      setStatus(profilesTabStatus, 'Cannot delete the last remaining profile.', 'error');
    }
    updateDeleteButtonState();
    return;
  }

  // Check if button is already in confirmation state
  const isConfirming = deleteBtn.classList.contains('btn-danger-confirm');

  if (!isConfirming) {
    // Step 1: Enter confirm state
    deleteBtn.classList.add('btn-danger-confirm');
    if (deleteLabel) deleteLabel.textContent = 'Confirm?';
    if (profilesTabStatus) {
      setStatus(profilesTabStatus, 'Click Delete again to confirm.', 'amber');
    }

    // Auto-revert after 3.5 seconds
    deleteConfirmTimer = setTimeout(() => {
      resetDeleteButtonState();
      if (profilesTabStatus && profilesTabStatus.textContent.includes('confirm')) {
        setStatus(profilesTabStatus, '', '');
      }
    }, 3500);

    return;
  }

  // Step 2: Confirmed! Delete active profile
  resetDeleteButtonState();

  try {
    await deleteProfile(activeName);

    // Sync deletion to backend DB
    try {
      const token = await getAuthToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`http://localhost:8000/profiles/${activeName}`, {
        method: 'DELETE',
        headers,
      });
    } catch (backendErr) {
      console.warn('[Fillosophy] Backend delete sync failed:', backendErr.message);
    }

    // Find next profile to select
    const remaining = await listProfiles();

    if (remaining.length > 0) {
      const nextActive = remaining[0];
      await setActiveProfile(nextActive);
      const nextData = await getProfile(nextActive);
      currentProfile = nextData;
      displayProfile(nextData);
    } else {
      await setActiveProfile('');
      currentProfile = null;
      displayProfile(null);
    }

    if (profilesTabStatus) {
      setStatus(profilesTabStatus, 'Profile deleted.', 'success');
    }
  } catch (err) {
    console.error('[Fillosophy] Failed to delete profile:', err.message);
    if (profilesTabStatus) {
      setStatus(profilesTabStatus, `Delete failed: ${err.message}`, 'error');
    }
  }

  // Invalidate field mapping cache
  fieldMapping = {};
  lastMatchTimestamp = null;

  renderProfileChips();
}

/**
 * Sets the visual active state on the chip matching profileName.
 * Used after imports to sync the chip UI.
 *
 * @param {string} profileName - e.g. "personal" | "academic" | "job"
 */
function setActiveProfileChip(profileName) {
  renderProfileChips();
  console.log(`[Fillosophy] Active profile chip updated to: ${profileName}`);
}

// ════════════════════════════════════════════════════════════
// DROPZONE
// ════════════════════════════════════════════════════════════

/**
 * Wires all dropzone interactions.
 * Both drag-drop and file-input change call applyFileSelection(file).
 *
 * @param {Object} els - Named DOM references from DOMContentLoaded.
 */
function initDropzone(els) {
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
    applyFileSelection(file, {
      dropzone, dropzoneTitle, dropzoneSub,
      extractBtn, uploadStatus
    });
  });

  // File picker selection
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    console.log(`[Fillosophy Upload] File selected via picker: ${file?.name ?? 'none'}`);
    applyFileSelection(file, {
      dropzone, dropzoneTitle, dropzoneSub,
      extractBtn, uploadStatus
    });
    // Reset so the same file can be re-selected
    fileInput.value = '';
  });
}

/**
 * Validates the chosen file (must be a PDF), stores it in selectedFile,
 * and updates the dropzone UI.
 *
 * @param {File|undefined} file - The file to validate.
 * @param {Object}         els  - DOM element references.
 */
function applyFileSelection(file, els) {
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
    setStatus(uploadStatus, 'Only PDF files are supported.', 'error');
    return;
  }

  // Accept
  selectedFile = file;
  console.log(`[Fillosophy Upload] File accepted: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

  dropzone.classList.add('has-file');
  dropzoneTitle.textContent = `${file.name}`;
  dropzoneSub.textContent = `${(file.size / 1024).toFixed(1)} KB · Click to change`;

  extractBtn.disabled = false;
}

// ════════════════════════════════════════════════════════════
// EXTRACT RESUME
// ════════════════════════════════════════════════════════════

/**
 * POSTs the selected PDF to the /extract endpoint.
 * On success: loads the extracted data into current profile memory & populates preview in Profiles tab.
 * On failure: surfaces the error in the status bar.
 *
 * Uses the currently active profile name from storage (or defaults to 'personal')
 * since the nand redesign removed the profile-name select dropdown.
 *
 * @param {Object} els - Named DOM element references.
 */
async function handleExtract(els) {
  const { extractBtn, extractBtnLabel, uploadStatus } = els;

  if (!selectedFile) {
    console.warn('[Fillosophy Upload] handleExtract called without a selected file.');
    return;
  }

  // Determine profile name from storage (nand removed the select dropdown)
  let profileName = 'personal';
  try {
    const active = await getActiveProfile();
    if (active) profileName = active;
  } catch (err) {
    console.warn('[Fillosophy] getActiveProfile failed, using default:', err.message);
  }

  console.log(`[Fillosophy Upload] Starting extract — file: "${selectedFile.name}", profile: "${profileName}"`);

  // Loading state
  setLoadingState(extractBtn, extractBtnLabel, true);
  setStatus(uploadStatus, '', '');

  // Build multipart payload
  const formData = new FormData();
  formData.append('file', selectedFile, selectedFile.name);
  formData.append('profile_name', profileName);

  try {
    console.log(`[Fillosophy Upload] POST ${EXTRACT_URL}`);

    const token = await getAuthToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(EXTRACT_URL, {
      method: 'POST',
      headers,
      body: formData,
      // Do NOT set Content-Type — browser sets it with the correct boundary
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

    // Hold extracted profile in draft memory — user names the profile on the Profiles tab before persisting
    pendingExtractedProfileData = data.profile;
    currentProfileName = null;
    lastUploadTimestamp = Date.now();

    // CRITICAL: Clear the field matching cache
    fieldMatchingCacheTimestamp = null;
    fieldMapping = {};
    lastMatchTimestamp = null;

    console.log(`[Fillosophy] Cache invalidated at ${lastUploadTimestamp}`);
    logProfileState();

    // ── Update status ────────────────────────────────────────────────────────
    setStatus(
      uploadStatus,
      'Resume parsed. Enter profile name.',
      'success'
    );

    // Re-enable extract button so user can re-trigger if needed
    extractBtn.disabled = false;

    // Switch to Profiles tab after extraction — smooth transition triggers naming flow automatically
    setTimeout(() => switchTab('profiles'), 350);

  } catch (err) {
    const isNetworkError = err instanceof TypeError;
    const message = isNetworkError
      ? 'Server offline.'
      : `Extraction failed: ${err.message}`;

    console.error('[Fillosophy Upload] Extract failed:', err.message);
    setStatus(uploadStatus, message, 'error');

    // Re-enable button so user can retry
    extractBtn.disabled = false;

  } finally {
    // Restore button label regardless of outcome
    setLoadingState(extractBtn, extractBtnLabel, false);
  }
}

// ════════════════════════════════════════════════════════════
// PROFILE EXPORT
// ════════════════════════════════════════════════════════════

/**
 * Exports the current active profile as a formatted JSON file.
 * Uses chrome.downloads.download() for reliable Manifest V3 popup downloads
 * with a blob-anchor fallback.
 */
async function handleExportJson() {
  const profilesStatus = document.getElementById('profiles-tab-status');

  // ── Guard: no profile loaded ──────────────────────────────────────────────
  if (!currentProfile) {
    if (profilesStatus) {
      setStatus(profilesStatus, 'No active profile to export.', 'error');
    }
    console.warn('[Fillosophy] Export aborted — no active profile.');
    return;
  }

  // ── Get the active profile name from storage ──────────────────────────────
  let activeProfileName;
  try {
    activeProfileName = await getActiveProfile();
    if (!activeProfileName) {
      activeProfileName = 'profile';
      console.warn('[Fillosophy] No active profile name in storage — using fallback.');
    }
  } catch (err) {
    activeProfileName = 'profile';
    console.warn('[Fillosophy] getActiveProfile failed, using fallback name:', err.message);
  }

  // ── Build export payload ──────────────────────────────────────────────────
  const exportPayload = {
    fillosophy_export_version: '1.0',
    exported_at: new Date().toISOString(),
    profile_name: activeProfileName,
    profile_data: currentProfile,
  };

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const filename = `fillosophy_${activeProfileName.toLowerCase()}_${Date.now()}.json`;

  // ── Trigger download ──────────────────────────────────────────────────────
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  let downloadSucceeded = false;

  // Primary: chrome.downloads API (reliable in MV3 popups)
  if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
    try {
      await new Promise((resolve, reject) => {
        chrome.downloads.download(
          { url, filename, saveAs: false },
          (downloadId) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(downloadId);
            }
          }
        );
      });
      downloadSucceeded = true;
    } catch (dlErr) {
      console.warn('[Fillosophy] chrome.downloads failed, falling back to anchor:', dlErr.message);
    }
  }

  // Fallback: temporary anchor element
  if (!downloadSucceeded) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    downloadSucceeded = true;
  }

  URL.revokeObjectURL(url);

  // ── Status feedback ───────────────────────────────────────────────────────
  if (profilesStatus) {
    setStatus(profilesStatus, `Profile exported as ${filename}.`, 'success');
  }
  console.log(`[Fillosophy] Profile exported: ${activeProfileName}`);
}

// ════════════════════════════════════════════════════════════
// PROFILE SAVE & SYNC
// ════════════════════════════════════════════════════════════

/**
 * Saves the edited profile details from the preview form to local storage and syncs to Supabase.
 */
async function handleSaveProfile() {
  const profilesStatus = document.getElementById('profiles-tab-status');
  if (profilesStatus) setStatus(profilesStatus, '', '');

  let activeProfileName = 'personal';
  try {
    const active = await getActiveProfile();
    const existingProfiles = await listProfiles();
    if (active && active !== '+' && active !== '__add__' && existingProfiles.includes(active)) {
      activeProfileName = active;
    } else {
      const enteredName = prompt('Enter a name for this profile (e.g. personal, academic):', 'personal');
      if (!enteredName || !enteredName.trim()) {
        if (profilesStatus) setStatus(profilesStatus, 'Save cancelled: Profile name required.', 'error');
        return;
      }
      activeProfileName = enteredName.trim().toLowerCase();
      await setActiveProfile(activeProfileName);
    }
  } catch (err) {
    console.warn('[Fillosophy] Failed to get active profile name:', err.message);
  }

  // Get flat values
  const getValue = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  };

  const full_name = getValue('profile-field-name');
  const preferred_name = getValue('profile-field-pref-name');
  const email = getValue('profile-field-email');
  const phone = getValue('profile-field-phone');
  const address = getValue('profile-field-address');
  const date_of_birth = getValue('profile-field-dob');
  const gender = getValue('profile-field-gender');
  const degree = getValue('profile-field-degree');
  const institution = getValue('profile-field-institution');
  const cgpa = getValue('profile-field-cgpa');
  const graduation_year = getValue('profile-field-grad-year');

  const links = getValue('profile-field-links')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const skills = getValue('profile-field-skills')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const certifications = getValue('profile-field-certifications')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Extract Experience array from DOM card inputs
  const experience = [];
  const expCards = document.querySelectorAll('#profile-experience-list .list-item-card');
  expCards.forEach(card => {
    const role = card.querySelector('.exp-role').value.trim();
    const company = card.querySelector('.exp-company').value.trim();
    const duration = card.querySelector('.exp-duration').value.trim();
    const description = card.querySelector('.exp-desc').value.trim();
    experience.push({ role, company, duration, description });
  });

  // Extract Projects array from DOM card inputs
  const projects = [];
  const projCards = document.querySelectorAll('#profile-projects-list .list-item-card');
  projCards.forEach(card => {
    const name = card.querySelector('.proj-name').value.trim();
    const description = card.querySelector('.proj-desc').value.trim();
    const techRaw = card.querySelector('.proj-tech').value.trim();
    const technologies = techRaw
      ? techRaw.split(',').map(t => t.trim()).filter(Boolean)
      : null;
    projects.push({ name, description, technologies });
  });

  const phoneObj = {
    full: phone,
    country_code: phone.startsWith('+') ? phone.split(' ')[0] : '+91',
    country_code_numeric: phone.startsWith('+') ? phone.split(' ')[0].replace('+', '') : '91',
    number_only: phone.startsWith('+') ? phone.split(' ').slice(1).join('').replace(/[^0-9]/g, '') : phone.replace(/[^0-9]/g, '')
  };

  const profileData = {
    full_name: full_name || null,
    preferred_name: preferred_name || null,
    email: email || null,
    phone: phone ? phoneObj : null,
    address: address || null,
    date_of_birth: date_of_birth || null,
    gender: gender || null,
    degree: degree || null,
    institution: institution || null,
    cgpa: cgpa ? Number(cgpa) : null,
    graduation_year: graduation_year ? Number(graduation_year) : null,
    links,
    skills,
    experience,
    projects,
    certifications
  };

  // ── Save to local storage ────────────────────────────────────────────────
  try {
    await saveProfile(activeProfileName, profileData);
    currentProfile = profileData;
    console.log(`[Fillosophy] Profile saved locally: ${activeProfileName}`);
  } catch (storageErr) {
    if (profilesStatus) setStatus(profilesStatus, `Save failed: ${storageErr.message}`, 'error');
    return;
  }

  // ── Invalidate cached field mapping (forces fresh match on next Autofill open) ──
  fieldMapping = {};
  lastMatchTimestamp = null;

  // ── Sync to backend (Supabase) ───────────────────────────────────────────
  if (profilesStatus) setStatus(profilesStatus, 'Saving and syncing...', '');
  try {
    const token = await getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(IMPORT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        profile_name: activeProfileName,
        profile_data: profileData,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (profilesStatus) setStatus(profilesStatus, 'Profile saved.', 'success');
    console.log(`[Fillosophy] Profile synced: ${activeProfileName}`);
  } catch (syncErr) {
    console.warn('[Fillosophy] Backend sync failed:', syncErr.message);
    if (profilesStatus) {
      setStatus(profilesStatus, 'Saved locally. Server offline.', 'success');
    }
  } finally {
    renderProfileChips();
  }
}

// ════════════════════════════════════════════════════════════
// PROFILE DISPLAY
// ════════════════════════════════════════════════════════════

/**
 * Populates the preview fields in the Profiles tab with extracted profile data.
 * @param {Object} profile - Structured profile dict returned by /extract.
 */
function displayProfile(profile) {
  // If profile is empty/null, clear all inputs and dynamic lists
  if (!profile || Object.keys(profile).length === 0) {
    const inputs = document.querySelectorAll('.preview-input');
    inputs.forEach(input => input.value = '');

    const containerExp = document.getElementById('profile-experience-list');
    if (containerExp) containerExp.innerHTML = '';

    const containerProj = document.getElementById('profile-projects-list');
    if (containerProj) containerProj.innerHTML = '';
    return;
  }

  // ── Populate preview inputs ─────────────────────────────────────────────
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (value == null || value === '' || value === 'null') {
      el.value = '';
    } else {
      el.value = value;
    }
  };

  const phoneDisplay = (typeof profile.phone === 'object' && profile.phone !== null)
    ? profile.phone.full
    : profile.phone;

  set('profile-field-name', profile.full_name ?? '');
  set('profile-field-pref-name', profile.preferred_name ?? '');
  set('profile-field-email', profile.email ?? '');
  set('profile-field-phone', phoneDisplay ?? '');
  set('profile-field-address', profile.address ?? '');
  set('profile-field-dob', profile.date_of_birth ?? '');
  set('profile-field-gender', profile.gender ?? '');
  set('profile-field-degree', profile.degree ?? '');
  set('profile-field-institution', profile.institution ?? '');
  set('profile-field-cgpa', profile.cgpa ?? '');
  set('profile-field-grad-year', profile.graduation_year ?? '');

  // Links list
  set('profile-field-links',
    Array.isArray(profile.links)
      ? profile.links.join(', ')
      : (profile.links ?? '')
  );

  // Skills list
  set('profile-field-skills',
    Array.isArray(profile.skills)
      ? profile.skills.join(', ')
      : (profile.skills ?? '')
  );

  // Certifications list (now flat comma-separated text)
  set('profile-field-certifications',
    Array.isArray(profile.certifications)
      ? profile.certifications.join(', ')
      : (profile.certifications ?? '')
  );

  // Render Experience & Projects cards dynamically
  renderExperienceCards(profile.experience ?? []);
  renderProjectCards(profile.projects ?? []);

  console.log('[Fillosophy] Profile displayed in Profiles tab');
}

/**
 * Renders the Experience cards in the Profiles tab.
 * @param {Array} experienceList
 */
function renderExperienceCards(experienceList) {
  const container = document.getElementById('profile-experience-list');
  if (!container) return;
  container.innerHTML = '';

  const list = Array.isArray(experienceList) ? experienceList : [];
  list.forEach((exp, index) => {
    container.appendChild(createExperienceCardElement(exp, index));
  });
}

/**
 * Creates an Experience card DOM element.
 */
function createExperienceCardElement(exp, index) {
  const card = document.createElement('div');
  card.className = 'list-item-card';
  card.dataset.index = index;

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-card-delete';
  deleteBtn.innerHTML = '×';
  deleteBtn.ariaLabel = 'Remove experience';
  deleteBtn.addEventListener('click', () => {
    card.remove();
  });
  card.appendChild(deleteBtn);

  const fields = [
    { label: 'Role', class: 'exp-role', value: exp.role ?? '' },
    { label: 'Company', class: 'exp-company', value: exp.company ?? '' },
    { label: 'Duration', class: 'exp-duration', value: exp.duration ?? '' },
    { label: 'Description', class: 'exp-desc', value: exp.description ?? '', isTextarea: true }
  ];

  fields.forEach(f => {
    const row = document.createElement('div');
    row.className = 'preview-row-stacked';

    const label = document.createElement('label');
    label.className = 'card-label';
    label.textContent = f.label;
    row.appendChild(label);

    if (f.isTextarea) {
      const input = document.createElement('textarea');
      input.className = `card-textarea ${f.class}`;
      input.value = f.value;
      row.appendChild(input);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = `card-input ${f.class}`;
      input.value = f.value;
      row.appendChild(input);
    }
    card.appendChild(row);
  });

  return card;
}

/**
 * Renders the Project cards in the Profiles tab.
 * @param {Array} projectsList
 */
function renderProjectCards(projectsList) {
  const container = document.getElementById('profile-projects-list');
  if (!container) return;
  container.innerHTML = '';

  const list = Array.isArray(projectsList) ? projectsList : [];
  list.forEach((proj, index) => {
    container.appendChild(createProjectCardElement(proj, index));
  });
}

/**
 * Creates a Project card DOM element.
 */
function createProjectCardElement(proj, index) {
  const card = document.createElement('div');
  card.className = 'list-item-card';
  card.dataset.index = index;

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-card-delete';
  deleteBtn.innerHTML = '×';
  deleteBtn.ariaLabel = 'Remove project';
  deleteBtn.addEventListener('click', () => {
    card.remove();
  });
  card.appendChild(deleteBtn);

  const techValue = Array.isArray(proj.technologies)
    ? proj.technologies.join(', ')
    : (proj.technologies ?? '');

  const fields = [
    { label: 'Project Name', class: 'proj-name', value: proj.name ?? '' },
    { label: 'Description', class: 'proj-desc', value: proj.description ?? '', isTextarea: true },
    { label: 'Technologies (comma-separated)', class: 'proj-tech', value: techValue }
  ];

  fields.forEach(f => {
    const row = document.createElement('div');
    row.className = 'preview-row-stacked';

    const label = document.createElement('label');
    label.className = 'card-label';
    label.textContent = f.label;
    row.appendChild(label);

    if (f.isTextarea) {
      const input = document.createElement('textarea');
      input.className = `card-textarea ${f.class}`;
      input.value = f.value;
      row.appendChild(input);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = `card-input ${f.class}`;
      input.value = f.value;
      row.appendChild(input);
    }
    card.appendChild(row);
  });

  return card;
}

// ════════════════════════════════════════════════════════════
// AUTOFILL TAB — LIVE DATA LOADER
// ════════════════════════════════════════════════════════════

/**
 * Called every time the Autofill tab becomes active.
 * Fetches live page info from the content script and the active profile
 * from chrome.storage via the service worker, then updates the UI.
 */
async function loadAutofillTab() {
  // Grab all the elements we'll update
  const urlEl = document.getElementById('current-page-url');
  const fieldsFoundEl = document.getElementById('stat-fields-found');
  const highConfidenceEl = document.getElementById('stat-high-confidence');
  const needsReviewEl = document.getElementById('stat-needs-review');
  const activeProfileEl = document.getElementById('active-profile-name');
  const autofillBtn = document.getElementById('autofill-btn');
  const tabStatus = document.getElementById('autofill-tab-status');

  // ── Step 1: loading state ──────────────────────────────────────────────────
  if (urlEl) urlEl.textContent = 'Scanning page…';
  if (fieldsFoundEl) fieldsFoundEl.textContent = '—';
  if (highConfidenceEl) highConfidenceEl.textContent = '—';
  if (needsReviewEl) needsReviewEl.textContent = '—';
  if (tabStatus) { tabStatus.textContent = ''; tabStatus.className = 'upload-status'; }
  if (autofillBtn) autofillBtn.disabled = true; // Disable until everything is ready

  const previewSection = document.getElementById('autofill-preview-section');
  if (previewSection) setPreviewSectionVisible(previewSection, false);

  // ── Step 1a: PING — verify content script is reachable before proceeding ───
  try {
    const ping = await sendMessage('PING_CONTENT');
    if (ping?.status !== 'content_script_ready') {
      throw new Error(ping?.message ?? 'Content script did not respond');
    }
  } catch (pingErr) {
    console.warn('[Fillosophy] PING_CONTENT failed:', pingErr.message);
    if (urlEl) urlEl.textContent = 'Unavailable';
    if (tabStatus) {
      tabStatus.textContent = 'Fillosophy cannot access this page.';
      tabStatus.className = 'upload-status error';
    }
    if (autofillBtn) autofillBtn.disabled = true;
    return; // abort — no point calling GET_PAGE_INFO or DETECT_FIELDS
  }

  // ── Step 2: GET_PAGE_INFO via service worker ───────────────────────────────
  try {
    const pageInfo = await sendMessage('GET_PAGE_INFO');
    if (pageInfo?.status === 'error') {
      throw new Error(pageInfo.message ?? 'Content script not reachable');
    }
    currentPageUrl = pageInfo.url ?? null;
    if (urlEl) urlEl.textContent = currentPageUrl ?? 'Unknown URL';
    console.log(`[Fillosophy] Page info loaded — ${pageInfo.fieldCount} field(s) on ${currentPageUrl}`);
  } catch (pageErr) {
    console.warn('[Fillosophy] GET_PAGE_INFO failed:', pageErr.message);
    if (urlEl) urlEl.textContent = 'Unavailable';
    if (tabStatus) {
      tabStatus.textContent = 'Fillosophy cannot read this page.';
      tabStatus.className = 'upload-status error';
    }
    if (autofillBtn) autofillBtn.disabled = true;
    return;
  }

  // ── Step 3: GET_ACTIVE_PROFILE via service worker ──────────────────────────
  try {
    const profileRes = await sendMessage('GET_ACTIVE_PROFILE');
    if (profileRes?.status === 'ok') {
      const name = profileRes.profileName ?? 'Unknown';
      if (activeProfileEl) activeProfileEl.textContent = name;
      currentProfile = profileRes.profile;
      currentProfileName = name;
      console.log(`[Fillosophy] Active profile loaded: ${name}`);
    } else {
      if (activeProfileEl) activeProfileEl.textContent = 'None';
      if (tabStatus) {
        tabStatus.textContent = 'No profile loaded.';
        tabStatus.className = 'upload-status error';
      }
      if (autofillBtn) autofillBtn.disabled = true;
      console.warn('[Fillosophy] No active profile found in storage.');
      return;
    }
  } catch (profileErr) {
    console.warn('[Fillosophy] GET_ACTIVE_PROFILE failed:', profileErr.message);
    if (activeProfileEl) activeProfileEl.textContent = 'Unknown';
    if (tabStatus) {
      tabStatus.textContent = 'Could not load profile data.';
      tabStatus.className = 'upload-status error';
    }
    if (autofillBtn) autofillBtn.disabled = true;
    return;
  }

  // Guard against stale profiles & invalidate cache if profile is newer
  const currentTime = Date.now();
  const timeSinceLastUpload = currentTime - (lastUploadTimestamp || 0);

  if (timeSinceLastUpload > 60000) {
    console.log('[Fillosophy] Profile may be stale, reloading...');
    const activeProfileName = await getActiveProfile();
    const reloadedProfile = await getProfile(activeProfileName);
    if (reloadedProfile) {
      currentProfile = reloadedProfile;
      currentProfileName = activeProfileName;
      console.log('[Fillosophy] Profile reloaded:', activeProfileName);
    }
  }

  if (fieldMatchingCacheTimestamp && lastUploadTimestamp) {
    if (lastUploadTimestamp > fieldMatchingCacheTimestamp) {
      console.log('[Fillosophy] Field mapping is stale, forcing refresh');
      fieldMapping = {};
      fieldMatchingCacheTimestamp = null;
      lastMatchTimestamp = null;
    }
  }

  logProfileState();

  // ── Step 4: Collect full field labels ──────────────────────────────────────
  try {
    fieldLabels = await collectFieldLabels();
    if (fieldsFoundEl) fieldsFoundEl.textContent = fieldLabels.length;
    console.log('[Fillosophy] Field labels:', fieldLabels);

    if (fieldLabels.length === 0) {
      if (fieldsFoundEl) fieldsFoundEl.textContent = '0';
      if (tabStatus) {
        tabStatus.textContent = 'No form fields detected.';
        tabStatus.className = 'upload-status error';
      }
      if (autofillBtn) autofillBtn.disabled = true;
      console.log('[Fillosophy] No fields detected — autofill disabled');
      return;
    }
  } catch (labelErr) {
    console.warn('[Fillosophy] collectFieldLabels failed:', labelErr.message);
    if (tabStatus) {
      tabStatus.textContent = 'Failed to detect form fields.';
      tabStatus.className = 'upload-status error';
    }
    if (autofillBtn) autofillBtn.disabled = true;
    return;
  }

  // ── Step 5: previewMatch — skip if mapping is fresh (< 60 s old) ──────────
  const isStale = !lastMatchTimestamp || (Date.now() - lastMatchTimestamp > 60_000);
  if (isStale) {
    await previewMatch();
  } else {
    console.log('[Fillosophy] Using cached mapping — last match was < 60 s ago.');
    renderMatchPreviewInPopup();
    wireAutofillButton();
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
async function previewMatch() {
  if (fieldLabels.length === 0 || !currentProfile) return;

  const highConfidenceEl = document.getElementById('stat-high-confidence');
  const needsReviewEl = document.getElementById('stat-needs-review');
  const tabStatus = document.getElementById('autofill-tab-status');
  const autofillBtn = document.getElementById('autofill-btn');
  const fieldsFoundEl = document.getElementById('stat-fields-found');

  if (highConfidenceEl) highConfidenceEl.textContent = '...';
  if (needsReviewEl) needsReviewEl.textContent = '...';

  try {
    // ── Step A: Try template matching first ──────────────────────────────────
    const templateResult = applyTemplateMatching(fieldLabels, currentProfile, currentPageUrl);

    if (templateResult && templateResult.unmatched.length === 0) {
      // ── Fully matched via template — skip AI entirely ─────────────────────
      fieldMapping = templateResult.matched;
      lastMatchTimestamp = Date.now();

      const totalFields = Object.keys(fieldMapping).length;

      if (fieldsFoundEl) fieldsFoundEl.textContent = totalFields;
      if (highConfidenceEl) highConfidenceEl.textContent = totalFields;
      if (needsReviewEl) needsReviewEl.textContent = 0;

      if (tabStatus) {
        tabStatus.textContent = `All ${totalFields} fields matched.`;
        tabStatus.className = 'upload-status success';
      }
      if (autofillBtn) autofillBtn.disabled = false;

      console.log('[Fillosophy] Full template match — AI skipped.');
      renderMatchPreviewInPopup();
      wireAutofillButton();
      return;
    }

    // ── Step B: Partial or no template match — call AI /match ────────────────
    const templateMatched = templateResult?.matched ?? {};
    const fieldsForAI = templateResult?.unmatched ?? fieldLabels;
    const templateMatchCount = Object.keys(templateMatched).length;

    if (templateMatchCount > 0) {
      console.log(`[Fillosophy] Template matched ${templateMatchCount} fields; sending ${fieldsForAI.length} to AI.`);
    }

    const response = await fetch('http://localhost:8000/match/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: fieldsForAI,
        profile: currentProfile,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const aiMapping = data.mapping || {};

    // ── Merge: template matches (high confidence) + AI matches ────────────
    fieldMapping = { ...templateMatched, ...aiMapping };
    fieldMatchingCacheTimestamp = Date.now();
    lastMatchTimestamp = fieldMatchingCacheTimestamp;

    // Recompute stats from the merged mapping
    const totalFields = Object.keys(fieldMapping).length;
    const highConfidence = Object.values(fieldMapping)
      .filter((m) => (m.confidence ?? 0) >= 80).length;
    const needsReview = totalFields - highConfidence;

    if (fieldsFoundEl) fieldsFoundEl.textContent = totalFields;
    if (highConfidenceEl) highConfidenceEl.textContent = highConfidence;
    if (needsReviewEl) needsReviewEl.textContent = needsReview;

    if (needsReview > 0) {
      if (tabStatus) {
        tabStatus.textContent = `⚠ ${needsReview} field(s) will be flagged for review.`;
        tabStatus.className = 'upload-status amber';
      }
    } else {
      if (tabStatus) {
        const extra = templateMatchCount > 0
          ? ` (${templateMatchCount} via template)`
          : '';
        tabStatus.textContent = `✓ All fields matched with high confidence${extra}.`;
        tabStatus.className = 'upload-status success';
      }
    }

    console.log('[Fillosophy] Match preview complete. Mapping ready.');

    renderMatchPreviewInPopup();
    wireAutofillButton();

  } catch (err) {
    console.error('[Fillosophy] Match preview failed:', err);
    if (tabStatus) {
      tabStatus.textContent = '⚠️ The backend server is offline. Please start it to map fields.';
      tabStatus.className = 'upload-status error';
    }
    if (autofillBtn) autofillBtn.disabled = true;
  }
}

/**
 * Wires the autofill button click handler. Extracted into a helper so
 * both the template-only and AI match paths can share it.
 */
function wireAutofillButton() {
  const autofillBtn = document.getElementById('autofill-btn');
  if (!autofillBtn) return;

  autofillBtn.disabled = false;

  // Clone to remove any previous listener before attaching a fresh one
  const freshBtn = autofillBtn.cloneNode(true);
  autofillBtn.parentNode.replaceChild(freshBtn, autofillBtn);

  freshBtn.addEventListener('click', async () => {
    const showError = (msg) => {
      const el = document.getElementById('autofill-tab-status');
      if (el) { el.textContent = msg; el.className = 'upload-status error'; }
    };

    if (!currentProfile) {
      showError("⚠ No profile loaded. Upload a resume first.");
      return;
    }

    const activeProfileName = await getActiveProfile();
    if (currentProfileName && activeProfileName && currentProfileName !== activeProfileName) {
      console.warn(
        `[Fillosophy] Profile mismatch detected!`,
        `Using: ${currentProfileName}, Active: ${activeProfileName}`
      );
      const correctProfile = await getProfile(activeProfileName);
      if (correctProfile) {
        currentProfile = correctProfile;
        currentProfileName = activeProfileName;
        console.log('[Fillosophy] Profile corrected to:', activeProfileName);
      }
    }

    logProfileState();

    // Guard 1 — mapping must exist
    if (!fieldMapping || Object.keys(fieldMapping).length === 0) {
      showError('⚠ No field matches available. Reopen this tab to rescan.');
      return;
    }
    // Guard 2 — fields must be detected
    if (!detectedFields || detectedFields.length === 0) {
      showError('⚠ No fields detected on this page.');
      return;
    }

    // Loading state
    freshBtn.disabled = true;
    freshBtn.textContent = 'Filling form…';
    // Always re-query — the clone swap may have detached the old reference
    const getStatus = () => document.getElementById('autofill-tab-status');
    const st = getStatus();
    if (st) { st.textContent = ''; st.className = 'upload-status'; }

    try {
      const res = await sendMessage('APPLY_AUTOFILL', {
        mapping: fieldMapping,
        fields: detectedFields
      });

      const summary = res?.summary ?? {};
      const filled = summary.filled ?? 0;
      const flagged = summary.flagged ?? 0;

      // Update stats row with post-fill numbers
      const hcEl = document.getElementById('stat-high-confidence');
      const nrEl = document.getElementById('stat-needs-review');
      if (hcEl) hcEl.textContent = filled;
      if (nrEl) nrEl.textContent = flagged;

      // Status message
      const st2 = getStatus();
      if (st2) {
        if (filled === 0 && flagged === 0) {
          st2.textContent = `⚠ No fields could be matched to your profile. Try re-scanning or check your profile.`;
          st2.className = 'upload-status amber';
        } else if (flagged > 0) {
          st2.textContent = `✓ Filled ${filled} field(s). ${flagged} flagged for your review on the page.`;
          st2.className = 'upload-status amber';
        } else {
          st2.textContent = `✓ All ${filled} field(s) filled successfully!`;
          st2.className = 'upload-status success';
        }
      }

      console.log('[Fillosophy] Autofill applied:', summary);

    } catch (err) {
      console.error('[Fillosophy] Autofill failed:', err);
      const st3 = getStatus();
      if (st3) {
        st3.textContent = `✗ Autofill failed. ${err.message}`;
        st3.className = 'upload-status error';
      }
    } finally {
      freshBtn.disabled = false;
      freshBtn.textContent = 'Autofill This Form';
    }
  });
}

// ════════════════════════════════════════════════════════════
// FIELD LABEL COLLECTION
// ════════════════════════════════════════════════════════════

/**
 * Sends DETECT_FIELDS to the service worker, stores the full descriptor
 * objects in detectedFields, and returns a flat array of best-available
 * label strings for the AI /match endpoint.
 *
 * Priority order per descriptor:
 *   label → placeholder → ariaLabel → name → id → "field_{index}"
 *
 * @returns {Promise<string[]>} One label string per detected field.
 */
async function collectFieldLabels() {
  const response = await sendMessage('DETECT_FIELDS');

  if (response?.status !== 'ok') {
    throw new Error(`DETECT_FIELDS returned status: ${response?.status ?? 'undefined'}`);
  }

  // Store full descriptors for the autofill handler
  detectedFields = response.fields ?? [];

  // Build the label list using the specified priority order
  const labels = detectedFields.map((d) =>
    d.label ??
    d.placeholder ??
    d.ariaLabel ??
    d.name ??
    d.id ??
    `field_${d.index}`
  );

  console.log(`[Fillosophy] Collected ${labels.length} field labels for matching`);
  return labels;
}

// ════════════════════════════════════════════════════════════
// UI HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Sets the #upload-status paragraph text and CSS modifier class.
 *
 * @param {HTMLElement}          el      - The status element.
 * @param {string}               message - Text to display ('': clears it).
 * @param {'success'|'error'|''} type    - CSS modifier class.
 */
function setStatus(el, message, type) {
  if (!el) return;
  el.textContent = message;
  el.className = `upload-status${type ? ` ${type}` : ''}`;
}

/**
 * Swaps button text for loading state and back.
 * The nand redesign removed the extract-btn-icon SVG, so this
 * simplified version only toggles the label text.
 *
 * @param {HTMLButtonElement} btn
 * @param {HTMLElement}       labelEl
 * @param {boolean}           isLoading
 */
function setLoadingState(btn, labelEl, isLoading) {
  if (labelEl) labelEl.textContent = isLoading ? 'Extracting…' : 'Extract';
  // Only force-disable on entry; re-enable decisions are made by the caller
  if (isLoading) btn.disabled = true;
}

/**
 * Builds and renders the dynamic list of matched field values and confidence scores
 * directly inside the Autofill panel of the extension popup.
 */
function renderMatchPreviewInPopup() {
  const previewSection = document.getElementById('autofill-preview-section');
  const previewList = document.getElementById('autofill-preview-list');
  if (!previewSection || !previewList) return;

  previewList.innerHTML = '';

  const entries = Object.entries(fieldMapping);
  if (entries.length === 0) {
    setPreviewSectionVisible(previewSection, false);
    return;
  }

  setPreviewSectionVisible(previewSection, true);

  entries.forEach(([label, data]) => {
    // Create card container
    const card = document.createElement('div');
    card.className = 'autofill-preview-card';

    // Header with label and badge
    const header = document.createElement('div');
    header.className = 'autofill-preview-header';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'autofill-preview-name';
    nameSpan.textContent = label;

    const badge = document.createElement('span');
    const isLow = (data.confidence ?? 0) < 70;
    badge.className = 'autofill-preview-badge ' + (isLow ? 'badge-low' : 'badge-high');
    badge.textContent = `${data.confidence ?? 0}%`;

    header.appendChild(nameSpan);
    header.appendChild(badge);

    // Value
    const valDiv = document.createElement('div');
    valDiv.className = 'autofill-preview-val';
    valDiv.textContent = data.value !== null ? data.value : '— (No Match)';
    if (data.value === null) {
      valDiv.style.opacity = '0.5';
    }

    card.appendChild(header);
    card.appendChild(valDiv);
    previewList.appendChild(card);
  });
}

/**
 * Toggles the autofill preview section with the same motion language as panel switches.
 * @param {HTMLElement} sectionEl
 * @param {boolean} isVisible
 */
function setPreviewSectionVisible(sectionEl, isVisible) {
  if (!sectionEl) return;

  if (previewSectionHideTimer) {
    clearTimeout(previewSectionHideTimer);
    previewSectionHideTimer = null;
  }

  if (isVisible) {
    sectionEl.removeAttribute('hidden');
    requestAnimationFrame(() => {
      sectionEl.classList.add('is-visible');
    });
    return;
  }

  sectionEl.classList.remove('is-visible');
  previewSectionHideTimer = setTimeout(() => {
    if (!sectionEl.classList.contains('is-visible')) {
      sectionEl.setAttribute('hidden', '');
    }
    previewSectionHideTimer = null;
  }, PANEL_SWITCH_DURATION_MS);
}

// ════════════════════════════════════════════════════════════
// AUTHENTICATION FLOW HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Resolves the active user session JWT access token from chrome storage.
 * @returns {Promise<string|null>}
 */
function getAuthToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['supabase_session'], (result) => {
      resolve(result.supabase_session?.access_token || null);
    });
  });
}

/**
 * Checks if the user has a valid Supabase session.
 * If verified, redirects to the main app layout. Otherwise shows the login screen.
 */
async function checkAuthState() {
  const loginStatus = document.getElementById('login-status');
  if (loginStatus) setStatus(loginStatus, '', '');

  chrome.storage.local.get(['supabase_session'], async (result) => {
    const session = result.supabase_session;

    if (!session || !session.access_token) {
      showAuthScreen('login');
      return;
    }

    try {
      const response = await fetch('http://localhost:8000/auth/verify', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.status === 'success') {
          enterApp();
        } else {
          showAuthScreen('login');
        }
      } else {
        showAuthScreen('login');
      }
    } catch (err) {
      console.error('[Fillosophy Auth] Session verification failed:', err.message);
      showAuthScreen('login');
      if (loginStatus) {
        setStatus(loginStatus, '⚠️ The backend server is offline. Please start it to authenticate.', 'error');
      }
    }
  });
}

/**
 * Shows the login or signup auth screens and hides the main panels.
 * @param {'login'|'signup'} screen
 */
function showAuthScreen(screen) {
  const appContainer = document.getElementById('app');
  const loginScreen = document.getElementById('screen-login');
  const signupScreen = document.getElementById('screen-signup');
  const logoutBtn = document.getElementById('header-logout-btn');

  if (appContainer) appContainer.classList.add('auth-mode');
  if (logoutBtn) logoutBtn.setAttribute('hidden', '');

  // Clear inputs and status
  const loginStatus = document.getElementById('login-status');
  const signupStatus = document.getElementById('signup-status');
  if (loginStatus) setStatus(loginStatus, '', '');
  if (signupStatus) setStatus(signupStatus, '', '');

  if (screen === 'login') {
    if (loginScreen) loginScreen.removeAttribute('hidden');
    if (signupScreen) signupScreen.setAttribute('hidden', '');
  } else {
    if (signupScreen) signupScreen.removeAttribute('hidden');
    if (loginScreen) loginScreen.setAttribute('hidden', '');
  }
}

/**
 * Hides authentication screens and presents the main application panels.
 */
function enterApp() {
  const appContainer = document.getElementById('app');
  const loginScreen = document.getElementById('screen-login');
  const signupScreen = document.getElementById('screen-signup');
  const logoutBtn = document.getElementById('header-logout-btn');

  if (appContainer) appContainer.classList.remove('auth-mode');
  if (loginScreen) loginScreen.setAttribute('hidden', '');
  if (signupScreen) signupScreen.setAttribute('hidden', '');
  if (logoutBtn) logoutBtn.removeAttribute('hidden');

  // Uploads tab is strictly the default tab whenever the extension is opened or logged in
  const initialTab = DEFAULT_TAB;

  // Sync database state before switching tab to ensure UI profile lists are complete
  syncProfilesFromBackend().then(() => {
    switchTab(initialTab);
  });
}

/**
 * Controls the loading state/text of authentication action buttons.
 * @param {HTMLButtonElement} btn
 * @param {boolean} isLoading
 * @param {string} originalText
 */
function setAuthButtonLoading(btn, isLoading, originalText) {
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    btn.textContent = 'Please wait...';
  } else {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}
