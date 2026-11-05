# Data pipeline

Every dataset in `data/` was built by a script in `tools/`. The sim never fetches weather, imagery or nav data at run
time: it loads the files in `data/` from the same static server as the code. The one network request to another site
is the optional SimBrief import, and it is sent only when you click **Fetch**.

This page lists what is in `data/`, which script made each part, where the script gets its input, and how to rerun
it. For what the sim does with the data, see [Real weather and ATC data](weather-data.md) and
[Renderer](renderer.md).

## Before you run anything

- The scripts are Python 3, run from the repository root (`python3 tools/<script>.py`). Each one writes to the right
  place under `data/` by default.
- The downloaders cache raw files on disk. The cache directory is `--cache DIR`, else the `MACHTUCK_CACHE`
  environment variable, else `/tmp/machtuck_cache`. Delete a cached file to force a fresh download.
- Each script's docstring names its own dependencies (listed below). There is no shared requirements file.
- Downloads send the User-Agent `machtuck-sim-asset-builder`.

## The data/ layout

| Path | Contents | Made by |
|---|---|---|
| `data/kamx_HHMMSS.bin`, `.json` | KAMX NEXRAD reflectivity on a 500 m grid, with grid metadata | `tools/grid_nexrad.py` |
| `data/goes/goes_1746.png`, `goes_1751.png`, `goes.json` | GOES-19 ABI cloud fields, parallax-corrected | `tools/fetch_goes.py` |
| `data/glm_flashes.json` | GOES-19 GLM lightning flashes, 17:44 to 17:52Z | `tools/fetch_glm.py` |
| `data/metar.json` | Surface observations around the event | `tools/fetch_metar.py` |
| `data/sounding_kmfl.json` | KMFL 12Z radiosonde with derived levels | `tools/fetch_sounding.py` |
| `data/ground/near.jpg`, `far.jpg`, `site.jpg`, `detail.jpg`, `airport.jpg` | Ground imagery in the local grid | `tools/fetch_imagery.py` |
| `data/ground/near_water.png`, `far_water.png`, `ground.json` | Water masks, bounds and attribution | `tools/fetch_imagery.py` |
| `data/ground/buildings.bin`, `buildings.json` | 62,192 buildings with measured heights around the impact area | `tools/fetch_buildings.py` |
| `data/ground/trees.bin`, `trees.json` | 511,964 trees with heights and crown radii | `tools/fetch_canopy_trees.py` |
| `data/nav/index.json`, `enroute.json`, `runways.json`, `apt/<ICAO>.json` | FAA CIFP nav database: 72 airports | `tools/fetch_cifp.py` |
| `data/nav/markers.json` | Operational ILS marker beacons from the FAA NASR | `tools/fetch_markers.py` |
| `data/plates/*.png`, `plates.json` | KDJT approach plates, airport diagram and straight-in minimums | `tools/fetch_plates.py` |
| `data/ext/` | Exterior model (`ext.json`, `ext.bin`, textures) and the N722BD livery textures | `tools/fs9_ext.py`, `tools/livery.py` |
| `data/vc/` | Virtual cockpit model (`vc.json`, `vc.bin`, textures) | `tools/fs9_vc.py` |

All of the grids use the sim's local projection, with its origin at KPBI (26.6832 N, 80.0956 W):

```text
north_m = (lat - 26.6832) * 111320
east_m  = (lon + 80.0956) * 111320 * cos((lat + 26.6832) / 2)
```

That is the same `toNE` the sim uses in `js/navdb.js`, so everything lines up without a reprojection step. See
[Architecture](architecture.md#units-and-frames).

## Weather

### NEXRAD radar

```bash
python3 tools/grid_nexrad.py <Level2 file> data/kamx_HHMMSS
```

Grids one KAMX NEXRAD Level II volume into a Cartesian reflectivity volume. The script reads the file with MetPy
(`metpy.io.Level2File`) and needs numpy. You supply the Level II file; the script does not download it.

- Grid: east −50 to +30 km, north −45 to +40 km, up 0 to 16 km, 500 m voxels, origin at the KPBI 10L/28R midpoint.
- Beam heights use a 4/3 Earth radius.
- `<out>.bin` is uint8, with dBZ encoded as `(dBZ + 10) * 4` and 0 for no echo. `<out>.json` holds the grid
  metadata (origin, voxel size, dimensions, layout `[north][up][east]`, the source file and time).

`data/` has three volumes: 17:40:32, 17:45:48 and 17:51:04Z. The sim loads the last two (`NEXRAD_VOLUMES` in
`js/scenario.js`) and blends between them.

### GOES-19 clouds

```bash
python3 tools/fetch_goes.py [--cache DIR] [--out data/goes] [--sounding data/sounding_kmfl.json] [--no-parallax] [--preview DIR]
```

Downloads GOES-19 ABI L1b CONUS radiances from the NOAA open-data bucket (`noaa-goes19` on S3) for the scans that
start nearest 17:46Z and 17:51Z. It uses band C02 (visible reflectance) and band C13 (infrared brightness
temperature). Needs numpy, h5py, scipy and Pillow.

- Cloud-top height comes from the C13 brightness temperature matched against the KMFL sounding. Run
  `tools/fetch_sounding.py` first.
- Parallax correction is on by default. GOES-19 sees a 13 km top about 8 km north of where it is, so each pixel is
  re-sampled along the line of sight at its consistent cloud-top height.
- Output: 1024 × 1024 RGBA PNGs over ±150 km (R reflectance, G cloud-top height in 100 m steps, B brightness
  temperature − 180 K, A cloud mask) and `goes.json` with the grid and encoding.

### GLM lightning

```bash
python3 tools/fetch_glm.py [--cache DIR] [--out data/glm_flashes.json] [--cloud-height 12000]
```

Downloads the GOES-19 GLM L2 LCFA 20-second files for 17:44 to 17:52Z and keeps the flashes within 80 km of KPBI.
Needs numpy and h5py. Each flash is re-navigated from the GLM lightning ellipsoid to a nominal 12 km cloud top.
`--cloud-height 0` gives the uncorrected surface footprint, and `-1` keeps the raw positions. Times are seconds from
17:47:00Z.

### METARs

```bash
python3 tools/fetch_metar.py [--cache DIR] [--out data/metar.json]
```

Fetches 16:30 to 18:30Z METARs from the Iowa Environmental Mesonet ASOS archive for KPBI and five nearby stations
(KLNA, KF45, KBCT, KFXE, KSUA). Standard library only. Palm Beach International now reports as KDJT (archive id
`DJT`); the output keeps the sim's KPBI label with the reporting id alongside. The 5-minute high-frequency reports
are kept and flagged `hf`.

### Sounding

```bash
python3 tools/fetch_sounding.py [--cache DIR] [--out data/sounding_kmfl.json]
```

Fetches the KMFL 12Z 1 November radiosonde from the IEM RAOB JSON service, falling back to station id `MFL` and then
to 00Z 2 November. Standard library only. Besides the levels it derives the freezing level, the −20 °C level, the
WMO tropopause, the wind at 35,000 ft and the surface temperature.

## Ground

### Imagery and water

```bash
python3 tools/fetch_imagery.py [--cache DIR] [--out data/ground] [--only near,far,site] [--debug DIR]
```

Needs numpy, scipy, Pillow and pyshp. It resamples tiles into the local grid:

- USGS The National Map `USGSImageryOnly` tiles (NAIP orthoimagery at large scales).
- NASA Blue Marble Next Generation via GIBS where USGS has no data (open ocean, the Bahamas).
- USGS National Hydrography Dataset water polygons and Natural Earth 1:10m land and lakes for the water masks.

| Product | Size | Area (east, north) | Source zoom |
|---|---|---|---|
| `near.jpg` | 4096² | −70 to +50 km, −60 to +60 km | USGS z13 |
| `far.jpg` | 2048² | −300 to +300 km, −300 to +300 km | USGS z9 |
| `site.jpg` | 4096² | −20 to −4 km, −16 to 0 km | USGS z15 |
| `detail.jpg` | 4096² | −15.1 to −10.1 km, −10.8 to −5.8 km | USGS z16 |
| `airport.jpg` | 4096² | −2.26 to +2.86 km, −2.26 to +2.86 km (KPBI) | USGS z16 |

The default `--only` builds `near`, `far` and `site`. Ask for the others by name, for example
`--only detail,airport`. Tile requests run at most 4 at a time and are cached.

### Buildings

```bash
pip install overturemaps pyarrow shapely numpy
python3 tools/fetch_buildings.py [--parquet FILE]
```

Downloads the Overture Maps buildings theme (OpenStreetMap footprints merged with Microsoft ML Buildings) with the
`overturemaps` CLI, unless you pass a GeoParquet file. Area: east −20 to −4 km, north −16 to 0 km (the `site.jpg`
patch, Greenacres and western Palm Beach County). Height is Overture's measured total height, else floors × 3.2 m
+ 1 m, else 4.2 m. The output is under the ODbL.

### Trees

```bash
python3 tools/fetch_canopy_trees.py [--min-height-m 4]
```

Reads Meta and WRI's 1 m global canopy height map straight from AWS Open Data over `/vsicurl`. Needs GDAL, numpy,
scipy and Pillow. Tree tops are local maxima of the smoothed canopy height, thinned so one crown gives one tree.
Crown radius is measured along 8 rays. Tops on building footprints are dropped, so run `fetch_buildings.py` first.
Palms are a proxy (a top 6 to 24 m high with a narrow crown), not a survey.

## Navigation

### CIFP

```bash
python3 tools/fetch_cifp.py [--url ...] [--center KDJT] [--radius 160] [--out data/nav] [--cache DIR]
```

Converts the FAA Coded Instrument Flight Procedures (ARINC 424-18, 132-column records) into compact JSON. Standard
library only. It keeps the airports within `--radius` nm of `--center` that have runways and at least one instrument
procedure, and resolves every fix to coordinates.

| File | Contents |
|---|---|
| `index.json` | Cycle, source URL, centre, radius, the airport list (ident, name, position, elevation, magnetic variation) |
| `apt/<ICAO>.json` | Runways, localizers and glideslopes, terminal fixes, SIDs, STARs, approaches with legs per transition |
| `enroute.json` | VORs, NDBs, enroute waypoints and airways within the radius plus 100 nm |
| `runways.json` | Runway pairs for the ground model and the runway paint |

**Cycle handling.** The cycle is read from the file name in `--url`: the six digits after `CIFP_`. The default URL is
`https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_261029.zip`, so the shipped database is cycle 261029. The zip is
downloaded once into the cache under its own name, and the script reads the `FAACIFP18` file inside it. To move to a
new cycle, pass that cycle's zip URL:

```bash
python3 tools/fetch_cifp.py --url <URL of the new CIFP_xxxxxx.zip>
```

The sim logs the cycle from `index.json` when it loads (`[NAVDB] cycle ...`) and shows it in the flight-plan log line.

### Marker beacons

```bash
python3 tools/fetch_markers.py [--nav data/nav] [--cycle Current] [--delay 1.0]
```

The CIFP has no marker records, so the outer, middle and inner markers come from the FAA's National Airspace System
Resource database (NASR), read through eNASR (`https://enasr.faa.gov/eNASR/nasr/`). Standard library only. Run it
after `fetch_cifp.py`: it reads the ILS already in `data/nav` and looks up only those.

1. Fetches the eNASR list of every US ILS and matches each one to an ILS in `data/nav` by airport, localizer and
   runway.
2. Fetches the detail page of each matched ILS, one request at a time, `--delay` seconds apart (1 s by default).
3. Keeps only the markers whose status is OPERATIONAL. Most US markers are decommissioned, and a decommissioned
   marker must stay silent in the cockpit.
4. Writes `data/nav/markers.json`: the cycle, the source URL, and per airport and ILS each marker's type (OM, MM or
   IM), ident, name, position and elevation.

A failed lookup leaves that ILS without markers. The file is optional: without it the sim simply has no markers.
The shipped file holds four markers, at KFMY, KPIE and KTPA; see
[Approaches and minimums](approaches.md#marker-beacons).

### Plates and minimums

```bash
python3 tools/fetch_plates.py [--cycle 2611] [--apt DJT] [--out data/plates] [--dpi 170]
```

Needs `pdftoppm` and `pdftotext` from poppler on your `PATH`. The script:

1. Downloads the d-TPP metafile for the cycle from `https://aeronav.faa.gov/d-tpp/<cycle>/`.
2. Finds the airport by its FAA identifier. KPBI is `DJT` from cycle 2611 on.
3. Downloads every instrument approach plate (`IAP`) and the airport diagram (`APD`) and renders each to a grayscale
   PNG with `pdftoppm`.
4. Runs `pdftotext -layout` on each approach plate and reads the straight-in minimums: the DA or MDA per aircraft
   category for each line (S-ILS, S-LOC, LPV, LNAV/VNAV, LNAV, RNP 0.30 and so on).
5. Writes `plates.json` with the cycle, the validity dates, and each chart's title, file, amendment and minimums.

CIFP carries the procedures but not their minimums, which is why the plates are parsed at all. Circling minimums are
skipped: in the text layer they wrap across lines and can't be assigned to categories. The sim uses the Category C
line. See [Approaches and minimums](approaches.md).

The repository ships one airport (KDJT, 12 approach plates and the diagram) for one cycle. The charts and the nav
data are **not for navigation**.

## Models and livery

### Model converters

```bash
python3 tools/fs9_vc.py <model.mdl> <texture dir> data/vc
python3 tools/fs9_ext.py <model.mdl> <texture dir> data/ext
```

Convert the FS2004 MDL8 bytecode of the Premier Aircraft Design Learjet 60 (`lear60_ver25.mdl`) into web assets: a
JSON node tree with animation tracks and batches, a binary vertex and index buffer, and one WebP per texture. Both
need numpy and Pillow, and `fs9_ext.py` reuses the decoder in `fs9_vc.py`. You supply the model and its textures. The
asset formats and the measured frame are documented in `data/vc/README.md` and `data/ext/README.md`.

### Livery

```bash
python3 tools/livery.py data/ext
```

Writes a `<texture>_N722BD.webp` next to each exterior texture, which `js/render.js` prefers when present. The paint
follows a 2017 sales listing that describes N722BD as "overall white with gold and brown stripes". The stripes are the
model's own cheat line recoloured, so the livery is an approximation, not a copy.

## Licensing and attribution

| Data | Terms, as recorded in the repo |
|---|---|
| NOAA NEXRAD, GOES, GLM; NWS METARs and soundings | US Government data, public domain |
| USGS imagery and NHD; NASA Blue Marble; Natural Earth | Public domain |
| FAA CIFP, NASR and d-TPP | US Government work, public domain. Not for navigation |
| Overture buildings (`buildings.bin`) | © OpenStreetMap contributors and Microsoft, ODbL 1.0 |
| Canopy height (`trees.bin`) | Meta and the World Resources Institute, CC BY 4.0 |
| KPBI boundary in `js/ground.js` | OpenStreetMap, ODbL |
| Exterior and cockpit models | FSX Bombardier Learjet 60 by Premier Aircraft Design (Jean-Pierre Brisard, Barry Blaisdell, Bob May and Kevin Pardy), see `data/vc/README.md` |

The live instruments drawn over the cockpit panel are the sim's own; the model's gauges are not used. For the full
list of sources, see [Sources and references](references.md).
