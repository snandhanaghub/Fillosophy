# Fillosophy Architecture

This document describes the architectural flow, database abstraction layer, and the hybrid AI-template field matching system of Fillosophy.

## Architecture Flow

Fillosophy utilizes a standard Manifest V3 Chrome Extension architecture that communicates with a local Python FastAPI backend server.

```text
+-----------------------------------+
|          Chrome Browser           |
|                                   |
|  +-----------------------------+  |          +--------------------------+
|  |       Popup UI (HTML/JS)    |  |          |       FastAPI Backend    |
|  |  (Handles uploads, UI, API  |  |          |  (Runs on localhost:8000)|
|  |   requests, and storage)    |===(HTTP)===>|                          |
|  +-----------------------------+  |          |  +--------------------+  |
|         |               ^         |          |  | PDF Parsing (pdfplumber) |
|   (Message Passing)     |         |          |  +--------------------+  |
|         v               |         |          |  +--------------------+  |
|  +-----------------------------+  |          |  | AI Logic (Claude API)|  |
|  | Content Script (content.js) |  |          |  +--------------------+  |
|  |  (Injected into active tab, |  |          |  +--------------------+  |
|  |   detects fields, fills DOM)|  |          |  | DB Layer (Supabase)  |  |
|  +-----------------------------+  |          |  +--------------------+  |
|                                   |          +--------------------------+
+-----------------------------------+
```

1. **Popup UI**: Acts as the main controller. It manages user interactions (resume uploads, triggering autofill), stores state in `chrome.storage.local`, and communicates with both the background/content scripts and the FastAPI backend.
2. **Content Script (`content.js`)**: Injected into web pages. It recursively scans the DOM to identify interactive form fields, resolves their labels (from `<label>` tags, `aria` properties, or nearby text), and listens for messages from the Popup to apply AI-generated fill values back into the DOM.
3. **FastAPI Backend**: Acts as the heavy-lifter. It parses PDFs using `pdfplumber`, uses Claude AI to extract unstructured text into JSON, matches field labels to profile data, and persists profiles in a database.

---

## Database Abstraction Layer

Fillosophy uses Supabase (PostgreSQL) for all profile storage. The database abstraction layer lives in `backend/database/profiles.py`.

### How It Works
- `profiles.py` exports unified functions: `save_profile`, `get_profile`, `list_profiles`, and `delete_profile`.
- It uses `supabase_db.py`, which lazily initialises the Supabase Python client on first use.
- To configure:
  1. Create a Supabase project and run the `CREATE TABLE` SQL from the `supabase_db.py` module docstring.
  2. Provide the `SUPABASE_URL` and `SUPABASE_KEY` variables in your backend `.env` file.
  3. The client connects automatically on startup and routes all queries to the cloud database.

---

## Hybrid Template + AI Matching System

To optimize performance and reduce reliance on expensive Claude API calls for heavily-frequented application portals (like Unstop, Internshala, or LinkedIn), Fillosophy employs a **hybrid template matching strategy**.

This logic resides in `extension/utils/templates.js` and is executed by `extension/popup/popup.js` (`previewMatch`).

### The Flow
1. **Template Lookup**: When the user opens a page (e.g., `unstop.com/apply`), the extension first looks up the domain in a hardcoded dictionary of known templates (`KNOWN_TEMPLATES`).
2. **Local Matching**: If a template exists, the extension compares the page's detected field labels against the template's known hints locally. Matches are instantly assigned a confidence score of 95 and a source of `"template"`.
3. **AI Fallback**: 
   - If *all* fields match the template, the extension skips the backend `/match` AI call entirely, saving credits and executing instantly.
   - If *some* fields match, only the unmatched (unknown) fields are sent to the `/match` endpoint for Claude to resolve.
   - If *no* template exists for the domain, all fields fall back to the standard AI matching process.
4. **Merge & Fill**: The high-confidence template matches and the AI-generated matches are seamlessly merged in `popup.js` before being forwarded to `content.js` to autofill the page.
