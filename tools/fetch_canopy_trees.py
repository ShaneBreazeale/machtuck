"""Individual trees around the impact area from Meta/WRI's 1 m global canopy height map.

    python3 tools/fetch_canopy_trees.py          # needs GDAL (with /vsicurl), numpy, scipy, Pillow

Source: "High Resolution Canopy Height Maps" (Tolan et al. 2024; Meta + World Resources Institute), CC BY 4.0,
keyless on AWS Open Data: s3://dataforgood-fb-data/forests/v1/alsgedi_global_v6_float/chm/<quadkey z9>.tif (EPSG:3857, m).
Method follows vibevoga's tools/chm_tree_points.py: tree tops are 5x5 local maxima of the 3x3-smoothed CHM at or above
--min-height-m, thinned tallest-first with a crown radius clamp(0.25 h, 2, 6) m so one crown gives one tree; tops on
building footprints (data/ground/buildings.bin, 1 m margin) are dropped.

Crown radius is measured: the median distance along 8 rays from the top to the first cell below 60% of its height.
Palm proxy (no LiDAR profile here, cf. chm_tree_points.py --palm-variant): a top 6-24 m high with a measured crown
radius of 1.2-2.6 m; everything else is a broadleaf crown. A proxy, not a survey.

Area: the data/ground/site.jpg patch, east -20000..-4000 m, north -16000..0 m from KPBI. Output:
  data/ground/trees.bin   per tree: u16 east, u16 north (0.25 m units from e0, n0), u8 height (0.25 m), u8 crown radius
                          (0.05 m), u8 kind (0 broadleaf, 1 palm)
  data/ground/trees.json  bounds, count, encoding, attribution
"""
import argparse, json, math, os, struct, sys
import numpy as np
from osgeo import gdal
from scipy.ndimage import maximum_filter, uniform_filter
from numpy.lib.stride_tricks import sliding_window_view
from PIL import Image, ImageDraw

LAT0, LON0 = 26.6832, -80.0956
E0, E1, N0, N1 = -20000, -4000, -16000, 0
CHM = 'https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/{}.tif'
R = 6378137.0

def to_ll(e, n):
    lat = LAT0 + n / 111320.0
    return lat, LON0 + e / (111320.0 * math.cos(math.radians((lat + LAT0) / 2)))

def to_en(lat, lon):
    return (lon - LON0) * 111320.0 * np.cos(np.radians((lat + LAT0) / 2)), (lat - LAT0) * 111320.0

def quadkey(lon, lat, z=9):
    n = 2 ** z; x = int((lon + 180) / 360 * n); lr = math.radians(lat)
    y = int((1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n)
    return ''.join(str(((x >> (i - 1)) & 1) + 2 * ((y >> (i - 1)) & 1)) for i in range(z, 0, -1))

def merc(lon, lat): return math.radians(lon) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R

def building_mask(root, step=1.0):
    """Footprints (+1 m) rasterised on a local grid, row 0 = north, step m per pixel."""
    p = os.path.join(root, 'buildings.bin')
    w, h = int((E1 - E0) / step), int((N1 - N0) / step)
    im = Image.new('L', (w, h), 0)
    if not os.path.exists(p): return np.zeros((h, w), bool), step
    d = open(p, 'rb').read(); o = 0; dr = ImageDraw.Draw(im)
    while o < len(d):
        n = d[o]; o += 3
        pts = [((struct.unpack_from('<H', d, o + 4 * i)[0] / 4) / step, (N1 - N0 - struct.unpack_from('<H', d, o + 4 * i + 2)[0] / 4) / step) for i in range(n)]
        o += 4 * n
        if len(pts) >= 3: dr.polygon(pts, fill=255)
    m = np.asarray(im) > 0
    return maximum_filter(m, size=3), step

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--min-height-m', type=float, default=4.0); a = ap.parse_args()
    gdal.UseExceptions(); gdal.SetConfigOption('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
    corners = [to_ll(e, n) for e in (E0, E1) for n in (N0, N1)]
    keys = sorted({quadkey(lo, la) for la, lo in corners})
    vrt = gdal.BuildVRT('/vsimem/chm.vrt', ['/vsicurl/' + CHM.format(k) for k in keys])
    gt = vrt.GetGeoTransform(); band = vrt.GetRasterBand(1)
    mx = [merc(lo, la) for la, lo in corners]
    x0 = int((min(p[0] for p in mx) - gt[0]) / gt[1]) - 4; x1 = int((max(p[0] for p in mx) - gt[0]) / gt[1]) + 4
    y0 = int((max(p[1] for p in mx) - gt[3]) / gt[5]) - 4; y1 = int((min(p[1] for p in mx) - gt[3]) / gt[5]) + 4
    print(f'CHM tiles {keys}, window {x1 - x0}x{y1 - y0} px of {gt[1]:.3f} m (mercator)', flush=True)
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'ground')
    bmask, bstep = building_mask(root)
    cand = []                                    # (h, e, n)
    B, OV = 2048, 6
    for by in range(y0, y1, B):
        for bx in range(x0, x1, B):
            wx0, wy0 = max(x0, bx - OV), max(y0, by - OV); wx1, wy1 = min(x1, bx + B + OV), min(y1, by + B + OV)
            arr = band.ReadAsArray(wx0, wy0, wx1 - wx0, wy1 - wy0).astype(np.float32)
            arr[~np.isfinite(arr)] = 0; arr[arr > 80] = 0
            sm = uniform_filter(arr, 3)
            peak = (sm >= a.min_height_m) & (sm >= maximum_filter(sm, size=5))
            r, c = np.nonzero(peak)
            keep = (r + wy0 >= by) & (r + wy0 < by + B) & (c + wx0 >= bx) & (c + wx0 < bx + B)
            r, c = r[keep], c[keep]
            X = gt[0] + (c + wx0 + 0.5) * gt[1]; Y = gt[3] + (r + wy0 + 0.5) * gt[5]
            lon = np.degrees(X / R); lat = np.degrees(2 * np.arctan(np.exp(Y / R)) - np.pi / 2)
            e, n = to_en(lat, lon)
            ok = (e > E0) & (e < E1) & (n > N0) & (n < N1)
            for hh, ee, nn in zip(sm[r, c][ok], e[ok], n[ok]): cand.append((float(hh), float(ee), float(nn)))
            print(f'  block {by - y0},{bx - x0}: {int(ok.sum())} tops', flush=True)
    cand.sort(key=lambda t: -t[0])
    kept, bucket = [], {}
    for h, e, n in cand:
        ix, iy = int((e - E0) / bstep), int((N1 - n) / bstep)
        if 0 <= iy < bmask.shape[0] and 0 <= ix < bmask.shape[1] and bmask[iy, ix]: continue
        rad = min(6.0, max(2.0, 0.25 * h)); gx, gz = int(e // 6), int(n // 6); clash = False
        for i in range(gx - 1, gx + 2):
            for j in range(gz - 1, gz + 2):
                for k in bucket.get((i, j), ()):
                    ke, kn, kh = kept[k]
                    if (ke - e) ** 2 + (kn - n) ** 2 < max(rad, min(6.0, max(2.0, 0.25 * kh))) ** 2: clash = True; break
                if clash: break
            if clash: break
        if clash: continue
        bucket.setdefault((gx, gz), []).append(len(kept)); kept.append((e, n, h))
    # second pass: measured crown radius per kept top (cells within 6 m reaching 60% of its height)
    K = np.array(kept, dtype=np.float64) if kept else np.zeros((0, 3))
    lat = LAT0 + K[:, 1] / 111320.0; lon = LON0 + K[:, 0] / (111320.0 * np.cos(np.radians((lat + LAT0) / 2)))
    MX = np.radians(lon) * R; MY = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * R
    PX = ((MX - gt[0]) / gt[1]).astype(int); PY = ((MY - gt[3]) / gt[5]).astype(int)
    crown = np.full(len(K), 2.0); W = 5
    for by in range(y0, y1, B):
        for bx in range(x0, x1, B):
            sel = np.nonzero((PX >= bx) & (PX < bx + B) & (PY >= by) & (PY < by + B))[0]
            if not len(sel): continue
            wx0, wy0 = bx - W, by - W; wx1, wy1 = min(x1 + W, bx + B + W), min(y1 + W, by + B + W)
            arr = band.ReadAsArray(max(0, wx0), max(0, wy0), wx1 - max(0, wx0), wy1 - max(0, wy0)).astype(np.float32)
            arr[~np.isfinite(arr)] = 0; arr[arr > 80] = 0
            sm = np.pad(uniform_filter(arr, 3), ((max(0, wy0) - wy0, 0), (max(0, wx0) - wx0, 0)))
            sm = np.pad(sm, ((0, 2 * W + 1), (0, 2 * W + 1)))
            win = sliding_window_view(sm, (2 * W + 1, 2 * W + 1))[PY[sel] - by, PX[sel] - bx]
            # walk 8 rays out from the top: crown edge = first cell below 60% of the top height (neighbouring crowns,
            # whose saddle stays high, read as wide; an isolated narrow head reads as narrow)
            thr = 0.6 * K[sel, 2]; dist = []
            for dy, dx in ((0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1)):
                prof = np.stack([win[:, W + dy * k, W + dx * k] for k in range(1, W + 1)], 1) < thr[:, None]
                first = np.where(prof.any(1), prof.argmax(1) + 0.5, W + 1.0) * math.hypot(dx, dy)
                dist.append(first)
            crown[sel] = np.median(np.stack(dist, 1), 1) * gt[1] * math.cos(math.radians(LAT0))
    palm = (K[:, 2] >= 6) & (K[:, 2] <= 24) & (crown >= 1.2) & (crown <= 2.6)
    out = bytearray()
    for (e, n, h), rad, pm in zip(K, crown, palm):
        out += struct.pack('<HHBBB', int(round((e - E0) * 4)), int(round((n - N0) * 4)), min(255, int(round(h * 4))), min(255, int(round(min(9.0, max(1.2, rad)) * 20))), int(pm))
    print(f'crown radius p10/p50/p90 {np.percentile(crown, 10):.1f}/{np.percentile(crown, 50):.1f}/{np.percentile(crown, 90):.1f} m; palms {int(palm.sum())} ({100 * palm.mean():.0f}%)')
    open(os.path.join(root, 'trees.bin'), 'wb').write(out)
    hs = np.array([k[2] for k in kept])
    json.dump({'source': 'Meta / World Resources Institute High Resolution Canopy Height Maps (Tolan et al. 2024)', 'licence': 'CC BY 4.0',
               'attribution': 'Canopy height: Meta and World Resources Institute, CC BY 4.0', 'chm_tiles': keys, 'count': len(kept),
               'height_p50_p95_max': [float(np.percentile(hs, 50)), float(np.percentile(hs, 95)), float(hs.max())] if len(hs) else None,
               'e0': E0, 'e1': E1, 'n0': N0, 'n1': N1, 'encoding': 'u16 (e-e0)*4, u16 (n-n0)*4, u8 height*4, u8 crown_radius*20, u8 kind (0 broadleaf, 1 palm proxy)'},
              open(os.path.join(root, 'trees.json'), 'w'), indent=1)
    print(f'trees {len(kept)} from {len(cand)} tops; height p50/p95/max {np.percentile(hs, 50):.1f}/{np.percentile(hs, 95):.1f}/{hs.max():.1f} m; {len(out)} bytes')

if __name__ == '__main__':
    sys.exit(main())
