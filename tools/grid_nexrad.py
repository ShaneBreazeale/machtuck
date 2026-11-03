"""Grid a NEXRAD Level II volume (KAMX) into a Cartesian reflectivity volume around KPBI.

Usage: python grid_nexrad.py <level2 file> <out basename>
Writes <out>.bin (uint8, dBZ encoded as (dBZ+10)*4, 0 = no echo) and <out>.json (grid metadata).
Grid axes: x = east (m), y = up (m), z = north (m), origin KPBI 10L/28R midpoint. Layout: [iz][iy][ix].
"""
import sys, json, math, numpy as np
from metpy.io import Level2File

RADAR_LAT, RADAR_LON = 25.6111, -80.4128      # KAMX
PBI_LAT, PBI_LON = 26.6832, -80.0956
# Grid: east -50..+30 km, north -45..+40 km, up 0..16 km, 500 m voxels
E0, E1, N0, N1, H0, H1, D = -50000, 30000, -45000, 40000, 0, 16000, 500
RE = 6371000 * 4 / 3

def main(path, out):
    f = Level2File(path)
    sweeps = []
    for sw in f.sweeps:
        rays = [r for r in sw if b'REF' in r[4]]
        if len(rays) < 100: continue
        el = float(np.mean([r[0].el_angle for r in rays]))
        az = np.array([r[0].az_angle for r in rays]) % 360
        hdr = rays[0][4][b'REF'][0]
        rng = (hdr.first_gate + np.arange(hdr.num_gates) * hdr.gate_width) * 1000.0   # MetPy gives km
        ng = min(r[4][b'REF'][1].shape[0] for r in rays)
        ref = np.array([r[4][b'REF'][1][:ng] for r in rays], dtype=float)
        ref = np.where(np.isfinite(ref), ref, -30.0)
        order = np.argsort(az); az, ref = az[order], ref[order]
        sweeps.append((el, az, rng[:ng], ref))
    sweeps.sort(key=lambda s: s[0])
    els = np.array([s[0] for s in sweeps])
    print('sweeps (el):', np.round(els, 2), 'time', f.dt)
    # radar offset from PBI in meters
    rn = (RADAR_LAT - PBI_LAT) * 111320.0
    re_ = (RADAR_LON - PBI_LON) * 111320.0 * math.cos(math.radians((RADAR_LAT + PBI_LAT) / 2))
    nx, ny, nz = int((E1 - E0) / D), int((H1 - H0) / D), int((N1 - N0) / D)
    xs = E0 + (np.arange(nx) + 0.5) * D; ys = H0 + (np.arange(ny) + 0.5) * D; zs = N0 + (np.arange(nz) + 0.5) * D
    Z, Y, X = np.meshgrid(zs, ys, xs, indexing='ij')
    dx, dz = X - re_, Z - rn
    s = np.hypot(dx, dz)                          # ground distance from radar
    azv = (np.degrees(np.arctan2(dx, dz)) + 360) % 360
    # beam geometry (4/3 earth): height h at slant range r and elevation e; invert for (r, e) from (s, h)
    h = Y + 4.0
    elv = np.degrees(np.arctan2(h - s * s / (2 * RE), s))
    rv = np.sqrt(s * s + (h - s * s / (2 * RE)) ** 2)
    out_v = np.full(X.shape, -30.0)
    # interpolate in elevation between adjacent sweeps; nearest in az and range
    idx = np.clip(np.searchsorted(els, elv) - 1, 0, len(els) - 2)
    e_lo, e_hi = els[idx], els[idx + 1]
    w = np.clip((elv - e_lo) / np.maximum(e_hi - e_lo, 1e-3), 0, 1)
    below = elv < els[0] - 0.3; above = elv > els[-1] + 0.5
    def sample(si, azq, rq):
        el, az, rng, ref = sweeps[si]
        ia = np.clip(np.searchsorted(az, azq) % len(az), 0, len(az) - 1)
        ir = np.clip(((rq - rng[0]) / (rng[1] - rng[0])).astype(int), 0, len(rng) - 1)
        v = ref[ia, ir]
        v = np.where(rq > rng[-1], -30.0, v)
        return v
    vlo = np.zeros_like(out_v); vhi = np.zeros_like(out_v)
    for si in range(len(sweeps) - 1):
        m = idx == si
        if not m.any(): continue
        vlo[m] = sample(si, azv[m], rv[m]); vhi[m] = sample(si + 1, azv[m], rv[m])
    out_v = vlo * (1 - w) + vhi * w
    # beam-gap softening: if one side is no-echo treat as linear fade rather than hard cut
    out_v = np.where(below | above, -30.0, out_v)
    enc = np.clip((out_v + 10) * 4, 0, 255).astype(np.uint8)
    enc[out_v < -9] = 0
    enc.tofile(out + '.bin')
    meta = {'file': path.split('/')[-1], 'time_utc': f.dt.isoformat(), 'x0': E0, 'y0': H0, 'z0': N0, 'd': D, 'nx': nx, 'ny': ny, 'nz': nz, 'encode': '(dBZ+10)*4, 0=no echo',
            'layout': '[north][up][east]', 'radar': 'KAMX', 'origin': 'KPBI'}
    json.dump(meta, open(out + '.json', 'w'), indent=1)
    # summary near the storm (east -15.3 km, north +3.2 km)
    ix, iz = int((-15300 - E0) / D), int((3200 - N0) / D)
    col = out_v[iz, :, ix]
    print('storm column dBZ by height (km):', ' '.join(f'{y/1000:.1f}:{v:.0f}' for y, v in zip(ys, col) if v > -5))
    top30 = ys[col > 30].max() if (col > 30).any() else 0
    print('30 dBZ top at storm column (ft):', round(top30 / 0.3048), '| max dBZ in grid', out_v.max().round(1), '| voxels>30dBZ', int((out_v > 30).sum()))
    # 30 dBZ max top anywhere within 10 km of the storm
    sub = out_v[iz-20:iz+20, :, ix-20:ix+20]
    tops = [ys[(sub[a, :, b] > 30)].max() for a in range(sub.shape[0]) for b in range(sub.shape[2]) if (sub[a, :, b] > 30).any()]
    print('max 30 dBZ top within 10 km (ft):', round(max(tops) / 0.3048) if tops else 0)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
