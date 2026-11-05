# FAQ

Short answers to the questions that come up most. Each one links to the page with the full story.

## Running the sim

### Why is there nothing to install?

The sim is plain WebGL2 and ES modules with no build step. The browser loads `index.html`, the modules in `js/` and
the files in `data/` straight from the server. The [live site](https://shanebreazeale.github.io/machtuck/) is
GitHub Pages serving the repository as it is.

To run your own copy, clone it and serve it with any static file server:

```bash
git clone https://github.com/ShaneBreazeale/machtuck.git
cd machtuck
python3 -m http.server 8080
```

Then open http://localhost:8080. The page fetches its data files, so serve it over HTTP rather than opening
`index.html` as a file. See [Getting started](getting-started.md).

### Which browsers work?

Any browser with WebGL2 and the `EXT_color_buffer_float` extension, which every current desktop browser has. The
renderer needs that extension for its HDR targets and stops with an error without it. A discrete GPU or Apple Silicon
is recommended.

Hardware support differs by browser:

| Feature | Browsers |
|---|---|
| The sim itself | Current desktop browsers with WebGL2 |
| Yokes, sticks, pedals, quadrants, gamepads (Gamepad API) | Chrome and Firefox |
| Force-feedback stick (WebHID) | Chrome and Edge, on a secure context (HTTPS or localhost) |

### How do I get a better frame rate?

- Press `K` to cycle the render quality. Each step trades image quality for frame rate.
- Dynamic resolution already adjusts the internal render resolution to keep the frame rate near 55 fps.
- To measure, run `node tools/bench.mjs` against a local server. See [Testing](testing.md#frame-rate-benchmark).

More on what the renderer does per frame is in [Renderer](renderer.md).

### Can I speed up time?

No. `[` and `]` change the sim rate between quarter speed and real time. Faster than real time isn't offered.

## The accident

### Is this what happened to N722BD?

No. Nobody knows yet. The cause of the accident is undetermined, and every upset scenario in the sim is a hypothesis,
not a finding. The timeline comes from public reporting (Flightradar24, an ADS-B Exchange analysis, NEXRAD analyses,
LiveATC and the NTSB briefing of 2 November 2026), and all of those figures are provisional.

The four hypotheses are a combined convective-core case, an ice-contaminated tailplane stall, Mach tuck with a failed
Mach trim, and a runaway nose-down trim. See [The N722BD flight](accident.md) and
[Upset hypotheses and difficulty](hypotheses.md).

### Why is the airplane so hard to recover?

Because the Learjet 60's elevator and ailerons have no hydraulic boost, and the sim models that:

- Your input is a force on the column, not a surface position. At high speed full deflection can take more than you
  can hold. A pilot holds about 60 lb, bursts to about 150 lb, and tires within about 10 seconds.
- The AFM warns that a nose-down overspeed can need more than 75 lb to recover. Nose-up trim is how you take the load
  off.
- The autopilot's servos can be overpowered, but it stays engaged and keeps trimming against you until you
  disconnect it (`X`).
- The iced tail can stall, and the pitch-down loads the wing past its ultimate load within seconds.

The headless force test shows how much the timing matters. Starting the AFM recovery 2 seconds after the autopilot
lets go saves the airplane in three of the four hypotheses. At 5 seconds it is marginal, and from 8 to 12 seconds on
the wing fails first. The help screen (`H`) has the AFM upset-recovery card. See [Flight model](flight-model.md) and
[Validation](validation.md).

### Does trainer mode make the airplane easier?

No. Both modes fly the same airplane through the same storm. Trainer mode only gives the autopilot a gentler
auto-trim and doesn't hand the airplane over trimmed nose-down. A test checks that both modes produce identical
trajectories for the same inputs. See [Upset hypotheses and difficulty](hypotheses.md).

### Why is the ATC audio off?

The optional ATC audio is a LiveATC recording as it was publicly posted, and it contains the crew's final
transmissions. The game doesn't reproduce those transmissions, so the recording stays off unless you choose it. Tick
the box on the briefing screen, or press `T` in flight. The posted clip was edited, so the sim maps it onto the clock;
`;` and `'` nudge the alignment by a second and the offset is saved in the browser. See
[Real weather and ATC data](weather-data.md).

## Free flight

### Why is there no autothrottle?

The Learjet 60 doesn't have one, so speed stays yours. The thrust levers always come from you, even with the autopilot
and VNAV engaged. In a VNAV climb you set climb thrust and the pitch holds the speed. See
[Autopilot and flight director](flight-guidance.md).

### Why do only KDJT plates show as images?

Rendering every chart at the 72 airports (376 of them) would add about 64 MB to the repository each cycle, so only
KDJT's 12 approach plates and diagram ship as images. Everywhere else `~` lists the airport's plates with a link to the
FAA PDF for the cycle.

The minimums are read from every plate anyway (CIFP has the procedures but not their minimums): 312 of the 329
approach plates give them. Where a plate gives none, RNAV (GPS) approaches use the FAA master RNAV list (dated 2019)
and the rest fall back to 200 ft above touchdown on an ILS with a glideslope and 400 ft on other approaches. See
[Approaches and minimums](approaches.md) and [Data pipeline](data-pipeline.md#plates-and-minimums).

### Why KDJT and not KPBI?

Palm Beach International now has the FAA identifier KDJT. The FAA data from these cycles uses KDJT, and the sim's
accident scenario keeps the KPBI name it was built with. They are the same airport.

### Can I fly outside 160 nm?

The nav database holds the 72 airports with instrument procedures within 160 nm of Palm Beach, plus navaids,
waypoints and airways out to 260 nm. A fix or airport outside that set is reported as "not in the nav database" by the
planner.

You can rebuild the database with a larger radius:

```bash
python3 tools/fetch_cifp.py --radius 250
```

The ground imagery covers 300 km each way from Palm Beach. See [Data pipeline](data-pipeline.md#navigation).

### The SimBrief import doesn't work

**Fetch** sends one request from your browser to SimBrief's public API for the latest plan of the username you
typed. Nothing goes to SimBrief until you click it. If the request fails, the planner shows `SimBrief:` followed by the
error. Common causes are a mistyped username, no recent plan on that account, or the browser or a network filter
blocking the cross-origin request.

Two alternatives always work offline: **Import** an MSFS `.pln` file, or type the route string, for example
`TBIRD8 CHEFS MUNGI1`. See [IFR routes](routes.md).

### Some of my route didn't load

The planner lists anything it couldn't find. The usual reasons are a fix outside the nav database (see above) or a
procedure name the airport doesn't publish. SIDs and STARs can be written with or without their version digit, and
FAA-style with a transition (`TBIRD.MATLK`). See [IFR routes](routes.md).

## Controls and hardware

### My yoke or joystick isn't detected

- Press one of its buttons. Browsers expose a device only after a button press or an axis move.
- Use Chrome or Firefox for the Gamepad API.
- Open the controls panel (`/`) to see every connected device live, and bind each function by moving or pressing the
  control. An unbound yoke or stick flies on its X and Y axes; pedals and quadrants do nothing until bound.
- Bindings are saved per device name in the browser, so a device keeps its setup in any USB port.

See [Hardware and force feedback](hardware.md).

### My force-feedback stick isn't detected

Force feedback uses WebHID, which only Chrome and Edge support, and only on a secure context: the live HTTPS site or
`localhost`. Open the controls panel (`/`), choose **Connect force-feedback stick**, and pick the stick in the
browser's prompt. The driver reads the layout from the stick's HID descriptor, so no per-model profile is needed. It
has been tested only against simulated sticks, so start with low strength. See
[Hardware and force feedback](hardware.md).

### Keys don't work while I'm typing in a box

That's by design. While the focus is in a text box, list or form field (the DIRECT TO box, the route field, the
SimBrief username), keystrokes go to the box and not to the airplane, so typing a fix name doesn't lower the gear.
Press Enter or Escape to close the DIRECT TO box, or click the cockpit view to give it the focus again. See
[Controls](controls.md).

### Where are my settings and flight data stored?

In your browser's `localStorage`: the last sortie plan, the hardware bindings, the force-feedback settings, the ATC
alignment and the last run's flight data recorder. The debrief can export the recorder as CSV. None of it is
sent anywhere. See [Architecture](architecture.md#persistence).

## Contributing

### Can I add an airport, a procedure or a fix by hand?

No. Navigation is generic and data-driven: everything comes from the FAA CIFP through one engine, and nothing is
hand-coded for an airport or a scenario. If something flies wrong, fix the engine and add a test. See
[Contributing](contributing.md).
