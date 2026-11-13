// Design-token rules for the stylesheets (SPEC §7.5, §16).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFiles } from './helpers.js';

const CSS_DIR = 'src/css';
const sheets = listFiles(CSS_DIR, (f) => f.endsWith('.css')).map((file) => ({
  file,
  css: readFileSync(path.join(CSS_DIR, file), 'utf8'),
}));
const tokensCss = readFileSync(path.join(CSS_DIR, 'tokens.css'), 'utf8');
const tokensJson = JSON.parse(readFileSync('docs/design/reference/tokens.json', 'utf8'));

describe('tokens.css', () => {
  it.each(tokensJson.color.tokens.map((t) => [t.name, t.value]))('defines --%s as %s', (name, value) => {
    expect(tokensCss).toMatch(new RegExp(`--${name}:\\s*${value};`, 'i'));
  });

  it.each([...tokensJson.spacing.tokens, ...tokensJson.radius.tokens].map((t) => [t.name, t.value]))(
    'defines --%s as %s',
    (name, value) => {
      expect(tokensCss).toMatch(new RegExp(`--${name}:\\s*${value};`));
    },
  );

  it('defines the hover shadow from tokens.json', () => {
    const shadow = tokensJson.shadow.tokens.find((t) => t.name === 'shadow-hover').value;
    expect(tokensCss).toContain(`--shadow-hover: ${shadow};`);
  });

  it('uses system font stacks only, never the handoff web fonts', () => {
    expect(tokensCss).toMatch(/--font-body:\s*system-ui/);
    expect(tokensCss).toMatch(/--font-heading:\s*system-ui/);
    expect(tokensCss).not.toMatch(/Figtree|Source Sans/);
  });
});

// CSS named colours (CSS Color 4) and system colours, deprecated ones included.
// `transparent` and `currentColor` are allowed: they add no colour.
const NAMED_COLOURS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown
  burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
  darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid
  darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet
  deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro
  ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
  lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow
  lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
  lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine
  mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise
  mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab
  orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru
  pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
  seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan
  teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen
  accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field
  fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext
  visitedtext activeborder activecaption appworkspace background buttonhighlight buttonshadow
  captiontext inactiveborder inactivecaption inactivecaptiontext infobackground infotext menu menutext
  scrollbar threeddarkshadow threedface threedhighlight threedlightshadow threedshadow window
  windowframe windowtext`.split(/\s+/),
);

// Properties that take a colour, and custom properties (which carry colours
// into the ones that do).
const COLOUR_PROPERTY = /^(?:--|color$|background|border|outline|fill|stroke|box-shadow|text-shadow|text-decoration|text-emphasis|caret-color|accent-color|column-rule|scrollbar-color|stop-color|flood-color|lighting-color)/i;

/** Named colours used as values in `css`: ["prop: value", ...]. */
function namedColourValues(css) {
  const found = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, prop, value] of body.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
    if (!COLOUR_PROPERTY.test(prop)) continue;
    // Keywords only: not custom property names (var(--white)) or strings.
    const words = value.replace(/"[^"]*"|'[^']*'/g, '').match(/(?<![\w-])[a-z]+(?![\w-])/gi) ?? [];
    if (words.some((w) => NAMED_COLOURS.has(w.toLowerCase()))) found.push(`${prop}: ${value.trim()}`);
  }
  return found;
}

describe('the named-colour check', () => {
  it('catches named and system colours and ignores token names', () => {
    expect(namedColourValues('.x { color: white; border: 1px solid Red; --c: navy }')).toEqual([
      'color: white',
      'border: 1px solid Red',
      '--c: navy',
    ]);
    expect(namedColourValues('.x { background: Canvas; outline-color: currentColor }')).toEqual(['background: Canvas']);
    expect(
      namedColourValues('.x { color: var(--white); background: var(--teal-wash); border: 0; fill: none; --w: 2px }'),
    ).toEqual([]);
  });
});

describe.each(sheets.map((s) => [s.file, s.css]))('%s', (file, css) => {
  it.skipIf(file === 'tokens.css')('has no colour literals (use the tokens in tokens.css)', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
    expect(namedColourValues(css)).toEqual([]);
  });

  it('loads no fonts or remote resources', () => {
    expect(css).not.toMatch(/@font-face|@import|url\(/i);
  });

  it('never removes the focus outline', () => {
    expect(css).not.toMatch(/outline(-style)?\s*:\s*(none|0)\b/i);
  });
});

// M7's accessibility fixes (SPEC §7.5, §13): the feedback dialog's own ring
// inside its border, rings kept clear of the viewport's edge, and long
// addresses in sentence links that break rather than scroll the page.
describe('focus rings and sentence links (site.css, admin.css)', () => {
  const site = sheets.find((s) => s.file === 'site.css').css;
  const admin = sheets.find((s) => s.file === 'admin.css').css;
  /** The declarations of the first top-level rule with exactly this selector list. */
  const rule = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,\s*/g, ',\\s*');
    return css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`))?.[1] ?? '';
  };

  it("draws the feedback dialog's own focus ring inside its border, not on the backdrop", () => {
    expect(rule(site, '.feedback-dialog:focus-visible')).toMatch(
      /^\s*outline-offset: calc\(-1 \* \(var\(--focus-width\) \+ var\(--border-width\) \+ var\(--space-1\)\)\);\s*$/,
    );
    // It keeps the global ring's colour, deep-teal on the dialog's paper.
    expect(rule(site, '.feedback-dialog')).toMatch(/--focus-colour: var\(--deep-teal\);[\s\S]*background: var\(--paper\);/);
  });

  it('keeps focus rings clear of the viewport edge on the public and admin pages', () => {
    const ring = /outline: var\(--focus-width\) solid var\(--focus-colour\);\s*outline-offset: var\(--focus-offset\);\s*scroll-margin-block: var\(--space-3\);/;
    expect(rule(site, ':focus-visible')).toMatch(ring);
    expect(rule(admin, '.admin :focus-visible')).toMatch(ring);
  });

  it('breaks long addresses in sentence links, so text spacing never scrolls the page sideways (WCAG 1.4.12)', () => {
    const links = rule(site, '.notice--urgent a, .search-fallback a, .link-standalone a, .info-body p a, .notice-text a');
    expect(links).toMatch(/display: inline-flex;[\s\S]*min-height: var\(--target-min\);/);
    expect(links).toMatch(/overflow-wrap: anywhere;/);
  });
});

// The row of controls under each video (SPEC §7.5, §9.2, §12): one wrapping
// row, an open "Audio only" across its full width, the rating's parts as
// items of the row, and nothing left for transcripts or a ratings notice.
describe('the row of controls under each video (components.css)', () => {
  const css = sheets.find((s) => s.file === 'components.css').css;
  /** The declarations of the first rule with exactly this selector. */
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`))?.[1] ?? '';
  };

  it('is one flex row that wraps', () => {
    expect(rule('.video-controls')).toMatch(/display: flex;[\s\S]*flex-wrap: wrap;/);
  });

  it('gives an open "Audio only" the full width, so its player opens under its button', () => {
    expect(rule('.video-controls > .format-disclosure[open]')).toMatch(/flex-basis: 100%;/);
  });

  // SPEC §7.5 (project lead, 2026-11-09): one video template everywhere.
  // Every template takes its layout from one query container, the page's
  // two-column wrapper (.with-sidebar, site.css): its width follows the
  // window's, the same on Start here and on problem pages, so every video
  // on the site switches at one window width and never back, and no page
  // shows two layouts at once. (The main column's own width doesn't: it
  // narrows when the sidebar moves from above it to beside it.) One column
  // in the DOM's order (header, video, row) below 1080px, and from 1080px
  // the video (3fr) beside the header (2fr) with the row under both.
  // 1080 = a problem page's sidebar (280) + gap (32) + a 768px main column;
  // 768 = 724 + 2 × (an open card's 2px border + 20px panel padding).
  it('lays out every video on the site the same way, by the two-column wrapper\'s width (site.css, components.css)', () => {
    const siteCss = sheets.find((s) => s.file === 'site.css').css;
    const siteRule = (selector) => siteCss.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';
    const main = siteRule('.with-sidebar__main');
    expect(siteRule('.with-sidebar')).toMatch(/container: video-context \/ inline-size;/);
    expect(main).toMatch(/flex: 999 1 600px;/);
    // One container on the page: not the main column, whose width is not
    // the same on the two page types and goes down as well as up.
    expect(main).not.toMatch(/container/);
    expect(siteCss.match(/container: video-context/g)).toHaveLength(1);
    const threshold = Number(css.match(/@container video-context \(min-width: (\d+)px\)/)?.[1]);
    expect(threshold).toBe(1080);
    // On both page types the sidebar is already beside the main column at
    // the switch (so the main column only widens from there), and the main
    // column has the 768px an open card needs.
    const px = (value) => Number(value.match(/^(\d+)px$/)?.[1] ?? tokensCss.match(new RegExp(`${value.match(/^var\((--[\w-]+)\)$/)?.[1]}: (\\d+)px;`))?.[1]);
    const basis = (declarations, fallback) => declarations.match(/flex(?:-basis)?: (?:\d+ \d+ )?(\d+px);/)?.[1] ?? fallback;
    const gap = (declarations, fallback) => declarations.match(/(?:^|\s)gap: ([^;]+);/)?.[1] ?? fallback;
    const plain = { side: basis(siteRule('.with-sidebar__side')), gap: gap(siteRule('.with-sidebar')), main: basis(main) };
    const roomy = {
      side: basis(siteRule('.with-sidebar--roomy > .with-sidebar__side'), plain.side),
      gap: gap(siteRule('.with-sidebar--roomy'), plain.gap),
      main: basis(siteRule('.with-sidebar--roomy > .with-sidebar__main'), plain.main),
    };
    expect([plain, roomy].map((l) => [px(l.side), px(l.gap), px(l.main)])).toEqual([[280, 32, 600], [260, 40, 560]]);
    for (const layout of [plain, roomy]) {
      expect(px(layout.side) + px(layout.gap) + px(layout.main)).toBeLessThanOrEqual(threshold);
      expect(threshold - px(layout.side) - px(layout.gap)).toBeGreaterThanOrEqual(768);
    }
    // The template is no container of its own, and no other rule names one
    // for it.
    expect(rule('.video-block')).toBe('');
    for (const s of sheets) expect(s.css, s.file).not.toMatch(/video-block \/ inline-size|@container video-block\b/);
    expect(rule('.video-block__grid')).toMatch(/display: grid;[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
    const wide = css.match(/@container video-context \(min-width: 1080px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(wide).not.toBe('');
    expect(wide).toMatch(/\.video-block__grid \{[^}]*grid-template-columns: minmax\(0, 3fr\) minmax\(0, 2fr\);[^}]*grid-template-areas:\s*"video header"\s*"controls controls";/);
    expect(wide).toMatch(/\.video-block__header \{\s*grid-area: header;/);
    expect(wide).toMatch(/\.video-block__video \{\s*grid-area: video;/);
    expect(wide).toMatch(/\.video-block__grid > \.video-controls \{\s*grid-area: controls;/);
    // A card's header that ships hidden (no JavaScript) leaves no empty column.
    expect(wide).toMatch(/\.video-block__header\[hidden\] ~ \* \{\s*grid-column: 1 \/ -1;/);
    // No page lays a video out on its own any more.
    for (const s of sheets) {
      expect(s.css, s.file).not.toMatch(/problem-block|solution__tools|solution__header|solution__heading|solution__lede|solution__meta|solution__quick|start-chapter__(head|num|title|desc|eyebrow)|@container (solution|problem-top)\b|video--lg|video__title:not/);
    }
  });

  // A video's "Feedback" button (SPEC §7.5, §13): a <button> with the
  // handout link's class, so one rule gives both their look; the button's
  // own rule only undoes what a browser adds to a <button>.
  it('gives a video\'s "Feedback" button the handout link\'s look, and keeps it hidden until feedback.js shows it', () => {
    const siteCss = sheets.find((s) => s.file === 'site.css').css;
    // `hidden` wins over the class's display, in whatever order the sheets load.
    expect(rule('.format-button')).toMatch(/display: inline-flex;/);
    expect(siteCss).toMatch(/(?:^|\n)\[hidden\] \{\s*display: none !important;\s*\}/);
    for (const s of sheets) expect(s.css, s.file).not.toMatch(/\.format-button\[hidden\]|\[data-feedback-video\]/);
    // One look: 48px tall on phones and 44px from 600px, outlined in deep-teal on white.
    expect(rule('.format-button')).toMatch(/min-height: var\(--target-lg\);[\s\S]*border: var\(--border-width\) solid var\(--deep-teal\);[\s\S]*background: var\(--white\);[\s\S]*color: var\(--deep-teal\);/);
    expect(css).toMatch(/@media \(min-width: 37\.5em\) \{\s*\.format-button \{\s*min-height: var\(--target-min\);/);
    // The button adds no size, colour or font of its own (site.css's base rule gives every button the page's font).
    expect(rule('button.format-button').replace(/\s+/g, ' ').trim()).toBe('margin: 0; cursor: pointer;');
    expect(siteCss).toMatch(/(?:^|\n)button,\ninput,\nselect,\ntextarea \{\s*font: inherit;\s*\}/);
    // And it hovers as the handout link does.
    expect(css).toMatch(/a\.format-button:hover,\nbutton\.format-button:hover,\n\.format-disclosure__toggle:hover > \.format-button \{\s*background: var\(--teal-wash\);\s*color: var\(--deep-teal\);\s*\}/);
  });

  it('shows the dialog\'s line for a video under its heading, and nothing while it is hidden (site.css)', () => {
    const siteCss = sheets.find((s) => s.file === 'site.css').css;
    const about = siteCss.match(/(?:^|\n)\.feedback__about \{([^}]*)\}/)?.[1] ?? '';
    expect(about.replace(/\s+/g, ' ').trim()).toBe('margin-top: var(--space-2); font-weight: var(--weight-semibold); overflow-wrap: break-word;');
    // No display of its own, so `hidden` hides it even without the !important rule.
    expect(about).not.toMatch(/display/);
  });

  it('makes the rating\'s fieldset and status line items of the row, the status line on a line of its own', () => {
    expect(rule('.rating')).toMatch(/display: contents;/);
    expect(rule('.rating__status-box')).toMatch(/flex: 1 1 100%;/);
  });

  it.each(sheets.map((s) => [s.file, s.css]))('%s styles no transcript, print sheet, card rating summary or white Start here bar', (file, sheet) => {
    expect(sheet).not.toMatch(/transcript|print-sheet|data-printing|solution__rating|rating--(row|card)|start-chapter__bar|\.formats\b/);
  });
});

// The worksheets section of an open solution card (SPEC §7.5, §7.6): a
// keyline, a heading in the card's title style, then the links, which are
// the row's outlined buttons, so nothing sizes or colours them again.
describe('the worksheets of an open solution card (pages/problem.css)', () => {
  const css = sheets.find((s) => s.file === 'pages/problem.css').css;
  const components = sheets.find((s) => s.file === 'components.css').css;
  /** The declarations of the first top-level rule with exactly this selector, on one line. */
  const rule = (sheet, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,\s*/g, ',\\s*');
    return (sheet.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`))?.[1] ?? '').replace(/\s+/g, ' ').trim();
  };

  it('sets the section off with a keyline above it, spaced by tokens', () => {
    expect(rule(css, '.worksheets')).toBe('margin-top: var(--space-5); padding-top: var(--space-5); border-top: var(--border-width) solid var(--keyline);');
  });

  // While the rating shows, the row ends with its status line, kept blank
  // until there is an answer (SPEC §11): with the section's whole margin
  // under it, the blank above the keyline was 52px (80px on a phone)
  // against 16px below. The section then adds only the row's own gap,
  // which keeps an answer off the keyline; nothing changes while the
  // rating is hidden (no JavaScript) or absent (ratings off).
  it('adds only the row\'s own gap above the keyline while the rating\'s status line is there', () => {
    const selector = '.video-block:has(.rating:not([hidden])) + .worksheets';
    expect(rule(css, selector)).toBe('margin-top: var(--space-3);');
    // The gap between the row's lines: the stars and the status line.
    expect(rule(components, '.video-controls')).toMatch(/gap: var\(--space-3\) /);
    // Never none: an answer would sit on the keyline.
    expect(rule(css, selector)).not.toMatch(/margin-top: 0/);
    // After the section's own rule, which it overrides, and outside any media query.
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(plain.indexOf(`\n${selector} {`)).toBeGreaterThan(plain.indexOf('\n.worksheets {'));
    // The status line it counts on: the rating's last part, an item of the row (display: contents).
    expect(rule(components, '.rating')).toBe('display: contents;');
    expect(rule(components, '.rating__status-box')).toMatch(/flex: 1 1 100%;/);
  });

  it('gives the heading the card\'s own title style: the closed card\'s title', () => {
    const title = rule(css, '.worksheets__title');
    expect(title).toBe('margin-bottom: var(--space-4); font-family: var(--font-heading); font-size: var(--fs-card-title); line-height: var(--lh-card-title); color: var(--night-teal);');
    expect(title.replace('margin-bottom: var(--space-4); ', '')).toBe(rule(css, '.solution__title'));
  });

  it('wraps the links, each whole, in a list without markers', () => {
    expect(rule(css, '.worksheets__list')).toBe('display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-4); padding: 0; list-style: none;');
    // The same gaps as the row of controls above it.
    expect(rule(components, '.video-controls')).toMatch(/flex-wrap: wrap;[\s\S]*gap: var\(--space-3\) var\(--space-4\);/);
    expect(rule(css, '.worksheets__list > li')).toBe('display: flex; max-width: 100%;');
  });

  it('lets a long title wrap inside its button, and a long word break, so the card never scrolls sideways', () => {
    expect(rule(css, '.worksheets__list .format-button')).toBe('justify-content: flex-start; min-width: 0; padding-block: var(--space-3); text-align: start; overflow-wrap: anywhere;');
  });

  // A title on two lines had 6px above and below it in a 50px button (the
  // row's buttons pad 4px); with 8px it has 10px, in 58px. One line and
  // that padding come to less than the button's own height, so a one-line
  // title's button is still 44px (48px on a phone), like the row's.
  it('gives a wrapped title room above and below, and leaves a one-line title\'s button at .format-button\'s height', () => {
    const px = (name) => {
      const value = tokensCss.match(new RegExp(`--${name}:\\s*([^;]+);`))[1].trim();
      const rem = value.match(/^calc\((\d+)rem \/ 16\)$/);
      return rem ? Number(rem[1]) : Number(value.match(/^(\d+)px$/)[1]);
    };
    expect(rule(components, '.format-button')).toMatch(/padding: var\(--space-1\) var\(--space-5\);[\s\S]*line-height: var\(--lh-label\);/);
    expect(px('space-3')).toBeGreaterThan(px('space-1'));
    const oneLine = px('lh-label') + 2 * px('space-3') + 2 * px('border-width');
    expect(oneLine).toBeLessThanOrEqual(px('target-min'));
    expect(px('target-min')).toBeLessThan(px('target-lg'));
  });

  it('leaves the links\' size and colours to .format-button: 48px tall on phones, 44px from 600px', () => {
    const all = css.replace(/\/\*[\s\S]*?\*\//g, '');
    // Every rule that styles the section or anything in it.
    const rules = [...all.matchAll(/(?:^|\n)\s*([^{}@\n][^{}]*?) \{([^}]*)\}/g)].filter(([, selector]) => /\.worksheets/.test(selector));
    expect(rules.map(([, selector]) => selector.replace(/\s+/g, ' ').trim())).toEqual([
      '.worksheets', '.video-block:has(.rating:not([hidden])) + .worksheets', '.worksheets__title', '.worksheets__list', '.worksheets__list > li', '.worksheets__list .format-button',
      '.problem__back, .on-this-page, .worksheets',
    ]);
    for (const [, selector, body] of rules) {
      // No height, type, colour or border of their own, and no padding
      // but the links' room above and below a wrapped title (above).
      if (/format-button|__list/.test(selector)) {
        expect(body.replace(/padding-block: var\(--space-3\);/, ''), selector).not.toMatch(/(?:min-|max-)?height|font-size|line-height|color|background|border|padding(?!: 0;)/);
      }
    }
    expect(rules.filter(([, , body]) => /padding-block/.test(body)).map(([, selector]) => selector.trim())).toEqual(['.worksheets__list .format-button']);
    expect(rule(components, '.format-button')).toMatch(/min-height: var\(--target-lg\);/);
    expect(components).toMatch(/@media \(min-width: 37\.5em\) \{\s*\.format-button \{\s*min-height: var\(--target-min\);/);
  });

  it('is styled by the problem page\'s stylesheet alone', () => {
    for (const s of sheets) {
      // The staff pages' sheet, which no public page loads (below), names
      // worksheets too: only the id cell of its "Worksheets opened" table
      // (SPEC §14.4), which wraps as its other ids do.
      if (s.file === 'admin.css') continue;
      if (s.file !== 'pages/problem.css') expect(s.css.replace(/\/\*[\s\S]*?\*\//g, ''), s.file).not.toMatch(/worksheet/i);
    }
    const admin = sheets.find((s) => s.file === 'admin.css').css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(admin.match(/[^\s{},]*worksheet[^\s{},]*/gi)).toEqual(['.worksheet-id', '.worksheet-id']);
  });

  // On paper a link can't open: the section goes wherever the row of
  // controls above it goes.
  it('hides the section in print, as the row of controls is hidden', () => {
    const print = (sheet) => (sheet.match(/@media print \{([\s\S]*?)\n\}/)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const hidden = (sheet) => [...print(sheet).matchAll(/\n {2}([^{}]+) \{\s*display: none;\s*\}/g)].flatMap((m) => m[1].split(/,\s*/).map((x) => x.trim()));
    expect(hidden(components)).toEqual(['.video', '.video-block__top', '.video-controls']);
    expect(hidden(css)).toEqual(['.problem__back', '.on-this-page', '.worksheets']);
    // One print block in each sheet, so nothing shows the section again.
    expect(css.match(/@media print/g)).toHaveLength(1);
  });
});

// Rules that could never apply, removed in review (2026-11-13). Each names
// what would have to come back with the rule.
describe('no stylesheet styles what no page can show', () => {
  const sheet = (file) => sheets.find((s) => s.file === file).css;
  const all = sheets.filter((s) => s.file !== 'admin.css');

  it('has no box for placeholder copy: no template or script gives an element the class', () => {
    for (const s of all) expect(s.css, s.file).not.toMatch(/\.placeholder\b/);
  });

  it('turns a solution card\'s chevron only where it shows: an open <details> without JavaScript', () => {
    const css = sheet('pages/problem.css');
    // With JavaScript an open card's face, chevron and all, is hidden.
    expect(css).toMatch(/\n\.solution\.is-open \.solution__face-heading \{\s*display: none;\s*\}/);
    expect(css).not.toMatch(/aria-expanded="true"\] \.solution__chevron/);
    expect(css).toMatch(/\n\.solution__disclosure\[open\] > \.solution__face \.solution__chevron \.icon \{\s*transform: rotate\(180deg\);\s*\}/);
    // The icon is rendered at its size (problem/solutions.njk), so no rule
    // or token repeats it.
    expect(readFileSync('src/_includes/problem/solutions.njk', 'utf8')).toContain("<span class=\"solution__chevron\" aria-hidden=\"true\">{{ icon('chevron-down', 18) }}</span>");
    expect(css).not.toMatch(/\.solution__chevron \.icon \{\s*width/);
    for (const s of sheets) expect(s.css, s.file).not.toMatch(/--icon-md/);
  });

  it('lays out nothing in the video wrapper, whose one child is the frame', () => {
    const video = sheet('components.css').match(/\n\.video \{([^}]*)\}/)?.[1] ?? '';
    expect(video).toMatch(/--video-inset:/);
    expect(video).not.toMatch(/display|flex|gap/);
  });

  it('has one size of step chip, the solution cards\' 20px disc, with no modifier for it', () => {
    const css = sheet('components.css');
    expect(css.match(/\n\.step-chip \{([^}]*)\}/)?.[1] ?? '').toMatch(/--step-disc: 20px;[\s\S]*\n {2}gap: var\(--space-2\);/);
    for (const s of all) expect(s.css, s.file).not.toMatch(/step-chip--sm/);
    for (const file of ['partials/step-chip.njk', 'partials/video-block.njk', 'problem/solutions.njk']) {
      expect(readFileSync(`src/_includes/${file}`, 'utf8'), file).not.toMatch(/variant='sm|'sm'/);
    }
  });
});

// Forced colours (site.css hides every settling arc: the SVG keeps its own
// fill, a block of teal on the visitor's chosen ground).
describe('forced colours', () => {
  it('hides the settling arc in the video frames too, where a heavier rule shows it from 600px (components.css)', () => {
    const css = sheets.find((s) => s.file === 'components.css').css;
    const site = sheets.find((s) => s.file === 'site.css').css;
    expect(site).toMatch(/@media \(forced-colors: active\) \{[^}]*\n {2}\.arc \{\s*display: none;\s*\}/);
    // (0,2,0) from 600px: site.css's `.arc` (0,1,0) can't hide it.
    const shown = css.indexOf('  .video__media .arc {\n    display: block;\n  }');
    expect(shown).toBeGreaterThan(-1);
    const forced = css.slice(css.indexOf('@media (forced-colors: active) {'));
    expect(forced).toMatch(/^@media \(forced-colors: active\) \{[\s\S]*?\n {2}\.video__media \.arc \{\s*display: none;\s*\}[\s\S]*?\n\}/);
    // The same weight as the rule that shows it, so it must come later.
    expect(css.indexOf('@media (forced-colors: active) {')).toBeGreaterThan(shown);
  });
});

// On paper: backgrounds don't print, so paper text on a teal or ink ground
// comes out pale grey or not at all, and a control that can't be used on
// paper has no place there.
describe('print', () => {
  /** A sheet's `@media print` block, without comments. */
  const printOf = (file) => (sheets.find((s) => s.file === file).css.match(/@media print \{([\s\S]*?)\n\}/)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  /** The selectors of the block's `display: none` rules. */
  const hidden = (print) => [...print.matchAll(/\n {2}([^{}]+) \{\s*display: none;\s*\}/g)].flatMap((m) => m[1].split(/,\s*/).map((sel) => sel.trim()));

  it('turns every teal ground\'s paper text to ink, on every page (site.css)', () => {
    const print = printOf('site.css');
    // .on-dark is the one class that gives a ground paper text: every title
    // band, Home's hero and Start here's band and end card.
    expect(print).toMatch(/\n {2}\.on-dark \{\s*background: none;\s*color: var\(--ink\);\s*\}/);
    expect(hidden(print)).toContain('.arc');
    // The pages don't each repeat it.
    for (const file of ['pages/home.css', 'pages/start.css']) expect(printOf(file), file).not.toMatch(/background: none|color: var\(--ink\)|\.arc\b/);
  });

  it('prints Getting urgent help\'s call cards, their numbers included, in ink with an ink edge (urgent-help.css)', () => {
    const print = printOf('pages/urgent-help.css');
    // Both grounds go (the first card's ink and the others' deep-teal), in
    // case the reader prints backgrounds: ink text on either would be lost.
    expect(print).toMatch(/\n {2}\.call-card a,\s*\.call-card a:hover,\s*\.call-card--first a \{\s*border-color: var\(--ink\);\s*background: none;\s*color: var\(--ink\);\s*\}/);
  });

  it('prints no Close button or label chip above a video\'s title (components.css)', () => {
    expect(hidden(printOf('components.css'))).toEqual(['.video', '.video-block__top', '.video-controls']);
  });
});

// The staff pages' stylesheet (SPEC §14.4): loaded after tokens.css alone,
// and printable as a report: no controls, downloads or contents list on
// paper, and table headers repeated on each page.
describe('admin.css', () => {
  const css = sheets.find((s) => s.file === 'admin.css').css;
  const print = (css.match(/@media print \{([\s\S]*?)\n\}/)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');

  it('hides the controls, the contents list and the downloads when printed', () => {
    const hidden = print.match(/\n {2}([^{}]+) \{\s*display: none;\s*\}/)?.[1].split(/,\s*/).map((s) => s.trim()) ?? [];
    expect(hidden).toEqual(
      // Scoped under .admin, so they outrank the 44px links' display: inline-flex.
      ['.skip-link', '.admin-header__signout', '.range', '.range-current__reset', '.admin-toc', '.admin-section--downloads', '.export'].map((s) => `.admin ${s}`),
    );
  });

  it('repeats table headers on each printed page and keeps rows and messages whole', () => {
    expect(print).toMatch(/thead \{\s*display: table-header-group;\s*\}/);
    expect(print).toMatch(/tr,\s*\.feedback-item \{\s*break-inside: avoid;\s*\}/);
    expect(print).toMatch(/\.table-scroll \{\s*overflow: visible;\s*\}/);
    // The night-teal header band doesn't print, so its text turns ink.
    expect(print).toMatch(/\.admin-header \{[^}]*background: none;[^}]*color: var\(--ink\);/);
  });

  it('scrolls a wide table inside its region, never the page, and keeps messages as stored', () => {
    expect(css).toMatch(/\.table-scroll \{\s*max-width: 100%;\s*overflow-x: auto;\s*\}/);
    expect(css).toMatch(/\.feedback-item__message \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;/);
  });

  // Ids and search text in a table: a worksheet's id (SPEC §14.4, "Worksheets
  // opened") wraps exactly as a page's or a video's does.
  it('breaks ids and search text at their hyphens on screen, and anywhere on paper, a worksheet id included', () => {
    // The selector list as it is written, one selector a line, at `indent`.
    const list = (indent) => ['page-name', 'page-id', 'video-id', 'worksheet-id', 'search-text'].map((name) => `${indent}\\.${name}`).join(',\\n');
    expect(css).toMatch(new RegExp(`\\n${list('')} \\{\\s*overflow-wrap: break-word;\\s*\\}`));
    expect(print).toMatch(new RegExp(`\\n${list('  ')} \\{\\s*overflow-wrap: anywhere;\\s*\\}`));
  });

  it('keeps every control and link at least 44px tall', () => {
    expect(css).toMatch(/\.admin-main a,\s*\.admin-header a \{\s*display: inline-flex;\s*align-items: center;\s*min-height: var\(--target-min\);/);
    expect(css).toMatch(/\.field input \{[^}]*min-height: var\(--target-lg\);/);
    expect(css).toMatch(/\.range__submit,\s*\.admin-button \{[^}]*min-height: var\(--target-lg\);/);
  });

  it("resets button and input fonts at one class's weight, so a button's class still sets its weight", () => {
    // `.admin button { font: inherit }` (0,1,1) outranked `.admin-button`
    // (0,1,0) and reset its font-weight: "Show" and the download button
    // rendered at 400.
    expect(css).toMatch(/\n\.admin :where\(button, input\) \{\s*font: inherit;\s*\}/);
    expect(css).not.toMatch(/\.admin (?:button|input)\b[^{]*\{\s*font: inherit;/);
    expect(css).toMatch(/\.range__submit,\s*\.admin-button \{[^}]*font-weight: var\(--weight-semibold\);/);
  });

  it('is the only stylesheet that styles the admin pages, and styles nothing on the public site', () => {
    for (const { file, css: sheet } of sheets) {
      if (file !== 'admin.css') expect(sheet, file).not.toMatch(/\.admin\b|admin-/);
    }
    // Every rule is scoped to the admin pages' own classes or elements inside body.admin.
    expect(css).not.toMatch(/\n(?:body|main|header|footer|a|p|h[1-4]|table|th|td) \{/);
  });
});
