// Phone Menu (HANDOFF §5 MobileHeader; SPEC §2, §11).
//
// The HTML ships a native <details>/<summary>, which opens and closes with
// JavaScript off. This module upgrades it to a disclosure button:
//
// - a real <button type="button"> with aria-expanded and aria-controls;
// - Escape closes the open menu and returns focus to the button;
// - focus stays on the button when the menu opens, and the panel follows it
//   in the tab order, so nothing jumps and no on-screen keyboard pops up.
//
// The panel keeps the same element, classes and position, and the button
// copies the summary's contents and classes, so the swap causes no layout
// shift. Nothing is animated, so prefers-reduced-motion needs no handling.
// If anything here fails, the <details> keeps working.

function enhance(details) {
  const summary = details.querySelector(':scope > summary');
  const panel = details.querySelector(':scope > .mobile-menu__panel');
  if (!summary || !panel || !panel.id) return;

  const wasOpen = details.open;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = summary.className;
  button.append(...[...summary.childNodes].map((node) => node.cloneNode(true)));
  button.setAttribute('aria-controls', panel.id);

  const wrapper = document.createElement('div');
  wrapper.className = details.className;
  wrapper.dataset.enhanced = '';

  const setOpen = (open) => {
    button.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
  };

  button.addEventListener('click', () => {
    setOpen(button.getAttribute('aria-expanded') !== 'true');
  });

  wrapper.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (button.getAttribute('aria-expanded') !== 'true') return;
    event.preventDefault();
    setOpen(false);
    button.focus();
  });

  // Moving a focused element drops focus, so put it back afterwards.
  const active = document.activeElement;
  const focusTarget = active === summary ? button : details.contains(active) ? active : null;

  setOpen(wasOpen);
  wrapper.append(button, panel);
  details.replaceWith(wrapper);
  focusTarget?.focus();
}

try {
  document.querySelectorAll('details[data-mobile-menu]').forEach(enhance);
} catch {
  // Leave the native <details> in place.
}
