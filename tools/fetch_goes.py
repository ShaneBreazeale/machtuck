"""GOES-19 (GOES-East) ABI cloud fields around KPBI for the N722BD event (1 Nov 2026, day 305).

Source: NOAA GOES-R ABI L1b CONUS radiances, NOAA Open Data Dissemination bucket (public domain, US Government data):
    https://noaa-goes19.s3.amazonaws.com/?list-type=2&prefix=ABI-L1b-RadC/2026/305/17/
Bands: C02 (0.64 um, 0.5 km) -> reflectance factor = kappa0 * Rad (no solar-zenith normalisation);
       C13 (10.3 um, 2 km)  -> brightness temperature BT = (fk2 / ln(fk1/Rad + 1) - bc1) / bc2.
Scans used: the CONUS scans starting nearest 17:46Z and 17:51Z.

Navigation: standard GOES-R fixed-grid projection (PUG vol. 3 sec. 4.2.8) from the goes_imager_projection
attributes, applied in the forward direction: for each output pixel (local KPBI grid, see below) and a trial height
h the geodetic point (lat, lon, h) is converted to ECEF and to scan angles (x, y), then Rad is bilinearly sampled.

Parallax correction (default on, --no-parallax to disable): GOES-19 sits at 75.2 W, so at 26.7 N / 80 W a 13 km
cloud top appears ~8 km north (and a little west) of where it is. For each output pixel P the trial heights
h = 0..18 km (250 m steps) are tested: BT13 is sampled along the line of sight through (P, h) and converted to a
cloud-top height H(BT). The largest h with |H - h| <= 750 m is taken as the true top over P (h = 0 is accepted when
the pixel is clear). Pixels with no consistent height are the ground hidden behind tall cloud as seen from the
satellite; they are filled from the nearest consistent pixel. All channels are then sampled along the chosen line
of sight, so R/G/B/A stay co-registered with the NEXRAD grids and the ground imagery.

Cloud-top height from BT13: the KMFL 12Z sounding (data/sounding_kmfl.json, tools/fetch_sounding.py): the lowest
height where the sounding temperature equals BT. BT colder than the tropopause minimum is extrapolated above the
tropopause at 7.3 K/km (overshooting top; capped at 20 km). BT within 3 K of the surface temperature (or warmer) -> 0.

Cloud mask (A): cloudy if BT13 < Tsfc - 8 K, or (reflectance > 0.30 and BT13 < Tsfc - 3 K).

Output grid: east -150000..+150000 m, north -150000..+150000 m, 1024x1024, row 0 = north edge, column 0 = west
edge, pixel centres at e0 + (i + 0.5) * dx. Local projection (same as tools/grid_nexrad.py), origin KPBI:
    north_m = (lat - 26.6832) * 111320; east_m = (lon + 80.0956) * 111320 * cos((lat + 26.6832) / 2)
Files: data/goes/goes_HHMM.png (RGBA8: R reflectance*255, G cloud-top height / 100 m, B BT13 - 180 K,
A 255 = cloudy) and data/goes/goes.json.

Usage: python tools/fetch_goes.py [--cache DIR] [--out data/goes] [--sounding data/sounding_kmfl.json]
Requires numpy, h5py, scipy, pillow.
"""
import argparse, json, math, os, re, sys, urllib.request
from datetime import datetime, timedelta, timezone
import numpy as np
import h5py
from scipy.ndimage import map_coordinates, distance_transform_edt
from PIL import Image

UA = 'machtuck-sim-asset-builder'
BUCKET = 'https://noaa-goes19.s3.amazonaws.com'
PREFIX = 'ABI-L1b-RadC/2026/305/17/'
PBI_LAT, PBI_LON = 26.6832, -80.0956
E0, E1, N0, N1, NPIX = -150000, 150000, -150000, 150000, 1024
T0 = datetime(2026, 11, 1, 17, 47, 0, tzinfo=timezone.utc)
TARGETS = ['1746', '1751']
HSTEP, HMAX, HTOL = 250.0, 18000.0, 750.0


def list_bucket(prefix, cache):
    fn = os.path.join(cache, 'list_' + prefix.replace('/', '_') + '.txt')
    if os.path.exists(fn):
        return open(fn).read().split()
    keys, token = [], None
    while True:
        url = f'{BUCKET}/?list-type=2&prefix={prefix}' + (f'&continuation-token={urllib.request.quote(token)}' if token else '')
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
            xml = r.read().decode()
        keys += re.findall(r'<Key>([^<]+)</Key>', xml)
        m = re.search(r'<NextContinuationToken>([^<]+)</NextContinuationToken>', xml)
        if not m:
            break
        token = m.group(1)
    open(fn, 'w').write('\n'.join(keys))
    return keys


def download(key, cache):
    fn = os.path.join(cache, key.split('/')[-1])
    if not os.path.exists(fn):
        print('download', key, file=sys.stderr)
        req = urllib.request.Request(f'{BUCKET}/{key}', headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=300) as r, open(fn + '.part', 'wb') as f:
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                f.write(b)
        os.rename(fn + '.part', fn)
    return fn


def scan_start(key):
    m = re.search(r'_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})(\d)_', key)
    y, doy, hh, mm, ss, ts = map(int, m.groups())
    return datetime(y, 1, 1, tzinfo=timezone.utc) + timedelta(days=doy - 1, hours=hh, minutes=mm, seconds=ss + ts / 10)


def scan_end(key):
    m = re.search(r'_e(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})(\d)_', key)
    y, doy, hh, mm, ss, ts = map(int, m.groups())
    return datetime(y, 1, 1, tzinfo=timezone.utc) + timedelta(days=doy - 1, hours=hh, minutes=mm, seconds=ss + ts / 10)


def local_grid():
    d = (E1 - E0) / NPIX
    e = E0 + (np.arange(NPIX) + 0.5) * d
    n = N1 - (np.arange(NPIX) + 0.5) * d            # row 0 = north edge
    E, N = np.meshgrid(e, n)
    lat = PBI_LAT + N / 111320.0
    lon = PBI_LON + E / (111320.0 * np.cos(np.radians((lat + PBI_LAT) / 2)))
    return lat, lon


class Band:
    def __init__(self, fn):
        f = h5py.File(fn, 'r')
        p = f['goes_imager_projection'].attrs
        self.a = float(p['semi_major_axis'][0]); self.b = float(p['semi_minor_axis'][0])
        self.H = float(p['perspective_point_height'][0]) + self.a
        self.lon0 = float(p['longitude_of_projection_origin'][0])
        xa, ya = f['x'].attrs, f['y'].attrs
        self.xs, self.xo = float(xa['scale_factor'][0]), float(xa['add_offset'][0])
        self.ys, self.yo = float(ya['scale_factor'][0]), float(ya['add_offset'][0])
        self.xi = f['x'][:].astype(np.float64); self.yi = f['y'][:].astype(np.float64)
        self.f = f
        self.rad_attrs = f['Rad'].attrs
        self.nrows = f['Rad'].shape[0]
        self.scalars = {k: float(f[k][()]) for k in ('kappa0', 'planck_fk1', 'planck_fk2', 'planck_bc1', 'planck_bc2')
                        if k in f}
        self.band = int(f['band_id'][0])

    def angles(self, lat, lon, h):
        """Scan angles (x, y) in rad of the geodetic point (lat, lon, height h m)."""
        e2 = 1 - (self.b / self.a) ** 2
        phi = np.radians(lat); dl = np.radians(lon - self.lon0)
        Nr = self.a / np.sqrt(1 - e2 * np.sin(phi) ** 2)
        X = (Nr + h) * np.cos(phi) * np.cos(dl)
        Y = (Nr + h) * np.cos(phi) * np.sin(dl)
        Z = (Nr * (1 - e2) + h) * np.sin(phi)
        sx, sy, sz = self.H - X, -Y, Z
        return np.arcsin(-sy / np.sqrt(sx * sx + sy * sy + sz * sz)), np.arctan(sz / sx)

    def index(self, lat, lon, h):
        x, y = self.angles(lat, lon, h)
        return (y - self.yo) / self.ys, (x - self.xo) / self.xs     # (row, col) fractional

    def load_window(self, r0, r1, c0, c1):
        raw = self.f['Rad'][r0:r1, c0:c1].view(np.uint16).astype(np.float64)
        fill = int(self.rad_attrs['_FillValue'][0]) & 0xFFFF
        rad = raw * float(self.rad_attrs['scale_factor'][0]) + float(self.rad_attrs['add_offset'][0])
        rad[raw == fill] = np.nan
        self.win = (r0, c0)
        if self.band == 2:
            self.field = self.scalars['kappa0'] * rad
        else:
            s = self.scalars
            with np.errstate(invalid='ignore', divide='ignore'):
                self.field = (s['planck_fk2'] / np.log(s['planck_fk1'] / rad + 1) - s['planck_bc1']) / s['planck_bc2']
        self.field = np.where(np.isfinite(self.field), self.field, np.nanmean(self.field))

    def sample(self, lat, lon, h):
        r, c = self.index(lat, lon, h)
        return map_coordinates(self.field, [r - self.win[0], c - self.win[1]], order=1, mode='nearest')


def window_for(band, lat, lon):
    rs, cs = [], []
    for h in (0.0, HMAX):
        r, c = band.index(lat[::32, ::32], lon[::32, ::32], h)
        rs += [r.min(), r.max()]; cs += [c.min(), c.max()]
    m = 8
    return (max(int(min(rs)) - m, 0), min(int(max(rs)) + m, band.nrows),
            max(int(min(cs)) - m, 0), min(int(max(cs)) + m, band.f['Rad'].shape[1]))


def height_lut(snd):
    lv = [l for l in snd['levels'] if l['t_c'] is not None]
    z = np.array([l['z_m'] for l in lv]); t = np.array([l['t_c'] for l in lv]) + 273.15
    trop = snd['derived']['tropopause']
    ztr = trop['z_m'] if trop else 16000.0
    tropo = z <= ztr
    zt, tt = z[tropo], t[tropo]
    tmin = tt.min(); zmin = zt[np.argmin(tt)]
    tsfc = snd['derived']['surface_t_c'] + 273.15
    bts = np.arange(150.0, 330.0, 0.1)
    hs = np.zeros_like(bts)
    for i, bt in enumerate(bts):
        if bt >= tsfc - 3:
            hs[i] = 0
        elif bt <= tmin:
            hs[i] = min(zmin + (tmin - bt) / 7.3 * 1000, 20000)
        else:
            k = np.nonzero(tt <= bt)[0][0]             # first level at or colder than BT, going up
            if k == 0:
                hs[i] = zt[0]
            else:
                f = (bt - tt[k - 1]) / (tt[k] - tt[k - 1])
                hs[i] = zt[k - 1] + f * (zt[k] - zt[k - 1])
    return bts, hs, tsfc, {'tropopause_min_t_k': round(float(tmin), 2), 'tropopause_min_z_m': float(zmin)}


def process(c02, c13, lat, lon, lut, parallax):
    bts, hs, tsfc, _ = lut
    zof = lambda bt: np.interp(bt, bts, hs)
    for b in (c02, c13):
        b.load_window(*window_for(b, lat, lon))
    if parallax:
        best = np.full(lat.shape, -1.0)
        for h in np.arange(0.0, HMAX + 1, HSTEP):
            H = zof(c13.sample(lat, lon, h))
            ok = np.abs(H - h) <= HTOL if h > 0 else H == 0
            best = np.where(ok, h, best)
        hidden = best < 0
        if hidden.any() and (~hidden).any():
            _, (ir, ic) = distance_transform_edt(hidden, return_indices=True)
            best = best[ir, ic]
        best = np.maximum(best, 0)
    else:
        best = np.zeros(lat.shape); hidden = np.zeros(lat.shape, bool)
    bt = c13.sample(lat, lon, best)
    ref = c02.sample(lat, lon, best)
    z = zof(bt)
    cloud = (bt < tsfc - 8) | ((ref > 0.30) & (bt < tsfc - 3))
    return ref, bt, z, cloud, best, hidden


def main():
    ap = argparse.ArgumentParser()
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    ap.add_argument('--cache', default=os.environ.get('MACHTUCK_CACHE', '/tmp/machtuck_cache'))
    ap.add_argument('--out', default=os.path.join(root, 'data', 'goes'))
    ap.add_argument('--sounding', default=os.path.join(root, 'data', 'sounding_kmfl.json'))
    ap.add_argument('--no-parallax', action='store_true')
    ap.add_argument('--preview', default=None, help='optional dir for false-colour preview PNGs')
    a = ap.parse_args()
    cache = os.path.join(a.cache, 'goes'); os.makedirs(cache, exist_ok=True); os.makedirs(a.out, exist_ok=True)
    snd = json.load(open(a.sounding))
    lut = height_lut(snd)
    keys = list_bucket(PREFIX, cache)
    lat, lon = local_grid()
    scans = []
    for tgt in TARGETS:
        tt = T0.replace(minute=int(tgt[2:]), hour=int(tgt[:2]))
        pick = {}
        for band in ('C02', 'C13'):
            ks = [k for k in keys if f'M6{band}_' in k or f'M3{band}_' in k]
            pick[band] = min(ks, key=lambda k: abs((scan_start(k) - tt).total_seconds()))
        c02, c13 = Band(download(pick['C02'], cache)), Band(download(pick['C13'], cache))
        ref, bt, z, cloud, best, hidden = process(c02, c13, lat, lon, lut, not a.no_parallax)
        st, en = scan_start(pick['C13']), scan_end(pick['C13'])
        # CONUS is scanned in north-to-south swaths: estimate when the KPBI rows were imaged
        r_pbi, _ = c13.index(np.array(PBI_LAT), np.array(PBI_LON), 0.0)
        frac = float(r_pbi) / c13.nrows
        t_local = st + (en - st) * frac
        hhmm = st.strftime('%H%M')
        rgba = np.zeros(lat.shape + (4,), np.uint8)
        rgba[..., 0] = np.clip(np.round(ref * 255), 0, 255)
        rgba[..., 1] = np.clip(np.round(z / 100), 0, 255)
        rgba[..., 2] = np.clip(np.round(bt - 180), 0, 255)
        rgba[..., 3] = np.where(cloud, 255, 0)
        png = os.path.join(a.out, f'goes_{hhmm}.png')
        Image.fromarray(rgba, 'RGBA').save(png, optimize=True)
        # storm check: ~15 km west / 3 km north of KPBI, report extremes within 8 km
        d = (E1 - E0) / NPIX
        ci, ri = int((-15000 - E0) / d), int((N1 - 3000) / d)
        k = int(8000 / d)
        sl = (slice(ri - k, ri + k), slice(ci - k, ci + k))
        imin = np.unravel_index(np.argmin(bt[sl]), bt[sl].shape)
        storm = {'center_e_n_m': [-15000, 3000], 'radius_m': 8000,
                 'min_bt_k': round(float(bt[sl].min()), 1), 'max_top_m': round(float(z[sl].max())),
                 'max_reflectance': round(float(ref[sl].max()), 3),
                 'coldest_at_e_n_m': [round(E0 + (ci - k + imin[1] + 0.5) * d), round(N1 - (ri - k + imin[0] + 0.5) * d)],
                 'bt_at_center_k': round(float(bt[ri, ci]), 1), 'top_at_center_m': round(float(z[ri, ci])),
                 'cloud_fraction': round(float(cloud[sl].mean()), 3)}
        scans.append({'file': os.path.basename(png), 'time_utc': t_local.strftime('%Y-%m-%dT%H:%M:%SZ'),
                      't_sim_s': round((t_local - T0).total_seconds(), 1),
                      'scan_start_utc': st.strftime('%Y-%m-%dT%H:%M:%S.%fZ')[:-5] + 'Z',
                      'scan_end_utc': en.strftime('%Y-%m-%dT%H:%M:%S.%fZ')[:-5] + 'Z',
                      'source_files': [pick['C02'].split('/')[-1], pick['C13'].split('/')[-1]],
                      'hidden_fraction': round(float(hidden.mean()), 4), 'storm_check': storm})
        print(hhmm, json.dumps(scans[-1]['storm_check']))
        if a.preview:
            os.makedirs(a.preview, exist_ok=True)
            Image.fromarray(rgba[..., 0]).save(os.path.join(a.preview, f'vis_{hhmm}.png'))
            Image.fromarray(np.clip((300 - bt) * 2, 0, 255).astype(np.uint8)).save(os.path.join(a.preview, f'ir_{hhmm}.png'))
            Image.fromarray(rgba[..., 1]).save(os.path.join(a.preview, f'z_{hhmm}.png'))
    meta = {
        'source': 'NOAA GOES-19 ABI L1b CONUS radiances (ABI-L1b-RadC), noaa-goes19 open-data bucket',
        'licence': 'NOAA/NESDIS GOES-R data, US Government work, public domain',
        'satellite_lon_deg': -75.0,
        'grid': {'e0': E0, 'e1': E1, 'n0': N0, 'n1': N1, 'width': NPIX, 'height': NPIX,
                 'row0': 'north edge', 'col0': 'west edge', 'origin': 'KPBI 26.6832 -80.0956',
                 'projection': 'north_m=(lat-26.6832)*111320; east_m=(lon+80.0956)*111320*cos(lat_mid)'},
        'encoding': {'R': 'C02 0.64um reflectance factor (kappa0*Rad), 0..1 -> 0..255, gamma 1',
                     'G': 'cloud-top height from BT13 vs KMFL 12Z sounding, units of 100 m (0..25.5 km), 0 = clear/surface',
                     'B': 'C13 10.3um brightness temperature, BT - 180 K, clamped 0..255',
                     'A': '255 = cloudy: BT13 < Tsfc-8 K or (refl > 0.30 and BT13 < Tsfc-3 K); Tsfc from sounding'},
        'parallax_corrected': not a.no_parallax,
        'parallax_method': 'per-pixel line-of-sight height consistency search (0..18 km, 250 m steps, 750 m tolerance); '
                           'ground hidden behind tall cloud filled from nearest consistent pixel',
        'height_lut': {'surface_t_k': round(lut[2], 2), **lut[3], 'overshoot_lapse_k_per_km': 7.3,
                       'clear_if_bt_within_k_of_surface': 3},
        'time_note': 'time_utc / t_sim_s estimate when the KPBI rows were imaged (CONUS scans north to south); '
                     't_sim_s relative to 17:47:00Z',
        'scans': scans,
    }
    json.dump(meta, open(os.path.join(a.out, 'goes.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
