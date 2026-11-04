# N722BD: Learjet 60 convective upset simulator

A browser flight simulator that recreates the 1 November 2026 loss of Learjet 60 N722BD, which entered a thunderstorm
core at FL350 over Palm Beach County, and lets you try to fly it out. The storm is built from the real radar,
satellite and lightning data for those minutes. The airplane is a 6-DOF model checked against the Airplane Flight
Manual (AFM). It is pure WebGL2 and ES modules with no build step.

**[Fly it in your browser](https://shanebreazeale.github.io/machtuck/)**

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
  trim, or a runaway nose-down trim, each "as flown" or in a forgiving trainer mode.
- **A reconstruction mode.** Watch the reported ADS-B track replayed with chase, cockpit and ground cameras.
- **Free flight sorties.** Separate from the accident: plan a flight at any of the 72 IFR airports within 160 nm of
  Palm Beach, using runways, ILS and approach procedures from the FAA nav database (CIFP). An FMS flies the
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

- **Airport and runway**, from the nav database.
- **Approach and transition**, from the airport's published procedures (ILS, LOC, RNAV). The planner shows the legs,
  including the missed approach.
- **Start:** lined up on the runway, airborne at the start of the approach with the autopilot on, a 6 nm final, or
  cruise at FL350.
- **Weather, weight and failure:** calm air, the accident day's METAR wind or a crosswind; an engine failure at V1 or
  after takeoff.

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
  except on final.
- **Go-around** (`?`) pitches 10°, arms LNAV for the published missed approach and climbs until the preselected
  altitude is above you. Once you are established on the glideslope, the pilot monitoring sets the missed-approach
  altitude.

`X` engages the autopilot, `|` toggles the flight director, `(` arms LNAV, `)` arms VNAV and `\` arms the approach.
`{` `}` move the heading bug and `<` `>` set the preselected altitude. There is no autothrottle on the Learjet 60, so
speed stays yours.

The minimums bug is set from the FAA plate, because CIFP carries the procedures but not their minimums. The plate
fetcher reads the straight-in DA or MDA for each category from the chart's text layer. The Learjet 60 is Category C:
its VREF at maximum landing weight is 139 kt. The line used depends on the approach:

- ILS: S-ILS (ILS 10L: DA 216 ft).
- LOC: S-LOC, flown LOC + GP (LOC 28R: MDA 460 ft).
- RNAV (GPS): LNAV/VNAV, else LNAV. The airplane has baro-VNAV, not WAAS.
- RNAV (RNP): RNP 0.30.

Circling minimums aren't read: in the text layer they wrap across lines and can't be assigned to categories. With no
plate, the bug falls back to 200 ft above touchdown on an ILS and 400 ft on other approaches. `~` (or **Approach
plates** on the sortie screen) shows the loaded approach's chart: KDJT (the former KPBI) has all 12 approach plates
and the airport diagram. The charts and the nav data are public domain and **not for navigation**. Refresh them with:

```bash
python3 tools/fetch_cifp.py            # FAA CIFP -> data/nav (airports, runways, ILS, procedures, airways)
python3 tools/fetch_plates.py --cycle <cycle>
```

## Controls

| Action | Keyboard | Controller |
|---|---|---|
| Pitch and roll | Arrow keys or WASD, or drag the mouse. Down or S pulls. | Left stick |
| Rudder | Q / E | Right stick |
| Throttle | `-` / `=`, `0` for idle | R2 / L2, square for idle |
| Pitch trim | `,` nose-down, `.` nose-up | R1 / L1 |
| Autopilot off or on | X | Cross |
| Heading bug, altitude preselect, approach (APR) | `{` `}`, `<` `>`, `\` | |
| LNAV, VNAV | `(`, `)` | |
| Flight director, go-around (TOGA) | `\|`, `?` (or a bound button) | |
| Approach plates | `~` | |
| Spoilers, gear, flaps | B, G, F | Circle, D-pad |
| Brakes (free flight) | Hold Shift; toe brakes bind in the controls panel | D-pad left |
| Thrust reversers (on the ground) | `−` past idle, `=` to stow; or a bound button | L2 past idle |
| Camera | C, right-drag to orbit | Triangle |
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

[`js/ground.js`](js/ground.js) models three oleo struts (stiffness and damping set so each sits about a third into its
stroke), tyres with rolling and cornering friction, anti-skid brakes, and nosewheel steering that narrows from 45° at
taxi speed to 7° at takeoff speed. The geometry comes from the exterior model: the nose wheel carries 7.7 % of the
weight, and the tail and wingtips touch at 11.3° of pitch and 14.5° of bank. Touchdown follows Part 25: 10 ft/s is the
limit, more than 12 ft/s damages the gear, and about 16 ft/s collapses it. Ground effect cuts induced drag, adds lift
and pitches the nose down below one wingspan. Runways come from OpenStreetMap, are painted with FAA markings over a
1.25 m/px NAIP image of the airport, and the imagery-driven 3D houses are kept off the aerodrome.

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
  Dynamic resolution keeps the frame rate near 55 fps.

[`docs/visual_comparison.md`](docs/visual_comparison.md) compares it with MSFS 2024 and X-Plane 12, feature by feature.

## Validation

Run `node test/flight_test.mjs`, `node test/afm_validate.mjs` and `node test/performance_test.mjs` to reproduce these.
The performance test flies the AFM procedures: accelerate-go with an engine failure at V1, accelerate-stop, 115 % of
the all-engine distance, and the landing from 50 ft at VREF.

| Check | Model | Reference |
|---|---|---|
| Clean and flapped stall speeds, 2 weights | within 2 kt | AFM Fig 5-22 |
| Buffet onset lift vs Mach | rms error 0.019 | SAE 932534 flight test |
| Max g at the 20 certified VA points | 2.90 to 3.11 g | 3.0 g, EASA TCDS IM.A.212 |
| Max-continuous N1 | rms ~1.5% | AFM Fig 5-31, 5-32 |
| Single-engine climb gradient | rms 0.7% | AFM Fig 5-62, 5-65 |
| Time to climb, MTOW to FL410 | ~18 min | 18 to 18.5 min published |
| NBAA IFR range, 4 passengers | 2,455 nm | 2,405 nm published |
| Max level speed | 458 KTAS | 453 to 466 KTAS published |
| Takeoff field length, flaps 8, 15 cases (sea level 60 °F and 90 °F, 5,000 ft) | rms 4.1 %, all within 7 % | AFM Fig 5-38 |
| Landing distance from 50 ft, 6 cases | rms 1.3 %, all within 2.2 % | AFM Fig 5-74 |

`node test/force_test.mjs` flies the upset with a force-limited pilot following the AFM procedure. Starting the
recovery 2 seconds after the autopilot lets go saves the airplane in three of the four hypotheses (the trim runaway
breaks up). At 5 seconds it is marginal: the tail-stall case loses about 8,000 ft and the combined case, already
near its structural limit, can break the tail as the iced stabilizer stalls and re-attaches. From 8 to 12 seconds
on, the wing fails before the recovery takes hold.

## Real data

| Data | Source | Used for |
|---|---|---|
| `data/kamx_*` | KAMX NEXRAD Level II at 17:40, 17:45 and 17:51Z, gridded to 500 m | Clouds, cores, icing, updrafts, weather radar |
| `data/goes/` | GOES-19 ABI visible and infrared, parallax-corrected | Cloud-top height and deck thickness |
| `data/glm_flashes.json` | GOES-19 Geostationary Lightning Mapper, 17:44 to 17:52Z | Lightning times and positions |
| `data/metar.json`, `data/sounding_kmfl.json` | KPBI METARs, KMFL 12Z radiosonde | Cumulus layer, deck base, freezing level |
| `data/ground/` | USGS orthoimagery (NAIP), NASA Blue Marble, USGS NHD water | Terrain texture and water |
| `data/nav/` | FAA CIFP cycle 261029 (ARINC 424, public domain) | Airports, runways, ILS, SID / STAR / approach procedures, navaids, airways |
| KPBI boundary (in `js/ground.js`) | OpenStreetMap (ODbL) | Keeps imagery-driven houses off the airport |
| `data/plates/` | FAA d-TPP cycle 2611 (public domain) | Approach plates, airport diagram, straight-in minimums |
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
| `js/nav.js`, `js/afm.js` | ILS deviations for any ILS in the database; AFM takeoff speeds and VREF |
| `js/pfd.js` | Pro Line 4-style primary flight display |
| `js/ffb.js` | USB PID force-feedback driver over WebHID |
| `js/scenario.js` | Storm environment, ADS-B reconstruction, ATC timeline, flight guidance (AP / FD modes), hypotheses |
| `js/render.js`, `js/shaders.js` | WebGL2 renderer |
| `js/hud.js`, `js/cockpit.js`, `js/vcgauges.js` | Instruments, 3D cockpit, standby gauges |
| `test/` | Flight-test card, AFM table validation, upset, recovery, force, ground, performance, ILS, hardware and force-feedback checks |
| `tools/` | Data fetchers, model and livery converters, benchmark |

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
