# Assumptions

1. Only public-location arrests can be served by public AEDs.
2. A bystander fetches the AED and returns, at walking speed.
3. Straight-line distance x detour factor approximates walking distance.
4. One placement serves all periods; periods differ in demand and lockout only.
5. Survival depends only on time to defibrillation; CPR is folded into the decay range.
6. Ambulance response time is the same everywhere on campus.
7. The synthetic campus layout and foot traffic are illustrative.
8. Monte Carlo: foot traffic uncertain by +-30%; 10% of opening schedules may be wrong.

## Synthetic campus

9. Building occupancy: each building kind has an illustrative (day, evening, night) head count (academic 800/100/0, library 400/300/50, residential 150/500/600, athletic 200/300/0, dining 300/250/0), scaled by a random size factor in [0.5, 2]. These are not measured.
10. Academic buildings are open until midnight, so they are accessible in the evening (occupied then) but locked at night. Dining and athletic buildings are open day and evening only; library and residential buildings are open all periods.
11. Residential halls are counted at night. Residents' common areas and lobbies are treated as public, and an AED in a card-access lobby is assumed reachable; this likely overstates night public risk.
12. General-population OHCA incidence is applied to a young campus population, which overstates risk.
13. Occupants spread around their building by a Gaussian kernel (sigma 60 m); a uniform background of 12.8 / 7.7 / 2.6 people per hectare (day / evening / night) covers paths and open space. Indoor AEDs sit within 30 m of their building centre, 10% of sites are outdoor cabinets, and the in-building delay of 30-120 s grows with building size. All of these are illustrative.