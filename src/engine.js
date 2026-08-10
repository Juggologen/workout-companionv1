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

  const eligible = catalog.exercises
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

/**
 * Sets logged per day for the last `days` days, oldest first.
 *
 * Drives the streak strip on Today. Returns the date and the count, not a bar
 * height -- how that maps to pixels is the view's business.
 */
export function dailySets(entries, days, today) {
  const counts = new Map();
  for (const entry of entries) {
    const d = daysAgo(entry.date, today);
    if (d >= 0 && d < days) counts.set(entry.date, (counts.get(entry.date) || 0) + 1);
  }

  // Dates come from local components via `localIso`, never toISOString: local
  // midnight is the previous day in UTC for any positive offset, which would
  // shift the whole strip back a day and make today's work never line up.
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() - i);
    const date = localIso(d);
    out.push({ date, sets: counts.get(date) || 0, daysAgo: i });
  }
  return out;
}

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
