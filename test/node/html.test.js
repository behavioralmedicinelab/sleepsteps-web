// worker/lib/html.js: the admin pages' escape-by-default HTML (SPEC §14.4).
import { describe, expect, it } from 'vitest';
import { escapeHtml, Html, html } from '../../worker/lib/html.js';

describe('escapeHtml', () => {
  it('escapes & < > " and \'', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('keeps tab, LF and CR, and shows other control characters as U+FFFD', () => {
    expect(escapeHtml('a\tb\nc\rd')).toBe('a\tb\nc\rd');
    for (const c of ['\u0000', '\u0007', '\u001B', '\u007F', '\u0085', '\u009F', '\u000B', '\u000C']) {
      expect(escapeHtml(`x${c}y`), c.codePointAt(0).toString(16)).toBe('x\uFFFDy');
    }
  });

  it('leaves other text alone, emoji and curly quotes included', () => {
    expect(escapeHtml('é “quoted” 😴  ')).toBe('é “quoted” 😴  ');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('html``', () => {
  it('escapes every interpolation', () => {
    const value = '<script>alert(1)</script>';
    expect(String(html`<p title="${value}">${value}</p>`)).toBe(
      '<p title="&lt;script&gt;alert(1)&lt;/script&gt;">&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
    expect(String(html`<a href="${'" onclick="x'}">`)).toBe('<a href="&quot; onclick=&quot;x">');
  });

  it('does not escape a nested html`` twice, and joins lists', () => {
    const inner = html`<b>${'a & b'}</b>`;
    expect(inner).toBeInstanceOf(Html);
    expect(String(html`<p>${inner}</p>`)).toBe('<p><b>a &amp; b</b></p>');
    expect(String(html`<ul>${['<1>', 2].map((x) => html`<li>${x}</li>`)}</ul>`)).toBe('<ul><li>&lt;1&gt;</li><li>2</li></ul>');
    expect(String(html`${['<a>', html`<b>`]}`)).toBe('&lt;a&gt;<b>');
  });

  it('renders null, undefined and false as nothing, and numbers as text', () => {
    expect(String(html`[${null}${undefined}${false}${0}]`)).toBe('[0]');
  });

  it('throws on an object, true, a symbol or a function: a bug in the template', () => {
    for (const value of [{}, { toString: () => '<b>' }, true, Symbol('x'), () => '<b>']) {
      expect(() => html`${value}`).toThrow(TypeError);
    }
  });

  it('renders an Html only when html`` made it: a forged one throws', () => {
    const fake = Object.create(Html.prototype);
    expect(() => String(html`${fake}`)).toThrow(TypeError);
  });
});
