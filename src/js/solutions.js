// Solution cards on problem pages (HANDOFF §6.4 SolutionCard; SPEC §2, §7.5,
// §11). Markup: src/_includes/problem/solutions.njk.
//
// The HTML ships each card as a native <details name="solution">, which opens
// and closes with JavaScript off. This module upgrades every card:
//
// - the <summary> becomes <h3><button aria-expanded aria-controls>, so a
//   closed card has a heading. The button is named by the solution's title;
//   the card's description and length describe it (aria-describedby);
// - the panel becomes a region labelled by the title of the video template
//   it holds (src/_includes/partials/video-block.njk);
// - the template's header (step chip, Close, title, description), which
//   ships hidden, is shown: while a card is open its face is hidden at every
//   width (problem.css), so the header names it and Close closes it;
// - one card is open at a time across both sections. Opening one closes the
//   other and pauses its media (players.js), and moves focus to the opened
//   card's title;
// - Close returns focus to the card's button.
//
// Escape doesn't close a card: that isn't a disclosure convention, and the
// YouTube player keeps keystrokes anyway. A card that was open before this
// ran (opened early, or rendered open) stays open. Elements and classes are
// kept, so the swap causes no layout shift. Nothing is stored or sent. If
// anything here fails, the <details> keep working.

import { pauseWithin } from './players.js';

const cards = [];

const isOpen = (card) => card.li.classList.contains('is-open');

function setOpen(card, open) {
  card.li.classList.toggle('is-open', open);
  card.face.setAttribute('aria-expanded', String(open));
  card.panel.hidden = !open;
}

function closeCard(card, { focus = false } = {}) {
  if (!isOpen(card)) return;
  pauseWithin(card.panel);
  setOpen(card, false);
  if (focus) card.face.focus();
}

function openCard(card) {
  for (const other of cards) {
    if (other !== card) closeCard(other);
  }
  setOpen(card, true);
  // The title: the open card's face is hidden at every width (problem.css).
  card.heading.focus({ preventScroll: true });
  // Closing a card above this one may have moved it out of view.
  card.heading.scrollIntoView({ block: 'nearest' });
}

function enhance(li) {
  const details = li.querySelector(':scope > details.solution__disclosure');
  const summary = details?.querySelector(':scope > summary.solution__face');
  const panel = details?.querySelector(':scope > .solution__panel');
  const header = panel?.querySelector('.video-block__header');
  const heading = header?.querySelector('.video-block__title');
  const close = header?.querySelector('.video-block__close');
  if (!summary || !panel?.id || !heading?.id || !close) return null;

  const wasOpen = details.open;
  const active = document.activeElement;

  const face = document.createElement('button');
  face.type = 'button';
  face.className = summary.className;
  face.setAttribute('aria-controls', panel.id);
  face.append(...summary.childNodes);
  const description = [...face.querySelectorAll('.solution__blurb[id], .solution__length[id]')];
  for (const el of description) el.setAttribute('aria-hidden', 'true');
  if (description.length) face.setAttribute('aria-describedby', description.map((el) => el.id).join(' '));

  const faceHeading = document.createElement('h3');
  faceHeading.className = 'solution__face-heading';
  faceHeading.append(face);

  const wrapper = document.createElement('div');
  wrapper.className = details.className;
  wrapper.dataset.enhanced = '';

  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-labelledby', heading.id);
  header.hidden = false;

  const card = { li, face, panel, heading };
  setOpen(card, false);
  wrapper.append(faceHeading, panel);
  details.replaceWith(wrapper);

  face.addEventListener('click', () => {
    if (isOpen(card)) closeCard(card, { focus: true });
    else openCard(card);
  });
  close.addEventListener('click', () => closeCard(card, { focus: true }));

  // Moving a focused element drops focus, so put it back.
  if (active === summary) face.focus();
  else if (active && wrapper.contains(active)) active.focus();

  return { card, wasOpen };
}

function init() {
  let opened = false;
  for (const li of document.querySelectorAll('.solution')) {
    const result = enhance(li);
    if (!result) continue;
    cards.push(result.card);
    // Without `name` support several cards may have been opened: keep the first.
    if (result.wasOpen && !opened) {
      opened = true;
      setOpen(result.card, true);
    }
  }
}

try {
  init();
} catch {
  // Cards not yet upgraded keep their native <details>.
}
