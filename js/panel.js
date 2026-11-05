// Interactive cockpit controls: one registry for everything you can click, turn or push on the panels, in the 3D
// cockpit (js/cockpit.js ray-casts the mouse onto the instrument canvases) and on the 2D panel (js/hud.js).
//
// The instrument drawing code marks each control with a hit box { x, y, w, h, id } as it draws (hud.hits); this module
// looks the id up in the registry and gives every control the same behaviour:
//   - hover: an outline on the control and a tooltip (its name, live state and how to use it)
//   - button / switch: click acts; a press flash and a click sound confirm it
//   - knob: the wheel turns it (Shift: a bigger step), a click on its left or right third steps it down or up, a click
//     in the middle pushes it (HDG: sync to the current heading, ALT: hold the current altitude)
//   - lever: press and drag up / down (forward / back) to move it, through its detents (a soft click at each); the wheel
//     steps it detent to detent
// The registry's actions are the same ones the keyboard keys trigger, so a key and its button never disagree.
//
// spec = { label, kind: 'button' | 'switch' | 'knob' | 'lever', act(), turn(steps, big), push(), state() -> string, help?,
//         lever: get() -> value, set(value), min, max, detents: [values], snap (move only between detents) }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const HELP = {
  button: 'click',
  switch: 'click to toggle',
  knob: 'scroll to turn (Shift: faster) · click left / right to step · click the centre to push',
  lever: 'drag up / down to move · scroll to step between detents',
};

export class Panel {
  constructor({ sound } = {}) {
    this.specs = new Map(); this.sound = sound || (() => {});
    this.hover = null;                 // { id, key, fx, fy } under the mouse
    this.pressed = new Map();          // id -> time of the last press (for the flash)
    this.tip = document.createElement('div'); this.tip.className = 'ctltip hidden'; document.body.appendChild(this.tip);
  }
  define(specs) { for (const [id, s] of Object.entries(specs)) this.specs.set(id, { kind: 'button', ...s, id }); }
  has(id) { return this.specs.has(id); }

  // the control under a hit (from hud.hit / Cockpit.pick), or null
  setHover(hit, key, x, y) {
    const s = hit && this.specs.get(hit.id);
    this.hover = s ? { id: hit.id, key, fx: hit.fx, fy: hit.fy } : null; this.last = s ? [hit, key, x, y] : null;
    if (!s) { this.tip.classList.add('hidden'); return null; }
    const state = s.state ? s.state() : '';
    this.tip.textContent = '';
    const b = document.createElement('b'); b.textContent = s.label; this.tip.append(b);
    if (state) this.tip.append(` · ${state}`);
    const h = document.createElement('span'); h.textContent = s.help || HELP[s.kind] || ''; this.tip.append(h);
    this.tip.classList.remove('hidden');
    const r = this.tip.getBoundingClientRect();   // below-right of the cursor, flipped where it would leave the window
    this.tip.style.left = `${Math.max(4, x + 16 + r.width > innerWidth ? x - 16 - r.width : x + 16)}px`;
    this.tip.style.top = `${Math.max(4, y + 18 + r.height > innerHeight ? y - 12 - r.height : y + 18)}px`;
    return s;
  }
  clearHover() { this.hover = null; this.last = null; this.tip.classList.add('hidden'); }
  refresh() { if (this.last) this.setHover(...this.last); }   // the tooltip's state after a click or a turn

  // a click on a hit: true if it was a control, 'drag' when it grabbed a lever (then dragMove / dragEnd follow)
  click(hit, x = 0, y = 0) {
    const s = hit && this.specs.get(hit.id); if (!s) return false;
    if (s.kind === 'lever') {
      this.drag = { s, id: hit.id, y0: y, v0: s.get(), last: s.get(), px: hit.dragPx || 240 };
      this.pressed.set(hit.id, performance.now()); this.sound('detent');
      return 'drag';
    }
    if (s.kind === 'knob') {
      const f = s.axis === 'y' ? 1 - (hit.fy ?? 0.5) : (hit.fx ?? 0.5);   // a thumbwheel steps by its top / bottom
      if (f < 0.33) s.turn(-1, false); else if (f > 0.67) s.turn(1, false); else if (s.push) s.push(); else return true;
    } else if (s.act) s.act();
    this.pressed.set(hit.id, performance.now()); this.sound(s.kind); this.refresh();
    return true;
  }
  // dragging a grabbed lever: up the screen is forward (more thrust, flaps up, spoilers stowed... as each lever defines)
  dragMove(x, y) {
    const D = this.drag; if (!D) return;
    const s = D.s, span = (s.max ?? 1) - (s.min ?? 0);
    let v = clamp(D.v0 + (s.invert ? y - D.y0 : D.y0 - y) / D.px * span, s.min ?? 0, s.max ?? 1);   // invert: pull down for more (flaps, spoilers)
    if (s.snap && s.detents) v = s.detents.reduce((b, d) => (Math.abs(d - v) < Math.abs(b - v) ? d : b), s.detents[0]);
    else if (s.detents) for (const d of s.detents) if (Math.abs(v - d) < span * 0.025) v = d;   // the detent holds the lever
    if (v === D.last) return;
    if (s.detents && s.detents.some((d) => (D.last - d) * (v - d) < 0 || v === d)) this.sound('detent');   // through or into a detent
    D.last = v; s.set(v); this.refresh();
  }
  dragEnd() { if (this.drag) { this.drag = null; this.refresh(); } }

  // the wheel over a hit: true if it turned a knob or stepped a lever
  wheel(hit, dy, big) {
    const s = hit && this.specs.get(hit.id); if (!s) return false;
    if (s.kind === 'lever' && s.detents) {
      const v = s.get(), up = (dy < 0) !== !!s.invert, d = up ? s.detents.find((x) => x > v + 1e-6) : [...s.detents].reverse().find((x) => x < v - 1e-6);
      if (d !== undefined) { s.set(d); this.pressed.set(hit.id, performance.now()); this.sound('detent'); this.refresh(); }
      return true;
    }
    if (s.kind !== 'knob') return false;
    s.turn(dy < 0 ? 1 : -1, big); this.pressed.set(hit.id, performance.now()); this.sound('detent'); this.refresh();
    return true;
  }

  // draw the hover outline and the press flash over the controls of one instrument canvas (key: its name in the
  // cockpit, or 'hud' for the 2D panel), after the instrument has drawn and registered its hits
  decorate(hud, ctx, key) {
    const now = performance.now();
    for (const h of hud.hits) {
      if (!this.specs.has(h.id)) continue;
      const t = this.pressed.get(h.id), flash = t ? Math.max(0, 1 - (now - t) / 180) : 0;
      const hov = this.hover && this.hover.id === h.id && this.hover.key === key;
      if (!flash && !hov) continue;
      ctx.save();
      if (flash) { ctx.fillStyle = `rgba(0,0,0,${0.35 * flash})`; ctx.fillRect(h.x, h.y, h.w, h.h); }   // the cap pressed in
      if (hov) {
        ctx.strokeStyle = 'rgba(120,220,255,0.95)'; ctx.lineWidth = Math.max(2, Math.min(h.w, h.h) * 0.05);
        ctx.shadowColor = '#5cf'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.roundRect(h.x + 1, h.y + 1, h.w - 2, h.h - 2, 4); ctx.stroke();
      }
      ctx.restore();
    }
  }
  // still drawing a flash? (the cockpit then redraws that canvas every frame)
  busy() { const now = performance.now(); for (const t of this.pressed.values()) if (now - t < 200) return true; return false; }
}
