"""RNAV approach minimums for airports without plates -> data/nav/rnav_minimums.json.

Source: the FAA's "All Approaches - Master RNAVs" spreadsheet (Air Traffic Organization,
https://www.faa.gov/about/officeorg/headquartersoffices/ato/all-approaches-master-rnavs). It lists every US RNAV (GPS)
approach with its straight-in minimums: LNAV MDA and LNAV/VNAV DA, each with its height above touchdown (HAT) and
visibility. It is older than the plates: the LNAV and LNAV/VNAV sheets say "Published Effective 01/31/2019" in the
current file (MasterRNAVs-20211222.xlsx). The sim prefers the plates' minimums (tools/fetch_plates.py) and uses these
only where no plate is loaded, saying where they came from. The Learjet 60 has baro-VNAV, not WAAS, so the LPV lines
are not used. FAA data, public domain. NOT FOR NAVIGATION.

Output: {"source": url, "effective": {"LNAV": "2019-01-31", "LNAV/VNAV": "2019-01-31"},
         "airports": {"KFLL": {"RNAV (GPS) RWY 10R": {"LNAV": {"alt": 460, "hat": 446, "vis": "4000"}, ...}}}}

Usage: python tools/fetch_rnav_minimums.py [--nav data/nav] [--url ...] [--xlsx FILE]
"""
import argparse, io, json, os, re, sys, urllib.request, zipfile
import xml.etree.ElementTree as ET

UA = 'machtuck-sim-asset-builder'
PAGE = 'https://www.faa.gov/about/officeorg/headquartersoffices/ato/all-approaches-master-rnavs'
DEFAULT_URL = 'https://www.faa.gov/sites/faa.gov/files/2021-12/MasterRNAVs-20211222.xlsx'
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def xml(z, name):
    data = z.read(name)
    if b'<!DOCTYPE' in data[:2000]:                    # an .xlsx part never has one; refuse entity tricks outright
        raise ValueError(f'{name}: unexpected DOCTYPE')
    return ET.fromstring(data)


def sheets(z):
    """sheet name -> worksheet part, from the workbook and its relationships"""
    wb = z.read('xl/workbook.xml').decode()
    rels = z.read('xl/_rels/workbook.xml.rels').decode()
    target = {}
    for rel in re.findall(r'<Relationship [^>]*>', rels):
        i, t = re.search(r'Id="([^"]+)"', rel), re.search(r'Target="([^"]+)"', rel)
        if i and t:
            target[i.group(1)] = 'xl/' + t.group(1).lstrip('/').replace('xl/', '')
    out = {}
    for s in re.findall(r'<sheet [^>]*>', wb):
        n, r = re.search(r'name="([^"]+)"', s), re.search(r'r:id="([^"]+)"', s)
        if n and r and r.group(1) in target:
            out[n.group(1)] = target[r.group(1)]
    return out


def rows(z, part, strings):
    for r in xml(z, part).iter(NS + 'row'):
        cells = {}
        for c in r.findall(NS + 'c'):
            col = re.match(r'[A-Z]+', c.get('r')).group(0)
            v = c.find(NS + 'v')
            val = v.text if v is not None else ''
            if c.get('t') == 's' and val:
                val = strings[int(val)]
            elif c.get('t') == 'inlineStr':
                val = ''.join(t.text or '' for t in c.iter(NS + 't'))
            cells[col] = (val or '').strip()
        yield cells


def table(z, part, strings):
    """the sheet's rows as dicts keyed by its header row (the row that has 'FAA ID'), and the 'Published Effective' date"""
    head, eff, out = None, None, []
    for r in rows(z, part, strings):
        if head is None:
            m = re.search(r'Effective (\d+)/(\d+)/(\d{4})', ' '.join(r.values()))
            if m:
                eff = f'{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}'
            if any(v.upper().startswith('FAA ID') for v in r.values()):
                head = {k: re.sub(r'\s+', ' ', v).strip().upper() for k, v in r.items() if v}
            continue
        out.append({head[k]: v for k, v in r.items() if k in head})
    return out, eff


def num(s):
    try:
        return int(round(float(s)))
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--nav', default='data/nav')
    ap.add_argument('--url', default=DEFAULT_URL)
    ap.add_argument('--xlsx', help='use a downloaded copy instead of fetching')
    a = ap.parse_args()
    if a.xlsx:
        data = open(a.xlsx, 'rb').read()
    else:
        data = urllib.request.urlopen(urllib.request.Request(a.url, headers={'User-Agent': UA}), timeout=120).read()
    z = zipfile.ZipFile(io.BytesIO(data))
    strings = [''.join(t.text or '' for t in si.iter(NS + 't')) for si in xml(z, 'xl/sharedStrings.xml').findall(NS + 'si')]
    parts = sheets(z)

    index = json.load(open(os.path.join(a.nav, 'index.json')))
    faa = {}                                            # FAA location id -> ICAO used in data/nav
    for apt in index['airports']:
        i = apt['id']
        faa[i[1:] if len(i) == 4 and i[0] == 'K' else i] = i

    out, eff = {}, {}
    for line, sheet, dcol in (('LNAV', 'LNAVs', 'MDA'), ('LNAV/VNAV', 'LNAV-VNAVs', 'DA')):
        if sheet not in parts:
            print(f'no sheet {sheet!r}', file=sys.stderr)
            continue
        recs, eff[line] = table(z, parts[sheet], strings)
        n = 0
        for r in recs:
            icao = faa.get(r.get('FAA ID', ''))
            name = re.sub(r'\s+', ' ', r.get('PROCEDURE NAME', '')).strip()
            alt = num(r.get(dcol))
            if not icao or not name or alt is None:
                continue
            hat = num(r.get('HAT') or r.get('HAT OR HAA'))
            out.setdefault(icao, {}).setdefault(name, {})[line] = {'alt': alt, 'hat': hat, 'vis': r.get('VIS', '')}
            n += 1
        print(f'{line}: {n} approaches at our airports ({sheet}, effective {eff[line]})', file=sys.stderr)
    json.dump({'source': a.url, 'page': PAGE, 'effective': eff, 'airports': out},
              open(os.path.join(a.nav, 'rnav_minimums.json'), 'w'), indent=1, sort_keys=True)
    print(f'{sum(len(v) for v in out.values())} RNAV approaches at {len(out)} airports', file=sys.stderr)


if __name__ == '__main__':
    main()
