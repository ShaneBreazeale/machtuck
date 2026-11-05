# Rendering and weather: comparison with commercial flight simulators

Reference points are the two current desktop simulators, Microsoft Flight Simulator 2024 (MSFS) and X-Plane 12 (XP12).
Their entries come from public descriptions, not from side-by-side testing; sources are listed at the end. The machtuck
column describes this repository (`js/render.js`, `js/shaders.js`, `tools/fetch_*.py`).

| Area | MSFS 2024 | X-Plane 12 | machtuck |
|---|---|---|---|
| Sky / atmosphere | Physically based sky | Photometric HDR lighting, physically based | Precomputed transmittance + multiple-scattering LUTs, sky-view LUT, spherical Earth, cloud-shadowed aerial perspective |
| Clouds | Volumetric | Volumetric, rebuilt for v12 | Volumetric raymarch, Perlin-Worley erosion, sun light-march + 220 km cloud-shadow map, multi-scatter octaves, diffuse transmission under the deck |
| Weather source | Meteoblue gridded forecast model blended with airport observations; users report "METAR bubbles" and storms missing on radar | Real-world data converted by proprietary algorithms | Observations at the event time: KAMX NEXRAD Level II volumes (storm cores, rain), GOES-19 ABI cloud tops and reflectance (deck top/thickness), KPBI METAR (bases), KMFL sounding (freezing level) |
| Lightning | Users report thunderstorms without lightning, and lightning in clear skies | Not described in the sources found | GOES-19 GLM flashes at their real times and positions; in-cloud illumination, cloud-to-ground channels, thunder |
| Precipitation | Rain effects | Rain effects | Streaks from radar reflectivity at the aircraft, rain vs ice from the sounding freezing level; wet ground under radar rain |
| Ground | Photogrammetry in selected cities, aerial imagery + autogen from building footprints elsewhere | Orthoimagery optional, autogen | USGS NAIP imagery (3.9 m/px at the site); over the impact area 62k real building footprints with measured heights (Overture: OSM + Microsoft ML Buildings) and 512k individual trees at measured positions, heights and crown widths (Meta/WRI 1 m canopy height map), palms, pines and two broadleaf forms by crown-shape proxy, GPU-instanced; 1.22 m/px imagery around the impact point; colour-classified houses and trees beyond |
| Aircraft | PBR models | PBR models | PAD Learjet 60 exterior, PBR-style shading, 4x MSAA at full resolution, animated surfaces, N722BD livery (approximate stripes) |
| Anti-aliasing / upscaling | TAA, DLSS/FSR | TAA, FSR | TAA upsampling with dynamic resolution |
| Post | Bloom, eye adaptation, lens effects | HDR tonemapping | Bloom, eye adaptation, ACES, sun glare and lens ghosts |

Where machtuck is ahead: the weather. The commercial simulators synthesise weather from forecast models and airport
reports; this simulator rebuilds one specific storm from the radar volumes, the satellite scans and the lightning
detections of the minutes it happened.

Where it is behind: breadth and asset depth. It covers a ~300 km region around one event; buildings are extruded real
footprints at measured heights (the same inputs as MSFS autogen) rather than modelled or photogrammetric buildings;
trees stand where the canopy map has them with measured crowns, but four generic forms (rounded and spreading broadleaf, slash pine, palm) chosen from the measured shape rather than modelled species; there
is no night lighting (the event is at midday), no 3D airport models and no AI traffic.

Measured frame rate (`node tools/bench.mjs 2560x1320`, Apple Silicon, headless Chrome) is in the README.

## Sources

- MSFS 2024 live weather: [SimTuts guide](https://simtuts.com/guides/msfs-2024-live-weather-guide);
  [forum comparison of live weather accuracy](https://forums.flightsimulator.com/t/live-weather-how-accurate-is-it-in-msfs-2024-a-comparison/686675);
  [heavy rain cells not displayed (AVSIM)](https://www.avsim.com/forums/topic/697727-msfs2024-heavy-rain-cells-are-not-displayed-with-live-wx-on/);
  [thunder in clear skies bug report](https://forums.flightsimulator.com/t/bug-thunder-in-clear-skies-and-sudden-unrealistic-weather-shifts-msfs-2024/732203).
- X-Plane 12 features: [Steam store page](https://store.steampowered.com/app/2014780/X); [Aerosoft product page](https://www.aerosoft.com/en/shop/x-plane/x-plane-12/3901/x-plane-12-early-access).
- These are third-party guides, forum reports and retailer pages, not vendor documentation; the commercial products change with updates.
