// Interactive cockpit controls: one registry for everything you can click, turn or push on the panels, in the 3D
// cockpit (js/cockpit.js ray-casts the mouse onto the instrument canvases) and on the 2D panel (js/hud.js).
//
// The instrument drawing code marks each control with a hit box { x, y, w, h, id } as it draws (hud.hits); this module
// looks the id up in the registry and gives every control the same behaviour:
//   - hover: an outline on the control and a tooltip (its name, live state, what a click does right now, how to use it)
//   - button / switch: click acts; a press flash and a click sound confirm it
//   - knob: two zones, left half = down, right half = up (a thumbwheel, axis 'y': bottom = down, top = up). Hovering
//     draws the − / + zones and lights the one under the cursor; the tooltip says what a click there does
//     ("click: −100 ft → 14,900 ft").
//       click            one step in that zone's direction (right-click: one step down, wherever you are on the knob)
//       press and hold   one step, then after HOLD.delay ms it repeats, speeding up, and after HOLD.bigAfter ms of
//                        repeating it takes the big step, like a knob spun fast; release stops it (mouse and touch)
//       press and drag   spins it: right (or up, axis 'y') turns it up, one step per dragPx px (default 10)
//       wheel            one step per notch; Shift, or fast consecutive notches (WHEEL), take the big step
//       middle-click     PUSH (HDG: sync to the heading, ALT: ALT hold); Alt+click does the same on a trackpad.
//                        A plain click never pushes.
//     Every step clicks a detent and a readout bubble near the cursor shows the new value.
//   - lever: press and drag up / down (forward / back) to move it, through its detents (a soft click at each); the wheel
//     steps it detent to detent
// The registry's actions are the same ones the keyboard keys trigger, so a key and its button never disagree.
//
// spec = { label, kind: 'button' | 'switch' | 'knob' | 'lever', act(), turn(steps, big), push(), state() -> string, help?,
//         knob (all optional): axis: 'y', peek(steps, big) -> the value a turn would give (for the tooltip),
//           step: [small, big] labels ('100 ft', '1,000 ft'), dragPx (px per step), repeat: false (no hold-repeat),
//         lever: get() -> value, set(value), min, max, detents: [values], snap (move only between detents) }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const HOLD = { delay: 400, first: 150, last: 60, ramp: 1000, bigAfter: 1000, bigEvery: 250, stall: 300 };   // ms
export const WHEEL = { fast: 60, bigAfter: 6, notch: 50 };   // a tick within `fast` ms of the last is a streak; px per notch
export const DRAG = { px: 10, start: 6 };                    // px per step; px of travel before a press becomes a drag
export const MIN_PICK = 28;                                  // px: smallest on-screen target (js/hud.js hit, js/cockpit.js pick)
const HELP = {
  button: 'click',
  switch: 'click to toggle',
  knob: 'click left / right half: − / + · hold: repeat, faster · drag or scroll: spin (Shift: big step) · right-click: − · middle-click (or Alt+click): push',
  lever: 'drag up / down to move · scroll to step between detents',
};

export class Panel {
  constructor({ sound, now, timers = true } = {}) {
    this.specs = new Map(); this.sound = sound || (() => {});
    this.now = now || (() => performance.now());
    this.timers = timers;              // false: the caller drives tick() (tests)
    this.hover = null;                 // { id, key, fx, fy } under the mouse
    this.pressed = new Map();          // id -> time of the last press (for the flash)
    this.wheelSt = new Map();          // id -> { t, streak, acc }
    this.tip = document.createElement('div'); this.tip.className = 'ctltip hidden'; document.body.appendChild(this.tip);
    this.bub = document.createElement('div'); this.bub.className = 'ctlval hidden'; document.body.appendChild(this.bub);
  }
  define(specs) { for (const [id, s] of Object.entries(specs)) this.specs.set(id, { kind: 'button', ...s, id }); }
  has(id) { return this.specs.has(id); }

  // which way a click on a knob at hit.fx / fy goes: -1 (left / bottom half) or +1
  static zone(s, hit) { const f = s.axis === 'y' ? 1 - (hit.fy ?? 0.5) : (hit.fx ?? 0.5); return f < 0.5 ? -1 : 1; }
  // "click: −100 ft → 14,900 ft" for the zone under the cursor
  clickText(s, dir) {
    const st = s.step && s.step[0], arrow = s.peek ? ` → ${s.peek(dir, false)}` : '';
    return `click: ${dir < 0 ? '−' : '+'}${st || (dir < 0 ? '1 step down' : '1 step up')}${arrow}`;
  }

  // the control under a hit (from hud.hit / Cockpit.pick), or null
  setHover(hit, key, x, y) {
    const s = hit && this.specs.get(hit.id);
    this.hover = s ? { id: hit.id, key, fx: hit.fx, fy: hit.fy } : null; this.last = s ? [hit, key, x, y] : null;
    if (!s) { this.tip.classList.add('hidden'); return null; }
    const state = s.state ? s.state() : '';
    this.tip.textContent = '';
    const b = document.createElement('b'); b.textContent = s.label; this.tip.append(b);
    if (state) this.tip.append(` · ${state}`);
    if (s.kind === 'knob') {
      const c = document.createElement('i'); c.textContent = this.clickText(s, Panel.zone(s, hit)); this.tip.append(c);
      const h = document.createElement('span'); h.textContent = (s.help ? `${s.help} · ` : '') + HELP.knob; this.tip.append(h);
    } else { const h = document.createElement('span'); h.textContent = s.help || HELP[s.kind] || ''; this.tip.append(h); }
    this.tip.classList.remove('hidden');
    const r = this.tip.getBoundingClientRect();   // below-right of the cursor, flipped where it would leave the window
    this.tip.style.left = `${Math.max(4, x + 16 + r.width > innerWidth ? x - 16 - r.width : x + 16)}px`;
    this.tip.style.top = `${Math.max(4, y + 18 + r.height > innerHeight ? y - 12 - r.height : y + 18)}px`;
    return s;
  }
  clearHover() { this.hover = null; this.last = null; this.tip.classList.add('hidden'); }
  refresh() { if (this.last) this.setHover(...this.last); }   // the tooltip's state after a click or a turn

  // one turn of a knob: the detent, the flash, the readout bubble. true if the state changed (false at a stop)
  step(s, n, big, x, y) {
    const before = s.state ? s.state() : null;
    s.turn(n, big); this.pressed.set(s.id, this.now()); this.sound('detent');
    const after = s.state ? s.state() : null;
    if (after !== null) this.bubble(after, x, y);
    this.refresh();
    return before === null || before !== after;
  }
  // the readout bubble above the cursor, for ~0.9 s after the last change
  bubble(text, x, y) {
    if (x === undefined) return;
    const B = this.bub; B.textContent = text; B.classList.remove('hidden');
    B.style.left = `${Math.max(4, Math.min(innerWidth - 120, x - 40))}px`; B.style.top = `${Math.max(4, y - 44)}px`;
    clearTimeout(this.bubT); if (this.timers) this.bubT = setTimeout(() => B.classList.add('hidden'), 900);
  }

  // a press on a hit: true if it was a control, 'drag' when it grabbed a lever or a knob (then dragMove / dragEnd
  // follow, and dragEnd is the release). opt: { button: 0 left | 1 middle | 2 right, alt }
  click(hit, x = 0, y = 0, opt = {}) {
    const s = hit && this.specs.get(hit.id); if (!s) return false;
    const button = opt.button || 0;
    if (s.kind === 'knob') return this.pressKnob(s, hit, x, y, button, !!opt.alt);
    if (button !== 0) return false;   // right / middle on a button or lever: not ours (right-drag looks around)
    if (s.kind === 'lever') {
      this.drag = { s, id: hit.id, y0: y, v0: s.get(), last: s.get(), px: hit.dragPx || 240 };
      this.pressed.set(hit.id, this.now()); this.sound('detent');
      return 'drag';
    }
    if (s.act) s.act();
    this.pressed.set(hit.id, this.now()); this.sound(s.kind); this.refresh();
    return true;
  }
  pressKnob(s, hit, x, y, button, alt) {
    if (button === 1 || (button === 0 && alt)) {   // the push: middle-click or Alt+click, never a plain click
      if (!s.push) return true;
      s.push(); this.pressed.set(s.id, this.now()); this.sound('button'); this.refresh();
      if (s.state) this.bubble(s.state(), x, y);
      return true;
    }
    const dir = button === 2 ? -1 : Panel.zone(s, hit), t = this.now();
    const moved = this.step(s, dir, false, x, y);
    this.drag = { s, id: s.id, knob: true, x0: x, y0: y, dir, t0: t, next: t + HOLD.delay, applied: moved ? dir : 0,
      dragging: false, px: s.dragPx || hit.dragPx || DRAG.px, x, y, repeat: s.repeat !== false };
    if (this.timers && this.drag.repeat) { clearInterval(this.holdT); this.holdT = setInterval(() => this.tick(), 20); }
    return 'drag';
  }
  // press-and-hold repeat: call with the time (the panel's own timer does every 20 ms). Returns the steps taken.
  tick(now = this.now()) {
    const D = this.drag; if (!D || !D.knob || D.dragging || !D.repeat) return 0;
    let n = 0;
    if (now - D.next > HOLD.stall) D.next = now;   // the page stalled (a long frame): one step, not a burst of the missed ones
    while (now >= D.next && n < 50) {
      const held = D.next - D.t0 - HOLD.delay, big = held >= HOLD.bigAfter;   // ms of repeating when this step is due
      this.step(D.s, D.dir, big, D.x, D.y); n++;
      D.next += big ? HOLD.bigEvery : HOLD.first + (HOLD.last - HOLD.first) * clamp(held / HOLD.ramp, 0, 1);
    }
    return n;
  }
  // dragging a grabbed lever: up the screen is forward (more thrust, flaps up, spoilers stowed... as each lever defines);
  // a grabbed knob: right (or up, axis 'y') turns it up, one step per D.px
  dragMove(x, y) {
    const D = this.drag; if (!D) return;
    if (D.knob) {
      const d = D.s.axis === 'y' ? D.y0 - y : x - D.x0;
      // past DRAG.start px the hold becomes a spin. The press's own step stands if the drag goes the same way, and is
      // taken back if it goes the other way (a drag is a spin, not a click plus a spin)
      if (!D.dragging) { if (Math.abs(d) < DRAG.start) return; D.dragging = true; D.at = Math.sign(d) * DRAG.start; D.base = Math.sign(d) === D.applied ? D.applied : 0; }
      const want = D.base + Math.trunc((d - D.at) / D.px);
      while (D.applied !== want) { const k = want > D.applied ? 1 : -1; this.step(D.s, k, false, x, y); D.applied += k; }
      return;
    }
    const s = D.s, span = (s.max ?? 1) - (s.min ?? 0);
    let v = clamp(D.v0 + (s.invert ? y - D.y0 : D.y0 - y) / D.px * span, s.min ?? 0, s.max ?? 1);   // invert: pull down for more (flaps, spoilers)
    if (s.snap && s.detents) v = s.detents.reduce((b, d) => (Math.abs(d - v) < Math.abs(b - v) ? d : b), s.detents[0]);
    else if (s.detents) for (const d of s.detents) if (Math.abs(v - d) < span * 0.025) v = d;   // the detent holds the lever
    if (v === D.last) return;
    if (s.detents && s.detents.some((d) => (D.last - d) * (v - d) < 0 || v === d)) this.sound('detent');   // through or into a detent
    D.last = v; s.set(v); this.refresh();
  }
  // the release (mouse up, touch end): stops a hold-repeat, lets go of a lever or knob
  dragEnd() { clearInterval(this.holdT); this.holdT = null; if (this.drag) { this.drag = null; this.refresh(); } }

  // the wheel over a hit: true if it turned a knob or stepped a lever. Small deltas (trackpads) add up to a notch;
  // WHEEL.bigAfter notches in a row, each within WHEEL.fast ms of the last, and the knob takes the big step
  wheel(hit, dy, big, x, y) {
    const s = hit && this.specs.get(hit.id); if (!s) return false;
    if (s.kind === 'lever' && s.detents) {
      const v = s.get(), up = (dy < 0) !== !!s.invert, d = up ? s.detents.find((q) => q > v + 1e-6) : [...s.detents].reverse().find((q) => q < v - 1e-6);
      if (d !== undefined) { s.set(d); this.pressed.set(hit.id, this.now()); this.sound('detent'); this.refresh(); }
      return true;
    }
    if (s.kind !== 'knob') return false;
    const t = this.now(), w = this.wheelSt.get(s.id) || { t: -1e9, streak: 0, acc: 0 };
    if (Math.sign(w.acc) !== Math.sign(dy)) w.acc = 0;
    w.acc += dy; this.wheelSt.set(s.id, w);
    if (Math.abs(w.acc) < WHEEL.notch && Math.abs(dy) < WHEEL.notch) return true;   // part of a notch
    w.acc = 0; w.streak = t - w.t < WHEEL.fast ? w.streak + 1 : 0; w.t = t;
    this.step(s, dy < 0 ? 1 : -1, big || w.streak >= WHEEL.bigAfter, x, y);
    return true;
  }

  // draw the hover outline and the press flash over the controls of one instrument canvas (key: its name in the
  // cockpit, or 'hud' for the 2D panel), after the instrument has drawn and registered its hits. On a hovered knob,
  // the − / + halves, the one under the cursor lit
  decorate(hud, ctx, key) {
    const now = this.now();
    for (const h of hud.hits) {
      const s = this.specs.get(h.id); if (!s) continue;
      const t = this.pressed.get(h.id), flash = t ? Math.max(0, 1 - (now - t) / 180) : 0;
      const hov = this.hover && this.hover.id === h.id && this.hover.key === key;
      if (!flash && !hov) continue;
      ctx.save();
      if (flash) { ctx.fillStyle = `rgba(0,0,0,${0.35 * flash})`; ctx.fillRect(h.x, h.y, h.w, h.h); }   // the cap pressed in
      if (hov && s.kind === 'knob') this.zones(ctx, s, h);
      if (hov) {
        ctx.strokeStyle = 'rgba(120,220,255,0.95)'; ctx.lineWidth = Math.max(2, Math.min(h.w, h.h) * 0.05);
        ctx.shadowColor = '#5cf'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.roundRect(h.x + 1, h.y + 1, h.w - 2, h.h - 2, 4); ctx.stroke();
      }
      ctx.restore();
    }
  }
  zones(ctx, s, h) {
    const y = s.axis === 'y', dir = Panel.zone(s, this.hover), r = Math.min(h.w, h.h) / 2;
    ctx.save(); ctx.beginPath(); ctx.roundRect(h.x, h.y, h.w, h.h, r); ctx.clip();
    // the lit half
    ctx.fillStyle = 'rgba(92,204,255,0.30)';
    if (y) ctx.fillRect(h.x, dir > 0 ? h.y : h.y + h.h / 2, h.w, h.h / 2); else ctx.fillRect(dir > 0 ? h.x + h.w / 2 : h.x, h.y, h.w / 2, h.h);
    ctx.strokeStyle = 'rgba(160,230,255,0.8)'; ctx.lineWidth = Math.max(1.5, r * 0.04); ctx.setLineDash([r * 0.12, r * 0.1]); ctx.beginPath();
    if (y) { ctx.moveTo(h.x, h.y + h.h / 2); ctx.lineTo(h.x + h.w, h.y + h.h / 2); } else { ctx.moveTo(h.x + h.w / 2, h.y); ctx.lineTo(h.x + h.w / 2, h.y + h.h); }
    ctx.stroke(); ctx.setLineDash([]);
    // − and + on the halves
    const fs = Math.max(12, r * 0.7); ctx.font = `bold ${fs}px "SF Mono", Menlo, Consolas, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = fs * 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    const mark = (txt, cx, cy, lit) => { ctx.fillStyle = lit ? '#ffffff' : 'rgba(200,225,240,0.55)'; ctx.strokeText(txt, cx, cy); ctx.fillText(txt, cx, cy); };
    if (y) { mark('+', h.x + h.w / 2, h.y + h.h * 0.25, dir > 0); mark('−', h.x + h.w / 2, h.y + h.h * 0.75, dir < 0); }
    else { mark('−', h.x + h.w * 0.25, h.y + h.h / 2, dir < 0); mark('+', h.x + h.w * 0.75, h.y + h.h / 2, dir > 0); }
    ctx.restore();
  }
  // still drawing a flash? (the cockpit then redraws that canvas every frame)
  busy() { const now = this.now(); for (const t of this.pressed.values()) if (now - t < 200) return true; return !!(this.drag && this.drag.knob); }
}
