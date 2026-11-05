// ILS deviations from the nav database (js/nav.js + FAA CIFP) and the flight-guidance modes (js/scenario.js): signs and
// scaling, altitude preselect and capture, a coupled ILS 10L from a 14 nm intercept to 200 ft, the heading knob turning
// the way it is spun, the FD flown by hand through a go-around (LNAV picks up the published missed approach at 400 ft),
// FD takeoff mode, an early go-around (no turn before the missed-approach point) and the 28R missed approach.
// A test pilot works the thrust levers and the configuration (the Learjet 60 has no autothrottle).
import { readFileSync } from 'node:fs';
import { Learjet60, ELEV_K } from '../js/aircraft.js';
import { Autopilot } from '../js/scenario.js';
import { setupStart, setWeight, FreeEnv, frameFor, trimFlight, tasFor, configureGuidance } from '../js/freeflight.js';
import { NavDB, procedureLegs } from '../js/navdb.js';
import { FMS } from '../js/fms.js';
import { ilsDeviation, nearestIls } from '../js/nav.js';
import { groundAlt } from '../js/ground.js';
import { vref } from '../js/afm.js';
import { DEG, clamp } from '../js/util.js';
import { FT } from '../js/atmo.js';

let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
const DT = 1 / 120, env = { wind: [0, 0, 0], dT: 0 };
const db = new NavDB({ load: async (p) => JSON.parse(readFileSync(new URL('../data/nav/' + p, import.meta.url), 'utf8')) });
await db.init(); const apt = await db.airport('KDJT'); const I10L = apt.ils.IDJT, I28R = apt.ils.IPWB;
const trkDeg = (r) => ((r / DEG) % 360 + 360) % 360;

// ---- deviations ----
{
  const f = frameFor('KDJT', '10L'), d5 = 5 * 1852, gsH = Math.tan(3 * DEG) * d5 + I10L.tch * FT;
  const at = (back, right, up) => ilsDeviation(I10L, f.thr[0] - f.u[0] * back - f.u[1] * right, f.thr[1] - f.u[1] * back + f.u[0] * right, I10L.thrElev * FT + up);
  const c = at(d5, 0, gsH), r = at(d5, 200, gsH), hi = at(d5, 0, gsH + 60), lo = at(d5, 0, gsH - 60);
  expect(Math.abs(c.loc) < 0.05 && Math.abs(c.gs) < 0.05 && c.locValid && c.gsValid && Math.abs(c.dme - 6.6) < 0.1, `5 nm on the centreline and glidepath: LOC ${c.loc.toFixed(2)}, G/S ${c.gs.toFixed(2)} dots, I-DJT ${c.dme.toFixed(2)} DME`);
  // the plate: glideslope intercept at ZISUR, 2,000 ft (CIFP fix position)
  const zis = procedureLegs(apt, 'APP', 'I10L').find((l) => l.faf), zd = ilsDeviation(I10L, zis.fix.ne[0], zis.fix.ne[1], 0);
  const gsAtZisur = (Math.tan(3 * DEG) * (I10L.tch * FT / Math.tan(3 * DEG) - zd.along)) / FT + I10L.thrElev;
  expect(Math.abs(gsAtZisur - 2000) < 60, `glidepath over ZISUR: ${Math.round(gsAtZisur)} ft MSL vs the published 2,000 ft intercept`);
  expect(r.loc < -0.4 && r.loc > -1.6, `200 m right of the centreline at 5 nm: LOC ${r.loc.toFixed(2)} dots (fly left)`);
  expect(hi.gs < -0.5 && lo.gs > 0.5 && Math.abs(hi.gs + lo.gs) < 0.1, `60 m above / below the glidepath at 5 nm: G/S ${hi.gs.toFixed(2)} / ${lo.gs.toFixed(2)} dots (fly down / up)`);
  const far = at(25 * 1852, 0, 3000), side = at(5 * 1852, 5000, 600);
  expect(!far.locValid && !side.gsValid, 'no localizer beyond 18 nm, no glideslope 5 km off the centreline');
  const pick = nearestIls(db.allIls(), f.thr[0] - f.u[0] * d5, f.thr[1] - f.u[1] * d5, 500, f.hdg);
  expect(pick && pick.ident === 'IDJT', `heading east on the 10L final picks ${pick && pick.ident} (${pick && pick.id})`);
}
function freeAp(ac) {
  const ap = new Autopilot(true); ap.on = true; ap.thetaLim = [-10 * DEG, 15 * DEG]; ap.fine = true;
  ap.nav = (o) => nearestIls(db.allIls(), ac.pos[0], ac.pos[1], o.h, o.track ?? o.psi); return ap;
}
function speedHold(ac, o, kias) { ac.ctl.thr = clamp(ac.ctl.thr + (kias - o.KIAS) * 0.004 * DT * 60, 0, 1); }
// 14 nm final for 10L, 2 nm right of the centreline, 3,000 ft, 180 KIAS, heading 30 deg to intercept
function intercept(ac) {
  const f = frameFor('KDJT', '10L'), dist = 14 * 1852, off = 2 * 1852, h = 3000 * FT;
  Object.assign(ac.ctl, { gear: 0, flaps: 0.2, sb: 0, park: false });
  trimFlight(ac, { n: f.thr[0] - f.u[0] * dist - f.u[1] * off, e: f.thr[1] - f.u[1] * dist + f.u[0] * off, h, V: tasFor(180, h), gamma: 0, psi: f.hdg - 30 * DEG });
}
// ---- altitude preselect: VS toward it, ALTS capture, ALT ----
{
  const ac = new Learjet60(); setWeight(ac, 'typical'); intercept(ac); const ap = freeAp(ac); let o = ac.step(0, env);
  ap.altTgt = o.h; ap.hdgTgt = trkDeg(o.psi); ap.setAlt(o.h + 2000 * FT, o);
  let maxVs = 0, t = 0; const seen = new Set();
  for (; t < 150; t += DT) { speedHold(ac, o, 200); ap.step(ac, DT, o); seen.add(ap.vert); o = ac.step(DT, env); maxVs = Math.max(maxVs, o.vs); if (t > 20 && ap.vert === 'ALT' && Math.abs(o.vs) < 0.5) break; }
  expect(ap.vert === 'ALT' && seen.has('ALTS') && Math.abs(o.h - ap.altTgt) < 30 && maxVs / FT * 60 > 1200 && maxVs / FT * 60 < 1900, `ALT preselect +2,000 ft: VS ${Math.round(maxVs / FT * 60)} ft/min, ${[...seen].join(' > ')}, ${Math.round((o.h - ap.altTgt) / FT)} ft from the target after ${t.toFixed(0)} s`);
}
// ---- heading select: spun 270 deg clockwise, the airplane turns right (the long way) ----
{
  const ac = new Learjet60(); setWeight(ac, 'typical'); intercept(ac); const ap = freeAp(ac); let o = ac.step(0, env);
  ap.altTgt = o.h; ap.hdgTgt = trkDeg(o.psi); const h0 = trkDeg(o.psi);
  for (let k = 0; k < 54; k++) ap.bumpHdg(5, trkDeg(o.psi));
  let firstBank = null, t = 0;
  for (; t < 200; t += DT) { speedHold(ac, o, 200); ap.step(ac, DT, o); o = ac.step(DT, env); if (firstBank === null && Math.abs(o.phi) > 10 * DEG) firstBank = o.phi; if (t > 30 && Math.abs(((trkDeg(o.psi) - ap.hdgTgt + 540) % 360) - 180) < 3) break; }
  expect(firstBank > 0 && t < 190, `bug spun 270° right (to ${Math.round(ap.hdgTgt)}° from ${Math.round(h0)}°): turned ${firstBank > 0 ? 'right' : 'left'}, on the bug after ${t.toFixed(0)} s`);
}

// ---- coupled ILS 10L ----
{
  const ac = new Learjet60(); setWeight(ac, 'typical'); intercept(ac); const ap = freeAp(ac); let o = ac.step(0, env);
  ap.altTgt = o.h; ap.hdgTgt = trkDeg(o.psi); ap.appr = true;
  const ref = vref(ac.m / 0.45359);
  let locAt = null, gsAt = null, maxLoc = 0, maxGs = 0, maxBank = 0, at200 = null, t = 0, conf = 0;
  for (; t < 600; t += DT) {
    const d = ap.ils, ft = (o.agl - 1.6) / FT;
    if (d && d.gsValid && d.gsRaw < 1 && conf === 0) { conf = 1; ac.ctl.gear = 1; ac.ctl.flaps = 0.5; }
    if (conf === 1 && ft < 1500) { conf = 2; ac.ctl.flaps = 1; }
    speedHold(ac, o, conf === 0 ? 180 : conf === 1 ? 150 : ref + 5);
    ap.step(ac, DT, o); o = ac.step(DT, env);
    if (ap.lat === 'LOC' && locAt === null) locAt = d ? d.dme : 0;
    if (ap.vert === 'GS' && gsAt === null) gsAt = d ? d.dme : 0;
    if (ft < 1000 && ft > 200 && d) { maxLoc = Math.max(maxLoc, Math.abs(d.locRaw)); maxGs = Math.max(maxGs, Math.abs(d.gsRaw)); maxBank = Math.max(maxBank, Math.abs(o.phi)); }
    if (ft <= 200) { at200 = { d, kias: o.KIAS, vs: o.vs / FT * 60 }; break; }
    if (!ap.on || ac.crashed) break;
  }
  expect(locAt !== null && gsAt !== null && locAt > gsAt, `captures: localizer at ${locAt?.toFixed(1)} DME, glideslope at ${gsAt?.toFixed(1)} DME`);
  expect(at200 && maxLoc < 0.5 && maxGs < 0.5 && maxBank < 10 * DEG, `1,000 to 200 ft coupled: LOC within ${maxLoc.toFixed(2)} dot, G/S within ${maxGs.toFixed(2)} dot, bank under ${(maxBank / DEG).toFixed(1)}°`);
  expect(at200 && Math.abs(at200.d.cross) < 15 && Math.abs(at200.d.gsErrM) < 6 && Math.abs(at200.kias - ref - 5) < 6 && at200.vs > -950 && at200.vs < -500,
    `at 200 ft: ${at200 && at200.d.cross.toFixed(1)} m off the centreline, ${at200 && at200.d.gsErrM.toFixed(1)} m off the glidepath, ${at200 && Math.round(at200.kias)} KIAS (VREF ${Math.round(ref)}), ${at200 && Math.round(at200.vs)} ft/min`);
}

// ---- flight director flown by hand: approach, go-around, LNAV onto the missed approach ----
const flyFd = (ac, ap, o) => {
  const e = ap.fdTheta - o.theta; ac.fI = o.wow ? 0 : clamp((ac.fI || 0) + e * DT * 4, -0.5, 0.5);
  ac.ctl.elev = clamp(((o.wow ? 3 : 6) * e - 2 * o.q) / ELEV_K + ac.fI, -1, 1);
  ac.ctl.ail = clamp(1.2 * (ap.fdPhi - o.phi) - 0.5 * o.p, -1, 1);
  ac.ctl.trim = clamp(ac.ctl.trim + ac.ctl.elev * ELEV_K * 0.2 * DT, -1.27, 2.96);
};
const withPlan = (ap, app, from = 0) => { const fms = new FMS(), legs = procedureLegs(apt, 'APP', app); fms.load(legs, from); ap.fms = fms; return fms; };
{
  const ac = new Learjet60(); setWeight(ac, 'typical'); intercept(ac); const ap = freeAp(ac); let o = ac.step(0, env);
  const fms = withPlan(ap, 'I10L', 1);
  ap.on = false; ap.fd = true; ap.lat = 'HDG'; ap.vert = 'ALT'; ap.altTgt = o.h; ap.hdgTgt = trkDeg(o.psi); ap.appr = true;
  const ref = vref(ac.m / 0.45359); let conf = 0, maxLoc = 0, maxGs = 0, ga = null, t = 0;
  for (; t < 900; t += DT) {
    const d = ap.ils, ft = (o.agl - 1.6) / FT;
    if (d && d.gsValid && d.gsRaw < 1 && conf === 0) { conf = 1; ac.ctl.gear = 1; ac.ctl.flaps = 0.5; }
    if (conf === 1 && ft < 1500) { conf = 2; ac.ctl.flaps = 1; ap.altTgt = 3000 * FT; }   // missed-approach altitude set on final
    if (conf < 3) speedHold(ac, o, conf === 0 ? 180 : conf === 1 ? 150 : ref + 5);
    if (ft < 1000 && ft > 300 && d && conf < 3) { maxLoc = Math.max(maxLoc, Math.abs(d.locRaw)); maxGs = Math.max(maxGs, Math.abs(d.gsRaw)); }
    if (conf === 2 && ft <= 300) { conf = 3; ap.goAround(o); ac.ctl.thr = 1; ac.ctl.flaps = 0.5; ga = { t, arm: ap.latArm }; }
    if (conf === 3) {
      if (o.vs > 2) ac.ctl.gear = 0;
      if (ft > 1000) { ac.ctl.flaps = 0; if (t > ga.t + 15) speedHold(ac, o, 180); }
      if (ga.lnavFt == null && ap.lat === 'LNAV') ga.lnavFt = ft;
      if (ga.turnFt == null && Math.abs(o.phi) > 8 * DEG) { ga.turnFt = ft; ga.turnLeg = fms.active && fms.active.pt; ga.turnDir = Math.sign(o.phi); }
      if (ap.vert === 'ALT' && Math.abs(o.h / FT - 3000) < 60) { ga.alt = o.h / FT; ga.leg = fms.active && fms.active.pt + ' ' + (fms.active.fix ? fms.active.fix.id : ''); break; }
    }
    ap.step(ac, DT, o); flyFd(ac, ap, o); o = ac.step(DT, env);
    if (ac.crashed) break;
  }
  expect(maxLoc < 0.5 && maxGs < 0.6, `flying the FD bars, AP off, 1,000 to 300 ft: LOC within ${maxLoc.toFixed(2)} dot, G/S within ${maxGs.toFixed(2)} dot`);
  expect(ga && ga.arm === 'LNAV' && ga.lnavFt >= 390 && ga.lnavFt < 500 && ga.turnFt > 540 && ga.turnDir < 0 && ga.alt && !ac.crashed,
    `go-around at 300 ft: LNAV armed, engaged at ${ga && Math.round(ga.lnavFt)} ft, left turn at ${ga && Math.round(ga.turnFt)} ft (${ga && ga.turnLeg}), 3,000 ft captured on ${ga && ga.leg}`);
}
// ---- FD takeoff mode ----
{
  const ac = new Learjet60(); setWeight(ac, 'typical'); setupStart(ac, { apt: 'KDJT', start: 'rwy', rwy: '10L' }, new FreeEnv('calm')); const ap = freeAp(ac); let o = ac.step(0, env);
  ap.on = false; ap.takeoff(o.psi / DEG, 3000 * FT); ac.ctl.park = false; ac.ctl.thr = 1;
  let rot = false, t = 0, done = null, maxTh = 0;
  for (; t < 240; t += DT) {
    if (o.KIAS > 136) rot = true;
    if (!o.wow && o.vs > 2) ac.ctl.gear = 0;
    if (!o.wow && (o.agl - 1.6) / FT > 1000 && ac.ctl.flaps) ac.ctl.flaps = 0;
    if (ap.vert === 'ALT' || ap.vert === 'ALTS') ac.ctl.thr = clamp(ac.ctl.thr + (220 - o.KIAS) * 0.004 * DT * 60, 0, 1);
    ap.step(ac, DT, o);
    if (rot) flyFd(ac, ap, o); else { ac.ctl.elev = 0; ac.ctl.ail = 0; }
    o = ac.step(DT, env); maxTh = Math.max(maxTh, o.theta);
    if (ap.vert === 'ALT' && Math.abs(o.vs) < 1 && t > 40) { done = { h: o.h, t }; break; }
    if (ac.crashed) break;
  }
  expect(done && Math.abs(done.h / FT - 3000) < 100 && maxTh < 12 * DEG, `FD takeoff: +9° bar to ${done && Math.round(done.h / FT)} ft (preselect 3,000), max pitch ${(maxTh / DEG).toFixed(1)}°, ${done && done.t.toFixed(0)} s`);
}
// ---- early go-around (6 nm final): straight ahead on the runway course, no turn before the missed-approach point ----
{
  const ac = new Learjet60(); setWeight(ac, 'typical'); const s = { apt: 'KDJT', start: 'final', app: 'I10L' }, legs = procedureLegs(apt, 'APP', 'I10L');
  const r = setupStart(ac, s, new FreeEnv('calm'), legs); let o = ac.step(0, env);
  const ap = freeAp(ac), fms = new FMS(); configureGuidance(ap, fms, r, s, legs, o);
  for (let t = 0; t < 2; t += DT) { ap.step(ac, DT, o); o = ac.step(DT, env); }
  ap.goAround(o); ac.ctl.thr = 1; let turnAlong = null, maxCross = 0;
  for (let t = 0; t < 240; t += DT) {
    if (o.vs > 2) ac.ctl.gear = 0; if ((o.agl - 1.6) / FT > 1000) ac.ctl.flaps = 0; if (t > 15) speedHold(ac, o, 180);
    const d = ilsDeviation(I10L, ac.pos[0], ac.pos[1], o.h);
    if (d.along < 0) maxCross = Math.max(maxCross, Math.abs(d.cross));
    if (turnAlong === null && Math.abs(o.phi) > 8 * DEG) { turnAlong = d.along; break; }
    ap.step(ac, DT, o); flyFd(ac, ap, o); o = ac.step(DT, env);
  }
  expect(turnAlong !== null && turnAlong >= -5 && maxCross < 60, `go-around 6 nm out: on the runway course (within ${maxCross.toFixed(0)} m) to the MAP (the 10L threshold), first turn ${turnAlong !== null ? Math.round(turnAlong) : '?'} m past it`);
}
// ---- 28R: climb to 500, then a right turn direct onto the PBI course to MORGA ----
{
  const ac = new Learjet60(); setWeight(ac, 'typical'); const f = frameFor('KDJT', '28R'), dist = 0.5 * 1852;   // just before the MAP
  Object.assign(ac.ctl, { gear: 1, flaps: 1, sb: 0, park: false });
  const n = f.thr[0] - f.u[0] * dist, e = f.thr[1] - f.u[1] * dist, h = Math.tan(3 * DEG) * dist + I28R.tch * FT + I28R.thrElev * FT;
  trimFlight(ac, { n, e, h, V: tasFor(145, h), gamma: -3 * DEG, psi: f.hdg });
  const ap = freeAp(ac); let o = ac.step(0, env); const fms = withPlan(ap, 'I28R', 2);
  ap.on = false; ap.fd = true; ap.appr = true; ap.lat = 'LOC'; ap.vert = 'GS'; ap.altTgt = 3000 * FT;
  for (let t = 0; t < 1; t += DT) { ap.step(ac, DT, o); o = ac.step(DT, env); }
  ap.goAround(o); ac.ctl.thr = 1; ac.ctl.flaps = 0.5; let turnH = null, firstBank = null, trk = null;
  for (let t = 0; t < 400; t += DT) {
    if (o.vs > 2) ac.ctl.gear = 0; if ((o.agl - 1.6) / FT > 1000) ac.ctl.flaps = 0; if (t > 15) speedHold(ac, o, 180);
    if (turnH === null && fms.active && fms.active.pt === 'CF' && fms.active.fix.id === 'MORGA') turnH = o.h / FT;
    if (turnH !== null && firstBank === null && Math.abs(o.phi) > 10 * DEG) firstBank = o.phi;
    if (turnH !== null && o.h / FT > 2500 && Math.abs(o.phi) < 3 * DEG) { trk = trkDeg(o.track); break; }
    ap.step(ac, DT, o); flyFd(ac, ap, o); o = ac.step(DT, env);
  }
  expect(turnH > 480 && turnH < 600 && firstBank > 0 && trk !== null && Math.abs(trk - 340) < 15, `ILS 28R missed approach: CA to 500 (turn at ${turnH && Math.round(turnH)} ft), ${firstBank > 0 ? 'right' : 'left'} turn, tracking ${trk !== null ? trk.toFixed(0) : '?'}° true to MORGA (course 340° true)`);
}

// ---- marker beacons: operational ones from the FAA NASR (tools/fetch_markers.py); decommissioned ones stay silent ----
{
  const fmy = await db.airport('KFMY'), il = fmy.ils.IFMY, om = il && il.markers.find((m) => m.type === 'OM');
  const u = il && [Math.cos(il.crsT * DEG), Math.sin(il.crsT * DEG)], h = (om ? om.elev : 0) * FT + 1500 * FT;
  const over = om && ilsDeviation(il, om.ne[0], om.ne[1], h).marker;
  const before = om && ilsDeviation(il, om.ne[0] - u[0] * 2 * 1852, om.ne[1] - u[1] * 2 * 1852, h).marker;
  expect(over === 'OM' && before === null, `KFMY ILS 05 outer marker (CALOO): ${over} overhead at 1,500 ft, ${before} 2 nm before it`);
  const djt = [I10L, I28R].map((x) => x.markers.length);
  expect(djt[0] === 0 && djt[1] === 0, `KDJT markers decommissioned (NASR): ${djt.join(', ')} operational on 10L, 28R`);
}

console.log(fail ? `\n${fail} FAILED` : '\nall nav tests passed');
process.exit(fail ? 1 : 0);
