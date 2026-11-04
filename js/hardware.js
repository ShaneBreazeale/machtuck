// Flight hardware through the Gamepad API: yokes, sticks, rudder pedals, throttle quadrants, gamepads, all at once.
//
// Flight gear has no standard layout (gp.mapping === ''), and axis numbers differ by device, OS and browser, so each
// function is bound by moving the control: the axis that moves most is captured, the direction it moved defines
// "positive" (pull, right roll, right pedal, throttle up), and its extremes are recorded as the calibration. Buttons are
// bound by pressing them: a real button, a hat direction (Chrome reports a hat as one axis with stepped values), or an
// axis that snaps to +/-1 (Firefox reports hats as two such axes). Bindings are stored per device name (gp.id), so a
// device keeps its setup in any USB port and across visits.
//
// Pure logic: no DOM. `getPads` returns the connected pads (navigator.getGamepads), `store` is localStorage-like.

export const AXIS_FNS = {
  pitch:    { label: 'Pitch (yoke / stick)', prompt: 'Pull the yoke or stick fully back, then push it fully forward', centred: true },
  roll:     { label: 'Roll', prompt: 'Roll fully right, then fully left', centred: true },
  rudder:   { label: 'Rudder (pedals / twist)', prompt: 'Push the right pedal fully, then the left', centred: true },
  throttle: { label: 'Throttle lever', prompt: 'Move the throttle from idle to FULL, then back to idle', centred: false },
  brake_l:  { label: 'Left toe brake', prompt: 'Press the left toe brake fully, then release it', centred: false },
  brake_r:  { label: 'Right toe brake', prompt: 'Press the right toe brake fully, then release it', centred: false },
};
export const BUTTON_FNS = {
  ap_toggle: { label: 'Autopilot disconnect', hold: false },
  trim_up:   { label: 'Trim nose-up', hold: true },
  trim_dn:   { label: 'Trim nose-down', hold: true },
  gear:      { label: 'Gear', hold: false },
  flaps:     { label: 'Flaps', hold: false },
  sb:        { label: 'Spoilers', hold: false },
  idle:      { label: 'Throttle idle', hold: false },
  cam:       { label: 'Camera', hold: false },
  brakes:    { label: 'Brakes (both, hold)', hold: true },
  park:      { label: 'Parking brake', hold: false },
  reverse:   { label: 'Thrust reversers (hold)', hold: true },
};
const KEY = 'n722bd_hw_v1';
const DEAD = 0.03;                       // hardware dead zone around centre (fraction of half-travel)

// ---- hat switch (Chrome / Edge on Windows and macOS: one axis, 8 directions at -1 + k * 2/7, neutral ~ +1.29) ----
// returns -1 for neutral, else 0 up, 1 up-right, 2 right, 3 down-right, 4 down, 5 down-left, 6 left, 7 up-left
export function hatDir(v) {
  if (!(Math.abs(v) <= 1.05)) return -1;
  return ((Math.round((v + 1) * 3.5) % 8) + 8) % 8;
}
// a cardinal direction also counts when the hat is on either neighbouring diagonal
export const hatHas = (dir, want) => dir >= 0 && (dir === want || dir === (want + 1) % 8 || dir === (want + 7) % 8);
export const isHatRest = (v) => Math.abs(v) > 1.05;

// ---- axis normalisation ----
// centred axis: raw extremes `pos` (positive direction) and `neg` either side of `center` -> -1..1 (asymmetric travel ok)
export function normCentred(v, b) {
  const d = v - b.center, sp = b.pos - b.center, sn = b.center - b.neg;
  let x = Math.sign(d) === Math.sign(sp) ? d / sp : (sn !== 0 ? -Math.abs(d / sn) : 0);
  x = Math.max(-1, Math.min(1, x));
  return Math.abs(x) < DEAD ? 0 : Math.sign(x) * (Math.abs(x) - DEAD) / (1 - DEAD);
}
// lever: raw `lo` (idle) .. `hi` (full) -> 0..1, either direction
export function normLever(v, b) {
  const x = (v - b.lo) / (b.hi - b.lo || 1);
  return Math.max(0, Math.min(1, (x - 0.01) / 0.98));
}

const padsOf = (getPads) => [...(getPads() || [])].filter((g) => g && g.connected !== false);
const isGamepadId = (id) => /dualshock|dualsense|wireless controller|xbox|054c|045e|gamepad|8bitdo|switch pro/i.test(id);
const isPedalsId = (id) => /pedal|rudder|tfrp|t-rudder|\btrp\b|mfg crosswind/i.test(id);
const isThrottleId = (id) => /throttle|quadrant|\btq\b|bravo|tca|tq6|x52|x56 throttle|warthog throttle/i.test(id);
export const deviceKind = (gp) => gp.mapping === 'standard' || isGamepadId(gp.id) ? 'gamepad' : isPedalsId(gp.id) ? 'pedals' : isThrottleId(gp.id) ? 'throttle' : 'stick';

// the same physical input (so binding it to one function frees it from another)
const axisKind = (b) => b.kind === 'axis' || b.kind === 'lever' || b.kind === 'axisbtn';
export function sameInput(a, b) {
  if (a.id !== b.id) return false;
  if (a.kind === 'button' || b.kind === 'button') return a.kind === b.kind && a.button === b.button;
  if (a.kind === 'hat' || b.kind === 'hat') return a.kind === b.kind && a.axis === b.axis && a.dir === b.dir;
  if (a.kind === 'axisbtn' && b.kind === 'axisbtn') return a.axis === b.axis && a.sign === b.sign;
  return axisKind(a) && axisKind(b) && a.axis === b.axis;
}

// ---- capture: watch every axis/button of every pad until one function is bound ----
export class Capture {
  constructor(fn, pads) {
    this.fn = fn; this.axis = fn in AXIS_FNS; this.centred = this.axis && AXIS_FNS[fn].centred;
    this.base = new Map();                   // `${id}#${index}` -> { axes, buttons }
    for (const gp of pads) this.base.set(gp.id + '#' + gp.index, { axes: [...gp.axes], buttons: gp.buttons.map((b) => b.pressed) });
    this.sel = null; this.t = 0; this.lastNew = 0; this.result = null;
  }
  // feed the current pads; returns the binding when done, else null
  feed(pads, dt = 1 / 60) {
    if (this.result) return this.result;
    this.t += dt;
    if (!this.axis) return (this.result = this.findButton(pads));
    if (!this.sel) {
      let best = null;
      for (const gp of pads) {
        const b = this.base.get(gp.id + '#' + gp.index); if (!b) { this.base.set(gp.id + '#' + gp.index, { axes: [...gp.axes], buttons: gp.buttons.map((x) => x.pressed) }); continue; }
        gp.axes.forEach((v, i) => {
          if (isHatRest(b.axes[i]) || isHatRest(v)) return;        // hats are buttons, not axes
          const d = v - b.axes[i];
          if (Math.abs(d) > 0.5 && (!best || Math.abs(d) > Math.abs(best.d))) best = { gp, i, d };
        });
      }
      if (!best) return null;
      const r = best.gp.axes[best.i], c = this.base.get(best.gp.id + '#' + best.gp.index).axes[best.i];
      this.sel = { id: best.gp.id, index: best.gp.index, axis: best.i, sign: Math.sign(best.d), rest: c, hi: r, lo: c, back: false };
      this.lastNew = this.t;
      return null;
    }
    const s = this.sel, gp = pads.find((g) => g.id === s.id && g.index === s.index) || pads.find((g) => g.id === s.id);
    if (!gp) return null;
    const v = gp.axes[s.axis];
    // track extremes in the positive (s.sign) and negative directions
    if ((v - s.hi) * s.sign > 0.005) { s.hi = v; this.lastNew = this.t; }
    if ((s.lo - v) * s.sign > 0.005) { s.lo = v; this.lastNew = this.t; }
    const span = Math.abs(s.hi - s.lo);
    if (this.centred) {
      const pos = Math.abs(s.hi - s.rest), neg = Math.abs(s.rest - s.lo);
      if (neg > 0.4 * pos && Math.abs(v - s.rest) < 0.12 * pos) s.back = true;   // been to both sides and recentred
      if (s.back || this.t - this.lastNew > 4) return (this.result = this.finish());
    } else {
      if (span > 1.2 && Math.abs(v - s.lo) < 0.15 * span && this.t - this.lastNew > 0.4) return (this.result = this.finish());
      if (this.t - this.lastNew > 5) return (this.result = this.finish());
    }
    return null;
  }
  // close the capture with what has been seen (the UI's Done button, or a timeout)
  finish() {
    const s = this.sel; if (!s) return null;
    if (this.centred) {
      let pos = s.hi, neg = s.lo;
      if (Math.abs(s.rest - neg) < 0.4 * Math.abs(pos - s.rest)) neg = s.rest - (pos - s.rest);  // one side only: mirror it
      return (this.result = { kind: 'axis', id: s.id, axis: s.axis, center: s.rest, pos, neg });
    }
    if (Math.abs(s.hi - s.lo) < 0.3) return null;
    return (this.result = { kind: 'lever', id: s.id, axis: s.axis, lo: s.lo, hi: s.hi });
  }
  findButton(pads) {
    for (const gp of pads) {
      const b = this.base.get(gp.id + '#' + gp.index);
      if (!b) { this.base.set(gp.id + '#' + gp.index, { axes: [...gp.axes], buttons: gp.buttons.map((x) => x.pressed) }); continue; }
      for (let i = 0; i < gp.buttons.length; i++) if (gp.buttons[i].pressed && !b.buttons[i]) return { kind: 'button', id: gp.id, button: i };
      for (let i = 0; i < gp.axes.length; i++) {
        const v = gp.axes[i], r = b.axes[i];
        if (isHatRest(r) && !isHatRest(v)) { const dir = hatDir(v); if (dir >= 0 && dir % 2 === 0) return { kind: 'hat', id: gp.id, axis: i, dir }; continue; }
        if (Math.abs(r) < 0.2 && Math.abs(v) > 0.9) return { kind: 'axisbtn', id: gp.id, axis: i, sign: Math.sign(v) };
      }
    }
    return null;
  }
}

// ---- the poller ----
export class Hardware {
  constructor(getPads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []), store = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    this.getPads = getPads; this.store = store;
    this.bind = {}; try { this.bind = JSON.parse(store && store.getItem(KEY) || '{}') || {}; } catch { this.bind = {}; }
    this.prev = {};                      // button fn -> was pressed
    this.padPrev = new Map();            // standard pads: id#index -> buttons pressed
    this.rest = new Map();               // first-seen axis values per pad (gamepad trigger heuristic)
    this.thrLast = null;                 // last lever value handed to the sim (pickup: only a moved lever takes over)
    this.capture = null;
    this.isFfb = null;                   // (gp) => true for a force-feedback stick: its pitch / roll are column POSITION
  }
  pads() { return padsOf(this.getPads); }
  save() { if (this.store) this.store.setItem(KEY, JSON.stringify(this.bind)); }
  clear(fn) { if (fn) delete this.bind[fn]; else this.bind = {}; if (fn === 'throttle' || !fn) this.thrLast = null; this.save(); }
  invert(fn) {
    const b = this.bind[fn]; if (!b) return;
    if (b.kind === 'axis') [b.pos, b.neg] = [b.neg, b.pos]; else if (b.kind === 'lever') [b.lo, b.hi] = [b.hi, b.lo];
    this.save();
  }
  startCapture(fn) { this.capture = new Capture(fn, this.pads()); }
  cancelCapture() { this.capture = null; }
  // advance a running capture; returns the new binding when it completes
  stepCapture(dt) {
    if (!this.capture) return null;
    const r = this.capture.feed(this.pads(), dt);
    if (r) { this.set(this.capture.fn, r); this.capture = null; }
    return r;
  }
  finishCapture() { if (!this.capture) return null; const r = this.capture.finish(); if (r) this.set(this.capture.fn, r); this.capture = null; return r; }
  set(fn, b) {
    // one control does one job: free the same physical input from any other function
    for (const [k, o] of Object.entries(this.bind)) if (k !== fn && sameInput(o, b)) delete this.bind[k];
    this.bind[fn] = b; if (fn === 'throttle') this.thrLast = null; this.save();
  }
  axisUsed(gp, i) { return Object.values(this.bind).some((b) => b.id === gp.id && b.kind !== 'button' && b.axis === i); }
  buttonUsed(gp, i) { return Object.values(this.bind).some((b) => b.id === gp.id && b.kind === 'button' && b.button === i); }
  padFor(id, pads) { return pads.find((g) => g.id === id) || null; }
  // raw value of a bound function: axis -1..1, lever 0..1, button 0/1; null when its device is not connected
  value(fn, pads = this.pads()) {
    const b = this.bind[fn]; if (!b) return null;
    const gp = this.padFor(b.id, pads); if (!gp) return null;
    if (b.kind === 'axis') return normCentred(gp.axes[b.axis] ?? b.center, b);
    if (b.kind === 'lever') return normLever(gp.axes[b.axis] ?? b.lo, b);
    if (b.kind === 'button') return gp.buttons[b.button] && gp.buttons[b.button].pressed ? 1 : 0;
    if (b.kind === 'hat') return hatHas(hatDir(gp.axes[b.axis] ?? 9), b.dir) ? 1 : 0;
    if (b.kind === 'axisbtn') return (gp.axes[b.axis] ?? 0) * b.sign > 0.5 ? 1 : 0;
    return null;
  }
  describe(fn) {
    const b = this.bind[fn]; if (!b) return '—';
    const dev = b.id.replace(/\s*\(.*$/, '').slice(0, 44);
    const what = b.kind === 'axis' || b.kind === 'lever' ? `axis ${b.axis}` : b.kind === 'button' ? `button ${b.button}` : b.kind === 'hat' ? `hat ${['up', '', 'right', '', 'down', '', 'left'][b.dir]}` : `axis ${b.axis}${b.sign > 0 ? '+' : '−'}`;
    return `${dev} · ${what}`;
  }
  // what drives an unbound function by default, for the panel (null = nothing)
  defaultFor(fn, pads = this.pads()) {
    if (this.bound(fn, pads)) return null;
    const name = (gp) => gp.id.replace(/\s*\(.*$/, '').slice(0, 36);
    const ax = { roll: 0, pitch: 1 }[fn];
    for (const gp of pads) {
      const k = deviceKind(gp);
      if (ax !== undefined && (k === 'stick' || k === 'gamepad') && !this.axisUsed(gp, ax)) return `default · ${name(gp)} ${ax ? 'Y' : 'X'}`;
      if (fn === 'rudder' && k === 'gamepad' && gp.mapping === 'standard' && !this.axisUsed(gp, 2)) return `default · ${name(gp)} right stick`;
      if (fn === 'throttle' && k === 'gamepad') return `default · ${name(gp)} triggers (rate)`;
    }
    return null;
  }
  // which functions any connected device leaves to a default (no binding, or its device unplugged)
  bound(fn, pads) { const b = this.bind[fn]; return !!(b && this.padFor(b.id, pads)); }

  // ---- per-frame poll: everything every connected device is doing ----
  // returns { elev, ail, rud } (-1..1, summed over devices, positive = pull / right / right pedal), brakeL / brakeR (0..1),
  //         thrRate (-1..1, gamepad triggers), thrSet (0..1 when a bound lever has moved, else null),
  //         trim (-1..1, nose-up positive), events [] (edge-triggered actions, same names as the keyboard's),
  //         posElev / posAil: pitch and roll from a force-feedback stick (column position), null without one
  poll() {
    const pads = this.pads(), o = { elev: 0, ail: 0, rud: 0, thrRate: 0, thrSet: null, trim: 0, events: [], active: pads.length > 0, posElev: null, posAil: null, brakeL: 0, brakeR: 0, rev: false };
    const B = (fn) => this.bound(fn, pads);
    const ffb = (gp) => !!(this.isFfb && gp && this.isFfb(gp));
    const addE = (gp, v) => { if (ffb(gp)) o.posElev = (o.posElev || 0) + v; else o.elev += v; };
    const addA = (gp, v) => { if (ffb(gp)) o.posAil = (o.posAil || 0) + v; else o.ail += v; };
    // bound axes
    if (B('pitch')) addE(this.padFor(this.bind.pitch.id, pads), this.value('pitch', pads));
    if (B('roll')) addA(this.padFor(this.bind.roll.id, pads), this.value('roll', pads));
    if (B('rudder')) o.rud += this.value('rudder', pads);
    if (B('throttle')) {
      const v = this.value('throttle', pads);
      if (this.thrLast === null) this.thrLast = v;              // first sight: remember where it is, do not grab the engines
      else if (Math.abs(v - this.thrLast) > 0.004) { this.thrLast = v; o.thrSet = v; }
    }
    // toe brakes (levers, 0 released .. 1 full)
    if (B('brake_l')) o.brakeL = Math.max(o.brakeL, this.value('brake_l', pads));
    if (B('brake_r')) o.brakeR = Math.max(o.brakeR, this.value('brake_r', pads));
    // bound buttons
    for (const fn of Object.keys(BUTTON_FNS)) {
      if (!B(fn)) { this.prev[fn] = false; continue; }
      const p = this.value(fn, pads) > 0;
      if (fn === 'trim_up' && p) o.trim += 1; else if (fn === 'trim_dn' && p) o.trim -= 1;
      else if (fn === 'brakes') { if (p) { o.brakeL = 1; o.brakeR = 1; } }
      else if (fn === 'reverse') { if (p) o.rev = true; }
      else if (p && !this.prev[fn]) o.events.push(fn);
      this.prev[fn] = p;
    }
    // defaults for whatever is unbound
    const dz = (v) => Math.abs(v) < 0.08 ? 0 : v;
    for (const gp of pads) {
      // a default applies only if its function is unbound everywhere and its input is not bound to something else
      const ax = (fn, i) => !B(fn) && !this.axisUsed(gp, i) ? (ffb(gp) ? gp.axes[i] || 0 : dz(gp.axes[i] || 0)) : 0;   // a position stick: no dead-zone step
      const free = (i) => !this.buttonUsed(gp, i);
      const key = gp.id + '#' + gp.index;
      if (!this.rest.has(key)) this.rest.set(key, [...gp.axes]);
      const kind = deviceKind(gp);
      if (kind === 'gamepad' && gp.mapping === 'standard') {
        addA(gp, ax('roll', 0)); addE(gp, ax('pitch', 1)); o.rud += ax('rudder', 2);   // left stick; right stick X = rudder
        const trig = (i) => { const v = free(i) && gp.buttons[i] ? gp.buttons[i].value : 0; return v > 0.1 ? v : 0; };
        if (!B('throttle')) o.thrRate += trig(7) - trig(6);         // R2 / L2
        const b = (i) => free(i) && !!(gp.buttons[i] && gp.buttons[i].pressed), prev = this.padPrev.get(key) || [];
        const MAP = { 0: 'ap_toggle', 1: 'sb', 2: 'idle', 3: 'cam', 8: 'help', 9: 'pause', 10: 'yd', 12: 'gear', 13: 'flaps' };
        for (const [i, ev] of Object.entries(MAP)) if (b(+i) && !prev[+i]) o.events.push(ev);
        this.padPrev.set(key, gp.buttons.map((x) => x.pressed));
        if (b(5)) o.trim += 1; if (b(4)) o.trim -= 1;               // R1 nose-up, L1 nose-down
        if (b(14)) { o.brakeL = 1; o.brakeR = 1; }                    // D-pad left: brakes
      } else if (kind === 'gamepad') {
        // no standard layout (e.g. Firefox on macOS): axes resting near -1 are analog triggers, a centred third axis is the right stick
        addA(gp, ax('roll', 0)); addE(gp, ax('pitch', 1));
        const rest = this.rest.get(key), trigAx = [];
        for (let i = 2; i < gp.axes.length; i++) if ((rest[i] ?? 0) < -0.9 && !this.axisUsed(gp, i)) trigAx.push(i);
        const rx = [2, 3].find((i) => !trigAx.includes(i) && Math.abs(rest[i] ?? 1) < 0.2);
        if (rx !== undefined) o.rud += ax('rudder', rx);
        const tv = (i) => { const v = (gp.axes[i] + 1) / 2; return v > 0.1 ? v : 0; };
        if (trigAx.length >= 2 && !B('throttle')) o.thrRate += tv(trigAx[1]) - tv(trigAx[0]);
      } else if (kind === 'stick') {
        // an unbound yoke or joystick: X = roll, Y = pitch (DirectInput convention, Y grows toward the pilot = pull)
        addA(gp, ax('roll', 0)); addE(gp, ax('pitch', 1));
      }
      // unbound pedals and throttle quadrants do nothing until bound: their axes (toe brakes, levers) have no safe default
    }
    const c = (x) => Math.max(-1, Math.min(1, x));
    if (o.posElev !== null) o.posElev = c(o.posElev); if (o.posAil !== null) o.posAil = c(o.posAil);
    o.elev = c(o.elev); o.ail = c(o.ail); o.rud = c(o.rud); o.thrRate = c(o.thrRate); o.trim = c(o.trim);
    return o;
  }
  // devices that need binding before they do anything (shown as a hint)
  unboundDevices() { return this.pads().filter((gp) => { const k = deviceKind(gp); return (k === 'pedals' || k === 'throttle') && !Object.values(this.bind).some((b) => b.id === gp.id); }); }
}
