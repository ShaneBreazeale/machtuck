// Controls and flight hardware panel: shows every connected device live, binds axes and buttons by moving / pressing
// them (js/hardware.js does the capture and calibration), with invert and clear per function.
import { AXIS_FNS, BUTTON_FNS, deviceKind } from './hardware.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class HardwarePanel {
  constructor(hw, { onOpen = () => {}, onClose = () => {}, ffb = null } = {}) {
    this.hw = hw; this.ffb = ffb; this.onOpen = onOpen; this.onClose = onClose; this.open = false; this.capFn = null; this.raf = 0; this.last = 0;
    const el = this.el = document.createElement('div');
    el.id = 'hwpanel'; el.className = 'overlay hidden';
    el.innerHTML = `<div class="panel hw">
      <h2>Controls and flight hardware</h2>
      <p class="sub">Yokes, sticks, rudder pedals, throttle quadrants and gamepads all work at once. Bind a function, then move or
        press the control. Bindings are saved per device in this browser. A device appears only after you press one of its buttons.</p>
      <div class="hwdevs"></div>
      <div class="hwprompt hidden"><b class="hwptext"></b> <span class="hwpsub"></span>
        <button class="alt hwdone">Done</button><button class="alt hwcancel">Cancel</button></div>
      <table class="hwtab"><thead><tr><th>Function</th><th>Bound to</th><th>Live</th><th></th></tr></thead><tbody></tbody></table>
      <p class="note">Unbound functions keep their defaults: a gamepad's sticks, triggers and buttons; a yoke or joystick's X and Y axes.
        Pedals and throttle quadrants do nothing until bound. Inputs are force on the column (see COLUMN FORCE), except a force-feedback stick, whose position is the column's; a moved throttle lever sets the
        thrust lever directly, the keys and triggers still nudge it.</p>
      <div class="hwffb">
        <b>Force feedback</b> <span class="ffbst"></span>
        <div class="ffbrow"><button class="alt sm ffbconn">Connect force-feedback stick…</button><button class="alt sm ffbdis">Disconnect</button><button class="alt sm ffbtest">Test</button>
          <label>Strength <input type="range" class="ffbgain" min="0" max="100" step="5"> <span class="ffbgv"></span></label>
          <label><input type="checkbox" class="ffbiy"> invert pitch</label><label><input type="checkbox" class="ffbix"> invert roll</label><label><input type="checkbox" class="ffbsw"> swap axes</label></div>
        <p class="note">USB PID sticks (the DirectInput force-feedback standard) in Chrome or Edge. The stick's position becomes the column's
          position and its motor carries the hinge moment: stiffer with airspeed and Mach, light with a stalled tail, moved by the
          autopilot (push past its clutch and it slips), with the shaker and buffet on top. Test: the stick should move back toward
          you, then right, then shake; if not, use invert or swap. Start with low strength.</p>
      </div>
      <div class="row"><button class="hwclose">Close</button><button class="alt hwreset">Clear all bindings</button></div>
    </div>`;
    document.body.appendChild(el);
    const body = el.querySelector('tbody');
    const rows = [...Object.entries(AXIS_FNS).map(([k, v]) => [k, v, true]), ...Object.entries(BUTTON_FNS).map(([k, v]) => [k, v, false])];
    for (const [fn, def, isAxis] of rows) {
      const tr = document.createElement('tr'); tr.dataset.fn = fn;
      tr.innerHTML = `<td>${esc(def.label)}</td><td class="hwb"></td><td class="hwlive">${isAxis ? '<span class="bar"><i></i></span>' : '<span class="dot"></span>'}</td>
        <td class="hwact"><button class="alt sm" data-a="bind">Bind</button>${isAxis ? '<button class="alt sm" data-a="inv">Invert</button>' : ''}<button class="alt sm" data-a="clr">Clear</button></td>`;
      body.appendChild(tr);
    }
    body.addEventListener('click', (e) => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      const fn = e.target.closest('tr').dataset.fn;
      if (a === 'bind') this.bind(fn); else if (a === 'inv') this.hw.invert(fn); else if (a === 'clr') this.hw.clear(fn);
      this.refresh();
    });
    el.querySelector('.hwclose').addEventListener('click', () => this.hide());
    el.querySelector('.hwreset').addEventListener('click', () => { this.hw.clear(); this.refresh(); });
    el.querySelector('.hwdone').addEventListener('click', () => { const r = this.hw.finishCapture(); this.endCapture(r); });
    el.querySelector('.hwcancel').addEventListener('click', () => { this.hw.cancelCapture(); this.endCapture(null); });
    this.wireFfb();
    window.addEventListener('keydown', (e) => { if (this.open && e.key === 'Escape') { if (this.capFn) { this.hw.cancelCapture(); this.endCapture(null); } else this.hide(); } });
  }
  wireFfb() {
    const f = this.ffb, q = (c) => this.el.querySelector(c), box = q('.hwffb');
    if (!f) { box.classList.add('hidden'); return; }
    q('.ffbconn').addEventListener('click', () => f.connect());
    q('.ffbdis').addEventListener('click', () => f.detach());
    q('.ffbtest').addEventListener('click', () => f.test());
    q('.ffbgain').addEventListener('input', (e) => f.setOpt('gain', e.target.value / 100));
    for (const [c, k] of [['.ffbix', 'invX'], ['.ffbiy', 'invY'], ['.ffbsw', 'swap']]) q(c).addEventListener('change', (e) => f.setOpt(k, e.target.checked));
    f.onChange = () => { this.refreshFfb(); const d = this.el.querySelector('.hwdevs'); d.dataset.sig = ''; };
    this.refreshFfb();
  }
  refreshFfb() {
    const f = this.ffb; if (!f) return;
    const q = (c) => this.el.querySelector(c);
    q('.ffbst').textContent = f.status;
    q('.ffbconn').disabled = !f.supported; q('.ffbdis').disabled = !f.ready; q('.ffbtest').disabled = !f.ready;
    q('.ffbgain').value = Math.round(f.s.gain * 100); q('.ffbgv').textContent = `${Math.round(f.s.gain * 100)} %`;
    q('.ffbix').checked = f.s.invX; q('.ffbiy').checked = f.s.invY; q('.ffbsw').checked = f.s.swap;
  }
  toggle() { if (this.open) this.hide(); else this.show(); }
  show() {
    if (this.open) return; this.open = true; this.el.classList.remove('hidden'); this.onOpen(); this.refresh();
    this.last = performance.now(); const loop = (now) => { if (!this.open) return; this.tick(Math.min(0.1, (now - this.last) / 1000)); this.last = now; this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  hide() { if (!this.open) return; this.hw.cancelCapture(); this.capFn = null; this.open = false; cancelAnimationFrame(this.raf); this.el.classList.add('hidden'); this.onClose(); }
  bind(fn) {
    this.hw.startCapture(fn); this.capFn = fn;
    const p = this.el.querySelector('.hwprompt'); p.classList.remove('hidden');
    const def = AXIS_FNS[fn] || BUTTON_FNS[fn];
    p.querySelector('.hwptext').textContent = AXIS_FNS[fn] ? `${def.label}: ${def.prompt}.` : `${def.label}: press the button or hat direction.`;
    p.querySelector('.hwpsub').textContent = 'Waiting for input…';
    p.querySelector('.hwdone').classList.toggle('hidden', !AXIS_FNS[fn]);
    this.refresh();
  }
  endCapture(r) {
    const fn = this.capFn; this.capFn = null;
    const p = this.el.querySelector('.hwprompt');
    if (r) p.classList.add('hidden');
    else if (fn) { p.querySelector('.hwptext').textContent = `${(AXIS_FNS[fn] || BUTTON_FNS[fn]).label}: not bound.`; p.querySelector('.hwpsub').textContent = 'Move the control further, or press Bind again.'; p.querySelector('.hwdone').classList.add('hidden'); }
    this.refresh();
  }
  tick(dt) {
    if (this.capFn) {
      const cap = this.hw.capture;
      if (cap && cap.sel) this.el.querySelector('.hwpsub').textContent = `Got ${cap.sel.id.replace(/\s*\(.*$/, '').slice(0, 30)} axis ${cap.sel.axis}: keep going through the full travel, then Done.`;
      const r = this.hw.stepCapture(dt);
      if (r) this.endCapture(r);
    }
    // live values
    const pads = this.hw.pads();
    for (const tr of this.el.querySelectorAll('tbody tr')) {
      const fn = tr.dataset.fn, v = this.hw.value(fn, pads);
      const bar = tr.querySelector('.bar i'), dot = tr.querySelector('.dot');
      if (bar) {
        const lever = fn === 'throttle', x = v === null ? 0 : v;
        bar.style.left = lever ? '0%' : `${50 + Math.min(0, x) * 50}%`; bar.style.width = `${(lever ? x : Math.abs(x) / 2) * 100}%`;
        bar.parentElement.classList.toggle('off', v === null);
      }
      if (dot) dot.classList.toggle('on', v === 1);
      tr.classList.toggle('cap', fn === this.capFn);
    }
    const devs = this.el.querySelector('.hwdevs');
    const sig = pads.map((g) => g.id + g.index).join('|');
    if (devs.dataset.sig !== sig) { devs.dataset.sig = sig; this.renderDevices(pads); this.refresh(); }
    pads.forEach((gp, k) => {
      const row = devs.children[k]; if (!row) return;
      const ax = row.querySelector('.axes');
      ax.textContent = gp.axes.map((v, i) => `${i}:${v > 1.05 ? 'hat' : (v >= 0 ? '+' : '') + v.toFixed(2)}`).join('  ');
      row.querySelector('.btns').textContent = gp.buttons.map((b, i) => b.pressed ? i : null).filter((x) => x !== null).join(' ') || '—';
    });
  }
  renderDevices(pads) {
    const devs = this.el.querySelector('.hwdevs');
    devs.innerHTML = pads.length ? '' : '<div class="hwdev none">No devices yet. Plug in, then press a button on each one.</div>';
    for (const gp of pads) {
      const d = document.createElement('div'); d.className = 'hwdev';
      d.innerHTML = `<b>${esc(gp.id.replace(/\s*\(.*$/, '').slice(0, 60))}</b> <span class="kind">${deviceKind(gp)}${gp.mapping === 'standard' ? ', standard layout' : ''}${this.hw.isFfb && this.hw.isFfb(gp) ? ', force feedback: position in, column force out' : ''}</span>
        <div class="axes"></div><div>buttons held: <span class="btns"></span></div>`;
      devs.appendChild(d);
    }
  }
  refresh() {
    const pads = this.hw.pads();
    for (const tr of this.el.querySelectorAll('tbody tr')) {
      const fn = tr.dataset.fn, d = this.hw.bind[fn] ? this.hw.describe(fn) : this.hw.defaultFor(fn, pads) || '—';
      const td = tr.querySelector('.hwb'); td.textContent = d; td.classList.toggle('dflt', d.startsWith('default'));
    }
  }
}
