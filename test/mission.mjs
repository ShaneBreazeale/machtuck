// NBAA IFR range mission flown on the model's own drag and engine (quasi-steady):
//   taxi 10 min -> MCT climb on the AFM schedule -> long-range cruise (99% of max nm/lb, best
//   altitude re-chosen as weight burns off, >= 300 ft/min climb margin) -> idle descent;
//   reserves: 100 nm alternate, 30 min hold at 5,000 ft at best-endurance speed, 5 min approach.
// Target: 2,405 nm with 4 passengers + 2 crew, NBAA IFR reserves (100 nm alternate), ISA
// (Bombardier spec, as quoted by Wikipedia and SmartCockpit).   node test/mission.mjs
import { isa, KT } from '../js/atmo.js';
import { cd0, K_IND, cdTrim, cdWave } from '../js/aero.js';
import { cycle, maxN1, idleN1 } from '../js/engine.js';
import { casKt } from '../js/aircraft.js';

const FT = 0.3048, LB = 0.45359237, G = 9.80665, S = 24.57, NM = 1852;
const BOW = 14640, PAX = 4 * 200, FUEL = 7910;          // lb: operating weight incl. crew (spec), payload, usable fuel (AFM)

const machAtKias = (kias, p) => { let M = 0.05; while (M < 0.95 && casKt(M, p) < kias) M += 0.0005; return M; };
function drag(W, h, M, extraCD = 0) {
  const a = isa(h), V = M * a.a, q = 0.5 * a.rho * V * V, CL = W / (q * S);
  return q * S * (cd0(a.rho, V, a.T, M) + K_IND * CL * CL + cdTrim(CL) + cdWave(M, CL) + extraCD);
}
// Level flight: N1 for thrust = drag (both engines); null if beyond the MCT rating
function level(W, h, M, extraCD = 0) {
  const a = isa(h), D = drag(W, h, M, extraCD), nMax = maxN1(M, a.p, a.T);
  if (2 * cycle(nMax, M, a.p, a.T).F < D) return null;
  let lo = 20, hi = nMax;
  for (let i = 0; i < 30; i++) { const n = (lo + hi) / 2; if (2 * cycle(n, M, a.p, a.T).F < D) lo = n; else hi = n; }
  const c = cycle(hi, M, a.p, a.T);
  return { ff: 2 * c.ff, V: M * a.a, N1: hi, margin: (2 * cycle(nMax, M, a.p, a.T).F - D) / W * M * a.a };   // margin: climb m/s at MCT
}
// Long-range cruise at weight W: best altitude, LRC Mach (high-speed side, 99% of max specific range)
function lrc(W) {
  let best = null;
  for (let hf = 25000; hf <= 49000; hf += 2000) {
    const h = hf * FT, pts = [];
    for (let M = 0.55; M <= 0.82; M += 0.005) { const l = level(W, h, M); if (l && l.margin > 300 * FT / 60) pts.push({ M, sr: l.V / l.ff, ...l }); }
    if (!pts.length) continue;
    const srMax = Math.max(...pts.map((p) => p.sr));
    const p = pts.filter((q) => q.sr >= 0.99 * srMax).sort((x, y) => y.M - x.M)[0];
    if (!best || p.sr > best.sr) best = { ...p, h };
  }
  return best;
}
// MCT climb or idle descent along a speed schedule; returns { fuel kg, dist m, time s }
function climbDescend(W, h0, h1, schedule, idle = false) {
  let fuel = 0, dist = 0, time = 0; const dh = 250 * FT, dir = Math.sign(h1 - h0);
  for (let h = h0; dir * (h1 - h) > 1; h += dir * dh) {
    const a = isa(h), a2 = isa(h + dir * dh), M = schedule(h, a.p), M2 = schedule(h + dir * dh, a2.p);
    const V = M * a.a, dVdh = (M2 * a2.a - V) / (dir * dh);
    const n = idle ? idleN1() : maxN1(M, a.p, a.T), c = cycle(n, M, a.p, a.T);
    const T = 2 * c.F, D = drag(W, h, M);
    const vs = V * (T - D) / W / (1 + V / G * dVdh);                  // energy share for the speed schedule
    if (dir * vs <= 0.05) return null;                                  // cannot make the altitude
    const dt = dh / Math.abs(vs);
    fuel += 2 * c.ff * dt; dist += Math.sqrt(Math.max(0, V * V - vs * vs)) * dt; time += dt; W -= 2 * c.ff * dt * G;
  }
  return { fuel, dist, time };
}
const climbSched = (h, p) => (h > 32000 * FT ? 0.70 : machAtKias(250, p));            // AFM Fig 5-31 climb speeds
const descSched = (h, p) => Math.min(0.74, machAtKias(h > 10000 * FT ? 280 : 250, p));

function reserves(Wland) {          // fuel (kg) for: missed approach + 100 nm alternate, 30 min hold, 5 min approach
  const W = Wland * G;
  const up = climbDescend(W, 1500 * FT, 25000 * FT, climbSched), down = climbDescend(W, 25000 * FT, 1500 * FT, descSched, true);
  const cr = level(W, 25000 * FT, 0.70), crDist = Math.max(0, 100 * NM - up.dist - down.dist);
  let hold = null;                                                      // best-endurance speed at 5,000 ft
  for (let M = 0.25; M < 0.45; M += 0.005) { const l = level(W, 5000 * FT, M); if (l && (!hold || l.ff < hold.ff)) hold = l; }
  const appr = level(W, 1500 * FT, 0.21, 0.025 + 0.06 * 0.5);         // gear down, flaps 20, ~135 KIAS
  return up.fuel + crDist / cr.V * cr.ff + down.fuel + 30 * 60 * hold.ff + 5 * 60 * appr.ff;
}

// ---- Mission
const ramp = (BOW + PAX + FUEL) * LB, zfw = (BOW + PAX) * LB;
const taxi = 2 * cycle(idleN1(), 0, 101325, 288.15).ff * 600;
let W = ramp - taxi;
const climb = climbDescend(W * G, 1500 * FT, 41000 * FT, climbSched);
W -= climb.fuel;
// reserves at the (unknown) landing weight: fixed point
let res = reserves(zfw + 600 * LB);
for (let i = 0; i < 3; i++) res = reserves(zfw + res);
const descent = climbDescend((zfw + res + 150 * LB) * G, 41000 * FT, 1500 * FT, descSched, true);
const cruiseFuelAvail = W - (zfw + res + descent.fuel);
let cruiseDist = 0, cruiseTime = 0, burned = 0, first = null, last = null; const dt = 300;
while (burned < cruiseFuelAvail) {
  const c = lrc((W - burned) * G); if (!first) first = c; last = c;
  const f = Math.min(c.ff * dt, cruiseFuelAvail - burned);
  cruiseDist += c.V * f / c.ff; cruiseTime += f / c.ff; burned += f;
}
const range = (climb.dist + cruiseDist + descent.dist) / NM;
const lb = (kg) => (kg / LB).toFixed(0);
console.log(`Ramp ${lb(ramp)} lb (BOW ${BOW} + 4 pax ${PAX} + fuel ${FUEL}); ZFW ${lb(zfw)} lb`);
console.log(`taxi ${lb(taxi)} lb | climb to FL410: ${(climb.time / 60).toFixed(1)} min, ${(climb.dist / NM).toFixed(0)} nm, ${lb(climb.fuel)} lb`);
console.log(`cruise: start FL${(first.h / FT / 100).toFixed(0)} M${first.M.toFixed(3)} ${lb(first.ff * 3600)} lb/h -> end FL${(last.h / FT / 100).toFixed(0)} M${last.M.toFixed(3)} ${lb(last.ff * 3600)} lb/h; ${(cruiseDist / NM).toFixed(0)} nm, ${(cruiseTime / 3600).toFixed(2)} h, ${lb(cruiseFuelAvail)} lb`);
console.log(`descent: ${(descent.dist / NM).toFixed(0)} nm, ${lb(descent.fuel)} lb | NBAA reserves (100 nm alt + 30 min hold + 5 min appr): ${lb(res)} lb`);
console.log(`\nNBAA IFR range, 4 pax: ${range.toFixed(0)} nm   (spec 2,405 nm: ${((range / 2405 - 1) * 100).toFixed(1)}%)`);
const err = range / 2405 - 1;
console.log(Math.abs(err) <= 0.05 ? 'PASS  NBAA range within 5 % of the spec' : `FAIL  NBAA range ${(err * 100).toFixed(1)} % from the spec (limit 5 %)`);
process.exit(Math.abs(err) <= 0.05 ? 0 : 1);
