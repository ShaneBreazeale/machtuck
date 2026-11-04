"""FAA CIFP (Coded Instrument Flight Procedures, ARINC 424-18) -> compact JSON navigation database for the sim.

The CIFP is the FAA's own coding of every US instrument procedure (SIDs, STARs, approaches with their missed
approaches and holds), plus runways, ILS, navaids, waypoints and airways. US Government data, public domain, 28-day
cycle. This script keeps the airports within --radius nm of --center, the enroute data around them, and resolves every
fix to coordinates, so the sim never hand-codes a procedure. NOT FOR NAVIGATION.

Output (data/nav/):
  index.json          cycle, centre, airport list (ident, name, position, elevation, magnetic variation)
  apt/<ICAO>.json     runways, localizer/glideslopes, terminal fixes, SIDs, STARs, approaches (legs, per transition)
  enroute.json        VHF navaids, NDBs, enroute waypoints, airways inside --radius + 100 nm

Usage: python tools/fetch_cifp.py [--url ...] [--center KDJT] [--radius 160] [--out data/nav] [--cache DIR]
Field positions: ARINC 424-18, 132-column records (checked against the KDJT ILS 10L records in this cycle).
"""
import argparse, io, json, math, os, re, sys, urllib.request, zipfile

UA = 'machtuck-sim-asset-builder'
DEFAULT_URL = 'https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_261029.zip'


def col(l, a, b):
    return l[a - 1:b]


def latlon(s9, s10):
    """N26405897 / W080061692 -> degrees"""
    try:
        lat = int(s9[1:3]) + int(s9[3:5]) / 60 + int(s9[5:9]) / 360000
        lon = int(s10[1:4]) + int(s10[4:6]) / 60 + int(s10[6:10]) / 360000
    except ValueError:
        return None
    return (-lat if s9[0] == 'S' else lat, -lon if s10[0] == 'W' else lon)


def num(s, scale=1.0):
    s = s.strip()
    try:
        return int(s) * scale if s else None
    except ValueError:
        return None


def magvar(s):
    """W0060 -> -6.0 (east positive); T0000 (true-referenced) -> 0"""
    s = s.strip()
    if len(s) < 4 or s[0] not in 'EWT':
        return None
    v = int(s[1:5]) / 10 if len(s) >= 5 else int(s[1:4])
    return -v if s[0] == 'W' else v


def nm(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 3440.065 * math.asin(math.sqrt(h))


def main():
    ap = argparse.ArgumentParser()
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    ap.add_argument('--url', default=DEFAULT_URL)
    ap.add_argument('--center', default='KDJT')
    ap.add_argument('--radius', type=float, default=160)
    ap.add_argument('--out', default=os.path.join(root, 'data', 'nav'))
    ap.add_argument('--cache', default=os.environ.get('MACHTUCK_CACHE', '/tmp/machtuck_cache'))
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    zpath = os.path.join(a.cache, os.path.basename(a.url))
    if not os.path.exists(zpath):
        req = urllib.request.Request(a.url, headers={'User-Agent': UA})
        open(zpath, 'wb').write(urllib.request.urlopen(req, timeout=300).read())
    z = zipfile.ZipFile(zpath)
    name = next(n for n in z.namelist() if os.path.basename(n).startswith('FAACIFP18'))
    lines = io.TextIOWrapper(z.open(name), encoding='latin-1').read().splitlines()
    hdr = next((l for l in lines if l.startswith('HDR')), '')
    m = re.search(r'CIFP_(\d{6})', a.url); cycle = m.group(1) if m else ''

    # ---------------- pass 1: index everything that can be a fix ----------------
    airports, vhf, ndb, enr, term = {}, {}, {}, {}, {}
    for l in lines:
        if len(l) < 132 or l[0] != 'S':
            continue
        sec, sub6 = l[4], l[5]
        if sec == 'P' and l[12] == 'A':
            p = latlon(col(l, 33, 41), col(l, 42, 51))
            if p:
                airports[col(l, 7, 10).strip()] = {'id': col(l, 7, 10).strip(), 'region': col(l, 11, 12), 'lat': p[0], 'lon': p[1],
                                                   'magvar': magvar(col(l, 52, 56)), 'elev': num(col(l, 57, 61)), 'name': col(l, 94, 123).strip()}
        elif sec == 'D' and sub6 in ' B' and col(l, 22, 22) in '01':
            p = latlon(col(l, 33, 41), col(l, 42, 51)) or latlon(col(l, 56, 64), col(l, 65, 74))
            if not p:
                continue
            ident, reg = col(l, 14, 17).strip(), col(l, 20, 21)
            rec = {'id': ident, 'region': reg, 'lat': p[0], 'lon': p[1], 'freq': num(col(l, 23, 27), 0.01 if sub6 == ' ' else 0.1),
                   'decl': magvar(col(l, 75, 79)), 'cls': col(l, 28, 32).strip(), 'name': col(l, 94, 123).strip(), 'airport': col(l, 7, 10).strip()}
            (vhf if sub6 == ' ' else ndb)[(ident, reg)] = rec
        elif sec == 'E' and sub6 == 'A':
            p = latlon(col(l, 33, 41), col(l, 42, 51))
            if p:
                enr[(col(l, 14, 18).strip(), col(l, 20, 21))] = {'id': col(l, 14, 18).strip(), 'region': col(l, 20, 21), 'lat': p[0], 'lon': p[1]}
        elif sec == 'P' and l[12] in 'CN' and col(l, 22, 22) in '01':   # continuation number: column 22 here, 39 in procedures
            p = latlon(col(l, 33, 41), col(l, 42, 51))
            if p:
                ident = col(l, 14, 18).strip() if l[12] == 'C' else col(l, 14, 17).strip()
                term[(col(l, 7, 10).strip(), ident)] = {'id': ident, 'lat': p[0], 'lon': p[1]}
    if a.center not in airports:
        sys.exit(f'{a.center} not in the CIFP')
    c0 = (airports[a.center]['lat'], airports[a.center]['lon'])
    keep = {k for k, v in airports.items() if nm(c0, (v['lat'], v['lon'])) <= a.radius}

    def fix(apt, ident, reg, sec, sub):
        """resolve a fix reference to {id, lat, lon}"""
        ident = ident.strip()
        if not ident:
            return None
        if sec == 'P' and sub == 'G':
            r = runways.get(apt, {}).get(ident)
            return r and {'id': ident, 'lat': r['lat'], 'lon': r['lon']}
        for cand in ((term.get((apt, ident)) if sec == 'P' else None), enr.get((ident, reg)) if sec == 'E' else None,
                     vhf.get((ident, reg)) if sec == 'D' and sub == ' ' else None, ndb.get((ident, reg)) if sec == 'D' and sub == 'B' else None,
                     term.get((apt, ident)), enr.get((ident, reg)), vhf.get((ident, reg)), ndb.get((ident, reg))):
            if cand:
                return {'id': ident, 'lat': cand['lat'], 'lon': cand['lon']}
        return None

    # ---------------- pass 2: runways and localizers of the kept airports ----------------
    runways, ils = {}, {}
    for l in lines:
        if len(l) < 132 or l[:5] != 'SUSAP' or col(l, 7, 10).strip() not in keep or col(l, 22, 22) not in '01':
            continue
        apt = col(l, 7, 10).strip()
        if l[12] == 'G':
            p = latlon(col(l, 33, 41), col(l, 42, 51))
            if p:
                runways.setdefault(apt, {})[col(l, 14, 18).strip()] = {
                    'id': col(l, 14, 18).strip(), 'lat': p[0], 'lon': p[1], 'length': num(col(l, 23, 27)), 'brgMag': num(col(l, 28, 31), 0.1),
                    'elev': num(col(l, 67, 71)), 'displaced': num(col(l, 72, 75)), 'tch': num(col(l, 76, 77)), 'width': num(col(l, 78, 80)),
                    'ils': col(l, 82, 85).strip() or None}
        elif l[12] == 'I':
            p = latlon(col(l, 33, 41), col(l, 42, 51)); g = latlon(col(l, 56, 64), col(l, 65, 74))
            if p:
                ils.setdefault(apt, {})[col(l, 14, 17).strip()] = {
                    'id': col(l, 14, 17).strip(), 'cat': col(l, 18, 18), 'freq': num(col(l, 23, 27), 0.01), 'runway': col(l, 28, 32).strip(),
                    'lat': p[0], 'lon': p[1], 'brgMag': num(col(l, 52, 55), 0.1), 'gsLat': g and g[0], 'gsLon': g and g[1],
                    'gsPos': num(col(l, 80, 83)), 'width': num(col(l, 84, 87), 0.01), 'gs': num(col(l, 88, 90), 0.01),
                    'decl': magvar(col(l, 91, 95)), 'tch': num(col(l, 96, 97)), 'gsElev': num(col(l, 98, 102))}

    # ILS DME antennas (airport VHF navaid records sharing the localizer ident)
    for apt, d in ils.items():
        for iid, rec in d.items():
            dme = next((v for (vid, _), v in vhf.items() if vid == iid and v['airport'] == apt), None)
            if dme:
                rec['dmeLat'], rec['dmeLon'] = dme['lat'], dme['lon']
    # ---------------- pass 3: procedures ----------------
    procs = {k: {'SID': {}, 'STAR': {}, 'APP': {}} for k in keep}
    navrefs = {k: {} for k in keep}
    kind = {'D': 'SID', 'E': 'STAR', 'F': 'APP'}
    for l in lines:
        if len(l) < 132 or l[:5] != 'SUSAP' or l[12] not in 'DEF' or col(l, 39, 39) not in '01':
            continue
        apt = col(l, 7, 10).strip()
        if apt not in keep:
            continue
        pid, rtype, trans = col(l, 14, 19).strip(), col(l, 20, 20), col(l, 21, 25).strip()
        desc = col(l, 40, 43)
        leg = {'seq': num(col(l, 27, 29)), 'pt': col(l, 48, 49).strip(), 'desc': desc, 'turn': col(l, 44, 44).strip() or None}
        f = fix(apt, col(l, 30, 34), col(l, 35, 36), col(l, 37, 37), col(l, 38, 38))
        if f:
            leg['fix'] = f
        flags = []
        if desc[1:2] == 'Y':
            flags.append('flyover')
        if desc[3:4] == 'F':
            flags.append('faf')
        if desc[3:4] == 'M':
            flags.append('map')
        if desc[3:4] in 'AC':
            flags.append('iaf')
        if flags:
            leg['flags'] = flags
        nav_id, nav_reg = col(l, 51, 54).strip(), col(l, 55, 56)
        if nav_id:
            n = vhf.get((nav_id, nav_reg)) or ndb.get((nav_id, nav_reg))
            loc = ils.get(apt, {}).get(nav_id)
            if loc:
                leg['nav'] = nav_id; navrefs[apt][nav_id] = {'id': nav_id, 'lat': loc['lat'], 'lon': loc['lon'], 'decl': loc['decl'], 'loc': True}
            elif n:
                leg['nav'] = nav_id; navrefs[apt][nav_id] = {'id': nav_id, 'lat': n['lat'], 'lon': n['lon'], 'decl': n['decl']}
        for k, (x, y, s) in {'arc': (57, 62, 0.001), 'theta': (63, 66, 0.1), 'rho': (67, 70, 0.1), 'crs': (71, 74, 0.1)}.items():
            v = num(col(l, x, y), s)
            if v is not None:
                leg[k] = v
        if col(l, 74, 74) == 'T':
            leg['crsTrue'] = True; leg['crs'] = num(col(l, 71, 73), 1)
        d = col(l, 75, 78)
        if d.startswith('T'):
            leg['time'] = num(d[1:], 0.1)
        elif d.strip():
            leg['dist'] = num(d, 0.1)
        ad, a1, a2 = col(l, 83, 83), col(l, 85, 89), col(l, 90, 94)
        alt = lambda s: (num(s[2:]) * 100 if s.startswith('FL') else num(s))
        if a1.strip():
            leg['alt'] = {'d': ad.strip() or '@', 'a1': alt(a1)}
            if a2.strip():
                leg['alt']['a2'] = alt(a2)
        spd = num(col(l, 100, 102))
        if spd:
            leg['spd'] = spd
        va = col(l, 103, 106).strip()
        if va:
            leg['vang'] = num(va, 0.01)
        cf = fix(apt, col(l, 107, 111), col(l, 112, 113), col(l, 114, 114), col(l, 115, 115)) if leg['pt'] in ('RF', 'AF') else None
        if cf:
            leg['ctr'] = cf
        p = procs[apt][kind[l[12]]].setdefault(pid, {'id': pid, 'trans': {}})
        p['trans'].setdefault(f'{rtype}:{trans}', []).append(leg)
    os.makedirs(os.path.join(a.out, 'apt'), exist_ok=True)
    rnd = lambda v: round(v, 6) if isinstance(v, float) else v

    def clean(o):
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items() if v is not None}
        if isinstance(o, list):
            return [clean(v) for v in o]
        return rnd(o)
    index = []
    for k in sorted(keep):
        apt = airports[k]
        if not runways.get(k) or not any(procs[k][t] for t in procs[k]):
            continue   # airports with instrument procedures only
        data = {'airport': apt, 'runways': runways.get(k, {}), 'ils': ils.get(k, {}), 'navaids': navrefs[k], 'procedures': procs[k]}
        json.dump(clean(data), open(os.path.join(a.out, 'apt', f'{k}.json'), 'w'), separators=(',', ':'))
        index.append({'id': k, 'name': apt['name'], 'lat': rnd(apt['lat']), 'lon': rnd(apt['lon']), 'elev': apt['elev'], 'magvar': apt['magvar'],
                      'procs': sum(len(v) for v in procs[k].values())})
    # ---------------- enroute: navaids, waypoints, airways near the area ----------------
    R = a.radius + 100
    inside = lambda p: nm(c0, (p['lat'], p['lon'])) <= R
    airways = {}
    for l in lines:
        if len(l) < 132 or l[:6] != 'SUSAER' or col(l, 39, 39) not in '01':
            continue
        f = fix('', col(l, 30, 34), col(l, 35, 36), col(l, 37, 37), col(l, 38, 38))
        if f:
            airways.setdefault(col(l, 14, 18).strip(), []).append({'seq': num(col(l, 26, 29)), **f, 'min': num(col(l, 84, 88)), 'max': num(col(l, 94, 98))})
    airways = {k: sorted(v, key=lambda x: x['seq']) for k, v in airways.items() if any(inside(p) for p in v)}
    enroute = {'vhf': [v for v in vhf.values() if inside(v) and not v['airport']], 'ndb': [v for v in ndb.values() if inside(v)],
               'waypoints': [v for v in enr.values() if inside(v)], 'airways': airways}
    json.dump(clean(enroute), open(os.path.join(a.out, 'enroute.json'), 'w'), separators=(',', ':'))
    # runway surfaces for the ground model and runway painting: pavement ends, landing thresholds, width, elevation
    rwys = []
    for k in [x['id'] for x in index]:
        rr = runways[k]
        for rid, r in rr.items():
            m = re.match(r'RW(\d\d)([LRC]?)', rid)
            if not m:
                continue
            opp = 'RW%02d%s' % ((int(m.group(1)) + 18 - 1) % 36 + 1, {'L': 'R', 'R': 'L', 'C': 'C', '': ''}[m.group(2)])
            if opp not in rr or rid > opp:
                continue
            o = rr[opp]
            rwys.append({'apt': k, 'ids': [rid[2:], opp[2:]], 'a': [rnd(r['lat']), rnd(r['lon'])], 'b': [rnd(o['lat']), rnd(o['lon'])],
                         'dispA': r.get('displaced') or 0, 'dispB': o.get('displaced') or 0, 'length': r.get('length'), 'width': r.get('width') or 100,
                         'elevA': r.get('elev'), 'elevB': o.get('elev')})
    json.dump(rwys, open(os.path.join(a.out, 'runways.json'), 'w'), separators=(',', ':'))
    json.dump({'cycle': cycle, 'source': a.url, 'center': a.center, 'radius_nm': a.radius, 'airports': index,
               'licence': 'FAA CIFP (ARINC 424-18): US Government work, public domain. Not for navigation.'},
              open(os.path.join(a.out, 'index.json'), 'w'), indent=1)
    print(f'{len(index)} airports, {len(enroute["vhf"])} VORs, {len(enroute["waypoints"])} waypoints, {len(airways)} airways', file=sys.stderr)


if __name__ == '__main__':
    main()
