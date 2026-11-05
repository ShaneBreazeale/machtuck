# Getting started

This page takes you from opening the simulator to your first flight in each mode: the N722BD accident scenario and
a free-flight IFR sortie. It also covers pausing, the debrief screen, the render quality key and the URL options.

> **Note:** Nine people died on this flight. The cause is undetermined. Every upset scenario in the sim is a
> hypothesis, not a finding, and the crew's final transmissions are not reproduced in the game.

## Open the simulator

### The live site

Open **[shanebreazeale.github.io/machtuck](https://shanebreazeale.github.io/machtuck/)**. Nothing needs to be
installed. The page loads the airplane, the storm data and the ground imagery in the background while the briefing
screen is up.

### Run it locally

There is no build step. Clone the repository and serve it with any static file server:

```bash
git clone https://github.com/ShaneBreazeale/machtuck.git
cd machtuck
python3 -m http.server 8080
```

Then open http://localhost:8080. Serve the folder over HTTP rather than opening `index.html` from disk: the page is
built from ES modules and loads its data files with `fetch()`.

### Browser and GPU requirements

- **WebGL2 with `EXT_color_buffer_float`.** The renderer needs float render targets for its HDR pipeline and stops
  with an error if the extension is missing. Every current desktop browser has it.
- **A discrete GPU or Apple Silicon** is recommended. Dynamic resolution aims to hold the frame rate near 55 fps.
- **Chrome or Edge** for a force-feedback joystick (WebHID). Ordinary yokes, pedals, throttles and gamepads work
  through the Gamepad API in Chrome and Firefox too. See [Hardware and force feedback](hardware.md).

If the 3D cockpit model fails to load, the sim falls back to the 2D instrument panel drawn over the outside view.

## The briefing screen

The page opens on the accident briefing: the reported timeline on the left, a summary of the airplane model on the
right, and the scenario options under it. Behind the briefing the airplane already sits at FL350 at 12:47:00 EST,
paused.

| Option | What it does |
|---|---|
| **Upset hypothesis** | Picks one of four hypotheses for what happened in the storm. All four are speculation. See [Upset hypotheses and difficulty](hypotheses.md). |
| **Real weather** | On by default. The KAMX NEXRAD volume drives the clouds, icing and the cockpit weather radar; GOES-19, GLM lightning and the KPBI METAR shape the rest. Off gives a synthetic storm cell. `U` switches it in flight. |
| **Real ATC audio** | Off by default. Plays the posted LiveATC recording, synced to the sim clock. The briefing marks it for listener discretion. `T` switches it in flight. |
| **Difficulty** | **As flown**: the autopilot trims hard against the climb and hands over the airplane trimmed nose-down. **Trainer**: a gentler autopilot trim and no nose-down handover. The airplane and the storm are the same in both. |

The buttons along the bottom:

- **Fly it · 12:47:00 EST** starts the accident with your choices.
- **Watch the reconstruction (no flying)** replays the reported ADS-B track with automatic cameras. There is no
  physics and no pilot in this mode.
- **Controls & hardware** opens the binding panel (the same panel as `/` in flight). See
  [Controls](controls.md#hardware-binding-panel).
- **Plan a sortie →** opens the free-flight planner. See [Your first sortie](#your-first-sortie).

## Your first flight in the accident

1. Choose the **Convective core** hypothesis (the first in the list) and **Trainer** difficulty for a first try.
2. Click **Fly it**. You are in the left seat at FL350, about M 0.77, with the autopilot holding altitude and heading.
3. Press `N` if you want to skip the first minute. It runs the sim forward to 12:47:50, just before core entry at
   12:47:56.
4. Watch the PFD, the weather radar on the MFD and the comm log. The autopilot keeps flying until it can no longer
   cope, then disconnects. The **AP OFF** light and an **AUTOPILOT DISCONNECT** banner tell you the airplane is yours.
5. Fly the recovery. The help screen (`H`) has an upset-recovery card written after the AFM procedure:
   thrust idle (`0`), autopilot off (`X`), read pitch *and* roll, level the wings before you pull, then elevator and
   nose-up trim (`.`). Gear down (`G`) at extreme speed or attitude. No spoilers above Vmo/Mmo: they pitch the nose down.

Your inputs are force on the column, not surface position. At high speed full stick may take more than a pilot can
hold, and the **COLUMN FORCE** box shows how hard you are pulling and how much strength you have left. Nose-up trim
takes the load off. See [Cockpit and instruments](instruments.md#column-force) and
[Hardware and force feedback](hardware.md#column-forces-without-force-feedback).

> **Tip:** The EFB tablet (`Tab`) has six procedure cards that tick off each step as you complete it, and it
> highlights the card that matches what the airplane is doing. See [Controls](controls.md#efb-tablet-and-procedure-cards).

### How the sim judges the flight

After core entry the sim watches for an upset: pitch above 25° or below −10°, bank past 45°, a stall or stick shaker,
a tailplane stall, an overspeed, or load factor outside 0.5 to 2.0 g. Once an upset has happened, ten seconds of stable
flight (wings within 15°, pitch between −5° and +15°, descent under 2,000 ft/min, load factor 0.8 to 1.3 g) counts as
**RECOVERED**. If you never upset and fly stable past 12:49:16, the result is **UPSET AVOIDED**. A breakup or ground
contact ends the flight.

## Your first sortie

A sortie is a separate free-flight mode with no storm and no accident script. From the briefing, click
**Plan a sortie →**, or open the page with `#sortie` at the end of the URL.

1. Leave the departure and arrival at **KDJT** (the former KPBI) for a local flight, or pick two of the airports in
   the list.
2. Pick an approach under **Arrival**, for example the ILS.
3. Choose a **Start**. "Lined up on the departure runway" is the full flight; "6 nm final" gets you straight to the
   landing.
4. Leave **Weather** on calm, **Weight** on typical and **Failure** on none.
5. Click **Fly the sortie**.

On a runway start the parking brake is set and takeoff trim is already set. The AFM V1, VR and V2 for your weight are
bugged on the speed tape and called out. Hold `Shift` (the wheel brakes) to release the parking brake, add full thrust
with `=`, and rotate at VR to about +9°. Raise the gear with `G`.

The full planner, with SIDs, routes, STARs, imports and the start options, is described in
[Planning a sortie](sorties.md). For flying the plan with the autopilot, see
[Autopilot and flight director](flight-guidance.md).

## Pausing, restarting and time scale

| Key | Action |
|---|---|
| `P` or `Space` | Pause or resume. The screen shows PAUSED. |
| `R` | Restart: the accident from 12:47:00 with the same hypothesis and difficulty, or the sortie from its start. |
| `[` | Halve the sim rate, down to 0.25×. |
| `]` | Double the sim rate, up to 1× (real time). The sim does not run faster than real time. |
| `N` | Accident: skip to 12:47:50. Replay: jump ahead. |
| `H` | Show or hide the help screen with every key. |
| `/` | Open the controls panel. The sim pauses while it is open. |

The MFD shows the current sim rate, quality setting and frame rate on its **SIM RATE** line. A controller's pause
button (Options) also resumes a paused flight.

## Render quality

Press `K` to step the render quality. The default is Q1.0. Each press goes up to Q1.4, then wraps to Q0.6 and back to
Q1.0. Higher settings render at a higher internal resolution. On top of this, dynamic resolution adjusts the frame
size to stay near 55 fps. The current setting appears as `Q` on the MFD's **SIM RATE** line.

## Cameras

Press `C` to switch between the cockpit and the chase camera. Right-drag looks around in the cockpit and orbits the
chase camera. The mouse wheel zooms the cockpit view. In a replay, `C` cycles four views: cockpit, chase, a ground
camera near the impact site, and **AUTO**, which picks the camera for you. Press `Z` to hide the HUD overlays.

## The debrief

The debrief opens when the flight ends: after a recovery or an avoided upset (about 1.5 seconds later), at impact,
or when a replay reaches its end.

In the accident, a table compares your flight with the reported one: lowest altitude, peak Mach, peak descent rate,
peak load factor, peak equivalent airspeed, airframe stress, when the upset happened and whether you recovered. Below
it is a short note on what went right or wrong. In a sortie, the table shows your last touchdown rate, peak load
factor, peak speed and airframe stress against their limits.

| Button | Action |
|---|---|
| **Fly it again** | Restart with the same setup. |
| **Keep flying** | Close the debrief and carry on. |
| **Briefing** | Back to the accident briefing or the sortie planner. |
| **Replay with cameras** | Replay your own flight from its flight data recorder. |
| **Download flight data (CSV)** | Save the 4 Hz flight data recorder as a CSV file. |

The recorder logs time, altitude, airspeed, Mach, vertical speed, attitude, angle of attack, load factor, control
positions, thrust, spoilers, trim, ice, stall flags, airframe stress, autopilot state, position, heading and N1. It is
also saved in the browser's local storage every 5 seconds.

## URL options

| URL ending | Effect |
|---|---|
| `#sortie` | Opens the sortie planner instead of the accident briefing. |
| `#view=t,cam,orbitYaw,orbitPitch` | Loads the reconstruction paused at `t` seconds after 12:47:00, with sim camera `cam` (0 cockpit, 1 chase, 2 ground) and the given orbit angles. An optional fifth value of `1` keeps the HUD visible. |
| `#shot=x,y,z,yaw,pitch,fov,nexrad,t` | Loads the reconstruction paused at `t`, with a free camera at `x`, `y`, `z` metres from KPBI (x east, y up, z north), looking along `yaw` and `pitch` in degrees with field of view `fov` (default 70). `nexrad` 0 turns the real radar volume off. |

The two debug views are meant for screenshots and renderer checks. `#view` waits until the radar and imagery have
loaded before it jumps to the time. The browser console also exposes the live state as `window.SIM`.

## Where next

- [Controls](controls.md) for every key, mouse action and controller button.
- [Cockpit and instruments](instruments.md) to read the PFD, the radar and the EFB.
- [The N722BD flight](accident.md) for what the data shows.
- [FAQ](faq.md) if something does not work.
