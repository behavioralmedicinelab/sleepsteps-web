// The built-site tests' own tools (helpers.js): what they read as a page's
// words, and what they count as "worksheets here" (SPEC §7.6). The team
// edits the words of the site (the spreadsheets, the problem files, the
// information pages), and `npm test` runs before every deploy, so a helper
// that mistook the team's words for a mistake would stop the deploy.
import { describe, expect, it } from 'vitest';
import { WORKSHEET_MARKUP, text } from './helpers.js';

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
  // solution's blurb, a video's title or description (escaped by the
  // template), a heading's id, another class or attribute.
  it.each([
    '<p>Each solution video comes with worksheets you can print.</p>',
    '<span class="solution__blurb" id="s-blurb">[Try this. The worksheets below help you plan.]</span>',
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
