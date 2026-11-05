// Force feedback for USB PID joysticks (HID "Physical Interface Device", the protocol behind DirectInput force
// feedback) over WebHID. Chrome and Edge only, secure context, and the pilot picks the stick in the browser's prompt.
//
// No device layout is hard-coded. PID reports are found by the usages they carry, and every field's bit position, size
// and logical range comes from the HID report descriptor as WebHID exposes it (Chromium hands each top-level
// collection every report item of its sub-collections, in descriptor order, so offsets can be summed).
//
// Effects used: one two-axis SPRING (condition effect: centre point, stiffness and saturation per axis), a DAMPER, and a
// SINE (periodic) for the stick shaker, buffet and the iced-tail column pulsing. The stick runs the spring loop
// itself at its own rate, so the browser only moves the centre and changes the stiffness (tens of Hz at most).
// Safety: device gain defaults to 50 %, stiffness rises at a limited rate; paused or in a menu the stick gets only a light
// centring spring, and every force stops on a hidden tab, page exit, disconnect or error.
//
// Units of a "feel" (see PilotControls.feel in js/controls.js), per axis, in stick terms:
//   centre -1..1 (+ = pull / right), k 0..1 (fraction of the device's strongest spring), sat 0..1 (force cap)
//   damp 0..1, shake { mag 0..1, periodMs }

export const PID = 0x0f;
const P = (id) => (PID << 16) | id;
const GD = (id) => (0x01 << 16) | id;
const ORD = (n) => (0x0a << 16) | n;

// Physical Input Device usage page (HID Usage Tables 1.x, page 0x0F)
export const U = {
  blockIndex: P(0x22), paramOffset: P(0x23), effectType: P(0x25),
  etConstant: P(0x26), etRamp: P(0x27), etSquare: P(0x30), etSine: P(0x31), etTriangle: P(0x32),
  etSpring: P(0x40), etDamper: P(0x41), etInertia: P(0x42), etFriction: P(0x43),
  duration: P(0x50), samplePeriod: P(0x51), gain: P(0x52), trigger: P(0x53), triggerRepeat: P(0x54),
  axesEnable: P(0x55), dirEnable: P(0x56), direction: P(0x57), startDelay: P(0xa7),
  cpOffset: P(0x60), posCoef: P(0x61), negCoef: P(0x62), posSat: P(0x63), negSat: P(0x64), deadBand: P(0x65),
  periodicOffset: P(0x6f), magnitude: P(0x70), phase: P(0x71), period: P(0x72), attack: P(0x5b), rampStart: P(0x75),
  op: P(0x78), opStart: P(0x79), opSolo: P(0x7a), opStop: P(0x7b), loopCount: P(0x7c),
  deviceGain: P(0x7e), ramPool: P(0x80), simulMax: P(0x83), deviceManaged: P(0xa9),
  loadStatus: P(0x8b), loadOk: P(0x8c), loadFull: P(0x8d), loadErr: P(0x8e),
  playing: P(0x94), actuatorsOn: P(0xa0),
  dcEnable: P(0x97), dcDisable: P(0x98), dcStopAll: P(0x99), dcReset: P(0x9a), dcPause: P(0x9b), dcContinue: P(0x9c),
  byteCount: GD(0x3b), x: GD(0x30), y: GD(0x31), ord1: ORD(1), ord2: ORD(2),
};
const DC = [U.dcEnable, U.dcDisable, U.dcStopAll, U.dcReset, U.dcPause, U.dcContinue];
const ETS = [U.etConstant, U.etRamp, U.etSquare, U.etSine, U.etTriangle, U.etSpring, U.etDamper, U.etInertia, U.etFriction];

// ---------------- report layout from WebHID collections ----------------
function usagesOf(item) {
  if (item.usages && item.usages.length) return item.usages.map((u) => u >>> 0);
  if (item.isRange && item.usageMaximum >= item.usageMinimum && item.usageMaximum - item.usageMinimum < 512) {
    const a = []; for (let u = item.usageMinimum; u <= item.usageMaximum; u++) a.push(u >>> 0); return a;
  }
  return [];
}
// HID unit exponent is a 4-bit two's complement nibble; some stacks pass the raw nibble or byte
function unitExp(e) { e = e | 0; if (e > 7 && e < 16) return e - 16; if (e > 127) return e - 256; return e; }

export class Report {
  constructor(type, id, items) {
    this.type = type; this.id = id; this.fields = []; let off = 0;
    for (const it of items) {
      const size = it.reportSize | 0, count = it.reportCount | 0;
      const f = { usages: usagesOf(it), isArray: !!it.isArray, constant: !!it.isConstant, size, count, off,
        lmin: it.logicalMinimum | 0, lmax: it.logicalMaximum, exp: unitExp(it.unitExponent) };
      if (f.lmax === undefined || f.lmax === null) f.lmax = 2 ** Math.min(size, 31) - 1;
      // a descriptor that writes 0xFF / 0xFFFF in a short item meant unsigned, but parsers can read it as -1
      if (f.lmax < f.lmin && f.lmin >= 0) f.lmax = 2 ** Math.min(size, 31) - 1;
      this.fields.push(f); off += size * count;
    }
    this.bits = off; this.bytes = Math.ceil(off / 8);
  }
  all() { const s = new Set(); for (const f of this.fields) if (!f.constant) for (const u of f.usages) s.add(u); return s; }
  has(u) { return this.fields.some((f) => !f.constant && f.usages.includes(u)); }
  // the variable field element carrying usage u (HID: the last usage repeats for the remaining elements)
  slot(u) {
    for (const f of this.fields) {
      if (f.constant || f.isArray) continue;
      for (let k = 0; k < f.count; k++) if (f.usages[Math.min(k, f.usages.length - 1)] === u) return { f, k };
    }
    return null;
  }
  field(u) { const s = this.slot(u); return s ? s.f : null; }
  arrayWith(u) { return this.fields.find((f) => f.isArray && !f.constant && f.usages.includes(u)) || null; }
  // vals: Map(extended usage -> logical value) for variable fields; sel: usages to pick in array fields (selectors)
  encode(vals = new Map(), sel = []) {
    const out = new Uint8Array(this.bytes);
    const put = (bit, size, v) => {
      v = Math.round(v); if (v < 0) v += 2 ** size; v = Math.max(0, Math.min(2 ** size - 1, v));
      for (let i = 0; i < size; i++) { if (Math.floor(v / 2 ** i) % 2) out[(bit + i) >> 3] |= 1 << ((bit + i) & 7); }
    };
    const left = [...sel];
    for (const f of this.fields) {
      if (f.constant) continue;
      for (let k = 0; k < f.count; k++) {
        const bit = f.off + k * f.size;
        if (f.isArray) {
          const j = left.findIndex((u) => f.usages.includes(u));
          if (j >= 0) { put(bit, f.size, f.lmin + f.usages.indexOf(left[j])); left.splice(j, 1); }
        } else {
          const u = f.usages[Math.min(k, f.usages.length - 1)];
          if (vals.has(u)) put(bit, f.size, vals.get(u));
          else if (sel.includes(u)) put(bit, f.size, 1);        // a selector declared as a one-bit variable (bitmask style)
        }
      }
    }
    return out;
  }
  decode(bytes) {
    const vals = new Map(), sel = new Set();
    const get = (bit, size, signed) => {
      let v = 0; for (let i = 0; i < size; i++) { const b = bit + i; if (bytes[b >> 3] & (1 << (b & 7))) v += 2 ** i; }
      return signed && v >= 2 ** (size - 1) ? v - 2 ** size : v;
    };
    for (const f of this.fields) {
      if (f.constant) continue;
      for (let k = 0; k < f.count; k++) {
        const v = get(f.off + k * f.size, f.size, f.lmin < 0);
        if (f.isArray) { const u = f.usages[v - f.lmin]; if (u !== undefined && v >= f.lmin && v <= f.lmax) sel.add(u); }
        else { const u = f.usages[Math.min(k, f.usages.length - 1)]; if (u !== undefined && !vals.has(u)) vals.set(u, v); }
      }
    }
    return { vals, sel };
  }
}

// value scaling into a field's logical range
export const scale = {
  // signed quantity -1..1; a field with an unsigned range takes the magnitude (as Linux hid-pidff does)
  signed(f, n) { n = Math.max(-1, Math.min(1, n)); if (f.lmin < 0) return n >= 0 ? n * f.lmax : n * -f.lmin; return f.lmin + Math.abs(n) * (f.lmax - f.lmin); },
  unsigned(f, n) { n = Math.max(0, Math.min(1, n)); return f.lmin + n * (f.lmax - f.lmin); },
  // milliseconds into the field's time unit (exponent -3 = ms; no exponent: ms, the de-facto convention)
  ms(f, t) { const e = f.exp < 0 && f.exp >= -6 ? f.exp : -3; return Math.min(f.lmax, Math.max(f.lmin, t * 10 ** (-3 - e))); },
  angle(f, deg) { return f.lmin + ((deg % 360 + 360) % 360) / 360 * (f.lmax - f.lmin + 1); },
};

// Find the PID reports by what they carry. `ok` is false (and `missing` says why) without usable force feedback.
export function pidLayout(collections) {
  const reports = [];
  const add = (type, list) => { for (const r of list || []) if (!reports.some((x) => x.type === type && x.id === r.reportId)) reports.push(new Report(type, r.reportId, r.items || [])); };
  // top-level collections already hold every item of their sub-collections, in order
  for (const c of collections || []) { add('output', c.outputReports); add('feature', c.featureReports); add('input', c.inputReports); }
  const L = {};
  const pick = (type, test) => reports.find((r) => r.type === type && test(r)) || null;
  const has = (r, ...us) => us.some((u) => r.has(u));
  L.control = pick('output', (r) => has(r, ...DC));
  L.gain = pick('output', (r) => has(r, U.deviceGain));
  L.condition = pick('output', (r) => has(r, U.cpOffset, U.posCoef));
  L.periodic = pick('output', (r) => has(r, U.period));
  L.operation = pick('output', (r) => has(r, U.opStart, U.opStop, U.op));
  L.effect = pick('output', (r) => has(r, U.duration, U.axesEnable, U.x) && has(r, U.blockIndex) && !has(r, U.cpOffset, U.period, U.magnitude));
  L.free = pick('output', (r) => { const a = [...r.all()]; return a.length === 1 && a[0] === U.blockIndex; });
  L.create = pick('feature', (r) => ETS.some((u) => r.has(u)));
  L.blockLoad = pick('feature', (r) => has(r, U.loadStatus, U.loadOk));
  L.pool = pick('feature', (r) => has(r, U.ramPool, U.simulMax));
  const typeField = L.effect && L.effect.fields.find((f) => f.isArray && ETS.some((u) => f.usages.includes(u)));
  L.types = new Set(typeField ? typeField.usages.filter((u) => ETS.includes(u)) : []);
  L.ok = !!(L.effect && L.condition && L.operation && L.control && L.types.has(U.etSpring) && (!L.create || L.blockLoad));
  L.missing = ['effect', 'condition', 'operation', 'control'].filter((k) => !L[k]);
  if (!L.types.has(U.etSpring)) L.missing.push('spring');
  return L;
}

// ---------------- the device: PID protocol over one WebHID device ----------------
export class PidStick {
  constructor(dev, layout) {
    this.dev = dev; this.L = layout; this.fx = {}; this.next = 1; this.sent = 0;
    this.deviceManaged = !!layout.create;
  }
  async out(rep, vals, sel) { this.sent++; await this.dev.sendReport(rep.id, rep.encode(vals, sel)); }
  async control(u) { if (this.L.control) await this.out(this.L.control, new Map(), [u]); }
  async init(gain) {
    if (!this.dev.opened) await this.dev.open();
    await this.control(U.dcReset);
    await this.control(U.dcStopAll);
    await this.control(U.dcEnable);
    await this.setGain(gain);
  }
  async setGain(g) { const r = this.L.gain; if (r) await this.out(r, new Map([[U.deviceGain, scale.unsigned(r.field(U.deviceGain), g)]])); }
  async readFeature(rep) {
    const dv = await this.dev.receiveFeatureReport(rep.id);
    let b = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    if (rep.id && b.length > rep.bytes && b[0] === rep.id) b = b.subarray(1);   // Chromium returns the report ID first
    return rep.decode(b);
  }
  // allocate an effect block: the device hands out the index (device-managed pool) or we number them
  async create(type) {
    if (!this.deviceManaged) return this.next++;
    const c = this.L.create, v = new Map();
    if (c.has(U.byteCount)) v.set(U.byteCount, 0);
    this.sent++; await this.dev.sendFeatureReport(c.id, c.encode(v, [type]));
    for (let i = 0; i < 4; i++) {
      const { vals, sel } = await this.readFeature(this.L.blockLoad);
      const idx = vals.get(U.blockIndex) | 0;
      if (sel.has(U.loadFull)) throw new Error('force feedback memory full');
      if (sel.has(U.loadErr)) throw new Error('effect upload refused');
      if (idx > 0 && (sel.has(U.loadOk) || !this.L.blockLoad.arrayWith(U.loadOk))) return idx;
    }
    throw new Error('no effect block from the device');
  }
  async setEffect(idx, type, polar) {
    const r = this.L.effect, v = new Map(), f = (u) => r.field(u);
    v.set(U.blockIndex, idx);
    if (f(U.duration)) v.set(U.duration, 0xffff);                    // infinite (PID convention, as Linux and Windows send)
    if (f(U.triggerRepeat)) v.set(U.triggerRepeat, 0);
    if (f(U.samplePeriod)) v.set(U.samplePeriod, 0);
    if (f(U.gain)) v.set(U.gain, f(U.gain).lmax);
    if (f(U.trigger)) { const t = f(U.trigger); v.set(U.trigger, t.lmin > 0 ? t.lmin - 1 : t.lmax + 1 < 2 ** t.size ? t.lmax + 1 : 0); }   // null: no trigger button
    if (f(U.startDelay)) v.set(U.startDelay, 0);
    if (f(U.x)) v.set(U.x, 1); if (f(U.y)) v.set(U.y, 1);              // axes enable: X and Y
    if (f(U.dirEnable)) v.set(U.dirEnable, polar ? 1 : 0);
    // direction: conditions are per-axis (Cartesian); periodic forces act fore-aft (polar 0)
    for (const u of [U.ord1, U.ord2]) if (f(u)) v.set(u, polar ? scale.angle(f(u), 0) : 0);
    await this.out(r, v, [type]);
  }
  async condition(idx, axis, c) {
    const r = this.L.condition, v = new Map(), f = (u) => r.field(u);
    v.set(U.blockIndex, idx); if (f(U.paramOffset)) v.set(U.paramOffset, axis);
    if (f(U.cpOffset)) v.set(U.cpOffset, scale.signed(f(U.cpOffset), c.centre || 0));
    for (const u of [U.posCoef, U.negCoef]) if (f(u)) v.set(u, scale.signed(f(u), c.k));
    for (const u of [U.posSat, U.negSat]) if (f(u)) v.set(u, scale.unsigned(f(u), c.sat ?? 1));
    if (f(U.deadBand)) v.set(U.deadBand, scale.unsigned(f(U.deadBand), 0));
    await this.out(r, v);
  }
  async periodic(idx, mag, periodMs) {
    const r = this.L.periodic, v = new Map(), f = (u) => r.field(u);
    v.set(U.blockIndex, idx);
    if (f(U.magnitude)) v.set(U.magnitude, scale.unsigned(f(U.magnitude), mag));
    if (f(U.periodicOffset)) v.set(U.periodicOffset, scale.signed(f(U.periodicOffset), 0));
    if (f(U.phase)) v.set(U.phase, f(U.phase).lmin);
    if (f(U.period)) v.set(U.period, scale.ms(f(U.period), periodMs));
    await this.out(r, v);
  }
  async op(idx, what) {
    const r = this.L.operation, v = new Map([[U.blockIndex, idx]]);
    if (r.field(U.loopCount)) v.set(U.loopCount, 1);
    await this.out(r, v, [what]);
  }
  async free(idx) { if (this.L.free) await this.out(this.L.free, new Map([[U.blockIndex, idx]])); }
  // effect blocks are made on first use
  async ensure(name, type, polar) {
    if (this.fx[name]) return this.fx[name];
    if (!this.L.types.has(type)) return null;
    const idx = await this.create(type);
    await this.setEffect(idx, type, polar);
    return (this.fx[name] = { idx, type, running: false });
  }
  async stopAll() { await this.control(U.dcStopAll); for (const e of Object.values(this.fx)) e.running = false; }
  async release() {
    await this.stopAll();
    for (const e of Object.values(this.fx)) await this.free(e.idx);
    this.fx = {};
  }
}

// ---------------- matching a WebHID device to its Gamepad API twin ----------------
const hex4 = (n) => (n | 0).toString(16).padStart(4, '0');
export function sameStick(hid, gp) {
  if (!hid || !gp) return false;
  const id = gp.id.toLowerCase(), v = hex4(hid.vendorId), p = hex4(hid.productId);
  const chrome = id.match(/vendor:\s*([0-9a-f]{4})\s+product:\s*([0-9a-f]{4})/);
  if (chrome) return chrome[1] === v && chrome[2] === p;
  const ff = id.match(/^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/);           // Firefox: "45e-1b-Name"
  if (ff) return ff[1].padStart(4, '0') === v && ff[2].padStart(4, '0') === p;
  return !!hid.productName && id.includes(hid.productName.toLowerCase());
}

// ---------------- the manager: connect, settings, per-frame updates ----------------
const KEY = 'n722bd_ffb_v1';
export const IDLE_FEEL = { pitch: { centre: 0, k: 0.15, sat: 0.3 }, roll: { centre: 0, k: 0.15, sat: 0.3 }, damp: 0.1, shake: { mag: 0, periodMs: 100 } };
const JOYSTICKS = [{ usagePage: 1, usage: 4 }, { usagePage: 1, usage: 5 }, { usagePage: 1, usage: 8 }, { usagePage: PID }];
const RATE = { centre: 1.5, k: 1.2 };     // per second: how fast the centre may move and stiffness may build
const MIN_GAP = 0.03;                      // s between parameter updates

export class ForceFeedback {
  constructor({ hid = (typeof navigator !== 'undefined' ? navigator.hid : null), store = (typeof localStorage !== 'undefined' ? localStorage : null), now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000 } = {}) {
    this.hid = hid || null; this.store = store; this.now = now;
    this.supported = !!this.hid;
    this.s = { gain: 0.5, invX: false, invY: false, swap: false, auto: true };
    try { Object.assign(this.s, JSON.parse(store && store.getItem(KEY) || '{}')); } catch { /* defaults */ }
    this.stick = null; this.dev = null; this.status = this.supported ? 'not connected' : 'needs Chrome or Edge (WebHID)';
    this.cur = null; this.sentFeel = null; this.lastSend = -1; this.busy = null; this.testUntil = 0; this.onChange = () => {};
    if (this.hid && this.hid.addEventListener) this.hid.addEventListener('disconnect', (e) => { if (e.device === this.dev) this.drop('disconnected'); });
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => { if (this.stick) this.stick.stopAll().catch(() => {}); });
      document.addEventListener('visibilitychange', () => { if (document.hidden && this.stick) this.flushStop(); });
    }
  }
  get ready() { return !!this.stick; }
  save() { if (this.store) this.store.setItem(KEY, JSON.stringify(this.s)); }
  setOpt(k, v) { this.s[k] = v; this.save(); if (k === 'gain' && this.stick) this.queue(() => this.stick.setGain(v)); this.sentFeel = null; this.onChange(); }
  // user gesture: pick a stick in the browser's chooser
  async connect() {
    if (!this.hid) return false;
    let devs;
    try { devs = await this.hid.requestDevice({ filters: JOYSTICKS }); } catch (e) { this.status = `chooser failed: ${e.message || e}`; this.onChange(); return false; }
    if (!devs || !devs.length) { this.status = 'no device chosen'; this.onChange(); return false; }
    const d = devs.find((x) => pidLayout(x.collections).ok);
    if (!d) { this.status = `${devs[0].productName || 'device'}: no USB PID force feedback (${pidLayout(devs[0].collections).missing.join(', ')} missing)`; this.onChange(); return false; }
    this.s.auto = true; this.save();
    return this.attach(d);
  }
  // a stick the pilot already allowed reconnects by itself
  async reconnect() {
    if (!this.hid || !this.s.auto || this.stick) return false;
    try { for (const d of await this.hid.getDevices()) if (pidLayout(d.collections).ok) return this.attach(d); } catch { /* none */ }
    return false;
  }
  async attach(d) {
    await this.detach(false);
    this.status = `connecting ${d.productName || ''}`.trim(); this.onChange();
    try {
      const st = new PidStick(d, pidLayout(d.collections));
      await st.init(this.s.gain);
      this.stick = st; this.dev = d; this.cur = null; this.sentFeel = null;
      this.status = `${d.productName || 'stick'}: force feedback on`; this.onChange();
      return true;
    } catch (e) { this.status = `${d.productName || 'stick'}: ${e.message || e}`; this.onChange(); return false; }
  }
  async detach(forget = true) {
    if (forget) { this.s.auto = false; this.save(); }
    const st = this.stick; this.stick = null; this.dev = null; this.cur = null;
    if (st) { try { await this.busy; await st.release(); } catch { /* unplugged */ } }
    if (forget) { this.status = this.supported ? 'not connected' : this.status; this.onChange(); }
  }
  drop(why) { this.stick = null; this.dev = null; this.cur = null; this.status = why; this.onChange(); }
  flushStop() { const st = this.stick; this.sentFeel = null; this.queue(() => st.stopAll()); }
  matchesPad(gp) { return !!this.dev && sameStick(this.dev, gp); }
  // a short check of axis directions: the stick should move back (toward you), then right
  test() { this.testUntil = this.now() + 2.4; this.testT0 = this.now(); }

  // per frame. feel: what the column should feel like now (null = idle)
  update(feel, dt) {
    if (!this.stick) return;
    const t = this.now();
    if (t < this.testUntil) {
      const p = t - this.testT0;
      feel = { pitch: { centre: p < 1.2 ? 0.5 : 0, k: 0.5, sat: 0.6 }, roll: { centre: p >= 1.2 ? 0.5 : 0, k: 0.5, sat: 0.6 }, damp: 0.1, shake: { mag: p > 2.1 ? 0.3 : 0, periodMs: 70 } };
    }
    feel = feel || IDLE_FEEL;
    // limited slew toward the target: the centre glides, stiffness builds gradually, softening is immediate
    const c = this.cur || { pitch: { centre: 0, k: 0, sat: feel.pitch.sat }, roll: { centre: 0, k: 0, sat: feel.roll.sat }, damp: 0, shake: feel.shake };
    const toward = (a, b, r) => (Math.abs(b - a) <= r * dt ? b : a + Math.sign(b - a) * r * dt);
    const ax = (o, n) => ({ centre: toward(o.centre, n.centre, RATE.centre), k: n.k < o.k ? n.k : toward(o.k, n.k, RATE.k), sat: n.sat });
    this.cur = { pitch: ax(c.pitch, feel.pitch), roll: ax(c.roll, feel.roll), damp: feel.damp, shake: feel.shake };
    if (t - this.lastSend >= MIN_GAP && !this.busyNow) this.send();
  }
  // device axes: X = roll, Y = pitch (HID joysticks: Y grows toward the pilot = pull), with the pilot's corrections
  toDevice(f) {
    const inv = (a, s) => ({ centre: s ? -a.centre : a.centre, k: Math.max(0, Math.min(1, a.k)), sat: Math.max(0, Math.min(1, a.sat)) });
    let x = inv(f.roll, this.s.invX), y = inv(f.pitch, this.s.invY);
    if (this.s.swap) [x, y] = [y, x];
    return { x, y, damp: Math.max(0, Math.min(1, f.damp || 0)), mag: Math.max(0, Math.min(1, f.shake ? f.shake.mag : 0)), period: f.shake ? f.shake.periodMs : 100 };
  }
  send() {
    const d = this.toDevice(this.cur), s = this.sentFeel, st = this.stick;
    const ch = (a, b, e) => !b || Math.abs(a.centre - b.centre) > e || Math.abs(a.k - b.k) > e || Math.abs(a.sat - b.sat) > e;
    const spring = !s || ch(d.x, s.x, 0.004) || ch(d.y, s.y, 0.004);
    const damp = !s || Math.abs(d.damp - s.damp) > 0.02;
    const shakeOn = d.mag > 0.01, shake = !s || (shakeOn !== s.mag > 0.01) || (shakeOn && (Math.abs(d.mag - s.mag) > 0.02 || Math.abs(d.period - s.period) > 4));
    if (!spring && !damp && !shake) return;
    this.lastSend = this.now(); this.sentFeel = d;
    this.queue(async () => {
      if (spring) {
        const e = await st.ensure('spring', U.etSpring, false);
        await st.condition(e.idx, 0, d.x); await st.condition(e.idx, 1, d.y);
        if (!e.running) { await st.op(e.idx, U.opStart); e.running = true; }
      }
      if (damp) {
        const e = await st.ensure('damper', U.etDamper, false);
        if (e) {
          const a = { centre: 0, k: d.damp, sat: 1 }; await st.condition(e.idx, 0, a); await st.condition(e.idx, 1, a);
          if (!e.running) { await st.op(e.idx, U.opStart); e.running = true; }
        }
      }
      if (shake && st.L.periodic) {
        const e = await st.ensure('shake', st.L.types.has(U.etSine) ? U.etSine : U.etSquare, true);
        if (e) {
          if (shakeOn) { await st.periodic(e.idx, d.mag, d.period); if (!e.running) { await st.op(e.idx, U.opStart); e.running = true; } }
          else if (e.running) { await st.op(e.idx, U.opStop); e.running = false; }
        }
      }
    });
  }
  // one report chain at a time, in order; a failure turns force feedback off rather than leaving a stuck force
  queue(fn) {
    const prev = this.busy || Promise.resolve();
    this.busyNow = true;
    const p = prev.then(fn).catch((e) => { const st = this.stick; this.drop(`force feedback stopped: ${e.message || e}`); if (st) st.stopAll().catch(() => {}); })
      .finally(() => { if (this.busy === p) this.busyNow = false; });
    this.busy = p; return p;
  }
  async flush() { while (this.busy) { const b = this.busy; await b; if (this.busy === b) break; } }
}
