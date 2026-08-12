# Workout Companion — logic spec

Everything the app computes, traced back to the cell formulas in
`Gym Exercise Compendium.xlsx`. This is the contract the engine implements
(`src/engine.js`); if a number in the app disagrees with the workbook, one of
them is wrong and this document says which.

Reverse-engineered from the hidden helper columns `Y:AK` on the *Workout A/B/C*
sheets and the visible formulas in columns `C:P`.

---

## 1. Data model

Five JSON files under `data/`, regenerated from the workbook by
`tools/extract-workbook.ps1`, plus three that are not.

| File | Rows | From |
|---|---|---|
| `exercises.json` | 167 | Exercise Library |
| `warmups.json` | 49 | Warm-Up Library |
| `mobility.json` | 43 | Mobility Library |
| `prescriptions.json` | 21 (7 profiles × 3 goals) | Prescriptions |
| `vocabulary.json` | — | derived: distinct equipment / patterns / muscles / profiles / goals |
| `hypertrophy.json` | 7 (7 profiles × 1 goal) | **hand-authored** — see §16 |
| `complexity.json` | 1 rule set + 62 overrides | **hand-authored** — see §18 |
| `conditioning.json` | 22 movements + 36 pace overlays | **hand-authored** — see §20 |

### Reference vs. user data

The workbook mixes the two: column J of the Exercise Library, *Your 1RM*, is
your data sitting inside the reference table. The app splits them:

- **Catalog** — the JSON above. The five generated files are replaced wholesale
  whenever the workbook is re-extracted; `hypertrophy.json` is not, which is the
  entire reason it is a separate file.
- **User data** — 1RMs, sessions, training log, prefs, and the user's own
  exercises. Lives in browser storage under its own keys and is never touched by
  a catalog update.

### Three catalogs, one interface

`src/data.js` assembles what the rest of the app sees:

```
loadCatalog()                     five generated files + hypertrophy.json,
                                  goals reordered to put Hypertrophy third
withCustomExercises(cat, customs) the above, plus the user's own exercises
```

`withCustomExercises` takes the list as an argument rather than reading storage,
so `data.js` still has no idea `store.js` exists. It is re-run after every change
to that list, and it rebuilds `byId` and the prescription index from scratch —
those are derived, never patched.

The user's exercises are appended **after** the workbook's, so library row
numbers — which the warm-up and cool-down tie-breaks depend on (§5.2, §6.2) —
are untouched by anything the user adds.

Exercise ids are numbers for the workbook's and strings (`u…`) for the user's,
so they cannot collide however many times the workbook is re-extracted. Anything
that has been through an HTML `value` attribute comes back as text and goes
through `catalog.resolveId()` rather than `Number()`.

The single 1RM in the workbook (Back Squat = 100 kg) is the example value the
Read Me tells you to replace, so it is deliberately **not** shipped.

### Vocabulary

```
equipment  Bands · Barbell · Bodyweight · Bodyweight/Rings · Cable ·
           Dumbbell/Kettlebell · Machine
patterns   Carry · Core/Anti-movement · Hinge · Horizontal pull ·
           Horizontal push · Isolation · Lunge/Single-leg ·
           Olympic/Explosive · Plyometric · Squat · Vertical pull ·
           Vertical push
muscles    Adductors · Back · Biceps · Calves · Chest · Core · Forearms ·
           Full body · Glutes · Hamstrings · Quads · Shoulders · Traps ·
           Triceps
profiles   Carry · Compound · Core · Heavy compound · Isolation ·
           Olympic lift · Plyometric
goals      Explosivity · Strength · Hypertrophy · Muscular endurance
                                        ^ not the workbook's; see §16
```

The workbook's own order — Explosivity, Strength, Muscular endurance — is a
progression rather than an alphabetical list, so Hypertrophy is inserted at the
point on that line where it belongs rather than appended to the end.

Every warm-up `trigger` and every mobility `target` resolves to `Always`, a
pattern, or a muscle. Verified: 0 unmatched out of 92.

---

## 2. Prescription lookup

Workbook: `INDEX(PrSets, MATCH($G30 & "|" & $B$5, PrKey, 0))`

A composite key of `profile | goal`, so it is a plain two-key lookup:

```
prescription(profile, goal) -> { sets, reps, load, loadMin, loadMax,
                                 rest, note, setsAvg, workPerSetSec, restAvgSec }
```

`profile` comes from the exercise, `goal` is chosen once for the whole session.
Every profile has a row for all four goals — the workbook's 21 plus the seven in
`hypertrophy.json`, merged into one index before anything looks at it — so the
lookup never misses.

> `Isolation | Explosivity` is a deliberate dead end: sets/reps/rest are all `—`
> and the note redirects you to compound lifts. `setsAvg` is `0`, which drives
> the estimated time for that exercise to `0`. Reproduced as-is.

---

## 3. Suggested load

Workbook (`K30`):

```excel
IF(N($S30)=0, "Bodyweight / RPE",
IF(N($R30)=0, "Enter 1RM in library",
   TEXT(MROUND($R30*$S30, 2.5), "0.0") & "–" &
   TEXT(MROUND($R30*$T30, 2.5), "0.0") & " kg"))
```

where `R` = your 1RM, `S` = `loadMin`, `T` = `loadMax`. In order:

1. `loadMin == 0` → **"Bodyweight / RPE"**. Covers Plyometric, Core and the
   `Isolation | Explosivity` dead end — load is not prescribed as a percentage.
2. No 1RM recorded → **"Enter your 1RM"**.
3. Otherwise → `round(1RM × loadMin)` – `round(1RM × loadMax)` kg, each rounded
   to the nearest **2.5 kg**, displayed to one decimal.

`MROUND` and JS differ on exact halves: `MROUND` rounds half **away from zero**,
`Math.round` rounds half **up** (so `-1.25` goes to `-1` in JS but `-2.5/2` in
Excel). Loads are never negative here, so the engine uses an explicit
`roundToNearest` that rounds half away from zero and matches the workbook.

For `Carry` profiles, "1RM" means the heaviest total load you can carry ~20 m.

---

## 4. Time estimate

Workbook (`P30`):

```excel
IF($U30=0, 0, ROUND(($U30*($V30+$W30) + TimeSetup)/60, 0))
```

`U` = `setsAvg`, `V` = `workPerSetSec`, `W` = `restAvgSec`, `TimeSetup` = 90 s
(Prescriptions row 28 — a flat allowance per exercise for walking over, loading
the bar and adjusting the machine).

```
minutes(exercise) = round( (setsAvg × (workPerSetSec + restAvgSec) + 90) / 60 )
```

Rounded **per exercise**, then summed — not summed then rounded. Reproducing
this matters, otherwise totals drift by a minute or two.

```
session total = warm-up minutes + Σ exercise minutes + cool-down minutes
```

Treat as ±15%. It cannot know about queueing for a rack.

**Worked example** — the workbook's own Workout A, goal `Strength`:

| Exercise | Profile | setsAvg | work | rest | Minutes |
|---|---|---:|---:|---:|---:|
| Back Squat | Heavy compound | 4 | 20 | 240 | `(4×260+90)/60` = **19** |
| Romanian Deadlift | Heavy compound | 4 | 20 | 240 | **19** |
| Bulgarian Split Squat | Compound | 3.5 | 25 | 150 | **12** |
| Seated Leg Curl | Isolation | 3.5 | 30 | 105 | **9** |
| Pallof Press | Core | 3.5 | 35 | 75 | **8** |
| Farmer's Walk | Carry | 4 | 30 | 105 | **11** |
| | | | | | **78** |

Matches cell `P52` (78). Warm-up 13 + main 78 + cool-down 7 = **98 min**.

---

## 5. Warm-up selection

The interesting part. Four helper columns per drill.

### 5.1 Eligibility — `Y`

```excel
IF(OR(INDEX(WuTrigger,n)="Always",
      COUNTIF($D$30:$D$51, INDEX(WuTrigger,n))>0,     <- Pattern column
      COUNTIF($E$30:$E$51, INDEX(WuTrigger,n))>0),    <- Primary muscle column
   1, 0)
```

A drill is eligible when its trigger is `Always`, **or** matches the movement
pattern of any chosen exercise, **or** matches the *primary* muscle of any
chosen exercise.

> **Note the asymmetry.** Warm-up looks at pattern + **primary** muscle.
> Cool-down (§6) looks at primary **and secondary**. Column `F` — secondary — is
> absent from the warm-up formula. This is the workbook's actual behaviour, so
> the engine reproduces it, exposed as `matchSecondaryForWarmup: false` in case
> you want to change your mind later.

### 5.2 Selection order — `Z`

```excel
INDEX(WuPriority,n)*1000 + n
```

Sort key = `priority × 1000 + library row`. So: **priority ascending, ties
broken by library order**. Priority 1 survives a tight budget, priority 8 is
dropped first.

### 5.3 Budget fill — `AA` / `AB`

```excel
AA: SUMIFS(WuMin, $Y$12:$Y$60, 1, $Z$12:$Z$60, "<=" & $Z12)
AB: IF(AND($Y12=1, $AA12 <= $B$6), 1, 0)
```

`AA` is a **running total over eligible drills only**, in sort-key order. A
drill is included when the running total *through and including it* is `<=` the
budget (inclusive).

Because the running total is monotonically increasing, this is exactly
equivalent to: walk the eligible list in priority order, keep adding until the
next drill would overflow the budget, then stop. It is **not** a knapsack — a
later, shorter drill that would still fit is *not* squeezed in.

> Worth knowing: with a 15-minute budget the example session picks 13 minutes
> and stops, because the next drill in line is 3 minutes and 16 > 15. The 2
> minutes are left on the table by design.

### 5.4 Display order — `AC` / `AD`

```excel
AC: INDEX(WuPhaseN,n)*1000 + n
AD: COUNTIFS($AB$12:$AB$60, 1, $AC$12:$AC$60, "<" & $AC12) + 1
```

Selected drills are then re-sorted for display by `phaseOrder × 1000 + library
row` — i.e. **phase order, ties by library order**. Selection is by priority;
presentation is by phase. Two different orderings, which is why a priority-1
drill can appear above a priority-3 one.

Phases: `1 Raise` → `2 Mobilise` → `3 Activate` → `4 Specific`.

### 5.5 Worked example

Workout A — patterns `{Squat, Hinge, Lunge/Single-leg, Isolation,
Core/Anti-movement, Carry}`, primary muscles `{Quads, Hamstrings, Core, Traps}`,
budget 15 min.

| Prio | Drill | Trigger | Min | Running | ≤ 15? |
|---:|---|---|---:|---:|---|
| 1 | Easy cardio | Always | 4 | 4 | yes |
| 2 | Specific ramp-up sets | Always | 5 | 9 | yes |
| 3 | Bodyweight squat | Squat | 2 | 11 | yes |
| 3 | Glute bridge | Hinge | 2 | 13 | yes |
| 4 | World's Greatest Stretch | Always | 3 | 16 | **no — stop** |

Selected: 4 drills, 13 min. Displayed in phase order: Easy cardio (Raise),
Bodyweight squat (Activate), Glute bridge (Activate), Specific ramp-up
(Specific). Matches the workbook cell for cell.

---

## 6. Cool-down selection

Identical machinery, three differences.

### 6.1 Eligibility — `AF`

```excel
IF(OR(INDEX(MoTarget,n)="Always",
      COUNTIF($E$30:$E$51, INDEX(MoTarget,n))>0,          <- Primary muscle
      COUNTIF($F$30:$F$51, "*"&INDEX(MoTarget,n)&"*")>0), <- Secondary, substring
   1, 0)
```

- Triggers off **muscles only** — never movement patterns.
- Includes **secondary** muscles. The workbook does a wildcard substring match
  because secondary muscles live in one cell as `"Glutes, Hamstrings, Core"`;
  the engine splits that into an array at extraction time and does exact
  membership, which is equivalent for this vocabulary (no muscle name is a
  substring of another).

### 6.2 Ordering

Same as warm-up: selection by `priority × 1000 + row`, display by
`typeOrder × 1000 + row`, budget compared with `<=`, stop at first overflow.

Types: `Flow` → `Lower body` → `Upper body` → `Spine` → `Wind-down`.

Set the budget to `0` to skip the cool-down entirely.

### 6.3 Worked example

Trained muscles `{Quads, Hamstrings, Core, Traps, Glutes, Back, Shoulders,
Forearms}`, budget 8 min.

| Prio | Exercise | Target | Min | Running | ≤ 8? |
|---:|---|---|---:|---:|---|
| 1 | Cat-Cow | Always | 2 | 2 | yes |
| 2 | Downward Dog | Always | 2 | 4 | yes |
| 2 | Pigeon Pose | Glutes | 3 | 7 | yes |
| 2 | Supine Figure-4 | Glutes | 2 | 9 | **no — stop** |

Selected: 3 exercises, 7 min. Matches the workbook.

---

## 7. Training log

One row per set, exactly as the workbook.

```
volume(kg)     = weight × reps
est1RM(kg)     = weight × (1 + reps / 30)          Epley
```

Epley is reliable to about 10 reps and optimistic above that — the app shows the
estimate but flags nothing, same as the workbook.

## 8. Progress

Fully derived from the log; nothing is stored. Per exercise:

```
best est. 1RM   = max(est1RM)
heaviest set    = max(weight)
total sets      = count(rows)
total volume    = Σ volume
last trained    = max(date)
```

---

## 9. Running and logging a session

```
sets(exercise) = max(1, round(prescription.setsAvg))
```

`setsAvg` is the same number that drives the time estimate (§4), so the session
screen asks for exactly as many sets as the plan budgeted time for.

The **starting weight** offered on each set is the middle of the prescribed
range, rounded like every other suggested load:

```
weight = mround(1RM × (loadMin + loadMax) / 2, 2.5)
```

`null` when the profile prescribes no percentage, or when you have not recorded
a 1RM.

### What gets logged

Two routes, and they differ in an important way.

| Route | Rows written |
|---|---|
| **Session → Finish** | Only the sets you actually ticked, each carrying the weight that was on the row when you ticked it |
| **Saved → Did it again** | Every prescribed set, at the default mid-range weight |

A set weight can be stepped in 2.5 kg or typed. Typing accepts any value —
plates are not always on the grid, and a 183 kg total is a real number. Only
the step buttons enforce the grid: from an off-grid weight the first press
snaps to the nearest multiple **in the direction pressed** (183 → + → 185,
101 → − → 100) rather than carrying the offset along forever.

The first is the honest one: it records what happened, including a set you
nudged to 90 kg and one you left at 85. The second is a shortcut for "I did
this workout again" without stepping through it.

Every row carries:

| field | from |
|---|---|
| `date` | the session date, or today for *Did it again* |
| `goal` | the session goal — this is what feeds the goal mix in §12 |
| `weight` | the per-set weight, else `null` |
| `reps` | `null` — the session screen shows the prescribed range, it never asks how many you managed |
| `auto` | `true`, so generated rows are distinguishable from hand entries |

Reps stay unrecorded, so volume and estimated 1RM stay blank for these rows.
That is why §11 counts in sets.

Finishing saves the workout first — otherwise the log would reference a session
that exists nowhere. Each completion appends `{ date, sets }` to the session's
`completions`, which is what the Saved screen counts.

### Rest

Ticking a set starts a countdown of that exercise's `restAvgSec` — the same
number the time estimate uses. Un-ticking cancels it. The deadline is stored as
a timestamp rather than a counter, so the timer stays honest across a reload
mid-session.

### The running session owns its workout

A session in progress holds a **full copy** of the workout, not a reference to
the draft, and takes over the workout's id while the draft is re-issued a fresh
one. That is what lets you build a different workout while one is running: edit
the goal, swap every lift, and the session you are halfway through does not
move. Finishing reads from that snapshot, so the logged rows carry the goal and
name of the session actually performed.

Warm-up drills and mobility work are ticked off the same way as sets but are
not sets, so they are excluded from the count of rows that will be written —
"finish and log N sets" states what will actually reach the log.

> `Isolation | Explosivity` has `setsAvg = 0` (the workbook's dead end). The
> `max(1, …)` floor means the exercise still appears in the log rather than
> vanishing silently.

## 10. Muscle map

Front and back figures, zoned by the 13 muscle groups the library actually
uses. For a set of exercises:

```
primary   = { ex.primary   for each exercise }
secondary = { m : m in ex.secondary for each exercise }
```

A muscle can land in **both** — the primary target of one exercise and support
in another. That is not collapsed to the stronger claim; it is drawn as a
45° red/amber stripe, which is what makes "I trained this both ways" visible.

`Full body` is a catch-all in the library rather than a region, so it lights up
every group.

Muscles are drawn per view: front carries Traps, Shoulders, Chest, Biceps,
Forearms, Core, Quads, Adductors, Calves; back carries Traps, Shoulders, Back,
Triceps, Forearms, Glutes, Hamstrings, Calves. A group trained but not drawn on
a given view simply doesn't appear there — the named lists under the figure are
the complete record, and are the reason the map is never colour-alone.

## 11. Sets per muscle group

```
for each logged set:
    primary[ex.primary]      += 1
    secondary[m]             += 1   for each m in ex.secondary
```

Counted in **sets, not kilograms.** Volume needs a weight *and* a rep count on
every row, and a session logged straight from the builder has neither — sets
are the metric that survives incomplete data. Working sets per muscle group is
also the ordinary way training volume is tracked.

Primary and secondary are kept in separate buckets rather than summed: ten sets
where a muscle was the target and ten where it merely helped are not the same
stimulus. Keeping them apart is also what lets the chart reuse the map's
red/amber language.

Windows are 30 and 180 days back from today, inclusive of today.

## 12. Goal mix

Share of logged sets by goal, over the same two windows. Entries written before
goals were recorded have no `goal` and are counted under **Not recorded**
rather than folded into one of the four — the proportions never overstate what
is actually known.

## 12a. The training week

Monday to Sunday, not a trailing seven days.

```
weekStart(iso, weeks) = iso - ((weekday(iso) + 6) mod 7) days + weeks * 7
```

`getDay()` numbers Sunday as 0, so `(day + 6) mod 7` sends Sunday six days back
— into the week it finishes rather than the one it would otherwise start. This
is the ISO-8601 week, and it is also the unit people plan training in.

Every date here is formatted from **local** components, never `toISOString()`.
Local midnight is the previous day in UTC at any positive offset, which would
slide every week boundary back by a day and file Monday's training under the
week before. Same rule as the 14-day strip.

The summary reports, for the selected week:

| | |
|---|---|
| days | seven `{ date, sets }`, Monday first, including the empty ones |
| rows | §11 over the week's entries — the same primary/supporting split |
| untouched | the muscle vocabulary minus what was trained, less `Full body` |
| sets, daysTrained | totals |

`untouched` is derived from the vocabulary rather than an anatomy list, so it
can only ever name groups the catalog can actually train. It is given equal
billing with the trained rows on purpose: which groups you keep missing is the
question a weekly summary is really being asked, and a list of what you hit
does not answer it.

Navigation is clamped at the current week. There is nothing logged in the
future, and an endlessly advancing empty week is a dead end to walk into.

## 12b. Perceived exertion

A 1–10 session rating, asked when a session is finished and when a saved
workout is logged again. Skipping is a first-class answer and writes `null`.

**Where it is stored.** On the log rows, not in a table of its own. A row is the
only record that survives every route into the log — finishing a session, "did
it again", and adding a set by hand all write rows and nothing else. One
session's rating is stamped identically on every set it writes, so averaging a
session's rows returns that number.

**Grouping.** One point per `(date, sessionId)`. Sets added by hand carry their
own per-set RPE, which is a different measurement; they are grouped by date
under a single pseudo-session, so a day of hand-entered sets contributes one
point rather than one per set.

**Bucketing.** All three ranges are trailing windows ending today, so the
rightmost point is always now and changing range never pushes recent training
off the end.

| Range | Buckets |
|---|---|
| Week | 7, one per day |
| Month | 30, one per day |
| Year | 12, one per calendar month |

A bucket's value is the mean of the session ratings inside it. A bucket with no
rated session is `null`, never `0` — a day you did not train is a gap in the
record, not an effortless workout, and drawing it as zero would drag every
trend toward the floor.

**Drawing.** The axis is 0–10 and is not cropped to where the data lives.
Ratings cluster in the top half, so a cropped axis would spread them out and
overstate every difference; the point of plotting a subjective number is to
watch it move, and an axis that exaggerates the movement answers a question
nobody asked.

Bars are drawn only for buckets with a value. The line joins the sessions,
skipping over the empty buckets between them — breaking it at each gap was the
first instinct and it is wrong on a daily axis, where nobody has two adjacent
points and the style would draw nothing at all. The dots are the measurements;
the segments between them are interpolation, and a long absence reads as
exactly that: a long segment with nothing on it.

Points sit at band centres in both styles, so the switch moves the ink without
moving the data.

## 13. Colour

Chrome comes from the **Nocturne** design system — ground `#161826`, surface
`#232532`, text `#e9e9ed`, radii 4/8/14, Inter. The app defines no chrome
palette of its own.

Two things do carry meaning and so are chosen for separation, not brand fit:

| Role | Value |
|---|---|
| Explosivity | `#5f93dd` |
| Strength | `#cd7449` |
| Hypertrophy | `#c9739d` |
| Muscular endurance | `#3f9d79` |
| Primary muscle | `#ca5556` |
| Supporting muscle | `#b28d15` |

Measured against **both** Nocturne surfaces — colour-vision separation,
normal-vision separation, lightness band, chroma floor, contrast:

| Palette | Worst CVD ΔE | Worst normal ΔE | Contrast |
|---|---|---|---|
| Goals, on `#161826` | 7.6 (warn) | 16.9 | 5.19–5.62 |
| Goals, on `#232532` | 7.6 (warn) | 16.9 | 4.48–4.85 |
| Muscle, on `#161826` | 8.5 | 16.6 | 4.15 / 5.63 |
| Muscle, on `#232532` | 8.5 | 16.6 | 3.58 / 4.86 |

Two consequences worth knowing:

- **The goal warn is real.** Endurance green and Strength orange sit at ΔE 7.6
  under protanopia, inside the 6–8 band that is legal only with a second
  channel. The balance bar therefore always ships its labelled legend with set
  counts and percentages — the colours never carry the reading alone.
- **Nocturne's accent `#9184d9` is not used for interactive text.** It measures
  ΔE 6.9 from the Explosive blue — below the 15 floor — so with Explosive
  selected the two would be indistinguishable while meaning different things.
  Everything interactive wears the goal accent instead, which is also what the
  design does almost everywhere.

### The fourth goal accent

`#c9739d` was not eyeballed. Candidates were swept across hue 285–340 at the
chroma and lightness band of the three existing goals, rejected below contrast
4.5 on either surface, and scored on the **smallest** CIEDE2000 distance to any
colour they can share a screen with — the three goals, both muscle tokens, Home
yellow and the body text — in normal vision and under Viénot protanopia and
deuteranopia simulation. The winner is the candidate whose worst case is
largest.

| | |
|---|---|
| Contrast | 5.38 on `#161826`, 4.65 on `#232532` |
| Binding neighbour | Explosive `#5f93dd`, ΔE 13.0 under protanopia |
| Second binding | Endurance `#3f9d79`, ΔE 13.0 under deuteranopia |
| Nearest in normal vision | Muscle red `#ca5556`, ΔE 18.1 |

Measured the same way, the existing Endurance/Strength pair — the warn above —
is the tightest thing on screen. Adding a fourth goal therefore does not make
the set harder to read than it already was, which was the constraint.

Magenta because it is the only hue left. Red, amber and yellow belong to the
muscle tokens and Home; violet is where Nocturne's own accent sits.

The muscle pair is re-stepped rather than inherited from the documented dark
ramp: the obvious dark red and amber measure ΔE 13.0 apart, which would be a
defect exactly where the stripe needs the two to read as different.

The print sheet forces the light equivalents (`#e34948` / `#eda100`), so a
dark-UI reader does not get dark-surface steps burned onto white paper.

## 14. Deliberate departures from the workbook

| Workbook | App | Why |
|---|---|---|
| Workout A / B / C as three sheets; copy a tab for a fourth | A `sessions` list, unlimited | Copying a tab is a spreadsheet workaround, not a feature |
| *Your 1RM* in Exercise Library column J | Separate user store keyed by exercise id | So re-extracting the catalog cannot destroy your history |
| Excel date serials (`46238`) | ISO `YYYY-MM-DD` | Portability |
| Progress sheet with 167 pre-built formula rows | Computed on read | Nothing to keep in sync |
| Swedish only on the three name columns | Full `{ en, sv }` on every string, `sv` currently `null` for how-to text | Structure ready for Swedish; English ships first |
| No record of *doing* a workout | A live session screen that logs what you ticked (§9) | The workbook had you retype every set by hand |
| No muscle diagram | Front/back map (§10) | The data was already there in the primary/secondary columns |
| No rest guidance beyond a printed range | A rest timer started by ticking a set (§9) | The prescription already carries the number in seconds |
| Three goals | Four — Hypertrophy added (§16) | The most common reason to lift is the one the workbook does not prescribe |
| No record of how hard it was | A 1–10 session rating (§12b) | Load and sets do not tell you what a session cost |
| A fixed library of 167 | The 167 plus your own (§17) | No compendium covers everyone's gym |
| 1RM only in the Exercise Library | Also on Build, beside each chosen lift | The suggested load is a percentage of it, so the number is asked for where it is needed |
| You choose every lift | Quick workout generates one from four answers (§19) | The workbook assumes you already know what you came to do |
| No notion of difficulty | Three skill tiers (§18) | A beginner and a competitor cannot be handed the same 167 exercises |

### A note on the Build lift row

It was one wide button that removed the lift wherever you pressed it, with
"Enter your 1RM" sitting inside it. That text is an instruction; people followed
it and lost the exercise. Removal is now on the tick alone, and pressing the row
opens the field it was asking for. Worth remembering the shape of the mistake:
a destructive action covering the whole row, with an invitation printed on top
of it.
| A Read Me sheet you have to know to open | A guide screen behind a question mark on Home (§18) | The sequence is the thing that needs explaining, and a spreadsheet tab is not where anyone looks for it |

## 15. Not yet translated

`name.sv` is populated for all 167 exercises, 49 drills and 43 mobility
exercises — it came with the workbook. Still English-only:

- `how.sv` for warm-up drills (49) and mobility (43)
- `cue` on exercises (167)
- prescription `sets` / `reps` / `load` / `rest` / `note` (28 × 5, including the
  seven hypertrophy rows)
- equipment, pattern, muscle, profile and goal labels (~40)
- all UI chrome

The UI reads every user-visible string through `t()` already, so adding Swedish
is a data task, not a refactor. Exercises the user writes themselves are stored
as `{ en, sv: '' }` and fall back to `en`, so a Swedish build shows them under
the name they were given rather than blank.

---

## 16. Hypertrophy — the fourth goal

The workbook prescribes three goals. Hypertrophy is the app's, and it lives in
`data/hypertrophy.json` because `tools/extract-workbook.ps1` rewrites
`prescriptions.json` and `vocabulary.json` wholesale — anything merged into
those would be gone after the next run. `src/data.js` folds the seven rows into
the same prescription index at load, so §2 onwards is unchanged and nothing
downstream can tell the two sources apart.

Seven rows, one per profile, in the same shape as a workbook row. The numbers:

| Profile | Sets | Reps | Load | Rest |
|---|---|---|---|---|
| Heavy compound | 3–4 | 6–10 | 70–80% | 2–3 min |
| Compound | 3–4 | 8–12 | 65–75% | 90–150 s |
| Isolation | 3–4 | 10–15 | 55–70% | 60–90 s |
| Core | 3–4 | 10–15 / 30–45 s | moderate | 60–90 s |
| Olympic lift | 3–4 | 4–6 | 65–75% | 2–3 min |
| Plyometric | 3–4 | 8–12 | bodyweight | 60–90 s |
| Carry | 3–4 | 30–50 m | 55–70% of max carry | 90–120 s |

What the ranges rest on, cited in full in the file's own `meta.basis`:

- **Load and reps are wide** because heavy and moderate loads produce similar
  hypertrophy when sets are taken close to failure (Schoenfeld et al. 2017,
  *JSCR* 31(12)). The proximity is what the notes insist on, not the percentage.
- **Rest is 2–3 min on multi-joint work**, not the 60 s that used to be standard
  advice: 3 min beat 1 min for hypertrophy in trained men (Schoenfeld, Pope et
  al. 2016, *JSCR* 30(7)). Cutting rest costs reps, and reps are the stimulus.
- **Sets are per exercise.** The weekly target of roughly 10–20 hard sets per
  muscle is dose-responsive (Schoenfeld, Ogborn & Krieger 2017, *J Sports Sci*
  35(11)) but is the user's to assemble across sessions — the app prescribes an
  exercise, not a mesocycle. §11 and §12a are the tools for checking it.
- **0–3 reps in reserve**, not failure on every set (Baz-Valle et al. 2022,
  *PLoS ONE* 17(4); Refalo et al. 2023, *J Sports Sci* 41(6)).

Two rows are honest about being poor fits. Olympic lifts and plyometrics are not
hypertrophy tools — technique fails before the muscle does — and their notes say
so and point the volume elsewhere. They still carry real numbers rather than the
workbook's `Isolation | Explosivity` dead end (§2), because a session containing
a power clean should still estimate and prescribe something.

These are population-level starting points. Nothing in that file is advice for a
particular person.

---

## 17. Exercises the user writes

Same shape as a workbook row, so everything downstream works on one unchanged:
the warm-up triggers off its `pattern` and muscles (§5.1), the prescription
comes from its `profile` (§2), the map paints it (§10), the log counts it (§11),
and it takes a 1RM (§3).

`profile` is the one field with no natural answer, because it is the workbook's
vocabulary rather than a property of the movement. The form asks for it plainly
and shows what it will prescribe for the current goal, which beats inferring it
from the pattern and quietly prescribing the wrong thing.

### Removing one

| Referred to by | What happens |
|---|---|
| nothing | deleted |
| a log entry, a saved workout, the draft, or the live session | archived |

Archived means out of the library and the picker, still resolving everywhere it
is already mentioned, restorable. Deleting an exercise a log entry points at
would not free anything — it would turn that entry into a row the app cannot
name and drop its sets out of every muscle and goal total, as though the
training had not happened. The confirmation names the counts either way, and a
second deletion attempt on something already archived is allowed and says what
it costs.

### Backup

`store.exportAll()` includes them. A backup file written before this existed has
no `customExercises` key, and restores a library with none in it rather than
failing.

---

## 16a. Naming the three phases

One set of names — `phase.warmup`, `phase.main`, `phase.cooldown` — used by the
plan, the live session and the print sheet, so all three say the same words.

They did not before. The plan read `Warm-up · 15 min`, `Main · 36 min`,
`Mobility · 9 min`, the live session said `Mobility`, and the print sheet said
`Main session` and `Cool-down`. Three problems:

- **"Main"** was the workbook's column heading, not something anyone says.
  Main what? It is the lifting, so it is **Main lifts**.
- **"Mobility"** named the contents rather than the phase, and disagreed with
  both the code and the printed sheet. The phase is the **cool-down**;
  mobility is what is in it.
- **Minutes without a count** says how long but not how much. `5 drills · 15
  min` answers both, and the pair is what tells you whether you have time.

They were also set in `.section-label` — the same 11px uppercase letterspaced
micro-type as every minor caption in the app — which made the largest divisions
on the screen read as decoration. `.phase-head` is sentence case at 15.5px with
the count and duration carried right, so they can be compared down the column.

`phaseHead(..., { explain: true })` adds a line of plain English about what the
phase is for. On the plan only: there you are reading and deciding, and during
a session you already know what a warm-up is and want the list, not the lecture.

The live session keeps its warm-up and cool-down as blocks rather than putting
a phase header above them — a block already carries a title, a count and a
tick, so a header would say the same thing twice. The lifts are the gap: they
are one block each, so without a header for the group they simply began, with
nothing marking that the warm-up was over.

### How to do the movement

Every warm-up drill and every mobility move in the workbook carries a `how`
string — a sentence or two on performing it. Until now it appeared only on the
print sheet, which is no use to someone standing in the gym holding a phone,
and the cool-down is exactly where you meet a movement you have never done.

`checkRow` takes it as a fourth argument and grows the affordance a set row
already has: the row itself is the action, and an `i` button beside it opens a
panel underneath. Same shape, same position, same gesture as the pencil that
opens the weight stepper — one thing to learn, not two. Rows with nothing to
say get no button rather than one that opens an empty panel.

It expands in place. The text is a sentence or two; a modal mid-session would
cover the list, lose the scroll position, and have to be dismissed before you
could tick anything off.

One open at a time, held in `live.howOpen` the way `live.editing` holds the
open weight stepper — opening the next closes the last, so the list cannot
quietly grow to twice its height while you read. It survives ticking the row it
belongs to: a finished drill dims, the note does not, because you may still be
reading it when you tick.

The plan screen does not offer this. There the drills are a flat three-column
list you are skimming to decide whether the session fits; the instructions
belong where the movement is performed.

---

## 17. Screen transitions

Navigation was a hard cut: `render()` replaces the whole subtree, so switching
tab swapped one screen for another with nothing in between.

**Only the content moves.** `.screen-inner` animates; `.sticky-actions`, the
rest timer and the tab bar do not. Chrome holding still is what makes the
moving part read as "a new screen arrived" rather than "everything lurched".

It is also the only place the transform *can* go. `.sticky-actions` and
`.rest` are `position: sticky` siblings of `.screen-inner` inside `.screen`,
and a transformed ancestor becomes their containing block — animating
`.screen` would break both for the length of every transition.

**Enter only.** The outgoing screen is gone before anything could animate it.
Keeping both in the DOM to cross them over is a real architectural change for
an effect nobody asks for, and a tuned enter reads the way a native push does.

**Direction is the whole vocabulary.** `SCREEN_DEPTH` gives each screen a
level; the sign of the difference picks the motion.

| Move | Motion | Duration |
|---|---|---|
| deeper (`build` → `plan`) | rises 10px, fades in | 200ms |
| shallower (`plan` → `build`) | drops 10px, fades in | 200ms |
| level (`home` → `log`) | rises 5px, fades in | 150ms |

Tab switching is the fastest because it happens dozens of times in a session,
and anything repeated that often should get out of the way. The first render
has no previous screen and gets nothing — animating the app into existence on
load is a splash screen, and this app opens instantly.

**The hard part is not animating.** The app re-renders on *every* interaction —
ticking a set, typing a name, tapping a chip. Firing the transition on each
one would flicker constantly and feel slower than the hard cut it replaced. So
the class is only applied when the render actually changes screen.

That alone is not quite enough: a navigation is often followed immediately by a
second render in the same call stack, `finishSession` doing `go('home')` and
then `flash()`. That second render would replace the DOM mid-animation and
arrive with no class, snapping the screen in. `state.nav` carries a timestamp
and the class survives for `NAV_MS`.

> `NAV_MS` is 60ms, far shorter than the animation. Those follow-up renders are
> in the same call stack, so a few frames covers them — and a longer window
> starts catching real interactions, replaying the whole transition because
> someone tapped a chip quickly after switching tab. It was 260ms first, which
> did exactly that.

---

## 17a. Home

Three questions, in this order, and nothing else:

| | |
|---|---|
| What am I doing now? | the hero card, and the two ways to get a session |
| How did this week go? | the week card |
| How am I trending? | balance, and the way through to the Log |

### What was wrong

Three container idioms ran down one column — a bordered card with a gradient
accent line, a bordered button, and two sections with no container at all — so
nothing looked related to anything and the eye had no grouping to work with.
A 14-day streak strip sat immediately above the Monday-to-Sunday card,
answering nearly the same question in a second visual language. Five colour
systems shared the screen. An `h1` reading "Home" spent the largest type
available restating the tab the user had just pressed.

### The rules

**One card.** `.home-card` — same border, radius, padding, `.is-link` for the
ones that navigate.

**Three ways to start, as one block.** Two square tiles (Quick workout, Build)
over a wide `.start-platform` carrying the saved workouts, all the same
material. The platform is the only one with contents rather than a promise: a
saved workout already exists, so its chips load straight to the plan — one tap
from Home rather than three. Each chip wears its goal colour on the left edge,
the same coding the Saved screen uses, so the rail can be read without being
read.

> A `PLANNED` hero card sat above all of this, holding the draft session with a
> Start button. Removed on request. The consequence is real and worth knowing:
> the draft is now reached through the Build tab, and a built session is
> started from Plan rather than from Home. A running session is still reachable
> anywhere via the resume bubble. Twelve `today.*` strings went with it.

**One accent.** Home is not a training mode (§13), so Home's yellow is the only
emphasis colour it owns. Goal colours appear exactly twice, both times naming
a goal: the pill on the planned session, and the balance bar, which ships its
labelled legend directly beneath it. The muscle red/amber does not appear on
Home at all — the primary/supporting split is real but it cannot be read
without its legend, and the legend belongs with the full breakdown on the Log.
Home answers *whether* a group was trained; the Log answers *how*.

**Two equal ways in.** Build was a filled button inside the planned card;
Quick workout was a wide bordered panel below it. That layout had an opinion —
that Build was the real route and the generator an add-on. They are two
answers to the same question and are now the same size, side by side. With
nothing planned they take an accent border, since they are the only way
forward.

**One week strip.** The day cells carry the volume the 14-day strip was
showing, scaled within the week and floored so a trained day is always
visible. `dailySets` went with it. The set count is no longer printed in the
cell — beside "10–16 Aug" it read as a date — so the height carries it and the
tooltip has the figure.

**One coverage control.** A legend, a list of paired bars and a separate "not
trained this week" paragraph — three elements, two colour languages, one
question — became a row of pills: filled with a count if trained, outlined if
not. Trained first by volume, then the rest.

**No nested frames.** An empty state inside a card uses `.card-empty`, plain
text, rather than the dashed `.empty` panel, which put two borders around one
message.

### Saved workouts

The same card, grouped by goal.

Grouped rather than sorted: the goal is a category, and a flat list ordered by
one leaves the boundary between Strength and Hypertrophy nowhere in
particular. Groups follow the goal order from §1 — the intensity continuum,
not alphabetical — so the list reads the way Build does. Empty goals are not
shown. A workout saved under a goal the catalog no longer lists lands in an
"Other" group with a neutral swatch rather than disappearing.

Within a group: most recently completed first, since what you trained last is
what you are most likely to want again. Never-completed workouts sort by save
date, below everything that has actually been done, and their completion line
stays grey — a workout you have never trained should not wear the same colour
as one you have.

The goal colour is a 3px stripe on the card edge, not another pill. The group
header already names the goal, so the word on every card would be noise, but
the stripe survives the header scrolling off and makes a long list scannable
by colour alone. The goal is dropped from the meta line for the same reason;
what is left is what the header cannot tell you.

`NEUTRAL_SCREENS` gained `saved` for a sharper reason than Home and the guide
have: it is a list of workouts of every goal, each colour-coded to its own,
and the screen accent was painting all of them in whatever the draft session
happened to be. A magenta wash over a column of orange and blue stripes.

---

## 18. Complexity tiers

The compendium records what an exercise trains and never how hard it is to do
well, so Quick workout needs a third axis the workbook does not have.

Three tiers, **cumulative**: `basic ⊂ medium ⊂ advanced`. Choosing advanced
excludes nothing.

They measure the skill and coaching a movement needs before it is worth
loading, **not** how hard the set feels. A leg press to failure is agony and
still basic. Familiarity counts as skill you probably already have: the barbell
squat, bench, deadlift, press, row and pull-up are basic despite being
technical, because they are the lifts every beginner programme is built from.

`data/complexity.json` is a rule plus a correction list:

```
rule      Olympic lift -> advanced, Plyometric -> medium, everything -> basic
override  62 exercises named individually
```

The rule cannot be right on its own — a Bodyweight Squat and a Pistol Squat are
Compound / Bodyweight / Squat / Quads all the way down — so the overrides carry
the judgement and the rule only has to cover the bulk. The rule is also what
tiers the user's own exercises, since nobody is going to hand-rate those.

Resulting split: **91 basic, 40 medium, 36 advanced** of 167.

Overrides are keyed on the English name. A renamed exercise falls back to its
rule tier rather than breaking.

Two demotions worth knowing: the Kettlebell Swing and Push Press come down off
the Olympic-lift rule. The swing is a hinge taught in every commercial gym, and
the push press is an overhead press with legs where the bar is never caught.
Four plyometrics come down to basic — Box Jump, Jump Squat, Pogo Hop, Medicine
Ball Slam — because they are how the rest are taught.

---

## 19. Quick workout

Inputs: target muscle groups, total minutes, goal, warm-up and mobility budgets,
complexity, and a seed.

### Time

```
mainBudget = minutes - warmupBudget - cooldownBudget
```

The number the user gave is the **whole** session. Treating it as lifting time
would produce a plan whose own estimate exceeded the only figure they knew for
certain. `mainBudget <= 0` is reported rather than generated around, and the
generate button is disabled while it holds.

### Selection

Round-robin across the chosen groups, not one ranked list. With three groups
selected a ranked list reliably spends the whole budget on whichever has the
most catalog entries; one exercise per group in rotation spreads the session
over what was asked for, and running out of time truncates the last lap.

The rotation order is shuffled from the seed, or the group listed first would
get the heaviest exercise every time.

Within a group, candidates are weighted:

| Match | Weight |
|---|---|
| exercise's primary is the group | 4 |
| exercise's primary is `Full body` | 2 |
| group appears in the exercise's secondary | 1 |

The pick is **weighted-random**, not best-first. That is the noise: the same
request on a different seed is a genuinely different session.

Assistance is a fallback, not a rival. Candidates that actually target the group
are taken first and absolutely; the weight-1 rows are only reached when the
group has nothing of its own left. Weighting alone let a Barbell Row into an
arms session and a Back Squat into a core one — both correct readings of the
secondary column, neither what anyone tapping "Biceps" is asking for.

### One exercise per movement

The duplicate key is `pattern | role | target`:

- **pattern**, not pattern-and-primary. Barbell Bench Press is Chest and
  Close-Grip Bench Press is Triceps, so the pair let a chest session return two
  bench presses and call them different movements.
- **role** — accessory (`Isolation` and `Core` profiles) or main — because
  pattern alone is far too coarse. Every chest exercise in the catalog is
  Horizontal push, the flies and the Pec Deck included, so one-per-pattern
  blocked the entire chest pool after the first press and left only a Vertical
  push that happens to list Chest as a secondary. A press and a fly are not the
  same movement twice.
- **target**, only inside the bucket patterns `Isolation` and
  `Core/Anti-movement`, where the pattern says nothing about the movement. One
  biceps isolation, one core brace.

### Other constraints

Zero-minute prescriptions are excluded. `Isolation | Explosivity` has
`setsAvg: 0` (§2), so it costs nothing and would be selected forever.

Capped at 8 exercises, which the time budget usually reaches first.

Ordered for the session, not for selection: Olympic lift, Plyometric, Heavy
compound, Compound, Carry, Core, Isolation. Technical and heavy work while you
are fresh.

### The seed

`mulberry32`, and the integer is stored on the session as `session.quick.seed`
alongside the inputs. Two consequences: **Shuffle** on the plan re-rolls the
same request with a new seed, and re-opening a generated plan shows the workout
it showed before rather than quietly producing another one.

Shuffle reads its inputs off the session rather than off the Quick screen, so it
still works on a generated workout loaded back from Saved.

> The generate button reads `quickState()` when clicked rather than closing over
> the value from render. The time picker updates state without re-rendering —
> see below — so anything captured at render time is one scroll out of date.
> That bug shipped a 5-minute budget an 8-exercise workout.

### Marking the result

A generated session is indistinguishable from a hand-built one — that is the
point of routing it through Plan — so it has to say so itself.

- A reveal overlay between Generate and the plan, roughly 1.3s door to door.
  The step lines are the real stages and their numbers come off the finished
  result, so nothing claims work that did not happen. Skipped entirely under
  `prefers-reduced-motion`, which is a request for less of exactly this.
- An **Auto-generated** badge on the plan, for the life of the session rather
  than the transition. "Did I choose these or did it?" is a question the saved
  list still has to answer a fortnight later.
- The plan's exercise cards stagger in, but only on the render straight after
  generating (`state.freshQuick`). Arriving any other way is instant.

Timing is one object, `REVEAL`, because the CSS delays are written inline from
it and the teardown timer is computed from it — split them and the overlay
leaves mid-sentence. Steps are 620ms apart, which is a line of six or seven
words read rather than glimpsed; the result holds 900ms; the whole thing is
about 3.2s. The first pass was 170ms a line, which registered only as
"something happened". A tap anywhere skips to the end, because the pacing is
for a first read and by the tenth generate you know what it says.

The overlay comes down on a timer, not an `animationend` listener. If anything
stops the animation running, a stuck full-screen panel over the app is a far
worse failure than a missed flourish.

`markHandEdited()` deletes `session.quick` on any hand edit to what the
generator decided — the lift list, the goal, the budgets. Two reasons: the
badge stops claiming something untrue, and Shuffle disappears instead of
sitting there ready to throw away the edit that was just made. Editing the
session name or a per-lift weight leaves the marker alone, since Shuffle would
not overwrite either.

### Focus, and the accent pulse

Four cards in a horizontal scroller, each carrying the goal's blurb and the
prescription a heavy compound would get under it. Pills gave a goal a word and
nothing else, which assumes you already know what the word means — and Quick
workout is the screen someone reaches for when they do not. Side-scrolling
rather than stacked because Focus is one of six sections here and four
full-width cards would push the rest off the bottom.

`scroll-padding: 0 20px` matters: the scroller bleeds to both screen edges and
pads itself back, and without matching scroll padding the snap aligns a card to
the scrollport edge and scrolls straight past that padding on load, leaving the
first card flush against the screen instead of lined up with its label.

The scroll position is held in `state.focusScroll` and restored on the frame
after each render. Choosing a card re-renders, which builds a fresh scroller
parked at the start — so picking Endurance snapped the row back to Explosive
and put the card you had just chosen out of sight. Restoring has to wait a
frame: `scrollLeft` does nothing on a node that is not laid out yet.

The cards carry no swatch. The chosen one is already tinted its own colour in
the border, the background and the name, so a dot beside the title was a legend
for something the card was saying three times over.

Holding the position creates its own problem: arriving on a screen unable to
see which goal is selected. So the chosen card is scrolled into view on mount
*only if less than 60% of it is visible*. Nudging a card that is merely clipped
at the edge would reintroduce the jump the position-holding exists to prevent.

**Build uses the same scroller.** Its goal picker was four stacked full-width
cards, the chosen one expanded — measured at 474px, 58% of an 812px viewport,
to choose one of four things, and it pushed the lift list to y=713, below the
fold. The scroller plus the prescription strip is 264px and the lifts start at
y=451. Sharing the component also means the pulse behaves identically in both
places, which it visibly did not when Build had its own cards.

That also fixed a subtler complaint: the pulse *was* wired to Build and firing
correctly, but Build had only two accent-bearing elements on the whole screen,
so the wave had almost nothing to leave behind and read as broken. The goal
detail's figures fall back to `--g`, which puts four more on screen.

Build's `h1` read "Build" — the same wasted-title problem as Home's — with a
labelled name field costing another 66px directly beneath it. The name is the
title now. It stays an `<input>` so typing behaves as before, and it does not
re-render on keystroke or the caret would jump on every letter.

Choosing a goal repaints every interactive surface, since `--g` drives all of
them. Rather than snapping between two saturated colours, the new one arrives
as a wave:

| | |
|---|---|
| the pulse | a circle in the new colour expanding from the press point, `z-index: 0` — above `.app`'s flat background and below `.screen`, so it washes *through* the transparent cards rather than over them |
| the repaint | each element changes colour **as the front reaches it** — `staggerRepaint` gives every node a `transition-delay` of its own distance from the press over the wave's speed |

The first version cross-faded everything at once, so the colour was already
changing across the whole screen while the circle was still small. The wave has
to arrive somewhere before that place changes.

That is why the pulse expands **linearly**. A constant speed makes delay
directly proportional to distance; an eased radius would need the inverse of
the easing curve to stay in step. The softening comes from opacity stops inside
the keyframes instead, which costs nothing in accuracy.

Ordering matters and is easy to get wrong. `apply()` re-renders with the new
accent already applied, so `pickGoal` puts the old one straight back, installs
the delays, and only then sets the new value — two frames later, because a
transition needs the property to have been watched when the value changed.
Setting both in one frame is a single style change with nothing to transition
from.

The repaint rule uses **longhands, and declares no `transition-delay`**. The
`transition` shorthand resets delay to zero, and carrying `!important` it beat
the inline per-element delay and collapsed the wave back into everything
changing at once. It still has to be `*` with `!important` on the other
longhands — the accent reaches dozens of unrelated selectors and an enumerated
list would rot the first time another was added.

The transition is added for the pulse and removed after; left on permanently it
would put a fade on every hover in the app.

The pulse is appended *after* the re-render, because `render()` replaces the
whole app subtree and would take the element with it. It scales a fixed-size
element rather than animating width and height, so the wave runs on the
compositor. Removal is on a timer, not `animationend`, so a suppressed
animation still leaves the app repaint-free.

The origin is the pointer coordinates, falling back to the control's centre for
a keyboard activation (which reports `detail: 0` and coordinates of 0,0, and
would otherwise fire from the top-left corner), and clamped to the viewport
because a card in a horizontal scroller can be activated while scrolled out of
sight.

> `screenAccent()` returns the *quick* goal on this screen, not the draft
> session's. Without that the focus cards were changing a colour the screen
> never showed: the pulse spread and nothing followed it.

### The time picker

The one scroll-driven control in the app: a scroll-snap strip, 15 to 120 in
fives, with a fixed marker at the centre. Whichever tick is nearest the middle
is the value; gutters of half the strip width let 15 and 120 reach it.

It updates its own readout, its selection and the total/warm-up/lifting line in
place and never calls `render()`. Re-rendering mid-scroll would replace the
element being scrolled and kill the momentum under the user's thumb — the same
reason the rest timer edits two values instead of re-rendering (§9).

---

## 18. The guide screen

Eight steps in the order the app is actually used — goal, lifts, 1RM, budgets,
generate, run, rate, review — plus three notes (your own exercises, saved
workouts, where the data lives). Each step is a title and a sentence or two;
three of them carry a button into the screen being described.

It teaches the **sequence**, not the feature set. Every screen already displays
what it can do; what an arrival is missing is that the goal rewrites every
prescription, that the warm-up is derived from the lifts you chose, and that
ticking a set is what writes the log. None of those are visible from any one
screen.

**Not shown on first run.** It is reached from a question mark on Home and
nowhere else, and nothing opens it automatically. A tutorial nobody asked for
is a modal between the user and the thing they opened the app for, and the
button does not expire — "what does the warm-up budget do" is a question that
arrives on day thirty, not day one.

**It is not a training mode**, so it joins Home in `NEUTRAL_SCREENS`: Home's
yellow, and no corner glow. Wearing a goal accent would mean picking one of the
four the page is there to describe. The Home tab stays lit while it is open,
the same as Saved.

The step list is data (`GUIDE_STEPS`) and the prose is i18n keys
(`guide.step.<key>.title` / `.text`), so translating it is the same data task as
everything else in §15, and reordering the walkthrough does not mean touching
markup.

Contrast, measured by compositing each token over `#161826`:

| | |
|---|---|
| Step title, note title | 14.5 |
| Jump links | 12.8 |
| Step number badge, on its tinted disc | 15.3 |
| Lede | 9.2 |
| Body text, goal key labels | 6.8 |
| The question-mark button | 5.1 |

---

## 20. Conditioning — HIIT, and why it needed a second unit of work

Everything above this section assumes the unit of work is **a set with a
weight**. A log entry is `{exerciseId, setNo, weight, reps}`; volume is
`weight × reps`; a prescription comes from `profile × goal → sets/reps/%1RM`;
the live screen is a checkbox per set. Conditioning's unit is **a time
interval**, and for an AMRAP the score is the *output* rather than the input —
you do not know it until you stop.

That is the whole of the difficulty. Adding movements is the easy part.

### What was already there

More than expected. Push-Up, Pull-Up, Dip, Plank, Wall Sit, Bear Crawl,
Farmer's Walk, Walking Lunge, Box Jump, Jump Squat, Thruster, Kettlebell Swing,
Medicine Ball Slam, Sled Push and Broad Jump are all in the compendium already.
What was missing was the **monostructural** work — there is no rower, ski erg,
bike or treadmill anywhere in 167 exercises — and the burpee family.

So `data/conditioning.json` is two lists rather than a second catalogue:

- **`movements`** — the 22 the compendium genuinely lacks, as ordinary catalog
  rows with string ids (`c1`), the same trick the user's own exercises use to
  avoid colliding with the workbook's numeric ones.
- **`paces`** — an overlay on exercises that already exist, keyed on the English
  name like `complexity.json`. A Thruster does not need a second catalog row; it
  needs a second *way of being prescribed*.

Together that is **58 movements pickable for conditioning** out of 189 total,
with only 22 new rows.

### Pace is the keystone

Every conditioning movement declares a **pace: units per minute at a hard but
repeatable effort** — roughly what you could hold for ten minutes. Everything
else derives from it:

| Format | Sizing |
|---|---|
| EMOM | a chunk of about 40 s → `pace × 40/60` |
| AMRAP | a round of 60–120 s, split across its movements |
| Intervals | work period × pace |
| For time | estimated duration = total units ÷ pace |

Get the pace right and every format sizes itself. Measured across all 58
movements: EMOM chunks land at 39–41 s against a 40 s target, and three-movement
AMRAP rounds at 59–78 s against a 60–120 s band, with nothing out of band.

Time-based movements (planks, holds, battle ropes) carry `pace: 60` — a minute
of work per minute — so the amount *is* the duration and no special case is
needed anywhere downstream.

These are middle-of-the-distribution numbers, not benchmarks. They exist so a
generated workout lands in the right ballpark — twelve burpees in a minute
rather than forty. A session that comes out too easy is a pace to tune.

### Conditioning movements are ordinary catalog rows

They have to be. A log entry refers to an exercise id, the warm-up builder reads
`pattern` and `secondary` off whatever is in the session, and the "how to do it"
panel wants the same `how` field a mobility drill has. A parallel catalogue
would mean teaching every one of those about a second kind of exercise.

`mode: 'conditioning'` is what keeps them out of where they do not belong. Rows
without the field are lifting rows, so nothing that already existed had to
change — only the five places that enumerate the catalog now say which pool they
mean:

| Site | Pool | Why |
|---|---|---|
| Library | `liftingPool` | every card offers a 1RM and filters on equipment |
| Build picker, manual log | `liftingPool` | both are weight × reps |
| Quick workout (`engine.js`) | `liftingPool` | prescribes against %1RM |
| Reveal animation's pool count | `liftingPool` | it is counting what it drew from |

`catalog.conditioningOf(exercise)` returns `{unit, pace, kit, impact, tier}` or
null, resolving native movements and overlaid lifts to one shape so callers
never have to know which they are holding.

### Kit, so the generator can ask

Four availability groups — `erg`, `run`, `floor`, `rig` — because the equipment
question is real here in a way it never was for lifting: a ski-erg workout is
useless to someone without a ski erg. Current spread: floor 44, rig 8, erg 4,
run 2.

### Tier, reused as-is

The same three tiers and the same meaning as §18: how much skill a movement
needs before it is worth doing *fast and tired*, not how much it hurts. An air
bike is agony and still basic; double-unders are advanced because a beginner
doing them under fatigue mostly whips their own shins. Spread: 32 basic, 15
medium, 11 advanced.

`indexComplexity` now checks `exercise.tier` before the override list, so a row
that states its own tier is believed. That saves `conditioning.json` from having
to repeat its whole movement list inside `complexity.json`.

### Conditioning is not a fifth goal

Tempting, and wrong. `session.goal` feeds `getPrescription(profile, goal)`, and
a fifth value would return nothing for every lifting profile — a user who picked
Conditioning and a Back Squat would get an empty prescription.

So the four goals stay as they are, and conditioning carries its own accent off
the session's *kind* instead. The log is the one place the word appears as a
goal: conditioning entries are written with `goal: 'Conditioning'` so the weekly
summary and the goal mix can report it. The string is doing two different jobs —
prescription lookup and reporting — and only the reporting job needs a fifth
value.

### The accent had to break the pattern

The four existing accents sit at L 58–60, chroma 38–50, contrast 5.2–5.6: one
lightness, four hues. Sweeping a fifth hue through that same band — 14,754
candidates — found nothing usable. The best normal-vision separation left is
ΔE 26.7, at a gold that collapses to ΔE 2.6 against Strength under deuteranopia.
The best colourblind separation is ΔE 9.7, at a rose that would then be the
closest pair in the palette. **Four hues at one lightness have used the circle
up.**

So `--goal-conditioning: #43b8c4` is *brighter* rather than merely differently
hued — L 69 against their 59 — letting lightness carry the separation hue no
longer can. It lands at ΔE 20.1 normal, 15.2 protanopia, 11.8 deuteranopia, all
three above the 10.5 the existing four already sit at among themselves, at
contrast 7.45. Cyan because 164°–276° is the one genuinely empty arc, and
because reading hotter than the strength goals suits the mode meant to be hard.

### Still to come

This section covers the data foundation only. The formats (EMOM, AMRAP, Tabata,
intervals, for time), the generator, the equipment ask, the countdown screen and
the score history are not built yet. The shape they will attach to:

```js
session.conditioning = { blocks: [ {
  id, format, minutes,
  partner: null | { mode: 'alternating' | 'shared' | 'relay', people: 2 },
  movements: [ { ref, amount, unit } ],
} ] }
```

Optional field, which is what makes a HIIT block able to be either a session of
its own (no `exerciseIds`) or a finisher on a lifting session (both present).
One field, both answers.

---

## 21. Conditioning formats and generation

Five formats, one generator, and the only thing that makes that possible is
`pace` (§20). Sizing a station is `pace × seconds / 60`; everything else is the
shape of the clock around it.

### The split that runs through everything: window-driven vs amount-driven

| | Formats | The clock says |
|---|---|---|
| **Window-driven** | EMOM, intervals, Tabata | how much work fits |
| **Amount-driven** | AMRAP, for time | how long the work takes |

This distinction decides three separate things — partner scaling, rounding
direction, and whether a round count exists — so it is worth naming once.

### Format shapes

| Format | Shape | Stations |
|---|---|---|
| **EMOM** | one movement per minute, rotating; 40 s of work in each | 2–4, chosen to divide the duration evenly |
| **AMRAP** | fixed round, count the rounds | 2–4, 30 s of work each |
| **Intervals** | 30/30, 40/20, 45/15, 60/60 or 90/60 | 1–2, alternating |
| **Tabata** | 8 × 20/10 = 4 min, per movement | 1–4, duration derived |
| **For time** | 3–5 rounds against a cap | 2–4 |

EMOM stations divide the duration where possible, so every movement comes up the
same number of times — fairer and easier to read off a plan.

AMRAP rounds are **30 s per movement**, not a fixed round length divided by the
movement count. A fixed 75 s round split four ways is 19 s each, which prescribes
three calories of ski erg — an amount too small to be worth walking to the
machine for. Real four-part AMRAP rounds are two-minute rounds.

Tabata's duration is derived and **floors**: ten minutes asked for gives eight of
Tabata, not twelve. Under-filling a budget is time the user can spend elsewhere;
overrunning one is the app deciding how long their evening is. Intervals filter
their shape list to those fitting four rounds in the budget for the same reason —
forcing a four-round minimum onto a 90/60 shape pushed an eight-minute ask to ten.

### Partner maths

The user asked for three modes, and they scale in two different ways:

- **`alternating`** (you go, I go) — one person works at a time, so each gets
  half the turns. In an **amount-driven** format that buys a **1.3× rest bonus**:
  a full turn off means you can go harder than a pace assuming continuous work.
  In a **window-driven** format it buys **nothing**, because a minute is sixty
  seconds whatever you do. An early version applied the bonus everywhere and
  prescribed *50 seconds of work inside a 60-second minute* — not a harder
  workout, just an impossible one. Alternating in an EMOM is simply the same
  prescription taking turns, which is how anyone actually runs it.
- **`shared`** and **`relay`** — everyone against one target, so the amount is
  the **combined** figure and scales with `people`. Correct in both families: a
  combined 80 s inside a 60 s minute is 40 s each, because both are working.

### Rounding direction

`niceAmount` snaps to a ladder of numbers workouts are actually written in — 15
burpees, not 17.33. Window-driven formats snap **down** (`fit`), amount-driven
ones snap to the **nearest**. In an EMOM, work that does not fit eats the rest it
was sized to leave, every single round; landing a rep light is free, landing a
rep heavy compounds.

When nothing on the ladder fits the window, the window wins: a 20-second Tabata
on a rower is four calories whatever the ladder's opinion of small numbers. That
one line is the difference between 46 impossible prescriptions and none.

### Movement selection

Weighted-random from the pool, filtered by kit, tier and impact, with two
constraints:

- **No repeated `pattern|primary` shape** inside a block.
- **Role diversity** — `mono`, `upper`, `lower`, `core`, `full` — with a
  **cubic** penalty on a used role. Linear was not enough: `lower` has far more
  candidates than any other role, so a quarter weight still produced
  `mono, lower, lower`, which is a leg workout wearing a conditioning workout's
  clothes. Cubed, a used role drops to an eighth.

### Measured

Sweeps against the real catalog, not inspection:

| | |
|---|---|
| Blocks generated | 3,000 across 6 partner configurations |
| Shortfalls | 0 |
| Duplicate movement in a block | 0 / 500 |
| Three of one role in a block | 0 / 500 (was the failure the cubic penalty fixed) |
| Prescriptions exceeding their work window | 0 / 4,626 |
| Blocks over the time budget | 0 / 600 |
| Amounts too small to prescribe | 0 |
| Time-budget fill | median 1.00, worst 0.64 (Tabata capped at 4 movements) |
| Window fill | median 0.90, p95 1.00 |
| Movements reachable | 58 / 58, hit counts 142–219 |

---

## 22. Conditioning on the plan

### Where it attaches

`session.conditioning.blocks` is optional, and that single fact delivers both
halves of what was asked for: a draft with no `exerciseIds` and one block is a
**conditioning session**; a draft with both is a **lifting session with a
finisher**. Nothing has to choose between them, because the draft already says
which was meant.

On the plan the block sits **after the lifts and before the cool-down**. A
finisher is the last hard thing you do and the cool-down is what brings you down
from it — fifteen minutes of EMOM after the mobility work would undo the only
job the cool-down has.

### One card, not one per movement

A lift gets an `.ex-card` with sets, reps, a load and a body map, because a lift
is a thing you do on its own. A conditioning movement means nothing apart from
the round it sits in, so giving each one a card would break up the only unit
that matters. The block is one card and the movements are a list inside it —
which is also how it would go on a whiteboard, and that is not a coincidence.

The header carries **each format's own sentence** rather than a generic count,
because the same "12 min" means different things: a limit in an AMRAP, a cap you
hope not to reach in a for-time, a duration in an EMOM.

| Format | Header reads | List is labelled |
|---|---|---|
| EMOM | `15 min · one movement a minute` | The minutes rotate |
| AMRAP | `As many rounds as possible in 12 min` | Each round |
| Intervals | `6 × 60s on, 60s off` | Each work period |
| Tabata | `3 × 8 rounds of 20s on, 10s off` | Four minutes each, in this order |
| For time | `4 rounds for time · 12 min cap` | Each round |

An AMRAP also prints its estimated round count, hedged (`about 8 rounds, if it
goes well`) because it is a guess — but an AMRAP with no idea how many rounds is
a workout you cannot pace.

### What a liftless plan is called

A session with no lifts is titled by its conditioning and its format, not by
whatever the draft was called before. Without this the plan printed **"Leg body /
Strength"** over an AMRAP — a name for a workout that was not there, and a goal
word naming a prescription axis conditioning does not sit on. The same fix
applies to the print sheet's header, which had the same bug.

The body map is hidden too: it reads muscles off the lifts, and an empty
silhouette under "What this trains" answers the question with a blank.

### Accent

Conditioning wears the fifth accent on its own screen, and on a plan whose
**only** content is a block. A plan with lifts *and* a finisher keeps the lifts'
goal colour, because the lifting is still what the session is.

The format and partner cards get **no accent pulse**, unlike the goal cards. The
pulse exists to announce that the theme colour changed, and this screen is
conditioning cyan whichever shape you pick — a wave that recoloured nothing would
be decoration pretending to be feedback.

### Generation guards found by looking at output

Two format rules exist only because a four-minute block exposed them:

- **AMRAP stations are capped at `minutes / 2`.** A round is `stations × 30`
  seconds, so the round count is `2 × minutes / stations`. A four-minute AMRAP
  with four movements yields two rounds — which is not an AMRAP, it is two
  rounds, and the score stops meaning anything.
- **EMOM stations are capped the same way**, so every movement comes round at
  least twice. A four-minute EMOM with four stations is four unrelated minutes.

Verified across 6,400 blocks at durations 4–25: zero AMRAPs under four rounds,
zero EMOMs over their station ceiling, zero empty blocks.

### Not yet live

The session screen runs sets and ticks, not a clock. A conditioning-only plan
therefore says **"Timer coming soon"** on a disabled Start rather than starting
into a session with nothing in it, and a plan with lifts starts normally with a
line saying the finisher is not carried through. The print sheet **does** carry
the block, which makes it the one place a conditioning workout is genuinely
usable today — it needs no clock the app has not built.

---

## 23. Three fixes to the HIIT planner

### The rows stopped jumping — and the goal row had the same bug

`focusScroller` already held its position across a re-render in `state.focusScroll`.
The conditioning screen has **two** card rows, and they were sharing that one
number — so picking a shape also yanked the partner row.

`holdScroll(scroller, key, selection)` is that logic lifted out and keyed. Two
things had to change beyond the key:

- **Position is per row.** `state.scrollPos[key]`.
- **The nudge only fires when *that row's* selection changed.** Every render
  rebuilds every scroller on the screen, so the "bring the chosen card into
  view if it is mostly hidden" rule was re-running on the partner row every
  time a shape was picked — which is the jumping the whole function exists to
  stop, one row over. `state.scrollSel[key]` remembers what was selected last
  time so an untouched row is left alone.

Measured: picking a visible card leaves both rows at exactly the position they
were scrolled to (436 → 436, 218 → 218), while picking a card that is off screen
still brings it fully into view. The Quick workout goal row benefits from the
same fix — it had the latent version of this bug from any unrelated re-render.

### Bodyweight is its own kit group

`floor` used to mean "open floor plus whatever kit lives on it", which was no use
to someone in a hotel room. `bodyweight` is now a fifth group meaning you and the
ground and nothing else: **20 movements**, enough to generate every format.

**Choosing `floor` admits `bodyweight` too**, in the engine rather than the data.
Anyone with a box and a kettlebell also has a floor, and being denied burpees for
ticking the box with more equipment in it would be a nonsense. The reverse does
not hold — bodyweight alone means alone, which is the entire point of the option.

It is listed first, because it is the answer that is always true and someone with
no equipment should not have to read past three things they do not have.

Verified across all 31 kit combinations × 40 seeds: zero shortfalls, zero
movements from a group that was not asked for.

### A colour per shape

The five formats get their own accents, the way the four goals do, so a plan is
recognisable as an EMOM or an AMRAP before it is read.

**"Surprise me" is not one of them** — it is the absence of a choice, so it keeps
`--goal-conditioning`. That is not tidiness, it is what made the set possible.
Eleven colours now share one hue circle (four goals, Home's yellow,
conditioning's cyan, five formats), and searching for **six** format colours
under all three constraints at once — distinct from each other, distinct under
colourblindness, distinct from the six that already exist — returned nothing
usable in 250,000 candidates. The best had two purples and two teals at ΔE 11.
Dropping "Surprise me" from the set freed exactly enough room.

| | Colour | |
|---|---|---|
| EMOM | `#6abbf2` | sky |
| AMRAP | `#e99096` | rose |
| Intervals | `#0ecaad` | turquoise |
| Tabata | `#977dba` | violet |
| For time | `#9a9654` | olive |

ΔE 25.3 between them in normal vision, 10.6 under protanopia, 12.3 under
deuteranopia, and no closer than 12.7 to any accent that already existed. Both
dichromat figures clear the 10.5 the four goals already sit at among themselves
— and unlike the goals, every one of these cards carries its name in 17px type,
so colour here is the second channel rather than the only one.

Picking a shape repaints the screen with the same wave from the press point that
picking a goal does. `pickGoal` now delegates to `pickAccent(event, colour, apply)`,
since shapes are not goals and have no entry in `GOAL_COLOR`.

**The block card sets its own accent** rather than inheriting the screen's, so a
finisher shows up in its shape's colour against a lifting session's goal colour.
An EMOM should be recognisable as an EMOM wherever it appears — that is the point
of giving shapes colours at all.

---

## 24. Generating a HIIT no longer hands you your lifting draft

**The bug.** Tap HIIT workout on Home, pick a shape, pick your kit, press
Generate — and land on *"Leg day / Strength"* in orange with two barbell lifts,
the conditioning buried at the bottom as a finisher.

**The cause was §22's reasoning, not a slip.** `session.conditioning` being
optional lets one field express both "a conditioning session" and "a lifting
session with a finisher", and I decided which by looking at the draft: lifts
present meant finisher, empty meant standalone. The line was *"nothing has to
choose, because the draft already says which was meant."*

It does not. **The entry point says what was meant.** Someone who taps HIIT
workout, answers four questions about a HIIT workout and presses Generate wants
a HIIT workout. What the draft happens to hold is leftover state from whatever
they were doing last, and letting it silently outvote four explicit answers
reads as the app ignoring all of them.

**The fix** is to stop inferring. An empty draft still needs no question — there
is nothing to collide with. A draft holding lifts now asks, once:

> **On its own, or after the lifting?**
> You have Leg day on the go, with 2 lifts in it.
> — **A workout on its own** · Just the conditioning. Replaces Leg day.
> — **Add it to Leg day** · As a finisher, after the lifting and before the cool-down.
> — Cancel

That keeps the finisher — it is a genuinely useful thing and §22's ordering
still applies — but as something you ask for rather than something you are given
for having a draft open.

`choiceSheet` is new alongside `confirmSheet`, because this is a fork rather
than a yes/no: both options are real things to do, so neither can be the one you
get by declining. Each carries a second line, since the difference between them
is the part that needs explaining and a button label has no room for it. The way
out is the quiet link underneath, not one of the two.

Standalone starts a **fresh session** rather than clearing the draft's lifts: a
session keeping its name, goal and budgets while losing its exercises is a
workout that no longer matches its own title.

Verified on all four paths — no lifts (no question asked, straight to a
conditioning plan), on-its-own (`HIIT workout / Tabata`, 0 lift cards, format
accent), finisher (`Leg day / Strength`, 2 lift cards, Warm-up → Main lifts →
Finisher → Cool-down, goal accent on the screen and format accent on the card),
and cancel (sheet closes, screen unchanged, draft byte-identical).

---

## 25. Multi-block conditioning

One block of three movements over twenty minutes is those three movements six
times each. It trains a narrow slice of you and is dull by minute ten. That was
the complaint, and it was right.

`conditioning.blocks` has been an array since §20 and only ever held one thing.
`generateConditioningWorkout` fills it.

### What the split buys, measured

Average distinct movements and body regions over the same minutes, 300 seeds
each against the full catalog:

| | 1 block | 2 | 3 | 4 |
|---|---|---|---|---|
| **12 min** | 2.6 mv / 2.5 roles | 4.6 / 3.4 | — | — |
| **16 min** | 2.8 / 2.7 | 5.7 / 3.8 | — | — |
| **20 min** | 2.8 / 2.7 | 5.9 / 3.9 | 7.2 / 4.0 | — |
| **25 min** | 2.8 / 2.7 | 6.0 / 3.9 | 8.4 / 4.3 | — |
| **30 min** | 2.7 / 2.6 | 5.3 / 3.6 | 8.5 / 4.2 | **10.6 / 4.4** |

Roles top out at five (mono / upper / lower / core / full), so four blocks is
near-complete coverage against one block's 2.7.

### Scaling to the clock

`BLOCK_MIN_MINUTES = 5`, `BLOCK_REST_MINUTES = 2`, so N blocks cost
`N × 5 + (N-1) × 2` and the ceiling falls out of that: 1 block below 10 min, 2
from 12, 3 from 19, 4 from 26. Capped at four regardless — past that the
transitions cost more than the work.

Two minutes of transition is **drawn on the plan and counted in the total**.
Changing station, resetting a rower and getting your breath back is real time,
and leaving it out would make a four-block estimate lie by the length of a whole
block.

The chips show all four counts always, disabling the unreachable ones. A control
that grows and shrinks as the time strip scrolls is a control you cannot aim at,
and seeing that four exists but needs more minutes is what makes the scaling read
as a rule rather than as arbitrary.

**The ceiling limits what is shown as chosen, never what is stored.** Writing the
clamp back meant scrolling the time strip down to eight minutes and back up to
thirty silently forgot that three blocks were wanted — and a strip is a thing you
scroll *through*.

### Two rules that make blocks worth having

**Movements do not repeat across blocks** while the pool can afford it, so three
blocks really is nine movements rather than the same three dealt again. Where the
pool cannot afford it the rule is abandoned rather than the block shrunk: ergs +
running is six movements total, and four blocks would rather repeat a rower than
hand back a block with one thing in it.

**Formats vary across blocks** when none was asked for. An EMOM then an AMRAP
then a for-time is three different relationships with the clock, which is most of
what makes the third block feel unlike the first.

Multi-block auto-selection draws only from **EMOM, AMRAP and for-time**. Tabata
is one movement per four minutes by protocol and intervals are one or two, so
spending a block on either costs most of the coverage the split exists to buy —
an early version handed back three blocks holding *four* distinct movements, fewer
than one long block. Both are still available when chosen by name.

### Sizing fixes the short blocks forced

Blocks are short by design now, and two format rules were tuned for one long
block:

- **For time** capped stations at `minutes × 2 / rounds`. Rounds multiply
  stations, so five minutes at five rounds of four movements is twelve seconds a
  station — which prescribed **two burpees**.
- **AMRAP** relaxed its station ceiling from `minutes / 2` to `minutes / 1.7`,
  admitting three rounds rather than demanding four. A five-minute AMRAP capped
  at two movements is half the coverage the block could carry, bought for a
  fourth round nobody asked for.

### A workout of several shapes is not one of them

A three-block workout of an EMOM, an AMRAP and a for-time is **not an EMOM**.
Titling it after whichever block is first describes two thirds of it wrongly, so
where the blocks disagree the title reads "3 blocks" and the screen accent falls
back to conditioning's own cyan — while each card keeps its block's colour. Where
they agree, the single format names the workout as before.

Re-roll and remove moved out of the card to the section. One set per card would
read as "re-roll this block", which is not what they do — and building that would
let a block be re-rolled into a movement its neighbour already has.

### Measured

12,000 workouts across 5 kit sets × 6 durations × every reachable block count:

| | |
|---|---|
| Shortfalls | 0 |
| Wrong block count | 0 |
| Over the time budget | 0 |
| Stations under 15 s | 0 |
| Repeated movement, pools ≥ 20 movements | **0%** |
| Repeated movement, ergs+running (pool of 6) | 5% at 2 blocks, 97% at 4 |
| Repeated format, 1–3 blocks | **0%** |
| Repeated format, 4 blocks | 100% — unavoidable against 3 formats |

---

## 26. The conditioning timer

The clock that turns a plan into a workout. Three decisions shape all of it, and
all three come from the screen being read at arm's length with your hands busy.

### The clock is derived, never counted

State holds the epoch millisecond the current step ends; remaining time is
`endsAt - now`. A counter incremented by `setInterval` drifts, stops when the tab
is backgrounded, and cannot survive the reload a phone performs when it reclaims
memory mid-workout. An end timestamp survives all three, and `catchUpTimer` walks
forward through however many steps expired while the page was gone.

**A step begins when the one before it ended**, not when the tick noticed.
Starting from `now` donates the tick's lateness to every round, so a
twelve-minute EMOM quietly runs thirteen. Skipping is the exception: the user
ended that step, so the next starts when they said. Verified by arming a stored
clock 125 s in the past — it resumes on step 3 with 55 s left, exactly where it
would have been.

Catching up is **silent**. Three beeps for three rounds that already happened is
noise about the past, so a multi-step overshoot takes the quiet path and only a
single-step arrival gets a cue.

### One step list, five formats

`blockSteps` flattens a block into `{kind, seconds, movement, round}`. Three of
the formats are a list of timed windows; the other two are one open window with a
counter. That is the same trick `pace` pulled for generation — get the shape into
one form and everything downstream stops caring which format it came from.

| kind | |
|---|---|
| `work` / `rest` | fixed window, counts down, moves on |
| `amrap` | one open window; the round counter is the score |
| `fortime` | one window counting **up** to a cap |
| `between` | the transition between blocks, a step like any other |

Tabata runs eight rounds of one movement *then* eight of the next, rather than
rotating within a round — that is the protocol, and it is why it costs four
minutes per movement. Intervals drop their trailing rest: the block is over, and
making someone wait out a rest to be told so is just wrong.

**This exposed a lie in the plan.** Intervals declared twelve minutes and their
steps totalled nine, because `rounds = floor(budget / (work + rest))` wasted up
to a whole round. The count now solves `N × (work + rest) − rest ≤ budget`, and
every window-driven block derives its stated `minutes` from the same step list
the timer walks — so the plan and the clock agree by construction rather than by
two functions staying in step. Measured across 16,000 blocks: worst drift 30 s
(whole-minute rounding), zero blocks over the ask.

### Rendering is surgical

`render()` rebuilds the screen, which would fight a tap on the round counter four
times a second — the same reason `tickRest` edits two nodes and nothing else. The
tick writes the digits and the ring; only a step boundary re-renders. It runs at
250 ms rather than 1 s because the ring is a continuous sweep and a one-second
step makes it stutter.

The tick runs **wherever you are**. A clock that only advances while you are
looking at it is not a clock, and off-screen the resume bubble carries the time.
Finishing navigates to the summary from any screen: the workout is over, nothing
is written down yet, and the numbers exist only there until you answer.

### It is audible

Every transition beeps and buzzes, with a three-note count-in on windows longer
than twelve seconds — a ten-second rest that beeps for three of them is noise.
The tones are synthesised WebAudio, not files: this app ships no binary assets
and a beep is four lines. The first Start press doubles as the gesture that
unlocks audio. Wake Lock holds the screen on where the browser allows it.

### The log

One entry per block, not per set — the block is the unit performed and there is
no per-set weight. `goal: 'Conditioning'` is written so the balance chart can
account for it, which needed `REPORT_GOALS`: `vocabulary.goals` drives the goal
picker and the prescription lookup, and reading the log against *that* list filed
a whole HIIT workout under "Not recorded". Two lists, two jobs.

### A note on a self-inflicted wound

Renaming a shadowed variable with a PowerShell round-trip re-encoded every
non-ASCII character in `app.js`, and the botched reversal then dropped twelve
lines. Recovered by matching each damaged line against `git show HEAD` with the
damaged regions wildcarded, then finding the four session-only casualties by
symptom — an undefined `RING_LEN`, a movement name reading `window.name`, a
missing list element and a missing button label. Every special character now
reconciles against HEAD exactly. **Use the Edit tool for source files;
`Get-Content`/`Set-Content` on PowerShell 5.1 is not UTF-8 safe.**

---

## 27. Building a conditioning block by hand

The generator answers "give me something". This answers "give me *this*". They
produce the same block, which is the whole point: a generated workout opens in
the editor and can be fixed, so the two are one feature rather than two paths
that each have to be complete alone.

### What the editor owns, and what it does not

It owns the things someone has an opinion about — the shape, how long, which
movements, how many of each, and whether anyone else is doing it.

It does **not** own the structural arithmetic. `rounds`, `work` and `rest` come
out of `assembleConditioningBlock`, which derives them exactly as the generator
does, and `minutes` for a window-driven format is read back off `blockSteps`
rather than trusted from the input. Ask for a ten-minute Tabata of three
movements and you get twelve minutes and are *told* twelve, because that is what
the clock will run. §26's invariant — the plan and the clock agree by
construction — has to hold for hand-built blocks too, or it does not hold.

### Per format, only what is a real choice

| Format | Editor shows |
|---|---|
| EMOM | duration |
| AMRAP | duration |
| Intervals | duration **and** a work/rest shape |
| Tabata | **no duration** — 8 × 20/10 is four minutes a movement, so the movement list decides |
| For time | duration (a cap) and a round count |

A live preview line says what the block will be, in the plan's own words. That
is where a hand-built block is most likely to surprise you, so it says so before
you save rather than after.

### Amounts are stepped, never typed

Every unit has its own grain — reps by one, calories by one, metres by ten,
seconds by five — and a keyboard for a number you are nudging is three taps too
many. A newly added movement opens on `defaultAmountFor`, the same
`pace × seconds / 60` the generator uses, so nothing starts on a figure that
needs fixing before it means anything.

### The picker offers everything

All 58 conditioning movements, whatever kit they need — unlike the generator,
which is *asked* what is to hand. Someone building by hand is looking at the gym
they are standing in, and filtering their choices out from under them would be
the app arguing with what it can see. Typing filters in place via
`refreshPickerList` rather than through `render()`, so the field keeps its focus
and caret.

### Entry points, and what each implies

- **Build my own**, beside Generate on the HIIT screen. It ignores every answer
  above it, which is right: those questions exist to brief the generator, and
  someone who already knows what they want is not briefing anybody. It asks the
  same on-its-own-or-finisher question as generating, for the same reason (§24).
- **The pencil on a block**, on the plan. Per block, because editing is per
  block — unlike Re-roll and Remove, which act on the workout and sit once at
  the bottom.
- **Add a block**, in that same action row, which opens the editor on an index
  past the end. Appending needs no second code path.

Saving drops the block's `inputs`, which is what removes Re-roll — a hand-built
block has nothing to roll back to, and offering it would be a button that
discards the work it sits under. Same reasoning as `markHandEdited` dropping the
"Auto-generated" badge on a hand-edited session.

---

## 28. Filtering the movement list, and adding your own

### Filters

Three rails over the picker: **kit**, **muscle**, **tier**. Each is a horizontal
scroller rather than a wrapped chip cloud, because three wrapped clouds is most
of a phone screen before a single result and the list is what you came to read.

They compose, and a live count says what survives — 58 movements, 20 with kit
set to bodyweight, 14 adding Core, 1 adding Advanced. The muscle filter matches
**primary or supporting**, because someone filtering for Core wants the movements
that hammer it as a side effect too, which is most of them.

The list is built inline in `condPicker`, not deferred to the frame after mount.
Filter chips go through `render()`, so the list they produce should exist by the
time render returns — waiting on `requestAnimationFrame` makes the list depend on
a frame actually firing, and a filtered list that arrives late reads as a filter
that found nothing. The search box is the exception: it patches the list
underneath via `refreshPickerList` so typing does not cost the field its caret.

### Muscle groups

Conditioning movements have carried `primary` and `secondary` since §20 — they
are catalog rows like any other — and nothing was showing them. Now:

- every picker row carries the same `muscleLine` the Library uses;
- **the body map appears for a conditioning-only plan**, reading its muscles off
  the movements. A workout of nothing but conditioning has a perfectly good
  answer to "what does this train"; it just was not being asked.

### Movements of your own

`data/conditioning.json` is 22 rows and the overlay covers 36 more, so "it is not
in the list" is a thought people will have. The form is offered in the picker
rather than the Library, because that thought happens while looking at the list.

**It needed no engine support.** `conditioningOf` reads `mode`, `unit`, `pace`
and `kit` straight off the row, and `indexComplexity` already believes a row that
states its own `tier` (§20). A custom movement is therefore a first-class one:
measured 90 appearances in 400 generated workouts, and it carries its `how` text
into the info panel during a session like any shipped drill.

The one field that could have been jargon is `pace`. "Units per minute at a hard
but repeatable effort" is exactly right and exactly unanswerable, so the form
asks **"How many reps in a minute, going hard?"** — the same number, and a
question anyone can answer about a movement they already do. Movements counted in
seconds skip it entirely: a minute of them is sixty seconds, so asking would be
posing a question with one possible reply.

Saving adds it straight to the block being built, because creating it there means
you wanted it there, and making you find it again in the list you just left is a
step for the app's benefit rather than yours.

Custom conditioning rows still carry `pattern` and `profile`, because the rest of
the app reads them off an exercise — the warm-up builder triggers on `pattern`,
the body map on `primary` and `secondary`.

The **Library stays lifts-only** (167). Every card there offers a 1RM and filters
on equipment and pattern, none of which a rowing machine answers; conditioning
movements have their own shelf, which is the picker.
