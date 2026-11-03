"""Fetch surface observations around the N722BD event (16:30Z-18:30Z 1 Nov 2026).

Source: Iowa Environmental Mesonet ASOS/AWOS archive (NWS/FAA METARs, US Government data, public domain):
    https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py
    data=metar,tmpf,dwpf,drct,sknt,gust,vsby,alti,skyc1-4,skyl1-4,wxcodes; tz=Etc/UTC; format=onlycomma

Station note: Palm Beach International now reports under ICAO KDJT (the FAA identifier change from PBI);
the IEM archive keeps the whole record under id DJT ("WEST PALM BEACH", archive from 1938). Station names
in the output use the sim's KPBI label with the reporting id alongside. The KDJT feed contains both the
routine/special METARs and the 5-minute MADIS high-frequency (MADISHF) AUTO reports, which often have
the wind direction missing (/////G26KT); all are kept, flagged by `hf`.

Usage: python tools/fetch_metar.py [--cache DIR] [--out data/metar.json]
Output: {source, licence, stations:{KPBI:{report_id, obs:[...]}, ...}, summary_kpbi_1747z:{...}}
Units: temperatures C, wind kt (dir deg true), visibility statute miles and metres, cloud bases metres AGL.
"""
import argparse, csv, io, json, os, re, urllib.parse, urllib.request
from datetime import datetime, timezone

UA = 'machtuck-sim-asset-builder'
BASE = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py'
STATIONS = [('KPBI', 'DJT'), ('KLNA', 'LNA'), ('KF45', 'F45'), ('KBCT', 'BCT'), ('KFXE', 'FXE'), ('KSUA', 'SUA')]
FIELDS = ['metar', 'tmpf', 'dwpf', 'drct', 'sknt', 'gust', 'vsby', 'alti', 'skyc1', 'skyc2', 'skyc3', 'skyc4',
          'skyl1', 'skyl2', 'skyl3', 'skyl4', 'wxcodes']
T_EVENT = datetime(2026, 11, 1, 17, 47, tzinfo=timezone.utc)


def fnum(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def f2c(f):
    return None if f is None else round((f - 32) * 5 / 9, 1)


def parse_raw(raw):
    """Fill gaps from the raw METAR text (wind group, precise T/Td from the RMK T group)."""
    out = {}
    m = re.search(r'\s(\d{3}|VRB|///)(\d{2,3}|//)(?:G(\d{2,3}))?KT\b', ' ' + raw)
    if m:
        out['wdir_raw'] = None if m.group(1) in ('VRB', '///') else int(m.group(1))
        out['vrb'] = m.group(1) == 'VRB'
        out['wspd_raw'] = None if m.group(2) == '//' else int(m.group(2))
        out['gust_raw'] = int(m.group(3)) if m.group(3) else None
    m = re.search(r'\bT([01])(\d{3})([01])(\d{3})\b', raw)
    if m:
        out['t_c_precise'] = (-1 if m.group(1) == '1' else 1) * int(m.group(2)) / 10
        out['td_c_precise'] = (-1 if m.group(3) == '1' else 1) * int(m.group(4)) / 10
    m = re.search(r'PK WND (\d{3})(\d{2,3})/(\d{2,4})', raw)
    if m:
        out['peak_wind'] = {'dir': int(m.group(1)), 'kt': int(m.group(2)), 'time': m.group(3)}
    out['ltg'] = ' '.join(re.findall(r'(?:FRQ |OCNL |CONS )?LTG[A-Z]*(?: DSNT| VC)? ?[A-Z\-]*(?: THRU [A-Z]+)?', raw)).strip() or None
    return out


def fetch(cache):
    os.makedirs(cache, exist_ok=True)
    q = [('station', s) for _, s in STATIONS] + [('data', f) for f in FIELDS] + [
        ('year1', 2026), ('month1', 11), ('day1', 1), ('hour1', 16), ('minute1', 30),
        ('year2', 2026), ('month2', 11), ('day2', 1), ('hour2', 18), ('minute2', 31),
        ('tz', 'Etc/UTC'), ('format', 'onlycomma'), ('latlon', 'no'), ('missing', 'M'), ('trace', 'T')]
    url = BASE + '?' + urllib.parse.urlencode(q)
    fn = os.path.join(cache, 'asos_20261101_1630_1830.csv')
    if not os.path.exists(fn):
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            open(fn, 'wb').write(r.read())
    return url, open(fn).read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.environ.get('MACHTUCK_CACHE', '/tmp/machtuck_cache'))
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'data', 'metar.json'))
    a = ap.parse_args()
    url, text = fetch(a.cache)
    label = {s: k for k, s in STATIONS}
    st = {k: {'report_id': 'K' + s, 'iem_id': s, 'obs': []} for k, s in STATIONS}
    for r in csv.DictReader(io.StringIO(text)):
        name = label.get(r['station'])
        if not name:
            continue
        valid = datetime.strptime(r['valid'], '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc)
        raw = r['metar']
        layers = []
        for i in range(1, 5):
            c, h = r.get(f'skyc{i}'), fnum(r.get(f'skyl{i}'))
            if c and c != 'M':
                layers.append({'cover': c, 'base_ft': h, 'base_m_agl': None if h is None else round(h * 0.3048)})
        vs = fnum(r['vsby'])
        p = parse_raw(raw)
        ob = {'valid': valid.strftime('%Y-%m-%dT%H:%MZ'), 't_sim_s': int((valid - T_EVENT).total_seconds()),
              'raw': raw, 'hf': 'MADISHF' in raw,
              't_c': p.get('t_c_precise', f2c(fnum(r['tmpf']))), 'td_c': p.get('td_c_precise', f2c(fnum(r['dwpf']))),
              'wdir_deg': fnum(r['drct']) if fnum(r['drct']) is not None else p.get('wdir_raw'),
              'wspd_kt': fnum(r['sknt']) if fnum(r['sknt']) is not None else p.get('wspd_raw'),
              'gust_kt': fnum(r['gust']) if fnum(r['gust']) is not None else p.get('gust_raw'),
              'vsby_sm': vs, 'vsby_m': None if vs is None else round(vs * 1609.34),
              'altim_inhg': fnum(r['alti']), 'wx': None if r['wxcodes'] in ('M', '') else r['wxcodes'],
              'clouds': layers}
        for k in ('peak_wind', 'ltg'):
            if p.get(k):
                ob[k] = p[k]
        st[name]['obs'].append(ob)
    for v in st.values():
        v['obs'].sort(key=lambda o: o['valid'])

    def nearest(obs, routine=False):
        c = [o for o in obs if not (routine and o['hf'])]
        return min(c, key=lambda o: abs(o['t_sim_s'])) if c else None

    def summ(o):
        if not o:
            return None
        return {k: o[k] for k in ('valid', 't_sim_s', 'raw', 'wdir_deg', 'wspd_kt', 'gust_kt', 'vsby_sm', 'vsby_m',
                                  'wx', 'clouds', 't_c', 'td_c', 'altim_inhg') if k in o}
    kp = st['KPBI']['obs']
    out = {
        'source': url,
        'licence': 'NWS/FAA METAR via Iowa Environmental Mesonet ASOS archive; US Government data, public domain',
        'note': 'KPBI reports as KDJT (IEM id DJT). t_sim_s relative to 17:47:00Z. hf = MADIS 5-min high-frequency '
                'AUTO report (wind direction often missing). Cloud bases metres AGL.',
        'stations': st,
        'summary_kpbi_1747z': {'nearest_any': summ(nearest(kp)), 'nearest_routine_metar': summ(nearest(kp, True))},
    }
    json.dump(out, open(a.out, 'w'), indent=1)
    for k, v in st.items():
        print(k, v['report_id'], len(v['obs']), 'obs')
    print(json.dumps(out['summary_kpbi_1747z'], indent=1))


if __name__ == '__main__':
    main()
