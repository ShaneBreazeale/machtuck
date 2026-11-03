// Validates the physics model against AFM tables transcribed in test/afm_tables.json:
//   - MCT N1 (Fig 5-31): engine control law (engine.js maxN1) vs the AFM N1 schedule
//   - Final segment climb gradient (Fig 5-62): single-engine thrust minus drag, clean, 1.25 Vs1
// Nothing here is fitted to these tables.   node test/afm_validate.mjs
import { readFileSync } from 'node:fs';
import { isa, KT } from '../js/atmo.js';
import { cd0, K_IND, cdTrim } from '../js/aero.js';
import { cycle, maxN1 } from '../js/engine.js';
import { clMaxAt, casKt } from '../js/aircraft.js';
const FT = 0.3048, LB = 0.45359237, S = 24.57;
const T = JSON.parse(readFileSync(new URL('./afm_tables.json', import.meta.url)));
// ISA deviation for a static air temperature at a pressure altitude
const atmAt = (hft, satC) => { const std = isa(hft * FT, 0); return isa(hft * FT, satC + 273.15 - std.T); };
const machAtKias = (kias, p) => { let M = 0.05; while (M < 0.95 && casKt(M, p) < kias) M += 0.0005; return M; };

const stats = (errs) => { const a = errs.filter(Number.isFinite); const mean = a.reduce((s, x) => s + x, 0) / a.length;
  return { n: a.length, mean, rms: Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length), max: Math.max(...a.map(Math.abs)) }; };

// ---- 1. MCT N1, anti-ice off. All engines: 250 KIAS to FL320, M0.70 above.
//      Single engine: 200 KIAS to 21k, M0.45 to 29k, 170 KIAS to 49k, M0.70 above.
const allEngSpeed = (h, p) => (h > 32000 ? 0.70 : machAtKias(250, p));
const seSpeed = (h, p) => (h > 49000 ? 0.70 : h > 29000 ? machAtKias(170, p) : h > 21000 ? 0.45 : machAtKias(200, p));
for (const [key, spd] of [['mct_n1_all', allEngSpeed], ['mct_n1_single', seSpeed]]) {
  const errs = [], worst = [];
  for (const c of T[key].cells) {
    if (c.off == null) continue;
    const a = atmAt(c.alt_ft, c.sat_c), M = spd(c.alt_ft, a.p);
    const n = maxN1(M, a.p, a.T), e = n - c.off;
    errs.push(e); worst.push([Math.abs(e), `${c.alt_ft}ft ${c.sat_c}C: model ${n.toFixed(2)} AFM ${c.off}`]);
  }
  const s = stats(errs);
  console.log(`MCT N1 ${key} (Fig ${T[key].figure}, ${s.n} cells): mean ${s.mean.toFixed(2)}  rms ${s.rms.toFixed(2)}  max ${s.max.toFixed(2)} %N1`);
  worst.sort((x, y) => y[0] - x[0]); for (const w of worst.slice(0, 3)) console.log('   worst:', w[1]);
}

// ---- 2. Final segment net gradient: one engine at MCT, other windmilling, gear/flaps up, 1.25 Vs1
// Windmilling drag (Torenbeek): D/q = 0.0785 Di^2 + 2/(1+0.16M^2) * (pi/4) Di^2 * vr (1 - vr), vr = 0.92
// Yaw trim (rudder + sideslip) drag: small for aft-fuselage engines, ~0.0005.
const DI = 0.79;
export function seNetGradient(hft, satC, lb, speed = 'final') {
  const a = atmAt(hft, satC), W = lb * LB * 9.80665;
  let M;
  if (speed === 'final') { M = 0.1; while (W / (0.7 * a.p * M * M * S) > clMaxAt(M)) M += 0.0005; M *= 1.25; }   // 1.25 Vs1
  else M = seSpeed(hft, a.p);                                                                                    // enroute schedule
  const V = M * a.a, q = 0.7 * a.p * M * M, CL = W / (q * S);
  const wm = 0.0785 * DI * DI + 2 / (1 + 0.16 * M * M) * Math.PI / 4 * DI * DI * 0.92 * 0.08;
  const D = q * (S * (cd0(a.rho, V, a.T, M) + K_IND * CL * CL + cdTrim(CL) + 0.0005) + wm);
  const F = cycle(maxN1(M, a.p, a.T), M, a.p, a.T).F;
  return { gross: 100 * (F - D) / W, net: 100 * (F - D) / W - 0.8, kias: casKt(M, a.p) };
}
for (const [key, speed] of [['final_segment', 'final'], ['enroute_climb_se', 'enroute']]) {
  const errs = [], worst = [], byAlt = new Map();
  for (const c of T[key].cells) {
    if (c.net == null || c.shaded) continue;
    const r = seNetGradient(c.alt_ft, c.temp_c, c.weight_lb, speed), e = r.net - c.net;
    errs.push(e); worst.push([Math.abs(e), `${c.alt_ft}ft ${c.temp_f}F ${c.weight_lb}lb: model ${r.net.toFixed(1)} AFM ${c.net}`]);
    if (!byAlt.has(c.alt_ft)) byAlt.set(c.alt_ft, []); byAlt.get(c.alt_ft).push(e);
  }
  const s = stats(errs);
  console.log(`\n${key} net gradient (Fig ${T[key].figure}, ${s.n} unshaded cells): mean ${s.mean.toFixed(2)}  rms ${s.rms.toFixed(2)}  max ${s.max.toFixed(2)} % gradient`);
  console.log('   by altitude (mean):', [...byAlt].map(([k, v]) => `${k / 1000}k ${stats(v).mean.toFixed(1)}`).join('  '));
  worst.sort((x, y) => y[0] - x[0]); for (const w of worst.slice(0, 3)) console.log('   worst:', w[1]);
}
