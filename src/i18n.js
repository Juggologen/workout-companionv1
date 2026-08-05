/**
 * i18n.js
 *
 * English is the only registered locale. The plumbing is here so that adding
 * Swedish is a data task rather than a refactor: every user-visible string in
 * the UI goes through `t()`, and every bilingual field from the workbook goes
 * through `localized()`.
 *
 * To add Swedish later:
 *   1. Add `sv` to LOCALES below with the same keys.
 *   2. Fill in the `sv` side of `how` / `cue` / prescription text in data/.
 *   3. Call setLanguage('sv') from a switcher.
 *
 * Missing keys and missing translations fall back to English rather than
 * rendering blank, so a partial translation degrades instead of breaking.
 */

const LOCALES = {
  en: {
    'app.name': 'Workout Companion',

    // --- navigation ---
    'tab.home': 'Home',
    'tab.build': 'Build',
    'tab.log': 'Log',
    'tab.library': 'Library',
    'nav.resume': 'Session in progress',
    'nav.resumeAction': 'Resume',

    // --- goals ---
    'goal.Explosivity': 'Explosive',
    'goal.Strength': 'Strength',
    'goal.Hypertrophy': 'Hypertrophy',
    'goal.Muscular endurance': 'Endurance',
    'goal.blurb.Explosivity': 'Speed and intent. Few reps, long rest.',
    'goal.blurb.Strength': 'Heavy and near-maximal. Quality over volume.',
    'goal.blurb.Hypertrophy': 'Moderate load, full range, a few reps from failure.',
    'goal.blurb.Muscular endurance': 'Long sets, short rest, clean technique.',

    // --- home ---
    'today.title': 'Home',
    'today.planned': 'Planned',
    'today.noPlan': 'Nothing planned',
    'today.noPlanHint': 'Build a session and it shows up here.',
    'today.buildOne': 'Build a session',
    'today.lifts': 'lifts',
    'today.estimated': 'estimated',
    'today.warmup': 'warm-up',
    'today.start': 'Start session',
    'today.seePlan': 'See the plan',
    'today.resume': 'Resume session',
    'today.busy': 'Session in progress',
    'today.streak': 'Last 14 days',
    'today.sessions.one': '{n} day trained',
    'today.sessions.other': '{n} days trained',
    'today.balance': 'Balance',
    'today.balanceMeta': '30 days · {n} sets',
    'today.saved': 'Saved workouts',
    'today.savedMeta': '{n} kept',

    // --- weekly summary ---
    'week.this': 'This week',
    'week.last': 'Last week',
    'week.agoWeeks': '{n} weeks ago',
    'week.previous': 'Previous week',
    'week.next': 'Next week',
    'week.summary.one': '{sets} sets over {n} day, across {muscles} muscle groups',
    'week.summary.other': '{sets} sets over {n} days, across {muscles} muscle groups',
    'week.untouched': 'Not trained this week:',
    'week.empty': 'Nothing logged this week',
    'week.emptyHint': 'Finish a session and the week fills in, Monday to Sunday.',

    // --- perceived exertion ---
    'rpe.title': 'How hard was that?',
    'rpe.body.one': 'Rate the whole session 1–10. It goes on the {n} set being logged.',
    'rpe.body.other': 'Rate the whole session 1–10. It goes on all {n} sets being logged.',
    'rpe.bodySaved': 'Rate {name} 1–10 before it goes into the log.',
    'rpe.skip': 'Skip the rating',
    'rpe.w1': 'Nothing at all',
    'rpe.w3': 'Light',
    'rpe.w5': 'Moderate',
    'rpe.w7': 'Hard',
    'rpe.w9': 'Very hard',
    'rpe.w10': 'Maximal',
    'rpe.panelTitle': 'Perceived exertion',
    'rpe.average': 'avg {n}',
    'rpe.range.week': 'Week',
    'rpe.range.month': 'Month',
    'rpe.range.year': 'Year',
    'rpe.style': 'Chart style',
    'rpe.line': 'Line',
    'rpe.bar': 'Bar',
    'rpe.empty': 'Nothing rated yet',
    'rpe.emptyHint': 'Finish a session and give it a 1–10; it plots itself from there.',
    'rpe.note.one': '{n} rated session in this range. A day with none is a gap, not a zero.',
    'rpe.note.other': '{n} rated sessions in this range. A day with none is a gap, not a zero.',
    'rpe.tooltip': 'RPE {n} · {sessions} rated',
    'rpe.noSession': 'nothing rated',
    'rpe.chartLabel.one':
      'Perceived exertion over the last {range}. {n} rated session, at {avg} out of 10.',
    'rpe.chartLabel.other':
      'Perceived exertion over the last {range}. {n} rated sessions, averaging {avg} out of 10.',

    // --- build ---
    'build.kicker': 'New session',
    'build.title': 'Build',
    'build.goal': 'Goal',
    'build.lifts': 'Lifts',
    'build.chosen': '{n} chosen',
    'build.addFromLibrary': 'Add from library',
    'build.noLifts': 'No lifts yet',
    'build.noLiftsHint': 'Your choices drive the warm-up, the loads and the estimate.',
    'build.warmBudget': 'Warm-up budget',
    'build.coolBudget': 'Mobility budget',
    'build.skip': 'Skip',
    'build.budgetNote':
      'Fills in priority order and stops at the first drill that would overflow — {count} drills, {minutes} min.',
    'build.generate': 'Generate plan',
    'build.name': 'Session name',
    'build.namePlaceholder': 'Lower body',
    'build.setRmFor': 'Set your 1RM for {name}',
    'build.rmHint':
      'Your one-rep max. The suggested load is a percentage of it, and this is the same number the Library holds.',

    'figures.sets': 'sets',
    'figures.reps': 'reps',
    'figures.load': 'of 1RM',
    'figures.rest': 'rest',

    // --- plan ---
    'plan.warmup': 'Warm-up · {n} min',
    'plan.main': 'Main · {n} min',
    'plan.cooldown': 'Mobility · {n} min',
    'plan.trains': 'What this trains',
    'plan.save': 'Save',
    'plan.start': 'Start session',
    'plan.export': 'Export PDF',
    'plan.tolerance': '±15%',
    'plan.empty': 'Nothing to plan yet',
    'plan.emptyHint': 'Pick some lifts on the Build screen first.',
    'plan.rest': 'rest {n}',

    // --- body map ---
    'map.front': 'Front',
    'map.back': 'Back',
    'map.trained': 'Trained',
    'map.supporting': 'Supporting',
    'map.none': 'None',

    // --- session ---
    'live.title': 'In session',
    'live.done': '{done} / {total} done',
    'live.warmup': 'Warm-up',
    'live.cooldown': 'Mobility',
    'live.set': 'Set {n}',
    'live.reps': '{reps} reps',
    'live.bodyweight': 'Bodyweight',
    'live.addWeight': 'Add weight',
    'live.adjust': 'Adjust load',
    'live.finish.one': 'Finish and log {n} set',
    'live.finish.other': 'Finish and log {n} sets',
    'live.finishEmpty': 'Finish workout',
    'live.selectAll': 'Mark everything done',
    'live.clearAll': 'Clear all marks',
    'live.confirmTitle': 'Finish with work unmarked?',
    'live.confirmBody.one':
      '{n} step is still unmarked. Only the {done} sets you ticked will be logged.',
    'live.confirmBody.other':
      '{n} steps are still unmarked. Only the {done} sets you ticked will be logged.',
    'live.confirmNothing':
      'Nothing is ticked, so nothing will be logged and the session will be discarded.',
    'live.confirmFinish': 'Finish anyway',
    'live.confirmKeepGoing': 'Keep going',
    'live.rest': 'Rest · {name}',
    'live.skip': 'Skip',
    'live.logged.one': 'Logged {n} set',
    'live.logged.other': 'Logged {n} sets',
    'live.nothingTicked': 'Nothing ticked — nothing logged',

    // --- log ---
    'log.kicker': 'Last 30 days · {n} sets',
    'log.title': 'Balance',
    'log.notRecorded': 'Not recorded',
    'log.sets.one': '{n} set',
    'log.sets.other': '{n} sets',
    'log.showMuscles': 'Sets per muscle group',
    'log.hideMuscles': 'Hide sets per muscle group',
    'log.primary': 'Primary',
    'log.supporting': 'Supporting',
    'log.muscleCol': 'Muscle',
    'log.setsCol': 'Sets',
    'log.splitTitle': '{muscle}: {total} sets — {p} primary, {s} supporting',
    'log.setsNote':
      'Counted in sets, not kilograms — a session logged straight from the plan has no rep count, and sets survive incomplete data.',
    'log.empty': 'Nothing logged yet',
    'log.emptyHint': 'Finish a session and this fills in on its own.',
    'log.history': 'History',
    'log.addSet': 'Add a set by hand',
    'log.add': 'Add',
    'log.date': 'Date',
    'log.exercise': 'Exercise',
    'log.weight': 'Weight',
    'log.reps': 'Reps',
    'log.rpe': 'RPE',
    'log.goal': 'Goal',
    'log.recent': 'Recent sets',
    'log.showAll': 'Show all {n}',
    'log.delete': 'Delete',
    'log.bests': 'Bests per exercise',
    'log.best1rm': 'best est. 1RM',
    'log.heaviest': 'heaviest',
    'log.data': 'Your data',
    'log.dataHint': 'Everything stays on this device. Nothing is uploaded.',
    'log.export': 'Export backup',
    'log.import': 'Import backup',
    'log.clear': 'Delete everything',
    'log.clearConfirm':
      'Delete all sessions, log entries and 1RMs on this device? This cannot be undone.',

    // --- library ---
    'library.kicker': '{n} exercises',
    'library.title': 'Library',
    'library.search': 'Search exercises',
    'library.oneRm': 'Your 1RM',
    'library.setRm': 'Set 1RM',
    'library.noResults': 'No exercises match',
    'library.noResultsHint': 'Try a different word, or clear the filters.',
    'library.filters': 'Filters',
    'library.clearFilters': 'Clear',
    'library.equipment': 'Equipment',
    'library.pattern': 'Movement pattern',
    'library.primary': 'Primary muscle',
    'library.secondary': 'Supporting muscle',
    'library.anyEquipment': 'Any equipment',
    'library.anyPattern': 'Any pattern',
    'library.anyPrimary': 'Any primary muscle',
    'library.anySecondary': 'Any supporting muscle',
    'library.primaryShort': 'Primary',
    'library.supportingShort': 'Supports',
    'library.matching.one': '{n} match',
    'library.matching.other': '{n} matches',
    'library.picking': '{n} chosen for this session',
    'library.donePicking': 'Done',

    // --- the user's own exercises ---
    'custom.add': 'Add your own exercise',
    'custom.addKicker': 'New exercise',
    'custom.editKicker': 'Edit exercise',
    'custom.title': 'Your own exercise',
    'custom.name': 'Name',
    'custom.namePlaceholder': 'Reverse Nordic curl',
    'custom.choose': 'Choose…',
    'custom.profile': 'Prescription profile',
    'custom.profileHint':
      'This is what decides the sets, reps, load and rest — pick the row that matches how the lift is actually trained, not what it is called.',
    'custom.previewFor': 'Prescribes, for {goal}',
    'custom.secondaryHint':
      'Supporting muscles pick your cool-down and paint the body map. Optional.',
    'custom.cue': 'Cue',
    'custom.cuePlaceholder': 'One line on how it should feel',
    'custom.create': 'Add to library',
    'custom.save': 'Save changes',
    'custom.cancel': 'Cancel',
    'custom.missing': 'Still needed: {fields}.',
    'custom.created': 'Added to your library',
    'custom.saved': 'Saved',
    'custom.badge': 'Yours',
    'custom.edit': 'Edit',
    'custom.remove': 'Remove',
    'custom.delete': 'Delete it',
    'custom.deleteTitle': 'Delete {name}?',
    'custom.deleteBody': 'Nothing refers to it, so it goes cleanly. This cannot be undone.',
    'custom.deleteUsedBody.one':
      '{n} logged set still refers to it. Deleting it drops that set out of every muscle and goal total, and it will no longer show a name. This cannot be undone.',
    'custom.deleteUsedBody.other':
      '{n} logged sets still refer to it. Deleting it drops them out of every muscle and goal total, and they will no longer show a name. This cannot be undone.',
    'custom.refSets.one': '{n} logged set',
    'custom.refSets.other': '{n} logged sets',
    'custom.refWorkouts.one': '{n} workout',
    'custom.refWorkouts.other': '{n} workouts',
    'custom.refJoin': ' and ',
    'custom.deleted': 'Deleted',
    'custom.archive': 'Archive it',
    'custom.archiveTitle': 'Still in use — archive {name}?',
    // Agreement follows the total, not the number of clauses: "1 workout still
    // refers to it", but "2 logged sets and 1 workout still refer to it".
    'custom.archiveBody.one':
      '{refs} still refers to it. Archiving takes it out of the library and the picker but leaves that intact, and you can restore it later.',
    'custom.archiveBody.other':
      '{refs} still refer to it. Archiving takes it out of the library and the picker but leaves all of that intact, and you can restore it later.',
    'custom.archived': 'Archived',
    'custom.restore': 'Restore',
    'custom.restored': 'Back in your library',
    'custom.archivedList': 'Archived ({n})',
    'custom.archivedHint':
      'Hidden from the library, but still named everywhere they are already used.',

    // --- saved ---
    'saved.title': 'Saved workouts',
    'saved.kicker': '{n} kept',
    'saved.empty': 'No saved workouts yet',
    'saved.emptyHint': 'Build a session and press Save on the plan.',
    'saved.load': 'Load',
    'saved.again': 'Did it again',
    'saved.never': 'Not completed yet',
    'saved.completedOnce': 'Completed once · last {date}',
    'saved.completedMany': 'Completed {n} times · last {date}',
    'saved.saved': 'Saved',

    // --- print sheet ---
    'print.generated': 'Generated by Workout Companion',
    'print.goal': 'Goal',
    'print.estimate': 'Estimated total',
    'print.warmup': 'Warm-up',
    'print.main': 'Main session',
    'print.cooldown': 'Cool-down',
    'print.exercise': 'Exercise',
    'print.sets': 'Sets',
    'print.reps': 'Reps',
    'print.suggested': 'Suggested',
    'print.rest': 'Rest',
    'print.yourLoad': 'Your load',

    // --- shared ---
    'units.min': 'min',
    'units.kg': 'kg',
    'load.enterRm': 'Enter your 1RM',
    'load.bodyweight': 'Bodyweight / RPE',
    'common.back': 'Back',
    'common.close': 'Close',
    'common.loading': 'Loading the compendium…',
    'common.loadError': 'Could not load the exercise data.',
    'common.loadErrorHint':
      'The app needs to be served over http:// — opening index.html straight from disk will not work.',
  },
};

let current = 'en';

export function setLanguage(lang) {
  if (LOCALES[lang]) current = lang;
}

export function getLanguage() {
  return current;
}

export function availableLanguages() {
  return Object.keys(LOCALES);
}

/** Translate a key, with optional {placeholder} substitution. */
export function t(key, vars) {
  const table = LOCALES[current] || LOCALES.en;
  let text = table[key] ?? LOCALES.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v);
  }
  return text;
}

/**
 * Plural form. Looks up `key.one` or `key.other` and passes `n` through as a
 * placeholder. English only needs the two forms; Swedish takes the same pair,
 * so adding it later needs no change here.
 */
export function tp(key, n, vars) {
  return t(`${key}.${n === 1 ? 'one' : 'other'}`, { ...vars, n });
}

/**
 * Pick the right side of a bilingual field from the workbook, e.g.
 * `{ en: 'Back Squat', sv: 'Knäböj' }`. Falls back to English when the
 * translation hasn't been written yet.
 */
export function localized(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  return field[current] || field.en || '';
}
