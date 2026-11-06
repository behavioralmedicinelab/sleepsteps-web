// The shared components (SPEC §9.1-§9.3, §12, §15.1; HANDOFF §5):
// VideoEmbed, the row of controls under each video (handout, "Audio only" and
// the ratings widget), the step chip, rendered with Eleventy's own Nunjucks
// and our filters, plus the plumbing they rely on in the built site.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, inject, it } from 'vitest';
import configure from '../../eleventy.config.js';
import { attr, elementByClass, pageAt, readHtmlPages, tags, text } from './helpers.js';

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

// Stand-ins for the `videos` collection. None of these IDs is a real video.
const item = (id, data, body = '') => ({
  page: { fileSlug: id },
  data,
  rawInput: body,
  templateContent: body.trim() ? `<p>${body.trim()}</p>\n` : '',
});
const videos = [
  item('full', { title: 'Settling "your" body', youtube_id: 'AbCdEfGhIjK', duration: '6:40', audio: 'full.mp3', handout: 'full.pdf' }, 'The transcript.'),
  item('bare', { title: 'Bare', youtube_id: 'Zz_-9yXwVu0', duration: '1:05' }),
  item('thumb', { title: 'Thumb', youtube_id: 'AbCdEfGhIjK', duration: '0:45', thumbnail: 'thumb.jpg' }),
  item('soon', { title: '[Coming]', youtube_id: 'PLACEHOLDER', duration: '[mm:ss]', placeholder: true }, 'Words.'),
  item('handout', { title: 'Handout only', youtube_id: 'AbCdEfGhIjK', duration: '2:00', handout: 'h.pdf' }),
  item('audio', { title: 'Audio only', youtube_id: 'AbCdEfGhIjK', duration: '2:00', audio: 'a.mp3' }),
  item('words', { title: 'Words only', youtube_id: 'AbCdEfGhIjK', duration: '2:00' }, 'Just words.'),
];
const video = (id) => filters.videoById(id, videos);
const siteConfig = JSON.parse(readFileSync('site.config.json', 'utf8'));

const render = (call, context = {}) =>
  env
    .renderString(
      `{% from "partials/video.njk" import videoEmbed %}{% from "partials/video-controls.njk" import videoControls %}` +
        `{% from "partials/step-chip.njk" import stepChip %}{% from "partials/rating.njk" import rating %}${call}`,
      context,
    )
    .trim();

describe('videoEmbed (VideoEmbed, SPEC §9.1)', () => {
  const html = render('{{ videoEmbed(v, showTitle=true) }}', { v: video('full') });
  const facade = tags(html, 'a').find((t) => attr(t, 'class') === 'video__facade');

  it('is a "Watch on YouTube" link without JavaScript, named by the title and spoken duration', () => {
    expect(attr(facade, 'href')).toBe('https://www.youtube.com/watch?v=AbCdEfGhIjK');
    expect(attr(facade, 'rel')).toBe('noreferrer');
    expect(text(elementByClass(html, 'video__facade', 'a'))).toBe('Watch on YouTube: Settling "your" body 6:40 , 6 minutes 40 seconds');
    expect(html).toMatch(/<span class="duration-badge video__duration" aria-hidden="true">6:40<\/span>/);
    expect(html).toMatch(/<span class="play-disc" aria-hidden="true"><svg class="icon play-disc__icon"/);
  });

  it('carries what players.js needs, and the title as a visible plate with showTitle', () => {
    const wrapper = tags(html, 'div')[0];
    expect([attr(wrapper, 'class'), attr(wrapper, 'data-video'), attr(wrapper, 'data-youtube-id'), attr(wrapper, 'data-title')]).toEqual([
      'video video--inset', 'full', 'AbCdEfGhIjK', 'Settling &quot;your&quot; body',
    ]);
    expect(html).toContain('<span class="video__title">Settling &quot;your&quot; body</span>');
    expect(render('{{ videoEmbed(v) }}', { v: video('full') })).toContain('<span class="video__title visually-hidden">');
  });

  it('contacts nothing: no iframe, player host, API script, preconnect or YouTube image', () => {
    for (const v of videos) {
      const out = render('{{ videoEmbed(v, arc=true) }}', { v: filters.videoById(v.page.fileSlug, videos) });
      expect(out).not.toMatch(/<iframe|youtube-nocookie|iframe_api|ytimg|preconnect|dns-prefetch|<script/i);
      for (const tag of out.match(/<[a-z][^>]*>/gi)) {
        expect(attr(tag, 'src') ?? '', tag).not.toMatch(/^(https?:)?\/\//);
      }
    }
  });

  it('carries no notice of its own: the YouTube note is once per page, at its end (SPEC §15.1, §22 2026-11-07)', () => {
    for (const id of ['full', 'handout', 'bare', 'words', 'audio', 'soon']) {
      const out = render('{{ videoEmbed(v) }}', { v: video(id) });
      expect(out, id).not.toMatch(/notice-text|video__notice|youtube-note"|Pressing play/);
      // No handout link and no transcript (the file's body isn't shown).
      expect(out, id).not.toMatch(/data-handout|media\/pdf|transcript|Just words|The transcript/i);
    }
  });

  it('describes the play control with the page\'s YouTube note, so it is heard before pressing play (SPEC §9.1)', () => {
    expect(attr(facade, 'aria-describedby')).toBe('youtube-note-text');
  });

  it('youtubeNote() is the SPEC §15.1 note: its sentences under the id the play control names, then one link, to the privacy page', () => {
    const note = env.renderString('{% from "notices/video.njk" import youtubeNote %}{{ youtubeNote() }}');
    expect(tags(note, 'p')).toEqual(['<p class="notice-text youtube-note">']);
    expect(text(note)).toBe(
      'Pressing play on a video loads it from YouTube (Google). YouTube may then store cookies in your browser and collect information about what you watch. More about this',
    );
    expect(note.match(/<span id="youtube-note-text">([^<]*)<\/span>/)?.[1]).toBe(
      'Pressing play on a video loads it from YouTube (Google). YouTube may then store cookies in your browser and collect information about what you watch.',
    );
    expect(tags(note, 'a').map((a) => attr(a, 'href'))).toEqual(['/privacy/#cookies-and-browser-storage']);
  });

  it('shows a self-hosted thumbnail if there is one, otherwise the arc when asked', () => {
    const thumb = render('{{ videoEmbed(v, arc=true) }}', { v: video('thumb') });
    const img = tags(thumb, 'img')[0];
    expect([attr(img, 'src'), attr(img, 'alt'), attr(img, 'loading')]).toEqual(['/media/thumbs/thumb.jpg', '', 'lazy']);
    expect(thumb).not.toContain('class="arc');
    expect(render('{{ videoEmbed(v, arc=true) }}', { v: video('bare') })).toContain('<svg class="arc arc--video" viewBox="0 0 960 120"');
    expect(render('{{ videoEmbed(v) }}', { v: video('bare') })).not.toMatch(/class="arc"|video__media/);
  });

  it('sets the bleed and size variants', () => {
    const wrapper = (out) => attr(tags(out, 'div')[0], 'class');
    expect(wrapper(render("{{ videoEmbed(v, bleed='page', size='lg') }}", { v: video('bare') }))).toBe('video video--page video--lg');
    expect(wrapper(render("{{ videoEmbed(v, bleed='card') }}", { v: video('bare') }))).toBe('video video--card');
  });

  it('shows a placeholder video as "[Video coming soon]", with no link, button or YouTube ID', () => {
    const out = render('{{ videoEmbed(v, showTitle=true) }}', { v: video('soon') });
    expect(out).not.toMatch(/<a class="video__facade|<button|data-youtube-id|youtube\.com\/watch|PLACEHOLDER/);
    expect(text(elementByClass(out, 'video__facade', 'div'))).toBe('[Coming] [Video coming soon] [mm:ss]');
    expect(attr(tags(out, 'div')[0], 'class')).toBe('video video--inset video--placeholder');
    // The page's YouTube note still shows (from the layout), so the page reads as it will at launch.
    expect(out).not.toContain('Words.');
  });
});

describe('videoControls (the row under each video, SPEC §9.2, §9.3, §12)', () => {
  const summaries = (html) => [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => text(m[1]).replace(' :', ':'));
  // The row's direct children, in order, as "tag.class" (icons and the
  // radios, which have no closing tag, left out).
  const children = (html) => {
    const out = [];
    let depth = 0;
    const markup = html.replace(/<svg\b[\s\S]*?<\/svg>/g, '').replace(/<input\b[^>]*>/g, '');
    for (const m of markup.matchAll(/<(\/?)([a-z0-9]+)\b[^>]*>/gi)) {
      if (m[1]) {
        depth -= 1;
        continue;
      }
      if (depth === 1) out.push(`${m[2]}.${attr(m[0], 'class') ?? ''}`);
      depth += 1;
    }
    return out;
  };

  it('renders nothing for a video with no handout or audio while ratings are off, whatever its body', () => {
    for (const id of ['bare', 'words', 'thumb']) {
      expect(render('{{ videoControls(v) }}', { v: video(id) }), id).toBe('');
      expect(render('{{ videoControls(v, false) }}', { v: video(id) }), id).toBe('');
      // Only exactly true turns the rating on (SPEC §11).
      expect(render("{{ videoControls(v, 'true') }}", { v: video(id) }), id).toBe('');
    }
  });

  it('is one row: "Audio only", then the handout link, then the rating, with nothing else', () => {
    const html = render('{{ videoControls(v, true) }}', { v: video('full') });
    expect(tags(html, 'div')[0]).toBe('<div class="video-controls">');
    // "Audio only" first, so opening it never moves its button (project
    // lead, 2026-11-07; SPEC §7.5).
    expect(children(html)).toEqual(['details.format-disclosure', 'a.format-button', 'div.rating']);
    expect(text(elementByClass(html, 'format-button', 'a')).replace(' :', ':')).toBe('Handout: Settling "your" body (PDF)');
    expect(summaries(html)).toEqual(['Audio only: Settling "your" body']);
    // No transcript, print button, group label or notice (project lead, 2026-11-06).
    expect(html).not.toMatch(/transcript|Print|role="group"|Other formats|notice-text|anonymous|About the information/i);
    expect(html).not.toContain('The transcript.');
  });

  it('links the handout by video_id, opening the PDF in media/pdf/', () => {
    const handout = tags(render('{{ videoControls(v) }}', { v: video('full') }), 'a').find((t) => attr(t, 'class') === 'format-button');
    // data-handout holds the video_id, not the file name (handout_open, SPEC §10.2).
    expect([attr(handout, 'class'), attr(handout, 'href'), attr(handout, 'data-handout'), attr(handout, 'type')]).toEqual([
      'format-button', '/media/pdf/full.pdf', 'full', 'application/pdf',
    ]);
    expect(render('{{ videoControls(v) }}', { v: video('full') })).toContain('Handout<span class="visually-hidden">: Settling &quot;your&quot; body (PDF)</span></a>');
  });

  it('plays audio from media/audio/ only on request, in a closed native disclosure with a download link inside', () => {
    const html = render('{{ videoControls(v) }}', { v: video('audio') });
    expect(tags(html, 'details')).toEqual(['<details class="format-disclosure" id="audio-audio">']);
    expect(tags(html, 'summary')).toEqual(['<summary class="format-disclosure__toggle">']);
    const audio = tags(html, 'audio')[0];
    // data-media holds the video_id, not the file name (audio_play, SPEC §10.2).
    expect([attr(audio, 'src'), attr(audio, 'preload'), attr(audio, 'data-media'), attr(audio, 'aria-label')]).toEqual([
      '/media/audio/a.mp3', 'none', 'audio', 'Audio only: Audio only',
    ]);
    expect(attr(audio, 'controls')).toBe('');
    expect(html).toContain('<a href="/media/audio/a.mp3">Download the audio (MP3)</a>');
    expect(html).not.toMatch(/Handout|transcript/);
    expect(children(html)).toEqual(['details.format-disclosure']);
  });

  it('shows only the formats a video has, and is visible without JavaScript whenever it has one', () => {
    const handout = render('{{ videoControls(v, true) }}', { v: video('handout') });
    expect(children(handout)).toEqual(['a.format-button', 'div.rating']);
    expect(tags(handout, 'div')[0]).toBe('<div class="video-controls">');
    expect(handout).not.toMatch(/<details|<audio/);
    const audio = render('{{ videoControls(v, true) }}', { v: video('audio') });
    expect(children(audio)).toEqual(['details.format-disclosure', 'div.rating']);
  });

  it('ships a row that would hold only the rating hidden, for rating.js to reveal (SPEC §11)', () => {
    for (const id of ['bare', 'words', 'soon']) {
      const html = render('{{ videoControls(v, true) }}', { v: video(id) });
      expect(tags(html, 'div')[0], id).toBe('<div class="video-controls" hidden data-rating-reveal>');
      expect(children(html), id).toEqual(['div.rating']);
    }
  });

  it("adds a page's own classes to the row", () => {
    expect(tags(render("{{ videoControls(v, true, 'solution__tools') }}", { v: video('full') }), 'div')[0]).toBe('<div class="video-controls solution__tools">');
    expect(tags(render("{{ videoControls(v, true, 'solution__tools') }}", { v: video('bare') }), 'div')[0]).toBe(
      '<div class="video-controls solution__tools" hidden data-rating-reveal>',
    );
  });
});

describe('stepChip', () => {
  it('renders a step chip, hiding the disc when the label repeats the number', () => {
    expect(render("{{ stepChip(2, 'Main', variant='sm paper') }}")).toBe(
      '<span class="step-chip step-chip--sm step-chip--paper"><span class="step-chip__num">2</span> <span class="step-chip__label">Main</span></span>',
    );
    expect(render("{{ stepChip(1, 'Step 1', tag='p', hideNum=true) }}")).toBe(
      '<p class="step-chip"><span class="step-chip__num" aria-hidden="true">1</span> <span class="step-chip__label">Step 1</span></p>',
    );
  });

});

// The widget itself (partials/rating.njk; SPEC §12). rating.js and the built
// pages are checked in rating.test.js.
describe('rating (SPEC §12)', () => {
  const html = render('{{ rating(v) }}', { v: video('full') });
  const root = tags(html, 'div')[0];

  it('ships the widget hidden, named by its video in data-rating', () => {
    expect(root).toBe('<div class="rating" data-rating="full" hidden>');
  });

  it('is exactly a fieldset and the status line: no notice, link or other text (project lead, 2026-11-06)', () => {
    const inner = html.match(/^<div[^>]*>([\s\S]*)<\/div>$/)[1];
    const top = [...inner.matchAll(/<(fieldset|div|p|a)\b[^>]*>/g)].map((m) => m[0]);
    expect(top[0]).toBe('<fieldset class="rating__group">');
    expect(html).toMatch(/<\/fieldset>\s*<div class="rating__status-box">[\s\S]*<\/div>\s*<\/div>$/);
    expect(tags(html, 'a')).toEqual([]);
    expect(html).not.toMatch(/notice-text|anonymous|improve these resources|About the information|privacy/i);
    // Visible text: the legend and nothing else until there is news (the
    // sizers are invisible copies).
    const visible = text(html.replace(/<p class="rating__sizer"[\s\S]*?<\/p>/g, '').replace(/<span class="visually-hidden">[\s\S]*?<\/span>/g, ''));
    expect(visible).toBe('Was this helpful?');
  });

  it('is a fieldset whose legend asks "Was this helpful?" and names the video for screen readers, escaped', () => {
    expect(tags(html, 'fieldset')).toEqual(['<fieldset class="rating__group">']);
    expect(tags(html, 'legend')).toHaveLength(1);
    expect(elementByClass(html, 'rating__legend', 'legend')).toBe(
      '<legend class="rating__legend">Was this helpful?<span class="visually-hidden"> Settling &quot;your&quot; body</span></legend>',
    );
  });

  it('has exactly five unchecked radios, 1 to 5, sharing one name, each with its own "n star(s)" label', () => {
    const inputs = tags(html, 'input');
    expect(inputs.map((t) => [attr(t, 'type'), attr(t, 'name'), attr(t, 'id'), attr(t, 'value'), attr(t, 'autocomplete')])).toEqual(
      [1, 2, 3, 4, 5].map((n) => ['radio', 'rating-full', `rating-full-${n}`, String(n), 'off']),
    );
    for (const t of inputs) expect(attr(t, 'checked'), t).toBeUndefined();
    const labels = [...html.matchAll(/<label class="rating__star" for="([^"]+)">([\s\S]*?)<\/label>/g)];
    expect(labels.map((m) => [m[1], text(m[2])])).toEqual([1, 2, 3, 4, 5].map((n) => [`rating-full-${n}`, n === 1 ? '1 star' : `${n} stars`]));
    // Each radio comes just before its label, which the CSS fills from.
    expect(html).toMatch(/(?:<input class="rating__input visually-hidden"[^>]*>\s*<label class="rating__star"[\s\S]*?<\/label>\s*){5}<\/div>\s*<\/fieldset>/);
    expect(tags(html, 'svg').map((t) => [attr(t, 'class'), attr(t, 'width'), attr(t, 'aria-hidden')])).toEqual(Array(5).fill(['icon rating__icon', '26', 'true']));
  });

  it('has an empty status line, not yet a live region, and hidden copies of the longest messages', () => {
    const box = elementByClass(html, 'rating__status-box', 'div');
    expect(tags(box, 'p')).toEqual([
      '<p class="rating__status" id="rating-full-status" data-rating-status>',
      '<p class="rating__sizer" aria-hidden="true">',
      '<p class="rating__sizer" aria-hidden="true">',
    ]);
    expect(elementByClass(box, 'rating__status', 'p')).toBe('<p class="rating__status" id="rating-full-status" data-rating-status></p>');
    expect(attr(elementByClass(box, 'rating__status', 'p'), 'role')).toBeUndefined();
    expect([...box.matchAll(/<p class="rating__sizer"[^>]*>([^<]*)<\/p>/g)].map((m) => m[1])).toEqual([
      'Thanks. You rated this 5 of 5.',
      "Couldn't send right now — please try again later",
    ]);
  });

  it('has no closed-card summary macro or ratings notice partial any more', () => {
    expect(readFileSync('src/_includes/partials/rating.njk', 'utf8')).not.toMatch(/ratingStatus|data-rating-summary|notices\/ratings/);
    expect(() => readFileSync('src/_includes/notices/ratings.njk', 'utf8')).toThrow();
  });
});

describe('players.js', () => {
  const source = readFileSync('src/js/players.js', 'utf8');
  const code = source.replace(/^\s*\/\/.*$/gm, ''); // without whole-line comments

  it('uses the IFrame Player API with the privacy-enhanced host and the SPEC §9.1 player settings', () => {
    expect(source).toContain("const API_URL = 'https://www.youtube.com/iframe_api';");
    expect(source).toContain("const PLAYER_HOST = 'https://www.youtube-nocookie.com';");
    // Captions on by default, in English (SPEC §9.1, §21).
    expect(source).toContain("const PLAYER_VARS = Object.freeze({ rel: 0, playsinline: 1, autoplay: 1, cc_load_policy: 1, cc_lang_pref: 'en' });");
    expect(code).not.toMatch(/modestbranding|\bhl:|origin:|preconnect|dns-prefetch|ytimg/);
  });

  it('stores nothing and sends nothing: it reports to events.js through DOM events (SPEC §9.4, §10.1)', () => {
    expect(code).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB|sendBeacon|fetch\(|XMLHttpRequest/);
  });
});

describe('SiteFooter text (site.config.json `footer`, SPEC §11)', () => {
  const footer = {
    tagline: 'Tagline <b>here</b>.',
    acknowledgement: 'We acknowledge the land.',
    trialRegistration: 'REG-1',
    ethicsApproval: 'ETH-2',
    licenceExceptions: 'except the moon',
  };
  const renderFooter = (changes = {}) =>
    env.render('partials/site-footer.njk', {
      site: { siteName: 'Name', features: { feedback: true }, footer: { ...footer, ...changes } },
      page: { url: '/x/' },
    });
  const meta = (html) => elementByClass(html, 'site-footer__meta', 'div').match(/^<div[^>]*>([\s\S]*)<\/div>$/)[1].trim().split(/\s*\n\s*/);
  const licence = '<p class="site-footer__licence">Content is licensed under <a href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">CC BY 4.0</a>';

  it('renders each field, escaped, with the licence link kept in the template', () => {
    const html = renderFooter();
    expect(elementByClass(html, 'site-footer__tagline', 'p')).toBe('<p class="site-footer__tagline">Tagline &lt;b&gt;here&lt;/b&gt;.</p>');
    expect(meta(html)).toEqual([
      '<p>We acknowledge the land.</p>',
      '<p>REG-1 <span aria-hidden="true">·</span> ETH-2</p>',
      `${licence}, except the moon.</p>`,
    ]);
  });

  it.each([
    ['acknowledgement', { acknowledgement: '' }, ['<p>REG-1 <span aria-hidden="true">·</span> ETH-2</p>', `${licence}, except the moon.</p>`]],
    ['trial registration', { trialRegistration: '' }, ['<p>We acknowledge the land.</p>', '<p>ETH-2</p>', `${licence}, except the moon.</p>`]],
    ['ethics approval', { ethicsApproval: '' }, ['<p>We acknowledge the land.</p>', '<p>REG-1</p>', `${licence}, except the moon.</p>`]],
    ['registration and ethics', { trialRegistration: '', ethicsApproval: '' }, ['<p>We acknowledge the land.</p>', `${licence}, except the moon.</p>`]],
    ['licence exclusions', { licenceExceptions: '' }, ['<p>We acknowledge the land.</p>', '<p>REG-1 <span aria-hidden="true">·</span> ETH-2</p>', `${licence}.</p>`]],
  ])('leaves out an empty %s', (name, changes, expected) => {
    expect(meta(renderFooter(changes))).toEqual(expected);
  });
});

describe('built site', () => {
  const site = inject('builtSite');
  const pages = readHtmlPages(site);

  it.each(pages.map((p) => [p.file, p.html]))('%s loads players.js only on problem pages and Start here', (file, html) => {
    const scripts = tags(html, 'script').map((t) => attr(t, 'src'));
    const expected = file === 'start/index.html' || /^problems\/[^/]+\/index\.html$/.test(file);
    expect(scripts.includes('/js/players.js'), file).toBe(expected);
    expect(html).toContain('<link rel="stylesheet" href="/css/components.css">');
  });

  it.each(pages.filter((p) => p.file !== 'urgent-help/index.html').map((p) => [p.file, p.html]))(
    '%s states the content licence in the footer (SPEC §22)',
    (file, html) => {
      const line = elementByClass(elementByClass(html, 'site-footer', 'footer'), 'site-footer__licence', 'p');
      expect(text(line).replace(/ ([,.])/g, '$1')).toBe(`Content is licensed under CC BY 4.0, ${siteConfig.footer.licenceExceptions}.`);
      expect(tags(line, 'a')).toEqual(['<a href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">']);
    },
  );

  it('titles the Start here chapter links from the video library', () => {
    const html = pageAt(site, '/start/');
    const chapters = elementByClass(elementByClass(html, 'with-sidebar__side', 'div'), 'topic-nav__chapters', 'ol');
    expect([...chapters.matchAll(/<a[^>]*>([^<]*)<\/a>/g)].map((m) => m[1])).toEqual([
      '1. [How sleep works]', '2. [Why cancer can change sleep]', '3. [How to use this program]',
    ]);
  });
});
