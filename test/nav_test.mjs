// ILS (js/nav.js) and the autopilot's approach modes (js/scenario.js): deviation signs and scaling, altitude preselect,
// and a coupled ILS 10L from the 14 nm intercept start to 200 ft, with a test pilot on the thrust levers and the
// configuration (the Learjet 60 has no autothrottle).
import { Learjet60, ELEV_K } from '../js/aircraft.js';
import { Autopilot } from '../js/scenario.js';
import { setupStart, setWeight, FreeEnv, rwyByStart } from '../js/freeflight.js';
import { ILS, ilsDeviation, nearestIls } from '../js/nav.js';
import { groundAlt } from '../js/ground.js';
import { vref } from '../js/afm.js';
import { DEG, clamp } from '../js/util.js';
import { FT, KT } from '../js/atmo.js';

let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
const DT = 1 / 120, env = { wind: [0, 0, 0], dT: 0 };

// ---- deviations ----
{
  const ils = ILS[0], f = rwyByStart('rwy10L'), d5 = 5 * 1852, gsH = Math.tan(3 * DEG) * (d5 + 55 * FT / Math.tan(3 * DEG));
  const at = (back, right, up) => ilsDeviation(ils, f.thr[0] - f.u[0] * back - f.u[1] * right, f.thr[1] - f.u[1] * back + f.u[0] * right, groundAlt(f.thr[0], f.thr[1]) + up);
  const c = at(d5, 0, gsH), r = at(d5, 200, gsH), hi = at(d5, 0, gsH + 60), lo = at(d5, 0, gsH - 60);
  expect(Math.abs(c.loc) < 0.01 && Math.abs(c.gs) < 0.02 && c.locValid && c.gsValid && Math.abs(c.dme - 5) < 0.05, `5 nm on the centreline and glidepath: LOC ${c.loc.toFixed(2)}, G/S ${c.gs.toFixed(2)} dots, ${c.dme.toFixed(2)} nm`);
  expect(r.loc < -0.6 && r.loc > -1.6, `200 m right of the centreline at 5 nm: LOC ${r.loc.toFixed(2)} dots (fly left)`);
  expect(hi.gs < -0.5 && lo.gs > 0.5 && Math.abs(hi.gs + lo.gs) < 0.1, `60 m above / below the glidepath at 5 nm: G/S ${hi.gs.toFixed(2)} / ${lo.gs.toFixed(2)} dots (fly down / up)`);
  const far = at(25 * 1852, 0, 3000), side = at(5 * 1852, 5000, 600);
  expect(!far.locValid && !side.gsValid, 'no localizer beyond 18 nm, no glideslope 5 km off the centreline');
  const n28 = nearestIls(f.thr[0] - f.u[0] * d5, f.thr[1] - f.u[1] * d5, 500, f.hdg);
  expect(n28 && n28.id === 'ILS 10L', `heading east on the 10L final picks ${n28 && n28.id}`);
}
// ---- the free-flight autopilot: altitude preselect ----
function freeAp(ac) {
  const ap = new Autopilot(true); ap.on = true; ap.thetaLim = [-10 * DEG, 15 * DEG]; ap.fine = true;
  ap.nav = (o) => nearestIls(ac.pos[0], ac.pos[1], o.h, o.track ?? o.psi); return ap;
}
function speedHold(ac, o, kias) { ac.ctl.thr = clamp(ac.ctl.thr + (kias - o.KIAS) * 0.004 * DT * 60 - 0.02 * (o.vs > 0 ? 0 : 0), 0, 1); }
{
  const ac = new Learjet60(); setWeight(ac, 'typical'); const fe = new FreeEnv('calm');
  setupStart(ac, 'ils10L', fe); const ap = freeAp(ac); let o = ac.step(0, env);
  ap.altTgt = o.h; ap.hdgTgt = (o.psi / DEG + 360) % 360;
  ap.setAlt(o.h + 2000 * FT, o);
  let maxVs = 0, t = 0;
  for (; t < 150; t += DT) { speedHold(ac, o, 200); ap.step(ac, DT, o); o = ac.step(DT, env); maxVs = Math.max(maxVs, o.vs); if (t > 20 && ap.vert === 'ALT' && Math.abs(o.vs) < 0.5) break; }
  expect(ap.vert === 'ALT' && Math.abs(o.h - ap.altTgt) < 30 && maxVs / FT * 60 > 1200 && maxVs / FT * 60 < 1900, `ALT preselect +2,000 ft: VS ${Math.round(maxVs / FT * 60)} ft/min, captured ${Math.round((o.h - ap.altTgt) / FT)} ft from the target after ${t.toFixed(0)} s`);
}
// ---- coupled ILS 10L ----
{
  const ac = new Learjet60(); setWeight(ac, 'typical'); const fe = new FreeEnv('calm');
  setupStart(ac, 'ils10L', fe); const ap = freeAp(ac); let o = ac.step(0, env);
  ap.altTgt = o.h; ap.hdgTgt = (o.psi / DEG + 360) % 360; ap.appr = true;
  const ref = vref(ac.m / 0.45359);
  let locAt = null, gsAt = null, maxLoc = 0, maxGs = 0, maxBank = 0, at200 = null, t = 0, conf = 0;
  for (; t < 600; t += DT) {
    const d = ap.ils, ft = (o.agl - 1.6) / FT;
    // the pilot: gear and flaps 20 when the glideslope comes alive, flaps 40 at 1,500 ft; speed on the thrust levers
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
  expect(locAt !== null && gsAt !== null && locAt > gsAt, `captures: localizer at ${locAt?.toFixed(1)} nm, glideslope at ${gsAt?.toFixed(1)} nm`);
  expect(at200 && maxLoc < 0.5 && maxGs < 0.5 && maxBank < 10 * DEG, `1,000 to 200 ft coupled: LOC within ${maxLoc.toFixed(2)} dot, G/S within ${maxGs.toFixed(2)} dot, bank under ${(maxBank / DEG).toFixed(1)}°`);
  expect(at200 && Math.abs(at200.d.cross) < 15 && Math.abs(at200.d.gsErrM) < 6 && Math.abs(at200.kias - ref - 5) < 6 && at200.vs > -950 && at200.vs < -500,
    `at 200 ft: ${at200 && at200.d.cross.toFixed(1)} m off the centreline, ${at200 && at200.d.gsErrM.toFixed(1)} m off the glidepath, ${at200 && Math.round(at200.kias)} KIAS (VREF ${Math.round(ref)}), ${at200 && Math.round(at200.vs)} ft/min`);
}

// ---- flight director, markers, go-around, takeoff mode ----
// a pilot who flies the FD bars (autopilot off)
const flyFd = (ac, ap, o) => {
  const e = ap.fdTheta - o.theta; ac.fI = o.wow ? 0 : clamp((ac.fI || 0) + e * DT * 4, -0.5, 0.5);   // no integrating on the wheels
  ac.ctl.elev = clamp(((o.wow ? 3 : 6) * e - 2 * o.q) / ELEV_K + ac.fI, -1, 1);
  ac.ctl.ail = clamp(1.2 * (ap.fdPhi - o.phi) - 0.5 * o.p, -1, 1);
  ac.ctl.trim = clamp(ac.ctl.trim + ac.ctl.elev * ELEV_K * 0.2 * DT, -1.27, 2.96);
};
{
  const ac = new Learjet60(); setWeight(ac, 'typical'); const fe = new FreeEnv('calm');
  setupStart(ac, 'ils10L', fe); const ap = freeAp(ac); let o = ac.step(0, env);
  ap.on = false; ap.fd = true; ap.lat = 'HDG'; ap.vert = 'ALT'; ap.altTgt = o.h; ap.hdgTgt = (o.psi / DEG + 360) % 360; ap.appr = true;
  const ref = vref(ac.m / 0.45359); let conf = 0, maxLoc = 0, maxGs = 0, marks = [], ga = null, top = null, t = 0;
  for (; t < 700; t += DT) {
    const d = ap.ils, ft = (o.agl - 1.6) / FT;
    if (d && d.gsValid && d.gsRaw < 1 && conf === 0) { conf = 1; ac.ctl.gear = 1; ac.ctl.flaps = 0.5; }
    if (conf === 1 && ft < 1500) { conf = 2; ac.ctl.flaps = 1; }
    if (d && d.marker && marks[marks.length - 1]?.id !== d.marker) marks.push({ id: d.marker, nm: d.along < 0 ? -d.along / 1852 : 0 });
    if (conf < 3) speedHold(ac, o, conf === 0 ? 180 : conf === 1 ? 150 : ref + 5);
    if (ft < 1000 && ft > 300 && d && conf < 3) { maxLoc = Math.max(maxLoc, Math.abs(d.locRaw)); maxGs = Math.max(maxGs, Math.abs(d.gsRaw)); }
    // go around at 300 ft: T/O thrust, FD GA, flaps 20, gear up with a positive rate
    if (conf === 2 && ft <= 300) { conf = 3; ap.goAround(o); ac.ctl.thr = 1; ac.ctl.flaps = 0.5; ga = { t, h: o.h }; }
    if (conf === 3 && o.vs > 2) ac.ctl.gear = 0;
    if (conf === 3 && ap.vert === 'ALT' && Math.abs(o.vs) < 1 && t > ga.t + 20) { top = { h: o.h, hdg: o.psi, t: t - ga.t }; break; }
    ap.step(ac, DT, o); flyFd(ac, ap, o); o = ac.step(DT, env);
    if (ac.crashed) break;
  }
  expect(maxLoc < 0.5 && maxGs < 0.6, `flying the FD bars, AP off, 1,000 to 300 ft: LOC within ${maxLoc.toFixed(2)} dot, G/S within ${maxGs.toFixed(2)} dot`);
  expect(marks.length >= 2 && marks[0].id === 'OM' && Math.abs(marks[0].nm - 4.5) < 0.4 && marks[1].id === 'MM' && Math.abs(marks[1].nm - 0.58) < 0.25, `markers: ${marks.map((m) => `${m.id} at ${m.nm.toFixed(2)} nm`).join(', ')}`);
  const f = rwyByStart('rwy10L'); let he = top ? top.hdg - f.hdg : 9; he = Math.atan2(Math.sin(he), Math.cos(he));
  expect(top && Math.abs(top.h / FT - 2000) < 120 && Math.abs(he) < 5 * DEG && !ac.crashed, `go-around at 300 ft: FD 10°, levels at ${top && Math.round(top.h / FT)} ft (missed approach 2,000) on ${top && (((top.hdg / DEG) % 360 + 360) % 360).toFixed(0)}° (runway ${(f.hdg / DEG).toFixed(0)}°) after ${top && top.t.toFixed(0)} s`);
}
{
  const ac = new Learjet60(); setWeight(ac, 'typical'); setupStart(ac, 'rwy10L', new FreeEnv('calm')); const ap = freeAp(ac); let o = ac.step(0, env);
  ap.on = false; ap.takeoff(o.psi / DEG, 3000 * FT); ac.ctl.park = false; ac.ctl.thr = 1;
  let rot = false, t = 0, done = null, maxTh = 0;
  for (; t < 240; t += DT) {
    if (o.KIAS > 136) rot = true;
    if (!o.wow && o.vs > 2) ac.ctl.gear = 0;
    if (!o.wow && (o.agl - 1.6) / FT > 1000 && ac.ctl.flaps) ac.ctl.flaps = 0;
    if (ap.vert === 'ALT') ac.ctl.thr = clamp(ac.ctl.thr + (220 - o.KIAS) * 0.004 * DT * 60, 0, 1);
    ap.step(ac, DT, o);
    if (rot) flyFd(ac, ap, o); else { ac.ctl.elev = 0; ac.ctl.ail = 0; }
    o = ac.step(DT, env); maxTh = Math.max(maxTh, o.theta);
    if (ap.vert === 'ALT' && Math.abs(o.vs) < 1 && t > 40) { done = { h: o.h, t }; break; }
    if (ac.crashed) break;
  }
  expect(done && Math.abs(done.h / FT - 3000) < 100 && maxTh < 12 * DEG, `FD takeoff: +9° bar to ${done && Math.round(done.h / FT)} ft (preselect 3,000), max pitch ${(maxTh / DEG).toFixed(1)}°, ${done && done.t.toFixed(0)} s`);
}

console.log(fail ? `\n${fail} FAILED` : '\nall nav tests passed');
process.exit(fail ? 1 : 0);
