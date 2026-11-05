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
