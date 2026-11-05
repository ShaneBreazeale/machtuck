# Real weather and ATC data

The storm in the accident mode is not invented. It is built from the public weather records for those minutes: the
KAMX NEXRAD radar, the GOES-19 satellite and its lightning mapper, the Palm Beach METARs and the Miami radiosonde. This
page explains where each dataset comes from, how the sim uses it, and how the optional LiveATC audio is synchronised.

For refreshing the data, see [Data pipeline](data-pipeline.md). For the reported flight itself, see
[The N722BD flight](accident.md).

## The datasets

| Data | Source | Fetched by | Used for |
|---|---|---|---|
| `data/kamx_*.bin`, `data/kamx_*.json` | KAMX NEXRAD Level II, gridded to 500 m | `tools/grid_nexrad.py` | Clouds, cores, icing, updrafts, precipitation, weather radar, tablet map |
| `data/goes/` | GOES-19 ABI visible and infrared, parallax-corrected | `tools/fetch_goes.py` | Cloud-top height and deck thickness in the renderer |
| `data/glm_flashes.json` | GOES-19 Geostationary Lightning Mapper, 17:44 to 17:52Z | `tools/fetch_glm.py` | Lightning times, positions and brightness |
| `data/metar.json` | KPBI METARs, 16:30 to 18:30Z | `tools/fetch_metar.py` | Low cumulus layer and deck base; free-flight METAR wind |
| `data/sounding_kmfl.json` | KMFL 12Z radiosonde | `tools/fetch_sounding.py` | Freezing level, cloud-top height lookup for GOES |
| `audio/atc_liveatc.mp3` | LiveATC recording, as publicly posted | (included) | Optional ATC audio, off by default |

All the NOAA weather data is public domain. Every grid uses the same local projection, with its origin at the KPBI
runway 10L/28R midpoint, so the radar, satellite and lightning all line up with the ground imagery.

Times in the data are UTC. The sim clock is EST: 12:47:00 EST is 17:47:00Z and sim time t = 0.

## NEXRAD radar volumes

### Gridding

`tools/grid_nexrad.py` reads a KAMX Level II file with MetPy and resamples its reflectivity sweeps onto a Cartesian
grid around KPBI:

- **Extent:** 50 km west to 30 km east, 45 km south to 40 km north, 0 to 16 km up.
- **Voxels:** 500 m, giving 160 × 32 × 170 cells.
- **Beam geometry:** a 4/3-Earth model converts each voxel to a slant range and elevation from the radar.
  Reflectivity is interpolated between adjacent sweeps in elevation, and taken from the nearest gate in azimuth and
  range. Voxels below the lowest sweep or above the highest are left empty.
- **Encoding:** one byte per voxel, `(dBZ + 10) × 4`, with 0 meaning no echo. The `.json` file next to each `.bin`
  holds the grid metadata and the volume time.

The tool also prints the 30 dBZ top over the storm column, a quick check against the published radar analyses.

### Which volumes the sim uses

`NEXRAD_VOLUMES` in `js/scenario.js` loads two volumes and blends them linearly in time:

| Volume | UTC | Sim time | Clock (EST) |
|---|---|---|---|
| `data/kamx_174548` | 17:45:48 | t = −72 s | 12:45:48 |
| `data/kamx_175104` | 17:51:04 | t = +244 s | 12:51:04 |

> **Note:** A third gridded volume, `data/kamx_174032` (17:40:32Z), is in the repository, and the README lists a
> 17:40 volume, but the current code doesn't load it.

### From reflectivity to air

`Environment.local()` in `js/scenario.js` turns the blended reflectivity at your position into the storm's state:

- **Cloud** where the echo rises from about 3 to 16 dBZ.
- **Core** where it rises from about 22 to 42 dBZ, boosted where the echo is growing between the two volumes.
- **Updraft** in the core, from an analytic cell (`STORM`) with a peak of 18 m/s, a downdraft ring just outside it,
  and an extra few metres per second up where the echo grows between volumes, or down where it decays.
- **Scripted pulses.** On top of the real echoes, a short updraft from about 12:48:04 to 12:48:16 and a downdraft
  pulse just after 12:48:16 reproduce the reported climb and the start of the descent. Each hypothesis scales all
  this vertical air with its `shear` factor (see [Upset hypotheses](hypotheses.md#what-each-switch-does)).
- **Turbulence** that is moderate in cloud and severe in the core and the downdraft ring. Severe turbulence also
  persists from about 12:48:10 to about 12:49:05, because the reported track stays in and under the cell's downshear
  after it leaves the core. The gusts are a sum of sines plus a random walk, scaled by the local intensity.
- **A stratiform deck** from 6,400 to 10,400 m (about 21,000 to 34,000 ft) around the cell, and thinner cloud
  outside it.

The analytic cell sits at the radar-placed storm centre, about 9.5 miles west and 2 miles north of the airport. It
drifts slowly to the north-west, and its top grows at about 1,500 ft a minute from 39,000 ft at 12:47.

### Icing

Ice builds where there is cloud and faster in the core (`Environment.iceRates()`), scaled by the hypothesis's
`iceGain`:

- **Wing heat** uses engine bleed air, so it is weak at low N1.
- **Stab heat** is electric. The supercooled large drops in the core overwhelm it: it trims the tail accretion there
  but doesn't stop it. Out of cloud it clears the tail quickly.
- **Nacelle heat** keeps the engine inlets clear. Without it they ice in cloud.

### Weather radar and tablet map

The cockpit weather radar samples the same blended volume. It shows the strongest echo in a height band around your
altitude across a 120° sector ahead. `O` toggles the radar, and `J` cycles the range through 40, 80 and 20 nm. Its
label reads `KAMX` when the real volume is on. With real weather off it paints the modelled cell instead (about
52 dBZ at the core) and reads `SYNTH`.

The tablet map (`Tab`) draws a composite of each volume, the strongest echo in each column, in bands from 10 to
50+ dBZ. It switches from the first volume to the second halfway between their times.

The rain and snow around the camera also follow the reflectivity at the airplane. Above the KMFL freezing level
(4,780 m) the precipitation falls slowly, like snow or graupel. Below it, it falls as rain.

## GOES-19 cloud tops

`tools/fetch_goes.py` builds two cloud fields from the GOES-19 ABI CONUS scans nearest 17:46Z and 17:51Z:

- **Band C02** (0.64 µm, visible) gives the reflectance.
- **Band C13** (10.3 µm, infrared) gives the brightness temperature. The tool turns it into a cloud-top height by
  finding where the KMFL sounding reaches that temperature. Colder than the tropopause, it extrapolates upward as an
  overshooting top.
- **Parallax correction.** GOES-19 is at 75.2° W, so from Palm Beach a 13 km cloud top appears about 8 km north of
  where it really is. For each pixel the tool searches heights from 0 to 18 km for the one that matches the infrared
  height along the line of sight. Ground hidden behind tall cloud is filled from the nearest consistent pixel.
- **Output.** A 1,024 × 1,024 RGBA image over ±150 km, holding reflectance, cloud-top height, brightness
  temperature and a cloud mask, plus `data/goes/goes.json`.

`data/goes/goes.json` estimates when each scan imaged Palm Beach: 17:47:52Z (t = 52.6 s) and 17:52:52Z (t = 352.5 s).
Over the storm centre, both scans give a cloud top of about 14.9 km and a brightness temperature near 204 K. The
renderer blends the two scans by time (see [Renderer](renderer.md)).

## GLM lightning

`tools/fetch_glm.py` reads the GLM Level 2 flash files from 17:44:00Z to 17:52:00Z and keeps the flashes within 80 km
of KPBI. Each flash is re-navigated from the GLM's built-in lightning ellipsoid to a 12 km cloud top along the
satellite's line of sight. The file holds 44 flashes. Its summary counts 19 within 20 km of the storm, between 1 and 4
a minute.

The storm environment replays them at their recorded times:

- Each flash within 70 km plays as 2 to 4 return strokes over its duration.
- The brightness falls with distance, and the flash position lights the cloud from inside.
- About a third of the flashes also draw a cloud-to-ground bolt.

With real weather off, or if the file doesn't load, the sim uses modelled flashes instead: random, and more frequent
in the core.

## METAR and sounding

`tools/fetch_metar.py` downloads the surface reports from the Iowa Environmental Mesonet for Palm Beach and five
nearby airports. Palm Beach International now reports as KDJT; the sim keeps the KPBI label. The nearest routine
report is (remarks omitted):

```
KDJT 011753Z 08016G28KT 10SM -RA SCT026 SCT050 OVC060 26/23 A3006
```

The sim doesn't read `data/metar.json` at runtime. Its values are written into the code:

- **Accident:** a low cumulus layer from 790 to 1,700 m and a deck base at 1,830 m, from the 17:53Z METAR (`WX` in
  `js/main.js`).
- **Free flight:** the "KPBI METAR 1 Nov 17:53Z" weather option, 080° at 16 kt gusting 28 kt, 26 °C.

`tools/fetch_sounding.py` fetches the KMFL (Miami) 12Z radiosonde, about 100 km south of KPBI and about 5.8 hours
before the event. It derives:

| Level | Value |
|---|---|
| Freezing level | 4,780 m |
| −20 °C level | 7,679 m |
| Tropopause | 15,880 m, −75.1 °C |
| Surface | 26.0 °C |

The sounding drives the GOES cloud-top heights and the snow/rain line. It also sets the accident day's air in
`Environment` (`js/scenario.js`):

- **Temperature:** ISA+11 (`Environment.dT = 11`), the mean deviation of the levels between 9.5 and 11.8 km (they
  range from +9 to +13; the surface is +11 too). It sets the temperature, the speed of sound and the Mach number at
  FL350.
- **Mean wind:** 11 kt from 274°, the vector mean of the same levels, fading linearly to calm at the surface.

## The Real weather checkbox

The briefing's **Real weather** checkbox is on by default. `U` toggles it in flight, and the log reports the change.

| | Real weather on | Real weather off |
|---|---|---|
| Clouds, core, updraft, icing | From the KAMX volumes plus the analytic cell | Analytic cell only ("synthetic cell") |
| GOES-19 cloud tops | Used | Not used |
| Precipitation | From the radar reflectivity | From the analytic core |
| GLM lightning | Replayed | Modelled flashes, more frequent in the core |
| Cockpit weather radar | The KAMX volume, labelled KAMX | The modelled cell, labelled SYNTH |
| Cumulus layer and deck base | From the METAR | From the METAR |

The KPBI METAR cloud layers stay either way, as the briefing's checkbox text says. The mean wind and the temperature
come from the sounding either way.

## Real ATC audio

The game can play a LiveATC recording of the frequency, as it was publicly posted, in step with the sim clock.

> **Warning:** The briefing marks this audio **listener discretion**. The recording includes the crew's final
> transmissions. It is off by default and plays only if you turn it on. This wiki doesn't describe what is said.

### Turning it on

- Tick **Real ATC audio** on the briefing before you press **Fly it** or **Watch the reconstruction**.
- Press `T` in flight to toggle it. The cockpit switch panel and the top bar show whether it's on.
- Free flight always turns it off.

### How it is synchronised

The posted clip is edited: the silences between transmissions were cut out. So `atcSync()` in `js/main.js` holds a
piecewise map from clip time to sim time, five pieces long. The pieces were aligned by matching the clip's captions to
the ATC timeline.

- The audio plays only while the flight or a replay is running, and pauses when you pause.
- Between pieces, where the original silences were, it stays quiet.
- It plays at the sim rate, so slowing the clock with `[` slows the tape too.
- If it drifts more than 0.6 s from where it should be, it jumps back into place.

### Shifting the sync

If the audio sounds early or late on your machine, nudge it:

| Key | Effect |
|---|---|
| `;` | Plays the tape 1 second earlier relative to the sim |
| `'` | Plays the tape 1 second later |

The log shows the current shift, and the top bar shows it next to the ATC status. The shift is saved in your browser
(`localStorage` key `n722bd_atc_shift`) and carries over to the next flight.

### The text timeline and synthesized voice

Separate from the audio, `TIMELINE` in `js/scenario.js` posts timed text annotations to the message log (see
[The N722BD flight](accident.md#the-text-timeline)). The crew's final words are left out of it. With the real audio
off, `L` turns on a synthesized voice that reads the timeline's radio lines aloud. It is off by default.

## Free-flight weather

Free flight has no storm, no radar volume, no satellite deck and no lightning. The weather radar shows clear air,
with no source label. `FreeEnv` in `js/freeflight.js` gives
it the same interface as the storm environment, with one of three weather presets:

| Preset | Wind | Temperature | Cloud |
|---|---|---|---|
| Calm | None | ISA | Few cumulus (cover 0.08) |
| KPBI METAR 1 Nov 17:53Z | 080° at 16 kt, gusting 28 kt | 26 °C at the surface (ISA+11) | Scattered cumulus (cover 0.3) |
| Crosswind | 010° at 15 kt, 90° to runway 10L | ISA | Cumulus (cover 0.12) |

The wind follows a boundary-layer profile near the ground. The gust spread drives the turbulence, which is stronger
below about 600 m. There is no icing: any ice sheds. See [Planning a sortie](sorties.md) for choosing the weather.

## Related pages

- [Data pipeline](data-pipeline.md): running the fetch scripts and regenerating the data.
- [Renderer](renderer.md): how the clouds, lightning and precipitation are drawn.
- [Sources and references](references.md): every dataset and its licence.
