// Flight hardware input (js/hardware.js) with simulated devices: hat decoding, calibration, binding by moving or
// pressing a control, several devices at once, absolute throttle pickup, defaults, persistence.
import { Hardware, Capture, hatDir, hatHas, normCentred, normLever, sameInput, deviceKind } from '../js/hardware.js';

let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
const near = (a, b, e = 0.02) => Math.abs(a - b) <= e;
const pad = (id, index, nAx, nBtn, mapping = '') => ({ id, index, connected: true, mapping, axes: new Array(nAx).fill(0), buttons: Array.from({ length: nBtn }, () => ({ pressed: false, value: 0 })) });
const HAT_REST = 9 / 7;
const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
// run a capture while a script moves the controls; returns the binding
const drive = (hw, fn, steps) => { hw.startCapture(fn); let r = null; for (const f of steps) { f(); r = hw.stepCapture(1 / 30) || r; if (r) break; } return r || hw.finishCapture(); };
const sweep = (arr, i, pts, n = 8) => { const s = []; let prev = arr[i]; for (const p of pts) { const a = prev; for (let k = 1; k <= n; k++) s.push(() => { arr[i] = a + (p - a) * k / n; }); prev = p; } for (let k = 0; k < 10; k++) s.push(() => {}); return s; };

// ---- hat decoding ----
{
  const vals = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => -1 + k * 2 / 7);
  expect(vals.every((v, k) => hatDir(v) === k) && hatDir(HAT_REST) === -1, 'hat: 8 directions decode from one axis, neutral reads -1');
  expect(hatHas(1, 0) && hatHas(7, 0) && !hatHas(2, 0) && !hatHas(-1, 0), 'hat: up counts on up-left and up-right diagonals');
}
// ---- normalisation ----
{
  const b = { center: 0.1, pos: 0.9, neg: -0.5 };
  expect(near(normCentred(0.9, b), 1) && near(normCentred(-0.5, b), -1) && normCentred(0.11, b) === 0 && near(normCentred(0.5, b), 0.48, 0.03), 'centred axis: asymmetric travel maps both ends to +/-1, dead zone at centre');
  expect(near(normCentred(-1, { center: 0, pos: -1, neg: 1 }), 1), 'centred axis: reversed hardware reads positive when moved the bound way');
  expect(normLever(1, { lo: 1, hi: -1 }) === 0 && normLever(-1, { lo: 1, hi: -1 }) === 1 && near(normLever(0, { lo: -1, hi: 1 }), 0.5), 'lever: either direction, 0..1');
}
// ---- device kinds ----
expect(deviceKind(pad('Logitech Flight Yoke System (Vendor: 06a3 Product: 0bac)', 0, 7, 20)) === 'stick'
  && deviceKind(pad('Thrustmaster T.Flight Rudder Pedals (Vendor: 044f Product: b679)', 1, 3, 0)) === 'pedals'
  && deviceKind(pad('Saitek Pro Flight Throttle Quadrant', 2, 3, 9)) === 'throttle'
  && deviceKind(pad('DualSense Wireless Controller', 3, 4, 17, 'standard')) === 'gamepad', 'device kinds from the browser id: yoke, pedals, quadrant, gamepad');

// ---- a full setup: yoke + pedals + throttle quadrant, bound by moving them ----
const yoke = pad('Logitech Flight Yoke System (Vendor: 06a3 Product: 0bac)', 0, 7, 20);
const peds = pad('Thrustmaster T.Flight Rudder Pedals (Vendor: 044f Product: b679)', 1, 3, 0);
const quad = pad('Saitek Pro Flight Throttle Quadrant (Vendor: 06a3 Product: 0c2d)', 2, 3, 9);
yoke.axes[6] = HAT_REST; peds.axes[0] = -1; peds.axes[1] = -1; quad.axes = [1, 1, 1];   // toe brakes released at -1; levers at idle = +1
let pads = [yoke, peds, quad];
const st = store();
const hw = new Hardware(() => pads, st);
{
  // unbound: the yoke flies on X/Y; the pedals' toe brakes (axes 0/1) must not roll or pitch the airplane
  yoke.axes[1] = 0.6; peds.axes[0] = 1; peds.axes[1] = 1;
  const o = hw.poll();
  expect(near(o.elev, 0.6) && o.ail === 0 && o.rud === 0 && o.thrSet === null, `unbound: yoke Y pulls (elev ${o.elev.toFixed(2)}), pedals' toe brakes do nothing, quadrant does nothing`);
  yoke.axes[1] = 0; peds.axes[0] = -1; peds.axes[1] = -1;
}
{
  // this yoke reports pull as NEGATIVE Y: binding by pulling makes that the positive (pull) direction
  const b = drive(hw, 'pitch', sweep(yoke.axes, 1, [-1, 1, 0]));
  expect(b && b.kind === 'axis' && b.axis === 1 && near(b.pos, -1) && near(b.neg, 1), `pitch bound by pulling: axis ${b && b.axis}, pull = ${b && b.pos.toFixed(2)}`);
  yoke.axes[1] = -1; expect(near(hw.poll().elev, 1), 'pitch: full pull reads +1 (pull) on a reversed yoke');
  yoke.axes[1] = 0.5; expect(near(hw.poll().elev, -0.48, 0.03), 'pitch: half push reads about -0.5, no ramp');
  yoke.axes[1] = 0;
}
{
  const b = drive(hw, 'rudder', sweep(peds.axes, 2, [1, -1, 0]));
  peds.axes[2] = 1; const o = hw.poll(); peds.axes[2] = 0;
  expect(b && b.id === peds.id && b.axis === 2 && near(o.rud, 1), `rudder bound on the pedals' axis 2, right pedal reads ${o.rud.toFixed(2)}`);
}
{
  // throttle quadrant lever 0: idle = +1, full = -1
  const b = drive(hw, 'throttle', sweep(quad.axes, 0, [-1, 1]));
  expect(b && b.kind === 'lever' && b.axis === 0 && near(b.lo, 1) && near(b.hi, -1), `throttle bound on quadrant axis ${b && b.axis}, idle ${b && b.lo.toFixed(2)} full ${b && b.hi.toFixed(2)}`);
  let o = hw.poll();
  expect(o.thrSet === null, 'throttle pickup: an unmoved lever does not grab the thrust levers');
  quad.axes[0] = 0; o = hw.poll();
  expect(near(o.thrSet, 0.5), `throttle: lever moved to mid sets thrust ${o.thrSet && o.thrSet.toFixed(2)} directly`);
  o = hw.poll(); expect(o.thrSet === null, 'throttle: no new value while the lever rests');
}
{
  // trim on the yoke hat, AP disconnect on a yoke button
  const b = drive(hw, 'trim_up', [() => {}, () => { yoke.axes[6] = -1; }]);
  yoke.axes[6] = HAT_REST;
  expect(b && b.kind === 'hat' && b.axis === 6 && b.dir === 0, 'trim nose-up bound to hat up (axis 6)');
  drive(hw, 'trim_dn', [() => {}, () => { yoke.axes[6] = -1 + 4 * 2 / 7; }]); yoke.axes[6] = HAT_REST;
  yoke.axes[6] = -1 + 2 / 7; let o = hw.poll();                 // up-right diagonal still trims nose-up
  expect(o.trim === 1, 'hat up-right trims nose-up');
  yoke.axes[6] = -1 + 4 * 2 / 7; o = hw.poll(); yoke.axes[6] = HAT_REST;
  expect(o.trim === -1, 'hat down trims nose-down');
  const a = drive(hw, 'ap_toggle', [() => {}, () => { yoke.buttons[4].pressed = true; }]);
  yoke.buttons[4].pressed = false;
  hw.poll(); yoke.buttons[4].pressed = true; const e1 = hw.poll().events; const e2 = hw.poll().events; yoke.buttons[4].pressed = false;
  expect(a && a.kind === 'button' && a.button === 4 && e1.includes('ap_toggle') && !e2.includes('ap_toggle'), 'AP disconnect on yoke button 4: one event per press');
}
{
  // Firefox-style hat: two axes snapping to +/-1
  const fx = pad('Thrustmaster T.16000M', 3, 6, 16); pads = [...pads, fx];
  const b = drive(hw, 'gear', [() => {}, () => { fx.axes[5] = -1; }]); fx.axes[5] = 0;
  expect(b && b.kind === 'axisbtn' && b.axis === 5 && b.sign === -1, 'a hat reported as an axis snapping to -1 binds as a button');
  pads = pads.filter((g) => g !== fx);
}
{
  // persistence: a fresh session finds the bindings by device name, even in a different slot
  const y2 = { ...yoke, index: 5, axes: [...yoke.axes] }, hw2 = new Hardware(() => [y2, peds, quad], st);
  y2.axes[1] = -1; const o = hw2.poll();
  expect(near(o.elev, 1) && hw2.describe('rudder').includes('Rudder Pedal'), 'bindings reload per device name in another USB slot');
}
{
  // one input, one job: binding the yoke's Y axis to rudder frees it from pitch
  const t = new Hardware(() => pads, store());
  t.set('pitch', { kind: 'axis', id: yoke.id, axis: 1, center: 0, pos: 1, neg: -1 });
  t.set('rudder', { kind: 'axis', id: yoke.id, axis: 1, center: 0, pos: 1, neg: -1 });
  expect(!t.bind.pitch && t.bind.rudder && sameInput(t.bind.rudder, { kind: 'lever', id: yoke.id, axis: 1 }), 'rebinding an axis to another function clears the old one');
}
{
  // a standard gamepad keeps its defaults alongside flight gear
  const gp = pad('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 4, 4, 17, 'standard');
  const h = new Hardware(() => [gp, peds], store());
  gp.buttons[7].value = 1; gp.axes[0] = 0.5; gp.buttons[0].pressed = true;
  const o = h.poll(); gp.buttons[0].pressed = false;
  expect(o.thrRate === 1 && near(o.ail, 0.5) && o.events.includes('ap_toggle'), 'standard gamepad defaults: R2 thrust, left stick roll, cross = AP');
}
{
  const y = pad('Logitech Flight Yoke System (Vendor: 06a3 Product: 0bac)', 0, 7, 20), q = pad('Saitek Pro Flight Throttle Quadrant', 1, 3, 9);
  const h = new Hardware(() => [y, q], store());
  expect((h.defaultFor('roll') || '').includes('Flight Yoke') && h.defaultFor('rudder') === null && h.defaultFor('throttle') === null, 'panel shows the yoke as the default for roll; pedals and throttle have no default');
}
console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
