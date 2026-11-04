// Ground model (js/ground.js) and free-flight setup (js/freeflight.js): struts at rest, takeoff and rotation, tail strike,
// braking, nosewheel steering, touchdown limits (Part 25: 10 ft/s limit, 12 ft/s reserve), gear-up landing, ground
// effect, and the trim solver used for airborne starts.
import { Learjet60, ELEV_K } from '../js/aircraft.js';
import { setupStart, setWeight, FreeEnv, trimFlight, tasFor, placeOnRunway, frameFor } from '../js/freeflight.js';
import { groundAlt, groundEffect, surfaceAt, runwayById, runwayFrame } from '../js/ground.js';
import { DEG } from '../js/util.js';
import { FT, KT } from '../js/atmo.js';

let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
const DT = 1 / 240, still = { wind: [0, 0, 0], dT: 0 };   // free flight 'calm' is ISA
const onRunway = (w = 'typical') => { const ac = new Learjet60(); setWeight(ac, w); setupStart(ac, { apt: 'KDJT', start: 'rwy', rwy: '10L' }, new FreeEnv('calm')); return ac; };
const run = (ac, secs, each) => { const evs = []; for (let t = 0; t < secs; t += DT) { if (each && each(ac.out, t) === false) break; ac.step(DT, still); evs.push(...ac.gnd.drain()); if (ac.crashed) break; } return evs; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---- runway data ----
{
  const f = runwayFrame(runwayById('KDJT', '10L'));
  expect(Math.abs(f.L - 3048) < 2 && Math.abs(f.hdg / DEG - 92.8) < 0.2 && surfaceAt(f.thr[0] + f.u[0] * 1000, f.thr[1] + f.u[1] * 1000) === 'paved' && surfaceAt(f.thr[0] + 200, f.thr[1] + 1000) === 'grass',
    `KDJT 10L/28R from the FAA CIFP: ${f.L.toFixed(0)} m of pavement (1,200 ft displaced threshold), 10L heading ${(f.hdg / DEG).toFixed(1)}° true, paved on the centreline, grass 200 m off it`);
}
// ---- at rest ----
{
  const ac = onRunway(), L = ac.gnd.legs, tot = L.reduce((a, l) => a + l.load, 0);
  const share = L[0].load / tot;
  expect(share > 0.05 && share < 0.11 && L.every((l) => l.comp > 0.25 * l.stroke && l.comp < 0.45 * l.stroke) && Math.abs(ac.out.theta) < 1.5 * DEG && ac.out.wow,
    `at rest: nose wheel carries ${(share * 100).toFixed(1)} %, struts at ${L.map((l) => (l.comp / l.stroke * 100).toFixed(0)).join('/')} % of stroke, pitch ${(ac.out.theta / DEG).toFixed(1)}°, weight on wheels`);
  const p0 = ac.pos.slice(); run(ac, 10);
  expect(dist(ac.pos, p0) < 0.1, `parking brake at idle thrust: moved ${(dist(ac.pos, p0) * 100).toFixed(1)} cm in 10 s`);
  ac.ctl.thr = 1; const p1 = ac.pos.slice(); run(ac, 6);
  expect(dist(ac.pos, p1) < 0.5, `parking brake at full thrust: moved ${(dist(ac.pos, p1) * 100).toFixed(0)} cm in 6 s (static friction holds)`);
}
// ---- takeoff: flaps 8, rotate at VR 130 KIAS to 12° ----
function takeoff(w, vr, pitchTgt, pullFrom = null) {
  const ac = onRunway(w); const p0 = ac.pos.slice(); ac.ctl.park = false; ac.ctl.thr = 1;
  let rot = null, lof = null, h35 = null, maxPitchGround = 0;
  const evs = run(ac, 70, (o, t) => {
    if (pullFrom !== null ? o.KIAS >= pullFrom : o.KIAS >= vr) { rot = rot || { kias: o.KIAS, ft: dist(ac.pos, p0) / FT }; ac.ctl.elev = pullFrom !== null ? 1 : Math.max(-1, Math.min(1, 3 * (pitchTgt * DEG - o.theta) - 1.2 * o.q + 0.15)); }
    if (o.wow) maxPitchGround = Math.max(maxPitchGround, o.theta / DEG);
    if (rot && !o.wow && !lof) lof = { kias: o.KIAS, ft: dist(ac.pos, p0) / FT };
    if (lof && o.agl - 1.5 > 35 * FT) { h35 = { kias: o.KIAS, ft: dist(ac.pos, p0) / FT }; return false; }
  });
  return { ac, rot, lof, h35, evs, maxPitchGround };
}
{
  const r = takeoff('typical', 130, 12);
  expect(r.lof && r.lof.kias > 132 && r.lof.kias < 152 && r.h35 && r.h35.ft > 3000 && r.h35.ft < 6000 && !r.evs.some((e) => /TAIL/.test(e.txt || '')),
    `takeoff 20,700 lb, flaps 8, sea level: VR ${r.rot.kias.toFixed(0)} at ${r.rot.ft.toFixed(0)} ft, liftoff ${r.lof?.kias.toFixed(0)} KIAS at ${r.lof?.ft.toFixed(0)} ft, 35 ft at ${r.h35?.ft.toFixed(0)} ft (${r.h35?.kias.toFixed(0)} KIAS), no tail strike`);
  const h = takeoff('mtow', 138, 12), l = takeoff('light', 120, 12);
  expect(h.h35 && l.h35 && h.h35.ft > r.h35.ft && l.h35.ft < r.h35.ft, `weight: 35 ft at ${l.h35?.ft.toFixed(0)} / ${r.h35?.ft.toFixed(0)} / ${h.h35?.ft.toFixed(0)} ft for 17,000 / 20,700 / 23,500 lb`);
  const o = takeoff('typical', 0, 0, 100);
  expect(o.evs.some((e) => e.txt === 'TAIL STRIKE'), `full aft stick from 100 KIAS: tail strike (pitch ${o.maxPitchGround.toFixed(1)}° on the wheels)`);
}
// ---- braking from 100 KIAS ----
{
  const ac = onRunway(); ac.ctl.park = false; ac.ctl.thr = 1;
  run(ac, 60, (o) => o.KIAS < 100);
  ac.ctl.thr = 0; ac.ctl.brakeL = ac.ctl.brakeR = 1; ac.ctl.flaps = 0.2; const p0 = ac.pos.slice(); let t = 0;
  run(ac, 60, (o, tt) => { t = tt; return Math.hypot(ac.vel[0], ac.vel[1]) > 0.3; });
  const d = dist(ac.pos, p0);
  expect(d > 250 && d < 650, `full brakes (anti-skid) from 100 KIAS at idle: stopped in ${d.toFixed(0)} m (${(d / FT).toFixed(0)} ft), ${t.toFixed(1)} s, ${((100 * KT) ** 2 / 2 / d / 9.81).toFixed(2)} g average`);
}
// ---- nosewheel steering at taxi speed ----
{
  const ac = onRunway(); ac.ctl.park = false; ac.ctl.thr = 0.12;
  run(ac, 40, (o) => o.gs < 10 * KT);
  ac.ctl.rud = 1; const pts = [];
  run(ac, 25, (o, t) => { ac.ctl.thr = o.gs > 10 * KT ? 0 : 0.12; if (t > 8) pts.push([ac.pos[0], ac.pos[1]]); });
  // radius from three points on the arc
  const [a, b, c] = [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]];
  const A = dist(b, c), B = dist(a, c), C = dist(a, b), s = (A + B + C) / 2, area = Math.sqrt(Math.max(1e-9, s * (s - A) * (s - B) * (s - C)));
  const R = A * B * C / (4 * area);
  expect(R > 6 && R < 30 && ac.out.psi !== undefined, `full right pedal at ~10 kt: turns on a ${R.toFixed(1)} m radius (nosewheel ${(ac.gnd.steer / DEG).toFixed(0)}°)`);
}
// ---- touchdown ----
function landing(fps, gear = 1) {
  const ac = new Learjet60(); setWeight(ac, 'typical');
  const f = frameFor('KDJT', '10L'), V = tasFor(125, 10), gamma = -Math.asin(fps * FT / V);
  Object.assign(ac.ctl, { gear, flaps: 1, sb: 0, park: false, brakeL: 0, brakeR: 0 });
  const n = f.thr[0] + f.u[0] * 400, e = f.thr[1] + f.u[1] * 400;
  // trimmed descent with the wheels 0.5 m up (inside ground effect, so the trim includes it), attitude held to touchdown
  trimFlight(ac, { n, e, h: groundAlt(n, e) + 1.67 + 0.5, V, gamma, psi: f.hdg });
  let down = false, th = null;
  const evs = run(ac, 40, (o) => {
    th = th ?? o.theta; down = down || o.wow;
    ac.ctl.elev = down ? 0 : Math.max(-1, Math.min(1, (3 * (th - o.theta) - 1.0 * o.q) / ELEV_K));
    return !(o.wow && o.gs < 15);
  });
  return { ac, evs, msgs: evs.filter((e) => e.type === 'msg' || e.type === 'crash').map((e) => e.txt) };
}
{
  const a = landing(6);
  expect(!a.ac.crashed && a.msgs.length === 0 && a.ac.gnd.touchFpm > 250 && a.ac.gnd.touchFpm < 500 && a.ac.wow, `normal touchdown: ${a.ac.gnd.touchFpm.toFixed(0)} ft/min, no warning, rolling out on the wheels`);
  const b = landing(11);
  expect(!b.ac.crashed && b.msgs.some((m) => /HARD LANDING/.test(m)), `11 ft/s: ${b.msgs.join('; ')}`);
  const c = landing(14);
  expect(!c.ac.crashed && c.msgs.some((m) => /gear damaged/.test(m)) && c.ac.gnd.gearDamage > 0, `14 ft/s: ${c.msgs.join('; ')}`);
  const d = landing(20);
  expect(d.ac.crashed && /GEAR COLLAPSE/.test(d.ac.crashWhy), `20 ft/s: ${d.ac.crashWhy}`);
  const g = landing(4, 0);
  expect(g.ac.crashed && g.ac.crashWhy === 'GEAR-UP LANDING', `gear up: ${g.ac.crashWhy}`);
}
// ---- ground effect, trim solver, and impact without the gear ----
{
  const near = groundEffect(0.1 * 13.34, 13.34), far = groundEffect(20, 13.34);
  expect(near.kInd < 0.8 && near.lift > 1.08 && near.cm < 0 && far.kInd > 0.99 && far.lift === 1, `ground effect at h/b 0.1: induced drag x${near.kInd.toFixed(2)}, lift x${near.lift.toFixed(2)}, nose-down ${near.cm.toFixed(3)}; none above a span`);
  const ac = new Learjet60(); setWeight(ac, 'typical'); const env = new FreeEnv('calm');
  setupStart(ac, { apt: 'KDJT', start: 'final', app: 'I10L' }, env); const h0 = ac.out.h ?? -ac.pos[2];
  let o; for (let t = 0; t < 20; t += DT) o = ac.step(DT, still);
  const fpm = o.vs / FT * 60;
  expect(Math.abs(fpm + 800) < 120 && Math.abs(o.KIAS - 150) < 4 && Math.abs(o.phi) < 2 * DEG, `6 nm final start holds itself: ${fpm.toFixed(0)} ft/min (3° at 150 kt ≈ -800), ${o.KIAS.toFixed(0)} KIAS after 20 s hands-off`);
  const cr = new Learjet60(); setupStart(cr, { apt: 'KDJT', start: 'cruise', rwy: '10L' }, env); let oc; for (let t = 0; t < 20; t += DT) oc = cr.step(DT, still);
  expect(Math.abs(oc.vs / FT * 60) < 150 && Math.abs(oc.M - 0.77) < 0.01, `cruise start trimmed: ${(oc.vs / FT * 60).toFixed(0)} ft/min, M ${oc.M.toFixed(3)} after 20 s`);
  const dive = new Learjet60(); dive.setState({ n: 0, e: -20000, d: -300, psi: 0, theta: -20 * DEG, phi: 0, V: 150 }); dive.vel = [150 * Math.cos(20 * DEG), 0, 150 * Math.sin(20 * DEG)];
  for (let t = 0; t < 10 && !dive.crashed; t += DT) dive.step(DT, still);
  expect(dive.crashed && /IMPACT/.test(dive.crashWhy), `dive into the ground with the gear up: ${dive.crashWhy}`);
}

console.log(fail ? `\n${fail} FAILED` : '\nall ground tests passed');
process.exit(fail ? 1 : 0);
