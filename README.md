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
Explosive, Strength, Hypertrophy, Endurance — becomes `--g`, and every
interactive surface reads from it, so the whole app re-tints. Nocturne's own
accent is deliberately unused for interactive text: it measures ΔE 6.9 from the
Explosive blue, so the two would be indistinguishable while meaning different
things.

The Hypertrophy magenta (`#c9739d`) was picked by sweeping hue 285–340 at its
siblings' chroma and lightness and keeping the candidate whose worst CIEDE2000
distance to anything it can share a screen with was largest — ΔE 13.0, against
Explosive under protanopia and Endurance under deuteranopia, at contrast 5.38 on
the ground and 4.65 on the surface. Magenta because nothing else was free: red,
amber and yellow belong to the muscle tokens and Home, and violet collides with
Nocturne's accent.

**Home is the exception.** It is not a training mode, so it keeps its own
yellow (`#f3dd53`) and drops the corner glow — validated at ΔE ≥ 23.4 from
every colour it can share a screen with, including the three goals and both
muscle tokens.

## Home

Home answers three questions in order — what am I doing now, how did this week
go, how am I trending — and everything on it is the same card.

It did not used to be. Three container idioms ran down one column: a bordered
card with a gradient accent line, a bordered button, and two sections with no
container at all. Nothing looked related to anything else. Two strips answered
nearly the same question in different visual languages, stacked. Five colour
systems competed.

The rules now:

- **One card.** Same border, radius and padding throughout.
- **Home opens on the three ways to start** — Quick workout and Build as two
  square tiles, with the saved workouts as a wide platform beneath them, all
  the same material so they read as one block. The platform is the only one of
  the three with contents rather than a promise: a saved workout already exists
  and can be stepped straight onto, one tap from Home.
- **Home's yellow is the only emphasis colour Home owns.** Goal colours appear
  twice, both naming a goal: the pill on the planned session, and the balance
  bar with its legend. The muscle red/amber does not appear at all — a real
  distinction, but unreadable without the legend that lives on the Log. Home
  says *whether* a group was trained; the Log says *how*.
- **The date is the heading.** There was an `h1` reading "Home" above it,
  spending the biggest type on the screen restating the tab you just pressed.
- **Quick workout and Build are the same size.** Build was a filled button
  inside the planned card and Quick workout a wide panel beneath it, which
  said one was the real way in. They are two answers to the same question.
- **One week strip, not two.** The 14-day streak sat directly above the
  Monday-to-Sunday card. The day cells carry the volume the strip was showing,
  and stepping back a week reaches further than fourteen days ever did.
- **One coverage control.** A legend, a list of paired bars and a "not trained
  this week" paragraph became a single row of pills: filled with a count if
  trained, outlined if not.

**Build** got the same treatment. Its goal picker was four stacked full-width
cards, the chosen one expanded: 474px, 58% of a phone screen, to choose one of
four things — and it pushed the lifts, which are what a workout actually *is*,
below the fold. It uses the same focus scroller as Quick workout now, at about
half the height, with the chosen goal's prescription underneath where it is
easier to read than it was crammed into a card. The lifts start above the fold.

The session name is the screen's title, replacing an `h1` that read "Build" and
a labelled field beneath it — the same fix as Home's date, and it stops asking
you to name a session before you have decided what it is.

**Saved workouts** uses the same card. It groups by goal in the intensity order
everything else uses, sorts each group by what you trained most recently, and
puts the goal colour on the edge of every card — a stripe rather than another
pill, because the group header already names the goal but the stripe survives
that header scrolling away.

Like Home and the guide, Saved is not a training mode, so it takes Home's
yellow rather than the draft session's accent. It previously washed a list of
orange and blue stripes in whatever colour the current draft happened to be.

Dark only, because the design system is.

**Screens move, chrome does not.** Navigating animates only the content:
deeper rises, back drops, tab-to-tab is a shorter flatter move at 150ms
because you do it dozens of times a session. The tab bar, the sticky action
bar and the rest timer stay exactly where they are — that stillness is what
makes the moving part read as a new screen rather than everything lurching.
Nothing animates on an ordinary re-render, which is most of them.

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
data/
  exercises.json      generated from the workbook -- do not hand-edit
  warmups.json          "
  mobility.json         "
  prescriptions.json    "
  vocabulary.json       "
  hypertrophy.json    hand-authored: the fourth goal, with its sources
  complexity.json     hand-authored: skill tiers for Quick workout
tools/
  extract-workbook.ps1  xlsx -> data/*.json
  serve.ps1             static file server
docs/logic.md         every rule, traced to its cell formula
```

## Screens

Four tabs, with Plan and Session pushed from Build, and Saved and the guide
pushed from Home.

| Screen | What it does |
|---|---|
| **Home** | The three ways to start — generate one, build one, or step onto a saved one — then the Monday-to-Sunday week with muscle coverage, and the goal balance. |
| **Quick workout** | Muscle groups, time, focus and complexity in, a whole session out. Reached from Home. |
| **Build** | Name it in the title, pick a goal from the same scroller Quick uses, choose lifts — each with its 1RM to hand — and set the budgets. |
| **Plan** | The whole session laid out: warm-up, every lift with sets × reps and suggested load, mobility, and what it trains. Save, export a PDF, or start. |
| **Session** | Tick each set off as you do it, type or step the load, and the rest timer counts the prescribed rest. Finishing asks how hard it was and logs exactly what you ticked. |
| **Log** | Goal balance over 30 days, perceived exertion over a week, month or year, sets per muscle group, history, per-exercise bests, and your data. |
| **Library** | All 167 exercises plus any you write yourself. Search by name, filter by equipment, movement pattern, primary muscle and supporting muscle, read the cue, set your 1RMs — and pick lifts from here when building. |
| **Saved** | Your workouts, grouped by goal and colour-coded to it. Load one back, print it, or record that you did it again. |
| **How this works** | A walk through one session start to finish, for someone who has just arrived. Reached from a question mark in the corner of Home. |

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
the direction pressed (183 → + → 185). The same control sets a 1RM, and it is
on the Build screen next to each chosen lift as well as in the Library — the
suggested load is a percentage of your 1RM, so the number is asked for where
the sentence asking for it appears.

On Build, **the tick is the only thing that removes a lift.** The row used to be
one wide button that dropped the exercise wherever you pressed it, including on
the words "Enter your 1RM" — which reads as an instruction, so people followed
it and lost the lift. Pressing the row now opens the 1RM field it was asking
for, and the destructive action has its own target.

## Finding your way in

**Home → the question mark, top right.** It opens a walkthrough of one whole
session in the order you actually do it: pick a goal, pick lifts, give it your
1RM, set a warm-up budget, generate, run it, rate it, look back. Eight steps,
each a sentence or two, with buttons into the screen being described.

It is a *page*, not a first-run modal, and nothing triggers it automatically. A
tutorial nobody asked for is an obstacle between someone and the thing they
opened the app to do, and the button does not go away — it is as useful on the
day you wonder what the warm-up budget actually does as it is on day one.

Home is the only place it appears, and the button is deliberately quiet: a
38px outlined circle drawn at `--t-55`, which measures 5.1:1 on the ground —
dimmer than anything else on the screen, but well clear of the 3:1 floor for a
control someone is meant to find. `--t-45`, the kicker tint, was the first
choice and came in at 3.9:1, which is legal and too faint for the only door
into the thing. The guide keeps Home's yellow rather than a goal accent, because it
describes all four goals and wearing one would be picking a side.

## The four goals

Three come from the workbook. **Hypertrophy** is the app's own, because the
compendium does not prescribe it, and it lives in `data/hypertrophy.json`
rather than in the generated files — the extractor rewrites those wholesale,
and anything merged into them would not survive the next run. `src/data.js`
folds it into the same prescription index at load, so nothing downstream can
tell the two apart.

Its seven rows (one per prescription profile) are hand-authored from the
current literature, and that file cites what each number rests on: load and rep
ranges wide because proximity to failure matters more than the exact number,
2–3 min rest on multi-joint work rather than the 60 s that used to be standard
advice, and 0–3 reps in reserve rather than training to failure. Those are
population-level starting points, not advice for any individual.

## Quick workout

**Home → Quick workout.** Four questions — which muscle groups, how long you
have, which goal, and how much technique you want handed to you — and it builds
the session. Build asks you to know which lifts you want; this doesn't.

The time is the **whole** session. The warm-up and mobility budgets come out of
it before anything is chosen, so "I have an hour" means an hour in the building,
and the screen shows the split as you change it.

**Focus** is a side-scrolling row of cards rather than four pills. A pill gives
a goal a word and nothing else, which is no use on the screen a beginner
reaches for; a card has room for the sentence that explains it and the numbers
it will actually prescribe — "3–4 × 8–12 · 70–80%" says more than
"Hypertrophy" ever will.

Choosing one sends a **pulse** of the new colour out from wherever you pressed.
It sits behind the content, above the flat ground and below the screen, so it
washes through the cards rather than over them — and each element changes
colour as the front reaches it, not when the wave starts, so the colour really
is carried outward rather than merely announced. The Build screen's goal cards
do the same thing, because picking a goal repaints the app wherever you do it.
Skipped under `prefers-reduced-motion`.

Selection rotates across the muscle groups you picked rather than ranking one
list, because a single ranked list spends the whole budget on whichever group
has the most catalog entries. Within a group the pick is weighted-random, not
best-first — that is the variability, and it means the same request twice in a
week gives you different lifts. Assistance is a fallback rather than a rival: an
exercise that targets the group always beats one that merely helps, or asking
for biceps would hand you a barbell row.

One exercise per movement, where a movement is the pattern *and* whether it is a
main lift or accessory work. Pattern alone was too coarse — every chest exercise
in the catalog is Horizontal push, flies included — and pattern-plus-target was
too fine, because a bench press and a close-grip bench press have different
primary muscles and are still two bench presses.

Every session carries the inputs it was built from and its random seed, so
**Shuffle** on the plan re-rolls the same request, and reloading never silently
gives you a different workout.

Generating plays a short reveal — about a second — naming the stages as they
happen and ending on the shape of the result, because otherwise the only sign
that a workout was chosen for you is that the screen changed. The counts in it
are read off the finished session, so it never claims work that did not happen,
and it is skipped entirely under `prefers-reduced-motion`. The plan then carries
an **Auto-generated** badge for the life of the session, which answers the same
question a fortnight later in the saved list.

Editing a generated session by hand — adding or removing a lift, changing the
goal or a budget — drops the badge and the Shuffle button. The badge means "this
is exactly what the generator produced", and Shuffle would otherwise sit there
ready to discard the edit you just made.

### Complexity

Three cumulative tiers — basic ⊂ medium ⊂ advanced — about how much skill a
movement needs before it is worth loading, not how hard the set feels. A leg
press to failure is agony and still basic.

Familiarity counts: the barbell squat, bench, deadlift, press, row and pull-up
are **basic** despite being technical, because they are what every beginner
programme is built from. Held back are the genuinely obscure and the high-skill:
Olympic lifts, ring work, pistol squats, depth jumps, Zercher anything.

The tiers live in `data/complexity.json` — a rule per profile plus a
hand-written list of the exercises the rule gets wrong. The rule alone can't
tell a Bodyweight Squat from a Pistol Squat, since they're the same four fields
all the way down; the overrides carry the judgement. It splits 91 / 40 / 36.
Exercises you write yourself get tiered by the rule, since nobody is going to
hand-rate those.

## Perceived exertion

Finishing a session asks for a 1–10 rating before it writes the log, and
"Did it again" asks the same. Skipping is a first-class answer.

The rating is stored on the log rows themselves rather than in a table of its
own, because a row is the only record that survives every route into the log.
One session's rating is stamped on every set it writes, so averaging a
session's rows gives that number straight back.

**Log → Perceived exertion** charts it. The chips choose the window — week and
month bucket by day, year by calendar month — and the slider switches between a
line and bars. Both are remembered. The scale is 0–10 and not cropped to where
the data lives: the whole point of plotting a subjective number is to watch it
move, and an axis that exaggerates the movement answers a question nobody
asked. A bucket with no rated session is a gap, never a zero.

## Your own exercises

**Library → Add your own exercise.** Name, equipment, movement pattern, primary
and supporting muscles, prescription profile and a cue — the same shape as a
workbook row, so everything downstream works on it unchanged: the warm-up
triggers off its pattern and muscles, the prescription comes from its profile,
the body map paints it, the log counts it, and it has a 1RM.

The profile is the one field with no obvious answer, since it is the workbook's
vocabulary rather than a property of the movement. The form shows what the
chosen profile will actually prescribe, for your current goal, before you
commit to it.

They live in `store.js`, never in `data/`, so re-extracting the workbook cannot
touch them, and they carry string ids (`u…`) so they can never collide with the
workbook's numeric ones. Removing one deletes it if nothing refers to it and
archives it if something does — archived means gone from the library and the
picker but still named everywhere it is already used, because deleting an
exercise a log entry points at would quietly drop that training out of every
muscle and goal total.

## Export to PDF

**Build → Export PDF**, or the same button on any saved workout. It opens the
browser's print dialog — choose *Save as PDF*. There is no PDF library bundled
(none is installable here, and it would mean a build step); the sheet is a
dedicated print layout, so it also prints properly on paper. The *Your load*
column is left as ruled boxes to write into at the rack.

## Changing the exercise data

The workbook stays the authoring surface for the 167 exercises and the three
goals it prescribes. Edit it in Excel, then:

```bash
powershell -ExecutionPolicy Bypass -File tools/extract-workbook.ps1
```

It rewrites the five generated files and reports anything suspect — an exercise
whose prescription profile has no matching row, a missing Swedish name, and any
1RM left in the sheet (those are deliberately *not* shipped; 1RMs belong to the
user, not the catalog). It does not touch `data/hypertrophy.json`, and it has
no idea the user's own exercises exist.

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
