// Keyboard / mouse / touch / gamepad -> smoothed control axes.
import { clamp } from './util.js';
import { Hardware, deviceKind } from './hardware.js';
export class Input {
  constructor(canvas) {
    this.keys = new Set(); this.axes = { elev: 0, ail: 0, rud: 0, posElev: null, posAil: null };
    this.kb = { elev: 0, ail: 0, rud: 0 };   // keyboard part, ramped (keys are on/off); hardware and mouse are added unramped
    this.hw = new Hardware();               // every connected yoke, stick, pedals, throttle quadrant and gamepad (js/hardware.js)
    this.thrSet = null;                     // absolute throttle from a bound lever, set only on frames the lever moved
    this.brakeL = 0; this.brakeR = 0;       // wheel brakes 0..1: Shift (both), toe brakes, a bound button, D-pad left
    this.events = [];            // discrete actions: 'ap_off','sb','gear','flaps','cam','pause','restart','skip','quality','slow','antiice','yd','help','ghost'
    this.mouse = { down: false, x0: 0, y0: 0, dx: 0, dy: 0 };
    this.thrDelta = 0; this.trimDelta = 0; this.orbit = { yaw: 0, pitch: 0 }; this.rdrag = null; this.onClick = null;
    // Browsers expose a device only after one of its buttons is pressed or an axis moves.
    this.pad = { rumbleAt: 0 }; this.onPad = null;
    this.zoom = 1;   // cockpit field-of-view scale, mouse wheel
    canvas.addEventListener('wheel', (e) => { this.zoom = clamp(this.zoom * Math.exp(e.deltaY * 0.0012), 0.42, 1.22); e.preventDefault(); }, { passive: false });
    window.addEventListener('gamepadconnected', (e) => {
      const gp = e.gamepad, k = deviceKind(gp), name = gp.id.replace(/\s*\(.*$/, '').slice(0, 40), mine = Object.values(this.hw.bind).some((b) => b.id === gp.id);
      if (!this.onPad) return;
      if (mine) this.onPad(`${name} connected: using your bindings`);
      else if (k === 'gamepad') this.onPad(gp.mapping === 'standard' ? `Controller connected: ${name}` : `Controller connected without the standard layout (${name}): sticks and triggers only. Bind buttons in Controls (/)`);
      else if (k === 'stick') this.onPad(`${name} connected: X/Y fly roll and pitch. Bind rudder, throttle and buttons in Controls (/)`);
      else this.onPad(`${name} connected: bind its ${k === 'pedals' ? 'rudder axis' : 'lever and buttons'} in Controls (/)`);
    });
    window.addEventListener('gamepaddisconnected', (e) => { if (this.onPad) this.onPad(`${e.gamepad.id.replace(/\s*\(.*$/, '').slice(0, 40)} disconnected`); });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return; const k = e.key.toLowerCase(); this.keys.add(k);
      const map = { '{': 'hdg_dn', '}': 'hdg_up', '<': 'alt_dn', '>': 'alt_up', '\\': 'appr', '/': 'controls', x: 'ap_toggle', b: 'sb', g: 'gear', f: 'flaps', c: 'cam', p: 'pause', ' ': 'pause', r: 'restart', n: 'skip', k: 'quality', '[': 'slower', ']': 'faster', i: 'antiice', y: 'yd', h: 'help', v: 'ghost', '0': 'idle', m: 'mute', z: 'hud', tab: 'efb', '`': 'ckback', '1': 'ck0', '2': 'ck1', '3': 'ck2', '4': 'ck3', '5': 'ck4', '6': 'ck5', '7': 'trimMode', '8': 'machTrim', '9': 'nacelleHeat', t: 'atc', ';': 'atc_earlier', "'": 'atc_later', l: 'comms', u: 'nexrad', o: 'wxr', j: 'wxr_range' };
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
  // Stick shaker / buffet through the rumble motors of any connected controller that has them (Chrome)
  haptics({ shaker = false, buffet = false, broken = false } = {}) {
    const gp = this.hw.pads().find((g) => g.vibrationActuator);
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
    let eT = 0, aT = 0, rT = 0;
    if (this.pressed('arrowdown', 's')) eT += 1; if (this.pressed('arrowup', 'w')) eT -= 1;
    if (this.pressed('arrowright', 'd')) aT += 1; if (this.pressed('arrowleft', 'a')) aT -= 1;
    if (this.pressed('e')) rT += 1; if (this.pressed('q')) rT -= 1;
    // keyboard ramps: ramp up over ~0.35 s, recentre over ~0.2 s
    const ramp = (cur, tgt, up, dn) => { const r = Math.abs(tgt) > Math.abs(cur) ? up : dn; const d = tgt - cur; return Math.abs(d) <= r * dt ? tgt : cur + Math.sign(d) * r * dt; };
    this.kb.elev = ramp(this.kb.elev, eT, 2.8, 5); this.kb.ail = ramp(this.kb.ail, aT, 3.0, 6); this.kb.rud = ramp(this.kb.rud, rT, 2.0, 4);
    // hardware (all devices) and mouse drag go straight through
    const hw = this.hw.poll();
    for (const e of hw.events) this.events.push(e);
    let dE = hw.elev, dA = hw.ail;
    if (this.mouse.down) { dA += clamp(this.mouse.dx, -1, 1); dE += clamp(this.mouse.dy, -1, 1); }
    this.axes.elev = clamp(this.kb.elev + dE, -1, 1);
    this.axes.ail = clamp(this.kb.ail + dA, -1, 1);
    this.axes.rud = clamp(this.kb.rud + hw.rud, -1, 1);
    this.axes.posElev = hw.posElev; this.axes.posAil = hw.posAil;   // force-feedback stick: column position (js/controls.js)
    const held = Math.abs(this.axes.elev) > 0.05 || Math.abs(this.axes.ail) > 0.05 || Math.abs(hw.posElev || 0) > 0.05 || Math.abs(hw.posAil || 0) > 0.05;
    let thrIn = hw.thrRate, trimIn = hw.trim;   // -1..1 rate demands: keys are on/off, triggers proportional
    if (hw.thrSet !== null) this.thrSet = hw.thrSet;   // held until the sim takes it (IN.thrSet = null)
    const kbBrake = this.pressed('shift') ? 1 : 0;
    this.brakeL = Math.max(kbBrake, hw.brakeL); this.brakeR = Math.max(kbBrake, hw.brakeR);
    this.revHold = hw.rev;                  // a bound 'thrust reversers' button is held
    this.trimDelta = 0;
    if (this.pressed('=', '+')) thrIn += 1; if (this.pressed('-', '_')) thrIn -= 1;
    this.thrDelta = clamp(thrIn, -1, 1) * 0.5 * dt;   // full travel in ~2 s at full key/trigger
    if (this.pressed('.')) trimIn += 1; if (this.pressed(',')) trimIn -= 1;
    this.trimDelta = clamp(trimIn, -1, 1) * 0.25 * dt;
    return held;
  }
  // while the sim is paused: keep a controller's pause button live, drop everything else it does
  pollPaused() { for (const e of this.hw.poll().events) if (e === 'pause') this.events.push(e); }
  drain() { const e = this.events; this.events = []; return e; }
}
