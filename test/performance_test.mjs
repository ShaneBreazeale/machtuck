// Takeoff and landing performance against the Learjet 60 AFM (FM-123 Section V), flown the way the AFM says it was
// measured (pages 5-1 / 5-2):
//   accelerate-go     T/O thrust set static, brakes released; engine failure recognised at V1; rotate at VR to +9°;
//                     gear up with a positive climb; distance to 35 ft (V2 by then).
//   accelerate-stop   failure just before V1; maximum braking from V1, both levers idle, spoilers (auto) deployed.
//   all engines       rotate at VR to +9°, gear up; 115 % of the distance to 35 ft.
//   field length      the largest of the three (Fig 5-38).
//   landing           VREF on a 3° glideslope, thrust reduced at 50 ft, idle at 25 ft, firm touchdown with little or no
//                     flare, maximum braking and spoilers; distance from 50 ft to a stop (Fig 5-74).
// The pilot is a set of simple loops: rudder and nosewheel hold the centreline, ailerons hold the wings level.
import { readFileSync } from 'node:fs';
import { Learjet60, ELEV_K } from '../js/aircraft.js';
import { placeOnRunway, trimFlight, tasFor, rwyByStart } from '../js/freeflight.js';
import { groundAlt } from '../js/ground.js';
import { takeoffSpeeds, vref } from '../js/afm.js';
import { DEG, clamp } from '../js/util.js';
import { FT, KT } from '../js/atmo.js';

const T = JSON.parse(readFileSync(new URL('./afm_tables.json', import.meta.url)));
let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
const DT = 1 / 240, LB = 0.45359237;
const dTof = (altFt, F) => (F - 32) / 1.8 + 273.15 - (288.15 - 0.0019812 * altFt);   // OAT -> ISA deviation

function setup(lb, altFt, dT) {
  const ac = new Learjet60(); ac.m = lb * LB; ac.fuel = Math.min(3588, ac.m - 6700); ac.gnd.elev = altFt * FT;
  const f = rwyByStart('rwy10L');
  placeOnRunway(ac, f, 0, { wind: [0, 0, 0], dT });
  return { ac, f, env: { wind: [0, 0, 0], dT } };
}
const along = (ac, f) => (ac.pos[0] - f.thr[0]) * f.u[0] + (ac.pos[1] - f.thr[1]) * f.u[1];
const cross = (ac, f) => -(ac.pos[0] - f.thr[0]) * f.u[1] + (ac.pos[1] - f.thr[1]) * f.u[0];
const wheelFt = (o) => (o.agl - 1.6) / FT;
// centreline and wings: rudder (nosewheel on the ground) from heading and lateral offset, ailerons from bank
function lateral(ac, f, o) {
  let he = o.psi - f.hdg; he = Math.atan2(Math.sin(he), Math.cos(he));
  const y = cross(ac, f), vy = Math.sin(o.track - f.hdg) * o.gs;
  ac.ctl.rud = clamp(-2.5 * he - 1.2 * o.r - (o.wow ? 0.04 * y + 0.08 * vy : 0), -1, 1);
  ac.ctl.ail = clamp(-2.0 * o.phi - 0.4 * o.p - (o.wow ? 0 : 1.0 * he), -1, 1);
}
// pitch-attitude loop (rotation to +9° at about 3°/s, then hold it): proportional + integral, like a pilot pulling
// harder until the nose comes up
function pitchTo(ac, o, tgt, dt = DT) {
  const e = tgt - o.theta; ac.pI = clamp((ac.pI || 0) + e * dt * 6, -0.6, 0.6);
  ac.ctl.elev = clamp((10 * e - 2.5 * o.q) / ELEV_K + ac.pI, -1, 1);
}

function takeoff(lb, altFt, dT, mode) {
  const { ac, f, env } = setup(lb, altFt, dT); const V = takeoffSpeeds(lb, altFt);
  ac.ctl.thr = 1; ac.n1 = 1; for (let i = 0; i < 240; i++) ac.step(DT, env);   // T/O thrust set static, on the brakes
  ac.ctl.park = false; const s0 = along(ac, f);
  let o = ac.out, t = 0, rot = null, tgt = 0, stopAt = null, v35 = null, failed = false;
  for (; t < 120; t += DT) {
    if (!failed && mode !== 'all' && o.KIAS >= V.v1) {
      failed = true;
      if (mode === 'go') ac.engFail = 'L';
      else { ac.engFail = 'L'; stopAt = t; }
    }
    if (stopAt !== null) {   // reject: brakes at V1, levers idle, autospoilers
      ac.ctl.brakeL = ac.ctl.brakeR = 1; ac.ctl.thr = 0; ac.n1 = Math.min(ac.n1, ac.n1);
      if (t > stopAt + 0.5) ac.ctl.sb = 1;
      ac.ctl.elev = 0;
      if (o.gs < 0.5) return { ft: (along(ac, f) - s0) / FT };
    } else {
      if (o.KIAS >= V.vr && rot === null) rot = t;
      if (rot !== null) { tgt = Math.min(9 * DEG, (t - rot) * 3 * DEG); pitchTo(ac, o, tgt); }
      if (!o.wow && o.vs > 1) ac.ctl.gear = 0;
      if (wheelFt(o) >= 35 && rot !== null) return { ft: (along(ac, f) - s0) / FT, kias: o.KIAS, v2: V.v2 };
    }
    lateral(ac, f, o);
    o = ac.step(DT, env);
    if (ac.crashed) return { ft: NaN, why: ac.crashWhy };
  }
  return { ft: NaN, why: 'timeout' };
}

function landing(lb, altFt, dT) {
  const ac = new Learjet60(); ac.m = lb * LB; ac.fuel = Math.min(3588, ac.m - 6700); ac.gnd.elev = altFt * FT;
  const f = rwyByStart('rwy10L'), env = { wind: [0, 0, 0], dT };
  Object.assign(ac.ctl, { gear: 1, flaps: 1, sb: 0, park: false, brakeL: 0, brakeR: 0 });
  // start 200 ft up on the 3° path so the approach is settled by 50 ft
  const h50 = 50 * FT + 1.6, start = 200 * FT, d0 = (start - 50 * FT) / Math.tan(3 * DEG);
  const n = f.thr[0] + f.u[0] * (300 - d0), e = f.thr[1] + f.u[1] * (300 - d0), kias = vref(lb);
  trimFlight(ac, { n, e, h: groundAlt(n, e) + ac.gnd.elev + start + 1.6, V: tasFor(kias, altFt * FT, dT), gamma: -3 * DEG, psi: f.hdg, dT });
  const th0 = ac.out.theta ?? 0; let o = ac.out, s50 = null, down = false, thr0 = ac.ctl.thr, touchFpm = null, kiasTd = null;
  let thHold = null, tTd = 0, sTd = 0;
  for (let t = 0; t < 120; t += DT) {
    const hw = wheelFt(o);
    if (s50 === null && hw <= 50) s50 = along(ac, f);
    if (!down) {
      // on the glideslope until 25 ft: hold the trimmed attitude; thrust trimmed back at 50 ft, idle at 25 ft
      if (thHold === null) thHold = o.theta;
      pitchTo(ac, o, thHold);
      ac.ctl.thr = hw > 50 ? thr0 : hw > 25 ? thr0 * 0.8 : 0;
    }
    if (o.wow && !down) { down = true; tTd = t; touchFpm = -o.vs / FT * 60; kiasTd = o.KIAS; sTd = along(ac, f); }
    if (down) { ac.ctl.thr = 0; ac.ctl.brakeL = ac.ctl.brakeR = 1; ac.ctl.elev = 0; if (t > tTd + 1) ac.ctl.sb = 1; }   // spoilers by hand, ~1 s
    lateral(ac, f, o);
    o = ac.step(DT, env);
    if (process.env.LDBG && down && Math.round((t - tTd) * 240) % 240 === 0) { const L = ac.gnd.legs; console.log(`  +${(t - tTd).toFixed(0)}s gs ${(o.gs / KT).toFixed(0)} kt th ${(o.theta / DEG).toFixed(1)} a ${(o.alpha / DEG).toFixed(1)} CL ${o.CL.toFixed(2)} CD ${o.CD.toFixed(3)} N nose ${(L[0].load / 1e3).toFixed(1)} mains ${((L[1].load + L[2].load) / 1e3).toFixed(1)} kN W ${(ac.m * 9.81 / 1e3).toFixed(1)} thrust ${(o.thrust / 1e3).toFixed(1)} sb ${ac.ctl.sb}`); }
    if (ac.crashed) return { ft: NaN, why: ac.crashWhy };
    if (down && o.gs < 0.5) return { ft: (along(ac, f) - s50) / FT, touchFpm, kiasTd, air: (sTd - s50) / FT, roll: (along(ac, f) - sTd) / FT };
  }
  return { ft: NaN, why: 'timeout' };
}

export { landing, takeoff };
const pct = (a, b) => (a / b - 1) * 100;
if (!process.env.NOMAIN) {
const TOL = 8;   // percent
console.log('TAKEOFF FIELD LENGTH, flaps 8 (AFM Fig 5-38) — model: go / stop / 1.15 x all-engine');
const tf = T.takeoff_field_length_f8, errs = [];
for (const row of tf.rows) {
  const dT = dTof(row.alt_ft, row.oat_F);
  tf.weights_lb.forEach((lb, i) => {
    const go = takeoff(lb, row.alt_ft, dT, 'go'), stop = takeoff(lb, row.alt_ft, dT, 'stop'), all = takeoff(lb, row.alt_ft, dT, 'all');
    const tofl = Math.max(go.ft, stop.ft, 1.15 * all.ft), afm = row.ft[i], e = pct(tofl, afm); errs.push(e);
    const lim = ['go', 'stop', 'all'][[go.ft, stop.ft, 1.15 * all.ft].indexOf(tofl)];
    expect(Math.abs(e) <= TOL, `${String(row.alt_ft).padStart(4)} ft ${row.oat_F} F ${lb} lb: ${Math.round(tofl)} ft (${lim}; go ${Math.round(go.ft)}${go.kias ? ` at ${Math.round(go.kias)} kt, V2 ${Math.round(go.v2)}` : ''}${go.why ? ' ' + go.why : ''}, stop ${Math.round(stop.ft)}, all ${Math.round(all.ft)}) vs AFM ${afm} (${e >= 0 ? '+' : ''}${e.toFixed(1)} %)`);
  });
}
console.log(`  rms ${Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length).toFixed(1)} %, mean ${(errs.reduce((a, e) => a + e, 0) / errs.length).toFixed(1)} %`);

// the AFM technique (firm, little or no flare) touches down under the 12 ft/s gear-damage line (720 ft/min)
console.log('\nLANDING DISTANCE from 50 ft (AFM Fig 5-74)');
const ld = T.landing_distance, lerrs = [];
for (const row of ld.rows) {
  const dT = dTof(row.alt_ft, row.oat_F);
  ld.weights_lb.forEach((lb, i) => {
    const r = landing(lb, row.alt_ft, dT), afm = row.ft[i], e = pct(r.ft, afm); lerrs.push(e);
    expect(Math.abs(e) <= TOL && r.touchFpm < 720, `${String(row.alt_ft).padStart(4)} ft ${row.oat_F} F ${lb} lb, VREF ${Math.round(vref(lb))}: ${Math.round(r.ft)} ft = air ${Math.round(r.air)} + roll ${Math.round(r.roll)}${r.why ? ' ' + r.why : ''} (touchdown ${Math.round(r.touchFpm)} ft/min at ${Math.round(r.kiasTd)} KIAS) vs AFM ${afm} (${e >= 0 ? '+' : ''}${e.toFixed(1)} %)`);
  });
}
console.log(`  rms ${Math.sqrt(lerrs.reduce((a, e) => a + e * e, 0) / lerrs.length).toFixed(1)} %, mean ${(lerrs.reduce((a, e) => a + e, 0) / lerrs.length).toFixed(1)} %`);

console.log(fail ? `\n${fail} FAILED` : '\nall performance checks passed');
process.exit(fail ? 1 : 0);
}
