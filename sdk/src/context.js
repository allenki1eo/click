/**
 * Page context reader — extracts structured info from the host page
 * so the AI understands what the user is currently looking at.
 */

export function getPageContext() {
  return {
    url: location.href,
    path: location.pathname,
    title: document.title,
    lang: document.documentElement.lang || navigator.language || 'en',
    visibleText: getVisibleText(),
    formFields: getFormFields(),
    errors: getErrors(),
    breadcrumb: getBreadcrumb(),
    pageHeading: getPageHeading(),
  };
}

function getVisibleText() {
  const sel = 'h1, h2, h3, h4, p, label, th, td, li, .alert, .error, .message, ' +
    '[role="alert"], [role="status"], [role="heading"]';
  const texts = [];
  document.querySelectorAll(sel).forEach(el => {
    if (!isVisible(el)) return;
    const t = el.innerText?.trim();
    if (t && t.length > 1 && t.length < 300) texts.push(t);
  });
  // Deduplicate and cap total
  const unique = [...new Set(texts)];
  return unique.slice(0, 40).join(' | ');
}

function getFormFields() {
  const fields = [];
  document.querySelectorAll('input, select, textarea').forEach(el => {
    if (!isVisible(el) || el.type === 'hidden') return;
    const label = getFieldLabel(el);
    const entry = {
      type: el.tagName.toLowerCase() === 'select' ? 'select' : el.type || 'text',
      label: label || el.name || el.id || el.placeholder || '',
      name: el.name || el.id || '',
      placeholder: el.placeholder || '',
      value: el.type === 'password' ? '[hidden]' : (el.value || ''),
      required: el.required || el.getAttribute('aria-required') === 'true',
    };
    if (entry.label) fields.push(entry);
  });
  return fields.slice(0, 20);
}

function getFieldLabel(el) {
  // 1. aria-label / aria-labelledby
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
  if (el.getAttribute('aria-labelledby')) {
    const ref = document.getElementById(el.getAttribute('aria-labelledby'));
    if (ref) return ref.innerText?.trim();
  }
  // 2. <label for="id">
  if (el.id) {
    const lbl = document.querySelector(`label[for="${el.id}"]`);
    if (lbl) return lbl.innerText?.trim();
  }
  // 3. Wrapping <label>
  const parent = el.closest('label');
  if (parent) return parent.innerText?.replace(el.value, '').trim();
  // 4. Preceding sibling text
  const prev = el.previousElementSibling;
  if (prev?.tagName === 'LABEL') return prev.innerText?.trim();
  return '';
}

function getErrors() {
  const sel = '.error, .alert-danger, .alert-error, [role="alert"], ' +
    '.invalid-feedback, .help-block, .form-error, .field-error';
  const errors = [];
  document.querySelectorAll(sel).forEach(el => {
    if (!isVisible(el)) return;
    const t = el.innerText?.trim();
    if (t) errors.push(t);
  });
  return [...new Set(errors)].slice(0, 5);
}

function getBreadcrumb() {
  const sel = '[aria-label="breadcrumb"], .breadcrumb, nav ol, nav ul';
  const nav = document.querySelector(sel);
  if (!nav) return '';
  return nav.innerText?.replace(/\n/g, ' > ').trim() || '';
}

function getPageHeading() {
  const h1 = document.querySelector('h1');
  return h1?.innerText?.trim() || document.title || '';
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    el.offsetParent !== null;
}
