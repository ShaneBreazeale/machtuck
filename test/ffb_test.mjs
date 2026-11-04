// Force feedback (js/ffb.js) against simulated USB PID sticks, plus the force-feedback side of js/controls.js.
// Two HID report descriptors, written here from the PID usage tables: a full 16-bit one with a device-managed effect
// pool, and a compact 8-bit one (driver-managed pool, device control as a bitmask, no periodic effects). They are
// parsed the way Chromium does (every report item also lands in each ancestor collection, in order) and a fake stick
// decodes what the driver sends with its own decoder, so the driver is checked against the descriptor, not itself.
import { pidLayout, ForceFeedback, sameStick, U, scale, IDLE_FEEL } from '../js/ffb.js';
import { PilotControls, FEEL, FORCE } from '../js/controls.js';
import { Hardware } from '../js/hardware.js';

let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
const near = (a, b, e = 1) => Math.abs(a - b) <= e;

// ---------------- descriptor items and a Chromium-style parser ----------------
const page = (v) => ({ t: 'page', v }), use = (v) => ({ t: 'use', v }), lmin = (v) => ({ t: 'lmin', v }), lmax = (v) => ({ t: 'lmax', v });
const size = (v) => ({ t: 'size', v }), count = (v) => ({ t: 'count', v }), id = (v) => ({ t: 'id', v }), exp = (v) => ({ t: 'exp', v });
const coll = (type, ...kids) => [{ t: 'coll', v: type }, ...kids.flat(9), { t: 'end' }];
const main = (kind) => (f = {}) => ({ t: kind, array: !!f.array, constant: !!f.constant });
const out = main('output'), feat = main('feature'), inp = main('input');
const ARR = { array: true }, PAD = { constant: true };
const ets = (...u) => u.map(use);

function parse(items) {
  const tops = []; let cur = null, loc = [];
  const g = { page: 0, lmin: 0, lmax: 0, size: 0, count: 0, id: 0, exp: 0 };
  for (const it of items.flat(9)) {
    switch (it.t) {
      case 'page': g.page = it.v; break;
      case 'use': loc.push(((g.page << 16) | it.v) >>> 0); break;
      case 'lmin': case 'lmax': case 'size': case 'count': case 'id': case 'exp': g[it.t] = it.v; break;
      case 'coll': {
        const c = { usagePage: loc.length ? loc[0] >>> 16 : 0, usage: loc.length ? loc[0] & 0xffff : 0, type: it.v, children: [], inputReports: [], outputReports: [], featureReports: [], parent: cur };
        (cur ? cur.children : tops).push(c); cur = c; loc = []; break;
      }
      case 'end': cur = cur.parent; loc = []; break;
      default: {
        const item = { usages: [...loc], isRange: false, isArray: it.array, isConstant: it.constant, reportSize: g.size, reportCount: g.count, logicalMinimum: g.lmin, logicalMaximum: g.lmax, unitExponent: g.exp & 0xf };
        for (let c = cur; c; c = c.parent) {
          const list = c[it.t + 'Reports']; let r = list.find((x) => x.reportId === g.id);
          if (!r) list.push(r = { reportId: g.id, items: [] }); r.items.push(item);
        }
        loc = [];
      }
    }
  }
  return tops;
}
// the fake device's own view of a report: element list with bit offsets
function elements(cols, type, rid) {
  const r = cols[0][type + 'Reports'].find((x) => x.reportId === rid); const els = []; let off = 0;
  for (const it of r.items) {
    for (let k = 0; k < it.reportCount; k++) {
      els.push({ off, size: it.reportSize, usage: it.isArray ? null : it.usages[Math.min(k, it.usages.length - 1)], list: it.usages, array: it.isArray, constant: it.isConstant, lmin: it.logicalMinimum });
      off += it.reportSize;
    }
  }
  return { els, bytes: Math.ceil(off / 8) };
}
function decodeT(cols, type, rid, data) {
  const { els } = elements(cols, type, rid), v = {}, sel = [];
  for (const e of els) {
    if (e.constant) continue;
    let x = 0; for (let i = 0; i < e.size; i++) if (data[(e.off + i) >> 3] & (1 << ((e.off + i) & 7))) x += 2 ** i;
    if (e.lmin < 0 && x >= 2 ** (e.size - 1)) x -= 2 ** e.size;
    if (e.array) { if (x >= e.lmin && e.list[x - e.lmin] !== undefined) sel.push(e.list[x - e.lmin] & 0xffff); }
    else if (!((e.usage & 0xffff) in v)) v[e.usage & 0xffff] = x; else v[(e.usage & 0xffff) + ':2'] = x;
  }
  return { v, sel };
}
function encodeT(cols, type, rid, vals, sels) {
  const { els, bytes } = elements(cols, type, rid), b = new Uint8Array(bytes);
  for (const e of els) {
    let x = e.array ? (sels.find((s) => e.list.some((u) => (u & 0xffff) === s)) !== undefined ? e.lmin + e.list.findIndex((u) => sels.includes(u & 0xffff)) : 0) : (vals[e.usage & 0xffff] ?? 0);
    if (x < 0) x += 2 ** e.size;
    for (let i = 0; i < e.size; i++) if (Math.floor(x / 2 ** i) % 2) b[(e.off + i) >> 3] |= 1 << ((e.off + i) & 7);
  }
  return b;
}

// ---------------- descriptor A: full 16-bit PID stick, device-managed pool ----------------
const ALL_ET = ets(0x26, 0x27, 0x30, 0x31, 0x32, 0x33, 0x34, 0x40, 0x41, 0x42, 0x43, 0x28);
const blockIdx = [page(0x0f), use(0x22), lmin(1), lmax(40), size(8), count(1)];
const DESC_A = [page(1), use(4), coll(1,
  id(1), page(1), use(0x30), use(0x31), lmin(0), lmax(65535), size(16), count(2), inp(),
  page(9), use(1), use(2), lmin(0), lmax(1), size(1), count(8), inp(),
  page(0x0f), use(0x92), coll(2, id(2), blockIdx, inp(), use(0x9f), use(0xa0), use(0x94), lmin(0), lmax(1), size(1), count(3), inp(), size(5), count(1), inp(PAD)),
  // Set Effect (output 1)
  page(0x0f), use(0x21), coll(2, id(1), blockIdx, out(),
    use(0x25), coll(2, ALL_ET, lmin(1), lmax(12), size(8), count(1), out(ARR)),
    use(0x50), use(0x54), use(0x51), lmin(0), lmax(65535), exp(-3), size(16), count(3), out(), exp(0),
    use(0x52), lmin(0), lmax(255), size(8), count(1), out(),
    use(0x53), lmin(1), lmax(8), size(8), count(1), out(),
    use(0x55), coll(2, page(1), use(0x30), use(0x31), lmin(0), lmax(1), size(1), count(2), out()),
    page(0x0f), use(0x56), size(1), count(1), out(), size(5), count(1), out(PAD),
    use(0x57), coll(2, page(0x0a), use(1), use(2), lmin(0), lmax(35999), size(16), count(2), out()),
    page(0x0f), use(0xa7), lmin(0), lmax(65535), size(16), count(1), out()),
  // Set Condition (output 3)
  use(0x5f), coll(2, id(3), blockIdx, out(), use(0x23), lmin(0), lmax(1), size(4), count(1), out(), size(4), out(PAD),
    use(0x60), use(0x61), use(0x62), lmin(-10000), lmax(10000), size(16), count(3), out(),
    use(0x63), use(0x64), lmin(0), lmax(10000), size(16), count(2), out(),
    use(0x65), lmin(0), lmax(255), size(8), count(1), out()),
  // Set Periodic (output 4)
  use(0x6e), coll(2, id(4), blockIdx, out(), use(0x70), lmin(0), lmax(10000), size(16), count(1), out(),
    use(0x6f), lmin(-10000), lmax(10000), size(16), count(1), out(), use(0x71), lmin(0), lmax(35999), size(16), count(1), out(),
    use(0x72), lmin(0), lmax(32767), exp(-3), size(16), count(1), out(), exp(0)),
  // Set Constant Force (output 5)
  use(0x73), coll(2, id(5), blockIdx, out(), use(0x70), lmin(-10000), lmax(10000), size(16), count(1), out()),
  // Effect Operation (output 10)
  use(0x77), coll(2, id(10), blockIdx, out(), use(0x78), coll(2, ets(0x79, 0x7a, 0x7b), lmin(1), lmax(3), size(8), count(1), out(ARR)),
    use(0x7c), lmin(0), lmax(255), size(8), count(1), out()),
  // Block Free (output 11), Device Control (output 12), Device Gain (output 13)
  use(0x90), coll(2, id(11), blockIdx, out()),
  use(0x95), coll(2, id(12), use(0x96), coll(2, ets(0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c), lmin(1), lmax(6), size(8), count(1), out(ARR))),
  use(0x7d), coll(2, id(13), use(0x7e), lmin(0), lmax(255), size(8), count(1), out()),
  // Create New Effect (feature 1), Block Load (feature 2), Pool (feature 3)
  use(0xab), coll(2, id(1), use(0x25), coll(2, ALL_ET, lmin(1), lmax(12), size(8), count(1), feat(ARR)),
    page(1), use(0x3b), lmin(0), lmax(511), size(16), count(1), feat(), page(0x0f)),
  use(0x89), coll(2, id(2), blockIdx, feat(), use(0x8b), coll(2, ets(0x8c, 0x8d, 0x8e), lmin(1), lmax(3), size(8), count(1), feat(ARR)),
    use(0xac), lmin(0), lmax(65535), size(16), count(1), feat()),
  use(0x7f), coll(2, id(3), use(0x80), lmin(0), lmax(65535), size(16), count(1), feat(), use(0x83), lmin(0), lmax(255), size(8), count(1), feat(),
    use(0xa9), use(0xaa), lmin(0), lmax(1), size(1), count(2), feat(), size(6), count(1), feat(PAD)),
)];
// ---------------- descriptor B: compact 8-bit stick, driver-managed pool, bitmask device control ----------------
const DESC_B = [page(1), use(4), coll(1,
  id(1), page(1), use(0x30), use(0x31), lmin(-127), lmax(127), size(8), count(2), inp(),
  page(0x0f), use(0x21), coll(2, id(1), use(0x22), lmin(1), lmax(10), size(8), count(1), out(),
    use(0x25), coll(2, ets(0x26, 0x40), lmin(1), lmax(2), size(8), count(1), out(ARR)),
    use(0x50), lmin(0), lmax(65535), size(16), count(1), out(), use(0x52), lmin(0), lmax(255), size(8), count(1), out(),
    use(0x55), coll(2, page(1), use(0x30), use(0x31), lmin(0), lmax(1), size(1), count(2), out()),
    page(0x0f), use(0x56), size(1), count(1), out(), size(5), count(1), out(PAD),
    use(0x57), coll(2, page(0x0a), use(1), lmin(0), lmax(255), size(8), count(1), out()), page(0x0f)),
  use(0x5f), coll(2, id(2), use(0x22), lmin(1), lmax(10), size(8), count(1), out(), use(0x23), lmin(0), lmax(1), size(8), count(1), out(),
    use(0x60), use(0x61), lmin(-128), lmax(127), size(8), count(2), out(), use(0x63), lmin(0), lmax(255), size(8), count(1), out()),
  use(0x73), coll(2, id(3), use(0x22), lmin(1), lmax(10), size(8), count(1), out(), use(0x70), lmin(-128), lmax(127), size(8), count(1), out()),
  use(0x77), coll(2, id(4), use(0x22), lmin(1), lmax(10), size(8), count(1), out(), use(0x78), coll(2, ets(0x79, 0x7b), lmin(1), lmax(2), size(8), count(1), out(ARR)),
    use(0x7c), lmin(0), lmax(255), size(8), count(1), out()),
  use(0x96), coll(2, id(5), ets(0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c), lmin(0), lmax(1), size(1), count(6), out(), size(2), count(1), out(PAD)),
  use(0x7d), coll(2, id(6), use(0x7e), lmin(0), lmax(255), size(8), count(1), out()),
)];
const PLAIN = [page(1), use(4), coll(1, id(0), page(1), use(0x30), use(0x31), lmin(0), lmax(1023), size(16), count(2), inp())];

// ---------------- a fake PID stick ----------------
const ID = { A: { effect: 1, cond: 3, per: 4, op: 10, free: 11, ctl: 12, gain: 13, create: 1, load: 2 }, B: { effect: 1, cond: 2, op: 4, ctl: 5, gain: 6 } };
class FakeStick {
  constructor(desc, ids, opt = {}) {
    this.collections = parse(desc); this.ids = ids; this.opt = opt;
    this.vendorId = 0x0483; this.productId = 0xa1c0; this.productName = 'Test FFB Stick'; this.opened = false;
    this.fx = new Map(); this.next = 1; this.load = null; this.enabled = false; this.gain = null; this.ctl = []; this.n = 0;
  }
  async open() { this.opened = true; }
  async sendReport(rid, data) {
    this.n++; const I = this.ids;
    const { v, sel } = decodeT(this.collections, 'output', rid, data);
    if (rid === I.ctl) {
      const s = sel.length ? sel : Object.keys(v).filter((k) => v[k] === 1).map(Number);
      for (const c of s) { this.ctl.push(c); if (c === 0x9a) this.fx.clear(); if (c === 0x97) this.enabled = true; if (c === 0x99) for (const e of this.fx.values()) e.running = false; }
    } else if (rid === I.gain) this.gain = v[0x7e];
    else if (rid === I.effect) { const e = this.fx.get(v[0x22]) || {}; Object.assign(e, { type: sel[0], x: v[0x30], y: v[0x31], dirEnable: v[0x56], duration: v[0x50], gain: v[0x52], trigger: v[0x53], cond: e.cond || [] }); this.fx.set(v[0x22], e); }
    else if (rid === I.cond) { const e = this.fx.get(v[0x22]); e.cond[v[0x23]] = { cp: v[0x60], pc: v[0x61], nc: v[0x62], ps: v[0x63], ns: v[0x64] }; }
    else if (rid === I.per) { const e = this.fx.get(v[0x22]); e.per = { mag: v[0x70], period: v[0x72] }; }
    else if (rid === I.op) { const e = this.fx.get(v[0x22]); e.running = sel[0] === 0x79 || sel[0] === 0x7a; }
    else if (rid === I.free) this.fx.delete(v[0x22]);
  }
  async sendFeatureReport(rid, data) {
    this.n++;
    if (rid === this.ids.create) {
      const { sel } = decodeT(this.collections, 'feature', rid, data);
      if (this.opt.full) { this.load = { 0x22: 0, sel: [0x8d] }; return; }
      const idx = this.next++; this.fx.set(idx, { type: sel[0], cond: [], created: true }); this.load = { 0x22: idx, sel: [0x8c] };
    }
  }
  async receiveFeatureReport(rid) {
    const b = encodeT(this.collections, 'feature', rid, this.load || {}, this.load ? this.load.sel : []);
    const withId = this.opt.noIdByte ? b : Uint8Array.from([rid, ...b]);
    return new DataView(withId.buffer);
  }
}
const hidFor = (dev) => ({ requestDevice: async () => [dev], getDevices: async () => [dev], addEventListener() {} });
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const clock = () => { const c = { t: 100, now: () => c.t }; return c; };
const feelOf = (pc, pk, rc, rk, shake = { mag: 0, periodMs: 100 }) => ({ pitch: { centre: pc, k: pk, sat: 1 }, roll: { centre: rc, k: rk, sat: 1 }, damp: 0.1, shake });
async function step(ff, c, feel, dt = 1) { c.t += Math.max(dt, 0.05); ff.update(feel, dt); await ff.flush(); }
const spring = (dev) => [...dev.fx.values()].find((e) => e.type === 0x40);

// ---------------- layout ----------------
{
  const L = pidLayout(parse(DESC_A));
  expect(L.ok && L.effect.id === 1 && L.condition.id === 3 && L.periodic.id === 4 && L.operation.id === 10 && L.free.id === 11 && L.control.id === 12 && L.gain.id === 13
    && L.create.id === 1 && L.create.type === 'feature' && L.blockLoad.id === 2, 'layout A: every PID report found by its usages (output / feature ids overlap)');
  expect(L.effect.bytes === 17 && L.condition.bytes === 13 && L.types.has(U.etSpring) && L.types.has(U.etDamper) && L.types.has(U.etSine), 'layout A: report sizes from the descriptor (Set Effect 17 bytes, Set Condition 13), spring / damper / sine supported');
  const LB = pidLayout(parse(DESC_B));
  expect(LB.ok && !LB.create && !LB.periodic && LB.types.has(U.etSpring) && !LB.types.has(U.etDamper), 'layout B: compact stick usable (no pool reports, no periodic, no damper)');
  const LP = pidLayout(parse(PLAIN));
  expect(!LP.ok && LP.missing.includes('effect'), `plain joystick: no force feedback (${LP.missing.join(', ')} missing)`);
  const f = { lmin: -10000, lmax: 10000, exp: -3 }, u8 = { lmin: 0, lmax: 255, exp: 0 };
  expect(scale.signed(f, -0.5) === -5000 && scale.signed(u8, -0.5) === 127.5 && scale.ms(f, 70) === 70 && scale.ms({ lmin: 0, lmax: 32767, exp: -4 }, 70) === 700, 'scaling: signed ranges, magnitude into unsigned ranges, time units from the exponent');
}

// ---------------- descriptor A end to end ----------------
{
  const dev = new FakeStick(DESC_A, ID.A), c = clock(), ff = new ForceFeedback({ hid: hidFor(dev), store: mem(), now: c.now });
  expect(await ff.connect() && ff.ready && dev.opened, `connect: ${ff.status}`);
  expect(dev.ctl.join(',') === [0x9a, 0x99, 0x97].join(',') && dev.enabled && dev.gain === 128, 'init: reset, stop all, enable actuators, device gain 50 % (128 of 255)');
  await step(ff, c, feelOf(0.2, 0.44, 0, 0.38));
  const s = spring(dev);
  expect(s && s.created && s.running && s.x === 1 && s.y === 1 && s.dirEnable === 0 && s.duration === 65535 && s.gain === 255 && s.trigger === 0,
    'spring: device-allocated block, X+Y enabled, Cartesian, infinite, full effect gain, no trigger button, running');
  expect(s.cond[1].cp === 2000 && s.cond[1].pc === 4400 && s.cond[1].nc === 4400 && s.cond[1].ps === 10000 && s.cond[0].cp === 0 && s.cond[0].pc === 3800,
    `spring axes: Y (pitch) centre +0.2 -> ${s.cond[1].cp}, stiffness 0.44 -> ${s.cond[1].pc}; X (roll) stiffness 0.38 -> ${s.cond[0].pc}`);
  const d = [...dev.fx.values()].find((e) => e.type === 0x41);
  expect(d && d.running && d.cond[0].pc === 1000, 'damper: running, coefficient 0.1 -> 1000');
  const n0 = dev.n; await step(ff, c, feelOf(0.2, 0.44, 0, 0.38));
  expect(dev.n === n0, 'unchanged feel: nothing sent');
  await step(ff, c, feelOf(0.2, 0.44, 0, 0.38, { mag: 0.35, periodMs: 70 }));
  const p = [...dev.fx.values()].find((e) => e.type === 0x31);
  expect(p && p.running && p.per.mag === 3500 && p.per.period === 70 && p.dirEnable === 1, 'shaker: sine effect, magnitude 0.35 -> 3500, period 70 ms, polar direction, running');
  await step(ff, c, feelOf(0.2, 0.44, 0, 0.38));
  expect(!p.running && s.running, 'shaker off: sine stopped, spring keeps running');
  ff.setOpt('invY', true); await step(ff, c, feelOf(0.2, 0.44, 0, 0.38));
  expect(s.cond[1].cp === -2000, 'invert pitch: centre -0.2 on the device');
  ff.setOpt('invY', false); ff.setOpt('swap', true); await step(ff, c, feelOf(0.2, 0.44, 0, 0.38));
  expect(s.cond[0].cp === 2000 && s.cond[0].pc === 4400, 'swap axes: pitch on device X');
  ff.setOpt('swap', false); ff.setOpt('gain', 0.3); await ff.flush();
  expect(dev.gain === 77, 'strength 30 %: device gain 77');
  // slew: stiffness builds at a limited rate, softens at once
  await step(ff, c, feelOf(0, 0.1, 0, 0.1)); await step(ff, c, feelOf(0, 1, 0, 0.1), 0.1);
  expect(near(s.cond[1].pc, 2200, 30), `stiffness 0.1 -> 1 in 0.1 s: limited to ${(s.cond[1].pc / 10000).toFixed(2)}`);
  await step(ff, c, feelOf(0, 0.05, 0, 0.1), 0.05);
  expect(s.cond[1].pc === 500, 'softening is immediate');
  await step(ff, c, null);
  expect(s.cond[1].pc === IDLE_FEEL.pitch.k * 10000 && s.cond[1].ps === IDLE_FEEL.pitch.sat * 10000, 'idle (paused / menus): light centring spring');
  ff.test(); await step(ff, c, null, 0.5);
  expect(s.cond[1].cp > 0 && s.cond[0].cp === 0, 'test: stick pulled back first');
  c.t += 1; ff.update(null, 1); await ff.flush(); c.t += 2; ff.update(null, 0.1); await ff.flush();
  await ff.detach();
  expect(dev.ctl.at(-1) === 0x99 && dev.fx.size === 0 && !ff.ready, 'disconnect: stop all, blocks freed');
}
// feature reports without the report ID byte, memory full
{
  const dev = new FakeStick(DESC_A, ID.A, { noIdByte: true }), c = clock(), ff = new ForceFeedback({ hid: hidFor(dev), store: mem(), now: c.now });
  await ff.connect(); await step(ff, c, feelOf(0.1, 0.4, 0, 0.3));
  expect(spring(dev) && spring(dev).running, 'block load read without a leading report ID');
  const full = new FakeStick(DESC_A, ID.A, { full: true }), c2 = clock(), f2 = new ForceFeedback({ hid: hidFor(full), store: mem(), now: c2.now });
  await f2.connect(); await step(f2, c2, feelOf(0.1, 0.4, 0, 0.3));
  expect(!f2.ready && /memory full/.test(f2.status) && full.ctl.at(-1) === 0x99, `device memory full: force feedback turns off and stops (${f2.status})`);
}
// ---------------- descriptor B ----------------
{
  const dev = new FakeStick(DESC_B, ID.B), c = clock(), ff = new ForceFeedback({ hid: hidFor(dev), store: mem(), now: c.now });
  expect(await ff.connect(), `compact stick connects: ${ff.status}`);
  expect(dev.ctl.join(',') === [0x9a, 0x99, 0x97].join(','), 'bitmask device control: reset, stop all, enable as single bits');
  await step(ff, c, feelOf(0.5, 0.44, -0.25, 0.3, { mag: 0.35, periodMs: 70 }));
  const s = dev.fx.get(1);
  expect(s && s.type === 0x40 && s.running && dev.fx.size === 1, 'driver-managed pool: spring is block 1; no damper or periodic on this stick, no error');
  expect(s.cond[1].cp === 64 && s.cond[1].pc === 56 && s.cond[1].ps === 255 && s.cond[0].cp === -32, `8-bit fields: centre 0.5 -> ${s.cond[1].cp}, stiffness 0.44 -> ${s.cond[1].pc}, roll centre -0.25 -> ${s.cond[0].cp}`);
  expect(ff.ready, 'still running');
}
// ---------------- matching the WebHID device to the Gamepad API's ----------------
{
  const hid = { vendorId: 0x0483, productId: 0xa1c0, productName: 'Test FFB Stick' };
  expect(sameStick(hid, { id: 'Test FFB Stick (Vendor: 0483 Product: a1c0)' }) && sameStick(hid, { id: '483-a1c0-Test FFB Stick' }) && sameStick(hid, { id: 'Test FFB Stick' })
    && !sameStick(hid, { id: 'Other (Vendor: 0483 Product: a1c1)' }), 'gamepad twin: Chrome, Firefox and name-only ids');
  const ffbPad = { id: 'Test FFB Stick (Vendor: 0483 Product: a1c0)', index: 0, connected: true, mapping: '', axes: [0.3, 0.4], buttons: [] };
  const other = { id: 'Logitech Flight Yoke System (Vendor: 06a3 Product: 0bac)', index: 1, connected: true, mapping: '', axes: [0, -0.5], buttons: [] };
  const hw = new Hardware(() => [ffbPad, other], mem()); hw.isFfb = (gp) => sameStick(hid, gp);
  const o = hw.poll();
  expect(o.posElev === 0.4 && o.posAil === 0.3 && o.elev === -0.5 && o.ail === 0, 'force-feedback stick: its pitch / roll arrive as position (no dead-zone step), other devices as force');
}

// ---------------- js/controls.js: position mode and feel ----------------
{
  const KTS = 0.514444, qOf = (keas) => 0.5 * 1.225 * (keas * KTS) ** 2;
  const pc = new PilotControls();
  let s = pc.step(1 / 60, { elev: 0, ail: 0, rud: 0, posElev: 0.5, posAil: -0.2 }, { qbar: qOf(250), M: 0.4 }, null);
  expect(near(s.elev, 0.5, 1e-9) && near(s.ail, -0.2, 1e-9) && near(pc.pitchLb, 0.5 * FORCE.elevFull250, 0.5), `position mode, 250 KEAS: stick 0.5 = elevator 0.5, the pilot holds ${pc.pitchLb.toFixed(0)} lb`);
  const f = pc.feel();
  expect(near(f.pitch.k, FORCE.elevFull250 / FEEL.pitchLb, 1e-6) && f.pitch.centre === 0 && f.pitch.sat === 1 && near(f.roll.k, FORCE.ailFull250 / FEEL.rollLb, 1e-6),
    `feel, 250 KEAS: pitch stiffness ${f.pitch.k.toFixed(2)} (66 of 150 lb), roll ${f.roll.k.toFixed(2)}, centred (stabilizer trim)`);
  const hi = new PilotControls(); s = hi.step(1 / 60, { elev: 0, ail: 0, rud: 0, posElev: 1, posAil: null }, { qbar: qOf(380), M: 0.88 }, null);
  expect(s.elev < 0.8 && near(s.elev, hi.avail('pitch') / hi.need.pitch, 0.01) && hi.feel().pitch.k === 1, `380 KEAS, M 0.88: full stick only gets ${s.elev.toFixed(2)} elevator (pilot strength), spring at its stiffest`);
  const ts = new PilotControls(); ts.step(1 / 60, { elev: 0, ail: 0, rud: 0, posElev: 0, posAil: 0 }, { qbar: qOf(250), M: 0.4, tailStalled: true }, null);
  expect(near(ts.feel().pitch.k, 0.45 * FORCE.elevFull250 / FEEL.pitchLb, 1e-6) && ts.feel().shake.mag > 0 && ts.feel().shake.periodMs === 700, 'stalled iced tail: column goes light and pulses');
  const ap = new PilotControls(), apc = { on: true, elev: 0.12, ail: -0.05 };
  s = ap.step(1 / 60, { elev: 0, ail: 0, rud: 0, posElev: 0.12, posAil: -0.05 }, { qbar: qOf(300), M: 0.7 }, apc);
  const fa = ap.feel();
  expect(s.elev === 0.12 && !ap.slipping && fa.pitch.centre === 0.12 && near(fa.pitch.sat, FORCE.apClutch.pitch / FEEL.pitchLb, 1e-6), 'autopilot: the servo holds the stick at its command, saturation = clutch force');
  s = ap.step(1 / 60, { elev: 0, ail: 0, rud: 0, posElev: 0.9, posAil: -0.05 }, { qbar: qOf(300), M: 0.7 }, apc);
  expect(ap.slipping && s.elev > 0.12, `stick pulled 0.78 past the autopilot: clutch slips (${ap.pitchLb.toFixed(0)} lb), elevator ${s.elev.toFixed(2)}`);
  expect(new PilotControls().feel({ shaker: true }).shake.periodMs === 70 && new PilotControls().feel({ buffet: true }).shake.mag < 0.3 && new PilotControls().feel({ broken: true, shaker: true }).shake.mag === 0.8, 'shake: shaker, lighter buffet, breakup strongest');
  const fm = new PilotControls(); s = fm.step(1 / 60, { elev: 0.5, ail: 0, rud: 0 }, { qbar: qOf(250), M: 0.4 }, null);
  expect(near(s.elev, fm.forceFor(0.5, 'pitch') / fm.need.pitch, 1e-9), 'no force-feedback stick: input is force, as before');
}

console.log(fail ? `\n${fail} FAILED` : '\nall force feedback tests passed');
process.exit(fail ? 1 : 0);
