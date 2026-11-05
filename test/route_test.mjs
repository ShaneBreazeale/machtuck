// IFR routes (js/route.js) on the FAA CIFP: route-string parsing (SID / STAR with and without versions and FAA-style
// transitions, airways, coordinates), MSFS .pln import, plan assembly, and a whole flight flown from the plan:
// KDJT runway 10L, TBIRD8 departure to CHEFS, MUNGI1 arrival, ILS 18R at KMCO (176 nm), with a test pilot on the
// thrust levers and the configuration. Altitudes are above the curved surface (js/aircraft.js curved), so the airport
// 230 km away sits where its elevation says.
import { readFileSync } from 'node:fs';
import { Learjet60, ELEV_K } from '../js/aircraft.js';
import { Autopilot } from '../js/scenario.js';
import { setupStart, setWeight, FreeEnv, configureGuidance } from '../js/freeflight.js';
import { NavDB } from '../js/navdb.js';
import { parseRoute, buildPlan, parsePln } from '../js/route.js';
import { FMS } from '../js/fms.js';
import { nearestIls } from '../js/nav.js';
import { vref } from '../js/afm.js';
import { DEG, clamp } from '../js/util.js';
import { FT } from '../js/atmo.js';

let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
const db = new NavDB({ load: async (p) => JSON.parse(readFileSync(new URL('../data/nav/' + p, import.meta.url), 'utf8')) });
await db.init(); const KDJT = await db.airport('KDJT'), KMCO = await db.airport('KMCO');
const ids = (r) => r.enroute.map((x) => x.kind === 'FIX' ? x.fix.id : `<${x.id}>`).join(' ');

// ---- parsing ----
{
  const a = parseRoute(db, 'KDJT TBIRD8 CHEFS MUNGI1 KMCO', KDJT, KMCO);
  expect(a.sid === 'TBIRD8' && a.sidTrans === 'CHEFS' && a.star === 'MUNGI1' && a.starTrans === 'CHEFS' && ids(a) === 'CHEFS' && !a.errors.length, `KDJT TBIRD8 CHEFS MUNGI1 KMCO: SID ${a.sid}.${a.sidTrans}, STAR ${a.starTrans}.${a.star}, route ${ids(a)}`);
  const b = parseRoute(db, 'TBIRD.MATLK MATLK.SLOAO1 /F240', KDJT, KMCO);
  expect(b.sid === 'TBIRD8' && b.sidTrans === 'MATLK' && b.star === 'SLOAO1' && b.starTrans === 'MATLK' && b.cruise === 24000, `FAA style TBIRD.MATLK MATLK.SLOAO1 /F240: ${b.sid}.${b.sidTrans}, ${b.starTrans}.${b.star}, cruise ${b.cruise}`);
  const c = parseRoute(db, 'ZBV A315 JAYEE DCT 2630N07930W', KDJT, KMCO);
  const pc = buildPlan(db, { dep: KDJT, arr: KMCO, enroute: c.enroute });
  expect(ids(c) === 'ZBV <A315> JAYEE 2630N07930W' && pc.legs.map((l) => l.fix.id).join(' ') === 'ZBV SWIMM TINKY PEKRE JAYEE 2630N07930W', `airway and coordinates: ${pc.legs.map((l) => l.fix.id).join(' ')}`);
  const d = parseRoute(db, 'TBIRD8 NOPEZ J999', KDJT, KMCO);
  expect(d.errors.length === 2, `unknown tokens reported: ${d.errors.join('; ')}`);
}
// ---- MSFS .pln ----
{
  const pln = `<?xml version="1.0"?><SimBase.Document><FlightPlan.FlightPlan><DepartureID>KDJT</DepartureID><DestinationID>KMCO</DestinationID><CruisingAlt>21000</CruisingAlt>
    <ATCWaypoint id="KDJT"><ATCWaypointType>Airport</ATCWaypointType></ATCWaypoint>
    <ATCWaypoint id="CHEFS"><ATCWaypointType>Intersection</ATCWaypointType><DepartureFP>TBIRD8</DepartureFP></ATCWaypoint>
    <ATCWaypoint id="MOOTS"><ATCWaypointType>Intersection</ATCWaypointType><ArrivalFP>MUNGI1</ArrivalFP></ATCWaypoint>
    <ATCWaypoint id="KMCO"><ATCWaypointType>Airport</ATCWaypointType></ATCWaypoint></FlightPlan.FlightPlan></SimBase.Document>`;
  const p = parsePln(pln), r = parseRoute(db, p.route, KDJT, KMCO);
  expect(p.dep === 'KDJT' && p.arr === 'KMCO' && p.cruise === 21000 && r.sid === 'TBIRD8' && r.star === 'MUNGI1', `.pln: ${p.dep} → ${p.arr}, ${p.cruise} ft, route "${p.route}" → SID ${r.sid}, STAR ${r.star}`);
}

// ---- the whole flight ----
{
  const s = { apt: 'KDJT', rwy: '10L', arr: 'KMCO', sid: 'TBIRD8', sidTrans: 'CHEFS', star: 'MUNGI1', starTrans: 'CHEFS', app: 'I18R', start: 'rwy', cruise: 21000 };
  const r0 = parseRoute(db, 'TBIRD8 CHEFS MUNGI1', KDJT, KMCO);
  const plan = buildPlan(db, { dep: KDJT, arr: KMCO, depRwy: '10L', sid: s.sid, sidTrans: s.sidTrans, enroute: r0.enroute, star: s.star, starTrans: s.starTrans, arrRwy: '18R', app: s.app });
  const legs = plan.legs;
  expect(!plan.errors.length && Math.abs(plan.dist - 180) < 6 && legs[0].kind === 'SID' && legs.at(-1).pt === 'HM', `plan: ${legs.length} legs, ${plan.dist.toFixed(0)} nm, SID ... ${legs.filter((l) => l.kind === 'STAR').length} STAR legs ... ${legs.filter((l) => l.kind === 'APP').length} approach legs`);
  const ac = new Learjet60(); setWeight(ac, 'typical'); const env = new FreeEnv('calm'), DT = 1 / 50;
  const r = setupStart(ac, s, env, legs); let o = ac.step(0, { wind: [0, 0, 0] });
  const ap = new Autopilot(true), fms = new FMS();
  ap.nav = (q) => { const id = fms.approachNav(), il = id && KMCO.ils[id]; return nearestIls(il ? [il] : db.allIls(), ac.pos[0], ac.pos[1], q.h, q.track ?? q.psi); };
  configureGuidance(ap, fms, r, s, legs, o);
  ac.ctl.park = false; ac.ctl.thr = 1;
  const flyFd = () => { const e = ap.fdTheta - o.theta; ac.fI = o.wow ? 0 : clamp((ac.fI || 0) + e * DT * 4, -0.5, 0.5); ac.ctl.elev = clamp(((o.wow ? 3 : 6) * e - 2 * o.q) / ELEV_K + ac.fI, -1, 1); ac.ctl.ail = clamp(1.2 * (ap.fdPhi - o.phi) - 0.5 * o.p, -1, 1); };
  const ref = vref(ac.m / 0.45359); let t = 0, rot = false, conf = 0, lastLeg = -1, at = [], maxH = 0, modes = [], end = null, mspDown = false;
  for (; t < 4000; t += DT) {
    const ft = (o.agl - 1.6) / FT, hft = o.h / FT, leg = fms.active;
    if (fms.i !== lastLeg) { const pl = legs[lastLeg]; if (pl && pl.fix && pl.alt) at.push({ id: pl.fix.id, h: hft, alt: pl.alt, kind: pl.kind }); lastLeg = fms.i; }
    const key = `${ap.lat}/${ap.vert}`; if (modes.at(-1) !== key) modes.push(key);
    maxH = Math.max(maxH, hft);
    // the pilot: rotate at VR, gear up, flaps up at 1,000 ft, the AP on at 1,000 ft; climb thrust; speed in cruise and descent
    if (o.KIAS > 136) rot = true;
    if (!o.wow && o.vs > 2) ac.ctl.gear = 0;
    if (!o.wow && ft > 1000 && conf === 0 && !ap.on) { ac.ctl.flaps = 0; ap.engage(o); }
    const spd = ap.climbSpd ? null : leg && leg.kind === 'APP' ? 180 : hft < 10000 ? 250 : 280;
    if (leg && leg.kind === 'APP' && conf === 0) ac.ctl.flaps = 0.2;
    if (conf === 0 && spd) { ac.ctl.thr = clamp(ac.ctl.thr + (spd - o.KIAS) * 0.004 * DT * 60, 0, 1); ac.ctl.sb = o.KIAS > spd + 15 && ac.ctl.thr < 0.05 ? 1 : 0; }
    else if (conf === 0) { ac.ctl.thr = 0.95; ac.ctl.sb = 0; }
    // past the departure: descend via the arrival (the lowest altitude before the approach preselected), arm the approach
    if (!mspDown && leg && leg.kind === 'STAR') { mspDown = true; ap.altTgt = 2200 * FT; }
    if (leg && leg.kind === 'APP' && !ap.appr) ap.appr = true;
    if (ap.vert === 'GS' && conf === 0) { conf = 1; ac.ctl.sb = 0; ac.ctl.gear = 1; ac.ctl.flaps = 0.5; ap.altTgt = 4000 * FT; }
    if (conf === 1 && ft < 1500) { conf = 2; ac.ctl.flaps = 1; }
    if (conf > 0) ac.ctl.thr = clamp(ac.ctl.thr + ((conf === 1 ? 150 : ref + 5) - o.KIAS) * 0.004 * DT * 60, 0, 1);
    if (conf === 2 && ft <= 200) { end = { d: ap.ils, kias: o.KIAS, t }; break; }
    ap.step(ac, DT, o);
    if (!ap.on) { if (rot) flyFd(); else { ac.ctl.elev = 0; ac.ctl.ail = 0; } }
    o = ac.step(DT, { wind: [0, 0, 0], dT: 0 });
    if (ac.crashed || ac.broken) break;
  }
  const bad = at.filter((x) => { const a = x.alt, d = a.d; const lo = d === 'B' ? a.a2 : /[-Y]/.test(d) ? -1e9 : a.a1, hi = d === 'B' ? a.a1 : /[+HJV]/.test(d) ? 1e9 : a.a1; return x.h < lo - 300 || x.h > hi + 300; });
  console.log('      modes:', modes.join(' > '));
  console.log('      constraints:', at.map((x) => `${x.id} ${Math.round(x.h)} (${x.alt.d}${x.alt.a1}${x.alt.a2 ? '/' + x.alt.a2 : ''})`).join(', '));
  expect(Math.abs(maxH - 21000) < 250, `climbed via the SID to the cruise altitude: top ${Math.round(maxH)} ft (21,000)`);
  expect(bad.length === 0, `every altitude constraint met within 300 ft${bad.length ? ': missed ' + bad.map((x) => `${x.id} ${Math.round(x.h)}`).join(', ') : ''}`);
  expect(end && Math.abs(end.d.locRaw) < 0.5 && Math.abs(end.d.gsRaw) < 0.6 && !ac.crashed, `KMCO ILS 18R at 200 ft after ${end ? (end.t / 60).toFixed(0) : '?'} min: LOC ${end && end.d.locRaw.toFixed(2)}, G/S ${end && end.d.gsRaw.toFixed(2)} dot, ${end && Math.round(end.kias)} KIAS`);
}
console.log(fail ? `\n${fail} FAILED` : '\nall route tests passed');
process.exit(fail ? 1 : 0);
