# N722BD — Learjet 60 convective upset simulator

Browser flight simulator that recreates the 1 November 2026 Learjet 60 (N722BD) upset at FL350
over western Palm Beach County and lets you attempt the recovery. Pure WebGL2 + ES modules, no build.

## Run

```bash
cd machtuck
python3 -m http.server 8080
# open http://localhost:8080
```

Needs a WebGL2 browser. Rendering is a single raymarched fragment shader (sky, Florida coast, storm cell,
SDF Learjet) so a discrete GPU or Apple Silicon is recommended; press `K` to cycle quality.

## Structure

- `js/aircraft.js` — 6-DOF Learjet 60 flight model (Mach tuck, buffet, ice, T-tail stall, structural limits, AFM limits)
- `js/aero.js` — aerodynamics from textbook methods: component drag build-up, DATCOM lift slope, sweep theory +
  section pressure model for critical Mach, wave drag, buffet onset and the Mach loss of CLmax
- `js/engine.js` — PW305A two-stream cycle with turbomachinery similarity and the thrust-rating (N1) law
- `js/scenario.js` — storm environment, ADS-B ghost reconstruction, ATC timeline, autopilot, hypotheses
- `js/render.js` — WebGL2 raymarcher + line program
- `js/hud.js` — PFD, system panel, profile chart, comm log
- `js/input.js`, `js/audio.js`, `js/main.js`
- `test/` — headless Node checks: `sim_test.mjs` (upset scenario), `stab_test.mjs`, `flight_test.mjs` (flight-test
  card), `afm_validate.mjs` (model vs ~1,860 cells of AFM tables in `afm_tables.json`)

## Flight model validation

Geometry and limits come from the Learjet 60 AFM (FM-123; limitations, performance tables, scale three-view), the
Gates Learjet wing patents (US 4,240,597; US 4,050,651) and SAE 932534 (Chandrasekharan et al. 1993, *Aerodynamic
Tailoring of the Learjet Model 60 Wing*). Engine cycle anchored at the PW305 design point in AIAA 90-2520 (Karanjia &
Harvey 1990: fan 30.75 in, FPR 1.811, BPR 4.3, OPR 23.7, 2105 F, mixed exhaust); size from the published takeoff
rating (4,600 lbf, flat to 23.3 C) at the AFM takeoff N1. Current agreement (`node test/flight_test.mjs`,
`node test/afm_validate.mjs`):

- Stall speeds, 4 flap settings x 2 weights: within 2 kt of AFM Fig 5-22
- Buffet onset vs Model 60 flight test (SAE 932534 Fig 19): rms dCL 0.019
- Max-continuous N1 vs AFM Fig 5-31/5-32: rms ~1.5% N1
- Single-engine climb gradients (AFM Fig 5-62, 5-65): mean -0.2% of weight, rms 0.7% (about -1% at 40-45k ft)
- Time to climb MTOW to FL410 on the AFM schedule (250 KIAS to FL320, M0.70): 16.9 min from 1,500 ft, ~18 min from
  brake release vs 18-18.5 published
- NBAA IFR range, 4 pax, 100 nm alternate (`node test/mission.mjs`): 2,455 nm vs 2,405 nm spec (+2%); cruise fuel flow
  ~1,250 lb/h at FL410 M0.76; max level speed 458 KTAS (published max cruise 453-466 KTAS). Wave drag: Korn + Lock, kA 0.87

## Cockpit, systems, procedures

3D cockpit from the left seat (`js/cockpit.js`): procedural glareshield, windshield frame, panel, pedestal, yokes, thrust levers
and rudder pedals that follow the controls, lit by the sun and dimmed in cloud; the instruments are drawn onto the panel
screens and stay clickable. Right-drag looks around, the mouse wheel zooms. The exterior cameras (C) keep the 2D instruments.


Pro Line 4-style panel: glareshield annunciators + flight-guidance strip, PFD, engine column (N1/ITT/N2/FF), MFD with
the weather radar, a clickable systems panel (wing/stab heat, nacelle heat, pitot/windshield heat, stall-warning cutout,
Mach trim, pitch-trim PRI/SEC/OFF, AP, YD, spoilers, gear, flaps) and the pedestal. The EFB tablet (TAB) shows a
north-up moving map with the KAMX composite, the reported track and your trail, or the procedure cards (1-6: upset
recovery, overspeed, ice-contaminated tailplane stall, runaway pitch trim, emergency descent, icing). Steps tick as you
do them and the sim recommends a card when it detects the condition. Wording is our own, not AFM text.

Modelled consequences: stick shaker on a clean-wing AOA schedule (no pusher on the type; with wing ice the wing can stall before the shaker), Mach trim offsetting part of the tuck,
trim selector OFF stopping a runaway, gear 260 / flaps 200-150 KIAS limits, bleed-air wing heat weak at idle,
SLD in the core overwhelming stab heat, inlet ice reducing thrust with nacelle heat off. No autothrottle (as on the type).

## Real data in the sim

- `data/kamx_*.bin/json` — KAMX NEXRAD Level II volumes (17:40:32Z, 17:45:48Z, 17:51:04Z) gridded to 500 m voxels
  around KPBI by `tools/grid_nexrad.py` (MetPy). The shader samples them as 3D textures (time-blended), the
  environment derives cloud/core/icing/updraft from reflectivity and its growth, and the cockpit weather radar
  draws them. `U` toggles back to the synthetic cell. Regrid: `python tools/grid_nexrad.py <Level2 file> data/kamx_HHMMSS`
  (files from `s3://unidata-nexrad-level2/2026/11/01/KAMX/`).
- `audio/atc_liveatc.mp3` — Miami Center audio as posted publicly (LiveATC recording). Off by default; the clip is edited, so
  playback is piecewise-synced to the clock from its captions (`ATC.map` in `js/main.js`). It contains the crew's final transmissions. Listener discretion.
- `localStorage['n722bd_fdr']` — flight data recorder of the last run (4 Hz); CSV export in the debrief.

## Sources

Flightradar24 blog, BizJet Journal ADS-B Exchange analysis, MyRadar / LiveStormChasers NEXRAD (KAMX)
analyses, LiveATC recordings as reported, NTSB 2 Nov 2026 briefing. All figures provisional; cause undetermined.
