"""
Fillosophy — PDF text extraction using pdfplumber.
Handles multi-page resumes with text and tabular content.
"""

import io
import re

import pdfplumber


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """
    Extracts and cleans all readable text from a PDF supplied as raw bytes.

    Strategy:
        1. Open the PDF from a BytesIO buffer via pdfplumber.
        2. Iterate every page and collect non-empty text blocks.
        3. Join pages with a double newline separator.
        4. Collapse runs of 3+ consecutive blank lines down to 2.
        5. Raise ValueError if no text could be extracted at all.

    Args:
        file_bytes: Raw bytes of the uploaded PDF file.

    Returns:
        str: Cleaned, readable text extracted from the PDF.

    Raises:
        ValueError: If the uploaded file is empty (zero bytes).
        ValueError: If the PDF file appears to be corrupted or unreadable.
        ValueError: If the PDF contains no extractable text (e.g. scanned image).
        pdfplumber.exceptions.PDFSyntaxError: If the bytes are not a valid PDF.
    """
    # Guard: reject empty uploads before attempting to parse
    if len(file_bytes) == 0:
        raise ValueError("Uploaded file is empty")

    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            page_count = len(pdf.pages)
            print(f"[Fillosophy PDF] Opened PDF — {page_count} page(s) detected.")

            page_texts: list[str] = []

            for page_num, page in enumerate(pdf.pages, start=1):
                raw = page.extract_text()

                # Skip pages that return None or only whitespace
                if not raw or not raw.strip():
                    print(f"[Fillosophy PDF] Page {page_num}/{page_count} — no text, skipping.")
                    continue

                page_texts.append(raw.strip())
                print(
                    f"[Fillosophy PDF] Page {page_num}/{page_count} — "
                    f"{len(raw.strip())} chars extracted."
                )
    except ValueError:
        raise  # Re-raise our own ValueError from the empty-bytes guard above
    except Exception as exc:
        raise ValueError(
            "The PDF file appears to be corrupted or unreadable"
        ) from exc

    # Guard: nothing useful was found across all pages
    if not page_texts:
        raise ValueError(
            "No readable text found in PDF. "
            "The file may be a scanned image or contain only non-text elements."
        )

    # Join pages, then normalise excessive blank lines
    joined = "\n\n".join(page_texts)
    cleaned = _collapse_blank_lines(joined)

    total_chars = len(cleaned)
    print(
        f"[Fillosophy PDF] Extraction complete — "
        f"{len(page_texts)} page(s) with text, {total_chars} total chars."
    )

    return cleaned


# Helpers

def _collapse_blank_lines(text: str) -> str:
    """
    Replaces any run of 3 or more consecutive newlines with exactly 2,
    so the output never has more than one blank line between paragraphs.

    Args:
        text: Raw joined text string.

    Returns:
        str: Text with excessive blank lines normalised.
    """
    # \n{3,} matches three or more newlines in a row
    return re.sub(r'\n{3,}', '\n\n', text).strip()
