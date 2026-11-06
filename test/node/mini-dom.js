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
//   (inputs; a textarea's value starts as its text), readOnly, maxLength,
//   open (details, firing "toggle"), focus with document.activeElement,
//   click() with the default actions of <summary>, radio inputs (a radio is
//   checked before its click's listeners run, as in browsers) and submit
//   buttons (requestSubmit() on their form), events that bubble to the
//   document, getClientRects() (via `isRendered`) and getBoundingClientRect()
//   (its width is document.layoutWidth while the element is rendered);
//   scrollTop, clientTop and clientHeight as plain numbers (0 until a test
//   sets them; nothing is laid out), and `style`, a StyleDeclaration holding
//   what setProperty() puts there (it isn't reflected in a style attribute
//   and styles nothing);
// - <dialog> (HTMLDialogElement, for feedback.js): open, showModal() (throws
//   InvalidStateError when already open or not in the document; focuses the
//   first control, as browsers do), close(returnValue) (puts focus back
//   where it was if it was inside, and fires "close" in a later task, as
//   browsers do) and returnValue. A closed dialog isn't rendered. A form with
//   method="dialog" closes its dialog when submitted, unless the submit
//   event is cancelled. pressEscape() stands in for the Escape key.
//   installDom's `dialog: false` leaves <dialog> as a plain element, as in a
//   browser without dialog support;
// - a window with location (hash, search and hostname), timers (the global
//   ones, so fake timers work), events, print() and innerHeight; for
//   feedback.js, optionally a visualViewport (VisualViewport: height,
//   offsetTop and scale, with "resize" and "scroll" events); and, for
//   events.js and stats-switch.js, localStorage and sessionStorage
//   (MemoryStorage, which can be blocked or full), navigator, fetch and
//   crypto, each replaceable.
//
// installDom(html) puts document, window, location, HTMLDetailsElement and
// HTMLDialogElement on globalThis, as a browser would, and returns
// { document, window, restore }. The modules reach storage, navigator, fetch
// and crypto through window, so Node's own globals of those names are never
// touched. Scripts a module appends to <head> are only elements: a test
// dispatches their "load" or "error" event itself.

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

/**
 * An element's `style` (CSSStyleDeclaration), holding properties by name:
 * setProperty, removeProperty, getPropertyValue, length and item. Values
 * aren't parsed or checked, and nothing reads them but the tests.
 */
export class StyleDeclaration {
  #values = new Map();

  get length() {
    return this.#values.size;
  }

  item(i) {
    return [...this.#values.keys()][i] ?? '';
  }

  getPropertyValue(name) {
    return this.#values.get(String(name)) ?? '';
  }

  setProperty(name, value) {
    if (value === '' || value === null || value === undefined) this.removeProperty(name);
    else this.#values.set(String(name), String(value));
  }

  removeProperty(name) {
    const value = this.getPropertyValue(name);
    this.#values.delete(String(name));
    return value;
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
    // Layout numbers a test may set; nothing here lays anything out.
    this.scrollTop = 0;
    this.clientTop = 0;
    this.clientHeight = 0;
  }

  get style() {
    this._style ??= new StyleDeclaration();
    return this._style;
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
    if (this._value !== undefined) return this._value;
    return this.localName === 'textarea' ? this.textContent : this.getAttribute('value') ?? '';
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

  get readOnly() {
    return this.hasAttribute('readonly');
  }

  set readOnly(on) {
    if (on) this.setAttribute('readonly', '');
    else this.removeAttribute('readonly');
  }

  get maxLength() {
    const n = Number.parseInt(this.getAttribute('maxlength') ?? '', 10);
    return Number.isInteger(n) && n >= 0 ? n : -1;
  }

  /**
   * Submit this form as a browser does after its checks: a cancelable,
   * bubbling "submit" event carrying `submitter`; then, unless it was
   * cancelled, method="dialog" closes the form's dialog. Nothing is ever
   * navigated to.
   */
  requestSubmit(submitter = null) {
    const event = new Event('submit', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'submitter', { value: submitter, configurable: true });
    if (!this.dispatchEvent(event)) return;
    if ((this.getAttribute('method') ?? '').toLowerCase() !== 'dialog') return;
    const dialog = this.closest('dialog');
    if (dialog instanceof HTMLDialogElement) dialog.close(submitter?.getAttribute('value') ?? undefined);
  }

  click() {
    // As in browsers, a radio is checked before its click is dispatched, so
    // the click's listeners see it checked; cancelling the click puts back
    // the radio checked before, and change follows only a new check.
    const radio = this.localName === 'input' && this.getAttribute('type') === 'radio';
    const group = radio && this.name ? this.ownerDocument.querySelectorAll(`input[name="${this.name}"]`) : [this];
    const before = radio ? group.find((r) => r.checked) : undefined;
    if (radio) this.checked = true;
    const event = new Event('click', { bubbles: true, cancelable: true });
    if (!this.dispatchEvent(event)) {
      if (radio) {
        this.checked = false;
        if (before) before.checked = true;
      }
      return;
    }
    // Default actions the modules rely on.
    if (this.localName === 'summary' && this.parentNode instanceof HTMLDetailsElement) {
      this.parentNode.open = !this.parentNode.open;
    } else if (radio && before !== this) {
      this.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (this.isSubmitButton) {
      this.closest('form')?.requestSubmit(this);
    }
  }

  /** A <button> without type="button" or "reset", or an <input type="submit">. */
  get isSubmitButton() {
    const type = (this.getAttribute('type') ?? '').toLowerCase();
    if (this.localName === 'button') return type !== 'button' && type !== 'reset';
    return this.localName === 'input' && type === 'submit';
  }

  /** Empty when the element (or an ancestor) is hidden or not rendered. */
  getClientRects() {
    for (let el = this; el instanceof Element; el = el.parentNode) {
      if (el.hidden || !this.ownerDocument.isRendered(el)) return [];
      if (el instanceof HTMLDialogElement && !el.open) return [];
    }
    return this.isConnected ? [{}] : [];
  }

  /** The page's width (document.layoutWidth) while rendered, else zero. */
  getBoundingClientRect() {
    const width = this.getClientRects().length ? this.ownerDocument.layoutWidth : 0;
    return { x: 0, y: 0, top: 0, left: 0, width, height: 0, right: width, bottom: 0 };
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

// What showModal() focuses: the first of these in the dialog (browsers take
// the first focusable element; our dialog's first control is enough here).
const DIALOG_FOCUS = '[autofocus], button, textarea, input, select, a[href]';

export class HTMLDialogElement extends Element {
  constructor(doc, tagName) {
    super(doc, tagName);
    this.returnValue = '';
    this.modal = false;
    this.previouslyFocused = null;
  }

  get open() {
    return this.hasAttribute('open');
  }

  set open(on) {
    if (on) this.setAttribute('open', '');
    else this.removeAttribute('open');
  }

  showModal() {
    if (this.open && this.modal) return;
    if (this.open) throw new DOMException('The dialog is already open as a non-modal dialog.', 'InvalidStateError');
    if (!this.isConnected) throw new DOMException('The dialog is not in a document.', 'InvalidStateError');
    this.setAttribute('open', '');
    this.modal = true;
    this.previouslyFocused = this.ownerDocument.activeElement;
    this.querySelector(DIALOG_FOCUS)?.focus();
  }

  close(returnValue) {
    if (!this.open) return;
    this.removeAttribute('open');
    this.modal = false;
    if (returnValue !== undefined) this.returnValue = String(returnValue);
    // Focus goes back to where it was before showModal(), if it was inside.
    const previous = this.previouslyFocused;
    this.previouslyFocused = null;
    const active = this.ownerDocument.activeElement;
    if (this.contains(active)) {
      if (previous?.isConnected && previous !== this.ownerDocument.body) previous.focus();
      else active.blur();
    }
    // "close" comes in a later task.
    globalThis.setTimeout(() => this.dispatchEvent(new Event('close')), 0);
  }
}

/**
 * The Escape key: keydown on the focused element (bubbling, cancelable),
 * then, unless that was cancelled, a cancelable "cancel" on the topmost
 * modal dialog, which closes unless that is cancelled too. Returns whether a
 * dialog closed.
 */
export function pressEscape(doc = globalThis.document) {
  const keydown = Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key: 'Escape' });
  if (!doc.activeElement.dispatchEvent(keydown)) return false;
  const dialog = doc.querySelectorAll('dialog').filter((d) => d instanceof HTMLDialogElement && d.open && d.modal).at(-1);
  if (!dialog) return false;
  if (!dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) return false;
  dialog.close();
  return true;
}

export class Document extends Node {
  constructor({ dialog = true } = {}) {
    super(null);
    this.ownerDocument = this;
    this.focused = null;
    this.readyState = 'complete';
    /** Whether CSS shows an element; set it to stand in for a layout. */
    this.isRendered = () => true;
    /** The width getBoundingClientRect() gives a rendered element. */
    this.layoutWidth = 640;
    this.dialogSupport = dialog;
  }

  createElement(tag) {
    const name = tag.toLowerCase();
    if (name === 'details') return new HTMLDetailsElement(this, tag);
    if (name === 'dialog' && this.dialogSupport) return new HTMLDialogElement(this, tag);
    return new Element(this, tag);
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

/**
 * Parse our template HTML (a whole page or a fragment) into a Document.
 * `dialog: false` parses <dialog> as a plain element.
 */
export function parseHtml(html, { dialog = true } = {}) {
  const doc = new Document({ dialog });
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

// ---- Storage -------------------------------------------------------------------

/**
 * A stand-in for localStorage or sessionStorage, holding strings in memory.
 * `full` makes setItem throw, as a full or read-only store does; pass
 * 'blocked' instead of a store to installDom to make reading the property
 * itself throw, as browsers do when site data is blocked. Pass the same
 * store to two installDom calls to keep it across page loads.
 */
export class MemoryStorage {
  constructor(items = {}, { full = false } = {}) {
    this.items = new Map(Object.entries(items));
    this.full = full;
  }

  get length() {
    return this.items.size;
  }

  key(i) {
    return [...this.items.keys()][i] ?? null;
  }

  getItem(key) {
    return this.items.has(String(key)) ? this.items.get(String(key)) : null;
  }

  setItem(key, value) {
    if (this.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.items.set(String(key), String(value));
  }

  removeItem(key) {
    this.items.delete(String(key));
  }

  clear() {
    this.items.clear();
  }
}

/** A window property that is `value`, or throws when it is 'blocked'. */
function storageProperty(value) {
  return {
    configurable: true,
    enumerable: true,
    get() {
      if (value === 'blocked') throw new DOMException('Access is denied for this document.', 'SecurityError');
      return value;
    },
  };
}

// ---- The visual viewport ---------------------------------------------------------

/**
 * A stand-in for window.visualViewport: the part of the page on screen,
 * which an on-screen keyboard makes shorter (height) and which can pan
 * (offsetTop) and be pinch-zoomed (scale). change() sets any of the three
 * and then fires what a browser would: "resize" when height or scale
 * changed, "scroll" when offsetTop did. listenerCount counts the listeners
 * still attached.
 */
export class VisualViewport extends Node {
  constructor({ height = 800, offsetTop = 0, scale = 1 } = {}) {
    super(null);
    this.height = height;
    this.offsetTop = offsetTop;
    this.scale = scale;
  }

  change({ height = this.height, offsetTop = this.offsetTop, scale = this.scale } = {}) {
    const resized = height !== this.height || scale !== this.scale;
    const scrolled = offsetTop !== this.offsetTop;
    Object.assign(this, { height, offsetTop, scale });
    if (resized) this.dispatchEvent(new Event('resize'));
    if (scrolled) this.dispatchEvent(new Event('scroll'));
  }

  get listenerCount() {
    return [...this.listeners.values()].reduce((sum, list) => sum + list.length, 0);
  }
}

// ---- Window and globals --------------------------------------------------------

/**
 * Parse `html` and install it as the global document, with a window, as
 * the browser modules expect. `hash`, `search` and `hostname` set
 * location.hash, location.search ("?q=") and location.hostname.
 * `localStorage` and `sessionStorage` are MemoryStorage stores (new, empty
 * ones by default) or 'blocked'; `navigator`, `fetch` and `crypto` become
 * window's (by default: a navigator without sendBeacon, no fetch, and Node's
 * crypto). `dialog: false` stands in for a browser without <dialog>, and
 * `layoutWidth` sets document.layoutWidth. `innerHeight` is window's (the
 * layout viewport's height), and `visualViewport` (a VisualViewport) is
 * window.visualViewport; without one there is none, as in browsers older
 * than the Visual Viewport API. Returns { document, window, restore }; call
 * restore() after the test.
 */
export function installDom(
  html,
  {
    hash = '',
    search = '',
    hostname = 'sleepsteps.test',
    localStorage = new MemoryStorage(),
    sessionStorage = new MemoryStorage(),
    navigator = {},
    fetch,
    crypto = globalThis.crypto,
    dialog = true,
    layoutWidth = 640,
    innerHeight = 800,
    visualViewport,
  } = {},
) {
  const document = parseHtml(html, { dialog });
  document.layoutWidth = layoutWidth;
  const events = new Node(document);
  const window = {
    location: { hash, search, hostname, href: `https://${hostname}/page/${search}${hash}` },
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
    navigator,
    fetch,
    crypto,
    innerHeight,
  };
  if (visualViewport) window.visualViewport = visualViewport;
  Object.defineProperty(window, 'localStorage', storageProperty(localStorage));
  Object.defineProperty(window, 'sessionStorage', storageProperty(sessionStorage));
  const names = ['document', 'window', 'location', 'HTMLDetailsElement', 'HTMLDialogElement'];
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  Object.assign(globalThis, { document, window, location: window.location, HTMLDetailsElement });
  if (dialog) globalThis.HTMLDialogElement = HTMLDialogElement;
  else delete globalThis.HTMLDialogElement;
  const restore = () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
  return { document, window, restore };
}
