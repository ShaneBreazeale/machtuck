# Architecture

The sim is a static site: `index.html`, `style.css`, the ES modules in `js/`, and the data files in `data/`. There is
no bundler, no package manager and no server code. The browser loads `js/main.js` as a module, and it imports
everything else. The same modules run under Node 22 for the headless tests in `test/`.

This page maps the modules, follows one frame through the main loop, and lists the conventions you need before you
change anything.

## Module map

The README's Development table, extended to every file in `js/`:

| File | Contents |
|---|---|
| `js/main.js` | Boot, game state `G`, the two modes, the main loop, event handling, sortie planner UI, debrief, persistence, the `SIM` debug global |
| `js/aircraft.js` | `Learjet60`: the 6-DOF flight model, structure, stabilizer trim (`STAB`), curved-Earth datum |
| `js/aero.js` | Aerodynamics from textbook methods: lift slope, drag build-up, critical Mach, wave drag, buffet |
| `js/engine.js` | PW305A two-stream cycle and the thrust-rating law (N1 limits, APR) |
| `js/atmo.js` | ISA with a temperature offset; the constants `FT`, `KT`, `G0`, `RHO0` |
| `js/controls.js` | `PilotControls`: column and wheel forces on the unboosted controls, pilot strength and stamina, autopilot clutches |
| `js/input.js` | `Input`: keyboard, mouse, touch and gamepad into smoothed control axes and discrete events |
| `js/hardware.js` | All connected flight hardware through the Gamepad API: binding, calibration, persistence (no DOM) |
| `js/hwui.js` | The controls and hardware binding panel (`/`) |
| `js/ffb.js` | `ForceFeedback`: USB PID force-feedback driver over WebHID |
| `js/ground.js` | Landing gear, tyres, brakes, steering, ground effect, airframe contact; runway list; `groundAlt` |
| `js/freeflight.js` | Free-flight starts, weather and weight presets, `FreeEnv`, the trim solver, `configureGuidance` |
| `js/navdb.js` | `NavDB`: the FAA CIFP database in `data/nav` with the NASR marker beacons attached to each ILS, the local projection (`LAT0`, `LON0`, `toNE`), procedure assembly |
| `js/fms.js` | `FMS`: the ARINC 424 leg engine (LNAV, VNAV, holds, direct to) |
| `js/route.js` | Route strings, MSFS `.pln` import, whole-plan assembly (SID, airways, STAR, approach, vectors to final) |
| `js/nav.js` | ILS deviations and marker beacon reception for any ILS in the database |
| `js/afm.js` | AFM takeoff speeds (Fig 5-42) and VREF (Fig 5-66) |
| `js/scenario.js` | The accident: storm, `NexradField`, ADS-B ghost track, ATC timeline, hypotheses, `Environment`, `Autopilot` (AP and FD modes), `RecoveryJudge` |
| `js/render.js` | `Renderer`: the WebGL2 HDR pipeline |
| `js/shaders.js` | GLSL for the renderer: atmosphere, clouds, ground, post-processing |
| `js/sun.js` | Solar position (NOAA low-precision ephemeris) for the scenario clock |
| `js/anim.js` | Keyframe helpers for the converted models (FS2004 MDL8 format) |
| `js/hud.js` | `HUD`: the 2D panel overlay, EFB tablet, profile chart, comm log |
| `js/pfd.js` | `drawPfd`: the Pro Line 4-style primary flight display, drawn into any box |
| `js/cockpit.js` | `Cockpit`: the 3D virtual cockpit, with live instruments mapped onto its panel |
| `js/vcgauges.js` | Standby and secondary gauges of the virtual cockpit, and the flight guidance panel |
| `js/panel.js` | The cockpit control layer: one registry for every clickable control, hover outline and tooltip, click sound and press flash, knobs |
| `js/cdu.js` | The FMS control display unit: pages, scratchpad and keys over the FMS of `js/fms.js` |
| `js/audio.js` | WebAudio: wind, engines, warnings, thunder, rain, voice callouts |
| `js/util.js` | Math: quaternions, matrices, `nedToWorld`, `clamp`, `lerp`, angle wrapping |

Outside `js/`:

| Path | Contents |
|---|---|
| `index.html`, `style.css` | The page: canvases, briefing screen, sortie planner, overlays |
| `data/` | Weather, imagery, nav data, plates and models. See [Data pipeline](data-pipeline.md) |
| `audio/atc_liveatc.mp3` | The optional ATC recording, off by default |
| `test/` | Headless Node checks. See [Testing](testing.md) |
| `tools/` | Data fetchers, model and livery converters, the frame-rate benchmark |
| `docs/` | The README screenshot and `docs/visual_comparison.md` |
| `wiki/` | This wiki. See [The wiki itself](#the-wiki-itself) |

## Data flow

```text
 keyboard / mouse / gamepads (Gamepad API) / force-feedback stick (WebHID)
          |
          v
   Input  (js/input.js, js/hardware.js, js/ffb.js)
          |  axes, thrust, trim, brakes, discrete events
          v
 frame(now)                                    js/main.js, requestAnimationFrame
   |-- handleEvents()      switches, AP / FD modes, camera, pause, restart
   |-- levers, trim, brakes, reversers from Input
   |-- stepSim(h) x sub    h = simDt / sub, never more than 1/240 s
   |      env.wind(pos, t, h)          Environment (accident) or FreeEnv (free flight)
   |      PilotControls.step           pilot force + AP servo -> elevator, aileron
   |      Learjet60.step(h)            aero, engine, ground contact
   |      env.iceRates                 wing, tail and engine ice
   |      Autopilot.step               -> FMS.update / FMS.vertical when a plan is loaded
   |      env.scriptedUpset            hypothesis events (accident only)
   |      log, FDR (4 Hz), ground events, freeTick (free), RecoveryJudge (accident)
   |
   |-- Renderer.render(S)              js/render.js + js/shaders.js (3D world, WebGL2)
   |-- Cockpit.update / render         js/cockpit.js (3D cockpit; panel textures from the HUD code)
   |-- HUD.draw(HS)                    js/hud.js + js/pfd.js (2D canvas overlay)
   '-- Audio.update, ForceFeedback.update, gamepad haptics
```

## The main loop

`js/main.js` ends by calling `requestAnimationFrame(frame)`. Each `frame(now)`:

1. Clamps the wall-clock step to 50 ms, so a stalled tab doesn't produce one huge step.
2. Calls `handleEvents()`, which drains `Input`'s discrete events (autopilot, gear, flaps, camera, pause, restart,
   heading bug, preselected altitude, LNAV, VNAV, direct to, approach, go-around and so on).
3. If the sim is running and not paused, reads the levers, trim and brakes from `Input`. Manual trim disconnects the
   autopilot, as the AFM says. There is no autothrottle, so thrust always comes from the pilot.
4. Scales the step by the sim rate (`G.timeScale`, 0.25 to 1), splits it into
   `sub = ceil(simDt / (1/240))` equal substeps, and calls `stepSim(h)` once per substep.
5. Builds the camera, the render state `S` and the instrument state `HS`, then draws: `R.render(S)`, the 3D cockpit
   when it is active, and `H.draw(HS)`.
6. Updates audio, gamepad haptics and the force-feedback stick.

The reconstruction mode (the ADS-B replay) runs `replayStep(dt)` instead of `stepSim`.

### One physics step

`stepSim(h)` runs in this order:

1. `env.wind(ac.pos, t, h)` gives the NED wind at the airplane.
2. `PilotControls.step` turns the player's input (a force, not a position) and the autopilot's servo command into
   elevator and aileron positions. See [Flight model](flight-model.md).
3. A trim runaway, if that hypothesis is active, drives the stabilizer toward the nose-down stop.
4. `Learjet60.step(h, { wind, dT })` integrates the airframe, including the engines and the ground model.
5. `env.iceRates` grows or sheds ice on the wing, tail and engines.
6. `Autopilot.step` computes its servo commands for the next step. With a flight plan it calls `FMS.update` for lateral
   guidance and `FMS.vertical` for the VNAV target. See [Autopilot and flight director](flight-guidance.md) and
   [FMS and navigation](fms.md).
7. Disconnect checks: tail stall, trim runaway, and on the ground in free flight. `env.scriptedUpset` applies the
   hypothesis events.
8. Bookkeeping: the clock, the ATC timeline (accident), history for the profile chart, the flight data recorder at
   4 Hz, the trail, structural failure, touchdown events, `freeTick` (free flight) and the `RecoveryJudge` (accident).

## Game state and modes

All mutable state lives in one object, `G`. It holds the airplane (`ac`), the environment (`env`), the autopilot (`ap`),
the clock, the phase (`run`, `replay` or `end`), the log, the FDR rows and the camera state.

| Function | Mode | What it builds |
|---|---|---|
| `newGame(hypKey, hard)` | `G.mode = 'accident'` | `Learjet60` trimmed at FL350 on the first ghost-track point, `Environment(hypKey, hard)` (the storm and the hypothesis), `Autopilot(hard)` |
| `newFreeFlight(o)` | `G.mode = 'free'` | Calls `newGame('combined', true)` for the shared state, then swaps in a new `Learjet60`, `FreeEnv(o.wx)`, `Autopilot`, an `FMS` loaded with the assembled plan, the AFM speeds and the minimums |

At load the page calls `newGame('combined')` and pauses behind the briefing screen. **Fly it** starts a new accident
run with the chosen hypothesis and difficulty. `#sortie` opens the sortie planner instead.

`Environment` (`js/scenario.js`) and `FreeEnv` (`js/freeflight.js`) share an interface: `wind()`, `iceRates()`,
`scriptedUpset()`, `dT`, `hyp`, the local conditions `L`, and the lightning fields. `FreeEnv` is calm or steady wind
with gusts, sheds any ice, and has an empty `scriptedUpset()`. That is why `stepSim` doesn't branch much on the mode.

The difficulty flag only changes the autopilot (its trim rate and the nose-down handover), never the airplane or the
storm. `test/aero_validate.mjs` checks that. See [Upset hypotheses and difficulty](hypotheses.md).

## Units and frames

| Quantity | Convention |
|---|---|
| Physics frame | NED: metres north, east, down. `ac.pos = [n, e, d]`, so altitude is `-d` |
| Body frame | x forward, y right, z down |
| Render world | x east, y up, z north, metres. `nedToWorld([n, e, d]) = [e, -d, n]` (`js/util.js`) |
| Cockpit and models | x right, y up, z forward, metres |
| Rotations | Quaternions `[w, x, y, z]`; 3x3 matrices row-major, body to NED |
| Internal units | SI. `FT = 0.3048` and `KT = 0.514444` (`js/atmo.js`); `NM = 1852` in the nav modules |
| Display units | Feet, knots, ft/min. The FMS takes altitudes in feet; the autopilot targets are in metres |

The origin is `LAT0 = 26.6832`, `LON0 = -80.0956` in `js/navdb.js`, the KPBI runway 10L/28R midpoint. Every dataset
uses the same projection, `toNE(lat, lon)`:

```js
north = (lat - LAT0) * 111320
east  = (lon - LON0) * 111320 * cos((lat + LAT0) / 2)
```

The tools in `tools/` use the same formula, so the radar, satellite, lightning, imagery, buildings, trees and nav
data all line up in one local grid.

### The curved-Earth datum

The ground surface is curved: `groundAlt(n, e) = (n² + e²) / 12720000` in `js/ground.js`, so its height grows with the
square of the distance from the origin. The renderer draws the same spherical surface.

Free flight sets `ac.curved = true`. Then altitude is measured above the curved surface, gravity acts along its local
vertical, and pitch and bank are reported against the local horizon. The altimeter, VSI, glideslopes and VNAV read the
same at Orlando, 230 km away, as at Palm Beach. The accident keeps the flat frame it was calibrated in. Across its
30 km box the difference is under 70 m.

## Rendering

Three pieces draw each frame:

- **`js/render.js` and `js/shaders.js`** draw the 3D world into the `gl` canvas: atmosphere, volumetric clouds from
  the radar and satellite data, ground imagery with buildings and trees, the exterior model, and post-processing.
  `R.render(S)` takes one state object per frame. See [Renderer](renderer.md).
- **`js/hud.js`** draws the 2D overlay into the `hud` canvas: the panel, the PFD (`js/pfd.js`), the engine column,
  weather radar, EFB tablet, comm log and debrief. It also does the click hit-tests for its switches.
- **`js/cockpit.js`** draws the 3D virtual cockpit into the `ck` canvas. Its live instruments are the HUD's own
  drawing code rendered into canvases and mapped onto the panel at the gauge positions of the original `panel.cfg`.
  Clicks are ray-cast onto those quads and handed to the HUD hit-tests. If the 3D cockpit fails to start, the sim
  falls back to the 2D panel.

## Persistence

Everything persistent is in `localStorage`:

| Key | Written by | Contents |
|---|---|---|
| `n722bd_fdr` | `js/main.js` | The last run's flight data recorder, saved every 5 s and at the end |
| `n722bd_sortie_v3` | `js/main.js` | The last sortie plan |
| `n722bd_atc_shift` | `js/main.js` | The ATC tape alignment offset, in seconds |
| `n722bd_hw_v1` | `js/hardware.js` | Hardware bindings and calibration, per device name |
| `n722bd_ffb_v1` | `js/ffb.js` | Force-feedback stick settings |

The debrief also exports the FDR as CSV.

## Debugging

`js/main.js` exposes a global for the browser console:

```js
SIM.G          // the live game state (getter)
SIM.R          // the Renderer
SIM.H, SIM.CK  // the HUD and the 3D cockpit
SIM.IN, SIM.FF // Input and ForceFeedback
SIM.ATC, SIM.SETTINGS, SIM.NEX
SIM.camOverride = { pos: [x, y, z], yaw, pitch, fov }   // free camera, world metres and degrees
```

Two URL hashes load the reconstruction paused at a time:

- `#view=t,cam,orbitYaw,orbitPitch` uses a sim camera (0 cockpit, 1 chase, 2 ground).
- `#shot=x,y,z,yaw,pitch,fov,nexrad,t` uses a free camera in metres from KPBI (x east, y up, z north).

`tools/bench.mjs` uses both to measure frame rate. See [Testing](testing.md#frame-rate-benchmark).

## The wiki itself

The wiki in `wiki/` follows the same no-build approach:

- `wiki/index.html` and `wiki/wiki.css` are the shell.
- `wiki/wiki.js` fetches `wiki/pages.json` for the sidebar, renders `wiki/pages/<slug>.md` in the browser, and builds
  the search index from the same files.
- Routes are `#/slug` and `#/slug/heading-id`. Links written as `other-page.md#id` read correctly on GitHub and are
  rewritten to routes.

See [Contributing](contributing.md#documentation) for how to edit it.
