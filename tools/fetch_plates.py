"""FAA terminal procedure charts (d-TPP): approach plates and minimums.

FAA d-TPP charts are US Government works (public domain). Each 28-day cycle publishes a metafile listing every chart.
The straight-in minimums (DA / MDA by aircraft category) are read from each plate's text layer: CIFP carries the
procedures but not their minimums. NOT FOR NAVIGATION: the sim ships one cycle.

Two outputs:
  --apt DJT   one airport's approach plates and airport diagram rendered to grayscale PNGs for the in-game viewer,
              with their minimums: data/plates/plates.json + PNGs
  --all       the minimums of every approach at every airport in data/nav/index.json, no images (376 charts would be
              ~64 MB of PNGs per cycle): data/plates/minimums.json, which also records each chart's PDF for a link

Usage: python tools/fetch_plates.py [--cycle 2611] [--apt DJT | --all] [--out data/plates] [--dpi 170] [--delay 0.3]
Needs pdftotext (and pdftoppm for --apt) from poppler on PATH.
"""
import argparse, json, os, re, subprocess, sys, tempfile, time, urllib.request

UA = 'machtuck-sim-asset-builder'
BASE = 'https://aeronav.faa.gov/d-tpp/{cycle}/'
WANT = [('APD', None), ('IAP', None)]   # airport diagram, instrument approaches


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


# Minimums block: a label (S-ILS 10L, S-LOC 10L, LPV DA, LNAV/VNAV DA, LNAV MDA, RNP 0.30 DA ...) with entries
# "216/24 200 (200-1/2)" (DA / RVR hundreds, HAT, military) or "380-1 364" (MDA - visibility) under the CATEGORY
# A B C D header: one entry spanning all categories, or one per column group. In the text layer an entry often sits a
# line below its label (superscript fractions push it down) and LNAV/VNAV is split over three lines, so each label
# takes the entries on its own line, else the next, else the previous, never from a line holding another label.
# Circling is skipped: its entries wrap across several lines and cannot be assigned to categories reliably.
LABEL = re.compile(r'(S-ILS|S-LOC|S-LDA|LPV|LNAV/VNAV|LNAV/(?!VNAV)|LNAV|LP|S-VOR/DME|S-VOR|S-NDB|RNP\s*0?\.\d+)(?:\s(\d\d[LRC]?)(?![\d/-]))?\*?')
STOP = re.compile(r'CIRCLING|CATEGORY|LPV|LNAV|S-ILS|S-LOC|S-LDA|S-VOR|S-NDB|RNP\s*0?\.\d|^\s*VNAV')
ENTRY = re.compile(r'(?<![(\d/-])(\d{3,5})(?:/(\d{2,3})|-(\d+)?)(?=\s|$)')


def kind(title):
    """the straight-in label a chart's short form ("S-8L", "S-4") stands for, from the chart title"""
    t = title.upper()
    for pat, k in ((r'\bILS\b', 'S-ILS'), (r'\bLDA\b', 'S-LDA'), (r'\bLOC\b', 'S-LOC'), (r'VOR/DME', 'S-VOR/DME'), (r'\bVOR\b', 'S-VOR'), (r'\bNDB\b', 'S-NDB')):
        if re.search(pat, t):
            return k
    return None


def minimums(text, title=''):
    # LOC, VOR and NDB plates often label the straight-in line by runway only ("S-8L", "S-4"): name it from the title
    k = kind(title)
    if k and k != 'S-ILS':
        text = re.sub(r'(?<![A-Z-])S-(\d{1,2}[LRC]?)(?![\d/-])', lambda m: f'{k} {m.group(1) if m.group(1)[1:2].isdigit() else "0" + m.group(1)}', text)
    lines, out, cats = text.split('\n'), [], None
    for i, ln in enumerate(lines):
        if cats is None:
            m = re.search(r'CATEGORY', ln)
            if m:
                # the A B C D column letters: right of the CATEGORY label, on its line or the lines either side (the
                # text layer scatters them when a plan-view label shares the row); the label's own line wins
                cats = {}
                for j in (i, i - 1, i + 1):
                    if 0 <= j < len(lines):
                        for c in re.finditer(r'(?<=\s)[ABCDE](?=\s|$)', lines[j]):
                            if c.start() > m.end() and c.group(0) not in cats:
                                cats[c.group(0)] = c.start()
                cats = dict(sorted(cats.items()))
            continue
        for lm in LABEL.finditer(ln):
            typ = 'LNAV/VNAV' if lm.group(1) == 'LNAV/' else re.sub(r'\s+', ' ', lm.group(1))
            nxt = LABEL.search(ln, lm.end())
            x0, x1 = lm.end(), nxt.start() if nxt else 10 ** 6
            ents = []
            for j, own in ((i, True), (i + 1, False), (i - 1, False)):
                if j < 0 or j >= len(lines):
                    continue
                l2 = lines[j]
                if not own and STOP.search(l2[:x0 + 4]):
                    continue
                ents = [(e.start(), int(e.group(1)), e.group(2)) for e in ENTRY.finditer(l2[:x1]) if e.start() >= x0 - 2]
                if ents:
                    break
            if not ents or not cats:
                continue
            per = {}
            for c, cx in cats.items():
                cand = [e for e in ents if e[0] <= cx + 12]
                e = cand[-1] if cand else ents[0]
                per[c] = {'alt': e[1], 'rvr': int(e[2]) * 100 if e[2] else None}
            out.append({'type': typ, 'rwy': lm.group(2), 'cat': per})
        if re.search(r'CIRCLING', ln):
            break   # circling and anything after it: not parsed
    return out


def airport(meta, faa):
    """(name, icao, [records]) for an FAA airport id in the d-TPP metafile, or None"""
    i = meta.find(f'apt_ident="{faa}"')
    if i < 0:
        return None
    blk = meta[meta.rfind('<airport_name', 0, i): meta.find('</airport_name>', i)]
    recs = []
    for rec in re.findall(r'<record>(.*?)</record>', blk, re.S):
        g = lambda k: (re.search(f'<{k}>([^<]*)</{k}>', rec) or [None, ''])[1]
        recs.append({'code': g('chart_code'), 'title': g('chart_name'), 'pdf': g('pdf_name'), 'amdt': g('amdtnum'), 'amdt_date': g('amdtdate')})
    return re.search(r'<airport_name ID="([^"]+)"', blk).group(1), re.search(r'icao_ident="([^"]*)"', blk).group(1), recs


CACHE = None   # --cache DIR: keep the downloaded PDFs (re-parsing then needs no network)


def plate_text(base, pdf, td):
    path = os.path.join(CACHE or td, pdf)
    if not (CACHE and os.path.exists(path)):
        open(path, 'wb').write(get(base + pdf))
    return path, subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True, check=True).stdout


def all_minimums(a, base, meta, head):
    """minimums of every IAP at every airport in data/nav/index.json -> data/plates/minimums.json"""
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    index = json.load(open(os.path.join(root, 'data', 'nav', 'index.json')))
    out, n, empty = {}, 0, []
    for apt in index['airports']:
        icao = apt['id']
        faa = icao[1:] if len(icao) == 4 and icao[0] == 'K' else icao
        found = airport(meta, faa)
        if not found:
            print(f'{icao}: not in d-TPP cycle {a.cycle}', file=sys.stderr)
            continue
        name, _, recs = found
        charts = []
        for r in recs:
            if r['code'] != 'IAP':
                continue
            if not (CACHE and os.path.exists(os.path.join(CACHE, r['pdf']))):
                time.sleep(a.delay)
            try:
                with tempfile.TemporaryDirectory() as td:
                    mins = minimums(plate_text(base, r['pdf'], td)[1], r['title'])
            except Exception as e:                                      # a failed chart keeps the rest
                print(f'  {icao} {r["title"]}: {e}', file=sys.stderr)
                continue
            charts.append({'code': 'IAP', 'title': r['title'], 'pdf': r['pdf'], 'amdt': r['amdt'], 'amdt_date': r['amdt_date'], 'minimums': mins})
            n += 1
            if not mins:
                empty.append(f'{icao} {r["title"]}')
        out[icao] = {'airport': name, 'faa': faa, 'charts': charts}
        print(f'{icao}: {len(charts)} approaches, {sum(1 for c in charts if c["minimums"])} with straight-in minimums', file=sys.stderr)
    json.dump({'cycle': head.group(1), 'valid_from': head.group(2).strip(), 'valid_to': head.group(3).strip(), 'source': base,
               'licence': 'FAA d-TPP: US Government work, public domain. Not for navigation.', 'airports': out},
              open(os.path.join(a.out, 'minimums.json'), 'w'), separators=(',', ':'))
    print(f'{n} approach plates at {len(out)} airports; no straight-in minimums read from {len(empty)}:', file=sys.stderr)
    for e in empty:
        print('  ' + e, file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    ap.add_argument('--cycle', default='2611')
    ap.add_argument('--apt', default='DJT', help='FAA airport identifier (KPBI is DJT from cycle 2611)')
    ap.add_argument('--out', default=os.path.join(root, 'data', 'plates'))
    ap.add_argument('--dpi', type=int, default=170)
    ap.add_argument('--all', action='store_true', help='minimums for every airport in data/nav (no images)')
    ap.add_argument('--delay', type=float, default=0.3, help='seconds between chart downloads with --all')
    ap.add_argument('--cache', help='directory to keep the PDFs in (and reuse them from)')
    a = ap.parse_args()
    global CACHE
    if a.cache:
        CACHE = a.cache; os.makedirs(CACHE, exist_ok=True)
    base = BASE.format(cycle=a.cycle)
    meta = get(base + 'xml_data/d-tpp_Metafile.xml').decode('utf-8')
    head = re.search(r'<digital_tpp cycle="(\d+)" from_edate="([^"]+)" to_edate="([^"]+)"', meta)
    os.makedirs(a.out, exist_ok=True)
    if a.all:
        return all_minimums(a, base, meta, head)
    found = airport(meta, a.apt)
    if not found:
        sys.exit(f'{a.apt} not in cycle {a.cycle}')
    name, icao, recs = found
    charts = []
    for r in recs:
        code, title, pdf = r['code'], r['title'], r['pdf']
        if not any(code == c and (pat is None or re.search(pat, title)) for c, pat in WANT):
            continue
        stem = os.path.splitext(pdf)[0]
        with tempfile.TemporaryDirectory() as td:
            path, text = plate_text(base, pdf, td)
            subprocess.run(['pdftoppm', '-r', str(a.dpi), '-gray', '-png', '-singlefile', path, os.path.join(a.out, stem)], check=True)
            mins = minimums(text, title) if code == 'IAP' else []
        charts.append({'code': code, 'title': title, 'file': stem + '.png', 'pdf': pdf, 'amdt': r['amdt'], 'amdt_date': r['amdt_date'], **({'minimums': mins} if code == 'IAP' else {})})
        print(code, title, stem + '.png', file=sys.stderr)
    json.dump({'airport': name, 'faa': a.apt, 'icao': icao, 'cycle': head.group(1), 'valid_from': head.group(2).strip(), 'valid_to': head.group(3).strip(),
               'source': base, 'licence': 'FAA d-TPP: US Government work, public domain. Not for navigation.', 'charts': charts},
              open(os.path.join(a.out, 'plates.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
