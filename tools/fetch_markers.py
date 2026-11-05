"""ILS marker beacons from the FAA NASR (eNASR) -> data/nav/markers.json.

The FAA CIFP (tools/fetch_cifp.py) has no marker records, so the outer, middle and inner markers come from the FAA's
National Airspace System Resource database, read through eNASR (https://enasr.faa.gov/eNASR/nasr/), current cycle.
Only the ILS already in data/nav (the airports within the CIFP radius) are looked up, one request each, a second
apart. Only markers whose status is OPERATIONAL are kept: most US markers are decommissioned (KDJT's in 2011), and a
decommissioned marker must stay silent in the cockpit. US Government data, public domain. NOT FOR NAVIGATION.

Output: data/nav/markers.json  {"cycle": "...", "airports": {"KMCO": {"ITFE": [{"type": "OM", "ident": "..",
        "name": "..", "lat": .., "lon": .., "elev": ..}]}}}

Usage: python tools/fetch_markers.py [--nav data/nav] [--cycle Current] [--delay 1.0]
Run it after tools/fetch_cifp.py; js/navdb.js attaches the markers to each ILS when it loads an airport.
"""
import argparse, json, os, re, sys, time, urllib.request

UA = 'machtuck-sim-asset-builder'
BASE = 'https://enasr.faa.gov/eNASR/nasr/{cycle}/ILS/'
TYPES = {'outer_marker_component': 'OM', 'middle_marker_component': 'MM', 'inner_marker_component': 'IM'}


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    return urllib.request.urlopen(req, timeout=60).read().decode('utf-8', 'replace')


def dms(s):
    """26-41-15.7191N -> degrees"""
    m = re.match(r'(\d+)-(\d+)-([\d.]+)([NSEW])$', (s or '').strip())
    if not m:
        return None
    v = int(m.group(1)) + int(m.group(2)) / 60 + float(m.group(3)) / 3600
    return -v if m.group(4) in 'SW' else v


def fields(seg):
    """the "name": ..., "value": ... pairs of one eNASR form section, first occurrence of each name"""
    out = {}
    for m in re.finditer(r'"name" : "(\w+)", "title" : "[^"]*", "value" : "([^"]*)"', seg):
        out.setdefault(m.group(1), m.group(2))
    return out


def markers(page):
    """marker components of one ILS detail page: [{type, status, ident, name, lat, lon, elev}]"""
    found = []
    starts = [(m.start(), TYPES[m.group(1)]) for m in re.finditer(r'"name" : "(\w+_marker_component)"', page) if m.group(1) in TYPES]
    for k, (at, typ) in enumerate(starts):
        end = starts[k + 1][0] if k + 1 < len(starts) else len(page)
        for stop in ('"name" : "ils_components"', '"name" : "glide_slope_component"'):   # the marker sections end there
            j = page.find(stop, at)
            if 0 < j < end:
                end = j
        f = fields(page[at:end])
        lat, lon = dms(f.get('latitude')), dms(f.get('longitude'))
        if lat is None or lon is None:
            continue
        found.append({'type': typ, 'status': f.get('status', ''), 'ident': f.get('ident', ''), 'name': f.get('name', ''),
                      'lat': round(lat, 6), 'lon': round(lon, 6), 'elev': float(f['elevation']) if f.get('elevation') else None})
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--nav', default='data/nav')
    ap.add_argument('--cycle', default='Current')
    ap.add_argument('--delay', type=float, default=1.0)
    a = ap.parse_args()
    index = json.load(open(os.path.join(a.nav, 'index.json')))
    base = BASE.format(cycle=a.cycle)

    # our ILS: (FAA location id without the K, localizer id without the I, runway) -> (ICAO, CIFP ILS id)
    want = {}
    for apt in index['airports']:
        p = os.path.join(a.nav, 'apt', f"{apt['id']}.json")
        if not os.path.exists(p):
            continue
        for iid, il in json.load(open(p)).get('ils', {}).items():
            lid = apt['id'][1:] if len(apt['id']) == 4 and apt['id'][0] == 'K' else apt['id']
            want[(lid, iid[1:] if iid.startswith('I') else iid, il['runway'].replace('RW', ''))] = (apt['id'], iid)
    print(f'{len(want)} ILS in {a.nav}', file=sys.stderr)

    # the eNASR list of every US ILS: localizer id, record id, airport, runway
    page = get(base + '?Airport_ID=')                                  # the bare URL is the query form; any query lists all
    rows = re.findall(r"\"ILS_Loc_ID\":\"<A comment='(\w+)' href=(\d+)[^}]*?\"Airport_ID\":\"(\w+)\",\"Site_No_Type\":\"[^\"]*\",\"Runway_ID\":\"([^\"]*)\"", page)
    print(f'{len(rows)} ILS in eNASR', file=sys.stderr)

    out, seen = {}, 0
    for loc, rec, apt, rwy in rows:
        key = (apt, loc, rwy)
        if key not in want:
            continue
        icao, iid = want[key]
        time.sleep(a.delay)
        try:
            ms = markers(get(base + rec))
        except Exception as e:                                         # a failed lookup leaves that ILS without markers
            print(f'  {icao} {iid}: {e}', file=sys.stderr)
            continue
        seen += 1
        live = [dict((k, v) for k, v in m.items() if k != 'status') for m in ms if m['status'].startswith('OPERATIONAL')]
        print(f"  {icao} {iid} RW{rwy}: {', '.join(m['type'] + ' ' + m['status'] for m in ms) or 'no markers'}", file=sys.stderr)
        if live:
            out.setdefault(icao, {})[iid] = live
    missing = len(want) - seen
    json.dump({'cycle': a.cycle, 'source': base, 'airports': out}, open(os.path.join(a.nav, 'markers.json'), 'w'), indent=1)
    print(f'{seen} ILS looked up ({missing} not found in eNASR), {sum(len(v) for v in out.values())} with operational markers', file=sys.stderr)


if __name__ == '__main__':
    main()
