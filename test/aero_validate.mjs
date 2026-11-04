// Aerodynamics cross-check against what the AFM actually publishes. The AFM (FM-123) has no CL/CD/Cm curves, so
// the curves are checked through the quantities that depend on them:
//   1. Buffet boundary (Fig 5-24): its worked example, which sets CL_buffet at two Mach numbers. The chart is in
//      W/delta, so those CLs carry to any altitude. Tolerance: 2 KIAS on the low-speed edge.
//   2. FL350 buffet envelope at accident and bracketing weights, and how far it moves if the boundary drops by the
//      0.03-0.06 CL that separates SAE 932534 flight test from the AFM.
//   3. Mach tuck: stick-fixed elevator to trim vs Mach (1 g, FL350). The AFM cuts Mmo to 0.77 with the Mach trim
//      inoperative, so with it failed the trim gradient must still be stable at 0.77; with it working it must stay
//      stable to Mmo 0.81.
//   4. Physics that depends on the difficulty mode (hard vs trainer). Reported as a warning, not a pass.
// Stall speeds (Fig 5-22) and the CLmax-vs-Mach VA chart are in test/flight_test.mjs.   node test/aero_validate.mjs
import { clBuffet } from '../js/aero.js';
import { Learjet60, casKt, clAlphaAt, ELEV_POWER } from '../js/aircraft.js';
import { isa, FT } from '../js/atmo.js';
import { DEG, smoothstep } from '../js/util.js';

const LB = 0.45359237, S = 24.57, G = 9.80665;
let fails = 0;
const res = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const clReq = (hft, lb, M, n = 1) => n * lb * LB * G / (0.7 * isa(hft * FT).p * M * M * S);
const kias = (hft, M) => casKt(M, isa(hft * FT).p);

// ---- 1. AFM Fig 5-24 worked example: FL400, 18,000 lb -> 1 g low-speed buffet M0.57 (165 KIAS); M0.70 -> 1.56 g
{
  let M = 0.3; while (clReq(40000, 18000, M) > clBuffet(M)) M += 0.0005;
  const dKt = kias(40000, M) - kias(40000, 0.57);
  res(Math.abs(dKt) <= 2, `Fig 5-24 FL400 18k lb 1 g low-speed buffet: model ${kias(40000, M).toFixed(1)} KIAS (M${M.toFixed(3)}) vs AFM 165 (M0.57): ${dKt.toFixed(1)} kt`);
  const n70 = clBuffet(0.70) / clReq(40000, 18000, 0.70);
  res(Math.abs(n70 - 1.56) <= 0.03, `Fig 5-24 FL400 18k lb M0.70 buffet-onset g: model ${n70.toFixed(2)} vs AFM 1.56`);
  for (const [Mx, cl] of [[0.57, clReq(40000, 18000, 0.57)], [0.70, clReq(40000, 18000, 0.70, 1.56)]])
    console.log(`      CL_buffet M${Mx}: AFM ${cl.toFixed(3)}, model ${clBuffet(Mx).toFixed(3)} (+${(clBuffet(Mx) - cl).toFixed(3)})`);
}

// ---- 2. FL350 buffet envelope (KIAS), as modelled and with the boundary lowered toward the AFM
{
  const edges = (lb, n, d) => { let lo = null, hi = null;
    for (let M = 0.3; M < 0.95; M += 0.0005) if (clReq(35000, lb, M, n) <= clBuffet(M) - d) { lo ??= M; hi = M; }
    return lo == null ? ['closed', ''] : [kias(35000, lo).toFixed(0), kias(35000, hi).toFixed(0)]; };
  console.log('\nFL350 buffet-free window, KIAS (low .. high):        model     dCL -0.03   dCL -0.06');
  for (const lb of [17000, 20700, 23000]) for (const n of [1, 1.3])
    console.log(`  ${lb} lb ${n.toFixed(1)} g`.padEnd(52) + [0, 0.03, 0.06].map((d) => edges(lb, n, d).join('..').padEnd(12)).join(''));
}

// ---- 3. Stick-fixed speed stability through the tuck: elevator to trim (Cm = 0) vs Mach, FL350, 20,700 lb, 1 g
const tuckCm = (hard, machTrim, M) => {
  let t = hard ? -0.14 * smoothstep(0.78, 0.92, M) : -0.09 * smoothstep(0.80, 0.93, M);   // mirrors aircraft.js step()
  if (machTrim) t -= Math.max(t, -0.05) * 0.9;
  return t;
};
const elevToTrim = (ac, hard, machTrim, M) => {
  const alpha = clReq(35000, 20700, M) / clAlphaAt(M) - 1.5 * DEG;
  return -(0.02 + ac.cmAlpha(M) * (alpha + 1.5 * DEG) + tuckCm(hard, machTrim, M)) / ELEV_POWER;
};
// Mach at which more pull is needed to hold 1 g as speed rises (the trim gradient reverses)
const reversal = (hard, machTrim) => { const ac = new Learjet60();
  for (let M = 0.70; M < 0.95; M += 0.0025) if (elevToTrim(ac, hard, machTrim, M + 0.0025) > elevToTrim(ac, hard, machTrim, M)) return M;
  return Infinity; };
console.log('');
for (const hard of [true, false]) {
  const on = reversal(hard, true), off = reversal(hard, false), tag = hard ? 'as flown' : 'trainer ';
  res(off > 0.77, `tuck ${tag}: Mach trim failed, trim gradient reverses at M${off.toFixed(3)} (AFM Mmo with Mach trim inop 0.77)`);
  res(on > 0.81, `tuck ${tag}: Mach trim working, trim gradient reverses at M${on.toFixed(3)} (Mmo 0.81, MD 0.89)`);
}

// ---- 4. Physics that changes with the difficulty mode
{
  const d = [0.81, 0.85, 0.89].map((M) => `M${M} ${tuckCm(true, false, M).toFixed(3)}/${tuckCm(false, false, M).toFixed(3)}`).join('  ');
  console.log(`\nWARN  mode-dependent aerodynamics: tuck dCm as flown/trainer (Mach trim off) ${d}`);
  console.log('      also mode-dependent: tail incidence per elevator (8 vs 6 deg), iced-tail effectiveness, stalled-tail effectiveness and');
  console.log('      pitch-down (-0.17 vs -0.22), tail re-attach margin (3.0 vs 1.5 deg). A hypothesis outcome flown "as flown" is partly set by these.');
}

console.log(fails ? `\n${fails} aero check(s) failed` : '\nall aero checks passed');
process.exit(fails ? 1 : 0);
