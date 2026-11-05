# Ground handling and performance

Free flight starts and ends on real runways, so the airplane needs landing gear, tyres, brakes and steering, and its
takeoff and landing distances have to match the AFM. The ground model is `js/ground.js`, the free-flight starts and
trim solver are in `js/freeflight.js`, and the AFM speeds are in `js/afm.js`.

## Landing gear

`Ground` models three oleo struts as springs and dampers on the airframe's contact points. The geometry comes from the
exterior model (`data/ext/README.md`), in body axes from the CG:

| Point | Position (forward, right, down) | Notes |
|---|---|---|
| Nose wheel | 7.34, 0, 1.60 m | steerable, stroke 0.25 m |
| Main wheels | −0.53, ±1.45, 1.67 m | braked, stroke 0.30 m |
| Tail | −8.06, 0, 0.09 m | strikes at 11.3° of pitch on extended struts |
| Wingtips | −1.17, ±5.9, 0.44 m | strike at 14.5° of bank |
| Nose and belly | four points along the fuselage | a gear-up landing or a collapse |

Strut stiffness is set so each strut sits about a third into its stroke at rest, and damping is firmer in rebound
than in compression. Both are estimates. A bottomed strut gets 25 times stiffer (tyre and structure). In the ground
test, at rest the nose wheel carries 7.8 % of the weight and the struts sit at 40/35/35 % of their stroke.

### Touchdown limits

Touchdown follows Part 25: 25.473 sets the limit descent velocity at 10 ft/s, and 25.723 requires 12 ft/s of reserve
energy without collapse.

| Sink rate at first contact | Result |
|---|---|
| up to 10 ft/s (600 ft/min) | normal |
| 10 to 12 ft/s | "HARD LANDING", no damage |
| 12 to 16 ft/s | "HARD LANDING, gear damaged" |
| above 16 ft/s (960 ft/min) | gear collapse |

The airframe points have stiff skin contact and sliding friction. The tail and wingtips report a strike and take
some damage. A belly contact with the gear up is a gear-up landing. Any airframe point arriving faster than 10 ft/s is
an impact.

## Tyres and brakes

Each wheel has rolling friction along its rolling direction and cornering friction across it, capped at the tyre's
peak friction.

| Surface | Rolling | Peak (cornering) | Anti-skid braking |
|---|---|---|---|
| Paved | 0.015 | 0.80 | 0.40 |
| Wet | 0.015 | 0.45 | 0.20 |
| Grass | 0.06 | 0.45 | 0.25 |

Only runways count as paved. Taxiways and aprons are not modelled, so anywhere off a runway is grass. A wet set
exists, but nothing switches it on yet.

Braking is anti-skid at μ 0.40, capped by a brake-torque limit of 13 kN per main gear. Because of the cap, heavier
landings brake less than the friction would allow, which is how the landing rolls grow with weight in the AFM. Below
3 m/s a held brake is static friction.

- **Brakes:** hold Shift for both. Toe brakes and a button bind in the controls panel; see [Controls](controls.md).
- **Parking brake:** set on every runway start. Pressing the brakes releases it. A bound parking-brake control
  toggles it, and it can only be set once stopped. In the ground test it holds full thrust to 13 cm of creep in 6 s.

## Nosewheel steering

The rudder pedals steer the nose wheel. The steering limit narrows from 45° at taxi speed to 7° at takeoff speed,
blending between 3 and 25 m/s. In the ground test, full right pedal at about 10 kt turns on a 9.1 m radius.

## Spoilers

The spoilers are armed for free flight. On the ground with the levers at idle above 60 kt (a landing or a rejected
takeoff) they deploy themselves, and they stow when thrust comes up past half. With flaps out they dump most of the
flap lift; see [Flight model](flight-model.md#lift).

## Thrust reversers

Pulling thrust back past idle (`−` or L2) on the ground deploys the reversers. A bound button works too. The reverse
lever spools the engines toward 92 % of the maximum-continuous N1, and about 45 % of the thrust is turned forward. The
reversers stow when the lever returns, and they cannot deploy in the air. The AFM landing distances don't credit them,
and neither does the performance test.

## Ground effect

Below one wingspan (13.34 m), ground effect follows McCormick, measured from the wing's height, about 0.6 m below the
CG:

- induced drag falls (to 0.72 at a tenth of a span in the ground test);
- lift at a given angle of attack rises, by up to 12 %;
- the weaker downwash at the T-tail pitches the nose down, by up to ΔCm −0.03, so the flare needs more pull.

## Runways

Runways come from the FAA CIFP via `tools/fetch_cifp.py` into `data/nav/runways.json`: 146 runway pairs at the 72 IFR
airports in range. Each has its landing thresholds (displaced where published), displaced distances, width and
threshold elevations. Pavement runs from each landing threshold back by its displaced distance, so a displaced
threshold is usable for takeoff.

`runwayAt` reports which runway and which end you are on, by direction of travel: distance past the threshold,
offset from the centreline, and pavement left. The touchdown and stopping reports use it.

For example, KDJT (the former KPBI) 10L/28R has 3,047 m of pavement with a 1,200 ft displaced threshold, and 10L
points 92.8° true.

The ground surface is the curved surface the renderer draws (`groundAlt`, see
[Flight model](flight-model.md#curved-earth-datum-in-free-flight)). Florida is flat and the imagery does not resolve
KPBI's 19 ft of elevation, so the runways sit on that surface.

The KPBI airport boundary (OpenStreetMap, 32 vertices) is also in `js/ground.js`. The renderer uses it to keep its
imagery-driven 3D houses off the aerodrome, where concrete and aprons would read as roofs.

## Starts and the trim solver

`setupStart` in `js/freeflight.js` places the airplane for each sortie start. Nothing in it names a particular
airport: the runway, approach and route come from the nav database. Every start clears the ice, turns on the Mach tuck
model with working Mach trim, and sets the curved-earth datum.

| Start | Placement |
|---|---|
| Lined up | 60 m past the start of the pavement, on the centreline, flaps 8, takeoff trim, parking brake set; struts settled for 4 s |
| Approach | 3 nm before the approach's first fix, on its course, at its altitude, 180 KIAS, flaps 8, autopilot on |
| 6 nm final | on a 3° path to the approach runway, 150 KIAS, gear down, flaps 20, hand-flown |
| En route | 5 nm before the first route fix after the departure, at the cruise altitude (M 0.77 at or above FL300) |

`trimFlight` solves steady flight for a given airspeed, flight-path angle and heading. It steps the real model from
a frozen state, measures the accelerations, and takes Newton steps on angle of attack, stabilizer trim and thrust
until they vanish. In the ground test, the final start holds −770 ft/min at 150 KIAS hands-off, and the cruise start
holds −23 ft/min at M 0.770 after 20 s.

**Takeoff trim** is what holds the climb hands-off at about V2 (1.2 × the flaps-8 stall speed from AFM Fig 5-22),
flaps 8, gear down, for the weight. The AFM sets it from a CG and weight band. With a fixed CG, this is that setting.

## Takeoff and landing technique

The AFM speeds come from `js/afm.js`, transcribed from FM-123 Section V:

- **Fig 5-42:** V1, VR and V2, flaps 8, for sea level at 60 °F and 5,000 ft at 40 °F, interpolated in weight and
  altitude. V1 never exceeds VR.
- **Fig 5-66:** VREF, flaps 40, gear down, from 15,000 to 23,100 lb. The maximum landing weight is 19,500 lb.

**Takeoff.** On the runway the V1, VR and V2 bugs appear on the speed tape and are called out.

1. Hold Shift to release the parking brake and add full thrust. Below 1,500 ft with the levers full forward, the
   engines give the takeoff rating.
2. Rotate at VR to about +9°, the AFM attitude. The tail strikes at 11°.
3. With positive rate, gear up (`G`). Flaps up (`F`) above 160 KIAS.

With an engine failure at V1, continue: rudder against the yaw, hold V2, gear up. APR gives the live engine 4,600 lbf.

**Landing.** On approach the bug shows VREF, and radio altitude is called from 500 ft.

1. Flaps 40 below 165 KIAS, VREF on a 3° path.
2. Touch down below 600 ft/min.
3. At idle the spoilers deploy themselves. Brake, and pull past idle for the reversers.

After stopping, the log reports the touchdown point, centreline offset, runway left and landing distance available.
Landing distance available runs from the landing threshold to the far end of the pavement.

## AFM performance checks

`test/performance_test.mjs` flies the AFM procedures the way the AFM says they were measured (pages 5-1 and 5-2), on
KDJT 10L with the field elevation and temperature of each case. The pilot is a set of simple loops: rudder and
nosewheel hold the centreline, ailerons hold the wings level, and a pitch loop rotates at about 3°/s.

| Procedure | How it is flown |
|---|---|
| Accelerate-go | Takeoff thrust set static, brakes released, engine failure at V1, rotate at VR to +9°, gear up with positive climb; distance to 35 ft |
| Accelerate-stop | Failure just before V1, maximum braking from V1, both levers idle, spoilers out half a second later |
| All engines | Rotate at VR to +9°, gear up; 115 % of the distance to 35 ft |
| Field length | The largest of the three (Fig 5-38) |
| Landing | VREF on a 3° glideslope, thrust reduced at 50 ft, idle at 25 ft, firm touchdown with little or no flare, maximum braking and spoilers; 50 ft to a stop (Fig 5-74) |

Each case must be within 8 % of the AFM, and landings must touch down below 720 ft/min. Measured on 2026-11-04:

- **Takeoff field length**, 15 cases (sea level at 60 °F and 90 °F, 5,000 ft at 40 °F; 16,000 to 23,500 lb): rms
  4.1 %, mean +0.7 %, worst +6.8 % (5,000 ft, 18,000 lb).
- **Landing distance**, 6 cases: rms 1.3 %, mean +0.7 %, worst +2.1 % (sea level, 19,500 lb).

The full table is on [Validation](validation.md#performance-test).

The checks pinned down four things:

- **Flaps.** Slotted flaps shift the whole lift curve up by more than they raise maximum lift: +0.27 CL at flaps 8,
  which is what reaching V2 at +9° on one engine needs. Stall speeds are unchanged.
- **Thrust.** The takeoff rating (corrected N1 93.3 %, flat-rated to 23.3 °C) below 1,500 ft, APR to 31.6 °C after a
  failure, and a 1.5 s run-down of the failed engine.
- **Brakes.** μ 0.40 with the 13 kN torque cap reproduces the landing rolls, including how they grow with weight.
- **Spoilers.** With flaps out they dump most of the flap lift.

`test/ground_test.mjs` covers the rest of the ground model: struts at rest, the parking brake, a 20,700 lb takeoff
(VR 130 at 2,203 ft, 35 ft at 3,224 ft), a tail strike with full aft stick, braking from 100 KIAS (stopped in 1,776 ft),
steering, the touchdown limits, a gear-up landing, ground effect and the trim solver. See [Testing](testing.md).
