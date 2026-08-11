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
    // Not a goal you can pick; a goal the log can hold. See REPORT_GOALS.
    'goal.Conditioning': 'Conditioning',
    'goal.blurb.Explosivity': 'Speed and intent. Few reps, long rest.',
    'goal.blurb.Strength': 'Heavy and near-maximal. Quality over volume.',
    'goal.blurb.Hypertrophy': 'Moderate load, full range, a few reps from failure.',
    'goal.blurb.Muscular endurance': 'Long sets, short rest, clean technique.',

    // --- home ---
    // Twelve `today.*` keys went with the PLANNED card and the "Home" h1 --
    // title, planned, noPlan, noPlanHint, buildOne, lifts, estimated, warmup,
    // start, seePlan, resume, busy. Removed rather than left behind: §15
    // counts what is left to translate, and dead keys inflate the number.
    'home.quickBlurb': 'Muscles and minutes in, session out',
    'home.buildTitle': 'Build your own',
    'home.buildBlurb': 'Choose every lift yourself',
    'home.savedNone': 'None yet',
    'home.savedEmptyHint': 'Save a workout from the plan and it lands here, ready to run again.',
    'today.balance': 'Balance',
    'today.balanceMeta': '30 days · {n} sets',
    'today.saved': 'Saved workouts',
    'today.savedMeta': '{n} kept',

    // --- quick workout ---
    'quick.title': 'Quick workout',
    'quick.kicker': 'Built for you',
    'quick.entryHint': 'Say what you want to work and how long you have. It picks the rest.',
    'quick.muscles': 'What are you training?',
    'quick.preset.upper': 'Upper',
    'quick.preset.lower': 'Lower',
    'quick.preset.full': 'Full body',
    'quick.musclesAny': 'Nothing picked, so it will spread across the whole body.',
    'quick.musclesN': '{n} selected. It rotates between them so none gets all the time.',
    'quick.time': 'How long have you got?',
    'quick.focus': 'Focus',
    'quick.focusHint':
      'Sets, reps, load and rest all come from this. The figures shown are for a heavy compound lift — lighter movements get their own.',
    'quick.complexity': 'Complexity',
    'quick.level.basic': 'Basic',
    'quick.level.medium': 'Medium',
    'quick.level.advanced': 'Advanced',
    'quick.levelHint.basic':
      'The lifts every gym programme is built from — barbell, dumbbell and machine work that is widely taught. No Olympic lifts, no rings, nothing that needs a coach watching.',
    'quick.levelHint.medium':
      'Adds variations and single-leg work: front squats, Bulgarian split squats, dips, sled work. Assumes you have been shown the basics.',
    'quick.levelHint.advanced':
      'Everything in the library, Olympic lifts and ring work included. Nothing is held back.',
    'quick.splitTotal': '{n} min total',
    'quick.splitWarm': '{n} warm-up & mobility',
    'quick.splitMain': '{n} min lifting',
    'quick.generate': 'Generate workout',
    'quick.generated.one': 'Built a session with {n} lift',
    'quick.generated.other': 'Built a session with {n} lifts',
    'quick.nothingFits':
      'No lifts fit that. Try more time, a shorter warm-up, or a wider complexity.',
    'quick.replaceTitle': 'Replace what you were building?',
    'quick.replaceBody.one':
      '“{name}” has {n} lift in it. Generating a workout will replace it — a saved copy is not affected.',
    'quick.replaceBody.other':
      '“{name}” has {n} lifts in it. Generating a workout will replace them — a saved copy is not affected.',
    'quick.replaceConfirm': 'Replace it',
    'quick.autoBadge': 'Auto-generated',
    'quick.reveal.pool': 'Reading {n} exercises',
    'quick.reveal.picking': 'Choosing lifts for {groups}',
    'quick.reveal.pickingAny': 'Choosing lifts across the whole body',
    'quick.reveal.warmup': 'Building a {n}-drill warm-up',
    'quick.reveal.result.one': 'lift · {time}',
    'quick.reveal.result.other': 'lifts · {time}',
    'quick.reveal.skip': 'Tap to skip',
    'quick.shuffle': 'Shuffle the lifts',
    'quick.shuffled.one': '{n} lift swapped',
    'quick.shuffled.other': '{n} lifts swapped',
    'quick.shuffledSame': 'Nothing else fits — same lifts',
    'quick.nameFull': 'Full body',
    'quick.name.upper': 'Upper body',
    'quick.name.lower': 'Lower body',
    'quick.name.full': 'Full body',
    'quick.nameGroups': '{n} muscle groups',

    // --- guide ---
    'guide.open': 'How this works',
    'guide.kicker': 'New here?',
    'guide.title': 'How this works',
    'guide.lede':
      'You pick a goal and the lifts you want to do. Everything else — the warm-up, the sets and reps, the weight on the bar, how long it will take — is worked out from those two answers. Here is the whole loop, in the order you will actually do it.',

    'guide.step.goal.title': 'Start with a goal',
    'guide.step.goal.text':
      'Explosive, Strength, Hypertrophy or Endurance. This is the big one: the same lift is prescribed completely differently depending on which you pick — five heavy triples for strength, three sets of ten for hypertrophy. The whole app re-tints to the goal you are in, so you can tell at a glance.',

    'guide.step.lifts.title': 'Choose your lifts',
    'guide.step.lifts.text':
      'Add from library opens all 167 exercises, plus any you have written yourself. Search by name, or filter by the equipment you have, the movement pattern, or the muscle you want to work. Pick as many as you want — three to five is a normal session.',

    'guide.step.oneRm.title': 'Tell it what you can lift',
    'guide.step.oneRm.text':
      'Suggested weights are a percentage of your one-rep max, so any lift without one just says “Enter your 1RM”. Tap the + beside it on Build to fill it in — you only ever do this once per exercise. Bodyweight lifts do not need one.',

    'guide.step.budgets.title': 'Give it a warm-up budget',
    'guide.step.budgets.text':
      'In minutes, not exercises. It fills that time with drills that match what you are about to do, in priority order, and stops at the first one that would not fit. The mobility budget at the end works the same way.',

    'guide.step.plan.title': 'Generate the plan',
    'guide.step.plan.text':
      'Now it builds: a warm-up chosen from the lifts you picked, every exercise with its sets, reps, suggested weight and rest, a cool-down, a time estimate, and a body map of what you are about to train. Save it to reuse, or export a PDF to write on at the rack.',

    'guide.step.run.title': 'Run the session',
    'guide.step.run.text':
      'Tick each set as you finish it and the rest timer starts itself, counting the rest that lift was prescribed. If the weight was different from the suggestion, type it or step it in 2.5 kg. What you tick is exactly what gets logged — nothing is assumed.',

    'guide.step.rpe.title': 'Say how hard it was',
    'guide.step.rpe.text':
      'Finishing asks for a rating from 1 to 10. It is a snap judgement about the session as a whole, not a score for each set, and it takes one tap. Skip it if you would rather — a rating you did not mean is worse than none.',

    'guide.step.review.title': 'Look back',
    'guide.step.review.text':
      'Home shows your week, Monday to Sunday, including which muscle groups you have not touched. Log has the balance across the four goals, how hard your sessions have felt over a week, month or year, and your sets per muscle group.',

    'guide.goto.build': 'Open Build',
    'guide.goto.library': 'Open the Library',
    'guide.goto.log': 'Open the Log',

    'guide.goto.quick': 'Try Quick workout',

    'guide.moreLabel': 'Worth knowing',
    'guide.quick.title': 'Or skip all of that',
    'guide.quick.text':
      'Quick workout does the eight steps above for you. Tell it which muscle groups, how long you have and how much technique you want handed to you, and it builds the session. It picks differently every time, so you can use it twice in a week without repeating yourself.',
    'guide.own.title': 'Your gym, your exercises',
    'guide.own.text':
      'If the library is missing something you do, add it. Give it a name, the equipment, the muscles it works and how it should be prescribed, and it behaves like any other exercise from then on — warm-ups, body map, log and all.',
    'guide.saved.title': 'Workouts you keep',
    'guide.saved.text':
      'Save a plan and it is on Home under Saved workouts. Load it back to run it again, or press “Did it again” to log it without stepping through it set by set.',
    'guide.data.title': 'It all stays on this device',
    'guide.data.text':
      'No account, no server, nothing uploaded. That also means nothing is backed up for you — if you care about the history, take a copy now and then from Log → Your data.',
    'guide.start': 'Build your first session',

    // --- weekly summary ---
    'week.this': 'This week',
    'week.last': 'Last week',
    'week.agoWeeks': '{n} weeks ago',
    'week.previous': 'Previous week',
    'week.next': 'Next week',
    'week.daysUnit.one': 'day',
    'week.daysUnit.other': 'days',
    'week.setsUnit': 'sets',
    'week.groupsUnit': 'groups',
    'week.notTrained': 'not trained this week',
    'week.detail': 'Full breakdown',
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
    // No 'build.title': the session's name is the screen's title now.
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
    'build.remove': 'Remove {name} from this session',
    'build.setRmFor': 'Set your 1RM for {name}',
    'build.rmHint':
      'Your one-rep max. The suggested load is a percentage of it, and this is the same number the Library holds.',

    'figures.sets': 'sets',
    'figures.reps': 'reps',
    'figures.load': 'of 1RM',
    'figures.rest': 'rest',

    // --- plan ---
    // --- the three phases of a session ---
    // One set of names for the plan, the live session and the print sheet.
    // "Main" was the workbook's column heading, not a thing anyone says, and
    // "Mobility" named the contents rather than the phase while disagreeing
    // with the print sheet and the code, which both call it the cool-down.
    'phase.warmup': 'Warm-up',
    'phase.main': 'Main lifts',
    'phase.cooldown': 'Cool-down',
    'phase.why.warmup': 'Raise the heart rate and rehearse the movements you are about to load.',
    'phase.why.main': 'The working sets. This is the part that drives the adaptation.',
    'phase.why.cooldown': 'Mobility work to bring you down and give back the range you just used.',
    'phase.drills.one': '{n} drill',
    'phase.drills.other': '{n} drills',
    'phase.lifts.one': '{n} lift',
    'phase.lifts.other': '{n} lifts',
    'phase.moves.one': '{n} exercise',
    'phase.moves.other': '{n} exercises',
    'phase.mins': '{n} min',
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

    // --- conditioning ---
    'cond.kicker': 'Conditioning',
    'cond.title': 'HIIT workout',
    'cond.blurb': 'Hard intervals, short. Pick a shape or let it choose.',
    'cond.homeBlurb': 'Intervals, EMOMs and AMRAPs',
    'cond.time': 'How long',
    'cond.format': 'Shape',
    'cond.kit': 'What have you got?',
    'cond.kitHint': 'Only movements you can actually do get picked.',
    'cond.kitNone': 'Pick at least one — there is nothing to choose from otherwise.',
    'cond.blocks': 'How many blocks',
    'cond.blocksOne':
      'One block. The same movements all the way through — simple to run, and the same few muscles the whole time.',
    'cond.blocksSplit':
      '{n} blocks of {per} min, {rest} min between. Each block gets its own movements, so more of you gets worked.',
    'cond.blockCount.one': '{n} block',
    'cond.blockCount.other': '{n} blocks',
    'cond.between': '{n} min — get your breath back',
    'cond.betweenPrint': 'Take {n} min after the block before this one.',
    'cond.complexity': 'Technique',
    'cond.partner': 'Training with anyone?',
    'cond.people': 'How many of you',
    'cond.lowImpact': 'No jumping',
    'cond.lowImpactHint': 'Leaves out box jumps, skipping and burpees. Ergs and carries stay.',
    'cond.generate': 'Generate',
    'cond.attachTitle': 'On its own, or after the lifting?',
    'cond.attachBody.one':
      'You have {name} on the go, with {n} lift in it.',
    'cond.attachBody.other':
      'You have {name} on the go, with {n} lifts in it.',
    'cond.attachAlone': 'A workout on its own',
    'cond.attachAloneSub': 'Just the conditioning. Replaces {name}.',
    'cond.attachFinisher': 'Add it to {name}',
    'cond.attachFinisherSub': 'As a finisher, after the lifting and before the cool-down.',
    'cond.nothingFits': 'Nothing fits that. Try more kit, or a higher technique level.',

    'cond.format.any': 'Surprise me',
    'cond.format.emom': 'EMOM',
    'cond.format.amrap': 'AMRAP',
    'cond.format.intervals': 'Intervals',
    'cond.format.tabata': 'Tabata',
    'cond.format.fortime': 'For time',

    // One line each. These sit in 208px cards beside four others, and the goal
    // cards next door prove that a sentence is enough to choose by.
    'cond.formatWhy.any': 'No preference? It picks.',
    'cond.formatWhy.emom': 'One movement a minute. Finish fast, rest the remainder.',
    'cond.formatWhy.amrap': 'One round on repeat. The count is your score.',
    'cond.formatWhy.intervals': 'Fixed work, fixed rest. You always know when it stops.',
    'cond.formatWhy.tabata': '20 on, 10 off, eight times. All-out, no pacing.',
    'cond.formatWhy.fortime': 'Fixed work, fast as you can. The clock is the score.',

    'cond.partner.solo': 'On my own',
    'cond.partner.alternating': 'You go, I go',
    'cond.partner.shared': 'Share the work',
    'cond.partner.relay': 'Relay',
    'cond.partnerWhy.solo': 'Just you.',
    'cond.partnerWhy.alternating': 'Take turns. One works, one rests.',
    'cond.partnerWhy.shared': 'One target. Split the reps how you like.',
    'cond.partnerWhy.relay': 'A fixed total, worked through together.',

    'cond.kit.bodyweight': 'Just me',
    'cond.kit.erg': 'Ergs',
    'cond.kit.run': 'Running',
    'cond.kit.floor': 'Floor & kit',
    'cond.kit.rig': 'Pull-up bar',
    'cond.kitWhy.bodyweight': 'No equipment at all',
    'cond.kitWhy.erg': 'Rower, ski, bike',
    'cond.kitWhy.run': 'Space or a treadmill',
    'cond.kitWhy.floor': 'Rope, box, ball, bells',
    'cond.kitWhy.rig': 'Something to hang from',

    // --- conditioning, on the plan ---
    'cond.block': 'Conditioning',
    'cond.finisher': 'Finisher',
    'cond.rounds.one': '{n} round',
    'cond.rounds.other': '{n} rounds',
    'cond.minutes': '{n} min',
    'cond.emomMeta': '{rounds} min · one movement a minute',
    'cond.amrapMeta': 'As many rounds as possible in {n} min',
    'cond.amrapEst': 'about {n} rounds, if it goes well',
    'cond.intervalMeta': '{rounds} × {work}s on, {rest}s off',
    'cond.tabataMeta': '{n} × 8 rounds of 20s on, 10s off',
    'cond.fortimeMeta': '{rounds} rounds for time · {n} min cap',
    'cond.roundIs': 'Each round',
    'cond.eachMinute': 'The minutes rotate',
    'cond.eachInterval': 'Each work period',
    'cond.tabataEach': 'Four minutes each, in this order',
    'cond.total': 'Total',
    'cond.perPerson': 'each',
    'cond.together': 'between you',
    'cond.partnerNote.alternating': 'Taking turns, {n} of you — you work every other round.',
    'cond.partnerNote.shared': 'Split between {n} of you, however you like.',
    'cond.partnerNote.relay': 'Worked through by {n} of you in any split.',
    'cond.finisherNote':
      'The finisher is not carried into the session screen yet — run it off this plan when you get there.',

    // --- the clock ---
    'cond.start': 'Start the clock',
    'cond.begin': 'Start',
    'cond.resume': 'Resume',
    'cond.pause': 'Pause',
    'cond.stop': 'Stop',
    'cond.doneStep': "I'm done",
    'cond.stepOf': '{n} of {total}',
    'cond.next': 'Up next',
    'cond.lastOne': 'Last one',
    'cond.rest': 'Rest',
    'cond.work': 'Work',
    'cond.left': 'left',
    'cond.elapsed': 'elapsed',
    'cond.betweenBlocks': 'Between blocks',
    'cond.roundOf': 'Round {n} of {total}',
    'cond.roundOfGroup': 'Round {n}/{total} · move {g}/{groups}',
    'cond.turn': "Person {n}'s turn",
    'cond.movementCount.one': '{n} movement',
    'cond.movementCount.other': '{n} movements',
    'cond.roundsDone.one': '{n} round',
    'cond.roundsDone.other': '{n} rounds',
    'cond.roundPlus': 'Count a round',
    'cond.roundMinus': 'Take one back',

    'cond.doneTitle': 'Done',
    'cond.doneHint': 'That took about {n} min. Nothing is written down until you say so.',
    'cond.logIt': 'Log it',
    'cond.discard': 'Discard',
    'cond.discardTitle': 'Throw this one away?',
    'cond.discardBody': 'The workout stays on the plan. Only what you just did gets forgotten.',
    'cond.rpeBody': 'How hard was that, all in?',
    'cond.logged.one': 'Logged {n} block',
    'cond.logged.other': 'Logged {n} blocks',
    'cond.resumePill': 'Clock running: {name}',
    'cond.paused': 'Paused',
    'cond.remove': 'Remove conditioning',
    'cond.reshuffle': 'Re-roll the conditioning',

    // --- session ---
    'live.title': 'In session',
    'live.done': '{done} / {total} done',
    // live.warmup / live.cooldown removed — the live session uses the shared
    // `phase.*` names now, so all three screens say the same words.
    'live.set': 'Set {n}',
    'live.reps': '{reps} reps',
    'live.bodyweight': 'Bodyweight',
    'live.addWeight': 'Add weight',
    'live.adjust': 'Adjust load',
    'live.how': 'How to do it',
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
    'saved.never': 'Never done',
    'saved.completedOnce': 'Done once · {date}',
    'saved.completedMany': 'Done {n} times · last {date}',
    'saved.lifts.one': '{n} lift',
    'saved.lifts.other': '{n} lifts',
    'saved.savedOn': 'saved {date}',
    'saved.otherGoal': 'Other',
    'saved.saved': 'Saved',

    // --- print sheet ---
    'print.generated': 'Generated by Workout Companion',
    'print.goal': 'Goal',
    'print.estimate': 'Estimated total',
    // print.warmup / print.main / print.cooldown removed — the sheet uses the
    // shared `phase.*` names, so paper agrees with the screen.
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
