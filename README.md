# Workout Companion

A mobile-first web app built from `Gym Exercise Compendium.xlsx`. Pick your main
lifts and a goal, and it builds the warm-up, prescribes sets/reps/load, picks a
cool-down and estimates how long the session will take — the same logic as the
workbook, reproduced exactly. Then it runs the session with you: tick each set
off, adjust the load, and the rest timer starts itself.

Everything runs in the browser. No build step, no dependencies, no server, no
account. Your data never leaves the device.

## Look

The interface is built on the **Nocturne** design system — a dark ground
(`#161826`), one surface step above it, Inter, and radii of 4/8/14. Those tokens
are the source of truth; the app defines no palette of its own for chrome.

The one idea on top is the **goal accent**. The training goal you pick —
Explosive, Strength, Endurance — becomes `--g`, and every interactive surface
reads from it, so the whole app re-tints. Nocturne's own accent is deliberately
unused for interactive text: it measures ΔE 6.9 from the Explosive blue, so the
two would be indistinguishable while meaning different things.

**Home is the exception.** It is not a training mode, so it keeps its own
yellow (`#f3dd53`) and drops the corner glow — validated at ΔE ≥ 23.4 from
every colour it can share a screen with, including the three goals and both
muscle tokens.

Dark only, because the design system is.

**The page scrolls, not an inner pane.** A phone-shaped app shell — fixed-height
column, scrolling content area — looks right but breaks on a desktop window:
the column is 480px of a 1280px viewport, so the wheel does nothing across the
other 800px, and Space / PageDown target the document, which cannot scroll.
Putting the scroll on the document makes the wheel, trackpad, keyboard and
scrollbar work everywhere; the tab bar is fixed over the top of it, aligned to
the column rather than the window.

## Run it

```bash
powershell -ExecutionPolicy Bypass -File tools/serve.ps1
```

Then open <http://localhost:8181>.

The local server exists only because ES modules won't load over `file://`. Any
static server works — this one is here because the machine has no Node or
Python.

## Layout

```
index.html            app shell
styles.css            Nocturne tokens, the goal accent, and the print sheet
manifest.json         PWA metadata (installable, offline-ready shell)
src/
  app.js              screens and wiring
  engine.js           the workbook's logic + log metrics -- pure, no DOM
  muscles.js          the front/back body map (inline SVG)
  data.js             loads the generated catalog
  store.js            user data (localStorage today, swappable)
  i18n.js             translation plumbing; English registered
  ui.js               ~120-line DOM helper, not a framework
data/*.json           generated from the workbook -- do not hand-edit
tools/
  extract-workbook.ps1  xlsx -> data/*.json
  serve.ps1             static file server
docs/logic.md         every rule, traced to its cell formula
```

## Screens

Four tabs, with Plan and Session pushed from Build and Saved pushed from Today.

| Screen | What it does |
|---|---|
| **Home** | The planned session at a glance, a 14-day training strip, and the goal balance. Start or resume from here. |
| **Build** | Goal (each one expands to its prescription), lifts, warm-up and mobility budgets. |
| **Plan** | The whole session laid out: warm-up, every lift with sets × reps and suggested load, mobility, and what it trains. Save, export a PDF, or start. |
| **Session** | Tick each set off as you do it, type or step the load, and the rest timer counts the prescribed rest. Finishing logs exactly what you ticked. |
| **Log** | Goal balance over 30 days, sets per muscle group, history, per-exercise bests, and your data. |
| **Library** | All 167 exercises. Search by name, filter by equipment, movement pattern, primary muscle and supporting muscle, read the cue, set your 1RMs — and pick lifts from here when building. |
| **Saved** | Your workouts. Load one back, print it, or record that you did it again. |

While a session is running, a **bubble** floats above the tab bar on every
other screen, carrying the session's name, goal colour and progress. It
disappears when the session is finished.

A running session owns its own copy of the workout, so you can build an
entirely different one while it is in progress — the plan you are halfway
through never moves under you, and finishing logs what that session actually
prescribed.

The session screen groups the warm-up, each exercise and the mobility work into
collapsible boxes with their own done counts, plus a select-all and a
confirmation if you finish with steps still unmarked.

Weights are steppable in 2.5 kg or typable outright. Typing accepts any number;
only the +/- buttons enforce the grid, snapping an off-grid weight onto it in
the direction pressed (183 → + → 185).

## Export to PDF

**Build → Export PDF**, or the same button on any saved workout. It opens the
browser's print dialog — choose *Save as PDF*. There is no PDF library bundled
(none is installable here, and it would mean a build step); the sheet is a
dedicated print layout, so it also prints properly on paper. The *Your load*
column is left as ruled boxes to write into at the rack.

## Changing the exercise data

The workbook stays the authoring surface. Edit it in Excel, then:

```bash
powershell -ExecutionPolicy Bypass -File tools/extract-workbook.ps1
```

It rewrites `data/*.json` and reports anything suspect — an exercise whose
prescription profile has no matching row, a missing Swedish name, and any 1RM
left in the sheet (those are deliberately *not* shipped; 1RMs belong to the
user, not the catalog).

## Verified against the workbook

The engine reproduces the workbook's own Workout A exactly:

| | Workbook | App |
|---|---|---|
| Warm-up | 13 min, 4 drills | 13 min, 4 drills |
| Main session | 78 min | 78 min |
| Cool-down | 7 min, 3 exercises | 7 min, 3 exercises |
| Total | 98 min | 1:38 |
| Back Squat suggested @ 1RM 100 | `80.0–90.0 kg` | `80.0–90.0 kg` |
| Log: 85 kg × 5 | volume 425, est. 1RM 99.17 | 425, 99.2 |

The two orderings that make the warm-up work — selection by priority, display
by phase — are both reproduced. See [docs/logic.md](docs/logic.md).

## Swedish

The app is English-only for now, by choice. The groundwork is in:

- every UI string goes through `t()` in `src/i18n.js`
- every workbook field is `{ en, sv }`, and `sv` is already populated for all
  167 exercise names, 49 warm-up drills and 43 mobility exercises
- `localized()` falls back to English wherever `sv` is missing, so a partial
  translation degrades rather than breaks

What's left to translate is listed in [docs/logic.md](docs/logic.md) §10.
Adding Swedish means filling in data and registering a second locale — no
refactor.

## Later

- **Hosting** — it's static files. Copy the folder to any static host and the
  URL works. No backend.
- **APK** — wrap the same folder with Capacitor once Node is available:
  `npx cap add android`. No rewrite; the app is already offline-first.
- **Offline** — the manifest is in place; a service worker is the remaining
  piece. Deliberately left out for now because a stale cache during development
  is more trouble than it's worth.
- **Sync** — `src/store.js` is the only file that touches storage. Swapping
  localStorage for IndexedDB or a synced backend is contained to it.
