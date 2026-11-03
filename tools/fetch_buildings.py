"""Building footprints and heights around the impact area from Overture Maps (OpenStreetMap + Microsoft ML Buildings).

    pip install overturemaps pyarrow shapely numpy
    python3 tools/fetch_buildings.py [--parquet FILE]   # downloads with the overturemaps CLI unless FILE is given

Area: east -20000..-4000 m, north -16000..0 m from KPBI (the data/ground/site.jpg patch: Greenacres, western Palm
Beach County). Overture's buildings theme merges OpenStreetMap footprints with Microsoft ML Buildings; most carry a
measured total height (Microsoft's, from imagery). Output:
  data/ground/buildings.bin   per building: u8 vertex count n, u8 total height (0.25 m units), u8 flags (bit0 hip roof,
                              bit1 measured height), then n x (u16 east, u16 north) in 0.25 m units from (e0, n0)
  data/ground/buildings.json  bounds, counts, encoding, licence

Height: Overture `height` (total, including the roof), else `num_floors` x 3.2 m + 1 m, else 4.2 m. Hip roof: roof_shape
hipped/gabled/pyramidal, or no roof tag on a residential-sized footprint (< 600 m2, < 9 m, <= 12 vertices); the renderer
puts the eaves at height minus the roof rise. Rings are simplified to at most 64 vertices; interior rings are dropped.

Licence: Overture Maps buildings, ODbL 1.0 (OpenStreetMap contributors; Microsoft ML Buildings); https://overturemaps.org
The derived data/ground/buildings.bin is therefore also under the ODbL.
"""
import argparse, json, math, os, struct, subprocess, sys, tempfile

LAT0, LON0 = 26.6832, -80.0956
E0, E1, N0, N1 = -20000, -4000, -16000, 0

def to_ll(e, n):
    lat = LAT0 + n / 111320.0
    return lat, LON0 + e / (111320.0 * math.cos(math.radians((lat + LAT0) / 2)))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--parquet'); a = ap.parse_args()
    import numpy as np, pyarrow.parquet as pq, shapely
    pqf = a.parquet
    if not pqf:
        s, w = to_ll(E0, N0); n, e = to_ll(E1, N1)
        pqf = os.path.join(tempfile.mkdtemp(), 'buildings.parquet')
        subprocess.run(['overturemaps', 'download', f'--bbox={w:.5f},{s:.5f},{e:.5f},{n:.5f}', '-f', 'geoparquet', '--type=building', '-o', pqf], check=True)
    t = pq.read_table(pqf, columns=['geometry', 'height', 'num_floors', 'roof_shape', 'class', 'subtype', 'is_underground'])
    geoms = shapely.from_wkb(t.column('geometry').to_pylist())
    H, F, RS, CL, UG = (t.column(c).to_pylist() for c in ('height', 'num_floors', 'roof_shape', 'class', 'is_underground'))
    out, nb, measured, hips = bytearray(), 0, 0, 0
    for g, h, nf, rs, cl, ug in zip(geoms, H, F, RS, CL, UG):
        if g is None or ug: continue
        polys = list(g.geoms) if g.geom_type == 'MultiPolygon' else [g] if g.geom_type == 'Polygon' else []
        for p in polys:
            ring = np.asarray(p.exterior.coords)[:-1]
            if len(ring) < 3: continue
            lon, lat = ring[:, 0], ring[:, 1]
            en = np.c_[(lon - LON0) * 111320.0 * np.cos(np.radians((lat + LAT0) / 2)), (lat - LAT0) * 111320.0]
            if (en[:, 0] < E0).any() or (en[:, 0] > E1).any() or (en[:, 1] < N0).any() or (en[:, 1] > N1).any(): continue
            if len(en) > 64: en = en[::math.ceil(len(en) / 64)]
            area = 0.5 * abs(np.dot(en[:, 0], np.roll(en[:, 1], 1)) - np.dot(en[:, 1], np.roll(en[:, 0], 1)))
            if area < 8: continue
            m = h is not None and h > 1.5
            hh = h if m else (nf * 3.2 + 1.0 if nf else 4.2)
            hip = (rs in ('hipped', 'gabled', 'pyramidal')) or (rs is None and area < 600 and hh < 9 and len(en) <= 12 and cl not in ('garage', 'carport', 'shed', 'roof'))
            out += struct.pack('<BBB', len(en), min(255, int(round(hh * 4))), (1 if hip else 0) | (2 if m else 0))
            for x, y in en: out += struct.pack('<HH', int(round((x - E0) * 4)), int(round((y - N0) * 4)))
            nb += 1; measured += int(bool(m)); hips += int(bool(hip))
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'ground')
    open(os.path.join(root, 'buildings.bin'), 'wb').write(out)
    json.dump({'source': 'Overture Maps Foundation buildings theme (OpenStreetMap + Microsoft ML Buildings)', 'licence': 'ODbL 1.0',
               'attribution': '(c) OpenStreetMap contributors, Microsoft; Overture Maps Foundation', 'count': nb, 'measured_heights': measured, 'hip_roofs': hips,
               'e0': E0, 'e1': E1, 'n0': N0, 'n1': N1, 'encoding': 'u8 n, u8 total height*4, u8 flags(bit0 hip, bit1 measured height), n*(u16 (e-e0)*4, u16 (n-n0)*4)'},
              open(os.path.join(root, 'buildings.json'), 'w'), indent=1)
    print(f'buildings {nb}, measured heights {measured}, hip roofs {hips}, {len(out)} bytes')

if __name__ == '__main__':
    sys.exit(main())
