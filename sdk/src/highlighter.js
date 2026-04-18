/**
 * DOM Highlighter — finds elements on the host page and draws
 * animated highlight overlays + directional arrows.
 *
 * AI uses [GUIDE:query:description] tags. Query forms:
 *   text=Submit Application   — find by visible text
 *   label=National ID         — find input by associated label
 *   placeholder=Enter TIN     — find input by placeholder
 *   name=username             — find input by name attr
 *   id=submit-btn             — find by element ID
 */

const OVERLAY_CLASS = 'mwz-highlight-overlay';
const ARROW_CLASS = 'mwz-highlight-arrow';
const TOOLTIP_CLASS = 'mwz-highlight-tip';

export class DOMHighlighter {
  constructor(theme = '#00843D') {
    this.theme = theme;
    this._overlays = [];
    this._guidesSeen = new Set();
    this._injectStyles();
  }

  // Called for each [GUIDE:query:description] found in the AI response
  guide({ query, description }) {
    const key = `${query}:${description}`;
    if (this._guidesSeen.has(key)) return;
    this._guidesSeen.add(key);

    const el = this._find(query);
    if (!el) return;

    this._highlight(el, description);
  }

  clearAll() {
    this._overlays.forEach(o => o.remove());
    this._overlays = [];
    this._guidesSeen.clear();
  }

  // --- Finding ---

  _find(query) {
    if (!query) return null;
    const eqIdx = query.indexOf('=');
    if (eqIdx < 0) {
      // Treat as CSS selector fallback
      try { return document.querySelector(query); } catch (_) { return null; }
    }

    const type = query.slice(0, eqIdx).toLowerCase().trim();
    const value = query.slice(eqIdx + 1).trim();

    switch (type) {
      case 'text':    return this._findByText(value);
      case 'label':   return this._findByLabel(value);
      case 'placeholder': return document.querySelector(`[placeholder*="${value}" i]`);
      case 'name':    return document.querySelector(`[name="${value}"]`);
      case 'id':      return document.getElementById(value);
      default:        return this._findByText(value);
    }
  }

  _findByText(text) {
    const lower = text.toLowerCase();
    // Priority: button > a > label > any visible element
    const candidates = [
      ...document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]'),
      ...document.querySelectorAll('label, th, td, span, div, p, li'),
    ];
    // Exact match first
    for (const el of candidates) {
      const t = el.innerText?.trim().toLowerCase();
      if (t === lower && this._isVisible(el)) return el;
    }
    // Partial match
    for (const el of candidates) {
      const t = el.innerText?.trim().toLowerCase();
      if (t?.includes(lower) && this._isVisible(el)) return el;
    }
    return null;
  }

  _findByLabel(labelText) {
    const lower = labelText.toLowerCase();
    // Check <label> elements
    for (const lbl of document.querySelectorAll('label')) {
      if (!lbl.innerText?.toLowerCase().includes(lower)) continue;
      // label[for]
      if (lbl.htmlFor) {
        const inp = document.getElementById(lbl.htmlFor);
        if (inp && this._isVisible(inp)) return inp;
      }
      // Wrapped input
      const inp = lbl.querySelector('input, select, textarea');
      if (inp && this._isVisible(inp)) return inp;
    }
    // aria-label
    const el = document.querySelector(`[aria-label*="${labelText}" i]`);
    if (el && this._isVisible(el)) return el;
    return null;
  }

  _isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  // --- Highlighting ---

  _highlight(el, description) {
    const rect = el.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // Pulsing border overlay
    const overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    Object.assign(overlay.style, {
      position: 'absolute',
      top: `${rect.top + scrollY - 4}px`,
      left: `${rect.left + scrollX - 4}px`,
      width: `${rect.width + 8}px`,
      height: `${rect.height + 8}px`,
      border: `3px solid ${this.theme}`,
      borderRadius: '6px',
      boxShadow: `0 0 0 3px ${this.theme}40`,
      animation: 'mwz-pulse-border 1.2s ease-in-out infinite',
      pointerEvents: 'none',
      zIndex: '2147483640',
    });

    // Tooltip with description
    if (description) {
      const tip = document.createElement('div');
      tip.className = TOOLTIP_CLASS;
      tip.textContent = description;
      Object.assign(tip.style, {
        position: 'absolute',
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        background: this.theme,
        color: '#fff',
        padding: '4px 10px',
        borderRadius: '4px',
        fontSize: '12px',
        fontFamily: 'system-ui, sans-serif',
        whiteSpace: 'nowrap',
        marginBottom: '6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      });
      // Arrow on tooltip
      const tipArrow = document.createElement('div');
      Object.assign(tipArrow.style, {
        position: 'absolute',
        top: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        border: '5px solid transparent',
        borderTopColor: this.theme,
      });
      tip.appendChild(tipArrow);
      overlay.style.position = 'absolute';
      overlay.appendChild(tip);
    }

    document.body.appendChild(overlay);
    this._overlays.push(overlay);

    // Scroll element into view smoothly
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Auto-remove after 6 seconds
    setTimeout(() => {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.5s';
      setTimeout(() => overlay.remove(), 500);
      this._overlays = this._overlays.filter(o => o !== overlay);
    }, 6000);
  }

  _injectStyles() {
    if (document.getElementById('mwz-highlight-styles')) return;
    const style = document.createElement('style');
    style.id = 'mwz-highlight-styles';
    style.textContent = `
      @keyframes mwz-pulse-border {
        0%, 100% { box-shadow: 0 0 0 3px ${this.theme}40; }
        50%       { box-shadow: 0 0 0 8px ${this.theme}20; }
      }
    `;
    document.head.appendChild(style);
  }
}
