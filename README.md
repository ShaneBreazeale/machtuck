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

- `js/aircraft.js` — 6-DOF Learjet 60 flight model (Mach tuck, buffet, ice, T-tail stall, structural limits)
- `js/scenario.js` — storm environment, ADS-B ghost reconstruction, ATC timeline, autopilot, hypotheses
- `js/render.js` — WebGL2 raymarcher + line program
- `js/hud.js` — PFD, system panel, profile chart, comm log
- `js/input.js`, `js/audio.js`, `js/main.js`
- `test/` — headless Node checks of the physics (`node test/sim_test.mjs`)

## Cockpit, systems, procedures

Pro Line 4-style panel: glareshield annunciators + flight-guidance strip, PFD, engine column (N1/ITT/N2/FF), MFD with
the weather radar, a clickable systems panel (wing/stab heat, nacelle heat, pitot/windshield heat, stall-warning cutout,
Mach trim, pitch-trim PRI/SEC/OFF, AP, YD, spoilers, gear, flaps) and the pedestal. The EFB tablet (TAB) shows a
north-up moving map with the KAMX composite, the reported track and your trail, or the procedure cards (1-6: upset
recovery, overspeed, ice-contaminated tailplane stall, runaway pitch trim, emergency descent, icing). Steps tick as you
do them and the sim recommends a card when it detects the condition. Wording is our own, not AFM text.

Modelled consequences: stick shaker/pusher (fires at low AOA with wing ice), Mach trim offsetting part of the tuck,
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
