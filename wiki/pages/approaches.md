# Approaches and minimums

Every approach in the sim comes from the FAA CIFP: the transitions, the final approach, the missed approach and the
hold at the end of it. The minimums come from the FAA approach plates, because the CIFP carries the procedures but
not their minimums. This page covers the approach types, how the guidance arms and captures them, the ILS model,
the minimums and the go-around.

## Approach types

The CIFP names an approach by a letter, the runway and an optional suffix. The planner shows it the way the chart
does:

| Ident | Shown as | Count in the shipped data (72 airports) |
|---|---|---|
| `I10L` | ILS RWY 10L | 48 |
| `L10L` | LOC RWY 10L | 52 |
| `R10LY` | RNAV (GPS) Y RWY 10L | 193 |
| `H14-Z` | RNAV (RNP) Z RWY 14 | 26 |
| `B…` | LOC BC | 1 |
| `S…`, `V…` | VOR | 1 each |
| `X…` | LDA | none in this region |

The database also holds 52 ILS facilities, each with its localizer, glideslope and DME data (`data/nav/apt/<ID>.json`).

Each approach is a set of transitions plus its final and missed-approach legs. Its legs carry three flags from the
CIFP: the final approach fix (FAF), the missed-approach point (MAP), and fly-over. How the planner joins an approach
to the route (a named transition, **Auto**, or vectors to final) is on
[IFR routes](routes.md#vectors-to-final).

## Arming and capture

`\` arms the approach once the AP or FD is on. The modes it arms depend on the type:

| Approach | Lateral | Vertical |
|---|---|---|
| ILS | LOC | GS |
| LOC, LDA (flown on a localizer) | LOC | GP |
| RNAV (GPS), RNAV (RNP) | LNAV | GP |
| No approach loaded, a localizer ahead | LOC | GS |

LOC captures inside 1.5 dots and GS inside 0.4 dot. GP engages once the FMS has sequenced past the FAF, and then
flies the CIFP's final path angle (the `-3.00` vertical angle on the KDJT finals). The full capture rules are on
[Autopilot and flight director](flight-guidance.md#capture-criteria).

The Learjet 60 has baro-VNAV, not WAAS. An RNAV (GPS) approach is flown to LNAV/VNAV or LNAV, never LPV.

`test/fms_test.mjs` flies the KDJT ILS 10L via GULLO from the approach start with the autopilot. The modes go:

```
LNAV/VNAV > LNAV(LOC)/VNAV(GS) > LOC/VNAV(GS) > LOC/GS
VNAV: WILBA at 4,235 ft (at or above 3,000), ZISUR at 2,010 ft (glideslope intercept 2,000)
coupled from 1,000 to 250 ft within 0.18 dot
```

## ILS deviations

`js/nav.js` computes the localizer and glideslope for any ILS in the database. It uses the localizer antenna
position and course, the runway threshold and its elevation, the glideslope angle and threshold crossing height, and
the DME antenna. Nothing in it is specific to an airport.

### Scaling

| Indication | Full scale (2 dots) | Usable |
|---|---|---|
| Localizer | Half the CIFP localizer width either side (±2.04° for I-DJT, width 4.08°). 2.5° if no width is published. | In front of the antenna, within 18 nm and ±35° of the course, and no more than 2,000 m past the threshold |
| Glideslope | 0.7° (0.35° per dot) above or below the published angle | Within 10 nm of the glidepath origin and ±8° of the localizer course, with a valid localizer |

The glidepath meets the runway past the threshold, at the threshold crossing height divided by `tan` of the
glideslope angle. The needles are drawn up to ±2.5 dots. DME is measured from the DME antenna, or from the localizer
if there is none.

`test/nav_test.mjs` checks the signs and the scaling on KDJT runway 10L:

```
5 nm final, on the centreline and glidepath:   LOC 0.00, G/S 0.00 dots, I-DJT 6.6 DME
200 m right of the centreline at 5 nm:         LOC -0.92 dots (fly left)
60 m above / below the glidepath at 5 nm:      G/S -1.02 / +1.02 dots (fly down / up)
glidepath over ZISUR:                          within 60 ft of the published 2,000 ft intercept
25 nm out:                                     no localizer; 5 km off the centreline: no glideslope
```

### Which ILS

`ilsDeviation` gives the deviations from one ILS. `nearestIls` picks the ILS whose localizer you are most nearly
lined up with: a valid localizer within 40 nm, with your track within 90° of its course. A sortie tunes:

1. the localizer the loaded approach's final approach fix references, if there is one,
2. otherwise the best-aligned ILS among all the airports loaded so far.

The PFD's course pointer and deviation show the localizer in green while LOC is active or armed, or when no FMS leg
is active. Otherwise they show the FMS leg in magenta. See [Cockpit and instruments](instruments.md).

## Minimums

`tools/fetch_plates.py` reads the straight-in minimums from each FAA d-TPP plate's text layer, at every airport in the
data: 312 of the 329 approach plates at the 72 airports in cycle 2611 give minimums. The other 17 are
circling-only approaches (the `-A` / `-B` ones), one visual approach and one helicopter-only (COPTER) approach.

The military fields' plates (KCOF, KHST, KMCF, KNQX) have no usable text layer: most are images, and the rest use a
font without a character map, so their text comes out as noise. For those the fetcher reads the minimums by OCR
(`tesseract`): it finds `CATEGORY` on the rendered plate, renders the minimums table alone at 600 dpi, and rebuilds
the text lines from the word positions. It repairs the misreads this typeface causes (4 read as A, 0 as O, "S-10C" for
S-LOC, "5-03" for S-03, "INAV" for LNAV) and fills in column letters it missed. 31 plates are read this way; the plates viewer
says so, because OCR can still misread a digit. The FAA CIFP has no procedures (and no ILS) at these four fields, so
their approaches can't be flown in the sim yet: the minimums show in the viewer only.
Short labels are named from the chart title ("S-8L" on a LOC plate is S-LOC, "S-4" on a VOR plate S-VOR), and the
category letters are found right of the `CATEGORY` label even when the text layer scatters them over the lines either
side. The parser finds each line of minimums by its label (S-ILS, S-LOC, LPV, LNAV/VNAV, LNAV, RNP
0.30 and so on). It assigns the DA or MDA, and the RVR, to categories A to E using the column positions under the
`CATEGORY` header. The results go into `data/plates/minimums.json` (every airport) and `data/plates/plates.json`
(KDJT, with the rendered charts). The free-flight log quotes the line, the chart and its amendment, for example
`S-ILS DA 294 ft (202 above touchdown, Cat C, RVR 1800; ILS OR LOC RWY 18R Amdt 11A)` at KMCO.

**Circling minimums are skipped.** In the text layer their entries wrap across several lines and can't be assigned
to categories reliably, so the parser stops at `CIRCLING`.

### Category C and the line used

The Learjet 60 is approach Category C: its VREF at the 19,500 lb maximum landing weight is 139 kt, inside the
121–140 kt band. `plateMinimums` in `js/main.js` reads the Category C value from the line that matches the approach:

| Approach | Minimums line | Why |
|---|---|---|
| ILS | S-ILS | |
| LOC | S-LOC | Flown LOC + GP to an MDA |
| LDA | S-LDA | |
| RNAV (GPS) | LNAV/VNAV, else LNAV | Baro-VNAV, no WAAS: no LPV |
| RNAV (RNP) | RNP 0.30, else RNP 0.11 | |

S-LOC, S-LDA and LNAV values are reported as an MDA. The rest are reported as a DA.

### KDJT minimums

Plates ship for one airport only: **KDJT** (the former KPBI), FAA d-TPP cycle 2611, valid 29 October to
26 November 2026. These are the minimums the sim uses there (Category C, ft MSL, height above touchdown in brackets):

| Approach | Line | Minimums | RVR |
|---|---|---|---|
| ILS RWY 10L | S-ILS | DA 216 (200) | 2400 |
| LOC RWY 10L | S-LOC | MDA 380 (364) | 3500 |
| ILS RWY 28R | S-ILS | DA 218 (200) | 4000 |
| LOC RWY 28R | S-LOC | MDA 460 (442) | |
| RNAV (GPS) Y RWY 10L | LNAV | MDA 440 (424) | 6000 |
| RNAV (GPS) Y RWY 14 | LNAV/VNAV | DA 338 (321) | |
| RNAV (GPS) Y RWY 28R | LNAV/VNAV | DA 342 (324) | 5000 |
| RNAV (GPS) Y RWY 32 | LNAV/VNAV | DA 342 (326) | |
| RNAV (RNP) Z RWY 10L | RNP 0.30 | DA 355 (339) | 2600 |
| RNAV (RNP) Z RWY 14 | RNP 0.30 | DA 354 (337) | |
| RNAV (RNP) W RWY 28R | RNP 0.30 | DA 725 (707) | |
| RNAV (RNP) Z RWY 28R | RNP 0.30 | DA 404 (386) | 6000 |
| RNAV (RNP) Z RWY 32 | RNP 0.30 | DA 376 (360) | |

`test/fms_test.mjs` checks six of these against the charts: 216, 380, 218, 460, 338 and 440. The RNAV (GPS) X RWY 28R
plate is in the viewer, but the CIFP has no matching procedure, so it can't be flown.

### Without a plate

When the plate gives no straight-in minimums (or the approach has no plate in the cycle), an RNAV (GPS) approach takes
its minimums from the FAA's
[All Approaches - Master RNAVs](https://www.faa.gov/about/officeorg/headquartersoffices/ato/all-approaches-master-rnavs)
spreadsheet (`data/nav/rnav_minimums.json`, built by `tools/fetch_rnav_minimums.py`): the LNAV/VNAV DA if there is one
(the airplane has baro-VNAV), else the LNAV MDA, straight-in. It covers 154 of the 193 RNAV (GPS) approaches in the
data directly, and more where an approach has been renamed since (a Y or Z suffix added) and the list has exactly one
RNAV (GPS) approach to that runway; the log then says "listed as" the list's name.

> **Warning:** The list is old. Its LNAV and LNAV/VNAV sheets say "Published Effective 01/31/2019". Against the current
> KDJT plates (the airport was KPBI in the list) it is off by up to 260 ft, mostly higher (RNAV Y 14: LNAV 720 vs 460
> today, LNAV/VNAV 475 vs 338), once 20 ft lower (RNAV X 28R LNAV 560 vs 580). The log always names the source and date.

Everything else falls back to a height above the touchdown zone elevation (the runway's elevation in the CIFP):

- **200 ft** on an ILS approach with a glideslope
- **400 ft** on LOC, RNP, VOR and every other approach, and on an RNAV approach the list doesn't have

For example, a KMCO RNAV (GPS) Y RWY 18R start logs:

```
Minimums: LNAV/VNAV DA 390 ft (298 above touchdown, straight-in; listed as RNAV (GPS) RWY 18R, FAA master RNAV list
effective 2019-01-31: older than the current chart).
```

And the KMCO ILS 18R start logs:

```
I-TFE 111.90, course 186°, glideslope 3.0°. Minimums: 292 ft (no plate minimums for this approach:
200 ft above touchdown).
```

At KDJT the same line shows the plate's value, the chart and its amendment:

```
I-DJT 111.90, course 099°, glideslope 3.0°. Minimums: S-ILS DA 216 ft (200 above touchdown, Cat C,
RVR 2400; ILS OR LOC RWY 10L Amdt 29A). Press ~ for the plates.
```

### Callouts

With the gear down, descending and airborne, the barometric altitude is compared with the minimums:

| Height | Callout | Log |
|---|---|---|
| Minimums + 100 ft | "Approaching minimums" | |
| Minimums | "Minimums" | `MINIMUMS 216 ft: runway in sight to continue, otherwise go around (?)` |

The callouts reset when you climb more than 400 ft above the minimums, so a second approach gets them again. The
radio altitude is also called at 500, 100, 50, 40, 30, 20 and 10 ft with the gear down.

### Marker beacons

The PFD and HUD can show OM, MM and IM lights, the audio has the three marker tones (400 Hz dashes, 1,300 Hz
dot-dash, 3,000 Hz dots), and the log announces each passage.

The CIFP has no marker records, so the markers come from the FAA NASR (`data/nav/markers.json`, built by
`tools/fetch_markers.py`; see [Data pipeline](data-pipeline.md#marker-beacons)). Only markers the NASR lists as
operational are kept. `js/navdb.js` attaches them to their ILS, and `ilsDeviation` reports a marker while you are
inside its beacon fan, which widens with height: about ±0.8 × your height above the beacon along the course and
±1.5 × across it.

Most US markers have been decommissioned. In the current data four are in range:

| Airport | Approach | Marker |
|---|---|---|
| KFMY | ILS 05 | Outer marker CALOO |
| KPIE | ILS 18 | Outer marker CAPOK |
| KTPA | ILS 01L | Inner marker |
| KTPA | ILS 19L | Inner marker |

KDJT's markers were decommissioned in 2011, and KMCO's on 18R too, so those approaches have none.

## Go-around and missed approach

Press `?` in the air for a go-around (see [Autopilot and flight director](flight-guidance.md#to-and-ga)):

- The autopilot disconnects and the FD commands 10° nose-up, wings level, on the current heading (or the localizer
  course if you were on LOC).
- LNAV arms for the published missed approach. It engages above 400 ft.
- The climb continues until the preselected altitude is above you and captured.

The log gives the procedure and the missed approach in full:

```
GO AROUND — T/O thrust, pitch to the FD (10°), flaps 20, positive rate gear up. LNAV armed (400 ft):
course 099° to ≥600 ft, then left heading 323° to intercept, then course 343° to MORGA ≥3,000,
then hold at MORGA, inbound 343°, right turns ≥3,000. Climbing to 3,000 ft.
```

The missed approach is part of the flight plan, so the FMS reaches it either way. If you go around before the MAP,
LNAV keeps you on the final approach course to the MAP and turns there. `test/nav_test.mjs` goes around 6 nm out on
the KDJT 10L: the airplane stays within 9 m of the runway course and turns 142 m past the threshold, which is the MAP.
When the FMS sequences past the MAP, the log prints the `MISSED APPROACH:` legs. The hold at the end is an HM leg,
which you leave with direct-to (see [FMS and navigation](fms.md#holds)).

### The missed-approach altitude

The pilot monitoring sets the missed-approach altitude once you are established on final (AC 25.1329-1C 67a). When
GS or GP captures, the highest altitude in the missed approach is preselected if it is above the current preselect:

```
PM   Missed-approach altitude 3,000 set
```

GS and GP aren't bounded by the preselected altitude, so this doesn't stop the descent. The 6 nm final start
preselects the missed-approach altitude from the beginning.

`test/fms_test.mjs` flies the whole sequence on the KDJT ILS 10L. It goes around at 200 ft, climbs straight ahead
to 600 ft and turns left, sequences `CA > VI > CF MORGA > HM MORGA`, and enters the MORGA hold direct. It then holds
an inbound track of 339° true (published 340°) within a 77 ft altitude spread. On the ILS 28R missed approach in
`test/nav_test.mjs`, the airplane climbs to 500 ft, turns right, and tracks 347° true to MORGA (course 340° true).

## The plates viewer

`~`, or **Approach plates** on the sortie screen, opens the FAA charts:

- In the air it opens on the chart for the loaded approach. On the ground, or with no approach, it opens on the
  airport diagram.
- A tab for each chart along the top, **Rotate** (90° steps) and **Close**. `Esc` also closes it.
- The airport diagram is printed sideways, so it opens rotated a quarter turn to put north up.
- The footer gives the airport, the d-TPP cycle and validity, and "public domain · NOT FOR NAVIGATION".

KDJT's 12 approach plates and its diagram ship as images. At every other airport (the field you are on, the one you
are flying to, or on the sortie screen the arrival you are planning) the viewer lists the airport's approach plates as
tabs; each opens a link to the FAA PDF for the cycle (`https://aeronav.faa.gov/d-tpp/<cycle>/...`, which the FAA keeps
online only for the current cycles) with the straight-in minimums the sim read from it. Rendering all 376 charts as
images would add about 64 MB to the repository every cycle.

To refresh the charts for a new cycle (this needs `pdftoppm` and `pdftotext` from poppler):

```bash
python3 tools/fetch_plates.py --cycle <cycle>          # KDJT images and minimums
python3 tools/fetch_plates.py --cycle <cycle> --all    # every airport's minimums, no images
```

The default airport is `DJT` (`--apt`), the FAA ident KPBI took from cycle 2611. See [Data pipeline](data-pipeline.md).
