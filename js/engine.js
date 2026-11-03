// PW305A turbofan from a two-stream cycle with turbomachinery similarity, and the engine
// control's thrust-rating law expressed in the same corrected parameters.
//
// Cycle (per engine), at fan corrected speed r = N1 / sqrt(theta_t2) / 100:
//   corrected airflow     mc  = mc100 * r^1.6            (fan map, along the operating line)
//   fan pressure ratio    FPR = 1 + (FPR100 - 1) r^2     (pressure rise ~ blade speed^2)
//   overall pres. ratio   OPR = 1 + (OPR100 - 1) r^3
//   turbine entry temp    T4  = lam * Tt2 * r^1.15       (exponent from the AFM ITT-limit law, below)
//   work balance: the turbine drives fan (all flow) + core compressor; core nozzle sees what's left.
//   Convergent nozzles, choked or not; net thrust = gross - ram drag. Fuel from the burner energy balance.
//
// Rating law (max lever = maximum continuous thrust), found in the AFM MCT N1 tables (Fig 5-31/5-32)
// by converting N1 to corrected speed: the limit is the lowest of
//   - flat-rated thrust  (cold, low altitude: corrected N1 constant ~91% at sea level)
//   - turbine temperature (hot or high: N1c * Tt2^0.87 = const, same constant at SL and FL350)
//   - mechanical N1 102%, corrected N1 114%
// test/flight_test.mjs checks the resulting N1 against the AFM table.
const G = 1.4, CP = 1004.5, R = 287.053, GH = 1.33, CPH = 1150, LHV = 43.1e6;
export const ENG = {
  BPR: 4.5, OPR100: 23, FPR100: 1.68,                  // BPR ~4.5 (PW300 data, Wikipedia); OPR, FPR est.
  etaFan: 0.88, etaC: 0.86, etaT: 0.89, etaB: 0.99, piInlet: 0.995, piDuct: 0.98, piBurner: 0.95,
  mc100: 82,                                           // corrected airflow at r = 1, kg/s: set below from the takeoff rating
  lam: 4.9,                                            // T4 / Tt2 at r = 1 (sets TSFC; checked against ~0.39 static)
  T4max: 0,                                            // set from the ITT law constant (below)
  Fflat: 0,                                            // flat-rated MCT thrust, N (from the AFM cold-side N1c)
  N1mech: 102, N1cMax: 114, N1cFlat: 91.2, ittExp: 0.87, ittC: Math.exp(9.47),
  bleed: 0.085,                                        // cabin pressurization bleed off the core, kg/s per engine, est.
  pExt: 8400,                                          // generator power extraction, W per engine (AFM: 300 A at altitude, 28 V)
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
  const m = e.mc100 * r ** 1.6 * d2 / Math.sqrt(th2), mCore = m / (1 + e.BPR), mFan = m - mCore;
  const FPR = 1 + (e.FPR100 - 1) * r * r, OPR = Math.max(FPR, 1 + (e.OPR100 - 1) * r ** 3);
  const k = (G - 1) / G;
  const Tt13 = Tt0 * FPR ** (k / e.etaFan), Tt3 = Tt0 * OPR ** (k / e.etaC);
  const T4 = e.lam * Tt0 * r ** 1.15;
  const mBurn = Math.max(0.2 * mCore, mCore - e.bleed);                   // customer bleed leaves after the compressor
  const f = Math.max(0, CPH * T4 - CP * Tt3) / (e.etaB * LHV - CPH * T4);
  // turbine work = fan work (all flow) + core compressor work + accessory power
  const W = m * CP * (Tt13 - Tt0) + mCore * CP * (Tt3 - Tt13) + e.pExt / 0.98;
  const Tt5 = T4 - W / (mBurn * (1 + f) * CPH);
  const Pt4 = Pt0 * e.piInlet * OPR * e.piBurner;
  const Pt5 = Pt4 * Math.max(1e-3, Tt5 / T4) ** (GH / ((GH - 1) * e.etaT));
  const V0 = M * Math.sqrt(G * R * T0);
  const Fg = nozzle(mFan, Pt0 * e.piInlet * FPR * e.piDuct, Tt13, p0, G, CP) + nozzle(mBurn * (1 + f), Pt5, Tt5, p0, GH, CPH);
  return { F: Fg - m * V0, ff: f * mBurn, T4, r, N1c: r * 100, Tt2: Tt0 };
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
ENG.Fflat = cycle(ENG.N1cFlat * Math.sqrt(1 + 0.2 * 0.38 * 0.38), 0.38, 101325, 288.15).F;
