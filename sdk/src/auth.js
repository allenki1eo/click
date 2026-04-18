/**
 * Auth/role context reader — extracts the current user's identity from the
 * host page so the AI can personalise responses by role.
 *
 * Orgs integrate by adding ONE of these patterns to their pages:
 *
 * 1. Hidden data-attribute element (easiest for server-rendered PHP/HTML):
 *    <div id="mwz-user"
 *         data-role="teller"
 *         data-name="Amina Hassan"
 *         data-department="Retail Banking"
 *         data-branch="Kariakoo"
 *         style="display:none"></div>
 *
 * 2. Window global (easiest for SPAs / React apps):
 *    window.__MWZ_USER__ = { role: 'employee', name: 'John Doe' }
 *
 * 3. Meta tags (good for PHP templates):
 *    <meta name="mwz:user:role"       content="manager">
 *    <meta name="mwz:user:name"       content="Fatuma Ali">
 *    <meta name="mwz:user:department" content="Finance">
 *
 * 4. Script-tag data attributes (set on the widget script tag itself):
 *    <script src="widget.js" data-org="crdb" data-user-role="teller" data-user-name="Ali">
 */

export function getUserContext() {
  return (
    _fromDataElement() ||
    _fromWindowGlobal() ||
    _fromMetaTags() ||
    _fromScriptTag() ||
    null
  );
}

function _fromDataElement() {
  const el = document.getElementById('mwz-user') ||
             document.querySelector('[data-mwz-role]');
  if (!el) return null;
  const role       = el.dataset.role || el.dataset.mwzRole;
  const name       = el.dataset.name || el.dataset.mwzName;
  const department = el.dataset.department || el.dataset.mwzDepartment;
  const branch     = el.dataset.branch || el.dataset.mwzBranch;
  if (!role && !name) return null;
  return _clean({ role, name, department, branch });
}

function _fromWindowGlobal() {
  const u = window.__MWZ_USER__ || window.__MWONGOZO_USER__;
  if (!u || typeof u !== 'object') return null;
  return _clean({
    role:       u.role,
    name:       u.name || u.fullName || u.username,
    department: u.department || u.dept,
    branch:     u.branch || u.location,
    employeeId: u.employeeId || u.id,
  });
}

function _fromMetaTags() {
  const get = name => document.querySelector(`meta[name="${name}"]`)?.content;
  const role = get('mwz:user:role');
  const name = get('mwz:user:name');
  if (!role && !name) return null;
  return _clean({
    role,
    name,
    department: get('mwz:user:department'),
    branch:     get('mwz:user:branch'),
  });
}

function _fromScriptTag() {
  const script =
    document.currentScript ||
    document.querySelector('script[data-org], script[src*="mwongozo"], script[src*="widget"]');
  if (!script) return null;
  const role = script.getAttribute('data-user-role');
  const name = script.getAttribute('data-user-name');
  if (!role && !name) return null;
  return _clean({
    role,
    name,
    department: script.getAttribute('data-user-department'),
    branch:     script.getAttribute('data-user-branch'),
  });
}

function _clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}
