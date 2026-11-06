// The browser modules run against our real markup in a small DOM
// (mini-dom.js; no DOM package, SPEC §5): players.js (SPEC §9.1-§9.4,
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
    data: { title: 'Settling your body', youtube_id: 'AbCdEfGhIjK', duration: '6:40', handout: 'full.pdf', audio: 'full.mp3' },
    rawInput: 'Words.',
    templateContent: '<p>Words.</p>\n',
  },
];
const videoPage = env.renderString(
  '<!doctype html><html lang="en-AU"><head><title>T</title></head><body><main><h1>A page</h1>' +
    '{% from "partials/video.njk" import videoEmbed %}{% from "partials/video-controls.njk" import videoControls %}' +
    '{{ videoEmbed(v) }}{{ videoControls(v) }}<a id="elsewhere" href="/about/">Elsewhere</a></main></body></html>',
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
    // The notice's privacy link, and other links, report nothing.
    document.querySelector('.video__notice a').click();
    document.getElementById('elsewhere').click();
    expect(reported).toEqual([
      { type: 'handout_open', detail: { media: 'full' } }, // the video_id, not full.pdf (SPEC §10.2)
    ]);
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

  it('reports the problem video\'s handout clicks, from the row, with no cards or transcripts to open', async () => {
    await load(html, ['players']);
    const { document } = dom;
    expect(document.querySelectorAll('.solution')).toEqual([]);
    expect(document.querySelectorAll('main details').map((d) => d.id)).toEqual(['audio-sharing-a-bed-about']);
    expect(document.querySelector('[data-transcript], .transcript__print')).toBeNull();
    const reported = [];
    document.addEventListener('sleepsteps:event', (event) => reported.push(event.detail));

    expect(document.querySelector('.video__notice a[data-handout]')).toBeNull();
    const handout = document.querySelector('.video-controls a[data-handout]');
    const click = new Event('click', { bubbles: true, cancelable: true });
    handout.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(reported).toEqual([{ type: 'handout_open', detail: { media: 'sharing-a-bed-about' } }]);
  });
});

describe('problems.js on /problems/', () => {
  const html = pageAt(site, '/problems/');
  const panel = (view) => dom.document.querySelector(`[data-view-panel="${view}"]`);
  const groups = (view) => panel(view).querySelectorAll('section.group-list__group');
  const areaSections = () => groups('area');
  const button = (section) => section.querySelector('button.group-list__header');
  const expanded = (view) => groups(view).map((s) => button(s).getAttribute('aria-expanded'));
  const visibleItems = (section) => section.querySelectorAll('li[data-slug]').filter((li) => !li.hidden);
  const typeQuery = (value) => {
    const input = dom.document.getElementById('problem-filter');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const slugs = (items) => items.map((li) => li.dataset.slug).sort();
  /** Each group of a view: its name, whether it is hidden or open, and its count. */
  const viewState = (view) =>
    groups(view).map((s) => [
      s.querySelector('[data-group-name]').textContent,
      s.hidden,
      button(s).getAttribute('aria-expanded'),
      s.querySelector('[data-group-list]').hidden,
      s.querySelector('[data-group-count]').textContent,
    ]);
  /** Check a view is narrowed: only groups with a match show, each open, counting "n of total". Returns the shown slugs. */
  const expectNarrowed = (view) => {
    for (const section of groups(view)) {
      const items = visibleItems(section);
      expect(section.hidden).toBe(items.length === 0);
      if (items.length === 0) continue;
      expect(button(section).getAttribute('aria-expanded')).toBe('true');
      expect(section.querySelector('[data-group-list]').hidden).toBe(false);
      const total = section.querySelectorAll('li[data-slug]').length;
      expect(section.querySelector('[data-group-count]').textContent).toBe(`${items.length} of ${total}`);
    }
    return slugs(groups(view).filter((s) => !s.hidden).flatMap(visibleItems));
  };

  // The page with a group that has no topics, second in each view (an area
  // with no problems yet, or a time of day none has): a copy of the view's
  // first group, renamed, with its list emptied.
  const withEmptyGroups = (source) => {
    let out = source;
    for (const view of ['area', 'time']) {
      const first = out.indexOf('<section', out.indexOf(`data-view-panel="${view}"`));
      const end = out.indexOf('</section>', first) + '</section>'.length;
      const empty = out
        .slice(first, end)
        .replace(/^<section([^>]*?) id="[^"]*"/, '<section$1 id="empty"')
        .replace(/(data-group-name>)[^<]*/, '$1Nothing here yet')
        .replace(/data-total="\d+">\d+</, 'data-total="0">0<')
        .replace(/(group-list__count-unit">) topics?/, '$1 topics')
        .replace(/(<ul\b[^>]*\bid=")[^"]*("[^>]*>)[\s\S]*<\/ul>/, `$1${view}-empty-problems$2</ul>`);
      expect(empty).not.toContain('<li');
      const second = out.indexOf('<section', end);
      out = out.slice(0, second) + empty + out.slice(second);
    }
    return out;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('shows the toolbar (the filter and the view toggle, no "Open all areas") and its lede sentence', async () => {
    await load(html, ['problems']);
    const { document } = dom;
    const tools = document.querySelector('[data-problems-tools]');
    expect(tools.hidden).toBe(false);
    expect(document.querySelector('[data-problems-hint]').hidden).toBe(false);
    expect(tools.querySelectorAll('button')).toHaveLength(0);
    expect(document.querySelector('[data-toggle-all]')).toBeNull();
    const radios = tools.querySelectorAll('fieldset input[type="radio"]');
    expect(radios.map((r) => [r.value, r.checked])).toEqual([['area', true], ['time', false]]);
  });

  it('makes every group in both views a button, with only the first of each open', async () => {
    await load(html, ['problems']);
    for (const [view, n] of [['area', 10], ['time', 6]]) {
      const sections = groups(view);
      expect(sections).toHaveLength(n);
      sections.forEach((section, i) => {
        const list = section.querySelector('[data-group-list]');
        const header = button(section);
        expect(header.parentNode.tagName.toLowerCase()).toBe('h2');
        expect(header.getAttribute('type')).toBe('button');
        expect(header.getAttribute('aria-controls')).toBe(list.id);
        expect(header.getAttribute('aria-expanded')).toBe(String(i === 0));
        expect(list.hidden).toBe(i !== 0);
        expect(section.querySelector('span.group-list__header')).toBeNull();
      });
    }
    expect(panel('area').hidden).toBe(false);
    expect(panel('time').hidden).toBe(true);
    expect(dom.document.querySelector('[data-problems]').classList.contains('is-enhanced')).toBe(true);

    for (const view of ['area', 'time']) {
      const second = groups(view)[1];
      button(second).click();
      expect(button(second).getAttribute('aria-expanded')).toBe('true');
      expect(second.querySelector('[data-group-list]').hidden).toBe(false);
      button(second).click();
      expect(second.querySelector('[data-group-list]').hidden).toBe(true);
    }
  });

  it('opens the area named in the URL instead of the first', async () => {
    await load(html, ['problems'], { hash: '#mind' });
    const open = areaSections().filter((s) => button(s).getAttribute('aria-expanded') === 'true');
    expect(open.map((s) => s.id)).toEqual(['mind']);
    expect(expanded('time')).toEqual(['true', ...Array(5).fill('false')]);
  });

  it('switches to "When it happens" and back, and the result line follows the view', async () => {
    const [{ STATUS_DELAY }] = await load(html, ['problems']);
    const { document } = dom;
    const status = document.querySelector('[data-filter-status]');
    expect(status.textContent).toBe('36 topics in 10 areas');
    document.getElementById('view-time').click();
    expect(panel('time').hidden).toBe(false);
    expect(panel('area').hidden).toBe(true);
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(status.textContent).toBe('36 topics across 6 times of day');
    document.getElementById('view-area').click();
    expect(panel('area').hidden).toBe(false);
    expect(panel('time').hidden).toBe(true);
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(status.textContent).toBe('36 topics in 10 areas');
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
        expect(section.querySelector('[data-group-count]').textContent).toBe(`${items.length} of ${total}`);
      }
      const areaName = section.querySelector('[data-group-name]').textContent;
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
    expect(expanded('area')).toEqual(['true', ...Array(9).fill('false')]);
  });

  it('filters "When it happens" the same way: "3am" hides the times without matches and opens the rest', async () => {
    const [{ STATUS_DELAY }] = await load(html, ['problems']);
    const { document } = dom;
    const status = document.querySelector('[data-filter-status]');
    document.getElementById('view-time').click();
    button(groups('time')[2]).click(); // open "During the night" by hand too

    typeQuery('3am');
    const areaMatches = areaSections().flatMap(visibleItems).filter((li) => !li.closest('section').hidden);
    const matchedSlugs = areaMatches.map((li) => li.dataset.slug).sort();
    expect(matchedSlugs.length).toBeGreaterThan(0);
    const timeShown = groups('time').filter((s) => !s.hidden);
    expect(timeShown.length).toBeGreaterThan(0);
    expect(timeShown.length).toBeLessThan(6);
    expect(timeShown.flatMap(visibleItems).map((li) => li.dataset.slug).sort()).toEqual(matchedSlugs);
    for (const section of groups('time')) {
      const items = visibleItems(section);
      expect(section.hidden).toBe(items.length === 0);
      if (items.length) {
        expect(button(section).getAttribute('aria-expanded')).toBe('true');
        expect(section.querySelector('[data-group-list]').hidden).toBe(false);
        const total = section.querySelectorAll('li[data-slug]').length;
        expect(section.querySelector('[data-group-count]').textContent).toBe(`${items.length} of ${total}`);
      }
    }
    vi.advanceTimersByTime(STATUS_DELAY);
    const n = matchedSlugs.length;
    expect(status.textContent).toBe(n === 1 ? '1 topic matches “3am”' : `${n} topics match “3am”`);

    // Clearing it puts the times of day back as they were.
    typeQuery('');
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(groups('time').filter((s) => s.hidden)).toEqual([]);
    expect(expanded('time')).toEqual(['true', 'false', 'true', 'false', 'false', 'false']);
    expect(groups('time').map((s) => s.querySelector('[data-group-count]').textContent)).toEqual(
      groups('time').map((s) => String(s.querySelectorAll('li[data-slug]').length)),
    );
    expect(status.textContent).toBe('36 topics across 6 times of day');
  });

  it('says so when nothing matches, keeping every topic in view, in either view', async () => {
    const [{ STATUS_DELAY, NO_MATCH }] = await load(html, ['problems']);
    const status = dom.document.querySelector('[data-filter-status]');
    typeQuery('zzzz');
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(status.textContent).toBe(NO_MATCH.area);
    expect(areaSections().filter((s) => s.hidden)).toEqual([]);
    dom.document.getElementById('view-time').click();
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(status.textContent).toBe(NO_MATCH.time);
    expect(groups('time').filter((s) => s.hidden)).toEqual([]);
  });

  it('keeps the filter when switching view: typed in By area, "When it happens" is narrowed to the same topics, and back again', async () => {
    const [{ STATUS_DELAY }] = await load(html, ['problems']);
    const { document } = dom;
    const status = document.querySelector('[data-filter-status]');

    typeQuery('night');
    vi.advanceTimersByTime(STATUS_DELAY);
    const matched = expectNarrowed('area');
    expect(matched.length).toBeGreaterThan(1);
    const line = `${matched.length} topics match “night”`;
    expect(status.textContent).toBe(line);
    const areaNarrowed = viewState('area');

    document.getElementById('view-time').click();
    expect(panel('time').hidden).toBe(false);
    expect(document.getElementById('problem-filter').value).toBe('night');
    expect(expectNarrowed('time')).toEqual(matched);
    expect(groups('time').filter((s) => s.hidden).length).toBeGreaterThan(0);
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(status.textContent).toBe(line);

    document.getElementById('view-area').click();
    expect(panel('area').hidden).toBe(false);
    expect(viewState('area')).toEqual(areaNarrowed);
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(status.textContent).toBe(line);

    // And the other way: typed in "When it happens", By area follows.
    document.getElementById('view-time').click();
    typeQuery('3am');
    const fromTime = expectNarrowed('time');
    expect(fromTime.length).toBeGreaterThan(0);
    expect(fromTime).not.toEqual(matched);
    document.getElementById('view-area').click();
    expect(expectNarrowed('area')).toEqual(fromTime);
    vi.advanceTimersByTime(STATUS_DELAY);
    const n = fromTime.length;
    expect(status.textContent).toBe(n === 1 ? '1 topic matches “3am”' : `${n} topics match “3am”`);
  });

  it('hides a group with no topics only while the filter narrows: cleared or with no match, both views are as on load', async () => {
    const [{ STATUS_DELAY, NO_MATCH }] = await load(withEmptyGroups(html), ['problems']);
    const status = dom.document.querySelector('[data-filter-status]');
    const empties = () => ['area', 'time'].map((view) => groups(view)[1]);
    expect(groups('area')).toHaveLength(11);
    expect(groups('time')).toHaveLength(7);
    for (const section of empties()) {
      expect(section.querySelector('[data-group-name]').textContent).toBe('Nothing here yet');
      expect(section.hidden).toBe(false);
      expect(section.querySelector('[data-group-count]').textContent).toBe('0');
      expect(button(section).getAttribute('aria-expanded')).toBe('false');
    }
    const onLoad = { area: viewState('area'), time: viewState('time') };
    const asOnLoad = () => expect({ area: viewState('area'), time: viewState('time') }).toEqual(onLoad);

    typeQuery('night');
    for (const section of empties()) expect(section.hidden).toBe(true);

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
    expect(status.textContent).toBe(NO_MATCH.area);

    dom.document.getElementById('view-time').click();
    typeQuery('');
    asOnLoad();
    vi.advanceTimersByTime(STATUS_DELAY);
    expect(status.textContent).toBe('36 topics across 7 times of day');
  });

  it('opens an area on hashchange, switching back to By area', async () => {
    await load(html, ['problems']);
    const { document, window } = dom;
    document.getElementById('view-time').click();
    window.location.hash = '#social';
    window.dispatchEvent(new Event('hashchange'));
    expect(panel('area').hidden).toBe(false);
    expect(document.getElementById('view-area').checked).toBe(true);
    expect(button(document.getElementById('social')).getAttribute('aria-expanded')).toBe('true');
  });
});
