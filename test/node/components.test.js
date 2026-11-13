// The shared components (SPEC §7.5, §9.1-§9.3, §12, §15.1; HANDOFF §5):
// VideoEmbed, the video template every video uses (its label, title and
// description, and the row of controls under it: "Audio only", the handout,
// "Feedback" and the ratings widget), the step chip, rendered with Eleventy's own
// Nunjucks and our filters, plus the plumbing they rely on in the built
// site. video-template.test.js checks every video on every built page.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, inject, it } from 'vitest';
import configure from '../../eleventy.config.js';
import { attr, elementByClass, pageAt, readHtmlPages, tags, text, videoRow } from './helpers.js';

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

// Stand-ins for data/videos.csv rows. None of these IDs is a real video.
// Every row names an audio file and a handout, as the content check
// requires (SPEC §7.1).
const yt = (id) => `https://youtu.be/${id}`;
const files = (id) => ({ audio: `${id}.mp3`, handout: `${id}.pdf` });
const videos = [
  videoRow('full', { title: 'Settling "your" body', description: 'What it is about.', youtube_url: yt('AbCdEfGhIjK'), duration: '6:40', ...files('full') }),
  videoRow('bare', { title: 'Bare', description: 'Bare words.', youtube_url: 'https://www.youtube.com/watch?v=Zz_-9yXwVu0', duration: '1:05', ...files('bare') }),
  videoRow('thumb', { title: 'Thumb', description: 'A thumbnail.', youtube_url: yt('AbCdEfGhIjK'), duration: '0:45', thumbnail: 'thumb.jpg', ...files('thumb') }),
  videoRow('soon', { title: '[Coming]', description: '[Words.]', audio: 'placeholder-audio.mp3', handout: 'placeholder-handout.pdf' }),
  videoRow('words', { title: 'Words only', description: 'Just words.', youtube_url: yt('AbCdEfGhIjK'), duration: '2:00', ...files('words') }),
];
const video = (id) => filters.videoById(id, videos);
const siteConfig = JSON.parse(readFileSync('site.config.json', 'utf8'));

const render = (call, context = {}) =>
  env
    .renderString(
      `{% from "partials/video.njk" import videoEmbed %}{% from "partials/video-block.njk" import videoBlock %}` +
        `{% from "partials/step-chip.njk" import stepChip %}{% from "partials/rating.njk" import rating %}${call}`,
      context,
    )
    .trim();

describe('videoEmbed (VideoEmbed, SPEC §9.1)', () => {
  const html = render('{{ videoEmbed(v) }}', { v: video('full') });
  const facade = tags(html, 'a').find((t) => attr(t, 'class') === 'video__facade');

  it('is a "Watch on YouTube" link without JavaScript, named by the title and spoken duration', () => {
    expect(attr(facade, 'href')).toBe('https://www.youtube.com/watch?v=AbCdEfGhIjK');
    expect(attr(facade, 'rel')).toBe('noreferrer');
    expect(text(elementByClass(html, 'video__facade', 'a'))).toBe('Watch on YouTube: Settling "your" body 6:40 , 6 minutes 40 seconds');
    expect(html).toMatch(/<span class="duration-badge video__duration" aria-hidden="true">6:40<\/span>/);
    expect(html).toMatch(/<span class="play-disc" aria-hidden="true"><svg class="icon play-disc__icon"/);
  });

  it('carries what players.js needs, and never a title plate: the template\'s heading names the video', () => {
    const wrapper = tags(html, 'div')[0];
    expect([attr(wrapper, 'class'), attr(wrapper, 'data-video'), attr(wrapper, 'data-youtube-id'), attr(wrapper, 'data-title')]).toEqual([
      'video video--page', 'full', 'AbCdEfGhIjK', 'Settling &quot;your&quot; body',
    ]);
    expect(html).toContain('<span class="video__title visually-hidden">Settling &quot;your&quot; body</span>');
    for (const v of videos) {
      expect(render('{{ videoEmbed(v) }}', { v: video(v.video_id) }), v.video_id).not.toMatch(/<span class="video__title">/);
    }
  });

  it('contacts nothing: no iframe, player host, API script, preconnect or YouTube image', () => {
    for (const v of videos) {
      const out = render('{{ videoEmbed(v) }}', { v: filters.videoById(v.video_id, videos) });
      expect(out).not.toMatch(/<iframe|youtube-nocookie|iframe_api|ytimg|preconnect|dns-prefetch|<script/i);
      for (const tag of out.match(/<[a-z][^>]*>/gi)) {
        expect(attr(tag, 'src') ?? '', tag).not.toMatch(/^(https?:)?\/\//);
      }
    }
  });

  it('carries no notice of its own: the YouTube note is once per page, at its end (SPEC §15.1, §22 2026-11-07)', () => {
    for (const id of ['full', 'bare', 'words', 'soon']) {
      const out = render('{{ videoEmbed(v) }}', { v: video(id) });
      expect(out, id).not.toMatch(/notice-text|video__notice|youtube-note"|Pressing play/);
      // No handout link, description or transcript: the facade is only the video.
      expect(out, id).not.toMatch(/data-handout|media\/pdf|transcript|Just words|What it is about/i);
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

  it('shows a self-hosted thumbnail if there is one, otherwise the settling arc, on every frame', () => {
    const thumb = render('{{ videoEmbed(v) }}', { v: video('thumb') });
    const img = tags(thumb, 'img')[0];
    expect([attr(img, 'src'), attr(img, 'alt'), attr(img, 'loading')]).toEqual(['/media/thumbs/thumb.jpg', '', 'lazy']);
    expect(thumb).not.toContain('class="arc');
    for (const id of ['full', 'bare', 'soon']) {
      expect(render('{{ videoEmbed(v) }}', { v: video(id) }), id).toContain('<svg class="arc arc--video" viewBox="0 0 960 120"');
    }
  });

  it('sets the bleed, and has no size variant (every facade is the same)', () => {
    const wrapper = (out) => attr(tags(out, 'div')[0], 'class');
    expect(wrapper(render("{{ videoEmbed(v, bleed='page') }}", { v: video('bare') }))).toBe('video video--page');
    expect(wrapper(render("{{ videoEmbed(v, bleed='card') }}", { v: video('bare') }))).toBe('video video--card');
    // 'page' is the default, as it is the video template's: every bleed has styles (no 'inset').
    expect(wrapper(render('{{ videoEmbed(v) }}', { v: video('bare') }))).toBe('video video--page');
    expect(readFileSync('src/_includes/partials/video.njk', 'utf8')).not.toMatch(/inset/);
    expect(readFileSync('src/css/components.css', 'utf8')).toMatch(/\.video--page \.video__frame \{/);
    expect(readFileSync('src/_includes/partials/video.njk', 'utf8')).not.toMatch(/showTitle|video--lg|size=/);
  });

  it('shows a placeholder video as "[Video coming soon]", with no link, button or YouTube ID', () => {
    const out = render('{{ videoEmbed(v) }}', { v: video('soon') });
    expect(out).not.toMatch(/<a class="video__facade|<button|data-youtube-id|youtube\.com\/watch|PLACEHOLDER/);
    expect(text(elementByClass(out, 'video__facade', 'div'))).toBe('[Coming] [Video coming soon] [mm:ss]');
    expect(attr(tags(out, 'div')[0], 'class')).toBe('video video--page video--placeholder');
    // The page's YouTube note still shows (from the layout), so the page reads as it will at launch.
    expect(out).not.toContain('[Words.]');
  });
});

// The one video template (partials/video-block.njk; SPEC §7.5; project lead,
// 2026-11-09): every video on the site is this macro.
describe('videoBlock (the video template, SPEC §7.5, §9.2, §9.3, §12)', () => {
  const summaries = (html) => [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => text(m[1]).replace(' :', ':'));
  // An element's direct children, in order, as "tag.class" (icons and the
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
  const row = (html) => elementByClass(html, 'video-controls', 'div');
  const header = (html) => elementByClass(html, 'video-block__header', 'div');

  it('is the header, the video, then the row of controls, in that order', () => {
    const html = render('{{ videoBlock(v, ratings=true) }}', { v: video('full') });
    expect(tags(html, 'div').slice(0, 2)).toEqual(['<div class="video-block">', '<div class="video-block__grid">']);
    expect(children(elementByClass(html, 'video-block__grid', 'div'))).toEqual(['div.video-block__header', 'div.video-block__video', 'div.video-controls']);
    expect(children(elementByClass(html, 'video-block__video', 'div'))).toEqual(['div.video video--page']);
  });

  it('heads it with the title and the description, and no label or Close unless asked', () => {
    const html = render('{{ videoBlock(v) }}', { v: video('full') });
    expect(header(html)).toBe(
      '<div class="video-block__header">\n      <h2 class="video-block__title" id="video-full-title">Settling &quot;your&quot; body</h2>\n      <p class="video-block__desc">What it is about.</p>\n    </div>',
    );
    expect(html).not.toMatch(/video-block__top|step-chip|<button/);
    // h3 inside a solution card.
    expect(tags(render('{{ videoBlock(v, heading=3) }}', { v: video('full') }), 'h3')).toEqual(['<h3 class="video-block__title" id="video-full-title">']);
    // No caller can give a video another title or description (project lead, 2026-11-14; SPEC §7.2).
    expect(render("{{ videoBlock(v, description='Try this.', title='Another title') }}", { v: video('full') })).toBe(html);
  });

  it('puts the label first, and a solution card\'s Close at its right, shipping that header hidden', () => {
    const labelled = render("{{ videoBlock(v, label={ num: 2, text: 'of 3' }) }}", { v: video('bare') });
    expect(children(header(labelled))).toEqual(['div.video-block__top', 'h2.video-block__title', 'p.video-block__desc']);
    expect(text(elementByClass(labelled, 'video-block__top', 'div'))).toBe('2 of 3');
    expect(tags(labelled, 'div')).toContain('<div class="video-block__header">');

    const card = render("{{ videoBlock(v, heading=3, label={ num: 1, text: 'Main' }, close='solution-bare-panel', bleed='card') }}", { v: video('bare') });
    expect(tags(card, 'div')).toContain('<div class="video-block__header" hidden>');
    expect(children(elementByClass(card, 'video-block__top', 'div'))).toEqual(['span.step-chip', 'button.video-block__close']);
    expect(tags(card, 'button')).toEqual(['<button type="button" class="video-block__close" aria-expanded="true" aria-controls="solution-bare-panel">']);
    expect(text(elementByClass(card, 'video-block__close', 'button'))).toBe('Close Bare');
    // The title is where solutions.js moves focus when the card opens.
    expect(tags(card, 'h3')).toEqual(['<h3 class="video-block__title" id="video-bare-title" tabindex="-1">']);
    expect(attr(tags(card, 'div').find((t) => /class="video /.test(t)), 'class')).toBe('video video--card');
  });

  it('is one row: "Audio only", then the handout link, then the rating, with nothing else', () => {
    const html = render('{{ videoBlock(v, ratings=true) }}', { v: video('full') });
    expect(tags(row(html), 'div')[0]).toBe('<div class="video-controls">');
    // "Audio only" first, so opening it never moves its button (project
    // lead, 2026-11-07; SPEC §7.5).
    expect(children(row(html))).toEqual(['details.format-disclosure', 'a.format-button', 'div.rating']);
    expect(text(elementByClass(html, 'format-button', 'a')).replace(' :', ':')).toBe('Handout: Settling "your" body (PDF)');
    expect(summaries(html)).toEqual(['Audio only: Settling "your" body']);
    // No transcript, print button, group label or notice (project lead, 2026-11-06).
    expect(row(html)).not.toMatch(/transcript|Print|role="group"|Other formats|notice-text|anonymous|About the information/i);
    expect(row(html)).not.toContain('What it is about.');
  });

  it('renders "Audio only" and the handout for every video, placeholders included, and the rating only while ratings are exactly true', () => {
    for (const v of videos) {
      const id = v.video_id;
      for (const ratings of [false, 'true', undefined]) {
        const call = ratings === undefined ? '{{ videoBlock(v) }}' : `{{ videoBlock(v, ratings=${JSON.stringify(ratings)}) }}`;
        expect(children(row(render(call, { v: video(id) }))), `${id} ${ratings}`).toEqual(['details.format-disclosure', 'a.format-button']);
      }
      expect(children(row(render('{{ videoBlock(v, ratings=true) }}', { v: video(id) }))), id).toEqual(['details.format-disclosure', 'a.format-button', 'div.rating']);
      // Never hidden: it always holds the two buttons (no data-rating-reveal).
      expect(tags(row(render('{{ videoBlock(v, ratings=true) }}', { v: video(id) })), 'div')[0], id).toBe('<div class="video-controls">');
    }
    expect(readFileSync('src/_includes/partials/video-block.njk', 'utf8')).not.toMatch(/if video\.(audio|handout)|data-rating-reveal/);
  });

  it('puts "Feedback" after the handout and before the rating: a hidden button naming the video, for feedback.js to show (SPEC §13)', () => {
    const html = render('{{ videoBlock(v, ratings=true, feedback=true) }}', { v: video('full') });
    expect(children(row(html))).toEqual(['details.format-disclosure', 'a.format-button', 'button.format-button', 'div.rating']);
    // Never hidden: only the button and the rating wait for their scripts.
    expect(tags(row(html), 'div')[0]).toBe('<div class="video-controls">');
    expect(tags(row(html), 'button')).toEqual(['<button type="button" class="format-button" data-feedback-trigger data-feedback-video="full" hidden>']);
    const button = row(html).match(/<button\b[\s\S]*?<\/button>/)[0];
    // The handout's look: the same class, an icon of the same size, then the label.
    expect(button).toMatch(/^<button [^>]*><svg class="icon format-button__icon" width="18" height="18" [^>]*aria-hidden="true" focusable="false">.*<\/svg>Feedback<span class="visually-hidden">: Settling &quot;your&quot; body<\/span><\/button>$/);
    expect(text(button).replace(' :', ':')).toBe('Feedback: Settling "your" body');
    // The icon is a stroke-only speech bubble: no fill or colour of its own, no style attribute.
    const icon = button.match(/<svg\b[\s\S]*?<\/svg>/)[0];
    expect(icon).toMatch(/^<svg [^>]*fill="none" stroke="currentColor" stroke-width="2" [^>]*><path d="[^"]+"\/><\/svg>$/);
    expect(icon).not.toMatch(/style=|fill="(?!none)|#[0-9a-f]{3}/i);
    // No link, form or field: the dialog (base.njk) holds those.
    expect(row(html)).not.toMatch(/<form|<textarea|href="\/contact\/"|aria-haspopup/);
    // Without the rating it ends the row.
    expect(children(row(render('{{ videoBlock(v, feedback=true) }}', { v: video('full') })))).toEqual(['details.format-disclosure', 'a.format-button', 'button.format-button']);
  });

  it('renders "Feedback" for every video, placeholders included, and only while feedback is exactly true', () => {
    for (const v of videos) {
      const id = v.video_id;
      for (const feedback of [false, 'true', 1, undefined]) {
        const call = feedback === undefined ? '{{ videoBlock(v, ratings=true) }}' : `{{ videoBlock(v, ratings=true, feedback=${JSON.stringify(feedback)}) }}`;
        const html = render(call, { v: video(id) });
        expect(children(row(html)), `${id} ${feedback}`).toEqual(['details.format-disclosure', 'a.format-button', 'div.rating']);
        expect(html, `${id} ${feedback}`).not.toMatch(/data-feedback|>Feedback</);
      }
      const on = render('{{ videoBlock(v, feedback=true) }}', { v: video(id) });
      expect(tags(row(on), 'button'), id).toEqual([`<button type="button" class="format-button" data-feedback-trigger data-feedback-video="${id}" hidden>`]);
      // The heading feedback.js takes the video's title from is in the same template.
      expect(on, id).toContain(` id="video-${id}-title"`);
    }
    // In a solution card it is the template's second button, after Close.
    const card = render("{{ videoBlock(v, heading=3, label={ num: 1, text: 'Main' }, close='solution-bare-panel', bleed='card', feedback=true) }}", { v: video('bare') });
    expect(tags(card, 'button').map((t) => attr(t, 'class'))).toEqual(['video-block__close', 'format-button']);
  });

  it('links the handout by video_id, opening the PDF in media/pdf/', () => {
    const html = render('{{ videoBlock(v) }}', { v: video('full') });
    const handout = tags(html, 'a').find((t) => attr(t, 'class') === 'format-button');
    // data-handout holds the video_id, not the file name (handout_open, SPEC §10.2).
    expect([attr(handout, 'class'), attr(handout, 'href'), attr(handout, 'data-handout'), attr(handout, 'type')]).toEqual([
      'format-button', '/media/pdf/full.pdf', 'full', 'application/pdf',
    ]);
    expect(html).toContain('Handout<span class="visually-hidden">: Settling &quot;your&quot; body (PDF)</span></a>');
  });

  it('plays audio from media/audio/ only on request, in a closed native disclosure with a download link inside', () => {
    const html = render('{{ videoBlock(v) }}', { v: video('words') });
    expect(tags(html, 'details')).toEqual(['<details class="format-disclosure" id="audio-words">']);
    expect(tags(html, 'summary')).toEqual(['<summary class="format-disclosure__toggle">']);
    const audio = tags(html, 'audio')[0];
    // data-media holds the video_id, not the file name (audio_play, SPEC §10.2).
    expect([attr(audio, 'src'), attr(audio, 'preload'), attr(audio, 'data-media'), attr(audio, 'aria-label')]).toEqual([
      '/media/audio/words.mp3', 'none', 'words', 'Audio only: Words only',
    ]);
    expect(attr(audio, 'controls')).toBe('');
    expect(html).toContain('<a href="/media/audio/words.mp3">Download the audio (MP3)</a>');
    expect(html).not.toMatch(/transcript/i);
  });

  it('keeps a placeholder\'s shared stand-in files apart by video_id in its hooks', () => {
    const html = render('{{ videoBlock(v) }}', { v: video('soon') });
    expect(attr(tags(html, 'audio')[0], 'src')).toBe('/media/audio/placeholder-audio.mp3');
    expect(attr(tags(html, 'audio')[0], 'data-media')).toBe('soon');
    expect(attr(tags(html, 'a').find((t) => attr(t, 'class') === 'format-button'), 'data-handout')).toBe('soon');
  });
});

describe('stepChip', () => {
  it('renders a step chip: a numbered disc and its label, with its variant as a class', () => {
    expect(render("{{ stepChip(2, 'Main', variant='paper') }}")).toBe(
      '<span class="step-chip step-chip--paper"><span class="step-chip__num">2</span> <span class="step-chip__label">Main</span></span>',
    );
    expect(render("{{ stepChip(1, 'of 2') }}")).toBe(
      '<span class="step-chip"><span class="step-chip__num">1</span> <span class="step-chip__label">of 2</span></span>',
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
      '1. [How sleep works and why cancer can change it]', '2. [How to use this program]',
    ]);
  });
});
