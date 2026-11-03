"""Fetch the KMFL (Miami) 12Z 1 Nov 2026 radiosonde and derive the levels the sim needs.

Source: Iowa Environmental Mesonet (IEM) RAOB JSON service, which redistributes the NWS/NCEI upper-air
observations (US Government data, public domain):
    https://mesonet.agron.iastate.edu/json/raob.py?ts=202611011200&station=KMFL
Falls back to MFL as station id, then to 00Z 2 Nov.

Usage: python tools/fetch_sounding.py [--cache DIR] [--out data/sounding_kmfl.json]
Writes {station, time, source, levels:[{p_hpa, z_m, t_c, td_c, wdir_deg, wspd_kt}], derived:{...}}.
z_m is geopotential height above mean sea level as reported.
Derived:
  freezing_level_m  - lowest height where T crosses 0 C going up (linear interpolation in z)
  m20c_level_m      - same for -20 C
  tropopause        - WMO lapse-rate tropopause: lowest level above 500 hPa where the lapse rate drops to
                      <= 2 K/km and the mean lapse rate to every level within the next 2 km stays <= 2 K/km
  wind_35000ft      - wind at 10668 m MSL, interpolated in u/v between bracketing reported winds
  surface_t_c       - first (surface) level temperature
"""
import argparse, json, math, os, sys, urllib.request

UA = 'machtuck-sim-asset-builder'
URL = 'https://mesonet.agron.iastate.edu/json/raob.py?ts={ts}&station={st}'


def get(url, cache):
    os.makedirs(cache, exist_ok=True)
    fn = os.path.join(cache, 'raob_' + url.split('?')[1].replace('&', '_').replace('=', '-') + '.json')
    if not os.path.exists(fn):
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        open(fn, 'wb').write(data)
    return json.load(open(fn))


def crossing(levels, key, value):
    for a, b in zip(levels, levels[1:]):
        if a[key] is None or b[key] is None:
            continue
        if (a[key] - value) * (b[key] - value) <= 0 and a[key] != b[key]:
            f = (value - a[key]) / (b[key] - a[key])
            return round(a['z_m'] + f * (b['z_m'] - a['z_m']), 1), round(a['p_hpa'] + f * (b['p_hpa'] - a['p_hpa']), 1)
    return None, None


def tropopause(levels):
    lv = [l for l in levels if l['t_c'] is not None and l['z_m'] is not None]
    for i in range(len(lv) - 1):
        if lv[i]['p_hpa'] > 500:
            continue
        dz = lv[i + 1]['z_m'] - lv[i]['z_m']
        if dz <= 0:
            continue
        lapse = -(lv[i + 1]['t_c'] - lv[i]['t_c']) / dz * 1000
        if lapse > 2:
            continue
        ok = True
        for j in range(i + 1, len(lv)):
            d = lv[j]['z_m'] - lv[i]['z_m']
            if d > 2000:
                break
            if d > 0 and -(lv[j]['t_c'] - lv[i]['t_c']) / d * 1000 > 2:
                ok = False
                break
        if ok:
            return {'z_m': lv[i]['z_m'], 'p_hpa': lv[i]['p_hpa'], 't_c': lv[i]['t_c'], 'method': 'WMO 2 K/km lapse-rate'}
    return None


def wind_at(levels, z):
    lv = [l for l in levels if l['wspd_kt'] is not None and l['wdir_deg'] is not None and l['z_m'] is not None]
    for a, b in zip(lv, lv[1:]):
        if a['z_m'] <= z <= b['z_m']:
            f = (z - a['z_m']) / (b['z_m'] - a['z_m'])
            def uv(l):
                r = math.radians(l['wdir_deg'])
                return -l['wspd_kt'] * math.sin(r), -l['wspd_kt'] * math.cos(r)
            ua, va = uv(a); ub, vb = uv(b)
            u, v = ua + f * (ub - ua), va + f * (vb - va)
            spd = math.hypot(u, v)
            d = (math.degrees(math.atan2(-u, -v)) + 360) % 360
            t = None
            if a['t_c'] is not None and b['t_c'] is not None:
                t = round(a['t_c'] + f * (b['t_c'] - a['t_c']), 1)
            p = round(math.exp(math.log(a['p_hpa']) + f * (math.log(b['p_hpa']) - math.log(a['p_hpa']))), 1)
            return {'z_m': z, 'p_hpa': p, 'wdir_deg': round(d), 'wspd_kt': round(spd, 1), 't_c': t,
                    'bracket_m': [a['z_m'], b['z_m']]}
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.environ.get('MACHTUCK_CACHE', '/tmp/machtuck_cache'))
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'data', 'sounding_kmfl.json'))
    a = ap.parse_args()
    prof = None
    for ts in ('202611011200', '202611020000'):
        for st in ('KMFL', 'MFL'):
            url = URL.format(ts=ts, st=st)
            try:
                d = get(url, a.cache)
            except Exception as e:
                print('fetch failed', url, e, file=sys.stderr)
                continue
            if d.get('profiles') and d['profiles'][0].get('profile'):
                prof, used = d['profiles'][0], url
                break
        if prof:
            break
    if not prof:
        sys.exit('no KMFL sounding found')
    levels = []
    for r in prof['profile']:
        if r.get('pres') is None or r.get('hght') is None:
            continue
        levels.append({'p_hpa': r['pres'], 'z_m': round(r['hght'], 1), 't_c': r.get('tmpc'), 'td_c': r.get('dwpc'),
                       'wdir_deg': r.get('drct'), 'wspd_kt': r.get('sknt')})
    levels.sort(key=lambda l: -l['p_hpa'])
    fz, fp = crossing(levels, 't_c', 0.0)
    m20, m20p = crossing(levels, 't_c', -20.0)
    sfc = levels[0]
    out = {
        'station': prof['station'], 'time': prof['valid'], 'source': used,
        'licence': 'NWS radiosonde observation via Iowa Environmental Mesonet; US Government data, public domain',
        'note': 'z_m geopotential metres MSL; KMFL is ~100 km south of KPBI; 12Z is ~5.8 h before the event',
        'levels': levels,
        'derived': {
            'surface_t_c': sfc['t_c'], 'surface_td_c': sfc['td_c'], 'surface_p_hpa': sfc['p_hpa'],
            'freezing_level_m': fz, 'freezing_level_hpa': fp,
            'm20c_level_m': m20, 'm20c_level_hpa': m20p,
            'tropopause': tropopause(levels),
            'wind_35000ft': wind_at(levels, 35000 * 0.3048),
        },
    }
    json.dump(out, open(a.out, 'w'), indent=1)
    print(json.dumps(out['derived'], indent=1))
    print(len(levels), 'levels ->', a.out)


if __name__ == '__main__':
    main()
