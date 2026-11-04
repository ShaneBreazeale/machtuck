"""Ground imagery and water masks around KPBI, resampled into the sim's local metric grid.

Sources (all public domain / no copyright restrictions):
  * USGS The National Map "USGSImageryOnly" tile cache (NAIP 0.6-1 m orthoimagery at large scales, Blue Marble /
    Landsat at small scales). US Government work, public domain. Credit: "USGS The National Map: Orthoimagery".
        https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}
    The cache is transparent offshore beyond the NAIP footprint and outside the US (Bahamas).
  * NASA Blue Marble: Next Generation (via NASA GIBS WMTS, GoogleMapsCompatible_Level8) fills the transparent
    areas (open ocean, Bahamas). NASA imagery, no copyright; credit "NASA Earth Observatory Blue Marble / GIBS".
        https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg
  * USGS National Hydrography Dataset (NHD, small-scale ~1:100k) water polygons, rendered by the USGS hydro map
    service (public domain): https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/export
    (layer 7 Area: CanalDitch, StreamRiver, SeaOcean, BayInlet; layer 10 Waterbody: LakePond, Reservoir, Estuary;
    SwampMarsh deliberately excluded so the Everglades/Loxahatchee marshes stay land).
  * Natural Earth 1:10m land, minor islands and lakes (public domain, naturalearthdata.com) for the far water mask.

Output grid convention (same as tools/grid_nexrad.py): origin KPBI 26.6832 N, -80.0956 E,
    north_m = (lat - 26.6832) * 111320
    east_m  = (lon + 80.0956) * 111320 * cos(radians((lat + 26.6832) / 2))
Images are north-up / east-right: row 0 = north edge (n1), column 0 = west edge (e0); pixel centres at
e0 + (i + 0.5) * (e1 - e0) / W. Each output pixel is mapped back to lat/lon, then to Web Mercator pixel coordinates
at the tile zoom, and bilinearly sampled (with 2x supersampling and box filtering when the tiles are finer than
the output).

Products (data/ground/):
  near.jpg  4096^2  east -70..+50 km,  north -60..+60 km   (USGS z13 ~17 m/px)
  far.jpg   2048^2  east -300..+300 km, north -300..+300 km (USGS z9 ~270 m/px)
  site.jpg  4096^2  east -20..-4 km,   north -16..0 km     (USGS z15 ~4.3 m/px)
  detail.jpg 4096^2 east -15.1..-10.1 km, north -10.8..-5.8 km (USGS z16, ~2.4 m source at 1.2 m/px; z17 has no coverage here)
  airport.jpg 4096^2 east -2.26..2.86 km, north -2.26..2.86 km (USGS z16, ~2.4 m source at 1.25 m/px): KPBI for free flight
  near_water.png 2048^2, far_water.png 1024^2: 8-bit, 255 = water.
  ground.json bounds + attribution.

Water mask method:
  near: union of (1) the offshore area where the USGS cache has no data, (2) blue/turquoise imagery pixels
        (B > R + 12 and B >= G - 6) connected to that area (near-shore ocean inside the NAIP footprint), (3) NHD water
        polygons (Lake Worth Lagoon / Intracoastal, Lake Okeechobee, lakes, ponds, the larger canals) and (4) Natural
        Earth lakes as a backstop. Pure colour classification was tried and rejected: Lake Okeechobee is grey-brown
        in NAIP and the lagoon looks like turf, while wet prairie and flooded fields look like water.
  far:  Natural Earth 10m land + minor islands (coastline good to ~1 km, fine at 586 m/px), minus NE lakes.
  The binary mask is computed at the image resolution, box-averaged to the mask size and blurred (sigma 0.8 px)
  for soft edges.
Imagery compositing: USGS where it has data; NASA Blue Marble elsewhere. On far, USGS small-scale tiles are used
over (feathered) land only, because their offshore coverage is blocky. On near, the NAIP offshore strip is faded
into Blue Marble within 1.2 km of its no-data edge and beyond 3 km from shore.

Usage: python tools/fetch_imagery.py [--cache DIR] [--out data/ground] [--only near,far,site] [--debug DIR]
Requires numpy, scipy, pillow, pyshp. Tile requests: <= 4 concurrent, User-Agent machtuck-sim-asset-builder,
cached on disk.
"""
import argparse, io, json, math, os, sys, time, urllib.error, urllib.parse, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

UA = 'machtuck-sim-asset-builder'
USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'
GIBS = ('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/'
        'GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg')
NE = 'https://naciscdn.org/naturalearth/10m/physical/{name}.zip'
NHD = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/export'
NHD_AREA = "FTYPE IN ('CanalDitch','StreamRiver','SeaOcean','BayInlet')"          # layer 7, Area - Small Scale
NHD_WATERBODY = "FTYPE IN ('LakePond','Reservoir','Estuary')"                      # layer 10, no SwampMarsh
PBI_LAT, PBI_LON = 26.6832, -80.0956

PRODUCTS = {
    'near': dict(e0=-70000, e1=50000, n0=-60000, n1=60000, size=4096, z=13, ss=2, mask=2048, q=85, nhd=True),
    'far': dict(e0=-300000, e1=300000, n0=-300000, n1=300000, size=2048, z=9, ss=2, mask=1024, q=85),
    'site': dict(e0=-20000, e1=-4000, n0=-16000, n1=0, size=4096, z=15, ss=1, mask=None, q=85),
    # 2.4 m source (z16; z17 is empty here) around the reconstructed impact point (ghost track end, e -12.6 km / n -8.3 km): the replay ground camera
    'detail': dict(e0=-15074, e1=-10074, n0=-10839, n1=-5839, size=4096, z=16, ss=1, mask=None, q=82),
    # KPBI for free flight: runways, taxiways and aprons (the aerodrome spans east -1.6..2.2 km, north -0.7..1.2 km)
    'airport': dict(e0=-2260, e1=2860, n0=-2260, n1=2860, size=4096, z=16, ss=1, mask=None, q=82),   # z17 is empty here too
}


# ---------------------------------------------------------------- projections
def local_to_ll(E, N):
    lat = PBI_LAT + N / 111320.0
    lon = PBI_LON + E / (111320.0 * np.cos(np.radians((lat + PBI_LAT) / 2)))
    return lat, lon


def ll_to_local(lat, lon):
    return (lon - PBI_LON) * 111320.0 * np.cos(np.radians((lat + PBI_LAT) / 2)), (lat - PBI_LAT) * 111320.0


def ll_to_merc_px(lat, lon, z):
    n = 256.0 * 2 ** z
    x = (lon + 180.0) / 360.0 * n
    s = np.radians(lat)
    y = (1 - np.log(np.tan(s) + 1 / np.cos(s)) / math.pi) / 2 * n
    return x, y


def grid(p, size, ss=1):
    m = size * ss
    de, dn = (p['e1'] - p['e0']) / m, (p['n1'] - p['n0']) / m
    e = p['e0'] + (np.arange(m) + 0.5) * de
    n = p['n1'] - (np.arange(m) + 0.5) * dn        # row 0 = north
    return e, n


# ---------------------------------------------------------------- tiles
class TileCache:
    def __init__(self, root, url, tag):
        self.dir = os.path.join(root, tag); self.url = url
        os.makedirs(self.dir, exist_ok=True)

    def path(self, z, y, x):
        return os.path.join(self.dir, f'{z}_{y}_{x}')

    def fetch(self, zyx):
        z, y, x = zyx
        fn = self.path(z, y, x)
        if os.path.exists(fn) or os.path.exists(fn + '.404'):
            return
        for attempt in range(4):
            try:
                req = urllib.request.Request(self.url.format(z=z, y=y, x=x), headers={'User-Agent': UA})
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
                open(fn + '.part', 'wb').write(data); os.rename(fn + '.part', fn)
                return
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    open(fn + '.404', 'w').close(); return
                time.sleep(2 ** attempt)
            except Exception:
                time.sleep(2 ** attempt)
        print('tile failed', zyx, file=sys.stderr)

    def load(self, z, y, x):
        fn = self.path(z, y, x)
        if not os.path.exists(fn):
            return np.zeros((256, 256, 4), np.uint8)
        try:
            return np.asarray(Image.open(fn).convert('RGBA'))
        except Exception:
            return np.zeros((256, 256, 4), np.uint8)

    def mosaic(self, lat, lon, z):
        """Fetch every tile touching the lat/lon sample set; return (RGBA mosaic, x0px, y0px)."""
        px, py = ll_to_merc_px(lat, lon, z)
        tx0, tx1 = int(np.floor(px.min() / 256)) , int(np.floor(px.max() / 256))
        ty0, ty1 = int(np.floor(py.min() / 256)), int(np.floor(py.max() / 256))
        jobs = [(z, y, x) for y in range(ty0, ty1 + 1) for x in range(tx0, tx1 + 1)]
        print(f'  {self.dir.split("/")[-1]} z{z}: {len(jobs)} tiles', file=sys.stderr)
        with ThreadPoolExecutor(4) as ex:
            list(ex.map(self.fetch, jobs))
        M = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 4), np.uint8)
        for (z_, y, x) in jobs:
            M[(y - ty0) * 256:(y - ty0 + 1) * 256, (x - tx0) * 256:(x - tx0 + 1) * 256] = self.load(z_, y, x)
        return M, tx0 * 256, ty0 * 256


def sample_rgba(M, x0, y0, lat, lon, z):
    """Bilinear sample of a mosaic with premultiplied alpha. Returns float32 (..., 4) rgb in 0..255, a in 0..1."""
    px, py = ll_to_merc_px(lat, lon, z)
    c = [py - y0 - 0.5, px - x0 - 0.5]
    a = M[..., 3].astype(np.float32) / 255
    out = np.empty(lat.shape + (4,), np.float32)
    out[..., 3] = ndimage.map_coordinates(a, c, order=1, mode='nearest')
    for k in range(3):
        out[..., k] = ndimage.map_coordinates(M[..., k].astype(np.float32) * a, c, order=1, mode='nearest')
    with np.errstate(invalid='ignore', divide='ignore'):
        out[..., :3] = np.where(out[..., 3:] > 1e-3, out[..., :3] / out[..., 3:], 0)
    return out


def render(p, usgs, gibs):
    """Render a product grid at output size: (USGS rgb float, USGS alpha 0..1, Blue Marble rgb float)."""
    size, ss, z = p['size'], p['ss'], p['z']
    e, n = grid(p, size, ss)
    # mosaics from a sparse sample of the grid (edges + interior suffice for monotone projections)
    E, N = np.meshgrid(e[::64], n[::64])
    lat_s, lon_s = local_to_ll(np.r_[E.ravel(), e[[0, -1, 0, -1]]], np.r_[N.ravel(), n[[0, 0, -1, -1]]])
    Mu, ux, uy = usgs.mosaic(lat_s, lon_s, z)
    zb = min(z, 8)
    Mb, bx, by = gibs.mosaic(lat_s, lon_s, zb)
    urgb = np.zeros((size, size, 3), np.float32); brgb = np.zeros((size, size, 3), np.float32)
    alpha = np.zeros((size, size), np.float32)
    rows = max(ss, (512 // ss) * ss)
    for r0 in range(0, size * ss, rows):
        En, Nn = np.meshgrid(e, n[r0:r0 + rows])
        lat, lon = local_to_ll(En, Nn)
        u = sample_rgba(Mu, ux, uy, lat, lon, z)
        b = sample_rgba(Mb, bx, by, lat, lon, zb)
        h = u.shape[0] // ss
        box = lambda x: x.reshape(h, ss, size, ss, *x.shape[2:]).mean((1, 3))
        a = np.clip(u[..., 3], 0, 1)
        al = box(a)
        with np.errstate(invalid='ignore', divide='ignore'):
            uc = np.where(al[..., None] > 1e-3, box(u[..., :3] * a[..., None]) / al[..., None], 0)
        urgb[r0 // ss:r0 // ss + h] = uc; alpha[r0 // ss:r0 // ss + h] = al
        brgb[r0 // ss:r0 // ss + h] = box(b[..., :3])
    return urgb, alpha, brgb


# ---------------------------------------------------------------- vectors
def ne_shapes(cache, name):
    import shapefile
    fn = os.path.join(cache, name + '.zip')
    if not os.path.exists(fn):
        req = urllib.request.Request(NE.format(name=name), headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            open(fn, 'wb').write(r.read())
    z = zipfile.ZipFile(fn)
    shp = shapefile.Reader(shp=io.BytesIO(z.read(name + '.shp')), shx=io.BytesIO(z.read(name + '.shx')),
                           dbf=io.BytesIO(z.read(name + '.dbf')))
    return shp


def raster_polys(shp, p, size, lon_min=-180.0, bbox_pad=0.5):
    """Rasterise polygons (holes respected) into a size^2 boolean grid of product p."""
    lat_c, lon_c = local_to_ll(np.array([p['e0'], p['e1'], p['e0'], p['e1']]), np.array([p['n0'], p['n0'], p['n1'], p['n1']]))
    bb = (lon_c.min() - bbox_pad, lat_c.min() - bbox_pad, lon_c.max() + bbox_pad, lat_c.max() + bbox_pad)
    img = Image.new('L', (size, size), 0); d = ImageDraw.Draw(img)
    sx, sy = size / (p['e1'] - p['e0']), size / (p['n1'] - p['n0'])
    for s in shp.iterShapes():
        if s.bbox[2] < bb[0] or s.bbox[0] > bb[2] or s.bbox[3] < bb[1] or s.bbox[1] > bb[3] or s.bbox[2] < lon_min:
            continue
        parts = list(s.parts) + [len(s.points)]
        for i in range(len(parts) - 1):
            pts = np.array(s.points[parts[i]:parts[i + 1]])
            if len(pts) < 3:
                continue
            E, N = ll_to_local(pts[:, 1], pts[:, 0])
            X, Y = (E - p['e0']) * sx, (p['n1'] - N) * sy
            area = 0.5 * np.sum(pts[:-1, 0] * pts[1:, 1] - pts[1:, 0] * pts[:-1, 1])
            d.polygon(list(zip(X, Y)), fill=255 if area <= 0 else 0)   # shapefile: outer rings clockwise
    return np.asarray(img) > 127


# ---------------------------------------------------------------- water
def nhd_water(p, size, cache):
    """NHD (small-scale, ~1:100k) water polygons rendered by the USGS hydro map service, sampled to the grid."""
    lat_c, lon_c = local_to_ll(np.array([p['e0'], p['e1'], p['e0'], p['e1']]), np.array([p['n0'], p['n0'], p['n1'], p['n1']]))
    bb = [round(lon_c.min() - 0.02, 4), round(lat_c.min() - 0.02, 4), round(lon_c.max() + 0.02, 4), round(lat_c.max() + 0.02, 4)]
    fn = os.path.join(cache, 'nhd_%s_%s_%s_%s.png' % tuple(bb))
    if not os.path.exists(fn):
        sym = {'type': 'esriSFS', 'style': 'esriSFSSolid', 'color': [0, 0, 255, 255],
               'outline': {'type': 'esriSLS', 'style': 'esriSLSNull', 'color': [0, 0, 0, 0], 'width': 0}}
        def lyr(i, expr):
            return {'id': i, 'source': {'type': 'mapLayer', 'mapLayerId': i}, 'definitionExpression': expr,
                    'drawingInfo': {'renderer': {'type': 'simple', 'symbol': sym}, 'showLabels': False}}
        dl = [lyr(7, NHD_AREA), lyr(10, NHD_WATERBODY)]
        q = dict(bbox=','.join(map(str, bb)), bboxSR=4326, imageSR=4326, size='4096,4096', format='png32',
                 transparent='true', dynamicLayers=json.dumps(dl), f='image', dpi=96)
        req = urllib.request.Request(NHD + '?' + urllib.parse.urlencode(q), headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=300) as r:
            open(fn, 'wb').write(r.read())
    A = np.asarray(Image.open(fn).convert('RGBA'))[..., 3].astype(np.float32) / 255
    e, n = grid(p, size)
    lat, lon = local_to_ll(*np.meshgrid(e, n))
    H, W = A.shape
    col = (lon - bb[0]) / (bb[2] - bb[0]) * W - 0.5
    row = (bb[3] - lat) / (bb[3] - bb[1]) * H - 0.5
    return ndimage.map_coordinates(A, [row, col], order=1) > 0.5


def blue_ocean(rgb, offshore):
    """Near-shore ocean inside the NAIP footprint: blue/turquoise pixels connected to the offshore no-data area."""
    f = rgb.astype(np.int16)
    blue = (f[..., 2] > f[..., 0] + 12) & (f[..., 2] >= f[..., 1] - 6)
    lab, nl = ndimage.label(blue | offshore)
    ids = np.unique(lab[offshore])
    return np.isin(lab, ids[ids > 0])


def water_mask(p, rgb, alpha, ne, out_size, cache):
    size = p['size']
    lakes = raster_polys(ne['lakes'], p, size)
    if p.get('nhd'):
        offshore = alpha < 0.5
        ocean = blue_ocean(rgb, offshore)
        water = ocean | nhd_water(p, size, cache) | lakes
    else:
        land = raster_polys(ne['land'], p, size) | raster_polys(ne['islands'], p, size)
        ocean = ~land                  # small scale: Natural Earth 10m coastline
        water = ocean | lakes
    water = ndimage.binary_closing(water, iterations=1) | water
    f = size // out_size
    m = water.reshape(out_size, f, out_size, f).mean((1, 3)) if f > 1 else water.astype(np.float32)
    m = ndimage.gaussian_filter(m, 0.8)
    return np.clip(np.round(m * 255), 0, 255).astype(np.uint8), water, ocean


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    ap.add_argument('--cache', default=os.environ.get('MACHTUCK_CACHE', '/tmp/machtuck_cache'))
    ap.add_argument('--out', default=os.path.join(root, 'data', 'ground'))
    ap.add_argument('--only', default='near,far,site')
    ap.add_argument('--debug', default=None, help='write previews / intermediates here')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    usgs = TileCache(a.cache, USGS, 'usgs_tiles'); gibs = TileCache(a.cache, GIBS, 'gibs_bmng')
    vcache = os.path.join(a.cache, 'vector'); os.makedirs(vcache, exist_ok=True)
    ne = {'land': ne_shapes(vcache, 'ne_10m_land'), 'islands': ne_shapes(vcache, 'ne_10m_minor_islands'),
          'lakes': ne_shapes(vcache, 'ne_10m_lakes')}
    meta_fn = os.path.join(a.out, 'ground.json')
    meta = json.load(open(meta_fn)) if os.path.exists(meta_fn) else {}
    if a.debug:
        os.makedirs(a.debug, exist_ok=True)
    for name in a.only.split(','):
        p = PRODUCTS[name]
        print(name, file=sys.stderr)
        urgb, alpha, brgb = render(p, usgs, gibs)
        if name == 'far':
            # small-scale USGS tiles carry blocky offshore patches: keep them on land only (feathered NE land)
            land = (raster_polys(ne['land'], p, p['size']) | raster_polys(ne['islands'], p, p['size'])) & \
                ~raster_polys(ne['lakes'], p, p['size'])
            land = ndimage.binary_dilation(land, iterations=2)
            w = alpha * np.clip(ndimage.gaussian_filter(land.astype(np.float32), 2.0) * 1.5, 0, 1)
        else:
            w = np.clip(ndimage.gaussian_filter(alpha, 3.0) * alpha, 0, 1)        # feather the no-data edge
        rgb = np.clip(np.round(urgb * w[..., None] + brgb * (1 - w[..., None])), 0, 255).astype(np.uint8)
        if p['mask']:
            m, water, ocean = water_mask(p, rgb, alpha, ne, p['mask'], vcache)
            if p.get('nhd'):
                # NAIP's offshore strip ends in rectangular blocks: over the ocean fade it into Blue Marble
                # within 1.2 km of the no-data edge, and beyond 3 km from shore
                px_m = (p['e1'] - p['e0']) / p['size']
                d_shore = ndimage.distance_transform_edt(ocean) * px_m
                d_nd = ndimage.distance_transform_edt(alpha >= 0.5) * px_m
                k = np.clip(d_nd / 1200, 0, 1) * np.clip(1 - (d_shore - 1000) / 2000, 0, 1)
                k = np.where(ocean, ndimage.gaussian_filter(k, 4), 1.0) * w
                rgb = np.clip(np.round(urgb * k[..., None] + brgb * (1 - k[..., None])), 0, 255).astype(np.uint8)
            Image.fromarray(m, 'L').save(os.path.join(a.out, f'{name}_water.png'), optimize=True)
            meta[name + '_water'] = {'file': f'{name}_water.png', 'e0': p['e0'], 'e1': p['e1'], 'n0': p['n0'],
                                     'n1': p['n1'], 'width': p['mask'], 'height': p['mask'], 'encoding': '255 = water',
                                     'water_fraction': round(float(m.mean() / 255), 3)}
            if a.debug:
                np.save(os.path.join(a.debug, f'{name}_water_full.npy'), water)
        Image.fromarray(rgb).save(os.path.join(a.out, f'{name}.jpg'), quality=p['q'], optimize=True, progressive=True)
        meta[name] = {'file': f'{name}.jpg', 'e0': p['e0'], 'e1': p['e1'], 'n0': p['n0'], 'n1': p['n1'],
                      'width': p['size'], 'height': p['size'], 'm_per_px': (p['e1'] - p['e0']) / p['size'],
                      'usgs_zoom': p['z'], 'usgs_coverage_fraction': round(float((alpha > 0.5).mean()), 3)}
        if a.debug:
            Image.fromarray(rgb).resize((1024, 1024), Image.LANCZOS).save(os.path.join(a.debug, f'{name}_preview.jpg'), quality=80)
            np.save(os.path.join(a.debug, f'{name}_alpha.npy'), (alpha * 255).astype(np.uint8))
    meta['convention'] = ('metres from KPBI (26.6832, -80.0956): north_m=(lat-26.6832)*111320, '
                          'east_m=(lon+80.0956)*111320*cos(radians((lat+26.6832)/2)); images north-up, '
                          'row 0 = n1 (north edge), column 0 = e0 (west edge); world x=east, z=north')
    meta['source'] = ('USGS The National Map USGSImageryOnly tile cache (NAIP orthoimagery; Blue Marble/Landsat at '
                      'small scales), Web Mercator tiles resampled to the local grid; transparent (no-data) areas '
                      'filled with NASA Blue Marble: Next Generation via NASA GIBS. Water masks: imagery '
                      'no-data + blue near-shore ocean + USGS NHD water polygons (near); Natural Earth 10m land/islands/lakes (far).')
    meta['licence'] = ('Public domain. Imagery: USGS The National Map: Orthoimagery (USDA NAIP), US Government work. '
                       'Ocean/Bahamas fill: NASA Earth Observatory Blue Marble: Next Generation, served by NASA GIBS '
                       '(no copyright). Water: USGS National Hydrography Dataset (public domain); Made with Natural Earth (public domain).')
    meta['attribution'] = 'Imagery: USGS The National Map / USDA NAIP; NASA Blue Marble (GIBS). Water: USGS NHD, Natural Earth.'
    json.dump(meta, open(meta_fn, 'w'), indent=1)


if __name__ == '__main__':
    main()
