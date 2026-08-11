/**
 * ui.js -- the smallest DOM helper that makes app.js readable.
 *
 * Deliberately not a framework. `h()` builds elements, `mount()` swaps
 * children. That's the whole thing.
 */

/**
 * A plain options bag, as opposed to a child. Elements, arrays, strings and
 * numbers are all children; only an object literal is props.
 */
function isProps(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Node)
  );
}

/**
 * h('div.card', { onclick }, child, child, ...)
 * h('div.card', child, child, ...)          <- props may be omitted
 *
 * The tag accepts CSS-ish shorthand: 'button.chip.is-active' or 'span#total'.
 * Props starting with `on` bind listeners, everything else becomes an
 * attribute. `null` and `false` children are skipped so `cond && h(...)` works.
 */
export function h(tag, props = null, ...children) {
  // Second argument is optional. If it isn't an options bag it's the first
  // child -- without this, h('main', view()) silently drops its content.
  if (props != null && !isProps(props)) {
    children.unshift(props);
    props = null;
  }

  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || 'div');

  for (const token of rest) {
    if (token[0] === '.') el.classList.add(token.slice(1));
    else if (token[0] === '#') el.id = token.slice(1);
  }

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;

      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'class') {
        for (const c of String(value).split(/\s+/).filter(Boolean)) el.classList.add(c);
      } else if (key === 'dataset') {
        Object.assign(el.dataset, value);
      } else if (key === 'value' || key === 'checked' || key === 'disabled') {
        el[key] = value;
      } else if (key === 'html') {
        el.innerHTML = value;
      } else {
        el.setAttribute(key, value === true ? '' : value);
      }
    }
  }

  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false || child === '') continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

/** Replace an element's contents. */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/**
 * Inline SVG icon, so nothing is fetched from a CDN.
 *
 * `stroke` overrides the default currentColor — the tick inside a filled
 * checkbox has to be dark against the goal colour, not the text colour it
 * would otherwise inherit.
 */
export function icon(path, { size = 18, label = null, stroke = 'currentColor', width = 1.8 } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', stroke);
  svg.setAttribute('stroke-width', width);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', label ? 'false' : 'true');
  if (label) svg.setAttribute('aria-label', label);

  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

export const ICONS = {
  plus: 'M12 5v14M5 12h14',
  close: 'M18 6 6 18M6 6l12 12',
  up: 'm18 15-6-6-6 6',
  down: 'm6 9 6 6 6-6',
  chevronLeft: 'm15 5-7 7 7 7',
  chevronRight: 'm9 5 7 7-7 7',
  chevronDown: 'm6 9 6 6 6-6',
  pencil: 'M15.5 4.5 19.5 8.5 8.5 19.5 4 20.5l1-4.5 10.5-11.5Z',
  // Tab bar
  home: 'M3 10.6 12 3.5l9 7.1M5.6 9.4V20.5h12.8V9.4M9.8 20.5v-6.2h4.4v6.2',
  dumbbell: 'M6.8 7.5v9M17.2 7.5v9M3.4 10v4M20.6 10v4M6.8 12h10.4',
  chart: 'M3 21h18M7 21V10M12 21V4M17 21v-7',
  list: 'M8.5 6.5h12M8.5 12h12M8.5 17.5h12M3.6 6.5h.02M3.6 12h.02M3.6 17.5h.02',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  sun: 'M12 3v2m0 14v2M5.6 5.6 7 7m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m10-10 1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  search: 'M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35',
  // Three subpaths in one `d` — ring, hook, dot — because icon() draws a
  // single <path>. The dot is a zero-length segment relying on the round line
  // cap, the same trick as `list` above.
  help: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18ZM9.5 9.3a2.6 2.6 0 0 1 5 .8c0 1.7-2.5 2.2-2.5 3.9M12 17.3h.01',
  // Same ring-stem-dot construction as `help` on purpose: the two live a few
  // rows apart in the app and should read as one family. A question mark asks
  // "what is this?"; an "i" says "there is more here" — which is the offer.
  info: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18ZM12 11.2v5.4M12 7.6h.01',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM7 3v6h8M7 21v-8h10v8',
  clock: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-14v5l3 2',
  spark: 'M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z',
  shuffle: 'M17 3.5 21 7l-4 3.5M17 13.5 21 17l-4 3.5M3 7h4.5l9 10H21M3 17h4.5l3-3.3M21 7h-4.5l-3 3.3',
  check: 'm20 6-11 11-5-5',
  checkAll: 'm2.5 12.5 3.5 3.5 8-8M10 17.5l1.5 1.5 10-10',
  print: 'M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z',
};

/** Sensible <output> for a number the user might not have entered yet. */
export function num(value, digits = 0, dash = '—') {
  if (value == null || Number.isNaN(value)) return dash;
  return Number(value).toFixed(digits);
}
