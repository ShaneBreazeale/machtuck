# Controls

Every keyboard, mouse and controller input in the sim, taken from the keymap in `js/input.js`, the event handling
in `js/main.js` and the controller defaults in `js/hardware.js`. Press `H` in flight for the same list on screen.

Keys are matched by the character they type, not by their position, so the symbol keys follow your keyboard layout.
On a US layout, `{` `}` `<` `>` `(` `)` `@` `?` `|` and `~` need Shift. Keys do nothing while you are typing in a
text box, such as the DIRECT TO box or the sortie route.

## Flying

| Key | Action |
|---|---|
| `↑` or `W` | Push (nose down) |
| `↓` or `S` | Pull (nose up) |
| `←` or `A` | Roll left |
| `→` or `D` | Roll right |
| `Q` / `E` | Left / right rudder; on the ground also nosewheel steering |
| `,` | Pitch trim nose-down (hold) |
| `.` | Pitch trim nose-up (hold) |
| `G` | Landing gear up or down |
| `F` | Flaps: up, 8°, 20°, 40°, then back to up |
| `B` | Spoilers extend or retract |
| `Shift` | Wheel brakes, both sides (hold). Pressing them also releases the parking brake. |

Keyboard pitch, roll and rudder are on/off keys, so the sim ramps them: they build up over a fraction of a second and
recentre a little faster. Mouse and hardware inputs skip the ramp.

All of these inputs are **force on the column**, not surface position, because the Learjet 60's elevator and
ailerons have no hydraulic boost. Holding `↓` pulls with your full available force; how much elevator that buys
depends on airspeed. See [Hardware and force feedback](hardware.md#column-forces-without-force-feedback).

Manual pitch trim disconnects the autopilot if it is engaged. Trim runs at full rate with the pitch trim selector on
PRI, at a slower rate on SEC, and not at all on OFF (key `7`, below).

## Engines and thrust

| Key | Action |
|---|---|
| `=` (or `+`) | Thrust levers forward (hold). Full travel takes about 2 seconds. |
| `-` (or `_`) | Thrust levers back (hold) |
| `0` | Thrust levers to idle, and reversers stowed |
| `-` past idle, on the ground | Deploys the thrust reversers; holding it raises reverse thrust |
| `=` with reversers out | Stows the reversers before any forward thrust |

There is no autothrottle on the Learjet 60, so the levers are always yours, with the autopilot on or off. On the
ground in free flight the spoilers deploy themselves when the levers are at idle above 60 kt, and stow when thrust
comes back up.

## Autopilot and flight guidance

| Key | Action |
|---|---|
| `X` | Autopilot engage or disconnect. It engages in HDG and ALT, but not on the ground, and not beyond 30° of bank, 15° of pitch or in a stall. |
| `\|` | Flight director on or off. On the runway it comes up in takeoff mode (+9°); in the air in HDG and ALT. |
| `{` / `}` | Heading bug left / right 5° |
| `<` / `>` | Preselected altitude down / up 500 ft (not below 1,000 ft) |
| `\` | APR: arm the approach (localizer then glideslope, or the FMS approach). Needs the autopilot or flight director on. |
| `(` | Arm LNAV (needs a flight plan) |
| `)` | Arm VNAV (needs a flight plan) |
| `@` | DIRECT TO box (free flight with a flight plan). See [Direct to](#direct-to). |
| `?` | Go-around (TOGA) in the air; takeoff mode on the runway. Free flight only. |

The full mode logic is on [Autopilot and flight director](flight-guidance.md). The mode band at the top of the PFD and
the flight guidance strip on the glareshield show what is engaged and armed; see
[Cockpit and instruments](instruments.md#flight-guidance-mode-band).

## Systems

| Key | Action |
|---|---|
| `I` | Wing and stabilizer heat on or off (one switch for both) |
| `9` | Nacelle heat, left and right |
| `8` | Mach trim on or off (shows FAIL in the hypothesis where it has failed) |
| `7` | Pitch trim selector: PRI, then SEC, then OFF, then back to PRI |
| `Y` | Yaw damper on or off |

Pitot and windshield heat and the stall warning (shaker) cutout have no key. Click their switches on the switch panel
instead (see [Mouse and touch](#mouse-and-touch)).

## Navigation and charts

| Key | Action |
|---|---|
| `~` | Approach plates: opens on the loaded approach's chart, or on the airport diagram when you are on the ground. Esc closes. KDJT's charts show as images; elsewhere each plate opens a link to the FAA PDF. |
| `Tab` | EFB tablet: map, then procedures, then off |
| `1` to `6` | Open procedure card 1 to 6 on the EFB |
| backtick key | Back to the procedure list |
| `O` | Weather radar on or off (MFD) |
| `J` | Weather radar and EFB map range: 40, 80, 20 nm, then back to 40 |

## View and display

| Key | Action |
|---|---|
| `C` | Camera: cockpit or chase. In a replay: cockpit, chase, ground camera, AUTO. |
| `Z` | Hide or show the HUD overlays |
| `V` | Show or hide the magenta ghost of the reported track (accident) |
| `K` | Render quality: Q1.0 (default), Q1.4, Q0.6, then back |
| `U` | Real weather (NEXRAD volume and GLM lightning) or the modelled storm cell and lightning |

## Sim and audio

| Key | Action |
|---|---|
| `P` or `Space` | Pause or resume |
| `R` | Restart the accident or the sortie |
| `N` | Accident: skip to 12:47:50, just before core entry. Replay: jump ahead. |
| `[` / `]` | Sim rate down / up: 0.25×, 0.5×, 1× (no faster than real time) |
| `H` | Help screen with every key and the upset-recovery card |
| `/` | Controls and hardware panel (pauses the sim while open) |
| `M` | Mute or unmute the sim sounds |
| `T` | Real ATC audio (LiveATC recording) on or off. Off by default. |
| `;` / `'` | Shift the ATC tape 1 second earlier / later against the sim clock. The shift is remembered. |
| `L` | Synthesized voice for the radio calls in the comm log, on or off |

## Mouse and touch

| Input | Action |
|---|---|
| Left-drag | Flies the airplane like a stick: drag down to pull, sideways to roll. Release to centre. |
| Right-drag | Look around in the cockpit; orbit the chase camera |
| Mouse wheel | Turns the knob under the mouse; elsewhere zooms the 3D cockpit view |
| Left-click | Operates switches, buttons and knobs (below) |
| Hover | Outlines the control under the mouse and shows its name, state and how to use it |
| Touch drag | Flies the airplane, like a left-drag |

### Cockpit controls

Every control you can operate with the mouse works the same way (`js/panel.js`). Hovering it outlines it in cyan,
turns the pointer into a hand (or an up-down arrow on a knob) and shows a tooltip with its name, its state and how to
use it. A click gives a click sound and the button presses in. Knobs turn with the wheel (Shift: bigger steps); a
click on a knob's left or right third steps it, a click in its middle pushes it. The mouse actions are the same as the
keys, so a button and its key never disagree.

What you can click:

- **Flight guidance panel** (the glareshield in the 3D cockpit, the bottom bar of the 2D panel): HDG knob, HDG, NAV
  (`(`), APR (`\`), AP (`X`), YD (`Y`), FD (`|`), VNAV (`)`), ALT, VS, the VS wheel and the ALT knob. See
  [Cockpit and instruments](instruments.md#flight-guidance-strip).
- **Switch panel** (outboard of the pilot's PFD in the 3D cockpit, on the right of the 2D panel): wing heat, stab heat,
  nacelle heat, pitot/windshield heat, stall warning, Mach trim, pitch trim selector, autopilot, yaw damper, spoilers,
  landing gear, flaps, ATC audio and EFB mode. Each switch shows its key next to it; STALL WARN, which has no key,
  reads `click`.
- **EFB tablet**: the header bar cycles the mode, the procedure titles open their cards, and **‹ list** goes back.
- **3D cockpit gear lever**: raises or lowers the gear.

In the 3D cockpit a click is ray-cast onto the panel, so it works from any head position. If you click empty space,
the click becomes a stick drag instead.

## Gamepad

A controller with the browser's standard layout (DualShock, DualSense, Xbox and similar) works without setup.

| Control | Action |
|---|---|
| Left stick | Pitch and roll (pull back to pull) |
| Right stick, left/right | Rudder |
| R2 / L2 | Thrust up / down, proportional to how far you press. L2 past idle on the ground deploys the reversers. |
| R1 / L1 | Pitch trim nose-up / nose-down (hold) |
| Cross (A) | Autopilot engage or disconnect |
| Circle (B) | Spoilers |
| Square (X) | Thrust idle |
| Triangle (Y) | Camera |
| D-pad up | Gear |
| D-pad down | Flaps |
| D-pad left | Wheel brakes (hold) |
| L3 (press the left stick) | Yaw damper |
| Options (Menu) | Pause; also resumes a paused flight |
| Create (Share, View) | Help screen |

The stick axes have a small dead zone. In Chrome, a controller with rumble motors vibrates with the stick shaker,
buffet and a breakup.

A gamepad without the standard layout (for example in Firefox on macOS) gets only its sticks and analog triggers by
default. Bind its buttons in the controls panel. When a device connects, the comm log says what it will do.

## Hardware binding panel

Press `/`, or click **Controls & hardware** on the briefing screen. The panel lists every connected device with its
live axes and buttons, and a table of functions you can bind:

- **Axes:** pitch, roll, rudder, throttle lever, left toe brake, right toe brake.
- **Buttons:** autopilot disconnect, trim nose-up, trim nose-down, gear, flaps, spoilers, throttle idle, camera,
  brakes (both, hold), parking brake, thrust reversers (hold), go-around (TOGA).

Click **Bind**, then move or press the control. **Invert** flips an axis, **Clear** removes one binding, and
**Clear all bindings** removes them all. The sim is paused while the panel is open; Esc cancels a binding in progress
or closes the panel. A device only appears after you press one of its buttons.

The parking brake, toe brakes and TOGA on a button exist only as bindings; they have no default key. Binding, defaults,
calibration and force feedback are covered in detail on [Hardware and force feedback](hardware.md).

## EFB tablet and procedure cards

The EFB tablet sits on the left of the 2D panel, or clamped to the left side window in the 3D cockpit. `Tab` cycles
it through **MAP**, **PROCEDURES** and **OFF**.

The procedures page lists six emergency and abnormal cards, written in the sim's own words. Cards 1 and 2 follow the
order of the AFM overspeed recovery procedure.

| Key | Card |
|---|---|
| `1` | Upset recovery: nose low / high speed |
| `2` | Overspeed: Vmo / Mmo exceeded |
| `3` | Tailplane stall: ice contaminated |
| `4` | Runaway pitch trim |
| `5` | Emergency descent |
| `6` | Icing: anti-ice systems |

Each step is checked against the airplane's live state and ticks green when it is done, with a count of completed
steps at the bottom. When the airplane is in a situation one of the cards covers (a stalled tail, a trim runaway, a
nose-low overspeed, a descent with the autopilot off, or heavy ice with the heat off), an amber **RECOMMENDED** bar
names that card. Press the backtick key or click **‹ list** to go back to the list.

The map page is described on [Cockpit and instruments](instruments.md#efb-moving-map).

## Direct to

In a free-flight sortie with a flight plan, press `@` to open the DIRECT TO box.

1. The box lists up to twelve fixes of the plan ahead of you, each with its magnetic bearing and distance.
2. Click one, or type any fix, navaid or airport ident and press Enter (or click **Direct**).
3. Esc (or the **Esc** button) closes the box without changes.

A fix in the plan is flown direct and the legs before it are skipped. Any other fix is flown direct and the plan
resumes from it. If the ident is not in the plan or the nav database, the box says so. The lateral mode stays as it
was: if you are in HDG, press `(` to arm LNAV. See [FMS and navigation](fms.md) for how the plan is rebuilt.
