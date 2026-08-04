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

  // Dates are formatted from local components, never via toISOString: local
  // midnight is the previous day in UTC for any positive offset, which would
  // shift the whole strip back a day and make today's work never line up.
  const pad = (n) => String(n).padStart(2, '0');
  const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

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

/* ------------------------------------------------------------- formatting */

export function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}` : `${m} min`;
}
