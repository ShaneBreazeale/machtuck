"""FAA terminal procedure charts (d-TPP) for the free-flight airport: every instrument approach plate and the airport diagram.

FAA d-TPP charts are US Government works (public domain). Each 28-day cycle publishes a metafile listing every chart;
this script finds the airport in it, downloads the selected charts and renders them to grayscale PNGs for the in-game
plate viewer, with data/plates/plates.json recording the cycle and validity. The straight-in minimums (DA / MDA by
aircraft category) are read from each plate's text layer: CIFP carries the procedures but not their minimums.
NOT FOR NAVIGATION: the sim ships one cycle.

Usage: python tools/fetch_plates.py [--cycle 2611] [--apt DJT] [--out data/plates] [--dpi 170]
Needs pdftoppm and pdftotext (poppler) on PATH.
"""
import argparse, json, os, re, subprocess, sys, tempfile, urllib.request

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


def minimums(text):
    lines, out, cats = text.split('\n'), [], None
    for i, ln in enumerate(lines):
        if cats is None:
            m = re.search(r'CATEGORY', ln)
            if m:
                cats = {c.group(0): c.start() + m.end() for c in re.finditer(r'(?<=\s)[ABCDE](?=\s|$)', ln[m.end():])}
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


def main():
    ap = argparse.ArgumentParser()
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    ap.add_argument('--cycle', default='2611')
    ap.add_argument('--apt', default='DJT', help='FAA airport identifier (KPBI is DJT from cycle 2611)')
    ap.add_argument('--out', default=os.path.join(root, 'data', 'plates'))
    ap.add_argument('--dpi', type=int, default=170)
    a = ap.parse_args()
    base = BASE.format(cycle=a.cycle)
    meta = get(base + 'xml_data/d-tpp_Metafile.xml').decode('utf-8')
    head = re.search(r'<digital_tpp cycle="(\d+)" from_edate="([^"]+)" to_edate="([^"]+)"', meta)
    i = meta.find(f'apt_ident="{a.apt}"')
    if i < 0:
        sys.exit(f'{a.apt} not in cycle {a.cycle}')
    blk = meta[meta.rfind('<airport_name', 0, i): meta.find('</airport_name>', i)]
    name = re.search(r'<airport_name ID="([^"]+)"', blk).group(1)
    icao = re.search(r'icao_ident="([^"]*)"', blk).group(1)
    os.makedirs(a.out, exist_ok=True)
    charts = []
    for rec in re.findall(r'<record>(.*?)</record>', blk, re.S):
        g = lambda k: (re.search(f'<{k}>([^<]*)</{k}>', rec) or [None, ''])[1]
        code, title, pdf = g('chart_code'), g('chart_name'), g('pdf_name')
        if not any(code == c and (pat is None or re.search(pat, title)) for c, pat in WANT):
            continue
        stem = os.path.splitext(pdf)[0]
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, pdf)
            open(path, 'wb').write(get(base + pdf))
            subprocess.run(['pdftoppm', '-r', str(a.dpi), '-gray', '-png', '-singlefile', path, os.path.join(a.out, stem)], check=True)
            mins = minimums(subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True, check=True).stdout) if code == 'IAP' else []
        charts.append({'code': code, 'title': title, 'file': stem + '.png', 'amdt': g('amdtnum'), 'amdt_date': g('amdtdate'), **({'minimums': mins} if code == 'IAP' else {})})
        print(code, title, stem + '.png', file=sys.stderr)
    json.dump({'airport': name, 'faa': a.apt, 'icao': icao, 'cycle': head.group(1), 'valid_from': head.group(2).strip(), 'valid_to': head.group(3).strip(),
               'source': base, 'licence': 'FAA d-TPP: US Government work, public domain. Not for navigation.', 'charts': charts},
              open(os.path.join(a.out, 'plates.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
