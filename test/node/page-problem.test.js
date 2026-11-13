// Problem pages (SPEC §7.2, §9.1-§9.3, §12, §15.1, §20 M1b; HANDOFF §6.4):
// the built pages for all 36 problems, a problem of each layout shape, a
// stand-alone problem (no solutions), the solution card rendered with a
// playable (fake) video, the worksheets in each open solution card (SPEC
// §7.6), and solutions.js.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import configure from '../../eleventy.config.js';
import { validateContent } from '../../scripts/validate-content.js';
import { WORKSHEET_MARKUP, attr, elementByClass, pageAt, readHtmlPages, tags, text, videoRow } from './helpers.js';

// The site built with every feature on, whatever site.config.json says, so
// none of these checks changes while features.ratings is off (SPEC §11). The
// pages with the switch off are checked in features-off.test.js.
const site = inject('builtSiteOn');
const { model } = validateContent(process.cwd());
const problems = [...model.problems.entries()];
const video = (id) => model.videos.get(id);

/** Visible text: tags, visually hidden spans and the rating's invisible sizers left out. */
const visibleText = (html) =>
  text(
    html
      .replace(/<p class="rating__sizer"[\s\S]*?<\/p>/g, ' ')
      .replace(/<span class="visually-hidden">[\s\S]*?<\/span>/g, ' ')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' '),
  );

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
// A video's worksheets (SPEC §7.6): its rows of data/worksheets.csv, in the
// file's order, as the content check read them.
const worksheetsOf = (id) => [...model.worksheets.values()].map((w) => w.data).filter((w) => w.video_id === id);
/** Text as Nunjucks escapes it in the built pages. */
const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Markup without the white space between tags. */
const squeeze = (html) => html.replace(/>\s+</g, '><').trim();
/**
 * The worksheets section of a solution card, exactly as the template writes
 * it (problem/solutions.njk): a region named by its heading, then one
 * download link per worksheet, in order. `icon` is the download icon's
 * markup, taken from the card's "Handout" link.
 */
const worksheetsSection = (videoId, videoTitle, sheets, icon) =>
  `<section class="worksheets" aria-labelledby="solution-${videoId}-worksheets">` +
  `<h4 class="worksheets__title" id="solution-${videoId}-worksheets">Worksheet${sheets.length === 1 ? '' : 's'}<span class="visually-hidden">: ${esc(videoTitle)}</span></h4>` +
  '<ul class="worksheets__list" role="list">' +
  sheets.map((w) => `<li><a class="format-button" href="/media/worksheets/${esc(w.file)}" type="application/pdf" data-worksheet="${esc(w.worksheet_id)}">${icon}${esc(w.title)}<span class="visually-hidden"> (PDF)</span></a></li>`).join('') +
  '</ul></section>';
/** The download icon of a card's "Handout" link. */
const handoutIcon = (html) => html.match(/<a class="format-button"[^>]*\sdata-handout="[^"]*">(<svg\b[\s\S]*?<\/svg>)/)[1];

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
    // The problem's area in Home's list of sleep problems.
    expect(attr(back, 'href')).toBe(`/#${data.area}`);
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

  it('has one video per page video, in order, none with a notice of its own; the YouTube note is once, last (SPEC §15.1)', () => {
    const blocks = elements(main, 'video', 'div');
    expect(blocks.map((b) => attr(tags(b, 'div')[0], 'data-video'))).toEqual(pageVideos);
    for (const block of blocks) expect(block).not.toMatch(/notice-text|video__notice|youtube-note"/);
    const notes = elements(main, 'youtube-note', 'p');
    expect(notes).toHaveLength(1);
    expect(main.indexOf(notes[0])).toBeGreaterThan(main.lastIndexOf('problem__all'));
    expect(tags(notes[0], 'a').map((t) => attr(t, 'href'))).toEqual(['/privacy/#cookies-and-browser-storage']);
    // No title plate on any frame: the video template's heading names every
    // video (project lead, 2026-11-09), and the title is the play control's name.
    for (const block of blocks) expect(block).toMatch(/<span class="video__title visually-hidden">/);
    expect(main).not.toMatch(/<span class="video__title">/);
  });

  it('contacts nothing before a play button is pressed', () => {
    expect(html).not.toMatch(/<iframe|youtube-nocookie|iframe_api|i\.ytimg|preconnect|dns-prefetch/);
  });

  it('shows every video\'s "Audio only" and handout, once each, and never a transcript', () => {
    // Each video's own block: the problem video, or the video's card. Every
    // video has both (SPEC §7.1), and a closed card has no quick link
    // (project lead, 2026-11-09).
    const blocks = [elementByClass(main, 'problem-video', 'div'), ...cards];
    pageVideos.forEach((id, i) => {
      const { data: v } = video(id);
      const block = blocks[i];
      expect([Boolean(v.audio), Boolean(v.handout)], id).toEqual([true, true]);
      expect(block.match(/<audio\b/g), `${id} audio`).toHaveLength(1);
      expect(block, `${id} audio`).toContain(`id="audio-${id}"`);
      const handouts = tags(block, 'a').filter((t) => attr(t, 'data-handout'));
      // The hook holds the video_id (SPEC §10.2).
      expect(handouts.map((t) => [attr(t, 'href'), attr(t, 'data-handout')]), `${id} handout`).toEqual([[`/media/pdf/${v.handout}`, id]]);
      expect(block, id).not.toMatch(/transcript/i);
    });
    expect(main).not.toMatch(/solution__meta|solution__quick/);
  });

  it('puts each video in the video template: header, video, then one row of "Audio only", the handout and the rating', () => {
    // The problem video's wrapper holds the template and nothing else. A
    // card's panel holds the template, then its video's worksheets where
    // it has some (SPEC §7.6; checked below), and nothing else.
    // video-template.test.js checks the template itself on every page.
    const holders = [elementByClass(main, 'problem-video', 'div'), ...cards.map((card) => elementByClass(card, 'solution__panel', 'div'))];
    pageVideos.forEach((id, i) => {
      const holder = holders[i];
      const block = elementByClass(holder, 'video-block', 'div');
      const sheets = elementByClass(holder, 'worksheets', 'section');
      expect(Boolean(sheets), id).toBe(i > 0 && worksheetsOf(id).length > 0);
      const rest = holder.replace(block, '').replace(sheets ?? '', '');
      expect(rest.replace(/<[^>]+>/g, '').trim(), id).toBe('');
      // Only the holder's own opening and closing tags are left.
      expect(squeeze(rest), id).toMatch(/^<div [^<>]*><\/div>$/);
      const order = ['class="video-block__header"', 'class="video-block__title"', 'class="video-block__desc"', `data-video="${id}"`, 'class="video-controls"'].map((needle) => block.indexOf(needle));
      expect(order.every((n) => n >= 0), id).toBe(true);
      expect(order, id).toEqual([...order].sort((a, b) => a - b));
      const row = elementByClass(block, 'video-controls', 'div');
      // Never hidden: it always holds "Audio only" and the handout.
      expect(tags(row, 'div')[0], id).toBe('<div class="video-controls">');
      const at = [`<details class="format-disclosure" id="audio-${id}">`, '>Handout<span class="visually-hidden">: ', `<div class="rating" data-rating="${id}" hidden>`, 'Was this helpful?', 'class="rating__status-box"'].map((needle) => row.indexOf(needle));
      expect(at.every((n) => n >= 0), id).toBe(true);
      expect(at, id).toEqual([...at].sort((a, b) => a - b));
      // Nothing after the widget: it ends the row.
      const widget = elementByClass(row, 'rating', 'div');
      expect(row.slice(row.indexOf(widget) + widget.length).trim(), id).toBe('</div>');
    });
    expect(main).not.toMatch(/data-rating-reveal|problem-block|solution__tools|solution__header|solution__heading/);
  });

  // SPEC §7.6 (project lead, 2026-11-13): "Add a section to expanded
  // solution video boxes where worksheets can go." The worksheets belong to
  // the video, so every problem that lists a video shows the same ones.
  it('lists each solution video\'s worksheets in a section of its card, after the video template, with the exact markup', () => {
    cards.forEach((card, i) => {
      const id = solutions[i].video;
      const sheets = worksheetsOf(id);
      const sections = elements(card, 'worksheets', 'section');
      // A video with no worksheets has no section at all: no empty heading.
      expect(sections, id).toHaveLength(sheets.length ? 1 : 0);
      expect((card.match(/\sdata-worksheet="/g) ?? []), id).toHaveLength(sheets.length);
      if (!sheets.length) {
        // None of the section's markup. (The word is the team's to use: a
        // blurb may say "the worksheets below".)
        expect(card, id).not.toMatch(WORKSHEET_MARKUP);
        return;
      }
      const [section] = sections;
      expect(squeeze(section), id).toBe(worksheetsSection(id, video(id).data.title, sheets, handoutIcon(card)));
      // Inside the panel, directly after the template (so under its row of
      // controls), and the last thing in the panel; never in the closed
      // card's face or inside the template.
      const panel = elementByClass(card, 'solution__panel', 'div');
      const block = elementByClass(panel, 'video-block', 'div');
      expect(squeeze(panel).endsWith(`${squeeze(block)}${squeeze(section)}</div>`), id).toBe(true);
      expect(block, id).not.toMatch(WORKSHEET_MARKUP);
      expect(card.match(/<summary[\s\S]*?<\/summary>/)[0], id).not.toMatch(WORKSHEET_MARKUP);
      expect(panel.indexOf(section), id).toBeGreaterThan(panel.indexOf('class="video-controls"'));
    });
  });

  it('names each worksheets section by its heading: "Worksheet" for one, "Worksheets" for several, then the video\'s title for screen readers', () => {
    cards.forEach((card, i) => {
      const id = solutions[i].video;
      const sheets = worksheetsOf(id);
      if (!sheets.length) return;
      const section = elementByClass(card, 'worksheets', 'section');
      const heading = elementByClass(section, 'worksheets__title', 'h4');
      expect(visibleText(heading), id).toBe(sheets.length === 1 ? 'Worksheet' : 'Worksheets');
      expect(text(heading).replace(' :', ':'), id).toBe(`${sheets.length === 1 ? 'Worksheet' : 'Worksheets'}: ${video(id).data.title}`);
      // The section is a region named by that heading, whose id is its own.
      const headingId = attr(tags(heading, 'h4')[0], 'id');
      expect([headingId, attr(tags(section, 'section')[0], 'aria-labelledby')], id).toEqual([`solution-${id}-worksheets`, `solution-${id}-worksheets`]);
      expect(html.split(` id="${headingId}"`), id).toHaveLength(2);
      // Under the card's own title, the template's h3.
      expect(card.indexOf('<h3 class="video-block__title"'), id).toBeLessThan(card.indexOf(heading));
      expect(tags(section, 'h[1-6]'), id).toHaveLength(1);
    });
  });

  it('links each worksheet as the row\'s "Handout" is: a download link to its PDF in media/worksheets/, with its title and "(PDF)" for screen readers', () => {
    cards.forEach((card, i) => {
      const id = solutions[i].video;
      const sheets = worksheetsOf(id);
      if (!sheets.length) return;
      const section = elementByClass(card, 'worksheets', 'section');
      const list = elementByClass(section, 'worksheets__list', 'ul');
      expect(tags(list, 'ul')[0], id).toBe('<ul class="worksheets__list" role="list">');
      const items = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
      expect(items, id).toHaveLength(sheets.length);
      items.forEach((item, n) => {
        const sheet = sheets[n];
        // One link, and nothing else, in each item.
        expect(item, sheet.worksheet_id).toMatch(/^<a class="format-button" [^>]*>[\s\S]*<\/a>$/);
        const link = tags(item, 'a');
        expect(link, sheet.worksheet_id).toHaveLength(1);
        expect([attr(link[0], 'class'), attr(link[0], 'href'), attr(link[0], 'type'), attr(link[0], 'data-worksheet')], sheet.worksheet_id).toEqual([
          'format-button', `/media/worksheets/${sheet.file}`, 'application/pdf', sheet.worksheet_id,
        ]);
        // A plain link: it opens in the same tab, like the handout, and needs no JavaScript.
        expect(link[0], sheet.worksheet_id).not.toMatch(/\s(?:target|download|rel|hidden|role|tabindex|aria-[a-z]+)[\s=>]/);
        expect(visibleText(item), sheet.worksheet_id).toBe(sheet.title);
        expect(text(item), sheet.worksheet_id).toBe(`${sheet.title} (PDF)`);
        // The handout's download icon, decorative.
        expect(item.match(/<svg\b[\s\S]*?<\/svg>/g), sheet.worksheet_id).toEqual([handoutIcon(card)]);
        expect(handoutIcon(card), sheet.worksheet_id).toMatch(/^<svg class="icon format-button__icon" width="18" height="18" [^>]*aria-hidden="true" focusable="false">/);
        // The file is in the built site, under the address the link names.
        expect(existsSync(path.join(site, 'media/worksheets', sheet.file)), sheet.file).toBe(true);
      });
    });
  });

  it('shows worksheets only in solution cards: none on the problem\'s own video, and each worksheet once on the page', () => {
    const named = [...html.matchAll(/\sdata-worksheet="([^"]*)"/g)].map((m) => m[1]);
    expect(named).toEqual(solutions.flatMap((s) => worksheetsOf(s.video).map((w) => w.worksheet_id)));
    expect(new Set(named).size).toBe(named.length);
    expect(html.match(/<section class="worksheets"/g) ?? []).toHaveLength(solutions.filter((s) => worksheetsOf(s.video).length).length);
    // The problem's own video has none, whatever data/worksheets.csv says of it.
    expect(elementByClass(main, 'problem-video', 'div')).not.toMatch(WORKSHEET_MARKUP);
    // Nothing outside the cards' panels has the section, a link or a file
    // (the page's words may speak of worksheets).
    const outside = cards.reduce((rest, card) => rest.replace(elementByClass(card, 'solution__panel', 'div'), ''), html);
    expect(outside).not.toMatch(WORKSHEET_MARKUP);
    expect(html.match(/\/media\/worksheets\//g) ?? []).toHaveLength(named.length);
  });

  it('shows the worksheets without JavaScript: plain links inside the card\'s <details>, nothing hidden', () => {
    for (const card of cards) {
      const section = elementByClass(card, 'worksheets', 'section');
      if (!section) continue;
      expect(section).not.toMatch(/\shidden[\s=>]|<button\b|<script\b|\sdata-(?!worksheet=)[a-z-]+/);
      const details = card.match(/<details class="solution__disclosure" name="solution">[\s\S]*<\/details>/)[0];
      expect(details).toContain(section);
    }
  });

  it('puts "Is this you?" in its own section directly below the problem video', () => {
    const wrapper = elementByClass(main, 'problem-video', 'div');
    const panel = elementByClass(main, 'is-this-you', 'section');
    expect(wrapper).not.toContain('is-this-you');
    expect(main.slice(main.indexOf(wrapper) + wrapper.length).trim().startsWith('<section class="is-this-you panel panel--wash" aria-labelledby="is-this-you-title">')).toBe(true);
    expect(main.indexOf(panel)).toBeLessThan(main.indexOf('class="solutions') === -1 ? Infinity : main.indexOf('class="solutions'));
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
      // The blurb, or the video's description where there is none (SPEC §7.2).
      expect(text(elementByClass(summary, 'solution__blurb', 'span'))).toBe(s.blurb || video(s.video).data.description);
      expect(summary).toContain(`id="solution-${s.video}-length"`);
      expect(tags(summary, 'span').find((t) => attr(t, 'class') === 'solution__band')).toContain('aria-hidden="true"');
    });
  });

  it('keeps the JavaScript-only parts hidden: the card\'s template header, with Close', () => {
    for (const card of cards) {
      expect(tags(card, 'div').find((t) => /\bvideo-block__header\b/.test(attr(t, 'class')))).toBe('<div class="video-block__header" hidden>');
      const close = tags(card, 'button').find((t) => attr(t, 'class') === 'video-block__close');
      const panelId = attr(tags(card, 'div').find((t) => attr(t, 'class') === 'solution__panel'), 'id');
      expect([attr(close, 'type'), attr(close, 'aria-expanded'), attr(close, 'aria-controls')]).toEqual(['button', 'true', panelId]);
      expect(text(elementByClass(card, 'video-block__close', 'button'))).toMatch(/^Close \S/);
    }
    // The problem video's header is shown without JavaScript.
    expect(tags(elementByClass(main, 'problem-video', 'div'), 'div').find((t) => /\bvideo-block__header\b/.test(attr(t, 'class')))).toBe('<div class="video-block__header">');
  });

  it('has no transcript anywhere: no disclosure, print button, quick link or visible mention (project lead, 2026-11-06)', () => {
    expect(visibleText(html)).not.toMatch(/transcript/i);
    expect(main).not.toMatch(/data-transcript|id="transcript-|#transcript-|transcript__|Read transcript|Print transcript|solution__quick-transcript/);
  });

  it('has no ratings notice and no rating summary in the closed cards', () => {
    expect(visibleText(main)).not.toMatch(/Ratings are anonymous|We use them to improve|About the information we collect|You rated this/);
    expect(main).not.toMatch(/data-rating-summary|solution__rating\b|notice-text">Ratings/);
    // The only notice is the page's YouTube note, once (SPEC §15.1).
    expect(tags(main, 'p').filter((t) => /\bnotice-text\b/.test(attr(t, 'class')))).toEqual(['<p class="notice-text youtube-note">']);
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
    const panel = elementByClass(main, 'is-this-you', 'section');
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
    expect(all).toBe('<p class="problem__all"><a href="/#sleep-problems">Back to all sleep problems</a></p>');
    expect(main.lastIndexOf('problem__all')).toBeGreaterThan(main.lastIndexOf('solution-grid'));
  });

  it('has one "Feedback" button per video and no feedback link or form of its own (the dialog and the footer\'s "Send feedback" are base.njk\'s, SPEC §13)', () => {
    // Each video's row has the button (project lead, 2026-11-13), hidden
    // until feedback.js runs; video-template.test.js checks its markup.
    const buttons = tags(main, 'button').filter((t) => attr(t, 'data-feedback-trigger') !== undefined);
    expect(buttons.map((t) => [attr(t, 'data-feedback-video'), attr(t, 'hidden')])).toEqual(pageVideos.map((id) => [id, '']));
    // "Feedback" appears nowhere else in the page's content.
    expect(text(main.replace(/<button\b[^>]*data-feedback-trigger[\s\S]*?<\/button>/g, ''))).not.toMatch(/feedback/i);
    expect(tags(main, 'a').filter((t) => /feedback/i.test(t))).toEqual([]);
    expect(main).not.toMatch(/<(form|textarea|dialog)\b/);
  });

  it('keeps a heading outline without skipped levels: h1, the problem video\'s h2, h2 sections, h3 solutions', () => {
    const levels = [...main.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i) expect(level, `heading ${i + 1}`).toBeLessThanOrEqual(levels[i - 1] + 1);
    });
    // Each card's title is an h3 in the template (and, with JavaScript, its face too).
    expect(levels.filter((l) => l === 3)).toHaveLength(solutions.length);
    // The only h4s are the worksheets headings (SPEC §7.6), each straight
    // after its card's h3; nothing is deeper.
    expect(levels.filter((l) => l === 4)).toHaveLength(solutions.filter((s) => worksheetsOf(s.video).length).length);
    levels.forEach((level, i) => {
      if (level === 4) expect(levels[i - 1], `heading ${i + 1}`).toBe(3);
    });
    expect(Math.max(...levels)).toBeLessThanOrEqual(4);
    const headings = [...main.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => [Number(m[1]), text(m[2])]);
    expect(headings.slice(0, 3)).toEqual([[1, data.title], [2, video(data.problem_video).data.title], [2, 'Is this you?']]);
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
// content, with no solutions.
describe('a stand-alone problem page: /problems/sharing-a-bed/', () => {
  const slug = 'sharing-a-bed';
  const { data } = model.problems.get(slug);
  const html = pageAt(site, `/problems/${slug}/`);
  const main = mainOf(html);
  const { data: v } = video(data.problem_video);

  it('is a stand-alone problem whose video has a handout and audio', () => {
    expect([data.standalone, data.solutions]).toEqual([true, undefined]);
    expect([Boolean(v.handout), Boolean(v.audio)]).toEqual([true, true]);
  });

  it('has no solutions section, solution cards, chips or solutions.js', () => {
    expect(main).not.toMatch(/class="solutions\b|solution-grid|class="solution\b|on-this-page|#main-solutions|#more-solutions/);
    expect(text(main)).not.toMatch(/Things to try|Main solutions|Other things that can help|If you want more/);
    expect(html).not.toContain('/js/solutions.js');
  });

  it('shows the problem video, in the video template with its title, description and every format, as the main content', () => {
    const wrapper = elementByClass(main, 'problem-video', 'div');
    const videos = elements(main, 'video', 'div');
    expect(videos).toHaveLength(1);
    expect(wrapper).toContain(videos[0]);
    expect(attr(tags(videos[0], 'div')[0], 'data-video')).toBe(data.problem_video);
    expect(text(elementByClass(wrapper, 'video-block__title', 'h2'))).toBe(v.title);
    expect(text(elementByClass(wrapper, 'video-block__desc', 'p'))).toBe(v.description);
    // No label: the problem's own video has none.
    expect(wrapper).not.toMatch(/video-block__top|step-chip|video-block__close/);
    expect(videos[0]).not.toMatch(/video__notice|notice-text/);
    expect(elements(main, 'youtube-note', 'p')).toHaveLength(1);
    const row = elementByClass(wrapper, 'video-controls', 'div');
    expect(tags(row, 'div')[0]).toBe('<div class="video-controls">');
    expect(tags(row, 'a').filter((t) => attr(t, 'data-handout') === data.problem_video)).toHaveLength(1);
    // The row's "Handout" is the page's only handout link (SPEC §15.1).
    expect(tags(main, 'a').filter((t) => attr(t, 'data-handout'))).toHaveLength(1);
    expect(text(elementByClass(row, 'format-button', 'a'))).toBe(`Handout : ${v.title} (PDF)`);
    expect(row).toContain(`id="audio-${data.problem_video}"`);
    expect(row.includes(`data-rating="${data.problem_video}"`)).toBe(true);
    expect(row).not.toMatch(/transcript/i);
  });

  it('keeps its headings in order: the title, its video\'s title, then "Is this you?" (and Related topics, when it has some)', () => {
    const headings = [...main.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => [Number(m[1]), text(m[2])]);
    expect(headings).toEqual([
      [1, data.title],
      [2, v.title],
      [2, 'Is this you?'],
      ...(data.related.length ? [[2, 'Related topics']] : []),
    ]);
  });

  it('works without JavaScript: a native "Audio only" disclosure, a plain handout link, and only "Feedback" and the rating hidden', () => {
    expect(tags(main, 'details').map((t) => attr(t, 'id'))).toEqual([`audio-${data.problem_video}`]);
    expect(main).toMatch(/<audio\b[^>]*\scontrols\b/);
    const hidden = [...main.matchAll(/<([a-z0-9]+)\b[^>]*\shidden(?=[\s>])[^>]*>/g)].map((m) => [m[1], attr(m[0], 'class')]);
    // The video's "Feedback" button (SPEC §13) and the ratings widget (SPEC
    // §12) need JavaScript; nothing else does.
    expect(hidden).toEqual([['button', 'format-button'], ['div', 'rating']]);
    expect(elementByClass(main, 'problem__all', 'p')).toBe('<p class="problem__all"><a href="/#sleep-problems">Back to all sleep problems</a></p>');
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
  const videos = [
    videoRow('full', { title: 'Settling your body', description: 'Words.', youtube_url: 'https://youtu.be/AbCdEfGhIjK', duration: '6:40', handout: 'full.pdf', audio: 'full.mp3' }),
    videoRow('bare', { title: 'Bare', description: 'The bare video.', youtube_url: 'https://www.youtube.com/watch?v=Zz_-9yXwVu0', duration: '1:05', handout: 'bare.pdf', audio: 'bare.mp3' }),
  ];
  const render = (solutions, ratings = false) =>
    env.renderString('{% from "problem/solutions.njk" import solutionsSection %}{{ solutionsSection("main", items, ratings) }}', {
      items: filters.solutionsByTier(solutions, videos).main,
      ratings,
    });

  const html = render([{ tier: 'main', video: 'full', blurb: 'Try this.' }, { tier: 'main', video: 'bare', blurb: 'Or this.' }]);
  const [full, bare] = elements(html, 'solution', 'li');

  it('puts the "Watch on YouTube" facade inside the panel, not the closed card, with no notice of its own', () => {
    const summary = full.match(/<summary[\s\S]*?<\/summary>/)[0];
    expect(summary).not.toMatch(/youtube/i);
    const panel = elementByClass(full, 'solution__panel', 'div');
    const facade = tags(panel, 'a').find((t) => attr(t, 'class') === 'video__facade');
    expect([attr(facade, 'href'), attr(facade, 'rel')]).toEqual(['https://www.youtube.com/watch?v=AbCdEfGhIjK', 'noreferrer']);
    expect(text(elementByClass(panel, 'video__facade', 'a'))).toBe('Watch on YouTube: Settling your body 6:40 , 6 minutes 40 seconds');
    expect(panel).not.toMatch(/video__notice|notice-text/);
    expect(attr(facade, 'aria-describedby')).toBe('youtube-note-text');
  });

  it('describes the card with its spoken length, and opens to the video template: header, video, row of controls', () => {
    expect(text(elementByClass(full, 'solution__length', 'span'))).toBe('Video, 6 minutes 40 seconds');
    const panel = elementByClass(full, 'solution__panel', 'div');
    const order = ['class="video-block__header" hidden', 'class="video-block__top"', 'class="step-chip step-chip--sm"', 'class="video-block__close"', 'class="video-block__title"', 'class="video-block__desc"', 'class="video-block__video"', 'class="video-controls"'].map((c) => panel.indexOf(c));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(elementByClass(panel, 'video-block__title', 'h3')).toBe('<h3 class="video-block__title" id="video-full-title" tabindex="-1">Settling your body</h3>');
    expect(text(elementByClass(panel, 'step-chip', 'span'))).toBe('1 Main');
    expect(text(elementByClass(panel, 'video-block__desc', 'p'))).toBe('Try this.');
  });

  it('gives the closed card nothing but its face: no quick Handout link (project lead, 2026-11-09)', () => {
    for (const card of [full, bare]) {
      const inner = card.match(/^<li[^>]*>([\s\S]*)<\/li>$/)[1].trim();
      expect(inner).toMatch(/^<details class="solution__disclosure" name="solution">[\s\S]*<\/details>$/);
      expect(card).not.toMatch(/solution__meta|solution__quick/);
      // Its only handout link is the row's, inside the panel.
      const handouts = tags(card, 'a').filter((t) => attr(t, 'data-handout'));
      expect(handouts).toHaveLength(1);
      expect(elementByClass(card, 'video-controls', 'div')).toContain(handouts[0]);
    }
    expect(full).not.toMatch(/transcript|Words\./i);
  });

  it('puts "Audio only" and the handout in one row right under the video in the open card', () => {
    const panel = elementByClass(full, 'solution__panel', 'div');
    const row = elementByClass(panel, 'video-controls', 'div');
    expect(tags(row, 'div')[0]).toBe('<div class="video-controls">');
    // "Audio only" first, so opening it never moves its button (SPEC §7.5).
    expect(row.indexOf('<details class="format-disclosure" id="audio-full">')).toBeGreaterThan(-1);
    expect(row.indexOf('<details class="format-disclosure" id="audio-full">')).toBeLessThan(row.indexOf('<a class="format-button"'));
    expect(panel.indexOf(row)).toBeGreaterThan(panel.indexOf('video__frame'));
  });

  it('shows the video\'s description, from data/videos.csv, on a solution without a blurb (SPEC §7.2)', () => {
    const [card] = elements(render([{ tier: 'main', video: 'bare' }]), 'solution', 'li');
    expect(text(elementByClass(card, 'solution__blurb', 'span'))).toBe('The bare video.');
    expect(text(elementByClass(card, 'video-block__desc', 'p'))).toBe('The bare video.');
    // A blurb replaces it, on this problem only.
    expect(text(elementByClass(bare, 'solution__blurb', 'span'))).toBe('Or this.');
    expect(bare).not.toContain('The bare video.');
  });

  it('renders "Audio only" and the handout for every video: the content check guarantees the files (SPEC §7.1)', () => {
    for (const [card, id] of [[full, 'full'], [bare, 'bare']]) {
      const row = elementByClass(card, 'video-controls', 'div');
      expect(row).toContain(`<audio class="format-audio" controls preload="none" src="/media/audio/${id}.mp3" data-media="${id}"`);
      expect(row).toContain(`<a class="format-button" href="/media/pdf/${id}.pdf" type="application/pdf" data-handout="${id}">`);
    }
  });

  it('renders nothing for a tier with no solutions (a stand-alone problem has none, SPEC §7.2)', () => {
    expect(render([]).trim()).toBe('');
    expect(env.renderString('{% from "problem/solutions.njk" import solutionsSection %}[{{ solutionsSection("extra", items) }}]', { items: [] })).toBe('[]');
  });

  // SPEC §7.6: the section a solution card adds after the video template.
  describe('with worksheets (data/worksheets.csv rows, SPEC §7.6)', () => {
    const row = (worksheet_id, video_id, title, file = `${worksheet_id}.pdf`) => ({ worksheet_id, video_id, title, file });
    const worksheets = [
      row('full-two', 'full', 'Second in the file'),
      row('bare-one', 'bare', 'The only one'),
      row('full-one', 'full', 'Plan & "do" <now>', 'Shared-File.PDF'),
      row('elsewhere', 'not-on-this-page', 'Another video'),
      row('full-three', 'full', 'It’s the third', 'Shared-File.PDF'),
    ];
    const solutions = [{ tier: 'main', video: 'full', blurb: 'Try this.' }, { tier: 'main', video: 'bare', blurb: 'Or this.' }];
    const renderWith = (rows, { ratings = false, feedback = false, list = solutions } = {}) =>
      env.renderString('{% from "problem/solutions.njk" import solutionsSection %}{{ solutionsSection("main", items, "a-page", ratings, feedback) }}', {
        items: filters.solutionsByTier(list, videos, rows).main,
        ratings,
        feedback,
      });
    const withSheets = renderWith(worksheets);
    const [sheetsFull, sheetsBare] = elements(withSheets, 'solution', 'li');
    const sectionOf = (card) => elementByClass(card, 'worksheets', 'section');

    it('lists a video\'s worksheets in the file\'s order, under "Worksheets", and one under "Worksheet"', () => {
      const icon = handoutIcon(sheetsFull);
      expect(squeeze(sectionOf(sheetsFull))).toBe(
        worksheetsSection('full', 'Settling your body', [
          { worksheet_id: 'full-two', title: 'Second in the file', file: 'full-two.pdf' },
          { worksheet_id: 'full-one', title: 'Plan & "do" <now>', file: 'Shared-File.PDF' },
          { worksheet_id: 'full-three', title: 'It’s the third', file: 'Shared-File.PDF' },
        ], icon),
      );
      expect(squeeze(sectionOf(sheetsBare))).toBe(worksheetsSection('bare', 'Bare', [{ worksheet_id: 'bare-one', title: 'The only one', file: 'bare-one.pdf' }], icon));
      expect(visibleText(elementByClass(sheetsFull, 'worksheets__title', 'h4'))).toBe('Worksheets');
      expect(visibleText(elementByClass(sheetsBare, 'worksheets__title', 'h4'))).toBe('Worksheet');
      // Another video's worksheet is on neither card.
      expect(withSheets).not.toMatch(/elsewhere|Another video/);
    });

    it('escapes a worksheet\'s title, and the video\'s title in the heading', () => {
      const section = sectionOf(sheetsFull);
      expect(section).toContain('Plan &amp; &quot;do&quot; &lt;now&gt;<span class="visually-hidden"> (PDF)</span>');
      expect(section).not.toMatch(/<now>|"do"/);
      const quoted = [videoRow('q', { title: 'Settling "your" <body>', description: 'D.', youtube_url: 'https://youtu.be/AbCdEfGhIj1', duration: '2:00', handout: 'q.pdf', audio: 'q.mp3' })];
      const html = env.renderString('{% from "problem/solutions.njk" import solutionsSection %}{{ solutionsSection("main", items, "a-page") }}', {
        items: filters.solutionsByTier([{ tier: 'main', video: 'q' }], quoted, [row('q-one', 'q', 'One')]).main,
      });
      expect(elementByClass(html, 'worksheets__title', 'h4')).toBe(
        '<h4 class="worksheets__title" id="solution-q-worksheets">Worksheet<span class="visually-hidden">: Settling &quot;your&quot; &lt;body&gt;</span></h4>',
      );
    });

    it('adds the section after the video template and changes nothing else in the card', () => {
      const without = renderWith([]);
      // Take the sections out, and the cards are as they are without worksheets.
      const stripped = elements(withSheets, 'worksheets', 'section').reduce((html, section) => html.replace(section, ''), withSheets);
      expect(squeeze(stripped)).toBe(squeeze(without));
      expect(without).not.toMatch(WORKSHEET_MARKUP);
      for (const card of [sheetsFull, sheetsBare]) {
        const panel = elementByClass(card, 'solution__panel', 'div');
        const block = elementByClass(panel, 'video-block', 'div');
        expect(squeeze(panel).endsWith(`${squeeze(block)}${squeeze(sectionOf(card))}</div>`)).toBe(true);
        expect(block).not.toMatch(WORKSHEET_MARKUP);
        expect(card.match(/<summary[\s\S]*?<\/summary>/)[0]).not.toMatch(WORKSHEET_MARKUP);
      }
    });

    it('renders no section, and no heading, for a video with no worksheets', () => {
      for (const rows of [[], undefined, [row('elsewhere', 'not-on-this-page', 'Another video')]]) {
        const html = renderWith(rows);
        expect(html).not.toMatch(WORKSHEET_MARKUP);
        expect(html).not.toMatch(/<h4\b/i);
        expect(html).toBe(renderWith([]));
      }
      // One card with, one without: only the first has the section.
      const [first, second] = elements(renderWith([row('full-one', 'full', 'One')]), 'solution', 'li');
      expect(elements(first, 'worksheets', 'section')).toHaveLength(1);
      expect(second).not.toMatch(WORKSHEET_MARKUP);
      expect(second).not.toMatch(/<h4\b/i);
    });

    // The word is the team's to use (a blurb, a video's title or
    // description, any page's text): only the section's markup means
    // "worksheets here", in these tests and in those of the built pages.
    it('leaves the word "worksheet" in a blurb, a title or a description alone: no section without a row, and the same section with one', () => {
      const wordy = [
        videoRow('full', { title: 'Your worksheet plan', description: 'Fill in the worksheet as you watch.', youtube_url: 'https://youtu.be/AbCdEfGhIjK', duration: '6:40', handout: 'full.pdf', audio: 'full.mp3' }),
        videoRow('bare', { title: 'Bare', description: 'This video has worksheets too.', youtube_url: 'https://www.youtube.com/watch?v=Zz_-9yXwVu0', duration: '1:05', handout: 'bare.pdf', audio: 'bare.mp3' }),
      ];
      const list = [{ tier: 'main', video: 'full', blurb: 'Try this. The worksheets below help you plan.' }, { tier: 'main', video: 'bare' }];
      const renderWordy = (rows) =>
        env.renderString('{% from "problem/solutions.njk" import solutionsSection %}{{ solutionsSection("main", items, "a-page") }}', {
          items: filters.solutionsByTier(list, wordy, rows).main,
        });
      const none = renderWordy([]);
      // The words are on the cards, and no section, link or file is.
      expect(text(none)).toContain('Try this. The worksheets below help you plan.');
      expect(text(none)).toContain('This video has worksheets too.');
      expect(text(none)).toContain('Your worksheet plan');
      expect(none).not.toMatch(WORKSHEET_MARKUP);
      expect(none).not.toMatch(/<h4\b/i);
      // With a row, the section is the card's last part, as for any video.
      const [first, second] = elements(renderWordy([row('full-one', 'full', 'A worksheet to print')]), 'solution', 'li');
      expect(squeeze(sectionOf(first))).toBe(worksheetsSection('full', 'Your worksheet plan', [{ worksheet_id: 'full-one', title: 'A worksheet to print', file: 'full-one.pdf' }], handoutIcon(first)));
      expect(elementByClass(first, 'video-block', 'div')).not.toMatch(WORKSHEET_MARKUP);
      expect(first.match(/<summary[\s\S]*?<\/summary>/)[0]).not.toMatch(WORKSHEET_MARKUP);
      expect(second).not.toMatch(WORKSHEET_MARKUP);
    });

    it('is the same section whatever the ratings and feedback switches say', () => {
      const sections = (html) => elements(html, 'worksheets', 'section');
      for (const options of [{ ratings: true }, { feedback: true }, { ratings: true, feedback: true }]) {
        expect(sections(renderWith(worksheets, options))).toEqual(sections(withSheets));
        // Still after the whole row of controls, the stars included.
        const [card] = elements(renderWith(worksheets, options), 'solution', 'li');
        const panel = elementByClass(card, 'solution__panel', 'div');
        const rowOfControls = elementByClass(panel, 'video-controls', 'div');
        expect(panel.indexOf(sectionOf(card))).toBeGreaterThan(panel.indexOf(rowOfControls) + rowOfControls.length);
      }
    });

    it('gives a video the same section on another problem, whatever its tier and number', () => {
      const elsewhere = env.renderString('{% from "problem/solutions.njk" import solutionsSection %}{{ solutionsSection("extra", items, "another-page") }}', {
        items: filters.solutionsByTier([{ tier: 'main', video: 'bare' }, { tier: 'extra', video: 'full' }], videos, worksheets).extra,
      });
      expect(sectionOf(elsewhere)).toBe(sectionOf(sheetsFull));
    });
  });

  describe('with ratings on (SPEC §12)', () => {
    const [onFull, onBare] = elements(render([{ tier: 'main', video: 'full', blurb: 'Try this.' }, { tier: 'main', video: 'bare', blurb: 'Or this.' }], true), 'solution', 'li');

    it('ends the open card\'s row of controls with the widget, after "Audio only" and the handout', () => {
      const panel = elementByClass(onFull, 'solution__panel', 'div');
      const row = elementByClass(panel, 'video-controls', 'div');
      expect(tags(row, 'div')[0]).toBe('<div class="video-controls">');
      const widget = elementByClass(row, 'rating', 'div');
      expect(tags(widget, 'div')[0]).toBe('<div class="rating" data-rating="full" hidden>');
      expect(row.indexOf(widget)).toBeGreaterThan(row.indexOf('id="audio-full"'));
      expect(row.indexOf(widget)).toBeGreaterThan(row.indexOf('<a class="format-button"'));
      expect(panel.indexOf('video-block__video')).toBeLessThan(panel.indexOf('video-controls'));
      expect(onFull.match(/data-rating="/g)).toHaveLength(1);
      expect(elementByClass(onFull, 'solution__face', 'summary')).not.toMatch(/rating/);
    });

    it('shows no rating summary or notice in the closed card', () => {
      expect(onFull).not.toMatch(/solution__meta|data-rating-summary|solution__rating|Ratings are anonymous|notice-text">Ratings/);
      // "You rated this" only in the status line's invisible sizer, never in the closed card.
      expect(visibleText(onFull)).not.toMatch(/You rated/);
    });

    it('never hides the row: it always holds "Audio only" and the handout, and only the widget waits for rating.js', () => {
      for (const card of [onFull, onBare]) {
        const row = elementByClass(card, 'video-controls', 'div');
        expect(tags(row, 'div')[0]).toBe('<div class="video-controls">');
        expect(row).toMatch(/format-button[\s\S]*<div class="rating" data-rating="[a-z]+" hidden>/);
      }
      expect(onBare).not.toMatch(/data-rating-reveal/);
    });

    it('renders the slots only for exactly true', () => {
      const off = render([{ tier: 'main', video: 'bare', blurb: 'Or this.' }], false);
      expect(render([{ tier: 'main', video: 'bare', blurb: 'Or this.' }], 'true')).toBe(off);
      expect(off).not.toMatch(/rating/);
    });
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
    for (const needle of ["setAttribute('aria-expanded'", "setAttribute('aria-controls'", "setAttribute('role', 'region')", "setAttribute('aria-labelledby'", 'pauseWithin(']) {
      expect(code).toContain(needle);
    }
    // No transcripts to reveal any more (SPEC §9.3).
    expect(code).not.toMatch(/sleepsteps:reveal|transcript/i);
  });
});
