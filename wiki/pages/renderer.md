# Renderer

The renderer is plain WebGL2 in two files: `js/render.js` runs the passes and loads the data, and `js/shaders.js`
holds the GLSL. It is a physically based HDR pipeline. Most of the scene (sky, clouds, ground, ray-traced houses and
trees) is one full-screen raymarch at reduced resolution. The aircraft and the real buildings and trees are meshes
drawn in a separate full-resolution pass.

It needs `EXT_color_buffer_float` for its HDR targets, and stops with an error without it.

## Frame structure

At start-up the renderer bakes the static tables: atmosphere transmittance and multiple scattering, and tileable 3D
cloud noise. Each frame then runs these passes:

1. **Sky-view LUT.** The sky's radiance as seen from the camera altitude.
2. **Cloud-shadow map.** Optical depth along the sun ray for each ground column.
3. **Scene raymarch** (HDR, jittered, reduced resolution): ground imagery, aerial perspective, volumetric clouds, the
   imagery-driven 3D houses and trees, and the signed-distance-field Learjet.
4. **Temporal anti-aliasing** and upsampling to the output resolution.
5. **Mesh pass** at output resolution with 4× MSAA: the exterior aircraft, the real buildings and the real trees.
6. **Lightning channel**, drawn into the HDR image so bloom gives it a glow.
7. **Bloom chain**, **eye adaptation** and an **ACES tonemap** to the canvas, with sun glare and lens ghosts.
8. **Precipitation streaks** and the ghost-track and trail lines, over the tonemapped image.

World units are metres: x east, y up, z north, with the origin at KPBI. The atmosphere functions use kilometres in a
planet-centred frame.

## Atmosphere and sun

The atmosphere follows Bruneton and Hillaire: precomputed transmittance and multiple-scattering LUTs on a spherical
planet, a per-frame sky-view LUT that packs resolution around the horizon (Hillaire 2020), and per-pixel aerial
perspective. The aerial perspective is shadowed by the clouds, which gives god rays under the storm.

The sun comes from `js/sun.js`, the NOAA low-precision solar ephemeris (about 0.01° over 1950 to 2050), for the
scenario clock.

## Clouds and weather

The clouds are a volumetric raymarch out to 220 km. Baked tileable Perlin-Worley and Worley noise erodes them, and a
sun light-march, multiple-scattering octaves, a dual-lobe phase function, sky and ground ambient, and lightning light
them. In the accident, real data shapes the cloud field (see [Real weather and ATC data](weather-data.md)):

- **Low cumulus layer** from the KPBI METAR, Nubis-style: a soft base field eroded by Worley detail and sharpened for
  crisp edges.
- **The storm deck** from the METAR overcast base up to the GOES-19 cloud-top height, with its thickness taken from the
  visible reflectance, and an anvil blown downwind at the top.
- **Convective cores and rain shafts** from the KAMX NEXRAD reflectivity. Two gridded volumes are loaded as 3D
  textures and blended in time. Echo is cut above the satellite cloud top, because of the radar beam spread.

The **cloud-shadow map** covers 220 km at 1,024 texels. It moves with the camera, re-centres in full only after the
camera has moved 25 km, and otherwise refreshes a quarter per frame.

**Precipitation** streaks around the camera follow the NEXRAD reflectivity at the aircraft. Above the KMFL freezing
level (4,780 m) they fall slowly, as snow or graupel. The ground is darker and partly specular under radar-indicated
rain.

In free flight there is no storm, radar volume or satellite deck, only the chosen weather's cumulus.

### Lightning

The GOES-19 Geostationary Lightning Mapper flashes (`data/glm_flashes.json`) play at their real times and positions,
each as 2 to 4 return strokes over its duration, within 70 km of the airplane. Brightness falls with distance. The
flash position drives the in-cloud illumination, and lights the ground, the clouds and the aircraft. About 35 % of
flashes also draw a cloud-to-ground channel: a midpoint-displaced polyline with branches, from the cloud base to the
ground.

## Ground

The ground is USGS imagery draped on the world's curved surface, with a procedural coast where there is no imagery.
`tools/fetch_imagery.py` resamples the USGS National Map orthoimagery tiles (NAIP at large scales) into the local grid,
fills the gaps offshore and over the Bahamas with NASA Blue Marble, and builds water masks from USGS NHD and Natural
Earth. The layers in `data/ground`:

| Layer | Coverage | Resolution |
|---|---|---|
| `far.jpg` | 600 km square | 293 m/px |
| `near.jpg` | 120 km square | 29 m/px |
| `site.jpg` | 16 × 16 km over the impact area | 3.9 m/px |
| `detail.jpg` | 5 km square around the impact point | 1.22 m/px |
| `airport.jpg` | 5.1 km square around KPBI | 1.25 m/px |

One high-resolution patch is bound at a time: the crash site in the accident, KPBI in free flight. Water has
wind-driven wave normals, a Fresnel sky reflection, and a microfacet sun glint.

### Imagery-driven houses and trees

Close to the ground, the aerial photo itself becomes 3D. A GPU pass classifies 16 m cells from the photo's colour into
a 512 × 512 cell map (8.2 km) around the camera:

- dark green canopy becomes a tree (trunk and a three-lobe canopy);
- light, low-saturation or terracotta roofs in built-up areas become houses (4 to 9 m, stucco walls, hip roofs,
  occasionally taller with a flat roof);
- anything else stays flat.

The cell map is generated below 2,200 m and re-centred after the camera moves 2 km. The scene ray-traces it below
1,800 m within 6 km, and colours each roof and canopy from the photo. Inside the KPBI airport boundary (OpenStreetMap)
nothing is generated, because runway concrete and aprons would read as roofs.

### Real buildings and trees

Over the impact area (east −20 to −4 km, north −16 to 0 km from KPBI) the buildings and trees are measured, not
guessed.

**Buildings.** `tools/fetch_buildings.py` takes Overture Maps footprints (OpenStreetMap plus Microsoft ML Buildings):
62,192 buildings, 52,501 with measured heights, into `data/ground/buildings.bin`. `js/render.js` extrudes them into
walls with hip roofs (57,144 of them) or ear-clipped flat roofs, in one static mesh. Roof colour comes from the aerial
photo at the roof. Once they load, the colour-guessed houses in that area are dropped.

**Trees.** `tools/fetch_canopy_trees.py` finds individual trees in the Meta/WRI 1 m canopy height map: local maxima,
thinned tallest-first, with crown radii measured along eight rays. That gives 511,964 trees (median height 9 m, 95th
percentile 16 m) in `data/ground/trees.bin`. Trees on building footprints are dropped. Each is a GPU instance of a unit
mesh scaled by its height and crown, in one of four forms chosen from its measured shape: palm, slash pine (tall with a
narrow crown), and a rounded or spreading broadleaf. Full trees are drawn within 600 m and simple blobs to 2.5 km, in
200 m buckets refreshed when the camera moves 40 m. The palm class is a proxy from crown size, not a survey.

Both are drawn in the full-resolution MSAA pass, lit, hazed and fogged like the rest of the scene.

## Runways

The shader paints three runways at a time: the three nearest the camera, re-chosen whenever the camera moves 500 m.
The nav database (`data/nav/runways.json`, from the FAA CIFP) has every runway in range. Each runway is painted from
the start of its pavement over its whole length, displaced thresholds included, with FAA AC 150/5340-1 precision
markings:

- asphalt, edge stripes and a dashed centreline;
- threshold bars;
- touchdown-zone bars at 500, 1,500, 2,000, 2,500 and 3,000 ft;
- aiming-point bars at 1,020 ft.

The markings blur with distance and grazing angle. See [Ground handling](ground.md#runways) for the runway data.

## The aircraft and cockpit

The aircraft and cockpit models are the FSX Bombardier Learjet 60 by Premier Aircraft Design (Jean-Pierre Brisard,
Barry Blaisdell, Bob May and Kevin Pardy), model `lear60_ver25.mdl` with the textures of its N838 livery.

- **Exterior.** `tools/fs9_ext.py` converts the model's MDL8 bytecode into `data/ext`: 21,916 vertices, 23,972
  triangles, 110 batches and 66 animated nodes. The gear, flaps, spoilers, reversers, ailerons, elevator and rudder
  move with the controls, and the beacon flashes. `tools/livery.py` repaints the textures in an approximate N722BD
  livery. The mesh is drawn within 25 km in the 4× MSAA HDR pass, lit by the scene's sun through the cloud-shadow map,
  with sky ambient and reflections, and fogged by a short cloud march to the camera.
- **Signed-distance-field Learjet.** The scene raymarch also has an SDF Learjet. It draws the ADS-B ghost track and
  stands in for the exterior when the mesh hasn't loaded, and can lose its stabilizer after a breakup.
- **Virtual cockpit.** `tools/fs9_vc.py` converts the model's virtual cockpit into `data/vc`. `js/cockpit.js` draws
  the panel, glareshield, yokes, pedestal, seats and glass, and drives its yokes, pedals and levers from the controls.
  The instruments are the sim's own (`js/hud.js`, `js/vcgauges.js`, `js/pfd.js`), drawn into canvases mapped onto the
  panel. The model's own gauges are not used. See [Cockpit and instruments](instruments.md).

`data/ext/README.md` and `data/vc/README.md` describe the file formats, frames and animated parts.

## Post-processing

- **Temporal AA and upsampling.** The scene is jittered over a 16-frame Halton sequence. TAA reprojects the history
  with the previous camera (and the aircraft's own motion for its pixels), clips it to the current neighbourhood in
  YCoCg, and blends in tonemapped space.
- **Bloom.** A 13-tap downsample (Jimenez 2014) with a Karis average on the first level, then a tent upsample, over
  six levels.
- **Eye adaptation** from the average log luminance of the smallest bloom level.
- **Tonemap.** ACES filmic, plus sun glare and lens ghosts when the sun disc itself is unoccluded.

## Quality and dynamic resolution

The scene raymarch runs at a fraction of the window resolution, and TAA upsamples it. `K` cycles three quality
levels:

| Quality | Scene scale | Cloud steps |
|---|---|---|
| 0.6 | 0.4 | 90 |
| 1.0 (default) | 0.5 | 150 |
| 1.4 | 0.75 | 210 |

Quality also sets the cloud step length and the number of aerial-perspective samples.

Dynamic resolution multiplies the scene scale by a factor from 0.45 to 1. Every 0.75 s it compares the smoothed frame
rate with a 55 fps target: below 92 % of the target it drops by 0.1, and above 135 % it rises by 0.1. The output canvas
is capped at 1.5× device pixel ratio.

## Performance

`tools/bench.mjs` measures the real-time frame rate in headless Chrome (GPU through ANGLE and Metal on macOS) over the
DevTools protocol. Serve the repository, then run:

```bash
python3 -m http.server 8080
node tools/bench.mjs 2560x1320 8080
```

It loads six debug views, lets exposure, TAA and dynamic resolution settle for 9 s, counts frames for 4 s, and prints
the fps with the scene and output resolutions. Without arguments it uses 1280x660 and port 8787. `CHROME=` overrides
the browser path.

Measured on 2026-11-04 on an Apple M4, 2560x1320 window, default quality:

| View | fps |
|---|---|
| Chase, graupel at core entry | 46 |
| Chase, breakout under the deck | 30.2 |
| Cockpit, final dive | 20.7 |
| Above the anvil, 17.5 km | 51.5 |
| Under the storm base | 25.4 |
| Greenacres from 300 m | 28.8 |

Every view ran with the scene at 576 × 277 against a 2560 × 1233 output, so dynamic resolution was at its 0.45 floor
and none of these views reached the 55 fps target. Other test runs shared the machine during the measurement.

## Known issue: curvature sign

The world's ground surface is `groundAlt = (n² + e²) / 12.72e6` metres (`js/ground.js`; `groundY` and `altOf` in
`js/shaders.js`). 12.72e6 m is twice the Earth's radius, so it has the right size for the Earth's curvature, but the
wrong sign. The ground curves **upward** with distance from Palm Beach, like a bowl, where the Earth curves down.

| Distance from KPBI | Ground height in the renderer |
|---|---|
| 30 km | +71 m |
| 100 km | +786 m |
| 230 km (Orlando) | +4,159 m |

The flight model, ground model and trim solver all use the same surface, so they agree with each other, and free flight
measures altitude above it (see [Flight model](flight-model.md#curved-earth-datum-in-free-flight)). The effect is
visual: at long range the distant ground rises, and the horizon looks slightly raised instead of dipping below eye
level. Inside the accident's 30 km box the difference is under 70 m.

## Comparison with commercial simulators

`docs/visual_comparison.md` compares the renderer and weather with Microsoft Flight Simulator 2024 and X-Plane 12,
feature by feature, from public descriptions. Its summary: the weather is ahead, because it rebuilds one specific storm
from the radar, satellite and lightning data of the minutes it happened. Breadth and asset depth are behind: about
300 km around one event, extruded footprints rather than modelled buildings, four generic tree forms, no night
lighting, no 3D airport models and no AI traffic.
