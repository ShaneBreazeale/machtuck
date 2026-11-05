# Upset hypotheses and difficulty

The accident mode offers four ways the upset might have happened, and two difficulty modes for each. All four
hypotheses are speculation, built to be flown, and none of them is a finding. The cause of the N722BD accident is
undetermined. For the reported facts, see [The N722BD flight](accident.md).

> **Important:** The briefing labels the menu "Upset hypothesis (all are speculation)". The first entry calls itself
> "most consistent with data". That is the project's own reading of the public figures, not an official conclusion.

## The four hypotheses

`HYPOTHESES` in `js/scenario.js` defines each case as a set of switches. `newGame()` in `js/main.js` copies them into
the airplane and the storm.

| Menu name | Key | `tailIce` | `tuck` | `trimRunaway` | `iceGain` | `shear` | Other |
|---|---|---|---|---|---|---|---|
| Convective core: shear + rapid SLD icing + Mach tuck | `combined` | yes | yes | no | 1.0 | 1.0 | |
| Ice-contaminated tailplane stall | `tail` | yes | no | no | 1.3 | 0.7 | |
| Updraft overshoot, overspeed and Mach tuck (Mach trim fails) | `tuck` | no | yes | no | 0.6 | 1.3 | `apFail`, `machTrimFail` |
| Runaway nose-down pitch trim in turbulence | `trim` | no | yes | yes | 0.5 | 0.6 | |

### What each switch does

- **`tailIce`** lets ice on the T-tail lower its stall angle. A clean tail stalls at 14° of negative tail angle of
  attack; with full ice, at 14 − 11.5 = 2.5°. A stalled tail pitches the nose down hard and keeps only 22 % of its
  effectiveness. It re-attaches only with a 3° margin, which takes a real pull or less speed. On the column the stalled
  tail goes light and pulses (see [Hardware and force feedback](hardware.md)).
- **`tuck`** turns on the Mach tuck: a nose-down pitching moment that builds from M 0.78 to M 0.92. With the Mach trim
  working, its compensator cancels most of the first part. The size of the tuck is hand-set, not derived from the
  pressure model. Only its ordering against the AFM's Mach limits is checked (see [Validation](validation.md)).
- **`machTrimFail`** makes the Mach trim inoperative. The AFM limits the airplane to M 0.77 with Mach trim inoperative,
  so the sim's Mmo drops to 0.77 and you are in overspeed as soon as you pass it. Pressing `8` (Mach trim) reports
  `MACH TRIM — FAIL (inop this scenario)`.
- **`apFail`** makes the autopilot let go at 12:48:16 with the reason `OVERSPEED`, trimmed nose-down.
- **`trimRunaway`** runs the stabilizer trim nose-down from 12:48:16 for 12 seconds, about 0.8° a second, toward the
  nose-down stop. It runs only while the pitch trim selector is on PRI.
- **`iceGain`** scales how fast ice builds on the wing and tail in cloud and in the core.
- **`shear`** scales the storm's vertical air: the updraft core, the downdraft ring, the scripted climb before the
  upset, the exit pulse, and the updraft read from radar growth (see
  [Real weather and ATC data](weather-data.md#from-reflectivity-to-air)).

### The scripted upset

To make every case start from the recorded moment, `Environment.scriptedUpset()` acts in a short window from
12:48:16 (t = 76 s, `UPSET_T`):

- If the hypothesis has `tailIce` and the tail ice has passed 0.35, the tail stalls.
- As flown, with `tailIce`, the stabilizer trim is set to at most about 3.4° (−0.35 in trim units, nose-down of the
  cruise trim). This stands for the autopilot having trimmed nose-down to chase the climb.
- With `apFail`, the trim goes to at most about 3.1° (−0.45) and the autopilot disconnects with `OVERSPEED`.

At the same moment the storm sends a scripted downdraft pulse on the core's edge (12:48:15 to about 12:48:25). It
follows a scripted updraft that lifts the airplane from about 12:48:04, matching the reported climb. For the trim
hypothesis the runaway starts at 12:48:16 in `js/main.js`.

### What each case feels like

These descriptions follow the code and the repo's tests; they are not predictions of what happened on the real flight.

- **Combined.** Ice on the T-tail, Mach tuck and full-strength shear. At 12:48:16 the iced tail stalls and the nose
  goes over. Of the four, it has the least margin: the README notes that it can break the tail as the iced
  stabilizer stalls and re-attaches.
- **Tailplane stall.** More tail ice (`iceGain` 1.3) and weaker shear. The tail stalls at 12:48:16, but with no Mach
  tuck, the task is to re-attach the tail (a firm pull and less speed) and keep the g positive.
- **Mach tuck.** Little ice but strong shear. The updraft overshoot takes the airplane past the reduced 0.77 limit,
  often before 12:48:16, and the autopilot hands over at 12:48:16 already trimmed nose-down. In
  `test/recovery_test.mjs` the scripted textbook pilot is credited with a recovery only in this case.
- **Runaway trim.** The stabilizer runs toward its nose-down stop. The column force needed to hold it at high speed is
  more than a pilot can keep up for long, so the cure is to stop the trim.

## The autopilot and the handover

In the accident the autopilot (`Autopilot` in `js/scenario.js`) flies HDG and ALT with the cruise pitch law it was
calibrated with. It holds FL350 and follows the reported heading change. There is no autothrottle on the Learjet 60,
so thrust stays wherever it is.

- **Limited authority.** The pitch command is limited to −2.5° to +4°, and the elevator servo to a small fraction of
  its travel. In a strong updraft it saturates and can't hold altitude. The code comment describes this as the way
  the reported +450 ft climb is reproduced.
- **Auto-trim.** While engaged, the autopilot trims to take the load off its servo. In the climb that means trimming
  nose-down. If you fight it, it keeps trimming against you.
- **Clutched servos.** You can overpower the servos. The log then reads `AP SERVO SLIPPING — the autopilot is still
  engaged and trimming against you. Disconnect: X.`

The autopilot disconnects, with the log reading `AUTOPILOT DISCONNECT — <reason>. YOUR AIRPLANE.`, when:

| Reason | Trigger |
|---|---|
| `PILOT` | You press `X` or a bound disconnect button. |
| `TRIM` | You touch the pitch trim (the AFM: manual trim disconnects the autopilot), or a trim runaway passes −0.5 in trim units. |
| `PITCH` | The tail stalls. |
| `OVERSPEED` | Mach passes 0.845, or the `apFail` handover at 12:48:16. |
| `ATTITUDE` | Bank passes 50°, or the descent passes about 8,900 ft/min (45 m/s). |

## Difficulty: as flown and trainer

Since pull request #11 the two modes fly **the same airplane through the same storm**. The aerodynamics, ice, tail
stall, Mach tuck, turbulence and structure are identical. `test/aero_validate.mjs` checks this by flying both modes
for 120 seconds through the storm with the same seed and inputs and requiring identical trajectories.

The mode changes only the autopilot:

| | As flown | Trainer |
|---|---|---|
| Autopilot auto-trim rate (`trimRate` in `Autopilot`) | 0.35 | 0.08, about four times gentler |
| Nose-down trim at the 12:48:16 handover (tail-ice cases) | yes, to about 3.4° | no |
| Briefing text | "the autopilot trims hard against the balloon and hands over trimmed nose-down" | "a gentler autopilot trim and no nose-down handover; same airplane, same storm" |

With the trainer's autopilot the airplane inherits less mis-trim, but on the ISA+11 day of the KMFL sounding it still
doesn't fly itself out: in `test/recovery_test.mjs` no hands-off run recovers in either mode (5 seeds per hypothesis).

> **Note:** Two hand-overs are not affected by the mode. In the Mach tuck case the `apFail` disconnect sets the trim
> nose-down in both modes, and the trim runaway runs in both modes. So "no nose-down handover" in the trainer strictly
> applies to the tail-ice cases (combined and tailplane stall).

## What the force and recovery tests say

`test/force_test.mjs` flies the upset with a force-limited pilot following the AFM procedure. According to the README:

| Pilot starts the recovery | Result |
|---|---|
| 2 seconds after the autopilot lets go | Saved in three of the four hypotheses. The trim runaway still breaks up. |
| 5 seconds after | Marginal. The tailplane-stall case loses about 11,000 ft and the combined case about 10,000 ft (seed 1). |
| 8 to 12 seconds after | The wing fails before the recovery takes hold. |

In the sim's breakups the killer is negative g. When the iced tail stalls, the pitch-down loads the wing to about
−2 g within seconds, past the ultimate load, while the airplane is still near M 0.81. The structure follows the AFM
limit load of +3.0 / −1.0 g with failure at 1.5 times that. Speed alone does no damage below the design dive speed
(an estimate of 377 KIAS / M 0.89; see [Flight model](flight-model.md)).

`test/recovery_test.mjs` checks the pass/fail rules. As flown, no pilot input is never credited as a recovery, and
taking over early and holding level is never credited before a real upset. Both tests take `MODE=trainer` to run
with the trainer's autopilot. See [Testing](testing.md).

## AFM procedures in the sim

The tablet (`Tab`, then `1` to `6`) carries six procedure cards from `PROCEDURES` in `js/main.js`, written in the
project's own words. Cards 1 and 2 follow the order of the AFM FM-123 Overspeed Recovery (Change 37). Each step ticks
itself off when the sim sees it done, and the tablet recommends a card for what is happening: a tail stall, a trim
runaway, an overspeed dive, a dive with the autopilot off, or ice with the heat off. `H` shows the AFM upset-recovery
card.

| Card | Title | Key points |
|---|---|---|
| 1 | Upset recovery: nose low / high speed | Idle, autopilot off, read pitch **and** roll, wings level before any pull, elevator and nose-up trim (expect more than 75 lb), gear down at extreme speed or attitude, spoilers stay in. |
| 2 | Overspeed: Vmo / Mmo exceeded | Idle, autopilot off, wings level then raise the pitch gently, **do not extend the spoilers** above Vmo / Mmo, gear down if severe (tested to M .85 / 320 KIAS). |
| 3 | Tailplane stall: ice contaminated | Pull, nose-up as required; stab heat on; flaps up and don't extend them; reduce thrust; nose-up trim; once the tail re-attaches, reduce speed and level the wings. |
| 4 | Runaway pitch trim | Hold against the trim; autopilot and trim off (`X`); pitch trim selector off (`7`); re-trim on secondary (`7` to SEC, then `,` `.`); reduce speed. |
| 5 | Emergency descent | Idle, spoilers out (only below Vmo / Mmo), gear down below 260 KIAS, descend at Vmo / Mmo and no faster. |
| 6 | Icing: anti-ice systems | Nacelle heat (`9`), wing and stab heat (`I`), N1 high enough for wing bleed heat, pitot and windshield heat, and get out of the icing. |

Why the spoilers stay in: above Vmo / Mmo they add a nose-down pitching moment, the opposite of what you need.

## Tips for recovering

- **Be early.** The force test shows the window closes within seconds of the handover. Have your hands on the
  controls before 12:48:16. `N` gets you close to core entry quickly.
- **Disconnect cleanly.** Press `X`. Pushing through the autopilot only makes it trim against you.
- **Idle.** Pull the thrust to idle (`0`).
- **Wings level first, then pull.** Pulling with bank on tightens the spiral and raises the g.
- **Keep the g positive.** In a tail stall or a tuck the danger is negative g. Firm back pressure in the first seconds
  matters more than a big pull later. Watch the g readout, stay under about +3 g.
- **Trim nose-up.** Your input is force on an unboosted column. A pilot can hold about 60 lb, burst to about 150 lb,
  and tires within about 10 seconds. Nose-up trim (`.`) takes the load off. See [Controls](controls.md).
- **Stop a runaway at the source.** Turn the pitch trim selector (`7`) to SEC or OFF, then re-trim on SEC.
- **Leave the spoilers in** above Vmo / Mmo. Gear down (`G`) is the AFM's tool for an extreme overspeed.
- **Practise.** Try trainer mode first, or slow the sim with `[`. Replay your flight from the debrief to see what
  happened, and download the CSV to study it.

The debrief's tip also responds to how your flight ended. For example, after a negative-g wing failure it tells you
to catch the pitch-down in the first seconds with firm back pressure, idle, wings level and nose-up trim.

## Related pages

- [The N722BD flight](accident.md): the reported facts, the ghost track, recovery detection and the debrief.
- [Flight model](flight-model.md): the Mach tuck, buffet, ice and structure behind these cases.
- [Validation](validation.md): what is checked against the AFM, and the known biases (an optimistic buffet boundary,
  a hand-set tuck) that apply to every upset result.
