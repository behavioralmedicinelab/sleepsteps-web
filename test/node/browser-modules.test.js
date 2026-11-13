// The browser modules run against our real markup in a small DOM
// (mini-dom.js; no DOM package, SPEC §5): players.js (SPEC §9.1-§9.4,
// §16.2), solutions.js (HANDOFF §6.4, SPEC §7.5) and problems.js (SPEC §7.2,
// §8.1). The other tests check the HTML these modules start from; these
// check what the modules do to it.
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import configure from '../../eleventy.config.js';
import { pageAt, videoRow } from './helpers.js';
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
  videoRow('full', { title: 'Settling your body', youtube_url: 'https://youtu.be/AbCdEfGhIjK', duration: '6:40', handout: 'full.pdf', audio: 'full.mp3' }),
];
const videoPage = env.renderString(
  '<!doctype html><html lang="en-AU"><head><title>T</title></head><body><main><h1>A page</h1>' +
    '{% from "partials/video-block.njk" import videoBlock %}' +
    '{% from "notices/video.njk" import youtubeNote %}' +
    '{{ videoBlock(v) }}<a id="elsewhere" href="/about/">Elsewhere</a>{{ youtubeNote() }}</main></body></html>',
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

        destroy() {
          this.destroyed = true;
        }
      },
    };
  };
  const scripts = () => dom.document.querySelectorAll('script');
  const youTubeUrls = () =>
    dom.document
      .querySelectorAll('[src], [href]')
      .map((el) => el.getAttribute('src') ?? el.getAttribute('href'))
      .filter((url) => /youtube|ytimg/.test(url) && !url.startsWith('https://www.youtube.com/watch?v='));

  it('contacts nothing on load: the facade becomes a "Play video" button, still described by the page\'s YouTube note', async () => {
    await load(videoPage, ['players']);
    const { document, window } = dom;
    expect(scripts()).toEqual([]);
    expect(youTubeUrls()).toEqual([]);
    expect(window.YT).toBeUndefined();
    expect(document.querySelector('a.video__facade')).toBeNull();
    const button = document.querySelector('button.video__facade');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.textContent.replace(/\s+/g, ' ').trim()).toBe('Play video: Settling your body 6:40, 6 minutes 40 seconds');
    expect(button.getAttribute('aria-describedby')).toBe('youtube-note-text');
    expect(document.getElementById('youtube-note-text').textContent).toMatch(/^Pressing play on a video loads it from YouTube \(Google\)\./);
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
    // The page's note stays where it is.
    expect(document.getElementById('youtube-note-text')).not.toBeNull();
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

  // SPEC §9.1, §11: the player fails over to the YouTube link when the API
  // takes over 15 seconds, the player reports an error, or it is never ready.
  const LOAD_TIMEOUT_MS = 15000;
  const errorShown = () => {
    const message = dom.document.querySelector('.video__error');
    if (!message) return null;
    const link = message.querySelector('a');
    return {
      role: message.getAttribute('role'),
      text: message.textContent,
      href: link.getAttribute('href'),
      focused: dom.document.activeElement === link,
    };
  };
  const SHOWN = {
    role: 'alert',
    text: "The video couldn't load here. Watch on YouTube",
    href: 'https://www.youtube.com/watch?v=AbCdEfGhIjK',
    focused: true,
  };

  it('says the video couldn\'t load, and focuses the link, when the IFrame API neither loads nor fails within 15 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await load(videoPage, ['players']);
    const button = dom.document.querySelector('button.video__facade');
    button.focus();
    button.click();
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    expect(errorShown()).toBeNull();
    expect(dom.document.querySelector('.video__status').textContent).toBe('Loading video…');
    await vi.advanceTimersByTimeAsync(1);
    expect(errorShown()).toEqual(SHOWN);
    expect(dom.document.querySelector('.video__status, .video__facade')).toBeNull();
    expect(dom.document.querySelector('.video').classList.contains('is-loading')).toBe(false);
    // The API arriving afterwards changes nothing.
    dom.window.YT = fakeYouTube(dom.document);
    dom.window.onYouTubeIframeAPIReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toEqual([]);
    expect(errorShown()).toEqual(SHOWN);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('says the video couldn\'t load, and destroys the player, when the player reports an error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await load(videoPage, ['players']);
    const button = dom.document.querySelector('button.video__facade');
    button.focus();
    button.click();
    dom.window.YT = fakeYouTube(dom.document);
    dom.window.onYouTubeIframeAPIReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toHaveLength(1);
    created[0].options.events.onError({ data: 150 }); // e.g. embedding not allowed
    expect(errorShown()).toEqual(SHOWN);
    expect(created[0].destroyed).toBe(true);
    expect(dom.document.querySelector('iframe')).toBeNull();
    // Its readiness timer is cleared with it.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up on a player that is never ready after 15 seconds, and destroys it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await load(videoPage, ['players']);
    const button = dom.document.querySelector('button.video__facade');
    button.focus();
    button.click();
    dom.window.YT = fakeYouTube(dom.document);
    dom.window.onYouTubeIframeAPIReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    expect(errorShown()).toBeNull();
    expect(created[0].destroyed).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(errorShown()).toEqual(SHOWN);
    expect(created[0].destroyed).toBe(true);
    expect(dom.document.querySelector('iframe')).toBeNull();
  });

  it('leaves focus where the visitor moved it when a video fails', async () => {
    await load(videoPage, ['players']);
    const button = dom.document.querySelector('button.video__facade');
    button.focus();
    button.click();
    const elsewhere = dom.document.getElementById('elsewhere');
    elsewhere.focus();
    scripts()[0].dispatchEvent(new Event('error'));
    await settle();
    expect(errorShown()).toEqual({ ...SHOWN, focused: false });
    expect(dom.document.activeElement).toBe(elsewhere);
  });

  it('loads the IFrame API again when another video\'s play is pressed after a failure', async () => {
    const two = videoPage.replace(
      '<a id="elsewhere"',
      env.renderString('{% from "partials/video.njk" import videoEmbed %}{{ videoEmbed(v) }}', {
        v: { ...filters.videoById('full', videos), video_id: 'second', youtube_id: 'ZyXwVuTsRqP', title: 'Second' },
      }) + '<a id="elsewhere"',
    );
    await load(two, ['players']);
    const [first, second] = dom.document.querySelectorAll('button.video__facade');
    first.click();
    expect(scripts()).toHaveLength(1);
    scripts()[0].dispatchEvent(new Event('error'));
    await settle();
    expect(dom.document.querySelectorAll('.video__error')).toHaveLength(1);
    second.click();
    // A fresh script element: the failed load isn't reused.
    expect(scripts().map((s) => s.getAttribute('src'))).toEqual(['https://www.youtube.com/iframe_api', 'https://www.youtube.com/iframe_api']);
    dom.window.YT = fakeYouTube(dom.document);
    dom.window.onYouTubeIframeAPIReady();
    await settle();
    expect(created.map((p) => p.options.videoId)).toEqual(['ZyXwVuTsRqP']);
  });

  it('reports clicks on the row\'s handout only as DOM events (events.js sends them), and lets the link open', async () => {
    await load(videoPage, ['players']);
    const { document } = dom;
    const reported = [];
    document.addEventListener('sleepsteps:event', (event) => reported.push(event.detail));
    // The row's "Handout" is the only handout link (the notice has none,
    // SPEC §15.1).
    expect(document.querySelectorAll('a[data-handout]').map((a) => a.className)).toEqual(['format-button']);
    const handout = document.querySelector('.video-controls a.format-button');
    expect(handout.getAttribute('href')).toBe('/media/pdf/full.pdf');
    const click = new Event('click', { bubbles: true, cancelable: true });
    handout.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    // The note's privacy link, and other links, report nothing.
    document.querySelector('.youtube-note a').click();
    document.getElementById('elsewhere').click();
    expect(reported).toEqual([
      { type: 'handout_open', detail: { media: 'full' } }, // the video_id, not full.pdf (SPEC §10.2)
    ]);
    expect(scripts()).toEqual([]);
  });

  // A worksheet link is handled exactly as the handout link is (SPEC §7.6,
  // §9.4): any click inside an <a href> marked data-worksheet is reported
  // once, with the worksheet_id, and the link still opens.
  it('reports clicks on a worksheet link only as DOM events, with the worksheet_id, and lets the link open', async () => {
    await load(
      videoPage.replace(
        '<a id="elsewhere"',
        '<section class="worksheets"><ul role="list">' +
          '<li><a class="format-button" id="sheet" href="/media/worksheets/File Name.pdf" type="application/pdf" data-worksheet="settling-worksheet-1">' +
          '<svg class="format-button__icon" id="sheet-icon"></svg>A worksheet<span class="visually-hidden" id="sheet-format"> (PDF)</span></a></li>' +
          // Not a link, an empty id, and no href: none is a worksheet to open.
          '<li><button type="button" id="not-a-link" data-worksheet="settling-worksheet-2">B</button></li>' +
          '<li><a id="empty" href="/media/worksheets/c.pdf" data-worksheet="">C</a></li>' +
          '<li><a id="no-href" data-worksheet="settling-worksheet-3">D</a></li>' +
          '<li><a id="unmarked" href="/media/worksheets/e.pdf">E</a></li>' +
          '</ul></section><a id="elsewhere"',
      ),
      ['players'],
    );
    const { document } = dom;
    const reported = [];
    document.addEventListener('sleepsteps:event', (event) => reported.push(event.detail));
    const press = (id) => {
      const click = new Event('click', { bubbles: true, cancelable: true });
      document.getElementById(id).dispatchEvent(click);
      return click.defaultPrevented;
    };
    // The link itself, its icon and its hidden "(PDF)": one report each, by id, never the file name.
    expect([press('sheet'), press('sheet-icon'), press('sheet-format')]).toEqual([false, false, false]);
    expect(reported).toEqual([1, 2, 3].map(() => ({ type: 'worksheet_open', detail: { worksheet: 'settling-worksheet-1' } })));
    for (const id of ['not-a-link', 'empty', 'no-href', 'unmarked', 'elsewhere']) expect(press(id), id).toBe(false);
    expect(reported).toHaveLength(3);
    // The handout beside it is still a handout_open, and nothing else.
    document.querySelector('.video-controls a[data-handout]').click();
    expect(reported.slice(3)).toEqual([{ type: 'handout_open', detail: { media: 'full' } }]);
    // players.js sends and stores nothing itself.
    expect(scripts()).toEqual([]);
  });

  it('has no transcripts to open, print or report (SPEC §9.3): nothing but the native "Audio only" disclosure', async () => {
    await load(videoPage, ['players'], { hash: '#transcript-full' });
    const { document, window } = dom;
    const reported = [];
    document.addEventListener('sleepsteps:event', (event) => reported.push(event.detail));
    expect(document.querySelectorAll('details').map((d) => d.id)).toEqual(['audio-full']);
    const audio = document.getElementById('audio-full');
    expect(audio.open).toBe(false);
    audio.open = true;
    audio.dispatchEvent(new Event('toggle'));
    window.dispatchEvent(new Event('hashchange'));
    expect(reported).toEqual([]);
    expect(window.printed).toBeUndefined();
    expect(document.querySelector('.print-sheet, .transcript__print, [data-transcript]')).toBeNull();
  });

  it('reports audio only once it has played: seeking while paused is not a play (SPEC §9.4)', async () => {
    await load(
      '<!doctype html><html lang="en-AU"><head><title>T</title></head><body><main><h1>A page</h1>' +
        '<audio controls preload="none" src="/media/audio/talk.mp3" data-media="a-talk"></audio></main></body></html>',
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
    expect(reported).toEqual([{ type: 'audio_play', detail: { media: 'a-talk', furthest: 75 } }]);
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
      // Labelled by the video template's title, whose header is now shown.
      expect(panel(card).getAttribute('aria-labelledby')).toBe(`video-${id.replace(/^solution-/, '')}-title`);
      expect(card.querySelector('.video-block__header').hidden).toBe(false);
    }
  });

  it('opens one card at a time across both sections, moving focus to its title; Close returns it', async () => {
    await load(html, ['players', 'solutions']);
    const { document } = dom;
    const [first, , , firstExtra] = cards();
    expect(firstExtra.classList.contains('solution--extra')).toBe(true);

    face(first).click();
    expect(face(first).getAttribute('aria-expanded')).toBe('true');
    expect(panel(first).hidden).toBe(false);
    expect(first.classList.contains('is-open')).toBe(true);
    expect(document.activeElement).toBe(first.querySelector('.video-block__title'));

    face(firstExtra).click();
    expect(face(first).getAttribute('aria-expanded')).toBe('false');
    expect(panel(first).hidden).toBe(true);
    expect(face(firstExtra).getAttribute('aria-expanded')).toBe('true');
    expect(cards().filter((c) => c.classList.contains('is-open'))).toEqual([firstExtra]);

    firstExtra.querySelector('.video-block__close').click();
    expect(face(firstExtra).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(face(firstExtra));
  });

  // The worksheets of an open card (SPEC §7.6) are the page's only links
  // marked data-worksheet; players.js reports each click, open card or not
  // (without JavaScript nothing is reported: the links are plain links).
  it('reports a click on each worksheet link of a card as a worksheet_open with its worksheet_id, and nothing for the card\'s other controls', async () => {
    await load(html, ['players', 'solutions']);
    const { document } = dom;
    const reported = [];
    document.addEventListener('sleepsteps:event', (event) => reported.push(event.detail));
    const withSheets = cards().filter((card) => card.querySelector('.worksheets'));
    const links = document.querySelectorAll('[data-worksheet]');
    expect(links.length).toBeGreaterThanOrEqual(withSheets.length);
    // Nothing to click while none of this page's solution videos has a
    // worksheet in data/worksheets.csv (a valid file, SPEC §7.6): then no
    // element is marked at all.
    expect(links.length > 0).toBe(withSheets.length > 0);
    if (withSheets.length === 0) return;
    // Every one is in a card's worksheets section, under its video template.
    expect(links).toEqual(withSheets.flatMap((card) => card.querySelectorAll('.solution__panel > .worksheets a.format-button')));
    const [first] = withSheets;
    face(first).click();
    first.querySelector('.video-block__close').click();
    expect(reported).toEqual([]);
    face(first).click();
    for (const link of first.querySelectorAll('.worksheets a')) {
      const click = new Event('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(false);
      expect(link.getAttribute('href')).toMatch(/^\/media\/worksheets\/[^/]+\.pdf$/i);
    }
    expect(reported).toEqual(first.querySelectorAll('.worksheets a').map((a) => ({ type: 'worksheet_open', detail: { worksheet: a.dataset.worksheet } })));
    expect(reported.length).toBeGreaterThan(0);
    for (const { detail } of reported) expect(detail.worksheet).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    // The card stays open, and focus is not moved.
    expect(face(first).getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps focus on the card button should the title not be rendered', async () => {
    await load(html, ['players', 'solutions']);
    const { document } = dom;
    document.isRendered = (el) => !el.classList.contains('video-block__header');
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

  it('reports the problem video\'s handout clicks, from the row, with no cards or transcripts to open', async () => {
    await load(html, ['players']);
    const { document } = dom;
    expect(document.querySelectorAll('.solution')).toEqual([]);
    expect(document.querySelectorAll('main details').map((d) => d.id)).toEqual(['audio-sharing-a-bed-about']);
    expect(document.querySelector('[data-transcript], .transcript__print')).toBeNull();
    const reported = [];
    document.addEventListener('sleepsteps:event', (event) => reported.push(event.detail));

    expect(document.querySelector('.youtube-note a[data-handout]')).toBeNull();
    const handout = document.querySelector('.video-controls a[data-handout]');
    const click = new Event('click', { bubbles: true, cancelable: true });
    handout.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(reported).toEqual([{ type: 'handout_open', detail: { media: 'sharing-a-bed-about' } }]);
    // No solution cards, so no worksheet to open or report (SPEC §7.6).
    expect(document.querySelectorAll('[data-worksheet]')).toEqual([]);
  });
});

// Home holds the list of sleep problems (project lead, 2026-11-13; it was
// the Sleep problems page, /problems/).
describe('problems.js on Home (/)', () => {
  const html = pageAt(site, '/');
  const areaSections = () => dom.document.querySelectorAll('[data-problems] section.group-list__group');
  const button = (section) => section.querySelector('button.group-list__header');
  const expanded = () => areaSections().map((s) => button(s).getAttribute('aria-expanded'));
  const visibleItems = (section) => section.querySelectorAll('li[data-slug]').filter((li) => !li.hidden);
  const typeQuery = (value) => {
    const input = dom.document.getElementById('problem-filter');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  /** Each area: its name, whether it is hidden or open, and its count. */
  const pageState = () =>
    areaSections().map((s) => [
      s.querySelector('[data-group-name]').textContent,
      s.hidden,
      button(s).getAttribute('aria-expanded'),
      s.querySelector('[data-group-list]').hidden,
      s.querySelector('[data-group-count]').textContent,
    ]);
  /** Check the page is narrowed: only areas with a match show, each open, counting "n of total". Returns the shown slugs. */
  const expectNarrowed = () => {
    for (const section of areaSections()) {
      const items = visibleItems(section);
      expect(section.hidden).toBe(items.length === 0);
      if (items.length === 0) continue;
      expect(button(section).getAttribute('aria-expanded')).toBe('true');
      expect(section.querySelector('[data-group-list]').hidden).toBe(false);
      const total = section.querySelectorAll('li[data-slug]').length;
      expect(section.querySelector('[data-group-count]').textContent).toBe(`${items.length} of ${total}`);
    }
    return areaSections()
      .filter((s) => !s.hidden)
      .flatMap(visibleItems)
      .map((li) => li.dataset.slug)
      .sort();
  };

  // The page with an area that has no topics yet, second in the list: a
  // copy of the first area, renamed, with its list emptied.
  const withEmptyArea = (source) => {
    const first = source.indexOf('<section class="group-list__group"');
    expect(first).toBeGreaterThan(-1);
    const end = source.indexOf('</section>', first) + '</section>'.length;
    const empty = source
      .slice(first, end)
      .replace(/^<section([^>]*?) id="[^"]*"/, '<section$1 id="empty"')
      .replace(/(data-group-name>)[^<]*/, '$1Nothing here yet')
      .replace(/data-total="\d+">\d+</, 'data-total="0">0<')
      .replace(/(group-list__count-unit">) topics?/, '$1 topics')
      .replace(/(<ul\b[^>]*\bid=")[^"]*("[^>]*>)[\s\S]*<\/ul>/, '$1area-empty-problems$2</ul>');
    expect(empty).not.toContain('<li');
    const second = source.indexOf('<section', end);
    return source.slice(0, second) + empty + source.slice(second);
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('shows the toolbar (the filter alone: no view toggle, no "Open all areas") and its lede sentence', async () => {
    await load(html, ['problems']);
    const { document } = dom;
    const tools = document.querySelector('[data-problems-tools]');
    expect(tools.hidden).toBe(false);
    expect(document.querySelector('[data-problems-hint]').hidden).toBe(false);
    expect(tools.querySelectorAll('button')).toHaveLength(0);
    expect(document.querySelector('[data-toggle-all]')).toBeNull();
    expect(tools.querySelectorAll('input').map((i) => i.id)).toEqual(['problem-filter']);
    expect(document.querySelectorAll('main fieldset, main input[type="radio"]')).toHaveLength(0);
  });

  it('makes every area a button, all closed (project lead, 2026-11-07)', async () => {
    await load(html, ['problems']);
    const sections = areaSections();
    expect(sections).toHaveLength(10);
    for (const section of sections) {
      const list = section.querySelector('[data-group-list]');
      const header = button(section);
      expect(header.parentNode.tagName.toLowerCase()).toBe('h3');
      expect(header.getAttribute('type')).toBe('button');
      expect(header.getAttribute('aria-controls')).toBe(list.id);
      expect(header.getAttribute('aria-expanded')).toBe('false');
      expect(list.hidden).toBe(true);
      expect(section.hidden).toBe(false);
      expect(section.querySelector('span.group-list__header')).toBeNull();
    }
    expect(dom.document.querySelector('[data-problems]').classList.contains('is-enhanced')).toBe(true);

    const second = sections[1];
    button(second).click();
    expect(button(second).getAttribute('aria-expanded')).toBe('true');
    expect(second.querySelector('[data-group-list]').hidden).toBe(false);
    button(second).click();
    expect(button(second).getAttribute('aria-expanded')).toBe('false');
    expect(second.querySelector('[data-group-list]').hidden).toBe(true);
  });

  it('opens only the area named in the URL', async () => {
    await load(html, ['problems'], { hash: '#mind' });
    const open = areaSections().filter((s) => button(s).getAttribute('aria-expanded') === 'true');
    expect(open.map((s) => s.id)).toEqual(['mind']);
    expect(expanded().filter((value) => value === 'false')).toHaveLength(9);
  });

  // Links from other pages arrive at /#sleep-problems (the section) or at
  // /#<area_id> (an area in it); the skip link is #main.
  it.each(['#sleep-problems', '#main', '#nowhere'])('leaves every area closed when the URL names %s, on load and on hashchange', async (hash) => {
    await load(html, ['problems'], { hash });
    expect(expanded()).toEqual(Array(10).fill('false'));
    expect(dom.document.querySelector('[data-problems-tools]').hidden).toBe(false);
    button(areaSections()[0]).click();
    dom.window.dispatchEvent(new Event('hashchange'));
    expect(expanded()).toEqual(['true', ...Array(9).fill('false')]);
    expect(dom.document.getElementById('sleep-problems').hidden).toBe(false);
  });

  it('leaves the rest of Home as it was: the hero, the trial band and the disclaimer', async () => {
    const before = installDom(html);
    const outside = (document) => ['.home-hero', '.home-trial', '.home-disclaimer'].map((selector) => document.querySelector(selector).textContent);
    const expected = outside(before.document);
    before.restore();
    await load(html, ['problems']);
    expect(outside(dom.document)).toEqual(expected);
    expect(dom.document.querySelectorAll('main button').every((b) => b.closest('#sleep-problems') !== null)).toBe(true);
  });

  it('filters as you type: hides areas without matches, opens the rest, and announces the count once typing pauses', async () => {
    const [{ STATUS_DELAY }] = await load(html, ['problems']);
    const { document } = dom;
    const status = document.querySelector('[data-filter-status]');
    const before = status.textContent;
    expect(before).toBe('36 topics in 10 areas');

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
        expect(section.querySelector('[data-group-count]').textContent).toBe(`${items.length} of ${total}`);
      }
      const areaName = section.querySelector('[data-group-name]').textContent;
      for (const li of items) expect(`${li.textContent} ${areaName} ${li.dataset.keywords ?? ''}`.toLowerCase()).toContain('night');
    }
    expect(status.textContent).toBe(before); // not on every keystroke
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe(`${matched.length} topics match “night”`);

    // Clearing it puts the areas back as they were: all closed.
    typeQuery('');
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(status.textContent).toBe(before);
    expect(areaSections().filter((s) => s.hidden)).toEqual([]);
    expect(expanded()).toEqual(Array(10).fill('false'));
  });

  it('puts the areas back as they were when the field is cleared: one opened by hand stays open, the rest close', async () => {
    const [{ STATUS_DELAY }] = await load(html, ['problems']);
    const status = dom.document.querySelector('[data-filter-status]');
    button(areaSections()[2]).click(); // open the third area by hand

    typeQuery('3am');
    const matched = expectNarrowed();
    expect(matched.length).toBeGreaterThan(0);
    const shown = areaSections().filter((s) => !s.hidden);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(10);
    vi.advanceTimersByTime(STATUS_DELAY);
    const n = matched.length;
    expect(status.textContent).toBe(n === 1 ? '1 topic matches “3am”' : `${n} topics match “3am”`);

    // A second query narrows again: the state to return to is still the one
    // before the first.
    typeQuery('night');
    expect(expectNarrowed()).not.toEqual(matched);

    typeQuery('');
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(areaSections().filter((s) => s.hidden)).toEqual([]);
    expect(expanded()).toEqual(['false', 'false', 'true', 'false', 'false', 'false', 'false', 'false', 'false', 'false']);
    expect(areaSections().flatMap((s) => s.querySelectorAll('li[data-slug]')).filter((li) => li.hidden)).toEqual([]);
    expect(areaSections().map((s) => s.querySelector('[data-group-count]').textContent)).toEqual(
      areaSections().map((s) => String(s.querySelectorAll('li[data-slug]').length)),
    );
    expect(status.textContent).toBe('36 topics in 10 areas');
  });

  it('says so when nothing matches, keeping every topic in view', async () => {
    const [{ STATUS_DELAY, NO_MATCH }] = await load(html, ['problems']);
    const status = dom.document.querySelector('[data-filter-status]');
    typeQuery('zzzz');
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(NO_MATCH).toBe('Nothing matches yet. Try a different word, or open an area below.');
    expect(status.textContent).toBe(NO_MATCH);
    expect(areaSections().filter((s) => s.hidden)).toEqual([]);
    expect(areaSections().flatMap((s) => s.querySelectorAll('li[data-slug]')).filter((li) => li.hidden)).toEqual([]);
  });

  it('hides an area with no topics only while the filter narrows: cleared or with no match, the page is as on load', async () => {
    const [{ STATUS_DELAY, NO_MATCH }] = await load(withEmptyArea(html), ['problems']);
    const status = dom.document.querySelector('[data-filter-status]');
    const empty = () => areaSections()[1];
    expect(areaSections()).toHaveLength(11);
    expect(empty().querySelector('[data-group-name]').textContent).toBe('Nothing here yet');
    expect(empty().hidden).toBe(false);
    expect(empty().querySelector('[data-group-count]').textContent).toBe('0');
    expect(button(empty()).getAttribute('aria-expanded')).toBe('false');
    const onLoad = pageState();
    const asOnLoad = () => expect(pageState()).toEqual(onLoad);

    typeQuery('night');
    expect(empty().hidden).toBe(true);

    typeQuery('');
    asOnLoad();
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(status.textContent).toBe('36 topics in 11 areas');

    typeQuery('zzzz'); // never narrowed
    asOnLoad();
    typeQuery('night');
    typeQuery('nightzzzz'); // narrowed, then nothing matches
    asOnLoad();
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(status.textContent).toBe(NO_MATCH);
  });

  it('opens an area on hashchange, clearing a filter that hides it', async () => {
    const [{ STATUS_DELAY }] = await load(html, ['problems']);
    const { document, window } = dom;
    window.location.hash = '#social';
    window.dispatchEvent(new Event('hashchange'));
    const social = document.getElementById('social');
    expect(button(social).getAttribute('aria-expanded')).toBe('true');
    expect(expanded().filter((value) => value === 'true')).toHaveLength(1);

    // A filter that hides the area is cleared, so the area can show.
    button(social).click();
    typeQuery('night sweats');
    expect(expectNarrowed()).toEqual(['hot-flushes-and-night-sweats']);
    expect(social.hidden).toBe(true);
    window.dispatchEvent(new Event('hashchange'));
    expect(document.getElementById('problem-filter').value).toBe('');
    expect(social.hidden).toBe(false);
    expect(button(social).getAttribute('aria-expanded')).toBe('true');
    expect(areaSections().filter((s) => s.hidden)).toEqual([]);
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(document.querySelector('[data-filter-status]').textContent).toBe('36 topics in 10 areas');
  });
});
