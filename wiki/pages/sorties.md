# Planning a sortie

The free-flight sortie is a separate mode from the accident. It has no storm and no scripted upset. You pick a
departure, a route, an arrival and a starting point, and the FMS flies the plan through the autopilot and flight
director if you let it. This page walks through the planner screen. The route syntax has its own page,
[IFR routes](routes.md).

## Opening the planner

You can reach the planner two ways:

- Click **Plan a sortie →** on the accident briefing screen.
- Open `index.html#sortie` directly.

**← The accident** takes you back to the briefing. Below the plan preview there is a one-line key reminder, plus
**Fly the sortie** and **Approach plates**.

The header shows the FAA CIFP cycle the nav data comes from (`261029` in the shipped data). It also carries the
"NOT FOR NAVIGATION" notice.

## Where you can fly

The nav database holds the **72 airports** with instrument procedures within **160 nm** of Palm Beach.
`tools/fetch_cifp.py` builds it from the FAA CIFP, and `data/nav/index.json` records the centre (KDJT) and the
radius. Both airport lists are sorted alphabetically, except that KDJT (the former KPBI) comes first. Each entry
shows the ident and the FAA name.

The arrival airport can be the same as the departure airport. That gives you a local flight, for example a takeoff
followed by an approach back to the same field.

## Departure

| Field | What it holds |
|---|---|
| Airport | Any of the 72 airports. Changing it reloads the runways and SIDs. |
| Runway | Runways the ground model can place you on, with their length from the CIFP (`Runway 10L · 10,001 ft`). |
| SID | **None**, or any departure procedure published for the airport. |
| Transition | **None**, or one of the SID's enroute transitions. |

The transition list leaves out the SID's runway transitions, because the planner picks the runway transition that
matches the **Runway** field. `procedureLegs` in `js/navdb.js` assembles the SID in the order runway transition,
common route, enroute transition.

## Route

The **Route** box takes fixes, airways, `DCT` and coordinates, for example `TBIRD8 CHEFS MUNGI1`. When you leave the
box, `sortieRoute` parses it. Any SID, STAR or cruise level it finds is copied into the selectors:

- A SID in the route sets **SID** and, if the next token is one of its transitions, the SID **Transition**.
- A STAR at the end sets **STAR** and, if the fix before it is one of its transitions, the STAR **Transition**.
- A cruise token (`FL210`, `/F210`, `N0450F210`) sets **Cruise altitude**. A level the list doesn't offer is added
  to it, in order.

The selectors win after that. If you change the SID dropdown by hand, the plan uses the dropdown, and only the
route's fixes and airways go in between. The full syntax is on [IFR routes](routes.md#route-syntax).

**Cruise altitude** offers **None (local flight)** or the odd thousands from 3,000 ft to FL410 (3,000, 5,000 …
17,000 ft, FL190, FL210 … FL410). With a cruise altitude, VNAV climbs to it after takeoff and holds it to the top of
descent. See [FMS and navigation](fms.md#vnav).

The odd thousands are the IFR eastbound levels. Any other level from 1,000 to 45,000 ft, such as a westbound even
level (`/F240`), comes in from the route, an imported plan or your saved settings: it is rounded to 100 ft and added
to the list.

### Importing a plan

**Import** has two sources:

- **MSFS .pln** opens a file picker for an MSFS or FSX flight plan (`.pln` or `.xml`). `parsePln` in `js/route.js`
  turns it into a departure, a destination, a cruise altitude and a route string.
- **SimBrief user** plus **Fetch** downloads the latest SimBrief OFP for the username you type. The request goes only
  to `www.simbrief.com`, and only when you click **Fetch**. The username isn't saved.

`importPlan` in `js/main.js` then:

1. Selects the departure and arrival airports if they are in the database. If one isn't, the preview starts with
   "`XXXX` not in the nav database (airports within 160 nm of Palm Beach)".
2. Selects SimBrief's planned departure runway, and an approach to its planned arrival runway (the ILS if there is
   one, otherwise any approach to that runway), with the approach transition set to **Auto**.
3. Copies the route string into the **Route** box.
4. Sets **Cruise altitude** to the plan's cruise altitude, adding it to the list if it isn't offered.
5. Runs `sortieRoute`, so a SID or STAR in the route is selected.

The field mapping is listed on [IFR routes](routes.md#importing-plans).

## Arrival

| Field | What it holds |
|---|---|
| Airport | The destination. Changing it reloads its STARs and approaches. |
| STAR | **None**, or any arrival procedure. |
| Transition | **None**, or one of the STAR's enroute transitions (runway transitions are picked from the approach's runway). |
| Approach | **None**, or any approach, named as on the chart: `ILS RWY 10L`, `RNAV (GPS) Y RWY 10L`, `RNAV (RNP) Z RWY 14`. The default is the airport's first ILS. |
| Transition | **Auto (route / vectors)**, **None (from the intermediate fix)**, or a named approach transition. |

The approach transition choice decides how the approach joins the route:

- **Auto.** If the route or STAR ends at the start of one of the approach's transitions, that transition is flown. If
  it ends somewhere else, ATC-style vectors put you on the final approach course at a 30° intercept. With no route at
  all, the approach starts at its intermediate fix.
- **None.** The approach starts at its first leg after the transitions, usually the intermediate fix. No vectors are
  added.
- **A named transition**, such as `GULLO` for the KDJT ILS 10L, is always flown from its first fix.

How the vectors are built is on [IFR routes](routes.md#vectors-to-final). Approach types, arming and minimums are on
[Approaches and minimums](approaches.md).

## Start

`STARTS` in `js/freeflight.js` defines four starting points. Each one is placed from the selected airport, runway and
approach. None of them names a particular airport.

| Start | Where you begin | Guidance set up by `configureGuidance` |
|---|---|---|
| **rwy**: Lined up on the departure runway | 60 m past the start of the pavement, at rest, parking brake set, flaps 8, takeoff trim dialled in | AP off, flight director in TO mode (+9° on the runway heading). LNAV is armed if a plan is loaded. With a route and a cruise altitude, VNAV is armed and the cruise altitude is preselected; otherwise the preselect is 3,000 ft. |
| **app**: Airborne at the start of the approach | 3 nm before the first fix of the approach, inbound on its first leg, at that fix's altitude (3,000 ft if it has none), 180 KIAS, flaps 8, gear up | AP on in LNAV and VNAV with the approach armed. The FAF altitude is preselected. |
| **final**: 6 nm final | On a 3° path 6 nm from the approach runway's threshold, 150 KIAS, gear down, flaps 20 | Hand-flown. The flight director is on in HDG and ALT with the approach armed. The missed-approach altitude is preselected (3,000 ft if the approach has none). The FMS starts at the missed-approach-point leg. |
| **cruise**: En route at the cruise altitude | 5 nm (or half the leg, if shorter) before the first route or STAR fix after the departure, at the cruise altitude | AP on in HDG and ALT, with LNAV and VNAV armed. VNAV descends on the arrival's constraints once you lower the preselected altitude. |

Notes on the starts:

- **app** and **final** need an approach. Without one, the preview says "This start needs an approach." and
  **Fly the sortie** is disabled.
- **cruise** with no cruise altitude uses FL350. With no route it starts 65 nm west of the airport, heading towards
  the runway. The speed depends on the level: Mach 0.77 at or above FL300, Mach 0.74 above 25,000 ft, 270 KIAS above
  10,000 ft and 230 KIAS below that.
- Airborne starts are trimmed into steady flight by `trimFlight`, which solves angle of attack, stabilizer trim and
  thrust on the real flight model.
- Every start widens the autopilot and flight-director pitch command range to −10° to +15°. The accident keeps
  its narrower calibrated cruise limits.

There is no autothrottle in any start. Thrust is yours.

## Conditions

| Selector | Options (`js/freeflight.js`) |
|---|---|
| Weather (`swx`) | **Calm, few cumulus, ISA**. **KPBI METAR 1 Nov 17:53Z**: 080° 16 G28 kt, 26 °C, scattered cumulus (ISA +11). **Crosswind 010° 15 kt** (90° to runway 10L), ISA. |
| Weight (`swt`) | **17,000 lb** (light), **20,700 lb** (typical), **23,500 lb** (max takeoff). Fuel is the weight above a basic operating weight of about 14,800 lb. |
| Failure (`sfail`) | **No failures**. **Engine failure at V1**, on the takeoff roll with the levers above 80 %. **Engine failure after takeoff**, at a random height between 400 and 1,500 ft while climbing. The failed side is random. |

`FreeEnv` gives the wind a surface boundary-layer profile and band-limited random gusts. The gust spread sets the
turbulence. The wind directions are fixed: the crosswind preset is 90° to KDJT 10L, not to whichever runway you pick.

## The plan preview

The line under the columns is rebuilt whenever a selection changes. It shows the route part as fix names and the
approach in full, missed approach included. For the README's example (KDJT runway 10L, `TBIRD8 CHEFS MUNGI1`, ILS 18R
at KMCO, transition **Auto**), the preview reads:

```
KDJT → KMCO, 176 nm: SMGLR SONNC AHABB BAGGR TBIRD CHEFS MOOTS MUNGI HIJON PARRX HAANZ WONMR
— APPROACH: ATC vectors to final · intercept the final approach course at HAMMY 3,000 ·
course 185° to TUFFE ≥2,200 (FAF) · course 185° to RW18R 148 (MAP)
— MISSED APPROACH: course 186° to ≥500 ft, then heading 270° to intercept,
then course 227° to CAMBE ≥4,000, then hold at CAMBE, inbound 047°, right turns ≥4,000
```

Courses are magnetic. Altitudes use `≥` for at or above, `≤` for at or below and a range for between. With a cruise
altitude selected the header reads `KDJT → KMCO, 176 nm at FL210:`.

Anything the planner couldn't use is appended after a `⚠`, and the line turns red. For example:

```
⚠ NOPEZ: unknown fix, airway or procedure; J999: unknown fix, airway or procedure
```

With no SID, route, STAR or approach the preview reads "No flight plan: fly it by hand, heading and altitude modes."

## Saved settings

Clicking **Fly the sortie** saves every selection, including the route text, in the browser's `localStorage` under
the key `n722bd_sortie_v3` (`FREE_KEY` in `js/main.js`). The next time the planner opens, it restores them. A saved
departure that is no longer in the database falls back to KDJT, and a missing arrival falls back to the departure.

`R` (restart) during a sortie, and **Fly it again** on the debrief, rebuild the same sortie from those selections.

## What the log says at the start

`newFreeFlight` writes these lines to the log in order:

1. **The start message** from `setupStart`. For a runway start:
   ```
   Runway 10L, KDJT, 9,996 ft of pavement. Parking brake set: press Shift (brakes) to release it.
   Flaps 8, takeoff trim 6.7°. Full thrust (T/O), rotate at VR to about +9° (FD),
   positive rate: gear up (G), flaps up (F) above 160 KIAS.
   ```
2. **The flight plan**: `FLIGHT PLAN (FAA CIFP 261029, 176 nm): …`, the same summary as the preview.
3. **Not in the plan:** anything that couldn't be resolved.
4. **The localizer**, if the approach is flown on one: ident, frequency, magnetic course, and either the glideslope
   angle or "localizer only: no glideslope (GP flies the FMS path)". The minimums follow, with "Press ~ for the
   plates." when plates are loaded for that airport.
5. **Minimums**: the plate's DA or MDA, or the fallback height above touchdown (200 ft on an ILS with a glideslope,
   400 ft on LOC, RNAV and the rest). See
   [Approaches and minimums](approaches.md#minimums).
6. **Speeds**: the AFM V1, VR and V2 for your weight and the departure runway's elevation on a runway start, or
   VREF flaps 40 on a final start (with a warning above the 19,500 lb maximum landing weight).
7. **Failure armed**, if you chose one.

For flying the airplane after that, see [Autopilot and flight director](flight-guidance.md) and
[Controls](controls.md).
