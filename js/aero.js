// Learjet 60 aerodynamics from textbook methods, not curve fits.
//   - Lift-curve slope: DATCOM / Helmbold swept-wing formula (Raymer 12.6)
//   - Parasite drag: component build-up, Reynolds- and Mach-dependent skin friction (Raymer 12.5)
//   - Induced drag: Oswald efficiency for swept wings, winglet effective span (Raymer 12.48-12.50)
//   - Compressibility: simple sweep theory + Karman-Tsien on a section pressure model. One
//     pressure model gives the critical Mach (wave drag, Lock's 4th-power law), shock-induced
//     buffet onset (Pearcey: local Mach ~1.3 ahead of the shock), and the Mach loss of CLmax
//     (leading-edge suction peak going supersonic).
// AFM data (stall chart, buffet boundary, climb gradients) is used to VALIDATE these, see
// test/flight_test.mjs. Constants marked "calibrated" were set against the single AFM point
// named next to them; everything else is geometry or textbook.
import { DEG } from './util.js';

// ---- Geometry ----
// Sourced: S 264.5 sq ft, span 43 ft 9 in, length 58 ft 8 in (Bombardier); MAC 80.1 in (AFM CG
// limits: FS 363.08 = -2.5% MAC, FS 378.10 = 16.25% MAC); wing = Model 55 "Longhorn" wing:
// 13 deg c/4 sweep, 2.5 deg dihedral, taper 0.39, NACA 64A-109 sections (Gates Learjet patents
// US 4,240,597 and US 4,050,651), plus the Model 60 root glove and tip fairing (SAE 932534).
// Measured off the AFM's scale three-view (Fig 6-3, Section VI), scale set by the published span and
// length (1.83 px/in both views) and checked against the printed stations (LEMAC FS 365.085 reads
// 364.8; stabilizer chord 67 in edge-on vs 65 in in plan): tail, winglet, nacelle, pylon, fuselage
// width ("dwg"). "est." = not in a published source or drawing.
export const GEO = {
  S: 24.57, b: 13.34,
  sweepC4: 13 * DEG,
  tc: 0.09,                                // NACA 64A-109
  rLE: 0.687 * 0.09 * 0.09,                // 6-series LE radius r/c = 0.687 (t/c)^2 (Abbott & von Doenhoff)
  mac: 2.035, Sexp: 19.5,                  // exposed wing outside a 1.95 m fuselage, root chord 2.65 m (taper 0.39)
  winglet: 1.03,                           // winglet height above the wing, 41 in, dwg
  fus: { l: 17.0, d: 1.94 },               // body length without fin overhang (est.), max width (dwg)
  nac: { l: 3.40, d: 1.04, n: 2 },         // PW305A nacelle incl. reverser, dwg
  ht: { S: 5.6, b: 4.57, mac: 1.28, tc: 0.10, sweep: 25 * DEG },   // T-tail: span 180 in, chords 65/32 in, LE sweep ~29 deg, dwg (t/c est.)
  vt: { S: 4.2, mac: 2.43, tc: 0.11, sweep: 40 * DEG },   // fin: 70 in tall, chords 121/65 in, LE sweep ~43 deg, dwg (excl. dorsal fillet; t/c est.)
  upsweep: 6 * DEG,                        // aft-fuselage upsweep, est.
  pylon: { swet: 0.8, l: 1.0, tc: 0.12, n: 2 },        // engine pylons: chord ~1.0 m (dwg), short stubs (wetted est.)
  deltaFin: { swet: 1.8, l: 1.2 },                     // ventral 'delta fins', both, est.
  lt: 7.19,                                            // wing MAC c/4 (FS 385.1) to stabilizer MAC c/4 (FS 668), dwg
  CmAcWB: -0.08,                                       // wing-body Cm about its ac (cambered, aft-loaded section), est.
};
GEO.AR = GEO.b * GEO.b / GEO.S;
const G = 1.4;

// Sutherland viscosity (kg/m/s)
export const mu = (T) => 1.458e-6 * T ** 1.5 / (T + 110.4);
// Turbulent flat-plate skin friction with the roughness cutoff Reynolds number
// (production sheet metal, k = 1.015e-5 m)
function cf(rho, V, T, l, M) {
  const Re = Math.min(rho * V * l / mu(T), 38.21 * (l / 1.015e-5) ** 1.053);
  return 0.455 / (Math.log10(Math.max(Re, 1e5)) ** 2.58 * (1 + 0.144 * M * M) ** 0.65);
}
const ffLifting = (tc, sweep, M) => (1 + 0.6 / 0.3 * tc + 100 * tc ** 4) * (1.34 * Math.max(M, 0.05) ** 0.18 * Math.cos(sweep) ** 0.28);

/** Zero-lift drag coefficient (ref S) from the component build-up. */
export function cd0(rho, V, T, M) {
  const g = GEO; let f = 0;
  // wing
  f += cf(rho, V, T, g.mac, M) * ffLifting(g.tc, g.sweepC4, M) * 1.0 * 2 * (1 + 0.2 * g.tc) * g.Sexp;
  // fuselage: Torenbeek wetted area for a body of fineness l/d
  const fr = g.fus.l / g.fus.d;
  const swF = Math.PI * g.fus.d * g.fus.l * (1 - 2 / fr) ** (2 / 3) * (1 + 1 / (fr * fr));
  f += cf(rho, V, T, g.fus.l, M) * (1 + 60 / fr ** 3 + fr / 400) * swF;
  // nacelles, mounted close to the fuselage: interference Q = 1.3
  const frN = g.nac.l / g.nac.d;
  f += g.nac.n * cf(rho, V, T, g.nac.l, M) * (1 + 0.35 / frN) * 1.3 * Math.PI * g.nac.d * g.nac.l * 0.9;
  // tails (Q = 1.04) and winglets
  for (const t of [g.ht, g.vt]) f += cf(rho, V, T, t.mac, M) * ffLifting(t.tc, t.sweep, M) * 1.04 * 2 * (1 + 0.2 * t.tc) * t.S;
  f += cf(rho, V, T, 0.6, M) * ffLifting(0.09, 30 * DEG, M) * 1.04 * 2 * 2 * g.winglet * 0.6;
  // pylons (Q 1.3, close to the nacelle/fuselage) and ventral delta fins
  f += g.pylon.n * cf(rho, V, T, g.pylon.l, M) * ffLifting(g.pylon.tc, 0, M) * 1.3 * g.pylon.swet;
  f += cf(rho, V, T, g.deltaFin.l, M) * ffLifting(0.06, 45 * DEG, M) * 1.1 * g.deltaFin.swet;
  // aft-fuselage upsweep (Raymer 12.61), then leakage + protuberances (antennas, stall fences, vortilons) +5%
  f += 3.83 * g.upsweep ** 2.5 * Math.PI * g.fus.d ** 2 / 4;
  return 1.05 * f / g.S;
}

// Oswald efficiency (Raymer 12.49, swept wing) on the geometric aspect ratio; winglets raise
// the effective aspect ratio A(1 + 1.9 h/b) (Raymer 12.50)
const eOsw = 4.61 * (1 - 0.045 * GEO.AR ** 0.68) * Math.cos(GEO.sweepC4 + 2 * DEG) ** 0.15 - 3.1;
export const AReff = GEO.AR * (1 + 1.9 * GEO.winglet / GEO.b);
export const K_IND = 1 / (Math.PI * eOsw * AReff);

// Trim drag: the cambered wing pitches nose-down (CmAcWB), so the T-tail carries a download and
// the wing a matching extra lift: extra wing induced drag + the tail's own induced drag.
const dCLtrim = -GEO.CmAcWB / (GEO.lt / GEO.mac);                          // extra wing CL (ref S)
const K_TAIL = 1 / (Math.PI * 0.8 * GEO.ht.b ** 2 / GEO.ht.S);              // tail AR 3.7 (dwg), e 0.8 est.
export const cdTrim = (CL) => K_IND * ((Math.abs(CL) + dCLtrim) ** 2 - CL * CL) + K_TAIL * (dCLtrim * GEO.S / GEO.ht.S) ** 2 * GEO.ht.S / GEO.S;

/** Lift-curve slope per rad: DATCOM/Helmbold, section efficiency 0.95, body factor capped at 0.98 (Raymer). */
export function clAlpha(M) {
  const b2 = 1 - Math.min(M, 0.95) ** 2, A = AReff, eta = 0.95;
  const tanHalf = Math.tan(GEO.sweepC4 - 2 * DEG);
  return 2 * Math.PI * A / (2 + Math.sqrt(4 + (A * A * b2 / (eta * eta)) * (1 + tanHalf * tanHalf / b2))) * 0.98;
}

// ---- Section pressure model (simple sweep theory) ----
// Normal Mach Mn = M cos L; normal section cl = CL * peak spanwise loading / cos^2 L.
// Incompressible peak suction at the shock station (mid-chord, roof-top section):
//   Cp0 = -(kT * t/c + kL * cl)          thickness + lift superposition (thin-airfoil theory)
// and at the leading edge (thin-airfoil + LE-radius correction, Riegels):
//   Cp0_LE = 1 - (1 + alpha_eff * sqrt(2 / rLE))^2,  alpha_eff = (cl - cl_i) / (2 pi)
// where cl_i is the section's ideal (camber) lift, carried without a leading-edge spike.
// Karman-Tsien takes Cp0 to Mn; the isentropic relation gives the local Mach.
// Buffet onset is whichever separation comes first (SAE 932534, Chandrasekharan et al. 1993,
// "Aerodynamic Tailoring of the Learjet Model 60 Wing": shock-induced separation at the root,
// fixed by the leading-edge glove, plus rear/viscous separation):
//   1. mid-chord shock:  local Mach ahead of the shock reaches Msep (Pearcey ~1.3)   -> high-Mach side
//   2. leading-edge peak: same criterion on the LE suction peak                          -> knee ~M0.72
//   3. rear (trailing-edge) separation at a section lift clRear, ~Mach-independent      -> the plateau
// kT, kL, clI, clRear: least squares against the Model 60 flight-test buffet-onset envelope
// (SAE 932534 Fig 19, 9 points M0.50-0.815): rms dCL 0.018. Check (not fitted): at the paper's
// design point M0.75, alpha 4 deg the peak local Mach is 1.18 vs TRANAIR 1.1-1.25 along the span
// (Fig 12). The AFM boundary (Fig 5-24, forward CG) sits 0.03-0.06 lower, as certification data should.
export const PM = {
  spanLoad: 1.1,     // outboard section cl / CL (elliptic-ish loading peaks ~1.1)
  kT: 0.9,           // thickness suction per t/c (bare 64A-109 theory ~2.2: glove/droop/twist absorbed)
  kL: 0.80,          // lift suction per section cl
  clI: 0.825,        // lift carried without a leading-edge spike (bare 64A-109: 0.1; the drooped LE + glove raise it)
  clRear: 0.975,     // section lift at rear-separation onset (aircraft CL ~0.84)
  Msep: 1.30,        // Pearcey: shock-induced separation at local Mach ~1.3 - textbook, not fitted
  Mstall: 1.50,      // extensive shock-induced separation (CLmax), textbook ~1.5 - not fitted. Check: CLmax 0.94 @ M0.70, 1.32 @ M0.48 vs flown 0.88 / 0.95 (Fig 19)
};
const cosL = Math.cos(GEO.sweepC4);
function karmanTsien(cp0, Mn) {
  const b = Math.sqrt(Math.max(1e-4, 1 - Mn * Mn));
  const den = b + Mn * Mn / (1 + b) * cp0 / 2;
  return den > 0.05 ? cp0 / den : cp0 / 0.05;   // past this the flow is far supersonic anyway
}
/** Local Mach where the freestream (normal) Mach Mn meets pressure coefficient Cp. */
function localMach(Cp, Mn) {
  const pr = Math.max(0.02, 1 + G / 2 * Mn * Mn * Cp);                 // p_local / p_inf
  return Math.sqrt(Math.max(0, 2 / (G - 1) * ((1 + (G - 1) / 2 * Mn * Mn) * pr ** (-(G - 1) / G) - 1)));
}
const sectionCl = (CL) => PM.spanLoad * Math.abs(CL) / (cosL * cosL);
/** Peak local Mach on the upper surface: mid-chord (shock) station and leading edge. */
export function peakMach(M, CL) {
  const Mn = M * cosL, cl = sectionCl(CL);
  const mid = localMach(karmanTsien(-(PM.kT * GEO.tc + PM.kL * cl), Mn), Mn);
  const a = Math.max(0, cl - PM.clI) / (2 * Math.PI);
  const le = localMach(karmanTsien(1 - (1 + a * Math.sqrt(2 / GEO.rLE)) ** 2, Mn), Mn);
  return { mid, le };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Root-find helper: largest x in [lo, hi] with f(x) false, f monotone false->true
function bisect(f, lo, hi, n = 30) { for (let i = 0; i < n; i++) { const m = (lo + hi) / 2; if (f(m)) hi = m; else lo = m; } return lo; }

const peak = (M, CL) => { const p = peakMach(M, CL); return Math.max(p.mid, p.le); };
// For full separation the local flow is well supersonic, where Karman-Tsien goes singular (its
// denominator -> 0). There, scale the velocity perturbation by 1/beta and get the local Mach from
// the energy equation instead (no singularity).
function localMachV(cp0, Mn) {
  const vr = 1 + (Math.sqrt(Math.max(0, 1 - cp0)) - 1) / Math.sqrt(Math.max(1e-4, 1 - Mn * Mn));
  const a2 = 1 / (Mn * Mn) + (G - 1) / 2 * (1 - vr * vr);
  return a2 > 0 ? vr / Math.sqrt(a2) : 9;
}
function peakV(M, CL) {
  const Mn = M * cosL, cl = sectionCl(CL), a = Math.max(0, cl - PM.clI) / (2 * Math.PI);
  return Math.max(localMachV(-(PM.kT * GEO.tc + PM.kL * cl), Mn), localMachV(1 - (1 + a * Math.sqrt(2 / GEO.rLE)) ** 2, Mn));
}

// The physics is a root-find per query: tabulate once at load (M step 0.005, CL step 0.02)
// and interpolate at run time.
const MG = (i) => 0.05 + 0.005 * i, NM = 191;          // M 0.05 .. 1.00
const CLG = (i) => 0.02 * i, NC = 101;                 // CL 0 .. 2.0
const mkM = (f) => Float64Array.from({ length: NM }, (_, i) => f(MG(i)));
const lookM = (tab, M) => { const x = (Math.min(Math.max(M, 0.05), 1) - 0.05) / 0.005, i = Math.min(NM - 2, Math.floor(x)); return tab[i] + (tab[i + 1] - tab[i]) * (x - i); };
const lookCL = (tab, CL) => { const x = Math.min(Math.abs(CL), 2) / 0.02, i = Math.min(NC - 2, Math.floor(x)); return tab[i] + (tab[i + 1] - tab[i]) * (x - i); };
/** Buffet-onset CL at Mach M: either the leading-edge peak (low-speed side) or the mid-chord shock (high-speed side) reaches Msep. */
const clRearAt = (M) => PM.clRear * cosL * cosL / PM.spanLoad + 3 * (1 - smooth(0.35, 0.45, M));   // measured from M0.48 up; below, LE/stall govern
const CL_BUF = mkM((M) => Math.min(clRearAt(M), bisect((CL) => peak(M, CL) >= PM.Msep, 0, 3)));
/** Compressibility limit on CLmax (full separation at Mstall). The viscous low-speed limit is applied by the caller. */
const CL_MAXC = mkM((M) => bisect((CL) => peakV(M, CL) >= PM.Mstall, 0, 3));
/** Critical Mach (mid-chord local Mach = 1) vs CL. */
const M_CRIT = Float64Array.from({ length: NC }, (_, i) => bisect((M) => peakMach(M, CLG(i)).mid >= 1, 0.3, 0.99));
export const clBuffet = (M) => lookM(CL_BUF, M);
export const clMaxCompressible = (M) => lookM(CL_MAXC, M);
export const mCrit = (CL) => lookCL(M_CRIT, CL);
/** Wave drag, Lock's fourth-power law above the critical Mach. dMcr lets ice lower it. */
export const cdWave = (M, CL, dMcr = 0) => { const mc = mCrit(CL) - dMcr; return M > mc ? 20 * (M - mc) ** 4 : 0; };
/** Shock-buffet onset Mach at lift coefficient CL (inverse of clBuffet on its high-speed side). */
export function buffetMach(CL) {
  const c = Math.abs(CL);
  for (let i = NM - 1; i > 0; i--) if (CL_BUF[i] >= c) return MG(i);
  return MG(0);
}
