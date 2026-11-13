// Expressions the a11y runner evaluates in the page (scripts/a11y/run.js).
// Each is a string, so it runs in the page, not in Node.

/**
 * What has focus, and how it looks: { none } when nothing in the page has
 * it; otherwise the element, the box that carries its ring (a star's label
 * for a rating radio), the ring's style, and the ring's box against the
 * viewport.
 */
export const FOCUS_INFO = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { none: true };
  let ring = el;
  if (el.matches('input[type=radio]')) ring = (el.id && document.querySelector('label[for="' + el.id + '"]')) || el.closest('label') || el.nextElementSibling || el;
  const cs = getComputedStyle(ring);
  const r = ring.getBoundingClientRect();
  const width = parseFloat(cs.outlineWidth) || 0;
  const offset = parseFloat(cs.outlineOffset) || 0;
  const reach = cs.outlineStyle === 'none' ? 0 : Math.max(0, width + offset);
  const ringBox = { top: r.top - reach, bottom: r.bottom + reach, left: r.left - reach, right: r.right + reach };
  const name = (el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText || el.value || el.getAttribute('title') || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
  const path = [];
  for (let n = el; n && n.nodeType === 1 && path.length < 4; n = n.parentElement) {
    path.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\\s+/)[0] : ''));
  }
  const own = getComputedStyle(el);
  const scroller = /auto|scroll/.test(own.overflowX + ' ' + own.overflowY) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
  const siblings = el.parentElement ? [...el.parentElement.children].indexOf(el) : 0;
  return {
    key: path.join(' > ') + ':' + siblings + ':' + (el.getAttribute('href') || '') + ':' + name,
    where: path.join(' > '),
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type') || '',
    name,
    // A frame, or an element that isn't focusable itself nor a scrolling box
    // (which Chrome makes a Tab stop), so focus is in its closed shadow root
    // (Turnstile's widget): another site's controls.
    frame: el.tagName === 'IFRAME' || (!el.matches('a[href], area[href], button, input, select, textarea, summary, audio, video, dialog, [tabindex], [contenteditable]') && !scroller),
    dateField: el.matches('input[type=date], input[type=time], input[type=datetime-local], input[type=month], input[type=week]'),
    media: el.matches('audio, video'),
    // Chrome scrolls a text field only far enough to show its caret.
    textEntry: el.matches('textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], input[type=tel], input[type=number], input[type=password]'),
    inDialog: Boolean(el.closest('dialog[open]')),
    isDialog: el.matches('dialog'),
    focusVisible: el.matches(':focus-visible'),
    outline: cs.outlineStyle + ' ' + cs.outlineWidth,
    ringWidth: cs.outlineStyle === 'none' || cs.outlineStyle === 'hidden' ? 0 : width,
    outlineOffset: offset,
    w: Math.round(r.width),
    h: Math.round(r.height),
    fits: ringBox.bottom - ringBox.top <= innerHeight && ringBox.right - ringBox.left <= innerWidth,
    partlyInView: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    inView: ringBox.top >= -0.5 && ringBox.bottom <= innerHeight + 0.5 && ringBox.left >= -0.5 && ringBox.right <= innerWidth + 0.5,
  };
})()`;

/** Does the page scroll sideways (WCAG 1.4.10)? */
export const SIDEWAYS = `(() => {
  const root = document.documentElement;
  return root.scrollWidth > root.clientWidth + 1 ? root.scrollWidth : 0;
})()`;

/**
 * Text that a box cuts off (WCAG 1.4.12; axe has no rule for it): for every
 * box that clips (overflow hidden or clip, an ellipsis or a line clamp),
 * any line of its text that reaches past its padding box in a clipped
 * direction. Boxes hidden on purpose (the 1px visually-hidden pattern, a
 * clip-path) and text inside them don't count. Text that overlaps other
 * content without being clipped isn't detected. Returns up to 10
 * descriptions, or none.
 */
export const CLIPPED = `(() => {
  const out = [];
  const hiddenOnPurpose = (el) => {
    const r = el.getBoundingClientRect();
    return r.width <= 2 || r.height <= 2 || getComputedStyle(el).clipPath !== 'none';
  };
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[hidden], iframe, svg, script, style, template, noscript, select, textarea, input')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const clipX = /hidden|clip/.test(cs.overflowX);
    const clipY = /hidden|clip/.test(cs.overflowY);
    if (!clipX && !clipY) continue;
    if (!el.textContent.trim() || hiddenOnPurpose(el)) continue;
    // Chrome reports an ellipsis's or a line clamp's lines as drawn, so
    // those are judged by the box's own overflow.
    const ellipsis = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
    const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1;
    if (ellipsis || clamped) {
      out.push(describe(el) + (ellipsis ? ' ends its text with an ellipsis' : ' clamps its text') + ' ("' + el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 40) + '")');
      if (out.length >= 10) break;
      continue;
    }
    const r = el.getBoundingClientRect();
    const left = r.left + el.clientLeft;
    const top = r.top + el.clientTop;
    const box = { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let hit = null;
    for (let t = walker.nextNode(); t && !hit; t = walker.nextNode()) {
      if (!t.data.trim()) continue;
      let skip = false;
      for (let n = t.parentElement; n && n !== el; n = n.parentElement) {
        const ns = getComputedStyle(n);
        if (ns.display === 'none' || ns.visibility === 'hidden' || hiddenOnPurpose(n)) {
          skip = true;
          break;
        }
      }
      if (skip) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      for (const line of range.getClientRects()) {
        if (!line.width || !line.height) continue;
        const outX = clipX && (line.left < box.left - 1 || line.right > box.right + 1);
        const outY = clipY && (line.top < box.top - 1 || line.bottom > box.bottom + 1);
        if (outX || outY) {
          hit = t.data.trim().replace(/\\s+/g, ' ').slice(0, 40);
          break;
        }
      }
    }
    if (hit) out.push(describe(el) + ' cuts off "' + hit + '"');
    if (out.length >= 10) break;
  }
  return out;
})()`;
