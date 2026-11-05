# Cockpit and instruments

The sim draws a Learjet 60 panel in the style of the Collins Pro Line 4: a primary flight display (PFD), an MFD with
the weather radar, an engine column, a switch panel, glareshield annunciators and an EFB tablet. You see it in one of
three layouts:

- **3D cockpit** (`js/cockpit.js`): the default cockpit view. The left-seat virtual cockpit of the Premier Aircraft
  Design Learjet 60, with the live instruments drawn onto its panel.
- **2D panel** (`js/hud.js`): drawn over the lower part of the screen if the 3D cockpit is not available.
- **Chase view**: a compact PFD, the MFD, the switch panel and the annunciators along the bottom of the screen.

The 3D cockpit and the 2D panel draw the same PFD (`js/pfd.js`) and share the rest of the instrument code in
`js/hud.js`. The chase view's compact PFD is a simpler attitude display from `js/hud.js`, with a green flight path
marker and crosshair flight director bars instead of the single cue.

## The PFD

The PFD shows the flight guidance mode band across the top, the attitude display in the middle with the speed tape on
its left and the altitude tape and VSI on its right, the deviation scales, and the HSI below. In the 3D cockpit the
full compass rose is visible; on the wider 2D panel only its top half fits.

### Flight guidance mode band

| Position | Shows |
|---|---|
| Left, top | Active lateral mode in green: HDG, LOC or LNAV |
| Left, below | Armed lateral mode in white |
| Right, top | Active vertical mode in green: ALT, VS, VNAV, GS, GP, TO, GA, or ALTS CAP during altitude capture |
| Right, below | Armed vertical modes in white. ALTS (altitude capture) shows armed whenever you are in VS, VNAV, TO or GA. |
| Centre | AP in green when the autopilot is engaged, YD when the yaw damper is on |

For five seconds after the autopilot disconnects, AP flashes red and amber. When the autopilot has disconnected and
the flight director is off, the band shows **AP OFF** and the reason in amber, for example PILOT, TRIM or PITCH. The modes themselves are
explained on [Autopilot and flight director](flight-guidance.md).

### Attitude and flight director

- **Pitch ladder** in 2.5° steps, numbered every 10°.
- **Roll scale** with marks at 10°, 20°, 30°, 45° and 60°. The bank pointer turns amber past 35°.
- **Slip/skid bar** under the bank pointer, offset by sideslip.
- **Flight director**: a single-cue command bar in magenta (V-bars). It moves up or down with the pitch command and
  banks with the roll command. Fly the white aircraft delta into the V. It shows only when the flight director is on.
- **G** readout, lower left: white, amber above 2.5 g, red above 3 g or below −1 g (the AFM limit loads).
- **α** readout, lower right: angle of attack in degrees, red when the wing is stalled.
- **Marker beacon** box, upper right: OM in blue, MM in amber, others in white.
- **Radio altitude**, bottom centre, in free flight below 2,500 ft above the ground. It turns amber below minimums.

A warning flashes across the attitude display when it applies, in this order of priority: **STRUCTURAL FAILURE**,
**STALL**, **OVERSPEED**, **PULL UP** (descending faster than about 5,900 ft/min below about 9,800 ft) and
**BANK ANGLE** (past 45°). The sim also
calls out "Bank angle", "Pull up" and "Overspeed".

### Speed tape

The speed tape shows indicated airspeed in a window about 90 kt tall, with a readout box that turns red in an
overspeed. Above M 0.40 the Mach number appears under the tape, red above Mmo.

Coloured bands run down the inner edge of the tape. They come from the model's own speed envelope at the current load
factor, so they move as you bank or pull:

| Band | Meaning |
|---|---|
| Red and white (top) | Above Vmo/Mmo |
| Red and white (bottom) | Below the stick-shaker speed |
| Amber (bottom) | Where 30 % more g, from a gust or a pull, would reach the shaker |
| Amber (top) | Where 30 % more g would reach shock buffet, up to Vmo/Mmo |

Watch the two amber bands close in from both ends as you climb or bank at altitude: that is the coffin corner.

A magenta **trend vector** from the readout shows where the speed will be in 10 seconds. In free flight, cyan bugs mark
the AFM takeoff speeds (**1**, **R** and **2** for V1, VR and V2) on the ground and just after takeoff, and **REF**
(VREF) once the flaps are at 20° or more or the gear is down.

### Altitude tape and VSI

- **Altitude readout** rounded to 10 ft, on a tape about 900 ft tall with labels every 200 ft.
- **Preselected altitude** in cyan at the top of the tape, with a cyan bug on the tape. Set it with `<` and `>`.
- **Baro setting** under the tape. It always reads 29.92; there is no altimeter setting to change.
- **Minimums**: a cyan line across the tape at the decision altitude or MDA, and **MIN** with the value under the baro
  setting. The MIN readout flashes amber once you are below it. Minimums come from the FAA approach plate; see
  [Approaches and minimums](approaches.md).
- **VSI** on the far right: a pointer on a compressed scale out to 6,000 ft/min, labelled 1, 2 and 4 (thousands). It
  is green, and red beyond 6,000 ft/min. A numeric readout appears above or below the scale when the rate is 400 ft/min
  or more.

### Deviation scales

The lateral scale sits under the attitude display and the vertical scale on its right edge. Each has two dots either
side of centre. The diamond is filled while it is on scale and hollow when it is pinned past the last dot.

| Source | Colour | Lateral | Vertical |
|---|---|---|---|
| ILS (LOC1) | Green | Localizer deviation | Glideslope deviation |
| FMS (FMS1) | Magenta | Cross-track error: 0.5 nm per dot, 0.15 nm per dot from the final approach fix to the missed approach point | VNAV or GP path: 100 ft per dot |

The vertical scale shows the glideslope when one is being received, and otherwise the FMS vertical path when VNAV or
GP is active or armed.

### HSI

- **Heading** readout in a box at the top, magnetic, with a rotating compass rose and a lubber line.
- **Heading bug**: a notched magenta bug on the rose, and **HDG** with its value in cyan at the lower left. Set it with
  `{` and `}`.
- **Nav source** at the upper left: **LOC1** in green or **FMS1** in magenta, with **CRS** (localizer course) or
  **DTK** (FMS desired track) below it.
- **Distance** at the upper right in nm (DME for the ILS, distance to the active fix for the FMS) and the station or
  waypoint ident.
- **Course pointer** and **deviation bar** in the nav source colour, with two dots either side.
- **Bearing pointer** in cyan to the active FMS waypoint.

The source is LOC1 when a valid localizer is received and LOC is active or armed, or when there is no flight plan
leg. Otherwise it is FMS1 whenever the FMS has an active leg. With neither, the nav fields are blank.

## Glareshield

### Annunciators

| Light | Colour | Lit when |
|---|---|---|
| MASTER WARN | Red, flashing | Structural failure, a stall, or a fast descent close to the ground |
| MASTER CAUT | Amber, flashing | Overspeed, heavy tail or engine ice, or for 4 seconds after the autopilot disconnects |
| AP OFF | Amber | Autopilot not engaged |
| SHAKER | Amber | Stick shaker running |
| OVERSPEED | Red | Above Vmo/Mmo |
| STAB ICE | Amber | Heavy ice on the horizontal stabilizer |
| WING ICE | Amber | Heavy ice on the wing |
| ENG ICE | Amber | Engine ice |
| TRIM | Red or amber | Pitch trim selector off PRI (amber on OFF), or a trim runaway (red) |
| MACH TRIM | Amber | Mach trim off or failed |
| SPOILER | Green | Spoilers extended |
| GEAR | Green | Gear down |
| YD OFF | Amber | Yaw damper off |

### Flight guidance strip

To the right of the lights, the FGC strip shows AP, FD, YD, the lateral mode, the vertical mode and APR, each green
when active. Its readout gives the targets, for example `ALT 35000  HDG 058°`, `VS +1500 → 10000`, or the armed modes.
It is cyan with the autopilot engaged, amber with only the flight director, and reads **AP OFF** with the reason when
both are off.

In the 3D cockpit the same lights and strip are drawn over the painted annunciator grid. Below them is the flight
guidance panel (`fgp` in `js/vcgauges.js`), in two parts either side of the model's trim indicator. The same panel
sits at the left end of the 2D panel's bottom bar. Every part is a live control (see
[Controls](controls.md#cockpit-controls)); each button's green bar lights from the real mode, with the autopilot or
the flight director on.

| Control | Shows / lit when | Use |
|---|---|---|
| HDG knob | Its pointer turns with the bug | Scroll: 1° (Shift 10°). Click its left / right third: 1°. Click the centre: sync the bug to the heading |
| HDG window | The selected heading, green in HDG mode | |
| HDG | Lateral mode HDG | HDG on the current heading |
| NAV | LNAV or LOC engaged or armed | Arm LNAV, like `(` |
| APR | The approach armed or captured | Arm the approach, like `\` |
| AP | Autopilot engaged | Engage or disconnect, like `X` |
| YD | Yaw damper on | Yaw damper on or off, like `Y` |
| FD | Flight director on | Flight director on or off, like `\|` |
| VNAV | VNAV engaged or armed | Arm VNAV, like `)` |
| ALT | ALT hold or altitude capture | Hold the current altitude |
| VS | Vertical mode VS | VS at the current vertical speed, to the preselected altitude |
| VS wheel | The VS window shows the target in VS mode | Scroll or click its top / bottom: 100 ft/min (Shift 500); from another mode it enters VS at the current rate |
| ALT / VS window | The preselected altitude (cyan) and the VS target | |
| ALT knob | Its pointer turns with the preselected altitude | Scroll: 100 ft (Shift 1,000). Click its left / right third: 100 ft. Click the centre: hold the current altitude. Like `<` `>`, a new altitude away from yours starts a VS climb or descent toward it |

HDG, ALT, VS and the VS wheel need the autopilot or the flight director on; otherwise the log says to engage one
first. In the accident the heading bug follows the crew's reported turn until you set it yourself (HDG knob, `{` `}`).

## MFD and weather radar

The MFD shows the weather radar on its upper part and a data block below it.

The radar paints a 120° sector ahead (60° either side of the nose) out to the selected range, from the NEXRAD
reflectivity in a height band around your altitude. Tilt is fixed at 0.

| Colour | Reflectivity |
|---|---|
| Green | 18 to 30 dBZ |
| Yellow | 30 to 40 dBZ |
| Red | 40 to 50 dBZ |
| Magenta | 50 dBZ and above |

The header gives the range, `TILT 0`, the source (**KAMX** for the real radar volume, **SYNTH** for the modelled
cell with real weather off), your heading, and **HERE** with the reflectivity at the airplane (red above 30 dBZ).
Range rings are labelled at quarters of the range.

| Key | Radar action |
|---|---|
| `O` | Radar on or off. Off shows WX RADAR OFF (O). |
| `J` | Range 40, 80, 20 nm, then back to 40. The EFB map uses the same range. |
| `U` | Real NEXRAD volume or the modelled storm cell |

In free flight there is no storm, so the radar shows clear air and the header has no source label.

The data block lists **OAT / SAT**, **IN CLOUD** (VMC, IMC or CONVECTIVE CORE in red), **VERT AIR** (the updraft or
downdraft in ft/min, amber when strong), **CLOCK EST** and **SIM RATE** (rate, quality setting and frame rate).

## Engine column

Round gauges for each engine, left and right: **N1**, **ITT** (red above 760), **N2** and **FF** (fuel flow, lb/h).
Under them, bars for pitch trim (stabilizer degrees and the trim selector), spoiler and flap position, **STRESS**
(airframe stress in percent, red above 70 %) and **ICE** for the wing and the stabilizer.

## Switch panel and pedestal

The switch panel is labelled ANTI-ICE · STALL · TRIM · FLT CTL. Every row is a clickable switch with its key
(STALL WARN, which has none, reads `click`): wing heat (shows ON·LOW in amber when N1 is too low to heat the wing), stab heat, nacelle heat, pitot/windshield heat,
stall warning, Mach trim, pitch trim selector, autopilot, yaw damper, spoilers, landing gear (red when down above
260 KIAS), flaps, ATC audio and EFB. See [Controls](controls.md#mouse-and-touch).

On the 2D panel, the pedestal strip along the bottom shows the thrust levers, the spoiler and flap levers, thrust and
N1 in percent, and the trim position and selector. The trim readout turns red when it is far nose-down.

## EFB moving map

The EFB map is north-up and centred on your airplane, with range rings at half and full range (`J` sets it).

- **Background**: a simplified coastline and the runways in the sim's runway table.
- **NEXRAD composite** (accident): the column-maximum reflectivity of the radar volume, in the same colour steps as
  the radar.
- **Flight plan** (free flight): the FMS legs through their fixes, each fix a diamond with its ident. The active leg
  is magenta, the rest white, and the missed approach dashed cyan.
- **Reported track** (accident): the ADS-B track of N722BD, dashed magenta, with an X at its end.
- **Your trail** in green, and a white own-ship symbol with a heading line.

The footer shows the range, N UP, the radar source, ground speed and altitude. The procedure cards on the other EFB
page are described on [Controls](controls.md#efb-tablet-and-procedure-cards).

## Column force

The **COLUMN FORCE** box shows the force you are holding on the column, worked out by `js/controls.js`:

- **Pitch bar**: push to the left, pull to the right, on a 150 lb scale with ticks at ±60 lb (what a pilot can hold).
  It is green up to 60 lb, amber above, and flashes red when you are at the limit of your strength.
- **PULL** or **PUSH** with the force in pounds, and **ROLL** with the wheel force and its direction.
- **Strength** bar: how much of your burst strength is left. It drains while you hold more than you can sustain and
  recovers when you relax.
- **AP CLUTCH SLIPPING — X** when you are overpowering the engaged autopilot's servos. Press `X` to disconnect it.

The force model is described on [Hardware and force feedback](hardware.md#column-forces-without-force-feedback).

## Other overlays

- **Header**, top left: the airplane, clock and hypothesis (or the sortie), with a line of key hints.
- **Altitude profile**, top right (accident): your altitude in green against the reported ADS-B profile in magenta
  over the first 160 seconds, with dots at the reported events and your peak g, Mach and descent rate.
- **Status panel**, top right (free flight): radio altitude or ground speed, gear (and gear damage), flaps, spoilers,
  reversers, a failed engine, brakes or parking brake, nosewheel angle, the last touchdown rate (amber above
  360 ft/min, red above 600 ft/min) and the wind.
- **Comm log**: the last six messages, colour-coded by who sent them.
- **Banners** across the top: RECOVERED, AUTOPILOT DISCONNECT, or the reason the flight ended.
- **Windshield** (2D panel): rain streaks in cloud, darkening in the core, ice building from the edges (less with
  windshield heat on) and lightning flashes.

## 3D cockpit details

The 3D cockpit is the virtual cockpit of the Premier Aircraft Design FSX Learjet 60 (FS2004 MDL8 format), converted by
`tools/fs9_vc.py`.
The yokes, rudder pedals, thrust levers (which lift into reverse), flap lever and spoiler lever move with your
controls. Its thrust, flap and spoiler levers and the red parking-brake handle are live too: drag a lever, click
the handle (see [Controls](controls.md#cockpit-controls)). Right-drag to look around and use the mouse wheel to zoom.

The pilot's and copilot's PFDs and MFDs and the engine column are live, drawn by the code above. The other gauges are
the sim's own artwork from `js/vcgauges.js`, placed where the original panel had them:

| Gauge | Notes |
|---|---|
| MASTER WARNING / MASTER CAUTION | Top of the pilot's panel, same logic as the annunciators |
| Standby attitude | Pitch and bank |
| Standby airspeed | 40 to 450 KIAS with a red arc from Vmo, and Mach |
| Standby altimeter | Copilot side: 100 ft pointer, drum readout, 29.92 |
| RMI | Heading and track |
| Clocks | Scenario local time |
| Gear lights and lever | NOSE, LH, RH green when down, red when down above 260 KIAS. Click the lever to move the gear. |
| Fuel quantity | Total, in lb |
| Flap and spoiler position | Copilot panel: flaps 0, 8, 20, 40; spoilers RET or EXT |
| Pitch trim | 1° (nose down) to 12° (nose up), with the green takeoff segment of 5.7° to 8.75° |
| Whiskey compass | On the windshield centre post |
| Switch panel | Outboard of the pilot's PFD, clickable |
| EFB tablet | Clamped to the left side window, clickable |
