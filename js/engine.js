// PW305A turbofan from a two-stream cycle with turbomachinery similarity, and the engine
// control's thrust-rating law expressed in the same corrected parameters.
//
// Cycle (per engine), at fan corrected speed r = N1 / sqrt(theta_t2) / 100:
//   corrected airflow     mc  = mc100 * r^1.6            (fan map, along the operating line)
//   fan pressure ratio    FPR = 1 + (FPR100 - 1) r^2     (pressure rise ~ blade speed^2)
//   overall pres. ratio   OPR = 1 + (OPR100 - 1) r^3
//   turbine entry temp    T4  = lam * Tt2 * r^1.15       (exponent from the AFM ITT-limit law, below)
//   work balance: the turbine drives fan (all flow) + core compressor; core nozzle sees what's left.
//   Fan and core streams mix ahead of one convergent nozzle (forced mixer, SAE/AIAA 90-2520);
//   net thrust = gross - ram drag. Fuel from the burner energy balance.
// Design cycle (Karanjia & Harvey, "Optimization Studies for the PW305 Turbofan", AIAA 90-2520,
// 1990), at 40,000 ft, M0.8, ISA, max cruise: fan 30.75 in, bypass FPR 1.811, BPR 4.3,
// OPR 23.711, combustor exit 2105 F, specific thrust 19.2 lbf/(lb/s). FPR100, OPR100 and lam are
// set so the model reproduces that design point; specific thrust and the cold/hot total-pressure
// balance at the mixer are left free as checks (test/flight_test.mjs).
//
// Rating law (max lever = maximum continuous thrust), found in the AFM MCT N1 tables (Fig 5-31/5-32)
// by converting N1 to corrected speed: the limit is the lowest of
//   - flat-rated thrust  (cold, low altitude: corrected N1 constant ~91% at sea level)
//   - turbine temperature (hot or high: N1c * Tt2^0.87 = const, same constant at SL and FL350)
//   - mechanical N1 102%, corrected N1 114%
// test/flight_test.mjs checks the resulting N1 against the AFM table.
const G = 1.4, CP = 1004.5, R = 287.053, GH = 1.33, CPH = 1150, LHV = 43.1e6;
export const ENG = {
  BPR: 4.3, OPR100: 23, FPR100: 1.68,                  // BPR(r): 4.3 at the design point, 4.55 at sea-level takeoff (PTM); FPR100/OPR100 set below
  fanD: 30.75 * 0.0254,                                // fan diameter, m (AIAA 90-2520)
  etaFan: 0.88, etaC: 0.86, etaT: 0.89, etaB: 0.99, piInlet: 0.995, piDuct: 0.98, piBurner: 0.95,
  mc100: 82,                                           // corrected airflow at r = 1, kg/s: set below from the takeoff rating
  lam: 4.9,                                            // T4 / Tt2 at r = 1: set below from the 2105 F design combustor exit
  T4max: 0,                                            // set from the ITT law constant (below)
  Fflat: 0,                                            // flat-rated MCT thrust, N (from the AFM cold-side N1c)
  N1mech: 102, N1cMax: 114, N1cFlat: 91.2, ittExp: 0.87, ittC: Math.exp(9.47),
  bleed: 0.085,                                        // cabin pressurization bleed off the core, kg/s per engine, est.
  pExt: 8400,
  cool: 0.08,                                          // HP turbine cooling air, fraction of core flow: set below from the mixer pressure balance
  cv: 0.985,                                           // nozzle velocity coefficient (textbook)                                          // generator power extraction, W per engine (AFM: 300 A at altitude, 28 V)
  idleN1: 48,                                          // flight idle, physical % (min core-speed schedule, est.)
};
// T4 limit implied by the ITT law: N1c^(1/0.87) * Tt2 = C^(1/0.87) at the limit, so T4max = lam * that / 100^1.15
ENG.T4max = ENG.lam * Math.pow(ENG.ittC, 1 / ENG.ittExp) / Math.pow(100, 1 / ENG.ittExp);

function nozzle(m, Pt, Tt, p0, g, cp) {           // convergent nozzle gross thrust
  const crit = ((g + 1) / 2) ** (g / (g - 1));
  const npr = Pt / p0;
  if (npr <= 1) return 0;
  if (npr < crit) return m * Math.sqrt(2 * cp * Tt * (1 - npr ** (-(g - 1) / g)));
  const Te = Tt * 2 / (g + 1), Ve = Math.sqrt(g * R * Te), pe = Pt / crit;
  return m * Ve + (m / (pe / (R * Te) * Ve)) * (pe - p0);
}

/** Thrust (N), fuel flow (kg/s), T4 (K) for one engine at physical N1 (%), flight Mach, ambient p (Pa), T (K). */
export function cycle(N1, M, p0, T0) {
  const e = ENG;
  const Tt0 = T0 * (1 + 0.2 * M * M), Pt0 = p0 * (1 + 0.2 * M * M) ** 3.5;
  const th2 = Tt0 / 288.15, d2 = Pt0 * e.piInlet / 101325;
  const r = Math.max(0.2, N1 / Math.sqrt(th2) / 100);
  const bpr = e.BPR + (e.BPRto - e.BPR) * (r - e.rDes) / (e.rTO - e.rDes);   // linear in r between the two sourced points
  const m = e.mc100 * r ** 1.6 * d2 / Math.sqrt(th2), mCore = m / (1 + bpr), mFan = m - mCore;
  const FPR = 1 + (e.FPR100 - 1) * r * r, OPR = Math.max(FPR, 1 + (e.OPR100 - 1) * r ** 3);
  const k = (G - 1) / G;
  const Tt13 = Tt0 * FPR ** (k / e.etaFan), Tt3 = Tt0 * OPR ** (k / e.etaC);
  const T4 = e.lam * Tt0 * r ** 1.15;
  const mAft = Math.max(0.2 * mCore, mCore - e.bleed);                    // customer bleed leaves after the compressor
  const mCool = e.cool * mAft, mBurn = mAft - mCool;                       // cooling air skips the combustor
  const f = Math.max(0, CPH * T4 - CP * Tt3) / (e.etaB * LHV - CPH * T4);
  // cooling air rejoins at the HP turbine: diluted turbine entry temperature
  const mT = mBurn * (1 + f) + mCool, T41 = (mBurn * (1 + f) * CPH * T4 + mCool * CP * Tt3) / (mT * CPH);
  // turbine work = fan work (all flow) + core compressor work + accessory power
  const W = m * CP * (Tt13 - Tt0) + mCore * CP * (Tt3 - Tt13) + e.pExt / 0.98;
  const Tt5 = T41 - W / (mT * CPH);
  const Pt4 = Pt0 * e.piInlet * OPR * e.piBurner;
  const Pt5 = Pt4 * Math.max(1e-3, Tt5 / T41) ** (GH / ((GH - 1) * e.etaT));
  const V0 = M * Math.sqrt(G * R * T0);
  // Forced mixer: enthalpy-weighted total temperature, mass-weighted total pressure less 1% mixing loss
  const Pt13 = Pt0 * e.piInlet * FPR * e.piDuct, mHot = mT, mMix = mFan + mHot;
  const cpM = (mFan * CP + mHot * CPH) / mMix, gM = (mFan * G + mHot * GH) / mMix;
  const TtM = (mFan * CP * Tt13 + mHot * CPH * Tt5) / (mMix * cpM);
  const PtM = 0.99 * (mFan * Pt13 + mHot * Pt5) / mMix;
  const Fg = e.cv * nozzle(mMix, PtM, TtM, p0, gM, cpM);
  return { F: Fg - m * V0, ff: f * mBurn, T4, r, N1c: r * 100, Tt2: Tt0, m, bpr, FPR, OPR, ptRatio: Pt5 / Pt13 };
}

// Mach the engine control assumes when it computes the thrust rating: the AFM climb schedule
// (250 KIAS to FL320, M0.70 above). The rating is an N1 schedule in pressure altitude and
// temperature, not a live thrust limit: the AFM all-engine (Fig 5-31) and single-engine
// (Fig 5-32, slower climb speeds) tables give nearly the same N1 at the same altitude and SAT.
function refMach(p0) {
  const h = 44330.8 * (1 - (p0 / 101325) ** 0.190263);                     // pressure altitude, m
  if (h > 32000 * 0.3048) return 0.70;
  const qc = 101325 * ((1 + 0.2 * (250 * 0.514444 / 340.294) ** 2) ** 3.5 - 1);   // 250 KCAS impact pressure
  return Math.sqrt(5 * ((qc / p0 + 1) ** (2 / 7) - 1));
}
/** Rating-limited maximum N1 (%): lowest of flat thrust, turbine temperature, mechanical, corrected speed. */
export function maxN1(M, p0, T0) {
  const e = ENG;
  // temperature limits on the actual total temperature
  const th2 = T0 * (1 + 0.2 * M * M) / 288.15, s = Math.sqrt(th2), Tt2 = th2 * 288.15;
  let n = Math.min(e.N1mech, e.N1cMax * s, e.ittC * Tt2 ** -e.ittExp * s);
  // flat rating: N1 that gives the rated thrust at the schedule Mach for this altitude and SAT
  const Mr = refMach(p0);
  if (cycle(n, Mr, p0, T0).F > e.Fflat) {
    let lo = 20, hi = n;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (cycle(mid, Mr, p0, T0).F > e.Fflat) hi = mid; else lo = mid; }
    n = lo;
  }
  return n;
}
export const idleN1 = () => ENG.idleN1;
// Takeoff rating (thrust levers at T/O, AFM Fig 5-25): corrected N1 93.3 % on the flat-rated side; the sea-level line
// meets the temperature limit at 74 F with 94.6 % N1, which sets the takeoff ITT line (above the MCT one). Above sea level
// (not transcribed) the rating keeps the sea-level ISA margin of 0.8 % N1 over maximum continuous: an estimate.
// APR (automatic performance reserve, armed for takeoff; fires when an engine fails): the same 4,600 lbf, flat-rated to
// 31.6 C instead of 23.3 C (PTM ch. 7), i.e. a higher ITT line on the live engine.
export function takeoffN1(M, p0, T0, apr = false) {
  const e = ENG, th2 = T0 * (1 + 0.2 * M * M) / 288.15, s = Math.sqrt(th2), Tt2 = th2 * 288.15;
  const itt = (apr ? e.ittAPR : e.ittTO) * Tt2 ** -e.ittExp * s;
  // at altitude the sea-level corrected-N1 anchor would fall below MCT: keep the sea-level ISA margin over MCT there
  return Math.min(e.N1mech, itt, Math.max(93.3 * s, maxN1(M, p0, T0) + 0.8));
}
// Anchor the cycle at the AIAA 90-2520 design point. At 40,000 ft, M0.8, ISA the max-cruise N1 is on
// the turbine-temperature limit, so its corrected speed rDes comes from the AFM rating law alone.
{
  const T0 = 216.65, Tt2 = T0 * (1 + 0.2 * 0.64);
  ENG.rDes = ENG.ittC * Tt2 ** -ENG.ittExp / 100;
  ENG.rTO = 0.933; ENG.BPRto = 4.55;                   // sea-level takeoff: corrected N1 93.3% (AFM Fig 5-25), BPR 4.55 (PTM)
  ENG.FPR100 = 1 + (1.811 - 1) / ENG.rDes ** 2;
  ENG.OPR100 = 1 + (23.711 - 1) / ENG.rDes ** 3;
  ENG.lam = ((2105 - 32) / 1.8 + 273.15) / (Tt2 * ENG.rDes ** 1.15);
  ENG.T4max = ENG.lam * Math.pow(ENG.ittC, 1 / ENG.ittExp) / Math.pow(100, 1 / ENG.ittExp);
  // Cooling air from the design condition the paper states: cold and hot total pressures equal at the mixer
  const p0 = 18754, nDes = ENG.rDes * 100 * Math.sqrt(Tt2 / 288.15);
  let lo = 0, hi = 0.3;
  for (let i = 0; i < 40; i++) { ENG.cool = (lo + hi) / 2; if (cycle(nDes, 0.8, p0, T0).ptRatio > 1) lo = ENG.cool; else hi = ENG.cool; }
}
// Engine size from the published takeoff rating: 4,600 lbf per engine, sea level, flat-rated to
// 23.3 C (FlightSafety Learjet 60 PTM ch. 7), at the AFM takeoff setting (Fig 5-25: the sea-level line
// meets the temperature limit at 74 F / 94.6% N1, i.e. corrected N1 93.3% on the flat-rated side).
// Rating is bare-engine thrust: no customer bleed or accessory load. Solve the corrected airflow.
{
  const want = 4600 * 4.44822, N1to = 93.3, save = [ENG.bleed, ENG.pExt];
  ENG.bleed = 0; ENG.pExt = 0;
  let lo = 40, hi = 160;
  for (let i = 0; i < 40; i++) { ENG.mc100 = (lo + hi) / 2; if (cycle(N1to, 0, 101325, 288.15).F > want) hi = ENG.mc100; else lo = ENG.mc100; }
  [ENG.bleed, ENG.pExt] = save;
}
// Flat-rated thrust: the AFM shows corrected N1 held at ~91.2% on the cold side at sea level at the
// 250 KIAS climb speed (M ~0.38): that thrust is the flat rating.
ENG.ittTO = 94.6 / (296.5 ** -ENG.ittExp * Math.sqrt(296.5 / 288.15));
{ // APR: N1 for 4,600 lbf static at sea level and 31.6 C sets its ITT line
  const T = 304.75, want = 4600 * 4.44822, save = [ENG.bleed, ENG.pExt]; ENG.bleed = 0; ENG.pExt = 0;
  let lo = 80, hi = 105; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (cycle(mid, 0, 101325, T).F > want) hi = mid; else lo = mid; }
  [ENG.bleed, ENG.pExt] = save; ENG.ittAPR = lo / (T ** -ENG.ittExp * Math.sqrt(T / 288.15));
}
ENG.Fflat = cycle(ENG.N1cFlat * Math.sqrt(1 + 0.2 * 0.38 * 0.38), 0.38, 101325, 288.15).F;
