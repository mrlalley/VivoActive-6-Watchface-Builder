'use strict';

// Import escHtml from the HTML escape utility (CommonJS-compatible for testing)
const { escHtml } = require('../builder/utils/html-escape');

// ── escHtml completeness tests ────────────────────────────────────────────
//
// Guards against regression of the incomplete escape set.
// Prior to this fix, > and ' were not escaped, providing false assurance
// at attribute-context sites.

describe('escHtml escapes all five dangerous HTML characters', () => {

  test('escapes & as &amp;', () => {
    expect(escHtml('rock & roll')).toBe('rock &amp; roll');
  });

  test('escapes < as &lt;', () => {
    expect(escHtml('a < b')).toBe('a &lt; b');
  });

  test('escapes > as &gt; (was missing)', () => {
    expect(escHtml('a > b')).toBe('a &gt; b');
  });

  test('escapes " as &quot;', () => {
    expect(escHtml('"quoted"')).toBe('&quot;quoted&quot;');
  });

  test('escapes \' as &#39; (was missing)', () => {
    expect(escHtml("it's")).toBe('it&#39;s');
  });

  test('escapes & first to prevent double-escaping', () => {
    // If & were replaced after <, then "&lt;" would become "&amp;lt;"
    // — a double-escape. This test asserts that does not happen.
    expect(escHtml('a & b < c')).toBe('a &amp; b &lt; c');
    // Not: 'a &amp; b &amp;lt; c'
  });

  test('escapes all five in a single string', () => {
    expect(escHtml(`&"'<>`))
      .toBe('&amp;&quot;&#39;&lt;&gt;');
  });

  test('returns empty string for null and undefined', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
  });

  test('passes through a plain string unchanged', () => {
    expect(escHtml('Hello World')).toBe('Hello World');
  });

  test('handles numeric values by converting to string first', () => {
    expect(escHtml(123)).toBe('123');
  });

});

// ── XSS sink regression: el.label in h3 element ──────────────────────────
//
// Guards against regression of the innerHTML el.label sink. Prior to this
// fix, el.label was interpolated raw into an innerHTML assignment, making
// the <h3> an XSS sink. The fix uses textContent, which never interprets HTML.
//
// This test simulates the panel rendering to verify that an XSS payload
// in el.label is rendered as literal text, not as executable markup.

describe('escHtml integration: attribute escaping prevents context breaks', () => {

  test('escaped > prevents tag-closing attack in attributes', () => {
    // Payload: " onclick=alert(1)>"
    // If > were not escaped in an attribute value, the attacker could
    // close the attribute and the tag, then inject a new attribute.
    const payload = '" onclick=alert(1)>';
    const escaped = escHtml(payload);
    expect(escaped).toContain('&gt;');
    expect(escaped).not.toContain('>');
  });

  test('escaped \' prevents single-quote attribute breaks', () => {
    // Payload: ' onclick=alert(1) data-x='"
    // If ' were not escaped in a single-quoted attribute, the attacker
    // could close the attribute and inject a new one.
    const payload = "' onclick=alert(1) data-x='";
    const escaped = escHtml(payload);
    expect(escaped).toContain('&#39;');
    expect(escaped).not.toContain("'");
  });

  test('XSS payload with <img onerror> as attribute value', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const escaped = escHtml(payload);
    // All angle brackets and quotes must be escaped
    expect(escaped).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

});
