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
| **Plan** | The whole session laid out in three phases — warm-up, main lifts, cool-down — each with its item count, its duration and a line on what it is for. Save, export a PDF, or start. |
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

The session screen groups the warm-up, each exercise and the cool-down into
collapsible boxes with their own done counts, plus a select-all and a
confirmation if you finish with steps still unmarked.

**The three phases are named the same everywhere** — Warm-up, Main lifts,
Cool-down — on the plan, in a live session and on the printed sheet. "Main" was
the workbook's column heading rather than anything anyone says, and "Mobility"
named the contents rather than the phase while disagreeing with the sheet and
the code. Each header carries its item count as well as its duration, because
minutes alone tell you how long but not how much.

**Every warm-up drill and mobility move can tell you how to do it.** An `i`
beside the row opens a sentence or two underneath — the same gesture as the
pencil that opens the weight stepper, one row up. The instructions were in the
workbook all along but only ever reached the printed sheet, which is no use in
a gym; the cool-down is exactly where you meet a movement you have never done.
One opens at a time, and it stays open when you tick the row off.

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

## Conditioning

**Groundwork only so far — the data layer, not yet the workouts.**

Everything else in the app assumes the unit of work is a set with a weight. Log
entries are `{exerciseId, setNo, weight, reps}`, volume is `weight × reps`, and
a prescription comes from `profile × goal → sets/reps/%1RM`. HIIT's unit is a
time interval, and for an AMRAP the score is the *output* — you don't know it
until you stop. That mismatch is the whole difficulty; adding movements is the
easy part.

The compendium turned out to be half-stocked already: Push-Up, Pull-Up, Dip,
Plank, Bear Crawl, Farmer's Walk, Box Jump, Thruster, Kettlebell Swing, Med Ball
Slam and Sled Push were all in there. What was missing was the machines — no
rower, ski erg, bike or treadmill anywhere in 167 exercises — and the burpee
family. So `data/conditioning.json` is **22 new movements plus a pace overlay on
36 exercises that already existed**. A Thruster doesn't need a second catalog
row; it needs a second way of being prescribed. 58 movements are pickable for
conditioning in total.

**Pace is the keystone.** Every movement declares units per minute at a hard but
repeatable effort — what you could hold for ten minutes. An EMOM minute is
`pace × 40/60`. An AMRAP round is 60–120 seconds split across its movements. A
for-time estimate is total units ÷ pace. Get the pace right and every format
sizes itself: measured across all 58, EMOM chunks land at 39–41 s against a 40 s
target and three-movement rounds at 59–78 s, nothing out of band.

Movements carry a `kit` group — **bodyweight**, erg, run, floor, rig — because
"do you have a ski erg" is a real question in a way it never was for lifting.
Bodyweight means you and the ground and nothing else, which is 20 movements and
enough for every format; choosing "floor & kit" admits it too, since anyone with
a box and a kettlebell also has a floor. They carry the same three complexity
tiers as everything else. An air bike is agony and still basic;
double-unders are advanced because a beginner doing them tired mostly whips
their own shins.

### Blocks

One block of three movements over twenty minutes is those three movements six
times each — a narrow slice of you, and dull by minute ten. So a workout can be
cut into up to **four blocks**, each with its own movements and its own shape,
with a transition between them that you set.

What that buys, measured over 300 seeds per cell — average distinct movements,
and body regions of the five:

| | 1 block | 2 | 3 | 4 |
|---|---|---|---|---|
| **20 min** | 2.8 mv / 2.7 roles | 5.9 / 3.9 | 7.2 / 4.0 | — |
| **30 min** | 2.7 / 2.6 | 5.3 / 3.6 | 8.5 / 4.2 | **10.6 / 4.4** |

The count scales with the clock — a block needs 5 minutes and the gaps cost 2, so
you get 1 block under 10 minutes, 2 from 12, 3 from 19, 4 from 26 at the default
two-minute transition, and fewer if you set a longer one. All four are
always shown, with the unreachable ones disabled, because a control that grows
and shrinks as you scroll the time strip is one you can't aim at.

Movements never repeat across blocks unless the pool is genuinely too small, and
the shapes vary — an EMOM then an AMRAP then a for-time is three different
relationships with the clock, which is most of what makes the third block feel
unlike the first.

**You set the transition between blocks** — straight on, or 1, 2, 3 or 5 minutes.
It is not cosmetic: it comes out of the same total, so it changes how many blocks
fit — twenty minutes is three blocks at two minutes and two at five. Changing
station, resetting a machine and getting your breath back is real time, and how
much you need depends on whether the kit is at your feet or across a busy gym.

### Formats

Five, from one generator: **EMOM** (see below), **AMRAP**
(fixed round, count the rounds), **intervals** (30/30 through 90/60), **Tabata**
(8 × 20/10) and **for time** (3–5 rounds against a cap).

**There are two EMOMs, and you choose.** *All of it, every minute* — every
movement, every minute, resting whatever's left. Or *one movement a minute*,
taking turns. Both are ordinary, and the app used to only build the second while
showing you a card that read like the first; now the card, the editor and the
clock all say which one it is.

The distinction that runs through all of it is whether the clock says *how much
work fits* (EMOM, intervals, Tabata) or *how long the work takes* (AMRAP, for
time). It decides the partner maths, which way amounts round, and whether a
round count even exists.

**Partner work** comes in the three modes you'd actually use. *You go, I go*
alternates turns — in an AMRAP that earns a 1.3× bonus because a full turn of
rest means you can go harder, but in an EMOM it earns nothing, because a minute
is sixty seconds whatever you do. *Shared* and *relay* put everyone against one
target, so the number is the combined figure and scales with the group.

Amounts snap to numbers people actually write — 15 burpees, not 17.33 — rounding
**down** inside a timed window, because work that doesn't fit eats the rest it
was sized to leave. Selection spreads across movement roles (mono / upper /
lower / core) so a round doesn't stack three leg movements and stop for muscular
reasons rather than cardiovascular ones.

Verified by sweeping the real catalog: 3,000 blocks across six partner
configurations, **zero** over budget, **zero** prescriptions exceeding their work
window, zero duplicate movements or tripled roles, and all 58 movements
reachable.

### Generating one

**HIIT workout** on Home asks five things — how long (4–30 min), **how many
blocks**, what shape, what kit is to hand, and whether anyone's doing it with
you. Kit is asked each
time rather than kept as a setting, because the answer changes between the gym
and the garage and a stale one silently prescribes a rower you can't reach.

A HIIT workout normally stands on its own. If you happen to have a lifting draft
open, it asks once whether you want the conditioning **on its own** or **as a
finisher** on that session — rather than guessing from what the draft holds,
which is leftover state and no indication of what you just asked for. On the
plan a finisher sits after the lifts and before the cool-down: it's the last hard
thing you do, and the cool-down is what brings you down from it.

**Each shape has its own colour**, the way the four goals do, so a plan is
recognisable as an EMOM or an AMRAP before it's read — and picking one repaints
the screen with the same wave from the press point. "Surprise me" keeps the
generic conditioning cyan, because it isn't a shape, it's the absence of a
choice. The block card carries its shape's colour even inside a lifting session,
so a finisher stands out from the workout it's attached to.

It renders as **one card with a list inside**, not a card per movement. A lift
card carries sets, reps and a load because a lift is a thing you do on its own;
a conditioning movement means nothing apart from the round it sits in. A
whiteboard writes it the same way, for the same reason. The header carries each
format's own sentence rather than a generic count, because "12 min" is a limit
in an AMRAP and a cap you hope not to reach in a for-time.

### Building one yourself

**Build my own** sits beside Generate, and the pencil on any block opens the same
editor — so a generated workout can be fixed rather than only re-rolled. Pick the
shape, the length, the movements and how many of each; a live line tells you what
the block will actually be, in the words the plan will use.

The editor only asks what's a real choice. Intervals get a work/rest shape;
for-time gets a round count; **Tabata gets no duration at all**, because 8 × 20/10
is four minutes a movement and the movement list decides. What it never lets you
set is the structural arithmetic — rounds, work and rest are derived exactly as
they are for a generated block, and the stated minutes are read back off the same
step list the timer walks. Ask for a ten-minute Tabata of three movements and you
get twelve, and you're *told* twelve, because that's what the clock will run.

Amounts are stepped, not typed — reps by one, metres by ten, seconds by five — and
a movement you've just added opens on the same sizing the generator would have
given it. The picker offers all 58 movements whatever kit they need, unlike the
generator, which is asked what's to hand: someone building by hand is looking at
the gym they're standing in.

**Filtering is the Library's**, down to the count badge on the Filters button and
the panel unfolding itself when a combination finds nothing. The axes are
conditioning's own: kit, primary muscle, supporting muscle, technique, **impact**
and **what it's counted in**. Impact earns its place — "nothing that pounds my
knees" is a real constraint that the generator's single low-impact switch can't
express.

Every row shows what it works, and a conditioning-only plan now gets a body map
of its own: it always had the muscle data, it just was never asked.

**Add your own movement** when the list is missing one. Name it, say what it's
counted in, and answer *"how many in a minute, going hard?"* — that's the pace
number everything else is sized from, asked in words you can actually answer.
Pick its muscles, kit, technique level and impact, and optionally write the
how-to that shows up behind the info button mid-session. It needs no special
handling anywhere: yours are first-class, and **the generator will pick them**
(measured: 90 appearances in 400 generated workouts).

### Running it

**Start the clock** runs the workout. One screen, two controls, everything sized
to be read from across the room with your hands busy.

The clock counts each step down inside a ring, names the movement and its amount,
and moves itself on. Rests show what's coming *next*, because a rest is only
useful if you know what to set up for. An AMRAP gets the biggest control on the
screen for its round counter — the count is the score. A for-time counts up. On a
"you go, I go" partner workout it says whose turn it is.

**It beeps.** You can't watch a phone mid-burpee, so every transition sounds,
with a three-note count-in before it. The tones are synthesised on the spot —
this app still ships no binary assets. It keeps the screen awake where the
browser allows, and it runs whether or not you're looking at it: switch to the
Log and a bubble carries the time back.

**It survives a reload**, which is exactly what a phone does when it reclaims
memory mid-workout. Nothing counts seconds — state holds the instant the current
step ends, so coming back late means walking forward to wherever the clock
actually is, silently.

Finishing shows what you did and writes nothing until you say so. A rating, and
it lands in the log as one entry per block under a Conditioning heading.

See [docs/logic.md](docs/logic.md) §20–26.

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
