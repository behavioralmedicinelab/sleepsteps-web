// Home (/) and Start here (/start/), checked on the fresh build (SPEC §7.3,
// §9.1-§9.3, §10.2, §12, §13, §15.1, §20 M1b; HANDOFF §6.1, §6.2). Expected
// values come from the content files, so the checks follow content edits.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, inject, it, vi } from 'vitest';
import configure from '../../eleventy.config.js';
import { parseCsvRecords } from '../../scripts/lib/csv.js';
import { parseFrontMatter, validateContent } from '../../scripts/validate-content.js';
import { attr, elementByClass, pageAt, readHtmlPages, tags, text } from './helpers.js';
import { installDom } from './mini-dom.js';

// The site built with every feature on, whatever site.config.json says, so
// none of these checks changes or is skipped while features.ratings is off
// (SPEC §11). The pages with the switch off are checked in
// features-off.test.js.
const site = inject('builtSiteOn');
const { model } = validateContent();
const areas = parseCsvRecords(readFileSync('data/areas.csv', 'utf8')).sort((a, b) => Number(a.order) - Number(b.order));
const problems = [...model.problems.values()];
const videos = [...model.videos.values()];

/** Visible text: tags, visually hidden spans and the rating's invisible sizers left out. */
const visibleText = (html) =>
  text(
    html
      .replace(/<p class="rating__sizer"[\s\S]*?<\/p>/g, ' ')
      .replace(/<span class="visually-hidden">[\s\S]*?<\/span>/g, ' ')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' '),
  );

/** The <main> element. */
const mainOf = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>') + '</main>'.length);

/** Links in `html`: href, class and the text a screen reader reads (tags
    removed without adding spaces, so "1<span>.</span>" reads "1."). */
const links = (html) =>
  [...(html ?? '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, inner]) => ({
    href: attr(`<a${attrs}>`, 'href'),
    cls: attr(`<a${attrs}>`, 'class'),
    name: text(inner.replace(/<[^>]+>/g, '')),
  }));

/** Headings in order, as "level text". */
const headings = (html) => [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => `${m[1]} ${text(m[2])}`);

describe('Home (/)', () => {
  const html = pageAt(site, '/');
  const main = mainOf(html);

  it('has the hero H1 and no title band', () => {
    expect(tags(html, 'h1')).toHaveLength(1);
    expect(text(elementByClass(html, 'home-hero__title', 'h1'))).toBe('Sleep can be hard after cancer. It can also get better.');
    expect(text(elementByClass(html, 'home-hero__eyebrow', 'p'))).toBe('Free · Short videos · At your own pace');
    expect(main).toMatch(/^<main id="main" class="home">/);
    expect(html).not.toMatch(/class="band[ "]/);
    expect(html).toContain('<link rel="stylesheet" href="/css/pages/home.css">');
  });

  it('links the hero buttons to Start here and Sleep problems', () => {
    expect(links(elementByClass(html, 'home-hero__actions', 'div')).map((l) => [l.href, l.cls, l.name])).toEqual([
      ['/start/', 'button button--light', 'Start with the introduction'],
      ['/problems/', 'button button--ghost', 'Browse sleep problems'],
    ]);
  });

  it('ends the hero with the settling arc, and its photo frame is decorative and loads nothing from elsewhere', () => {
    const hero = elementByClass(html, 'home-hero', 'section');
    expect(hero).toMatch(/<svg class="arc"[^>]*>[\s\S]*?<\/svg>\s*<\/section>$/);
    const photo = elementByClass(hero, 'home-hero__photo', 'div');
    expect(attr(tags(photo, 'div')[0], 'aria-hidden')).toBe('true');
    const imgs = tags(photo, 'img');
    if (imgs.length) {
      for (const img of imgs) expect([attr(img, 'alt'), attr(img, 'src')?.startsWith('/img/')]).toEqual(['', true]);
    } else {
      expect(text(photo)).toMatch(/^\[Photo: .+\]$/);
    }
  });

  it('has the three step cards in an ordered list, with chips that read "Step n"', () => {
    const list = elementByClass(html, 'home-steps__list', 'ol');
    expect(attr(tags(list, 'ol')[0], 'role')).toBe('list');
    const cards = [...list.matchAll(/<li class="card home-step home-step--(\d)">([\s\S]*?)<\/li>/g)];
    expect(cards.map(([, n]) => n)).toEqual(['1', '2', '3']);
    for (const [, n, card] of cards) {
      expect(elementByClass(card, 'step-chip', 'p')).toBe(
        `<p class="step-chip"><span class="step-chip__num" aria-hidden="true">${n}</span> <span class="step-chip__label">Step ${n}</span></p>`,
      );
    }
    expect(cards.map(([, , card]) => text(elementByClass(card, 'home-step__title', 'h3')))).toEqual([
      'Watch the introduction',
      "Choose what's keeping you up",
      'Try what fits you',
    ]);
    expect(cards.map(([, , card]) => links(card).map((l) => [l.href, l.name]))).toEqual([
      [['/start/', 'Go to the introduction']],
      [['/problems/', 'See sleep problems']],
      [],
    ]);
    expect(text(cards[1][2])).toContain(`There are ${problems.length}, grouped into ten areas.`);
  });

  it('ends step 3 with the ratings note while ratings are on (Main.dc.html, SPEC §7.5), and has no widget', () => {
    const body = elementByClass(elementByClass(html, 'home-step--3', 'li'), 'home-step__body', 'div');
    const note = elementByClass(body, 'home-step__note', 'p');
    expect(note).toBe('<p class="home-step__note" hidden data-js-only>Rate each video to help us improve</p>');
    expect(body).toMatch(/<\/p>\s*<p class="home-step__note" [^>]*>[^<]*<\/p>\s*<\/div>$/);
    expect(text(main).match(/Rate each video/g) ?? []).toHaveLength(1);
    expect(main).not.toMatch(/data-rating|Was this helpful|<fieldset/);
  });

  it('ships the ratings note hidden, so without JavaScript Home reads as with ratings off (SPEC §11)', () => {
    const note = tags(main, 'p').find((t) => attr(t, 'class') === 'home-step__note');
    expect([attr(note, 'hidden'), attr(note, 'data-js-only')]).toEqual(['', '']);
    // menu.js shows it, and Home loads menu.js but not rating.js.
    const scripts = tags(html, 'script').map((t) => attr(t, 'src'));
    expect(scripts).toContain('/js/menu.js');
    expect(scripts).not.toContain('/js/rating.js');
  });

  it('renders the note only while features.ratings is exactly true (SPEC §11)', () => {
    // Home's body rendered with each switch value (features-off.test.js
    // checks the pages built with the switch off).
    const require = createRequire(import.meta.url);
    const nunjucks = createRequire(require.resolve('@11ty/eleventy'))('nunjucks');
    const filters = {};
    configure({
      on: () => {},
      addGlobalData: () => {},
      addDataExtension: () => {},
      addPassthroughCopy: () => {},
      addCollection: () => {},
      addFilter: (name, fn) => (filters[name] = fn),
    });
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('src/_includes'), { autoescape: true });
    for (const [name, fn] of Object.entries(filters)) env.addFilter(name, fn);
    const { data, body } = parseFrontMatter(readFileSync('content/index.njk', 'utf8'));
    const notes = (ratings) =>
      env.renderString(body, { ...data, site: { features: { ratings } }, collections: { problems: [], videos: [] }, areas: [] }).match(/<p class="home-step__note"[^>]*>[^<]*<\/p>/g) ?? [];
    expect(notes(true)).toEqual(['<p class="home-step__note" hidden data-js-only>Rate each video to help us improve</p>']);
    for (const off of [false, 'true', 1, undefined]) expect(notes(off), String(off)).toEqual([]);
  });

  it('shows the ratings note once menu.js runs, and only the note (SPEC §11)', async () => {
    const dom = installDom(html);
    try {
      vi.resetModules();
      await import('../../src/js/menu.js');
      const note = dom.document.querySelector('.home-step__note');
      expect([note.hidden, note.textContent]).toEqual([false, 'Rate each video to help us improve']);
      expect(dom.document.querySelectorAll('[data-js-only]')).toEqual([note]);
    } finally {
      dom.restore();
    }
  });

  it('links each area, in areas.csv order, to its place on the Sleep problems page, with its topic count', () => {
    const cards = links(elementByClass(html, 'home-areas__list', 'ul'));
    const counts = areas.map((a) => problems.filter((p) => p.data.area === a.area_id).length);
    expect(cards.map((c) => [c.cls, c.href])).toEqual(areas.map((a) => ['home-area', `/problems/#${a.area_id}`]));
    expect(cards.map((c) => c.name)).toEqual(
      areas.map((a, i) => `${a.name} ${a.description} ${counts[i]} ${counts[i] === 1 ? 'topic' : 'topics'}`),
    );
    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(problems.length);
  });

  it('points every area link at an id on the Sleep problems page', () => {
    const problemsPage = pageAt(site, '/problems/');
    for (const a of areas) expect(problemsPage, a.area_id).toMatch(new RegExp(`\\sid="${a.area_id}"`));
  });

  it('counts the problems in "See all n sleep problems"', () => {
    expect(links(elementByClass(html, 'home-areas__all', 'p')).map((l) => [l.href, l.name])).toEqual([
      ['/problems/', `See all ${problems.length} sleep problems`],
    ]);
  });

  it('shows a format tile only for a format some video has, and no Transcript tile', () => {
    const anyHandout = videos.some((v) => v.data.handout);
    const anyAudio = videos.some((v) => v.data.audio);
    const section = elementByClass(html, 'home-formats', 'section');
    if (!anyHandout && !anyAudio) {
      expect(section).toBeUndefined();
      return;
    }
    const tiles = [...section.matchAll(/<li class="home-format"><strong class="home-format__name">([^<]*)<\/strong> ([^<]*)<\/li>/g)];
    expect(tiles.map((m) => [m[1], m[2]])).toEqual([
      // In the heading's order: watch, listen, read. Audio takes the board's
      // Transcript tile's place (SPEC §7.5).
      ['Video', 'Short, with captions'],
      ...(anyAudio ? [['Audio', 'Listen without watching']] : []),
      ...(anyHandout ? [['Handout', 'Read, print or keep']] : []),
    ]);
    expect(tags(section, 'li')).toHaveLength(tiles.length);
    expect(text(elementByClass(section, 'home-formats__heading', 'h2'))).toBe('Watch, listen or read');
  });

  it('names the audio-only version and the handout in the formats line and step 3, and no transcript (SPEC §7.5)', () => {
    const intro = elementByClass(html, 'home-formats__intro', 'div');
    if (intro) {
      expect(text(intro)).toMatch(/every video also has an audio-only version and a handout you can read or print\./i);
    }
    const step3 = text(elementByClass(elementByClass(html, 'home-step--3', 'li'), 'home-step__text', 'p'));
    expect(step3).toMatch(/Watch a video, listen to it, or read its handout\./);
  });

  it('promises no transcript anywhere: hero line, meta description, headings or text (project lead, 2026-11-06)', () => {
    expect(text(elementByClass(html, 'home-hero__lede', 'p'))).toMatch(/Watch, listen or read, whichever suits you\.$/);
    const description = attr(tags(html, 'meta').find((t) => attr(t, 'name') === 'description'), 'content');
    expect(description).toMatch(/Watch, listen or read, whichever suits you\.$/);
    expect(`${description} ${visibleText(html)}`).not.toMatch(/transcript|Watch, listen, read or print/i);
  });

  it('has the trial band and a "Need more help?" card', () => {
    const trial = elementByClass(html, 'home-trial', 'div');
    expect(links(trial).map((l) => [l.href, l.name])).toEqual([
      ['/about/', 'More about us and the trial'],
      ['/help/', 'Get more help'],
    ]);
    const { trial_text } = parseFrontMatter(readFileSync('content/index.njk', 'utf8')).data;
    expect(text(elementByClass(trial, 'home-trial__main', 'section'))).toBe(`About the trial Part of a research study ${trial_text} More about us and the trial`);
  });

  it('ends with the disclaimer, linking to Getting urgent help', () => {
    const disclaimer = elementByClass(html, 'home-disclaimer__text', 'p');
    expect(text(disclaimer)).toMatch(/^These videos and ideas don't replace care from your treating team\./);
    expect(links(disclaimer).map((l) => [l.href, l.name])).toEqual([['/urgent-help/', 'Getting urgent help']]);
  });

  it('has one H1, then H2 sections (H3 only for the steps)', () => {
    const formats = elementByClass(html, 'home-formats', 'section') ? ['2 Watch, listen or read'] : [];
    expect(headings(main)).toEqual([
      '1 Sleep can be hard after cancer. It can also get better.',
      '2 Three small steps',
      '3 Watch the introduction',
      "3 Choose what's keeping you up",
      '3 Try what fits you',
      "2 What's getting in the way of your sleep?",
      ...formats,
      '2 Part of a research study',
      '2 Need more help?',
    ]);
  });

  it('loads no page JavaScript and embeds no video', () => {
    // feedback.js comes with the footer's dialog (feedback.test.js).
    expect(tags(html, 'script').map((t) => attr(t, 'src')).filter((src) => src !== '/js/feedback.js')).toEqual(['/js/menu.js']);
    expect(html).not.toMatch(/class="video[ "]/);
  });
});

describe('Start here (/start/)', () => {
  const html = pageAt(site, '/start/');
  const main = mainOf(html);
  const chapters = model.start.data.chapters.map((c, i) => {
    const v = model.videos.get(c.video);
    return {
      n: i + 1,
      id: `v${i + 1}`,
      video: c.video,
      // From the video's row in data/videos.csv (SPEC §7.3).
      description: v.data.description,
      title: v.data.title,
      duration: v.data.duration,
      youtubeId: v.data.youtube_id,
      placeholder: v.data.placeholder === true,
      handout: v.data.handout ?? '',
      audio: v.data.audio ?? '',
    };
  });
  const article = (id) => {
    const start = main.indexOf(`<article class="start-chapter" id="${id}"`);
    return start < 0 ? undefined : main.slice(start, main.indexOf('</article>', start) + '</article>'.length);
  };

  it('has the band with the H1, lede and the "On this page" chapter pills', () => {
    const band = elementByClass(main, 'band', 'div');
    expect(text(elementByClass(band, 'band__eyebrow', 'p'))).toBe('Start here');
    expect(tags(html, 'h1')).toHaveLength(1);
    expect(text(elementByClass(band, 'band__title', 'h1'))).toBe('The introduction');
    expect(text(elementByClass(band, 'band__lede', 'p'))).toBe(model.start.data.summary);
    const nav = elementByClass(band, 'chapter-pills', 'nav');
    expect(attr(tags(nav, 'nav')[0], 'aria-label')).toBe('On this page');
    expect(attr(tags(nav, 'ol')[0], 'role')).toBe('list');
    expect(links(nav).map((l) => [l.href, l.name, l.cls])).toEqual(
      chapters.map((c) => [`#${c.id}`, `${c.n}. ${c.title}`, c.n === 1 ? 'chapter-pill chapter-pill--lead' : 'chapter-pill']),
    );
    // The filled first pill is emphasis, not a "you are here" marker.
    expect(nav).not.toMatch(/aria-current/);
  });

  it('keeps the band, TopicNav and chapters inside <main> and loads its stylesheet', () => {
    expect(main).toMatch(/<h1 class="band__title">/);
    expect(main).toMatch(/aria-label="All topics"/);
    expect(html).toContain('<link rel="stylesheet" href="/css/pages/start.css">');
  });

  it('has an H2 per chapter, in order, then the end card', () => {
    expect(headings(main)).toEqual([
      '1 The introduction',
      ...chapters.map((c) => `2 ${c.title}`),
      "2 Choose what's keeping you up",
    ]);
  });

  describe.each(chapters.map((c) => [c.id, c]))('chapter #%s', (id, c) => {
    const html = article(id);

    it('is an article named by its title: the video template with the label "n of N", the title and the description', () => {
      expect(html).toMatch(new RegExp(`^<article class="start-chapter" id="${id}" aria-labelledby="video-${c.video}-title">\\s*<div class="video-block">`));
      expect(tags(html, 'h2').map((t) => attr(t, 'id'))).toEqual([`video-${c.video}-title`]);
      expect(text(elementByClass(html, 'video-block__title', 'h2'))).toBe(text(c.title));
      // Intro-B's "Video n of N · duration" becomes the template's label, in
      // the solution cards' pill: the frame beside it shows the duration
      // (project lead, 2026-11-09). No large faint number, no eyebrow.
      expect(elementByClass(html, 'video-block__top', 'div')).toMatch(
        new RegExp(`^<div class="video-block__top">\\s*<span class="step-chip step-chip--sm"><span class="step-chip__num">${c.n}</span> <span class="step-chip__label">of ${chapters.length}</span></span>\\s*</div>$`),
      );
      expect(html).not.toMatch(/start-chapter__(num|eyebrow|desc|head)|video-block__close/);
      expect(tags(html, 'div').find((t) => /video-block__header/.test(t))).toBe('<div class="video-block__header">');
      expect(text(elementByClass(html, 'video-block__desc', 'p'))).toBe(c.description);
    });

    it("embeds the video, with no notice of its own (the page's YouTube note is last, SPEC §15.1)", () => {
      const video = elementByClass(html, 'video', 'div');
      const wrapper = tags(video, 'div')[0];
      expect(attr(wrapper, 'data-video')).toBe(c.video);
      expect(attr(wrapper, 'class').split(' ')).toEqual(expect.arrayContaining(['video', 'video--page']));
      expect(attr(wrapper, 'class')).not.toMatch(/video--lg/);
      expect(video).not.toMatch(/notice-text|video__notice|Pressing play/);
      expect(html).not.toMatch(/transcript/i);
      const facades = tags(video, 'a').filter((t) => attr(t, 'class') === 'video__facade');
      if (c.placeholder) {
        expect(facades).toEqual([]);
        expect(text(video)).toContain('[Video coming soon]');
      } else {
        expect(facades.map((t) => attr(t, 'href'))).toEqual([`https://www.youtube.com/watch?v=${c.youtubeId}`]);
      }
    });

    it('ends with one row of controls under the video: "Audio only", the handout, then the rating', () => {
      const row = elementByClass(html, 'video-controls', 'div');
      // The board's white bar is gone: the row sits right after the video.
      expect(html).not.toMatch(/start-chapter__bar/);
      expect(row).toBeTruthy();
      // The video's column ends right before the row, and the row ends the template.
      expect(html).toMatch(/<\/div>\s*<\/div>\s*<\/div>\s*<div class="video-controls">/);
      expect(html.slice(html.indexOf(row) + row.length).replace(/<\/div>/g, '').trim()).toBe('</article>');
      expect(tags(row, 'div')[0]).toBe('<div class="video-controls">');
      // "Audio only" first, so opening it never moves its button (SPEC §7.5).
      expect(row.indexOf('<details')).toBeLessThan(row.indexOf('<a class="format-button"'));
      const widget = elementByClass(row, 'rating', 'div');
      expect(tags(widget, 'div')[0]).toBe(`<div class="rating" data-rating="${c.video}" hidden>`);
      expect(text(elementByClass(widget, 'rating__legend', 'legend'))).toBe(`Was this helpful? ${text(c.title)}`);
      for (const before of ['<a class="format-button"', '<details']) expect(row.indexOf(before)).toBeLessThan(row.indexOf(widget));
      expect(widget).not.toMatch(/notice-text|anonymous|About the information/);
      expect(tags(row, 'a').filter((t) => attr(t, 'class') === 'format-button').map((t) => attr(t, 'href'))).toEqual([`/media/pdf/${c.handout}`]);
      expect(tags(row, 'audio').map((t) => attr(t, 'src'))).toEqual([`/media/audio/${c.audio}`]);
    });
  });

  it('has no transcript and no ratings notice anywhere (project lead, 2026-11-06)', () => {
    expect(visibleText(html)).not.toMatch(/transcript|Ratings are anonymous|About the information we collect/i);
    expect(main).not.toMatch(/data-transcript|transcript__|notice-text">Ratings/);
  });

  it('has one ratings widget per chapter while ratings are on, and no per-video feedback', () => {
    const content = elementByClass(main, 'start-flow', 'div');
    expect(links(content).filter((l) => /feedback/i.test(l.name))).toEqual([]);
    expect(content).not.toMatch(/<textarea|<form\b/);
    expect(tags(content, 'fieldset')).toHaveLength(chapters.length);
    expect([...content.matchAll(/\sdata-rating="([^"]+)"/g)].map((m) => m[1])).toEqual(chapters.map((c) => c.video));
  });

  it('ends with the card to the Sleep problems page, then the YouTube note, once, last (SPEC §15.1)', () => {
    const card = elementByClass(main, 'start-next', 'section');
    expect(text(elementByClass(card, 'start-next__body', 'p'))).toBe(
      `${problems.length} sleep problems, grouped into ten areas. Pick as many as sound like you.`,
    );
    expect(links(card).map((l) => [l.href, l.cls, l.name])).toEqual([
      ['/problems/', 'button button--light start-next__action', 'See sleep problems'],
    ]);
    const notes = [...main.matchAll(/<p class="notice-text youtube-note">[\s\S]*?<\/p>/g)].map((m) => m[0]);
    expect(notes).toHaveLength(1);
    const after = main.indexOf(card) + card.length;
    expect(main.indexOf(notes[0])).toBeGreaterThan(after);
    // Nothing but closing tags between the card and the note, and after the note.
    expect(main.slice(after, main.indexOf(notes[0]))).toMatch(/^\s*$/);
    expect(main.slice(main.indexOf(notes[0]) + notes[0].length)).toMatch(/^(\s*<\/div>)*\s*(<\/main>)?\s*$/);
  });

  it('contacts nothing before play: no resource hints, iframes or YouTube scripts', () => {
    // Only this site's stylesheets and icons (SPEC §7.5): no preconnect, preload or other hint.
    for (const link of tags(html, 'link')) {
      expect(['stylesheet', 'icon', 'apple-touch-icon'], link).toContain(attr(link, 'rel'));
      expect(attr(link, 'href'), link).toMatch(/^\/(?!\/)/);
    }
    expect(html).not.toMatch(/<iframe|iframe_api|youtube-nocookie|ytimg/);
  });
});

// Text that needs JavaScript (SPEC §11): it ships hidden, and menu.js, which
// only pages with the site header load, shows it.
describe('[data-js-only] across the built site', () => {
  const pages = readHtmlPages(site).filter((p) => /\sdata-js-only[\s>=]/.test(p.html));

  it('is on Home alone, while ratings are on', () => {
    expect(pages.map((p) => p.file)).toEqual(['index.html']);
  });

  it.each(pages.map((p) => [p.file, p.html]))('%s ships each one hidden and loads menu.js, which shows them', (file, html) => {
    const marked = [...html.matchAll(/<[a-z][a-z0-9]*\s[^>]*\bdata-js-only\b[^>]*>/g)].map((m) => m[0]);
    expect(marked.length).toBeGreaterThan(0);
    for (const tag of marked) expect(attr(tag, 'hidden'), tag).toBe('');
    expect(tags(html, 'script').map((t) => attr(t, 'src'))).toContain('/js/menu.js');
  });
});
