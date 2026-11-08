// One template for every video (SPEC §7.5; project lead, 2026-11-09: "a
// consistent template that is reproduced exactly, without variation"). On
// every built page, in every combination of the feature switches:
//
// - every video is the video template (partials/video-block.njk): the label
//   where the context has one, the title and the description, the video,
//   then one row of exactly "Audio only", "Handout" and, while
//   features.ratings is on, "Was this helpful?", in that order;
// - stripped of what may differ (text, ids, the heading level, the label
//   and a card's Close, the frame's bleed and whether the video is on
//   YouTube yet), every template is the same markup;
// - every closed solution card is the same summary: the band (play disc,
//   step chip, duration), the title and the description, and nothing else.
//
// The templates' parts are checked in detail in components.test.js,
// page-problem.test.js and page-home-start.test.js.
import { describe, expect, inject, it } from 'vitest';
import { validateContent } from '../../scripts/validate-content.js';
import { attr, elementByClass, readHtmlPages, tags, text } from './helpers.js';

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

  // Every template on a page takes its layout from one query container, the
  // page's main column (site.css), so the problem video and an open card
  // never show two layouts at once (SPEC §7.5).
  it.each(withVideos.map((p) => [p.file, p.html]))('%s: every template is inside the page\'s main column, the one query container', (file, html) => {
    const column = elementByClass(html, 'with-sidebar__main', '(?:main|div)');
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
    '%s: the label (if any), title and description, the video, then exactly "Audio only", "Handout" and the rating, in that order',
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
      expect(kids(row)).toEqual(['details.format-disclosure', 'a.format-button', ...(ratingsOn ? ['div.rating'] : [])]);
      const controls = elementByClass(html, 'video-controls', 'div');
      expect(visibleText(elementByClass(controls, 'format-disclosure__toggle', 'summary'))).toBe('Audio only');
      expect(visibleText(elementByClass(controls, 'format-button', 'a'))).toBe('Handout');
      if (ratingsOn) expect(visibleText(elementByClass(controls, 'rating__legend', 'legend'))).toBe('Was this helpful?');
    },
  );

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
        'span.solution__band[span.play-disc.play-disc--sm,span.step-chip.step-chip--sm.step-chip--paper[span.step-chip__num,span.step-chip__label],span.duration-badge.solution__duration],' +
        'span.solution__disc,' +
        'span.solution__text[span.solution__title,span.solution__blurb,span.solution__length.visually-hidden],' +
        'span.solution__chevron]]',
    ]);
  });

  it.each(cards.map((c) => [`${c.file} ${attr(tags(c.html, 'li')[0], 'id')}`, c]))('%s: the closed card shows its chip, duration, title and description, and no link', (where, { html }) => {
    const summary = html.match(/<summary[\s\S]*?<\/summary>/)[0];
    expect(text(elementByClass(summary, 'step-chip', 'span'))).toMatch(/^\d (Main|Extra)$/);
    expect(text(elementByClass(summary, 'solution__duration', 'span')).length).toBeGreaterThan(0);
    expect(text(elementByClass(summary, 'solution__title', 'span')).length).toBeGreaterThan(0);
    expect(text(elementByClass(summary, 'solution__blurb', 'span')).length).toBeGreaterThan(0);
    // The card's only links and buttons are in its open template.
    const outside = html.replace(elementByClass(html, 'solution__panel', 'div'), '');
    expect(outside).not.toMatch(/<(a|button)\b|data-handout/);
  });
});
