// Keyboard / mouse / touch / gamepad -> smoothed control axes.
import { clamp } from './util.js';
export class Input {
  constructor(canvas) {
    this.keys = new Set(); this.axes = { elev: 0, ail: 0, rud: 0 };
    this.events = [];            // discrete actions: 'ap_off','sb','gear','flaps','cam','pause','restart','skip','quality','slow','antiice','yd','help','ghost'
    this.mouse = { down: false, x0: 0, y0: 0, dx: 0, dy: 0 };
    this.thrDelta = 0; this.trimDelta = 0; this.orbit = { yaw: 0, pitch: 0 }; this.rdrag = null; this.onClick = null;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return; const k = e.key.toLowerCase(); this.keys.add(k);
      const map = { x: 'ap_toggle', b: 'sb', g: 'gear', f: 'flaps', c: 'cam', p: 'pause', ' ': 'pause', r: 'restart', n: 'skip', k: 'quality', '[': 'slower', ']': 'faster', i: 'antiice', y: 'yd', h: 'help', v: 'ghost', '0': 'idle', m: 'mute', z: 'hud', tab: 'efb', '`': 'ckback', '1': 'ck0', '2': 'ck1', '3': 'ck2', '4': 'ck3', '5': 'ck4', '6': 'ck5', '7': 'trimMode', '8': 'machTrim', '9': 'nacelleHeat', t: 'atc', ';': 'atc_earlier', "'": 'atc_later', l: 'comms', u: 'nexrad', o: 'wxr', j: 'wxr_range' };
      if (map[k]) { this.events.push(map[k]); e.preventDefault(); }
      if (k === 'tab') e.preventDefault();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear()); document.addEventListener('visibilitychange', () => { if (document.hidden) this.keys.clear(); });
    const down = (x, y) => { this.mouse.down = true; this.mouse.x0 = x; this.mouse.y0 = y; this.mouse.dx = 0; this.mouse.dy = 0; };
    const move = (x, y) => { if (!this.mouse.down) return; this.mouse.dx = (x - this.mouse.x0) / 220; this.mouse.dy = (y - this.mouse.y0) / 220; };
    const up = () => { this.mouse.down = false; this.mouse.dx = 0; this.mouse.dy = 0; };
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { if (this.onClick && this.onClick(e.clientX, e.clientY)) return; down(e.clientX, e.clientY); } if (e.button === 2) this.rdrag = { x: e.clientX, y: e.clientY, yaw: this.orbit.yaw, pitch: this.orbit.pitch }; });
    window.addEventListener('mousemove', (e) => { move(e.clientX, e.clientY); if (this.rdrag) { this.orbit.yaw = this.rdrag.yaw + (e.clientX - this.rdrag.x) * 0.01; this.orbit.pitch = clamp(this.rdrag.pitch + (e.clientY - this.rdrag.y) * 0.01, -1.2, 1.2); } });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) this.rdrag = null; else up(); });
    canvas.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (this.onClick && this.onClick(t.clientX, t.clientY)) { e.preventDefault(); return; } down(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchmove', (e) => { const t = e.touches[0]; move(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchend', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  pressed(...ks) { return ks.some(k => this.keys.has(k)); }
  // Returns true if the pilot is actively deflecting the stick (used for AP auto-disconnect)
  update(dt) {
    const k = this.keys;
    let eT = 0, aT = 0, rT = 0;
    if (this.pressed('arrowdown', 's')) eT += 1; if (this.pressed('arrowup', 'w')) eT -= 1;
    if (this.pressed('arrowright', 'd')) aT += 1; if (this.pressed('arrowleft', 'a')) aT -= 1;
    if (this.pressed('e')) rT += 1; if (this.pressed('q')) rT -= 1;
    const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
    if (gp) {
      const dz = (v) => Math.abs(v) < 0.08 ? 0 : v;
      aT += dz(gp.axes[0] || 0); eT += dz(gp.axes[1] || 0); rT += dz(gp.axes[2] || 0);
      if (gp.buttons[7] && gp.buttons[7].value > 0.1) this.thrDelta = gp.buttons[7].value;
    }
    if (this.mouse.down) { aT += clamp(this.mouse.dx, -1, 1); eT += clamp(this.mouse.dy, -1, 1); }
    eT = clamp(eT, -1, 1); aT = clamp(aT, -1, 1); rT = clamp(rT, -1, 1);
    const held = Math.abs(eT) > 0.05 || Math.abs(aT) > 0.05;
    // keyboard ramps: ramp up over ~0.35 s, recentre over ~0.2 s; stick input is direct
    const ramp = (cur, tgt, up, dn) => { const r = Math.abs(tgt) > Math.abs(cur) ? up : dn; const d = tgt - cur; return Math.abs(d) <= r * dt ? tgt : cur + Math.sign(d) * r * dt; };
    this.axes.elev = ramp(this.axes.elev, eT, 2.8, 5);
    this.axes.ail = ramp(this.axes.ail, aT, 3.0, 6);
    this.axes.rud = ramp(this.axes.rud, rT, 2.0, 4);
    this.thrDelta = 0; this.trimDelta = 0;
    if (this.pressed('=', '+')) this.thrDelta = 0.5 * dt; if (this.pressed('-', '_')) this.thrDelta = -0.5 * dt;
    if (this.pressed('.')) this.trimDelta = 0.25 * dt; if (this.pressed(',')) this.trimDelta = -0.25 * dt;
    return held;
  }
  drain() { const e = this.events; this.events = []; return e; }
}
