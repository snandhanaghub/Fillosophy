// Fillosophy — Form-field template library
// Stores known field-label → profile-key mappings for frequently
// visited portals.  Reduces reliance on the Claude /match API by
// resolving as many fields as possible locally before falling back
// to AI matching for unrecognised labels.
//
// Used by popup.js → previewMatch().

// KNOWN TEMPLATES

/**
 * Map of domain → { fieldHints }.
 *
 * fieldHints keys are **lowercased** label strings that appear on the
 * portal; values are the corresponding profile-data keys returned by
 * the /extract endpoint (e.g. "full_name", "email", "skills").
 *
 * An empty fieldHints object (e.g. forms.google.com) means "recognised
 * domain but too generic for static matching — always use AI."
 */
const KNOWN_TEMPLATES = {
  'unstop.com': {
    fieldHints: {
      'name':       'full_name',
      'email':      'email',
      'phone':      'phone',
      'college':    'institution',
      'cgpa':       'cgpa',
      'degree':     'degree',
      'graduation': 'graduation_year',
      'skills':     'skills',
    },
  },
  'internshala.com': {
    fieldHints: {
      'full name':          'full_name',
      'email address':      'email',
      'mobile number':      'phone',
      'college/university': 'institution',
      'current cgpa':       'cgpa',
      'course':             'degree',
      'year of graduation': 'graduation_year',
    },
  },
  'linkedin.com': {
    fieldHints: {
      'first name':   'full_name',
      'email':        'email',
      'phone number': 'phone',
    },
  },
  'forms.google.com': {
    fieldHints: {},  // too generic — always use AI matching
  },
};

// PUBLIC API

/**
 * Returns the template entry for the given page URL, or null if no
 * known template matches.
 *
 * Accepts a full URL string (e.g. "https://www.unstop.com/apply/…")
 * so it can be called from the popup context where window.location
 * refers to the popup itself, not the active page.
 *
 * @param {string} pageUrl - The URL of the active tab's page.
 * @returns {Object|null}   Template object or null.
 */
export function getTemplateForUrl(pageUrl) {
  if (!pageUrl) return null;

  let hostname;
  try {
    hostname = new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    return null;  // malformed URL
  }

  for (const domain in KNOWN_TEMPLATES) {
    if (hostname.includes(domain)) {
      return KNOWN_TEMPLATES[domain];
    }
  }
  return null;
}

/**
 * Attempts to match detected field labels against a known portal
 * template.  Returns null if no template exists for the current site
 * (caller should fall back to full AI matching).
 *
 * For matched fields, confidence is set to 95 and source to "template".
 * Unmatched fields are collected separately so the caller can send only
 * those to the AI /match endpoint.
 *
 * @param {string[]} fieldLabels - Label strings for every detected field.
 * @param {Object}   profile    - The active profile data object.
 * @param {string}   pageUrl    - The URL of the page being autofilled.
 * @returns {{ matched: Object, unmatched: string[] } | null}
 */
export function applyTemplateMatching(fieldLabels, profile, pageUrl) {
  const template = getTemplateForUrl(pageUrl);
  if (!template) return null;  // no template → full AI fallback

  // Empty fieldHints means "known domain but cannot template-match"
  if (Object.keys(template.fieldHints).length === 0) return null;

  const matched   = {};
  const unmatched = [];

  for (const label of fieldLabels) {
    const normalizedLabel = label.toLowerCase().trim();
    const profileKey      = template.fieldHints[normalizedLabel];

    if (profileKey && profile[profileKey]) {
      matched[label] = {
        value: Array.isArray(profile[profileKey])
          ? profile[profileKey].join(', ')
          : profile[profileKey],
        confidence: 95,
        source: 'template',
      };
    } else {
      unmatched.push(label);
    }
  }

  return { matched, unmatched };
}
