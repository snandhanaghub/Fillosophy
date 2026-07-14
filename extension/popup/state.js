/**
 * Holds the shared state for the Fillosophy Popup controller modules.
 */
export const state = {
  /**
   * Holds the currently selected File object.
   * @type {File|null}
   */
  selectedFile: null,

  /**
   * Holds the most recently extracted profile dict returned by the backend.
   * @type {Object|null}
   */
  currentProfile: null,

  /**
   * Full descriptor objects returned by the last DETECT_FIELDS call.
   * @type {Object[]}
   */
  detectedFields: [],

  /**
   * Best-available label string for each detected field.
   * @type {string[]}
   */
  fieldLabels: [],

  /**
   * Mapping object returned by the last successful /match call.
   * @type {Object}
   */
  fieldMapping: {},

  /**
   * Unix timestamp (ms) of the last successful previewMatch() call.
   * @type {number|null}
   */
  lastMatchTimestamp: null,

  /**
   * URL of the page in the active tab.
   * @type {string|null}
   */
  currentPageUrl: null,

  /**
   * Map of tab buttons by tab ID.
   * @type {Object<string, HTMLElement>}
   */
  tabBtns: {},

  /**
   * Map of tab panels by tab ID.
   * @type {Object<string, HTMLElement>}
   */
  tabPanels: {},
};
