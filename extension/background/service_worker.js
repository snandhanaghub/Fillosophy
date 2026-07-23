// Fillosophy — Background Service Worker | Message bus & API relay

import {
  getProfile,
  getActiveProfile,
  saveProfile,
  setActiveProfile,
} from '../utils/storage.js';

/** Base URL of the local FastAPI backend. */
const BACKEND_BASE_URL = 'http://localhost:8000';

// ─── Tab helpers ───────────────────────────────────────────────

/**
 * Returns the currently active tab in the focused window.
 *
 * @returns {Promise<chrome.tabs.Tab>}
 * @throws {Error} If no active tab is found.
 */
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) {
    throw new Error('No active tab found');
  }
  return tabs[0];
}

/**
 * Sends a message to the content script running in the given tab.
 * Throws a descriptive error if the content script is not reachable
 * (e.g. on chrome:// pages or tabs where injection is blocked).
 *
 * @param {number} tabId
 * @param {Object} message
 * @returns {Promise<any>} The response from the content script.
 */
async function sendToContentScript(tabId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    return response;
  } catch (error) {
    throw new Error(`Content script not reachable on this tab: ${error.message}`);
  }
}

/**
 * Ensures the Fillosophy content script is running in the given tab.
 *
 * Strategy:
 *   1. Send a PING — if the content script is already present it responds
 *      immediately and we return true without any injection.
 *   2. If the PING throws (no listener), programmatically inject
 *      content/content.js via chrome.scripting.executeScript.
 *   3. If injection also fails (chrome://, extension pages, PDFs, etc.)
 *      log the error and return false so callers can surface a user-friendly
 *      message instead of propagating a cryptic Chrome error.
 *
 * @param {number} tabId
 * @returns {Promise<boolean>} true if the content script is ready, false if
 *                            the tab cannot be scripted.
 */
async function ensureContentScript(tabId) {
  // Step 1 — PING: already injected?
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (pong?.status === 'content_script_ready') {
      return true;
    }
  } catch {
    // No listener — content script not present yet, fall through to injection
  }

  // Step 2 — Programmatic injection
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files:  ['content/content.js'],
    });
    console.log(`[Fillosophy SW] Content script injected into tab ${tabId}`);
    return true;
  } catch (injectionErr) {
    // Step 3 — Unscriptable page (chrome://, extension pages, PDFs…)
    console.warn(
      `[Fillosophy SW] Cannot inject into tab ${tabId}:`,
      injectionErr.message
    );
    return false;
  }
}

// ─── Lifecycle ─────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.log('[Fillosophy] Extension installed/updated.');

  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    // First-install hook — uncomment to open an onboarding page:
    // chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
  }
});

// ─── Message router ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(`[Fillosophy SW] Message received: ${message.type}`);

  switch (message.type) {

    // PING_CONTENT — verify the content script is alive on the active tab (inject if missing)
    case 'PING_CONTENT':
      getActiveTab()
        .then(async (tab) => {
          const ready = await ensureContentScript(tab.id);
          if (!ready) {
            sendResponse({ status: 'error', message: 'Cannot inject into this page type' });
            return;
          }
          const response = await sendToContentScript(tab.id, { type: 'PING' });
          sendResponse(response);
        })
        .catch((err) => sendResponse({ status: 'error', message: err.message }));
      return true;

    // DETECT_FIELDS — scan the active tab's page for fillable form fields
    case 'DETECT_FIELDS':
      getActiveTab()
        .then(async (tab) => {
          const ready = await ensureContentScript(tab.id);
          if (!ready) {
            sendResponse({ status: 'error', message: 'Cannot inject into this page type' });
            return;
          }
          const response = await sendToContentScript(tab.id, { type: 'DETECT_FIELDS' });
          sendResponse({ status: 'ok', fields: response.fields, count: response.count });
        })
        .catch((err) => sendResponse({ status: 'error', message: err.message }));
      return true;

    // GET_PAGE_INFO — lightweight metadata about the active tab
    case 'GET_PAGE_INFO':
      getActiveTab()
        .then(async (tab) => {
          const ready = await ensureContentScript(tab.id);
          if (!ready) {
            sendResponse({ status: 'error', message: 'Cannot inject into this page type' });
            return;
          }
          const response = await sendToContentScript(tab.id, { type: 'GET_PAGE_INFO' });
          sendResponse(response);
        })
        .catch((err) =>
          sendResponse({ status: 'error', url: 'unknown', fieldCount: 0 })
        );
      return true;

    // GET_ACTIVE_PROFILE — read active profile name + data from chrome.storage.local
    case 'GET_ACTIVE_PROFILE':
      chrome.storage.local.get(['fillosophy_active'], (result) => {
        const profileName = result?.fillosophy_active?.activeProfile ?? null;
        if (!profileName) {
          sendResponse({ status: 'empty' });
          return;
        }
        chrome.storage.local.get([`profile_${profileName}`], (profileResult) => {
          const profile = profileResult?.[`profile_${profileName}`] ?? null;
          sendResponse({ status: 'ok', profileName, profile });
        });
      });
      return true;

    // SW_SET_ACTIVE_PROFILE — persist the chosen profile name
    case 'SW_SET_ACTIVE_PROFILE':
      handleSetActiveProfile(message.payload?.name)
        .then(sendResponse)
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    // SW_EXTRACT_RESUME — relay resume to backend (stub, wired in Week 3)
    case 'SW_EXTRACT_RESUME':
      handleExtractResume(message.payload)
        .then(sendResponse)
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    // APPLY_AUTOFILL — forward AI mapping + field descriptors to content script
    case 'APPLY_AUTOFILL':
      getActiveTab()
        .then(async (tab) => {
          const ready = await ensureContentScript(tab.id);
          if (!ready) {
            sendResponse({ status: 'error', message: 'Cannot inject into this page type' });
            return;
          }
          console.log(`[Fillosophy SW] Forwarding autofill: ${(message.fields ?? []).length} fields`);
          const response = await sendToContentScript(tab.id, {
            type:    'APPLY_AUTOFILL',
            mapping: message.mapping,
            fields:  message.fields
          });
          sendResponse({ status: 'ok', summary: response?.summary ?? {} });
        })
        .catch((err) => {
          console.error('[Fillosophy SW] Autofill failed:', err);
          sendResponse({ status: 'error', message: err.message });
        });
      return true;

    default:
      console.warn(`[Fillosophy SW] Unknown message type: ${message.type}`);
      sendResponse({ status: 'unhandled' });
      return true;
  }
});

// ─── Handlers ──────────────────────────────────────────────────

/**
 * Sets the active profile name in chrome.storage.
 *
 * @param {string} name
 * @returns {Promise<{ success: boolean }>}
 */
async function handleSetActiveProfile(name) {
  if (!name) return { success: false, error: 'Profile name is required.' };
  await setActiveProfile(name);
  console.log('[Fillosophy SW] SW_SET_ACTIVE_PROFILE → set to:', name);
  return { success: true };
}

/**
 * Forwards the uploaded resume to the backend /extract endpoint.
 * Full implementation in Week 3.
 *
 * @param {{ fileDataUrl: string, fileName: string, profileName: string }} payload
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function handleExtractResume(payload) {
  console.log('[Fillosophy SW] SW_EXTRACT_RESUME received —', payload?.fileName);
  // Week 3: convert fileDataUrl → Blob, POST to /extract, save profile
  return { success: false, error: 'Not yet implemented — coming in Week 3.' };
}
