# Sources for model parameters

Every numeric parameter in `aed/params.py` (`RANGES`) is tied to a source below,
except `dispatch_delay_s`, which stays an explicit assumption (see its entry).

How the sources were checked: each URL listed was opened (fetched) while writing
this file. PubMed itself returned only a cookie page to our fetch tool, so for
journal articles we cite the Europe PMC record of the same paper (the URL is a
Europe PMC REST query that returns the bibliographic record and abstract; the PMID
is given so the paper can be found on PubMed). Where an abstract carried no
numbers we say so rather than quote a figure we could not see. Full texts behind
paywalls were not read; every figure below comes from the abstract or page named.

## Changed values

- New parameter `shockable_fraction` = 0.40 (range 0.26-0.60), multiplying every AED benefit: an AED only helps shockable-rhythm arrests. Low end = Fordyce 2017 (26.5% of all public arrests); high end = Weisfeldt 2011 (60% of bystander-witnessed public arrests).

| Parameter | Old | New | Why |
|---|---|---|---|
| `survival_k_per_min` range | (0.03, 0.10) | (0.03, 0.12) | The base 0.10 sat on the upper edge of its range. Waalewijn et al. (source 5) report odds ratios of 0.85-0.89 per minute of delay to defibrillation, which correspond to rates of about 0.12-0.16 per minute, and Larsen et al. imply about 0.08. 0.12 is at the lower end of the OR-implied 0.12-0.16 and above Larsen's 0.08 (the OR-based rates are not directly comparable); it puts the base inside the range. Base value unchanged (0.10). |

No other base values or ranges were changed. `incidence_per_100k_yr` (55.0) and
`public_fraction` (0.18) are unchanged and sit inside ranges the sources support.

## References

1. Berdowski J, Berg RA, Tijssen JGP, Koster RW (2010). Global incidences of
   out-of-hospital cardiac arrest and survival rates: systematic review of 67
   prospective studies. *Resuscitation* 81(11):1479-1487. PMID 20828914,
   doi:10.1016/j.resuscitation.2010.08.006.
   URL: https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=%22Global%20incidences%20of%20out-of-hospital%20cardiac%20arrest%20and%20survival%20rates%22&resultType=core&format=json
   Supports `incidence_per_100k_yr`. Figures: treated OHCA incidence per 100,000
   person-years of 54.6 (North America), 44.0 (Australia), 35.0 (Europe), 28.3
   (Asia); adult-only studies 62.3 vs 34.7 when children are included. Base 55
   matches North America; range 40-70 covers North America (54.6), Australia (44.0) and
   adult-only studies (62.3); Europe (35.0) and Asia (28.3) fall below it.

2. Nichol G, Thomas E, Callaway CW, et al. (2008). Regional variation in
   out-of-hospital cardiac arrest incidence and outcome. *JAMA* 300(12):1423-1431.
   PMID 18812533, doi:10.1001/jama.300.12.1423 (an erratum exists, JAMA
   2008;300(15):1763; we did not read it).
   URL: https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE%3A%22Regional%20variation%20in%20out-of-hospital%20cardiac%20arrest%20incidence%20and%20outcome%22&resultType=core&format=json
   Supports `incidence_per_100k_yr`. Figures: EMS-treated incidence median 52.1
   per 100,000 (IQR 48.0-70.1) across 10 North American sites. Also used under
   "For model refinement".

3. CARES (Cardiac Arrest Registry to Enhance Survival) (2026). CARES Summary
   Report, non-traumatic OHCA, 1 Jan 2013 to 31 Dec 2025, national, N=1,269,409.
   URL: https://mycares.net/sitepages/uploads/2026/CARES%202013-2025%20Non-Traumatic%20National%20Summary%20Report.pdf
   Supports `public_fraction`. Figures: location of arrest, home/residence
   908,723 (71.6%), nursing home 134,737 (10.6%), public setting 225,927 (17.8%).
   Base 0.18 matches. (The text of this PDF was extracted with `pdftotext`; the
   table columns are interleaved but the counts and percents pair up in order.)

4. Chan PS, McNally B, Tang F, Kellermann A (2014). Recent trends in survival
   from out-of-hospital cardiac arrest in the United States. *Circulation*
   130(21):1876-1882. doi:10.1161/CIRCULATIONAHA.114.009711.
   URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC4276415/
   Supports `public_fraction` (lower end). Figures: CARES 2005-2012, 70,027
   patients; about 12% of arrests in "other public areas" plus under 2% in public
   areas with likely AED access, roughly 83-85% in private residences. First
   rhythm VF/pVT about 23.6%; overall survival to discharge 9.8% (unadjusted) in
   2012.

5. Waalewijn RA, de Vos R, Tijssen JGP, Koster RW (2001). Survival models for
   out-of-hospital cardiopulmonary resuscitation from the perspectives of the
   bystander, the first responder, and the paramedic. *Resuscitation*
   51(2):113-122. PMID 11718965, doi:10.1016/s0300-9572(01)00407-5.
   URL: https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE%3A%22Survival%20models%20for%20out-of-hospital%20cardiopulmonary%20resuscitation%20from%20the%20perspectives%22&resultType=core&format=json
   Supports `survival_k_per_min` (upper end). Figures: odds ratio of survival per
   minute of delay to defibrillation 0.89 (first-responder model) and 0.85
   (paramedic model), n=1,030 witnessed arrests. These are odds ratios from
   adjusted models, not a direct percentage decline in survival.

6. Larsen MP, Eisenberg MS, Cummins RO, Hallstrom AP (1993). Predicting survival
   from out-of-hospital cardiac arrest: a graphic model. *Annals of Emergency
   Medicine* 22(11):1652-1658. PMID 8214853.
   URL: https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:8214853%20AND%20SRC:MED&resultType=core&format=json
   Supports `survival_k_per_min` and `survival_S0`. Figures: King County WA,
   1,667 patients; linear model with a 67% baseline if CPR, defibrillation and
   ACLS are all immediate; survival falls about 2.3 points per minute of delay to
   CPR, 1.1 to defibrillation and 2.1 to ACLS (sum 5.5 points/min, about 8% of
   the 67% baseline per minute; the sum and ratio are our arithmetic).

7. Valenzuela TD, Roe DJ, Nichol G, Clark LL, Spaite DW, Hardman RG (2000).
   Outcomes of rapid defibrillation by security officers after cardiac arrest in
   casinos. *New England Journal of Medicine* 343(17):1206-1209. PMID 11071670.
   URL: https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:11071670%20AND%20SRC:MED&resultType=core&format=json
   Supports `survival_S0` and `ems_response_s`. Figures: 56 of 105 VF patients
   (53%) survived to discharge; among witnessed collapses survival was 74% when the
   first shock came within 3 minutes and 49% when later; mean collapse-to-first-shock
   4.4 minutes; paramedics arrived a mean of about 9.8 minutes after collapse.
   (The PubMed text of the abstract has a "153 percent" typo; 53% is consistent
   with 56/105.)

8. Bohannon RW (1997). Comfortable and maximum walking speed of adults aged
   20-79 years: reference values and determinants. *Age and Ageing* 26(1):15-19.
   PMID 9143432.
   URL: https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=%22Comfortable%20and%20maximum%20walking%20speed%20of%20adults%20aged%2020-79%20years%22&resultType=core&format=json
   Supports `walk_speed_mps`. Figures: 230 healthy volunteers over 7.62 m; mean
   comfortable speed about 1.27 m/s (women in their seventies) to 1.46 m/s (men in
   their forties); mean maximum speed about 1.75 m/s to 2.53 m/s (men in their
   twenties). Range 1.2-2.0 covers comfortable up to brisk walking.

9. Deakin CD, Anfield S, Hodgetts GA (2018). Underutilisation of public access
   defibrillation is related to retrieval distance and time-dependent
   availability. *Heart* 104(16):1339-1343. PMID 29760243,
   doi:10.1136/heartjnl-2018-312998.
   URL: https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE%3A%22Underutilisation%20of%20public%20access%20defibrillation%20is%20related%20to%20retrieval%20distance%22&resultType=core&format=json
   Supports `walk_speed_mps` (brisk end). Figure: AED retrieval distances were
   computed for a bystander at "brisk walking speed (4 mph)", about 1.79 m/s. The
   abstract does not state how long was allowed to relay the AED location or to
   remove the device (secondary summaries mention 2 min and 1 min, but we could not
   open the full text, so we do not use those numbers).

10. Boeing G (2019). The morphology and circuity of walkable and drivable street
    networks. In: D'Acci L (ed.), *The Mathematics of Urban Morphology*,
    Birkhauser, pp. 271-287. doi:10.1007/978-3-030-12381-9_12 (preprint on
    arXiv:1708.00836).
    URL: https://arxiv.org/pdf/1708.00836
    Supports `detour_factor`. Figures: Table 1, mean circuity of simulated
    walking routes (shortest network distance / great-circle distance) in 40 US
    cities. Our arithmetic on that table: mean 1.27, median 1.26, minimum 1.14
    (Manhattan), maximum 1.49 (Salem MA). Base 1.3 and range 1.2-1.5 match. Caveat:
    these are random city-wide routes, not campus trips.

11. CARES (2026). CARES 2025 annual report (flipbook edition), page 49.
    URL: https://mycares.net/sitepages/uploads/2026/2025_flipbook/inc/html/page49.html
    Supports `ems_response_s` and `survival_k_per_min`. Figures: median EMS
    response time 7.6 min (IQR 5.6-10.4); first responders 6.4 min (IQR
    4.9-8.3); EMS arrived within 9 min for 64.9% of arrests. Response is measured
    from the 911 call to arrival, not from collapse to shock. The page also states
    that survival falls 7-10% per minute without CPR or defibrillation (registry
    statement; no primary reference given on the page).

12. Mell HK, Mumma SN, Hiestand B, Carr BG, Holland T, Stopyra J (2017). Emergency
    medical services response times in rural, suburban, and urban areas. *JAMA
    Surgery* 152(10):983-984.
    URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC5831456
    Supports `ems_response_s`. Figures: median 911-call-to-arrival 7 min overall
    (IQR 4-10), urban 6 (IQR 4-9), suburban 6 (IQR 4-10), rural 13 (IQR 8-19), 2015
    data from 485 EMS agencies.

13. Weisfeldt ML, Everson-Stewart S, Sitlani C, et al. (2011). Ventricular
    tachyarrhythmias after cardiac arrest in public versus at home. *New England
    Journal of Medicine* 364(4):313-321. PMID 21268723, doi:10.1056/NEJMoa1010663.
    URL: https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE%3A%22Ventricular%20tachyarrhythmias%20after%20cardiac%20arrest%20in%20public%20versus%20at%20home%22&resultType=core&format=json
    Supports `shockable_fraction` (added after this research; see Changed values).

14. De Maio VJ, Stiell IG, Wells GA, Spaite DW (2003). Optimal defibrillation
    response intervals for maximum out-of-hospital cardiac arrest survival rates.
    *Annals of Emergency Medicine* 42(2):242-250. PMID 12883512,
    doi:10.1067/mem.2003.266.
    URL: https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE%3A%22Optimal%20defibrillation%20response%20intervals%20for%20maximum%20out-of-hospital%20cardiac%20arrest%20survival%20rates%22&resultType=core&format=json
    Used under "For model refinement" and as a cross-check on `ems_response_s`:
    OPALS cohort, 9,273 BLS-level arrests, mean response interval 6.2 min (90th
    percentile 9.3 min), overall survival 4.2%, adjusted odds of survival x0.77 per
    minute of response interval.

15. Fordyce CB, Hansen CM, Kragholm K, et al. (2017). Association of public
    health initiatives with outcomes for out-of-hospital cardiac arrest at home and
    in public locations. *JAMA Cardiology* 2(11):1226-1235.
    doi:10.1001/jamacardio.2017.3471.
    URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC5710360
    Used under "For model refinement" and as a caution on `public_fraction`:
    CARES, 16 North Carolina counties, 2010-2014, 8,269 arrests, 32.3% in public
    locations (higher than the national 17.8%, so regional values can fall outside
    our 0.12-0.25 range).

## Parameter summary

| Parameter | Base | Range | Sources | Figure used |
|---|---|---|---|---|
| `incidence_per_100k_yr` | 55 | 40-70 | 1, 2 | 54.6 N. America; EMS-treated median 52.1 (IQR 48.0-70.1) |
| `public_fraction` | 0.18 | 0.12-0.25 | 3, 4 (15 caution) | 17.8% national CARES 2013-2025; about 14% in 2005-2012 |
| `walk_speed_mps` | 1.4 | 1.2-2.0 | 8, 9 | comfortable 1.27-1.46 m/s; brisk 4 mph = 1.79; max 1.75-2.53 |
| `detour_factor` | 1.3 | 1.2-1.5 | 10 | walking circuity mean 1.27, range 1.14-1.49 over 40 US cities |
| `dispatch_delay_s` | 60 | 30-120 | none | ASSUMPTION (below) |
| `ems_response_s` | 540 | 420-720 | 11, 12, 7 (14) | median EMS response 7.6 min (CARES), 7 min (Mell); paramedics about 9.8 min after collapse (casinos). High end 720 s assumes an urban/suburban campus: it excludes the rural median of 13 min (Mell) |
| `survival_S0` | 0.7 | 0.5-0.8 | 7, 6 | 74% shock within 3 min; 67% baseline |
| `survival_k_per_min` | 0.10 | 0.03-0.12 | 6, 5, 11 | about 0.08 (Larsen, derived); odds x0.85-0.89 per min; registry 7-10% |

### `dispatch_delay_s` is an assumption

No source we could open measures the time from collapse until a bystander sets off
to fetch an AED. Deakin et al. (source 9) model walking only. The 30-120 s range is
a judgement covering recognition, deciding to act, and learning where the AED is.
Do not read it as evidence-based; the sensitivity analysis should treat it as an
open input.

### Not verified

- The 3-4% per minute decline with bystander CPR (AHA guidelines, repeated by
  secondary sites) could not be confirmed from a page we opened. The lower end
  0.03 of `survival_k_per_min` therefore rests on judgement. Larsen's linear
  model would give about 1.1 points/min (about 1.6% of the 67% baseline) for delay
  to defibrillation when CPR is already underway, i.e. lower than 0.03; the models
  are not directly comparable (linear, absolute points).
- Valenzuela et al. (1997), Circulation 96(10):3308-3313 (record:
  https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:9396421%20AND%20SRC:MED&resultType=core&format=json) was opened but its abstract gives no per-minute figures, so no
  number is taken from it.
- The AHA Heart Disease and Stroke Statistics 2024/2025 chapter on cardiac
  arrest could not be read (the PMC page we could open was truncated before that
  chapter), so no AHA statistics figures are used.
- The EMS parameter is a response time (call to arrival). Time from arrival to
  first shock is not sourced; the base 540 s (9 min) is the 7.6-min CARES median plus
  a margin, consistent with the casino study's 9.8-min mean collapse-to-paramedic
  arrival, but the margin itself is a judgement.

## For model refinement

(Not used by the current model; for later work. Do not treat as new parameters.)

(a) Share of public-location OHCA with an initial shockable rhythm (VF/pVT):
- Weisfeldt et al. 2011 (source 13), ROC, 12,930 arrests, 2,042 in public.
  Initial VF/pVT in public arrests: 38% if EMS-witnessed, 60% if bystander-witnessed,
  79% if a bystander applied an AED. At home: 25%, 35%, 36%. Adjusted odds ratio
  public vs home 2.28 (bystander-witnessed) and 4.48 (bystander AED applied).
  URL: https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE%3A%22Ventricular%20tachyarrhythmias%20after%20cardiac%20arrest%20in%20public%20versus%20at%20home%22&resultType=core&format=json
- Fordyce et al. 2017 (source 15): all public-location arrests in 16 North
  Carolina counties, 2010-2014, VF/pVT in 26.5% (706 of 2,665) vs 21.0% at home.
  URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC5710360
  Reading: about 26% of all public arrests are shockable, but 60-79% for the
  witnessed and AED-applied cases the model cares about.

(b) Overall survival of EMS-treated OHCA:
- Nichol et al. 2008 (source 2): median survival to discharge 8.4% (IQR 5.4-10.4%,
  site range 3.0-16.3%); for VF 22.0% (IQR 15.0-24.4%). URL: https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE%3A%22Regional%20variation%20in%20out-of-hospital%20cardiac%20arrest%20incidence%20and%20outcome%22&resultType=core&format=json
- Chan et al. 2014 (source 4): CARES unadjusted survival 9.8% in 2012 (5.7% in
  2005-2006). URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC4276415/
- De Maio et al. 2003 (source 14): 4.2% overall in Ontario BLS-only OPALS cohort;
  adjusted survival ratio 0.77 (odds) per minute of response interval, predicted
  survival 5.9% at an 8-min 90th-percentile response interval. URL: https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE%3A%22Optimal%20defibrillation%20response%20intervals%20for%20maximum%20out-of-hospital%20cardiac%20arrest%20survival%20rates%22&resultType=core&format=json
- Sanity check: an S0 of 0.7 refers to near-immediate defibrillation of a
  witnessed shockable arrest (casinos 74%, Larsen 67%), far above the 8-10% overall
  survival, which averages in delayed or unwitnessed arrests and non-shockable
  rhythms. Multiplying S0 by the shockable share (about 0.26 public overall, 0.6 for
  bystander-witnessed public arrests) before applying time decay would be the
  consistent way to compare model output with these overall rates.

## Range ends that are judgement, not sourced

- `public_fraction` high end 0.25 (Fordyce 2017 reports 32.3% in some North Carolina counties).
- `survival_S0` high end 0.8 (highest cited figure is 74%).
- `walk_speed_mps` high end 2.0 m/s (between brisk walking, 1.79, and maximum speed).
- `survival_k_per_min` low end 0.03 (bystander-CPR figure not opened from a primary source).
- Derived figures (arithmetic on the sources): about 14% public (Chan), 0.08/min and 8%/min (Larsen), 1.79 m/s (4 mph), circuity mean 1.27 (Boeing Table 1).
