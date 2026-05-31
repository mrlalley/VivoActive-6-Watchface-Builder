/**
 * escHtml(str)
 * Escapes a string for safe interpolation into HTML attribute values.
 * Escapes all five characters that can break attribute or element contexts.
 *
 * Use for attribute-context values only (data-*, id, value=, etc.).
 * For element text content, use textContent — never use escHtml() with
 * innerHTML for text nodes.
 *
 * Escape order matters: &amp; must be replaced first to prevent
 * double-escaping subsequent replacements.
 *
 * @param {string} str — the raw value to escape
 * @returns {string} — HTML-safe string
 */
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,  '&amp;')   // first: prevents double-escaping
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')    // was missing
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');  // was missing; use &#39; not &apos;
}

export { escHtml };
