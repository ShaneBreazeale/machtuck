# Testing

The physics, guidance, navigation and hardware code is plain ES modules with no DOM dependency, so it runs headless
under Node. The test suite is a folder of standalone scripts in `test/`. There is no test runner and nothing to
install: each file imports the real modules from `js/` and flies or exercises them.

## Running the suites

Use Node 22. From the repository root:

```bash
for t in test/*.mjs; do node "$t" || echo "FAILED: $t"; done
```

Or run one file at a time, for example `node test/fms_test.mjs`.

The whole suite takes about 20 seconds. The slowest files are `recovery_test.mjs` (about 7 s),
`force_test.mjs` (about 4 s), `flight_test.mjs` (about 3 s) and `performance_test.mjs` (about 2 s); the rest finish
in a second or less.

> **Note:** Not every file can fail. The checks print what they measured, and the ones with pass/fail expectations
> exit non-zero when one is missed. `afm_validate.mjs`, `flight_test.mjs`, `mission.mjs`, `sim_test.mjs` and
> `stab_test.mjs` are reports: read their output against the reference values they print.

Run the suite before you open a pull request. See [Contributing](contributing.md).

## What each file checks

| File | Checks | Fails on error |
|---|---|---|
| `test/aero_validate.mjs` | Aerodynamics against what the AFM publishes: the Fig 5-24 buffet-boundary worked example, the FL350 buffet envelope and its sensitivity, Mach-tuck trim gradient against the Mach limits, and that both difficulty modes fly identical trajectories | Yes |
| `test/afm_validate.mjs` | Max-continuous N1 against Fig 5-31, and the single-engine final-segment climb gradient against Fig 5-62, from the tables in `test/afm_tables.json` | Report |
| `test/ffb_test.mjs` | The WebHID force-feedback driver (`js/ffb.js`) against two simulated USB PID sticks, parsed the way Chromium does, plus the force-feedback side of `js/controls.js` | Yes |
| `test/flight_test.mjs` | The flight-test card, in calm air: stall speeds (Fig 5-22), buffet onset (Fig 5-24 and SAE 932534), max g at the 20 VA points (EASA TCDS), cruise thrust and fuel flow, max level speed, time to climb, and the handling modes (short period, phugoid, Dutch roll, roll, spiral) | Report |
| `test/fms_test.mjs` | The FMS on the FAA CIFP: KDJT ILS 10L via GULLO, LNAV and VNAV to the localizer and glideslope, a go-around at 200 ft, the published missed approach and the MORGA hold, hold entries, VNAV against the preselected altitude | Yes |
| `test/force_test.mjs` | Control forces (`js/controls.js`): calibration against the AFM figure, normal handling, pilot fatigue, the autopilot's clutched servos, and the as-flown upset recovered by an AFM-procedure pilot with and without force limits | Yes |
| `test/ground_test.mjs` | Ground model and free-flight setup: struts at rest, takeoff and rotation, tail strike, braking, nosewheel steering, Part 25 touchdown limits, gear-up landing, ground effect, the trim solver | Yes |
| `test/hardware_test.mjs` | Flight hardware input (`js/hardware.js`) with simulated devices: hat decoding, calibration, binding by moving or pressing, several devices at once, absolute throttle, defaults, persistence | Yes |
| `test/mission.mjs` | The NBAA IFR range mission flown on the model's drag and engine, against the published 2,405 nm | Report |
| `test/nav_test.mjs` | ILS deviations (`js/nav.js`) and the flight-guidance modes: signs and scaling, altitude capture, a coupled ILS 10L to 200 ft, the heading knob, FD go-around and missed approach, FD takeoff mode, an early go-around, the 28R missed approach | Yes |
| `test/performance_test.mjs` | Takeoff field length (Fig 5-38) and landing distance (Fig 5-74), flown the way the AFM measured them: accelerate-go, accelerate-stop, 115 % of all-engine, landing from 50 ft at VREF | Yes |
| `test/recovery_test.mjs` | The pass/fail judge: an early takeover that only holds level flight must not count as a recovery. Flies the as-flown scenario with three pilots and compares the old rule with `RecoveryJudge` | Yes |
| `test/route_test.mjs` | IFR routes (`js/route.js`): route-string parsing, MSFS `.pln` import, plan assembly, and a whole flight from KDJT 10L via TBIRD8, CHEFS and MUNGI1 to the ILS 18R at KMCO | Yes |
| `test/sim_test.mjs` | The ADS-B ghost track, and the combined hypothesis flown with several simple pilots in both difficulty modes | Report |
| `test/stab_test.mjs` | Open-loop stability: trimmed cruise with a 5° roll perturbation and no autopilot; expects slow spiral and Dutch roll, no departure | Report |

`test/afm_tables.json` is data, not a test: AFM FM-123 (Change 37) Section V tables transcribed from the scan on
archive.org, used by `afm_validate.mjs` and `performance_test.mjs`.

The navigation tests (`fms_test.mjs`, `nav_test.mjs`, `route_test.mjs`) read the real `data/nav/` files, and
`fms_test.mjs` also reads `data/plates/plates.json`. A new CIFP cycle can change their results, so rerun them after
[updating the data](data-pipeline.md#navigation).

## Environment variables

| Variable | File | Effect |
|---|---|---|
| `MODE=trainer` | `force_test.mjs`, `recovery_test.mjs` | Fly the trainer's autopilot (slower auto-trim, no nose-down handover trim). The airplane is the same |
| `AERO_STRICT=1` | `aero_validate.mjs` | Make the known buffet-boundary bias fail the suite instead of only being reported |
| `HYP=combined,tail,tuck,trim` | `recovery_test.mjs` | Run only the listed hypotheses |
| `SEEDS=1,2,3,4,5` | `recovery_test.mjs` | Random seeds for turbulence, gusts and lightning, one run per seed |
| `DBG` | `recovery_test.mjs`, `fms_test.mjs` | Print a trace while flying (`recovery_test.mjs` takes an interval in seconds) |
| `TRACE` | `flight_test.mjs` | Print the trim and climb traces |
| `LDBG` | `performance_test.mjs` | Print the landing roll second by second |
| `NOMAIN` | `performance_test.mjs` | Skip the main run, so the file can be imported for its `takeoff` and `landing` functions |
| `CHROME` | `tools/bench.mjs` | Path to the Chrome binary |

For example:

```bash
MODE=trainer node test/force_test.mjs
AERO_STRICT=1 node test/aero_validate.mjs
HYP=tail SEEDS=1 node test/recovery_test.mjs
```

## Determinism

The physics is deterministic in calm air. The storm's turbulence, gusts and lightning use `Math.random`, so the
tests that fly through it seed the generator per run to make each case reproducible. `aero_validate.mjs` relies on
that to check that both difficulty modes, given the same seed and inputs, fly identical trajectories.

## Frame-rate benchmark

`tools/bench.mjs` measures the renderer's real-time frame rate in headless Chrome. Serve the repository first, then
pass the window size and the port:

```bash
python3 -m http.server 8080
node tools/bench.mjs 2560x1320 8080
```

Without arguments it uses 1280x660 and port 8787. It loads six fixed views through the debug hashes (chase and
cockpit views at `#view=...`, free cameras at `#shot=...`), waits 9 seconds for the data, exposure and dynamic
resolution to settle, counts frames for 4 seconds, and prints the fps with the raymarch and output resolutions:

```text
chase, graupel at core entry        <fps> fps   scene <WxH>   output <WxH>
```

It launches Chrome with `--headless=new`, `--use-angle=metal`, the GPU blocklist ignored and the frame-rate limit
and vsync disabled. The default Chrome path is the macOS one; set `CHROME=/path/to/chrome` elsewhere.

## Headless browser checks

The rendering, the HUD and the page wiring need a browser. `tools/bench.mjs` shows the pattern for scripting one:

1. Serve the repository with any static server, for example `python3 -m http.server 8080`.
2. Start Chrome headless with `--remote-debugging-port` (bench uses 9333) and a fresh `--user-data-dir`.
3. Read `http://127.0.0.1:<port>/json/list`, open the page target's WebSocket, and drive it with DevTools protocol
   commands: `Page.navigate` to a URL with a debug hash, then `Runtime.evaluate` to read state through the `SIM`
   global (for example `SIM.G`, `SIM.R`).

> **Tip:** ES modules are cached hard by the browser. When a script reloads the page after you change code, send
> `Network.setCacheDisabled` with `{ cacheDisabled: true }` first (after `Network.enable`), or you may be testing
> the old modules.

The debug hashes and the `SIM` global are described in [Architecture](architecture.md#debugging).
