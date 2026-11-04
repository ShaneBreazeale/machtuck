// Ground model for the Learjet 60: oleo struts, tyres, anti-skid brakes, nosewheel steering, ground effect, and contact of
// the airframe itself (tail strike, wingtip strike, gear-up landing, impact).
//
// Geometry from the exterior model (data/ext/README.md, x right / y up / z forward, CG at z -0.39, y 0), in body axes
// (x forward, y right, z down, metres from the CG):
//   nose wheel x 7.34, mains x -0.53 at y +/-1.45; wheel bottoms 1.60 (nose) / 1.67 (mains) below the CG, struts extended.
//   With struts extended the tail strikes at 11.3 deg pitch and a wingtip at 14.5 deg bank (both about the main wheels).
// Strut travel and stiffness are estimates: static compression about a third of the stroke, damping firmer in rebound.
// Touchdown limits are Part 25's: 25.473 limit descent velocity 10 ft/s at design landing weight, 25.723 reserve
// energy 12 ft/s without collapse. Beyond that the gear is damaged, and well beyond it fails.
//
// Ground height is the renderer's spherical-Earth surface (js/shaders.js groundY): Florida is flat and KPBI is 19 ft
// above sea level, which the imagery does not resolve, so the runway sits on that surface.
import { clamp, smoothstep, lerp } from './util.js';
import { mulMV, mulMTV } from './util.js';

export const groundAlt = (n, e) => (n * n + e * e) / 12720000;

// KPBI runways from OpenStreetMap (aeroway=runway ways), metres north / east of the scenario origin (26.6832 N,
// 80.0956 W). Threshold a -> b is the direction of the first designator.
// KPBI airport boundary (OpenStreetMap aeroway=aerodrome, simplified to 32 vertices), [east, north] m. The renderer keeps
// its imagery-driven 3D houses out of it: runway concrete and aprons read as roofs in the aerial photo.
export const AIRPORT = [[-915, 1241], [-1051, 1203], [-1287, 993], [-1389, 962], [-1505, 960], [-1508, 867], [-1480, 791], [-1489, 557], [-1589, 561], [-1594, 518], [-1491, 517], [-1494, 419], [-1597, 421], [-1619, -243], [-1427, -252], [-1436, -531], [-847, -622], [-421, -616], [1013, -662], [1213, -645], [1829, -538], [2008, -447], [2110, -329], [2155, -185], [2164, 151], [2144, 267], [2044, 537], [2032, 789], [2000, 833], [-426, 933], [-559, 980], [-800, 1201]];
export const RUNWAYS = [
  { id: '10L/28R', a: [1.1, -1271.6], b: [-147.7, 1772.4], w: 46 },
  { id: '10R/28L', a: [-223.5, -1063.0], b: [-271.5, -85.9], w: 23 },
  { id: '14/32', a: [959.9, -837.3], b: [-544.2, 650.4], w: 46 },
];
export function runwayFrame(rw, fromB = false) {
  const [a, b] = fromB ? [rw.b, rw.a] : [rw.a, rw.b];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  return { thr: a, end: b, u, L, w: rw.w, hdg: Math.atan2(u[1], u[0]) };   // hdg: true heading, rad
}
// which runway (and which end, by direction of travel) a point is on: distance past the threshold, offset (+ = right
// of the centreline), runway left. null off the runways.
export function runwayAt(n, e, track) {
  for (const rw of RUNWAYS) for (const fromB of [false, true]) {
    const f = runwayFrame(rw, fromB); if (Math.cos(track - f.hdg) < 0.5) continue;
    const dn = n - f.thr[0], de = e - f.thr[1], s = dn * f.u[0] + de * f.u[1], c = -dn * f.u[1] + de * f.u[0];
    if (s >= -300 && s <= f.L + 60 && Math.abs(c) <= f.w / 2 + 25) {
      const ids = rw.id.split('/'); return { id: fromB ? ids[1] : ids[0], s, c, left: f.L - s, L: f.L };
    }
  }
  return null;
}
// 'paved' on a runway, 'grass' elsewhere (taxiways and aprons are not modelled yet)
export function surfaceAt(n, e) {
  for (const rw of RUNWAYS) {
    const f = runwayFrame(rw), dn = n - f.thr[0], de = e - f.thr[1];
    const s = dn * f.u[0] + de * f.u[1], c = -dn * f.u[1] + de * f.u[0];
    if (s >= -30 && s <= f.L + 30 && Math.abs(c) <= f.w / 2 + 1.5) return 'paved';
  }
  return 'grass';
}
// friction: rolling, peak tyre, anti-skid braking (fraction of load)
export const SURFACE = {
  paved: { roll: 0.015, peak: 0.8, brake: 0.40 },   // anti-skid dry; with the torque cap below this reproduces the AFM landing rolls (Fig 5-74)
  wet:   { roll: 0.015, peak: 0.45, brake: 0.20 },
  grass: { roll: 0.06, peak: 0.45, brake: 0.25 },
};

// Ground effect from the wing's height above ground h (m) over span b (McCormick): induced drag falls by phi,
// lift at a given AOA rises, and the weaker downwash at the T-tail pitches the nose down (more pull to flare).
export function groundEffect(h, b) {
  const x = Math.max(h, 0.05) / b, s = (16 * x) ** 2;
  const near = 1 - smoothstep(0, 1, x);
  return { kInd: s / (1 + s), lift: 1 + 0.12 * near, cm: -0.03 * near };
}

const G0 = 9.80665;
const NOMINAL_KG = 9400;
function leg(name, r, stroke, share, steer, brake) {
  const W = share * NOMINAL_KG * G0, k = W / (0.35 * stroke), m = share * NOMINAL_KG;
  return { name, r, stroke, k, cIn: 2 * 0.45 * Math.sqrt(k * m), cOut: 2 * 0.9 * Math.sqrt(k * m), steer, brake, contact: false, load: 0, comp: 0 };
}
const NOSE_SHARE = 0.53 / 7.87;
// airframe points that must not touch: name, body position (m), what it means if they do
const HARD = [
  { name: 'tail', r: [-8.06, 0, 0.09], kind: 'tail' },
  { name: 'left wingtip', r: [-1.17, -5.9, 0.44], kind: 'tip' },
  { name: 'right wingtip', r: [-1.17, 5.9, 0.44], kind: 'tip' },
  { name: 'nose', r: [7.9, 0, 0.77], kind: 'belly' },
  { name: 'forward belly', r: [4.5, 0, 0.91], kind: 'belly' },
  { name: 'belly', r: [0.4, 0, 0.92], kind: 'belly' },
  { name: 'aft belly', r: [-2.6, 0, 0.76], kind: 'belly' },
];
export const LIMITS = { hardFps: 10, damageFps: 12, collapseFps: 16 };
export const BRAKE = { cap: 13000 };   // N of braking per main gear: brake torque limit (heavier landings brake less than the friction allows)
const FPS = 0.3048;

export class Ground {
  constructor() {
    this.legs = [
      leg('nose', [7.34, 0, 1.60], 0.25, NOSE_SHARE, true, false),
      leg('left main', [-0.53, -1.45, 1.67], 0.30, (1 - NOSE_SHARE) / 2, false, 'L'),
      leg('right main', [-0.53, 1.45, 1.67], 0.30, (1 - NOSE_SHARE) / 2, false, 'R'),
    ];
    this.hardOn = new Set(); this.events = []; this.wow = false; this.touchFpm = null; this.gearDamage = 0; this.collapsed = false;
    this.wet = false; this.steer = 0;
    this.elev = 0;                       // field elevation above the scenario's sea-level surface (m), for performance tests
  }
  // nosewheel steering through the rudder pedals: wide at taxi speed, a few degrees at takeoff speed
  steerLimit(v) { return lerp(45, 7, smoothstep(3, 25, Math.abs(v))) * Math.PI / 180; }

  // Forces and moments in body axes on the airframe from everything touching the ground. ac: Learjet60 state;
  // R: body->NED rotation (flat row-major 3x3); ctl: controls (gear, rud, brakeL, brakeR, park). Returns null when nothing is near.
  contact(ac, R, ctl) {
    const pos = ac.pos, vel = ac.vel, w = ac.w;
    const F = [0, 0, 0], M = [0, 0, 0];
    let wow = false, crash = null, dmg = 0;
    const vNorm = (r) => { const wr = [w[1] * r[2] - w[2] * r[1], w[2] * r[0] - w[0] * r[2], w[0] * r[1] - w[1] * r[0]]; const vw = mulMV(R, wr); return [vel[0] + vw[0], vel[1] + vw[1], vel[2] + vw[2]]; };
    const apply = (r, fN) => {   // fN: force in NED at body point r
      const fb = mulMTV(R, fN);
      F[0] += fb[0]; F[1] += fb[1]; F[2] += fb[2];
      M[0] += r[1] * fb[2] - r[2] * fb[1]; M[1] += r[2] * fb[0] - r[0] * fb[2]; M[2] += r[0] * fb[1] - r[1] * fb[0];
    };
    // horizontal heading of the airframe
    const bx = [R[0], R[3]], bl = Math.hypot(bx[0], bx[1]) || 1; const fwd0 = [bx[0] / bl, bx[1] / bl];
    const cosT = clamp(R[8], 0.3, 1);                       // strut axis (body z) against the vertical
    const gs = Math.hypot(vel[0], vel[1]);
    const gearDown = ctl.gear >= 1 && !this.collapsed;
    for (const L of this.legs) {
      if (!gearDown) { L.contact = false; L.load = 0; L.comp = 0; continue; }
      const rw = mulMV(R, L.r), p = [pos[0] + rw[0], pos[1] + rw[1], pos[2] + rw[2]];
      const pen = groundAlt(p[0], p[1]) + this.elev + p[2];    // wheel bottom below the ground (m, NED down positive)
      if (pen <= 0) { L.contact = false; L.load = 0; L.comp = 0; continue; }
      const v = vNorm(L.r);
      if (!L.contact) {                                         // first touch: the descent rate is what the gear has to absorb
        const fps = v[2] / FPS; this.events.push({ type: 'touch', leg: L.name, fps });
        const say = (txt) => { if (!this.said) { this.said = true; this.events.push({ type: 'msg', txt }); } };   // one call per landing
        if (L.name !== 'nose') this.touchFpm = Math.max(this.touchFpm ?? 0, v[2] * 196.85);
        if (fps > LIMITS.collapseFps) { this.collapsed = true; crash = `GEAR COLLAPSE — touchdown at ${Math.round(fps * 60)} ft/min`; }
        else if (fps > LIMITS.damageFps) { this.gearDamage += (fps - LIMITS.damageFps) / (LIMITS.collapseFps - LIMITS.damageFps); say(`HARD LANDING — ${Math.round(fps * 60)} ft/min, gear damaged`); }
        else if (fps > LIMITS.hardFps) say(`HARD LANDING — ${Math.round(fps * 60)} ft/min (limit 600)`);
      }
      L.contact = true;
      const comp = pen / cosT, rate = v[2] / cosT;
      let f = L.k * comp + (rate > 0 ? L.cIn : L.cOut) * rate;
      if (comp > L.stroke) f += 25 * L.k * (comp - L.stroke);   // bottomed: tyre and structure
      f = Math.max(0, f); L.load = f; L.comp = comp;
      const N = f * cosT;
      // tyre: rolling direction (nose wheel steered), slip velocities in the ground plane
      let fw = fwd0;
      if (L.steer) { const a = clamp(ctl.rud || 0, -1, 1) * this.steerLimit(gs); this.steer = a; const c = Math.cos(a), s = Math.sin(a); fw = [fw[0] * c - fw[1] * s, fw[0] * s + fw[1] * c]; }
      const rt = [-fw[1], fw[0]];
      const vl = v[0] * fw[0] + v[1] * fw[1], vt = v[0] * rt[0] + v[1] * rt[1];
      const sf = SURFACE[this.wet && surfaceAt(p[0], p[1]) === 'paved' ? 'wet' : surfaceAt(p[0], p[1])];
      const brk = L.brake ? Math.max(ctl.park ? 1 : 0, L.brake === 'L' ? ctl.brakeL || 0 : ctl.brakeR || 0) : 0;
      const muB = brk * lerp(sf.peak, sf.brake, smoothstep(0.3, 3, Math.abs(vl)));   // a held brake is static friction
      const bF = Math.abs(vl) < 3 ? muB * N : Math.min(muB * N, brk * BRAKE.cap);   // held brakes at a standstill: static friction only
      let fl = -(sf.roll * N + bF) * Math.tanh(vl / 0.05);
      let ft = -sf.peak * N * Math.tanh(vt / Math.max(0.08, 0.12 * Math.abs(vl)));
      const tot = Math.hypot(fl, ft), cap = sf.peak * N + sf.roll * N;
      if (tot > cap) { fl *= cap / tot; ft *= cap / tot; }
      apply(L.r, [fl * fw[0] + ft * rt[0], fl * fw[1] + ft * rt[1], -N]);
      wow = wow || (L.name !== 'nose' && N > 0);
    }
    // the airframe itself
    for (const H of HARD) {
      const rw = mulMV(R, H.r), p = [pos[0] + rw[0], pos[1] + rw[1], pos[2] + rw[2]];
      const pen = groundAlt(p[0], p[1]) + this.elev + p[2];
      if (pen <= 0) { this.hardOn.delete(H.name); continue; }
      const v = vNorm(H.r);
      if (!this.hardOn.has(H.name)) {
        this.hardOn.add(H.name);
        const fps = v[2] / FPS;
        if (fps > 10) crash = crash || `IMPACT — ${H.name} hit the ground at ${Math.round(Math.hypot(gs, v[2]) / 0.514444)} kt`;
        else if (H.kind === 'belly' && !gearDown) crash = crash || (ctl.gear >= 1 ? 'GEAR COLLAPSED — fuselage on the runway' : 'GEAR-UP LANDING');
        else if (H.kind === 'tail') { this.events.push({ type: 'msg', txt: 'TAIL STRIKE' }); dmg += 0.08; }
        else if (H.kind === 'tip') { this.events.push({ type: 'msg', txt: `${H.name.toUpperCase()} STRIKE` }); dmg += 0.1; }
        else if (H.kind === 'belly') this.events.push({ type: 'msg', txt: 'FUSELAGE CONTACT' });
      }
      // stiff skin contact, sliding friction
      const N = Math.max(0, 2.0e6 * pen + 6.0e4 * v[2]);
      const vh = Math.hypot(v[0], v[1]), mu = 0.45 * N * Math.tanh(vh / 0.3);
      apply(H.r, [vh > 1e-6 ? -mu * v[0] / vh : 0, vh > 1e-6 ? -mu * v[1] / vh : 0, -N]);
    }
    if (crash) this.events.push({ type: 'crash', txt: crash });
    this.wow = wow;
    return { F, M, wow, crash, dmg };
  }
  // well clear of the ground: nothing in contact
  airborne() { for (const L of this.legs) { L.contact = false; L.load = 0; L.comp = 0; } this.hardOn.clear(); this.wow = false; this.said = false; }
  drain() { const e = this.events; this.events = []; return e; }
}
