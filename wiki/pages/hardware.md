# Hardware and force feedback

The sim works with flight hardware as well as the keyboard: yokes, joysticks, rudder pedals, throttle quadrants and
gamepads, several at once, plus USB force-feedback joysticks. This page covers how devices are recognised, how to bind
them, how the column forces work with and without force feedback, and what to do when something does not respond.

| File | Role |
|---|---|
| `js/hardware.js` | Reads every connected device through the Gamepad API, binding capture and calibration, defaults |
| `js/hwui.js` | The controls and hardware panel (`/`) |
| `js/ffb.js` | USB PID force-feedback driver over WebHID |
| `js/controls.js` | Column and wheel forces, pilot strength, autopilot clutches, and the "feel" sent to a force-feedback stick |
| `js/input.js` | Mixes keyboard, mouse and hardware into the control axes |

## Browser support

| Feature | Browser API | Works in |
|---|---|---|
| Yokes, sticks, pedals, throttles, gamepads | Gamepad API | Chrome and Firefox |
| Controller rumble on the shaker and buffet | Gamepad vibration actuator | Chrome |
| Force-feedback joystick | WebHID | Chrome and Edge only, in a secure context (https, or localhost) |

Without WebHID the force-feedback section of the panel says **needs Chrome or Edge (WebHID)** and its Connect button
is disabled.

## Connecting devices

Plug the device in and **press one of its buttons**. Browsers only expose a gamepad-type device after it has sent an
input, so it does not appear before that. When it appears, the comm log says what it will do, for example that a
stick flies roll and pitch on X and Y, or that pedals need their rudder axis bound.

Press `/` (or **Controls & hardware** on the briefing screen) to open the panel. The sim pauses while the panel is
open. Each connected device is listed with its name, its kind, whether it has the standard layout, the live value of
every axis, and the buttons currently held.

## What works without binding

Each device is sorted into one of four kinds from its browser id. Unbound functions fall back to these defaults:

| Kind | Recognised by | Default behaviour |
|---|---|---|
| Gamepad, standard layout | The browser reports the standard mapping | Full layout: sticks, triggers and buttons (see [Controls](controls.md#gamepad)) |
| Gamepad, no standard layout | A gamepad name (DualShock, DualSense, Wireless Controller, Xbox, 8BitDo, Switch Pro and similar) without the standard mapping | Left stick flies; axes that rest near −1 are taken as analog triggers for thrust; a centred third axis is rudder |
| Pedals | Names containing pedal, rudder, TFRP, T-Rudder, TRP or MFG Crosswind | Nothing until bound |
| Throttle | Names containing throttle, quadrant, TQ, Bravo, TCA, TQ6, X52, X56 Throttle or Warthog Throttle | Nothing until bound |
| Stick (anything else, including yokes) | Everything else | X axis rolls, Y axis pitches (Y toward you is pull) |

Pedals and throttle quadrants have no default on purpose: their axes (toe brakes, levers) have no safe default, and a
resting toe brake must not roll or pitch the airplane. A default only applies while its function is unbound on every
device and the input is not bound to something else. The panel shows defaults in the **Bound to** column as
`default · device name X` and so on.

> **Note:** The kind is a guess from the device name. If a device is put in the wrong kind, bind its axes and buttons
> by hand: a binding always wins over a default.

## Binding controls

In the panel's table, click **Bind** next to a function, then operate the control.

### Axes

| Function | What to do when binding |
|---|---|
| Pitch (yoke / stick) | Pull the yoke or stick fully back, then push it fully forward |
| Roll | Roll fully right, then fully left |
| Rudder (pedals / twist) | Push the right pedal fully, then the left |
| Throttle lever | Move the throttle from idle to full, then back to idle |
| Left toe brake | Press the left toe brake fully, then release it |
| Right toe brake | Press the right toe brake fully, then release it |

The axis that moves most (by more than half its range) is captured. **The direction you move it first becomes the
positive direction** (pull, right roll, right pedal, throttle up, brake on), so a device that reports its axis
backwards is corrected by binding it. The extremes you reach become the calibration, and unequal travel either side of
centre is fine.

- A **centred** axis (pitch, roll, rudder) finishes by itself once it has been to both sides and back to centre, or
  after 4 seconds with no new extreme. If you only moved one side, the other side is mirrored.
- A **lever** (throttle, toe brakes) finishes once it has travelled far enough and come back near where it started,
  or after 5 seconds with no new extreme.
- Click **Done** to finish early, or **Cancel** (or Esc) to give up. If the capture saw too little movement, the
  panel says the function is not bound; move the control further and press Bind again.

Bound centred axes have a 3 % dead zone around the centre.

### Buttons

| Function | Behaviour |
|---|---|
| Autopilot disconnect | Press: engage or disconnect |
| Trim nose-up, Trim nose-down | Hold to trim |
| Gear, Flaps, Spoilers | Press, like `G`, `F`, `B` |
| Throttle idle | Press: levers to idle |
| Camera | Press: next camera |
| Brakes (both, hold) | Hold: both wheel brakes |
| Parking brake | Press: set (only when stopped) or release |
| Thrust reversers (hold) | Hold on the ground: reversers out, levers at idle; release to stow |
| Go-around (TOGA) | Press: go-around, or takeoff mode on the runway (free flight) |

A button binds to whatever you press next: a real button, one direction of a hat switch, or an axis that snaps to
±1. The code handles both hat formats: Chrome and Edge report a hat as one axis with eight stepped values, and Firefox
reports it as two axes that snap to ±1. A hat binds to a cardinal direction, and the neighbouring diagonals also count,
so up-right on a trim hat still trims nose-up.

### Rules

- **One input, one job.** Binding a control to a function frees that same physical input from any other function.
- **Invert** flips a bound axis. **Clear** removes one binding. **Clear all bindings** removes them all.
- **Saved per device name.** Bindings are stored in the browser's local storage under the device's id, so a device
  keeps its setup in any USB port and on your next visit. They are per browser: another browser or another computer
  starts unbound.
- **Inputs add up.** Hardware axes, the mouse and the keyboard are summed. Hardware and mouse inputs go straight
  through; only the keyboard is ramped.

## Throttle levers

A bound throttle lever sets the thrust levers directly, 0 at idle and 1 at full. It takes over only once you move it:
when the sim first sees the lever, it remembers the position without touching the engines, so the airplane does not
jump to whatever the lever happened to be resting at. After that, every movement sets the thrust levers, and the keys
and gamepad triggers still nudge them in between.

The sim has one pair of thrust levers moved together. On the ground, `-` past idle (or L2, or a bound reverser button)
deploys the thrust reversers.

## Brakes

The wheel brakes take the strongest of: `Shift` (both), the left and right toe brakes, a bound brakes button (both),
and D-pad left on a standard gamepad (both). Toe brakes are proportional and act on each side separately. Any brake
pressed past half releases the parking brake. A runway start begins with the parking brake set.

## Column forces without force feedback

The Learjet 60's elevator and ailerons are driven by cables and push-rods with no hydraulic boost, so `js/controls.js`
treats your input as the **force** you put on the column, not as the surface position. The surface moves until that
force balances its hinge moment, which grows with dynamic pressure and again in the transonic range. At high speed the
same pull buys less elevator.

| Quantity | Value in the model |
|---|---|
| Pitch force a pilot can hold / burst | 60 lb / 150 lb |
| Roll force hold / burst | 40 lb / 90 lb |
| Rudder force hold / burst | 150 lb / 250 lb |
| Autopilot clutch slip force | 25 lb pitch, 15 lb roll |
| Force for full elevator at 250 KEAS, subsonic | about 165 lb |

Input maps to force progressively (input to the power 1.5), so small deflections give fine control and full deflection
gives your full strength. Your strength fades: holding more than you can sustain drains it within about 10 seconds,
and it recovers when you relax. The **COLUMN FORCE** box on the screen shows all of this; see
[Cockpit and instruments](instruments.md#column-force).

The calibration follows the AFM's warning that a nose-down trim runaway or overspeed can need more than 75 lb to
recover: holding full nose-down trim at Vmo takes about 100 lb in the model. Nose-up trim is how you take that load
off. With ice on the tail the column pulses, and with a stalled iced tail it goes light.

The autopilot moves the same surfaces through clutched servos. You can overpower them, but while the autopilot stays
engaged it keeps trimming against you, and the box shows **AP CLUTCH SLIPPING — X**. Disconnect with `X`.

## Force feedback

A USB PID force-feedback joystick (the HID protocol behind DirectInput force feedback) can drive the column in Chrome
or Edge over WebHID.

> **Warning:** The driver has been tested only against simulated sticks (see `test/ffb_test.mjs`). Behaviour on real
> hardware is unverified. Start with low strength, and keep your hands clear the first time you press Test.

### Connecting a stick

1. Open the controls panel (`/`).
2. Click **Connect force-feedback stick…** and pick the stick in the browser's device prompt.
3. The status line should read *stick name*: force feedback on. The stick's entry in the device list gains the note
   "force feedback: position in, column force out".
4. Click **Test**. The stick should pull back toward you, then move right, then shake. If a direction is wrong, tick
   **invert pitch**, **invert roll** or **swap axes** and test again.
5. Set **Strength** (0 to 100 %, default 50 %).

A stick you have allowed once reconnects by itself the next time the page loads, and the comm log says so. Click
**Disconnect** to stop that. The strength and the invert and swap settings are saved in the browser.

### What you feel

With a force-feedback stick the roles swap, as in the airplane: the stick's **position** becomes the column's
position, and the motor supplies the hinge moment.

- The centring spring gets **stiffer with airspeed** and with transonic Mach.
- With a **stalled iced tail** the stick goes light (less than half the stiffness) and pulses slowly.
- With the **autopilot engaged**, the spring's centre follows the servo command, so the stick moves on its own. Push
  past the clutch force and it slips.
- The **stick shaker**, **buffet** and a **breakup** shake the stick, each with its own strength and rate.
- Paused, in menus and in replays, the stick holds a light centring spring.

Your simulated strength still applies: the elevator never goes further than the pilot model could hold against the
hinge moment, however far you push the stick. Other devices and the keyboard still add force on top.

### How the driver works

No stick model is hard-coded. `js/ffb.js` reads each stick's HID report descriptor through WebHID, finds the PID
reports by the usages they carry, and takes every field's position, size and range from the descriptor. A stick is
usable when it has the effect, condition, effect operation and device control reports and supports a spring effect.
A damper and a periodic (sine, or square) effect are used when the stick has them; a compact stick without them still
gets the spring.

The stick runs its own spring loop. The browser only moves the spring's centre and changes its stiffness and
saturation, at most every 30 ms and only when something has changed.

The browser's prompt offers HID devices that identify as a joystick, gamepad or multi-axis controller, or that carry
the PID usage page. The driver links the WebHID device to its Gamepad API entry by vendor and product id (or by name),
which is how the sim knows to read that stick as position.

### Safety

- Device gain starts at 50 %.
- Stiffness builds at a limited rate and the spring centre glides; softening is immediate.
- Forces stop when the tab is hidden, when the page closes and when the stick is unplugged.
- If any report fails, force feedback switches off and all effects stop, rather than leaving a force stuck on. The
  status line shows **force feedback stopped** with the error.

## Controller rumble

In Chrome, a connected controller with rumble motors vibrates with the stick shaker, lighter with buffet, and at full
strength in a breakup. This needs no setup.

## Test coverage

The input code is tested headless with simulated devices, not real ones:

- `test/hardware_test.mjs` builds a yoke, rudder pedals, a throttle quadrant and a DualSense gamepad from their
  browser ids and checks hat decoding (both formats), calibration of reversed and asymmetric axes, binding by moving
  and pressing, throttle pickup, defaults, persistence across USB slots and rebinding.
- `test/ffb_test.mjs` writes two PID report descriptors from the HID usage tables (a full 16-bit stick and a compact
  8-bit one) and a fake stick that decodes what the driver sends. It checks the layout parser, initialisation,
  spring, damper and shaker effects, invert and swap, strength, slew limits, the idle spring, the Test sequence,
  disconnect, device matching and the force-feedback side of `js/controls.js`.

Run them with `node test/hardware_test.mjs` and `node test/ffb_test.mjs`. See [Testing](testing.md).

## Troubleshooting

| Problem | What to try |
|---|---|
| A device is not in the panel | Press one of its buttons. Browsers hide devices until they send an input. |
| Pedals or a throttle quadrant do nothing | They have no defaults. Bind the rudder axis, toe brakes or throttle lever. |
| An axis works backwards | Click **Invert**, or bind it again moving it the right way first. |
| Binding says "not bound" | Move the control further, through its full travel, and press **Bind** again. |
| The throttle lever does not take over | Move it. The sim ignores a lever until it changes position. |
| A controller has only sticks and triggers | It has no standard layout in this browser. Bind its buttons in the panel. |
| The airplane pitches or rolls on its own | An unbound stick's X and Y fly by default; check the panel's **Live** column for an axis that is not centred, and bind or clear it. |
| The Connect button is disabled | WebHID is missing: use Chrome or Edge, over https or localhost. |
| "no USB PID force feedback (… missing)" | The stick you picked does not expose the PID reports the driver needs. |
| "force feedback stopped" | A report failed. Click **Connect force-feedback stick…** again. |
| The stick moves the wrong way in Test | Use **invert pitch**, **invert roll** or **swap axes**. |
| The stick is too strong | Lower **Strength**. |
| Bindings are gone | They are stored per browser. Another browser, a private window or cleared site data starts fresh. |
