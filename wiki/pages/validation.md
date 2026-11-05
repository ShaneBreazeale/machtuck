# Validation

The flight model is checked against the Learjet 60 AFM (FM-123), the EASA type certificate data sheet, the SAE 932534
flight test and published performance figures. Nothing in the AFM checks is fitted to the tables it is compared
with, except where a constant is marked "calibrated" next to the single AFM point it was set against (see
[Flight model](flight-model.md)).

All the numbers on this page were measured on **2026-11-04** with Node 22.19 on the `wiki` branch.

## Running the checks

Each check is a plain Node script with no dependencies:

```bash
node test/flight_test.mjs
STRICT=1 node test/flight_test.mjs           # makes the five known-bias rows fail
node test/afm_validate.mjs
node test/aero_validate.mjs
AERO_STRICT=1 node test/aero_validate.mjs   # makes the known buffet bias fail
node test/performance_test.mjs
node test/force_test.mjs
node test/recovery_test.mjs
MODE=trainer node test/force_test.mjs       # the trainer's autopilot
MODE=trainer node test/recovery_test.mjs
node test/stab_test.mjs
node test/mission.mjs                       # NBAA range
```

Run in parallel, the whole set took about 10 seconds here. Every script exits 1 on a failure. The pass limits of the
report-style scripts are a margin above the figures on this page: `afm_validate.mjs` fails on an MCT N1 rms above
2.0 %N1 or any cell above 5.0, or a climb-gradient rms above 1.0 %; `mission.mjs` on an NBAA range more than 5 % from
2,405 nm; `stab_test.mjs` on a departure (bank of 30° within 40 s). See [Testing](testing.md) for the rest of the
suite.

## Summary

| Check | Model (measured) | Reference |
|---|---|---|
| Stall speeds, flaps 0/8/20/40, 14,000 and 23,500 lb | all within 2 kt | AFM Fig 5-22 |
| Buffet onset lift vs Mach | rms ΔCL 0.019 | SAE 932534 flight test (Fig 19) |
| Buffet onset vs the AFM, FL400 18,000 lb worked example | 8.2 kt early at low speed; 1.63 g vs 1.56 g at M 0.70 | AFM Fig 5-24 (known bias) |
| Mach-tuck trim gradient reversal | M 0.785 with Mach trim failed, M 0.830 working | after the AFM's 0.77 (Mach trim inop) and Mmo 0.81 |
| Max g at the 20 certified VA points | 2.90 to 3.11 g | 3.0 g, EASA TCDS IM.A.212 |
| Max-continuous N1, 178 cells each | rms 1.42 % (all engines), 1.47 % (single) | AFM Fig 5-31, 5-32 |
| Single-engine climb gradient | rms 0.72 % (final segment), 0.68 % (en route) | AFM Fig 5-62, 5-65 |
| Time to climb, MTOW to FL410 | 16.9 min (16.6 min in the mission run) | 18 to 18.5 min from brake release, published |
| NBAA IFR range, 4 passengers | 2,455 nm | 2,405 nm published |
| Max level speed, FL410, max continuous | 458 KTAS (M 0.798) | 453 to 466 KTAS published |
| Takeoff field length, flaps 8, 15 cases | rms 4.1 %, worst +6.8 % | AFM Fig 5-38 |
| Landing distance from 50 ft, 6 cases | rms 1.3 %, worst +2.1 % | AFM Fig 5-74 |
| Column force, full nose-down trim at Vmo | 101 lb | AFM: "in excess of 75 pounds" |

## Flight-test card

`test/flight_test.mjs` measures the model against published Learjet 60 figures and textbook handling qualities, in
calm air with no ice and no failures. It is deterministic.

Each row prints PASS, FAIL or BIAS. BIAS marks a known model bias: it is reported but doesn't fail the run unless
`STRICT=1` is set.

| Check | Model | Target |
|---|---|---|
| Stall KCAS flaps 0°, 14,000 / 23,500 lb | 100 / 131 | 102 / 129 (AFM Fig 5-22) |
| Stall KCAS flaps 8° | 98 / 127 | 99 / 126 |
| Stall KCAS flaps 20° | 94 / 122 | 95 / 121 |
| Stall KCAS flaps 40° | 90 / 116 | 91 / 115 |
| Dynamic stall, clean, MTOW, 1 kt/s entry | 129 KCAS | about 129 |
| FL400 18,000 lb 1 g low-speed buffet | M 0.544 (159 KIAS) | M 0.57 (165 KIAS) |
| FL400 18,000 lb buffet-onset g at M 0.70 | 1.63 | 1.56 |
| Buffet CL vs SAE 932534, 9 points M 0.50 to 0.815 | rms 0.019 | rms below 0.03 |
| Max g at VA, 20 points | 2.90 to 3.11 | 3.0 ± 0.15 (Part 25.335(c)) |
| FL410 M 0.76: thrust lever / fuel flow | 0.89 / 1,246 lb/h | below 0.9 / about 1,200 to 1,300 |
| FL410 max level Mach, max continuous | 0.798 (458 KTAS) | 0.81 or more |
| Breguet range, full fuel, 30 min reserve | 2,644 nm | gross check only |
| Time to climb, MTOW to FL410 / fuel | 16.9 min / 686 lb | about 17 to 17.5 min / 700 to 900 lb |
| KIAS at FL350 M 0.78 | 264.4 | 264.4 (exact CAS) |
| Short period: period / damping | 2.19 s / 0.35 | damping 0.35 to 1.3 (MIL-F-8785C level 1) |
| Phugoid: period / damping | 104 s / 0.386 | damping above 0.04 |
| Dutch roll, yaw damper off | 3.18 s / 0.06 | damping 0.08 or more |
| Dutch roll, yaw damper on | damped within a cycle | damping above 0.2 |
| Roll: time to 30° / peak rate | 1.20 s / 42°/s | 2.0 s or less; 30 to 60°/s for business jets |
| Spiral: bank after 30 s from 10° | 0.0° | time to double above 20 s |
| Elevator step: steady g | 1.18 | 1.2 to 1.4 |

Five rows read BIAS. The two FL400 buffet rows are the SAE 932534 boundary sitting above the AFM Fig 5-24 one (see
[Aerodynamics against the AFM](#aerodynamics-against-the-afm)). Max level Mach at FL410 is 0.798, short of 0.81,
though the 458 KTAS is inside the published range; the 0.81 is an expectation, not an AFM figure. The
yaw-damper-off Dutch roll damping is 0.06, below the level 1 minimum of 0.08; MIL-F-8785C is a design guide, not a
certification figure. The elevator step gives 1.18 g, just below a band that is itself an estimate scaled from the
full-stick g. With the yaw damper on, the Dutch roll dies out before the card finds three peaks to measure, so it
reads "damped within a cycle": damped well beyond the target.

The maximum-lift curve the VA check tests is described in [Flight model](flight-model.md#lift).

## AFM tables

`test/afm_validate.mjs` compares the model with AFM tables transcribed in `test/afm_tables.json`. Nothing here is
fitted to those tables.

| Table | Cells | Mean | rms | Max |
|---|---|---|---|---|
| MCT N1, all engines (Fig 5-31) | 178 | +0.08 | 1.42 | 4.03 % N1 |
| MCT N1, single engine (Fig 5-32) | 178 | +0.12 | 1.47 | 4.03 % N1 |
| Final-segment net gradient (Fig 5-62) | 811 | −0.28 | 0.72 | 1.99 % |
| En-route single-engine climb (Fig 5-65) | 693 | −0.23 | 0.68 | 3.02 % |

The N1 check flies the AFM climb schedule (250 KIAS to FL320, M 0.70 above for all engines; slower speeds on one
engine) and compares the engine control law in `js/engine.js` with the AFM's N1. The worst cells are at 50,000 to
51,000 ft and −60 °C, where the model gives 101.5 % against 97.4 %.

The gradient checks fly one engine at maximum continuous with the other windmilling (Torenbeek windmilling drag),
gear and flaps up, at 1.25 Vs1, and include a small yaw-trim drag. The worst en-route cells are at 20,000 ft and
−60 °F, where the model climbs about 3 % better than the AFM. At 40,000 and 45,000 ft it averages about 1 % low.

## Aerodynamics against the AFM

`test/aero_validate.mjs` checks the aerodynamics through what the AFM does publish. The AFM has no lift, drag or
moment curves, so the curves are tested through the quantities that depend on them.

1. **Buffet boundary (Fig 5-24).** Its worked example sets the buffet CL at two Mach numbers. The chart is in W/δ, so
   those CLs carry to any altitude. Tolerance: 2 KIAS on the low-speed edge and 0.03 g at M 0.70.
2. **FL350 buffet envelope** at the accident weight and bracketing weights, and how far it moves if the boundary drops
   by 0.03 or 0.06 CL toward the AFM.
3. **Mach tuck.** The stick-fixed elevator to trim at 1 g, FL350, against Mach. With the Mach trim failed the trim
   gradient must still be stable at 0.77; with it working it must stay stable to Mmo 0.81.
4. **Difficulty mode.** The as-flown and trainer modes fly 120 s through the storm with the same seed and inputs, and
   the trajectories must be identical.

Results:

| Check | Result |
|---|---|
| Fig 5-24 1 g low-speed buffet, FL400 18,000 lb | **known bias**: 159.3 KIAS (M 0.543) vs 165 (M 0.57), −8.2 kt |
| Fig 5-24 buffet-onset g at M 0.70 | **known bias**: 1.63 vs 1.56 |
| Buffet CL at M 0.57 / 0.70 | model 0.842 / 0.825 vs AFM 0.764 / 0.790 |
| Tuck, Mach trim failed | PASS: reversal at M 0.785 |
| Tuck, Mach trim working | PASS: reversal at M 0.830 |
| As flown vs trainer | PASS: identical (22.9 m / 22.9 m) |

FL350 buffet-free window, KIAS (low to high):

| Weight and load | Model | Boundary −0.03 CL | Boundary −0.06 CL |
|---|---|---|---|
| 17,000 lb, 1.0 g | 137 to 312 | 139 to 306 | 159 to 301 |
| 17,000 lb, 1.3 g | 176 to 298 | 179 to 292 | 183 to 287 |
| 20,700 lb, 1.0 g | 170 to 302 | 173 to 296 | 177 to 290 |
| 20,700 lb, 1.3 g | 195 to 284 | 199 to 278 | 203 to 273 |
| 23,000 lb, 1.0 g | 180 to 295 | 183 to 290 | 187 to 284 |
| 23,000 lb, 1.3 g | 206 to 275 | 211 to 269 | 215 to 264 |

At the accident weight of 20,700 lb, moving the boundary to the AFM puts high-speed buffet onset 6 to 12 KIAS lower.

### The two caveats

- **The buffet boundary is optimistic.** It follows the SAE 932534 flight test, which sits 0.03 to 0.08 in lift
  coefficient above the AFM boundary. Elevator authority, which fades past buffet onset, lasts too long into a dive.
  The test reports this as **KNOWN BIAS** and still passes. With `AERO_STRICT=1` the two Fig 5-24 checks fail and
  the script exits 1 ("2 aero check(s) failed"). Refitting needs Fig 5-24 digitized at several W/δ lines.
- **The Mach tuck is hand-set.** Its pitching moment is not derived from the pressure model. Only its ordering against
  the AFM Mach limits is checked, not its size.

> **Note:** `MODE=trainer` has no effect on `aero_validate.mjs`. That script always flies both modes itself (check 4),
> and gives the same output with or without it.

## Performance test

`test/performance_test.mjs` flies the AFM takeoff and landing procedures; see
[Ground handling](ground.md#afm-performance-checks) for how each is flown. The tolerance is 8 % on every case, and
landings must touch down below 720 ft/min.

**Takeoff field length, flaps 8 (Fig 5-38).** The limiting case is the largest of accelerate-go, accelerate-stop and
115 % of the all-engine distance.

| Field | Weight | Model | Limited by | AFM | Error |
|---|---|---|---|---|---|
| Sea level, 60 °F | 16,000 lb | 2,939 ft | stop | 3,140 | −6.4 % |
| | 18,000 lb | 3,582 ft | go | 3,580 | +0.1 % |
| | 20,000 lb | 4,291 ft | go | 4,290 | +0.0 % |
| | 22,000 lb | 5,162 ft | go | 5,120 | +0.8 % |
| | 23,500 lb | 5,842 ft | go | 5,830 | +0.2 % |
| Sea level, 90 °F | 16,000 lb | 3,248 ft | all engines | 3,480 | −6.7 % |
| | 18,000 lb | 3,972 ft | go | 3,970 | +0.0 % |
| | 20,000 lb | 4,791 ft | go | 4,800 | −0.2 % |
| | 22,000 lb | 5,797 ft | go | 5,760 | +0.6 % |
| | 23,500 lb | 6,685 ft | go | 6,610 | +1.1 % |
| 5,000 ft, 40 °F | 16,000 lb | 3,511 ft | go | 3,640 | −3.5 % |
| | 18,000 lb | 4,433 ft | go | 4,150 | +6.8 % |
| | 20,000 lb | 5,333 ft | go | 5,010 | +6.5 % |
| | 22,000 lb | 6,296 ft | go | 6,010 | +4.8 % |
| | 23,500 lb | 7,308 ft | go | 6,870 | +6.4 % |

rms 4.1 %, mean +0.7 %. The light weights come out short and the 5,000 ft cases long.

**Landing distance from 50 ft (Fig 5-74).**

| Field | Weight, VREF | Model (air + roll) | Touchdown | AFM | Error |
|---|---|---|---|---|---|
| Sea level, 60 °F | 16,000 lb, 128 kt | 2,963 ft (1,011 + 1,952) | 528 ft/min | 2,910 | +1.8 % |
| | 18,000 lb, 135 kt | 3,215 ft (1,009 + 2,206) | 562 ft/min | 3,190 | +0.8 % |
| | 19,500 lb, 139 kt | 3,493 ft (1,008 + 2,485) | 580 ft/min | 3,420 | +2.1 % |
| 5,000 ft, 40 °F | 16,000 lb, 128 kt | 3,252 ft (1,012 + 2,240) | 569 ft/min | 3,220 | +1.0 % |
| | 18,000 lb, 135 kt | 3,542 ft (1,009 + 2,534) | 608 ft/min | 3,580 | −1.1 % |
| | 19,500 lb, 139 kt | 3,862 ft (1,008 + 2,855) | 629 ft/min | 3,870 | −0.2 % |

rms 1.3 %, mean +0.7 %.

## Force test

`test/force_test.mjs` checks the control-force model (`js/controls.js`), then flies the as-flown upset with a pilot
following the AFM procedure, with and without force limits, three seeds per hypothesis. The four hypotheses are
scenarios, not findings: the cause of the accident is undetermined. See [Upset hypotheses](hypotheses.md).

| Check | Result |
|---|---|
| Holding full nose-down trim at Vmo | 101 lb (AFM: in excess of 75 lb) |
| Cruise: 15 % effort | 0.05 elevator for 9 lb |
| Approach | full elevator for 45 lb |
| 380 KEAS, M 0.88, full-strength pull | 0.31 elevator (150 lb), aileron 0.89 |
| Fatigue at 380 KEAS | available force falls below 90 lb after 10 s |
| Autopilot engaged, light push (13 lb) | elevator stays at the autopilot's 0.05 |
| Autopilot engaged, firm pull | clutch slips, elevator 0.53 |

The pilot starts the recovery 2 s after the autopilot lets go. Free controls and force-limited both recover 9 of 12
runs: every combined, tail-stall and Mach-tuck run, and none of the trim runaways, which break up. Peak column force is
68 to 77 lb in the recoveries and 110 to 113 lb in the trim runaway. The test requires that force limits never make
recovery easier.

**Reaction-delay sweep** (force-limited, seed 1, as flown):

| Hypothesis | 2 s | 5 s | 8 s | 12 s and later |
|---|---|---|---|---|
| Combined | recovered | lowest 25,320 ft | wing breakup | wing breakup |
| Tail stall | recovered | lowest 23,621 ft | wing breakup | wing breakup |
| Mach tuck | recovered | lowest 32,838 ft | lowest 25,977 ft | wing breakup |
| Trim runaway | wing breakup | wing breakup | wing breakup | wing breakup |

At 5 s it is marginal: the tail-stall case loses about 11,000 ft and the combined case about 10,000 ft. From 8 s on,
the wing fails before the recovery takes hold; the Mach-tuck case holds on until 12 s. The breakups in the sweep happen
at −2.2 to −2.3 g. These figures are for the ISA+11 day of the KMFL sounding (measured 2026-11-04 after the switch from
ISA+7); seed 1 only, so other seeds differ by a few thousand feet.

With `MODE=trainer` the same checks pass and the 5 s delay loses less: lowest 30,275 ft in the combined case and
28,392 ft in the tail stall. The outcomes at 8 s and later are unchanged.

## Recovery test

`test/recovery_test.mjs` checks the rule that decides whether you recovered. An early takeover that just holds level
flight must not count. The rule (`RecoveryJudge`) needs a real upset first, then 10 s of stable flight. The test
compares it with the old rule (autopilot off 3 s, then 3 s stable). Five seeds per hypothesis, three pilots:

- **Take over at t = 20 s and hold level.** Never credited before an upset. The old rule credited it at 26 s, before
  the upset, which the test keeps as a regression check. Hand-flying through the event is credited in 5 of 5 seeds
  for the combined, tail-stall and tuck cases.
- **No pilot input.** As flown, never credited, because the autopilot hands over trimmed nose-down. All runs break up.
- **Textbook recovery** (AFM: idle, no spoilers, gear down if extreme). Reported, not asserted. Credited 0 of 5 for
  combined, tail stall and trim runaway, and 5 of 5 for Mach tuck. The old rule credited 5 of 5 in every case: the
  scripted pilot stays at idle after the pull-up and ends up riding the shaker or mushing past the stall angle.

With `MODE=trainer` all checks pass. Hands-off is reported instead of asserted, because the trainer's autopilot does
not hand over a nose-down trim. On the ISA+11 day none of the hands-off runs recovers (0 of 5 in every case; on the
older ISA+7 day 2 of 5 combined runs did). The textbook pilot is credited 0 of 5 combined, 5 of 5 Mach tuck and 1 of 5
trim runaway.

## Stability test

`test/stab_test.mjs` is open-loop: trimmed cruise at FL350 and M 0.77, a 5° roll perturbation, no wind and no
autopilot. It prints a time history and expects slow spiral and Dutch roll modes with no departure: it fails if the
bank reaches 30° within 40 s or the state goes non-finite. The peak bank is the initial 5°.

| Yaw damper | Bank after 20 s | Bank after 36 s |
|---|---|---|
| On | 0.0° | 0.0° |
| Off | 4.4° | 4.1° |

## NBAA range

`test/mission.mjs` flies the NBAA IFR mission on the model's own drag and engine: 10 min taxi, a maximum-continuous
climb on the AFM schedule, long-range cruise with the altitude re-chosen as weight burns off, and an idle descent.
Reserves are a 100 nm alternate, a 30 min hold at 5,000 ft and a 5 min approach. With 4 passengers it climbs to
FL410 in 16.6 min, cruises from FL410 to FL490, and reaches **2,455 nm**, 2.1 % over the 2,405 nm specification.
The test fails beyond 5 %.

## Known gaps

- The buffet boundary is optimistic (above). It is the largest known bias in the upset results.
- The Mach tuck's size is not validated.
- VD/MD (377 KIAS / M 0.89) are estimates, not published values.
- The Dutch roll with the yaw damper off is under-damped against level 1, and max level Mach at FL410 is short of 0.81.
- The force-feedback driver has been tested only against simulated sticks; see [Hardware](hardware.md).
