# Assumptions

1. Only arrests among people present on campus count. Their hazard is the population
   incidence times public_fraction / away_time_share (0.18 / 0.313, about 0.575).
   Residential-hall residents are the exception noted in 11.
2. A bystander fetches the AED and returns, at walking speed.
3. Straight-line distance x detour factor approximates walking distance.
4. One placement serves all periods; periods differ in demand and lockout only.
5. Survival depends only on time to defibrillation; CPR is folded into the decay range.
   Only shockable-rhythm arrests (shockable_fraction) benefit from an AED.
6. Ambulance response time is the same everywhere on campus.
7. The synthetic campus layout and foot traffic are illustrative.
8. Monte Carlo: foot traffic uncertain by +-30%; 10% of opening schedules may be wrong.

## Synthetic campus

9. Building occupancy: each building kind has an illustrative (day, evening, night) head count (academic 800/100/0, library 400/300/50, residential 150/500/600, athletic 200/300/0, dining 300/250/0), scaled by a random size factor in [0.5, 2]. These are not measured.
10. Academic buildings are open until midnight, so they are accessible in the evening (occupied then) but locked at night. Dining and athletic buildings are open day and evening only; library and residential buildings are open all periods.
11. Residential halls are counted at night. Residents' common areas and lobbies are treated as public, and an AED in a card-access lobby is assumed reachable. Residents get the public hazard ratio (0.575) although their at-home hazard is about 1.19 (0.82 / 0.687), so dorm demand may be understated about 2x, while counting dorm-room arrests as reachable overstates it; the net direction is uncertain.
12. Adult incidence with an average public hazard ratio is applied to a young campus population, which likely overstates risk.
13. Occupants spread around their building by a Gaussian kernel (sigma 60 m); a uniform background of 12.8 / 7.7 / 2.6 people per hectare (day / evening / night) covers paths and open space. Indoor AEDs sit within 30 m of their building centre, 10% of sites are outdoor cabinets, and the in-building delay of 30-120 s grows with building size. All of these are illustrative.
## York University Keele campus (headline study area)

14. Periods: weekday morning (Mon-Fri 08-13), weekday afternoon (13-18), weekday evening
    (18-24), night (every day 00-08), weekend day (Sat-Sun 08-24), weighted by hours per week.
15. The York timetable needs a login, so classroom use is assumed: seats x booking share
    (0.70, 0.65, 0.25, 0, 0.05 by period) x attendance 0.60 (literature 0.50-0.75).
16. Floor-area occupancy: offices and labs 1 person per 40 m2; library, student centres,
    retail and services 1 per 25 m2; athletic 1 per 100 m2; each scaled by a period profile.
    Missing OSM floor counts use defaults by building kind.
17. Residences: handbook beds (2,347 in 9 halls) x share at home (0.30, 0.30, 0.60, 0.90,
    0.60). York Apartments and other unlisted residence buildings use floor area / 35 m2,
    which may overstate their beds (Buildings C1-C4 especially, whose OSM footprints are
    bounding boxes).
18. 3,000 people walk outdoors during weekday teaching periods (800 evenings and weekends,
    100 at night), spread over cells in proportion to walking-path density.
19. Candidate sites: mapped building entrances, one door point for every building without a
    mapped entrance, 20 outdoor cabinets at the busiest path junctions, and York's 19
    published AEDs. Access delay: 20 s at an entrance, 45 s for York's AEDs (inside, location
    named only), 30 s for an outdoor cabinet (leave and re-enter the building).
20. Opening: academic buildings locked at night and weekends; library, services and
    athletics locked at night; residences and outdoor cabinets always reachable.
21. Walking distance is the shortest path on the OpenStreetMap network, capped at 1.3 x the
    straight line up to 100 m and rising smoothly beyond (people cut through buildings and
    plazas that the footpath map misses). Indoor tunnels are not mapped. `detour_factor`
    has no effect on York results and is left out of the York sensitivity analysis.
22. York's AED map may be incomplete (residence AEDs and security-patrol AEDs are not on it);
    results compare against York's *published* AEDs.
23. Residents at home are given the same public hazard ratio as other occupants. Arrests in
    residence rooms are less often witnessed, so this likely overstates what a lobby AED can do.
24. Base-case beds: handbook residences plus York-run apartments (Assiniboine, Passy); the
    privately run Quad and unidentified housing appear only in a sensitivity scenario. The
    Central Utilities power plant is excluded and Physical Resources uses office density.
