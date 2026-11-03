# N722BD — Learjet 60 convective upset simulator

Browser flight simulator that recreates the 1 November 2026 Learjet 60 (N722BD) upset at FL350
over western Palm Beach County and lets you attempt the recovery. Pure WebGL2 + ES modules, no build.

## Run

```bash
cd machtuck
python3 -m http.server 8080
# open http://localhost:8080
```

Needs a WebGL2 browser with `EXT_color_buffer_float` (all current desktop browsers). A discrete GPU or Apple Silicon is
recommended; press `K` to cycle quality (scene resolution and cloud steps).

## Rendering

`js/render.js` + `js/shaders.js`, HDR and physically based throughout:

- **Atmosphere**: precomputed transmittance and multiple-scattering LUTs (Bruneton/Hillaire), a per-frame sky-view LUT,
  spherical Earth, per-pixel aerial perspective that is shadowed by the clouds (god rays, dark air under the storm).
  Sun position from a solar ephemeris for the scenario clock (`js/sun.js`: 47° elevation, azimuth 195° at 12:47 EST).
- **Clouds**: volumetric raymarch shaped by real data (below), eroded with GPU-baked tileable Perlin-Worley / Worley
  noise, lit by a sun light-march plus a 1024² cloud-shadow map, multiple-scattering octaves, dual-lobe phase, and a
  diffuse-transmission model for light under and inside the deck.
- **Ground**: USGS orthoimagery (30 m around Palm Beach, 4 m over the impact area, 290 m to 300 km out) on a spherical
  Earth, water from a mask with wind-driven waves, Fresnel sky reflection and sun glint, cloud shadows. Below 1.8 km the
  photo also drives 3D detail: each 16 m cell's colour makes it a hip-roofed house (roof colour from the photo) or a tree
  (trunk + lobed canopy placed on the photo's own canopy), generated into a GPU cell map around the camera and ray-traced
  out to 6 km.
  Over the impact area (16 x 16 km around Greenacres) nothing is guessed: 62,192 real building footprints with measured
  heights (Overture Maps: OpenStreetMap + Microsoft ML Buildings, `tools/fetch_buildings.py`), extruded with hip roofs
  for houses and flat roofs otherwise, roof colours from the aerial photo; and 511,964 individual trees at their
  measured positions, heights and crown widths from Meta/WRI's 1 m canopy height map (`tools/fetch_canopy_trees.py`, the
  method of vibevoga's `chm_tree_points.py`), GPU-instanced in two LODs. Forms follow the measured shape (proxies, not a survey): narrow-crowned 6-24 m tops as
  palms (~9,300), tall (>= 15 m) narrow crowns as slash pines, the rest as rounded or spreading broadleaf crowns. Around the reconstructed impact point a 2.4 m USGS image
  (`detail.jpg`, z16) sharpens the ground for the replay ground camera. Both are drawn at full resolution with 4x MSAA.
- **Aircraft**: the textured exterior of the PAD Learjet 60 (`data/ext`, `tools/fs9_ext.py`) with live ailerons,
  elevator, rudder, flaps, spoilers and gear, a flashing beacon, N722BD in white with gold and brown stripes (`tools/livery.py`:
  colours from a 2017 sales listing for the aircraft; the stripe layout is the model's own cheat line, so approximate), drawn at full resolution with 4x MSAA and shaded with the same
  lighting as the clouds, fogged by the cloud between it and the camera.
- **Weather effects**: rain / ice streaks from the radar reflectivity at the aircraft, lightning from GLM with
  in-cloud illumination and cloud-to-ground channels.
- **Comparison** with MSFS 2024 and X-Plane 12, feature by feature with sources: `docs/visual_comparison.md`.
- **Performance**: dynamic resolution (the raymarch drops to as little as 45% of its normal resolution when the frame
  rate falls under ~50 fps; TAA upsamples), optical-depth-adaptive cloud steps. `node tools/bench.mjs 2560x1320` measures
  real-time fps in headless Chrome; on a loaded Apple Silicon Mac the six benchmark views ran at roughly 38-104 fps at that size across repeated runs, 51-106 fps in the latest run with the real buildings, trees and palms (heaviest: low over Greenacres and the breakout under the deck).
- **Post**: temporal anti-aliasing/upsampling, bloom, sun glare and lens ghosts (only when the sun disk is unoccluded),
  eye adaptation (snaps on camera cuts), ACES filmic tonemap. Wet, darker ground under radar-indicated rain.

Debug: `#view=t,cam,orbitYaw,orbitPitch` starts the reconstruction paused at `t` with a sim camera (0 cockpit, 1 chase, 2 ground);
`#shot=x,y,z,yaw,pitch,fov,nex,t` starts the reconstruction paused at `t` with a free camera (world metres from
KPBI, x east, y up, z north); `SIM.R.dbg = {cloudCover: 0.3}` overrides render inputs from the console.

## Structure

- `js/aircraft.js` — 6-DOF Learjet 60 flight model (Mach tuck, buffet, ice, T-tail stall, Part 25 structural limits, AFM limits)
- `js/aero.js` — aerodynamics from textbook methods: component drag build-up, DATCOM lift slope, sweep theory +
  section pressure model for critical Mach, wave drag, buffet onset and the Mach loss of CLmax
- `js/engine.js` — PW305A two-stream cycle with turbomachinery similarity and the thrust-rating (N1) law
- `js/scenario.js` — storm environment, ADS-B ghost reconstruction, ATC timeline, autopilot, hypotheses
- `js/render.js`, `js/shaders.js` — WebGL2 renderer (see Rendering); `js/sun.js` solar ephemeris; `js/anim.js` model keyframe helpers
- `js/hud.js` — PFD, system panel, profile chart, comm log
- `js/cockpit.js`, `js/vcgauges.js` — 3D virtual cockpit and its standby gauges; `tools/fs9_vc.py` / `tools/fs9_ext.py` convert the FS2004 model's cockpit / exterior
- `js/input.js`, `js/audio.js`, `js/main.js`
- `test/` — headless Node checks: `sim_test.mjs` (upset scenario), `stab_test.mjs`, `flight_test.mjs` (flight-test
  card), `afm_validate.mjs` (model vs ~1,860 cells of AFM tables in `afm_tables.json`), `recovery_test.mjs` (pass/fail judgement: no credit for an early takeover
  without an upset, seeded turbulence), `force_test.mjs` (control forces, AFM calibration, reaction-delay sweep)

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

## Control forces

The Learjet 60's ailerons and elevator are unboosted (cables and push-rods), so `js/controls.js` treats your input as
the force on the column and wheel: the surface goes where that force balances its hinge moment, which grows with
dynamic pressure and in the transonic range. Calibrated to AFM FM-123 (Pitch Axis Malfunction: a nose-down trim runaway
or nose-down overspeed "can ... require control forces in excess of 75 pounds for recovery"): holding full nose-down
trim at Vmo takes ~100 lb. A pilot holds ~60 lb, bursts to ~150 lb and tires in ~10 s (gauge: COLUMN FORCE). The
stabilizer trims as a whole, so nose-up trim is how you take the load off. The autopilot's clutched servos can be
overpowered, but it stays engaged and keeps trimming against you until you disconnect it (X) or use manual trim. Ice on
the stabilizer makes the column go light and pulse (AFM). Spoilers pitch the nose down above Vmo/Mmo and gear gives a
nose-up moment; the upset card follows the AFM order (idle, AP off, identify attitude, wings level, elevator + nose-up
trim, gear down if extreme, no spoilers).

Structure (`aircraft.js`): Vmo/Mmo is an operating limit, not a structural one. Up to the design dive speed VD/MD
(25.335(b); not in the AFM or EASA TCDS: VD 377 KIAS / MD 0.89, an unsourced figure that matches the Part 25 margins) speed alone does no damage; strength follows the AFM
limit load (+3.0 / -1.0 g), yielding past ~1.2x and failing at the 1.5x ultimate; beyond VD/MD the allowable load
shrinks; past the 25.629 flutter margin (1.15 VD, or well past MD) failure is rapid; rolling pull-outs above Vmo get
~2/3 of the symmetric limit (25.349). In the sim's breakups the killer is negative g (about -2 g, twice the limit) from
the tail stall, trim runaway or downdraft at M 0.91-0.96, not the overspeed by itself. N722BD is serial 60-271 (2004);
its AFM limits pages are the "60-249 & Subsequent" set, with the same primary-instrument Vmo/Mmo (330 KIAS / M 0.81 at altitude).

`node test/force_test.mjs` checks the calibration and flies the as-flown upset with a force-limited AFM-procedure pilot.
Starting the recovery 2 s after the autopilot lets go saves the airplane in three of the four hypotheses; at 5 s it costs
~6,000 ft; at 8-12 s the column forces outlast the pilot and the dive ends in breakup.

## Cockpit, systems, procedures

3D cockpit from the left seat (`js/cockpit.js`): the textured virtual cockpit of the Premier Aircraft Design Learjet 60
(panel, glareshield, yokes, pedestal, seats, side consoles, window glass; `data/vc/`, see its README for credits).
The model's own animations drive the yokes (pitch and roll), rudder pedals, thrust, flap and spoiler levers from our controls.
Our live instruments are mapped onto the panel at the gauge positions of the original panel.cfg: PFDs with HSI rose, MFDs with the
weather radar, engine column, glareshield annunciators + flight-guidance strip, master warning/caution, standby attitude,
airspeed and altimeter, RMI, clocks, gear lights and lever, trim, flap/spoiler indicators, fuel quantity, the whiskey compass,
the systems switch panel and an EFB on the left. Everything is clickable where the 2D panel was. Right-drag looks around, the
mouse wheel zooms. The exterior cameras (C) keep the 2D instruments, as does the cockpit until `data/vc/` has loaded.

Regenerate the cockpit assets from the FS2004 model (`tools/fs9_vc.py` decodes the MDL8 BGL bytecode and DXT textures):
`python3 tools/fs9_vc.py "<PAD_Learjet 60_FSX>/model/lear60_ver25.mdl" "<PAD_Learjet 60_FSX>/texture.N838" data/vc`


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
- `data/goes/` — GOES-19 ABI CONUS scans at 17:47:52Z and 17:52:52Z (KPBI rows): 0.64 µm reflectance and 10.3 µm
  brightness temperature, cloud-top height from the KMFL sounding, parallax-corrected (`tools/fetch_goes.py`). Sets the
  top of the cloud deck (12.9 km median, ~15 km over the storm) and its thickness.
- `data/glm_flashes.json` — GOES-19 GLM flashes within 80 km, 17:44-17:52Z (`tools/fetch_glm.py`): the lightning you
  see and hear is played at the real flash times and positions.
- `data/metar.json`, `data/sounding_kmfl.json` — KPBI METARs (17:53Z: 08016G28KT 10SM -RA SCT026 SCT050 OVC060) set
  the cumulus layer and the deck base; KMFL 12Z radiosonde: freezing level 4,780 m (rain vs. ice streaks).
- `data/ground/` — USGS The National Map orthoimagery (NAIP), NASA Blue Marble fill offshore, water from USGS NHD and
  Natural Earth (`tools/fetch_imagery.py`). All public domain. `buildings.bin`: Overture Maps buildings, © OpenStreetMap
  contributors and Microsoft, ODbL 1.0. `trees.bin`: tree tops from High Resolution Canopy Height Maps by Meta and
  World Resources Institute (Tolan et al. 2024), CC BY 4.0.
- `localStorage['n722bd_fdr']` — flight data recorder of the last run (4 Hz); CSV export in the debrief.

## Sources

Flightradar24 blog, BizJet Journal ADS-B Exchange analysis, MyRadar / LiveStormChasers NEXRAD (KAMX)
analyses, LiveATC recordings as reported, NTSB 2 Nov 2026 briefing. All figures provisional; cause undetermined.
