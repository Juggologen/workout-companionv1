/**
 * app.js -- screens and wiring.
 *
 * Six screens behind four tabs: Home, Build, Log, Library, with Plan and
 * Session pushed from Build and Saved pushed from Home. State lives in one
 * object; almost everything calls render(). The two places where a full
 * re-render would steal focus mid-typing (library search, the by-hand log
 * form) update in place instead.
 *
 * The training goal drives the accent: `--g` is stamped on the app root every
 * render, so choosing Explosive / Strength / Endurance re-tints the app. Home
 * is the exception -- it is not a training mode, so it keeps its own yellow.
 */

import { loadCatalog, withCustomExercises } from './data.js';
import { store, newId, today } from './store.js';
import { t, tp, localized } from './i18n.js';
import { h, mount, icon, ICONS, num } from './ui.js';
import {
  buildSession,
  getPrescription,
  suggestedLoad,
  mround,
  setVolume,
  estimatedOneRm,
  summariseProgress,
  formatMinutes,
  withinDays,
  musclesetsFromLog,
  goalMixFromLog,
  weekStart,
  weekSummary,
  rpeSeries,
  RPE_RANGES,
  RPE_MIN,
  RPE_MAX,
  generateQuickWorkout,
  COMPLEXITY_LEVELS,
  generateConditioning,
  generateConditioningWorkout,
  maxConditioningBlocks,
  assembleConditioningBlock,
  defaultAmountFor,
  INTERVAL_SHAPES,
  workoutSteps,
  stepsSeconds,
  BLOCK_REST_MINUTES,
  CONDITIONING_FORMATS,
  PARTNER_MODES,
} from './engine.js';
import { renderBodyMap, musclesWorked } from './muscles.js';

/* ------------------------------------------------------------------ goals */

const GOAL_COLOR = {
  Explosivity: 'var(--goal-explosive)',
  Strength: 'var(--goal-strength)',
  Hypertrophy: 'var(--goal-hypertrophy)',
  'Muscular endurance': 'var(--goal-endurance)',
  // Never chosen on the Build screen -- see the note on `REPORT_GOALS` -- but
  // it reaches the log, and the balance chart needs a colour for it.
  Conditioning: 'var(--goal-conditioning)',
};

/**
 * The goals the training log can contain, which is not the goals you can pick.
 *
 * `vocabulary.goals` drives the goal picker and the prescription lookup, and
 * Conditioning belongs in neither: `getPrescription(profile, 'Conditioning')`
 * has no row for any lifting profile. But conditioning entries are written with
 * `goal: 'Conditioning'` so the balance chart can account for them, and reading
 * the log against the picker's list filed a whole HIIT workout under "Not
 * recorded". The two lists do different jobs; this is the reporting one.
 */
const REPORT_GOALS = (goals) => [...goals, 'Conditioning'];

/** The prescription profile used to preview a goal before lifts are chosen. */
const REPRESENTATIVE_PROFILE = 'Heavy compound';

const WARM_BUDGETS = [10, 15, 20];
const COOL_BUDGETS = [0, 10, 20, 30];
const WINDOW_DAYS = 30;

/* ------------------------------------------------------------- navigation

   How deep each screen sits. It is the only thing the transition needs to
   know: a deeper number is a push and rises, a shallower one is a return and
   drops, an equal one is a tab switch and gets a shorter, flatter move.

   Plan is 2 rather than 1 because it is reached from Build (0) and from Quick
   (1), and both of those are forward.
   ------------------------------------------------------------------------ */
const SCREEN_DEPTH = {
  home: 0,
  build: 0,
  log: 0,
  library: 0,
  guide: 1,
  saved: 1,
  quick: 1,
  cond: 1,
  plan: 2,
  // Deeper than Plan: it is reached from there, and from the HIIT screen when
  // you choose to build rather than generate.
  condedit: 3,
  live: 3,
  timer: 3,
};

/**
 * How long a navigation stays "recent".
 *
 * The transition cannot simply be "this render changed screen", because a
 * navigation is often followed immediately by a second render -- `finishSession`
 * calls go('home') and then flash(), one after the other. That second render
 * replaces the DOM mid-animation, and without this window it would arrive with
 * no animation class at all and the screen would snap in. Re-applying the
 * class restarts the animation a few milliseconds in, which nobody can see.
 *
 * Deliberately far shorter than the animation. Those follow-up renders are in
 * the same call stack, so a few frames is plenty -- and a longer window would
 * start catching real interactions, replaying the whole transition because
 * someone tapped a chip quickly after switching tab.
 */
const NAV_MS = 60;

/* ------------------------------------------------------------------ state */

const state = {
  catalog: null,
  screen: 'home',
  session: blankSession(),
  sessions: [],
  log: [],
  oneRm: {},
  prefs: {},
  customExercises: [],
  live: null,
  libQuery: '',
  libFilters: { equipment: '', pattern: '', primary: '', secondary: '' },
  libFiltersOpen: false,
  libOpen: null,
  libPicking: false,
  /** The custom exercise being written or edited, or null. See `exerciseForm`. */
  libDraftExercise: null,
  libArchiveOpen: false,
  logDetail: false,
  logHistory: false,
  /** Which lift on Build has its 1RM control unfolded. One at a time. */
  buildRmOpen: null,
  /** 0 = the week containing today, -1 = the week before it. Never positive. */
  weekOffset: 0,
  /** Quick workout's inputs. Seeded from prefs so it remembers your usual. */
  quick: null,
  /** Conditioning's inputs. Seeded from prefs, like `quick`. */
  cond: null,
  /** Where each card row is scrolled to, by key, held across re-renders. */
  scrollPos: {},
  /** The last navigation: `{ dir, at }`. Drives the screen transition. */
  nav: null,
  flash: null,
};

const QUICK_DEFAULTS = {
  muscles: [],
  minutes: 60,
  complexity: 'medium',
  warmupBudget: 15,
  cooldownBudget: 10,
};

/** 15 minutes to two hours, in five-minute steps. */
const QUICK_TIMES = Array.from({ length: 22 }, (_, i) => 15 + i * 5);

/**
 * Conditioning runs short. 4 to 30 minutes, and the low end matters: a Tabata is
 * four minutes by definition, and "I have six minutes" is a real ask that the
 * lifting range cannot express.
 */
const COND_TIMES = [4, 6, 8, 10, 12, 14, 15, 16, 18, 20, 25, 30];

const COND_DEFAULTS = {
  minutes: 12,
  format: 'any',
  blocks: 2,
  kit: ['bodyweight'],
  complexity: 'medium',
  lowImpact: false,
  partnerMode: 'solo',
  people: 2,
};

/** The most the control ever offers; the clock decides how many are reachable. */
const COND_BLOCK_CHOICES = [1, 2, 3, 4];

const QUICK_PRESETS = {
  upper: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'],
  lower: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
  full: ['Chest', 'Back', 'Shoulders', 'Quads', 'Hamstrings', 'Glutes', 'Core'],
};

function blankSession() {
  return {
    id: newId(),
    name: '',
    date: today(),
    goal: 'Strength',
    warmupBudget: 15,
    cooldownBudget: 10,
    exerciseIds: [],
    loads: {},
  };
}

/**
 * A running session owns a full copy of the workout, not a reference to the
 * draft. Without that, opening Build mid-session would rewrite the plan you
 * are halfway through — the whole point of being able to build a new workout
 * while one is running.
 */
function blankLive(session) {
  return {
    session: JSON.parse(JSON.stringify(session)),
    date: today(),
    checked: {},
    weights: {},
    collapsed: {},
    editing: null,
    howOpen: null,
    restEndsAt: 0,
    restTotal: 0,
    restLabel: '',
  };
}

/* ------------------------------------------------------------------- boot */

async function init() {
  const root = document.getElementById('app');
  mount(root, h('div.loading', h('div.spinner'), h('p', t('common.loading'))));

  try {
    state.catalog = await loadCatalog();
  } catch (err) {
    mount(
      root,
      h(
        'div.loading',
        h('h1', t('common.loadError')),
        h('p', { class: 'hint' }, String(err.message)),
        h('p', { class: 'hint' }, t('common.loadErrorHint'))
      )
    );
    return;
  }

  state.sessions = store.getSessions();
  state.log = store.getLog();
  state.oneRm = store.getOneRm();
  state.prefs = store.getPrefs();
  state.live = store.getLive();
  state.timer = store.getTimer();
  state.customExercises = store.getCustomExercises();
  // A reload is what a phone does when it reclaims memory mid-workout, and the
  // clock kept running while the page was gone. Catch it up before the first
  // render so it comes back where it actually is, not where it was left.
  if (state.timer?.running) catchUpTimer();

  // Sound and haptics default on: this screen is used with the phone on the
  // floor, and a silent interval timer is not an interval timer.
  if (state.prefs.sound === undefined) state.prefs.sound = true;
  if (state.prefs.haptics === undefined) state.prefs.haptics = true;
  refreshCatalog();

  const draft = store.getDraft();
  if (draft) state.session = { ...blankSession(), ...draft };

  // A session stored before the live snapshot existed only held a sessionId.
  // Adopt the draft as its workout rather than dropping someone mid-workout.
  if (state.live && !state.live.session) {
    state.live.session = JSON.parse(JSON.stringify(state.session));
    state.live.collapsed = state.live.collapsed || {};
    saveLive();
  }

  // The rest timer updates its own two values in place rather than going
  // through render(). A full re-render every second replaces every element,
  // including a weight field the user is part-way through typing into.
  setInterval(tickRest, 1000);

  // Four times a second rather than once: the ring is a continuous sweep, and a
  // one-second step makes it stutter in a way a progress ring never should. The
  // digits only change when the second does, so this costs nothing extra.
  setInterval(tickTimer, 250);

  // A backgrounded tab has its timers throttled, so the clock can come back
  // seconds or minutes behind. Everything is derived from `endsAt`, so one tick
  // on return is enough to catch up -- including running straight past any steps
  // that expired while the screen was off.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.timer?.running) return;
    catchUpTimer();
    if (state.screen === 'timer') render();
  });

  render();
}

/* ----------------------------------------------------------------- render */

function saveDraft() {
  store.setDraft(state.session);
}

/**
 * The session is no longer exactly what the generator produced.
 *
 * Drops the `quick` marker, which does two things: the "Auto-generated" badge
 * stops claiming something that is no longer true, and Shuffle disappears
 * rather than sitting there ready to throw away the edit that was just made.
 *
 * Called from every hand edit to the things the generator decided -- the lift
 * list, the goal, the budgets. Anything else about the session (its name, a
 * per-lift weight) leaves the marker alone, because none of it is something
 * Shuffle would overwrite.
 */
function markHandEdited() {
  if (state.session.quick) delete state.session.quick;
}

function saveLive() {
  if (state.live) store.setLive(state.live);
}

/**
 * Fold the user's own exercises back into the catalog.
 *
 * Called after anything that changes that list. Archived ones are still in
 * here on purpose: they are hidden from the library and the picker, but a
 * workout or a log entry that already refers to one has to keep resolving,
 * or the history would develop holes the moment someone tidied up.
 */
function refreshCatalog() {
  state.catalog = withCustomExercises(state.catalog, state.customExercises);
}

function saveCustomExercises() {
  store.setCustomExercises(state.customExercises);
  refreshCatalog();
}

/**
 * The accent for the current screen.
 *
 * Home is not a training mode, so it takes its own yellow rather than being
 * repainted by whichever goal the draft session happens to hold.
 */
function screenAccent() {
  if (NEUTRAL_SCREENS.has(state.screen)) return 'var(--home-accent)';
  // Quick workout is picking a goal for a session that does not exist yet, so
  // it wears the goal being chosen rather than the draft's. Without this the
  // focus cards changed a colour the screen never showed: the pulse spread and
  // nothing followed it.
  if (state.screen === 'quick') {
    return GOAL_COLOR[quickState().goal] || GOAL_COLOR.Strength;
  }
  // Conditioning is its own mode, not one of the four goals, so it wears the
  // fifth accent -- on its own screen, and on a plan whose only content is a
  // conditioning block. A plan with lifts AND a finisher keeps the lifts' goal
  // colour, because the lifting is still what the session is.
  // The shape being chosen, not the mode: picking AMRAP has to recolour the
  // screen or the wave from the press point arrives somewhere that looks the
  // same as where it left.
  if (state.screen === 'cond') return formatColor(condState().format);
  // While the clock runs, the whole app wears the block being run -- tab bar
  // included -- so which block you are in is answerable without reading.
  if (state.screen === 'timer' && state.timer) {
    const step = timerStep();
    return formatColor(state.timer.blocks[step?.block ?? 0]?.format);
  }
  if (state.screen === 'plan' && conditioningBlocks().length && !sessionExercises().length) {
    // Mixed shapes have no one colour, so the screen wears the mode's own and
    // lets each card carry its block's. Painting the whole screen in the first
    // block's colour would say the workout is an EMOM when it is three things.
    const only = condFormat();
    return only ? formatColor(only) : 'var(--goal-conditioning)';
  }
  return GOAL_COLOR[state.session.goal];
}

/**
 * Screens that are not a training mode, and so keep Home's yellow rather than
 * being repainted by whichever goal the draft session happens to hold.
 *
 * The guide belongs here for the same reason Home does: it describes all four
 * goals, so wearing one of them would be picking a side. Saved belongs for a
 * sharper reason — it is a list of workouts of every goal, each colour-coded
 * to its own, and painting the whole screen in the draft's unrelated accent
 * put a magenta wash over a row of orange and blue stripes.
 */
const NEUTRAL_SCREENS = new Set(['home', 'guide', 'saved']);

/**
 * Which way the app just moved, from the two screen names.
 *
 * Deeper is a push, shallower is a return, level is a tab switch. The first
 * render has no previous screen and gets no motion — animating the app into
 * existence on load is a splash screen, and this app opens instantly.
 */
function navDirection(from, to) {
  if (!from) return 'none';
  const depth = (s) => SCREEN_DEPTH[s] ?? 0;
  const delta = depth(to) - depth(from);
  return delta > 0 ? 'forward' : delta < 0 ? 'back' : 'lateral';
}

function render() {
  const root = document.getElementById('app');
  saveDraft();

  const scrollY = window.scrollY;
  const sameScreen = root.dataset.screen === state.screen;
  const resume = state.live && state.screen !== 'live';
  // A running clock needs the same way back as a running session, and needs it
  // more: a reload mid-workout is exactly what a phone does when it reclaims
  // memory, and a timer you cannot get back to is a workout lost.
  // Including a finished one: a summary nobody has answered yet is unfinished
  // business, and losing the way back to it would lose the workout.
  const resumeTimer = state.timer && state.screen !== 'timer';

  // Record the move on the render that actually changes screen, then keep it
  // for a moment (see NAV_MS) so a follow-up render does not cut the
  // animation off. Everything else — ticking a set, typing a name, tapping a
  // chip — re-renders too, and must not animate or the app would flicker
  // constantly and feel slower than the hard cut it replaced.
  if (!sameScreen) {
    state.nav = { dir: navDirection(root.dataset.screen, state.screen), at: Date.now() };
  }
  const navClass =
    state.nav && Date.now() - state.nav.at < NAV_MS ? `nav-${state.nav.dir}` : null;

  const app = h(
    'div.app',
    {
      class: [
        NEUTRAL_SCREENS.has(state.screen) && 'is-neutral',
        (resume || resumeTimer) && 'has-resume',
        navClass,
      ]
        .filter(Boolean)
        .join(' '),
      style: `--g:${screenAccent()}`,
    },
    screen(),
    resume && resumeBubble(),
    !resume && resumeTimer && timerBubble(),
    tabbar()
  );

  mount(
    root,
    app,
    // The toast is a sibling of `.app`, not a child of it, so it cannot
    // inherit the accent and was falling back to the `:root` default — saving
    // an Endurance session flashed a Strength-orange tick. Same fault the
    // dialogs had, and the same fix: hand it the accent explicitly.
    state.flash &&
      h(
        'div.flash',
        { style: `--g:${screenAccent()}` },
        icon(ICONS.check, { size: 14 }),
        state.flash
      )
  );
  root.dataset.screen = state.screen;

  syncTabbarHeight(app);

  // Hold the scroll position across a re-render, but start a newly pushed
  // screen at the top the way a real navigation would.
  window.scrollTo({ top: sameScreen ? scrollY : 0 });
}

/**
 * Publish the tab bar's real height as `--tabbar-h`.
 *
 * Everything pinned to the bottom clears the bar using that variable, and the
 * bar's height depends on the rendered font, so guessing it in CSS leaves
 * content hidden behind it on whichever platform disagrees.
 */
function syncTabbarHeight(app) {
  const bar = app.querySelector('.tabbar');
  if (!bar) return;
  const height = Math.round(bar.getBoundingClientRect().height);
  if (height > 0) app.style.setProperty('--tabbar-h', `${height}px`);
}

function go(screen) {
  // Leaving the Library abandons a half-written exercise. Keeping it would
  // mean coming back to the Library later and landing in a form instead of
  // the list, with no memory of having opened one.
  if (screen !== 'library') state.libDraftExercise = null;
  state.screen = screen;
  render();
}

/**
 * The floating bubble back into a running session. Present on every screen
 * while a session is live, gone the moment it is finished.
 */
/**
 * The way back into a running clock.
 *
 * Same bubble as a live session's, in the running block's colour, and it says
 * the time left rather than a step count -- when a clock is running, how long
 * is the only question worth answering from another screen.
 */
function timerBubble() {
  const tm = state.timer;
  const step = timerStep();
  const block = tm.blocks[step?.block ?? 0];

  return h(
    'div.bubble-wrap',
    h(
      'button.bubble',
      {
        style: `--gs:${formatColor(block?.format)}`,
        onclick: () => go('timer'),
        'aria-label': t('cond.resumePill', { name: tm.sessionName }),
      },
      h('span.bubble-pulse'),
      h(
        'span.bubble-main',
        h('span.bubble-name', block ? t(`cond.format.${block.format}`) : tm.sessionName),
        h(
          'span.bubble-meta',
          tm.done ? t('cond.doneTitle') : tm.running ? restClock(timerRemaining()) : t('cond.paused')
        )
      ),
      h('span.bubble-action', t('nav.resumeAction'))
    )
  );
}

function resumeBubble() {
  const session = liveSession();
  const built = buildSession(session, state.catalog, state.oneRm);
  const steps = liveSteps(built, sessionExercises(session), session);
  const done = steps.filter((k) => state.live.checked[k]).length;

  return h(
    'div.bubble-wrap',
    h(
      'button.bubble',
      {
        style: `--gs:${GOAL_COLOR[session.goal] || GOAL_COLOR.Strength}`,
        onclick: () => go('live'),
        'aria-label': `${t('nav.resume')}: ${sessionTitle(session)}`,
      },
      h('span.bubble-pulse'),
      h(
        'span.bubble-main',
        h('span.bubble-name', sessionTitle(session)),
        h('span.bubble-meta', `${goalLabel(session.goal)} · ${done}/${steps.length}`)
      ),
      h('span.bubble-action', t('nav.resumeAction'))
    )
  );
}

function flash(message) {
  state.flash = message;
  render();
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => {
    state.flash = null;
    render();
  }, 2200);
}

function screen() {
  switch (state.screen) {
    case 'build':
      return viewBuild();
    case 'plan':
      return viewPlan();
    case 'live':
      // No session running means there is nothing to show. Fall back rather
      // than let the view conjure one into existence.
      if (!state.live) {
        state.screen = 'home';
        return viewHome();
      }
      return viewLive();
    case 'log':
      return viewLog();
    case 'library':
      return viewLibrary();
    case 'saved':
      return viewSaved();
    case 'guide':
      return viewGuide();
    case 'quick':
      return viewQuick();
    case 'cond':
      return viewConditioning();
    case 'condedit':
      return viewCondEdit();
    case 'timer':
      if (!state.timer) {
        state.screen = 'home';
        return viewHome();
      }
      return viewTimer();
    default:
      return viewHome();
  }
}

function tabbar() {
  const tabs = [
    ['home', t('tab.home'), ICONS.home],
    ['build', t('tab.build'), ICONS.dumbbell],
    ['log', t('tab.log'), ICONS.chart],
    ['library', t('tab.library'), ICONS.list],
  ];

  // Plan and Session are pushed from Build; Saved and the guide from Home.
  // Keep the parent tab lit so the bar never looks like nothing is selected.
  const parent =
    state.screen === 'plan' ||
    state.screen === 'live' ||
    state.screen === 'quick' ||
    state.screen === 'cond' ||
    state.screen === 'condedit' ||
    state.screen === 'timer'
      ? 'build'
      : state.screen === 'saved' || state.screen === 'guide'
        ? 'home'
        : state.screen;

  return h(
    'nav.tabbar',
    { role: 'tablist' },
    tabs.map(([key, label, path]) =>
      h(
        'button.tab',
        {
          class: parent === key ? 'is-active' : '',
          role: 'tab',
          'aria-selected': String(parent === key),
          onclick: () => go(key),
        },
        h('span.tab-icon', icon(path, { size: 22, width: parent === key ? 2 : 1.7 })),
        h('span.tab-label', label)
      )
    )
  );
}

/* --------------------------------------------------------------- helpers */

function sessionExercises(session = state.session) {
  return (session.exerciseIds || []).map((id) => state.catalog.byId.get(id)).filter(Boolean);
}

function prescriptionFor(exercise, session = state.session) {
  return getPrescription(state.catalog.prescriptionIndex, exercise.profile, session.goal);
}

function loadFor(exercise, session = state.session) {
  return suggestedLoad(prescriptionFor(exercise, session), state.oneRm[exercise.id]);
}

function goalLabel(goal) {
  return t(`goal.${goal}`);
}

function sessionTitle(session = state.session) {
  return session.name || t('build.namePlaceholder');
}

/** Sets prescribed for one exercise, the same number that drives the estimate. */
function setsFor(exercise, session = state.session) {
  const p = prescriptionFor(exercise, session);
  return Math.max(1, Math.round(p?.setsAvg || 1));
}

/** The mid-range working weight, rounded like every other suggested load. */
function defaultWeight(exercise, session = state.session) {
  const p = prescriptionFor(exercise, session);
  const rm = state.oneRm[exercise.id];
  if (!p || !p.loadMin || !rm) return null;
  return mround((rm * (p.loadMin + p.loadMax)) / 2, 2.5);
}

const kg = (v) => `${Number(v).toFixed(1).replace(/\.0$/, '')} ${t('units.kg')}`;

function screenHead(kicker, title) {
  return h('div.stack', { style: 'gap:2px' }, h('div.kicker', kicker), h('h1.screen-title', title));
}

function backLink(label, onclick) {
  return h('button.back', { onclick }, icon(ICONS.chevronLeft, { size: 12 }), label);
}

function empty(title, hint) {
  return h('div.empty', h('p.empty-title', title), hint && h('p.empty-hint', hint));
}

/* ----------------------------------------------------------------- home

   Home answers three questions, in this order, and nothing else:

     What am I doing now?     the hero card, and the two ways to get one
     How did this week go?    the week card
     How am I trending?       balance, and the way through to the Log

   Everything is the same card. Home previously ran three container idioms
   down one column -- a bordered card with an accent line, a bordered button,
   and two sections floating with no container at all -- so nothing looked
   related to anything and the eye had no grouping to work with.

   COLOUR POLICY. Home is not a training mode, so it takes Home's yellow and
   that is the only emphasis colour it owns. Goal colours appear in exactly
   two places, both of which name a goal: the pill on the planned session, and
   the balance bar with its labelled legend. The muscle red/amber does not
   appear at all -- the primary/supporting split is a real distinction but it
   needs its legend to be read, and that legend lives on the Log. Home says
   whether a muscle group was trained; the Log says how.
   ------------------------------------------------------------------------ */

function viewHome() {
  const mix = goalMixFromLog(
    withinDays(state.log, WINDOW_DAYS, today()),
    REPORT_GOALS(state.catalog.vocabulary.goals)
  );

  return h(
    'div.screen',
    h(
      'div.screen-inner.home',
      homeHeader(),
      startBlock(),
      weekCard(),
      balanceCard(mix)
    )
  );
}

/**
 * The date is the heading.
 *
 * There used to be an `h1` reading "Home" above it, which spent the largest
 * type on the screen restating the tab you just pressed. The date is the one
 * piece of chrome here that is actually information.
 */
function homeHeader() {
  const d = new Date();
  return h(
    'header.home-top',
    h(
      'div.stack',
      { style: 'gap:1px' },
      h('div.kicker', d.toLocaleString('en', { weekday: 'long' })),
      h('h1.home-date', `${d.getDate()} ${d.toLocaleString('en', { month: 'long' })}`)
    ),
    // Deliberately quiet: a question mark in the corner, not a banner. It is
    // the only thing on Home that isn't your training, and someone on their
    // fortieth session should be able to stop seeing it.
    h(
      'button.help-btn',
      { onclick: () => go('guide'), 'aria-label': t('guide.open'), title: t('guide.open') },
      icon(ICONS.help, { size: 18 })
    )
  );
}

/** A card header: a kicker on the left, anything you like on the right. */
function cardHead(kicker, right) {
  return h('div.card-head', h('div.kicker', kicker), right);
}

/**
 * The one thing Home exists to answer: what am I doing now.
 *
 * Given the most type on the screen and the only filled button, because on
 * every other card you are reading and on this one you are leaving.
 */
function stat(value, label, unit) {
  return h(
    'div.stat',
    h('div.stat-value', String(value), unit && h('span.unit', ` ${unit}`)),
    h('div.stat-label', label)
  );
}

/**
 * The three ways to start training: generate one, build one, or reuse one.
 *
 * Two square tiles over a wide one, all the same material, so they read as a
 * single block rather than three unrelated offers. The wide one is the
 * platform: it is the only one with contents rather than a promise, since a
 * saved workout is a thing that already exists and can be stepped straight
 * onto.
 *
 * There used to be a PLANNED card above all this holding the draft session and
 * a Start button. It is gone at the user's request, which does mean the draft
 * is now reached through Build rather than from here.
 */
function startBlock() {
  const tile = (screen, iconPath, title, blurb) =>
    h(
      'button.start-tile',
      { onclick: () => go(screen) },
      h('span.tile-icon', icon(iconPath, { size: 17 })),
      h('span.tile-title', title),
      h('span.tile-blurb', blurb)
    );

  return h(
    'div.start-tiles',
    tile('quick', ICONS.spark, t('quick.title'), t('home.quickBlurb')),
    tile('build', ICONS.dumbbell, t('home.buildTitle'), t('home.buildBlurb')),
    // Conditioning gets a full-width tile of its own rather than a third square,
    // because it is a different kind of training rather than a third way to
    // arrive at the same session -- and it carries its own accent to say so.
    h(
      'button.start-tile.tile-wide.tile-cond',
      { onclick: () => go('cond') },
      h('span.tile-icon', icon(ICONS.clock, { size: 17 })),
      h('span.tile-title', t('cond.title')),
      h('span.tile-blurb', t('cond.homeBlurb'))
    ),
    savedPlatform()
  );
}

/**
 * The saved workouts, as a wide slab under the two tiles.
 *
 * The header navigates to the full list; the rail below carries the workouts
 * themselves, so the common case — "run the one I always run" — is one tap
 * from Home instead of three. Each carries its goal colour, the same coding
 * the Saved screen uses, so the row is scannable without reading it.
 *
 * With nothing saved it keeps the header and says what would land here. An
 * empty slab is worth one line: it is how you find out the feature exists.
 */
function savedPlatform() {
  const saved = state.sessions;

  const head = h(
    'button.platform-head',
    { onclick: () => go('saved'), disabled: !saved.length },
    h('span.tile-icon', icon(ICONS.save, { size: 16 })),
    h('span.tile-title', t('today.saved')),
    h(
      'span.card-meta',
      saved.length ? t('today.savedMeta', { n: saved.length }) : t('home.savedNone')
    ),
    saved.length > 0 && icon(ICONS.chevronRight, { size: 14 })
  );

  if (!saved.length) {
    return h('div.start-platform', head, h('p.tile-blurb', t('home.savedEmptyHint')));
  }

  // Most recently trained first, then most recently saved — the same order the
  // Saved screen uses inside a goal, for the same reason.
  const recent = (s) => lastCompleted(s) || '';
  const rail = saved
    .slice()
    .sort((a, b) => recent(b).localeCompare(recent(a)) || (b.date || '').localeCompare(a.date || ''))
    .slice(0, 8);

  return h(
    'div.start-platform',
    head,
    h(
      'div.platform-rail',
      rail.map((s) =>
        h(
          'button.saved-chip',
          {
            style: `--gs:${goalColor(s.goal)}`,
            title: `${s.name} — ${goalLabel(s.goal)}`,
            onclick: () => {
              state.session = JSON.parse(JSON.stringify(s));
              saveDraft();
              go('plan');
            },
          },
          h('span.saved-chip-name', s.name),
          h(
            'span.saved-chip-meta',
            tp('saved.lifts', (s.exerciseIds || []).length)
          )
        )
      )
    )
  );
}

function shortDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
}

/* ----------------------------------------------------------- week summary */

/**
 * The training week, Monday to Sunday.
 *
 * A calendar week rather than a trailing seven days, because that is the unit
 * people actually plan and talk about training in ("chest twice this week"),
 * and because a rolling window silently drops Monday's work as soon as the
 * next Monday arrives — which is exactly when you want to look back at it.
 *
 * This card used to sit directly beneath a 14-day strip that answered almost
 * the same question in a different visual language — two rows of bars, one
 * grey-and-yellow and one boxed, stacked. They are merged: the day cells carry
 * the volume the strip was showing, and stepping back a week reaches further
 * than fourteen days ever did.
 *
 * What was NOT trained is given equal billing, because a list of the groups
 * you hit says nothing about the ones you keep missing.
 */
function weekCard() {
  const start = weekStart(today(), state.weekOffset);
  const sum = weekSummary(
    state.log,
    start,
    state.catalog.byId,
    state.catalog.vocabulary.muscles
  );

  const nav = (delta, label, disabled) =>
    h(
      'button.icon-btn',
      {
        disabled,
        'aria-label': label,
        title: label,
        onclick: () => {
          state.weekOffset += delta;
          render();
        },
      },
      icon(delta < 0 ? ICONS.chevronLeft : ICONS.chevronRight, { size: 13 })
    );

  return h(
    'section.home-card',
    cardHead(
      weekTitle(),
      h(
        'div.week-nav',
        h('span.week-range', weekRangeLabel(sum.start, sum.end)),
        nav(-1, t('week.previous'), false),
        // Never past the current week: there is nothing logged in the future,
        // and an endlessly advancing empty week is a dead end to walk into.
        nav(1, t('week.next'), state.weekOffset >= 0)
      )
    ),
    weekDayStrip(sum),
    sum.sets
      ? h(
          'div.stack',
          { style: 'gap:14px' },
          h(
            'div.hero-stats.is-compact',
            stat(sum.daysTrained, tp('week.daysUnit', sum.daysTrained)),
            stat(sum.sets, t('week.setsUnit')),
            stat(sum.rows.length, t('week.groupsUnit'))
          ),
          coverage(sum),
          h(
            'button.btn-link',
            { onclick: () => go('log') },
            t('week.detail'),
            icon(ICONS.chevronRight, { size: 12 })
          )
        )
      : // Plain text, not the dashed `empty` box: this is already inside a
        // card, and a bordered panel within a bordered panel is the nesting
        // this redesign exists to get rid of.
        h(
          'div.card-empty',
          h('p.card-empty-title', t('week.empty')),
          state.weekOffset === 0 && h('p.hint', t('week.emptyHint'))
        )
  );
}

/**
 * Seven cells, Monday first, with a bar for the day's volume.
 *
 * The count used to be printed in the cell, which read as a date next to the
 * "10–16 Aug" beside it. The height carries the volume instead and the exact
 * figure is in the tooltip, so nothing on the card can be mistaken for a
 * calendar.
 */
function weekDayStrip(sum) {
  const max = sum.days.reduce((m, d) => Math.max(m, d.sets), 0) || 1;
  const now = today();

  return h(
    'div.week-days',
    sum.days.map((d) =>
      h(
        'div.week-day',
        {
          class: [d.sets ? 'is-on' : '', d.date === now ? 'is-today' : ''].filter(Boolean).join(' '),
          title: `${shortDate(d.date)} — ${tp('log.sets', d.sets)}`,
        },
        h('span.week-day-name', weekdayShort(d.date)),
        h(
          'span.week-day-track',
          // A day with any work always reads as present; above that it is
          // proportion. A 1-set day and a 20-set day must not look the same.
          h('span.week-day-bar', {
            style: d.sets ? `height:${20 + Math.round((d.sets / max) * 60)}%` : '',
          })
        )
      )
    )
  );
}

/**
 * Which muscle groups the week covered, and which it did not.
 *
 * One control for both halves. This replaces a legend, a list of bars and a
 * separate "not trained this week" paragraph — three elements answering one
 * question, in two colour languages, taking most of the card.
 *
 * Deliberately not split by primary/supporting. That distinction is real but
 * unreadable without its legend, and the legend belongs with the full
 * breakdown on the Log. Here a group is either trained or it is not.
 */
function coverage(sum) {
  const trained = sum.rows.map((r) => ({ muscle: r.muscle, sets: r.total }));
  const rest = sum.untouched.map((muscle) => ({ muscle, sets: 0 }));

  return h(
    'div.coverage',
    [...trained, ...rest].map((row) =>
      h(
        'span.cover-pill',
        {
          class: row.sets ? 'is-on' : '',
          title: row.sets
            ? `${row.muscle} — ${tp('log.sets', row.sets)}`
            : `${row.muscle} — ${t('week.notTrained')}`,
        },
        h('span.cover-name', row.muscle),
        row.sets > 0 && h('span.cover-count', String(row.sets))
      )
    )
  );
}

function weekTitle() {
  if (state.weekOffset === 0) return t('week.this');
  if (state.weekOffset === -1) return t('week.last');
  return t('week.agoWeeks', { n: -state.weekOffset });
}

function weekdayShort(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleString('en', { weekday: 'short' }).slice(0, 2);
}

function weekRangeLabel(startIso, endIso) {
  const a = new Date(`${startIso}T00:00:00`);
  const b = new Date(`${endIso}T00:00:00`);
  const month = (d) => d.toLocaleString('en', { month: 'short' });
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${month(b)}`
    : `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)}`;
}

/**
 * Sets per muscle group as paired bars.
 *
 * Shared by the weekly summary and the 30-day breakdown on Log so the two can
 * never drift into showing the same numbers two different ways. The bars are
 * scaled within the rows they are given, so a quiet week still fills the
 * width — the figure on the right is the one that carries the magnitude.
 */
function muscleBars(rows) {
  const max = rows.reduce((m, r) => Math.max(m, r.primary, r.secondary), 0) || 1;

  return h(
    'div.stack',
    { style: 'gap:0' },
    rows.map((r) =>
      h(
        'div.mbar-row',
        {
          title: t('log.splitTitle', {
            muscle: r.muscle,
            total: r.total,
            p: r.primary,
            s: r.secondary,
          }),
        },
        h('span.mbar-name', r.muscle),
        h(
          'span.mbar-pair',
          h('span.mbar.mbar-p', { style: `width:${Math.round((r.primary / max) * 100)}%` }),
          h('span.mbar.mbar-s', { style: `width:${Math.round((r.secondary / max) * 100)}%` })
        ),
        h('span.mbar-value', String(r.total))
      )
    )
  );
}

/** The red/amber key the body map, the week card and the log all share. */
function muscleRoleKey() {
  return h(
    'div',
    { style: 'display:flex;align-items:center;gap:16px' },
    h('span.map-group-label', h('span.swatch.swatch-lg.swatch-primary'), t('log.primary')),
    h('span.map-group-label', h('span.swatch.swatch-lg.swatch-secondary'), t('log.supporting'))
  );
}

/**
 * The 30-day goal mix.
 *
 * The one place on Home besides the planned session's pill where goal colours
 * appear, and it earns them: the bar is a chart of four named things and it
 * ships its legend right underneath.
 */
function balanceCard(mix) {
  if (!mix.total) {
    return h(
      'button.home-card.is-link',
      { onclick: () => go('log') },
      cardHead(t('today.balance'), h('span.card-meta', t('log.empty')))
    );
  }

  return h(
    'button.home-card.is-link',
    { onclick: () => go('log') },
    cardHead(
      t('today.balance'),
      h('span.card-meta', t('today.balanceMeta', { n: mix.total }))
    ),
    mixBar(mix),
    h(
      'div.mix-keys',
      mixParts(mix).map((part) =>
        h(
          'span.mix-key',
          h('span.swatch', { style: `background:${part.color}` }),
          `${part.label} ${part.pct}%`
        )
      )
    )
  );
}

/** The goal mix as coloured parts, sorted the way the workbook orders goals. */
function mixParts(mix) {
  const parts = mix.items
    .filter((i) => i.sets > 0)
    .map((i) => ({
      label: goalLabel(i.goal),
      color: GOAL_COLOR[i.goal],
      sets: i.sets,
      pct: Math.round(i.share * 100),
    }));

  if (mix.unknown > 0) {
    parts.push({
      label: t('log.notRecorded'),
      color: 'var(--color-neutral-700)',
      sets: mix.unknown,
      pct: Math.round((mix.unknown / mix.total) * 100),
    });
  }
  return parts;
}

function mixBar(mix, tall = false) {
  return h(
    'div.mix-bar',
    { class: tall ? 'is-tall' : '' },
    mixParts(mix).map((part) =>
      h('span.mix-seg', {
        style: `width:${part.pct}%;background:${part.color}`,
        title: `${part.label}: ${part.sets} sets (${part.pct}%)`,
      })
    )
  );
}

/* `savedCard` lived here: a one-line link row at the bottom of Home that said
   how many workouts you had and nothing about them. Replaced by
   `savedPlatform`, which carries the workouts themselves. */

/* ---------------------------------------------------------------- guide

   A walk through one session, start to finish, in the order you would
   actually do it. Not a feature list: the app's own screens already show what
   it can do, and what a new arrival is missing is the sequence — that a goal
   changes every prescription, that the warm-up builds itself from the lifts
   you picked, that ticking a set is what writes the log.

   Reached from a small question mark on Home and nowhere else. It is not
   forced on first run: a tutorial nobody asked for is a modal in the way of
   the thing they opened the app to do, and the button is always there.
   ------------------------------------------------------------------------ */

/**
 * `go` marks a step you can act on now, and adds a button that takes you
 * there. The steps without one are things that happen on a screen you are
 * already being sent to, so a second button would be noise.
 */
const GUIDE_STEPS = [
  { key: 'goal', go: 'build' },
  { key: 'lifts', go: 'library' },
  { key: 'oneRm' },
  { key: 'budgets' },
  { key: 'plan' },
  { key: 'run' },
  { key: 'rpe' },
  { key: 'review', go: 'log' },
];

function viewGuide() {
  return h(
    'div.screen',
    h(
      'div.screen-inner',
      { style: 'gap:26px' },
      backLink(t('tab.home'), () => go('home')),
      h(
        'div.stack',
        { style: 'gap:10px' },
        screenHead(t('guide.kicker'), t('guide.title')),
        h('p.guide-lede', t('guide.lede'))
      ),

      h(
        'ol.guide-steps',
        GUIDE_STEPS.map((step, i) => guideStep(step, i + 1))
      ),

      h(
        'div.stack',
        { style: 'gap:12px' },
        h('div.section-label', t('guide.moreLabel')),
        guideNote(t('guide.quick.title'), t('guide.quick.text'), 'quick', t('guide.goto.quick')),
        guideNote(t('guide.own.title'), t('guide.own.text'), 'library', t('guide.goto.library')),
        guideNote(t('guide.saved.title'), t('guide.saved.text')),
        guideNote(t('guide.data.title'), t('guide.data.text'))
      ),

      h(
        'button.btn.btn-goal.btn-lg.btn-block',
        { onclick: () => go('build') },
        t('guide.start')
      )
    )
  );
}

function guideStep(step, n) {
  return h(
    'li.guide-step',
    h('span.guide-num', String(n)),
    h(
      'div.guide-step-body',
      h('h2.guide-step-title', t(`guide.step.${step.key}.title`)),
      h('p.guide-text', t(`guide.step.${step.key}.text`)),
      // The goals are the one thing here that is easier shown than described:
      // the app re-tints around whichever you pick, so the swatches teach the
      // colour language before you meet it.
      step.key === 'goal' && guideGoalKey(),
      step.go &&
        h(
          'button.btn-link',
          { onclick: () => go(step.go) },
          t(`guide.goto.${step.go}`),
          icon(ICONS.chevronRight, { size: 12 })
        )
    )
  );
}

function guideGoalKey() {
  return h(
    'div.guide-goals',
    state.catalog.vocabulary.goals.map((goal) =>
      h(
        'span.guide-goal',
        h('span.swatch.swatch-lg', { style: `background:${GOAL_COLOR[goal]}` }),
        goalLabel(goal)
      )
    )
  );
}

function guideNote(title, text, target, label) {
  return h(
    'div.guide-note',
    h('div.guide-note-title', title),
    h('p.guide-text', text),
    target && h('button.btn-link', { onclick: () => go(target) }, label, icon(ICONS.chevronRight, { size: 12 }))
  );
}

/* --------------------------------------------------------- quick workout

   Four questions and a button. Build asks you to know which lifts you want;
   this asks what you want to work, how long you have, and how much technique
   you are willing to be handed, and answers the rest itself.

   Every control writes straight to prefs, so the screen you come back to is
   the one you left. The generated session carries its own inputs and seed
   (`session.quick`), which is what lets Plan offer a shuffle without this
   screen having to still be open.
   ------------------------------------------------------------------------ */

function quickState() {
  if (!state.quick) {
    state.quick = { ...QUICK_DEFAULTS, ...(state.prefs.quick || {}) };
    // The goal is not stored with the rest: falling back to whatever the draft
    // is set to means Quick workout opens on the goal you have been training.
    if (!state.quick.goal) state.quick.goal = state.session.goal;
  }
  return state.quick;
}

function setQuick(patch, { rerender = true } = {}) {
  state.quick = { ...quickState(), ...patch };
  state.prefs = { ...state.prefs, quick: state.quick };
  store.setPrefs(state.prefs);
  if (rerender) render();
}

function viewQuick() {
  const q = quickState();
  const v = state.catalog.vocabulary;
  const mainBudget = q.minutes - q.warmupBudget - q.cooldownBudget;

  return h(
    'div.screen',
    h(
      'div.screen-inner',
      { style: 'gap:24px' },
      backLink(t('tab.home'), () => go('home')),
      screenHead(t('quick.kicker'), t('quick.title')),

      quickSection(
        t('quick.muscles'),
        h(
          'div.stack',
          { style: 'gap:9px' },
          h(
            'div.chips',
            Object.keys(QUICK_PRESETS).map((key) =>
              h(
                'button.chip',
                {
                  class: samePreset(q.muscles, QUICK_PRESETS[key]) ? 'is-on' : '',
                  onclick: () => setQuick({ muscles: [...QUICK_PRESETS[key]] }),
                },
                t(`quick.preset.${key}`)
              )
            )
          ),
          h(
            'div.muscle-chips',
            v.muscles
              .filter((m) => m !== 'Full body')
              .map((m) => {
                const on = q.muscles.includes(m);
                return h(
                  'button.chip.chip-sm',
                  {
                    class: on ? 'is-on' : '',
                    'aria-pressed': String(on),
                    onclick: () =>
                      setQuick({
                        muscles: on ? q.muscles.filter((x) => x !== m) : [...q.muscles, m],
                      }),
                  },
                  m
                );
              })
          ),
          h('p.hint', q.muscles.length ? t('quick.musclesN', { n: q.muscles.length }) : t('quick.musclesAny'))
        )
      ),

      quickSection(t('quick.time'), timeScroller(q.minutes)),

      quickSection(
        t('quick.focus'),
        focusScroller(q.goal, (e, goal) => pickGoal(e, goal, () => setQuick({ goal }))),
        t('quick.focusHint')
      ),

      quickSection(
        t('quick.complexity'),
        h(
          'div.stack',
          { style: 'gap:9px' },
          h(
            'div.chips',
            COMPLEXITY_LEVELS.map((level) =>
              h(
                'button.chip',
                {
                  class: q.complexity === level ? 'is-on' : '',
                  'aria-pressed': String(q.complexity === level),
                  onclick: () => setQuick({ complexity: level }),
                },
                t(`quick.level.${level}`)
              )
            )
          ),
          h('p.hint', t(`quick.levelHint.${q.complexity}`))
        )
      ),

      quickSection(t('build.warmBudget'), quickBudget('warmupBudget', WARM_BUDGETS, q)),
      quickSection(t('build.coolBudget'), quickBudget('cooldownBudget', COOL_BUDGETS, q)),

      // The split is the one thing about this screen that surprises people:
      // the time you picked is the whole session, so a long warm-up eats the
      // lifting. Saying so up front beats explaining a short plan afterwards.
      h(
        'div.quick-split',
        h('span', t('quick.splitTotal', { n: q.minutes })),
        h('span.quick-split-sep', '='),
        h('span', t('quick.splitWarm', { n: q.warmupBudget + q.cooldownBudget })),
        h('span.quick-split-sep', '+'),
        h(
          'span',
          { class: mainBudget <= 0 ? 'is-short' : '' },
          t('quick.splitMain', { n: Math.max(0, mainBudget) })
        )
      )
    ),
    h(
      'div.sticky-actions',
      h(
        'button.btn.btn-goal.btn-lg.btn-block',
        // No captured `q`: the time strip updates state without re-rendering,
        // so anything closed over at render time is one scroll out of date.
        { disabled: mainBudget <= 0, onclick: () => runQuick() },
        icon(ICONS.spark, { size: 16 }),
        t('quick.generate')
      )
    )
  );
}

function quickSection(label, body, hint) {
  return h(
    'div.stack',
    { style: 'gap:10px' },
    h('div.kicker', label),
    body,
    hint && h('p.hint', hint)
  );
}

/* ---------------------------------------------------------- conditioning

   The same four-questions-and-a-button shape as Quick workout, because it is
   the same kind of screen and there is nothing to gain from it being a
   different one. What it asks is different: how long, what shape, what kit is
   to hand, and whether anyone is doing it with you.

   Kit is asked here rather than kept as a setting because the answer changes
   between the gym and the garage, and a stale one silently prescribes a rower
   you cannot reach.
   ------------------------------------------------------------------------ */

function condState() {
  if (!state.cond) state.cond = { ...COND_DEFAULTS, ...(state.prefs.cond || {}) };
  return state.cond;
}

function setCond(patch, { rerender = true } = {}) {
  state.cond = { ...condState(), ...patch };
  state.prefs = { ...state.prefs, cond: state.cond };
  store.setPrefs(state.prefs);
  if (rerender) render();
}

// Bodyweight first: it is the answer that needs nothing, so it is the one that
// is always true, and someone in a hotel room should not have to read past the
// three they do not have to find it.
const COND_KITS = ['bodyweight', 'floor', 'erg', 'run', 'rig'];
const COND_FORMAT_CHOICES = ['any', ...CONDITIONING_FORMATS];

/**
 * A colour per shape, so a plan is recognisable as an EMOM or an AMRAP before
 * it is read -- the same job the goal accents do for the lifting side.
 *
 * `any` is not a shape, it is the absence of a choice, so it wears the mode's
 * own cyan rather than a sixth colour. That is also what made the set possible:
 * eleven colours now share one hue circle, and six formats could not be
 * separated from each other, from each other under colourblindness, and from
 * the six accents that already exist, all at once.
 */
const FORMAT_COLOR = {
  any: 'var(--goal-conditioning)',
  emom: 'var(--fmt-emom)',
  amrap: 'var(--fmt-amrap)',
  intervals: 'var(--fmt-intervals)',
  tabata: 'var(--fmt-tabata)',
  fortime: 'var(--fmt-fortime)',
};

const formatColor = (key) => FORMAT_COLOR[key] || 'var(--goal-conditioning)';
const COND_PARTNERS = ['solo', ...PARTNER_MODES];

function viewConditioning() {
  const c = condState();
  const noKit = c.kit.length === 0;

  return h(
    'div.screen',
    h(
      'div.screen-inner',
      { style: 'gap:24px' },
      backLink(t('tab.home'), () => go('home')),
      screenHead(t('cond.kicker'), t('cond.title')),
      h('p.hint', { style: 'margin-top:-14px' }, t('cond.blurb')),

      quickSection(
        t('cond.time'),
        timeScroller(c.minutes, COND_TIMES, (minutes) => {
          setCond({ minutes }, { rerender: false });
          updateBlockChips(minutes);
        })
      ),

      // How many pieces the time is cut into. One block of three movements over
      // twenty minutes is those three movements six times each; three blocks is
      // nine movements and a second half that does not feel like the first.
      quickSection(t('cond.blocks'), blockChips(c), blockSplitHint(c)),

      // Shape gets the scrolling-card treatment the goals get, and for the same
      // reason: "EMOM" and "AMRAP" are jargon that mean nothing until someone
      // tells you, and this is the screen where they need telling.
      // Shapes carry their own colour and repaint the screen when picked, the
      // same as the goals do -- so they get the same wave from the press point.
      quickSection(
        t('cond.format'),
        cardScroller(
          COND_FORMAT_CHOICES,
          c.format,
          'cond.format',
          'cond.formatWhy',
          (key, e) => pickAccent(e, formatColor(key), () => setCond({ format: key })),
          formatColor
        )
      ),

      quickSection(
        t('cond.kit'),
        h(
          'div.chips.chips-grid',
          COND_KITS.map((k) => {
            const on = c.kit.includes(k);
            return h(
              'button.chip.chip-stack',
              {
                class: on ? 'is-on' : '',
                'aria-pressed': String(on),
                onclick: () =>
                  setCond({ kit: on ? c.kit.filter((x) => x !== k) : [...c.kit, k] }),
              },
              h('span.chip-name', t(`cond.kit.${k}`)),
              h('span.chip-sub', t(`cond.kitWhy.${k}`))
            );
          })
        ),
        noKit ? t('cond.kitNone') : t('cond.kitHint')
      ),

      quickSection(
        t('cond.partner'),
        cardScroller(COND_PARTNERS, c.partnerMode, 'cond.partner', 'cond.partnerWhy', (key) =>
          setCond({ partnerMode: key })
        )
      ),

      c.partnerMode !== 'solo' &&
        quickSection(
          t('cond.people'),
          h(
            'div.chips',
            [2, 3, 4].map((n) =>
              h(
                'button.chip',
                {
                  class: c.people === n ? 'is-on' : '',
                  'aria-pressed': String(c.people === n),
                  onclick: () => setCond({ people: n }),
                },
                String(n)
              )
            )
          )
        ),

      quickSection(
        t('cond.complexity'),
        h(
          'div.stack',
          { style: 'gap:9px' },
          h(
            'div.chips',
            COMPLEXITY_LEVELS.map((level) =>
              h(
                'button.chip',
                {
                  class: c.complexity === level ? 'is-on' : '',
                  'aria-pressed': String(c.complexity === level),
                  onclick: () => setCond({ complexity: level }),
                },
                t(`quick.level.${level}`)
              )
            )
          ),
          h('p.hint', t(`quick.levelHint.${c.complexity}`))
        )
      ),

      quickSection(
        t('cond.lowImpact'),
        h(
          'button.chip',
          {
            class: c.lowImpact ? 'is-on' : '',
            'aria-pressed': String(c.lowImpact),
            onclick: () => setCond({ lowImpact: !c.lowImpact }),
          },
          t('cond.lowImpact')
        ),
        t('cond.lowImpactHint')
      )
    ),
    h(
      'div.sticky-actions',
      // Building by hand ignores every answer above it, which is exactly right:
      // those questions exist to brief the generator, and someone who already
      // knows what they want is not briefing anybody.
      h(
        'button.btn.btn-lg',
        { style: 'flex:none;width:104px', onclick: () => startBuiltConditioning() },
        t('cond.buildOwn')
      ),
      h(
        'button.btn.btn-goal.btn-lg',
        { style: 'flex:1', disabled: noKit, onclick: () => runConditioning() },
        icon(ICONS.spark, { size: 16 }),
        t('cond.generate')
      )
    )
  );
}

/**
 * Start a hand-built conditioning workout.
 *
 * Same collision question as generating, and for the same reason: the entry
 * point says a HIIT workout was wanted, and a lifting draft sitting there is
 * leftover state rather than an answer.
 */
function startBuiltConditioning() {
  const open = () => {
    editConditioning(conditioningBlocks().length);
  };

  const lifts = sessionExercises().length;
  if (!lifts) {
    if (!conditioningBlocks().length) state.session = blankSession();
    open();
    return;
  }

  const name = sessionTitle(state.session);
  choiceSheet({
    title: t('cond.attachTitle'),
    body: tp('cond.attachBody', lifts, { name }),
    choices: [
      {
        label: t('cond.attachAlone'),
        sub: t('cond.attachAloneSub', { name }),
        primary: true,
        onPick: () => {
          state.session = blankSession();
          open();
        },
      },
      { label: t('cond.attachFinisher', { name }), sub: t('cond.attachFinisherSub'), onPick: open },
    ],
    cancelLabel: t('custom.cancel'),
  });
}

/**
 * A side-scrolling row of titled cards with a blurb, one of them chosen.
 *
 * Lifted out of `focusScroller` rather than copied: shape and partner mode are
 * the same problem the goals had -- a word that means nothing until someone
 * explains it -- and they deserve the same answer. The goals keep their own
 * function because their cards also carry prescription numbers.
 */
function cardScroller(keys, current, titlePrefix, blurbPrefix, onPick, colourOf = null) {
  const scroller = h(
    'div.focus-scroller',
    { role: 'radiogroup' },
    keys.map((key) => {
      const on = key === current;
      const colour = colourOf ? colourOf(key) : null;
      return h(
        'button.focus-card',
        {
          class: [on ? 'is-on' : '', colour ? '' : 'card-plain'].filter(Boolean).join(' '),
          style: colour ? `--gc:${colour}` : null,
          role: 'radio',
          'aria-checked': String(on),
          onclick: (e) => onPick(key, e),
        },
        h('span.focus-name', t(`${titlePrefix}.${key}`)),
        h('span.focus-blurb', t(`${blurbPrefix}.${key}`))
      );
    })
  );

  return holdScroll(scroller, titlePrefix, current);
}

/**
 * Generate a conditioning block and hand it to Plan.
 *
 * The block is attached to the draft session rather than replacing it, which is
 * the whole point of `session.conditioning` being an optional field: a draft
 * with lifts in it gets a finisher, and an empty one gets a conditioning
 * session. Neither case needs a decision from the user, because the draft
 * already says which they meant.
 */
/**
 * How many blocks, with the ones the clock cannot afford shown but disabled.
 *
 * Disabled rather than absent: a control that grows and shrinks as the time
 * strip scrolls is a control you cannot aim at, and seeing that four blocks
 * exist but need more minutes is the fact that makes the scaling
 * understandable rather than arbitrary.
 */
function blockChips(c) {
  const ceiling = maxConditioningBlocks(c.minutes);
  // The ceiling limits what is *shown as chosen*, never what is stored. Writing
  // the clamp back would mean scrolling the time strip down to eight minutes and
  // back up to thirty silently forgot that three blocks were wanted -- and the
  // strip is a thing you scroll through, so that would happen by accident.
  const shown = Math.min(c.blocks, ceiling);
  return h(
    'div.chips',
    { id: 'cond-blocks' },
    COND_BLOCK_CHOICES.map((n) =>
      h(
        'button.chip',
        {
          class: shown === n ? 'is-on' : '',
          disabled: n > ceiling,
          dataset: { blocks: String(n) },
          'aria-pressed': String(shown === n),
          onclick: () => setCond({ blocks: n }),
        },
        String(n)
      )
    )
  );
}

/** "3 × 6 min, 2 min between" — what the choice actually buys, in minutes. */
function blockSplitHint(c) {
  const n = Math.min(c.blocks, maxConditioningBlocks(c.minutes));
  if (n <= 1) return t('cond.blocksOne');
  const per = Math.floor((c.minutes - (n - 1) * BLOCK_REST_MINUTES) / n);
  return t('cond.blocksSplit', { n, per, rest: BLOCK_REST_MINUTES });
}

/**
 * Keep the block control honest while the time strip is scrolling.
 *
 * The strip writes minutes without re-rendering -- see `timeScroller` -- so the
 * chips have to be told, the same way the quick-workout split line is.
 */
function updateBlockChips(minutes) {
  const row = document.getElementById('cond-blocks');
  if (!row) return;

  const ceiling = maxConditioningBlocks(minutes);
  const c = condState();
  // Shown, not stored -- see `blockChips`. Scrolling past a short time must not
  // cost the user the answer they gave.
  const chosen = Math.min(c.blocks, ceiling);

  for (const chip of row.querySelectorAll('.chip')) {
    const n = Number(chip.dataset.blocks);
    chip.disabled = n > ceiling;
    chip.classList.toggle('is-on', n === chosen);
    chip.setAttribute('aria-pressed', String(n === chosen));
  }

  const hint = row.parentElement?.querySelector('.hint');
  if (hint) hint.textContent = blockSplitHint({ ...c, minutes, blocks: chosen });
}

function conditioningBlocksFrom(c, seed = Math.floor(Math.random() * 2 ** 31)) {
  const workout = generateConditioningWorkout(
    {
      minutes: c.minutes,
      format: c.format,
      blocks: c.blocks || 1,
      kit: c.kit,
      complexity: c.complexity,
      lowImpact: c.lowImpact,
      partner: c.partnerMode === 'solo' ? null : { mode: c.partnerMode, people: c.people },
      seed,
    },
    state.catalog
  );
  if (workout.shortfall) {
    flash(t('cond.nothingFits'));
    return null;
  }
  // The inputs ride on the first block, which is where the re-roll reads them
  // from. Storing them per block would be four copies of one answer.
  workout.blocks.forEach((b, i) => {
    b.id = newId();
    if (i === 0) b.inputs = { ...c };
  });
  return workout.blocks;
}

/**
 * Generate a conditioning block and decide what it is attached to.
 *
 * This used to attach the block to the draft unconditionally, on the reasoning
 * that a draft with lifts means you wanted a finisher and an empty one means you
 * wanted a conditioning session -- "the draft already says which you meant".
 *
 * It does not. The **entry point** says what you meant. Someone who taps HIIT
 * workout on Home, picks a shape, picks their kit and presses Generate wants a
 * HIIT workout; what they got was last week's Leg day in Strength orange with an
 * EMOM stapled to the bottom, which reads as the app ignoring every answer they
 * just gave.
 *
 * So a draft holding lifts is now a fork rather than an assumption, and the
 * finisher survives as the thing you can explicitly ask for. An empty draft
 * still needs no question, because there is nothing to collide with.
 */
function runConditioning() {
  const blocks = conditioningBlocksFrom(condState());
  if (!blocks) return;

  const lifts = sessionExercises().length;
  if (!lifts) {
    applyConditioning(blocks, true);
    return;
  }

  const name = sessionTitle(state.session);
  choiceSheet({
    title: t('cond.attachTitle'),
    body: tp('cond.attachBody', lifts, { name }),
    choices: [
      {
        label: t('cond.attachAlone'),
        sub: t('cond.attachAloneSub', { name }),
        primary: true,
        onPick: () => applyConditioning(blocks, true),
      },
      {
        label: t('cond.attachFinisher', { name }),
        sub: t('cond.attachFinisherSub'),
        onPick: () => applyConditioning(blocks, false),
      },
    ],
    cancelLabel: t('custom.cancel'),
  });
}

/**
 * `standalone` starts a fresh session rather than clearing the draft's lifts,
 * so the old workout is replaced whole rather than half-emptied -- a session
 * keeping its name, goal and budgets while losing its exercises is a workout
 * that no longer matches its own title.
 */
function applyConditioning(blocks, standalone) {
  if (standalone) state.session = blankSession();
  state.session.conditioning = { blocks };
  saveDraft();

  state.freshQuick = true;
  go('plan');
  setTimeout(() => {
    state.freshQuick = false;
  }, 1600);
}

/* ------------------------------------------------------ building one by hand

   The generator answers "give me something"; this answers "give me this". They
   produce the same block, which is the point: a generated workout can be opened
   here and fixed, so the two are one feature rather than two paths that both
   have to be complete on their own.

   What the editor owns is what someone actually has an opinion about -- the
   shape, how long, which movements, how many of each. What it does not own is
   the structural arithmetic: rounds, work and rest are derived by
   `assembleConditioningBlock` exactly as they are for a generated block, so the
   plan and the clock cannot disagree about a hand-built workout either.
   ------------------------------------------------------------------------ */

/**
 * Open the editor on a block, or on a blank one.
 *
 * `index` is where it will land in `session.conditioning.blocks`; past the end
 * means appending, which is how "add another block" works without a second
 * code path.
 */
function editConditioning(index = 0) {
  const blocks = conditioningBlocks();
  const existing = blocks[index];

  state.condEdit = {
    index,
    isNew: !existing,
    format: existing?.format || 'emom',
    minutes: existing?.minutes || 10,
    rounds: existing?.rounds || 3,
    intervalShape:
      INTERVAL_SHAPES.find((s) => s.work === existing?.work && s.rest === existing?.rest) ||
      INTERVAL_SHAPES[1],
    // A copy: backing out of the editor has to leave the block as it was.
    movements: JSON.parse(JSON.stringify(existing?.movements || [])),
    partner: existing?.partner ? { ...existing.partner } : null,
    picking: false,
    query: '',
  };
  go('condedit');
}

function condEditState() {
  return state.condEdit;
}

function setCondEdit(patch) {
  state.condEdit = { ...state.condEdit, ...patch };
  render();
}

/** The block as it currently stands, so the editor can show what it will be. */
function condEditPreview() {
  const e = condEditState();
  return assembleConditioningBlock({
    format: e.format,
    minutes: e.minutes,
    rounds: e.rounds,
    movements: e.movements,
    partner: e.partner,
    intervalShape: e.intervalShape,
  });
}

function saveCondEdit() {
  const e = condEditState();
  if (!e.movements.length) return;

  const block = condEditPreview();
  block.id = conditioningBlocks()[e.index]?.id || newId();
  // Hand-built blocks carry no `inputs`, which is what removes Re-roll: there
  // is nothing to re-roll to. Editing a generated block drops it for the same
  // reason a hand-edited session stops being "auto-generated" -- shuffling
  // would throw away the choosing you just did.
  const blocks = conditioningBlocks().slice();
  blocks[e.index] = block;

  state.session.conditioning = { blocks: blocks.filter(Boolean) };
  state.condEdit = null;
  saveDraft();
  go('plan');
}

function viewCondEdit() {
  const e = condEditState();
  if (!e) {
    state.screen = 'plan';
    return viewPlan();
  }
  if (e.picking) return condPicker();

  const preview = condEditPreview();
  const colour = formatColor(e.format);

  return h(
    'div.screen',
    { style: `--g:${colour}` },
    h(
      'div.screen-inner',
      { style: 'gap:22px' },
      backLink(t('cond.block'), () => {
        state.condEdit = null;
        go('plan');
      }),
      screenHead(t(e.isNew ? 'cond.editNew' : 'cond.editTitle'), t(`cond.format.${e.format}`)),

      quickSection(
        t('cond.format'),
        cardScroller(
          CONDITIONING_FORMATS,
          e.format,
          'cond.format',
          'cond.formatWhy',
          (key, ev) => pickAccent(ev, formatColor(key), () => setCondEdit({ format: key })),
          formatColor
        )
      ),

      // Tabata has no duration to set: eight rounds of 20/10 is four minutes per
      // movement, and the movement list is what decides how long it takes.
      e.format !== 'tabata' &&
        quickSection(
          t('cond.time'),
          timeScroller(e.minutes, COND_TIMES, (minutes) => {
            state.condEdit.minutes = minutes;
            updateCondPreview();
          })
        ),

      e.format === 'intervals' &&
        quickSection(
          t('cond.shape'),
          h(
            'div.chips',
            INTERVAL_SHAPES.map((s) =>
              h(
                'button.chip',
                {
                  class: e.intervalShape.work === s.work && e.intervalShape.rest === s.rest ? 'is-on' : '',
                  onclick: () => setCondEdit({ intervalShape: s }),
                },
                `${s.work}/${s.rest}`
              )
            )
          )
        ),

      e.format === 'fortime' &&
        quickSection(
          t('cond.rounds'),
          h(
            'div.chips',
            [2, 3, 4, 5, 6].map((n) =>
              h(
                'button.chip',
                { class: e.rounds === n ? 'is-on' : '', onclick: () => setCondEdit({ rounds: n }) },
                String(n)
              )
            )
          )
        ),

      quickSection(
        t('cond.movements'),
        h(
          'div.stack',
          { style: 'gap:9px' },
          e.movements.length
            ? h('div.stack', { style: 'gap:7px' }, e.movements.map((m, i) => condEditRow(m, i)))
            : empty(t('cond.noMovements'), t('cond.noMovementsHint')),
          h(
            'button.btn.btn-block',
            { onclick: () => setCondEdit({ picking: true, query: '' }) },
            icon(ICONS.plus, { size: 15 }),
            t('cond.addMovement')
          )
        )
      ),

      quickSection(
        t('cond.partner'),
        cardScroller(
          COND_PARTNERS,
          e.partner?.mode || 'solo',
          'cond.partner',
          'cond.partnerWhy',
          (key) =>
            setCondEdit({
              partner: key === 'solo' ? null : { mode: key, people: e.partner?.people || 2 },
            })
        )
      ),

      e.partner &&
        quickSection(
          t('cond.people'),
          h(
            'div.chips',
            [2, 3, 4].map((n) =>
              h(
                'button.chip',
                {
                  class: e.partner.people === n ? 'is-on' : '',
                  onclick: () => setCondEdit({ partner: { ...e.partner, people: n } }),
                },
                String(n)
              )
            )
          )
        ),

      // What it will actually be, in the words the plan will use. A hand-built
      // block is exactly where the derived numbers surprise you -- a Tabata of
      // three movements is twelve minutes however long you asked for.
      h(
        'div.cond-preview',
        h('span.cond-preview-label', t('cond.willBe')),
        h('span.cond-preview-text', preview.movements.length ? condMeta(preview) : t('cond.willBeEmpty'))
      )
    ),
    h(
      'div.sticky-actions',
      h(
        'button.btn.btn-goal.btn-lg.btn-block',
        { disabled: !e.movements.length, onclick: saveCondEdit },
        t('cond.saveBlock')
      )
    )
  );
}

/** Keep the preview line honest while the time strip is scrolling. */
function updateCondPreview() {
  const node = document.querySelector('.cond-preview-text');
  if (!node) return;
  const preview = condEditPreview();
  node.textContent = preview.movements.length ? condMeta(preview) : t('cond.willBeEmpty');
}

/**
 * One movement in the block being built: what it is, and how much of it.
 *
 * The amount is stepped rather than typed. Every unit here has its own sensible
 * grain -- reps go up by one, calories by one, metres by ten, seconds by five --
 * and a keyboard for a number you are nudging is three taps too many.
 */
function condEditRow(movement, index) {
  const e = condEditState();
  const ex = state.catalog.byId.get(movement.ref);
  const step = movement.unit === 'metres' ? 10 : movement.unit === 'seconds' ? 5 : 1;

  const bump = (delta) => {
    const next = Math.max(step, movement.amount + delta * step);
    e.movements[index] = { ...movement, amount: next };
    render();
  };

  return h(
    'div.cond-edit-row',
    h(
      'span.cond-edit-main',
      h('span.cond-edit-name', localized(ex?.name) || '—'),
      h('span.cond-edit-unit', t(`cond.unit.${movement.unit}`))
    ),
    h(
      'span.cond-edit-amount',
      h('button.stepper-btn', { onclick: () => bump(-1), 'aria-label': t('cond.less') }, '−'),
      h('span.cond-edit-value', String(movement.amount)),
      h('button.stepper-btn', { onclick: () => bump(1), 'aria-label': t('cond.more') }, '+')
    ),
    h(
      'button.icon-btn',
      {
        'aria-label': t('cond.removeMovement'),
        onclick: () => {
          e.movements.splice(index, 1);
          render();
        },
      },
      icon(ICONS.trash, { size: 14 })
    )
  );
}

/**
 * The movement picker.
 *
 * Everything conditioning can use, whatever kit it needs -- unlike the
 * generator, which is asked what is to hand. Someone building by hand is
 * looking at the gym they are standing in, and filtering their own choices out
 * from under them would be the app arguing with what it can see.
 */
function condPicker() {
  const e = condEditState();
  if (e.creating) return condCustomForm();

  const f = e.filters || {};

  const search = h('input.input', {
    type: 'search',
    placeholder: t('cond.searchMovements'),
    value: e.query || '',
    oninput: (ev) => {
      // Written straight to state without a render, so the field keeps focus and
      // the caret while the list below filters.
      state.condEdit.query = ev.target.value;
      refreshPickerList();
    },
  });

  // Filters that answer the questions actually asked at this point: what can I
  // reach, and what do I want to work. Tier is here too because "show me the
  // simple ones" is the other real question, and it is the one a beginner asks.
  const filterRow = (key, values, labelFor) =>
    h(
      'div.filter-rail',
      h(
        'button.chip.chip-sm',
        { class: !f[key] ? 'is-on' : '', onclick: () => setCondFilter(key, null) },
        t('cond.filterAll')
      ),
      values.map((v) =>
        h(
          'button.chip.chip-sm',
          { class: f[key] === v ? 'is-on' : '', onclick: () => setCondFilter(key, v) },
          labelFor ? labelFor(v) : v
        )
      )
    );

  // Built inline rather than deferred to the frame after mount. Filter chips go
  // through render(), so the list they produce should exist by the time render
  // returns -- waiting on a frame makes the list depend on rAF actually firing,
  // and a filtered list that arrives late reads as a filter that found nothing.
  const chosen = new Set(e.movements.map((m) => m.ref));
  const pool = condPickerPool();

  return h(
    'div.screen',
    { style: `--g:${formatColor(e.format)}` },
    h(
      'div.screen-inner',
      { style: 'gap:14px' },
      backLink(t('cond.editTitle'), () => setCondEdit({ picking: false, query: '' })),
      screenHead(t('cond.addMovement'), t('cond.pickerTitle')),
      search,
      h(
        'div.stack',
        { style: 'gap:7px' },
        filterRow('kit', COND_KITS, (k) => t(`cond.kit.${k}`)),
        filterRow('muscle', condMuscles()),
        filterRow('tier', COMPLEXITY_LEVELS, (v) => t(`quick.level.${v}`))
      ),
      h(
        'div.pick-count',
        { id: 'cond-picker-count' },
        pool.length ? tp('cond.matchCount', pool.length) : t('cond.noMatches')
      ),
      h(
        'div.rows-boxed',
        { id: 'cond-picker-list' },
        pool.map((ex) => condPickerRow(ex, chosen.has(ex.id), () => addCondMovement(ex)))
      ),
      // Offered here rather than buried in the Library, because "it is not in
      // the list" is a thought you have while looking at the list.
      h(
        'button.btn.btn-block',
        { onclick: () => setCondEdit({ creating: true, draft: blankCondCustom() }) },
        icon(ICONS.plus, { size: 15 }),
        t('cond.createOwn')
      )
    )
  );
}

/** Every muscle any conditioning movement names, primary or supporting. */
function condMuscles() {
  const set = new Set();
  for (const ex of state.catalog.conditioningPool) {
    if (ex.primary) set.add(ex.primary);
    for (const m of ex.secondary || []) set.add(m);
  }
  return [...set].sort();
}

function setCondFilter(key, value) {
  const e = condEditState();
  e.filters = { ...(e.filters || {}), [key]: value };
  render();
}

/** The pool as the filters and the search leave it. */
function condPickerPool() {
  const e = condEditState();
  const q = (e.query || '').trim().toLowerCase();
  const f = e.filters || {};

  return state.catalog.conditioningPool
    .filter((ex) => !ex.archived)
    .filter((ex) => !q || localized(ex.name).toLowerCase().includes(q))
    .filter((ex) => {
      const cond = state.catalog.conditioningOf(ex);
      if (f.kit && cond.kit !== f.kit) return false;
      if (f.tier && cond.tier !== f.tier) return false;
      // Primary or supporting: someone filtering for Core wants the movements
      // that hammer it as a side effect too, which is most of them.
      if (f.muscle && ex.primary !== f.muscle && !(ex.secondary || []).includes(f.muscle)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => localized(a.name).localeCompare(localized(b.name)));
}

function condPickerRow(ex, already, onPick) {
  const cond = state.catalog.conditioningOf(ex);
  return h(
    'button.pick-row',
    { onclick: onPick },
    h(
      'span.pick-main',
      h(
        'span.pick-name',
        localized(ex.name),
        ex.custom && h('span.pick-badge', t('cond.yours'))
      ),
      h(
        'span.pick-meta',
        `${t(`cond.kit.${cond.kit}`)} · ${t(`cond.unit.${cond.unit}`)}${already ? ` · ${t('cond.alreadyIn')}` : ''}`
      ),
      // What it actually works, which is the question the muscle filter above
      // is asking and the one a movement name only half answers.
      muscleLine(ex)
    ),
    icon(ICONS.plus, { size: 15 })
  );
}

function addCondMovement(ex) {
  const e = condEditState();
  const cond = state.catalog.conditioningOf(ex);
  e.movements.push({
    ref: ex.id,
    amount: defaultAmountFor(cond, e.format),
    unit: cond.unit,
    pace: cond.pace,
  });
  setCondEdit({ picking: false, query: '' });
}

/**
 * Refilter in place for the search box only.
 *
 * The filter chips go through `render()` and rebuild the whole screen, which is
 * fine — nothing on it holds focus. The search field does, and re-rendering it
 * mid-word would take the caret with it, so typing patches the list underneath
 * and leaves the input alone.
 */
function refreshPickerList() {
  const list = document.getElementById('cond-picker-list');
  if (!list) return;

  const e = condEditState();
  const chosen = new Set(e.movements.map((m) => m.ref));
  const pool = condPickerPool();

  mount(list, pool.map((ex) => condPickerRow(ex, chosen.has(ex.id), () => addCondMovement(ex))));

  const count = document.getElementById('cond-picker-count');
  if (count) {
    count.textContent = pool.length
      ? tp('cond.matchCount', pool.length)
      : t('cond.noMatches');
  }
}

/* ------------------------------------------------- movements of one's own

   The compendium is a lifting compendium and the conditioning file is 22 rows
   long, so "it is not in the list" is a thought people will have. A custom
   conditioning movement needs no engine support at all: `conditioningOf` reads
   `mode`, `unit`, `pace` and `kit` straight off the row, and `indexComplexity`
   already believes a row that states its own tier.
   ------------------------------------------------------------------------ */

function blankCondCustom() {
  return {
    name: '',
    unit: 'reps',
    pace: 15,
    kit: 'bodyweight',
    tier: 'basic',
    impact: 'low',
    primary: '',
    secondary: [],
    how: '',
    error: null,
  };
}

/**
 * The form.
 *
 * `pace` is the one field that could have been jargon -- "units per minute at a
 * hard but repeatable effort" is exactly right and exactly unanswerable. Asked
 * as "how many in a minute, going hard?" it is the same number and a question
 * anyone can answer about a movement they already do.
 */
function condCustomForm() {
  const e = condEditState();
  const d = e.draft;
  const v = state.catalog.vocabulary;

  const set = (patch) => {
    state.condEdit.draft = { ...d, ...patch, error: null };
    render();
  };

  const chips = (key, values, labelFor) =>
    h(
      'div.filter-rail',
      values.map((val) =>
        h(
          'button.chip.chip-sm',
          { class: d[key] === val ? 'is-on' : '', onclick: () => set({ [key]: val }) },
          labelFor ? labelFor(val) : val
        )
      )
    );

  return h(
    'div.screen',
    { style: `--g:${formatColor(e.format)}` },
    h(
      'div.screen-inner',
      { style: 'gap:18px' },
      backLink(t('cond.pickerTitle'), () => setCondEdit({ creating: false, draft: null })),
      screenHead(t('cond.createOwn'), t('cond.createTitle')),

      d.error && h('p.form-error', d.error),

      field(
        t('custom.name'),
        h('input.input', {
          value: d.name,
          placeholder: t('cond.namePlaceholder'),
          oninput: (ev) => (state.condEdit.draft.name = ev.target.value),
        })
      ),

      field(t('cond.measuredIn'), chips('unit', ['reps', 'calories', 'metres', 'seconds'], (u) => t(`cond.unit.${u}`))),

      // Seconds are their own answer: a minute of a movement measured in
      // seconds is sixty seconds, so asking would be asking a question with
      // one possible reply.
      d.unit !== 'seconds' &&
        field(
          t('cond.paceQuestion', { unit: t(`cond.unit.${d.unit}`) }),
          h(
            'div.stepper',
            h('span.stepper-label', t(`cond.unit.${d.unit}`)),
            h('button.stepper-btn', { onclick: () => set({ pace: Math.max(1, d.pace - condPaceStep(d.unit)) }) }, '−'),
            h('span.cond-edit-value', String(d.pace)),
            h('button.stepper-btn', { onclick: () => set({ pace: d.pace + condPaceStep(d.unit) }) }, '+')
          ),
          t('cond.paceHint')
        ),

      field(t('cond.kit'), chips('kit', COND_KITS, (k) => t(`cond.kit.${k}`))),
      field(t('library.primary'), chips('primary', v.muscles)),

      field(
        t('map.supporting'),
        h(
          'div.filter-rail',
          v.muscles
            .filter((m) => m !== d.primary)
            .map((m) =>
              h(
                'button.chip.chip-sm',
                {
                  class: d.secondary.includes(m) ? 'is-on' : '',
                  onclick: () =>
                    set({
                      secondary: d.secondary.includes(m)
                        ? d.secondary.filter((x) => x !== m)
                        : [...d.secondary, m],
                    }),
                },
                m
              )
            )
        )
      ),

      field(t('cond.complexity'), chips('tier', COMPLEXITY_LEVELS, (x) => t(`quick.level.${x}`))),
      field(t('cond.impact'), chips('impact', ['low', 'medium', 'high'], (x) => t(`cond.impact.${x}`))),

      field(
        t('cond.howTo'),
        h('textarea.input', {
          rows: '3',
          value: d.how,
          placeholder: t('cond.howPlaceholder'),
          oninput: (ev) => (state.condEdit.draft.how = ev.target.value),
        }),
        t('cond.howHint')
      )
    ),
    h(
      'div.sticky-actions',
      h('button.btn.btn-goal.btn-lg.btn-block', { onclick: saveCondCustom }, t('cond.createSave'))
    )
  );
}

/** Calories and reps move by one; metres by ten, because nobody runs 141 m. */
function condPaceStep(unit) {
  return unit === 'metres' ? 10 : 1;
}

function saveCondCustom() {
  const e = condEditState();
  const d = e.draft;
  const name = (d.name || '').trim();

  const missing = [
    !name && t('custom.name'),
    !d.primary && t('library.primary'),
  ].filter(Boolean);

  if (missing.length) {
    state.condEdit.draft = { ...d, error: t('custom.missing', { fields: missing.join(', ') }) };
    render();
    return;
  }

  const record = {
    id: `u${newId()}`,
    name: { en: name, sv: '' },
    // Conditioning rows are catalog rows like any other, so they need the
    // fields the rest of the app reads off an exercise -- the warm-up builder
    // triggers on `pattern`, the body map on `primary` and `secondary`.
    equipment: d.kit === 'erg' ? 'Erg' : 'Bodyweight',
    pattern: 'Monostructural',
    profile: 'Conditioning',
    primary: d.primary,
    secondary: (d.secondary || []).filter((m) => m !== d.primary),
    mode: 'conditioning',
    unit: d.unit,
    pace: d.unit === 'seconds' ? 60 : Math.max(1, d.pace),
    kit: d.kit,
    tier: d.tier,
    impact: d.impact,
    how: { en: (d.how || '').trim(), sv: null },
    cue: '',
    custom: true,
    archived: false,
  };

  state.customExercises.push(record);
  saveCustomExercises();

  // Straight into the block being built: creating it here means you wanted it
  // here, and making you find it again in the list you just left is a step for
  // the app's benefit rather than yours.
  state.condEdit.creating = false;
  state.condEdit.draft = null;
  const added = state.catalog.byId.get(record.id);
  if (added) addCondMovement(added);
  else setCondEdit({ picking: false });
  flash(t('custom.created'));
}

/** Re-roll the whole conditioning workout on the same inputs. */
function reshuffleConditioning() {
  const inputs = state.session.conditioning?.blocks?.[0]?.inputs;
  if (!inputs) return;

  const blocks = conditioningBlocksFrom(inputs);
  if (!blocks) return;

  state.session.conditioning = { blocks };
  saveDraft();
  render();
}

/**
 * The four goals as cards you scroll through, not four small pills.
 *
 * Pills gave each goal a word and nothing else, which is fine once you know
 * what the words mean and useless before that — and this screen is the one a
 * beginner reaches for. A card has room for the sentence that explains it and
 * for the numbers it will actually prescribe, so the choice can be made by
 * reading rather than by guessing.
 *
 * Side-scrolling rather than a stack of four: the section is one of six on
 * this screen, and four full-width cards would push the time picker and the
 * complexity control off the bottom.
 */
function focusScroller(current, onPick) {
  const scroller = h(
    'div.focus-scroller',
    { role: 'radiogroup', 'aria-label': t('quick.focus') },
    state.catalog.vocabulary.goals.map((goal) => {
      const on = goal === current;
      const p = getPrescription(state.catalog.prescriptionIndex, REPRESENTATIVE_PROFILE, goal);

      return h(
        'button.focus-card',
        {
          class: on ? 'is-on' : '',
          style: `--gc:${GOAL_COLOR[goal]}`,
          role: 'radio',
          'aria-checked': String(on),
          onclick: (e) => onPick(e, goal),
        },
        // No swatch beside the name: the card is already tinted its own colour
        // when chosen and the name carries it, so a dot was a legend for
        // something the card was saying twice over.
        h('span.focus-name', goalLabel(goal)),
        h('span.focus-blurb', t(`goal.blurb.${goal}`)),
        // The prescription for a heavy compound, which is what makes the
        // difference between the goals concrete: "3–4 × 8–12 at 70–80%" says
        // more than "Hypertrophy" ever will.
        p &&
          h(
            'span.focus-figures',
            `${p.sets} × ${p.reps}`,
            h('span.focus-sep', '·'),
            p.load.replace(/ of 1RM$/, '')
          )
      );
    })
  );

  return holdScroll(scroller, 'goal', current);
}

/**
 * Keep a card row where the user left it across a re-render.
 *
 * Choosing a card re-renders, which builds a fresh scroller parked at the start
 * -- so tapping Endurance sent the row snapping back to Explosive and the card
 * you just picked out of sight. The position is held in state and put back on
 * the frame after the new element is in the document, since `scrollLeft` does
 * nothing on a node that is not laid out yet.
 *
 * Keyed, because this screen has two of these rows and one shared position sent
 * the partner row jumping whenever a shape was picked. Every scroller needs its
 * own memory or they fight over one.
 */
function holdScroll(scroller, key, selection = null) {
  state.scrollPos = state.scrollPos || {};
  state.scrollSel = state.scrollSel || {};

  // Whether this row's own selection changed on this render. Every render
  // rebuilds every scroller on the screen, so without this the partner row got
  // re-examined -- and re-nudged -- each time a shape was picked, which is the
  // jumping this whole function exists to stop, just one row over.
  const changed = selection !== null && state.scrollSel[key] !== selection;
  state.scrollSel[key] = selection;

  scroller.addEventListener('scroll', () => {
    state.scrollPos[key] = scroller.scrollLeft;
  });

  requestAnimationFrame(() => {
    scroller.scrollLeft = state.scrollPos[key] || 0;

    // ...but arriving unable to see which card is selected is its own problem.
    // If the chosen card is mostly out of view, bring it in -- on arrival, or
    // when this row's selection actually moved. The visibility test is generous
    // on purpose: nudging a card that is merely clipped at the edge would
    // reintroduce the jump, so only a card genuinely off screen moves.
    if (selection !== null && !changed) return;

    const chosen = scroller.querySelector('.focus-card.is-on');
    if (!chosen) return;

    const card = chosen.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const visible = Math.min(card.right, view.right) - Math.max(card.left, view.left);

    if (visible < card.width * 0.6) {
      chosen.scrollIntoView({ inline: 'center', block: 'nearest' });
      state.scrollPos[key] = scroller.scrollLeft;
    }
  });

  return scroller;
}

/* ------------------------------------------------------------ accent pulse

   Choosing a goal repaints the whole app, because `--g` drives every
   interactive surface. Snapping between two saturated colours is abrupt and
   says nothing about what caused it, so the new colour arrives as a wave from
   wherever you pressed.

   Two halves, and both are needed:

     the pulse    a circle in the new colour, expanding from the press point,
                  behind the content -- it sits above the app's flat ground
                  and below `.screen`, so it washes through the cards rather
                  than over them

     the repaint  each element changes colour as the wave front reaches it,
                  not when the wave starts

   The second half is the whole point and the first attempt got it wrong: it
   cross-faded everything at once, so the colour was already changing across
   the entire screen while the circle was still small. The wave has to arrive
   somewhere before that place changes.

   Each element is given a `transition-delay` of its own distance from the
   press, divided by the wave's speed. That means the pulse expands *linearly*
   -- a constant speed makes delay directly proportional to distance, and an
   eased radius would need the inverse of the easing curve to stay in step.
   The opacity is eased separately inside the keyframes, so the wave still
   softens as it goes without the radius lying about where the front is.

   The new accent is applied a frame *after* the delays are in place, because a
   transition only runs if the property was already being watched when the
   value changed. Rendering with the new colour and then adding transitions
   would repaint instantly and leave the wave chasing something that had
   already happened.

   The repaint transition is switched on for the duration and then switched
   off again. Leaving it on permanently would put a fade on every hover in the
   app, which is the opposite of responsive.
   ------------------------------------------------------------------------ */

const PULSE_MS = 760;
/** How long any one element takes to change once the wave gets to it. */
const REPAINT_MS = 320;

/** Where the press happened, falling back to the control's centre for keys. */
function pressPoint(event) {
  const rect = event.currentTarget.getBoundingClientRect();

  // A keyboard-activated click reports detail 0 and coordinates of 0,0, which
  // would fire the pulse from the top-left corner of the screen.
  const keyed = !event.detail || (!event.clientX && !event.clientY);
  const x = keyed ? rect.left + rect.width / 2 : event.clientX;
  const y = keyed ? rect.top + rect.height / 2 : event.clientY;

  // Clamped, because a card inside a horizontal scroller can be activated
  // while sitting outside the viewport -- the wave would then start off-screen
  // and arrive as a wash with no visible origin.
  const clamp = (v, max) => Math.max(0, Math.min(v, max));
  return { x: clamp(x, window.innerWidth), y: clamp(y, window.innerHeight) };
}

/**
 * Apply a goal change and paint it outward from the press.
 *
 * `apply` does the state change and the re-render; the pulse is appended
 * afterwards, because render() replaces the whole app subtree and would take
 * the element with it.
 */
function pickGoal(event, goal, apply) {
  return pickAccent(event, GOAL_COLOR[goal], apply);
}

/**
 * The same wave, driven by a colour rather than a goal.
 *
 * Conditioning shapes repaint the screen exactly as goals do but are not goals
 * and have no entry in `GOAL_COLOR`, so the colour is the parameter and the
 * goal lookup moves out to the one caller that needs it.
 */
function pickAccent(event, colour, apply) {
  const from = pressPoint(event);
  const before = document.querySelector('.app')?.style.getPropertyValue('--g');

  apply();

  const app = document.querySelector('.app');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!app || reduced || !before) return;

  // Hold the old accent for a beat. `apply` has already re-rendered with the
  // new one, and letting that stand would repaint the screen before the wave
  // had gone anywhere.
  app.style.setProperty('--g', before);

  // Reach the furthest corner, or the wave stops short of the screen edge.
  const radius = Math.hypot(
    Math.max(from.x, window.innerWidth - from.x),
    Math.max(from.y, window.innerHeight - from.y)
  );

  app.classList.add('is-repainting');
  staggerRepaint(app, from, radius);

  app.appendChild(
    h('span.accent-pulse', {
      style: `--px:${from.x}px;--py:${from.y}px;--pr:${radius}px;--pc:${colour};--pulse-ms:${PULSE_MS}ms`,
    })
  );

  // Two frames: one for the old accent and the delays to be committed, the
  // next to change the value. Setting both in the same frame is a single
  // style change with nothing to transition from.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => app.style.setProperty('--g', colour));
  });

  // Timers rather than animationend: a suppressed animation must still leave
  // the app repaint-free and the element removed.
  setTimeout(() => clearRepaint(), PULSE_MS + REPAINT_MS + 120);
}

/**
 * Delay every element's colour change by when the wave reaches it.
 *
 * Distance from the press point over the wave's speed. Elements beyond the
 * furthest corner cannot exist, but the clamp is there anyway so a stray
 * measurement can never park an element past the end of the animation and
 * leave it stuck on the old colour.
 *
 * All the reads happen before any of the writes, so this costs one layout
 * rather than one per element.
 */
function staggerRepaint(app, from, radius) {
  const nodes = [...app.querySelectorAll('*')];
  const delays = nodes.map((node) => {
    const r = node.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    const d = Math.hypot(r.left + r.width / 2 - from.x, r.top + r.height / 2 - from.y);
    return Math.round((Math.min(d, radius) / radius) * PULSE_MS);
  });

  nodes.forEach((node, i) => {
    if (delays[i] != null) node.style.transitionDelay = `${delays[i]}ms`;
  });
}

function clearRepaint() {
  const app = document.querySelector('.app');
  if (!app) return;
  app.querySelector('.accent-pulse')?.remove();
  app.classList.remove('is-repainting');
  for (const node of app.querySelectorAll('[style*="transition-delay"]')) {
    node.style.transitionDelay = '';
  }
}

function quickBudget(key, options, q) {
  return h(
    'div.chips',
    options.map((value) =>
      h(
        'button.chip',
        {
          class: q[key] === value ? 'is-on' : '',
          'aria-pressed': String(q[key] === value),
          onclick: () => setQuick({ [key]: value }),
        },
        value === 0 ? t('build.skip') : `${value} ${t('units.min')}`
      )
    )
  );
}

const samePreset = (a, b) => a.length === b.length && b.every((m) => a.includes(m));

/**
 * The time picker.
 *
 * A horizontal scroll-snap strip rather than a row of chips, because the range
 * is 15 to 120 in fives and twenty-two chips is not a control, it is a wall.
 * Scrolling picks; tapping also picks and scrolls the choice to the middle.
 *
 * It updates its own readout and selection in place and never calls render():
 * re-rendering mid-scroll would replace the element being scrolled and the
 * momentum would die under the user's thumb.
 */
/**
 * The scrolling minute strip.
 *
 * `values` and `onSettle` are parameters rather than the hard-wired quick-workout
 * ones, because conditioning asks the same question over a much shorter range --
 * nobody does a ninety-minute AMRAP -- and reimplementing scroll-snap, the
 * centre-detection and the settle timer for a second range would be two copies
 * of the fiddliest control in the app.
 */
function timeScroller(current, values = QUICK_TIMES, onSettle = null) {
  const readout = h('div.time-readout', h('span.time-value', String(current)), h('span.time-unit', t('units.min')));
  const strip = h('div.time-strip', { role: 'group', 'aria-label': t('quick.time') });

  const items = values.map((value) =>
    h(
      'button.time-tick',
      {
        class: value === current ? 'is-on' : '',
        dataset: { value: String(value) },
        'aria-pressed': String(value === current),
        onclick: () => select(value, true),
      },
      String(value)
    )
  );

  mount(strip, items);

  let settled = current;

  function paint(value) {
    if (value === settled) return;
    settled = value;
    readout.querySelector('.time-value').textContent = String(value);
    for (const item of items) {
      const on = Number(item.dataset.value) === value;
      item.classList.toggle('is-on', on);
      item.setAttribute('aria-pressed', String(on));
    }
    // Written straight through without a re-render, for the reason above.
    if (onSettle) {
      onSettle(value);
      return;
    }
    setQuick({ minutes: value }, { rerender: false });
    updateSplit(value);
  }

  function select(value, scroll) {
    paint(value);
    if (!scroll) return;
    const item = items.find((i) => Number(i.dataset.value) === value);
    item?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  // Whichever tick is nearest the middle of the strip is the selection.
  let timer = null;
  strip.addEventListener('scroll', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const box = strip.getBoundingClientRect();
      const mid = box.left + box.width / 2;
      let best = null;
      let bestDist = Infinity;
      for (const item of items) {
        const r = item.getBoundingClientRect();
        const d = Math.abs(r.left + r.width / 2 - mid);
        if (d < bestDist) {
          bestDist = d;
          best = item;
        }
      }
      if (best) paint(Number(best.dataset.value));
    }, 110);
  });

  // Centre the current value on entry. Instant, not smooth: an animated scroll
  // on arrival reads as the screen still loading.
  requestAnimationFrame(() => {
    const item = items.find((i) => Number(i.dataset.value) === current);
    if (item) strip.scrollLeft = item.offsetLeft - strip.clientWidth / 2 + item.offsetWidth / 2;
  });

  return h('div.time-picker', readout, h('div.time-strip-wrap', strip, h('span.time-marker')));
}

/** Keep the total/warm-up/lifting line honest while the strip is scrolling. */
function updateSplit(minutes) {
  const q = quickState();
  const row = document.querySelector('.quick-split');
  if (!row) return;
  const main = minutes - q.warmupBudget - q.cooldownBudget;
  const spans = row.querySelectorAll('span:not(.quick-split-sep)');
  if (spans[0]) spans[0].textContent = t('quick.splitTotal', { n: minutes });
  if (spans[2]) {
    spans[2].textContent = t('quick.splitMain', { n: Math.max(0, main) });
    spans[2].classList.toggle('is-short', main <= 0);
  }
  const button = document.querySelector('.sticky-actions .btn-goal');
  if (button) button.disabled = main <= 0;
}

/**
 * Generate, then hand the result to Plan.
 *
 * Plan already renders a session properly -- warm-up, loads, body map, the
 * lot -- so there is nothing for this feature to invent. It writes the draft
 * and navigates, and Plan cannot tell the session was not built by hand except
 * for the `quick` block that lets it offer a shuffle.
 */
function runQuick() {
  // Read the inputs now rather than trusting a closure. `setQuick` replaces
  // the object rather than mutating it, so a reference taken during render
  // still points at the values as they were then.
  const q = quickState();

  const apply = () => {
    const result = buildQuickSession(q, Math.floor(Math.random() * 2 ** 31));
    if (result.shortfall) {
      flash(t('quick.nothingFits'));
      return;
    }
    // No flash afterwards: the reveal has already said what happened, and a
    // second announcement would re-render the plan and restart its entrance.
    quickReveal(q, result, () => {
      state.freshQuick = true;
      go('plan');
      // Cleared without rendering — the class has done its work by now, and
      // re-rendering to remove it would replay the animation it just finished.
      setTimeout(() => {
        state.freshQuick = false;
      }, 1600);
    });
  };

  const draftHasLifts = (state.session.exerciseIds || []).length > 0;
  if (!draftHasLifts) {
    apply();
    return;
  }

  confirmSheet({
    title: t('quick.replaceTitle'),
    body: tp('quick.replaceBody', state.session.exerciseIds.length, {
      name: sessionTitle(state.session),
    }),
    confirmLabel: t('quick.replaceConfirm'),
    cancelLabel: t('custom.cancel'),
    onConfirm: apply,
  });
}

/**
 * The moment between pressing Generate and seeing the plan.
 *
 * Quick workout produces a session that looks exactly like one you built by
 * hand, which is the point — but it means the only signal that something was
 * decided for you is a screen change. This is that signal: an overlay in the
 * goal colour naming what it did, in the order it did it, ending on the shape
 * of the result.
 *
 * The steps are not fake progress. They are the real stages, and the counts
 * are read off the finished result, so nothing here claims work that did not
 * happen. It is short — under a second and a bit — because it sits between the
 * user and the thing they asked for, and a delay you notice twice is a delay
 * that has outstayed its welcome.
 */
/**
 * Reveal timing, in milliseconds. One place, because the CSS delays and the
 * teardown timer have to agree or the overlay leaves mid-sentence.
 *
 *   first  when the first step appears
 *   gap    between steps -- long enough to read six or seven words
 *   result when the count lands, one gap after the last step
 *   hold   how long the finished state sits there before it starts leaving
 *   leave  the fade
 */
const REVEAL = { first: 180, gap: 620, hold: 900, leave: 260 };
const revealResultAt = (steps) => REVEAL.first + steps * REVEAL.gap;
const revealTotal = (steps) => revealResultAt(steps) + REVEAL.hold;

function quickReveal(q, result, done) {
  // Someone who has asked for less motion has asked for less of exactly this.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    done();
    flash(tp('quick.generated', result.exerciseIds.length));
    return;
  }

  const built = buildSession(state.session, state.catalog, state.oneRm);
  const lines = [
    t('quick.reveal.pool', { n: state.catalog.liftingPool.filter((e) => !e.archived).length }),
    q.muscles.length
      ? t('quick.reveal.picking', { groups: q.muscles.slice(0, 3).join(', ') })
      : t('quick.reveal.pickingAny'),
    t('quick.reveal.warmup', { n: built.warmup.items.length }),
  ];

  // Paced to be read, not just seen. Each line needs to land, be recognised as
  // words and understood before the next one moves; 170ms apart was a flicker
  // that only registered as "something happened".
  const steps = lines.map((line, i) =>
    h('div.reveal-step', { style: `animation-delay:${REVEAL.first + i * REVEAL.gap}ms` }, line)
  );

  const overlay = h(
    'div.quick-reveal',
    { style: `--g:${GOAL_COLOR[q.goal] || 'var(--home-accent)'}`, role: 'status', 'aria-live': 'polite' },
    h(
      'div.reveal-inner',
      h('span.reveal-orb', icon(ICONS.spark, { size: 26 })),
      h('div.reveal-steps', steps),
      h(
        'div.reveal-result',
        { style: `animation-delay:${revealResultAt(lines.length)}ms` },
        h('span.reveal-count', String(result.exerciseIds.length)),
        h(
          'span.reveal-summary',
          tp('quick.reveal.result', result.exerciseIds.length, {
            time: formatMinutes(built.totalMinutes),
          })
        )
      )
    )
  );

  overlay.appendChild(h('span.reveal-skip', t('quick.reveal.skip')));
  document.body.appendChild(overlay);

  // A tap anywhere skips to the end. The pacing is for a first read, and the
  // tenth time you generate a workout you already know what it says.
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    overlay.classList.add('is-leaving');
    setTimeout(() => {
      overlay.remove();
      done();
    }, REVEAL.leave);
  };

  overlay.addEventListener('click', finish);

  // A timer, not an animationend listener: if anything stops the animation
  // running the overlay still has to come down, and a stuck full-screen panel
  // over the app is a far worse failure than a missed flourish.
  setTimeout(finish, revealTotal(lines.length));
}

/** Run the generator and install the result as the draft session. */
function buildQuickSession(q, seed) {
  const result = generateQuickWorkout(
    { ...q, seed },
    state.catalog,
    state.oneRm
  );
  if (result.shortfall) return result;

  state.session = {
    ...blankSession(),
    name: quickName(q),
    goal: q.goal,
    warmupBudget: q.warmupBudget,
    cooldownBudget: q.cooldownBudget,
    exerciseIds: result.exerciseIds,
    // Kept on the session so Plan can shuffle without this screen's state.
    quick: { ...q, seed },
  };
  saveDraft();
  return result;
}

/**
 * A name you would recognise in the saved list a fortnight later. Two groups
 * get named; more than that and it is easier to say how many.
 */
function quickName(q) {
  if (!q.muscles.length) return t('quick.nameFull');
  if (q.muscles.length <= 2) return q.muscles.join(' & ');
  for (const [key, preset] of Object.entries(QUICK_PRESETS)) {
    if (samePreset(q.muscles, preset)) return t(`quick.name.${key}`);
  }
  return t('quick.nameGroups', { n: q.muscles.length });
}

/* ---------------------------------------------------------------- build */

function viewBuild() {
  const exercises = sessionExercises();
  const built = buildSession(state.session, state.catalog, state.oneRm);

  return h(
    'div.screen',
    h(
      'div.screen-inner',
      buildHeader(),
      goalSection(),
      liftsSection(exercises),
      budgetSection('warmupBudget', t('build.warmBudget'), WARM_BUDGETS, built),
      budgetSection('cooldownBudget', t('build.coolBudget'), COOL_BUDGETS)
    ),
    h(
      'div.sticky-actions',
      h(
        'button.btn.btn-goal.btn-lg.btn-block',
        // A draft holding only a conditioning block is a real plan, so the
        // button opens rather than sitting disabled on an empty lift list.
        {
          disabled: !exercises.length && !conditioningBlocks().length,
          onclick: () => go('plan'),
        },
        t('build.generate'),
        h(
          'span',
          { style: 'opacity:.65;font-weight:400' },
          ` ≈ ${formatMinutes(built.totalMinutes + condMinutes())}`
        )
      )
    )
  );
}

/**
 * The session's name is the screen's title.
 *
 * There were two problems stacked on top of each other: an `h1` reading
 * "Build", spending the largest type on the screen restating the tab you just
 * pressed, and a labelled name field costing another 66px directly beneath it
 * — asking you to name a session before you had decided what it was.
 *
 * A name belongs where a title goes. It stays an `<input>` rather than
 * anything cleverer so typing works exactly as it did, and it does not
 * re-render on keystroke, or the caret would jump on every letter.
 */
function buildHeader() {
  return h(
    'div.stack',
    { style: 'gap:1px' },
    h('div.kicker', t('build.kicker')),
    h('input.build-title', {
      type: 'text',
      value: state.session.name,
      placeholder: t('build.namePlaceholder'),
      'aria-label': t('build.name'),
      oninput: (e) => {
        state.session.name = e.target.value;
        saveDraft();
      },
    })
  );
}

/**
 * Goal, as the same scroller the Quick screen uses.
 *
 * It was four stacked full-width cards, the chosen one expanded: 474px, 58% of
 * a phone screen, spent choosing one of four things — and it pushed the lifts,
 * which are what a workout actually is, below the fold. The scroller costs
 * about a third of that.
 *
 * The prescription that used to be inside the expanded card moves below the
 * row, where it is bigger and easier to read than it was crammed into a card,
 * and where it does not have to compete with three collapsed siblings.
 */
function goalSection() {
  const goal = state.session.goal;
  const p = getPrescription(state.catalog.prescriptionIndex, REPRESENTATIVE_PROFILE, goal);

  return h(
    'div.stack',
    { style: 'gap:10px' },
    h('div.kicker', t('build.goal')),
    focusScroller(goal, (e, picked) =>
      pickGoal(e, picked, () => {
        state.session.goal = picked;
        markHandEdited();
        render();
      })
    ),
    p &&
      h(
        'div.goal-detail',
        h(
          'span.figures',
          figure(p.sets, t('figures.sets')),
          figure(p.reps, t('figures.reps')),
          figure(p.load.replace(/ of 1RM$/, ''), t('figures.load')),
          figure(p.rest, t('figures.rest'))
        ),
        h('p.hint', p.note)
      )
  );
}

function figure(value, label) {
  return h('span.figure', h('span.figure-value', value), h('span.figure-label', label));
}

function liftsSection(exercises) {
  return h(
    'div.stack',
    { style: 'gap:8px' },
    h(
      'div',
      { style: 'display:flex;align-items:baseline;justify-content:space-between' },
      h('div.kicker', t('build.lifts')),
      h('div.kicker', t('build.chosen', { n: exercises.length }))
    ),
    exercises.length
      ? h(
          'div.rows-boxed',
          exercises.map((ex) => liftRow(ex)),
          addFromLibraryRow()
        )
      : h(
          'div.stack',
          { style: 'gap:10px' },
          empty(t('build.noLifts'), t('build.noLiftsHint')),
          h('div.rows-boxed', addFromLibraryRow())
        )
  );
}

/**
 * One chosen lift, with its 1RM to hand.
 *
 * The suggested load is a fraction of your 1RM, so a lift without one shows
 * "Enter your 1RM" right where the weight should be — and until now the only
 * place to enter it was the Library, three taps and a screen away from the
 * sentence asking for it. The control is the same stepper the Library uses,
 * writing to the same store, so a number typed here is the number there.
 *
 * Folded away by default, and only offered at all where a 1RM means
 * something: a lift prescribed by bodyweight has no percentage to take.
 *
 * Removal lives on the tick and nowhere else. This row used to be one wide
 * button that dropped the lift wherever you pressed it, including on the words
 * "Enter your 1RM" — which is an instruction, so people followed it and lost
 * the exercise. A destructive action needs its own target, and the text asking
 * for a number should open the field for that number.
 */
function liftRow(ex) {
  const load = loadFor(ex);
  const rm = state.oneRm[ex.id];
  const usesRm = load.kind !== 'bodyweight';
  const open = usesRm && state.buildRmOpen === ex.id;
  const name = localized(ex.name);

  const setRm = (value) => {
    if (value <= 0) delete state.oneRm[ex.id];
    else state.oneRm[ex.id] = value;
    store.setOneRm(state.oneRm);
    render();
  };

  const toggleRm = () => {
    state.buildRmOpen = open ? null : ex.id;
    render();
  };

  const details = [
    h(
      'span.pick-main',
      h('span.pick-name', name),
      h('span.pick-meta', `${ex.profile} · ${ex.primary}`)
    ),
    h('span.pick-load', { class: load.kind === 'no-1rm' ? 'is-missing' : '' }, loadLabel(load)),
  ];

  return [
    h(
      'div.lift-line',
      { class: open ? 'is-open' : '' },
      h(
        'button.lift-tick',
        {
          'aria-label': t('build.remove', { name }),
          title: t('build.remove', { name }),
          onclick: () => {
            state.session.exerciseIds = state.session.exerciseIds.filter((id) => id !== ex.id);
            delete state.session.loads[ex.id];
            if (state.buildRmOpen === ex.id) state.buildRmOpen = null;
            markHandEdited();
            render();
          },
        },
        h('span.tick.tick-square.is-on', icon(ICONS.check, { size: 11, stroke: '#161826' }))
      ),
      // The body of the row opens the 1RM rather than doing nothing, because
      // that is what people were already pressing it for. A bodyweight lift has
      // nothing to open, so it is inert text instead of a dead button.
      usesRm
        ? h(
            'button.lift-main',
            {
              'aria-expanded': String(open),
              'aria-label': `${t('library.oneRm')} — ${name}`,
              title: t('build.setRmFor', { name }),
              onclick: toggleRm,
            },
            details
          )
        : h('div.lift-main.is-static', details),
      usesRm &&
        h(
          'button.icon-btn',
          {
            'aria-expanded': String(open),
            'aria-label': `${t('library.oneRm')} — ${name}`,
            title: t('build.setRmFor', { name }),
            onclick: toggleRm,
          },
          icon(rm ? ICONS.pencil : ICONS.plus, { size: 14 })
        )
    ),
    open &&
      h(
        'div.lift-rm',
        weightStepper(t('library.oneRm'), rm ?? null, setRm, (delta) =>
          setRm(steppedWeight(rm || 0, delta))
        ),
        h('p.hint', t('build.rmHint'))
      ),
  ];
}

function loadLabel(load) {
  if (load.kind === 'no-1rm') return t('load.enterRm');
  if (load.kind === 'bodyweight') return t('load.bodyweight');
  return load.text;
}

function addFromLibraryRow() {
  return h(
    'button.pick-row',
    {
      style: 'color:var(--g);font-weight:500',
      onclick: () => {
        // Start the picker clean. Inheriting a filter left over from browsing
        // lands you on "no exercises match" for a reason that is off-screen.
        state.libPicking = true;
        state.libQuery = '';
        state.libFilters = { equipment: '', pattern: '', primary: '', secondary: '' };
        state.libFiltersOpen = false;
        go('library');
      },
    },
    h('span.pick-main', h('span.pick-name', t('build.addFromLibrary')))
  );
}

function budgetSection(key, label, options, built) {
  return h(
    'div.stack',
    { style: 'gap:8px' },
    h('div.kicker', label),
    h(
      'div.chips',
      options.map((value) =>
        h(
          'button.chip',
          {
            class: state.session[key] === value ? 'is-on' : '',
            'aria-pressed': String(state.session[key] === value),
            onclick: () => {
              state.session[key] = value;
              markHandEdited();
              render();
            },
          },
          value === 0 ? t('build.skip') : `${value} ${t('units.min')}`
        )
      )
    ),
    built &&
      h(
        'p.hint',
        t('build.budgetNote', { count: built.warmup.items.length, minutes: built.warmup.minutes })
      )
  );
}

/* ----------------------------------------------------------------- plan */

function viewPlan() {
  const exercises = sessionExercises();
  const built = buildSession(state.session, state.catalog, state.oneRm);

  // A session with no lifts but a conditioning block is not an empty session --
  // it is a conditioning session, which is exactly what the optional field is
  // for. Only a plan with nothing at all in it is empty.
  const cond = conditioningBlocks();

  if (!exercises.length && !cond.length) {
    return h(
      'div.screen',
      h(
        'div.screen-inner',
        backLink(t('tab.build'), () => go('build')),
        empty(t('plan.empty'), t('plan.emptyHint'))
      )
    );
  }

  return h(
    'div.screen',
    h(
      'div.screen-inner',
      { style: 'gap:24px' },
      h(
        'div.stack',
        { style: 'gap:8px' },
        backLink(t('tab.build'), () => go('build')),
        h(
          'div.plan-title',
          h(
            'div.plan-heading',
            h(
              'h1',
              // A session with no lifts is named by its conditioning, not by
              // whatever the draft was called before. Carrying "Lower body /
              // Strength" over an AMRAP would describe a workout that is not
              // there -- and the goal word is a prescription axis conditioning
              // does not sit on, so the format takes its place.
              exercises.length ? sessionTitle() : t('cond.title'),
              h('br'),
              h(
                'span.goal-word',
                exercises.length
                  ? goalLabel(state.session.goal)
                  : condFormat()
                    ? t(`cond.format.${condFormat()}`)
                    : tp('cond.blockCount', cond.length)
              )
            ),
            // Stays for the life of the session, not just the transition: a
            // week later, in the saved list, "did I choose these or did it?"
            // is a question the plan should still be able to answer.
            state.session.quick &&
              h('span.auto-badge', icon(ICONS.spark, { size: 11 }), t('quick.autoBadge'))
          ),
          h(
            'div.plan-total',
            h('div.plan-total-value', formatMinutes(built.totalMinutes + condMinutes())),
            h('div', { style: 'font-size:11px;color:var(--t-45)' }, t('plan.tolerance'))
          )
        )
      ),

      built.warmup.items.length > 0 &&
        h(
          'div.stack',
          { style: 'gap:10px' },
          phaseHead('warmup', tp('phase.drills', built.warmup.items.length), built.warmup.minutes, {
            explain: true,
          }),
          built.warmup.items.map((d) =>
            drillRow(d.phase.replace(/^\d+\s*/, ''), localized(d.name), d.minutes)
          )
        ),

      exercises.length > 0 &&
        h(
          'div.stack',
          { style: 'gap:10px' },
          phaseHead('main', tp('phase.lifts', built.main.length), built.mainMinutes, {
            explain: true,
          }),
          built.main.map((row, i) => planExerciseCard(row, i))
        ),

      // Before the cool-down, not after it. A finisher is the last hard thing
      // you do, and the cool-down is what brings you down from it -- putting
      // fifteen minutes of EMOM after the mobility work would undo the only
      // job the cool-down has.
      conditioningSection(),

      built.cooldown.items.length > 0 &&
        h(
          'div.stack',
          { style: 'gap:10px' },
          phaseHead('cooldown', tp('phase.moves', built.cooldown.items.length), built.cooldown.minutes, {
            explain: true,
          }),
          built.cooldown.items.map((m) => drillRow(m.type, localized(m.name), m.minutes))
        ),

      // Conditioning movements are catalog rows with `primary` and `secondary`
      // like any other, so a workout of nothing but conditioning has a perfectly
      // good answer to "what does this train" -- it just was not being asked.
      // The map reads whichever the session actually contains.
      (exercises.length > 0 || cond.length > 0) &&
        bodyMapSection(exercises.length ? exercises : condMovementExercises())
    ),
    h(
      'div.sticky-actions',
      // Only for a generated session: shuffling a workout someone assembled by
      // hand would throw away the choosing they came here to do.
      state.session.quick &&
        h(
          'button.btn.btn-lg',
          {
            style: 'flex:none;width:56px',
            onclick: shuffleQuick,
            'aria-label': t('quick.shuffle'),
            title: t('quick.shuffle'),
          },
          icon(ICONS.shuffle, { size: 17 })
        ),
      h('button.btn.btn-lg', { style: 'flex:none;width:96px', onclick: saveSession }, t('plan.save')),
      h(
        'button.btn.btn-lg',
        { style: 'flex:none;width:56px', onclick: () => printWorkout(state.session), 'aria-label': t('plan.export'), title: t('plan.export') },
        icon(ICONS.print, { size: 17 })
      ),
      // Two different runners, because they are two different activities: the
      // session screen ticks off sets, the timer walks a clock. A plan with
      // lifts starts the session; a conditioning-only plan starts the clock.
      h(
        'button.btn.btn-goal.btn-lg',
        {
          style: 'flex:1',
          onclick: exercises.length ? startSession : () => startConditioning(),
        },
        exercises.length ? t('plan.start') : t('cond.start')
      )
    )
  );
}

/* --------------------------------------------------- conditioning on plan */

function conditioningBlocks() {
  return state.session.conditioning?.blocks || [];
}

/**
 * The one format a conditioning workout is, or null when it is several.
 *
 * A three-block workout of an EMOM, an AMRAP and a for-time is not an EMOM, and
 * titling it after whichever block happens to be first describes two thirds of
 * it wrongly. Where the blocks disagree the workout has no single shape, and
 * both the title and the screen accent fall back to the mode itself.
 */
function condFormat() {
  const formats = new Set(conditioningBlocks().map((b) => b.format));
  return formats.size === 1 ? [...formats][0] : null;
}

/** Wall-clock for the conditioning, transitions between blocks included. */
function condMinutes() {
  const blocks = conditioningBlocks();
  const worked = blocks.reduce((sum, b) => sum + (b.minutes || 0), 0);
  return worked + Math.max(0, blocks.length - 1) * BLOCK_REST_MINUTES;
}

/** Every movement across every block, as catalog rows, for the body map. */
function condMovementExercises() {
  const seen = new Set();
  const out = [];
  for (const block of conditioningBlocks()) {
    for (const m of block.movements || []) {
      if (seen.has(m.ref)) continue;
      seen.add(m.ref);
      const ex = state.catalog.byId.get(m.ref);
      if (ex) out.push(ex);
    }
  }
  return out;
}

/** "12 cal", "15", "400 m", "30 s" — the amount as it would be said aloud. */
function condAmount(m) {
  const suffix =
    m.unit === 'calories' ? ' cal' : m.unit === 'metres' ? ' m' : m.unit === 'seconds' ? ' s' : '';
  return `${m.amount}${suffix}`;
}

/**
 * The one line that says what this block IS.
 *
 * Each format is a different sentence because each format is a different
 * promise about the clock, and a generic "12 min · 3 movements" would tell you
 * none of what you need: whether the time is a limit or a target, whether the
 * rounds are counted for you or by you, and where the rest comes from.
 */
function condMeta(block) {
  switch (block.format) {
    case 'emom':
      return t('cond.emomMeta', { rounds: block.rounds });
    case 'amrap':
      return t('cond.amrapMeta', { n: block.minutes });
    case 'intervals':
      return t('cond.intervalMeta', { rounds: block.rounds, work: block.work, rest: block.rest });
    case 'tabata':
      return t('cond.tabataMeta', { n: block.movements.length });
    default:
      return t('cond.fortimeMeta', { rounds: block.rounds, n: block.minutes });
  }
}

/** What the list underneath the header is a list OF. */
function condListLabel(block) {
  if (block.format === 'emom') return t('cond.eachMinute');
  if (block.format === 'intervals') return t('cond.eachInterval');
  if (block.format === 'tabata') return t('cond.tabataEach');
  return t('cond.roundIs');
}

/**
 * The conditioning block, on the plan.
 *
 * Deliberately not an `.ex-card` per movement. A lift card carries sets, reps,
 * a load and a body map because each lift is a thing you do on its own; a
 * conditioning movement means nothing apart from the round it sits in, and
 * giving each one a card would break up the only unit that matters. So the
 * block is one card and the movements are a list inside it -- which is also how
 * it would be written on a whiteboard, and that is not a coincidence.
 *
 * The header carries the format's own sentence rather than a generic count,
 * because "12 min" means something different in an AMRAP (a limit) than in a
 * for-time (a cap you hope not to reach).
 */
function conditioningSection() {
  const blocks = conditioningBlocks();
  if (!blocks.length) return null;

  const hasLifts = sessionExercises().length > 0;

  return h(
    'div.stack',
    { style: 'gap:10px' },
    h(
      'div.phase-head',
      h('span.phase-name', hasLifts ? t('cond.finisher') : t('cond.block')),
      h(
        'span.phase-meta',
        blocks.length > 1
          ? `${tp('cond.blockCount', blocks.length)} · ${t('cond.minutes', { n: condMinutes() })}`
          : t('cond.minutes', { n: condMinutes() })
      )
    ),
    // The breather between blocks is drawn, not just counted. It is two minutes
    // of the workout's wall-clock and part of what makes the next block
    // attackable, so a plan that jumped straight from one card to the next
    // would be describing a harder session than the one it costed.
    blocks.flatMap((block, i) =>
      i === 0
        ? [condCard(block, i)]
        : [
            h(
              'div.cond-rest',
              h('span.cond-rest-line'),
              h('span.cond-rest-label', t('cond.between', { n: BLOCK_REST_MINUTES })),
              h('span.cond-rest-line')
            ),
            condCard(block, i),
          ]
    ),
    // Always: adding and removing apply to any workout. Only Re-roll is
    // generation-specific, and that is decided inside.
    condActions(),
    // The finisher still is not carried into the lifting session screen, which
    // runs sets rather than a clock. Said here, where the thing it limits is.
    hasLifts && h('p.hint', t('cond.finisherNote'))
  );
}

function condCard(block, index = 0) {
  const fresh = state.freshQuick;
  const partner = block.partner;

  // The card sets its own accent rather than inheriting the screen's, so a
  // finisher shows up in its shape's colour against a lifting session's goal
  // colour. That is the point of giving shapes colours at all: an EMOM should
  // be recognisable as an EMOM wherever it appears.
  const style = [
    `--g:${formatColor(block.format)}`,
    fresh ? `animation-delay:${index * 55}ms` : null,
  ]
    .filter(Boolean)
    .join(';');

  return h('div.cond-card', { class: fresh ? 'is-fresh' : '', style },
    h(
      'div.cond-head',
      // Numbered only when there is more than one, since "1" on its own is a
      // label for a sequence that does not exist.
      conditioningBlocks().length > 1 && h('span.cond-index', String(index + 1)),
      h('span.cond-format', t(`cond.format.${block.format}`)),
      h('span.cond-meta', condMeta(block)),
      // Per block, because editing is per block -- unlike re-roll and remove,
      // which act on the workout and live once at the bottom.
      h(
        'button.icon-btn.cond-edit-btn',
        { 'aria-label': t('cond.editBlock'), onclick: () => editConditioning(index) },
        icon(ICONS.pencil, { size: 13 })
      )
    ),

    // An AMRAP with no idea how many rounds is a workout you cannot pace. The
    // estimate is explicitly a guess, and says so.
    block.estimatedRounds &&
      h('p.cond-est', t('cond.amrapEst', { n: block.estimatedRounds })),

    h('div.cond-list-label', condListLabel(block)),
    h(
      'ol.cond-list',
      block.movements.map((m) =>
        h(
          'li.cond-move',
          h('span.cond-amount', condAmount(m)),
          h('span.cond-name', localized(state.catalog.byId.get(m.ref)?.name) || '—')
        )
      )
    ),

    partner &&
      h(
        'p.cond-partner',
        icon(ICONS.checkAll, { size: 12 }),
        t(`cond.partnerNote.${partner.mode}`, { n: partner.people })
      ),

  );
}

/**
 * Re-roll and remove, once for the whole workout rather than once per card.
 *
 * They used to live inside the card, which was fine while there was only ever
 * one. With three, a set of controls on each would read as "re-roll this block"
 * — which is not what they do, and building that would mean a block could be
 * re-rolled into a movement its neighbour already has.
 */
function condActions() {
  const generated = !!conditioningBlocks()[0]?.inputs;
  return h(
    'div.cond-actions',
    // Only a generated workout can be re-rolled: a hand-built one has nothing to
    // roll back to, and offering it would mean a button that discards the work
    // it is sitting under.
    generated &&
      h(
        'button.btn.btn-sm',
        { onclick: reshuffleConditioning },
        icon(ICONS.shuffle, { size: 13 }),
        t('cond.reshuffle')
      ),
    h(
      'button.btn.btn-sm',
      { onclick: () => editConditioning(conditioningBlocks().length) },
      icon(ICONS.plus, { size: 13 }),
      t('cond.addBlock')
    ),
    h(
      'button.btn.btn-sm',
      {
        onclick: () => {
          delete state.session.conditioning;
          saveDraft();
          render();
        },
      },
      t('cond.remove')
    )
  );
}

/**
 * Re-roll the same request with a new seed.
 *
 * Same muscles, same time, same goal, different lifts. The inputs are read off
 * the session rather than the Quick screen's state, so this still works after
 * loading a generated workout back from Saved.
 */
function shuffleQuick() {
  const q = state.session.quick;
  if (!q) return;

  const previous = state.session.exerciseIds;
  const result = buildQuickSession(q, Math.floor(Math.random() * 2 ** 31));

  if (result.shortfall) {
    flash(t('quick.nothingFits'));
    return;
  }

  render();
  const changed = result.exerciseIds.filter((id) => !previous.includes(id)).length;
  flash(changed ? tp('quick.shuffled', changed) : t('quick.shuffledSame'));
}

/**
 * The header for one phase of a session — warm-up, the lifts, the cool-down.
 *
 * These were `Warm-up · 15 min`, `Main · 36 min` and `Mobility · 9 min` in
 * 11px uppercase micro-type. Three problems:
 *
 *   "Main" is the workbook's word for a column, not a thing anyone says. Main
 *   what? It is the lifting, so it says so.
 *
 *   "Mobility" named the contents rather than the phase, and disagreed with
 *   the print sheet and the code, which both call it the cool-down. The phase
 *   is the cool-down; mobility is what is in it.
 *
 *   Minutes without a count says how long but not how much. "5 drills · 15
 *   min" answers both, and the two together are what tells you whether you
 *   have time for this.
 *
 * `explain` adds a line of plain English about what the phase is for. It is
 * on for the plan, where you are reading and deciding, and off during a live
 * session, where you already know and want the list.
 */
function phaseHead(key, count, minutes, { explain = false } = {}) {
  return h(
    'div.stack',
    { style: 'gap:3px' },
    h(
      'div.phase-head',
      h('span.phase-name', t(`phase.${key}`)),
      h('span.phase-meta', phaseMeta(count, minutes))
    ),
    explain && h('p.phase-why', t(`phase.why.${key}`))
  );
}

/** "5 drills · 15 min" — how much, and how long, in that order. */
function phaseMeta(count, minutes) {
  return `${count} · ${t('phase.mins', { n: minutes })}`;
}

function drillRow(kicker, name, minutes) {
  return h(
    'div.drill-row',
    h('span.drill-phase', kicker),
    h('span.drill-name', name),
    h('span.drill-min', `${minutes} ${t('units.min')}`)
  );
}

function planExerciseCard(row, index = 0) {
  const { exercise: ex, prescription: p, suggested } = row;
  // The cards deal themselves in only on the render straight after generating,
  // so arriving here any other way is instant.
  const fresh = state.freshQuick;
  return h(
    'div.ex-card',
    {
      class: fresh ? 'is-fresh' : '',
      style: fresh ? `animation-delay:${index * 55}ms` : null,
    },
    h(
      'div.ex-head',
      h(
        'div.stack',
        { style: 'gap:3px' },
        h('div.ex-name', localized(ex.name)),
        h('div.ex-meta', `${ex.equipment} · ${ex.profile}`),
        muscleLine(ex)
      ),
      h('div.ex-mins', `${row.minutes} ${t('units.min')}`)
    ),
    h(
      'div.ex-figures',
      h('span.ex-big', p ? p.sets : '—'),
      h('span.ex-times', '×'),
      h('span.ex-big', p ? p.reps : '—'),
      h(
        'span.ex-load',
        { class: suggested.kind === 'range' ? '' : 'is-missing' },
        loadLabel(suggested)
      )
    ),
    h('div.divider'),
    h(
      'div.ex-foot',
      h('span.ex-note', p ? p.note : ''),
      p && h('span.ex-rest', t('plan.rest', { n: p.rest }))
    )
  );
}

function bodyMapSection(exercises) {
  const { primary, secondary } = musclesWorked(exercises);
  const onlyPrimary = [...primary].sort();
  const onlySecondary = [...secondary].filter((m) => !primary.has(m)).sort();

  const figure = (view, caption) =>
    h(
      'div.map-figure',
      renderBodyMap(primary, secondary, { front: t('map.front'), back: t('map.back') }, { view }),
      h('span.map-caption', caption)
    );

  const group = (label, swatchClass, names) =>
    h(
      'div.map-group',
      h('div.map-group-label', h('span', { class: `swatch swatch-lg ${swatchClass}` }), label),
      h('div.map-group-names', names.length ? names.join(' · ') : t('map.none'))
    );

  return h(
    'div.stack',
    { style: 'gap:14px' },
    h('div.section-label', t('plan.trains')),
    h(
      'div.map-wrap',
      h('div.map-figures', figure('front', t('map.front')), figure('back', t('map.back'))),
      h(
        'div.map-legend',
        group(t('map.trained'), 'swatch-primary', onlyPrimary),
        group(t('map.supporting'), 'swatch-secondary', onlySecondary)
      )
    )
  );
}

/* -------------------------------------------------------------- session */

function startSession() {
  if (!state.live) {
    state.live = blankLive(state.session);
    // The running session takes over the workout's identity; the draft keeps
    // the same contents under a fresh id, so Build is immediately usable for
    // a new workout without touching the one in progress.
    state.session = { ...JSON.parse(JSON.stringify(state.session)), id: newId() };
    saveLive();
    saveDraft();
  }
  go('live');
}

/** The workout the running session is performing. */
function liveSession() {
  return state.live?.session || state.session;
}

function restRemaining() {
  if (!state.live || !state.live.restEndsAt) return 0;
  return Math.max(0, Math.round((state.live.restEndsAt - Date.now()) / 1000));
}

/**
 * Every tickable step in the running session, in order.
 *
 * One list drives the progress count, select-all, and the finish check, so
 * those three can never disagree about what "everything" means.
 */
function liveSteps(built, exercises, session) {
  return [
    ...built.warmup.items.map((d) => `w${d.id}`),
    ...exercises.flatMap((ex) =>
      Array.from({ length: setsFor(ex, session) }, (_, i) => `s${ex.id}:${i + 1}`)
    ),
    ...built.cooldown.items.map((m) => `c${m.id}`),
  ];
}

/**
 * Of those steps, the ones that become log rows.
 *
 * Warm-up drills and mobility work are ticked off the same way but are not
 * sets, so counting them in "Finish and log N sets" overstated what would
 * actually be written.
 */
const isSetStep = (key) => key.startsWith('s');

function viewLive() {
  const live = state.live;
  const session = live.session;
  const exercises = sessionExercises(session);
  const built = buildSession(session, state.catalog, state.oneRm);

  const steps = liveSteps(built, exercises, session);
  const doneCount = steps.filter((k) => live.checked[k]).length;
  const loggableCount = steps.filter((k) => isSetStep(k) && live.checked[k]).length;
  const stepCount = steps.length;
  const remaining = restRemaining();
  const allDone = stepCount > 0 && doneCount === stepCount;

  const setBlocks = exercises.map((ex) => {
    const p = prescriptionFor(ex, session);
    const count = setsFor(ex, session);
    const keys = Array.from({ length: count }, (_, i) => `s${ex.id}:${i + 1}`);

    return block({
      key: `ex:${ex.id}`,
      title: localized(ex.name),
      sub: p ? `${p.sets} × ${p.reps}` : '',
      keys,
      children: keys.map((key, i) => setRow(ex, i + 1, key, p, session)),
    });
  });

  return h(
    'div.screen',
    h(
      'div.screen-inner',
      h(
        'div.stack',
        { style: 'gap:10px' },
        h(
          'div',
          { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px' },
          backLink(t('tab.build'), () => go('plan')),
          h('div', { style: 'font-size:12px;color:var(--t-55)' }, t('live.done', { done: doneCount, total: stepCount }))
        ),
        h('h1', { style: 'font-size:26px;font-weight:500;letter-spacing:-.02em' }, sessionTitle(session)),
        h(
          'div.progress-track',
          h('div.progress-fill', {
            style: `width:${stepCount ? Math.round((doneCount / stepCount) * 100) : 0}%`,
          })
        )
      ),

      // The warm-up and cool-down blocks are their own headers -- they carry a
      // title, a count and a tick already, so putting a phase header above
      // them would say the same thing twice. The lifts are the gap: they are
      // one block each, so without a header for the group they simply began,
      // with nothing to mark that the warm-up was over and the work started.
      built.warmup.items.length > 0 &&
        block({
          key: 'warmup',
          title: t('phase.warmup'),
          sub: phaseMeta(tp('phase.drills', built.warmup.items.length), built.warmup.minutes),
          keys: built.warmup.items.map((d) => `w${d.id}`),
          children: built.warmup.items.map((d) => checkRow(`w${d.id}`, localized(d.name), d.minutes, d.how)),
        }),

      h(
        'div.stack',
        { style: 'gap:9px' },
        phaseHead('main', tp('phase.lifts', exercises.length), built.mainMinutes),
        setBlocks
      ),

      built.cooldown.items.length > 0 &&
        block({
          key: 'mobility',
          title: t('phase.cooldown'),
          sub: phaseMeta(tp('phase.moves', built.cooldown.items.length), built.cooldown.minutes),
          keys: built.cooldown.items.map((m) => `c${m.id}`),
          children: built.cooldown.items.map((m) => checkRow(`c${m.id}`, localized(m.name), m.minutes, m.how)),
        }),

      h(
        'div.stack',
        { style: 'gap:9px' },
        h(
          'button.btn.btn-block',
          {
            onclick: () => {
              const target = !allDone;
              for (const key of steps) live.checked[key] = target;
              if (!target) live.restEndsAt = 0;
              saveLive();
              render();
            },
          },
          icon(allDone ? ICONS.close : ICONS.checkAll, { size: 16 }),
          allDone ? t('live.clearAll') : t('live.selectAll')
        ),
        h(
          'button.btn.btn-goal.btn-lg.btn-block',
          { onclick: () => attemptFinish(steps, doneCount, loggableCount) },
          loggableCount ? tp('live.finish', loggableCount) : t('live.finishEmpty')
        )
      )
    ),
    remaining > 0 && restBar(remaining)
  );
}

/**
 * One collapsible box. Each exercise, the warm-up and the mobility work get
 * their own, so a long session reads as separate things to get through rather
 * than one continuous column of rows.
 */
function block({ key, title, sub, keys, children }) {
  const live = state.live;
  const open = !live.collapsed[key];
  const done = keys.filter((k) => live.checked[k]).length;
  const complete = keys.length > 0 && done === keys.length;

  return h(
    'section.block',
    { class: [open ? 'is-open' : '', complete ? 'is-complete' : ''].filter(Boolean).join(' ') },
    h(
      'button.block-head',
      {
        'aria-expanded': String(open),
        onclick: () => {
          live.collapsed[key] = open;
          saveLive();
          render();
        },
      },
      h(
        'span.block-tick',
        { class: complete ? 'is-on' : '' },
        complete && icon(ICONS.check, { size: 11, stroke: '#161826' })
      ),
      h(
        'span.block-titles',
        h('span.block-title', title),
        sub && h('span.block-sub', sub)
      ),
      h('span.block-count', `${done}/${keys.length}`),
      h('span.block-chevron', icon(ICONS.chevronDown, { size: 15 }))
    ),
    open && h('div.block-body', children)
  );
}

/** Finish, but say so first when steps are still unmarked. */
function attemptFinish(steps, doneCount, loggableCount) {
  const missing = steps.length - doneCount;
  if (missing === 0) {
    askRpeThenFinish(loggableCount);
    return;
  }

  confirmSheet({
    title: t('live.confirmTitle'),
    body: loggableCount
      ? tp('live.confirmBody', missing, { done: loggableCount })
      : t('live.confirmNothing'),
    confirmLabel: t('live.confirmFinish'),
    cancelLabel: t('live.confirmKeepGoing'),
    onConfirm: () => askRpeThenFinish(loggableCount),
  });
}

/**
 * Ask how hard that was, then write the log.
 *
 * Asked at the end rather than per set: a session RPE is a judgement about the
 * whole thing, and stopping to rate every set would turn a rest period into
 * paperwork. Nothing ticked means nothing to attach a rating to, so the
 * question is skipped rather than asked about a session that will not exist.
 */
function askRpeThenFinish(loggableCount) {
  if (!loggableCount) {
    finishSession(0, null);
    return;
  }
  rpeSheet({
    title: t('rpe.title'),
    body: tp('rpe.body', loggableCount),
    onPick: (rpe) => finishSession(loggableCount, rpe),
  });
}

/**
 * Borg CR-10 anchors, for the label under each number.
 *
 * Only the ends and the middle are named. Handing the reader ten adjectives
 * invites them to pick the word rather than the effort, and the numbers in
 * between are exactly the fine grain the scale exists to capture.
 */
const RPE_WORD = {
  1: 'rpe.w1',
  3: 'rpe.w3',
  5: 'rpe.w5',
  7: 'rpe.w7',
  9: 'rpe.w9',
  10: 'rpe.w10',
};

function rpeWord(n) {
  const key = RPE_WORD[n] || RPE_WORD[n - 1];
  return key ? t(key) : '';
}

/**
 * The 1–10 picker.
 *
 * Ten buttons rather than a range input: a slider invites you to drag until
 * the number looks right, and the whole value of RPE is that it is a snap
 * judgement. Skipping is a first-class option — a rating nobody meant is
 * worse than no rating, and the chart draws gaps honestly.
 */
function rpeSheet({ title, body, onPick }) {
  const scale = Array.from({ length: RPE_MAX - RPE_MIN + 1 }, (_, i) => RPE_MIN + i);

  const dialog = h(
    'dialog.sheet',
    { style: `--g:${screenAccent()}` },
    h(
      'div.sheet-body',
      h('h2.sheet-title', title),
      h('p.sheet-text', body),
      h(
        'div.rpe-scale',
        scale.map((n) =>
          h(
            'button.rpe-dot',
            {
              type: 'button',
              title: `${n} — ${rpeWord(n)}`,
              'aria-label': `${n} — ${rpeWord(n)}`,
              onclick: () => {
                dialog.close();
                onPick(n);
              },
            },
            String(n)
          )
        )
      ),
      h('div.rpe-anchors', h('span', t('rpe.w1')), h('span', t('rpe.w10'))),
      h(
        'div.sheet-actions',
        h(
          'button.btn.btn-block',
          {
            onclick: () => {
              dialog.close();
              onPick(null);
            },
          },
          t('rpe.skip')
        )
      )
    )
  );

  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  dialog.showModal();
}

/**
 * A modal confirmation. Built rather than using window.confirm so the question
 * can carry the actual numbers and match the rest of the app.
 */
/**
 * A sheet offering two ways forward rather than yes/no.
 *
 * `confirmSheet` is a question with an answer. This is a fork: both options are
 * real things to do, so neither can be the one you get by declining. Each
 * carries a second line, because the difference between them is the part that
 * needs explaining and a button label has no room for it.
 */
function choiceSheet({ title, body, choices, cancelLabel }) {
  const dialog = h(
    'dialog.sheet',
    { style: `--g:${screenAccent()}` },
    h(
      'div.sheet-body',
      h('h2.sheet-title', title),
      h('p.sheet-text', body),
      h(
        'div.stack',
        { style: 'gap:8px' },
        choices.map((choice) =>
          h(
            'button.btn.btn-block.choice-btn',
            {
              class: choice.primary ? 'btn-goal' : '',
              onclick: () => {
                dialog.close();
                choice.onPick();
              },
            },
            h('span.choice-label', choice.label),
            choice.sub && h('span.choice-sub', choice.sub)
          )
        ),
        h('button.btn-link', { onclick: () => dialog.close() }, cancelLabel)
      )
    )
  );

  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  dialog.showModal();
}

function confirmSheet({ title, body, confirmLabel, cancelLabel, onConfirm }) {
  const dialog = h(
    'dialog.sheet',
    // A <dialog> is appended to <body>, outside the app root that carries the
    // goal accent, so it would otherwise fall back to the :root default and
    // confirm an Endurance session in Strength orange.
    { style: `--g:${screenAccent()}` },
    h(
      'div.sheet-body',
      h('h2.sheet-title', title),
      h('p.sheet-text', body),
      h(
        'div.sheet-actions',
        h('button.btn.btn-block', { onclick: () => dialog.close() }, cancelLabel),
        h(
          'button.btn.btn-goal.btn-block',
          {
            onclick: () => {
              dialog.close();
              onConfirm();
            },
          },
          confirmLabel
        )
      )
    )
  );

  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  dialog.showModal();
}

/**
 * A warm-up drill or a mobility move: tick it off, or ask how it is done.
 *
 * The instructions were only ever on the print sheet, which is no use to
 * someone standing in the gym holding a phone — and the cool-down is exactly
 * where you meet a movement you have never done before. So the row grows the
 * same affordance a set row already has: the row itself is the action, and a
 * quiet icon button beside it opens a panel underneath. Same shape, same
 * place, same gesture as the pencil that opens the weight stepper, so it is
 * one thing to learn rather than two.
 *
 * It expands in place rather than opening a sheet. The text is a sentence or
 * two, and a modal mid-session would cover the list, lose your scroll position
 * and have to be dismissed before you could tick anything off.
 *
 * One open at a time, like `live.editing`: opening the next closes the last,
 * so the list cannot silently grow to twice its height while you read.
 */
function checkRow(key, name, minutes, how = '') {
  const live = state.live;
  const on = !!live.checked[key];
  const note = localized(how);
  const open = live.howOpen === key;

  return h(
    'div.stack',
    { style: 'gap:9px' },
    h(
      'div.check-line',
      h(
        'button.check-row',
        {
          class: on ? 'is-done' : '',
          'aria-pressed': String(on),
          onclick: () => {
            live.checked[key] = !on;
            saveLive();
            render();
          },
        },
        h('span.tick', { class: on ? 'is-on' : '' }, icon(ICONS.check, { size: 11, stroke: '#161826' })),
        h('span.check-row-name', name),
        h('span.check-row-min', `${minutes} ${t('units.min')}`)
      ),
      // No button at all when there is nothing to say, rather than one that
      // opens an empty panel.
      note &&
        h(
          'button.icon-btn',
          {
            class: open ? 'is-on' : '',
            'aria-label': t('live.how'),
            'aria-expanded': String(open),
            onclick: () => {
              live.howOpen = open ? null : key;
              saveLive();
              render();
            },
          },
          icon(ICONS.info, { size: 15 })
        )
    ),
    open && note && h('p.how-note', note)
  );
}

function setRow(ex, n, key, p, session) {
  const live = state.live;
  const on = !!live.checked[key];
  const editing = live.editing === key;

  const stored = live.weights[key];
  const weight = stored !== undefined ? stored : defaultWeight(ex, session);
  const hasWeight = weight !== null && weight !== undefined;

  // Without a 1RM there is nothing to suggest, so the row invites you to put a
  // number in rather than stating one. Italic and dimmed so it never reads as
  // a weight you already entered.
  const isPrompt = !hasWeight && !!(p && p.loadMin);
  const label = hasWeight ? kg(weight) : isPrompt ? t('live.addWeight') : t('live.bodyweight');

  const setWeight = (value) => {
    live.weights[key] = Math.max(0, value);
    saveLive();
    render();
  };

  const step = (delta) => setWeight(steppedWeight(hasWeight ? weight : 0, delta));

  return h(
    'div.stack',
    { style: 'gap:9px' },
    h(
      'div.set-line',
      h(
        'button.set-row',
        {
          class: on ? 'is-done' : '',
          'aria-pressed': String(on),
          onclick: () => {
            live.checked[key] = !on;
            // Ticking a set starts its prescribed rest; un-ticking cancels it.
            if (!on && p && p.restAvgSec) {
              live.restEndsAt = Date.now() + p.restAvgSec * 1000;
              live.restTotal = p.restAvgSec;
              live.restLabel = localized(ex.name);
            } else {
              live.restEndsAt = 0;
            }
            saveLive();
            render();
          },
        },
        h('span.tick', { class: on ? 'is-on' : '' }, icon(ICONS.check, { size: 11, stroke: '#161826' })),
        h('span.set-n', t('live.set', { n })),
        h('span.set-load', { class: isPrompt ? 'is-prompt' : '' }, label),
        h('span.set-reps', p ? t('live.reps', { reps: p.reps }) : '')
      ),
      h(
        'button.icon-btn',
        {
          'aria-label': t('live.adjust'),
          onclick: () => {
            live.editing = editing ? null : key;
            saveLive();
            render();
          },
        },
        icon(ICONS.pencil, { size: 14 })
      )
    ),
    editing &&
      weightStepper(t('live.adjust'), hasWeight ? weight : null, setWeight, step)
  );
}

/** One 2.5 kg step, snapping an off-grid weight onto the grid on the way. */
function steppedWeight(current, delta) {
  const STEP = 2.5;
  const onGrid = Math.abs(current / STEP - Math.round(current / STEP)) < 1e-9;
  if (onGrid) return Math.max(0, current + delta);
  // Off the grid (typed by hand): the first press snaps to the nearest
  // multiple in the direction pressed rather than carrying the offset along.
  return Math.max(0, delta > 0 ? Math.ceil(current / STEP) * STEP : Math.floor(current / STEP) * STEP);
}

/**
 * A weight control that can be stepped or typed.
 *
 * Stepping is the common case and stays on 2.5 kg. Typing exists because a
 * 180 kg deadlift is a lot of button presses, and it accepts any number —
 * only the +/- buttons enforce the grid.
 */
function weightStepper(label, value, onSet, onStep) {
  // A text field rather than type="number": a number input reports an empty
  // value for a half-typed "187." and reads a decimal comma as invalid, both
  // of which would silently wipe the weight on commit. Parsing it here also
  // lets a Swedish keyboard's comma work.
  const input = h('input.stepper-input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    'aria-label': label,
    value: value ?? '',
    placeholder: '—',
    onchange: (e) => {
      const raw = e.target.value.trim().replace(',', '.');

      if (raw === '') {
        onSet(0);
        return;
      }

      const parsed = Number(raw);
      // Anything unparseable reverts rather than resetting the weight.
      if (Number.isFinite(parsed) && parsed >= 0) onSet(parsed);
      else e.target.value = value ?? '';
    },
  });

  return h(
    'div.stepper',
    h('span.stepper-label', label),
    h('button.stepper-btn', { type: 'button', onclick: () => onStep(-2.5), 'aria-label': '−2.5 kg' }, '−'),
    input,
    h('span.stepper-unit', t('units.kg')),
    h('button.stepper-btn', { type: 'button', onclick: () => onStep(2.5), 'aria-label': '+2.5 kg' }, '+')
  );
}

const restClock = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/* ------------------------------------------------------ conditioning timer

   The clock that turns a conditioning plan into a workout.

   Three things shape the whole design, and all three come from the fact that
   this screen is used from six feet away with your hands on a rower:

     The clock is derived, never counted. State holds the epoch millisecond the
     current step ends; remaining time is `endsAt - now`. A counter incremented
     by a `setInterval` drifts, stops when the tab is backgrounded, and cannot
     survive the reload a phone performs when it reclaims memory mid-workout.
     An end timestamp survives all three.

     Rendering is surgical. `render()` rebuilds the screen, which would fight a
     tap on the round counter four times a second -- the same reason `tickRest`
     edits two nodes and nothing else. The tick here writes the digits, the ring
     and the label, and calls `render()` only when the step actually changes.

     It is audible. You cannot watch a phone mid-burpee, so every transition
     beeps and buzzes, with a three-note count-in before it arrives. The tones
     are synthesised rather than loaded: this app ships no binary assets and a
     beep is four lines of WebAudio.
   ------------------------------------------------------------------------ */

/** Reused across the session; created on the first gesture so autoplay allows it. */
let audioCtx = null;

function beep(frequency, ms = 90, gain = 0.14) {
  if (!state.prefs.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const vol = audioCtx.createGain();
    osc.frequency.value = frequency;
    osc.type = 'sine';
    // A short ramp rather than a hard stop: an abrupt gate on a sine wave
    // clicks, and a click is what a broken speaker sounds like.
    vol.gain.setValueAtTime(gain, audioCtx.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
    osc.connect(vol).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + ms / 1000);
  } catch {
    // No audio is a worse workout, not a broken one.
  }
}

function buzz(pattern) {
  if (!state.prefs.haptics) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not everywhere, and not important enough to guard beyond this */
  }
}

/** The three-note count-in, then the transition itself. Different notes so the
 *  one that means "go" is not the one that means "nearly". */
const cueTick = () => {
  beep(880, 70, 0.1);
  buzz(30);
};
const cueGo = () => {
  beep(1320, 200, 0.18);
  buzz([60, 40, 60]);
};
const cueRest = () => {
  beep(520, 220, 0.14);
  buzz(80);
};
const cueDone = () => {
  beep(660, 160);
  setTimeout(() => beep(880, 160), 170);
  setTimeout(() => beep(1180, 340), 340);
  buzz([80, 60, 80, 60, 160]);
};

/** Keep the screen awake while a clock is running, if the browser allows it. */
let wakeLock = null;
async function holdWakeLock() {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) || null;
  } catch {
    /* denied or unsupported; the workout still runs */
  }
}
function releaseWakeLock() {
  try {
    wakeLock?.release();
  } catch {
    /* already gone */
  }
  wakeLock = null;
}

function saveTimer() {
  if (state.timer) store.setTimer(state.timer);
}

/**
 * Begin a conditioning workout.
 *
 * The steps are derived from the blocks rather than stored with them: they are
 * a pure function of the plan, and storing both would be two copies of one
 * truth that could disagree after an edit.
 */
function startConditioning(session = state.session) {
  const blocks = session.conditioning?.blocks || [];
  if (!blocks.length) return;

  state.timer = {
    sessionId: session.id,
    sessionName: sessionTitle(session),
    date: today(),
    blocks: JSON.parse(JSON.stringify(blocks)),
    index: 0,
    running: false,
    endsAt: 0,
    // Seconds left in the current step while paused, and on the ready screen
    // the full step, so the clock shows what is coming rather than zero.
    remaining: null,
    /** Per block: `{ rounds, reps, seconds }`. Only the relevant ones are set. */
    scores: {},
    startedAt: null,
  };

  saveTimer();
  go('timer');
}

function timerSteps() {
  return state.timer ? workoutSteps(state.timer.blocks) : [];
}

function timerStep() {
  const steps = timerSteps();
  return steps[state.timer?.index] || null;
}

/** Seconds left in the current step. The single source for every clock on screen. */
function timerRemaining() {
  const tm = state.timer;
  if (!tm) return 0;
  const step = timerStep();
  if (!step) return 0;
  if (!tm.running) return tm.remaining ?? step.seconds;
  return Math.max(0, Math.ceil((tm.endsAt - Date.now()) / 1000));
}

function timerStart() {
  const tm = state.timer;
  const step = timerStep();
  if (!tm || !step) return;
  const left = tm.remaining ?? step.seconds;
  tm.running = true;
  tm.endsAt = Date.now() + left * 1000;
  tm.remaining = null;
  if (!tm.startedAt) tm.startedAt = Date.now();
  // The first press is also what unlocks audio, so a cue here is both a signal
  // and the gesture that lets every later cue play.
  cueGo();
  holdWakeLock();
  saveTimer();
  render();
}

function timerPause() {
  const tm = state.timer;
  if (!tm?.running) return;
  tm.remaining = timerRemaining();
  tm.running = false;
  releaseWakeLock();
  saveTimer();
  render();
}

/**
 * Move to the next step, or finish.
 *
 * `auto` distinguishes the clock arriving from a user skipping, which matters
 * only for the cue: skipping should not sound like a round starting when you
 * are the one who ended it.
 */
function timerAdvance(auto = true) {
  const tm = state.timer;
  if (!tm) return;

  const steps = timerSteps();
  const next = tm.index + 1;

  if (next >= steps.length) {
    timerFinish();
    return;
  }

  const previousEnd = tm.endsAt;
  tm.index = next;
  tm.remaining = null;
  const step = steps[next];
  // A step begins when the one before it ended, not when the tick noticed. The
  // tick can be late -- 250 ms normally, minutes if the tab was backgrounded --
  // and starting from `now` would donate that lateness to every round, so a
  // twelve-minute EMOM would quietly run thirteen. Skipping is different: the
  // user ended the step, so the next one starts when they said.
  tm.endsAt = (auto ? previousEnd : Date.now()) + step.seconds * 1000;

  // An open step is the score, so it does not start itself: you decide when an
  // AMRAP begins, and the count-in is part of the format.
  if (step.kind === 'amrap' || step.kind === 'fortime') {
    tm.running = false;
    tm.remaining = step.seconds;
  }

  if (auto) (step.kind === 'rest' || step.kind === 'between' ? cueRest : cueGo)();
  saveTimer();
  render();
}

/** Count a round of the open-ended formats. The number IS the score. */
function timerCount(delta) {
  const tm = state.timer;
  const step = timerStep();
  if (!tm || !step) return;
  const block = step.block ?? 0;
  const score = tm.scores[block] || { rounds: 0, reps: 0 };
  score.rounds = Math.max(0, (score.rounds || 0) + delta);
  tm.scores[block] = score;
  if (delta > 0) {
    beep(1046, 60, 0.09);
    buzz(25);
  }
  saveTimer();
  render();
}

/**
 * Stop the clock and write the log.
 *
 * A conditioning entry is one row per block rather than one per set: the block
 * is the unit that was performed, and there is no per-set weight to record. The
 * `goal` is written as `Conditioning` so the weekly summary and the goal mix can
 * report it -- the one place the word is used as a goal, which is why it never
 * had to become a fifth entry in the prescription table.
 */
function timerFinish() {
  const tm = state.timer;
  if (!tm) return;

  cueDone();
  releaseWakeLock();

  const entries = tm.blocks.map((block, i) => {
    const score = tm.scores[i] || {};
    return {
      id: newId(),
      date: tm.date,
      sessionId: tm.sessionId,
      sessionName: tm.sessionName,
      kind: 'conditioning',
      format: block.format,
      blockMinutes: block.minutes,
      movementIds: block.movements.map((m) => m.ref),
      rounds: score.rounds || null,
      seconds: score.seconds || null,
      exerciseId: null,
      goal: 'Conditioning',
      weight: null,
      reps: null,
      rpe: null,
      auto: true,
    };
  });

  state.timer = { ...tm, done: true, running: false, entries };
  saveTimer();
  // The clock runs wherever you are, so it can finish while you are on the Log.
  // Coming to the summary is the one interruption this app should make: the
  // workout is over, nothing is written down yet, and the numbers only exist
  // here until you say what to do with them.
  go('timer');
}

/**
 * Rate it, write it, and go home.
 *
 * The RPE question is the same one the lifting session asks, for the same
 * reason: a session rating is a judgement about the whole thing, and a
 * conditioning workout is exactly the kind where it carries the most.
 */
function timerLogAndExit() {
  const tm = state.timer;
  if (!tm?.entries) return;

  rpeSheet({
    title: t('rpe.title'),
    body: t('cond.rpeBody'),
    onPick: (rpe) => {
      const entries = tm.entries.map((e) => ({ ...e, rpe }));
      state.log = [...entries, ...state.log];
      store.setLog(state.log);

      const session = state.sessions.find((s) => s.id === tm.sessionId);
      if (session) {
        session.completions = [...(session.completions || []), { date: tm.date, sets: entries.length, rpe }];
        store.setSessions(state.sessions);
      }

      state.timer = null;
      store.clearTimer();
      go('home');
      flash(tp('cond.logged', entries.length));
    },
  });
}

function timerDiscard() {
  confirmSheet({
    title: t('cond.discardTitle'),
    body: t('cond.discardBody'),
    confirmLabel: t('cond.discard'),
    cancelLabel: t('live.confirmKeepGoing'),
    onConfirm: () => {
      releaseWakeLock();
      state.timer = null;
      store.clearTimer();
      go('plan');
    },
  });
}

/**
 * Advance the clock without re-rendering.
 *
 * Writes the three things that change and nothing else, for the reason
 * `tickRest` does: going through `render()` four times a second would tear down
 * the round counter between every tap. A step boundary is the one thing that
 * does re-render, because the whole screen changes.
 */
function tickTimer() {
  const tm = state.timer;
  if (!tm || tm.done) return;

  const step = timerStep();
  if (!step) return;

  const countUp = step.kind === 'fortime';
  const remaining = timerRemaining();
  const shown = countUp ? step.seconds - remaining : remaining;

  // The digits and the ring only exist while the screen is up. Everything below
  // runs wherever you are: a clock that only advances while you are looking at
  // it is not a clock, and the beep that says the round changed is worth more
  // when you have wandered off to the Log than when you are staring at it.
  if (state.screen === 'timer') {
    const digits = document.querySelector('.tmr-clock');
    if (digits) digits.textContent = restClock(Math.max(0, shown));

    const ring = document.querySelector('.tmr-ring-fill');
    if (ring) {
      const done = step.seconds ? 1 - remaining / step.seconds : 0;
      ring.style.strokeDashoffset = String(Math.round(RING_LEN * (1 - done)));
    }
  } else {
    // Off-screen, the bubble carries the clock. One text node, once a second.
    const meta = document.querySelector('.bubble-meta');
    if (meta && tm.running) meta.textContent = restClock(Math.max(0, remaining));
  }

  if (!tm.running) return;

  // The count-in. Only on windows long enough for it to mean something -- a ten
  // second rest that beeps for three of them is just noise.
  if (step.seconds > 12 && remaining > 0 && remaining <= 3 && tm.lastCue !== remaining) {
    tm.lastCue = remaining;
    cueTick();
  }

  if (remaining <= 0) {
    tm.lastCue = null;
    // More than a whole step late means the tab was asleep, not that the tick
    // was slow. Catching up silently in one pass beats advancing a step every
    // 250 ms and firing a beep for each of the rounds that already went by.
    if (Date.now() - tm.endsAt > step.seconds * 1000) {
      catchUpTimer();
      render();
      return;
    }
    timerAdvance(true);
  }
}

/**
 * Walk forward through every step that expired while the tab was hidden.
 *
 * A backgrounded tab has its intervals throttled to once a minute or stopped
 * entirely, so coming back to a three-step-old clock is normal rather than
 * exceptional. Because remaining time is derived from `endsAt`, catching up is
 * just consuming steps until one of them has time left -- and each consumed
 * step pushes the next one's `endsAt` forward by its own length, so the
 * sequence lands exactly where it would have without the interruption.
 *
 * No cues while catching up: three beeps for three missed rounds would be
 * noise about something that already happened.
 */
function catchUpTimer() {
  const tm = state.timer;
  if (!tm?.running || tm.done) return;

  const steps = timerSteps();
  let guard = 0;

  while (tm.running && Date.now() >= tm.endsAt && guard < 500) {
    guard += 1;
    const next = tm.index + 1;
    if (next >= steps.length) {
      timerFinish();
      return;
    }
    tm.index = next;
    const step = steps[next];
    if (step.kind === 'amrap' || step.kind === 'fortime') {
      tm.running = false;
      tm.remaining = step.seconds;
      break;
    }
    tm.endsAt += step.seconds * 1000;
  }

  tm.lastCue = null;
  saveTimer();
}

/** Circumference of the ring below: 2·pi·r for r = 52. */
const RING_LEN = 326;

/**
 * The countdown ring. `fraction` is how much of the window is still to come.
 *
 * Built with createElementNS rather than `h`, which uses createElement and
 * would produce an HTMLUnknownElement named "svg" -- in the document, matched
 * by the stylesheet, and drawing absolutely nothing.
 */
function progressRing(fraction) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'tmr-ring');

  const circle = (cls, style) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '60');
    c.setAttribute('cy', '60');
    c.setAttribute('r', '52');
    c.setAttribute('class', cls);
    if (style) c.setAttribute('style', style);
    svg.appendChild(c);
  };

  const left = Math.max(0, Math.min(1, fraction));
  circle('tmr-ring-track');
  circle(
    'tmr-ring-fill',
    `stroke-dasharray:${RING_LEN};stroke-dashoffset:${Math.round(RING_LEN * (1 - left))}`
  );
  return svg;
}

/** Everything on this screen has to be legible from arm's length and further. */
function viewTimer() {
  const tm = state.timer;
  if (!tm) {
    state.screen = 'home';
    return viewHome();
  }
  if (tm.done) return timerSummary(tm);

  const steps = timerSteps();
  const step = timerStep();
  if (!step) return timerSummary(tm);

  const block = tm.blocks[step.block ?? 0];
  const colour = formatColor(block?.format);
  const remaining = timerRemaining();
  const countUp = step.kind === 'fortime';
  const shown = countUp ? step.seconds - remaining : remaining;
  const open = step.kind === 'amrap' || step.kind === 'fortime';
  const resting = step.kind === 'rest' || step.kind === 'between';
  const score = tm.scores[step.block ?? 0] || { rounds: 0 };

  // Whose turn it is, on a format that alternates. Blocks with no partner say
  // nothing rather than saying "you".
  const partner = block?.partner;
  const turn =
    partner?.mode === 'alternating' && step.round
      ? ((step.round - 1) % partner.people) + 1
      : null;

  return h(
    'div.screen.tmr',
    { style: `--g:${colour}` },
    h(
      'div.screen-inner.tmr-inner',
      h(
        'div.tmr-top',
        h('button.back', { onclick: timerDiscard }, icon(ICONS.close, { size: 13 }), t('cond.stop')),
        h(
          'span.tmr-progress',
          t('cond.stepOf', { n: tm.index + 1, total: steps.length })
        )
      ),

      // What you are doing, said once and large. During a rest it is what comes
      // next, because a rest is only useful if you know what to set up for.
      h(
        'div.tmr-head',
        h('span.tmr-kicker', resting ? t('cond.next') : t(`cond.format.${block.format}`)),
        h(
          'h1.tmr-name',
          resting ? nextMovementName(steps, tm.index) : stepName(step)
        ),
        turn && h('span.tmr-turn', t('cond.turn', { n: turn }))
      ),

      h(
        'div.tmr-dial',
        { class: resting ? 'is-rest' : '' },
        // Built with createElementNS rather than `h`, which uses createElement
        // and would produce an HTMLUnknownElement called "svg" -- present in the
        // DOM, styled by the stylesheet, and drawing absolutely nothing.
        progressRing(remaining / (step.seconds || 1)),
        h(
          'div.tmr-readout',
          h('div.tmr-clock', restClock(Math.max(0, shown))),
          h('div.tmr-phase', phaseWord(step, resting))
        )
      ),

      // The round list for the open formats: what one round is, so you know
      // what you are repeating without leaving the screen.
      open &&
        h(
          'ol.tmr-list',
          step.movements.map((m) =>
            h(
              'li.cond-move',
              h('span.cond-amount', condAmount(m)),
              h('span.cond-name', localized(state.catalog.byId.get(m.ref)?.name) || '—')
            )
          )
        ),

      // The counter is the score, so it is the biggest control on the screen
      // and sits under the thumb rather than beside the clock.
      step.kind === 'amrap' &&
        h(
          'div.tmr-count',
          h(
            'button.tmr-count-btn',
            { onclick: () => timerCount(-1), 'aria-label': t('cond.roundMinus'), disabled: !score.rounds },
            '−'
          ),
          h(
            'button.tmr-count-main',
            { onclick: () => timerCount(1) },
            h('span.tmr-count-n', String(score.rounds || 0)),
            h('span.tmr-count-label', tp('cond.roundsDone', score.rounds || 0))
          ),
          h('button.tmr-count-btn', { onclick: () => timerCount(1), 'aria-label': t('cond.roundPlus') }, '+')
        ),

      h(
        'div.tmr-actions',
        tm.running
          ? h('button.btn.btn-lg.btn-block', { onclick: timerPause }, t('cond.pause'))
          : h(
              'button.btn.btn-goal.btn-lg.btn-block',
              { onclick: timerStart },
              tm.startedAt ? t('cond.resume') : t('cond.begin')
            ),
        h(
          'button.btn.btn-lg',
          { style: 'flex:none;width:96px', onclick: () => timerAdvance(false) },
          step.kind === 'fortime' || step.kind === 'amrap' ? t('cond.doneStep') : t('live.skip')
        )
      )
    )
  );
}

/** The movement a rest is preparing you for. */
function nextMovementName(steps, index) {
  for (let i = index + 1; i < steps.length; i += 1) {
    const s = steps[i];
    if (s.kind === 'rest' || s.kind === 'between') continue;
    return stepName(s);
  }
  return t('cond.lastOne');
}

function stepName(step) {
  if (step.kind === 'amrap' || step.kind === 'fortime') {
    return tp('cond.movementCount', step.movements.length);
  }
  if (!step.movement) return t('cond.rest');
  const name = localized(state.catalog.byId.get(step.movement.ref)?.name) || '—';
  return `${condAmount(step.movement)} ${name}`;
}

/** The small word under the digits: what this window is, in one word. */
function phaseWord(step, resting) {
  if (step.kind === 'between') return t('cond.betweenBlocks');
  if (resting) return t('cond.rest');
  if (step.kind === 'fortime') return t('cond.elapsed');
  if (step.kind === 'amrap') return t('cond.left');
  if (step.round && step.rounds) {
    return step.group
      ? t('cond.roundOfGroup', { n: step.round, total: step.rounds, g: step.group, groups: step.groups })
      : t('cond.roundOf', { n: step.round, total: step.rounds });
  }
  return t('cond.work');
}

/** What you did, before it is written down. */
function timerSummary(tm) {
  const elapsed = tm.startedAt ? Math.round((Date.now() - tm.startedAt) / 1000) : 0;

  return h(
    'div.screen',
    h(
      'div.screen-inner',
      { style: 'gap:22px' },
      screenHead(tm.sessionName, t('cond.doneTitle')),
      h(
        'div.tmr-summary',
        tm.blocks.map((block, i) => {
          const score = tm.scores[i] || {};
          return h(
            'div.tmr-sum-row',
            { style: `--g:${formatColor(block.format)}` },
            h('span.tmr-sum-fmt', t(`cond.format.${block.format}`)),
            h(
              'span.tmr-sum-score',
              score.rounds
                ? tp('cond.roundsDone', score.rounds)
                : t('cond.minutes', { n: block.minutes })
            )
          );
        })
      ),
      h('p.hint', t('cond.doneHint', { n: Math.round(elapsed / 60) }))
    ),
    h(
      'div.sticky-actions',
      h('button.btn.btn-lg', { style: 'flex:none;width:96px', onclick: timerDiscard }, t('cond.discard')),
      h('button.btn.btn-goal.btn-lg', { style: 'flex:1', onclick: timerLogAndExit }, t('cond.logIt'))
    )
  );
}

const restPercent = (remaining) =>
  state.live?.restTotal ? Math.round((remaining / state.live.restTotal) * 100) : 0;

function restBar(remaining) {
  const live = state.live;

  return h(
    'div.rest',
    h(
      'div.rest-main',
      h('div.rest-kicker', t('live.rest', { name: live.restLabel })),
      h('div.rest-clock', restClock(remaining))
    ),
    h('div.rest-track', h('div.rest-fill', { style: `width:${restPercent(remaining)}%` })),
    h(
      'button.btn.btn-sm',
      {
        onclick: () => {
          live.restEndsAt = 0;
          saveLive();
          render();
        },
      },
      t('live.skip')
    )
  );
}

/**
 * Advance the rest timer without re-rendering.
 *
 * This deliberately edits the two values that change and nothing else. Going
 * through render() once a second tore down and rebuilt every element on the
 * screen, so a weight field could only be typed into in the gaps between
 * ticks. Expiry removes just the bar, for the same reason.
 */
function tickRest() {
  if (!state.live || state.screen !== 'live') return;

  const bar = document.querySelector('.rest');
  const remaining = restRemaining();

  if (remaining <= 0) {
    if (state.live.restEndsAt) {
      state.live.restEndsAt = 0;
      saveLive();
    }
    if (bar) bar.remove();
    return;
  }

  // No bar yet means the click that started this rest already drew it.
  if (!bar) return;

  const clock = bar.querySelector('.rest-clock');
  const fill = bar.querySelector('.rest-fill');
  if (clock) clock.textContent = restClock(remaining);
  if (fill) fill.style.width = `${restPercent(remaining)}%`;
}

/**
 * Turn the ticked sets into log rows.
 *
 * Only what was actually confirmed is written, carrying the weight that was on
 * the row -- which is a real improvement on logging the whole prescription
 * blind. Reps stay null: the session screen shows the prescribed range, it
 * never asks how many you managed.
 *
 * `rpe` is the session's rating, stamped identically on every row it writes.
 * That is redundant on the face of it, but the log row is the only record the
 * app keeps, and one number repeated across a session's rows averages back to
 * itself — see `sessionRpes`. A skipped rating writes null, not a guess.
 */
function finishSession(doneCount, rpe = null) {
  const live = state.live;
  if (!live || !doneCount) {
    state.live = null;
    store.clearLive();
    go('home');
    flash(t('live.nothingTicked'));
    return;
  }

  // Read from the session's own snapshot, not the draft: the draft may by now
  // be a completely different workout the user started building mid-session.
  const session = live.session;
  const entries = [];

  for (const ex of sessionExercises(session)) {
    for (let n = 1; n <= setsFor(ex, session); n += 1) {
      const key = `s${ex.id}:${n}`;
      if (!live.checked[key]) continue;
      const stored = live.weights[key];
      const weight = stored !== undefined ? stored : defaultWeight(ex, session);
      entries.push({
        id: newId(),
        date: live.date,
        sessionId: session.id,
        sessionName: sessionTitle(session),
        exerciseId: ex.id,
        goal: session.goal,
        setNo: n,
        weight: weight ?? null,
        reps: null,
        rpe,
        auto: true,
      });
    }
  }

  state.log = [...entries, ...state.log];
  store.setLog(state.log);
  recordCompletion(session, live.date, entries.length, rpe);

  // Navigate first: flash() renders, and rendering the session screen with no
  // session left is exactly the state that used to resurrect an empty one.
  state.live = null;
  store.clearLive();
  go('home');
  flash(tp('live.logged', entries.length));
}

/* ---------------------------------------------------------------- saved */

function saveSession() {
  const copy = JSON.parse(JSON.stringify(state.session));
  if (!copy.name) copy.name = sessionTitle();

  const at = state.sessions.findIndex((s) => s.id === copy.id);
  if (at >= 0) {
    copy.completions = state.sessions[at].completions || [];
    state.sessions[at] = copy;
  } else {
    state.sessions.unshift(copy);
  }

  store.setSessions(state.sessions);
  flash(t('saved.saved'));
}

/** Append a completion to the saved workout, saving it first if it is new. */
function recordCompletion(session, date, sets, rpe = null) {
  let saved = state.sessions.find((s) => s.id === session.id);
  if (!saved) {
    saved = JSON.parse(JSON.stringify(session));
    if (!saved.name) saved.name = sessionTitle(session);
    state.sessions.unshift(saved);
  }
  saved.completions = [...(saved.completions || []), { date, sets, rpe }];
  store.setSessions(state.sessions);
}

function completionLine(session) {
  const done = session.completions || [];
  if (!done.length) return t('saved.never');
  const last = done.reduce((a, b) => (a.date > b.date ? a : b));
  // Formatted, not raw ISO: it sits directly beside "saved 11 Jul" and two
  // date formats one line apart look like two different kinds of date.
  return done.length === 1
    ? t('saved.completedOnce', { date: shortDate(last.date) })
    : t('saved.completedMany', { n: done.length, date: shortDate(last.date) });
}

/**
 * Saved workouts, grouped by goal and wearing Home's card.
 *
 * Grouped rather than merely sorted: the goal is a category, and a flat list
 * ordered by one puts the boundary between Strength and Hypertrophy nowhere in
 * particular. A header per group gives that boundary somewhere to be.
 *
 * Groups follow the goal order everything else uses — the intensity continuum
 * from §1, not alphabetical — so this list reads the way Build does. A goal
 * with nothing saved under it is not shown; an empty heading is just a hole.
 */
function viewSaved() {
  return h(
    'div.screen',
    h(
      'div.screen-inner.home',
      backLink(t('tab.home'), () => go('home')),
      screenHead(t('saved.kicker', { n: state.sessions.length }), t('saved.title')),
      state.sessions.length ? savedGroups() : empty(t('saved.empty'), t('saved.emptyHint'))
    )
  );
}

/** The most recent completion date, or null if it has never been done. */
function lastCompleted(session) {
  const done = session.completions || [];
  if (!done.length) return null;
  return done.reduce((a, b) => (a.date > b.date ? a : b)).date;
}

/** A goal's colour, with a neutral fallback for one the catalog has dropped. */
function goalColor(goal) {
  return GOAL_COLOR[goal] || 'var(--color-neutral-700)';
}

function savedGroups() {
  const buckets = new Map(state.catalog.vocabulary.goals.map((goal) => [goal, []]));

  // A workout saved under a goal the catalog no longer lists still has to go
  // somewhere, so it gets its own group rather than vanishing from the screen.
  const orphans = [];
  for (const s of state.sessions) {
    if (buckets.has(s.goal)) buckets.get(s.goal).push(s);
    else orphans.push(s);
  }

  // Freshest first inside a group: what you trained most recently is what you
  // are most likely to want again. Anything never completed sorts by the day
  // it was saved, below everything that has actually been done.
  const recent = (s) => lastCompleted(s) || '';
  const bySession = (a, b) =>
    recent(b).localeCompare(recent(a)) || (b.date || '').localeCompare(a.date || '');

  const groups = [...buckets.entries()]
    .filter(([, list]) => list.length)
    .map(([goal, list]) => [goal, list.sort(bySession)]);

  if (orphans.length) groups.push([null, orphans.sort(bySession)]);

  return h(
    'div.stack',
    { style: 'gap:22px' },
    groups.map(([goal, list]) =>
      h(
        'div.stack',
        { style: 'gap:10px' },
        h(
          'div.goal-group',
          h('span.swatch.swatch-lg', { style: `background:${goalColor(goal)}` }),
          h('span.goal-group-name', goal ? goalLabel(goal) : t('saved.otherGoal')),
          h('span.card-meta', String(list.length))
        ),
        list.map((s) => savedRow(s))
      )
    )
  );
}

/**
 * One saved workout, on Home's card with its goal on the edge.
 *
 * The colour is a stripe rather than a pill because the group header above it
 * already names the goal — repeating the word on every card would be noise,
 * but the stripe keeps each card identifiable once the header has scrolled
 * away, and makes a long list scannable by colour alone.
 *
 * The goal is dropped from the meta line for the same reason. What is left is
 * what the header cannot tell you: how big it is, how long it takes, and
 * whether you have ever actually done it.
 */
function savedRow(s) {
  const exercises = sessionExercises(s);
  const built = buildSession(s, state.catalog, state.oneRm);

  return h(
    'div.home-card.saved-card',
    { style: `--gs:${goalColor(s.goal)}` },
    h(
      'div.saved-head',
      h('div.saved-name', s.name),
      h('div.saved-time', formatMinutes(built.totalMinutes))
    ),
    h(
      'div.stack',
      { style: 'gap:3px' },
      h(
        'div.saved-meta',
        `${tp('saved.lifts', exercises.length)} · ${t('saved.savedOn', { date: shortDate(s.date) })}`
      ),
      h(
        'div.saved-done',
        { class: lastCompleted(s) ? 'is-done' : '' },
        completionLine(s)
      )
    ),
    h(
      'div.row-actions',
      h(
        'button.btn.btn-sm.btn-goal',
        {
          onclick: () => {
            state.session = JSON.parse(JSON.stringify(s));
            saveDraft();
            go('plan');
          },
        },
        t('saved.load')
      ),
      h(
        'button.btn.btn-sm',
        {
          onclick: () => {
            // Same question as finishing a session, for the same reason: this
            // writes a completed workout to the log, so it should be able to
            // carry how hard it was.
            rpeSheet({
              title: t('rpe.title'),
              body: t('rpe.bodySaved', { name: s.name }),
              onPick: (rpe) => flash(tp('live.logged', logWholeSession(s, today(), rpe))),
            });
          },
        },
        t('saved.again')
      ),
      h(
        'button.btn.btn-sm',
        { onclick: () => printWorkout(s), 'aria-label': t('plan.export') },
        icon(ICONS.print, { size: 15 })
      ),
      h(
        'button.btn.btn-sm.btn-danger',
        {
          onclick: () => {
            state.sessions = state.sessions.filter((x) => x.id !== s.id);
            store.setSessions(state.sessions);
            render();
          },
          'aria-label': t('log.delete'),
        },
        icon(ICONS.trash, { size: 15 })
      )
    )
  );
}

/**
 * Log a saved workout as done again without stepping through it. Uses the
 * prescribed set count and the mid-range weight, since nothing was ticked.
 */
function logWholeSession(session, date, rpe = null) {
  const entries = [];
  for (const ex of sessionExercises(session)) {
    for (let n = 1; n <= setsFor(ex, session); n += 1) {
      entries.push({
        id: newId(),
        date,
        sessionId: session.id,
        sessionName: session.name,
        exerciseId: ex.id,
        goal: session.goal,
        setNo: n,
        weight: defaultWeight(ex, session),
        reps: null,
        rpe,
        auto: true,
      });
    }
  }
  state.log = [...entries, ...state.log];
  store.setLog(state.log);
  recordCompletion(session, date, entries.length, rpe);
  return entries.length;
}

/* ------------------------------------------------------------------ log */

function viewLog() {
  const window30 = withinDays(state.log, WINDOW_DAYS, today());
  const mix = goalMixFromLog(window30, REPORT_GOALS(state.catalog.vocabulary.goals));
  const muscles = musclesetsFromLog(window30, state.catalog.byId);

  return h(
    'div.screen',
    h(
      'div.screen-inner',
      screenHead(t('log.kicker', { n: window30.length }), t('log.title')),
      mix.total ? balancePanel(mix) : empty(t('log.empty'), t('log.emptyHint')),
      rpePanel(),
      mix.total > 0 && muscleDisclosure(muscles),
      historyDisclosure(),
      dataPanel()
    )
  );
}

function balancePanel(mix) {
  const parts = mixParts(mix);
  const top = parts.reduce((a, b) => (a.pct >= b.pct ? a : b));

  return h(
    'div',
    {
      style:
        'border:1px solid var(--color-divider);border-radius:var(--radius-lg);padding:18px;display:flex;flex-direction:column;gap:16px',
    },
    mixBar(mix, true),
    h(
      'div.mix-rows',
      parts.map((part) =>
        h(
          'div.mix-row',
          h('span.swatch', { style: `background:${part.color}` }),
          h('span.mix-row-name', part.label),
          h('span.mix-row-sets', tp('log.sets', part.sets)),
          h('span.mix-row-pct', `${part.pct}%`)
        )
      )
    ),
    // Stated, not editorialised: the reader is told which goal dominates and
    // by how much, and nothing is inferred about whether that is good.
    h('p.hint', `${top.label} carries ${top.pct}% of the last ${WINDOW_DAYS} days.`)
  );
}

/* ---------------------------------------------------------- exertion chart */

function setPref(key, value) {
  state.prefs = { ...state.prefs, [key]: value };
  store.setPrefs(state.prefs);
  render();
}

/**
 * Rate of perceived exertion over time.
 *
 * Two controls, and they do different kinds of thing, so they are different
 * kinds of control: the range is a choice among three (chips, like every
 * other budget and filter in the app) and the style is one thing or the other
 * (a switch). Both are remembered in prefs, because a chart you have to
 * re-configure on every visit is a chart you stop visiting.
 */
function rpePanel() {
  const range = RPE_RANGES.includes(state.prefs.rpeRange) ? state.prefs.rpeRange : 'week';
  const style = state.prefs.rpeStyle === 'bar' ? 'bar' : 'line';
  const series = rpeSeries(state.log, range, today());

  return h(
    'div.panel',
    h(
      'div.panel-head',
      h('div.panel-title', t('rpe.panelTitle')),
      series.average != null &&
        h(
          'span.rpe-average',
          t('rpe.average', { n: series.average.toFixed(1) })
        )
    ),
    h(
      'div.rpe-controls',
      h(
        'div.chips',
        RPE_RANGES.map((r) =>
          h(
            'button.chip',
            {
              class: range === r ? 'is-on' : '',
              'aria-pressed': String(range === r),
              onclick: () => setPref('rpeRange', r),
            },
            t(`rpe.range.${r}`)
          )
        )
      ),
      styleSwitch(style)
    ),
    series.count
      ? h(
          'div.stack',
          { style: 'gap:8px' },
          rpeChart(series, style, range),
          h('p.hint', tp('rpe.note', series.count))
        )
      : empty(t('rpe.empty'), t('rpe.emptyHint'))
  );
}

/**
 * Line or bar, as a two-position slider.
 *
 * Both labels stay on screen and both are hit targets, so the control says
 * what it will become rather than only what it currently is — a lone
 * "Bar" toggle reads as either the current state or the next one, and there
 * is no way to tell which from looking.
 */
function styleSwitch(style) {
  const pick = (value) => () => {
    if (value !== style) setPref('rpeStyle', value);
  };

  return h(
    'div.switch',
    { role: 'group', 'aria-label': t('rpe.style') },
    h(
      'button.switch-label',
      { class: style === 'line' ? 'is-on' : '', 'aria-pressed': String(style === 'line'), onclick: pick('line') },
      t('rpe.line')
    ),
    h(
      'button.switch-track',
      {
        role: 'switch',
        'aria-checked': String(style === 'bar'),
        'aria-label': t('rpe.style'),
        onclick: pick(style === 'bar' ? 'line' : 'bar'),
      },
      h('span.switch-thumb', { class: style === 'bar' ? 'is-right' : '' })
    ),
    h(
      'button.switch-label',
      { class: style === 'bar' ? 'is-on' : '', 'aria-pressed': String(style === 'bar'), onclick: pick('bar') },
      t('rpe.bar')
    )
  );
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(name, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

const CHART = { w: 320, h: 152, left: 22, right: 6, top: 10, bottom: 22 };

/**
 * The chart itself.
 *
 * The scale runs 0–10, not 5–10. Real ratings cluster in the top half, so a
 * cropped axis would spread them out beautifully and overstate every
 * difference between one session and the next; the whole point of plotting a
 * subjective 1–10 is to see how it moves, and an axis that exaggerates the
 * movement answers a question nobody asked.
 *
 * Points are placed at band centres in both styles, so flipping the switch
 * moves the ink without moving the data — the third bar and the third dot are
 * the same session in the same place.
 */
function rpeChart(series, style, range) {
  const { points } = series;
  const plotW = CHART.w - CHART.left - CHART.right;
  const plotH = CHART.h - CHART.top - CHART.bottom;
  const band = plotW / points.length;
  const x = (i) => CHART.left + band * (i + 0.5);
  const y = (v) => CHART.top + plotH - (v / RPE_MAX) * plotH;
  const baseline = CHART.top + plotH;

  const node = svg('svg', {
    class: 'rpe-chart',
    viewBox: `0 0 ${CHART.w} ${CHART.h}`,
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': tp('rpe.chartLabel', series.count, {
      range: t(`rpe.range.${range}`).toLowerCase(),
      avg: series.average != null ? series.average.toFixed(1) : '—',
    }),
  });

  for (const v of [0, 5, RPE_MAX]) {
    node.appendChild(
      svg('line', { class: 'rpe-grid', x1: CHART.left, x2: CHART.w - CHART.right, y1: y(v), y2: y(v) })
    );
    const label = svg('text', { class: 'rpe-axis', x: CHART.left - 5, y: y(v) + 3, 'text-anchor': 'end' });
    label.textContent = String(v);
    node.appendChild(label);
  }

  if (style === 'bar') {
    const width = Math.min(band * 0.62, 16);
    points.forEach((p, i) => {
      if (p.rpe == null) return;
      node.appendChild(
        svg('rect', {
          class: 'rpe-bar',
          x: x(i) - width / 2,
          y: y(p.rpe),
          width,
          height: Math.max(1, baseline - y(p.rpe)),
          rx: 2,
        })
      );
    });
  } else {
    // The line joins the sessions, skipping straight over the days between
    // them. Breaking it at every empty bucket was the first instinct and it
    // is wrong here: nobody trains seven days a week, so on a daily axis the
    // line would almost never have two adjacent points to join and the style
    // would draw nothing at all. The dots are the measurements; the segments
    // between them are the interpolation, and a long empty stretch shows up
    // as exactly that — a long segment with nothing on it.
    const known = points
      .map((p, i) => (p.rpe == null ? null : `${x(i)},${y(p.rpe)}`))
      .filter(Boolean);

    if (known.length > 1) {
      node.appendChild(svg('polyline', { class: 'rpe-line', points: known.join(' ') }));
    }

    points.forEach((p, i) => {
      if (p.rpe == null) return;
      node.appendChild(svg('circle', { class: 'rpe-dot-mark', cx: x(i), cy: y(p.rpe), r: 2.8 }));
    });
  }

  points.forEach((p, i) => {
    const text = rpeTickLabel(p, i, range, points.length);
    if (!text) return;
    const tick = svg('text', {
      class: 'rpe-tick',
      x: x(i),
      y: CHART.h - 6,
      'text-anchor': 'middle',
    });
    tick.textContent = text;
    node.appendChild(tick);
  });

  // The bars and dots carry no numbers, so every bucket gets a native tooltip
  // with its date and value -- including the empty ones, which is how you tell
  // "no session" apart from "a gap in the chart for some other reason".
  points.forEach((p, i) => {
    const hit = svg('rect', {
      class: 'rpe-hit',
      x: CHART.left + band * i,
      y: CHART.top,
      width: band,
      height: plotH,
    });
    const title = svg('title');
    title.textContent =
      p.rpe == null
        ? `${rpeBucketLabel(p, range)} — ${t('rpe.noSession')}`
        : `${rpeBucketLabel(p, range)} — ${t('rpe.tooltip', {
            n: p.rpe.toFixed(1),
            sessions: p.sessions,
          })}`;
    hit.appendChild(title);
    node.appendChild(hit);
  });

  return h('div.rpe-chart-wrap', node);
}

function rpeBucketLabel(point, range) {
  const d = new Date(`${point.from}T00:00:00`);
  return range === 'year'
    ? `${d.toLocaleString('en', { month: 'long' })} ${d.getFullYear()}`
    : shortDate(point.from);
}

/**
 * Which buckets get a label under them.
 *
 * Seven and twelve both fit; thirty do not, so the month view labels every
 * fifth day and lets the tooltip carry the rest.
 */
function rpeTickLabel(point, i, range, total) {
  if (range === 'week') return weekdayShort(point.from);
  const d = new Date(`${point.from}T00:00:00`);
  if (range === 'year') return d.toLocaleString('en', { month: 'narrow' });
  return i % 5 === 0 || i === total - 1 ? String(d.getDate()) : null;
}

function muscleDisclosure(rows) {
  if (!rows.length) return null;

  return h(
    'details',
    { open: state.logDetail, ontoggle: (e) => (state.logDetail = e.target.open) },
    h(
      'summary.btn-link',
      state.logDetail ? t('log.hideMuscles') : t('log.showMuscles'),
      icon(ICONS.chevronDown, { size: 12 })
    ),
    h(
      'div.stack',
      { style: 'gap:14px;padding-top:14px' },
      muscleRoleKey(),
      h(
        'div.mbar-head',
        h('span.mbar-head-name', t('log.muscleCol')),
        h('span.mbar-head-spacer'),
        h('span.mbar-head-value', t('log.setsCol'))
      ),
      // The number is the total. The split between the two roles is what the
      // pair of bars and the legend above them show -- a bare "12/6" beside
      // them said neither which number was which nor what of.
      muscleBars(rows),
      h('p.hint', t('log.setsNote'))
    )
  );
}

function historyDisclosure() {
  const recent = state.log.slice(0, 12);

  return h(
    'details',
    { open: state.logHistory, ontoggle: (e) => (state.logHistory = e.target.open) },
    h('summary.btn-link', t('log.history'), icon(ICONS.chevronDown, { size: 12 })),
    h(
      'div.stack',
      { style: 'gap:16px;padding-top:14px' },
      manualLogForm(),
      state.log.length
        ? h(
            'div.stack',
            { style: 'gap:6px' },
            h('div.kicker', t('log.recent')),
            h(
              'div.hist',
              recent.map((entry) => {
                const ex = state.catalog.byId.get(entry.exerciseId);
                return h(
                  'div.hist-row',
                  h('span.hist-date', entry.date),
                  h('span.hist-name', ex ? localized(ex.name) : '?'),
                  h(
                    'span.hist-num',
                    entry.weight != null ? kg(entry.weight) : '—',
                    entry.reps ? ` × ${entry.reps}` : ''
                  ),
                  h(
                    'button.icon-btn',
                    {
                      style: 'width:32px;height:28px',
                      'aria-label': t('log.delete'),
                      onclick: () => {
                        state.log = state.log.filter((x) => x.id !== entry.id);
                        store.setLog(state.log);
                        render();
                      },
                    },
                    icon(ICONS.trash, { size: 13 })
                  )
                );
              })
            ),
            state.log.length > recent.length &&
              h('p.hint', t('log.showAll', { n: state.log.length }))
          )
        : null,
      bestsSection()
    )
  );
}

function manualLogForm() {
  const draft = {
    date: today(),
    exerciseId: state.session.exerciseIds[0] ?? state.catalog.liftingPool[0].id,
    goal: state.session.goal,
    weight: '',
    reps: '',
    rpe: '',
  };

  // Manual log entry is weight × reps, so it offers lifts only. Conditioning
  // results are logged by their own block, not one set at a time.
  const options = state.catalog.liftingPool
    .filter((ex) => !ex.archived)
    .sort((a, b) => localized(a.name).localeCompare(localized(b.name)));

  return h(
    'form.log-form',
    {
      onsubmit: (e) => {
        e.preventDefault();
        if (!draft.weight || !draft.reps) return;
        // A <select> hands back text, and ids are numbers for the workbook's
        // exercises and strings for the user's own, so the catalog resolves it
        // rather than this parsing it.
        const exerciseId = state.catalog.resolveId(draft.exerciseId);
        if (exerciseId == null) return;
        state.log.unshift({
          id: newId(),
          date: draft.date,
          sessionName: '',
          exerciseId,
          goal: draft.goal,
          setNo: 1,
          weight: Number(draft.weight),
          reps: Number(draft.reps),
          rpe: draft.rpe === '' ? null : Number(draft.rpe),
        });
        store.setLog(state.log);
        state.logHistory = true;
        render();
      },
    },
    field(t('log.date'), h('input.input', { type: 'date', value: draft.date, oninput: (e) => (draft.date = e.target.value) })),
    field(
      t('log.exercise'),
      h(
        'select.input',
        { onchange: (e) => (draft.exerciseId = e.target.value) },
        options.map((ex) =>
          h('option', { value: ex.id, selected: ex.id === draft.exerciseId }, localized(ex.name))
        )
      )
    ),
    field(
      t('log.goal'),
      h(
        'select.input',
        { onchange: (e) => (draft.goal = e.target.value) },
        state.catalog.vocabulary.goals.map((g) =>
          h('option', { value: g, selected: g === draft.goal }, goalLabel(g))
        )
      )
    ),
    field(`${t('log.weight')} (${t('units.kg')})`, h('input.input.input-num', { type: 'number', step: '0.5', inputmode: 'decimal', oninput: (e) => (draft.weight = e.target.value) })),
    field(t('log.reps'), h('input.input.input-num', { type: 'number', min: 1, inputmode: 'numeric', oninput: (e) => (draft.reps = e.target.value) })),
    field(t('log.rpe'), h('input.input.input-num', { type: 'number', min: 1, max: 10, step: '0.5', oninput: (e) => (draft.rpe = e.target.value) })),
    h('button.btn.btn-goal', { type: 'submit' }, t('log.add'))
  );
}

function field(label, control, hint) {
  return h('div.field', h('span.field-label', label), control, hint && h('p.hint', hint));
}

function bestsSection() {
  const rows = summariseProgress(state.log, state.catalog.byId).slice(0, 10);
  if (!rows.length) return null;

  return h(
    'div.stack',
    { style: 'gap:6px' },
    h('div.kicker', t('log.bests')),
    h(
      'div.hist',
      rows.map((r) =>
        h(
          'div.hist-row',
          h('span.hist-name', localized(r.exercise.name)),
          h('span.hist-num', `${num(r.bestEstimated1Rm, 1)} ${t('units.kg')} ${t('log.best1rm')}`),
          h('span.hist-num', { style: 'color:var(--t-45)' }, `${r.sets} × `)
        )
      )
    )
  );
}

function dataPanel() {
  return h(
    'details',
    h('summary.btn-link', t('log.data'), icon(ICONS.chevronDown, { size: 12 })),
    h(
      'div.stack',
      { style: 'gap:12px;padding-top:14px' },
      h('p.hint', t('log.dataHint')),
      h(
        'div.row-actions',
        h(
          'button.btn.btn-sm',
          {
            onclick: () => {
              const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], {
                type: 'application/json',
              });
              const a = h('a', { href: URL.createObjectURL(blob), download: `workout-companion-${today()}.json` });
              a.click();
              URL.revokeObjectURL(a.href);
            },
          },
          t('log.export')
        ),
        h(
          'label.btn.btn-sm',
          t('log.import'),
          h('input', {
            type: 'file',
            accept: 'application/json',
            style: 'display:none',
            onchange: async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                store.importAll(JSON.parse(await file.text()));
                state.sessions = store.getSessions();
                state.log = store.getLog();
                state.oneRm = store.getOneRm();
                state.prefs = store.getPrefs();
                state.customExercises = store.getCustomExercises();
                refreshCatalog();
                render();
              } catch (err) {
                alert(err.message);
              }
            },
          })
        ),
        h(
          'button.btn.btn-sm.btn-danger',
          {
            onclick: () => {
              if (!confirm(t('log.clearConfirm'))) return;
              store.clearAll();
              state.sessions = [];
              state.log = [];
              state.oneRm = {};
              state.prefs = {};
              state.customExercises = [];
              state.live = null;
              state.session = blankSession();
              refreshCatalog();
              go('home');
            },
          },
          t('log.clear')
        )
      )
    )
  );
}

/* -------------------------------------------------------------- library */

const FILTER_KEYS = ['equipment', 'pattern', 'primary', 'secondary'];

/**
 * Filters are exact and independent of one another.
 *
 * Primary and supporting muscle are separate controls rather than one combined
 * "muscle group": asking for exercises where shoulders are the target is a
 * different question from asking where they only assist, and answering both at
 * once made the result unreadable.
 */
function matchesFilters(ex, f) {
  if (f.equipment && ex.equipment !== f.equipment) return false;
  if (f.pattern && ex.pattern !== f.pattern) return false;
  if (f.primary && ex.primary !== f.primary) return false;
  if (f.secondary && !(ex.secondary || []).includes(f.secondary)) return false;
  return true;
}

/**
 * Search matches the exercise name only.
 *
 * It used to also match muscle, pattern, equipment and profile, which meant
 * typing "shoulders" returned every exercise that merely mentions shoulders
 * anywhere. Those are all dedicated filters now, so the search box does one
 * predictable thing.
 */
function matchesQuery(ex, q) {
  if (!q) return true;
  return ex.name.en.toLowerCase().includes(q) || (ex.name.sv || '').toLowerCase().includes(q);
}

function viewLibrary() {
  const list = h('div.stack');
  const count = h('div.kicker');
  const filterCount = h('span.filter-count');
  const panel = h('div.filter-panel');

  const activeFilters = () => FILTER_KEYS.filter((k) => state.libFilters[k]).length;

  const refresh = () => {
    const q = state.libQuery.trim().toLowerCase();
    // Archived exercises are still in the catalog so old workouts and log
    // entries keep resolving, but they are not on offer here or in the picker.
    // Lifts only for now. Every card here offers a 1RM field and filters on
    // equipment and pattern, and a rowing machine answers none of those
    // questions -- conditioning movements need their own shelf, not this one.
    const results = state.catalog.liftingPool.filter(
      (ex) => !ex.archived && matchesFilters(ex, state.libFilters) && matchesQuery(ex, q)
    );

    const n = activeFilters();
    filterCount.textContent = n ? String(n) : '';
    filterCount.hidden = n === 0;

    // The kicker doubles as the result count, so a filtered list never looks
    // like the whole library.
    count.textContent = state.libPicking
      ? t('library.picking', { n: state.session.exerciseIds.length })
      : q || n
        ? tp('library.matching', results.length)
        : t('library.kicker', { n: results.length });

    // An empty result with filters on has an off-screen cause when the panel
    // is folded, so unfold it — the reason and the way out arrive together.
    if (!results.length && n > 0 && !state.libFiltersOpen) {
      state.libFiltersOpen = true;
      panel.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
    }

    // Emptying the list collapses the page height, which makes the browser
    // clamp the scroll position to whatever still fits -- i.e. jump to the
    // top. Restoring afterwards keeps expanding a row or nudging a 1RM from
    // throwing you back up the library.
    const scrollY = window.scrollY;
    mount(
      list,
      results.length
        ? results.map((ex) => libraryItem(ex, refresh))
        : empty(t('library.noResults'), t('library.noResultsHint'))
    );
    if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY });
  };

  const select = (key, label, options, anyLabel) =>
    h(
      'label.field',
      h('span.field-label', label),
      h(
        'select.input',
        {
          value: state.libFilters[key],
          onchange: (e) => {
            state.libFilters[key] = e.target.value;
            refresh();
          },
        },
        h('option', { value: '' }, anyLabel),
        options.map((o) =>
          h('option', { value: o, selected: state.libFilters[key] === o }, o)
        )
      )
    );

  const v = state.catalog.vocabulary;
  mount(
    panel,
    select('equipment', t('library.equipment'), v.equipment, t('library.anyEquipment')),
    select('pattern', t('library.pattern'), v.patterns, t('library.anyPattern')),
    // Primary offers only the muscles that are actually somebody's primary;
    // supporting offers the full vocabulary, since a group like Triceps is
    // very often a supporting muscle and rarely the headline one.
    select('primary', t('library.primary'), v.primaryMuscles, t('library.anyPrimary')),
    select('secondary', t('library.secondary'), v.muscles, t('library.anySecondary')),
    h(
      'button.btn.btn-sm',
      {
        type: 'button',
        onclick: () => {
          for (const k of FILTER_KEYS) state.libFilters[k] = '';
          for (const el of panel.querySelectorAll('select')) el.value = '';
          refresh();
        },
      },
      t('library.clearFilters')
    )
  );

  panel.classList.toggle('is-open', state.libFiltersOpen);

  const toggle = h(
    'button.btn.filter-toggle',
    {
      type: 'button',
      'aria-expanded': String(state.libFiltersOpen),
      onclick: () => {
        state.libFiltersOpen = !state.libFiltersOpen;
        panel.classList.toggle('is-open', state.libFiltersOpen);
        toggle.setAttribute('aria-expanded', String(state.libFiltersOpen));
      },
    },
    t('library.filters'),
    filterCount
  );

  const search = h('input.input', {
    type: 'search',
    value: state.libQuery,
    placeholder: t('library.search'),
    oninput: (e) => {
      state.libQuery = e.target.value;
      refresh();
    },
  });

  refresh();

  // The form takes over the screen rather than sitting above the list: it has
  // eight fields, and leaving 167 exercises scrolling underneath it made the
  // page read as a list that had sprouted a form rather than as a form.
  if (state.libDraftExercise) {
    return h(
      'div.screen',
      h(
        'div.screen-inner',
        { style: 'gap:18px' },
        backLink(t('tab.library'), () => {
          state.libDraftExercise = null;
          render();
        }),
        exerciseForm(state.libDraftExercise)
      )
    );
  }

  return h(
    'div.screen',
    h(
      'div.screen-inner',
      { style: 'gap:18px' },
      state.libPicking && backLink(t('tab.build'), stopPicking),
      h('div.stack', { style: 'gap:2px' }, count, h('h1.screen-title', t('library.title'))),
      h('div.stack', { style: 'gap:10px' }, h('div.filter-bar', search, toggle), panel),
      list,
      h(
        'button.btn.btn-block',
        { onclick: () => startExercise(null) },
        icon(ICONS.plus, { size: 15 }),
        t('custom.add')
      ),
      archivedDisclosure()
    ),
    state.libPicking &&
      h(
        'div.sticky-actions',
        h('button.btn.btn-goal.btn-lg.btn-block', { onclick: stopPicking }, t('library.donePicking'))
      )
  );
}

/* ------------------------------------------------- the user's own exercises

   The compendium is 167 exercises and it is not going to cover everyone's
   gym. A user exercise is the same shape as a workbook one -- id, name,
   equipment, pattern, primary and supporting muscles, profile, cue -- so
   every downstream feature works on it without knowing it is different: the
   warm-up triggers off its pattern and muscles, the prescription comes from
   its profile, the body map paints it, the log counts it, and it has a 1RM
   like anything else.

   The one field with no obvious answer is the prescription profile, because
   it is the workbook's own vocabulary rather than a property of the movement.
   The form asks for it plainly and says what it decides, which is better than
   guessing it from the pattern and quietly prescribing the wrong thing.
   ------------------------------------------------------------------------ */

function blankExercise() {
  return {
    id: null,
    name: '',
    equipment: '',
    pattern: '',
    profile: '',
    primary: '',
    secondary: [],
    cue: '',
    error: null,
  };
}

function startExercise(ex) {
  state.libDraftExercise = ex
    ? {
        id: ex.id,
        name: localized(ex.name),
        equipment: ex.equipment,
        pattern: ex.pattern,
        profile: ex.profile,
        primary: ex.primary,
        secondary: [...(ex.secondary || [])],
        cue: ex.cue || '',
        error: null,
      }
    : blankExercise();
  render();
}

function exerciseForm(draft) {
  const v = state.catalog.vocabulary;
  const editing = draft.id != null;

  const text = (key, label, placeholder) =>
    field(
      label,
      h('input.input', {
        type: 'text',
        value: draft[key],
        placeholder,
        // No render on keystroke -- rebuilding the form would take the caret
        // with it, exactly as the session name field avoids.
        oninput: (e) => {
          draft[key] = e.target.value;
        },
      })
    );

  // Selects do re-render, unlike the text fields: picking a profile has to
  // bring up its prescription preview, and picking a primary muscle has to
  // drop that muscle out of the supporting chips below. There is no caret to
  // lose in a <select>, so the cost the text fields are avoiding isn't paid.
  const choose = (key, label, options, placeholder) =>
    field(
      label,
      h(
        'select.input',
        {
          onchange: (e) => {
            draft[key] = e.target.value;
            if (key === 'primary') {
              draft.secondary = draft.secondary.filter((m) => m !== e.target.value);
            }
            render();
          },
        },
        h('option', { value: '' }, placeholder),
        options.map((o) => h('option', { value: o, selected: draft[key] === o }, o))
      )
    );

  return h(
    'form.stack',
    {
      style: 'gap:18px',
      onsubmit: (e) => {
        e.preventDefault();
        submitExercise(draft);
      },
    },
    screenHead(t(editing ? 'custom.editKicker' : 'custom.addKicker'), t('custom.title')),
    draft.error && h('p.form-error', { role: 'alert' }, draft.error),

    text('name', t('custom.name'), t('custom.namePlaceholder')),
    choose('equipment', t('library.equipment'), v.equipment, t('custom.choose')),
    choose('pattern', t('library.pattern'), v.patterns, t('custom.choose')),
    choose('primary', t('library.primary'), v.primaryMuscles, t('custom.choose')),

    h(
      'div.field',
      h('span.field-label', t('library.secondary')),
      h(
        'div.muscle-chips',
        v.muscles
          .filter((m) => m !== 'Full body' && m !== draft.primary)
          .map((m) => {
            const on = draft.secondary.includes(m);
            return h(
              'button.chip.chip-sm',
              {
                type: 'button',
                class: on ? 'is-on' : '',
                'aria-pressed': String(on),
                onclick: () => {
                  draft.secondary = on
                    ? draft.secondary.filter((x) => x !== m)
                    : [...draft.secondary, m];
                  render();
                },
              },
              m
            );
          })
      ),
      h('p.hint', t('custom.secondaryHint'))
    ),

    h(
      'div.stack',
      { style: 'gap:6px' },
      choose('profile', t('custom.profile'), v.profiles, t('custom.choose')),
      h('p.hint', t('custom.profileHint')),
      draft.profile && profilePreview(draft.profile)
    ),

    text('cue', t('custom.cue'), t('custom.cuePlaceholder')),

    h(
      'div.row-actions',
      h('button.btn.btn-goal', { type: 'submit' }, t(editing ? 'custom.save' : 'custom.create')),
      h(
        'button.btn',
        {
          type: 'button',
          onclick: () => {
            state.libDraftExercise = null;
            render();
          },
        },
        t('custom.cancel')
      )
    )
  );
}

/**
 * What the chosen profile will actually prescribe, for the current goal.
 *
 * The profile names mean nothing on their own -- "Heavy compound" is a row in
 * a lookup table, not a description of your exercise -- so the form shows the
 * sets, reps, load and rest it resolves to before you commit to it.
 */
function profilePreview(profile) {
  const p = getPrescription(state.catalog.prescriptionIndex, profile, state.session.goal);
  if (!p) return null;

  return h(
    'div.profile-preview',
    h('div.kicker', t('custom.previewFor', { goal: goalLabel(state.session.goal) })),
    h(
      'span.figures',
      figure(p.sets, t('figures.sets')),
      figure(p.reps, t('figures.reps')),
      figure(p.load.replace(/ of 1RM$/, ''), t('figures.load')),
      figure(p.rest, t('figures.rest'))
    )
  );
}

function submitExercise(draft) {
  const name = draft.name.trim();
  const required = [
    [name, t('custom.name')],
    [draft.equipment, t('library.equipment')],
    [draft.pattern, t('library.pattern')],
    [draft.primary, t('library.primary')],
    [draft.profile, t('custom.profile')],
  ];
  const missing = required.filter(([value]) => !value).map(([, label]) => label);

  if (missing.length) {
    draft.error = t('custom.missing', { fields: missing.join(', ') });
    render();
    return;
  }

  const record = {
    // A string id, so it can never collide with the workbook's numeric ones
    // however many times the workbook is re-extracted.
    id: draft.id ?? `u${newId()}`,
    name: { en: name, sv: '' },
    equipment: draft.equipment,
    pattern: draft.pattern,
    primary: draft.primary,
    secondary: draft.secondary.filter((m) => m !== draft.primary),
    profile: draft.profile,
    cue: draft.cue.trim(),
    custom: true,
    archived: false,
  };

  const at = state.customExercises.findIndex((x) => x.id === record.id);
  if (at >= 0) state.customExercises[at] = { ...state.customExercises[at], ...record };
  else state.customExercises.push(record);

  saveCustomExercises();
  state.libDraftExercise = null;
  state.libOpen = record.id;
  flash(t(at >= 0 ? 'custom.saved' : 'custom.created'));
}

/** Everywhere an exercise id can still be referred to. */
function referencesTo(id) {
  const inSessions = state.sessions.filter((s) => (s.exerciseIds || []).includes(id));
  return {
    sets: state.log.filter((e) => e.exerciseId === id).length,
    sessions: inSessions.length,
    inDraft: (state.session.exerciseIds || []).includes(id),
    inLive: !!state.live && (state.live.session.exerciseIds || []).includes(id),
  };
}

/**
 * Remove a user exercise — by deleting it, or by archiving it when something
 * still points at it.
 *
 * Deleting one that a log entry refers to would not free anything; it would
 * quietly turn that entry into a row the app cannot name, and drop its sets
 * out of every muscle and goal total as though the training had not happened.
 * So an exercise in use is archived instead: gone from the library and the
 * picker, still resolvable everywhere it is mentioned, and restorable. Only a
 * genuinely unreferenced one is deleted outright.
 */
function removeExercise(ex) {
  const refs = referencesTo(ex.id);
  const orphan = !refs.sets && !refs.sessions && !refs.inDraft && !refs.inLive;

  // Already archived and asked again: the user has seen what it is attached to
  // and wants it gone anyway. Say what that costs, then do it.
  if (orphan || ex.archived) {
    confirmSheet({
      title: t('custom.deleteTitle', { name: localized(ex.name) }),
      body: orphan ? t('custom.deleteBody') : tp('custom.deleteUsedBody', refs.sets),
      confirmLabel: t('custom.delete'),
      cancelLabel: t('custom.cancel'),
      onConfirm: () => {
        state.customExercises = state.customExercises.filter((x) => x.id !== ex.id);
        saveCustomExercises();
        state.libOpen = null;
        flash(t('custom.deleted'));
      },
    });
    return;
  }

  const workouts = refs.sessions + (refs.inDraft ? 1 : 0) + (refs.inLive ? 1 : 0);
  // Only the counts that are actually non-zero, so the sentence never opens
  // with "0 logged sets and".
  const clauses = [
    refs.sets > 0 && tp('custom.refSets', refs.sets),
    workouts > 0 && tp('custom.refWorkouts', workouts),
  ].filter(Boolean);

  confirmSheet({
    title: t('custom.archiveTitle', { name: localized(ex.name) }),
    body: tp('custom.archiveBody', refs.sets + workouts, {
      refs: clauses.join(t('custom.refJoin')),
    }),
    confirmLabel: t('custom.archive'),
    cancelLabel: t('custom.cancel'),
    onConfirm: () => setArchived(ex.id, true),
  });
}

function setArchived(id, archived) {
  const at = state.customExercises.findIndex((x) => x.id === id);
  if (at < 0) return;
  state.customExercises[at] = { ...state.customExercises[at], archived };
  saveCustomExercises();
  state.libOpen = null;
  flash(t(archived ? 'custom.archived' : 'custom.restored'));
}

function archivedDisclosure() {
  const rows = state.customExercises.filter((x) => x.archived);
  if (!rows.length) return null;

  return h(
    'details',
    { open: state.libArchiveOpen, ontoggle: (e) => (state.libArchiveOpen = e.target.open) },
    h(
      'summary.btn-link',
      t('custom.archivedList', { n: rows.length }),
      icon(ICONS.chevronDown, { size: 12 })
    ),
    h(
      'div.stack',
      { style: 'gap:10px;padding-top:14px' },
      h('p.hint', t('custom.archivedHint')),
      rows.map((ex) =>
        h(
          'div.saved-row',
          h(
            'div',
            h('div.saved-name', localized(ex.name)),
            h('div.saved-meta', `${ex.equipment} · ${ex.pattern} · ${ex.primary}`)
          ),
          h(
            'div.row-actions',
            h('button.btn.btn-sm', { onclick: () => setArchived(ex.id, false) }, t('custom.restore')),
            h(
              'button.btn.btn-sm.btn-danger',
              { onclick: () => removeExercise(ex), 'aria-label': t('custom.delete') },
              icon(ICONS.trash, { size: 15 })
            )
          )
        )
      )
    )
  );
}

function stopPicking() {
  state.libPicking = false;
  go('build');
}

function libraryItem(ex, refresh) {
  const picked = state.session.exerciseIds.includes(ex.id);
  const rm = state.oneRm[ex.id];
  const open = state.libOpen === ex.id;

  const togglePick = () => {
    if (picked) {
      state.session.exerciseIds = state.session.exerciseIds.filter((id) => id !== ex.id);
      delete state.session.loads[ex.id];
    } else {
      state.session.exerciseIds.push(ex.id);
    }
    markHandEdited();
    saveDraft();
    refresh();
  };

  const setRm = (value) => {
    if (value <= 0) delete state.oneRm[ex.id];
    else state.oneRm[ex.id] = value;
    store.setOneRm(state.oneRm);
    refresh();
  };

  return h(
    'div.lib-item',
    h(
      'button.lib-row',
      {
        'aria-pressed': state.libPicking ? String(picked) : null,
        onclick: () => {
          if (state.libPicking) {
            togglePick();
          } else {
            state.libOpen = open ? null : ex.id;
            refresh();
          }
        },
      },
      state.libPicking &&
        h(
          'span.tick.tick-square',
          { class: picked ? 'is-on' : '' },
          icon(ICONS.check, { size: 11, stroke: '#161826' })
        ),
      h(
        'span.lib-main',
        h(
          'span.lib-name',
          localized(ex.name),
          ex.custom && h('span.badge-own', t('custom.badge'))
        ),
        h('span.lib-meta', `${ex.equipment} · ${ex.pattern}`),
        muscleLine(ex)
      ),
      h(
        'span.lib-rm',
        { class: rm ? '' : 'is-unset' },
        rm ? kg(rm) : t('library.setRm')
      )
    ),
    open &&
      !state.libPicking &&
      h(
        'div.lib-detail',
        ex.cue && h('p.lib-cue', ex.cue),
        weightStepper(
          t('library.oneRm'),
          rm ?? null,
          setRm,
          (delta) => setRm(steppedWeight(rm || 0, delta))
        ),
        ex.custom &&
          h(
            'div.row-actions',
            h('button.btn.btn-sm', { onclick: () => startExercise(ex) }, t('custom.edit')),
            h(
              'button.btn.btn-sm.btn-danger',
              { onclick: () => removeExercise(ex), 'aria-label': t('custom.remove') },
              icon(ICONS.trash, { size: 15 })
            )
          )
      )
  );
}

/**
 * Which muscles an exercise trains, and in which role.
 *
 * The role is spelled out and carries a coloured dot in the same red/amber
 * language as the body map. Naming only the primary muscle -- as this row used
 * to -- hid most of what an exercise actually does.
 */
function muscleLine(ex) {
  const secondary = ex.secondary || [];
  return h(
    'span.muscle-line',
    h(
      'span.muscle-part',
      h('span.muscle-dot.muscle-dot-p'),
      h('span.muscle-role', t('library.primaryShort')),
      h('span.muscle-names', ex.primary)
    ),
    secondary.length > 0 &&
      h(
        'span.muscle-part',
        h('span.muscle-dot.muscle-dot-s'),
        h('span.muscle-role', t('library.supportingShort')),
        h('span.muscle-names', secondary.join(', '))
      )
  );
}

/* ------------------------------------------------------------ print/PDF */

/**
 * No PDF library is installable here (and adding one would mean a build step),
 * so this renders a clean print sheet and hands off to the browser's own
 * "Save as PDF". That also means it prints properly on paper.
 */
function buildPrintSheet(session) {
  const built = buildSession(session, state.catalog, state.oneRm);
  const exercises = sessionExercises(session);
  const { primary, secondary } = musclesWorked(exercises);

  const section = (title, ...children) =>
    h('section.print-section', h('h2.print-h2', title), children);

  // Same reasoning as the plan heading: a session with no lifts is named and
  // described by its conditioning, and the goal is a lifting axis it does not
  // sit on. Without this the sheet printed a stale draft name over an EMOM.
  const blocks = session.conditioning?.blocks || [];
  const condTotal =
    blocks.reduce((sum, b) => sum + (b.minutes || 0), 0) +
    Math.max(0, blocks.length - 1) * BLOCK_REST_MINUTES;
  const liftless = exercises.length === 0 && blocks.length > 0;

  return h(
    'div.print-sheet',
    h(
      'header.print-head',
      h('h1.print-h1', liftless ? t('cond.title') : session.name || sessionTitle(session)),
      h(
        'p.print-meta',
        [
          session.date,
          liftless ? null : `${t('print.goal')}: ${goalLabel(session.goal)}`,
          `${t('print.estimate')}: ${formatMinutes(built.totalMinutes + condTotal)}`,
        ]
          .filter(Boolean)
          .join('  ·  ')
      )
    ),

    exercises.length > 0 &&
      section(
        t('plan.trains'),
        h(
          'div.print-body-map',
          renderBodyMap(primary, secondary, { front: t('map.front'), back: t('map.back') })
        )
      ),

    built.warmup.items.length > 0 &&
      section(
        `${t('phase.warmup')} — ${built.warmup.minutes} ${t('units.min')}`,
        h(
          'ol.print-list',
          built.warmup.items.map((d) =>
            h(
              'li',
              h('strong', localized(d.name)),
              ` · ${d.phase} · ${d.minutes} ${t('units.min')}`,
              h('div.print-how', localized(d.how))
            )
          )
        )
      ),

    built.main.length > 0 &&
      section(
        `${t('phase.main')} — ${built.mainMinutes} ${t('units.min')}`,
        h(
          'table.print-table',
          h(
            'thead',
            h(
              'tr',
              [
                t('print.exercise'),
                t('print.sets'),
                t('print.reps'),
                t('print.suggested'),
                t('print.rest'),
                t('print.yourLoad'),
              ].map((label) => h('th', label))
            )
          ),
          h(
            'tbody',
            built.main.map((row) =>
              h(
                'tr',
                h('td', localized(row.exercise.name)),
                h('td', row.prescription?.sets ?? '—'),
                h('td', row.prescription?.reps ?? '—'),
                h('td', loadLabel(row.suggested)),
                h('td', row.prescription?.rest ?? '—'),
                // Left blank on purpose: a printed sheet is something you write
                // on at the rack.
                h('td.print-blank', session.loads?.[row.exercise.id] ?? '')
              )
            )
          )
        )
      ),

    // Same position as on screen: after the work, before the cool-down. A
    // printed sheet is the one place a conditioning block is genuinely usable
    // today, since it needs no clock the app has not built yet.
    ...blocks.map((block, i) =>
      section(
        // Numbered on the sheet for the same reason as on screen, and only when
        // there is a sequence to number.
        `${blocks.length > 1 ? `${i + 1}. ` : ''}${t(`cond.format.${block.format}`)} — ${block.minutes} ${t('units.min')}`,
        h(
          'div',
          h('p.print-how', condMeta(block)),
          i > 0 && h('p.print-how', t('cond.betweenPrint', { n: BLOCK_REST_MINUTES })),
          h(
            'ol.print-list',
            block.movements.map((m) =>
              h(
                'li',
                h('strong', condAmount(m)),
                ` · ${localized(state.catalog.byId.get(m.ref)?.name) || '—'}`
              )
            )
          ),
          block.partner &&
            h('p.print-how', t(`cond.partnerNote.${block.partner.mode}`, { n: block.partner.people }))
        )
      )
    ),

    built.cooldown.items.length > 0 &&
      section(
        `${t('phase.cooldown')} — ${built.cooldown.minutes} ${t('units.min')}`,
        h(
          'ol.print-list',
          built.cooldown.items.map((m) =>
            h(
              'li',
              h('strong', localized(m.name)),
              ` · ${m.type} · ${m.minutes} ${t('units.min')}`,
              h('div.print-how', localized(m.how))
            )
          )
        )
      ),

    h('footer.print-foot', t('print.generated'))
  );
}

function printWorkout(session) {
  const sheet = buildPrintSheet(session);
  document.body.appendChild(sheet);
  document.documentElement.classList.add('is-printing');

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    document.documentElement.classList.remove('is-printing');
    sheet.remove();
    window.removeEventListener('afterprint', cleanup);
  };

  window.addEventListener('afterprint', cleanup);
  window.print();
  cleanup(); // print() blocks in Chrome/Edge/Firefox; afterprint covers the rest
}

init();

