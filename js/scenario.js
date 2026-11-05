// Scenario: N722BD, 1 Nov 2026, 12:47:00-12:49:32 EST. Coordinates: NED meters, origin = KPBI runway 10L/28R midpoint.
// Reconstruction from publicly reported ADS-B / NEXRAD / ATC figures. Provisional; cause under NTSB investigation.
import { DEG, RAD, clamp, lerp, smoothstep, wrap180, wrap360 } from './util.js';
import { FT, KT } from './atmo.js';
import { shakerAoaN, ELEV_K, STAB } from './aircraft.js';

export const T0_CLOCK = 12 * 3600 + 47 * 60;   // 12:47:00 EST = t 0
export const clockStr = (t) => { const s = Math.max(0, Math.floor(T0_CLOCK + t)); const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60; return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`; };

// Convective cell (KAMX radar): ~9.5 mi W, 2 mi N of PBI. 30 dBZ top 33,600 ft @12:43 -> 41,000 @12:48 -> 48,300 @12:56.
export const STORM = {
  n: 3200, e: -15300,                 // core center (NED)
  rCore: 2600,                        // radius of 30+ dBZ core, m
  rCloud: 7000,                       // visible cloud tower radius
  base: 1200,                         // m
  top: (t) => 11900 + 7.6 * t,        // m; 39,000 ft at 12:47 growing ~1,500 ft/min (30 dBZ top + ~1 km)
  wUp: 18,                            // peak updraft, m/s
  drift: [2.5, -2.5],                 // NW drift, m/s (n, e)
};

// Piecewise-linear helpers
const pl = (pts, t) => { if (t <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return lerp(va, vb, (t - a) / (b - a)); } return pts[pts.length - 1][1]; };

// Ghost schedule (reported figures): heading, vertical speed, true airspeed vs t.
const HDG = [[0, 58], [25, 58], [70, 100], [76, 100], [151, 292]];
const VS = [[0, 0], [56, 0], [58, 5.1], [70, 5.1], [76, 0], [84, -51], [100, -102], [116, -163], [133, -173], [147, -267], [160, -267]];
const TAS = [[0, 232], [76, 232], [92, 278], [120, 300], [135, 305], [152, 290]];

export function buildGhost() {
  const pts = []; let n = 0, e = 0, alt = 35000 * FT; const dt = 0.1;
  for (let t = 0; t < 200; t += dt) {
    const hdg = pl(HDG, t) * DEG, vs = pl(VS, t), V = pl(TAS, t);
    const vh = Math.sqrt(Math.max(0, V * V - vs * vs));
    if (Math.round(t * 10) % 5 === 0) pts.push({ t: +t.toFixed(1), n, e, d: -alt, hdg, V, vs, gamma: Math.asin(clamp(vs / V, -1, 1)) });
    n += vh * Math.cos(hdg) * dt; e += vh * Math.sin(hdg) * dt; alt += vs * dt;
    if (alt <= 0) { pts.push({ t: +t.toFixed(1), n, e, d: 0, hdg, V, vs, gamma: Math.asin(clamp(vs / V, -1, 1)) }); break; }
  }
  // Anchor: core entry at t=56 (12:47:56) at the storm center.
  const a = pts.find(p => p.t >= 56);
  const dn = STORM.n - a.n, de = STORM.e - a.e;
  for (const p of pts) { p.n += dn; p.e += de; }
  return pts;
}
export function ghostAt(ghost, t) {
  if (t <= ghost[0].t) return ghost[0];
  const last = ghost[ghost.length - 1]; if (t >= last.t) return last;
  const i = Math.min(ghost.length - 1, Math.max(1, Math.floor(t * 2)));
  let lo = i; while (lo > 0 && ghost[lo].t > t) lo--; while (lo < ghost.length - 2 && ghost[lo + 1].t <= t) lo++;
  const A = ghost[lo], B = ghost[lo + 1], f = (t - A.t) / (B.t - A.t);
  return { t, n: lerp(A.n, B.n, f), e: lerp(A.e, B.e, f), d: lerp(A.d, B.d, f), hdg: A.hdg + wrap180((B.hdg - A.hdg) * RAD) * DEG * f, V: lerp(A.V, B.V, f), vs: lerp(A.vs, B.vs, f), gamma: lerp(A.gamma, B.gamma, f) };
}

// Annotations on the actual flight (from ATC/LiveATC + radar graphic timeline). Crew final words intentionally omitted.
export const TIMELINE = [
  { t: 0, who: 'FO', txt: 'Miami Center, 722 Bravo Delta: light clear ice, manageable. Moderate turbulence, plus or minus seven hundred.' },
  { t: 8, who: 'MIA', txt: '722 Bravo Delta, roger. Deviations left and right of course approved, moderate precipitation to the southeast.' },
  { t: 33, who: 'FO', txt: 'Managing the ice, minus fifty-three Fahrenheit.' },
  { t: 56, who: 'SYS', txt: 'ENTERING CONVECTIVE CORE (34 dBZ at FL350, 52 dBZ below)' },
  { t: 62, who: 'FO', txt: 'Picking up more precip, request flight level three seven zero.' },
  { t: 70, who: 'MIA', txt: '722 Bravo Delta, standby for higher.' },
  { t: 88, who: 'ACT', txt: 'ACTUAL FLIGHT 12:48:28: Mayday, descending 10,000 ft/min.' },
  { t: 97, who: 'ACT', txt: 'ACTUAL FLIGHT 12:48:37: Overspeed, descending 20,000 ft/min.' },
  { t: 122, who: 'ACT', txt: 'ACTUAL FLIGHT 12:49:02: Banking 60 degrees.' },
  { t: 152, who: 'ACT', txt: 'ACTUAL FLIGHT 12:49:32: Impact, Military Trail near Greenacres.' },
];

export const HYPOTHESES = {
  combined: { name: 'Convective core: shear + rapid SLD icing + Mach tuck (most consistent with data)', tailIce: true, tuck: true, trimRunaway: false, iceGain: 1.0, shear: 1.0 },
  tail:     { name: 'Ice-contaminated tailplane stall', tailIce: true, tuck: false, trimRunaway: false, iceGain: 1.3, shear: 0.7 },
  tuck:     { name: 'Updraft overshoot, overspeed and Mach tuck (Mach trim fails)', tailIce: false, tuck: true, trimRunaway: false, iceGain: 0.6, shear: 1.3, apFail: true, machTrimFail: true },
  trim:     { name: 'Runaway nose-down pitch trim in turbulence', tailIce: false, tuck: true, trimRunaway: true, iceGain: 0.5, shear: 0.6 },
};

// ---------------- NEXRAD reflectivity volume (gridded by tools/grid_nexrad.py) ----------------
export class NexradField {
  constructor(meta, data) { Object.assign(this, meta); this.data = data; }
  static async load(base) {
    const meta = await (await fetch(base + '.json')).json();
    const data = new Uint8Array(await (await fetch(base + '.bin')).arrayBuffer());
    return new NexradField(meta, data);
  }
  idx(n, e, h) {
    const ix = Math.floor((e - this.x0) / this.d), iy = Math.floor((h - this.y0) / this.d), iz = Math.floor((n - this.z0) / this.d);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz) return -1;
    return (iz * this.ny + iy) * this.nx + ix;
  }
  dbz(n, e, h) { const i = this.idx(n, e, h); if (i < 0) return -30; const v = this.data[i]; return v === 0 ? -30 : v / 4 - 10; }
  // max dBZ in a height band (for the cockpit radar)
  dbzBand(n, e, h0, h1) {
    let m = -30; for (let h = h0; h <= h1; h += this.d) m = Math.max(m, this.dbz(n, e, h)); return m;
  }
}
// Sim-time (s after 12:47:00 EST) of the gridded volumes
export const NEXRAD_VOLUMES = [{ base: 'data/kamx_174548', t: -72 }, { base: 'data/kamx_175104', t: 244 }];

// ---------------- Storm environment ----------------
export class Environment {
  constructor(hyp = 'combined', hard = true) {
    this.hyp = HYPOTHESES[hyp]; this.hypKey = hyp; this.hard = hard;
    this.seed = Math.random() * 1000;
    this.flash = 0; this.nextFlash = 3;
    this.phases = Array.from({ length: 12 }, () => Math.random() * 6.28);
    this.gust = [0, 0, 0];
    this.nex = null; this.useNex = true;     // set by main once the volumes load
    this.glm = null; this.glmIdx = 0; this.strokes = []; this.flashPos = null; this.flashDist = null;   // GLM flashes, set by main
  }
  nexDbz(pos, t, which = 'mix') {
    if (!this.nex) return -30;
    const h = -pos[2]; const a = this.nex[0], b = this.nex[1];
    const da = a.f.dbz(pos[0], pos[1], h), db = b.f.dbz(pos[0], pos[1], h);
    if (which === 'a') return da; if (which === 'b') return db;
    const w = clamp((t - a.t) / (b.t - a.t), 0, 1); return lerp(da, db, w);
  }
  // Returns {core: 0..1 (in-core intensity), cloud: 0..1 (in cloud), updraft m/s, turb 0..1}
  local(pos, t) {
    const h = -pos[2];
    const cn = STORM.n + STORM.drift[0] * t, ce = STORM.e + STORM.drift[1] * t;
    const r = Math.hypot(pos[0] - cn, pos[1] - ce);
    const top = STORM.top(t);
    const hf = (h - STORM.base) / (top - STORM.base);
    const vert = smoothstep(0, 0.05, hf) * (1 - smoothstep(0.8, 1.0, hf));
    const core = Math.exp(-((r / STORM.rCore) ** 2)) * vert;
    const cloudT = (1 - smoothstep(0.6, 1.0, r / STORM.rCloud)) * vert;
    // stratiform deck 22,000-33,000 ft around the cell (broken), plus the tower
    const deck = (h > 6400 && h < 10400) ? 0.6 : (h < 10700 ? 0.25 : 0);
    let cloud = clamp(Math.max(cloudT, deck), 0, 1);
    let coreN = core, dbz = -30, growth = 0;
    if (this.nex && this.useNex) {
      // Real echoes: cloud where >5 dBZ, core where >25 dBZ; growth between volumes marks the updraft
      const da = this.nexDbz(pos, t, 'a'), db = this.nexDbz(pos, t, 'b');
      dbz = lerp(da, db, clamp((t - this.nex[0].t) / (this.nex[1].t - this.nex[0].t), 0, 1));
      growth = db - da;
      const cloudR = smoothstep(3, 16, dbz), coreR = smoothstep(22, 42, dbz);
      cloud = clamp(Math.max(cloud, cloudR), 0, 1);
      coreN = clamp(Math.max(0.5 * core, coreR + 0.3 * smoothstep(5, 20, growth) * cloudR), 0, 1);
    }
    // updraft: strong in core, compensating downdraft ring just outside (exit shear)
    const ring = Math.exp(-(((r - STORM.rCore * 1.5) / (STORM.rCore * 0.5)) ** 2));
    // Exit shear: the ADS-B climb ends at 12:48:16 (t=76) with an abrupt reversal. Scripted downdraft pulse on the core's edge.
    // 12:48:06-16 balloon (+450 ft) on a gust inside the cell, then an abrupt reversal at 12:48:16.
    const balloon = smoothstep(64, 67, t) * (1 - smoothstep(74, 76, t));
    const pulse = smoothstep(75, 77, t) * (1 - smoothstep(81, 85, t));
    let updraft = (STORM.wUp * coreN - 9 * ring * vert + 14 * balloon - 24 * pulse) * this.hyp.shear;
    // Real echoes: reflectivity growing between volumes marks the updraft, decaying marks downdraft
    if (this.nex && this.useNex) updraft += (6 * smoothstep(5, 20, growth) - 5 * smoothstep(5, 20, -growth)) * (cloud > 0.2 ? 1 : 0) * this.hyp.shear;
    // Severe turbulence persists in the dive: the track stays in and under the cell's downshear for ~40 s after exit
    const under = smoothstep(70, 78, t) * (1 - smoothstep(110, 125, t));
    const turb = clamp(0.25 * (cloud > 0 ? 1 : 0.3) + 1.2 * coreN + 0.6 * ring * vert + 0.9 * under, 0, 1.6);
    return { core: coreN, cloud, updraft, turb, r, hf, top, dbz, growth };
  }
  // Wind in NED at aircraft position. Mean wind 20 kt from 230 at altitude.
  wind(pos, t, dt) {
    const L = this.local(pos, t);
    const h = -pos[2];
    const alt = clamp(h / 10668, 0, 1);
    const meanSpd = 10 * alt, meanDir = (230 + 180) * DEG;   // blowing toward 050
    const mean = [meanSpd * Math.cos(meanDir), meanSpd * Math.sin(meanDir), 0];
    // turbulence: sum of sines + random walk, scaled by local intensity (moderate outside, severe in core)
    const A = 3.5 * L.turb;
    const ph = this.phases;
    const sx = Math.sin(t * 0.9 + ph[0]) * 0.5 + Math.sin(t * 2.3 + ph[1]) * 0.3 + Math.sin(t * 5.1 + ph[2]) * 0.2;
    const sy = Math.sin(t * 0.7 + ph[3]) * 0.5 + Math.sin(t * 1.9 + ph[4]) * 0.3 + Math.sin(t * 4.3 + ph[5]) * 0.2;
    const sz = Math.sin(t * 0.17 + ph[6]) * 0.6 + Math.sin(t * 1.3 + ph[7]) * 0.5 + Math.sin(t * 3.7 + ph[8]) * 0.3 + Math.sin(t * 7.9 + ph[9]) * 0.15;
    for (let i = 0; i < 3; i++) this.gust[i] += ((Math.random() * 2 - 1) * 9 * L.turb - this.gust[i] * 1.5) * dt;
    const w = [mean[0] + A * sx + this.gust[0], mean[1] + A * sy + this.gust[1], -L.updraft + A * 1.6 * sz + this.gust[2]];
    // lightning
    this.flash = Math.max(0, this.flash - dt * 6);
    if (this.glm) {
      // Real lightning: GOES-19 GLM flashes (data/glm_flashes.json), each played as 2-4 return strokes over its duration.
      // Brightness falls with distance; position drives the in-cloud illumination in the renderer.
      while (this.glmIdx < this.glm.length && this.glm[this.glmIdx].t <= t) {
        const f = this.glm[this.glmIdx++]; const d = Math.hypot(f.n - pos[0], f.e - pos[1]);
        if (d > 70000 || t - f.t > 1) continue;
        const n = 2 + Math.floor((f.dur || 0) * 6) % 3; for (let k = 0; k < n; k++) this.strokes.push({ t: f.t + (f.dur || 0.2) * k / Math.max(1, n - 1), f, d });
      }
      for (let i = this.strokes.length - 1; i >= 0; i--) { const s = this.strokes[i]; if (s.t <= t) {
        this.flash = Math.max(this.flash, clamp(1.15 - s.d / 35000, 0.2, 1)); this.flashPos = [s.f.e, 7000 + 3000 * Math.random(), s.f.n]; this.flashDist = s.d; this.flashId = s.f.t; this.strokes.splice(i, 1); } }
    } else {
      this.nextFlash -= dt * (0.3 + 2.5 * L.core + 0.6 * (L.cloud > 0.3 ? 1 : 0));
      if (this.nextFlash <= 0) { this.flash = 1; this.nextFlash = 1.5 + Math.random() * 6; this.flashPos = null; this.flashDist = null; }
    }
    this.L = L;
    return w;
  }
  // Deterministic upset trigger at 12:48:16 so every hypothesis starts from the recorded moment.
  scriptedUpset(ac, ap, t) {
    if (t < 76 || t > 77.5) return;
    if (this.hyp.tailIce && !ac.tailStalled && ac.iceTail > 0.35) ac.tailStalled = true;
    // As flown: the servo had been trimming nose-down chasing the balloon; the airplane is handed over trimmed ND. This and
    // the autopilot's trim rate are the ONLY things the mode changes: the airplane and the storm are the same in both.
    if (this.hard && this.hyp.tailIce) ac.ctl.trim = Math.min(ac.ctl.trim, -0.35);
    if (this.hyp.apFail && ap.on) { ac.ctl.trim = Math.min(ac.ctl.trim, -0.45); ap.disconnect('OVERSPEED'); }
  }
  // Ice accretion rates per second for wing, T-tail and engine inlets, given the anti-ice systems.
  // Wing heat is bleed air: weak at idle. Stab heat is electric. Supercooled large drops in the core overwhelm both.
  iceRates(L, ac) {
    const sys = ac.sys, n1 = ac.n1;
    let r = 0.004 * (L.cloud > 0.2 ? 1 : 0) + 0.04 * L.core;
    r *= this.hyp.iceGain;
    const clear = L.cloud < 0.2;
    const wingEff = sys.wingHeat ? clamp((n1 - 0.2) / 0.3, 0.1, 1) : 0;
    const wing = clear ? -0.003 - 0.02 * wingEff : r * (1 - 0.75 * wingEff) - 0.012 * wingEff;
    // SLD in the growing core overwhelms stab heat: heat trims accretion ~25% there, but clears the tail fast once out of it
    const tail = clear ? -0.003 - (sys.stabHeat ? 0.025 : 0) : r * (sys.stabHeat ? 0.78 : 1.15) - (sys.stabHeat ? 0.003 : 0);
    const eng = sys.nacelleHeat ? -0.05 : (clear ? -0.01 : r * 0.8);
    return { wing, tail, eng };
  }
  iceRate(L, h, antiIce) { return this.iceRates(L, { sys: { wingHeat: antiIce, stabHeat: antiIce, nacelleHeat: true }, n1: 0.6 }).wing; }
}

// ---------------- Flight guidance: autopilot + flight director (no autothrottle on the Learjet 60) ----------------
// Modes after AC 25.1329-1C chapter 6. Lateral: HDG (select; turns the way the bug was spun, even past 180 deg), LOC,
// LNAV (the flight plan in js/fms.js). Vertical: ALT, ALTS (altitude capture, armed at all times), VS, VNAV (the plan's
// constraints, never climbing or descending through the preselected altitude except on final), GS, GP (an RNAV
// approach's final path), TO and GA (pitch attitude; GA climbs until the preselected altitude is above the airplane).
// Armed modes (latArm, vertArm) wait for their capture criteria and are annunciated alongside the active ones.
// The accident flies HDG + ALT with the cruise pitch law it was calibrated with.
export class Autopilot {
  constructor(hard = true) {
    this.on = true; this.altTgt = 35000 * FT; this.hdgTgt = 58; this.trimRate = hard ? 0.35 : 0.08; this.why = ''; this.trimLim = [STAB.min, STAB.max];   // the stabilizer's travel, 1-12 deg (PTM)
    this.lat = 'HDG'; this.vert = 'ALT'; this.vsTgt = 0; this.appr = false; this.nav = null; this.ils = null;
    this.latArm = null; this.vertArm = null;  // armed modes: 'LOC' | 'LNAV'; 'GS' | 'GP' | 'VNAV'
    this.fms = null; this.fmsG = null; this.vnav = null;   // flight plan (js/fms.js): its lateral guidance and vertical target this step
    this.agl = 0;                            // height above the ground, m (LNAV engages after takeoff / go-around at 400 ft)
    this.thetaLim = [-2.5 * DEG, 4 * DEG];   // cruise; free flight widens it for slow flight and approaches
    this.fine = false;                       // free flight: PI vertical-speed loop (the accident keeps the calibrated cruise law)
    this.thRef = null;
    this.fd = false;                         // flight director: the same guidance drawn as command bars, with or without the AP
    this.fdTheta = null; this.fdPhi = null;  // its pitch and bank commands, rad
    this.toPitch = 9 * DEG; this.gaPitch = 10 * DEG;   // TO: the AFM rotation attitude; GA: go-around pitch
    this.hdgLeft = null; this.lastPsi = null;          // heading select: degrees still to turn when the bug was spun past 180
  }
  disconnect(why) { if (this.on) { this.on = false; this.why = why; if (!this.fd) { this.appr = false; this.latArm = this.vertArm = null; } } }
  engage(out) {
    if (Math.abs(out.phi) > 30 * DEG || Math.abs(out.theta) > 15 * DEG || out.stalled) return false;
    this.on = true; this.why = ''; this.thRef = null;
    // with the flight director on, the autopilot flies its modes (a takeoff or go-around keeps climbing to the
    // preselected altitude); otherwise it holds what the airplane is doing
    if (this.fd && this.fdTheta !== null) return true;
    this.altTgt = out.h; this.hdgTgt = wrap360(out.psi * RAD); this.lat = 'HDG'; this.vert = 'ALT'; this.appr = false; this.latArm = this.vertArm = null; return true;
  }
  // a new preselected altitude: climb or descend toward it in VS mode, then capture it (VNAV, GS and GP keep flying)
  setAlt(h, out) {
    this.altTgt = h; if ((!this.on && !this.fd) || /^(GS|GP|TO|GA|VNAV)$/.test(this.vert)) return;
    const dh = h - out.h; if (Math.abs(dh) > 30) { this.vert = 'VS'; this.vsTgt = dh > 0 ? (out.h < 3000 ? 7.6 : 5.1) : -7.6; } else this.vert = 'ALT';
  }
  // heading select: HDG mode on the new bug (leaves LOC / LNAV; the approach disarms)
  setHdg(deg, keepTurn = false) {
    this.hdgTgt = wrap360(deg); if (!keepTurn) this.hdgLeft = null;
    if (this.lat !== 'HDG') { this.lat = 'HDG'; this.latArm = null; this.appr = false; if (this.vert === 'GS' || this.vert === 'GP') { this.vert = 'ALT'; this.vertArm = null; } }
  }
  // the heading knob: the airplane turns the way it was spun (AC 25.1329-1C 63b, CS/14 CFR 25.779)
  bumpHdg(d, psiDeg) {
    this.hdgLeft = (this.hdgLeft ?? wrap180(this.hdgTgt - psiDeg)) + d;
    this.setHdg(this.hdgTgt + d, true);
  }
  // LNAV / VNAV buttons: arm (engage when the capture criteria are met)
  armLnav() { if (!this.fms || !this.fms.active) return false; if (this.lat !== 'LNAV') this.latArm = 'LNAV'; return true; }
  armVnav() { if (!this.fms || !this.fms.active) return false; if (this.vert !== 'VNAV') this.vertArm = 'VNAV'; return true; }
  // go-around: the AP lets go, the FD commands the go-around pitch wings-level on the current (or localizer) heading,
  // LNAV arms to fly the published missed approach from the flight plan (engages at 400 ft). The preselected altitude
  // is not touched: the climb continues until it is above the airplane and captured.
  goAround(out) {
    const d = this.ils;
    this.hdgTgt = wrap360((d && d.locValid && this.lat === 'LOC' ? d.course : out.psi) * RAD); this.hdgLeft = null;
    this.lat = 'HDG'; this.vert = 'GA'; this.appr = false; this.vertArm = null; this.fd = true; this.thRef = null;
    this.latArm = this.fms && this.fms.active ? 'LNAV' : null;
    if (this.on) this.disconnect('GO AROUND');
  }
  // takeoff: FD pitch to the rotation attitude on the runway heading; LNAV arms if a departure is loaded
  takeoff(hdgDeg, alt) { this.fd = true; this.lat = 'HDG'; this.vert = 'TO'; this.hdgTgt = wrap360(hdgDeg); this.hdgLeft = null; this.altTgt = alt; this.appr = false; this.thRef = null; this.latArm = this.fms && this.fms.active ? 'LNAV' : null; this.vertArm = null; }
  // annunciation: [active lateral, armed lateral, active vertical, armed vertical]
  modes() { return { lat: this.lat, latArm: this.latArm, vert: this.vert, vertArm: this.vertArm }; }
  step(ac, dt, out) {
    const { h, vs, theta, phi, psi, p, q, M } = out;
    const psiD = psi * RAD, trkD = (out.track ?? psi) * RAD;
    // navigation runs whatever the AP / FD are doing: the ILS ahead, and the flight plan sequencing its legs
    const d = this.nav ? this.nav(out) : null; this.ils = d;
    const g = this.fms ? this.fms.update({ ne: [ac.pos[0], ac.pos[1]], h: h / FT, trk: trkD, hdg: psiD, gs: Math.max(30, out.gs || out.V || 0), dt }) : null;
    this.fmsG = g; this.vnav = this.fms && g ? this.fms.vertical({ ne: [ac.pos[0], ac.pos[1]], h: h / FT }) : null;
    this.agl = out.agl ?? h;
    if (!this.on && !this.fd) { this.lastPsi = psiD; return; }
    // approach: an ILS arms LOC + GS; a localizer-only approach (LOC, LDA) LOC + GP; RNAV LNAV + GP. With no
    // approach in the plan, the localizer ahead with its glideslope.
    if (this.appr) {
      const plan = this.fms && this.fms.fafIndex() >= 0, proc = plan ? this.fms.legs[this.fms.fafIndex()].proc || '' : '';
      const onLoc = plan ? !!this.fms.approachNav() && /^I/.test(this.fms.approachNav()) && /^[ILXB]/.test(proc) : !!d;
      // (a pending LNAV / VNAV arm engages first; the approach modes arm behind it)
      const latFree = this.latArm !== 'LNAV' || this.lat === 'LNAV', vertFree = this.vertArm !== 'VNAV';
      if (onLoc) { if (this.lat !== 'LOC' && latFree) this.latArm = 'LOC'; const v = !plan || proc[0] === 'I' ? 'GS' : 'GP'; if (this.vert !== v && vertFree) this.vertArm = v; }
      else if (plan) { if (this.lat !== 'LNAV') this.latArm = 'LNAV'; if (this.vert !== 'GP' && vertFree) this.vertArm = 'GP'; }
    }
    // captures: LOC inside 1.5 dots; GS inside 0.4 dot (on the localizer); LNAV inside 2 nm of the path, above 400 ft;
    // VNAV once LNAV is flying; GP past the final approach fix
    if (this.latArm === 'LOC' && d && d.locValid && Math.abs(d.locRaw) < 1.5) { this.lat = 'LOC'; this.latArm = null; }
    if (this.vertArm === 'GS' && d && d.gsValid && Math.abs(d.gsRaw) < 0.4 && Math.abs(d.locRaw) < 2) { this.vert = 'GS'; this.vertArm = null; }
    if (this.latArm === 'LNAV' && g && (g.xtk == null || Math.abs(g.xtk) < 2 * 1852) && (this.agl > 400 * FT || !out.wow && this.vert !== 'TO' && this.vert !== 'GA')) { this.lat = 'LNAV'; this.latArm = null; }
    // VNAV: once LNAV is flying; after takeoff, at 1,000 ft (the acceleration height)
    if (this.vertArm === 'VNAV' && this.lat === 'LNAV' && this.vnav && this.vert !== 'GA' && (this.vert !== 'TO' || this.agl > 1000 * FT)) { this.vert = 'VNAV'; this.vertArm = null; this.thRef = null; }
    if (this.vertArm === 'GP' && (this.lat === 'LNAV' || this.lat === 'LOC') && this.fms && this.fms.i > this.fms.fafIndex()) { this.vert = 'GP'; this.vertArm = null; }
    // losing the signal or the plan: back to holding heading / altitude (loss of approach mode is annunciated, 45c)
    if ((this.lat === 'LOC' || this.vert === 'GS') && !(d && d.locValid)) { this.lat = 'HDG'; this.hdgTgt = wrap360(psiD); this.appr = false; this.latArm = null; if (this.vert === 'GS') { this.vert = 'ALT'; this.altTgt = h; } this.lost = 'LOC'; }
    if (this.lat === 'LNAV' && !g) { this.lat = 'HDG'; this.hdgTgt = wrap360(psiD); this.lost = 'LNAV'; }
    if ((this.vert === 'VNAV' || this.vert === 'GP') && !this.vnav) { this.lost = this.vert; this.vert = 'ALT'; this.altTgt = Math.round(h / FT / 100) * 100 * FT; }
    // ---- vertical: commanded climb rate -> pitch attitude -> elevator (limited-authority servo); TO / GA fly a pitch attitude
    // TO / GA capture the preselected altitude only from below (a go-around keeps climbing while it is set lower)
    if ((this.vert === 'TO' || this.vert === 'GA') && !out.wow && vs > 1 && this.altTgt > h - 10 && this.altTgt - h < Math.max(60, vs * 8)) this.vert = 'ALTS';
    if (this.vert === 'VS' && Math.abs(this.altTgt - h) < Math.max(30, Math.abs(vs) * 6)) this.vert = 'ALTS';
    if (this.vert === 'ALTS' && Math.abs(this.altTgt - h) < 15 && Math.abs(vs) < 1) this.vert = 'ALT';
    let vsCmd;
    if (this.vert === 'TO' || this.vert === 'GA') vsCmd = 0;
    else if (this.vert === 'GS' && d) vsCmd = clamp(-out.gs * Math.tan(d.gsAngle * DEG) - 0.15 * d.gsErrM, -10, 3);
    else if (this.vert === 'VS') vsCmd = this.vsTgt;
    else if (this.vert === 'VNAV' || this.vert === 'GP') vsCmd = this.vnavRate(h, vs, out);
    else vsCmd = clamp((this.altTgt - h) * 0.10, -8, 8);
    let elev, thetaCmd;
    if (this.vert === 'TO' || this.vert === 'GA') {
      thetaCmd = this.vert === 'TO' ? this.toPitch : this.gaPitch; this.thRef = thetaCmd;
      elev = clamp((3.0 * (thetaCmd - theta) - 1.5 * q) / ELEV_K, -0.25 / ELEV_K, 0.25 / ELEV_K);
    } else if (this.fine) {
      // pitch-attitude reference integrates the climb-rate error; gains scale with airspeed (flight-path response ~ V)
      const V = Math.max(40, out.V || 100), e = vsCmd - vs;
      if (this.thRef === null) this.thRef = theta;
      this.thRef = clamp(this.thRef + e * (0.25 / V) * dt, this.thetaLim[0], this.thetaLim[1]);
      thetaCmd = clamp(this.thRef + e * (0.75 / V), this.thetaLim[0], this.thetaLim[1]);
      elev = clamp((3.0 * (thetaCmd - theta) - 1.5 * q) / ELEV_K, -0.25 / ELEV_K, 0.25 / ELEV_K);
    } else {
      // Limited-authority servo: real APs saturate in a 4,000 ft/min updraft, which is how the +450 ft excursion happened.
      thetaCmd = clamp(theta + (vsCmd - vs) * 0.0025, this.thetaLim[0], this.thetaLim[1]);
      elev = clamp((2.5 * (thetaCmd - theta) - 1.0 * q) / ELEV_K, -0.12 / ELEV_K, 0.12 / ELEV_K);
    }
    this.fdTheta = thetaCmd;
    // ---- lateral: heading select; the localizer course with a cross-track intercept (up to 30 deg) flown on the track;
    // or the flight plan's track / heading, turning the published way
    if (this.hdgLeft != null) { if (this.lastPsi != null) this.hdgLeft -= wrap180(psiD - this.lastPsi); if (Math.abs(this.hdgLeft) < 179) this.hdgLeft = null; }
    this.lastPsi = psiD;
    let hErr, bankLim = 25;
    if (this.lat === 'LNAV' && g) {
      hErr = g.trk != null ? wrap180(g.trk - trkD) : wrap180(g.hdg - psiD);
      if (g.turnDir && Math.sign(hErr) === -g.turnDir && Math.abs(hErr) > 5) hErr += 360 * g.turnDir;   // published turn direction: the long way round
    } else if (this.lat === 'LOC' && d) {
      const want = d.course * RAD - clamp(d.cross * 0.012, -30, 30);
      hErr = wrap180(want - trkD); bankLim = 20;
    } else hErr = this.hdgLeft ?? wrap180(this.hdgTgt - psiD);
    if (this.agl < 400 * FT && !out.wow) bankLim = Math.min(bankLim, 15);   // near the ground: keep the wingtips clear (63c(3))
    const phiCmd = clamp(hErr * 1.5, -bankLim, bankLim) * DEG;
    this.fdPhi = phiCmd;
    if (!this.on) return;   // flight director only: the pilot flies the bars
    ac.ctl.elev = elev; this.cmdElev = elev;
    ac.ctl.trim = clamp(ac.ctl.trim + elev * ELEV_K * this.trimRate * dt, this.trimLim[0], this.trimLim[1]);   // auto-trim offloads the servo (and trims against a pilot fighting it)
    // free flight: an integrator removes the steady bank error a held turn needs aileron for (roll stability, adverse yaw)
    if (this.fine) this.ailI = clamp((this.ailI || 0) + (phiCmd - phi) * 0.6 * dt, -0.2, 0.2);
    ac.ctl.ail = clamp(1.2 * (phiCmd - phi) - 0.5 * p + (this.fine ? this.ailI : 0), -0.6, 0.6); this.cmdAil = ac.ctl.ail;
    // No autothrottle on the Learjet 60: thrust stays where the crew left it.
    if (M > 0.845 || Math.abs(phi) > 50 * DEG || vs < -45) this.disconnect(M > 0.845 ? 'OVERSPEED' : 'ATTITUDE');
  }
  // VNAV / GP climb rate (m/s): climb toward an at-or-above / at constraint, or descend on the published path. Outside
  // the final approach (GP) the preselected altitude bounds it: no climb unless it is above, no descent unless it is
  // below, never through it (AC 25.1329-1C 64i(2)).
  vnavRate(h, vs, out) {
    const v = this.vnav, final = this.vert === 'GP'; this.climbSpd = null; if (!v) return 0;
    let tgt = v.alt * FT, path = v.path != null ? v.path * FT : null;
    if (!final) {
      const msp = this.altTgt;
      if (tgt > h) tgt = Math.min(tgt, Math.max(msp, h)); else tgt = Math.max(tgt, Math.min(msp, h));
      if (path != null) path = Math.max(path, msp);
    }
    // on a descent path: level while it is still above (never climb to meet it), then follow it down
    if (path != null && h > tgt + 15) return path > h + 15 ? 0 : clamp(-(out.gs || 60) * Math.tan((v.ang || 3) * DEG) + 0.12 * (path - h), -12, 0.5);
    // a climb well short of its target: speed on elevator (thrust is the pilot's; pitch holds 250 kt below 10,000 ft,
    // then 280 kt / M 0.70), as the flight-level-change climb (AC 25.1329-1C 64f); then capture as ALTS does
    if (tgt - h > Math.max(60, (out.vs || 0) * 8)) {
      const vc = h < 10000 * FT ? 250 : Math.min(280, out.M > 0.05 ? 0.70 * (out.KIAS || 250) / out.M : 280);
      this.climbSpd = vc;
      return clamp((out.vs || 0) + ((out.KIAS || vc) - vc) * 0.3, 1, 25);
    }
    return clamp((tgt - h) * 0.10, -7.6, 7.6);
  }
}

// ---------------- Upset / recovery judgement ----------------
// Definitions from the FAA Airplane Upset Recovery Training Aid: an upset is pitch above +25 or below -10 deg, bank
// beyond 45 deg, or flight outside the envelope (tailplane stall, stall / stick-shaker AOA, overspeed, g outside 0.5..2).
// Only upsets from the start of the event (core entry, 12:47:56) count. RECOVERED needs one of those first, then 10 s of
// stable flight (wings within 15 deg, pitch -5..+15, sink under 2,000 fpm, 0.8..1.3 g, inside the envelope); clean stable
// flight 60 s past the real upset time without ever upsetting is AVOIDED. Taking the airplane early and holding it level
// is neither. g and AOA are low-passed over ~1 s so a turbulence spike is not an upset (nor breaks a recovery).
export const UPSET_T = 76;   // 12:48:16, start of the actual rapid descent
export const EVENT_T = 56;   // 12:47:56, core entry
export class RecoveryJudge {
  constructor(eventT = EVENT_T, upsetT = UPSET_T) {
    this.eventT = eventT; this.upsetT = upsetT; this.upsetAt = null; this.why = ''; this.recoveredAt = null; this.recoveredAlt = 0; this.avoidedAt = null;
    this.stable = 0; this.minAlt = Infinity; this.nzF = 1; this.aoaF = 0;
  }
  outside(out, ac) {
    if (ac.tailStalled) return 'tailplane stall';
    if (out.alpha > 0 && (out.stalled || this.aoaF > shakerAoaN(out.h))) return 'stall / shaker';
    if (out.overspeed) return 'overspeed';
    if (this.nzF < 0.5 || this.nzF > 2.0) return 'g';
    return null;
  }
  upsetReason(out, ac) {
    if (out.theta > 25 * DEG) return 'nose high';
    if (out.theta < -10 * DEG) return 'nose low';
    if (Math.abs(out.phi) > 45 * DEG) return 'bank';
    return this.outside(out, ac);
  }
  stableNow(out, ac) {
    const nz = this.nzF;
    return Math.abs(out.phi) < 15 * DEG && out.theta > -5 * DEG && out.theta < 15 * DEG && out.vs > -2000 * FT / 60 && nz > 0.8 && nz < 1.3 && !this.outside(out, ac);
  }
  // Advance by h seconds at sim time t; returns 'upset' | 'recovered' | 'avoided' when one happens, else null
  update(t, h, out, ac) {
    const k = Math.min(1, h / 1.0); this.nzF += (out.nz - this.nzF) * k; this.aoaF += (out.aoaN - this.aoaF) * k;
    if (this.recoveredAt !== null || this.avoidedAt !== null || ac.broken || ac.crashed) return null;
    if (this.upsetAt === null && t >= this.eventT) {
      const why = this.upsetReason(out, ac);
      if (why) { this.upsetAt = t; this.upsetAlt = out.h; this.why = why; this.stable = 0; return 'upset'; }
    }
    this.stable = this.stableNow(out, ac) ? this.stable + h : 0;
    if (this.upsetAt !== null) {
      this.minAlt = Math.min(this.minAlt, out.h);
      if (this.stable >= 10) { this.recoveredAt = t; this.recoveredAlt = out.h; return 'recovered'; }
    } else if (t > this.upsetT + 60 && this.stable >= 10) { this.avoidedAt = t; return 'avoided'; }
    return null;
  }
}
