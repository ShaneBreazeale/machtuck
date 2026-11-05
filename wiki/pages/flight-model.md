# Flight model

The airplane is a six-degree-of-freedom rigid-body model of the Learjet 60. Its geometry, limits and performance
come from the Learjet 60 Airplane Flight Manual (AFM, FM-123), the Gates Learjet wing patents and SAE 932534, the
paper that describes the Model 60 wing. The aerodynamics use textbook methods, not curve fits to the AFM. The AFM data
is used to check the result: see [Validation](validation.md).

| File | Contents |
|---|---|
| `js/aircraft.js` | State, integration, forces and moments, icing effects, structure, speed envelope |
| `js/aero.js` | Geometry, drag build-up, lift slope, the section pressure model (buffet, critical Mach, wave drag) |
| `js/engine.js` | PW305A two-stream cycle and the thrust-rating law |
| `js/atmo.js` | International Standard Atmosphere with a temperature offset |
| `js/controls.js` | Column, wheel and pedal forces, pilot strength, autopilot clutches |

## State and integration

`Learjet60` holds position and velocity in a north-east-down (NED) frame, an attitude quaternion, and body rates. The
body frame is x forward, y right, z down. The renderer uses a different world frame (x east, y up, z north), and
`js/util.js` converts between them.

| Quantity | Value | Source |
|---|---|---|
| Wing area, span | 24.57 m², 13.34 m | Bombardier (264.5 sq ft, 43 ft 9 in) |
| Mean aerodynamic chord | 2.035 m | AFM CG limits |
| Default mass | 9,400 kg (about 20,700 lb), 2,450 kg of fuel | the accident case, after about 2 h of burn |
| Inertias Ixx, Iyy, Izz | 40,000, 62,000, 92,000 kg·m² | estimates |

Each `step(dt, env)` computes the aerodynamic, thrust and ground forces in body axes, rotates them to NED, and adds
gravity. The body rates are advanced with Euler's equations (including the gyroscopic cross terms), and the
quaternion is advanced by the exact rotation for the new rates over the step. Velocity is updated first and position
then uses the new velocity (semi-implicit Euler). Fuel flow burns off mass every step.

The browser splits each frame into substeps of at most 1/240 s. The headless tests use 1/200 s.

The atmosphere is ISA with a temperature offset. The accident uses ISA+11 (`Environment.dT`), the mean of the 12Z
KMFL sounding between 9.5 and 11.8 km; see [Real weather and ATC data](weather-data.md#metar-and-sounding). Free
flight takes the offset from the chosen weather.

## Aerodynamics

### Lift

The lift-curve slope is the DATCOM/Helmbold swept-wing formula (Raymer 12.6) on the winglet-corrected aspect ratio. It
collapses by up to 30 % between M 0.86 and 0.98, past drag divergence. The zero-lift angle is −1.5°.

Maximum lift versus Mach comes from documents, not the pressure model, wherever documents exist:

- **Low speed:** the AFM stall chart (Fig 5-22) gives CLmax about 1.55, flaps up.
- **M 0.30 to 0.81:** the maneuvering-speed (VA) lines of the certified airspeed-limits chart in EASA TCDS IM.A.212.
  Part 25.335(c) puts VA where a full pull stalls the wing at the 3.0 g limit, so each point gives CNmax = 3W/(qS).
  Twenty points over four weights collapse onto one curve, which meets the stall chart near M 0.2. Maximum lift falls
  fast to M 0.5, then holds about 0.97 to Mmo.
- **Above M 0.81:** the section pressure model's Mach falloff, anchored at 0.97.

Past the stall angle, lift falls off and a nose-down pitch break grows with stall depth. A random walk adds rolling and
yawing asymmetry while stalled.

Flaps do two things. They raise maximum lift by +0.08, +0.22 and +0.40 at 8°, 20° and 40°, which reproduces the AFM
stall speeds. They also shift the whole lift curve up by more (+0.27, +0.45, +0.62), because a slotted flap stalls at
a lower angle of attack. The +0.27 at flaps 8 is what reaching V2 at the AFM's +9° rotation attitude on one engine
needs. Spoilers remove `0.15 + 0.45 × flaps` of lift, so with the flaps out they dump most of the flap lift.

### Drag

```
CD = CD0 + 0.014·ice + K·CL² + CD_trim + CD_wave + 0.035·spoilers + 0.025·gear + 0.06·flaps + stall term
```

- **CD0** is a component build-up (Raymer 12.5): wing, fuselage, nacelles, tails, winglets, pylons, ventral fins and
  aft-fuselage upsweep. Skin friction depends on Reynolds number and Mach. Leakage and protuberances add 5 %.
- **Induced drag** uses a swept-wing Oswald efficiency, with the winglets raising the effective aspect ratio
  (Raymer 12.49 and 12.50). Ground effect reduces it (see [Ground handling](ground.md#ground-effect)).
- **Trim drag** comes from the T-tail download that balances the cambered wing's nose-down moment.
- **Wave drag** is the Korn equation for the drag-divergence Mach plus Lock's fourth-power law, with the textbook
  Korn factor 0.87 for NACA 6-series sections. Ice lowers the critical Mach.

### Pitching moment

```
Cm = 0.02 + Cmα·(α − α0) − 45·q̂ + 0.45·effM·effTail·elevator + 0.14·effM·effTail·trim + tuck + other terms
```

- **Static stability:** `Cmα = −0.177 · CLα`, a static margin of 17.7 % MAC.
- **Elevator:** full elevator is worth ΔCm 0.45 at low speed. That is a T-tail estimate (tail about 5.6 m², arm about
  7.5 m), and rotating at VR needs it, because the main wheels sit about 0.6 m behind the CG.
- **Stabilizer trim:** the stabilizer trims over 1° to 12° (the PTM's range) at about 0.054 Cm per degree. One unit
  of `ctl.trim` is 2.6° and zero is 4.3°. Takeoff trim works out to 7.3°, inside the AFM's takeoff segment, and cruise trims near 5°.
- **effM** is the loss of control power past shock-buffet onset: up to 60 % between 0.02 below and 0.10 above the
  buffet-onset Mach for the current lift. Pulling g at high Mach therefore loses elevator authority sooner.
- **Gear:** lowering the gear at high speed adds a small nose-up moment (AFM: "moderate nose-up pitching moment").

### Buffet

The section pressure model in `js/aero.js` gives buffet onset. It applies simple sweep theory and the Kármán-Tsien
rule to a roof-top section, then takes the first of three separations:

1. The mid-chord shock: local Mach ahead of the shock reaches 1.3 (Pearcey). This is the high-Mach side.
2. The leading-edge suction peak reaching the same local Mach. This gives the knee near M 0.72.
3. Rear separation at a fixed section lift, which gives the plateau.

Four constants (`kT`, `kL`, `clI`, `clRear`) are least-squares fitted to the Model 60 flight-test buffet envelope in
SAE 932534 (Fig 19, nine points from M 0.50 to 0.815). As an unfitted check, the model's peak local Mach at the
paper's design point (M 0.75, α 4°) is 1.18, against 1.1 to 1.25 from the paper's TRANAIR results. Buffet is also
flagged when the wing is stalled or within 10 % of its stall angle.

> **Warning:** the buffet boundary is optimistic. See [Known biases](#known-biases).

### Stall warning and stick shaker

The stall-warning computer works from a normalized angle of attack (0 at zero lift, 1 at maximum lift). The shaker
fires at 0.82, or at 0.70 above 18,100 ft, where the AFM says the warning speeds rise about 15 kt. Above M 0.72 the
normalization uses the M 0.72 maximum lift, because past the buffet hump the warning is the buffet itself.

The computer assumes a clean wing, so an iced wing can stall before the shaker fires. That matches the AFM warning
that even small leading-edge ice raises the stall speed. **STALL WARN OFF** silences the shaker. There is no stick
pusher: the Learjet 60 has none.

### Mach effects

| Effect | Where | Model |
|---|---|---|
| Lift-curve slope | M 0.86 to 0.98 | down by up to 30 % |
| Maximum lift | above M 0.3 | the VA chart, then the pressure model |
| Wave drag | above Lock's critical Mach | `20·(M − Mcr)⁴` |
| Elevator and trim power | past buffet onset | down by up to 60 % |
| Aileron power | M 0.86 to 0.98 | down by up to 40 % |
| Column forces | M 0.82 to 0.93 | hinge moments up by up to 50 % (see [Control forces](#control-forces)) |
| Mach tuck | M 0.78 to 0.92 | hand-set nose-down moment, below |

### Mach tuck and the Mach trim compensator

Mach tuck is a nose-down moment of up to −0.14, growing smoothly between M 0.78 and 0.92:

```
tuck = −0.14 · smoothstep(0.78, 0.92, M)
```

It is **hand-set**. It is not derived from the pressure model, and only its ordering against the AFM Mach limits is
tested: the trim gradient must stay stable to M 0.77 with Mach trim failed and to Mmo 0.81 with it working.

The Mach trim compensator cancels 90 % of the tuck up to a moment of 0.05, so it offsets at most about 0.045. Beyond
that the tuck comes through. When the Mach trim fails, the full tuck acts and `mmo()` drops Mmo to 0.77, as the AFM
does with Mach trim inoperative.

### Spoilers and gear at high speed

AFM FM-123 (Overspeed Recovery, Pitch Axis Malfunction) warns of a "significant nose-down pitching moment associated
with spoiler deployment" above Vmo/Mmo, and says not to extend spoilers in any nose-down upset. The model's spoiler
moment is `−0.012` at normal speeds and grows to `−0.052` once the airplane is above Vmo or Mmo, scaled by `effM`.

## Icing

The airplane carries three ice states from 0 to 1: wing (`ice`), T-tail (`iceTail`) and engine inlet (`engIce`).
Accretion rates come from the storm in `js/scenario.js` (`iceRates`). Cloud and radar core intensity drive them, and
the wing, stabilizer and nacelle heat switches cut or reverse them. In clear air ice sheds. Free flight has no ice.

| Ice | Effect |
|---|---|
| Wing | Maximum lift down by up to 22 % (less at high Mach), drag +0.014, critical Mach lowered by 0.03, buffet onset lowered, aileron power down 30 %, a persistent left-wing-heavy roll with slow wander |
| T-tail | Tail stall margin shrinks; elevator and trim power down by up to 45 % before it stalls |
| Engine inlet | Thrust down by up to 35 % |

In the core, supercooled large drops overwhelm the stabilizer heat. With the heat on, the tail still accretes 78 % of
the raw rate, while the heat clears it quickly once out of the core.

### Iced tailplane stall and reattachment

The tail's local angle is `αT = 0.7·α − 3° + 8°·2.5·elevator`. A push drives it toward the tail's negative stall,
and a pull drives it away. The negative stall angle is 14°, cut by ice to `14 − 11.5·iceTail` degrees.

- The tail stalls when `αT` goes below the negative stall angle.
- A stalled tail keeps only 22 % of its elevator and trim power, and adds a −0.17 pitch-down moment.
- It reattaches only with a 3° margin: it takes a real pull, or less speed.

The column goes light (hinge moment ×0.45) and pulses while the tail is stalled. With the autopilot engaged, a tail
stall disconnects it. The `tailIce` failure flag turns this mechanism on for the hypotheses that use it; see
[Upset hypotheses](hypotheses.md).

## Lateral-directional

Roll, yaw and side force are linear in sideslip, roll rate, yaw rate, aileron and rudder:

```
Cl = −0.08·β − 0.42·p̂ + 0.08·r̂ + 0.014·aileron·effA − 0.012·rudder
Cn =  0.10·β − 0.18·r̂ − 0.02·p̂ + 0.07·rudder − 0.004·aileron
CY = −0.75·β − 0.15·rudder
```

The aileron power gives about 42°/s peak roll rate at cruise in the flight-test card. Flaps above their placard
speed (VFE 250, 200 and 165 KIAS) add a rolling asymmetry. With one engine failed, the live engine, 1.31 m off the
centreline, yaws the airplane, and the dead one adds windmilling drag.

### Yaw damper

The yaw damper adds `−1.5 × yaw rate` to the rudder command. It is on by default, switches off with weight on wheels,
and has its own toggle. The flight-test card measures a Dutch roll damping of 0.06 with it off.

## Engines

`js/engine.js` models each PW305A as a two-stream cycle with a forced mixer and one convergent nozzle. The design
point is from AIAA 90-2520 (40,000 ft, M 0.8, ISA): bypass FPR 1.811, BPR 4.3, OPR 23.711, combustor exit 2,105 °F.
The engine is sized to 4,600 lbf static at sea level from the FlightSafety PTM.

The thrust levers command N1 between flight idle (48 %) and the rating limit. N1 spools with a 2.5 s time constant up
and 1.5 s down. The rating law is the lowest of four limits, found in the AFM N1 tables by converting N1 to corrected
speed:

- flat-rated thrust (corrected N1 about 91.2 % at sea level on the cold side),
- turbine temperature (`N1c · Tt2^0.87` constant),
- mechanical N1 102 %,
- corrected N1 114 %.

**Takeoff rating.** With the levers full forward below 1,500 ft AGL, the rating rises to the takeoff N1: corrected
93.3 %, flat-rated to 23.3 °C (AFM Fig 5-25). APR is armed for takeoff. When an engine fails, it keeps 4,600 lbf on
the live engine to 31.6 °C (PTM ch. 7). A failed engine runs down over about 1.5 s and windmills. Thrust reversers
give about 45 % of the thrust in reverse and work only on the ground (see [Ground handling](ground.md#thrust-reversers)).

## Structure

Vmo/Mmo is an operating limit, not a structural one. Speed alone does no damage below the design dive speed VD/MD.

| Limit | Value | Source |
|---|---|---|
| Limit load | +3.0 / −1.0 g, flaps up | AFM |
| Ultimate load | 1.5 × limit | Part 25 |
| VD / MD | Vmo + 47 KIAS (377 at Vmo 330) / M 0.89 | estimate, not published; consistent with Part 25 margins |
| Flutter margin | 1.15 VD | Part 25.629 |
| Gear VLE | 260 KIAS | AFM |
| Flap VFE | 250 / 200 / 165 KIAS | AFM |

Damage builds up at a rate set by how far a limit is exceeded, and the airplane breaks up when it reaches 1:

- above +3.6 g or below −1.6 g, damage grows with the excess, and above +4.5 g it grows fast;
- past VD or MD the allowable g shrinks;
- past 1.15 VD, or above M 0.96, failure is rapid;
- a rolling pull-out above Vmo, a violent pitch rate at high dynamic pressure, and flaps above VFE also add damage;
- the gear above VLE only damages the gear doors.

The breakup is a stabilizer failure if the pitch rate, Mach or g was high at the moment of failure, otherwise a wing
failure. In the sim's breakups the killer is usually negative g. When the iced tail stalls, the pitch-down loads the
wing to about −2 g within seconds while the airplane is still near M 0.81.

## Control forces

The Learjet 60's ailerons and elevator are driven by cables and push-rods with no hydraulic boost, so
`js/controls.js` treats your input as the **force** on the column, not the surface position. The surface moves until
that force balances its hinge moment.

- Hinge moment grows with dynamic pressure, and by up to 50 % more between M 0.82 and 0.93.
- Full elevator takes 165 lb at 250 KEAS; full aileron takes 34 lb. The rudder boost takes about 40 % of the pedal
  force.
- The calibration follows the AFM warning that a nose-down trim runaway or overspeed "can require control forces in
  excess of 75 pounds". In the model, holding full nose-down trim at Vmo takes about 100 lb.
- The stabilizer trims as a whole, with no tab, so mis-trim appears as a large standing elevator deflection, which is
  a large standing force. Nose-up trim is how you take the load off.

Input maps to force progressively (`|input|^1.5`), so small corrections are fine and full deflection is full
strength.

| Axis | Sustained | Burst |
|---|---|---|
| Pitch | 60 lb | 150 lb |
| Roll | 40 lb | 90 lb |
| Yaw | 150 lb | 250 lb |

Stamina drains while you pull more than the sustained force and recovers when you relax. At full strength it tires
within about 10 seconds. The AFM lists elevator force changes and column pulsing with ice on the stabilizer. In the
model the column pulses with tail ice, and harder with a stalled tail and with power.

### Autopilot clutches and trim servo

The autopilot drives the same surfaces through clutched servos. They slip when your force exceeds 25 lb in pitch or
15 lb in roll, and the surface then follows the excess. The autopilot stays engaged while it slips. Its auto-trim
moves the stabilizer in proportion to the elevator its servo is holding, so it keeps trimming against you until you
disconnect it. The as-flown autopilot trims at 0.35 units per second per unit of elevator. The trainer's trims at 0.08,
and doesn't hand over the airplane trimmed nose-down.

Manual trim runs at full rate on the primary system, at 45 % on the secondary, and not at all with the selector off.

With a force-feedback stick the roles swap: stick position is column position and the motor supplies the hinge
moment. See [Hardware and force feedback](hardware.md).

## Curved-earth datum in free flight

The world's ground surface is not flat: its height grows with the square of the distance from Palm Beach,
`groundAlt = (n² + e²) / 12.72e6` metres (`js/ground.js`). Free flight sets `ac.curved`, and then:

- altitude is measured above that surface, so the altimeter, VSI, glideslopes and VNAV read the same at Orlando,
  230 km away, as at Palm Beach;
- gravity acts along the surface's local vertical;
- pitch and bank are reported relative to the local horizon, and vertical speed relative to the surface;
- the trim solver measures the flight-path angle from the local horizon.

The accident keeps the flat frame it was calibrated in. Across its 30 km box the difference is under 70 m.

> **Note:** the surface curves upward, like a bowl, rather than down like the Earth. The flight model is consistent
> with it; the visual effect is described in [Renderer](renderer.md#known-issue-curvature-sign).

## Known biases

- **The buffet boundary is optimistic.** It follows the SAE 932534 flight test, which sits 0.03 to 0.08 in lift
  coefficient above the AFM boundary (Fig 5-24). On the AFM's worked example (FL400, 18,000 lb) the model's 1 g
  low-speed buffet is 8 kt early and its M 0.70 buffet onset is 1.63 g against 1.56 g. At FL350 and 20,700 lb that
  puts high-speed buffet onset about 6 to 12 KIAS too fast. Elevator authority, which fades past buffet onset, lasts
  too long into a dive. `test/aero_validate.mjs` reports this every run, and `AERO_STRICT=1` makes it fail. Refitting
  needs Fig 5-24 digitized at several W/δ lines.
- **The Mach tuck is hand-set.** Its size is not checked, only its ordering against the AFM Mach limits.
- **VD/MD are estimates.** They are not in the AFM or the EASA TCDS.

These caveats apply to every upset result. See [Validation](validation.md) for the measured numbers.
