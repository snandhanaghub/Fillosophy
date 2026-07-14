(function () {
  'use strict';
  window.Fillosophy = window.Fillosophy || {};

  // OVERLAY RENDERER

  /**
   * Renders the Fillosophy confidence overlay panel anchored to the
   * bottom-right of the page, matching the SmartFill preview design.
   *
   * @param {Object} summary - Result object from applyAutofill().
   */
  function renderOverlay(summary) {
    // Step 1 — Remove any existing overlay
    const existing = document.getElementById('fillosophy-overlay');
    if (existing) existing.remove();

    // Step 2 — Inject CSS once
    if (!document.getElementById('fillosophy-overlay-styles')) {
      const style = document.createElement('style');
      style.id = 'fillosophy-overlay-styles';
      style.textContent = `
        #fillosophy-overlay {
          position: fixed;
          bottom: 16px;
          right: 16px;
          width: 320px;
          max-height: 420px;
          overflow-y: auto;
          background: #ffffff;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.15);
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 13px;
          z-index: 2147483647;
          border: 1px solid #e5e7eb;
          animation: fillosophy-slide-in 0.25s ease;
        }
        @keyframes fillosophy-slide-in {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fillosophy-overlay-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: #2563EB;
          color: white;
          border-radius: 12px 12px 0 0;
          font-weight: 600;
          font-size: 13px;
          position: sticky;
          top: 0;
        }
        .fillosophy-overlay-close {
          cursor: pointer;
          font-size: 18px;
          background: none;
          border: none;
          color: white;
          line-height: 1;
          padding: 0 2px;
          opacity: 0.85;
        }
        .fillosophy-overlay-close:hover { opacity: 1; }
        .fillosophy-stats-bar {
          display: flex;
          gap: 0;
          background: #f0f7ff;
          border-bottom: 1px solid #e5e7eb;
        }
        .fillosophy-stat-pill {
          flex: 1;
          text-align: center;
          padding: 6px 4px;
          font-size: 11px;
          font-weight: 600;
          color: #374151;
        }
        .fillosophy-stat-pill span {
          display: block;
          font-size: 16px;
          font-weight: 700;
        }
        .fillosophy-stat-pill.green span { color: #16a34a; }
        .fillosophy-stat-pill.amber span { color: #d97706; }
        .fillosophy-stat-pill.gray span  { color: #6b7280; }
        .fillosophy-field-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 9px 16px;
          border-bottom: 1px solid #f3f4f6;
          gap: 8px;
        }
        .fillosophy-field-left {
          display: flex;
          flex-direction: column;
          min-width: 0;
          flex: 1;
        }
        .fillosophy-field-label {
          font-weight: 500;
          color: #111827;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fillosophy-field-value {
          color: #6b7280;
          font-size: 11px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fillosophy-badge {
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 99px;
        }
        .fillosophy-confidence-high {
          color: #16a34a;
          background: #dcfce7;
        }
        .fillosophy-confidence-mid {
          color: #374151;
          background: #f3f4f6;
        }
        .fillosophy-confidence-low {
          color: #d97706;
          background: #fef3c7;
        }
        .fillosophy-overlay-footer {
          display: flex;
          gap: 8px;
          padding: 12px 16px;
          background: #fafafa;
          border-top: 1px solid #e5e7eb;
          border-radius: 0 0 12px 12px;
          position: sticky;
          bottom: 0;
        }
        .fillosophy-btn-primary {
          flex: 1;
          background: #2563EB;
          color: white;
          border: none;
          border-radius: 6px;
          padding: 8px;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          font-family: inherit;
          transition: background 0.15s;
        }
        .fillosophy-btn-primary:hover { background: #1d4ed8; }
        .fillosophy-btn-secondary {
          flex: 1;
          background: #fef3c7;
          color: #92400e;
          border: none;
          border-radius: 6px;
          padding: 8px;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          font-family: inherit;
          transition: background 0.15s;
        }
        .fillosophy-btn-secondary:hover { background: #fde68a; }
      `;
      document.head.appendChild(style);
    }

    // Step 3 — Build overlay DOM
    const overlay = document.createElement('div');
    overlay.id = 'fillosophy-overlay';

    // Header
    const header = document.createElement('div');
    header.className = 'fillosophy-overlay-header';
    header.innerHTML = `<span>🧠 Fillosophy — Autofill Preview</span>`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'fillosophy-overlay-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    header.appendChild(closeBtn);
    overlay.appendChild(header);

    // Stats bar
    const statsBar = document.createElement('div');
    statsBar.className = 'fillosophy-stats-bar';
    statsBar.innerHTML = `
      <div class="fillosophy-stat-pill green"><span>${summary.filled}</span>Filled</div>
      <div class="fillosophy-stat-pill amber"><span>${summary.flagged}</span>Flagged</div>
      <div class="fillosophy-stat-pill gray"><span>${summary.skipped}</span>Skipped</div>
    `;
    overlay.appendChild(statsBar);

    // Field rows
    const scrollArea = document.createElement('div');
    for (const detail of summary.details) {
      const row = document.createElement('div');
      row.className = 'fillosophy-field-row';

      const truncatedValue = detail.value != null && String(detail.value).length > 30
        ? String(detail.value).slice(0, 30) + '…'
        : String(detail.value ?? '—');

      let badgeClass = 'fillosophy-confidence-high';
      if (detail.confidence < 70) badgeClass = 'fillosophy-confidence-low';
      else if (detail.confidence < 80) badgeClass = 'fillosophy-confidence-mid';

      row.innerHTML = `
        <div class="fillosophy-field-left">
          <span class="fillosophy-field-label">${detail.label}</span>
          <span class="fillosophy-field-value">${truncatedValue}</span>
        </div>
        <span class="fillosophy-badge ${badgeClass}">${detail.confidence}%</span>
      `;
      scrollArea.appendChild(row);
    }
    overlay.appendChild(scrollArea);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'fillosophy-overlay-footer';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'fillosophy-btn-primary';
    applyBtn.textContent = `Apply All (${summary.filled + summary.flagged})`;
    footer.appendChild(applyBtn);

    if (summary.flagged > 0) {
      const reviewBtn = document.createElement('button');
      reviewBtn.className = 'fillosophy-btn-secondary';
      reviewBtn.textContent = `Review (${summary.flagged}) ⚠`;
      reviewBtn.addEventListener('click', () => {
        scrollToFlaggedFields();
      });
      footer.appendChild(reviewBtn);
    }

    overlay.appendChild(footer);

    // Step 4 — Event listeners
    closeBtn.addEventListener('click', () => overlay.remove());
    applyBtn.addEventListener('click', () => {
      confirmAllFields();
      overlay.remove();
    });

    // Step 5 — Mount
    document.body.appendChild(overlay);
    console.log(`[Fillosophy Content] Overlay rendered with ${summary.details.length} fields`);
  }

  // OVERLAY HELPERS

  /**
   * Confirms all flagged low-confidence fields — removes amber highlight,
   * applies a green confirmed state, clears all outlines, removes overlay.
   */
  function confirmAllFields() {
    const flagged = document.querySelectorAll('[data-fillosophy-flag="low-confidence"]');
    flagged.forEach((el) => {
      el.removeAttribute('data-fillosophy-flag');
      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.border = '2px solid #16a34a';
      el.style.backgroundColor = '#f0fdf4';
    });
    // Also clear any remaining green outlines from high-confidence fields
    document.querySelectorAll('input[style*="outline"], select[style*="outline"], textarea[style*="outline"]')
      .forEach((el) => { el.style.outline = ''; el.style.outlineOffset = ''; });
    // Remove the overlay
    const overlay = document.getElementById('fillosophy-overlay');
    if (overlay) overlay.remove();
    console.log(`[Fillosophy Content] All fields confirmed by user (${flagged.length} flagged cleared).`);
  }

  /**
   * Scrolls to the first low-confidence field and pulses all flagged
   * fields with a CSS animation for 2 seconds.
   */
  function scrollToFlaggedFields() {
    const flaggedEls = document.querySelectorAll('[data-fillosophy-flag="low-confidence"]');
    if (!flaggedEls.length) return;

    // Inject pulse keyframes once
    if (!document.getElementById('fillosophy-pulse-styles')) {
      const ps = document.createElement('style');
      ps.id = 'fillosophy-pulse-styles';
      ps.textContent = `
        @keyframes fillosophy-pulse-anim {
          0%, 100% { box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.4); }
          50%       { box-shadow: 0 0 0 6px rgba(217, 119, 6, 0); }
        }
        .fillosophy-pulse {
          animation: fillosophy-pulse-anim 0.6s ease-in-out 3;
        }
      `;
      document.head.appendChild(ps);
    }

    // Scroll to the first flagged element
    flaggedEls[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Add pulse class to all flagged elements, remove after 2 s
    flaggedEls.forEach((el) => el.classList.add('fillosophy-pulse'));
    setTimeout(() => {
      flaggedEls.forEach((el) => el.classList.remove('fillosophy-pulse'));
    }, 2000);

    console.log(`[Fillosophy Content] Scrolled to ${flaggedEls.length} flagged fields`);
    // NOTE: Overlay intentionally left open so user can continue reviewing
  }

  // Publish to Fillosophy namespace
  window.Fillosophy.renderOverlay = renderOverlay;
  window.Fillosophy.confirmAllFields = confirmAllFields;
  window.Fillosophy.scrollToFlaggedFields = scrollToFlaggedFields;

})();
