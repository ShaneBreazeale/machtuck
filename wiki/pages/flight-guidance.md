# Autopilot and flight director

The Learjet 60 has a Collins Pro Line 4 flight guidance system. The sim's version is the `Autopilot` class in
`js/scenario.js`. Its modes follow FAA Advisory Circular
[AC 25.1329-1C](https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_25_1329-1C.pdf), chapter 6, and the
code cites the paragraphs it implements. The same guidance drives the flight director (FD) command bars, with or
without the autopilot (AP) engaged.

This page covers the free-flight sortie. The accident keeps HDG and ALT with the cruise pitch law it was calibrated
with. See [The N722BD flight](accident.md).

> **Note:** There is no autothrottle on the Learjet 60, and none in the sim. The autopilot flies pitch and roll.
> Thrust is always yours.

## Keys

These come from the key map in `js/input.js` and the handlers in `handleEvents` in `js/main.js`.

| Key | Action |
|---|---|
| `X` | Autopilot engage or disconnect. On a controller: Cross. A hardware button bound to **Autopilot disconnect** does the same. |
| `\|` | Flight director on or off |
| `?` | TOGA: takeoff mode on the ground, go-around in the air |
| `(` | Arm LNAV |
| `)` | Arm VNAV |
| `\` | Arm or cancel the approach (APR) |
| `@` | Direct to (see [FMS and navigation](fms.md#direct-to)) |
| `{` `}` | Heading bug 5° left or right |
| `<` `>` | Preselected altitude 500 ft down or up (never below 1,000 ft) |
| `,` `.` | Pitch trim nose-down or nose-up. **Disconnects the autopilot.** |
| `~` | Approach plates |

The full key list is on [Controls](controls.md).

## Modes

| Mode | Axis | What it flies |
|---|---|---|
| **HDG** | Lateral | The heading bug. It turns the way you spun the knob. |
| **LOC** | Lateral | The localizer course, with a cross-track intercept of up to 30°, flown on the track |
| **LNAV** | Lateral | The FMS flight plan's track or heading, turning the published way |
| **ALT** | Vertical | Holds the preselected altitude |
| **ALTS** | Vertical | Altitude capture: rounds out onto the preselected altitude. Shown as `ALTS CAP`. |
| **VS** | Vertical | A fixed vertical speed towards a new preselected altitude |
| **VNAV** | Vertical | The flight plan's altitude constraints, bounded by the preselected altitude |
| **GS** | Vertical | The ILS glideslope |
| **GP** | Vertical | The FMS glidepath on the final approach of an RNAV or localizer-only approach |
| **TO** | Vertical | Takeoff pitch attitude: +9°, the AFM rotation attitude |
| **GA** | Vertical | Go-around pitch attitude: +10° |

### Armed and active

The PFD's mode band shows the active lateral mode on the left and the active vertical mode on the right, in
**green**. Below each, any **armed** mode is in **white**. An armed mode waits for its capture criteria, then becomes
active and the log announces it (positive capture annunciation, AC 25.1329-1C 65c(2)):

```
LOCALIZER captured    LNAV captured    GLIDESLOPE captured
GLIDEPATH captured    VNAV path        ALTITUDE 3,000 captured
```

`ALTS` shows as armed (white) whenever the vertical mode is VS, VNAV, TO or GA. **AP** is shown green in the middle
of the band while it is engaged. For 5 seconds after a disconnect it flashes red and amber, and with nothing engaged
the band reads `AP OFF` and the reason.

## Capture criteria

| Armed mode | Becomes active when |
|---|---|
| LOC | The localizer is valid and within **1.5 dots** |
| GS | The glideslope is valid, within **0.4 dot**, and the localizer is within 2 dots |
| LNAV | The FMS has guidance and you are within **2 nm** of the path, and either above **400 ft** above the ground, or airborne in a mode other than TO or GA |
| VNAV | LNAV is active and the plan has a vertical target, not in GA. After takeoff (TO), only above **1,000 ft** above the ground (the acceleration height). |
| GP | LNAV or LOC is active and the FMS has sequenced **past the final approach fix** |
| ALTS (from VS) | Within the larger of 30 m (about 100 ft) or 6 seconds of the current vertical speed |
| ALTS (from TO or GA) | Climbing, the preselected altitude above you, and within the larger of 60 m or 8 seconds of climb. A go-around only captures from below. |
| ALT (from ALTS) | Within 15 m (about 50 ft) and almost level |

When the approach is armed, a pending LNAV or VNAV arm engages first. The approach modes arm behind it.

## Lateral modes

### HDG and the heading knob

`{` and `}` move the bug 5° per press, and selecting a heading always puts the lateral mode in HDG. That leaves LOC
or LNAV, cancels the approach, and drops GS or GP to ALT.

The airplane turns the way you spun the knob, even past 180° (AC 25.1329-1C 63b). `bumpHdg` counts the degrees still
to turn. While that count is 179° or more, the turn keeps the direction you spun. `test/nav_test.mjs` spins the bug
270° to the right, from 063° to 333°, and the airplane turns right, the long way round.

### LOC

The localizer course is flown on the track. The commanded track is the course minus a correction for the cross-track
error, capped at 30°. Bank is limited to 20°.

### LNAV

LNAV follows the track or heading the FMS asks for on the active leg (see [FMS and navigation](fms.md)). If a leg
has a published turn direction and the short way is the other way, LNAV turns the long way round. It does this until
it is within 5° of the wanted track.

### Bank limits

Bank is commanded at 1.5° per degree of heading or track error, up to:

| Condition | Bank limit |
|---|---|
| HDG, LNAV | 25° |
| LOC | 20° |
| Airborne below 400 ft above the ground | 15° (keeps the wingtips clear, AC 25.1329-1C 63c(3)) |

## Vertical modes

### Altitude preselect

`<` and `>` round the preselected altitude to the nearest 500 ft and step it by 500 ft, never below 1,000 ft. With
the AP or FD on and the vertical mode not GS, GP, TO, GA or VNAV, a new preselect starts a VS climb or descent
towards it:

- Climb at 7.6 m/s (about 1,500 ft/min) below 3,000 m (about 9,800 ft), and 5.1 m/s (about 1,000 ft/min) above.
- Descend at 7.6 m/s (about 1,500 ft/min).

It then captures (ALTS) and holds (ALT). In VNAV, GS, GP, TO and GA the new value is stored and those modes keep
flying.

### VNAV

VNAV takes its target from the FMS (`FMS.vertical`, see [FMS and navigation](fms.md#vnav)). `vnavRate` turns it into
a climb rate:

- **The preselected altitude bounds it.** VNAV never climbs unless the preselect is above you, never descends unless
  it is below you, and never goes through it (AC 25.1329-1C 64i(2)). The one exception is GP on the final approach.
  To let VNAV descend, lower the preselect.
- **On a descent path**, it stays level while the path is still above the airplane (it never climbs to meet the
  path), then follows it down at the path angle (3°, or the leg's published vertical angle).
- **A climb well short of its target** is flown like a flight-level change (AC 25.1329-1C 64f): speed on elevator.
  You set climb thrust, and pitch holds **250 kt below 10,000 ft**, then **280 kt or Mach 0.70**, whichever is the
  lower airspeed.
- **Near the target** it captures like ALTS.

`test/fms_test.mjs` preselects 4,000 ft on an approach whose next constraint is "at or above 3,000". VNAV levels at
3,974 ft and waits there.

### GS and GP

GS flies the glideslope angle at the current ground speed, plus a correction for the height error above or below the
beam. GP flies the FMS's final approach path in the same way as a VNAV descent, except that the preselected altitude
doesn't bound it. That way you can set the missed-approach altitude above you on final without stopping the descent.

### TO and GA

| Mode | Engaged by | Pitch | Lateral |
|---|---|---|---|
| TO | `?` on the ground, or `\|` on the ground with the AP off | +9° | HDG on the current (runway) heading. LNAV arms if a plan is loaded and engages above 400 ft. |
| GA | `?` in the air | +10° | HDG on the current heading, or the localizer course if LOC was active. LNAV arms to fly the published missed approach and engages at 400 ft. |

TO and GA climb until the preselected altitude is above you and they capture it. On the ground, `?` sets the
preselect to at least 3,000 ft, and `|` to at least 1,000 ft above the airplane.

A go-around disconnects the AP (reason `GO AROUND`), turns the FD on and cancels the approach. It doesn't touch the
preselected altitude. If that is below you, the log says "Set a missed-approach altitude above you" and GA keeps
climbing. See [Approaches and minimums](approaches.md#go-around-and-missed-approach).

## Approach arming

`\` arms the approach. It needs the AP or the FD on, and either an approach in the flight plan or a localizer in
range. What it arms depends on the approach the plan holds:

| Approach in the plan | Arms |
|---|---|
| ILS (ident `I…`) | LOC + GS |
| Localizer-only: LOC (`L…`), LDA (`X…`), LOC back course (`B…`), flown on a localizer | LOC + GP |
| RNAV (GPS), RNAV (RNP) and any other approach with a final approach fix | LNAV + GP |
| No approach in the plan, a localizer ahead | LOC + GS |

The type comes from the approach's ident letter, and the localizer from the navaid its final approach fix references.
`test/fms_test.mjs` checks the KDJT approaches: ILS 10L arms LOC+GS, LOC 10L LOC+GP and RNAV (GPS) Y 10L LNAV+GP.

Pressing `\` again cancels the approach. LOC drops to HDG on the current heading, and GS or GP to ALT at the current
altitude.

## Mode loss

When a mode loses its signal or its plan, the guidance falls back to holding heading and altitude. The log announces
it with the disconnect tone (loss of approach mode is annunciated, AC 25.1329-1C 45c):

| Lost | Falls back to | Log |
|---|---|---|
| LOC or GS (localizer no longer valid) | HDG on the current heading, approach cancelled, GS to ALT at the current altitude | `APPROACH MODE LOST — localizer: holding heading and altitude` |
| LNAV (no FMS guidance, for example at the end of the plan) | HDG on the current heading | `LNAV LOST: holding heading and altitude` |
| VNAV or GP (no vertical target) | ALT at the current altitude, rounded to 100 ft | `VNAV LOST: …` or `GP LOST: …` |

## Engaging and disconnecting the autopilot

`X` engages the AP if:

- the airplane is airborne ("AP will not engage on the ground"), and
- bank is within 30°, pitch within 15° and the wing isn't stalled ("AP will not engage: attitude out of limits").

With the FD on, the AP takes over the FD's modes, so a takeoff or go-around keeps climbing to the preselected
altitude. With the FD off, it holds the current altitude and heading in ALT and HDG, and clears any armed modes.

The autopilot disconnects when:

| Cause | Reason shown |
|---|---|
| `X` or a bound disconnect button | `PILOT` |
| Any manual pitch trim input (`,` `.`, a hat switch, R1 or L1). The AFM says manual trim disconnects the autopilot. | `TRIM` |
| TOGA in the air | `GO AROUND` |
| The airplane on the ground (free flight) | `ON GROUND` |
| A stalled tailplane | `PITCH` |
| Mach above 0.845 | `OVERSPEED` |
| Bank above 50°, or descending faster than 45 m/s (about 8,900 ft/min) | `ATTITUDE` |

The automatic disconnects (on the ground, pitch, overspeed, attitude) sound the disconnect tone, flash **AP** on the
mode band and log `AUTOPILOT DISCONNECT — <reason>. YOUR AIRPLANE.`. The ones you cause (`X`, trim, TOGA) happen
between simulation steps and don't produce that log line. A go-around logs its own `GO AROUND — …` message, and with
the FD off the mode band shows `AP OFF` and the reason.

If the FD is off at the moment of disconnect, the approach and armed modes are cleared too. With the FD on, its modes
carry on and the bars keep guiding you.

The servos are clutched and have limited authority. You can overpower them, but the AP stays engaged and keeps
trimming against you until you disconnect it. The log then warns `AP SERVO SLIPPING`. See
[Flight model](flight-model.md) for the control forces.

## The flight director without the autopilot

The FD computes its pitch and bank commands on every step, whether the AP is on or not. With the AP off you fly the
bars yourself.

- Turning the FD on in the air with the AP off starts HDG and ALT on the current heading and altitude.
- Turning it on on the ground starts TO mode.
- In free flight the FD pitch command is limited to −10° to +15°.

`test/nav_test.mjs` flies the ILS 10L by hand on the FD bars, with the AP off, inside 0.04 dot of localizer and 0.09
dot of glideslope from 1,000 to 300 ft. It then goes around, and LNAV engages at 395 ft for the missed approach.

## How a sortie sets the modes

At the start of a sortie `configureGuidance` in `js/freeflight.js` sets the modes a crew would have at that point:

| Start | AP | Lateral | Vertical | Approach |
|---|---|---|---|---|
| On the runway | off | HDG, LNAV armed if a plan is loaded | TO, VNAV armed with a route and cruise altitude | off |
| Start of the approach | on | LNAV | VNAV, FAF altitude preselected | armed |
| 6 nm final | off (FD on) | HDG | ALT, missed-approach altitude preselected | armed |
| En route | on | HDG, LNAV armed | ALT, VNAV armed | arm it yourself with `\` |

See [Planning a sortie](sorties.md#start) for where each start puts the airplane.
