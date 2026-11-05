# N722BD: Learjet 60 convective upset simulator

A browser flight simulator that recreates the 1 November 2026 loss of Learjet 60 N722BD, which entered a thunderstorm
core at FL350 over Palm Beach County, and lets you try to fly it out. The storm is built from the real radar,
satellite and lightning data for those minutes. The airplane is a 6-DOF model checked against the Airplane Flight
Manual (AFM). It is pure WebGL2 and ES modules with no build step.

**[Fly it in your browser](https://shanebreazeale.github.io/machtuck/)** · **[Read the wiki](https://shanebreazeale.github.io/machtuck/wiki/)**

![Four views from the sim: the anvil top from above, the jet entering the radar core at FL350, the virtual cockpit with weather radar, and Greenacres from 300 m](docs/img/screenshot.jpg)

> Nine people died on this flight. The cause is undetermined, and every upset scenario here is a hypothesis, not a
> finding. The crew's final transmissions are not reproduced in the game.

## Contents

[Features](#features) · [Installation](#installation) · [Usage](#usage) · [Controls](#controls) ·
[How it works](#how-it-works) · [Validation](#validation) · [Real data](#real-data) · [Development](#development) ·
[Contributing](#contributing) · [License](#license)

## Features

- **The real storm.** KAMX NEXRAD volumes drive the clouds, icing and the cockpit weather radar. GOES-19 sets the cloud
  tops, GLM flashes are replayed at their real times and places, and the KPBI METAR and KMFL sounding fill in the rest.
- **An airplane that fights back.** Mach tuck, shock buffet, ice on the wing and T-tail, unboosted controls with real
  column forces, an autopilot that trims against you, and Part 25 structural limits.
- **Four upset hypotheses.** Fly the combined convective-core case, a tailplane stall, Mach tuck with a failed Mach
  trim, or a runaway nose-down trim, each "as flown" or in trainer mode. Both modes fly the same airplane through the
  same storm: trainer only gives the autopilot a gentler auto-trim and, in the iced-tail cases, doesn't hand over the
  airplane trimmed nose-down. The Mach-tuck and trim-runaway failures trim nose-down in both modes: that is the failure.
- **A reconstruction mode.** Watch the reported ADS-B track replayed with chase, cockpit and ground cameras.
- **Free flight sorties and IFR routes.** Separate from the accident: plan a local flight or a route between any of the
  72 IFR airports within 160 nm of Palm Beach. Choose a departure procedure, airways and fixes, an arrival and an
  approach from the FAA nav database (CIFP), or import an MSFS `.pln` file or a SimBrief plan. An FMS flies the
  procedure, including the missed approach and holds, through an autopilot and flight director whose modes follow
  FAA AC 25.1329-1C. The ground model covers landing gear, tyres, brakes, nosewheel steering and ground effect.
- **A Pro Line 4-style PFD.** Mode band (active modes green, armed modes white), single-cue flight director, speed
  and altitude tapes, VSI, and an HSI with the course pointer for the localizer or the FMS leg.
- **A debrief.** Compares your flight with the real one and exports a 4 Hz flight data recorder as CSV.
- **A physically based renderer.** Atmosphere scattering, volumetric clouds, imagery-driven ground with 62,000 real
  buildings and 512,000 measured trees around the impact area.

## Installation

Nothing to install or build. Clone the repository and serve it with any static file server:

```bash
git clone https://github.com/ShaneBreazeale/machtuck.git
cd machtuck
python3 -m http.server 8080
```

Then open http://localhost:8080.

You need a WebGL2 browser with `EXT_color_buffer_float`, which every current desktop browser has. A discrete GPU or
Apple Silicon is recommended. Press `K` to trade quality for frame rate.

## Usage

Click **Fly it**, or press `N` to skip ahead to core entry. The autopilot flies the cruise and hands you the airplane
when it can no longer cope.

The page opens on the accident: real weather, autopilot on, 12:47:00 EST.

**Free flight sortie** is a separate mode: **Plan a sortie →** on the briefing screen, or open `index.html#sortie`.
There is no storm and no accident script. Choose:

- **Departure:** airport, runway, and a SID with its transition.
- **Route:** fixes, airways and coordinates (`2630N08010W`), for example `TBIRD8 CHEFS MUNGI1`. A SID or STAR written in
  the route is selected for you, with or without its version digit and in FAA style (`TBIRD.MATLK MATLK.SLOAO1`).
  `FL210` or `/F210` in the route sets the cruise altitude, even levels included. **Import** reads an MSFS `.pln`
  file, or fetches the latest SimBrief plan for a username you type (sent only to SimBrief, only when you click
  Fetch).
- **Arrival:** airport, STAR with its transition, approach with its transition. **Auto** joins the approach where the
  route ends; if the route ends elsewhere, ATC-style vectors put you on the final approach course at a 30° intercept.
- **Start:** lined up on the departure runway, en route at the cruise altitude, airborne at the start of the
  approach, or a 6 nm final.
- **Weather, weight and failure:** calm air, the accident day's METAR wind or a crosswind; an engine failure at V1 or
  after takeoff.

The planner shows the whole plan with its distance and lists anything it couldn't find. For example, KDJT to KMCO via
`TBIRD8 CHEFS MUNGI1` to the ILS 18R is 176 nm.

On the runway the parking brake is set and takeoff trim is dialled in. The AFM V1, VR and V2 for your weight appear on
the speed tape and are called out. Hold Shift to release the brake, add full thrust, and rotate at VR to about +9°
(the tail strikes at 11°). On approach the bug shows VREF and radio altitude is called from 500 ft. Touch down below
600 ft/min; harder than that the gear is damaged, and near 960 ft/min it collapses. On the ground the spoilers deploy
themselves at idle above 60 kt, and pulling thrust back past idle (`−` or L2) deploys the thrust reversers. The log
reports the touchdown point, centreline offset, runway left and landing distance available.

### Flight guidance

The flight management system (`js/fms.js`) flies any ARINC 424 leg sequence: track, course and direct to a fix,
heading or course to an altitude, intercepts, DME arcs, radius-to-fix turns and holds. Holds use the standard direct,
teardrop and parallel entries. Nothing is written for a particular airport; the legs come from the data.

The autopilot and flight director modes follow FAA [AC 25.1329-1C](https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_25_1329-1C.pdf):

- **Lateral:** HDG, LOC and LNAV. Spin the heading bug past 180° and the airplane turns the way you spun it.
- **Vertical:** ALT, VS, VNAV, GS, GP (an RNAV approach's final path), TO and GA. Altitude capture is always armed.
- **Armed modes** (white) engage when their capture criteria are met. LNAV engages within 2 nm of the path, and above
  400 ft after takeoff or a go-around.
- **VNAV** flies the plan's altitude constraints but never climbs or descends through the preselected altitude,
  except on final. On a route it climbs to the cruise altitude by speed on elevator: you set climb thrust, and pitch
  holds 250 kt below 10,000 ft, then 280 kt / M 0.70. It holds cruise until the descent path to the arrival
  constraints reaches it (top of descent). Lower the preselected altitude to let it descend.
- **Direct to** (`@`) opens a DIRECT TO box listing the plan's fixes ahead with bearing and distance. Click one, or
  type any fix, navaid or airport and press Enter. A fix in the plan is flown direct and the legs before it are
  skipped; it keeps its altitude constraint and approach role (a direct to the FAF is still the FAF). Any other fix is
  flown direct and the plan resumes from it. A holding fix is reached direct and the hold entry follows. The mode stays
  yours: press `(` for LNAV if you are on HDG.
- **Vectors:** a departure that ends in radar vectors gets a "proceed direct" clearance from ATC after a minute.
- **Go-around** (`?`) pitches 10°, arms LNAV for the published missed approach and climbs until the preselected
  altitude is above you. Once you are established on the glideslope, the pilot monitoring sets the missed-approach
  altitude.

`X` engages the autopilot, `|` toggles the flight director, `(` arms LNAV, `)` arms VNAV, `@` is direct to and `\` arms the approach.
The same controls are on the glareshield's flight guidance panel (and the 2D panel's bottom bar): click its buttons,
scroll its HDG and ALT knobs and VS wheel. Hovering any cockpit control outlines it and says what it is and does.
`{` `}` move the heading bug and `<` `>` set the preselected altitude. There is no autothrottle on the Learjet 60, so
speed stays yours.

The minimums bug is set from the FAA plate, because CIFP carries the procedures but not their minimums. The plate
fetcher reads the straight-in DA or MDA for each category from the chart's text layer, at all 72 airports (312 of
the 329 approach plates; the military fields' plates, which have no usable text layer, are read by OCR with tesseract and shown in the viewer,
since the CIFP has no procedures there;
the rest are circling-only, visual or helicopter-only). The Learjet 60 is Category C:
its VREF at maximum landing weight is 139 kt. The line used depends on the approach:

- ILS: S-ILS (ILS 10L: DA 216 ft).
- LOC: S-LOC, flown LOC + GP (LOC 28R: MDA 460 ft).
- RNAV (GPS): LNAV/VNAV, else LNAV. The airplane has baro-VNAV, not WAAS.
- RNAV (RNP): RNP 0.30.

Circling minimums aren't read: in the text layer they wrap across lines and can't be assigned to categories. With no
plate (or none readable), an RNAV (GPS) approach uses the FAA master RNAV list (LNAV/VNAV, else LNAV; that list's sheets are effective
31 Jan 2019, so the values can be off by a few hundred feet and the log says so), and the rest fall back to 200 ft
above touchdown on an ILS with a glideslope and 400 ft otherwise. `~` (or **Approach plates** on the sortie screen) shows the loaded approach's chart: KDJT (the former KPBI) ships
all 12 approach plates and the airport diagram as images; elsewhere each plate opens a link to the FAA PDF. The charts
and the nav data are public domain and **not for navigation**. Refresh them with:

```bash
python3 tools/fetch_cifp.py            # FAA CIFP -> data/nav (airports, runways, ILS, procedures, airways)
python3 tools/fetch_markers.py         # FAA NASR (eNASR) -> data/nav/markers.json (operational ILS marker beacons)
python3 tools/fetch_rnav_minimums.py   # FAA master RNAV list -> data/nav/rnav_minimums.json (RNAV minimums, no plates)
python3 tools/fetch_plates.py --cycle <cycle>          # KDJT charts as images, with minimums
python3 tools/fetch_plates.py --cycle <cycle> --all    # every airport's minimums, no images
```

## Controls

| Action | Keyboard | Controller |
|---|---|---|
| Pitch and roll | Arrow keys or WASD, or drag the mouse. Down or S pulls. | Left stick |
| Rudder | Q / E | Right stick |
| Throttle | `-` / `=`, `0` for idle | R2 / L2, square for idle |
| Pitch trim | `,` nose-down, `.` nose-up | L1 nose-down, R1 nose-up |
| Autopilot off or on | X | Cross |
| Heading bug, altitude preselect, approach (APR) | `{` `}`, `<` `>`, `\` | |
| LNAV, VNAV, direct to | `(`, `)`, `@` | |
| Flight director, go-around (TOGA) | `\|`, `?` (or a bound button) | |
| Approach plates | `~` | |
| Spoilers, gear, flaps | B, G, F | Circle, D-pad |
| Brakes (free flight) | Hold Shift; toe brakes bind in the controls panel | D-pad left |
| Thrust reversers (on the ground) | `−` past idle, `=` to stow; or a bound button | L2 past idle |
| Camera | C, right-drag to orbit | Triangle |
| Cockpit buttons, knobs and levers | Click; scroll a knob (Shift: faster); drag a lever (thrust, flaps, spoilers); click the parking brake; hover for a tooltip | |
| FMS CDU (large, type into it) | F2, or click the CDU on the pedestal | |
| Tablet (map and procedure cards) | Tab, then 1 to 6 for a card | |
| Real weather on or off | U | |
| Pause, restart, sim rate | P, R, `[` `]` | Options |
| Controls and hardware binding | / | |
| All keys | H | Create |

**Flight hardware.** Yokes, joysticks, rudder pedals and throttle quadrants work through the browser's Gamepad API, several
at once, in Chrome and Firefox. Press `/`, or **Controls & hardware** on the briefing screen, then bind each function by
moving or pressing the control: pitch, roll, rudder, throttle lever, autopilot disconnect, trim (hat switch or buttons),
gear, flaps, spoilers, idle and camera. The direction you move a control on binding becomes its positive direction, and
its travel is the calibration. Bindings are saved per device name in the browser. An unbound yoke or stick flies on its X
and Y axes; pedals and quadrants do nothing until bound. A moved throttle lever sets the thrust levers directly, and
hardware axes skip the keyboard's smoothing ramp. Each device appears only after you press one of its buttons.

**Force feedback.** A USB PID force-feedback joystick (the DirectInput force-feedback standard) can drive the column in
Chrome or Edge over WebHID. Open the controls panel (`/`), choose **Connect force-feedback stick**, and pick the stick in
the browser's prompt. The stick's position then becomes the column's position, and its motor supplies the elevator
and aileron hinge moment. The stick gets stiffer with airspeed and transonic Mach, and goes light and pulses with a
stalled iced tail. With the autopilot engaged the stick follows the servo, and pushing past the clutch force makes it
slip. The stick shaker and buffet shake the stick. Your simulated strength still limits how far the elevator goes.
**Test** pulls the stick back, then moves it right, then shakes it; use invert or swap if the directions are wrong.
Start with low strength. The driver reads the report layout from each stick's HID descriptor, so no per-model profile
is needed. It has been tested only against simulated sticks, so behaviour on real hardware is unverified.

Without a force-feedback stick, your inputs are force on the column, not surface position. At high speed full deflection may take more than you can
hold, and nose-up trim is how you take the load off. The help screen (`H`) has the AFM upset-recovery card.

## How it works

### Flight model

The geometry, limits and performance data come from the Learjet 60 AFM (FM-123), the Gates Learjet wing patents, and
SAE 932534, which describes the Model 60 wing. Aerodynamics use textbook methods (component drag build-up, DATCOM lift
slope, sweep theory and a section pressure model for critical Mach, wave drag and buffet). The engine is a PW305A
two-stream cycle anchored at the design point in AIAA 90-2520.

Maximum lift versus Mach comes from the certified airspeed-limits chart in EASA type certificate data sheet
IM.A.212. Its maneuvering-speed lines mark where a full pull stalls the wing at the 3.0 g limit load, so each point
gives the maximum lift at that Mach. Twenty points over four weights fall on one curve that meets the AFM stall chart
near M 0.2.

### Control forces

The Learjet 60's ailerons and elevator are driven by cables and push-rods with no hydraulic boost, so
[`js/controls.js`](js/controls.js) treats your input as the force on the column. The surface moves until that force
balances its hinge moment, which grows with dynamic pressure and in the transonic range. The calibration follows the
AFM, which warns that a nose-down overspeed can need more than 75 lb to recover. A pilot holds about 60 lb, bursts to
150 lb, and tires within about 10 seconds. The autopilot's clutched servos can be overpowered, but it keeps trimming
against you until you disconnect it.

Full elevator is worth ΔCm 0.45 at low speed, a T-tail estimate (tail about 5.6 m², arm about 7.5 m) that rotation
at VR needs: the main wheels sit about 0.6 m behind the CG (the TCDS CG range against the gear contact points). The
stabilizer trims over the PTM's 1–12° range at 0.054 Cm per degree. Takeoff trim works out to 7.3°, inside the AFM's
takeoff segment, and cruise trims near 5°. Both modes use the full stabilizer travel: a nose-down trim runaway now runs
to the real stop, and nose-up trim has more to give in a recovery. The upset scenario keeps its earlier calibration
otherwise: column force, tail-stall onset and autopilot authority per unit of pitching moment are unchanged.

### Ground

The world's ground surface is curved (its height grows with the square of the distance from Palm Beach). Free flight
measures altitude above that surface, applies gravity along its local vertical, and reports pitch and bank relative to
the local horizon. So the altimeter, VSI, glideslopes and VNAV read the same at Orlando, 230 km away, as at Palm
Beach. The accident keeps the flat frame it was calibrated in: across its 30 km box the difference is under 70 m.

[`js/ground.js`](js/ground.js) models three oleo struts (stiffness and damping set so each sits about a third into its
stroke), tyres with rolling and cornering friction, anti-skid brakes, and nosewheel steering that narrows from 45° at
taxi speed to 7° at takeoff speed. The geometry comes from the exterior model: the nose wheel carries 7.8 % of the
weight, and the tail and wingtips touch at 11.3° of pitch and 14.5° of bank. Touchdown follows Part 25: 10 ft/s is the
limit, more than 12 ft/s damages the gear, and about 16 ft/s collapses it. Ground effect cuts induced drag, adds lift
and pitches the nose down below one wingspan. Runways come from the FAA CIFP (146 runway pairs at 72 airports); the three nearest
are painted with FAA markings, KPBI over a 1.25 m/px NAIP image, and an OpenStreetMap boundary keeps the
imagery-driven 3D houses off the aerodrome.

Takeoff and landing are checked against the AFM tables (see Validation). That pinned down four things:
- **Flaps.** Slotted flaps shift the whole lift curve up by more than they raise maximum lift: +0.27 CL at flaps 8,
  which is what reaching V2 at the AFM's +9° rotation attitude on one engine needs. Stall speeds are unchanged.
- **Thrust.** Takeoff thrust (corrected N1 93.3 %, flat-rated to 23.3 °C) applies below 1,500 ft with the levers full
  forward. APR, armed for takeoff, keeps 4,600 lbf on the live engine to 31.6 °C after a failure (PTM ch. 7). A failed
  engine runs down over about 1.5 s and windmills.
- **Brakes.** Anti-skid braking at μ 0.40 with a brake-torque limit of 13 kN per main gear reproduces the AFM landing
  rolls, including how they grow with weight.
- **Spoilers.** With flaps out they dump most of the flap lift. Thrust reversers give about 45 % reverse thrust and
  aren't credited in the AFM distances.

### Structure

Vmo/Mmo is an operating limit, not a structural one. Below the design dive speed, speed alone does no damage. Strength
follows the AFM limit load of +3.0 / −1.0 g, with failure at the 1.5× ultimate load. Past the design dive speed the
allowable loads shrink, and past the flutter margin failure is rapid. The design dive speed of 377 KIAS / M 0.89 is
not published anywhere. It is an estimate consistent with the Part 25 margins.

In the sim's breakups the killer is negative g. When the iced tail stalls, the pitch-down loads the wing to about
−2 g within seconds, past the ultimate load, while the airplane is still near M 0.81.

### Renderer

[`js/render.js`](js/render.js) and [`js/shaders.js`](js/shaders.js) form an HDR pipeline:

- **Atmosphere:** precomputed transmittance and multiple-scattering tables on a spherical Earth, with aerial
  perspective shadowed by the clouds. The sun comes from a solar ephemeris for the scenario clock.
- **Clouds:** a volumetric raymarch shaped by the radar and satellite data, eroded with GPU-baked noise, lit by a light
  march plus a cloud-shadow map.
- **Ground:** USGS aerial imagery on a spherical Earth with water, waves and sun glint. Below 1.8 km the photo drives
  ray-traced houses and trees. Over the impact area the buildings and trees are measured, not generated.
- **Aircraft:** the textured Premier Aircraft Design Learjet 60 with live control surfaces, gear and beacon, in the
  N722BD livery, drawn with 4× multisample anti-aliasing.
- **Post-processing:** temporal anti-aliasing and upsampling, bloom, sun glare, eye adaptation and an ACES tone map.
  Dynamic resolution aims for 55 fps; on an Apple M4 at 2560×1320 `tools/bench.mjs` measured 20 to 51 fps by view,
  with resolution at its 0.45 floor.

[`docs/visual_comparison.md`](docs/visual_comparison.md) compares it with MSFS 2024 and X-Plane 12, feature by feature.

## Validation

Run `node test/flight_test.mjs`, `node test/afm_validate.mjs`, `node test/aero_validate.mjs` and `node test/performance_test.mjs` to reproduce these.
Each exits 1 on a failure. `flight_test.mjs` marks its rows PASS, FAIL or BIAS: a BIAS row is a known model bias,
reported but failed only with `STRICT=1`.
The performance test flies the AFM procedures: accelerate-go with an engine failure at V1, accelerate-stop, 115 % of
the all-engine distance, and the landing from 50 ft at VREF.

| Check | Model | Reference |
|---|---|---|
| Clean and flapped stall speeds, 2 weights | within 2 kt | AFM Fig 5-22 |
| Buffet onset lift vs Mach | rms error 0.019 | SAE 932534 flight test |
| Buffet onset vs the AFM, FL400 18,000 lb worked example | 8 kt early at low speed, 1.63 g vs 1.56 g at M0.70 | AFM Fig 5-24 (known bias, see below) |
| Mach-tuck trim gradient reversal | M0.785 with Mach trim failed, M0.83 working | after the AFM's 0.77 (Mach trim inop) and Mmo 0.81 |
| Max g at the 20 certified VA points | 2.90 to 3.11 g | 3.0 g, EASA TCDS IM.A.212 |
| Max-continuous N1 | rms ~1.5% | AFM Fig 5-31, 5-32 |
| Single-engine climb gradient | rms 0.7% | AFM Fig 5-62, 5-65 |
| Time to climb, MTOW to FL410 | 16.9 min | 18 to 18.5 min published (from brake release) |
| NBAA IFR range, 4 passengers | 2,455 nm | 2,405 nm published |
| Max level speed | 458 KTAS | 453 to 466 KTAS published |
| Takeoff field length, flaps 8, 15 cases (sea level 60 °F and 90 °F, 5,000 ft) | rms 4.1 %, all within 7 % | AFM Fig 5-38 |
| Landing distance from 50 ft, 6 cases | rms 1.3 %, all within 2.2 % | AFM Fig 5-74 |

`node test/aero_validate.mjs` checks the aerodynamics against what the AFM publishes. The AFM has no lift, drag or
moment curves, so they are checked through the buffet boundary, the Mach-tuck limits and the stall and VA charts
(the last two in `flight_test.mjs`). Two caveats apply to every upset result:
- **The buffet boundary is optimistic.** It follows the SAE 932534 flight test, which sits 0.03 to 0.08 in lift
  coefficient above the AFM boundary (Fig 5-24). At FL350 and 20,700 lb that puts high-speed buffet onset about 6 to
  12 KIAS too fast, and elevator authority (which fades past buffet onset) lasts too long into a dive. The test
  reports this as a known bias; `AERO_STRICT=1` makes it fail. Refitting needs Fig 5-24 digitized at several W/δ lines.
- **The Mach tuck is hand-set.** Its pitching moment is not derived from the pressure model. Only its ordering against
  the AFM's Mach limits is checked, not its size.

The difficulty mode never changes the physics: `aero_validate.mjs` flies both modes through the storm with the same
seed and inputs and requires identical trajectories. `MODE=trainer` runs `force_test.mjs` and `recovery_test.mjs` with
the trainer's autopilot.

`node test/force_test.mjs` flies the upset with a force-limited pilot following the AFM procedure. Starting the
recovery 2 seconds after the autopilot lets go saves the airplane in three of the four hypotheses (the trim runaway
breaks up). At 5 seconds it is marginal: the tail-stall case loses about 11,000 ft and the combined case about
10,000 ft. From 8 seconds on, the wing fails before the recovery takes hold (the Mach-tuck case from 12 seconds).

## Real data

| Data | Source | Used for |
|---|---|---|
| `data/kamx_*` | KAMX NEXRAD Level II at 17:45 and 17:51Z, gridded to 500 m (a 17:40Z volume is included but not loaded) | Clouds, cores, icing, updrafts, weather radar |
| `data/goes/` | GOES-19 ABI visible and infrared, parallax-corrected | Cloud-top height and deck thickness |
| `data/glm_flashes.json` | GOES-19 Geostationary Lightning Mapper, 17:44 to 17:52Z | Lightning times and positions |
| `data/metar.json`, `data/sounding_kmfl.json` | KPBI METARs, KMFL 12Z radiosonde | Cumulus layer, deck base, freezing level, the day's temperature (ISA+11) and wind aloft |
| `data/ground/` | USGS orthoimagery (NAIP), NASA Blue Marble, USGS NHD water | Terrain texture and water |
| `data/nav/` | FAA CIFP cycle 261029 (ARINC 424, public domain) | Airports, runways, ILS, SID / STAR / approach procedures, navaids, airways |
| `data/nav/markers.json` | FAA NASR via eNASR (public domain) | The operational ILS marker beacons (the CIFP has none) |
| `data/nav/rnav_minimums.json` | FAA "All Approaches - Master RNAVs" list (effective 31 Jan 2019, public domain) | RNAV straight-in minimums where no plate is loaded |
| KPBI boundary (in `js/ground.js`) | OpenStreetMap (ODbL) | Keeps imagery-driven houses off the airport |
| `data/plates/` | FAA d-TPP cycle 2611 (public domain) | KDJT plates and diagram; straight-in minimums at all 72 airports |
| `data/ground/buildings.bin` | Overture Maps (OpenStreetMap + Microsoft) | 62,192 buildings with measured heights |
| `data/ground/trees.bin` | Meta / WRI 1 m canopy height map | 511,964 trees with measured heights and crowns |
| `audio/atc_liveatc.mp3` | LiveATC recording as publicly posted | Optional ATC audio, off by default |

Every dataset has a fetch script in [`tools/`](tools), for example:

```bash
python3 tools/grid_nexrad.py <Level2 file> data/kamx_HHMMSS
python3 tools/fetch_goes.py --out data/goes
python3 tools/fetch_buildings.py
```

## Development

Run the headless physics checks with Node 22:

```bash
for t in test/*.mjs; do node "$t" || echo "FAILED: $t"; done
```

Measure real-time frame rate in headless Chrome while the server runs on port 8080:

```bash
node tools/bench.mjs 2560x1320 8080
```

| Path | Contents |
|---|---|
| `js/aircraft.js`, `js/aero.js`, `js/engine.js` | Flight model, aerodynamics, engine cycle |
| `js/controls.js` | Column and wheel forces, pilot strength, autopilot clutches |
| `js/input.js`, `js/hardware.js`, `js/hwui.js` | Keyboard and mouse, all connected flight hardware, the binding panel |
| `js/ground.js`, `js/freeflight.js` | Landing gear and ground contact; free-flight starts, weather and trim solver |
| `js/navdb.js`, `js/fms.js` | Nav database (CIFP) and procedure assembly; the FMS leg engine (LNAV, VNAV, holds) |
| `js/route.js` | Route strings, MSFS `.pln` import, whole-plan assembly (SID, airways, STAR, approach, vectors to final) |
| `js/nav.js`, `js/afm.js` | ILS deviations for any ILS in the database; AFM takeoff speeds and VREF |
| `js/pfd.js` | Pro Line 4-style primary flight display |
| `js/ffb.js` | USB PID force-feedback driver over WebHID |
| `js/scenario.js` | Storm environment, ADS-B reconstruction, ATC timeline, flight guidance (AP / FD modes), hypotheses |
| `js/render.js`, `js/shaders.js` | WebGL2 renderer |
| `js/hud.js`, `js/cockpit.js`, `js/vcgauges.js` | Instruments, 3D cockpit, standby gauges |
| `test/` | Flight-test card, AFM table validation, upset, recovery, force, ground, performance, ILS, hardware and force-feedback checks |
| `tools/` | Data fetchers, model and livery converters, benchmark |
| `wiki/` | The documentation site: Markdown pages in `wiki/pages`, rendered in the browser by `wiki/wiki.js` |

Debug views load the reconstruction paused at a given time:

- `#view=t,cam,orbitYaw,orbitPitch` uses a sim camera (0 cockpit, 1 chase, 2 ground).
- `#shot=x,y,z,yaw,pitch,fov,nexrad,t` uses a free camera in metres from KPBI (x east, y up, z north).

## Contributing

Issues and pull requests are welcome, especially better sources: photos of N722BD for the livery, or published Learjet 60
data that can replace an estimate. Run the test suite before opening a pull request, and keep every number traceable to
a source or marked as an estimate.

## Sources and credits

The timeline comes from the Flightradar24 blog, a BizJet Journal ADS-B Exchange analysis, NEXRAD analyses by MyRadar and
LiveStormChasers, LiveATC recordings, and the NTSB briefing of 2 November 2026. All figures are provisional.

The aircraft and cockpit models are the FSX Bombardier Learjet 60 by Premier Aircraft Design (Jean-Pierre Brisard,
Barry Blaisdell, Bob May and Kevin Pardy), converted by `tools/fs9_ext.py` and `tools/fs9_vc.py`. See
[`data/vc/README.md`](data/vc/README.md).

## License

Third-party data keeps its own terms:

- USGS and NASA imagery and NOAA weather data are public domain.
- The Overture buildings are © OpenStreetMap contributors and Microsoft, under ODbL 1.0.
- The canopy height data is by Meta and the World Resources Institute, under CC BY 4.0.

The repository does not include a license file for its own code yet.
