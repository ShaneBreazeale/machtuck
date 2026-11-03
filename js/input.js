// Keyboard / mouse / touch / gamepad -> smoothed control axes.
import { clamp } from './util.js';
export class Input {
  constructor(canvas) {
    this.keys = new Set(); this.axes = { elev: 0, ail: 0, rud: 0 };
    this.events = [];            // discrete actions: 'ap_off','sb','gear','flaps','cam','pause','restart','skip','quality','slow','antiice','yd','help','ghost'
    this.mouse = { down: false, x0: 0, y0: 0, dx: 0, dy: 0 };
    this.thrDelta = 0; this.trimDelta = 0; this.orbit = { yaw: 0, pitch: 0 }; this.rdrag = null; this.onClick = null;
    // Gamepad (DualShock 4 / DualSense / Xbox). Browsers expose a pad only after a button press.
    this.pad = { index: null, prev: [], rest: null, rumbleAt: 0 }; this.onPad = null;
    this.zoom = 1;   // cockpit field-of-view scale, mouse wheel
    canvas.addEventListener('wheel', (e) => { this.zoom = clamp(this.zoom * Math.exp(e.deltaY * 0.0012), 0.42, 1.22); e.preventDefault(); }, { passive: false });
    window.addEventListener('gamepadconnected', (e) => {
      const gp = e.gamepad;
      if (this.onPad) this.onPad(gp.mapping === 'standard'
        ? `Controller connected: ${gp.id.slice(0, 48)}`
        : `Controller connected without the standard layout (${gp.id.slice(0, 32)}): sticks and triggers only - use Safari or Chrome for buttons`);
    });
    window.addEventListener('gamepaddisconnected', (e) => { if (this.pad.index === e.gamepad.index) this.pad = { index: null, prev: [], rest: null, rumbleAt: 0 }; if (this.onPad) this.onPad('Controller disconnected'); });
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
  // First connected pad, preferring the standard layout (macOS may put a PlayStation pad in any slot)
  gamepad() {
    if (!navigator.getGamepads) return null;
    const pads = [...navigator.getGamepads()].filter((g) => g && g.connected);
    const gp = pads.find((g) => g.mapping === 'standard') || pads[0] || null;
    if (gp && gp.index !== this.pad.index) this.pad = { index: gp.index, prev: [], rest: gp.axes.map((v) => v), rumbleAt: 0 };
    return gp;
  }
  // Stick shaker / buffet through the controller's rumble motors, where the browser supports it (Chrome)
  haptics({ shaker = false, buffet = false, broken = false } = {}) {
    const gp = this.pad.index !== null && navigator.getGamepads ? navigator.getGamepads()[this.pad.index] : null;
    const act = gp && gp.vibrationActuator;
    if (!act || document.hidden) return;
    const now = performance.now();
    if (now < this.pad.rumbleAt) return;
    const strong = broken ? 1 : shaker ? 0.75 : buffet ? 0.25 : 0, weak = broken ? 1 : shaker ? 0.9 : buffet ? 0.5 : 0;
    if (strong === 0 && weak === 0) return;
    this.pad.rumbleAt = now + 100;
    act.playEffect('dual-rumble', { duration: 140, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }
  // Returns true if the pilot is actively deflecting the stick (used for AP auto-disconnect)
  update(dt) {
    const k = this.keys;
    let eT = 0, aT = 0, rT = 0;
    if (this.pressed('arrowdown', 's')) eT += 1; if (this.pressed('arrowup', 'w')) eT -= 1;
    if (this.pressed('arrowright', 'd')) aT += 1; if (this.pressed('arrowleft', 'a')) aT -= 1;
    if (this.pressed('e')) rT += 1; if (this.pressed('q')) rT -= 1;
    const gp = this.gamepad();
    let thrIn = 0, trimIn = 0;   // -1..1 rate demands: keys are on/off, triggers are proportional
    if (gp) {
      const dz = (v) => Math.abs(v) < 0.08 ? 0 : v;
      aT += dz(gp.axes[0] || 0); eT += dz(gp.axes[1] || 0);
      if (gp.mapping === 'standard') {
        rT += dz(gp.axes[2] || 0);                                    // right stick X = rudder
        // RT (7) throttle up, LT (6) throttle down; small deadzone for resting fingers
        const trig = (i) => { const v = gp.buttons[i] ? gp.buttons[i].value : 0; return v > 0.1 ? v : 0; };
        thrIn += trig(7) - trig(6);
        const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
        // Buttons (standard layout; PlayStation names): edge-triggered actions
        const MAP = { 0: 'ap_toggle', 1: 'sb', 2: 'idle', 3: 'cam', 8: 'help', 9: 'pause', 10: 'yd', 12: 'gear', 13: 'flaps' };
        for (const [i, ev] of Object.entries(MAP)) if (b(+i) && !this.pad.prev[+i]) this.events.push(ev);
        this.pad.prev = gp.buttons.map((x) => x.pressed);
        if (b(5)) trimIn += 1; if (b(4)) trimIn -= 1;                  // R1 nose-up, L1 nose-down (hold)
      } else {
        // No standard layout (e.g. Firefox on macOS): axes resting near -1 are analog triggers
        // (first = left, second = right); a centred third axis is the right stick for rudder.
        const rest = this.pad.rest || [], trigAx = [];
        for (let i = 2; i < gp.axes.length; i++) if ((rest[i] ?? 0) < -0.9) trigAx.push(i);
        const rx = [2, 3].find((i) => !trigAx.includes(i) && Math.abs(rest[i] ?? 1) < 0.2);
        if (rx !== undefined) rT += dz(gp.axes[rx] || 0);
        const tv = (i) => { const v = (gp.axes[i] + 1) / 2; return v > 0.1 ? v : 0; };
        if (trigAx.length >= 2) thrIn += tv(trigAx[1]) - tv(trigAx[0]);
      }
    }
    if (this.mouse.down) { aT += clamp(this.mouse.dx, -1, 1); eT += clamp(this.mouse.dy, -1, 1); }
    eT = clamp(eT, -1, 1); aT = clamp(aT, -1, 1); rT = clamp(rT, -1, 1);
    const held = Math.abs(eT) > 0.05 || Math.abs(aT) > 0.05;
    // keyboard ramps: ramp up over ~0.35 s, recentre over ~0.2 s; stick input is direct
    const ramp = (cur, tgt, up, dn) => { const r = Math.abs(tgt) > Math.abs(cur) ? up : dn; const d = tgt - cur; return Math.abs(d) <= r * dt ? tgt : cur + Math.sign(d) * r * dt; };
    this.axes.elev = ramp(this.axes.elev, eT, 2.8, 5);
    this.axes.ail = ramp(this.axes.ail, aT, 3.0, 6);
    this.axes.rud = ramp(this.axes.rud, rT, 2.0, 4);
    this.trimDelta = 0;
    if (this.pressed('=', '+')) thrIn += 1; if (this.pressed('-', '_')) thrIn -= 1;
    this.thrDelta = clamp(thrIn, -1, 1) * 0.5 * dt;   // full travel in ~2 s at full key/trigger
    if (this.pressed('.')) trimIn += 1; if (this.pressed(',')) trimIn -= 1;
    this.trimDelta = clamp(trimIn, -1, 1) * 0.25 * dt;
    return held;
  }
  drain() { const e = this.events; this.events = []; return e; }
}
