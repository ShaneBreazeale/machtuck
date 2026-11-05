# The N722BD flight

On 1 November 2026, Learjet 60 N722BD, flying from Austin (AUS) to North Eleuthera (MYEH), entered a rapidly growing
thunderstorm at FL350 over western Palm Beach County. About a minute and a half later it struck the ground near
Military Trail in Greenacres. Nine people died.

This page covers what is publicly known, how the simulator rebuilds the flight from those reports, and how the
accident mode works.

> **Important:** The cause is undetermined. Everything below is labelled as one of three things: **reported** (public
> sources, all provisional), **sim reconstruction** (how the code turns those reports into a flyable scenario), or
> **hypothesis** (a guess at what might have happened, built so you can fly it). The crew's final transmissions are not
> reproduced in the game or on this wiki.

## Sources

The README credits the timeline to:

- the Flightradar24 blog,
- a BizJet Journal analysis of ADS-B Exchange data,
- NEXRAD analyses by MyRadar and LiveStormChasers,
- LiveATC recordings,
- the NTSB briefing of 2 November 2026.

All figures are provisional. The simulator's own weather comes straight from public NOAA data (NEXRAD, GOES-19, GLM,
METAR and radiosonde), not from these analyses. See [Real weather and ATC data](weather-data.md) and
[Sources and references](references.md).

## What is reported

These figures come from the briefing screen (`index.html`), the reconstruction debrief and the comments in
`js/scenario.js`. Times are EST. 12:47:00 EST is 17:47:00 UTC.

| Time (EST) | Reported |
|---|---|
| 12:47 | Cruise at FL350, about M 0.77, near Palm Beach. Heading changes from about 058° to 100°. |
| 12:47:56 | The airplane enters the 34 dBZ echo at FL350, with a 52 dBZ core below. The cell's 30 dBZ top grows from 33,600 ft (12:43) to 41,000 ft (12:48) and 48,300 ft (12:56). |
| 12:48:06 | A brief climb of about 450 ft, to about 35,450 ft. |
| 12:48:16 | Rapid descent begins. |
| 12:49:02 | Bank of 60° reported. |
| During the descent | The vertical-rate encoder pegs at −32,640 ft/min. Peak speed is estimated from ADS-B at about M 0.9, 575–600 KTAS. The track turns right from 100° to 292° in about 75 seconds. |
| 12:49:32 | Impact near Military Trail, Greenacres, 76 seconds after the descent from FL350 began. |

The NTSB briefing reported indications of an in-flight breakup. The debrief also notes that video suggests the
horizontal stabilizer was missing before impact. That is marked **unconfirmed** in the game.

## How the sim rebuilds the flight

### The ghost track

The magenta "ghost" is N722BD's path as the sim reconstructs it. `buildGhost()` in `js/scenario.js` dead-reckons the
path from a schedule of the reported heading, vertical speed and true airspeed, starting at FL350. It then shifts the
whole track so that core entry (12:47:56) falls on the storm centre. That centre is placed from the KAMX radar about
9.5 miles west and 2 miles north of the airport.

| Time (EST) | Heading | Vertical speed | True airspeed |
|---|---|---|---|
| 12:47:00 | 058° | level | 451 kt |
| 12:47:25 | 058°, then turning | level | 451 kt |
| 12:47:58 – 12:48:10 | turning toward 100° | about +1,000 ft/min | 451 kt |
| 12:48:16 | 100°, then turning right | level | 451 kt |
| 12:48:24 | | about −10,000 ft/min | |
| 12:48:32 | | | 540 kt |
| 12:48:40 | | about −20,100 ft/min | |
| 12:48:56 | | about −32,100 ft/min | |
| 12:49:00 | | | 583 kt |
| 12:49:13 | | about −34,100 ft/min | |
| 12:49:15 | | | 593 kt |
| 12:49:27 | | about −52,600 ft/min | |
| 12:49:31 | 292° | | |
| 12:49:32 | | | 564 kt |

Values between the listed points are interpolated linearly. Any rate steeper than −32,640 ft/min is beyond what the
encoder could report, so those values are not readings. The schedule brings the ghost to the ground at about
12:49:32, the reported impact time.

> **Note:** The briefing gives the 12:48:06 climb as about 450 ft. The ghost's vertical-speed schedule climbs a little
> less, to about 35,270 ft.

You see the ghost in three places:

- as a magenta line and a magenta airplane in the 3D view (`V` toggles it),
- as the magenta "ACTUAL (ADS-B)" curve on the altitude-profile chart, against your own green "YOU" curve, with dots
  at the actual flight's marked events,
- as the track on the tablet map (`Tab`).

### The text timeline

`TIMELINE` in `js/scenario.js` holds timed annotations that appear in the message log as the clock passes them. They
are tagged by source: radio exchanges between the crew and Miami Center, a system marker at core entry, and markers
for the actual flight's events (shown in magenta, and plotted on the profile chart). Those annotations come from the
ATC recordings and a radar-graphic timeline. The crew's final words are deliberately left out of the timeline.

### The storm

The storm is built from the real KAMX radar volumes at 17:45:48Z and 17:51:04Z, blended over time, with GOES-19 cloud
tops and GLM lightning at their recorded times. A simple analytic cell (`STORM` in `js/scenario.js`) sits at the same
place and adds the updraft core, a downdraft ring and a slow drift to the north-west. See
[Real weather and ATC data](weather-data.md).

## Flying the accident

The page opens on the accident briefing. Pick an upset hypothesis and a difficulty, choose whether to use the real
weather and the real ATC audio, then press **Fly it · 12:47:00 EST**. See [Getting started](getting-started.md) for the
first flight and [Controls](controls.md) for every key.

### The start state

`newGame()` in `js/main.js` sets up:

- N722BD at the first ghost point, FL350, heading 058°, 1.95° nose up, 232 m/s (451 kt) true, about M 0.77,
  trimmed for an ISA+7 day.
- Thrust levers at the cruise setting (0.83), stabilizer trim near cruise, light ice on the wing and some on the T-tail.
- The anti-ice systems on (the airplane's default).
- The autopilot engaged in HDG and ALT at FL350. The heading bug follows the reported course change, turning from 058°
  at 12:47:25 to 100° at 12:48:10.

Press `N` to skip ahead to 12:47:50, just before core entry. The skip runs the physics fast, so it is the same flight,
only quicker. `R` restarts with the same hypothesis and difficulty, and `[` `]` change the sim rate.

### What happens if you do nothing

The autopilot flies the cruise and the turn. Inside the core, a scripted updraft lifts the airplane between about
12:48:04 and 12:48:16. The autopilot's servo has limited authority, so it can't hold altitude, and its auto-trim
keeps trimming nose-down to chase the climb. At 12:48:16 a scripted downdraft pulse hits on the core's edge, and each
hypothesis's upset begins (see [Upset hypotheses](hypotheses.md#the-scripted-upset)). The autopilot lets go, and
the log reads `AUTOPILOT DISCONNECT — <reason>. YOUR AIRPLANE.`

If nobody flies it after that, the airplane is lost. In the repo's `test/recovery_test.mjs` "no pilot input" case,
run as flown with three seeds, every hypothesis breaks up by about 12:48:30. In trainer mode the
airplane can sometimes fly itself out of the combined case. See
[Upset hypotheses](hypotheses.md#difficulty-as-flown-and-trainer).

### Recovery detection

`RecoveryJudge` in `js/scenario.js` decides the outcome. It uses the upset definitions in the FAA Airplane Upset
Recovery Training Aid.

| Term | Meaning in the sim |
|---|---|
| Upset | From core entry (12:47:56) on: pitch above +25° or below −10°, bank beyond 45°, or flight outside the envelope (tailplane stall, stall or stick-shaker AOA, overspeed, or load factor outside 0.5 to 2 g). |
| Stable | Wings within 15°, pitch between −5° and +15°, sink under 2,000 ft/min, 0.8 to 1.3 g, and inside the envelope. |
| RECOVERED | An upset first, then 10 seconds of stable flight. |
| UPSET AVOIDED | No upset at all, and 10 seconds of stable flight more than 60 seconds after 12:48:16. |

Load factor and AOA are smoothed over about a second, so a single turbulence spike is neither an upset nor the end of
a recovery. Taking the airplane early and holding it level doesn't count as a recovery until something actually goes
wrong. If the airframe fails, the log reports a separated horizontal stabilizer or a wing failure. If you hit the
ground, the flight ends with `IMPACT` and the time.

## The debrief

The debrief opens when you recover, avoid the upset, crash or reach the end of a replay. It compares your flight with
the reported one.

| Row | You | Actual N722BD (as reported) |
|---|---|---|
| Lowest altitude | your lowest altitude | impact, 12:49:32 |
| Peak Mach | your peak | about 0.9 (estimated from ADS-B; Mmo 0.81) |
| Peak descent | your peak | more than 32,640 ft/min (encoder limit) |
| Peak load factor | your maximum and minimum g | unknown; in-flight breakup indicated |
| Peak EAS | your peak | 575–600 KTAS estimated (about 470 KEAS at 15,000 ft) |
| Airframe stress | percent of the failure threshold | video suggests a missing horizontal stabilizer (unconfirmed) |
| Upset | type and time | 12:48:06 climb, 12:48:16 descent |
| Recovery | altitude and seconds after 12:48:16 | none; 76 s from FL350 to the ground |

Under the table is a tip that depends on how the flight ended: negative-g wing failure, overload, an unwound spiral,
or not enough nose-up authority in time. The buttons are:

- **Fly it again** restarts the same case.
- **Keep flying** closes the debrief.
- **Briefing** goes back to the briefing screen.
- **Replay with cameras** replays your flight.
- **Download flight data (CSV)** saves the flight data recorder.

### Flight data recorder

The recorder logs 24 channels at 4 Hz: time, altitude, KIAS, Mach, vertical speed, pitch, roll, AOA, load factor, the
control surfaces, thrust, spoilers, trim, ice, tail and wing stall flags, airframe damage, autopilot state, position,
heading and N1. Every 5 seconds, and at the end, it saves to the browser's `localStorage` under `n722bd_fdr`. The CSV
file name records the hypothesis, the mode and the length of the flight.

## Replay and the reconstruction

### Replay with cameras

**Replay with cameras** plays back your own recorded flight with no physics. `C` cycles through four cameras:

| Camera | View |
|---|---|
| Cockpit | The pilot's eye in the virtual cockpit. |
| Chase | Behind the airplane; right-drag orbits. |
| Ground cam | A fixed observer about 600 m south-west of where the flight ended, zoomed to keep the airplane in frame. |
| Auto | Chase until 12:47:48, cockpit into the core until 12:48:26, chase through the upset, then the ground cam for the last 32 seconds. |

In a replay, `N` jumps to 12:48:10, then to 12:48:58. The real ATC audio, if it's on, follows the replay clock.

### Watch the reconstruction

**Watch the reconstruction (no flying)** on the briefing replays the reported ADS-B track through the real radar
volume, with no physics and no pilot. The header reads "RECONSTRUCTION OF THE REPORTED ADS-B TRACK". It starts on the
Auto camera.

`buildReconRows()` in `js/main.js` turns the ghost into recorder rows. Position, heading, vertical speed and true
airspeed come from the ghost. KIAS and Mach are worked out for an ISA+7 day. Everything else is **inferred, not
recorded**:

- the bank: about 12° in the course change, then a tightening right spiral through the reported 60° at 12:49:02,
- the AOA, load factor, thrust and trim,
- the ice build-up through the core,
- a breakup that completes with stabilizer separation at about 12:49:14.

The reconstruction debrief lists the reported cruise, core entry, upset, peak Mach and descent, bank, breakup and
impact. It reminds you that attitudes, bank and the breakup time are inferred.

> **Note:** The reconstruction shows one possible way the reported track could have been flown, drawn to match the
> public figures. It is not flight recorder data, and it does not show what the crew saw or did.

## Debug views

Two URL hashes load the reconstruction paused at a chosen time, for screenshots and inspection:

- `#view=t,cam,orbitYaw,orbitPitch` uses a sim camera (0 cockpit, 1 chase, 2 ground).
- `#shot=x,y,z,yaw,pitch,fov,nexrad,t` uses a free camera in metres from KPBI (x east, y up, z north).

## Related pages

- [Upset hypotheses and difficulty](hypotheses.md): the four cases, the autopilot handover and recovery technique.
- [Real weather and ATC data](weather-data.md): the radar, satellite, lightning and audio behind the scenario.
- [Flight model](flight-model.md) and [Validation](validation.md): how far to trust the airplane.
