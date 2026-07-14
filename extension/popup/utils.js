/**
 * Promise-based wrapper around chrome.runtime.sendMessage.
 *
 * @param {string} type    - Message type string.
 * @param {Object} payload - Optional extra fields merged into the message.
 * @returns {Promise<any>}
 */
export function sendMessage(type, payload = {}) {
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

/**
 * Sets status paragraph text and CSS modifier class.
 *
 * @param {HTMLElement}          el      - The status element.
 * @param {string}               message - Text to display ('': clears it).
 * @param {'success'|'error'|'amber'|''} type    - CSS modifier class.
 */
export function setStatus(el, message, type) {
  if (!el) return;
  el.textContent = message;
  el.className   = `upload-status${type ? ` ${type}` : ''}`;
}

/**
 * Swaps button text/icon for loading state and back.
 *
 * @param {HTMLButtonElement} btn
 * @param {HTMLElement}       labelEl
 * @param {HTMLElement}       iconEl
 * @param {boolean}           isLoading
 */
export function setLoadingState(btn, labelEl, iconEl, isLoading) {
  if (labelEl) labelEl.textContent  = isLoading ? 'Extracting…' : 'Extract & Save Profile';
  if (iconEl)  iconEl.style.opacity = isLoading ? '0' : '1';
  if (isLoading) btn.disabled = true;
}
