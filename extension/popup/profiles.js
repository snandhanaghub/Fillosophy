import { IMPORT_URL } from './constants.js';
import { state } from './state.js';
import { setStatus } from './utils.js';
import { getProfile, saveProfile, setActiveProfile, getActiveProfile, listProfiles, deleteProfile } from '../utils/storage.js';

/**
 * Populates the readonly preview fields in the Profiles tab with extracted
 * profile data and syncs the active-profile radio button.
 *
 * @param {Object} profile - Structured profile dict returned by /extract.
 */
export function displayProfile(profile) {
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    // Show '—' for null, undefined, empty string, and the literal string "null"
    // but preserve numeric 0 and other falsy-but-valid values
    if (value == null || value === '' || value === 'null') {
      el.value = '—';
    } else {
      el.value = value;
    }
  };

  set('profile-field-name',   profile.full_name ?? '—');
  set('profile-field-email',  profile.email     ?? '—');
  set('profile-field-cgpa',   profile.cgpa      ?? '—');
  set('profile-field-degree', profile.degree    ?? '—');
  set('profile-field-skills',
    Array.isArray(profile.skills)
      ? profile.skills.join(', ')
      : (profile.skills ?? '—')
  );

  console.log('[Fillosophy] Profile displayed in Profiles tab');
}

/**
 * Exports the current active profile as a formatted JSON file.
 * Uses chrome.downloads.download() for reliable Manifest V3 popup downloads
 * with a blob-anchor fallback.
 */
export async function handleExportJson() {
  const profilesStatus = document.getElementById('profiles-tab-status');

  // Guard: no profile loaded
  if (!state.currentProfile) {
    if (profilesStatus) {
      setStatus(profilesStatus, '⚠ No active profile to export.', 'error');
    }
    console.warn('[Fillosophy] Export aborted — no active profile.');
    return;
  }

  // Get the active profile name from storage
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

  // Build export payload
  const exportPayload = {
    fillosophy_export_version: '1.0',
    exported_at: new Date().toISOString(),
    profile_name: activeProfileName,
    profile_data: state.currentProfile,
  };

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const filename   = `fillosophy_${activeProfileName.toLowerCase()}_${Date.now()}.json`;

  // Trigger download
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);

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
    const a  = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    downloadSucceeded = true;
  }

  URL.revokeObjectURL(url);

  // Status feedback
  if (profilesStatus) {
    setStatus(profilesStatus, `Profile exported as ${filename}`, 'success');
  }
  console.log(`[Fillosophy] Profile exported: ${activeProfileName}`);
}

/**
 * Handles the hidden file-input change event to import a Fillosophy
 * JSON profile.  Validates structure, confirms overwrites, persists to
 * chrome.storage + backend, and refreshes the Profiles tab UI.
 *
 * @param {Event} event - The file-input 'change' event.
 */
export async function handleImportJson(event) {
  const profilesStatus  = document.getElementById('profiles-tab-status');
  const importFileInput = document.getElementById('import-file-input');

  // Guard: no file selected
  const file = event.target.files?.[0];
  if (!file) return;

  // Validate file extension
  if (!file.name.endsWith('.json')) {
    setStatus(profilesStatus, '✗ Please select a valid .json file', 'error');
    if (importFileInput) importFileInput.value = '';
    return;
  }

  // Read and parse
  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);

    // Validate required top-level keys
    if (!parsed.profile_name || !parsed.profile_data) {
      throw new Error('Missing required fields: profile_name or profile_data');
    }

    // Validate profile_data has at least one expected key
    const requiredKeys  = ['full_name', 'email', 'skills'];
    const hasValidShape = requiredKeys.some((k) => k in parsed.profile_data);
    if (!hasValidShape) {
      throw new Error('File does not match Fillosophy profile format');
    }
  } catch (err) {
    setStatus(profilesStatus, `✗ Invalid file: ${err.message}`, 'error');
    if (importFileInput) importFileInput.value = '';
    return;
  }

  // Overwrite confirmation
  try {
    const existing = await getProfile(parsed.profile_name);
    if (existing) {
      const confirmed = confirm(
        `A profile named "${parsed.profile_name}" already exists. Overwrite it?`
      );
      if (!confirmed) {
        console.log('[Fillosophy] Import cancelled by user (overwrite declined).');
        if (importFileInput) importFileInput.value = '';
        return;
      }
    }
  } catch (lookupErr) {
    // Non-fatal — proceed with import even if lookup fails
    console.warn('[Fillosophy] Profile lookup failed, proceeding with import:', lookupErr.message);
  }

  // Save to chrome.storage
  try {
    await saveProfile(parsed.profile_name, parsed.profile_data);
    await setActiveProfile(parsed.profile_name);
    state.currentProfile = parsed.profile_data;
    console.log(`[Fillosophy] Profile saved to chrome.storage: ${parsed.profile_name}`);
  } catch (storageErr) {
    setStatus(profilesStatus, `✗ Import failed: ${storageErr.message}`, 'error');
    if (importFileInput) importFileInput.value = '';
    return;
  }

  // Update the UI
  displayProfile(parsed.profile_data);
  if (window.refreshProfilePickers) {
    await window.refreshProfilePickers();
  }

  // Invalidate cached field mapping (same as profile-switch logic)
  state.fieldMapping       = {};
  state.lastMatchTimestamp = null;

  // Show success
  setStatus(profilesStatus, `Imported profile: ${parsed.profile_name}`, 'success');
  console.log(`[Fillosophy] Profile imported: ${parsed.profile_name}`);

  // Sync to backend (non-blocking)
  try {
    const res = await fetch(IMPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile_name: parsed.profile_name,
        profile_data: parsed.profile_data,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('[Fillosophy] Backend sync successful for imported profile.');
  } catch (syncErr) {
    console.warn('[Fillosophy] Backend sync failed, profile saved locally only:', syncErr.message);
  }

  // Reset file input so the same file can be re-imported
  if (importFileInput) importFileInput.value = '';
}

/**
 * Maps default profile slot names to user-friendly emoji icons and display titles.
 */
const DEFAULT_MAP = {
  personal: { label: 'Personal' },
  academic: { label: 'Academic' },
  job:      { label: 'Job Application' }
};

/**
 * Initializes the reusable profile picker rows on both the Upload and Profiles tabs,
 * setting up event listeners, dynamic custom profile options, and tab selection synchronizations.
 */
export async function initProfilePicker() {
  const uploadContainer = document.getElementById('upload-profile-picker');
  const profilesContainer = document.getElementById('profiles-profile-picker');

  // Load the active profile initially, defaulting to "personal"
  let activeName = await getActiveProfile();
  if (!activeName) {
    activeName = 'personal';
    await setActiveProfile(activeName);
  }

  // Fetch the active profile details to populate preview
  const data = await getProfile(activeName) || { full_name: '', email: '', cgpa: '', degree: '', skills: [] };
  state.currentProfile = data;
  displayProfile(data);

  // Sync refresh handle
  const render = async () => {
    const stored = await listProfiles();
    const defaultKeys = ['personal', 'academic', 'job'];
    const allNames = Array.from(new Set([...defaultKeys, ...stored]));

    activeName = await getActiveProfile() || 'personal';

    const renderTo = (container, isUploadPanel) => {
      if (!container) return;
      container.innerHTML = '';

      allNames.forEach((name) => {
        const isDefault = defaultKeys.includes(name);
        const displayInfo = DEFAULT_MAP[name] || { label: name };

        const chip = document.createElement('div');
        chip.className = `profile-chip${name === activeName ? ' active' : ''}`;
        chip.setAttribute('data-profile', name);

        const label = document.createElement('span');
        label.textContent = displayInfo.label;
        chip.appendChild(label);

        // Edit/delete options for non-default slots (Profiles panel only)
        if (!isDefault && !isUploadPanel) {
          const optionsBtn = document.createElement('button');
          optionsBtn.className = 'chip-options-btn';
          optionsBtn.textContent = '⋯';
          optionsBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await handleChipOptions(name);
          });
          chip.appendChild(optionsBtn);
        }

        chip.addEventListener('click', async () => {
          if (name === activeName) return;
          await selectProfile(name);
        });

        container.appendChild(chip);
      });

      // Add custom profile creator chip
      const addChip = document.createElement('div');
      addChip.className = 'profile-chip add-chip';
      addChip.textContent = '+ Add profile';
      addChip.addEventListener('click', () => {
        showInlineInput(container, addChip);
      });
      container.appendChild(addChip);
    };

    renderTo(uploadContainer, true);
    renderTo(profilesContainer, false);
  };

  // Sync selection
  const selectProfile = async (name) => {
    activeName = name;
    await setActiveProfile(name);
    const pData = await getProfile(name) || { full_name: '', email: '', cgpa: '', degree: '', skills: [] };
    state.currentProfile = pData;
    displayProfile(pData);

    state.fieldMapping = {};
    state.lastMatchTimestamp = null;
    await render();
  };

  // Rename or delete
  const handleChipOptions = async (name) => {
    const val = prompt(`Profile: "${name}"\n\nEnter a new name to rename, or type "DELETE" to remove this profile:`, name);
    if (val === null) return;

    const trimmed = val.trim();
    if (!trimmed) return;

    if (trimmed.toUpperCase() === 'DELETE') {
      const confirmed = confirm(`Are you sure you want to delete the profile "${name}"?`);
      if (!confirmed) return;
      await deleteProfile(name);
      if (activeName === name) {
        await selectProfile('personal');
      } else {
        await render();
      }
    } else if (trimmed !== name) {
      const stored = await listProfiles();
      const defaultKeys = ['personal', 'academic', 'job'];
      const allNames = Array.from(new Set([...defaultKeys, ...stored]));
      if (allNames.some(n => n.toLowerCase() === trimmed.toLowerCase())) {
        alert('A profile with this name already exists.');
        return;
      }

      const pData = await getProfile(name) || { full_name: '', email: '', cgpa: '', degree: '', skills: [] };
      await saveProfile(trimmed, pData);
      await deleteProfile(name);

      if (activeName === name) {
        await selectProfile(trimmed);
      } else {
        await render();
      }
    }
  };

  // Inline input display
  const showInlineInput = (container, addChip) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'profile-chip-input';
    input.placeholder = 'Profile name...';

    const commitInput = async () => {
      const val = input.value.trim();
      if (val) {
        const stored = await listProfiles();
        const defaultKeys = ['personal', 'academic', 'job'];
        const allNames = Array.from(new Set([...defaultKeys, ...stored]));
        if (allNames.some(n => n.toLowerCase() === val.toLowerCase())) {
          alert('A profile with this name already exists.');
          await render();
          return;
        }

        await saveProfile(val, { full_name: '', email: '', cgpa: '', degree: '', skills: [] });
        await selectProfile(val);
      } else {
        await render();
      }
    };

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        await commitInput();
      } else if (e.key === 'Escape') {
        await render();
      }
    });

    input.addEventListener('blur', async () => {
      setTimeout(async () => {
        if (container.contains(input)) {
          await commitInput();
        }
      }, 150);
    });

    container.replaceChild(input, addChip);
    input.focus();
  };

  // Bind reload function globally for import synchronizations
  window.refreshProfilePickers = render;
  await render();
}
