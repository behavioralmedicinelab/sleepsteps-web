// test/node/helpers.js: the small HTML readers the built-site tests share.
// A helper that reads the wrong thing makes every test built on it check
// the wrong thing, so the ones with rules of their own are tested here:
// attr() and the tag readers, what the tests read as a page's words
// (text()), and what they count as "worksheets here" (WORKSHEET_MARKUP,
// SPEC §7.6). The team edits the words of the site (the spreadsheets, the
// problem files, the information pages), and `npm test` runs before every
// deploy, so a helper that mistook the team's words for a mistake would
// stop the deploy.
import { describe, expect, inject, it } from 'vitest';
import { WORKSHEET_MARKUP, attr, currentLinks, readHtmlPages, tags, text } from './helpers.js';

describe('attr()', () => {
  it('reads quoted, single-quoted, bare and valueless attributes, whatever their case, as written', () => {
    const tag = `<input type="text" id='q' maxlength=80 REQUIRED data-x="a &amp; b" aria-label="">`;
    expect(attr(tag, 'type')).toBe('text');
    expect(attr(tag, 'id')).toBe('q');
    expect(attr(tag, 'maxlength')).toBe('80');
    expect(attr(tag, 'required')).toBe('');
    expect(attr(tag, 'aria-label')).toBe('');
    // Not decoded: the text between the quotes.
    expect(attr(tag, 'data-x')).toBe('a &amp; b');
    expect(attr(tag, 'TYPE')).toBe('text');
    expect(attr('<a href = "/x/" >', 'href')).toBe('/x/');
    expect(attr('<br/>', 'class')).toBeUndefined();
    expect(attr('<details open>', 'open')).toBe('');
    expect(attr('<use xlink:href="#a"/>', 'xlink:href')).toBe('#a');
  });

  it('gives undefined for an attribute the tag does not have', () => {
    expect(attr('<a href="/x/">', 'class')).toBeUndefined();
    expect(attr('<a data-href="/x/">', 'href')).toBeUndefined();
    expect(attr('<a href="/x/">', 'hre')).toBeUndefined();
  });

  // Keywords and descriptions are the team's words: "for", "open", "hidden"
  // and "action" are ordinary ones, and each is also an attribute's name.
  it("never takes a word inside another attribute's value for an attribute", () => {
    const meta = '<meta name="description" content="Videos for the sleep problems people have, hidden or open">';
    for (const name of ['for', 'hidden', 'open']) expect(attr(meta, name), name).toBeUndefined();
    expect(attr(meta, 'content')).toBe('Videos for the sleep problems people have, hidden or open');
    const item = `<li data-slug="pain" data-keywords="take action; hidden; class = 'x'; id=y for z">`;
    for (const name of ['action', 'hidden', 'class', 'id', 'for']) expect(attr(item, name), name).toBeUndefined();
    expect(attr(item, 'data-slug')).toBe('pain');
    expect(attr(`<a title='say "open" for me' href="/x/">`, 'open')).toBeUndefined();
  });

  it("reads only the opening tag, not what is inside the element", () => {
    const link = '<a href="/x/">Go <span class="arrow" hidden>→</span></a>';
    expect(attr(link, 'href')).toBe('/x/');
    expect(attr(link, 'class')).toBeUndefined();
    expect(attr(link, 'hidden')).toBeUndefined();
  });

  it('agrees with the tag itself on every tag of the built site: no attribute that the tag does not spell out', () => {
    const names = ['for', 'hidden', 'open', 'action', 'id', 'class', 'href', 'required', 'disabled', 'checked'];
    let read = 0;
    for (const { file, html } of readHtmlPages(inject('builtSiteOn'))) {
      for (const tag of html.match(/<[a-z][a-z0-9-]*\b[^>]*>/gi) ?? []) {
        // The tag with every quoted value emptied: what is left names its attributes.
        const bare = tag.replace(/"[^"]*"|'[^']*'/g, '""');
        for (const name of names) {
          const spelt = new RegExp(`\\s${name}(?=[\\s=>/])`, 'i').test(bare);
          expect(attr(tag, name) !== undefined, `${file}: ${name} in ${tag}`).toBe(spelt);
          read += 1;
        }
      }
    }
    expect(read).toBeGreaterThan(1000);
  });
});

describe('tags() and currentLinks()', () => {
  it('tags() finds opening tags by their exact name', () => {
    const html = '<a href="/a/">A</a><article><A HREF="/b/">B</A></article><abbr>c</abbr>';
    expect(tags(html, 'a')).toEqual(['<a href="/a/">', '<A HREF="/b/">']);
  });

  it('currentLinks() lists the links with aria-current, with their href, value and text', () => {
    const html = '<a href="/a/" aria-current="page">A <span>one</span></a><a href="/b/">B</a>';
    expect(currentLinks(html)).toEqual([{ href: '/a/', value: 'page', label: 'A one' }]);
  });
});

describe('text()', () => {
  it('gives the words as a reader gets them: tags out, the template\'s escapes decoded, spaces collapsed', () => {
    expect(text('<p>One &amp; <b>two</b>\n  &quot;three&quot; it&#39;s</p>')).toBe('One & two "three" it\'s');
  });

  // Nunjucks escapes < and > in a title from a spreadsheet; the text is
  // the title as the team typed it.
  it.each([
    ['Sleep under 6 hours -&gt; plan', 'Sleep under 6 hours -> plan'],
    ['[Bed &amp; sleep &lt;plan&gt;]', '[Bed & sleep <plan>]'],
    ['<a class="format-button" href="/x.pdf"><svg></svg>5 &lt; 8 &gt; 3<span class="visually-hidden"> (PDF)</span></a>', '5 < 8 > 3 (PDF)'],
  ])('decodes %j to %j', (html, words) => {
    expect(text(html)).toBe(words);
  });

  it('decodes once: an escaped escape is the text of that escape', () => {
    expect(text('&amp;lt;b&amp;gt; &amp;amp; &amp;quot;')).toBe('&lt;b&gt; &amp; &quot;');
  });
});

describe('WORKSHEET_MARKUP', () => {
  // problem/solutions.njk's section, in its parts.
  it.each([
    '<section class="worksheets" aria-labelledby="solution-x-worksheets">',
    '<h4 class="worksheets__title" id="solution-x-worksheets">Worksheets</h4>',
    '<ul class="worksheets__list" role="list">',
    '<div class="panel worksheets">',
    '<a class="format-button" href="/media/worksheets/x.pdf" type="application/pdf">',
    '<a class="format-button" href="/x.pdf" data-worksheet="x-sheet">',
    '<a data-worksheet>',
    '<object type="application/pdf" data="/media/worksheets/x.pdf"></object>',
  ])('matches the section\'s markup: %s', (html) => {
    expect(html).toMatch(WORKSHEET_MARKUP);
  });

  // The word is the team's to use anywhere: an information page, a
  // video's title or description (escaped by the
  // template), a heading's id, another class or attribute.
  it.each([
    '<p>Each solution video comes with worksheets you can print.</p>',
    '<span class="solution__description" id="s-description">[Try this. The worksheets below help you plan.]</span>',
    '<p class="video-block__desc">A worksheet may help: fill it in as you watch.</p>',
    '<h3 class="video-block__title" id="video-x-title" tabindex="-1">Your worksheet plan</h3>',
    '<li>Anonymous usage: videos and audio played, and handouts and worksheets opened</li>',
    '<h2 id="using-the-worksheets">Using the worksheets</h2>',
    '<a href="/help/#worksheets">About worksheets</a>',
    '<td class="worksheet-id">x-sheet</td>',
    '<div data-worksheets="3" data-worksheet-id="x">',
    '<p>The PDFs are in the folder /media/worksheets/ of the repository.</p>',
    // Typed into a title, markup is text: the template escapes its quotes.
    '<span class="solution__title">class=&quot;worksheets&quot; data-worksheet=&quot;x&quot;</span>',
  ])('does not match the word in the site\'s text: %s', (html) => {
    expect(html).not.toMatch(WORKSHEET_MARKUP);
  });
});
