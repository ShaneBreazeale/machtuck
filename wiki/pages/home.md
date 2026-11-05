# N722BD Learjet 60 simulator wiki

This wiki documents a browser flight simulator with two modes: a reconstruction of the 1 November 2026 loss of
Learjet 60 N722BD in a thunderstorm over Palm Beach County, and free-flight IFR sorties anywhere within 160 nm of Palm
Beach. It runs on WebGL2 and plain ES modules, with no install and no build step.

**[Fly it in your browser](https://shanebreazeale.github.io/machtuck/)** · [Source on GitHub](https://github.com/ShaneBreazeale/machtuck)

![Four views from the sim: the anvil top from above, the jet entering the radar core at FL350, the virtual cockpit with weather radar, and Greenacres from 300 m](../docs/img/screenshot.jpg)

> **Important:** Nine people died on this flight. The cause is undetermined, and every upset scenario in the sim is a
> hypothesis, not a finding. The crew's final transmissions are not reproduced in the game.

## Where to start

| If you want to… | Read |
|---|---|
| Fly the accident scenario right now | [Getting started](getting-started.md), then [Controls](controls.md) |
| Understand what happened to N722BD and how the sim models it | [The N722BD flight](accident.md) and [Upset hypotheses](hypotheses.md) |
| Plan and fly an IFR flight between real airports | [Planning a sortie](sorties.md) and [IFR routes](routes.md) |
| Use the autopilot, flight director and FMS | [Autopilot and flight director](flight-guidance.md) and [FMS and navigation](fms.md) |
| Fly an ILS or RNAV approach to minimums | [Approaches and minimums](approaches.md) |
| Plug in a yoke, rudder pedals or a force-feedback stick | [Hardware and force feedback](hardware.md) |
| Know how accurate the airplane is | [Flight model](flight-model.md) and [Validation](validation.md) |
| Change the code | [Architecture](architecture.md), [Testing](testing.md) and [Contributing](contributing.md) |

## The two modes

**The accident** is the default page. You take over N722BD at FL350 shortly before it enters the storm, with the
autopilot on, in the weather built from the real radar, satellite and lightning data for those minutes. You can pick
one of four upset hypotheses, fly it "as flown" or in trainer mode, or watch the reported ADS-B track replayed. See
[The N722BD flight](accident.md).

**Free flight** is a separate sortie screen. You choose a departure and arrival among the 72 IFR airports in range,
a SID, route, STAR and approach from the FAA nav database, and a start position: on the runway, en route, at the
start of the approach or on final. An FMS and a Pro Line 4-style flight guidance system fly the plan if you let them.
See [Planning a sortie](sorties.md).

## Principles

- **Real data first.** The storm comes from NEXRAD, GOES-19 and GLM. The procedures come from the FAA CIFP, the
  minimums from the FAA approach plates, and the performance from the Learjet 60 Airplane Flight Manual.
- **Traceable numbers.** Every number in the model points to a source or is marked as an estimate. The
  [Validation](validation.md) page lists what is checked and how closely.
- **Generic logic, not scripts.** Navigation, procedures and approaches run through one data-driven engine. Nothing
  is hand-coded for a particular airport or scenario.
- **Respect.** The accident is presented as speculation where it is speculation, and the crew's last words stay out.

## Editing this wiki

Each page is a Markdown file in [`wiki/pages`](https://github.com/ShaneBreazeale/machtuck/tree/main/wiki/pages), and
the sidebar order lives in `wiki/pages.json`. Every page has an "Edit this page on GitHub" link at the bottom. See
[Contributing](contributing.md#documentation) for the conventions.
