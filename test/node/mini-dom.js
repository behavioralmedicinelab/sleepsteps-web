// A small DOM for running the browser modules (players.js, solutions.js,
// problems.js) in the node tests, without a DOM package (SPEC §5). It covers
// only what those modules use, on our own well-formed template HTML:
//
// - parsing: elements, attributes, text, comments, void and self-closing
//   tags, and the few character references our templates produce;
// - selectors: type, #id, .class, [attr], [attr="value"] and :scope,
//   joined by descendant or child (>) combinators, in comma lists;
// - Node/Element: append, replaceWith, replaceChildren, remove, contains,
//   cloneNode, closest, matches, querySelector(All), attributes, id,
//   className, classList, dataset, hidden, textContent, value/checked
//   (inputs), open (details, firing "toggle"), focus with
//   document.activeElement, click()
//   with the default actions of <summary> and radio inputs, events that
//   bubble to the document, and getClientRects() (via `isRendered`);
// - a window with location (hash and search), timers (the global ones, so
//   fake timers work), events and print().
//
// installDom(html) puts document, window, location and HTMLDetailsElement on
// globalThis, as a browser would, and returns { document, window, restore }.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (text) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref) => {
    if (ref[0] !== '#') return ENTITIES[ref.toLowerCase()] ?? whole;
    return String.fromCodePoint(ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1)));
  });

const camelToData = (prop) => `data-${prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// ---- Selectors -------------------------------------------------------------

const selectorCache = new Map();

function parseCompound(text) {
  const m = /^(\*|[a-z][\w-]*)?((?:#[\w-]+|\.[\w-]+|\[[^\]]+\]|:scope)*)$/i.exec(text);
  if (!m) throw new Error(`mini-dom: unsupported selector "${text}"`);
  const compound = { tag: m[1] && m[1] !== '*' ? m[1].toLowerCase() : null, ids: [], classes: [], attrs: [], scope: false };
  for (const [part] of m[2].matchAll(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:scope/g)) {
    if (part === ':scope') compound.scope = true;
    else if (part[0] === '#') compound.ids.push(part.slice(1));
    else if (part[0] === '.') compound.classes.push(part.slice(1));
    else {
      const a = /^\[\s*([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]$/.exec(part);
      if (!a) throw new Error(`mini-dom: unsupported attribute selector "${part}"`);
      compound.attrs.push({ name: a[1].toLowerCase(), value: a[2] ?? a[3] ?? a[4] });
    }
  }
  return compound;
}

function parseSelector(selector) {
  if (selectorCache.has(selector)) return selectorCache.get(selector);
  const list = selector.split(',').map((complex) => {
    const tokens = complex.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
    const steps = [];
    let combinator = null;
    for (const token of tokens) {
      if (token === '>') combinator = '>';
      else {
        steps.push({ combinator, compound: parseCompound(token) });
        combinator = ' ';
      }
    }
    return steps;
  });
  selectorCache.set(selector, list);
  return list;
}

function matchesCompound(el, c, scope) {
  if (c.scope && el !== scope) return false;
  if (c.tag && el.localName !== c.tag) return false;
  if (c.ids.some((id) => el.id !== id)) return false;
  if (c.classes.some((cls) => !el.classList.contains(cls))) return false;
  return c.attrs.every(({ name, value }) => el.hasAttribute(name) && (value === undefined || el.getAttribute(name) === value));
}

function matchesSteps(el, steps, i, scope) {
  if (!matchesCompound(el, steps[i].compound, scope)) return false;
  if (i === 0) return true;
  const { combinator } = steps[i];
  let parent = el.parentElement;
  if (combinator === '>') return parent !== null && matchesSteps(parent, steps, i - 1, scope);
  for (; parent; parent = parent.parentElement) {
    if (matchesSteps(parent, steps, i - 1, scope)) return true;
  }
  return false;
}

const matchesSelector = (el, selector, scope) =>
  parseSelector(selector).some((steps) => matchesSteps(el, steps, steps.length - 1, scope));

function* descendants(node) {
  for (const child of node.childNodes) {
    if (child instanceof Element) {
      yield child;
      yield* descendants(child);
    }
  }
}

// ---- Nodes -----------------------------------------------------------------

export class Node {
  constructor(doc) {
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
    this.listeners = new Map();
  }

  get parentElement() {
    return this.parentNode instanceof Element ? this.parentNode : null;
  }

  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument;
  }

  get textContent() {
    return this.childNodes.map((n) => n.textContent).join('');
  }

  set textContent(value) {
    this.replaceChildren(String(value ?? ''));
  }

  #adopt(nodes) {
    return nodes.map((n) => {
      const node = typeof n === 'string' ? new Text(this.ownerDocument, n) : n;
      node.remove();
      node.parentNode = this;
      return node;
    });
  }

  append(...nodes) {
    this.childNodes.push(...this.#adopt(nodes));
  }

  replaceChildren(...nodes) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }

  remove() {
    const parent = this.parentNode;
    if (!parent) return;
    parent.childNodes.splice(parent.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }

  replaceWith(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const marker = new Text(this.ownerDocument, '');
    parent.childNodes.splice(parent.childNodes.indexOf(this), 1, marker);
    marker.parentNode = parent;
    this.parentNode = null;
    const adopted = parent.#adopt(nodes.filter((n) => n !== marker));
    parent.childNodes.splice(parent.childNodes.indexOf(marker), 1, ...adopted);
  }

  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  addEventListener(type, fn, options = {}) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ fn, once: options === true ? false : Boolean(options.once) });
  }

  removeEventListener(type, fn) {
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((l) => l.fn !== fn));
  }

  dispatchEvent(event) {
    Object.defineProperty(event, 'target', { value: this, configurable: true });
    const path = [];
    for (let n = this; n; n = event.bubbles ? n.parentNode : null) path.push(n);
    for (const node of path) {
      Object.defineProperty(event, 'currentTarget', { value: node, configurable: true });
      for (const listener of [...(node.listeners.get(event.type) ?? [])]) {
        if (listener.once) node.removeEventListener(event.type, listener.fn);
        listener.fn.call(node, event);
      }
      if (event.cancelBubble) break;
    }
    return !event.defaultPrevented;
  }

  querySelectorAll(selector) {
    return [...descendants(this)].filter((el) => matchesSelector(el, selector, this));
  }

  querySelector(selector) {
    for (const el of descendants(this)) if (matchesSelector(el, selector, this)) return el;
    return null;
  }

  get children() {
    return this.childNodes.filter((n) => n instanceof Element);
  }
}

export class Text extends Node {
  constructor(doc, data) {
    super(doc);
    this.data = data;
  }

  get textContent() {
    return this.data;
  }

  set textContent(value) {
    this.data = String(value);
  }

  cloneNode() {
    return new Text(this.ownerDocument, this.data);
  }
}

class Comment extends Node {
  get textContent() {
    return '';
  }

  cloneNode() {
    return new Comment(this.ownerDocument);
  }
}

class ClassList {
  constructor(el) {
    this.el = el;
  }

  #list() {
    return (this.el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  }

  contains(name) {
    return this.#list().includes(name);
  }

  add(...names) {
    this.el.setAttribute('class', [...new Set([...this.#list(), ...names])].join(' '));
  }

  remove(...names) {
    this.el.setAttribute('class', this.#list().filter((n) => !names.includes(n)).join(' '));
  }

  toggle(name, force) {
    const on = force ?? !this.contains(name);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

/** Attributes reflected as plain string properties. */
const REFLECTED = ['id', 'type', 'href', 'rel', 'src', 'title', 'name'];
/** Boolean attributes reflected as properties. */
const BOOLEAN = ['hidden', 'async', 'disabled'];

export class Element extends Node {
  constructor(doc, tagName) {
    super(doc);
    this.localName = tagName.toLowerCase();
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.classList = new ClassList(this);
    this.dataset = new Proxy(
      {},
      {
        get: (_, prop) => (typeof prop === 'string' ? this.getAttribute(camelToData(prop)) ?? undefined : undefined),
        set: (_, prop, value) => {
          this.setAttribute(camelToData(prop), value);
          return true;
        },
        has: (_, prop) => this.hasAttribute(camelToData(prop)),
        deleteProperty: (_, prop) => {
          this.removeAttribute(camelToData(prop));
          return true;
        },
      },
    );
    this.paused = true; // <audio>
  }

  getAttribute(name) {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name.toLowerCase(), String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name.toLowerCase());
  }

  hasAttribute(name) {
    return this.attributes.has(name.toLowerCase());
  }

  get className() {
    return this.getAttribute('class') ?? '';
  }

  set className(value) {
    this.setAttribute('class', value);
  }

  get value() {
    return this._value ?? this.getAttribute('value') ?? '';
  }

  set value(v) {
    this._value = String(v);
  }

  get checked() {
    return this._checked ?? this.hasAttribute('checked');
  }

  set checked(on) {
    this._checked = Boolean(on);
    if (on && this.getAttribute('type') === 'radio' && this.name) {
      for (const other of this.ownerDocument.querySelectorAll(`input[name="${this.name}"]`)) {
        if (other !== this) other._checked = false;
      }
    }
  }

  matches(selector) {
    return matchesSelector(this, selector, this);
  }

  cloneNode(deep = false) {
    const copy = this.ownerDocument.createElement(this.localName);
    for (const [name, value] of this.attributes) copy.setAttribute(name, value);
    if (deep) copy.append(...this.childNodes.map((child) => child.cloneNode(true)));
    return copy;
  }

  closest(selector) {
    for (let el = this; el instanceof Element; el = el.parentNode) if (matchesSelector(el, selector, el)) return el;
    return null;
  }

  focus() {
    this.ownerDocument.focused = this;
  }

  blur() {
    if (this.ownerDocument.focused === this) this.ownerDocument.focused = null;
  }

  click() {
    const event = new Event('click', { bubbles: true, cancelable: true });
    if (!this.dispatchEvent(event)) return;
    // Default actions the modules rely on.
    if (this.localName === 'summary' && this.parentNode instanceof HTMLDetailsElement) {
      this.parentNode.open = !this.parentNode.open;
    } else if (this.localName === 'input' && this.getAttribute('type') === 'radio' && !this.checked) {
      this.checked = true;
      this.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /** Empty when the element (or an ancestor) is hidden or not rendered. */
  getClientRects() {
    for (let el = this; el instanceof Element; el = el.parentNode) {
      if (el.hidden || !this.ownerDocument.isRendered(el)) return [];
    }
    return this.isConnected ? [{}] : [];
  }

  scrollIntoView() {}

  pause() {
    this.paused = true;
  }
}

for (const name of REFLECTED) {
  Object.defineProperty(Element.prototype, name, {
    get() {
      return this.getAttribute(name) ?? '';
    },
    set(value) {
      this.setAttribute(name, value);
    },
  });
}

for (const name of BOOLEAN) {
  Object.defineProperty(Element.prototype, name, {
    get() {
      return this.hasAttribute(name);
    },
    set(on) {
      if (on) this.setAttribute(name, '');
      else this.removeAttribute(name);
    },
  });
}

export class HTMLDetailsElement extends Element {
  get open() {
    return this.hasAttribute('open');
  }

  set open(on) {
    if (Boolean(on) === this.open) return;
    if (on) this.setAttribute('open', '');
    else this.removeAttribute('open');
    this.dispatchEvent(new Event('toggle'));
  }
}

export class Document extends Node {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.focused = null;
    this.readyState = 'complete';
    /** Whether CSS shows an element; set it to stand in for a layout. */
    this.isRendered = () => true;
  }

  createElement(tag) {
    return tag.toLowerCase() === 'details' ? new HTMLDetailsElement(this, tag) : new Element(this, tag);
  }

  get documentElement() {
    return this.children[0] ?? null;
  }

  get head() {
    return this.querySelector('head');
  }

  get body() {
    return this.querySelector('body');
  }

  get activeElement() {
    return this.focused?.isConnected ? this.focused : this.body;
  }

  getElementById(id) {
    for (const el of descendants(this)) if (el.id === id) return el;
    return null;
  }
}

// ---- Parsing ----------------------------------------------------------------

const TOKEN = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-z][\w-]*)\s*>|<([a-z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|[^<]+|</gi;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Parse our template HTML (a whole page or a fragment) into a Document. */
export function parseHtml(html) {
  const doc = new Document();
  const stack = [doc];
  const top = () => stack[stack.length - 1];
  for (const m of html.matchAll(TOKEN)) {
    const [whole, closing, opening, attrs, selfClosing] = m;
    if (closing) {
      const name = closing.toLowerCase();
      const i = stack.findLastIndex((n) => n.localName === name);
      if (i > 0) stack.length = i;
    } else if (opening) {
      const el = doc.createElement(opening);
      for (const a of (attrs ?? '').matchAll(ATTRIBUTE)) el.setAttribute(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ''));
      top().append(el);
      if (!selfClosing && !VOID.has(el.localName)) stack.push(el);
    } else if (whole.startsWith('<!--')) {
      top().append(new Comment(doc));
    } else if (!whole.startsWith('<!')) {
      top().append(new Text(doc, decode(whole)));
    }
  }
  return doc;
}

// ---- Window and globals --------------------------------------------------------

/**
 * Parse `html` and install it as the global document, with a window, as
 * the browser modules expect. `hash` and `search` set location.hash and
 * location.search ("?q=..."). Returns { document, window, restore }; call
 * restore() after the test.
 */
export function installDom(html, { hash = '', search = '' } = {}) {
  const document = parseHtml(html);
  const events = new Node(document);
  const window = {
    location: { hash, search, href: `https://sleepsteps.test/page/${search}${hash}` },
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    setInterval: (...args) => globalThis.setInterval(...args),
    clearInterval: (...args) => globalThis.clearInterval(...args),
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
    dispatchEvent: (event) => events.dispatchEvent(event),
    print: () => {
      window.printed = (window.printed ?? 0) + 1;
    },
  };
  const names = ['document', 'window', 'location', 'HTMLDetailsElement'];
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  Object.assign(globalThis, { document, window, location: window.location, HTMLDetailsElement });
  const restore = () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
  return { document, window, restore };
}
