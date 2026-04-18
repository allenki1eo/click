/**
 * Mwongozo Web SDK — auto-initializing entry point.
 *
 * Embed on any webpage with a single script tag:
 *
 *   <script src="dist/widget.js"
 *           data-org="tra"
 *           data-proxy="https://your-proxy.example.com">
 *   </script>
 *
 * Attributes:
 *   data-org      — org ID (tra, brela, crdb, nmb, or custom)
 *   data-proxy    — proxy server URL (defaults to http://localhost:8787)
 *   data-position — orb position: bottom-right (default), bottom-left, top-right, top-left
 *   data-theme    — fallback hex color if org config unavailable
 *   data-name     — fallback assistant name
 */

import { MwongozoWidget } from './widget.js';

async function init() {
  // Find our own script tag to read data-* attributes
  const script =
    document.currentScript ||
    document.querySelector('script[data-org], script[src*="mwongozo"], script[src*="widget"]');

  const orgId    = script?.getAttribute('data-org')      || 'default';
  const proxyUrl = script?.getAttribute('data-proxy')    || 'http://localhost:8787';
  const position = script?.getAttribute('data-position') || 'bottom-right';
  const fallbackTheme = script?.getAttribute('data-theme') || '#00843D';
  const fallbackName  = script?.getAttribute('data-name')  || 'Msaada';

  // Fetch org config from proxy (branding, welcome message, suggested questions)
  let orgConfig = {};
  try {
    const resp = await fetch(`${proxyUrl}/config?org=${encodeURIComponent(orgId)}`, {
      headers: { 'X-Org-Id': orgId },
    });
    if (resp.ok) orgConfig = await resp.json();
  } catch (e) {
    console.warn('[mwongozo] Could not load org config, using defaults:', e.message);
    orgConfig = { name: fallbackName, theme: fallbackTheme };
  }

  const widget = new MwongozoWidget({
    orgId,
    proxyUrl,
    position,
    theme: fallbackTheme,
    name: fallbackName,
    orgConfig,
  });

  await widget.init();

  // Expose globally for programmatic control
  window.mwongozo = widget;
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
