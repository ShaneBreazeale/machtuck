# Sources and references

Every source on this page is cited somewhere in the repository: the README, a file header, a code comment, a fetch
script or a data file's metadata. Where a source backs a specific number, the code names it next to that number. See
[Contributing](contributing.md#principles) for why.

## The accident

From the README's "Sources and credits":

- The timeline comes from the **Flightradar24 blog**, a **BizJet Journal ADS-B Exchange analysis**, NEXRAD analyses
  by **MyRadar** and **LiveStormChasers**, **LiveATC** recordings, and the **NTSB briefing of 2 November 2026**.
- All figures are provisional. The cause is under NTSB investigation, and every upset scenario in the sim is a
  hypothesis, not a finding.

The optional ATC audio (`audio/atc_liveatc.mp3`) is a LiveATC recording as publicly posted. It is off by default.
See [The N722BD flight](accident.md) and [Real weather and ATC data](weather-data.md).

## Learjet 60 data

### Airplane Flight Manual

**Bombardier Learjet 60 AFM, FM-123 (Change 37).** The Section V performance data was transcribed, numbers only,
from the scan on archive.org into `test/afm_tables.json` and `js/afm.js`.

| Figure | Content | Used in |
|---|---|---|
| Fig 5-22 | Stall speeds | `js/aircraft.js`, `js/freeflight.js`, `test/flight_test.mjs` |
| Fig 5-24 | Buffet boundary and its FL400 worked example | `test/aero_validate.mjs`, `test/flight_test.mjs` |
| Fig 5-25 | Takeoff N1 (corrected N1 93.3 %) | `js/engine.js` |
| Fig 5-31, 5-32 | Max-continuous N1, all engines and single engine | `js/engine.js`, `test/afm_validate.mjs` |
| Fig 5-38 | Takeoff field length, flaps 8 | `test/performance_test.mjs` |
| Fig 5-42 | Takeoff speeds V1, VR, V2, flaps 8 | `js/afm.js` |
| Fig 5-62, 5-65 | Single-engine final-segment and enroute climb gradients | `test/afm_validate.mjs`, `test/afm_tables.json` |
| Fig 5-66 | VREF, flaps 40 | `js/afm.js` |
| Fig 5-74 | Landing distance from 50 ft | `js/ground.js`, `test/performance_test.mjs` |

Also cited from the AFM: the Vmo/Mmo schedule (Section I), the +3.0 / −1.0 g limit load, the Pitch Axis Malfunction
warning that a nose-down overspeed can need more than 75 lb to recover (the control-force calibration in
`js/controls.js`), the Overspeed Recovery procedure, whose order the EFB upset-recovery cards follow, and the stall-warning system
(no stick pusher).

### Certification and design

| Source | Used for |
|---|---|
| **EASA Type Certificate Data Sheet IM.A.212** (Issue 04) | The certified airspeed-limits chart: 20 maneuvering-speed (VA) points over four weights, which give maximum lift versus Mach |
| **SAE 932534**, Chandrasekharan et al. 1993, "Aerodynamic Tailoring of the Learjet Model 60 Wing" | The Model 60 wing, its root glove and tip fairing, and the flight-test buffet onset |
| **Gates Learjet wing patents US 4,240,597 and US 4,050,651** | Wing sweep, dihedral, taper and NACA 64A-109 sections |
| **Bombardier** published figures | Wing area, span and length; the NBAA IFR range of 2,405 nm, as quoted by Wikipedia and SmartCockpit (`test/mission.mjs`) |
| **FlightSafety Learjet 60 PTM** | Ch. 7: takeoff flat rating and APR thrust; ch. 15: stabilizer travel. Bypass ratio at takeoff |
| **Karanjia and Harvey, "Optimization Studies for the PW305 Turbofan", AIAA 90-2520** (1990) | The PW305A design cycle the engine model is anchored to |
| **2017 sales listing for N722BD** (aircraft.com) | The livery description, "overall white with gold and brown stripes" (`tools/livery.py`) |

### Regulations and guidance

- **FAA AC 25.1329-1C**:
  https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_25_1329-1C.pdf. The autopilot and flight director
  modes, mode annunciation, armed modes and the heading-knob behaviour follow it. See
  [Autopilot and flight director](flight-guidance.md).
- **14 CFR Part 25**, as cited in the code:
  - 25.143: pilot control-force levels (`js/controls.js`).
  - 25.335: design dive speed and maneuvering speed (`js/aircraft.js`).
  - 25.349: rolling pull-out loads (`js/aircraft.js`).
  - 25.473 and 25.723: limit descent velocity and reserve energy at touchdown (`js/ground.js`).
  - 25.629: flutter margin to 1.15 VD (`js/aircraft.js`).
  - 25.779: direction of motion of cockpit controls (the heading knob).

## Methods

The aerodynamics, ground model and renderer cite these methods and authors:

| Source | Used for |
|---|---|
| Raymer (eqs. 12.5, 12.6, 12.48 to 12.50, 12.61) | Skin-friction drag build-up, lift-curve slope, Oswald efficiency, fuselage upsweep drag |
| DATCOM and the Helmbold formula | Swept-wing lift-curve slope |
| Torenbeek | Fuselage wetted area; windmilling drag (`test/afm_validate.mjs`) |
| Pearcey | Shock-induced separation at a local Mach of about 1.3, for buffet onset |
| Korn equation and Lock's fourth-power law (after Mason and Raymer) | Drag-divergence Mach and wave drag |
| Karman-Tsien rule | Compressibility on the section pressure model |
| McCormick | Ground effect |
| Bruneton and Hillaire (Hillaire 2020) | Precomputed atmosphere transmittance and multiple-scattering tables, the sky-view mapping |
| ACES filmic tone map | The final tone map |
| NOAA low-precision solar ephemeris | The sun's position for the scenario clock (`js/sun.js`) |

## Weather and environment data

All are fetched by scripts in `tools/`. See [Data pipeline](data-pipeline.md).

| Data | Source | Terms |
|---|---|---|
| Radar | **NOAA NEXRAD Level II**, KAMX (Miami), 17:40, 17:45 and 17:51Z, gridded by `tools/grid_nexrad.py` | Public domain |
| Satellite clouds | **NOAA GOES-19 ABI L1b CONUS radiances** (ABI-L1b-RadC), from the `noaa-goes19` open-data bucket; navigation per the GOES-R Product User's Guide vol. 3 sec. 4.2.8 | Public domain |
| Lightning | **NOAA GOES-19 GLM L2 LCFA**, from the same bucket | Public domain |
| Surface observations | **Iowa Environmental Mesonet ASOS archive** of NWS/FAA METARs: https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py | Public domain |
| Sounding | **Iowa Environmental Mesonet RAOB JSON service**, redistributing NWS/NCEI upper-air data: the KMFL 12Z radiosonde | Public domain |
| Imagery | **USGS The National Map** `USGSImageryOnly` (NAIP orthoimagery) | Public domain |
| Imagery fill | **NASA Blue Marble: Next Generation** via NASA GIBS | Public domain |
| Water | **USGS National Hydrography Dataset** and **Natural Earth** 1:10m | Public domain |
| Buildings | **Overture Maps** buildings (OpenStreetMap + Microsoft ML Buildings), https://overturemaps.org | ODbL 1.0 |
| Trees | **Meta and World Resources Institute, High Resolution Canopy Height Maps** (Tolan et al. 2024), on AWS Open Data; tree extraction after vibevoga's `tools/chm_tree_points.py` | CC BY 4.0 |
| KPBI aerodrome boundary | **OpenStreetMap** (in `js/ground.js`) | ODbL |

## Navigation data

| Data | Source | Terms |
|---|---|---|
| Procedures, runways, ILS, navaids, airways | **FAA CIFP** (ARINC 424-18), cycle 261029: https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_261029.zip | Public domain, not for navigation |
| Approach plates, airport diagram, minimums | **FAA d-TPP**, cycle 2611: https://aeronav.faa.gov/d-tpp/2611/ | Public domain, not for navigation |

Flight-plan import reads **MSFS** `.pln` files and the **SimBrief** API (`https://www.simbrief.com/api/xml.fetcher.php`),
only when you ask. See [IFR routes](routes.md).

## Models

The aircraft and cockpit models are the **FSX Bombardier Learjet 60 by Premier Aircraft Design** (Jean-Pierre
Brisard, Barry Blaisdell, Bob May and Kevin Pardy), model `lear60_ver25.mdl` with textures from the `N838` livery.
They were converted by `tools/fs9_ext.py` and `tools/fs9_vc.py`; see `data/vc/README.md` and `data/ext/README.md`.
The live instruments drawn over the cockpit panel are the sim's own; the model's gauges are not used. The N722BD
livery is an approximation made by `tools/livery.py`.

`docs/visual_comparison.md` compares the renderer with MSFS 2024 and X-Plane 12, feature by feature.

## License

From the README. Third-party data keeps its own terms:

- USGS and NASA imagery and NOAA weather data are public domain.
- The Overture buildings are © OpenStreetMap contributors and Microsoft, under ODbL 1.0.
- The canopy height data is by Meta and the World Resources Institute, under CC BY 4.0.

The repository does not include a license file for its own code yet.
