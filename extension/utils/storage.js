// Fillosophy — chrome.storage.local utility wrapper

/**
 * storage.js — Fillosophy Chrome Extension
 *
 * Async helpers for reading and writing all Fillosophy data in
 * chrome.storage.local. Every public function:
 *   - Returns a Promise
 *   - Logs its operation with the "[Fillosophy Storage]" prefix
 *   - Catches chrome.runtime.lastError and rejects with a real Error
 *
 * Key schema
 * ──────────
 *   profile_{name}    →  profile data object  (e.g. "profile_Academic")
 *   fillosophy_active →  { activeProfile: string }
 */

// ════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════

/** Prefix applied to every profile key in storage. */
const PROFILE_PREFIX = 'profile_';

/** Key used to persist the currently active profile name. */
const ACTIVE_PROFILE_KEY = 'fillosophy_active';

// ════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Builds the storage key for a named profile.
 * @param {string} name — e.g. "Academic"
 * @returns {string}    — e.g. "profile_Academic"
 */
function profileKey(name) {
  return `${PROFILE_PREFIX}${name}`;
}

/**
 * Promise wrapper around chrome.storage.local.get.
 * Rejects if chrome.runtime.lastError is set after the call.
 *
 * @param {string|string[]} keys
 * @returns {Promise<Object>} — the result object from storage
 */
function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Promise wrapper around chrome.storage.local.set.
 * Rejects if chrome.runtime.lastError is set after the call.
 *
 * @param {Object} items — key/value pairs to write
 * @returns {Promise<void>}
 */
function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Promise wrapper around chrome.storage.local.remove.
 * Rejects if chrome.runtime.lastError is set after the call.
 *
 * @param {string|string[]} keys — key(s) to delete
 * @returns {Promise<void>}
 */
function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// ════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════

// ── saveProfile ──────────────────────────────────────────────

/**
 * Saves a profile object to chrome.storage.local under "profile_{name}".
 *
 * @param {string} name  — Profile label, e.g. "Academic", "Personal"
 * @param {Object} data  — Structured profile data (name, email, skills, …)
 * @returns {Promise<void>}
 *
 * @example
 *   await saveProfile('Academic', { name: 'Aditya', email: 'a@b.com' });
 */
export async function saveProfile(name, data) {
  console.log(`[Fillosophy Storage] saveProfile → key: "${profileKey(name)}"`);
  try {
    await storageSet({ [profileKey(name)]: data });
    console.log(`[Fillosophy Storage] saveProfile ✓ "${name}" saved`);
  } catch (err) {
    console.error(`[Fillosophy Storage] saveProfile ✗ "${name}":`, err.message);
    throw err;
  }
}

// ── getProfile ───────────────────────────────────────────────

/**
 * Retrieves a stored profile by name.
 *
 * @param {string} name — Profile label to look up
 * @returns {Promise<Object|null>} — The profile object, or null if not found
 *
 * @example
 *   const profile = await getProfile('Academic');
 */
export async function getProfile(name) {
  console.log(`[Fillosophy Storage] getProfile → key: "${profileKey(name)}"`);
  try {
    const key    = profileKey(name);
    const result = await storageGet([key]);
    const data   = result[key] ?? null;
    console.log(
      `[Fillosophy Storage] getProfile ✓ "${name}"`,
      data ? 'found' : 'not found'
    );
    return data;
  } catch (err) {
    console.error(`[Fillosophy Storage] getProfile ✗ "${name}":`, err.message);
    throw err;
  }
}

// ── listProfiles ─────────────────────────────────────────────

/**
 * Lists all saved profile names by scanning all keys in storage
 * and filtering those that start with the "profile_" prefix.
 *
 * @returns {Promise<string[]>} — Array of profile name strings
 *                                e.g. ["Academic", "Personal", "Job Application"]
 *
 * @example
 *   const names = await listProfiles(); // ["Academic", "Personal"]
 */
export async function listProfiles() {
  console.log('[Fillosophy Storage] listProfiles → scanning all keys');
  try {
    // null fetches all keys
    const all   = await storageGet(null);
    const names = Object.keys(all)
      .filter((key) => key.startsWith(PROFILE_PREFIX))
      .map((key) => key.slice(PROFILE_PREFIX.length));

    console.log(`[Fillosophy Storage] listProfiles ✓ found ${names.length} profile(s):`, names);
    return names;
  } catch (err) {
    console.error('[Fillosophy Storage] listProfiles ✗:', err.message);
    throw err;
  }
}

// ── setActiveProfile ─────────────────────────────────────────

/**
 * Marks a profile as the currently active one.
 * The popup and content script read this to know which profile to use.
 *
 * @param {string} name — Profile label to activate
 * @returns {Promise<void>}
 *
 * @example
 *   await setActiveProfile('Academic');
 */
export async function setActiveProfile(name) {
  console.log(`[Fillosophy Storage] setActiveProfile → "${name}"`);
  try {
    await storageSet({ [ACTIVE_PROFILE_KEY]: { activeProfile: name } });
    console.log(`[Fillosophy Storage] setActiveProfile ✓ active profile set to "${name}"`);
  } catch (err) {
    console.error(`[Fillosophy Storage] setActiveProfile ✗:`, err.message);
    throw err;
  }
}

// ── getActiveProfile ─────────────────────────────────────────

/**
 * Retrieves the name of the currently active profile.
 *
 * @returns {Promise<string|null>} — Profile name, or null if none is set
 *
 * @example
 *   const active = await getActiveProfile(); // "Academic"
 */
export async function getActiveProfile() {
  console.log('[Fillosophy Storage] getActiveProfile');
  try {
    const result  = await storageGet([ACTIVE_PROFILE_KEY]);
    const entry   = result[ACTIVE_PROFILE_KEY] ?? null;
    const name    = entry?.activeProfile ?? null;
    console.log(
      '[Fillosophy Storage] getActiveProfile ✓',
      name ? `active: "${name}"` : 'no active profile set'
    );
    return name;
  } catch (err) {
    console.error('[Fillosophy Storage] getActiveProfile ✗:', err.message);
    throw err;
  }
}

// ── deleteProfile ────────────────────────────────────────────

/**
 * Permanently removes a profile from storage.
 * If the deleted profile was the active one, the caller is responsible
 * for updating the active profile via setActiveProfile().
 *
 * @param {string} name — Profile label to delete
 * @returns {Promise<void>}
 *
 * @example
 *   await deleteProfile('Personal');
 */
export async function deleteProfile(name) {
  console.log(`[Fillosophy Storage] deleteProfile → key: "${profileKey(name)}"`);
  try {
    await storageRemove([profileKey(name)]);
    console.log(`[Fillosophy Storage] deleteProfile ✓ "${name}" removed`);
  } catch (err) {
    console.error(`[Fillosophy Storage] deleteProfile ✗ "${name}":`, err.message);
    throw err;
  }
}

// ── clearAllProfiles ─────────────────────────────────────────

/**
 * Removes all stored profile keys ("profile_*") and the active profile key
 * from chrome.storage.local to enforce user data isolation across login sessions.
 *
 * @returns {Promise<void>}
 */
export async function clearAllProfiles() {
  console.log('[Fillosophy Storage] clearAllProfiles → removing all profile keys');
  try {
    const all = await storageGet(null);
    const keysToRemove = Object.keys(all).filter(
      (key) => key.startsWith(PROFILE_PREFIX) || key === ACTIVE_PROFILE_KEY
    );
    if (keysToRemove.length > 0) {
      await storageRemove(keysToRemove);
      console.log(`[Fillosophy Storage] clearAllProfiles ✓ removed ${keysToRemove.length} key(s)`);
    }
  } catch (err) {
    console.error('[Fillosophy Storage] clearAllProfiles ✗:', err.message);
    throw err;
  }
}
