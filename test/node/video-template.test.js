// One template for every video (SPEC §7.5; project lead, 2026-11-09: "a
// consistent template that is reproduced exactly, without variation"). On
// every built page, in every combination of the feature switches:
//
// - every video is the video template (partials/video-block.njk): the label
//   where the context has one, the title and the description, the video,
//   then one row of exactly "Audio only", "Handout", while features.feedback
//   is on, exactly one "Feedback" button (project lead, 2026-11-13; SPEC
//   §13) and, while features.ratings is on, "Was this helpful?", in that
//   order;
// - stripped of what may differ (text, ids, the heading level, the label
//   and a card's Close, the frame's bleed and whether the video is on
//   YouTube yet), every template is the same markup;
// - every closed solution card is the same summary: the band (play disc,
//   step chip, duration), the title and the description, and nothing else.
//
// - the template holds no worksheets (SPEC §7.6; project lead, 2026-11-13):
//   they are a section a solution card adds after its template, so the
//   template is the same for every video, with or without worksheets.
//   "No worksheets" is about the markup (the section, its links and their
//   files; WORKSHEET_MARKUP), never the word: the team may write
//   "worksheet" in a page's text or a video's title or description.
//
// The templates' parts are checked in detail in components.test.js,
// page-problem.test.js and page-home-start.test.js.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { validateContent } from '../../scripts/validate-content.js';
import { WORKSHEET_MARKUP, attr, elementByClass, listFiles, readHtmlPages, tags, text } from './helpers.js';

const builds = inject('featureBuilds');
const { model } = validateContent(process.cwd());

/** Every element (opening tag to its matching close) with this class. */
function elements(html, className, tagName) {
  const found = [];
  let rest = html;
  for (let el = elementByClass(rest, className, tagName); el; el = elementByClass(rest, className, tagName)) {
    found.push(el);
    rest = rest.slice(rest.indexOf(el) + el.length);
  }
  return found;
}

const VOID = new Set(['input', 'img', 'br', 'hr', 'source', 'track', 'wbr']);

/**
 * An element's markup as a tree of { tag, cls, attrs, children }, from our
 * own (well-formed) template output. Icons (<svg>) are left out.
 */
function tree(html) {
  const root = { tag: '#root', children: [] };
  const stack = [root];
  const markup = html.replace(/<svg\b[\s\S]*?<\/svg>/g, '');
  for (const m of markup.matchAll(/<(\/?)([a-z0-9]+)\b([^>]*)>/gi)) {
    const [whole, closing, name] = m;
    const tag = name.toLowerCase();
    if (closing) {
      stack.pop();
      continue;
    }
    const node = { tag, cls: attr(whole, 'class') ?? '', open: whole, children: [] };
    stack.at(-1).children.push(node);
    if (!VOID.has(tag)) stack.push(node);
  }
  return root.children[0];
}

/** The video_id of the (first) video in this markup. */
const videoIdOf = (html) => html.match(/\sdata-video="([^"]*)"/)[1];
/** Visible text: visually hidden spans left out. */
const visibleText = (html) => text(html.replace(/<span class="visually-hidden">[\s\S]*?<\/span>/g, ''));

const label = (node) => `${node.tag}${node.cls ? `.${node.cls.split(' ').join('.')}` : ''}`;
const kids = (node) => node.children.map(label);
const find = (node, cls) => {
  if (node.cls.split(' ').includes(cls)) return node;
  for (const child of node.children) {
    const hit = find(child, cls);
    if (hit) return hit;
  }
  return undefined;
};

/**
 * The template's skeleton: tags and classes, without what may differ
 * between contexts (SPEC §7.5): the label row (a step chip and a card's
 * Close, "if applicable"), the heading level, the frame's bleed modifier and
 * the facade's inside (a placeholder or a "Watch on YouTube" link; the
 * facade is partials/video.njk's, checked in components.test.js).
 */
function skeleton(node) {
  if (node.cls === 'video-block__top') return '';
  const tag = /^h[1-6]$/.test(node.tag) ? 'hN' : node.tag;
  const cls = node.cls
    .split(' ')
    .filter((c) => c && !/^video--(page|card|inset|placeholder)$/.test(c))
    .join('.');
  const inner = node.cls === 'video__frame' ? '' : node.children.map(skeleton).filter(Boolean).join(',');
  return `${tag}${cls ? `.${cls}` : ''}${inner ? `[${inner}]` : ''}`;
}

describe.each(builds.map((b) => [b.name, b]))('every video, built with %s', (name, { features, dir }) => {
  const pages = readHtmlPages(dir).map(({ file, html }) => ({ file, html, main: html.slice(html.indexOf('<main'), html.indexOf('</main>')) }));
  const withVideos = pages.filter((p) => p.main.includes('data-video='));
  const blocks = withVideos.flatMap(({ file, main }) => elements(main, 'video-block', 'div').map((html) => ({ file, html, node: tree(html) })));
  const ratingsOn = features.ratings === true;
  const feedbackOn = features.feedback === true;

  it('covers every page with a video: the problem pages and Start here, and no other', () => {
    expect(withVideos.map((p) => p.file).sort()).toEqual(
      [...model.problems.keys()].map((slug) => `problems/${slug}/index.html`).concat('start/index.html').sort(),
    );
  });

  it.each(withVideos.map((p) => [p.file, p.main]))('%s: every video on the page is in a video template, and nothing else is', (file, main) => {
    const videos = tags(main, 'div').filter((t) => attr(t, 'data-video') !== undefined).map((t) => attr(t, 'data-video'));
    const inBlocks = elements(main, 'video-block', 'div').map((b) => attr(tags(b, 'div').find((t) => attr(t, 'data-video') !== undefined), 'data-video'));
    expect(inBlocks).toEqual(videos);
    // Each template holds one video, and each row of controls is a template's.
    for (const b of elements(main, 'video-block', 'div')) expect(b.match(/\sdata-video="/g)).toHaveLength(1);
    expect(main.match(/class="video-controls/g)).toHaveLength(videos.length);
    // Nothing from the old per-page layouts.
    expect(main).not.toMatch(/problem-block|solution__tools|solution__header|solution__heading|solution__lede|solution__meta|solution__quick|start-chapter__(head|num|title|desc|eyebrow)|data-rating-reveal|video--lg|<span class="video__title">/);
  });

  // Every template takes its layout from one query container, the page's
  // two-column wrapper (.with-sidebar, site.css), which is as wide on Start
  // here as on a problem page: every video switches at one window width, and
  // the problem video and an open card never show two layouts at once (SPEC
  // §7.5). The videos themselves are in its main column.
  it.each(withVideos.map((p) => [p.file, p.html]))('%s: every template is inside the page\'s two-column wrapper, the one query container', (file, html) => {
    const wrappers = elements(html, 'with-sidebar', 'div');
    expect(wrappers, file).toHaveLength(1);
    expect(attr(tags(wrappers[0], 'div')[0], 'class').split(/\s+/), file).toContain('container');
    const column = elementByClass(wrappers[0], 'with-sidebar__main', '(?:main|div)');
    expect(column, file).toBeDefined();
    expect(elements(column, 'video-block', 'div')).toHaveLength(elements(html, 'video-block', 'div').length);
  });

  it('renders every template as the same markup', () => {
    expect(blocks.length).toBe(withVideos.reduce((n, p) => n + (p.main.match(/\sdata-video="/g) ?? []).length, 0));
    const shapes = new Map();
    for (const b of blocks) {
      const shape = skeleton(b.node);
      if (!shapes.has(shape)) shapes.set(shape, []);
      shapes.get(shape).push(`${b.file} ${videoIdOf(b.html)}`);
    }
    expect([...shapes.keys()], [...shapes.values()].map((where) => where.slice(0, 3).join(', ')).join(' | ')).toHaveLength(1);
  });

  it.each(blocks.map((b) => [`${b.file} ${videoIdOf(b.html)}`, b]))(
    '%s: the label (if any), title and description, the video, then exactly "Audio only", "Handout", "Feedback" and the rating, in that order',
    (where, { node, html }) => {
      const grid = node.children[0];
      expect(kids(node)).toEqual(['div.video-block__grid']);
      expect(kids(grid)).toEqual(['div.video-block__header', 'div.video-block__video', 'div.video-controls']);
      const header = grid.children[0];
      const hasTop = header.children[0]?.cls === 'video-block__top';
      const parts = header.children.slice(hasTop ? 1 : 0);
      expect(parts.map((p) => p.cls)).toEqual(['video-block__title', 'video-block__desc']);
      expect(['h2', 'h3']).toContain(parts[0].tag);
      expect(parts[1].tag).toBe('p');
      expect(text(elementByClass(html, 'video-block__title')).length).toBeGreaterThan(0);
      expect(text(elementByClass(html, 'video-block__desc', 'p')).length).toBeGreaterThan(0);
      expect(kids(grid.children[1])).toHaveLength(1);
      expect(grid.children[1].children[0].cls.split(' ')[0]).toBe('video');
      const row = grid.children[2];
      expect(row.open).toBe('<div class="video-controls">');
      expect(kids(row)).toEqual(['details.format-disclosure', 'a.format-button', ...(feedbackOn ? ['button.format-button'] : []), ...(ratingsOn ? ['div.rating'] : [])]);
      const controls = elementByClass(html, 'video-controls', 'div');
      expect(visibleText(elementByClass(controls, 'format-disclosure__toggle', 'summary'))).toBe('Audio only');
      expect(visibleText(elementByClass(controls, 'format-button', 'a'))).toBe('Handout');
      if (ratingsOn) expect(visibleText(elementByClass(controls, 'rating__legend', 'legend'))).toBe('Was this helpful?');
      // "Feedback": exactly one button per video while the switch is on,
      // after the handout and before the rating, naming this video and
      // shipped hidden (it needs feedback.js); none while it is off. It is the
      // row's only button, and nothing else in the template opens the dialog.
      const id = videoIdOf(html);
      const buttons = tags(controls, 'button');
      const triggers = (html.match(/<[a-z0-9]+\b[^>]*\sdata-feedback-(?:trigger|video)\b[^>]*>/g) ?? []);
      if (feedbackOn) {
        expect(buttons).toEqual([`<button type="button" class="format-button" data-feedback-trigger data-feedback-video="${id}" hidden>`]);
        expect(triggers).toEqual(buttons);
        const button = controls.match(/<button\b[\s\S]*?<\/button>/)[0];
        expect(visibleText(button)).toBe('Feedback');
        expect(text(button).replace(' :', ':')).toBe(`Feedback: ${text(elementByClass(html, 'video-block__title'))}`);
        expect(button).toMatch(/^<button [^>]*><svg class="icon format-button__icon" [^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>Feedback<span class="visually-hidden">: [^<]+<\/span><\/button>$/);
        // After the whole handout link, and wholly before the rating.
        const handoutAt = controls.indexOf('<a class="format-button"');
        const buttonAt = controls.indexOf('<button type="button" class="format-button"');
        const at = [handoutAt, controls.indexOf('</a>', handoutAt), buttonAt, controls.indexOf('</button>', buttonAt), ratingsOn ? controls.indexOf('<div class="rating"') : controls.length];
        expect(at.every((i) => i > -1)).toBe(true);
        expect([...at].sort((a, b) => a - b)).toEqual(at);
        // The heading feedback.js reads the video's title from.
        expect(html).toContain(` id="video-${id}-title"`);
      } else {
        expect(buttons).toEqual([]);
        expect(triggers).toEqual([]);
        expect(html).not.toMatch(/data-feedback|>Feedback</);
      }
    },
  );

  it(`has ${feedbackOn ? 'one "Feedback" button per video, each naming a different video of its page, and the footer\'s "Send feedback"' : 'no "Feedback" button anywhere'}`, () => {
    for (const { file, html, main } of withVideos) {
      const named = [...html.matchAll(/\sdata-feedback-video="([^"]*)"/g)].map((m) => m[1]);
      const videos = tags(main, 'div').filter((t) => attr(t, 'data-video') !== undefined).map((t) => attr(t, 'data-video'));
      expect(named, file).toEqual(feedbackOn ? videos : []);
      expect(new Set(named).size, file).toBe(named.length);
      // With the footer's link, the page's only other way into the dialog.
      expect((html.match(/\sdata-feedback-trigger\b/g) ?? []).length, file).toBe(feedbackOn ? videos.length + 1 : 0);
    }
    // A page without videos has none.
    for (const { file, html } of pages.filter((p) => !withVideos.some((w) => w.file === p.file))) {
      expect(html, file).not.toMatch(/data-feedback-video/);
    }
  });

  it('labels each template by its context: none on the problem video, "n Main"/"n Extra" with Close on a card, "n of N" on Start here', () => {
    for (const { file, html, node } of blocks) {
      const top = find(node, 'video-block__top');
      const chip = top && text(elementByClass(html, 'step-chip', 'span'));
      const close = top && find(top, 'video-block__close');
      const id = videoIdOf(html);
      if (file === 'start/index.html') {
        const n = model.start.data.chapters.findIndex((c) => c.video === id) + 1;
        expect([chip, Boolean(close)], id).toEqual([`${n} of ${model.start.data.chapters.length}`, false]);
      } else if (model.problems.get(file.split('/')[1]).data.problem_video === id) {
        expect(top, id).toBeUndefined();
      } else {
        const solutions = model.problems.get(file.split('/')[1]).data.solutions;
        const s = solutions.find((x) => x.video === id);
        const n = solutions.filter((x) => x.tier === s.tier).indexOf(s) + 1;
        expect([chip, Boolean(close)], id).toEqual([`${n} ${s.tier === 'main' ? 'Main' : 'Extra'}`, true]);
      }
    }
  });

  const cards = withVideos.flatMap(({ file, main }) => elements(main, 'solution', 'li').map((html) => ({ file, html, node: tree(html) })));

  it('renders every closed solution card as the same summary, and nothing outside it', () => {
    expect(cards.length).toBeGreaterThan(40);
    const shapes = new Set();
    for (const { node } of cards) {
      expect(kids(node)).toEqual(['details.solution__disclosure']);
      const summary = node.children[0].children[0];
      expect(label(summary)).toBe('summary.solution__face');
      shapes.add(skeleton(summary));
    }
    expect([...shapes]).toEqual([
      'summary.solution__face[span.solution__face-inner[' +
        'span.solution__band[span.play-disc.play-disc--sm,span.step-chip.step-chip--paper[span.step-chip__num,span.step-chip__label],span.duration-badge.solution__duration],' +
        'span.solution__disc,' +
        'span.solution__text[span.solution__title,span.solution__description,span.solution__length.visually-hidden],' +
        'span.solution__chevron]]',
    ]);
  });

  // Worksheets (SPEC §7.6): a section of a solution card, after its
  // template. They belong to the video, so the same video has the same
  // section on every page, whatever the feature switches.
  const worksheetsOf = (id) => [...model.worksheets.values()].map((w) => w.data).filter((w) => w.video_id === id);

  it('keeps the worksheets out of every template: each section is a solution card\'s, after its template, and no other page has one', () => {
    for (const b of blocks) expect(b.html, `${b.file} ${videoIdOf(b.html)}`).not.toMatch(WORKSHEET_MARKUP);
    let sections = 0;
    for (const { file, html, node } of cards) {
      const id = videoIdOf(html);
      const expected = worksheetsOf(id);
      const panel = find(node, 'solution__panel');
      // The panel holds the template, then the section where the video has worksheets.
      expect(kids(panel), `${file} ${id}`).toEqual(['div.video-block', ...(expected.length ? ['section.worksheets'] : [])]);
      expect([...html.matchAll(/\sdata-worksheet="([^"]*)"/g)].map((m) => m[1]), `${file} ${id}`).toEqual(expected.map((w) => w.worksheet_id));
      if (!expected.length) continue;
      sections += 1;
      const section = find(panel, 'worksheets');
      expect(kids(section), `${file} ${id}`).toEqual(['h4.worksheets__title', 'ul.worksheets__list']);
      expect(kids(section.children[1]), `${file} ${id}`).toEqual(expected.map(() => 'li'));
      for (const item of section.children[1].children) {
        expect(kids(item), `${file} ${id}`).toEqual(['a.format-button']);
        expect(kids(item.children[0]), `${file} ${id}`).toEqual(['span.visually-hidden']);
      }
    }
    // Every section on the site is one of those.
    const all = pages.reduce((n, { html }) => n + (html.match(/<section class="worksheets"/g) ?? []).length, 0);
    expect(all).toBe(sections);
    // Say so if there is nothing to check: no solution video has a worksheet.
    const solutionVideos = new Set(cards.map(({ html }) => videoIdOf(html)));
    expect(sections > 0).toBe([...model.worksheets.values()].some((w) => solutionVideos.has(w.data.video_id)));
    // Pages without solution cards have no worksheets section, link or file:
    // Start here, Home, the stand-alone problems and the rest. Their text
    // may speak of worksheets, as the privacy page's does (SPEC §15.2;
    // features-off.test.js checks its two sentences).
    for (const { file, html } of pages) {
      if (cards.some((c) => c.file === file)) continue;
      expect(html, file).not.toMatch(WORKSHEET_MARKUP);
    }
    // And on a page with cards, all of it is inside their panels.
    for (const { file, html } of pages) {
      const own = cards.filter((c) => c.file === file);
      if (!own.length) continue;
      const outside = own.reduce((rest, c) => rest.replace(elementByClass(c.html, 'solution__panel', 'div'), ''), html);
      expect(outside, file).not.toMatch(WORKSHEET_MARKUP);
    }
  });

  // Project lead, 2026-11-14 (SPEC §7.2): a video's title and description
  // are fixed. They come from its row of data/videos.csv and nowhere else,
  // so a video reads the same on every page, open or closed.
  it('gives every video its own title and description, from data/videos.csv, wherever it is', () => {
    const plain = (value) => String(value).replace(/\s+/g, ' ').trim();
    const own = (id) => {
      const { title, description } = model.videos.get(id).data;
      return [plain(title), plain(description)];
    };
    for (const { file, html } of blocks) {
      const id = videoIdOf(html);
      const title = elementByClass(html, 'video-block__title');
      expect([visibleText(title), text(elementByClass(html, 'video-block__desc', 'p'))], `${file} ${id}`).toEqual(own(id));
    }
    // video_id -> the different words its closed cards show, across every problem.
    const faces = new Map();
    for (const { file, html } of cards) {
      const id = videoIdOf(html);
      const summary = html.match(/<summary[\s\S]*?<\/summary>/)[0];
      const shown = [text(elementByClass(summary, 'solution__title', 'span')), text(elementByClass(summary, 'solution__description', 'span'))];
      expect(shown, `${file} ${id}`).toEqual(own(id));
      faces.set(id, (faces.get(id) ?? new Set()).add(shown.join('\n')));
    }
    for (const [id, seen] of faces) expect(seen.size, id).toBe(1);
  });

  it('shows a video\'s worksheets as the same section on every problem that has it as a solution', () => {
    // video_id -> the different sections its cards show ('' for none), and how many cards it has.
    const byVideo = new Map();
    for (const { html } of cards) {
      const id = videoIdOf(html);
      const seen = byVideo.get(id) ?? { sections: new Set(), cards: 0 };
      seen.sections.add(elementByClass(html, 'worksheets', 'section') ?? '');
      seen.cards += 1;
      byVideo.set(id, seen);
    }
    for (const [id, seen] of byVideo) expect(seen.sections.size, id).toBe(1);
    // Some video is a solution on several problems, or this checks nothing.
    expect([...byVideo.values()].some((seen) => seen.cards > 1)).toBe(true);
  });

  it.each(cards.map((c) => [`${c.file} ${attr(tags(c.html, 'li')[0], 'id')}`, c]))('%s: the closed card shows its chip, duration, title and description, and no link', (where, { html }) => {
    const summary = html.match(/<summary[\s\S]*?<\/summary>/)[0];
    expect(text(elementByClass(summary, 'step-chip', 'span'))).toMatch(/^\d (Main|Extra)$/);
    expect(text(elementByClass(summary, 'solution__duration', 'span')).length).toBeGreaterThan(0);
    expect(text(elementByClass(summary, 'solution__title', 'span')).length).toBeGreaterThan(0);
    expect(text(elementByClass(summary, 'solution__description', 'span')).length).toBeGreaterThan(0);
    // The card's only links and buttons are in its open template.
    const outside = html.replace(elementByClass(html, 'solution__panel', 'div'), '');
    expect(outside).not.toMatch(/<(a|button)\b|data-handout/);
  });
});

// The sources (SPEC §7.6): the video template doesn't change for worksheets
// and knows nothing of them, so no video outside a solution card can gain a
// worksheets section by accident. "Knows nothing" is about the templates'
// code (a Nunjucks tag that names the data, or the section's markup), not
// their words: a layout's own text, such as Home's steps, may say
// "worksheet", as the content may.
describe('worksheets in the templates', () => {
  const INCLUDES = 'src/_includes';
  const sources = listFiles(INCLUDES, (f) => f.endsWith('.njk')).map((file) => ({ file, source: readFileSync(path.join(INCLUDES, file), 'utf8') }));
  const code = (source) => source.replace(/\{#[\s\S]*?#\}/g, '');
  /** The template's Nunjucks tags, {{ … }} and {% … %}: where it reads data. */
  const logic = (source) => (code(source).match(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g) ?? []).join('\n');
  /** Does the template read the worksheets data, or write the section's markup? */
  const uses = (source) => /worksheet/i.test(logic(source)) || WORKSHEET_MARKUP.test(code(source));

  it('are rendered by the solution card alone: the video template, the facade and Start here never read or render them', () => {
    expect(sources.filter(({ source }) => uses(source)).map(({ file }) => file)).toEqual(['layouts/problem.njk', 'problem/solutions.njk']);
    // The problem layout only passes the data to solutionsByTier; the markup is the card's.
    const layout = code(sources.find(({ file }) => file === 'layouts/problem.njk').source);
    expect(logic(layout).match(/worksheet\w*/gi)).toEqual(['worksheets']);
    expect(layout).toContain('{%- set tiers = solutions | solutionsByTier(videos, worksheets) -%}');
    expect(layout).not.toMatch(WORKSHEET_MARKUP);
    const card = code(sources.find(({ file }) => file === 'problem/solutions.njk').source);
    expect(card.match(/<section class="worksheets"/g)).toHaveLength(1);
    // After the videoBlock call, inside the panel.
    expect(card.indexOf('<section class="worksheets"')).toBeGreaterThan(card.indexOf('{{ videoBlock(video, heading=3,'));
    expect(card.indexOf('<section class="worksheets"')).toBeGreaterThan(card.indexOf('<div class="solution__panel"'));
  });

  it('tell a template\'s words from its code', () => {
    // Words: a step on Home, a comment.
    expect(uses('<li>Print the worksheet, then watch the video.</li>{# worksheets: see solutions.njk #}')).toBe(false);
    // Code: the data in a tag, or the section's markup.
    expect(uses('{% for sheet in solution.worksheets %}{% endfor %}')).toBe(true);
    expect(uses('{{ videoBlock(video, worksheets=sheets) }}')).toBe(true);
    expect(uses('<section class="worksheets">')).toBe(true);
    expect(uses('<a href="/media/worksheets/{{ file }}">')).toBe(true);
    expect(uses('<a href="/x.pdf" data-worksheet="{{ id }}">')).toBe(true);
  });

  it('leave the video template\'s macro as it was: no worksheets argument', () => {
    const template = code(sources.find(({ file }) => file === 'partials/video-block.njk').source);
    expect(template).toContain("{%- macro videoBlock(video, heading=2, label=none, close='', bleed='page', ratings=false, feedback=false) -%}");
    expect(uses(template)).toBe(false);
  });
});
