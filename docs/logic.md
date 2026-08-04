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
`tools/extract-workbook.ps1`. All of it is **reference data** and ships read-only
with the app.

| File | Rows | From |
|---|---|---|
| `exercises.json` | 167 | Exercise Library |
| `warmups.json` | 49 | Warm-Up Library |
| `mobility.json` | 43 | Mobility Library |
| `prescriptions.json` | 21 (7 profiles × 3 goals) | Prescriptions |
| `vocabulary.json` | — | derived: distinct equipment / patterns / muscles / profiles / goals |

### Reference vs. user data

The workbook mixes the two: column J of the Exercise Library, *Your 1RM*, is
your data sitting inside the reference table. The app splits them:

- **Catalog** — the JSON above. Replaced wholesale whenever the workbook is
  re-extracted.
- **User data** — 1RMs, sessions, training log. Lives in browser storage under
  its own keys and is never touched by a catalog update.

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
goals      Explosivity · Strength · Muscular endurance   (workbook order — a
                                                          progression, not
                                                          alphabetical)
```

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
Every profile has a row for all three goals, so the lookup never misses.

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
rather than folded into one of the three — the proportions never overstate what
is actually known.

## 13. Colour

Chrome comes from the **Nocturne** design system — ground `#161826`, surface
`#232532`, text `#e9e9ed`, radii 4/8/14, Inter. The app defines no chrome
palette of its own.

Two things do carry meaning and so are chosen for separation, not brand fit:

| Role | Value |
|---|---|
| Explosivity | `#5f93dd` |
| Strength | `#cd7449` |
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

## 15. Not yet translated

`name.sv` is populated for all 167 exercises, 49 drills and 43 mobility
exercises — it came with the workbook. Still English-only:

- `how.sv` for warm-up drills (49) and mobility (43)
- `cue` on exercises (167)
- prescription `sets` / `reps` / `load` / `rest` / `note` (21 × 5)
- equipment, pattern, muscle, profile and goal labels (~40)
- all UI chrome

The UI reads every user-visible string through `t()` already, so adding Swedish
is a data task, not a refactor.
