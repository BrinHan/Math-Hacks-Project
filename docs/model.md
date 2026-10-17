# Model

We choose where to put K new AEDs on one campus to maximise **expected lives saved per
year compared with waiting for the ambulance**, given that buildings lock at night and
some AEDs already exist.

## Demand

The campus is a grid of cells i. Over a day there are three periods p (day 10 h,
evening 6 h, night 8 h). Expected public cardiac arrests per year in cell i during p:

```
rate_ip = people_ip * incidence / 100,000 * public_fraction * hours_p / 24
```

Only public arrests count: an arrest at home is rarely reachable from a public AED.

## Time to defibrillation

A bystander sets off after a dispatch delay, walks to the AED, and brings it back:

```
tau_ij = dispatch_delay + 2 * detour * distance_ij / walk_speed + floor_delay_j
```

Distance is straight-line times a detour factor until real walking paths (OSMnx) are added.
