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
  // Every template on a page switches at the width of the page's main
  // column (one query container, site.css), so the problem video and an
  // open card never show two layouts at once: one column in the DOM's order
  // (header, video, row) below 768px, and from 768px the video (3fr) beside
  // the header (2fr) with the row under both. 768 = 724 + 2 × (an open
  // card's 2px border + 20px panel padding).
  it('lays out every video on a page the same way, by the main column\'s width (site.css, components.css)', () => {
    const siteCss = sheets.find((s) => s.file === 'site.css').css;
    const main = siteCss.match(/(?:^|\n)\.with-sidebar__main \{([^}]*)\}/)?.[1] ?? '';
    expect(main).toMatch(/container: video-context \/ inline-size;/);
    expect(main).toMatch(/flex: 999 1 600px;/);
    // The template is no container of its own, and no other rule names one
    // for it.
    expect(rule('.video-block')).toBe('');
    for (const s of sheets) expect(s.css, s.file).not.toMatch(/video-block \/ inline-size|@container video-block\b/);
    expect(rule('.video-block__grid')).toMatch(/display: grid;[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
    const wide = css.match(/@container video-context \(min-width: 768px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
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

  it('makes the rating\'s fieldset and status line items of the row, the status line on a line of its own', () => {
    expect(rule('.rating')).toMatch(/display: contents;/);
    expect(rule('.rating__status-box')).toMatch(/flex: 1 1 100%;/);
  });

  it.each(sheets.map((s) => [s.file, s.css]))('%s styles no transcript, print sheet, card rating summary or white Start here bar', (file, sheet) => {
    expect(sheet).not.toMatch(/transcript|print-sheet|data-printing|solution__rating|rating--(row|card)|start-chapter__bar|\.formats\b/);
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

  it('keeps every control and link at least 44px tall', () => {
    expect(css).toMatch(/\.admin-main a,\s*\.admin-header a \{\s*display: inline-flex;\s*align-items: center;\s*min-height: var\(--target-min\);/);
    expect(css).toMatch(/\.field input \{[^}]*min-height: var\(--target-lg\);/);
    expect(css).toMatch(/\.range__submit,\s*\.admin-button \{[^}]*min-height: var\(--target-lg\);/);
  });

  it('is the only stylesheet that styles the admin pages, and styles nothing on the public site', () => {
    for (const { file, css: sheet } of sheets) {
      if (file !== 'admin.css') expect(sheet, file).not.toMatch(/\.admin\b|admin-/);
    }
    // Every rule is scoped to the admin pages' own classes or elements inside body.admin.
    expect(css).not.toMatch(/\n(?:body|main|header|footer|a|p|h[1-4]|table|th|td) \{/);
  });
});
