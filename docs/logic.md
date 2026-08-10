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
`tools/extract-workbook.ps1`, plus one that is not.

| File | Rows | From |
|---|---|---|
| `exercises.json` | 167 | Exercise Library |
| `warmups.json` | 49 | Warm-Up Library |
| `mobility.json` | 43 | Mobility Library |
| `prescriptions.json` | 21 (7 profiles × 3 goals) | Prescriptions |
| `vocabulary.json` | — | derived: distinct equipment / patterns / muscles / profiles / goals |
| `hypertrophy.json` | 7 (7 profiles × 1 goal) | **hand-authored** — see §16 |
| `complexity.json` | 1 rule set + 62 overrides | **hand-authored** — see §18 |

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
