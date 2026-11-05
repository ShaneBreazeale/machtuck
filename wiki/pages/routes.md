# IFR routes

A sortie's flight plan is one list of legs: departure procedure, enroute fixes and airways, arrival procedure,
approach and missed approach. `js/route.js` builds it from a route string, or from an imported MSFS `.pln` or
SimBrief plan. Everything comes from the FAA CIFP through `js/navdb.js`. No airport or route is coded by hand.

This page covers the route syntax and how the plan is put together. The planner screen is described on
[Planning a sortie](sorties.md), and how the legs are flown on [FMS and navigation](fms.md).

## The pieces

| Function | What it does |
|---|---|
| `parseRoute(db, text, dep, arr)` | Splits a route string into a SID and transition, enroute fixes and airways, a STAR and transition, and a cruise level. Collects errors. |
| `buildPlan(db, p)` | Assembles the SID, enroute legs, STAR and approach into one leg list, merges repeated fixes, and adds vectors to final when needed. Returns `{ legs, errors, dist }`. |
| `vectorsToFinal(app, from)` | Replaces an approach's initial segment with an ATC-style intercept of the final approach course. |
| `parsePln(xml)` | Reads an MSFS or FSX `.pln` file into a departure, destination, cruise altitude and route string. |
| `findProc(apt, kind, name)` | Finds a SID or STAR by name, with or without its version digit. |

Each leg keeps a `kind` of `SID`, `ENR`, `STAR` or `APP`. The FMS and VNAV use it to tell the phases apart.

## Route syntax

Tokens are separated by spaces. Commas, tabs and new lines count as spaces, and case doesn't matter. In order:

```
[DEP] [SID[.TRANS] | SID TRANS] {FIX | AIRWAY | DCT | lat/lon} [TRANS.STAR | STAR] [ARR]
```

| Token | Meaning |
|---|---|
| Departure or arrival ident (`KDJT`, `KMCO`) | Ignored. The airports come from the planner's selectors. |
| `DCT`, `SID`, `STAR` | Ignored. A fix after a fix is already flown direct. |
| SID name (`TBIRD8`, `TBIRD`) | The departure procedure. It must come before any enroute fix. |
| `SID.TRANS` (`TBIRD8.CHEFS`, `TBIRD.MATLK`) | FAA style: the SID with its enroute transition. |
| Fix (`CHEFS`, `ZBV`) | An enroute waypoint, VOR, NDB or airport, or a terminal fix used by a procedure at the departure or arrival airport. |
| Airway (`A315`) | Expanded into its fixes between the fix before it and the fix after it. |
| Coordinates (`2630N08010W`, `26N080W`) | Degrees and minutes, or whole degrees, north or south then east or west. |
| `TRANS.STAR` (`MATLK.SLOAO1`) | FAA style: the STAR with its enroute transition. `STAR.TRANS` is accepted too. |
| STAR name (`MUNGI1`) | The arrival procedure. It must be the last token (after the airport idents are removed). |
| Cruise level (`FL210`, `N0450F210`, `/F240`, `/A045`) | Sets the cruise altitude. See [Cruise level](routes.md#cruise-level). |

### Examples

All of these were checked against the shipped CIFP data, from KDJT to KMCO.

```
KDJT TBIRD8 CHEFS MUNGI1 KMCO
  SID TBIRD8, transition CHEFS. STAR MUNGI1, transition CHEFS. Enroute: CHEFS.
  (test/route_test.mjs)

TBIRD.MATLK MATLK.SLOAO1 /F240
  SID TBIRD8.MATLK, STAR SLOAO1 via MATLK, cruise 24,000 ft. The SID was written without its
  version digit. (test/route_test.mjs)

TBIRD8 MATLK SLOAO1
  The same plan without dots: the fix after the SID is one of its transitions, and the fix
  before the STAR is one of the STAR's transitions.

TBIRD8.CHEFS MUNGI1.CHEFS
  STAR.TRANS order also works: STAR MUNGI1 via CHEFS.

SID TBIRD8 CHEFS STAR MUNGI1
  The SID and STAR keywords are skipped: same as TBIRD8 CHEFS MUNGI1.

ZBV A315 JAYEE DCT 2630N07930W
  Airway A315 from ZBV to JAYEE becomes ZBV SWIMM TINKY PEKRE JAYEE, then direct to
  26°30'N 79°30'W. (test/route_test.mjs)

JAYEE A315 ZBV
  An airway can be flown in either direction: JAYEE PEKRE TINKY SWIMM ZBV.

CHEFS/N0450F210 MUNGI1
  A speed and level group attached to a fix: CHEFS, cruise FL210, STAR MUNGI1 via CHEFS.

PBI DCT 26N080W DCT ORL
  Navaids and a whole-degree coordinate, flown direct.
```

### Versionless and FAA-style names

`findProc` first looks for an exact match. If there isn't one, it drops a trailing digit from both names and
compares again, so `TBIRD` finds `TBIRD8`. A SID or STAR written with a different version digit (`TBIRD7`) finds the
current one the same way.

A name that is also a fix ident is read as the fix:

- An undotted SID is accepted as the first token, or later (before any enroute fix) only if no fix has that ident.
- An undotted STAR at the end is accepted only if no fix has that ident.

For example, `MUNGI` at the end of a route is the fix MUNGI, not the MUNGI1 arrival. Write `MUNGI1` or
`CHEFS.MUNGI1` to get the STAR.

### Cruise level

`parseRoute` recognises three forms anywhere in the route:

| Form | Example | Cruise |
|---|---|---|
| `FLnnn` | `FL210` | 21,000 ft |
| Speed and level group: `N`, `K` or `M` with four digits, then `F` or `A` with three digits | `N0450F210`, `M0074F350` | 21,000 ft; 35,000 ft |
| A slash group, alone or on the end of a fix | `/F240`, `/A045`, `CHEFS/N0450F210` | 24,000 ft; 4,500 ft; 21,000 ft |

A bare `A045` is not a level: it would clash with airway names such as `A315`, so it is reported as an unknown
token. The last cruise token in the route wins.

In the planner, the parsed level is copied into **Cruise altitude** only if that list offers it (odd thousands from
3,000 ft to FL410). See [Planning a sortie](sorties.md#route).

## How transitions are chosen

| Procedure | How its transition is picked |
|---|---|
| SID | The token after the SID if it names one of its transitions, or the part after the dot. The runway transition comes from the departure runway. |
| STAR | The fix before the STAR if it names one of its transitions, or the other half of a dotted token. The runway transition comes from the approach's runway. For a runway such as `18R`, a `RW18B` (both runways) transition also matches. |
| Approach | Chosen in the planner. With **Auto**, the transition that begins at the last fix of the route or STAR. If none does, vectors to final. See [below](routes.md#vectors-to-final). |

The order of the parts inside a procedure (`procedureLegs` in `js/navdb.js`) is:

- SID: runway transition, then the common route, then the enroute transition.
- STAR: enroute transition, then the common route, then the runway transition.
- Approach: the approach transition, then every non-transition part (final and missed approach).

## How duplicate fixes merge

Procedures and routes overlap at their joints. `TBIRD8 CHEFS` names CHEFS as the end of the SID transition and again
as a route fix. `buildPlan` and `procedureLegs` merge these:

- **The same fix twice in a row** becomes one leg. It keeps the later leg's altitude and speed constraint if it has
  one, otherwise the earlier one's, and it keeps the earlier leg's phase (`SID`, `STAR` and so on).
- **A hold is never merged away.** A hold at a fix (a course reversal) keeps its own data.
- **A segment that starts with an initial fix (IF)** joins the plan as a track from the previous fix (TF). After a
  heading or vectors leg, which has no end fix, it becomes a direct to the fix (DF) instead.
- **A repeated route fix** (`CHEFS CHEFS`) is entered only once.

## Error reporting

Nothing is silently dropped. Every problem is listed in the planner's preview after a `⚠`, and in the log at the
start as "Not in the plan: …". The plan is still built from the parts that worked.

| Message | Cause |
|---|---|
| `NOPEZ: unknown fix, airway or procedure` | The token is not a fix, navaid, airport, airway, coordinate or procedure. |
| `FOO.BAR: no such SID at KDJT or STAR at KMCO` | A dotted token that matches neither procedure. |
| `A315: an airway needs a fix before and after it` | An airway at the start or end of the route, or next to another airway. |
| `ZBV A315 ORL: A315 does not join ZBV and ORL` | One of the fixes isn't on that airway. |

A SID written after an enroute fix (`SMGLR TBIRD8`) or a STAR that isn't last is not recognised, and is reported as an
unknown token.

## Vectors to final

When the route ends somewhere that isn't the start of an approach transition, a real controller would vector you
onto the final approach course. `vectorsToFinal` does the same from the approach's own data. It applies when all of
these are true:

- The approach transition is **Auto**.
- There is a route or STAR before the approach.
- The route's last fix doesn't begin one of the approach's transitions, and doesn't appear in the approach.
- The approach has a final approach fix (FAF) with at least one leg before it.

The intercept point follows two rules:

1. If the last fix before the FAF is **2 to 10 nm** from it, that fix is the intercept point, and its altitude is kept
   as an "at" altitude. For a "between" constraint, the lower altitude is used.
2. Otherwise a point named `FINAL` is made **4 nm outside the FAF** on the final approach course, at the FAF's
   altitude.

The plan then becomes:

```
VECTR      3 nm before the intercept point along the course, 1.7 nm to the side the airplane
           comes from (a 30° intercept)
intercept  the point above, flown as a track (TF)
FAF        flown as a course to the fix (CF) on the final approach course
...        the rest of the approach and the missed approach, unchanged
```

The side is chosen from the last route fix, so the intercept is always from the side you arrive on. In the preview
these legs read "ATC vectors to final · intercept the final approach course at HAMMY 3,000". At KMCO the ILS 18R
transitions are HOLOP and YAGGO, so a route ending at WONMR (the MUNGI1 runway transition) gets vectors to HAMMY,
2.5 nm before the FAF TUFFE.

## Importing plans

### MSFS .pln

`parsePln` reads these elements:

| `.pln` element | Used as |
|---|---|
| `DepartureID`, `DestinationID` | Departure and arrival airports |
| `CruisingAlt` | Cruise altitude (ft) |
| `ATCWaypoint id` | A fix |
| `ATCWaypointType` | `Airport` waypoints are skipped. `User` waypoints with a `WorldPosition` become a coordinate token, rounded to the minute (`2641N08006W`). |
| `ATCAirway` | An airway token, added once when the airway changes |
| `DepartureFP` | The SID, placed before the first fix that carries it |
| `ArrivalFP` | The STAR, added at the end |

The result is a route string, parsed like a typed one. `test/route_test.mjs` imports a KDJT to KMCO plan with
`TBIRD8` on CHEFS and `MUNGI1` on MOOTS. It gives the route `TBIRD8 CHEFS MOOTS MUNGI1` and a cruise of 21,000 ft.
A `.pln` carries no runways, so you choose them in the planner.

### SimBrief

The planner fetches the latest flight plan for the username you type, from
`https://www.simbrief.com/api/xml.fetcher.php?username=…&json=1`. It does this only when you click **Fetch**. It uses:

| SimBrief field | Used as |
|---|---|
| `origin.icao_code`, `destination.icao_code` | Airports |
| `general.route` | The route string |
| `general.initial_altitude` | Cruise altitude, rounded to the nearest level the planner offers |
| `origin.plan_rwy` | Departure runway |
| `destination.plan_rwy` | Approach: the ILS to that runway if there is one, else any approach to it, transition **Auto** |

If SimBrief returns no plan, the preview shows `SimBrief:` with the status it sent back.

## Limits

- **The region.** Only the 72 airports within 160 nm of Palm Beach are in the database. Enroute waypoints and navaids
  cover 260 nm (`tools/fetch_cifp.py` keeps the radius plus 100 nm), and every airway with a point inside that area
  is kept whole. An imported plan to an airport outside the region keeps its route, and the preview says which
  airport is missing.
- **One cycle.** The data is FAA CIFP cycle 261029. Procedures renamed in later cycles won't be found until the data
  is refreshed with `python3 tools/fetch_cifp.py`. See [Data pipeline](data-pipeline.md).
- **Ident clashes.** Terminal fixes are found only in the departure and arrival airports' procedures. An enroute
  waypoint, navaid or airport with the same ident is found first.
- **Distance.** The plan distance is the sum of straight lines between the plan's fixes. Legs without a fix (heading
  and altitude legs) add nothing, and a hold at a fix already counted adds nothing.

## A complete plan

`test/route_test.mjs` builds and flies this plan end to end. It departs KDJT runway 10L on `TBIRD8 CHEFS MUNGI1`
at 21,000 ft and flies the ILS 18R at KMCO:

```
plan: 21 legs, 176 nm (6 STAR legs, 8 approach legs, ending in the CAMBE hold)
modes: HDG/TO > LNAV/TO > LNAV/VNAV > LOC/VNAV > LOC/GS
constraints: AHABB 10137 (+6000), BAGGR 18983 (+10000), CHEFS 21001 (B21000/19000),
             MOOTS 21003 (+15000), PARRX 11196 (B11000/9000), HAANZ 8996 (B9000/8000),
             WONMR 6009 (@6000), HAMMY 3104 (@3000), TUFFE 2207 (H2200/2200)
KMCO ILS 18R at 200 ft after 33 min: LOC 0.33, G/S -0.30 dot, 145 KIAS
```

Each constraint is shown as the altitude flown over the fix, then the published constraint. Every one was met within
300 ft. How VNAV gets there is on [FMS and navigation](fms.md#vnav).
