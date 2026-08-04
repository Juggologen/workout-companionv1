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

import { loadCatalog } from './data.js';
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
} from './engine.js';
import { renderBodyMap, musclesWorked } from './muscles.js';

/* ------------------------------------------------------------------ goals */

const GOAL_COLOR = {
  Explosivity: 'var(--goal-explosive)',
  Strength: 'var(--goal-strength)',
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
  live: null,
  libQuery: '',
  libFilters: { equipment: '', pattern: '', primary: '', secondary: '' },
  libFiltersOpen: false,
  libOpen: null,
  libPicking: false,
  logDetail: false,
  logHistory: false,
  flash: null,
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

function saveLive() {
  if (state.live) store.setLive(state.live);
}

/**
 * The accent for the current screen.
 *
 * Home is not a training mode, so it takes its own yellow rather than being
 * repainted by whichever goal the draft session happens to hold.
 */
function screenAccent() {
  return state.screen === 'home' ? 'var(--home-accent)' : GOAL_COLOR[state.session.goal];
}

function render() {
  const root = document.getElementById('app');
  saveDraft();

  const scrollY = window.scrollY;
  const sameScreen = root.dataset.screen === state.screen;
  const resume = state.live && state.screen !== 'live';

  const app = h(
    'div.app',
    {
      class: [state.screen === 'home' && 'is-home', resume && 'has-resume'].filter(Boolean).join(' '),
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

  // Plan and Session are pushed from Build; Saved from Home. Keep the parent
  // tab lit so the bar never looks like nothing is selected.
  const parent =
    state.screen === 'plan' || state.screen === 'live'
      ? 'build'
      : state.screen === 'saved'
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
      screenHead(formatToday(), t('today.title')),
      plannedCard(exercises, built),
      streakCard(),
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

function liftRow(ex) {
  const load = loadFor(ex);
  return h(
    'button.pick-row',
    {
      'aria-pressed': 'true',
      onclick: () => {
        state.session.exerciseIds = state.session.exerciseIds.filter((id) => id !== ex.id);
        delete state.session.loads[ex.id];
        render();
      },
    },
    h('span.tick.tick-square.is-on', icon(ICONS.check, { size: 11, stroke: '#161826' })),
    h(
      'span.pick-main',
      h('span.pick-name', localized(ex.name)),
      h('span.pick-meta', `${ex.profile} · ${ex.primary}`)
    ),
    h('span.pick-load', { class: load.kind === 'no-1rm' ? 'is-missing' : '' }, loadLabel(load))
  );
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
            'h1',
            sessionTitle(),
            h('br'),
            h('span.goal-word', goalLabel(state.session.goal))
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
        built.main.map((row) => planExerciseCard(row))
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

function drillRow(kicker, name, minutes) {
  return h(
    'div.drill-row',
    h('span.drill-phase', kicker),
    h('span.drill-name', name),
    h('span.drill-min', `${minutes} ${t('units.min')}`)
  );
}

function planExerciseCard(row) {
  const { exercise: ex, prescription: p, suggested } = row;
  return h(
    'div.ex-card',
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
    finishSession(loggableCount);
    return;
  }

  confirmSheet({
    title: t('live.confirmTitle'),
    body: loggableCount
      ? tp('live.confirmBody', missing, { done: loggableCount })
      : t('live.confirmNothing'),
    confirmLabel: t('live.confirmFinish'),
    cancelLabel: t('live.confirmKeepGoing'),
    onConfirm: () => finishSession(loggableCount),
  });
}

/**
 * A modal confirmation. Built rather than using window.confirm so the question
 * can carry the actual numbers and match the rest of the app.
 */
function confirmSheet({ title, body, confirmLabel, cancelLabel, onConfirm }) {
  const dialog = h(
    'dialog.sheet',
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
 */
function finishSession(doneCount) {
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
        rpe: null,
        auto: true,
      });
    }
  }

  state.log = [...entries, ...state.log];
  store.setLog(state.log);
  recordCompletion(session, live.date, entries.length);

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
function recordCompletion(session, date, sets) {
  let saved = state.sessions.find((s) => s.id === session.id);
  if (!saved) {
    saved = JSON.parse(JSON.stringify(session));
    if (!saved.name) saved.name = sessionTitle(session);
    state.sessions.unshift(saved);
  }
  saved.completions = [...(saved.completions || []), { date, sets }];
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
            const sets = logWholeSession(s, today());
            flash(tp('live.logged', sets));
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
function logWholeSession(session, date) {
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
        rpe: null,
        auto: true,
      });
    }
  }
  state.log = [...entries, ...state.log];
  store.setLog(state.log);
  recordCompletion(session, date, entries.length);
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

function muscleDisclosure(rows) {
  if (!rows.length) return null;
  const max = rows.reduce((m, r) => Math.max(m, r.primary, r.secondary), 0) || 1;

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
      h(
        'div',
        { style: 'display:flex;align-items:center;gap:16px' },
        h('span.map-group-label', h('span.swatch.swatch-lg.swatch-primary'), t('log.primary')),
        h('span.map-group-label', h('span.swatch.swatch-lg.swatch-secondary'), t('log.supporting'))
      ),
      h(
        'div.mbar-head',
        h('span.mbar-head-name', t('log.muscleCol')),
        h('span.mbar-head-spacer'),
        h('span.mbar-head-value', t('log.setsCol'))
      ),
      // The number is the total. The split between the two roles is what the
      // pair of bars and the legend above them show -- a bare "12/6" beside
      // them said neither which number was which nor what of.
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
      ),
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
    .slice()
    .sort((a, b) => localized(a.name).localeCompare(localized(b.name)));

  return h(
    'form.log-form',
    {
      onsubmit: (e) => {
        e.preventDefault();
        if (!draft.weight || !draft.reps) return;
        state.log.unshift({
          id: newId(),
          date: draft.date,
          sessionName: '',
          exerciseId: Number(draft.exerciseId),
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
              state.live = null;
              state.session = blankSession();
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
    const results = state.catalog.exercises.filter(
      (ex) => matchesFilters(ex, state.libFilters) && matchesQuery(ex, q)
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

  return h(
    'div.screen',
    h(
      'div.screen-inner',
      { style: 'gap:18px' },
      state.libPicking && backLink(t('tab.build'), stopPicking),
      h('div.stack', { style: 'gap:2px' }, count, h('h1.screen-title', t('library.title'))),
      h('div.stack', { style: 'gap:10px' }, h('div.filter-bar', search, toggle), panel),
      list
    ),
    state.libPicking &&
      h(
        'div.sticky-actions',
        h('button.btn.btn-goal.btn-lg.btn-block', { onclick: stopPicking }, t('library.donePicking'))
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
        h('span.lib-name', localized(ex.name)),
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
