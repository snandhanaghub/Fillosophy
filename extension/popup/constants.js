/** Tab IDs — left-to-right order matches the DOM. */
export const TAB_IDS = ['upload', 'profiles', 'autofill'];

/** Tab shown when the popup first opens. */
export const DEFAULT_TAB = 'upload';

/** Backend endpoint for resume extraction. */
export const EXTRACT_URL = 'http://localhost:8000/extract';

/** Only PDFs are accepted by the upload flow. */
export const ACCEPTED_MIME = 'application/pdf';

/** Backend endpoint for profile import sync. */
export const IMPORT_URL = 'http://localhost:8000/profiles/import';
