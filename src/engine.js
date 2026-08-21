/**
 * engine.js -- the workbook's logic, reimplemented.
 *
 * Pure functions only: no DOM, no storage, no globals. Every rule here is
 * traced to a cell formula in docs/logic.md; read that before changing a
 * number.
 */

export const ALWAYS = 'Always';

/* -------------------------------------------------------------- arithmetic */

/**
 * Excel MROUND: round to the nearest multiple of `step`, halves away from zero.
 * The epsilon absorbs binary-float error so 100 * 0.025 lands on a clean 2.5
 * boundary instead of falling just under it.
 */
export function mround(value, step) {
  if (!step) return value;
  const sign = value < 0 ? -1 : 1;
  const n = Math.floor(Math.abs(value) / step + 0.5 + 1e-9);
  return sign * n * step;
}

/** Excel ROUND: halves away from zero, unlike Math.round which rounds half up. */
export function excelRound(value, digits = 0) {
  const f = Math.pow(10, digits);
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.floor(Math.abs(value) * f + 0.5 + 1e-9)) / f;
}

/* ------------------------------------------------------------ prescriptions */

/** Index the 21 prescription rows by "profile|goal", the workbook's PrKey. */
export function indexPrescriptions(prescriptions) {
  const map = new Map();
  for (const p of prescriptions) map.set(`${p.profile}|${p.goal}`, p);
  return map;
}

export function getPrescription(index, profile, goal) {
  return index.get(`${profile}|${goal}`) || null;
}

/**
 * Suggested working load for one exercise.
 * Mirrors column K: bodyweight check first, then missing-1RM, then the range.
 */
export function suggestedLoad(prescription, oneRm) {
  if (!prescription) return { kind: 'unknown', text: '?' };

  if (!prescription.loadMin) {
    return { kind: 'bodyweight', text: 'Bodyweight / RPE' };
  }
  if (!oneRm) {
    return { kind: 'no-1rm', text: 'Enter your 1RM' };
  }

  const min = mround(oneRm * prescription.loadMin, 2.5);
  const max = mround(oneRm * prescription.loadMax, 2.5);
  return {
    kind: 'range',
    min,
    max,
    text: `${min.toFixed(1)}–${max.toFixed(1)} kg`,
  };
}

/**
 * Estimated minutes for one exercise:
 *   round( (setsAvg * (work + rest) + setupSeconds) / 60 )
 * Rounded per exercise and then summed -- not summed and then rounded.
 */
export function exerciseMinutes(prescription, setupSeconds) {
  if (!prescription || !prescription.setsAvg) return 0;
  const seconds =
    prescription.setsAvg * (prescription.workPerSetSec + prescription.restAvgSec) +
    setupSeconds;
  return excelRound(seconds / 60, 0);
}

/* ------------------------------------------------- warm-up / cool-down fill */

/**
 * Walk `items` in selection order, accumulating minutes, and stop at the first
 * one that would push the running total past the budget.
 *
 * This is the workbook's SUMIFS-and-compare, not a knapsack: a later, shorter
 * drill that would still fit is deliberately NOT squeezed in.
 */
function fillToBudget(items, budgetMinutes, selectionKey, displayKey) {
  const ordered = items.slice().sort((a, b) => selectionKey(a) - selectionKey(b));

  const chosen = [];
  let minutes = 0;

  for (const item of ordered) {
    const next = minutes + item.minutes;
    if (next > budgetMinutes) break;
    minutes = next;
    chosen.push(item);
  }

  chosen.sort((a, b) => displayKey(a) - displayKey(b));
  return { items: chosen, minutes };
}

/**
 * Which triggers the chosen exercises fire.
 *
 * Warm-up reads movement patterns + PRIMARY muscles; cool-down reads primary
 * AND secondary muscles and ignores patterns entirely. That asymmetry is the
 * workbook's, not a bug here -- see docs/logic.md section 5.1.
 */
export function collectTriggers(exercises, { patterns, secondary }) {
  const set = new Set();
  for (const ex of exercises) {
    if (!ex) continue;
    if (patterns && ex.pattern) set.add(ex.pattern);
    if (ex.primary) set.add(ex.primary);
    if (secondary) for (const m of ex.secondary || []) set.add(m);
  }
  return set;
}

export function buildWarmup(warmups, exercises, budgetMinutes, options = {}) {
  const triggers = collectTriggers(exercises, {
    patterns: true,
    secondary: options.matchSecondaryForWarmup === true,
  });

  const eligible = warmups.filter(
    (d) => d.trigger === ALWAYS || triggers.has(d.trigger)
  );

  return fillToBudget(
    eligible,
    budgetMinutes,
    (d) => d.priority * 1000 + d.row,
    (d) => d.phaseOrder * 1000 + d.row
  );
}

export function buildCooldown(mobility, exercises, budgetMinutes) {
  // Muscles only -- a movement pattern never selects a mobility exercise.
  const triggers = collectTriggers(exercises, { patterns: false, secondary: true });

  const eligible = mobility.filter(
    (m) => m.target === ALWAYS || triggers.has(m.target)
  );

  return fillToBudget(
    eligible,
    budgetMinutes,
    (m) => m.priority * 1000 + m.row,
    (m) => m.typeOrder * 1000 + m.row
  );
}

/* ---------------------------------------------------------------- assembly */

/**
 * Everything the session view needs, in one pass.
 *
 * @param {object} session   { goal, warmupBudget, cooldownBudget, exerciseIds }
 * @param {object} catalog   { exercises, warmups, mobility, prescriptionIndex,
 *                             setupSeconds, byId }
 * @param {object} oneRmById { [exerciseId]: kg }
 */
export function buildSession(session, catalog, oneRmById = {}) {
  const exercises = (session.exerciseIds || [])
    .map((id) => catalog.byId.get(id))
    .filter(Boolean);

  const main = exercises.map((ex) => {
    const prescription = getPrescription(
      catalog.prescriptionIndex,
      ex.profile,
      session.goal
    );
    return {
      exercise: ex,
      prescription,
      suggested: suggestedLoad(prescription, oneRmById[ex.id]),
      minutes: exerciseMinutes(prescription, catalog.setupSeconds),
    };
  });

  // With no exercises chosen the `Always` drills are still technically
  // eligible, and the workbook would happily bill you 14 minutes of warm-up
  // for a session containing nothing. Report an empty session instead --
  // a UI guard on a degenerate input, not a change to the algorithm.
  const empty = { items: [], minutes: 0 };
  const warmup = exercises.length
    ? buildWarmup(catalog.warmups, exercises, session.warmupBudget)
    : empty;
  const cooldown = exercises.length
    ? buildCooldown(catalog.mobility, exercises, session.cooldownBudget)
    : empty;

  const mainMinutes = main.reduce((sum, row) => sum + row.minutes, 0);

  return {
    warmup,
    main,
    cooldown,
    mainMinutes,
    totalMinutes: warmup.minutes + mainMinutes + cooldown.minutes,
  };
}

/* ------------------------------------------------------------- complexity */

export const COMPLEXITY_LEVELS = ['basic', 'medium', 'advanced'];

/**
 * A lookup from exercise to skill tier, built from data/complexity.json.
 *
 * Rule first, override second. The rule exists so the user's own exercises get
 * a tier without anyone rating them; the override list exists because the rule
 * cannot possibly be right -- a Bodyweight Squat and a Pistol Squat are the
 * same four fields all the way down.
 */
export function indexComplexity(complexity) {
  const byName = new Map();
  for (const tier of COMPLEXITY_LEVELS) {
    for (const name of complexity?.overrides?.[tier] || []) byName.set(name, tier);
  }

  const byProfile = complexity?.rules?.byProfile || {};
  const fallback = complexity?.rules?.default || 'basic';

  return (exercise) => {
    if (!exercise) return fallback;
    // A row that states its own tier is the most authoritative source there is,
    // and it saves conditioning.json from having to repeat its whole movement
    // list inside complexity.json's override arrays.
    if (exercise.tier) return exercise.tier;
    const override = byName.get(exercise.name?.en ?? exercise.name);
    return override || byProfile[exercise.profile] || fallback;
  };
}

/**
 * Tiers are cumulative: picking `advanced` excludes nothing, `medium` admits
 * basic too. Anyone choosing the harder setting is saying what they are
 * willing to see, not what they want exclusively.
 */
export function tierAllows(setting, tier) {
  const ceiling = COMPLEXITY_LEVELS.indexOf(setting);
  const level = COMPLEXITY_LEVELS.indexOf(tier);
  if (ceiling < 0) return true;
  return level >= 0 && level <= ceiling;
}

/* ---------------------------------------------------------- quick workout */

/**
 * Deterministic PRNG (mulberry32), so a workout is reproducible from its seed.
 *
 * Math.random would do the job once, but then the workout could never be shown
 * again -- reopening the plan would silently give you a different session, and
 * "shuffle" could not be told apart from "re-render". Storing one integer with
 * the session buys back the whole thing.
 */
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, rand) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Roulette-wheel pick. This is where the variability comes from. */
function weightedPick(candidates, rand) {
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

/** Heaviest and most technical first, while you are fresh; isolation last. */
const PROFILE_ORDER = [
  'Olympic lift',
  'Plyometric',
  'Heavy compound',
  'Compound',
  'Carry',
  'Core',
  'Isolation',
];

const MATCH_WEIGHT = { primary: 4, fullBody: 2, secondary: 1 };

/**
 * Patterns that are a bucket rather than a movement.
 *
 * "Isolation" covers curls, lateral raises and calf raises; "Core/Anti-movement"
 * covers planks and Pallof presses. Allowing only one of either would make an
 * arm or core session impossible, so within these the duplicate rule falls back
 * to one per target muscle.
 */
const BUCKET_PATTERNS = new Set(['Isolation', 'Core/Anti-movement']);

/** The profiles that make an exercise accessory work rather than a main lift. */
const ACCESSORY_PROFILES = new Set(['Isolation', 'Core']);

/**
 * What counts as "the same exercise again" for selection purposes.
 *
 * Two axes, and both are needed:
 *
 *   Pattern, not pattern-and-primary. Barbell Bench Press is Chest and
 *   Close-Grip Bench Press is Triceps, so keying on the pair let a chest
 *   session return two bench presses and call them different movements.
 *
 *   Profile, because pattern alone is far too coarse. Every chest exercise in
 *   the catalog is Horizontal push -- the flies and the Pec Deck included --
 *   so one-per-pattern blocked the whole chest pool after the first press and
 *   left only a Vertical push that happens to list Chest as a secondary. A
 *   press and a fly are not the same movement twice, and the profile is the
 *   field that already knows it.
 */
function shapeKey(ex) {
  const role = ACCESSORY_PROFILES.has(ex.profile) ? 'accessory' : 'main';
  // Inside a bucket pattern the pattern says nothing, so the target does.
  const target = BUCKET_PATTERNS.has(ex.pattern) ? ex.primary : '';
  return `${ex.pattern}|${role}|${target}`;
}

/**
 * Build a session from what you have rather than from what you chose.
 *
 * Four inputs: which muscle groups, how long you have, which goal, and how
 * much technique you are willing to be handed. Everything else falls out.
 *
 * The time is the *whole* session, so the warm-up and mobility budgets are
 * subtracted before anything is chosen -- "I have an hour" means an hour in
 * the building, and a plan that estimates 85 minutes would be a lie about the
 * only number the user actually knew for certain.
 *
 * Selection is round-robin across the chosen muscle groups rather than a
 * single ranked list. A ranked list with three groups selected reliably spends
 * the whole budget on whichever group has the most catalog entries; taking one
 * exercise per group in rotation spreads the session over what was asked for,
 * and running out of time simply truncates the last lap.
 *
 * Within a group the pick is weighted-random, not best-first. That is the
 * "noise": the same inputs on a different seed give a genuinely different
 * session, so the feature can be used twice in a week without prescribing the
 * same five lifts. Weights keep it sane -- an exercise that targets the group
 * is three times likelier than one that merely assists.
 */
export function generateQuickWorkout(options, catalog, oneRmById = {}) {
  const {
    muscles = [],
    minutes = 60,
    goal = 'Strength',
    warmupBudget = 15,
    cooldownBudget = 10,
    complexity = 'medium',
    seed = 1,
    maxExercises = 8,
  } = options;

  const rand = mulberry32(seed);
  const tierOf = catalog.tierOf;
  const mainBudget = minutes - warmupBudget - cooldownBudget;

  // No targets means no preference, which is a full-body session rather than
  // an empty one.
  const targets = muscles.length
    ? muscles
    : catalog.vocabulary.muscles.filter((m) => m !== 'Full body');

  // liftingPool, not exercises: quick workout prescribes against sets, reps and
  // a percentage of a 1RM, none of which a rowing machine has.
  const eligible = catalog.liftingPool
    .filter((ex) => !ex.archived && tierAllows(complexity, tierOf(ex)))
    .map((ex) => {
      const prescription = getPrescription(catalog.prescriptionIndex, ex.profile, goal);
      return { ex, prescription, minutes: exerciseMinutes(prescription, catalog.setupSeconds) };
    })
    // A zero-minute row is the workbook's dead end (Isolation | Explosivity,
    // setsAvg 0). It costs nothing, so it would be picked forever.
    .filter((row) => row.prescription && row.minutes > 0);

  if (mainBudget <= 0 || !eligible.length) {
    return { exerciseIds: [], chosen: [], mainMinutes: 0, mainBudget, seed, shortfall: true };
  }

  const poolFor = (muscle) =>
    eligible
      .map((row) => {
        let weight = 0;
        if (row.ex.primary === muscle) weight = MATCH_WEIGHT.primary;
        else if (row.ex.primary === 'Full body') weight = MATCH_WEIGHT.fullBody;
        else if ((row.ex.secondary || []).includes(muscle)) weight = MATCH_WEIGHT.secondary;
        return { ...row, weight };
      })
      .filter((row) => row.weight > 0);

  const pools = new Map(targets.map((m) => [m, poolFor(m)]));

  const chosen = [];
  const takenIds = new Set();
  // One exercise per movement. Without it a Quads session can legitimately
  // return Back Squat, Front Squat and Pause Squat, which is a correct reading
  // of the data and a useless workout.
  const takenShapes = new Set();
  let used = 0;

  // The rotation order is shuffled so the first group picked is not always the
  // first one tapped -- otherwise the group at the top of the list gets the
  // heaviest exercise every single time.
  const rotation = shuffled(targets, rand);

  let progressed = true;
  while (progressed && chosen.length < maxExercises) {
    progressed = false;

    for (const muscle of rotation) {
      if (chosen.length >= maxExercises) break;

      const candidates = (pools.get(muscle) || []).filter(
        (row) =>
          !takenIds.has(row.ex.id) &&
          !takenShapes.has(shapeKey(row.ex)) &&
          used + row.minutes <= mainBudget
      );

      // Exercises that actually target the group beat ones that merely assist,
      // and they beat them absolutely rather than by weight. Weighting alone
      // let a Barbell Row into an arms session and a Back Squat into a core
      // one -- both defensible readings of the secondary column, neither what
      // anyone tapping "Biceps" is asking for. Assistance is a fallback for
      // when the group has nothing of its own left, not a rival.
      const targeted = candidates.filter((row) => row.weight > MATCH_WEIGHT.secondary);
      const pick = weightedPick(targeted.length ? targeted : candidates, rand);
      if (!pick) continue;

      chosen.push(pick);
      takenIds.add(pick.ex.id);
      takenShapes.add(shapeKey(pick.ex));
      used += pick.minutes;
      progressed = true;
    }
  }

  chosen.sort((a, b) => {
    const rank = PROFILE_ORDER.indexOf(a.ex.profile) - PROFILE_ORDER.indexOf(b.ex.profile);
    return rank || a.ex.id.toString().localeCompare(b.ex.id.toString());
  });

  return {
    exerciseIds: chosen.map((row) => row.ex.id),
    chosen,
    mainMinutes: used,
    mainBudget,
    seed,
    shortfall: chosen.length === 0,
  };
}

/* --------------------------------------------------------- conditioning */

export const CONDITIONING_FORMATS = ['emom', 'amrap', 'intervals', 'tabata', 'fortime'];
export const PARTNER_MODES = ['alternating', 'shared', 'relay'];

/**
 * What part of you a conditioning movement taxes first.
 *
 * The single most common way a generated conditioning workout goes wrong is
 * stacking three movements that share a role -- three lower-body movements in a
 * round means the legs quit long before the lungs do, which is a leg workout
 * wearing a conditioning workout's clothes. Selection spreads across these.
 */
const ROLE_LOWER = new Set(['Quads', 'Glutes', 'Hamstrings', 'Calves', 'Adductors']);
const ROLE_UPPER = new Set(['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Traps', 'Forearms']);

function conditioningRole(ex) {
  if (ex.pattern === 'Monostructural') return 'mono';
  if (ex.primary === 'Core') return 'core';
  if (ROLE_LOWER.has(ex.primary)) return 'lower';
  if (ROLE_UPPER.has(ex.primary)) return 'upper';
  return 'full';
}

/**
 * Numbers workouts are actually written in.
 *
 * `pace × seconds / 60` produces things like 17.33 burpees, and a prescription
 * nobody would write by hand reads as a machine talking. Snapping to a ladder
 * costs a few percent of accuracy against a pace figure that is a ballpark
 * anyway, and buys "15 burpees" instead of "17".
 */
const NICE_AMOUNTS = {
  reps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 16, 18, 20, 21, 24, 25, 30, 35, 40, 45, 50, 60, 75, 100],
  // Starts at 5: below that the erg's counter barely moves before you are told
  // to stop, and "3 calories" is not a thing anyone writes on a whiteboard.
  calories: [5, 6, 7, 8, 9, 10, 12, 15, 18, 20, 25, 30, 35, 40, 50, 60],
  metres: [10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000],
};

/**
 * `fit` rounds down to the ladder instead of to the nearest rung.
 *
 * It is for the time-boxed formats. A minute is sixty seconds whatever the
 * ladder says, so rounding 6.67 burpees up to 7 prescribes work that does not
 * fit the window it was sized for -- and in an EMOM, work that does not fit is
 * work that eats the rest you were supposed to get, every single round. Landing
 * a rep light is free; landing a rep heavy compounds.
 */
function niceAmount(raw, unit, mode = 'nearest') {
  // Seconds are the one unit that must not be snapped to a ladder: the amount
  // IS the work window, so a 20 s Tabata plank has to read 20 s and not 18.
  if (unit === 'seconds') {
    const step = mode === 'fit' ? Math.floor(raw / 5) * 5 : Math.round(raw / 5) * 5;
    return Math.max(5, step);
  }
  const ladder = NICE_AMOUNTS[unit] || NICE_AMOUNTS.reps;
  if (mode === 'fit') {
    const under = ladder.filter((v) => v <= raw);
    if (under.length) return under[under.length - 1];
    // Nothing on the ladder fits. The ladder is a readability aid and the
    // window is a fact, so the window wins: a 20-second Tabata on a rower is
    // four calories, whatever the ladder's opinion of small numbers.
    return Math.max(1, Math.floor(raw));
  }
  return ladder.reduce((best, v) => (Math.abs(v - raw) < Math.abs(best - raw) ? v : best), ladder[0]);
}

/**
 * How partner work changes the numbers.
 *
 * Three modes, and they scale in two different ways:
 *
 *   `alternating` -- you go, I go. Only one of you works at a time, so within a
 *   fixed wall-clock each person gets half the turns. That is not a bug to
 *   correct: a full turn of rest between efforts is exactly what makes this
 *   format worth doing, and it means you can go harder than the pace assumes.
 *   So the work per turn goes UP rather than the duration going up.
 *
 *   `shared` and `relay` -- everyone working against one target. The prescribed
 *   amount is the combined figure, so it scales with the number of people or
 *   the pair finishes in half the time and calls it a workout.
 *
 * The rest bonus applies to amount-driven formats only, and the distinction is
 * the whole of it: in an AMRAP or a for-time the amount decides the duration,
 * so being fresher can be expressed as more work. In an EMOM, an interval or a
 * Tabata the duration decides the amount -- the window is 60 seconds whatever
 * you do -- and a bonus there prescribed 50 seconds of work inside a 60-second
 * minute, which is not a harder workout, just an impossible one. Alternating in
 * a window-driven format is simply the same prescription taking turns, which is
 * exactly how anyone actually runs it.
 *
 * Scaling by `people` stays correct in both: in a window-driven format everyone
 * works at once, so a combined 80 seconds inside a 60-second minute is 40
 * seconds each.
 */
const PARTNER_REST_BONUS = 1.3;

function partnerScale(partner, windowDriven) {
  if (!partner) return 1;
  const people = Math.max(2, partner.people || 2);
  if (partner.mode !== 'alternating') return people;
  return windowDriven ? 1 : PARTNER_REST_BONUS;
}

/**
 * The shape of each format, before any movement is chosen.
 *
 * `work`/`rest` are seconds and `rounds` is a count; `perStation` is how many
 * seconds of actual effort one movement should be sized to fill. `stations` is
 * how many movements the format wants. AMRAP alone has no round count -- the
 * count is the score.
 */
function planFormat(format, minutes, rand, style = null) {
  switch (format) {
    case 'emom': {
      // Two EMOMs, and which one it is changes both the station count and how
      // the work is sized. See `blockSteps`.
      const together = style === 'together';

      if (together) {
        // Everything happens inside one minute, so the movements share the 40 s
        // rather than each getting it. Two or three: four movements in forty
        // seconds is ten seconds each, which is a transition, not a set.
        const stations = 2 + Math.floor(rand() * 2);
        return {
          work: 60,
          rest: 0,
          rounds: minutes,
          stations,
          perStation: 40 / stations,
          openEnded: false,
          style: 'together',
        };
      }

      // Rotating. Stations that divide the duration evenly mean every movement
      // comes up the same number of times, which is both fairer and easier to
      // read off a plan. Capped so every movement comes round at least twice: a
      // four-minute EMOM with four stations is four unrelated minutes.
      const ceiling = Math.max(2, Math.floor(minutes / 2));
      const options = [2, 3, 4].filter((n) => n <= ceiling && minutes % n === 0);
      const stations = options.length
        ? options[Math.floor(rand() * options.length)]
        : Math.min(3, ceiling);
      return { work: 60, rest: 0, rounds: minutes, stations, perStation: 40, openEnded: false, style: 'rotate' };
    }
    case 'amrap': {
      // At 30 s a movement, a round is `stations x 30` seconds, so the round
      // count is `2 x minutes / stations`. Capping stations at `minutes / 2`
      // keeps that at four or more: a four-minute AMRAP that yields two rounds
      // is not an AMRAP, it is two rounds, and the score stops meaning anything.
      // Round = stations x 30 s, so rounds = 2 x minutes / stations. The ceiling
      // keeps that at three or more. It used to demand four, which was right for
      // a workout that is one block and wrong once blocks are short by design --
      // a five-minute AMRAP capped at two movements is half the body coverage
      // the block could carry, to buy a fourth round nobody asked for.
      const ceiling = Math.max(2, Math.round(minutes / 1.7));
      const stations = Math.min(2 + Math.floor(rand() * 3), ceiling); // 2-4
      // 30 s per movement rather than a fixed round length divided by however
      // many movements there are. A fixed 75 s round split four ways is 19 s
      // each, which prescribes three calories of ski erg -- an amount too small
      // to be worth walking to the machine for. Rounds therefore grow with the
      // movement count, which is also how real AMRAPs are written: a four-part
      // round is a two-minute round.
      return { work: null, rest: 0, rounds: null, stations, perStation: 30, openEnded: true };
    }
    case 'intervals': {
      const shapes = [
        { work: 30, rest: 30 },
        { work: 40, rest: 20 },
        { work: 45, rest: 15 },
        { work: 60, rest: 60 },
        { work: 90, rest: 60 },
      ];
      // Only shapes that fit at least four rounds inside the budget. Forcing a
      // four-round minimum onto whichever shape was drawn is what used to push
      // a 90/60 interval to ten minutes when eight were asked for -- the cost
      // of a long work period has to come out of the shape choice, not out of
      // the user's evening.
      const budget = minutes * 60;
      const fits = shapes.filter((s) => (s.work + s.rest) * 4 <= budget);
      const usable = fits.length ? fits : [shapes[0]];
      const shape = usable[Math.floor(rand() * usable.length)];
      // The last rest is never served -- the block is over -- so the true cost
      // of N rounds is `N × (work + rest) − rest`, and the round count solves
      // that rather than the naive division. Flooring the naive one wasted up
      // to a whole round: a 90/60 shape in twelve minutes ran four rounds and
      // nine minutes against a twelve-minute ask.
      const rounds = Math.max(
        4,
        Math.floor((budget + shape.rest) / (shape.work + shape.rest))
      );
      const stations = 1 + Math.floor(rand() * 2); // 1-2, alternating
      return { ...shape, rounds, stations, perStation: shape.work, openEnded: false };
    }
    case 'tabata': {
      // Tabata is a fixed protocol, not a parameter: 8 x 20/10 is four minutes.
      // The duration is therefore derived from how many movements fit the ask,
      // never the other way round -- and it floors rather than rounds, because
      // ten minutes asked for should give eight of Tabata and not twelve.
      // Under-filling a time budget is a choice the user can spend elsewhere;
      // overrunning one is the app deciding how long their evening is.
      const stations = Math.max(1, Math.min(4, Math.floor(minutes / 4)));
      return { work: 20, rest: 10, rounds: 8, stations, perStation: 20, openEnded: false };
    }
    case 'fortime':
    default: {
      const rounds = [3, 4, 5][Math.floor(rand() * 3)];
      // Rounds multiply stations, so a short block divides its minutes twice
      // over: five minutes at five rounds of four movements is twelve seconds a
      // station, which prescribes two burpees. Capping stations at
      // `minutes × 2 / rounds` keeps every station worth at least ~25 s, which
      // is the floor below which an amount stops being worth writing down.
      const ceiling = Math.max(2, Math.floor((minutes * 2) / rounds));
      const stations = Math.min(2 + Math.floor(rand() * 3), ceiling); // 2-4
      // Sized so the whole thing lands near the budget rather than under it:
      // a for-time workout that takes four minutes of a fifteen-minute slot is
      // a warm-up. 85% leaves room for the clock to be beaten.
      const perRound = (minutes * 60 * 0.85) / rounds;
      return { work: null, rest: 0, rounds, stations, perStation: perRound / stations, openEnded: false };
    }
  }
}

/**
 * Pick movements that do not tread on each other.
 *
 * Weighted-random rather than best-first, for the same reason quick workout is:
 * the same inputs on a different seed have to give a genuinely different
 * workout. The weighting pushes towards role diversity without hard-blocking
 * it, so a pool that only has lower-body movements in it still returns a
 * workout rather than nothing.
 *
 * The penalty is cubic, and it has to be. A linear one left a used role on a
 * quarter weight, which sounds decisive until you notice `lower` has far more
 * candidates than any other role -- a quarter of a pool that large still wins
 * often enough to produce `mono, lower, lower`, which is the exact thing roles
 * exist to prevent. Cubed, a used role drops to an eighth and a twice-used one
 * to a twenty-seventh.
 */
function pickConditioningMovements(count, pool, rand) {
  const chosen = [];
  const usedShapes = new Set();
  const usedRoles = new Map();
  let remaining = pool.slice();

  while (chosen.length < count && remaining.length) {
    const candidates = remaining
      .filter((m) => !usedShapes.has(m.shape))
      .map((m) => ({ ...m, weight: 1 / (1 + (usedRoles.get(m.role) || 0)) ** 3 }));
    if (!candidates.length) break;

    const pick = weightedPick(candidates, rand);
    if (!pick) break;

    chosen.push(pick);
    usedShapes.add(pick.shape);
    usedRoles.set(pick.role, (usedRoles.get(pick.role) || 0) + 1);
    remaining = remaining.filter((m) => m.ex.id !== pick.ex.id);
  }

  return chosen;
}

/** Seconds of effort a prescribed amount represents, at its movement's pace. */
export function movementSeconds(movement) {
  if (!movement?.pace) return 0;
  return (movement.amount / movement.pace) * 60;
}

/**
 * Generate one conditioning block.
 *
 * Four inputs the user gives -- how long, which format, what kit is to hand,
 * and whether anyone is doing it with them -- and one they gave earlier, the
 * complexity tier. Everything else falls out of `pace`, which is the only
 * number that makes a movement comparable to any other: units per minute at a
 * hard but repeatable effort. Sizing a station is `pace × seconds / 60`, and
 * that one line is what lets a single generator serve five formats that have
 * nothing structurally in common.
 *
 * `format: 'any'` picks one, which is the interesting default -- most people
 * asking for a hard fifteen minutes do not have a preference between an EMOM
 * and an AMRAP, and being handed one is more useful than being asked.
 */
export function generateConditioning(options, catalog) {
  const {
    minutes = 12,
    format = 'any',
    kit = ['bodyweight', 'erg', 'run', 'floor', 'rig'],
    complexity = 'medium',
    lowImpact = false,
    partner = null,
    seed = 1,
    exclude = null,
    excludeFormats = null,
  } = options;

  const rand = mulberry32(seed);

  // Having kit implies having a floor and a body. Anyone who ticked "floor &
  // kit" owns a box and a kettlebell, and denying them burpees because they
  // chose the box with more equipment in it would be a nonsense. The reverse
  // does not hold -- bodyweight alone means alone, which is the entire point of
  // the option.
  const allowedKit = new Set(kit);
  if (allowedKit.has('floor')) allowedKit.add('bodyweight');

  const pool = (catalog.conditioningPool || [])
    .filter((ex) => !ex.archived)
    .map((ex) => ({ ex, ...catalog.conditioningOf(ex) }))
    .filter((m) => m && allowedKit.has(m.kit))
    .filter((m) => tierAllows(complexity, m.tier))
    .filter((m) => !lowImpact || m.impact === 'low')
    .map((m) => ({ ...m, role: conditioningRole(m.ex), shape: `${m.ex.pattern}|${m.ex.primary}` }));

  if (!pool.length) {
    return { format: null, minutes: 0, movements: [], shortfall: true, seed };
  }

  // With no format asked for, prefer one this workout has not used yet. An EMOM
  // then an AMRAP then a for-time is three different relationships with the
  // clock, and that is most of what makes a third block feel unlike the first.
  let choices = options.formatPool || CONDITIONING_FORMATS;
  if (excludeFormats) {
    const unused = choices.filter((f) => !excludeFormats.has(f));
    if (unused.length) choices = unused;
  }
  const picked = format === 'any' ? choices[Math.floor(rand() * choices.length)] : format;

  // Which EMOM. Asked for explicitly where the caller has an opinion, and
  // otherwise leaning to `together` -- it is what most people mean by an EMOM,
  // and a generator that only ever produced the rotating kind is how the plan
  // and the clock came to be describing different workouts.
  const emomStyle =
    options.style || (rand() < 0.65 ? 'together' : 'rotate');

  const plan = planFormat(picked, minutes, rand, emomStyle);

  // Movements already spent on earlier blocks of the same workout. Honoured
  // where the pool can afford it and abandoned where it cannot: a bodyweight-only
  // pool is twenty movements, and four blocks of four would rather repeat a
  // burpee than hand back a block with two movements in it.
  const fresh = exclude ? pool.filter((m) => !exclude.has(m.ex.id)) : pool;
  const usable = fresh.length >= plan.stations ? fresh : pool;
  const movementRows = pickConditioningMovements(plan.stations, usable, rand);

  if (!movementRows.length) {
    return { format: picked, minutes: 0, movements: [], shortfall: true, seed };
  }

  // Window-driven: the clock decides how much work fits. Amount-driven: the
  // work decides how long it takes. Partner maths differs between the two.
  const windowDriven = picked === 'emom' || picked === 'intervals' || picked === 'tabata';
  const scale = partnerScale(partner, windowDriven);
  const movements = movementRows.map((m) => {
    const raw = (m.pace * plan.perStation * scale) / 60;
    const amount = niceAmount(raw, m.unit, windowDriven ? 'fit' : 'nearest');
    return { ref: m.ex.id, amount, unit: m.unit, pace: m.pace, role: m.role };
  });

  // A window-driven block reports what its own steps will actually take, not
  // what was asked for. The two are not the same -- a protocol has its own
  // arithmetic, and rounds do not divide a budget evenly -- and the plan
  // claiming twelve minutes for a block the clock runs in nine is the plan
  // being wrong. Deriving it from the same step list the timer walks makes them
  // agree by construction rather than by two functions staying in step.
  const shape = {
    format: picked,
    rounds: plan.rounds,
    work: plan.work,
    rest: plan.rest,
    style: plan.style,
    movements,
  };
  const actualMinutes = windowDriven
    ? Math.max(1, Math.round(stepsSeconds(blockSteps(shape)) / 60))
    : minutes;

  const roundSeconds = movements.reduce((sum, m) => sum + movementSeconds(m), 0);

  return {
    format: picked,
    minutes: actualMinutes,
    work: plan.work,
    rest: plan.rest,
    rounds: plan.rounds,
    openEnded: plan.openEnded,
    /** Which EMOM this is. Null for every other format. */
    style: plan.style || null,
    movements,
    partner: partner ? { mode: partner.mode, people: Math.max(2, partner.people || 2) } : null,
    /** One time through every movement, in seconds. The AMRAP round estimate. */
    roundSeconds: Math.round(roundSeconds),
    /** What an AMRAP is likely to score, so the plan can say something useful. */
    estimatedRounds: plan.openEnded && roundSeconds > 0
      ? Math.max(1, Math.round((actualMinutes * 60) / roundSeconds))
      : null,
    seed,
    shortfall: false,
  };
}

/** The interval shapes a hand-built block can choose between. */
export const INTERVAL_SHAPES = [
  { work: 30, rest: 30 },
  { work: 40, rest: 20 },
  { work: 45, rest: 15 },
  { work: 60, rest: 60 },
  { work: 90, rest: 60 },
];

/**
 * Assemble a block from a hand-made choice of format, length and movements.
 *
 * The generator picks movements and sizes them; this takes both as given and
 * fills in everything else. What it must not do is compute the structural
 * numbers differently -- a hand-built EMOM and a generated one are the same
 * kind of thing, and the timer walks both with the same code.
 *
 * So the derivation is the generator's, not a parallel one: `rounds`, `work`
 * and `rest` come out the same way, and `minutes` for a window-driven format is
 * read back off `blockSteps` rather than trusted from the input. Someone who
 * asks for a ten-minute Tabata of three movements gets twelve minutes and is
 * told twelve, because that is what the clock will actually run.
 */
export function assembleConditioningBlock(input) {
  const {
    format = 'emom',
    minutes = 12,
    movements = [],
    partner = null,
    intervalShape = INTERVAL_SHAPES[1],
    style = 'together',
  } = input;

  let rounds = null;
  let work = null;
  let rest = 0;
  let openEnded = false;

  switch (format) {
    case 'emom':
      rounds = Math.max(1, minutes);
      work = 60;
      break;
    case 'intervals': {
      work = intervalShape.work;
      rest = intervalShape.rest;
      rounds = Math.max(1, Math.floor((minutes * 60 + rest) / (work + rest)));
      break;
    }
    case 'tabata':
      work = 20;
      rest = 10;
      rounds = 8;
      break;
    case 'amrap':
      openEnded = true;
      break;
    default:
      // For time: the rounds are the shape, and the minutes are the cap.
      rounds = Math.max(1, input.rounds || 3);
      break;
  }

  const shape = { format, rounds, work, rest, movements, style: format === 'emom' ? style : null };
  const windowDriven = format === 'emom' || format === 'intervals' || format === 'tabata';
  const actualMinutes = windowDriven
    ? Math.max(1, Math.round(stepsSeconds(blockSteps(shape)) / 60))
    : Math.max(1, minutes);

  const roundSeconds = movements.reduce((sum, m) => sum + movementSeconds(m), 0);

  return {
    format,
    minutes: actualMinutes,
    work,
    rest,
    rounds,
    openEnded,
    style: format === 'emom' ? style : null,
    movements,
    partner: partner ? { mode: partner.mode, people: Math.max(2, partner.people || 2) } : null,
    roundSeconds: Math.round(roundSeconds),
    estimatedRounds:
      openEnded && roundSeconds > 0
        ? Math.max(1, Math.round((actualMinutes * 60) / roundSeconds))
        : null,
    shortfall: movements.length === 0,
  };
}

/**
 * A sensible starting amount for a movement someone has just added by hand.
 *
 * The same `pace × seconds / 60` the generator uses, so a hand-built block does
 * not open on numbers that need fixing before they mean anything. It is a
 * starting point, not a prescription -- the whole reason to build by hand is
 * that you intend to change it.
 */
export function defaultAmountFor(cond, format, stations = 3) {
  const perStation =
    format === 'emom' ? 40
    : format === 'tabata' ? 20
    : format === 'intervals' ? 40
    : format === 'amrap' ? 30
    : 45;
  const windowDriven = format === 'emom' || format === 'intervals' || format === 'tabata';
  return niceAmount((cond.pace * perStation) / 60, cond.unit, windowDriven ? 'fit' : 'nearest');
}

/* ------------------------------------------------------- multi-block work */

/**
 * The smallest block worth calling a block, and the breather between two.
 *
 * Four minutes because that is Tabata's own unit and the shortest thing anyone
 * writes down as a piece of a workout. Two minutes of transition because
 * changing station, resetting a rower and getting your breath back is real time
 * — leaving it out would make the estimate lie by the length of a whole block
 * across a four-block session.
 */
export const BLOCK_MIN_MINUTES = 5;

/**
 * How long you get between blocks, by default.
 *
 * Two minutes was a constant, which made it a guess the app was unwilling to
 * revisit -- and the right number depends entirely on where you are. Two is
 * plenty when the kit is at your feet; it is nothing at all when the rower is
 * across a busy gym and somebody is on it. So it is a default now, and
 * `COND_REST_CHOICES` is what the user can say instead.
 */
export const BLOCK_REST_MINUTES = 2;
export const COND_REST_CHOICES = [0, 1, 2, 3, 5];
const BLOCK_CEILING = 4;

/**
 * Formats worth giving a block of a multi-block workout.
 *
 * Tabata is one movement per four minutes by protocol, and intervals are one or
 * two. Spending a whole block on either costs the workout most of the coverage
 * the split was supposed to buy: an early version handed back three blocks
 * holding four distinct movements between them, which is fewer than a single
 * long block would have. They are still there when asked for by name -- a
 * Tabata is a Tabata and someone choosing one knows what they are getting.
 */
const MULTI_BLOCK_FORMATS = ['emom', 'amrap', 'fortime'];

/**
 * How many blocks the clock can afford.
 *
 * N blocks cost `N × min + (N-1) × rest`, so the answer falls straight out of
 * that. Capped at four regardless: past that the blocks get short enough that
 * the transitions cost more than the work, and a workout that is mostly walking
 * between stations is not a conditioning workout.
 */
export function maxConditioningBlocks(minutes, restMinutes = BLOCK_REST_MINUTES) {
  const fit = Math.floor((minutes + restMinutes) / (BLOCK_MIN_MINUTES + restMinutes));
  return Math.max(1, Math.min(BLOCK_CEILING, fit));
}

/**
 * A conditioning workout: one block, or several with a breather between.
 *
 * One block of three movements over sixteen minutes is the same three movements
 * five times each, which trains a narrow slice of you and is dull by minute ten.
 * Three blocks over the same sixteen minutes is nine movements, each block short
 * enough to be attacked rather than paced. That is how conditioning is actually
 * programmed, and the data model already allowed for it -- `blocks` has been an
 * array since the beginning and only ever had one thing in it.
 *
 * Two rules make the difference worth having:
 *
 *   Movements do not repeat across blocks while the pool can afford it, so a
 *   three-block workout really is nine movements rather than the same three
 *   dealt again.
 *
 *   Formats vary across blocks when none was asked for. An EMOM then an AMRAP
 *   then a for-time is three different relationships with the clock, which is
 *   most of what makes the second half feel unlike the first.
 */
export function generateConditioningWorkout(options, catalog) {
  const {
    minutes = 12,
    blocks: requested = 1,
    seed = 1,
    format = 'any',
    restBetween = BLOCK_REST_MINUTES,
  } = options;

  const count = Math.max(1, Math.min(maxConditioningBlocks(minutes, restBetween), requested));
  const restTotal = (count - 1) * restBetween;
  const per = Math.floor((minutes - restTotal) / count);

  const rand = mulberry32(seed);
  const used = new Set();
  const usedFormats = new Set();
  const blocks = [];

  for (let i = 0; i < count; i += 1) {
    // The last block absorbs the rounding, so the workout adds up to the ask
    // rather than losing a minute per block to the floor above.
    const spare = i === count - 1 ? minutes - restTotal - per * count : 0;
    const block = generateConditioning(
      {
        ...options,
        minutes: per + spare,
        format,
        exclude: used,
        excludeFormats: usedFormats,
        formatPool: count > 1 ? MULTI_BLOCK_FORMATS : CONDITIONING_FORMATS,
        seed: Math.floor(rand() * 2 ** 31),
      },
      catalog
    );
    if (block.shortfall) continue;
    block.movements.forEach((m) => used.add(m.ref));
    usedFormats.add(block.format);
    blocks.push(block);
  }

  if (!blocks.length) return { blocks: [], minutes: 0, restBetween: 0, shortfall: true };

  const worked = blocks.reduce((sum, b) => sum + b.minutes, 0);
  return {
    blocks,
    /** Wall-clock for the whole thing, transitions included. */
    minutes: worked + (blocks.length - 1) * restBetween,
    restBetween: blocks.length > 1 ? restBetween : 0,
    /** Distinct movements across the workout -- the number this feature exists for. */
    distinctMovements: used.size,
    shortfall: false,
  };
}

/* ------------------------------------------------------- running the clock */

/**
 * A block, flattened into the steps a clock can walk.
 *
 * The five formats have nothing structurally in common on paper, and the timer
 * would need five state machines to run them -- except that three of them are
 * just a list of timed windows, and the other two are one open window with a
 * counter. Flattening to a step list here is the same trick `pace` pulled for
 * generation: get the shape into one form and everything downstream stops
 * caring which format it came from.
 *
 * Each step is `{ kind, seconds, movement, round, label }`:
 *
 *   `work` / `rest`  a fixed window. The clock counts it down and moves on.
 *   `amrap`          one open window; the round counter is the score.
 *   `fortime`        one window counting UP to a cap; elapsed is the score.
 */
export function blockSteps(block) {
  const mv = block.movements || [];
  if (!mv.length) return [];

  switch (block.format) {
    case 'emom': {
      // The whole minute is the step either way: what is left after the work is
      // the rest, which is the format's entire idea. What differs is what the
      // minute contains.
      //
      // `together` -- every movement, every minute. What most people mean by
      // "EMOM: 5 burpees and 10 air squats".
      //
      // `rotate` -- one movement per minute, cycling. Also a real EMOM, and
      // what this generator produced exclusively until the plan card and the
      // clock were found to be describing different workouts.
      //
      // Absent `style` means `rotate`, because that is what every block saved
      // before this existed actually was.
      const together = block.style === 'together';
      return Array.from({ length: block.rounds }, (_, i) =>
        together
          ? { kind: 'work', seconds: 60, movements: mv, round: i + 1, rounds: block.rounds, style: 'together' }
          : {
              kind: 'work',
              seconds: 60,
              movement: mv[i % mv.length],
              round: i + 1,
              rounds: block.rounds,
              style: 'rotate',
            }
      );
    }
    case 'intervals': {
      const steps = [];
      for (let r = 0; r < block.rounds; r += 1) {
        steps.push({
          kind: 'work',
          seconds: block.work,
          movement: mv[r % mv.length],
          round: r + 1,
          rounds: block.rounds,
        });
        // No trailing rest: the block is over, and a timer that makes you wait
        // out a rest period before telling you so is just wrong.
        if (block.rest > 0 && r < block.rounds - 1) {
          steps.push({ kind: 'rest', seconds: block.rest, round: r + 1, rounds: block.rounds });
        }
      }
      return steps;
    }
    case 'tabata': {
      // Eight rounds of one movement, then eight of the next -- not the
      // movements rotating within a round. That is the protocol, and it is why
      // Tabata costs four minutes per movement.
      const steps = [];
      mv.forEach((movement, m) => {
        for (let r = 0; r < block.rounds; r += 1) {
          steps.push({
            kind: 'work',
            seconds: block.work,
            movement,
            round: r + 1,
            rounds: block.rounds,
            group: m + 1,
            groups: mv.length,
          });
          const last = m === mv.length - 1 && r === block.rounds - 1;
          if (!last) steps.push({ kind: 'rest', seconds: block.rest, round: r + 1, rounds: block.rounds });
        }
      });
      return steps;
    }
    case 'amrap':
      return [{ kind: 'amrap', seconds: block.minutes * 60, movements: mv }];
    default:
      return [{ kind: 'fortime', seconds: block.minutes * 60, movements: mv, countUp: true, rounds: block.rounds }];
  }
}

/**
 * The whole workout as one sequence: every block's steps, with the transition
 * between blocks sitting in the list as a step of its own rather than as a
 * special case the clock has to remember.
 */
export function workoutSteps(blocks, restMinutes = BLOCK_REST_MINUTES) {
  const out = [];
  blocks.forEach((block, i) => {
    if (i > 0 && restMinutes > 0) {
      out.push({ kind: 'between', seconds: restMinutes * 60, block: i, nextBlock: block });
    }
    for (const step of blockSteps(block)) out.push({ ...step, block: i });
  });
  return out;
}

/** Total seconds the sequence will take, transitions included. */
export function stepsSeconds(steps) {
  return steps.reduce((sum, s) => sum + s.seconds, 0);
}

/* -------------------------------------------------------------------- log */

/** Epley. Reliable to about 10 reps, optimistic beyond that. */
export function estimatedOneRm(weight, reps) {
  if (!weight || !reps) return null;
  return weight * (1 + reps / 30);
}

export function setVolume(weight, reps) {
  if (!weight || !reps) return null;
  return weight * reps;
}

/** Per-exercise rollup of the training log. Derived, never stored. */
export function summariseProgress(logEntries, byId) {
  const byExercise = new Map();

  for (const entry of logEntries) {
    const ex = byId.get(entry.exerciseId);
    if (!ex) continue;

    let row = byExercise.get(entry.exerciseId);
    if (!row) {
      row = {
        exercise: ex,
        sets: 0,
        volume: 0,
        heaviest: 0,
        bestEstimated1Rm: 0,
        lastTrained: null,
      };
      byExercise.set(entry.exerciseId, row);
    }

    const volume = setVolume(entry.weight, entry.reps) || 0;
    const est = estimatedOneRm(entry.weight, entry.reps) || 0;

    row.sets += 1;
    row.volume += volume;
    row.heaviest = Math.max(row.heaviest, entry.weight || 0);
    row.bestEstimated1Rm = Math.max(row.bestEstimated1Rm, est);
    if (!row.lastTrained || entry.date > row.lastTrained) row.lastTrained = entry.date;
  }

  return [...byExercise.values()].sort((a, b) =>
    (b.lastTrained || '').localeCompare(a.lastTrained || '')
  );
}

/* ----------------------------------------------------------- log analysis */

/** Days between two ISO dates, positive when `date` is in the past. */
function daysAgo(date, from) {
  const a = Date.parse(`${date}T00:00:00`);
  const b = Date.parse(`${from}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return (b - a) / 86400000;
}

export function withinDays(entries, days, today) {
  return entries.filter((e) => {
    const d = daysAgo(e.date, today);
    return d >= 0 && d < days;
  });
}

/**
 * Sets per muscle group, split by how the muscle was involved.
 *
 * One logged set counts once for the exercise's primary muscle and once for
 * each of its secondary muscles. They are kept in separate buckets rather than
 * summed, because "10 sets where this was the target" and "10 sets where it
 * just helped out" are not the same training stimulus -- and keeping them
 * apart is what lets the chart use the same red/amber language as the body map.
 *
 * The unit is sets, not kilograms: volume needs a weight and a rep count on
 * every row, and a session logged straight from the builder has neither yet.
 * Sets are the metric that survives incomplete data.
 */
export function musclesetsFromLog(entries, byId) {
  const rows = new Map();

  const bump = (muscle, key) => {
    if (!muscle) return;
    let row = rows.get(muscle);
    if (!row) {
      row = { muscle, primary: 0, secondary: 0, total: 0 };
      rows.set(muscle, row);
    }
    row[key] += 1;
    row.total += 1;
  };

  for (const entry of entries) {
    const ex = byId.get(entry.exerciseId);
    if (!ex) continue;
    bump(ex.primary, 'primary');
    for (const m of ex.secondary || []) bump(m, 'secondary');
  }

  return [...rows.values()].sort((a, b) => b.total - a.total || a.muscle.localeCompare(b.muscle));
}

/* ------------------------------------------------------------ calendar weeks

   Dates are formatted from local components throughout, never via
   toISOString: local midnight is the previous day in UTC at any positive
   offset, which would slide every week boundary back by one day and put
   Monday's training in the previous week. Same reason as `dailySets`.
   ------------------------------------------------------------------------- */

const pad2 = (n) => String(n).padStart(2, '0');

export function localIso(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local midnight for an ISO date, as a Date. */
function atMidnight(iso) {
  return new Date(`${iso}T00:00:00`);
}

/**
 * The Monday of the week containing `iso`, shifted by `weeks`.
 *
 * Monday-anchored rather than Sunday-anchored because that is what a training
 * week means to the person doing it, and it is the ISO-8601 week besides.
 * `getDay()` numbers Sunday 0, so the offset back to Monday is (day + 6) % 7 --
 * which sends Sunday six days back, into the week it finishes rather than the
 * one it would otherwise start.
 */
export function weekStart(iso, weeks = 0) {
  const d = atMidnight(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weeks * 7);
  return localIso(d);
}

/** The seven ISO dates of the week beginning `startIso`, Monday first. */
export function weekDates(startIso) {
  const out = [];
  for (let i = 0; i < 7; i += 1) {
    const d = atMidnight(startIso);
    d.setDate(d.getDate() + i);
    out.push(localIso(d));
  }
  return out;
}

/** Entries falling inside an inclusive ISO date range. */
export function withinRange(entries, fromIso, toIso) {
  return entries.filter((e) => e.date >= fromIso && e.date <= toIso);
}

/**
 * What a training week actually covered.
 *
 * The muscle rows are `musclesetsFromLog` over the week's entries -- the same
 * primary/supporting split the log and the body map use, so the three never
 * tell different stories. What is added here is the other half of the answer:
 * which groups were NOT touched, which is the question a weekly summary is
 * really being asked. That list is the muscle vocabulary minus what was
 * trained, so it names groups the catalog can actually train rather than
 * inventing anatomy.
 */
export function weekSummary(entries, startIso, byId, allMuscles = []) {
  const dates = weekDates(startIso);
  const inWeek = withinRange(entries, dates[0], dates[6]);
  const rows = musclesetsFromLog(inWeek, byId);
  const touched = new Set(rows.map((r) => r.muscle));

  const days = dates.map((date) => ({
    date,
    sets: inWeek.filter((e) => e.date === date).length,
  }));

  return {
    start: dates[0],
    end: dates[6],
    days,
    rows,
    untouched: allMuscles.filter((m) => m !== 'Full body' && !touched.has(m)),
    sets: inWeek.length,
    daysTrained: days.filter((d) => d.sets > 0).length,
  };
}

/*
 * `dailySets` lived here: sets per day over a trailing 14-day window, for the
 * streak strip on Home. Removed with that strip, which sat immediately above
 * the Monday-to-Sunday card and answered nearly the same question in a second
 * visual language. `weekSummary` covers it, and stepping back a week reaches
 * further than fourteen days ever did.
 */

/**
 * Share of logged sets by training goal.
 *
 * Entries written before goals were recorded have no `goal`; they are counted
 * under `unknown` rather than silently folded into one of the three, so the
 * proportions never overstate what is actually known.
 */
export function goalMixFromLog(entries, goals) {
  const counts = new Map(goals.map((g) => [g, 0]));
  let unknown = 0;

  for (const entry of entries) {
    if (entry.goal && counts.has(entry.goal)) counts.set(entry.goal, counts.get(entry.goal) + 1);
    else unknown += 1;
  }

  const total = entries.length;
  const items = goals.map((goal) => ({
    goal,
    sets: counts.get(goal),
    share: total ? counts.get(goal) / total : 0,
  }));

  return { items, unknown, total };
}

/* -------------------------------------------------------------------- RPE */

/**
 * One rate of perceived exertion per session, oldest first.
 *
 * RPE is stored on the log rows rather than in a table of its own, because a
 * row is the only thing that survives every route into the log -- finishing a
 * session, "did it again", and adding a set by hand all write rows and nothing
 * else. Finishing a session stamps the same session RPE on every set it logs,
 * so averaging the rows of one session gives that number straight back.
 *
 * Sets added by hand carry their own per-set RPE, which is a different
 * measurement. They are grouped by date under a single pseudo-session, so a
 * day of hand-entered sets contributes one point rather than one per set --
 * otherwise a single fastidiously logged afternoon would outweigh a month of
 * finished sessions.
 */
export function sessionRpes(entries) {
  const groups = new Map();

  for (const entry of entries) {
    if (entry.rpe == null) continue;
    const key = `${entry.date}|${entry.sessionId ?? 'by-hand'}`;
    let g = groups.get(key);
    if (!g) {
      g = { date: entry.date, name: entry.sessionName || '', sum: 0, n: 0 };
      groups.set(key, g);
    }
    g.sum += entry.rpe;
    g.n += 1;
  }

  return [...groups.values()]
    .map((g) => ({ date: g.date, name: g.name, rpe: g.sum / g.n, sets: g.n }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const RPE_RANGES = ['week', 'month', 'year'];
export const RPE_MIN = 1;
export const RPE_MAX = 10;

function dayBuckets(todayIso, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = atMidnight(todayIso);
    d.setDate(d.getDate() - i);
    const iso = localIso(d);
    out.push({ key: iso, from: iso, to: iso });
  }
  return out;
}

function monthBuckets(todayIso, months) {
  const out = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = atMidnight(todayIso);
    // Day 1 first: stepping back a month from the 31st lands in the wrong
    // month whenever the target is shorter, which would drop or duplicate a
    // bucket depending on where in the year you happen to be looking.
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const from = localIso(d);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    out.push({ key: from.slice(0, 7), from, to: localIso(last) });
  }
  return out;
}

/**
 * Session RPE bucketed for a chart, oldest first.
 *
 * All three ranges are trailing windows ending today rather than calendar
 * periods, so the rightmost point is always now and switching range never
 * makes recent training disappear off the end. Week and month bucket by day;
 * year buckets by calendar month, because 365 points is not a shape anyone
 * can read on a phone.
 *
 * A bucket with no session gets `rpe: null` rather than 0 -- a day you did not
 * train is a gap in the record, not an effortless workout, and drawing it as
 * zero would drag every trend line toward the floor.
 */
export function rpeSeries(entries, range, todayIso) {
  const sessions = sessionRpes(entries);
  const buckets =
    range === 'year' ? monthBuckets(todayIso, 12) : dayBuckets(todayIso, range === 'week' ? 7 : 30);

  const points = buckets.map((b) => {
    const inside = sessions.filter((s) => s.date >= b.from && s.date <= b.to);
    return {
      ...b,
      sessions: inside.length,
      rpe: inside.length ? inside.reduce((sum, s) => sum + s.rpe, 0) / inside.length : null,
    };
  });

  const known = points.filter((p) => p.rpe != null);
  return {
    range,
    points,
    count: known.reduce((sum, p) => sum + p.sessions, 0),
    average: known.length ? known.reduce((sum, p) => sum + p.rpe, 0) / known.length : null,
  };
}

/* ------------------------------------------------------------- formatting */

export function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}` : `${m} min`;
}
