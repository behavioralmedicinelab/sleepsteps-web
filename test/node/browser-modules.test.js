// The browser modules run against our real markup in a small DOM
// (mini-dom.js; no DOM package, SPEC §5): players.js (SPEC §9.1, §9.3,
// §16.2), solutions.js (HANDOFF §6.4, SPEC §7.5) and problems.js (SPEC §7.2,
// §8.1). The other tests check the HTML these modules start from; these
// check what the modules do to it.
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import configure from '../../eleventy.config.js';
import { pageAt } from './helpers.js';
import { installDom } from './mini-dom.js';

const require = createRequire(import.meta.url);
const nunjucks = createRequire(require.resolve('@11ty/eleventy'))('nunjucks');
const site = inject('builtSite');

// The video components rendered with a playable video. AbCdEfGhIjK is not a
// real video ID.
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
const videos = [
  {
    page: { fileSlug: 'full' },
    data: { title: 'Settling your body', youtube_id: 'AbCdEfGhIjK', duration: '6:40', handout: 'full.pdf' },
    rawInput: 'Words.',
    templateContent: '<p>Words.</p>\n',
  },
];
const videoPage = env.renderString(
  '<!doctype html><html lang="en-AU"><head><title>T</title></head><body><main><h1>A page</h1>' +
    '{% from "partials/video.njk" import videoEmbed %}{% from "partials/formats.njk" import formatLinks %}' +
    '{{ videoEmbed(v) }}{{ formatLinks(v) }}<a id="elsewhere" href="/about/">Elsewhere</a></main></body></html>',
  { v: filters.videoById('full', videos) },
);

let dom;

/** Install `html` as the page and run the modules on it, freshly imported. */
async function load(html, modules, options) {
  dom = installDom(html, options);
  vi.resetModules();
  const loaded = [];
  for (const name of modules) loaded.push(await import(`../../src/js/${name}.js`));
  return loaded;
}

/** Let promise callbacks (the API loader's .then) run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  dom?.restore();
  dom = undefined;
  vi.useRealTimers();
});

describe('players.js', () => {
  // A stand-in for the YouTube IFrame Player API: records what it is given.
  let created;
  const fakeYouTube = (document) => {
    created = [];
    return {
      PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 },
      Player: class {
        constructor(target, options) {
          this.options = options;
          this.iframe = document.createElement('iframe');
          target.replaceWith(this.iframe);
          created.push(this);
        }

        getIframe() {
          return this.iframe;
        }

        playVideo() {}

        getPlayerState() {
          return -1;
        }

        destroy() {}
      },
    };
  };
  const scripts = () => dom.document.querySelectorAll('script');
  const youTubeUrls = () =>
    dom.document
      .querySelectorAll('[src], [href]')
      .map((el) => el.getAttribute('src') ?? el.getAttribute('href'))
      .filter((url) => /youtube|ytimg/.test(url) && !url.startsWith('https://www.youtube.com/watch?v='));

  it('contacts nothing on load: the facade becomes a "Play video" button, still described by the notice', async () => {
    await load(videoPage, ['players']);
    const { document, window } = dom;
    expect(scripts()).toEqual([]);
    expect(youTubeUrls()).toEqual([]);
    expect(window.YT).toBeUndefined();
    expect(document.querySelector('a.video__facade')).toBeNull();
    const button = document.querySelector('button.video__facade');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.textContent.replace(/\s+/g, ' ').trim()).toBe('Play video: Settling your body 6:40, 6 minutes 40 seconds');
    expect(button.getAttribute('aria-describedby')).toBe('video-notice-full');
    expect(document.getElementById('video-notice-full').textContent).toMatch(/^Pressing play loads this video from YouTube \(Google\)\./);
  });

  it('loads the IFrame API only when play is pressed, once, and creates the player on the privacy-enhanced host', async () => {
    await load(videoPage, ['players']);
    const { document, window } = dom;
    const button = document.querySelector('button.video__facade');
    button.focus();
    button.click();
    button.click(); // a second press while loading does nothing
    expect(scripts().map((s) => [s.getAttribute('src'), s.async])).toEqual([['https://www.youtube.com/iframe_api', true]]);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.querySelector('.video__status[role="status"]').textContent).toBe('Loading video…');

    window.YT = fakeYouTube(document);
    window.onYouTubeIframeAPIReady();
    await settle();
    expect(created).toHaveLength(1);
    const { host, videoId, playerVars } = created[0].options;
    // SPEC §9.1: captions on by default, in English.
    expect({ host, videoId, playerVars }).toEqual({
      host: 'https://www.youtube-nocookie.com',
      videoId: 'AbCdEfGhIjK',
      playerVars: { rel: 0, playsinline: 1, autoplay: 1, cc_load_policy: 1, cc_lang_pref: 'en' },
    });

    created[0].options.events.onReady();
    const iframe = created[0].iframe;
    expect(iframe.title).toBe('Settling your body');
    expect(document.querySelector('.video__facade, .video__status')).toBeNull();
    expect(document.activeElement).toBe(iframe);
    // The notice stays under the player.
    expect(document.getElementById('video-notice-full')).not.toBeNull();
  });

  it('leaves focus alone if the visitor moved on while the player loaded', async () => {
    await load(videoPage, ['players']);
    const { document, window } = dom;
    const button = document.querySelector('button.video__facade');
    button.focus();
    button.click();
    const elsewhere = document.getElementById('elsewhere');
    elsewhere.focus();
    window.YT = fakeYouTube(document);
    window.onYouTubeIframeAPIReady();
    await settle();
    created[0].options.events.onReady();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('says the video couldn\'t load, with the YouTube link, if the API script fails', async () => {
    await load(videoPage, ['players']);
    const { document } = dom;
    const button = document.querySelector('button.video__facade');
    button.focus();
    button.click();
    scripts()[0].dispatchEvent(new Event('error'));
    await settle();
    const message = document.querySelector('.video__error');
    expect(message.getAttribute('role')).toBe('alert');
    expect(message.textContent).toBe("The video couldn't load here. Watch on YouTube");
    const link = message.querySelector('a');
    expect([link.getAttribute('href'), link.getAttribute('rel')]).toEqual(['https://www.youtube.com/watch?v=AbCdEfGhIjK', 'noreferrer']);
    expect(document.activeElement).toBe(link);
  });

  it('opens the transcript from the notice link and reports it and handout clicks only as DOM events (M3 sends them)', async () => {
    await load(videoPage, ['players']);
    const { document } = dom;
    const reported = [];
    document.addEventListener('sleepsteps:event', (event) => reported.push(event.detail));
    const details = document.getElementById('transcript-full');
    expect(details.open).toBe(false);
    expect(details.querySelector('.transcript__print').hidden).toBe(false);

    const link = document.querySelector('.video__notice a[href="#transcript-full"]');
    const click = new Event('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(details.querySelector('summary'));

    document.querySelector('a[data-handout]').click();
    expect(reported).toEqual([
      { type: 'transcript_open', detail: { media: 'full' } },
      { type: 'handout_open', detail: { media: 'full' } }, // the video_id, not full.pdf (SPEC §10.2)
    ]);
    expect(scripts()).toEqual([]);
  });

  it('prints the transcript with its source as the page title and address, without the site name (SPEC §9.3, §7.5)', async () => {
    await load(videoPage, ['players']);
    const { document, window } = dom;
    document.querySelector('#transcript-full .transcript__print').click();
    expect(window.printed).toBe(1);
    const sheet = document.querySelector('.print-sheet');
    expect(sheet.querySelector('.print-sheet__title').textContent).toBe('Transcript: Settling your body');
    expect(sheet.querySelector('.print-sheet__source').textContent).toBe('From “A page”: https://sleepsteps.test/page/');
    expect(sheet.querySelector('.transcript__body').textContent).toContain('Words.');
    expect(document.documentElement.hasAttribute('data-printing')).toBe(true);

    window.dispatchEvent(new Event('afterprint'));
    expect(document.querySelector('.print-sheet')).toBe(null);
    expect(document.documentElement.hasAttribute('data-printing')).toBe(false);
  });

  it('reports audio only once it has played: seeking while paused is not a play (SPEC §9.4)', async () => {
    await load(
      '<!doctype html><html lang="en-AU"><head><title>T</title></head><body><main><h1>A page</h1>' +
        '<audio controls preload="none" src="/media/audio/talk.mp3" data-media="talk.mp3"></audio></main></body></html>',
      ['players'],
    );
    const { document, window } = dom;
    const reported = [];
    document.addEventListener('sleepsteps:event', (event) => reported.push(event.detail));
    const audio = document.querySelector('audio');
    Object.assign(audio, { duration: 100, currentTime: 60 });

    audio.dispatchEvent(new Event('timeupdate'));
    window.dispatchEvent(new Event('pagehide'));
    expect(reported).toEqual([]);

    audio.paused = false;
    audio.dispatchEvent(new Event('play'));
    audio.currentTime = 80;
    audio.dispatchEvent(new Event('timeupdate'));
    window.dispatchEvent(new Event('pagehide'));
    expect(reported).toEqual([{ type: 'audio_play', detail: { media: 'talk.mp3', furthest: 75 } }]);
  });
});

describe('solutions.js on /problems/cant-get-back-to-sleep/ (3 main, 3 extra)', () => {
  const html = pageAt(site, '/problems/cant-get-back-to-sleep/');
  const cards = () => dom.document.querySelectorAll('.solution');
  const face = (card) => card.querySelector('.solution__face');
  const panel = (card) => card.querySelector('.solution__panel');

  it('turns each card into an h3 button that controls a labelled region, all closed', async () => {
    await load(html, ['players', 'solutions']);
    const { document } = dom;
    expect(document.querySelectorAll('details.solution__disclosure')).toEqual([]);
    expect(cards()).toHaveLength(6);
    for (const card of cards()) {
      const button = face(card);
      const id = card.id;
      expect(button.localName).toBe('button');
      expect(button.parentElement.localName).toBe('h3');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(button.getAttribute('aria-controls')).toBe(`${id}-panel`);
      expect(button.getAttribute('aria-describedby')).toBe(`${id}-blurb ${id}-length`);
      expect(panel(card).id).toBe(`${id}-panel`);
      expect(panel(card).hidden).toBe(true);
      expect(panel(card).getAttribute('role')).toBe('region');
      expect(panel(card).getAttribute('aria-labelledby')).toBe(`${id}-heading`);
      expect(card.querySelector('.solution__header').hidden).toBe(false);
    }
  });

  it('opens one card at a time across both sections, moving focus to its heading; Close returns it', async () => {
    await load(html, ['players', 'solutions']);
    const { document } = dom;
    const [first, , , firstExtra] = cards();
    expect(firstExtra.classList.contains('solution--extra')).toBe(true);

    face(first).click();
    expect(face(first).getAttribute('aria-expanded')).toBe('true');
    expect(panel(first).hidden).toBe(false);
    expect(first.classList.contains('is-open')).toBe(true);
    expect(document.activeElement).toBe(first.querySelector('.solution__heading'));

    face(firstExtra).click();
    expect(face(first).getAttribute('aria-expanded')).toBe('false');
    expect(panel(first).hidden).toBe(true);
    expect(face(firstExtra).getAttribute('aria-expanded')).toBe('true');
    expect(cards().filter((c) => c.classList.contains('is-open'))).toEqual([firstExtra]);

    firstExtra.querySelector('.solution__close').click();
    expect(face(firstExtra).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(face(firstExtra));
  });

  it('keeps focus on the card button on phones, where the panel header is not shown', async () => {
    await load(html, ['players', 'solutions']);
    const { document } = dom;
    document.isRendered = (el) => !el.classList.contains('solution__header');
    const [first] = cards();
    face(first).focus();
    face(first).click();
    expect(face(first).getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(face(first));
  });
});

// A stand-alone problem (SPEC §7.2) loads players.js but not solutions.js:
// its one video, with its formats, is the page.
describe('players.js on a stand-alone problem, /problems/sharing-a-bed/', () => {
  const html = pageAt(site, '/problems/sharing-a-bed/');

  it('opens the transcript from the notice link and reports it with the problem video, with no cards to open', async () => {
    await load(html, ['players']);
    const { document } = dom;
    expect(document.querySelectorAll('.solution')).toEqual([]);
    const reported = [];
    document.addEventListener('sleepsteps:event', (event) => reported.push(event.detail));
    const details = document.getElementById('transcript-sharing-a-bed-about');
    expect(details.open).toBe(false);
    expect(details.querySelector('.transcript__print').hidden).toBe(false);

    const link = document.querySelector('.video__notice a[href="#transcript-sharing-a-bed-about"]');
    const click = new Event('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(details.querySelector('summary'));

    document.querySelector('a[data-handout]').click();
    expect(reported).toEqual([
      { type: 'transcript_open', detail: { media: 'sharing-a-bed-about' } },
      { type: 'handout_open', detail: { media: 'sharing-a-bed-about' } },
    ]);
  });
});

describe('problems.js on /problems/', () => {
  const html = pageAt(site, '/problems/');
  const areaSections = () => dom.document.querySelectorAll('section.area-list__area');
  const button = (section) => section.querySelector('button.area-list__header');
  const visibleItems = (section) => section.querySelectorAll('li[data-slug]').filter((li) => !li.hidden);
  const typeQuery = (value) => {
    const input = dom.document.getElementById('problem-filter');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('shows the toolbar and its lede sentence, and makes each area a button with only the first open', async () => {
    await load(html, ['problems']);
    const { document } = dom;
    expect(document.querySelector('[data-problems-tools]').hidden).toBe(false);
    expect(document.querySelector('[data-problems-hint]').hidden).toBe(false);
    const sections = areaSections();
    expect(sections).toHaveLength(10);
    sections.forEach((section, i) => {
      const list = section.querySelector('[data-area-list]');
      expect(button(section).getAttribute('aria-controls')).toBe(list.id);
      expect(button(section).getAttribute('aria-expanded')).toBe(String(i === 0));
      expect(list.hidden).toBe(i !== 0);
    });
    expect(document.querySelector('[data-view-panel="time"]').hidden).toBe(true);

    button(sections[1]).click();
    expect(button(sections[1]).getAttribute('aria-expanded')).toBe('true');
    expect(sections[1].querySelector('[data-area-list]').hidden).toBe(false);
  });

  it('opens the area named in the URL instead of the first', async () => {
    await load(html, ['problems'], { hash: '#mind' });
    const open = areaSections().filter((s) => button(s).getAttribute('aria-expanded') === 'true');
    expect(open.map((s) => s.id)).toEqual(['mind']);
  });

  it('filters as you type: hides areas without matches, opens the rest, and announces the count once typing pauses', async () => {
    const [{ STATUS_DELAY }] = await load(html, ['problems']);
    const { document } = dom;
    const status = document.querySelector('[data-filter-status]');
    const before = status.textContent;

    typeQuery('night');
    const shown = areaSections().filter((s) => !s.hidden);
    const matched = shown.flatMap(visibleItems);
    expect(matched.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(10);
    for (const section of areaSections()) {
      const items = visibleItems(section);
      expect(section.hidden).toBe(items.length === 0);
      if (items.length) {
        expect(button(section).getAttribute('aria-expanded')).toBe('true');
        const total = section.querySelectorAll('li[data-slug]').length;
        expect(section.querySelector('[data-area-count]').textContent).toBe(`${items.length} of ${total}`);
      }
      const areaName = section.querySelector('[data-area-name]').textContent;
      for (const li of items) expect(`${li.textContent} ${areaName} ${li.dataset.keywords ?? ''}`.toLowerCase()).toContain('night');
    }
    expect(status.textContent).toBe(before); // not on every keystroke
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe(`${matched.length} topics match “night”`);

    // Clearing it puts the areas back as they were: only the first open.
    typeQuery('');
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(status.textContent).toBe(before);
    expect(areaSections().filter((s) => s.hidden)).toEqual([]);
    expect(areaSections().map((s) => button(s).getAttribute('aria-expanded'))).toEqual(['true', ...Array(9).fill('false')]);
  });

  it('says so when nothing matches, keeping every topic in view', async () => {
    const [{ STATUS_DELAY, NO_MATCH }] = await load(html, ['problems']);
    typeQuery('zzzz');
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(dom.document.querySelector('[data-filter-status]').textContent).toBe(NO_MATCH.area);
    expect(areaSections().filter((s) => s.hidden)).toEqual([]);
  });

  it('switches to the "When it happens" lanes and back', async () => {
    await load(html, ['problems']);
    const { document } = dom;
    document.getElementById('view-time').click();
    expect(document.querySelector('[data-view-panel="time"]').hidden).toBe(false);
    expect(document.querySelector('[data-view-panel="area"]').hidden).toBe(true);
    expect(document.querySelector('[data-toggle-all]').hidden).toBe(true);
    document.getElementById('view-area').click();
    expect(document.querySelector('[data-view-panel="area"]').hidden).toBe(false);
  });
});
