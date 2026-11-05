# FMS and navigation

Free flight navigates with two modules:

- `js/navdb.js` loads the FAA CIFP nav database and assembles procedures into leg lists.
- `js/fms.js` is one leg engine. It flies any ARINC 424 leg sequence and gives the autopilot a track or heading and
  a vertical target.

Neither knows about a particular airport. A SID at KDJT and an approach at KMCO run through the same code, driven only
by the data. How the autopilot uses the guidance is on [Autopilot and flight director](flight-guidance.md), and how a
plan is assembled from a route on [IFR routes](routes.md).

## The nav database

`tools/fetch_cifp.py` converts the FAA CIFP (cycle 261029 in the shipped data) into `data/nav`:

| File | Contents |
|---|---|
| `index.json` | The cycle, the centre (KDJT), the 160 nm radius, and the 72 airports with their position, elevation and magnetic variation |
| `enroute.json` | VHF navaids, NDBs, enroute waypoints and airways within 260 nm |
| `apt/<ID>.json` | One airport: runways, ILS, terminal navaids, and its SID, STAR and approach procedures |

`NavDB.init()` loads the first two. `NavDB.airport(id)` loads an airport the first time it is needed, when you pick it
in the planner, and caches it.

### Coordinates and courses

Every position is projected to the sim's local frame: metres north and east of 26.6832° N, 80.0956° W (`toNE`), the
same frame as the imagery and weather data. Courses are turned from magnetic to true when the airport loads:

- A course referenced to a VHF navaid uses that station's declination.
- Any other course uses the airport's magnetic variation.
- A course the CIFP marks as true is used as is.

The published magnetic course is kept as well, for display. That is why the preview shows "course 099° to ZISUR" on the
KDJT ILS 10L, a leg referenced to the localizer (declination −6°) that the FMS flies on 093° true.

### Finding a fix

`NavDB.fix(id)` finds enroute waypoints, navaids and airports by ident. `NavDB.findFix(id, near)`, used by
direct-to, also searches the terminal navaids and procedure fixes of every airport loaded so far. Idents repeat
between regions, so when several match, **the one nearest the airplane wins**. `test/fms_test.mjs` checks that
`findFix('zisur')` finds the KDJT terminal fix ZISUR, and that `NOPEZ` finds nothing.

### Assembling a procedure

`procedureLegs(apt, kind, id, { trans, rwy })` builds a SID, STAR or approach from its parts:

| Kind | Order |
|---|---|
| SID | Runway transition, common route, enroute transition |
| STAR | Enroute transition, common route, runway transition |
| Approach | Approach transition, then every other part (the final approach and the missed approach) |

Two rules join the parts:

- **A transition ends where the next part begins.** When the same fix appears twice at a joint, one leg is kept with
  the later altitude constraint. A hold at that fix (a course reversal) keeps its own data.
- **A hold with no navaid of its own,** at the fix the previous leg flew to on a navaid's course, takes that navaid
  as its course reference.

`resolveLeg` turns each raw leg into what the FMS needs: the path terminator, fix, true course, turn direction,
altitude and speed constraints, vertical angle, distance or time, arc centre, and the fly-over, FAF and
missed-approach-point flags.

`test/fms_test.mjs` checks one assembly against the chart. The KDJT ILS 10L via GULLO becomes:

```
IF GULLO, TF WILBA, CF ZISUR, CF RW10L, CA, VI, CF MORGA, HM MORGA
FAF ZISUR 2,000 ft, MAP RW10L, MORGA hold right turns, inbound 340.2° true (343.2° on PBI, declination −3°)
```

## Path terminators

The FMS supports these ARINC 424 leg types. The counts are how often each appears in the shipped procedures.

| Leg | Meaning | How it is flown | In the data |
|---|---|---|---|
| IF | Initial fix | Direct to the fix | 2,470 |
| TF | Track to fix | The straight track from the previous fix, intercepting it if off the path | 7,714 |
| CF | Course to fix | The published course to the fix, intercepting it | 561 |
| DF | Direct to fix | Straight to the fix from where you are | 317 |
| CA | Course to altitude | The course (as a track) until within 20 ft of the altitude | 312 |
| FA | Course from a fix to altitude | Same as CA | 0 |
| VA | Heading to altitude | The heading until the altitude | 111 |
| CD, FD, VD | Course, course from fix, or heading to a DME distance | Until the distance from the navaid (or fix) reaches the value | 0 |
| CI, VI | Course or heading to intercept | Until the next leg's path is within reach of the turn, or crossed | 0, 201 |
| FM, VM | Course or heading to manual termination | Indefinitely, until ATC or you end it (see [ATC vectors](fms.md#atc-vectors)) | 205, 145 |
| RF | Radius to fix | A constant-radius arc about the published centre | 47 |
| AF | DME arc | An arc at the published DME distance about the navaid | 12 |
| HF | Hold, one circuit | Enter, fly one circuit, continue | 182 |
| HA | Hold to an altitude | Circuits until at the altitude when over the fix | 0 |
| HM | Hold until manually terminated | Circuits until you fly direct elsewhere | 322 |

Any other leg type is flown to its fix if it has one, and skipped if not. That covers the few FC, PI and VR legs in
the data (8, 5 and 1).

### Steering onto a path

On TF and CF legs the commanded track is the path's course, corrected towards the path by 0.012° per metre of
cross-track error, up to a 45° intercept. DF and IF legs fly the bearing to the fix. Arcs steer to the arc's tangent
with the same correction for radial error.

### Turn anticipation

Fly-by fixes are turned early, so the airplane rolls out on the next leg instead of overshooting it. The turn radius
is worked out for a 25° bank at the current ground speed (at least 500 m), and a leg ends this far before its fix:

```
lead = R × tan(Δ / 2)      Δ = the course change to the next leg, capped at 120°
```

A leg also ends within 30 m of its fix, and a direct leg within 150 m. A **fly-over** fix has no lead: the leg ends
only when the airplane has crossed it.

The next leg's course is known for TF legs (the bearing to the next fix) and for course and heading legs. Before a DF
leg, where the course depends on where you are, there is no lead.

### Published turn direction

When a leg has a published turn direction (left or right), its first turn goes that way, even if the other way is
shorter. The FMS holds the direction until the airplane is within 30° of the wanted track, and the autopilot turns
the long way round while the error is over 5°. A direct-to clears the published direction: you asked for the short
way.

## Holds

`holdGuide` flies HF, HA and HM legs. The hold uses the published inbound course, turn direction (right if none is
published), and leg length:

- A leg distance in nm, flown at the current ground speed, or
- the published leg time, or
- 1 minute below 14,000 ft and 1.5 minutes above.

The outbound leg runs one turn diameter out on the holding side.

### Entry

The FMS flies to the fix. On arrival (within 400 m or 0.3 turn radius of it, whichever is larger, or 200 m past it)
it picks the entry from the track relative to the inbound course, using the standard 70° / 110° sectors:

| Entry | Right-hand hold: track minus inbound course | Left-hand hold | How it is flown |
|---|---|---|---|
| Direct | −110° to +70° | −70° to +110° | Turn the holding way onto the outbound heading |
| Teardrop | more than +70° | less than −70° | Heading 30° off the outbound course, towards the holding side, for one leg time, then turn in |
| Parallel | less than −110° | more than +110° | Fly the outbound course on the non-holding side for one leg time, turn the other way to a 45° intercept of the inbound course |

`test/fms_test.mjs` checks the sectors for a right-hand hold inbound 360°. Arriving on tracks 0° and 60° gives a
direct entry, 100° and 160° a teardrop, 200° and 230° a parallel, and 270° a direct entry. The log names the entry
when it starts. After the KDJT ILS 10L missed approach in the same test, the MORGA hold is entered direct:

```
MORGA: direct entry — hold at MORGA, inbound 343°, right turns ≥3,000
```

### Exit

| Leg | Leaves the hold |
|---|---|
| HF | Over the fix, after one circuit. Used for course reversals such as the WILBA transition to the KDJT ILS 10L. |
| HA | Over the fix, once within 50 ft of the altitude |
| HM | Never by itself: use direct-to to leave it. Missed approaches end in one. |

## ATC vectors

A FM or VM leg (a heading or course "to manual termination", usually radar vectors on a departure) never ends by
itself. In the sim ATC ends it: after 60 seconds on the leg, the FMS flies direct to the next fix in the plan. The log
shows the clearance, and the synthesized voice reads it if comms are on (`L`):

```
ATC  Lear 60, proceed direct <next fix>.
```

## Direct to

`@` opens the DIRECT TO box (free flight only). It lists up to 12 fixes of the plan ahead, from the active leg, each
with its magnetic bearing and distance. Click one, or type any fix, navaid or airport ident and press **Enter**.
**Esc** closes the box. A typed ident is looked up in the plan ahead first, then with `NavDB.findFix`, nearest the
airplane. If neither has it, the box says "`XXXXX`: not in the flight plan or the nav database".

`FMS.directTo` then applies these rules:

| Target | What happens |
|---|---|
| A fix the plan ends a leg at, ahead (missed approach included) | That leg becomes a DF leg. The legs before it are skipped. It keeps its altitude constraint and approach flags, so a direct to the FAF is still the FAF. |
| A holding fix | A DF leg to the fix is inserted before the hold, and the hold entry follows |
| Any other fix | A DF leg is inserted ahead of the plan, and the plan resumes from the leg that was active. A heading, altitude or vector leg that was active is dropped. |

In every case the published turn direction is cleared. Direct-to doesn't change the autopilot's mode: if you are in
HDG, press `(` to arm LNAV. The log confirms the direct with the magnetic bearing, the distance and the next leg,
and reminds you to press `(` if LNAV is neither active nor armed:

```
DIRECT <ident>: <bearing>°, <distance> nm, then <next leg>. Press ( for LNAV
```

`test/fms_test.mjs` checks four cases on the KDJT ILS 10L:

```
direct ZISUR (FAF):          DF ZISUR, CF RW10L, CA, VI, CF MORGA, HM MORGA   (FAF and 2,000 ft kept)
direct PBI (missed climb):   DF PBI, VI, CF MORGA, HM MORGA                   (the altitude leg is dropped)
direct WILBA (reversal hold): DF WILBA, HF WILBA, CF ZISUR, ...
direct PBI, flown on LNAV:   passes 0.08 nm from PBI, then resumes the plan at GULLO
```

## The CDU

The captain's control display unit (CDU) on the pedestal runs this FMS (`js/cdu.js`). It is laid over the CDU painted
on the cockpit model, and every key is a live control. Click its screen, the `CDU` button on the 2D panel, or press
`F2` for a large pop-out on the right. While it has focus the keyboard types into it (letters, digits, `.`, `/`,
`-` for +/−, Backspace for CLR, Delete for DEL) and the flight keys rest; `Esc` or `F2` closes it.

> **Note:** The Learjet 60's FMS is the Collins FMS-4200 (Pro Line 4). The pages below are a provisional, generic
> Collins-style set. They will be matched to the FMS-4200 pilot's guide: page names, key labels and line layout.

The screen is 24 columns by 14 rows: a title, six label and data line pairs next to the line-select keys L1 to L6 and
R1 to R6, and the scratchpad at the bottom, where messages appear in amber.

| Page (key) | Shows | Line-select keys |
|---|---|---|
| IDX | The pages | L1 to L4 open them |
| FPL | The active flight plan from the active leg, six legs a page (PREV / NEXT): ident (magenta: active), the course and distance to it above, the altitude constraint on the right | L: an empty scratchpad copies the ident; an ident goes **direct** on L1 of page 1 and is **inserted** before the leg on any other line; `DELETE` (the DEL key) removes the leg. R: an altitude sets the constraint: `5000`, `FL240`, `5000A` (at or above), `5000B` (at or below); `DELETE` clears it |
| DIR | The fixes ahead with bearing and distance | L1 to L6: direct to that fix; an ident in the scratchpad and L1: direct to it |
| PROG | The active fix, the next one and the destination (the missed-approach point), each with distance along the plan and time at the current ground speed; GS, TAS, fuel, altitude | |
| DEP ARR | The origin, destination, runway, approach, SID and STAR as planned on the sortie screen (read-only) | |

Changes take effect at once; EXEC and MSG only answer. A typed ident is looked up in the plan ahead first, then in the
nav database (nearest wins), as for the [DIRECT TO box](#direct-to). Direct-to, insert and delete are the FMS's own
`directTo`, `insertFix` and `deleteLeg`, so the CDU, the `@` box and the map always agree.

## VNAV

The FMS gives VNAV an altitude to be at now, and on a descent a path altitude. The autopilot flies it within the
preselected altitude (see [Autopilot and flight director](flight-guidance.md#vnav)).

### Altitude constraints

Each leg can carry a CIFP altitude description. `constraintTarget` reads them like this:

| Code | Meaning | In the data |
|---|---|---|
| `+`, `V`, `H`, `J` | At or above the first altitude | 4,102, 96, 47, 47 |
| `-`, `Y` | At or below the first altitude | 475, 0 |
| `B` | Between: at or below the first altitude, at or above the second | 498 |
| `@`, blank, `X`, `G`, `I` | At the first altitude | 990, 0, 1, 1, 1 |

The preview and the log show these as `≥3,000`, `≤4,000`, `9,000–11,000` or `3,000`.

### Finding the target

`constraintTarget` walks the legs from the active one, adding up the distance through their fixes, and stops at the
first constraint that matters:

1. **A leg that ends at an altitude** (CA, FA, VA, HA) is a climb: the target is its altitude. This is how departures
   and missed approaches climb.
2. **Below a constraint's lower limit** (by more than 50 ft): climb to it.
3. **Above its upper limit** (by more than 50 ft): descend to it on a path. The path altitude is the constraint plus
   the distance to it times `tan(3°)`, or the leg's published vertical angle. It never goes below an at-or-above
   constraint passed on the way.
4. **At an "at" constraint already:** hold it.
5. **Inside an "at or above", "at or below" or "between" window:** go on to the next constraint. An at-or-above
   altitude becomes a floor for any later descent.

### Cruise and top of descent

With a cruise altitude (a route), `FMS.vertical` adds the enroute phase:

- **Climb.** The target is the cruise altitude, unless a departure constraint is still ahead. A climb constraint
  above you is flown first. The first "at", "at or below" or "between" constraint before the arrival caps the climb
  (at its upper altitude) until it is passed.
- **Cruise.** The target stays at the cruise altitude.
- **Top of descent.** The descent path is drawn back up from the arrival's constraints, so its altitude at your
  position falls as you approach them. When it drops more than 30 ft below the cruise altitude, and you are within
  1,000 ft of cruise, VNAV starts down the path.
- **Arrival.** Once the active leg is a STAR or approach leg, VNAV flies the constraints alone.

The autopilot won't descend through the preselected altitude, so lower it for the descent. `test/route_test.mjs`
does that when the STAR begins, and meets every constraint from KDJT to KMCO within 300 ft (see
[IFR routes](routes.md#a-complete-plan)).

## The EFB map

`Tab` cycles the EFB tablet through MAP, PROCEDURES and OFF. The map (`efbMap` in `js/hud.js`) is north-up, and its
range is shared with the weather radar: `J` cycles 40, 80 and 20 nm. It draws the FMS plan:

- a line through each leg's fix, **magenta** for the active leg and white for the rest,
- the missed approach, after the missed-approach point, as a dashed light-blue line,
- a diamond and the ident at each fix, magenta for the active one,
- your own trail in green, and the ground speed and altitude along the bottom edge.

The PFD's course pointer and deviation show the active FMS leg in magenta, at 0.5 nm per dot (0.15 nm per dot
between the FAF and the missed-approach point), unless the localizer is in use. See
[Cockpit and instruments](instruments.md).
