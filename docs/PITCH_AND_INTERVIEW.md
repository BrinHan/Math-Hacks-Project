# Interview Guide: the modelling, the code, and what we learned

The interview is about the **mathematical model and the code behind it**, and about what the
team learned. It is not a sales pitch. Judges may have limited maths or coding background, so
every answer below has two layers:

- **Short answer:** one or two sentences in plain language. Give this first.
- **If they probe:** the precise version, for a judge who wants the maths or the code.

Numbers come from `README.md`, `docs/model.md`, `docs/results-log.md` and
`docs/assumptions.md`. Nothing here is invented. Where something depends on your own
experience (section 7), it is marked for you to fill in.

> **Rubric:** it is not in the repo. Paste it in and section 9 maps each criterion to
> where we show it.

---

## 1. Opening statement (60 to 90 seconds)

> We modelled where a campus should put its defibrillators, AEDs, to save the most lives. The
> core is an optimisation problem: given a budget, choose which candidate locations get an AED so
> that the expected number of lives saved per year is as high as possible. To make it
> realistic we estimated how many people are in each York building at five times of the week,
> turned that into expected cardiac arrests per square of campus, computed how long it takes a
> bystander to fetch an AED along real footpaths, and converted time into survival
> probability. An integer-programming solver then finds the best set exactly, and we compare
> it against simpler methods. Because many inputs are estimates, we test how the answer
> changes when they change. The work was as much about being honest about what we don't know
> as about the optimisation itself.

---

## 2. The model in one page (what to draw on a whiteboard)

**Inputs**
- A grid of 50 m **cells** `i`, over five weekly **periods** `p`.
- `rate_ip`: expected public cardiac arrests per year in cell `i` during period `p`.
- A list of candidate **sites** `j` with a cost `c_j`, an in-building delay, and the periods
  `p` in which the site is open.

**Travel time** from a collapse in cell `i` to an AED from site `j`:
```
tau_ij = dispatch_delay + 2 × walk_distance_ij ÷ walk_speed + floor_delay_j
```
(the 2 is the round trip: fetch it, bring it back.)

**Benefit** of getting an AED to the patient within time band `T_k`:
```
S(t) = S0 · e^(−k·t)                      survival if shocked at time t
b_k  = f · max(0, S(T_k) − S(T_ambulance))   extra survival over waiting for the ambulance
```
`f = 0.265` is the share of arrests with a rhythm a shock can fix.

**Decision:** `x_j = 1` if site `j` gets an AED. Existing AEDs are forced to 1 at cost 0.

**Optimisation (integer linear program)**
```
maximise    Σ  rate_ip · (b_k − b_{k+1}) · z_ipk
subject to  z_ipk ≤ Σ x_j     over sites j with tau_ij ≤ T_k and open in p
            Σ c_j · x_j ≤ K    (budget)
            x_j ∈ {0,1}, 0 ≤ z_ipk ≤ 1
```
`z_ipk` is a switch: "this cell, in this period, is reached within band `k`". The
differences `b_k − b_{k+1}` make the terms add up to `rate · b(fastest band)`, so each
cell-period is credited once, for the best AED that reaches it.

---

## 3. Questions about the mathematics

**Q1. What kind of problem is this?**
*Short:* It's a "maximal covering location" problem: choose a limited number of facilities to
serve as much demand as possible.
*If they probe:* The classic version (Church and ReVelle, 1974) is yes/no: a demand point is
covered if a facility is within a fixed distance. Ours is the *gradual cover* variant: coverage
is graded, since an AED two minutes away is worth more than one four minutes away. It is
NP-hard in general, which is why we use an integer-programming solver instead of trying
every combination.

**Q2. Why not just yes/no coverage?**
*Short:* Because it would treat a 2-minute AED and an 8-minute AED the same.
*If they probe:* Survival falls continuously with time, about 10% per minute in our base
case. We approximate that curve with 1-minute **bands**, a staircase. Each band is a yes/no
coverage constraint, and the staircase's step heights `b_k − b_{k+1}` become the weights. We
credit each band at its slow edge, so the staircase slightly *under*-estimates the benefit
(conservative).

**Q3. Why is `z` continuous when it's really yes/no?**
*Short:* It doesn't have to be a whole number for the answer to come out whole.
*If they probe:* Once the `x` values are fixed at 0 or 1, each `z` is either forced to 0 (no
chosen site reaches it) or free up to 1 (some site does), and because we are maximising, it
goes to 1. So only `x` needs the integer rule. That makes the problem smaller and faster for
the solver, and it is a standard trick in covering models.

**Q4. How does the solver actually find the best plan?**
*Short:* It finds a ceiling no plan can beat, and uses it to rule out huge groups of plans
without checking them.
*If they probe:* Branch and bound. (1) Drop the "whole number" rule: this "relaxed" problem is
easy and gives an upper bound. (2) If some `x` comes out fractional, split into two
sub-problems, `x_j = 0` and `x_j = 1`, and solve each. (3) If a sub-problem's bound is below
the best real plan found so far, discard it. (4) Stop when the best real plan is within a tiny
gap of the best bound; we use a gap of 0.01%, and report it. The solver is HiGHS, called through
`scipy.optimize.milp`.

**Q5. Is the answer guaranteed best?**
*Short:* Yes, to within a very small gap that we report.
*If they probe:* The gap is `(bound − best plan) ÷ best plan`, at most 1e-4. There is a
60-second time limit, and if it were hit the code warns and reports the gap; if no plan
had been found it falls back to greedy. We also checked the ILP against brute-force
enumeration on a small campus, where trying every combination is possible, and they agree.

**Q6. What's the greedy method, and why include it?**
*Short:* Greedy repeatedly adds the single best next AED. It's fast and easy to explain, and
it shows whether the fancy solver is needed.
*If they probe:* Our objective is a weighted coverage function, which is *monotone submodular*:
adding an AED never hurts, and each extra one helps less than the last (diminishing returns).
For that kind of function, greedy is guaranteed to reach at least `1 − 1/e ≈ 63%` of the
optimum when costs are equal (Nemhauser, Wolsey and Fisher, 1978). In practice on York it is
within about 1% of the ILP. We also built **swap** (Teitz and Bart, 1968), which starts from
greedy and exchanges sites while that helps.

**Q7. Why did you build a "population-only" baseline?**
*Short:* It's the intuitive approach: put AEDs where the most people are. We wanted to show
how much the model adds beyond that.
*If they probe:* It ranks sites by the arrest rate within about a 3-minute walk and takes
the top ones that fit the budget, ignoring opening hours and survival time. With 10 new AEDs
it reaches 0.113 lives/year against 0.175 for the ILP. It clusters AEDs in the busiest
buildings, so the second AED beside the first adds little.

**Q8. Where does the demand number come from?**
*Short:* People present × a published arrest rate, adjusted for time spent in public.
*If they probe:*
```
rate_ip = people_ip × (55 ÷ 100,000) × (0.18 ÷ 0.313) × (hours_p ÷ 24)
```
`people_ip` comes from classroom seats × room usage × attendance, floor area ÷ area per
person, and residence beds × share at home, all assumptions. Each building's people are
spread over nearby cells with a bell-shaped (Gaussian) weighting that sums to 1, so a
building's total is preserved. Walkers outdoors are shared out by footpath length.

**Q9. What does the 0.18 ÷ 0.313 factor mean?**
*Short:* Only arrests in public count, and this scales the average risk to the time people
spend away from home.
*If they probe:* About 18% of arrests happen in public, while people spend about 31% of their
time away from home. So a person in public has roughly `0.18 ÷ 0.313 ≈ 0.575` times the
average hazard. It only rescales the objective, so it changes how many lives are saved but
not which sites are chosen.

**Q10. Which assumptions change the answer the most?**
*Short:* The ambulance response time and the share of arrests in public.
*If they probe:* One-at-a-time sensitivity at K = 10 shows the biggest swings from the public
fraction and ambulance time (about 0.117 to 0.244 lives/year), then the shockable fraction
and survival decay rate. A useful finding is that some parameters only *scale* the answer
(arrest rate, public fraction, shockable fraction) and never change which sites are
chosen, so uncertainty in them affects the headline number but not the plan.

**Q11. The survival decay parameter behaves oddly. Why?**
*Short:* Faster decay makes the ambulance baseline worse too, so an AED closes a bigger gap.
*If they probe:* The benefit is `S(T_k) − S(T_ambulance)`. If `k` rises, survival at 9 minutes
falls faster than survival at 2 minutes, so the *difference* grows. It peaks near
`k ≈ 0.17` per minute. This is in `docs/model.md`, and it explains why the Monte Carlo mean sits
slightly below the base case.

**Q12. What is Monte Carlo doing here?**
*Short:* Re-running the test hundreds of times with randomly changed inputs to see how much
the answer wobbles.
*If they probe:* Each of 200 scenarios draws every uncertain parameter uniformly within a
range, scales demand by 0.7 to 1.3, and flips the opening hours of 10% of sites. We score the
base plan in each scenario and report the mean and a 90% interval (5th to 95th percentile).
We also re-optimise in each scenario with greedy to see how often each site is chosen. If the
re-optimised score is barely higher than the fixed plan's (0.119 against 0.116 on the earlier
campus), the plan is robust. Draws are uniform because we only know ranges, not
distributions.

**Q13. How do you know the model is correct and not just plausible?**
*Short:* Tests, a brute-force check, and a comparison against simpler methods.
*If they probe:* 131 Python tests and 32 TypeScript tests. The ILP is compared with
enumerating every combination on a tiny campus. Greedy is checked against its 63% bound.
Individual formulas are tested, such as the travel-time formula and the survival curve. We
also sanity-check results: more budget should never lower the score, and existing AEDs
stay in the plan (they are forced in by the model).

**Q14. What are the model's mathematical limitations?**
*Short:* It maximises an average, assumes a patient is always reached by one bystander, and
inherits the quality of its inputs.
*If they probe:* (a) The objective is an *expected value*: it doesn't protect the worst-served
area, and a fairness constraint would change the formulation. (b) Travel times are fixed numbers,
not random. (c) One AED serves one arrest, with no simultaneous emergencies. (d) The survival
curve is a single exponential. (e) Ambulance time is the same everywhere. (f) Candidate sites are
a fixed list. (g) Demand is estimated, not measured.

**Q15. Why 50 m cells and 1-minute bands?**
*Short:* Fine enough to separate buildings, coarse enough to solve quickly.
*If they probe:* There are 769 cells and 193 candidate sites on York. Smaller cells or bands
mean more rows in the program (about 13,700 on the earlier test campus). The solver slows as
rows grow. A 1-minute band against a ~9-minute ambulance gives about 9 steps in the staircase,
which tracks the curve closely.

---

## 4. Questions about the code

**Q16. How is the code organised?**
*Short:* A pipeline: build the campus, compute travel times, build the table of cases, solve,
then test.
*If they probe:* In `aed/`: `data/york.py` builds cells, sites and rates from OpenStreetMap
and York's data; `walknet.py` finds shortest walking paths; `travel.py` turns distance into
time; `survival.py` gives the benefit per band; `coverage.py` builds the sparse table of rows;
`solvers/` has the ILP, greedy and swap; `uncertainty.py` runs Monte Carlo and sensitivity;
`experiments/` writes the result tables. The app in `web/` is a TypeScript port of the same
model.

**Q17. Why two implementations (Python and TypeScript)?**
*Short:* Python is where we did the research; TypeScript lets the app re-solve in the browser
with no server.
*If they probe:* The app runs HiGHS compiled to WebAssembly, so changing the budget or time of
day re-solves live. The cost is keeping two models in agreement: the Python results are
precomputed and exported to JSON for the app to display, and the TypeScript model has its own
tests. A change to the maths has to be made in both places.

**Q18. How do you make results reproducible?**
*Short:* Fixed random seeds and committed data.
*If they probe:* Experiments take a `--seed`, and the York data extracts are committed with
their sources listed in `data/york/SOURCES.md`. Running the documented commands regenerates
every table in `docs/results-log.md`.

**Q19. How is the coverage table stored?**
*Short:* As a sparse matrix, because almost every cell and site pair is a zero.
*If they probe:* Each row (cell, period, band) lists only the sites that reach it in time and
are open. Storing only those non-zero entries (a SciPy sparse matrix) keeps memory small and
lets the solver exploit the structure.

**Q20. How do you compute walking distance?**
*Short:* Shortest path along mapped footpaths, with an allowance for cutting through buildings.
*If they probe:* A graph of the OpenStreetMap paths and a shortest-path search. Because indoor
routes aren't mapped, distance is capped at 1.3 × the straight line up to 100 m and rises
smoothly beyond. The 100 m figure is an assumption, and the sensitivity tests include a
"footpaths only" case to show its effect.

**Q21. What was hard to get right in the code?**
*(Answer from your own experience; candidates are in section 7.)*

---

## 5. Questions about data and assumptions

**Q22. What data is real and what is assumed?**
- *Real:* building outlines, entrances and footpaths (OpenStreetMap); York's 19 published AED
  locations; classroom seat counts; residence beds (York Housing handbook); the arrest
  incidence, public fraction and shockable fraction (published studies).
- *Assumed:* how full rooms are, attendance, people per square metre, outdoor foot traffic by
  period, in-building delays, opening hours by building type, site costs.
Every assumption is numbered in `docs/assumptions.md`.

**Q23. What's the weakest part?**
*Short:* The crowd sizes. York doesn't publish headcounts, so we estimated them.
*If they probe:* That's why the Monte Carlo interval is wide (0.060 to 0.335 for the 10-AED
plan). We vary crowd size by ±30%. What stays stable across scenarios is the direction of
the finding, not the exact number.

**Q24. Is the arrest rate right for a university?**
*Short:* Probably too high in absolute terms.
*If they probe:* The 55 per 100,000 is for the general adult population. A campus is young, so
absolute risk is likely overstated (assumption 12). Since the same factor applies to every
building, it changes the size of the benefit, not where AEDs should go.

**Q25. Did you check for errors in the map data?**
*Short:* Yes, and found one.
*If they probe:* Seven large buildings (Vari Hall, Central Square, Winters College, Sobeys
Stadium and Buildings C1, C2, C4) are stored in OpenStreetMap as multi-part shapes that our
data snapshot saved only as bounding rectangles. The map now shows their real outlines. The
Python model still uses the rectangles for them, so anything derived from their footprint
(such as floor area) is approximate. That is a known limitation we have not yet fixed.

---

## 6. "What would you do next?" (with the maths)

1. **Floors.** Add a vertical term to travel time: time from the patient's floor to the AED's
   floor (stairs or lift) and back. Candidate sites become (building, floor) pairs, and
   each building's demand is split across its floors. The optimiser doesn't change; only
   `tau` and the candidate list do.
2. **Risk by place.** Multiply each building's people by a risk factor for its use (a gym or
   pool versus a lecture hall), normalised so the campus total still matches the published
   rate. It's a change to the demand formula, not the optimiser.
3. **Age.** Split people into groups (students, staff, visitors) with a different arrest rate
   for each, and sum: `rate = Σ_groups people_g × incidence_g`.
4. **Measured headcounts** from York in place of the estimates, which would remove the
   largest uncertainty.
5. **A fairness constraint** so no area is left far from every AED, which turns the pure
   "maximise the average" objective into a two-part one.

---

## 7. What we learned (make this yours)

Judges usually value specific, honest lessons over polished ones. These are drawn from what
the project actually shows. **Replace or add your own, and say who learned what.**

- **Modelling decisions drive the answer more than the solver does.** The exact solver and
  the greedy method end up within about 1% of each other. The big differences came from the
  modelling choices: graded coverage instead of yes/no, opening hours, and time-of-day
  demand. (Evidence: results log.)
- **Know which uncertainty matters.** Sensitivity analysis showed some parameters only
  rescale the answer and never change the chosen sites. That told us where to spend effort.
- **Compare against the obvious baseline.** "Busiest buildings first" got about 65% of what the
  optimiser got at 10 AEDs (0.113 against 0.175). Without that comparison we couldn't claim the
  model adds anything.
- **Mistakes in understanding are normal.** `HOW_IT_WORKS.md` section 7 records
  corrections from our own learning: the "ceiling" of a relaxed problem is not "set everything
  to 1", and branching never rounds a fractional value. Writing the explanation down is
  what exposed them.
- **Data is never clean.** Seven large buildings arrived as rectangles because the map
  data snapshot dropped the geometry of multi-part shapes. We only noticed because a
  building on the 3D map didn't look like the real one.
- **Performance is part of correctness.** An interface that takes half a second to repaint
  feels broken. We measured, found the colour map was recomputing far too much, and made
  it about 15 times faster.
- **Be explicit about what's assumed.** Numbering every assumption made it possible to
  test them one by one.

Prompts to answer in your own words: *What did you believe at the start that turned out to
be wrong? What would you do differently with a week more? What was the hardest bug? What
did each person learn that the others didn't?*

---

## 8. Numbers to remember

| Fact | Value |
| --- | --- |
| Buildings modelled | 86 (OpenStreetMap) |
| Grid cells / candidate sites | 769 / 193 |
| Classroom seats / residence beds | 16,008 / 2,347 |
| York's published AEDs | 19 |
| Expected public arrests on campus | about 3.7 per year |
| Lives saved by York's 19 today | 0.100 per year |
| Plus 5 / 10 best new AEDs | 0.157 / 0.175 |
| Plus 10 "busiest places" AEDs | 0.113 |
| Greedy vs ILP | within 1% |
| Re-siting York's 19 | +74% (range +38% to +99%) |
| Monte Carlo, 10-AED plan | 0.156 (90% range 0.060 to 0.335) |
| Base survival curve | `0.70 · e^(−0.10·t)`, t in minutes |
| Shockable fraction | 26.5% |
| Ambulance time | 9 minutes (adjustable 7 to 12) |
| Tests | 131 Python, 32 TypeScript |

**In human terms:** 0.075 extra lives a year from 10 new AEDs is about one more survivor
every 13 years on this campus. It is small because a campus has few arrests, not because the
method is weak.

---

## 9. Rubric map (fill in once you have the rubric)

| Criterion | Where we show it | Best evidence |
| --- | --- | --- |
| | | |
| | | |
| | | |
| | | |

---

## 10. Honest limitations (say these before they are asked)

1. Crowd sizes are estimated: the largest uncertainty.
2. Arrest risk is the same per person in every building, and age is not modelled.
3. Floors aren't modelled: every AED is at the entrance and every patient at ground level.
4. Walking uses outdoor paths; indoor corridors and tunnels aren't mapped.
5. York's AED list may be incomplete, so "74% better" could shrink.
6. Seven large buildings are drawn with real outlines on the map, but the model still uses
   rectangles for them.
7. The survival curve is a single exponential, and CPR is not modelled separately.
8. The arrest rate is a whole-population figure, which overstates a young campus.
9. The objective is an average and does not guard against leaving any area poorly served.

---

## 11. Short demo order (if asked to show the app)

1. York map: red pins are recommended AEDs, white pins are York's 19.
2. Colours: green near an AED, red where the ambulance would arrive first.
3. Move "New AEDs" from 0 to 10: the score rises with diminishing returns.
4. Change time of day to Night: academic buildings lock and the picture changes.
5. Click a site: its lives per year and how often it was chosen across Monte Carlo runs.
6. Press **3D**: the buildings stand up with their real shapes.
7. Open Insights: the budget curve and the tornado chart.
