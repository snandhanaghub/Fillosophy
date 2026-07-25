# Fillosophy

An AI-powered form autofill Chrome extension that turns your resume into a universal application filler.

## The Problem
Filling out the same job application details over and over across different portals is mind-numbing. Fillosophy solves this by parsing your resume once and using AI to intelligently map your data to any form you encounter, letting you apply with a single click.

## Demo
![Demo](docs/demo.gif)

## Features
- **Intelligent Field Matching**: Uses Claude AI to understand semantic field labels (e.g., mapping "Passing Year" to "graduation_year").
- **PDF Resume Extraction**: Parses multi-page PDF resumes locally and structures the data into a JSON profile.
- **Hybrid Template System**: Falls back to hardcoded templates for frequently visited sites (LinkedIn, Internshala, Unstop) to reduce API calls and save credits.
- **Profile Management**: Supports multiple profiles (e.g., Personal, Academic, Job) and allows exporting/importing profile data.
- **Complex Input Handling**: Confidently fills text fields, selects options from dropdowns, and checks boxes or radio buttons.

## Tech Stack
| Component       | Technologies                                     |
|-----------------|--------------------------------------------------|
| **Extension**   | Manifest V3, Vanilla HTML/CSS/JS                 |
| **Backend**     | Python, FastAPI, Uvicorn                         |
| **AI / LLMs**   | Anthropic Claude (via API), Groq/OpenRouter fallback |
| **Parsing**     | pdfplumber                                       |
| **Database**    | Supabase (PostgreSQL)                            |

## Installation

### Backend Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/Fillosophy.git
   cd Fillosophy/backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Set up your environment variables by creating a `.env` file:
   ```env
    ANTHROPIC_API_KEY=your_claude_api_key
    SUPABASE_URL=https://your-project-id.supabase.co
    SUPABASE_KEY=your-supabase-anon-or-service-role-key
    # MOCK_AI=true # Uncomment to test without API credits
   ```
5. Run the FastAPI server:
   ```bash
   uvicorn main:app --reload
   ```

### Extension Setup
1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked** in the top left.
4. Select the `extension` folder from the cloned repository.

## Usage
1. Click the Fillosophy extension icon in your toolbar.
2. In the **Upload** tab, drag and drop your resume PDF to extract your profile.
3. Navigate to a job application form (e.g., on LinkedIn or Unstop).
4. Open the extension and switch to the **Autofill** tab.
5. Review the mapped fields, then click **Autofill This Form**.

## Project Structure
```text
Fillosophy/
├── backend/
│   ├── database/          # Supabase database abstraction layer
│   ├── routes/            # FastAPI endpoint handlers (extract, match, profiles)
│   ├── utils/             # pdfplumber parsing and AI client wrappers
│   ├── main.py            # FastAPI application entry point
│   └── requirements.txt
└── extension/
    ├── content/           # content.js (DOM parsing and field injection)
    ├── popup/             # popup.js, popup.html, popup.css (extension UI)
    ├── utils/             # storage.js, templates.js (client-side utilities)
    └── manifest.json      # Chrome extension manifest V3
```

## API Reference
| Endpoint                | Method | Purpose                                               |
|-------------------------|--------|-------------------------------------------------------|
| `/extract`              | POST   | Parses a PDF resume and extracts a structured profile |
| `/match`                | POST   | Matches form field labels to profile data using AI    |
| `/profiles/import`      | POST   | Imports and saves a raw JSON profile                  |
| `/profiles/list`        | GET    | Lists all available profiles on the server            |
| `/profiles/{name}`      | GET    | Retrieves a specific profile by name                  |
| `/profiles/{name}`      | DELETE | Deletes a specific profile by name                    |

## Known Limitations
- **Local Backend Required**: The extension currently requires the FastAPI backend to be running locally on `localhost:8000`.
- **Supported Portals**: Tested primarily on Unstop, Internshala, LinkedIn, Naukri, and Google Forms. Unconventional custom forms might experience lower fill confidence.
- **Popup Closure**: Closing the Chrome extension popup mid-extraction will abort the client-side fetch request, although the backend will finish processing the profile.

## Future Scope
- Hosting the backend to eliminate local setup.
- Adding cross-browser support for Firefox and Safari.
- Handling complex multi-step forms natively without requiring the user to manually rescan the page.

## Credits
Built by Aditya Jain.
