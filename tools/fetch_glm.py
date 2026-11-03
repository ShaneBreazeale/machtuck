"""GOES-19 GLM lightning flashes within 80 km of KPBI, 17:44:00Z-17:52:00Z 1 Nov 2026.

Source: NOAA GOES-R GLM L2 Lightning Cluster-Filter Algorithm (LCFA) 20-second files, NOAA Open Data Dissemination
bucket (public domain, US Government data):
    https://noaa-goes19.s3.amazonaws.com/?list-type=2&prefix=GLM-L2-LCFA/2026/305/17/
Fields: flash_lat, flash_lon, flash_time_offset_of_first_event / _last_event (relative to the time in the variable's
units attribute), flash_energy (J), flash_area (m2), flash_quality_flag (flashes with a nonzero flag are kept but
counted in the summary).

Parallax: GLM L2 locations are navigated onto the GLM "lightning ellipsoid" (WGS84 inflated by 14 km at the equator
and 6 km at the poles, i.e. ~12.4 km above the surface at 26.7 N), which is itself a parallax correction for a cloud
of that height. For a nominal 12 km cloud top (--cloud-height) each flash is re-navigated: the line of sight from the
satellite (nominal_satellite_subpoint_lon, 35786023 m altitude) through the lightning-ellipsoid point is
intersected with WGS84 inflated by the cloud height. With 12 km the shift is ~0.3 km; with --cloud-height 0 you get
the uncorrected surface footprint (~8 km further north for these tops). Pass --cloud-height -1 to keep the raw
lightning-ellipsoid positions.

Output data/glm_flashes.json: {source, note, ..., flashes:[{t, dur, e, n, energy_fJ, area_km2}]} sorted by t, where
t = flash start in sim seconds relative to 17:47:00Z (2 decimals), dur = last - first event (s),
e/n = metres east/north of KPBI in the local projection of tools/grid_nexrad.py:
    north_m = (lat - 26.6832) * 111320; east_m = (lon + 80.0956) * 111320 * cos((lat + 26.6832) / 2)

Usage: python tools/fetch_glm.py [--cache DIR] [--out data/glm_flashes.json] [--cloud-height 12000]
Requires numpy, h5py.
"""
import argparse, json, math, os, re, sys, urllib.request
from datetime import datetime, timedelta, timezone
import numpy as np
import h5py

UA = 'machtuck-sim-asset-builder'
BUCKET = 'https://noaa-goes19.s3.amazonaws.com'
PREFIX = 'GLM-L2-LCFA/2026/305/17/'
PBI_LAT, PBI_LON = 26.6832, -80.0956
T0 = datetime(2026, 11, 1, 17, 47, 0, tzinfo=timezone.utc)
TS, TE = datetime(2026, 11, 1, 17, 44, tzinfo=timezone.utc), datetime(2026, 11, 1, 17, 52, tzinfo=timezone.utc)
RADIUS = 80000.0
STORM = (-15000.0, 3000.0)          # storm cell east/north of KPBI (m), for the rate summary
A_WGS, B_WGS = 6378137.0, 6356752.31414
LE_EQ, LE_POLE = 14000.0, 6000.0    # GLM lightning ellipsoid inflation
SAT_ALT = 35786023.0


def list_keys(cache):
    fn = os.path.join(cache, 'glm_list_' + PREFIX.replace('/', '_') + '.txt')
    if not os.path.exists(fn):
        url = f'{BUCKET}/?list-type=2&prefix={PREFIX}'
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
            open(fn, 'w').write('\n'.join(re.findall(r'<Key>([^<]+)</Key>', r.read().decode())))
    return open(fn).read().split()


def t_of(key, tag):
    m = re.search(rf'_{tag}(\d{{4}})(\d{{3}})(\d{{2}})(\d{{2}})(\d{{2}})(\d)', key)
    y, doy, hh, mm, ss, ts = map(int, m.groups())
    return datetime(y, 1, 1, tzinfo=timezone.utc) + timedelta(days=doy - 1, hours=hh, minutes=mm, seconds=ss + ts / 10)


def download(key, cache):
    fn = os.path.join(cache, key.split('/')[-1])
    if not os.path.exists(fn):
        with urllib.request.urlopen(urllib.request.Request(f'{BUCKET}/{key}', headers={'User-Agent': UA}), timeout=120) as r:
            open(fn + '.part', 'wb').write(r.read())
        os.rename(fn + '.part', fn)
    return fn


def var(f, name):
    v = f[name]; x = v[()]
    if v.attrs.get('_Unsigned', b'') in (b'true', 'true') and x.dtype.kind == 'i':
        x = x.view(x.dtype.str.replace('i', 'u'))
    fill = v.attrs.get('_FillValue')
    x = x.astype(np.float64)
    if fill is not None:
        fv = int(fill[0]) & ((1 << (8 * v.dtype.itemsize)) - 1) if v.dtype.kind == 'i' else float(fill[0])
        x[x == fv] = np.nan
    if 'scale_factor' in v.attrs:
        x = x * float(v.attrs['scale_factor'][0]) + float(v.attrs.get('add_offset', [0.0])[0])
    return x


def ecef_on(lat, lon, A, B, lon0):
    phi, dl = np.radians(lat), np.radians(lon - lon0)
    d = np.sqrt(A * A * np.cos(phi) ** 2 + B * B * np.sin(phi) ** 2)
    rxy = A * A * np.cos(phi) / d
    return np.stack([rxy * np.cos(dl), rxy * np.sin(dl), B * B * np.sin(phi) / d], -1)


def renavigate(lat, lon, sat_lon, h):
    """Move points from the lightning ellipsoid to WGS84 inflated by h along the satellite line of sight."""
    P = ecef_on(lat, lon, A_WGS + LE_EQ, B_WGS + LE_POLE, sat_lon)
    S = np.array([A_WGS + SAT_ALT, 0.0, 0.0])
    D = P - S; D /= np.linalg.norm(D, axis=-1, keepdims=True)
    A, B = A_WGS + h, B_WGS + h
    w = np.array([1 / A ** 2, 1 / A ** 2, 1 / B ** 2])
    qa = (D * D * w).sum(-1); qb = 2 * (S * D * w).sum(-1); qc = (S * S * w).sum() - 1
    t = (-qb - np.sqrt(qb * qb - 4 * qa * qc)) / (2 * qa)       # first intersection (satellite side)
    Q = S + t[:, None] * D
    lat2 = np.degrees(np.arctan2(Q[:, 2] * (A / B) ** 2, np.hypot(Q[:, 0], Q[:, 1])))
    lon2 = np.degrees(np.arctan2(Q[:, 1], Q[:, 0])) + sat_lon
    return lat2, lon2


def to_local(lat, lon):
    n = (lat - PBI_LAT) * 111320.0
    e = (lon - PBI_LON) * 111320.0 * np.cos(np.radians((lat + PBI_LAT) / 2))
    return e, n


def main():
    ap = argparse.ArgumentParser()
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    ap.add_argument('--cache', default=os.environ.get('MACHTUCK_CACHE', '/tmp/machtuck_cache'))
    ap.add_argument('--out', default=os.path.join(root, 'data', 'glm_flashes.json'))
    ap.add_argument('--cloud-height', type=float, default=12000.0)
    a = ap.parse_args()
    cache = os.path.join(a.cache, 'glm'); os.makedirs(cache, exist_ok=True)
    keys = [k for k in list_keys(cache) if TS <= t_of(k, 's') < TE]
    keys.sort()
    rows, nfiles, sat_lon, bad_q = [], 0, None, 0
    for k in keys:
        f = h5py.File(download(k, cache), 'r')
        nfiles += 1
        if f['flash_lat'].shape[0] == 0:
            continue
        units = f['flash_time_offset_of_first_event'].attrs['units'].decode()
        mu = re.search(r'since (\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d(?:\.\d*)?)', units)
        Y, M, D, hh, mm = map(int, mu.groups()[:5])
        ref = datetime(Y, M, D, hh, mm, tzinfo=timezone.utc) + timedelta(seconds=float(mu.group(6)))
        sl = float(f['nominal_satellite_subpoint_lon'][()])
        sat_lon = sl if sl > -900 else -75.2
        lat, lon = var(f, 'flash_lat'), var(f, 'flash_lon')
        t1, t2 = var(f, 'flash_time_offset_of_first_event'), var(f, 'flash_time_offset_of_last_event')
        en, ar = var(f, 'flash_energy'), var(f, 'flash_area')
        q = var(f, 'flash_quality_flag')
        if a.cloud_height >= 0:
            lat, lon = renavigate(lat, lon, sat_lon, a.cloud_height)
        e, n = to_local(lat, lon)
        m = np.hypot(e, n) <= RADIUS
        t0 = (ref - T0).total_seconds()
        for i in np.nonzero(m)[0]:
            if q[i] and not np.isnan(q[i]):
                bad_q += 1
            rows.append({'t': round(t0 + t1[i], 2), 'dur': round(max(t2[i] - t1[i], 0.0), 3),
                         'e': round(float(e[i])), 'n': round(float(n[i])),
                         'energy_fJ': None if np.isnan(en[i]) else round(en[i] * 1e15, 1),
                         'area_km2': None if np.isnan(ar[i]) else round(ar[i] / 1e6, 1)})
    rows.sort(key=lambda r: r['t'])
    # summary
    span = (TE - TS).total_seconds() / 60
    def within(r, km):
        return math.hypot(r['e'] - STORM[0], r['n'] - STORM[1]) <= km * 1000
    per_min = {}
    for r in rows:
        if within(r, 20):
            mi = math.floor(r['t'] / 60)
            per_min[mi] = per_min.get(mi, 0) + 1
    summ = {'files': nfiles, 'flashes_80km': len(rows), 'rate_80km_per_min': round(len(rows) / span, 1),
            'flashes_within_10km_of_storm': sum(within(r, 10) for r in rows),
            'flashes_within_20km_of_storm': sum(within(r, 20) for r in rows),
            'rate_within_20km_per_min': round(sum(within(r, 20) for r in rows) / span, 1),
            'per_minute_within_20km': {f'{(T0 + timedelta(minutes=k)).strftime("%H:%MZ")}': v for k, v in sorted(per_min.items())},
            'flashes_with_nonzero_quality_flag': bad_q}
    out = {
        'source': f'NOAA GOES-19 GLM L2 LCFA, {BUCKET}/{PREFIX} ({nfiles} files, 17:44:00Z-17:52:00Z)',
        'licence': 'NOAA/NESDIS GOES-R data, US Government work, public domain',
        'note': ('t = flash start, sim seconds rel. 17:47:00Z; dur = last-first optical event (s); e/n metres from KPBI '
                 '(local flat projection, x=east z=north). GLM pixels are ~8x10 km here, so a flash centroid is good '
                 'to a few km. Positions re-navigated from the GLM lightning ellipsoid (+14 km eq / +6 km pole, '
                 '~12.4 km here) to a %s cloud height along the satellite line of sight (satellite lon %.1f).'
                 % ('%.0f m' % a.cloud_height if a.cloud_height >= 0 else 'raw lightning-ellipsoid', sat_lon or -75.2)),
        'cloud_height_m': a.cloud_height, 'radius_m': RADIUS, 'storm_ref_e_n_m': list(STORM),
        'summary': summ,
        'flashes': rows,
    }
    json.dump(out, open(a.out, 'w'), separators=(',', ':'))
    print(json.dumps(summ, indent=1))


if __name__ == '__main__':
    main()
