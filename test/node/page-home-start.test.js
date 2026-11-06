// Home (/) and Start here (/start/), checked on the fresh build (SPEC §7.3,
// §9.1-§9.3, §10.2, §12, §13, §15.1, §20 M1b; HANDOFF §6.1, §6.2). Expected
// values come from the content files, so the checks follow content edits.
import { readFileSync } from 'node:fs';
import { describe, expect, inject, it } from 'vitest';
import { parseCsvRecords } from '../../scripts/lib/csv.js';
import { validateContent } from '../../scripts/validate-content.js';
import { attr, elementByClass, pageAt, tags, text } from './helpers.js';

const site = inject('builtSite');
const { model } = validateContent();
const areas = parseCsvRecords(readFileSync('data/areas.csv', 'utf8')).sort((a, b) => Number(a.order) - Number(b.order));
const problems = [...model.problems.values()];
const videos = [...model.videos.values()];
const hasTranscript = (v) => v.body.trim() !== '';

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

  it('has no ratings prompt before the ratings widget ships (M4)', () => {
    expect(text(main)).not.toMatch(/Rate each video|Was this helpful/);
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

  it('shows a format tile only for a format some video has', () => {
    const anyTranscript = videos.some(hasTranscript);
    const anyHandout = videos.some((v) => v.data.handout);
    const anyAudio = videos.some((v) => v.data.audio);
    const section = elementByClass(html, 'home-formats', 'section');
    if (!anyTranscript && !anyHandout && !anyAudio) {
      expect(section).toBeUndefined();
      return;
    }
    const tiles = [...section.matchAll(/<li class="home-format"><strong class="home-format__name">([^<]*)<\/strong> ([^<]*)<\/li>/g)];
    expect(tiles.map((m) => [m[1], m[2]])).toEqual([
      // In the heading's order: watch, listen, read, print. Audio is not on the board (SPEC §7.5).
      ['Video', 'Short, with captions'],
      ...(anyAudio ? [['Audio', 'Listen without watching']] : []),
      ...(anyTranscript ? [['Transcript', 'Read at your own speed']] : []),
      ...(anyHandout ? [['Handout', 'One page to print or keep']] : []),
    ]);
  });

  it('names all four formats in the formats line and step 3 (every video has audio, a transcript and a handout, SPEC §7.5)', () => {
    const intro = elementByClass(html, 'home-formats__intro', 'div');
    if (intro) {
      expect(text(intro)).toMatch(/every video also has an audio-only version, a transcript and a handout/i);
    }
    const step3 = text(elementByClass(elementByClass(html, 'home-step--3', 'li'), 'home-step__text', 'p'));
    expect(step3).toMatch(/Watch a video, listen to it, read its transcript or print its handout\./);
  });

  it('names listening in the hero line and the formats heading (every video has an audio-only version, SPEC §7.5)', () => {
    expect(text(elementByClass(html, 'home-hero__lede', 'p'))).toMatch(/Watch, listen, read or print/);
    expect(attr(tags(html, 'meta').find((t) => attr(t, 'name') === 'description'), 'content')).toMatch(/Watch, listen, read or print/);
  });

  it('has the trial band and a "Need more help?" card', () => {
    const trial = elementByClass(html, 'home-trial', 'div');
    expect(links(trial).map((l) => [l.href, l.name])).toEqual([
      ['/about/', 'More about us and the trial'],
      ['/help/', 'Getting more help'],
    ]);
    expect(text(trial)).toContain('[research team and institution]');
  });

  it('ends with the disclaimer, linking to Getting urgent help', () => {
    const disclaimer = elementByClass(html, 'home-disclaimer__text', 'p');
    expect(text(disclaimer)).toMatch(/^SleepSteps does not replace care from your treating team\./);
    expect(links(disclaimer).map((l) => [l.href, l.name])).toEqual([['/urgent-help/', 'Getting urgent help']]);
  });

  it('has one H1, then H2 sections (H3 only for the steps)', () => {
    const formats = elementByClass(html, 'home-formats', 'section') ? ['2 Watch, listen, read or print'] : [];
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
    expect(tags(html, 'script').map((t) => attr(t, 'src'))).toEqual(['/js/menu.js']);
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
      description: c.description,
      title: v.data.title,
      duration: v.data.duration,
      youtubeId: v.data.youtube_id,
      placeholder: v.data.placeholder === true,
      transcript: hasTranscript(v),
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

    it('is an article named by its title, with the number, eyebrow and description', () => {
      expect(html).toMatch(new RegExp(`^<article class="start-chapter" id="${id}" aria-labelledby="${id}-title">`));
      expect(tags(html, 'h2').map((t) => attr(t, 'id'))).toEqual([`${id}-title`]);
      expect(text(elementByClass(html, 'start-chapter__title', 'h2'))).toBe(text(c.title));
      expect(elementByClass(html, 'start-chapter__num', 'span')).toBe(`<span class="start-chapter__num" aria-hidden="true">${c.n}</span>`);
      const eyebrow = elementByClass(html, 'start-chapter__eyebrow', 'p');
      const visible = eyebrow.replace(/<span class="visually-hidden">[\s\S]*?<\/span>/g, '');
      expect(text(visible)).toBe(`Video ${c.n} of ${chapters.length} · ${c.duration}`);
      expect(text(elementByClass(html, 'start-chapter__desc', 'p'))).toBe(c.description);
    });

    it('embeds the video with the YouTube notice directly under the frame', () => {
      const video = elementByClass(html, 'video', 'div');
      const wrapper = tags(video, 'div')[0];
      expect(attr(wrapper, 'data-video')).toBe(c.video);
      expect(attr(wrapper, 'class').split(' ')).toEqual(expect.arrayContaining(['video--page', 'video--lg']));
      expect(video).toMatch(/<\/div>\s*<p class="notice-text video__notice"><span id="video-notice-[a-z0-9-]+">Pressing play loads this video from YouTube \(Google\)\./);
      const notice = elementByClass(video, 'video__notice', 'p');
      expect(tags(notice, 'a').map((t) => attr(t, 'href'))).toEqual([
        '/privacy/#cookies-and-browser-storage',
        ...(c.transcript ? [`#transcript-${c.video}`] : []),
      ]);
      if (c.transcript) expect(html).toContain(`id="transcript-${c.video}"`);
      const facades = tags(video, 'a').filter((t) => attr(t, 'class') === 'video__facade');
      if (c.placeholder) {
        expect(facades).toEqual([]);
        expect(text(video)).toContain('[Video coming soon]');
      } else {
        expect(facades.map((t) => attr(t, 'href'))).toEqual([`https://www.youtube.com/watch?v=${c.youtubeId}`]);
      }
    });

    it('has the white bar only when the video has a format, holding just the formats it has', () => {
      const bar = elementByClass(html, 'start-chapter__bar', 'div');
      if (!c.transcript && !c.handout && !c.audio) {
        expect(bar).toBeUndefined();
        return;
      }
      expect(bar).toBeTruthy();
      expect(tags(bar, 'a').filter((t) => attr(t, 'class') === 'format-button').map((t) => attr(t, 'href'))).toEqual(
        c.handout ? [`/media/pdf/${c.handout}`] : [],
      );
      expect(tags(bar, 'audio').map((t) => attr(t, 'src'))).toEqual(c.audio ? [`/media/audio/${c.audio}`] : []);
      expect(tags(bar, 'details').filter((t) => attr(t, 'id') === `transcript-${c.video}`)).toHaveLength(c.transcript ? 1 : 0);
    });
  });

  it('has no per-video feedback, and no ratings widget before M4', () => {
    const content = elementByClass(main, 'start-flow', 'div');
    expect(links(content).filter((l) => /feedback/i.test(l.name))).toEqual([]);
    expect(content).not.toMatch(/<textarea|<fieldset|Was this helpful/);
  });

  it('ends with the card to the Sleep problems page', () => {
    const card = elementByClass(main, 'start-next', 'section');
    expect(text(elementByClass(card, 'start-next__body', 'p'))).toBe(
      `${problems.length} sleep problems, grouped into ten areas. Pick as many as sound like you.`,
    );
    expect(links(card).map((l) => [l.href, l.cls, l.name])).toEqual([
      ['/problems/', 'button button--light start-next__action', 'See sleep problems'],
    ]);
  });

  it('contacts nothing before play: no resource hints, iframes or YouTube scripts', () => {
    expect(tags(html, 'link').map((t) => attr(t, 'rel'))).toEqual(tags(html, 'link').map(() => 'stylesheet'));
    expect(html).not.toMatch(/<iframe|iframe_api|youtube-nocookie|ytimg/);
  });
});
