/**
 * muscles.js -- the front/back body map.
 *
 * Structure, in draw order:
 *   1. a single closed silhouette path, filled neutral
 *   2. muscle regions painted on top, clipped to that silhouette
 *   3. the silhouette stroked again, so the edge stays crisp over the regions
 *
 * Clipping is what makes this tractable: the regions can be generous
 * overlapping ellipses and still land exactly inside the body, so the shapes
 * stay easy to adjust without re-cutting curves by hand.
 *
 * The silhouette itself is authored once as a right half and mirrored in code
 * -- including reversing the curve so the two halves form ONE closed path
 * rather than two abutting ones. That matters for the stroke: two halves would
 * draw a seam straight down the middle of the figure.
 *
 * Colour carries emphasis:
 *   primary   -> red
 *   secondary -> amber
 *   both      -> 45-degree red/amber stripe
 *
 * The stripe is a real SVG pattern, not a blend, so an overlapped muscle stays
 * legible in dark mode, in print, and for a reader who cannot separate the two
 * hues. Colour is never the only channel -- app.js pairs this with named lists.
 */

const VIEW = { w: 220, h: 470 };
const GAP = 24;      // space between the two figures
const CENTER = 110;

/**
 * Right half of the silhouette, head-top to crotch, as cubic segments:
 * [c1x, c1y, c2x, c2y, endX, endY]. Both the start and the final point sit on
 * the centre line so the mirrored half closes cleanly.
 */
const HALF = {
  start: [110, 12],
  segs: [
    [121, 12, 128, 21, 128, 36],      // skull
    [128, 47, 123, 57, 118, 61],      // temple to jaw
    [118, 66, 118, 70, 119, 74],      // neck
    [133, 77, 148, 83, 157, 96],      // trapezius slope to shoulder
    [164, 106, 168, 119, 169, 134],   // deltoid
    [171, 156, 173, 178, 175, 198],   // upper arm, outer
    [177, 215, 177, 227, 174, 234],   // forearm to wrist, outer
    [171, 244, 162, 246, 157, 239],   // hand
    [154, 233, 154, 222, 153, 210],   // wrist, inner
    [151, 188, 149, 165, 146, 145],   // forearm, inner
    [144, 130, 142, 118, 139, 111],   // upper arm inner, up to the armpit
    [138, 132, 136, 152, 135, 170],   // torso: armpit to waist
    [137, 186, 141, 198, 142, 212],   // waist to hip
    [143, 236, 141, 264, 139, 290],   // hip to mid-thigh
    [137, 301, 135, 307, 134, 313],   // thigh to knee
    [132, 335, 131, 357, 129, 379],   // knee to calf
    [127, 399, 126, 412, 125, 423],   // calf to ankle
    [125, 435, 123, 441, 116, 441],   // foot
    [114, 441, 113, 435, 113, 424],   // ankle, inner
    [114, 400, 116, 372, 116, 345],   // calf, inner
    [116, 320, 115, 290, 114, 262],   // knee to inner thigh
    [113, 245, 111, 232, 110, 221],   // inner thigh to crotch
  ],
};

/**
 * One closed path: the half traversed forwards, then its mirror traversed
 * backwards. Reversing a cubic means swapping its two control points and
 * ending at the segment's original start.
 */
function silhouettePath(half) {
  const mx = (x) => 2 * CENTER - x;
  const d = [`M ${half.start[0]} ${half.start[1]}`];

  for (const s of half.segs) d.push(`C ${s[0]} ${s[1]} ${s[2]} ${s[3]} ${s[4]} ${s[5]}`);

  const starts = [half.start, ...half.segs.map((s) => [s[4], s[5]])];
  for (let i = half.segs.length - 1; i >= 0; i -= 1) {
    const s = half.segs[i];
    const from = starts[i];
    d.push(`C ${mx(s[2])} ${s[3]} ${mx(s[0])} ${s[1]} ${mx(from[0])} ${from[1]}`);
  }

  d.push('Z');
  return d.join(' ');
}

const BODY_PATH = silhouettePath(HALF);

/* ------------------------------------------------------------- regions */

// e(cx, cy, rx, ry, rotate). Declared for the left side and mirrored, so the
// figure cannot drift out of symmetry. `mirror: false` = already centred.
const e = (cx, cy, rx, ry, rot = 0) => ({ cx, cy, rx, ry, rot });
const centred = (cx, cy, rx, ry) => ({ cx, cy, rx, ry, rot: 0, mirror: false });

const FRONT_MUSCLES = {
  // Kept high and narrow: from the front the trapezius is only the slope from
  // neck to shoulder, and anything lower reads as chest.
  Traps: [e(95, 80, 17, 8, -28)],
  Shoulders: [e(64, 108, 19, 20)],
  Chest: [e(92, 118, 23, 17)],
  Core: [centred(110, 172, 20, 40)],
  Biceps: [e(64, 148, 16, 33)],
  Forearms: [e(54, 202, 15, 34)],
  Quads: [e(93, 258, 17, 47)],
  Adductors: [e(103, 252, 9, 36)],
  Calves: [e(97, 382, 12, 36)],
};

const BACK_MUSCLES = {
  Traps: [centred(110, 100, 35, 26)],
  Shoulders: [e(64, 108, 19, 20)],
  Back: [e(92, 148, 25, 33)],
  Triceps: [e(64, 148, 16, 33)],
  Forearms: [e(54, 202, 15, 34)],
  // Overlapped deliberately: the tapered ends of two ellipses leave a neutral
  // band across the top of the thigh otherwise.
  Glutes: [e(95, 212, 21, 26)],
  Hamstrings: [e(93, 268, 17, 49)],
  Calves: [e(97, 382, 12, 36)],
};

export const MUSCLES_BY_VIEW = {
  front: Object.keys(FRONT_MUSCLES),
  back: Object.keys(BACK_MUSCLES),
};

/* ------------------------------------------------------------ rendering */

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  return node;
}

function ellipseNode(shape, flip) {
  const cx = flip ? 2 * CENTER - shape.cx : shape.cx;
  const rot = flip ? -shape.rot : shape.rot;
  return el('ellipse', {
    cx,
    cy: shape.cy,
    rx: shape.rx,
    ry: shape.ry,
    transform: rot ? `rotate(${rot} ${cx} ${shape.cy})` : null,
  });
}

function regionNodes(shape) {
  const nodes = [ellipseNode(shape, false)];
  if (shape.mirror !== false) nodes.push(ellipseNode(shape, true));
  return nodes;
}

/**
 * The stripe pattern and the body clip live once in a hidden SVG rather than
 * inside every map: the plan screen renders the front and the back as two
 * separate <svg>s, and duplicating the defs in each would mean duplicate ids
 * in the document. SVG references resolve document-wide, so one copy serves
 * every map on the page.
 */
function ensureSharedDefs() {
  if (document.getElementById('body-defs')) return;

  const svg = el('svg', { id: 'body-defs', width: 0, height: 0, 'aria-hidden': 'true' });
  svg.style.position = 'absolute';

  const defs = el('defs');

  const pattern = el('pattern', {
    id: 'muscle-both',
    patternUnits: 'userSpaceOnUse',
    width: 10,
    height: 10,
    patternTransform: 'rotate(45)',
  });
  pattern.appendChild(el('rect', { width: 10, height: 10, fill: 'var(--muscle-secondary)' }));
  pattern.appendChild(el('rect', { width: 5, height: 10, fill: 'var(--muscle-primary)' }));
  defs.appendChild(pattern);

  const clip = el('clipPath', { id: 'body-clip' });
  clip.appendChild(el('path', { d: BODY_PATH }));
  defs.appendChild(clip);

  svg.appendChild(defs);
  document.body.appendChild(svg);
}

function buildFigure(muscles, { primary, secondary, label, clipId }) {
  const g = el('g', { class: 'body-figure' });

  g.appendChild(el('path', { d: BODY_PATH, class: 'body-base' }));

  const painted = el('g', { 'clip-path': `url(#${clipId})` });

  for (const [muscle, shapes] of Object.entries(muscles)) {
    const isPrimary = primary.has(muscle);
    const isSecondary = secondary.has(muscle);
    const state =
      isPrimary && isSecondary ? 'both' : isPrimary ? 'primary' : isSecondary ? 'secondary' : 'none';

    // Untouched groups are left to the neutral base -- drawing them would only
    // add seams across an otherwise clean silhouette.
    if (state === 'none') continue;

    const group = el('g', { class: `body-muscle is-${state}`, 'data-muscle': muscle });
    const title = el('title');
    title.textContent = `${muscle} — ${state === 'both' ? 'primary + secondary' : state}`;
    group.appendChild(title);

    for (const shape of shapes) for (const node of regionNodes(shape)) group.appendChild(node);
    painted.appendChild(group);
  }

  g.appendChild(painted);
  g.appendChild(el('path', { d: BODY_PATH, class: 'body-outline' }));

  const caption = el('text', {
    x: CENTER,
    y: VIEW.h - 8,
    class: 'body-caption',
    'text-anchor': 'middle',
  });
  caption.textContent = label;
  g.appendChild(caption);

  return g;
}

/**
 * @param {Set<string>} primary   primary muscles trained
 * @param {Set<string>} secondary supporting muscles trained
 * @param {object} labels         { front, back } captions
 * @param {object} opts           { view: 'both' | 'front' | 'back' }
 *
 * `view` exists because the two contexts want different framing: the plan
 * screen places the figures side by side with an HTML legend between them, so
 * it asks for one at a time; the print sheet wants a single centred pair.
 * @returns {SVGSVGElement}
 */
export function renderBodyMap(primary, secondary, labels = { front: 'Front', back: 'Back' }, opts = {}) {
  const view = opts.view || 'both';
  // "Full body" is a catch-all in the library rather than a region of its own,
  // so it lights up every group.
  const expand = (set) => {
    if (!set.has('Full body')) return set;
    return new Set([...set, ...MUSCLES_BY_VIEW.front, ...MUSCLES_BY_VIEW.back]);
  };

  const prim = expand(new Set(primary));
  const sec = expand(new Set(secondary));

  // A muscle in both sets is the primary target of one exercise and support in
  // another -- the overlap the stripe exists for, so it stays in both.
  const list = (set) => [...set].sort().join(', ') || 'none';
  const onlyPrimary = new Set([...prim].filter((m) => !sec.has(m)));
  const onlySecondary = new Set([...sec].filter((m) => !prim.has(m)));
  const both = new Set([...prim].filter((m) => sec.has(m)));

  const width = view === 'both' ? VIEW.w * 2 + GAP : VIEW.w;
  const svg = el('svg', {
    class: 'body-map',
    viewBox: `0 0 ${width} ${VIEW.h}`,
    role: 'img',
    'aria-label':
      `Body map${view === 'both' ? '' : `, ${view}`}. Primary: ${list(onlyPrimary)}. ` +
      `Secondary: ${list(onlySecondary)}. Both: ${list(both)}.`,
  });

  // One clip serves every figure. A clipPath resolves in the user space of the
  // element that references it, and the back figure's group is already
  // translated -- translating the clip too would shift it a second time and
  // clip the back away entirely.
  ensureSharedDefs();

  if (view !== 'back') {
    svg.appendChild(
      buildFigure(FRONT_MUSCLES, { primary: prim, secondary: sec, label: labels.front, clipId: 'body-clip' })
    );
  }

  if (view !== 'front') {
    const back = buildFigure(BACK_MUSCLES, {
      primary: prim,
      secondary: sec,
      label: labels.back,
      clipId: 'body-clip',
    });
    if (view === 'both') back.setAttribute('transform', `translate(${VIEW.w + GAP} 0)`);
    svg.appendChild(back);
  }

  return svg;
}

/**
 * Primary and supporting muscle sets for a list of exercises. A muscle can
 * legitimately land in both -- that is what the stripe reports.
 */
export function musclesWorked(exercises) {
  const primary = new Set();
  const secondary = new Set();

  for (const ex of exercises) {
    if (!ex) continue;
    if (ex.primary) primary.add(ex.primary);
    for (const m of ex.secondary || []) secondary.add(m);
  }
  return { primary, secondary };
}
