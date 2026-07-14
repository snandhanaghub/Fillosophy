// Fillosophy — Popup controller | Tab switching, PDF upload, backend fetch

import { TAB_IDS, DEFAULT_TAB } from './constants.js';
import { state } from './state.js';
import { setStatus } from './utils.js';
import { switchTab } from './tabs.js';
import { initDropzone, handleExtract } from './upload.js';
import { handleExportJson, handleImportJson, displayProfile, initProfilePicker } from './profiles.js';
import { getProfile, setActiveProfile } from '../utils/storage.js';

// INITIALISATION

document.addEventListener('DOMContentLoaded', () => {

  // Tab elements
  state.tabBtns = Object.fromEntries(
    TAB_IDS.map((id) => [id, document.getElementById(`tab-${id}`)])
  );
  state.tabPanels = Object.fromEntries(
    TAB_IDS.map((id) => [id, document.getElementById(`panel-${id}`)])
  );

  // Upload tab elements
  const dropzone        = document.getElementById('dropzone');
  const fileInput       = document.getElementById('resume-file-input');
  const dropzoneTitle   = document.getElementById('dropzone-title');
  const dropzoneSub     = document.getElementById('dropzone-sub');
  const extractBtn      = document.getElementById('extract-btn');
  const extractBtnLabel = document.getElementById('extract-btn-label');
  const extractBtnIcon  = document.getElementById('extract-btn-icon');
  const uploadStatus    = document.getElementById('upload-status');

  // Initial state
  extractBtn.disabled      = true;   // enabled only after a valid file is chosen
  uploadStatus.textContent = '';

  // Wire tabs
  TAB_IDS.forEach((id) => {
    state.tabBtns[id].addEventListener('click', () => switchTab(id));
  });
  switchTab(DEFAULT_TAB);

  // Wire dropzone
  initDropzone({ dropzone, fileInput, dropzoneTitle, dropzoneSub,
                 extractBtn, uploadStatus });

  // Wire extract button
  extractBtn.addEventListener('click', () => {
    handleExtract({ extractBtn, extractBtnLabel,
                    extractBtnIcon, uploadStatus });
  });



  // Wire export-JSON button
  const exportJsonBtn = document.getElementById('export-json-btn');
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', handleExportJson);
  }

  // Wire import button + hidden file input
  const importBtn       = document.getElementById('import-btn');
  const importFileInput = document.getElementById('import-file-input');
  if (importBtn && importFileInput) {
    importBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', handleImportJson);
  }

  // Wire Switch profile link
  const switchProfileBtn = document.getElementById('switch-profile-btn');
  if (switchProfileBtn) {
    switchProfileBtn.addEventListener('click', () => {
      switchTab('profiles');
    });
  }

  // Wire header refresh button
  const headerRefreshBtn = document.getElementById('header-refresh-btn');
  if (headerRefreshBtn) {
    headerRefreshBtn.addEventListener('click', () => {
      window.location.reload();
    });
  }

  // Initialize profile picker
  initProfilePicker();
});
