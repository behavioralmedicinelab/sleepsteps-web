// Problem pages (SPEC §7.2, §9.1-§9.3, §12, §15.1, §20 M1b; HANDOFF §6.4):
// the built pages for all 36 problems, a problem of each layout shape, a
// stand-alone problem (no solutions), the solution card rendered with a
// playable (fake) video, and solutions.js.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import configure from '../../eleventy.config.js';
import { validateContent } from '../../scripts/validate-content.js';
import { attr, elementByClass, pageAt, readHtmlPages, tags, text } from './helpers.js';

const site = inject('builtSite');
const { model } = validateContent(process.cwd());
const problems = [...model.problems.entries()];
const video = (id) => model.videos.get(id);
const hasTranscript = (id) => video(id).body.trim() !== '';

/** Every element (opening tag to its matching close) with this class. */
function elements(html, className, tagName = '[a-z0-9]+') {
  const found = [];
  let rest = html;
  for (let el = elementByClass(rest, className, tagName); el; el = elementByClass(rest, className, tagName)) {
    found.push(el);
    rest = rest.slice(rest.indexOf(el) + el.length);
  }
  return found;
}

const mainOf = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
// A stand-alone problem (SPEC §7.2) has no `solutions`.
const solutionsOf = (data) => data.solutions ?? [];
const tiersOf = (data) => ({
  main: solutionsOf(data).filter((s) => s.tier === 'main'),
  extra: solutionsOf(data).filter((s) => s.tier === 'extra'),
});

describe.each(problems)('/problems/%s/', (slug, { data }) => {
  const html = pageAt(site, `/problems/${slug}/`);
  const main = mainOf(html);
  const tiers = tiersOf(data);
  const solutions = solutionsOf(data);
  const pageVideos = [data.problem_video, ...solutions.map((s) => s.video)];
  const cards = elements(main, 'solution', 'li');

  it('loads the page stylesheet, players.js and, with solutions, solutions.js', () => {
    expect(tags(html, 'link').map((t) => attr(t, 'href'))).toContain('/css/pages/problem.css');
    const scripts = tags(html, 'script').map((t) => attr(t, 'src'));
    expect(scripts).toContain('/js/players.js');
    expect(scripts.includes('/js/solutions.js')).toBe(solutions.length > 0);
  });

  it('shows the phone back link to the area and, with solutions, the "On this page" chips', () => {
    const back = tags(main, 'a').find((t) => attr(t, 'class') === 'problem__back');
    expect(attr(back, 'href')).toBe(`/problems/#${data.area}`);
    const chips = elementByClass(main, 'on-this-page', 'nav');
    if (!solutions.length) {
      // A stand-alone page: nothing below the problem block to jump to.
      expect(chips).toBeUndefined();
      return;
    }
    expect(attr(tags(chips, 'nav')[0], 'aria-label')).toBe('On this page');
    const links = [...chips.matchAll(/<a (?:class="([^"]+)" )?href="([^"]+)">([\s\S]*?)<\/a>/g)].map((m) => [m[2], text(m[3])]);
    // The first chip is filled, as on the board (Start here's lead pill).
    expect([...chips.matchAll(/<a (?:class="([^"]+)" )?href=/g)].map((m) => m[1])).toEqual(
      ['on-this-page__lead', ...links.slice(1).map(() => undefined)],
    );
    const m = tiers.main.length;
    const x = tiers.extra.length;
    expect(links).toEqual([
      ['#about-this', 'About this'],
      ['#main-solutions', `${m} main solution${m === 1 ? '' : 's'}`],
      ...(x ? [['#more-solutions', `${x} more solution${x === 1 ? '' : 's'}`]] : []),
    ]);
    for (const [href] of links) expect(main).toContain(`id="${href.slice(1)}"`);
  });

  it('has one video per page video, in order, each followed by the YouTube notice', () => {
    const blocks = elements(main, 'video', 'div');
    expect(blocks.map((b) => attr(tags(b, 'div')[0], 'data-video'))).toEqual(pageVideos);
    blocks.forEach((block, i) => {
      const notice = elementByClass(block, 'video__notice', 'p');
      expect(text(notice)).toMatch(/^Pressing play loads this video from YouTube \(Google\)\./);
      const links = tags(notice, 'a').map((t) => attr(t, 'href'));
      expect(links).toEqual([
        '/privacy/#cookies-and-browser-storage',
        ...(hasTranscript(pageVideos[i]) ? [`#transcript-${pageVideos[i]}`] : []),
      ]);
    });
    // The problem's own video carries a visible title plate; solution videos
    // are named by their card.
    expect(blocks[0]).toMatch(/<span class="video__title">/);
    for (const block of blocks.slice(1)) expect(block).toMatch(/<span class="video__title visually-hidden">/);
  });

  it('contacts nothing before a play button is pressed', () => {
    expect(html).not.toMatch(/<iframe|youtube-nocookie|iframe_api|i\.ytimg|preconnect|dns-prefetch/);
  });

  it('shows each video\'s handout, audio and transcript exactly when it has one', () => {
    // Each video's own block: the problem block, or the video's card.
    const blocks = [elementByClass(main, 'problem-block', 'div'), ...cards];
    pageVideos.forEach((id, i) => {
      const { data: v } = video(id);
      const block = blocks[i];
      expect(block.includes(`id="transcript-${id}"`), `${id} transcript`).toBe(hasTranscript(id));
      expect(block.includes(`id="audio-${id}"`), `${id} audio`).toBe(Boolean(v.audio));
      const handouts = tags(block, 'a').filter((t) => attr(t, 'data-handout'));
      expect(handouts.map((t) => [attr(t, 'href'), attr(t, 'data-handout')]), `${id} handout`).toEqual(
        // In the formats, plus a solution card's quick link; the hook holds the video_id (SPEC §10.2).
        !v.handout ? [] : Array(i === 0 ? 1 : 2).fill([`/media/pdf/${v.handout}`, id]),
      );
    });
  });

  it('renders each solution as a closed native <details name="solution">, numbered within its tier', () => {
    const details = tags(main, 'details').filter((t) => /\bsolution__disclosure\b/.test(attr(t, 'class')));
    expect(details).toHaveLength(solutions.length);
    for (const t of details) {
      expect(attr(t, 'name')).toBe('solution');
      expect(attr(t, 'open')).toBeUndefined();
    }
    const chips = cards.map((card) => text(elementByClass(card, 'step-chip', 'span')));
    expect(chips).toEqual([
      ...tiers.main.map((_, i) => `${i + 1} Main`),
      ...tiers.extra.map((_, i) => `${i + 1} Extra`),
    ]);
    expect(cards.map((card) => attr(tags(card, 'li')[0], 'id'))).toEqual(solutions.map((s) => `solution-${s.video}`));
  });

  it('shows each card\'s title, blurb and length, with nothing interactive inside the summary', () => {
    cards.forEach((card, i) => {
      const s = [...tiers.main, ...tiers.extra][i];
      const summary = card.match(/<summary class="solution__face">([\s\S]*?)<\/summary>/)[1];
      expect(summary).not.toMatch(/<(a|button|input|select|textarea|details|iframe|audio)\b|tabindex/);
      expect(text(elementByClass(summary, 'solution__title', 'span'))).toBe(video(s.video).data.title);
      expect(text(elementByClass(summary, 'solution__blurb', 'span'))).toBe(s.blurb);
      expect(summary).toContain(`id="solution-${s.video}-length"`);
      expect(tags(summary, 'span').find((t) => attr(t, 'class') === 'solution__band')).toContain('aria-hidden="true"');
    });
  });

  it('keeps the JavaScript-only parts hidden: card headers, quick Transcript links, print buttons', () => {
    for (const card of cards) {
      expect(tags(card, 'div').find((t) => /\bsolution__header\b/.test(attr(t, 'class')))).toMatch(/\shidden(?=[\s>])/);
      const close = tags(card, 'button').find((t) => attr(t, 'class') === 'solution__close');
      const panelId = attr(tags(card, 'div').find((t) => attr(t, 'class') === 'solution__panel'), 'id');
      expect([attr(close, 'aria-expanded'), attr(close, 'aria-controls')]).toEqual(['true', panelId]);
      expect(text(elementByClass(card, 'solution__close', 'button'))).toMatch(/^Close \S/);
    }
    for (const t of tags(main, 'li').filter((t) => attr(t, 'class') === 'solution__quick-transcript')) {
      expect(attr(t, 'hidden')).toBe('');
    }
    for (const t of tags(main, 'button').filter((t) => /\btranscript__print\b/.test(attr(t, 'class')))) {
      expect(attr(t, 'hidden')).toBe('');
    }
  });

  it('puts "Other things that can help" after the main solutions, only when there are extras, and neither on a stand-alone page', () => {
    const order = [...main.matchAll(/<section class="solutions solutions--(main|extra)" id="([a-z-]+)"/g)].map((m) => [m[1], m[2]]);
    expect(order).toEqual([
      ...(tiers.main.length ? [['main', 'main-solutions']] : []),
      ...(tiers.extra.length ? [['extra', 'more-solutions']] : []),
    ]);
    if (!solutions.length) {
      expect(main).not.toMatch(/solution-grid|main-solutions|more-solutions/);
      return;
    }
    expect(text(elementByClass(main, 'solutions--main', 'section'))).toMatch(/^Things to try Main solutions Most people start here\./);
    if (tiers.extra.length) {
      expect(text(elementByClass(main, 'solutions--extra', 'section'))).toMatch(/^If you want more Other things that can help Useful extras/);
    }
  });

  it('shows "Is this you?", with "Not quite? Try" the first related topic', () => {
    const panel = elementByClass(main, 'is-this-you', 'div');
    expect(panel).toMatch(/<h2 class="is-this-you__title" id="is-this-you-title">Is this you\?<\/h2>/);
    expect(text(elementByClass(panel, 'is-this-you__summary', 'p'))).toBe(data.is_this_you.summary);
    expect([...panel.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]))).toEqual(data.is_this_you.bullets);
    const next = elementByClass(panel, 'is-this-you__next', 'p');
    if (data.related.length) {
      const first = model.problems.get(data.related[0]).data;
      expect(text(next)).toBe(`Not quite? Try ${first.title} .`);
      expect(tags(next, 'a').map((t) => attr(t, 'href'))).toEqual([`/problems/${data.related[0]}/`]);
    } else {
      expect(next).toBeUndefined();
    }
  });

  it('lists the related topics with their statements, then "Back to all sleep problems"', () => {
    const related = elementByClass(main, 'related', 'section');
    if (data.related.length) {
      const links = [...related.matchAll(/<a class="topic-card" href="([^"]+)">([\s\S]*?)<\/a>/g)].map((m) => [m[1], text(m[2])]);
      expect(links).toEqual(
        data.related.map((r) => {
          const p = model.problems.get(r).data;
          return [`/problems/${r}/`, `${p.title} ${p.statement}`];
        }),
      );
    } else {
      expect(related).toBeUndefined();
    }
    const all = elementByClass(main, 'problem__all', 'p');
    expect(all).toBe('<p class="problem__all"><a href="/problems/">Back to all sleep problems</a></p>');
    expect(main.lastIndexOf('problem__all')).toBeGreaterThan(main.lastIndexOf('solution-grid'));
  });

  it('has no per-video feedback links or forms (the footer is the only route, SPEC §13)', () => {
    expect(text(main)).not.toMatch(/feedback/i);
    expect(main).not.toMatch(/<(form|textarea)\b/);
  });

  it('keeps a heading outline without skipped levels: h1, h2 sections, h3 solutions', () => {
    const levels = [...main.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i) expect(level, `heading ${i + 1}`).toBeLessThanOrEqual(levels[i - 1] + 1);
    });
    expect(levels.filter((l) => l === 3)).toHaveLength(solutions.length);
    expect(main.slice(main.indexOf('>') + 1)).not.toMatch(/\sid="main"/);
  });
});

describe('the layout samples (SPEC §7)', () => {
  // One problem of each shape the planning sheet gives.
  it.each([
    ['cant-get-back-to-sleep', 3, 3],
    ['tired-but-wired', 3, 2],
    ['stress-and-worries', 3, 1],
    ['sleep-timing-all-over-the-place', 3, 0],
    ['putting-off-going-to-bed', 2, 2],
    ['sharing-a-bed', 0, 0],
  ])('/problems/%s/ shows %i main and %i extra cards', (slug, main, extra) => {
    const html = mainOf(pageAt(site, `/problems/${slug}/`));
    const grid = (tier) => elementByClass(html, `solutions--${tier}`, 'section') ?? '';
    expect(elements(grid('main'), 'solution', 'li')).toHaveLength(main);
    expect(elements(grid('extra'), 'solution', 'li')).toHaveLength(extra);
  });

  it.each(['tired-but-wired', 'cant-get-back-to-sleep', 'pain', 'hot-flushes-and-night-sweats'])(
    '/problems/%s/ shows its placeholder related topics',
    (slug) => {
      expect(elements(mainOf(pageAt(site, `/problems/${slug}/`)), 'topic-card', 'a').length).toBeGreaterThanOrEqual(2);
    },
  );
});

// A stand-alone problem (SPEC §7.2): its own video, made for it, is the main
// content, with no solutions. sharing-a-bed's video has every format.
describe('a stand-alone problem page: /problems/sharing-a-bed/', () => {
  const slug = 'sharing-a-bed';
  const { data } = model.problems.get(slug);
  const html = pageAt(site, `/problems/${slug}/`);
  const main = mainOf(html);
  const { data: v } = video(data.problem_video);

  it('is a stand-alone problem whose video has a handout, audio and a transcript', () => {
    expect([data.standalone, data.solutions]).toEqual([true, undefined]);
    expect([Boolean(v.handout), Boolean(v.audio), hasTranscript(data.problem_video)]).toEqual([true, true, true]);
  });

  it('has no solutions section, solution cards, chips or solutions.js', () => {
    expect(main).not.toMatch(/class="solutions\b|solution-grid|class="solution\b|on-this-page|#main-solutions|#more-solutions/);
    expect(text(main)).not.toMatch(/Things to try|Main solutions|Other things that can help|If you want more/);
    expect(html).not.toContain('/js/solutions.js');
  });

  it('shows the problem video, titled, with its notice and every format, as the main content', () => {
    const block = elementByClass(main, 'problem-block', 'div');
    const videos = elements(main, 'video', 'div');
    expect(videos).toHaveLength(1);
    expect(block).toContain(videos[0]);
    expect(attr(tags(videos[0], 'div')[0], 'data-video')).toBe(data.problem_video);
    expect(text(elementByClass(videos[0], 'video__title', 'span'))).toBe(v.title);
    expect(text(elementByClass(videos[0], 'video__notice', 'p'))).toMatch(/^Pressing play loads this video from YouTube \(Google\)\./);
    const formats = elementByClass(block, 'formats', 'div');
    expect(tags(formats, 'a').filter((t) => attr(t, 'data-handout') === data.problem_video)).toHaveLength(1);
    expect(formats).toContain(`id="audio-${data.problem_video}"`);
    expect(formats).toContain(`id="transcript-${data.problem_video}"`);
  });

  it('keeps its headings in order: the title, then "Is this you?" (and Related topics, when it has some)', () => {
    const headings = [...main.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => [Number(m[1]), text(m[2])]);
    expect(headings).toEqual([
      [1, data.title],
      [2, 'Is this you?'],
      ...(data.related.length ? [[2, 'Related topics']] : []),
    ]);
  });

  it('works without JavaScript: native disclosures, a plain handout link, and only the print button hidden', () => {
    for (const id of [`audio-${data.problem_video}`, `transcript-${data.problem_video}`]) {
      expect(tags(main, 'details').some((t) => attr(t, 'id') === id), id).toBe(true);
    }
    expect(main).toMatch(/<audio\b[^>]*\scontrols\b/);
    expect(text(elementByClass(main, 'transcript__body', 'div'))).toBe(`[Transcript of “${v.title.slice(1, -1)}”.]`);
    const hidden = [...main.matchAll(/<([a-z0-9]+)\b[^>]*\shidden(?=[\s>])[^>]*>/g)].map((m) => [m[1], attr(m[0], 'class')]);
    expect(hidden).toEqual([['button', 'transcript__print link-button']]);
    expect(elementByClass(main, 'problem__all', 'p')).toBe('<p class="problem__all"><a href="/problems/">Back to all sleep problems</a></p>');
  });

  it('is still in the site search index, with its video title in its text (SPEC §8.3)', () => {
    const entries = JSON.parse(readFileSync(path.join(site, 'search-index.json'), 'utf8'));
    const entry = entries.find((e) => e.id === slug);
    expect([entry?.type, entry?.url, entry?.title, entry?.summary]).toEqual(['problem', `/problems/${slug}/`, data.title, data.statement]);
    expect(entry.transcript).toContain(v.title);
    expect(entry.transcript).toContain(data.is_this_you.summary);
  });
});

describe('problem page assets on other pages', () => {
  it.each(readHtmlPages(site).filter((p) => !/^problems\/[^/]+\/index\.html$/.test(p.file)).map((p) => [p.file, p.html]))(
    '%s loads neither problem.css nor solutions.js',
    (file, html) => {
      expect(html).not.toContain('/css/pages/problem.css');
      expect(html).not.toContain('/js/solutions.js');
    },
  );
});

// The committed videos are all placeholders, so the built site never shows a
// playable facade. Render the cards with a fake video (not a real ID) to
// check that path.
describe('solutionsSection with a playable video', () => {
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
  const item = (id, data, body = '') => ({
    page: { fileSlug: id },
    data,
    rawInput: body,
    templateContent: body ? `<p>${body}</p>\n` : '',
  });
  const videos = [
    item('full', { title: 'Settling your body', youtube_id: 'AbCdEfGhIjK', duration: '6:40', handout: 'full.pdf', audio: 'full.mp3' }, 'Words.'),
    item('bare', { title: 'Bare', youtube_id: 'Zz_-9yXwVu0', duration: '1:05' }),
  ];
  const render = (solutions, ratings = false) =>
    env.renderString('{% from "problem/solutions.njk" import solutionsSection %}{{ solutionsSection("main", items, "a-page", ratings) }}', {
      items: filters.solutionsByTier(solutions, videos).main,
      ratings,
    });

  const html = render([{ tier: 'main', video: 'full', blurb: 'Try this.' }, { tier: 'main', video: 'bare', blurb: 'Or this.' }]);
  const [full, bare] = elements(html, 'solution', 'li');

  it('puts the "Watch on YouTube" facade and its notice inside the panel, not the closed card', () => {
    const summary = full.match(/<summary[\s\S]*?<\/summary>/)[0];
    expect(summary).not.toMatch(/youtube/i);
    const panel = elementByClass(full, 'solution__panel', 'div');
    const facade = tags(panel, 'a').find((t) => attr(t, 'class') === 'video__facade');
    expect([attr(facade, 'href'), attr(facade, 'rel')]).toEqual(['https://www.youtube.com/watch?v=AbCdEfGhIjK', 'noreferrer']);
    expect(text(elementByClass(panel, 'video__facade', 'a'))).toBe('Watch on YouTube: Settling your body 6:40 , 6 minutes 40 seconds');
    expect(panel.indexOf('video__notice')).toBeGreaterThan(panel.indexOf('video__facade'));
  });

  it('describes the card with its spoken length and orders the panel header, video, formats', () => {
    expect(text(elementByClass(full, 'solution__length', 'span'))).toBe('Video, 6 minutes 40 seconds');
    const panel = elementByClass(full, 'solution__panel', 'div');
    const order = ['solution__header', 'solution__video', 'solution__tools'].map((c) => panel.indexOf(`class="${c}`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(elementByClass(panel, 'solution__heading', 'h3')).toBe(
      '<h3 class="solution__heading" id="solution-full-heading" tabindex="-1">Settling your body</h3>',
    );
  });

  it('gives the closed card quick Transcript and Handout links with hidden context', () => {
    const quick = elementByClass(full, 'solution__quick', 'ul');
    expect([...quick.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [m[1], text(m[2])])).toEqual([
      ['#transcript-full', 'Transcript : Settling your body'],
      ['/media/pdf/full.pdf', 'Handout : Settling your body (PDF)'],
    ]);
  });

  it('leaves out the formats and quick links for a video without them', () => {
    expect(bare).not.toMatch(/solution__tools|solution__quick/);
    expect(bare).toMatch(/<div class="solution__meta">\s*<\/div>/);
  });

  it('renders nothing for a tier with no solutions (a stand-alone problem has none, SPEC §7.2)', () => {
    expect(render([]).trim()).toBe('');
    expect(env.renderString('{% from "problem/solutions.njk" import solutionsSection %}[{{ solutionsSection("extra", items, "a-page") }}]', { items: [] })).toBe('[]');
  });

  it('renders nothing visible in the ratings slots until M4, even with ratings on', () => {
    expect(render([{ tier: 'main', video: 'bare', blurb: 'Or this.' }], true)).toBe(
      render([{ tier: 'main', video: 'bare', blurb: 'Or this.' }], false),
    );
  });
});

describe('src/js/solutions.js', () => {
  const source = readFileSync('src/js/solutions.js', 'utf8');
  const code = source.replace(/\/\/.*$/gm, '');

  it('imports only players.js, and stores, sends and styles nothing', () => {
    expect([...code.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1])).toEqual(['./players.js']);
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|sendBeacon|XMLHttpRequest/);
    expect(code).not.toMatch(/\.style\b|innerHTML|insertAdjacentHTML|setAttribute\(\s*['"]style/);
  });

  it('upgrades cards to aria-expanded buttons controlling labelled regions', () => {
    for (const needle of ["setAttribute('aria-expanded'", "setAttribute('aria-controls'", "setAttribute('role', 'region')", "setAttribute('aria-labelledby'", 'sleepsteps:reveal', 'pauseWithin(']) {
      expect(code).toContain(needle);
    }
  });
});
