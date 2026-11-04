// Free flight: KPBI and the airspace around it with no accident script. Starting points, weather and weight presets,
// a calm / steady-wind environment with the same interface as the storm (js/scenario.js Environment), and a trim solver
// so airborne starts begin in steady flight.
import { clamp, DEG } from './util.js';
import { runwayById, runwayFrame, groundAlt } from './ground.js';
import { isa, FT, KT } from './atmo.js';
import { STAB, stabDeg } from './aircraft.js';

export const WEATHER = {
  calm:  { name: 'Calm, few cumulus, ISA', wind: 0, from: 0, gust: 0, cu: 0.08, dT: 0 },
  metar: { name: 'KPBI METAR 1 Nov 17:53Z: 080° 16 G28 kt, 26 °C, scattered cumulus', wind: 16, from: 80, gust: 28, cu: 0.3, dT: 11 },
  cross: { name: 'Crosswind 010° 15 kt (90° to runway 10L), ISA', wind: 15, from: 10, gust: 0, cu: 0.12, dT: 0 },
};
export const FAILURES = {
  none:  { name: 'No failures' },
  v1:    { name: 'Engine failure at V1 (continue: rudder, V2, gear up)' },
  climb: { name: 'Engine failure after takeoff (400-1,500 ft)' },
};
export const WEIGHTS = {
  light:   { name: '17,000 lb (light)', kg: 7711 },
  typical: { name: '20,700 lb (typical)', kg: 9400 },
  mtow:    { name: '23,500 lb (max takeoff)', kg: 10659 },
};
const BOW_KG = 6700;                                  // basic operating weight with crew, ~14,800 lb
// Sortie starts. Where the airplane begins is taken from the sortie's airport, runway and approach (the nav database):
// nothing here names a particular airport.
export const STARTS = {
  rwy:    { name: 'Lined up on the departure runway, parking brake set' },
  app:    { name: 'Airborne at the start of the approach, autopilot on (LNAV / VNAV, approach armed)' },
  final:  { name: '6 nm final for the approach runway, 150 KIAS, hand-flown' },
  cruise: { name: 'Cruise FL350, M 0.77, autopilot on, approach loaded' },
};
const brgDeg = (a, b) => ((Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG) % 360 + 360) % 360;
// a runway end ('10L' or 'RW10L') at an airport as a frame (js/ground.js)
export function frameFor(apt, rwy) {
  const id = String(rwy).replace(/^RW/, ''), r = runwayById(apt, id);
  if (!r) throw new Error(`no runway ${id} at ${apt}`);
  return runwayFrame(r, r.ids[1] === id);
}
// the runway an approach lands on: its missed-approach-point fix (RWxx), else the procedure id (I10L -> 10L)
export function approachRunway(legs, procId = '') {
  const m = legs.find((l) => l.map && l.fix && /^RW/.test(l.fix.id)); if (m) return m.fix.id.slice(2);
  const k = procId.match(/(\d\d[LRC]?)/); return k ? k[1] : null;
}
// ---- environment: mean wind with a surface boundary layer, gusts as a band-limited random walk ----
export class FreeEnv {
  constructor(wx = 'calm') {
    this.wxKey = wx; this.wx = WEATHER[wx] || WEATHER.calm; this.dT = this.wx.dT;   // ISA deviation, K
    this.hyp = { name: 'Free flight', tailIce: false, tuck: true, trimRunaway: false, iceGain: 0, shear: 0, apFail: false, machTrimFail: false };
    this.flash = 0; this.flashPos = null; this.flashDist = null; this.nex = null; this.useNex = false; this.glm = null;
    this.gust = [0, 0, 0]; this.ph = Array.from({ length: 6 }, () => Math.random() * 6.28);
    this.L = { core: 0, cloud: 0, updraft: 0, turb: 0, r: 1e9, hf: 0, top: 0, dbz: -30, growth: 0 };
  }
  // NED wind (m/s, the direction the air moves) at pos
  wind(pos, t, dt) {
    const w = this.wx, agl = Math.max(0.5, -pos[2] - groundAlt(pos[0], pos[1]));
    const z0 = 0.03, prof = agl < 300 ? Math.log(agl / z0) / Math.log(10 / z0) : Math.log(300 / z0) / Math.log(10 / z0) * (1 + 0.6 * clamp((agl - 300) / 3000, 0, 1));
    const spd = w.wind * KT * prof, to = (w.from + 180) * DEG;
    const gustK = w.gust ? (w.gust - w.wind) * KT * 0.45 : 0;    // gust spread -> turbulence intensity
    const tl = agl < 600 ? 1 : 0.4;
    for (let i = 0; i < 3; i++) this.gust[i] += ((Math.random() * 2 - 1) * 6 * gustK * tl - this.gust[i] * 1.2) * (dt || 0);
    const s = Math.sin(t * 0.6 + this.ph[0]) * 0.5 + Math.sin(t * 1.7 + this.ph[1]) * 0.3;
    this.L.turb = clamp(gustK / 6, 0, 1) * tl;
    return [spd * Math.cos(to) * (1 + 0.15 * s * (gustK > 0)) + this.gust[0], spd * Math.sin(to) + this.gust[1], this.gust[2] * 0.5];
  }
  scriptedUpset() {}
  iceRates() { return { wing: -0.02, tail: -0.02, eng: -0.05 }; }   // clear air: any ice sheds
}

// ---- placement ----
export function setWeight(ac, key) {
  const kg = (WEIGHTS[key] || WEIGHTS.typical).kg;
  ac.m = kg; ac.fuel = clamp(kg - BOW_KG, 300, 3588);
}
// on the runway centreline `along` metres past the start of the pavement (a displaced threshold is usable for takeoff),
// at rest, struts settled, parking brake set
export function placeOnRunway(ac, f, along = 60, env = { wind: [0, 0, 0] }) {
  const n = f.start[0] + f.u[0] * along, e = f.start[1] + f.u[1] * along;
  ac.setState({ n, e, d: -(groundAlt(n, e) + ac.gnd.elev + 1.52), psi: f.hdg, theta: 0.4 * DEG, phi: 0, V: 0 });
  ac.vel = [0, 0, 0];
  Object.assign(ac.ctl, { gear: 1, flaps: 0.2, sb: 0, thr: 0, elev: 0, ail: 0, rud: 0, park: true, brakeL: 0, brakeR: 0 });
  ac.n1 = 0; ac.ctl.trim = takeoffTrim(ac);
  for (let i = 0; i < 4 * 240; i++) ac.step(1 / 240, env);   // let the struts settle
  ac.maxG = 1; ac.minG = 1; ac.maxM = 0; ac.maxKEAS = 0; ac.maxVS = 0; ac.damage = 0; ac.gnd.events = []; ac.gnd.touchFpm = null;
}
// Takeoff trim: what holds the climb hands-off at about V2 (1.2 x the flaps-8 stall speed), flaps 8, gear down,
// for this weight. The AFM sets it from a CG / weight band; with a fixed CG this is that setting.
export function takeoffTrim(ac) {
  const t = new ac.constructor(); t.m = ac.m; t.fuel = ac.fuel;
  Object.assign(t.ctl, { flaps: 0.2, gear: 1, sb: 0 });
  const vs = 99 + (126 - 99) * (ac.m / 0.45359 - 14000) / 9500;          // AFM Fig 5-22 flaps 8 stall, KCAS
  const h = 300, r = trimFlight(t, { n: 0, e: 0, h, V: tasFor(1.2 * vs, h), gamma: 6 * DEG, psi: 0 });   // near the origin: the spherical-Earth ground rises with distance
  return clamp(r.trim, STAB.min, STAB.max);
}

// Steady flight at true airspeed V (m/s), flight-path angle gamma, heading psi: solves AOA, stabilizer trim and thrust
// by stepping the real model at a frozen state and nulling the accelerations.
export function trimFlight(ac, { n, e, h, V, gamma = 0, psi = 0, dT = 0 }) {
  let alpha = 3 * DEG, thr = 0.5, trim = 0.2, res = null;
  const env = { wind: [0, 0, 0], dT };
  const cg = Math.cos(gamma), sg = Math.sin(gamma);
  const save = () => ({ m: ac.m, fuel: ac.fuel, damage: ac.damage });
  for (let it = 0; it < 120; it++) {
    const s = save();
    ac.setState({ n, e, d: -h, psi, theta: gamma + alpha, phi: 0, V });
    ac.vel = [V * cg * Math.cos(psi), V * cg * Math.sin(psi), -V * sg];
    ac.ctl.thr = thr; ac.n1 = thr; ac.ctl.trim = trim; ac.ctl.elev = 0; ac.ctl.ail = 0; ac.ctl.rud = 0; ac.engAge = 1;
    const dt = 1e-3; const v0 = ac.vel.slice();
    ac.step(dt, env);
    const a = [(ac.vel[0] - v0[0]) / dt, (ac.vel[1] - v0[1]) / dt, (ac.vel[2] - v0[2]) / dt];
    const qd = ac.w[1] / dt;
    Object.assign(ac, s);
    const tang = [cg * Math.cos(psi), cg * Math.sin(psi), -sg], norm = [-sg * Math.cos(psi), -sg * Math.sin(psi), -cg];   // norm: up, perpendicular to the path
    const aT = a[0] * tang[0] + a[1] * tang[1] + a[2] * tang[2], aN = a[0] * norm[0] + a[1] * norm[1] + a[2] * norm[2];
    // Newton steps with the model's own sensitivities: lift slope ~5/rad, trim dCm 0.14, thrust ~3 m/s^2 per lever
    const qS = 0.5 * isa(h, dT).rho * V * V * ac.S;
    alpha = clamp(alpha - 0.8 * aN / (qS * 5 / ac.m), -4 * DEG, 14 * DEG);
    trim = clamp(trim - 0.8 * qd / (qS * ac.c * 0.14 / ac.Iyy), STAB.min, STAB.max);
    thr = clamp(thr - 0.6 * aT / 3, 0, 1);
    res = { aN, aT, qd };
    if (Math.abs(aN) < 0.005 && Math.abs(aT) < 0.005 && Math.abs(qd) < 0.0005) break;
  }
  ac.setState({ n, e, d: -h, psi, theta: gamma + alpha, phi: 0, V });
  ac.vel = [V * cg * Math.cos(psi), V * cg * Math.sin(psi), -V * sg];
  ac.ctl.thr = thr; ac.n1 = thr; ac.ctl.trim = trim; ac.w = [0, 0, 0];
  return { alpha, thr, trim, res };
}
export const tasFor = (kias, h, dT = 0) => { const atm = isa(h, dT); return kias * KT * Math.sqrt(1.225 / atm.rho); };

// Set up a sortie start: s = { apt, start, rwy, app }, legs = the loaded approach (js/navdb.js procedureLegs).
// Returns { onGround, apOn, msg, legIdx (the flight-plan leg to make active), alt (ft, the altitude to preselect) }.
export function setupStart(ac, s, env, legs = []) {
  ac.failures.tailIce = false; ac.failures.tuck = true; ac.ice = 0; ac.iceTail = 0; ac.engIce = 0; ac.hard = true;
  const dT = env ? env.dT : 0, kind = STARTS[s.start] ? s.start : 'rwy';
  if (kind === 'rwy') {
    const f = frameFor(s.apt, s.rwy);
    placeOnRunway(ac, f, 60, { wind: [0, 0, 0], dT });
    return { onGround: true, apOn: false, legIdx: 0, alt: 3000, msg: `Runway ${f.id}, ${s.apt}, ${Math.round(f.L / FT).toLocaleString()} ft of pavement. Parking brake set: press Shift (brakes) to release it. Flaps 8, takeoff trim ${stabDeg(ac.ctl.trim).toFixed(1)}°. Full thrust (T/O), rotate at VR to about +9° (FD), positive rate: gear up (G), flaps up (F) above 160 KIAS.` };
  }
  if (kind === 'final') {
    const rw = approachRunway(legs, s.app), f = frameFor(s.apt, rw), dist = 6 * 1852, h = Math.tan(3 * DEG) * dist + 15 + groundAlt(f.thr[0], f.thr[1]);
    Object.assign(ac.ctl, { gear: 1, flaps: 0.5, sb: 0, park: false });
    trimFlight(ac, { n: f.thr[0] - f.u[0] * dist, e: f.thr[1] - f.u[1] * dist, h, V: tasFor(150, h, dT), gamma: -3 * DEG, psi: f.hdg, dT });
    const k = legs.findIndex((l) => l.map);
    return { onGround: false, apOn: false, legIdx: Math.max(0, k), alt: null, msg: `6 nm final, runway ${rw}. On the 3° path, gear down, flaps 20. Flaps 40 below 165 KIAS; touch down below 600 ft/min.` };
  }
  if (kind === 'app') {
    // three miles before the first fix of the approach, inbound to it on the first leg's course, at its altitude
    const i0 = legs.findIndex((l) => l.fix); if (i0 < 0) throw new Error('approach has no fixes');
    const L0 = legs[i0], nx = legs.slice(i0 + 1).find((l) => l.fix);
    const crs = L0.crsT ?? (nx ? brgDeg(L0.fix.ne, nx.fix.ne) : 0), u = [Math.cos(crs * DEG), Math.sin(crs * DEG)];
    const altFt = L0.alt ? (L0.alt.d === 'B' ? L0.alt.a2 : L0.alt.a1) : 3000, h = altFt * FT, back = 3 * 1852;
    Object.assign(ac.ctl, { gear: 0, flaps: 0.2, sb: 0, park: false });
    trimFlight(ac, { n: L0.fix.ne[0] - u[0] * back, e: L0.fix.ne[1] - u[1] * back, h, V: tasFor(180, h, dT), gamma: 0, psi: crs * DEG, dT });
    return { onGround: false, apOn: true, legIdx: i0, alt: altFt, msg: `${L0.fix.id} in 3 nm at ${altFt.toLocaleString()} ft, 180 KIAS, flaps 8. Autopilot on LNAV / VNAV with the approach armed. No autothrottle: thrust is yours. Gear down and flaps 20 at the final approach fix, flaps 40 for landing.` };
  }
  // cruise: west of the airport at FL350, heading for it
  const apt = frameFor(s.apt, s.rwy || approachRunway(legs, s.app) || '10L');
  const h = 35000 * FT, atm = isa(h, dT), V = 0.77 * atm.a, n = apt.thr[0] + 9000, e = apt.thr[1] - 30000 * 4;
  Object.assign(ac.ctl, { gear: 0, flaps: 0, sb: 0, park: false });
  trimFlight(ac, { n, e, h, V, gamma: 0, psi: Math.atan2(apt.thr[1] - e, apt.thr[0] - n), dT });
  return { onGround: false, apOn: true, legIdx: 0, alt: 35000, msg: `Cruise FL350, M 0.77, 65 nm west. Autopilot on with the approach loaded: LNAV to its first fix (VNAV descends once you preselect a lower altitude).` };
}

// Flight guidance for a sortie start: load the plan into the FMS and set the autopilot / flight director modes as a crew
// would have them at that point. ap: js/scenario.js Autopilot; fms: js/fms.js FMS; r: setupStart's result.
export function configureGuidance(ap, fms, r, s, legs, out) {
  ap.thetaLim = [-10 * DEG, 15 * DEG]; ap.fine = true; ap.fd = true; ap.why = '';
  ap.fms = legs.length ? fms : null; if (legs.length) fms.load(legs, r.legIdx);
  const faf = legs.find((l) => l.faf && l.alt), miss = legs.length ? fms.missedAlt() : null;
  if (r.onGround) { ap.on = false; ap.takeoff(out.psi / DEG, (r.alt || 3000) * FT); return; }
  if (s.start === 'app') {          // established on the procedure: LNAV / VNAV, approach armed, cleared down to the FAF altitude
    ap.on = true; ap.lat = 'LNAV'; ap.vert = 'VNAV'; ap.appr = true; ap.altTgt = (faf ? faf.alt.a1 : r.alt) * FT; return;
  }
  if (s.start === 'final') {        // hand-flown, FD with the approach armed; the missed-approach altitude preselected
    ap.on = false; ap.lat = 'HDG'; ap.hdgTgt = out.psi / DEG; ap.vert = 'ALT'; ap.altTgt = (miss || 3000) * FT; ap.appr = true; return;
  }
  ap.on = true; ap.lat = 'HDG'; ap.hdgTgt = out.psi / DEG; ap.vert = 'ALT'; ap.altTgt = out.h;   // cruise
  if (legs.length) { ap.armLnav(); ap.armVnav(); }
}
