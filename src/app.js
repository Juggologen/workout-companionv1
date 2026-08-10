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
  dailySets,
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
} from './engine.js';
import { renderBodyMap, musclesWorked } from './muscles.js';

/* ------------------------------------------------------------------ goals */

const GOAL_COLOR = {
  Explosivity: 'var(--goal-explosive)',
  Strength: 'var(--goal-strength)',
  Hypertrophy: 'var(--goal-hypertrophy)',
  'Muscular endurance': 'var(--goal-endurance)',
};

/** The prescription profile used to preview a goal before lifts are chosen. */
const REPRESENTATIVE_PROFILE = 'Heavy compound';

const WARM_BUDGETS = [10, 15, 20];
const COOL_BUDGETS = [0, 10, 20, 30];
const STREAK_DAYS = 14;
const WINDOW_DAYS = 30;

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
  state.customExercises = store.getCustomExercises();
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
  return NEUTRAL_SCREENS.has(state.screen)
    ? 'var(--home-accent)'
    : GOAL_COLOR[state.session.goal];
}

/**
 * Screens that are not a training mode, and so keep Home's yellow rather than
 * being repainted by whichever goal the draft session happens to hold. The
 * guide belongs here for the same reason Home does: it describes all four
 * goals, so wearing one of them would be picking a side.
 */
const NEUTRAL_SCREENS = new Set(['home', 'guide']);

function render() {
  const root = document.getElementById('app');
  saveDraft();

  const scrollY = window.scrollY;
  const sameScreen = root.dataset.screen === state.screen;
  const resume = state.live && state.screen !== 'live';

  const app = h(
    'div.app',
    {
      class: [NEUTRAL_SCREENS.has(state.screen) && 'is-home', resume && 'has-resume']
        .filter(Boolean)
        .join(' '),
      style: `--g:${screenAccent()}`,
    },
    screen(),
    resume && resumeBubble(),
    tabbar()
  );

  mount(root, app, state.flash && h('div.flash', icon(ICONS.check, { size: 14 }), state.flash));
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
    state.screen === 'plan' || state.screen === 'live' || state.screen === 'quick'
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

/* ---------------------------------------------------------------- today */

function viewHome() {
  const exercises = sessionExercises();
  const built = buildSession(state.session, state.catalog, state.oneRm);
  const mix = goalMixFromLog(withinDays(state.log, WINDOW_DAYS, today()), state.catalog.vocabulary.goals);

  return h(
    'div.screen',
    h(
      'div.screen-inner',
      h(
        'div.home-head',
        screenHead(formatToday(), t('today.title')),
        // Deliberately quiet: a question mark in the corner, not a banner. It
        // is the only thing on Home that isn't your training, and someone on
        // their fortieth session should be able to stop seeing it.
        h(
          'button.help-btn',
          {
            onclick: () => go('guide'),
            'aria-label': t('guide.open'),
            title: t('guide.open'),
          },
          icon(ICONS.help, { size: 18 })
        )
      ),
      plannedCard(exercises, built),
      quickCard(),
      streakCard(),
      weekCard(),
      balanceCard(mix),
      savedCard()
    )
  );
}

function formatToday() {
  const d = new Date();
  return `${d.getDate()} ${d.toLocaleString('en', { month: 'long' })}`;
}

function plannedCard(exercises, built) {
  if (!exercises.length) {
    return h(
      'div.card',
      h('div.card-accent-line'),
      h(
        'div.card-body',
        empty(t('today.noPlan'), t('today.noPlanHint')),
        h('button.btn.btn-goal.btn-block', { onclick: () => go('build') }, t('today.buildOne'))
      )
    );
  }

  // A session already running is reached through the bubble, so this button
  // always starts the planned one — and is held back while one is in progress
  // rather than silently doing nothing.
  const busy = !!state.live;

  return h(
    'div.card',
    h('div.card-accent-line'),
    h(
      'div.card-body',
      h(
        'div',
        { style: 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px' },
        h(
          'div.stack',
          { style: 'gap:5px' },
          h('div.kicker', t('today.planned')),
          h('div', { style: 'font-size:21px;font-weight:500;letter-spacing:-.015em' }, sessionTitle())
        ),
        h(
          'span.pill-goal',
          { style: `--gs:${GOAL_COLOR[state.session.goal]}` },
          goalLabel(state.session.goal)
        )
      ),
      h(
        'div.stat-row',
        stat(exercises.length, t('today.lifts')),
        stat(formatMinutes(built.totalMinutes), t('today.estimated')),
        stat(built.warmup.minutes, t('today.warmup'), t('units.min'))
      ),
      h(
        'div',
        { style: 'display:flex;gap:9px' },
        h(
          'button.btn.btn-goal',
          { style: 'flex:1', onclick: startSession, disabled: busy, title: busy ? t('today.busy') : null },
          busy ? t('today.busy') : t('today.start')
        ),
        h('button.btn', { style: 'flex:1', onclick: () => go('plan') }, t('today.seePlan'))
      )
    )
  );
}

/**
 * The way into Quick workout.
 *
 * Sits directly under the planned session because it is the alternative to
 * having one: the answer to "I am at the gym and have not thought about this".
 */
function quickCard() {
  return h(
    'button.panel-btn.quick-entry',
    { onclick: () => go('quick') },
    h(
      'div.panel-head',
      h(
        'div',
        { style: 'display:flex;align-items:center;gap:9px' },
        h('span.quick-spark', icon(ICONS.spark, { size: 15 })),
        h('div.panel-title', t('quick.title'))
      ),
      icon(ICONS.chevronRight, { size: 14 })
    ),
    h('p.hint', { style: 'text-align:left' }, t('quick.entryHint'))
  );
}

function stat(value, label, unit) {
  return h(
    'div.stat',
    h('div.stat-value', String(value), unit && h('span.unit', ` ${unit}`)),
    h('div.stat-label', label)
  );
}

function streakCard() {
  const days = dailySets(state.log, STREAK_DAYS, today());
  const max = days.reduce((m, d) => Math.max(m, d.sets), 0);
  const active = days.filter((d) => d.sets > 0).length;
  const first = days[0];

  return h(
    'div.stack',
    { style: 'gap:10px' },
    h('div.kicker', t('today.streak')),
    h(
      'div.streak',
      days.map((d) =>
        h('div.streak-bar', {
          // A day with work always reads as present; the rest is proportion.
          style: `height:${d.sets ? 12 + Math.round((d.sets / max) * 32) : 6}px;${
            d.sets ? `background:${d.daysAgo <= 2 ? 'var(--g)' : 'rgba(233,233,237,.35)'}` : ''
          }`,
          title: `${d.date} — ${d.sets} sets`,
        })
      )
    ),
    h(
      'div.streak-scale',
      h('span', shortDate(first.date)),
      h('span', tp('today.sessions', active)),
      h('span', t('today.title'))
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
 * The 14-day strip above answers "have I been training". This answers "what
 * have I been training", which is a different question and the one a weekly
 * summary is for. What was NOT trained is given equal billing: a list of the
 * muscle groups you hit says nothing about the ones you keep missing.
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
    'div.stack',
    { style: 'gap:12px' },
    h(
      'div.week-head',
      h(
        'div.stack',
        { style: 'gap:2px' },
        h('div.kicker', weekTitle()),
        h('div.week-range', weekRangeLabel(sum.start, sum.end))
      ),
      h(
        'div.week-nav',
        nav(-1, t('week.previous'), false),
        // Never past the current week: there is nothing logged in the future,
        // and an endlessly advancing empty week is a dead end to walk into.
        nav(1, t('week.next'), state.weekOffset >= 0)
      )
    ),
    h(
      'div.week-days',
      sum.days.map((d) =>
        h(
          'div.week-day',
          { class: d.sets ? 'is-on' : '', title: `${d.date} — ${tp('log.sets', d.sets)}` },
          h('span.week-day-name', weekdayShort(d.date)),
          h('span.week-day-sets', d.sets ? String(d.sets) : '·')
        )
      )
    ),
    sum.sets
      ? h(
          'div.stack',
          { style: 'gap:12px' },
          h(
            'div.week-meta',
            tp('week.summary', sum.daysTrained, { sets: sum.sets, muscles: sum.rows.length })
          ),
          muscleRoleKey(),
          muscleBars(sum.rows),
          sum.untouched.length > 0 &&
            h(
              'p.hint',
              h('span.week-untouched-label', t('week.untouched')),
              ' ',
              sum.untouched.join(' · ')
            )
        )
      : empty(t('week.empty'), state.weekOffset === 0 ? t('week.emptyHint') : null)
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

function balanceCard(mix) {
  if (!mix.total) {
    return h(
      'button.panel-btn',
      { onclick: () => go('log') },
      h('div.panel-head', h('div.panel-title', t('today.balance')), h('span.muted', { style: 'font-size:11px' }, t('log.empty')))
    );
  }

  return h(
    'button.panel-btn',
    { onclick: () => go('log') },
    h(
      'div.panel-head',
      h('div.panel-title', t('today.balance')),
      h('span.muted', { style: 'font-size:11px' }, t('today.balanceMeta', { n: mix.total }))
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

function savedCard() {
  if (!state.sessions.length) return null;
  return h(
    'button.panel-btn',
    { onclick: () => go('saved') },
    h(
      'div.panel-head',
      h('div.panel-title', t('today.saved')),
      h('span.muted', { style: 'font-size:11px' }, t('today.savedMeta', { n: state.sessions.length }))
    )
  );
}

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
        h(
          'div.goal-chips',
          v.goals.map((goal) =>
            h(
              'button.goal-chip',
              {
                class: q.goal === goal ? 'is-on' : '',
                style: `--gc:${GOAL_COLOR[goal]}`,
                'aria-pressed': String(q.goal === goal),
                onclick: () => setQuick({ goal }),
              },
              h('span.swatch.swatch-lg', { style: `background:${GOAL_COLOR[goal]}` }),
              goalLabel(goal)
            )
          )
        )
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

function quickSection(label, body) {
  return h('div.stack', { style: 'gap:10px' }, h('div.kicker', label), body);
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
function timeScroller(current) {
  const readout = h('div.time-readout', h('span.time-value', String(current)), h('span.time-unit', t('units.min')));
  const strip = h('div.time-strip', { role: 'group', 'aria-label': t('quick.time') });

  const items = QUICK_TIMES.map((value) =>
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
function quickReveal(q, result, done) {
  // Someone who has asked for less motion has asked for less of exactly this.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    done();
    flash(tp('quick.generated', result.exerciseIds.length));
    return;
  }

  const built = buildSession(state.session, state.catalog, state.oneRm);
  const lines = [
    t('quick.reveal.pool', { n: state.catalog.exercises.filter((e) => !e.archived).length }),
    q.muscles.length
      ? t('quick.reveal.picking', { groups: q.muscles.slice(0, 3).join(', ') })
      : t('quick.reveal.pickingAny'),
    t('quick.reveal.warmup', { n: built.warmup.items.length }),
  ];

  const steps = lines.map((line, i) =>
    h('div.reveal-step', { style: `animation-delay:${120 + i * 170}ms` }, line)
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

  document.body.appendChild(overlay);

  // A timer, not an animationend listener: if anything stops the animation
  // running the overlay still has to come down, and a stuck full-screen panel
  // over the app is a far worse failure than a missed flourish.
  setTimeout(() => {
    overlay.classList.add('is-leaving');
    setTimeout(() => {
      overlay.remove();
      done();
    }, 220);
  }, 1080);
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
      screenHead(t('build.kicker'), t('build.title')),
      nameField(),
      goalSection(),
      liftsSection(exercises),
      budgetSection('warmupBudget', t('build.warmBudget'), WARM_BUDGETS, built),
      budgetSection('cooldownBudget', t('build.coolBudget'), COOL_BUDGETS)
    ),
    h(
      'div.sticky-actions',
      h(
        'button.btn.btn-goal.btn-lg.btn-block',
        { disabled: !exercises.length, onclick: () => go('plan') },
        t('build.generate'),
        h('span', { style: 'opacity:.65;font-weight:400' }, ` ≈ ${formatMinutes(built.totalMinutes)}`)
      )
    )
  );
}

function nameField() {
  return h(
    'div.field',
    h('label.field-label', { for: 'session-name' }, t('build.name')),
    h('input.input#session-name', {
      type: 'text',
      value: state.session.name,
      placeholder: t('build.namePlaceholder'),
      // No re-render: retyping the name shouldn't rebuild the screen.
      oninput: (e) => {
        state.session.name = e.target.value;
        saveDraft();
      },
    })
  );
}

function goalSection() {
  return h(
    'div.stack',
    { style: 'gap:8px' },
    h('div.kicker', t('build.goal')),
    state.catalog.vocabulary.goals.map((goal) => goalCard(goal))
  );
}

function goalCard(goal) {
  const on = state.session.goal === goal;
  const p = getPrescription(state.catalog.prescriptionIndex, REPRESENTATIVE_PROFILE, goal);
  const color = GOAL_COLOR[goal];

  return h(
    'button.goal-card',
    {
      class: on ? 'is-on' : '',
      style: `--gc:${color}`,
      'aria-pressed': String(on),
      onclick: () => {
        state.session.goal = goal;
        markHandEdited();
        render();
      },
    },
    h(
      'span.goal-head',
      h('span.goal-mark'),
      h(
        'span.stack',
        { style: 'flex:1;gap:2px' },
        h('span.goal-name', goalLabel(goal)),
        h('span.goal-blurb', t(`goal.blurb.${goal}`))
      )
    ),
    on &&
      p &&
      h(
        'span.goal-detail',
        h(
          'span.figures',
          figure(p.sets, t('figures.sets')),
          figure(p.reps, t('figures.reps')),
          figure(p.load.replace(/ of 1RM$/, ''), t('figures.load')),
          figure(p.rest, t('figures.rest'))
        ),
        h('span.hint', p.note)
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

  if (!exercises.length) {
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
              sessionTitle(),
              h('br'),
              h('span.goal-word', goalLabel(state.session.goal))
            ),
            // Stays for the life of the session, not just the transition: a
            // week later, in the saved list, "did I choose these or did it?"
            // is a question the plan should still be able to answer.
            state.session.quick &&
              h('span.auto-badge', icon(ICONS.spark, { size: 11 }), t('quick.autoBadge'))
          ),
          h(
            'div.plan-total',
            h('div.plan-total-value', formatMinutes(built.totalMinutes)),
            h('div', { style: 'font-size:11px;color:var(--t-45)' }, t('plan.tolerance'))
          )
        )
      ),

      built.warmup.items.length > 0 &&
        h(
          'div.stack',
          { style: 'gap:10px' },
          h('div.section-label', t('plan.warmup', { n: built.warmup.minutes })),
          built.warmup.items.map((d) =>
            drillRow(d.phase.replace(/^\d+\s*/, ''), localized(d.name), d.minutes)
          )
        ),

      h(
        'div.stack',
        { style: 'gap:10px' },
        h('div.section-label', t('plan.main', { n: built.mainMinutes })),
        built.main.map((row, i) => planExerciseCard(row, i))
      ),

      built.cooldown.items.length > 0 &&
        h(
          'div.stack',
          { style: 'gap:10px' },
          h('div.section-label', t('plan.cooldown', { n: built.cooldown.minutes })),
          built.cooldown.items.map((m) => drillRow(m.type, localized(m.name), m.minutes))
        ),

      bodyMapSection(exercises)
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
      h('button.btn.btn-goal.btn-lg', { style: 'flex:1', onclick: startSession }, t('plan.start'))
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

      built.warmup.items.length > 0 &&
        block({
          key: 'warmup',
          title: t('live.warmup'),
          sub: `${built.warmup.minutes} ${t('units.min')}`,
          keys: built.warmup.items.map((d) => `w${d.id}`),
          children: built.warmup.items.map((d) => checkRow(`w${d.id}`, localized(d.name), d.minutes)),
        }),

      setBlocks,

      built.cooldown.items.length > 0 &&
        block({
          key: 'mobility',
          title: t('live.cooldown'),
          sub: `${built.cooldown.minutes} ${t('units.min')}`,
          keys: built.cooldown.items.map((m) => `c${m.id}`),
          children: built.cooldown.items.map((m) => checkRow(`c${m.id}`, localized(m.name), m.minutes)),
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

function checkRow(key, name, minutes) {
  const on = !!state.live.checked[key];
  return h(
    'button.check-row',
    {
      class: on ? 'is-done' : '',
      'aria-pressed': String(on),
      onclick: () => {
        state.live.checked[key] = !on;
        saveLive();
        render();
      },
    },
    h('span.tick', { class: on ? 'is-on' : '' }, icon(ICONS.check, { size: 11, stroke: '#161826' })),
    h('span.check-row-name', name),
    h('span.check-row-min', `${minutes} ${t('units.min')}`)
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
  return done.length === 1
    ? t('saved.completedOnce', { date: last.date })
    : t('saved.completedMany', { n: done.length, date: last.date });
}

function viewSaved() {
  return h(
    'div.screen',
    h(
      'div.screen-inner',
      backLink(t('tab.home'), () => go('home')),
      screenHead(t('saved.kicker', { n: state.sessions.length }), t('saved.title')),
      state.sessions.length
        ? h(
            'div.stack',
            { style: 'gap:10px' },
            state.sessions.map((s) => savedRow(s))
          )
        : empty(t('saved.empty'), t('saved.emptyHint'))
    )
  );
}

function savedRow(s) {
  const exercises = sessionExercises(s);
  const built = buildSession(s, state.catalog, state.oneRm);

  return h(
    'div.saved-row',
    h(
      'div',
      h('div.saved-name', s.name),
      h(
        'div.saved-meta',
        `${s.date} · ${goalLabel(s.goal)} · ${exercises.length} ${t('today.lifts')} · ${formatMinutes(built.totalMinutes)}`
      ),
      h('div.saved-done', completionLine(s))
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
  const mix = goalMixFromLog(window30, state.catalog.vocabulary.goals);
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
    exerciseId: state.session.exerciseIds[0] ?? state.catalog.exercises[0].id,
    goal: state.session.goal,
    weight: '',
    reps: '',
    rpe: '',
  };

  const options = state.catalog.exercises
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

function field(label, control) {
  return h('div.field', h('span.field-label', label), control);
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
    const results = state.catalog.exercises.filter(
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

  return h(
    'div.print-sheet',
    h(
      'header.print-head',
      h('h1.print-h1', session.name || sessionTitle(session)),
      h(
        'p.print-meta',
        [
          session.date,
          `${t('print.goal')}: ${goalLabel(session.goal)}`,
          `${t('print.estimate')}: ${formatMinutes(built.totalMinutes)}`,
        ].join('  ·  ')
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
        `${t('print.warmup')} — ${built.warmup.minutes} ${t('units.min')}`,
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
        `${t('print.main')} — ${built.mainMinutes} ${t('units.min')}`,
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

    built.cooldown.items.length > 0 &&
      section(
        `${t('print.cooldown')} — ${built.cooldown.minutes} ${t('units.min')}`,
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
