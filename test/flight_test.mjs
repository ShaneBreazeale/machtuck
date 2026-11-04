// Flight-test card: measures the model against published Learjet 60 figures and
// textbook handling qualities. Calm air, no ice, no failures, deterministic.
//   node test/flight_test.mjs
import { Learjet60, clMaxAt, casKt, flapCL, ELEV_K } from '../js/aircraft.js';
import { cd0, K_IND, cdTrim, cdWave, clBuffet } from '../js/aero.js';
import { cycle, maxN1 } from '../js/engine.js';
import { DEG, RAD, clamp } from '../js/util.js';
import { FT, KT, isa } from '../js/atmo.js';

Math.random = (() => { let s = 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const DT = 1 / 240, LB = 0.45359237;
const MTOW = 23500 * LB, MLW = 19500 * LB;

function make({ m = 9400, h = 35000 * FT, V = 232, dT = 0, flaps = 0, gear = 0 } = {}) {
  const ac = new Learjet60();
  ac.m = m; ac.fuel = 3000; ac.failures = { tailIce: false, tuck: false }; ac.hard = false; ac.ice = 0; ac.iceTail = 0;
  ac.ctl.flaps = flaps; ac.ctl.gear = gear;
  ac.setState({ n: 0, e: 0, d: -h, psi: 0, theta: 0, phi: 0, V });
  ac.dT = dT;
  return ac;
}
const step = (ac) => ac.step(DT, { wind: [0, 0, 0], dT: ac.dT ?? 0 });

// Autopilot-style pilot: flight-path command -> pitch attitude -> elevator, auto-trim offloads
// the elevator, wings level. vsDes in m/s.
function fly(ac, o, vsDes) {
  const gamma = Math.asin(clamp(vsDes / o.V, -0.5, 0.5));
  const thetaCmd = o.alpha * Math.cos(o.phi) + gamma;
  ac.ctl.elev = clamp((2.5 * (thetaCmd - o.theta) - 1.0 * o.q) / ELEV_K, -1, 1);
  ac.ctl.trim = clamp(ac.ctl.trim + ac.ctl.elev * ELEV_K * 0.5 * DT, -1, 1);
  ac.ctl.ail = clamp(-2 * o.phi - 0.3 * o.p, -1, 1);
}
const altHold = (h0, o) => clamp((h0 - o.h) * 0.1, -8, 8);
// Hold altitude + speed (throttle) until steady; returns the trimmed state
function trimLevel(ac, target, { mach = false, t = 240 } = {}) {
  const h0 = -ac.pos[2]; let o = step(ac), I = ac.ctl.thr;
  for (let i = 0; i < t / DT; i++) {
    fly(ac, o, altHold(h0, o));
    const sErr = mach ? (target - o.M) * 600 : target - o.KIAS;   // knots-ish
    I = clamp(I + sErr * 0.004 * DT, 0, 1);
    ac.ctl.thr = clamp(I + sErr * 0.03, 0, 1);
    o = step(ac);
    if (process.env.TRACE && i % (20 / DT | 0) === 0) console.log('trim', (i * DT).toFixed(0), (o.h / FT).toFixed(0), o.M.toFixed(3), ac.ctl.thr.toFixed(2), (o.theta * RAD).toFixed(1), (o.phi * RAD).toFixed(1), ac.ctl.trim.toFixed(2), ac.ctl.elev.toFixed(2));
  }
  return o;
}

const rows = [];
const rec = (name, got, target, note = '') => rows.push({ name, got, target, note });

// 1. Stall speeds, AFM method: idle, ~1 kt/s deceleration, pusher off. Targets read off
//    AFM Fig 5-22 (KCAS, low altitude). Speed = first loss of 1g lift (stall break).
function decelTo(ac, until, rate = 1) {
  ac.ctl.thr = 0; ac.n1 = 0; ac.sys.stallWarn = false;
  let o = step(ac), vsDes = 0, prev = o.KIAS, dV = -rate, shaker = null, buffet = null, t = 0;
  while (t < 400) {
    fly(ac, o, vsDes);
    o = step(ac); t += DT;
    dV += ((o.KIAS - prev) / DT - dV) * DT / 1.0; prev = o.KIAS;   // filtered kt/s
    vsDes = clamp(vsDes + (dV + rate) * 2 * DT, -30, 30);          // too slow a decel -> climb
    if (t > 10 && o.shaker && !shaker) shaker = o;
    if (t > 10 && o.buffet && !buffet) buffet = o;
    if (t > 10 && until(o)) return { o, shaker, buffet };
  }
  return { o: null, shaker, buffet };
}
const AFM_STALL = { 0: [102, 129], 0.2: [99, 126], 0.5: [95, 121], 1: [91, 115] };   // [14,000 lb, 23,500 lb]
// Static 1g stall speed at 2,000 ft: CLmax(M) + flap increment, solved for Mach (KCAS)
const staticStall = (lb, f) => { const atm = isa(2000 * FT), W = lb * LB * 9.80665;
  let M = 0.1; while (M < 0.5 && W / (0.7 * atm.p * M * M * 24.57) > clMaxAt(M) + flapCL(f)) M += 0.0005; return casKt(M, atm.p); };
for (const f of [0, 0.2, 0.5, 1]) rec(`stall KCAS flaps ${f * 40}°, 14k / 23.5k lb`, [14000, 23500].map((lb) => staticStall(lb, f).toFixed(0)).join(' / '), `${AFM_STALL[f][0]} / ${AFM_STALL[f][1]}`, 'AFM Fig 5-22 (1g, static)');
{ // and the sim actually gets there: idle decel to the stall break, MTOW clean, pusher off
  const ac = make({ m: MTOW, h: 2000 * FT, V: 90 }); ac.ctl.trim = 0.4;
  const r = decelTo(ac, (o) => o.stalled);
  rec('dynamic stall, clean MTOW (KCAS)', r.o ? r.o.KIAS.toFixed(0) : 'none', '~129 (a few kt below 1g in a 1 kt/s entry)', `shaker ${r.shaker?.KIAS.toFixed(0)} (AFM: 0.82 normalized AOA)`);
}
// AFM Fig 5-24 example: FL400, 18,000 lb, 1g -> low-speed buffet M0.57 (165 KIAS);
// M0.70 -> buffet onset at 1.56 g (50° bank). Static: the model's own buffet boundary.
{
  const atm = isa(40000 * FT), W = 18000 * LB * 9.80665;
  const clReq = (M, n) => n * W / (0.7 * atm.p * M * M * 24.57);
  let Mlow = 0.3; while (Mlow < 0.9 && clReq(Mlow, 1) > clBuffet(Mlow)) Mlow += 0.001;
  const nBuf = (M) => clBuffet(M) / clReq(M, 1);
  rec('FL400 18k lb 1g low-speed buffet Mach', `${Mlow.toFixed(3)} (${casKt(Mlow, atm.p).toFixed(0)} KIAS)`, '0.57 (165 KIAS)', `stall M${(() => { let m = 0.3; while (clReq(m, 1) > clMaxAt(m)) m += 0.001; return m.toFixed(3); })()}`);
  rec('FL400 18k lb buffet-onset g at M0.70', nBuf(0.70).toFixed(2), '1.56', `M0.78: ${nBuf(0.78).toFixed(2)} g, M0.81: ${nBuf(0.81).toFixed(2)} g`);
}

// SAE 932534 Fig 19: Model 60 flight-test buffet-onset envelope (digitized), aircraft CL
{
  const FTB = [[0.50, 0.87], [0.55, 0.83], [0.63, 0.825], [0.70, 0.835], [0.72, 0.81], [0.75, 0.74], [0.78, 0.60], [0.80, 0.52], [0.815, 0.45]];
  const errs = FTB.map(([M, c]) => clBuffet(M) - c);
  rec('buffet CL vs flight test (SAE 932534)', `rms ${Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length).toFixed(3)}`, 'rms dCL < 0.03',
    FTB.map(([M, c]) => `${M}:${clBuffet(M).toFixed(2)}/${c}`).join(' '));
}

// EASA TCDS IM.A.212 Issue 04 p10: maneuvering speed VA (KIAS) vs altitude per weight, digitized; 'top' = where the
// line meets Mmo. Part 25.335(c): at VA a full pull stalls the wing at the 3.0 g limit load -> the model's max g there.
{
  const VA = { 16500: [[0, 200], [20, 237], [25, 245], [30, 250], ['top', 254]], 18000: [[0, 212], [20, 247], [25, 255], [30, 259], ['top', 264]],
    19500: [[0, 225], [20, 254], [25, 261], [30, 265], ['top', 274]], 22750: [[0, 249], [20, 278], [25, 286], [30, 295], ['top', 297]] };
  const mmo = (hf) => hf < 37000 ? 0.81 : 0.81 - 0.03 * (hf - 37000) / 6000;
  const machAt = (hf, kt) => { const p = isa(hf * FT).p; let M = 0.05; while (casKt(M, p) < kt) M += 0.0005; return M; };
  const ns = [];
  for (const [lb, pts] of Object.entries(VA)) for (let [kft, kt] of pts) {
    let hf = kft * 1000;
    if (kft === 'top') for (hf = 0; hf < 51000 && machAt(hf, kt) < mmo(hf); hf += 100);
    const M = machAt(hf, kt);
    ns.push(clMaxAt(M) * 0.7 * isa(hf * FT).p * M * M * 24.57 / (lb * LB * 9.80665));
  }
  rec('max g at VA (EASA TCDS chart, 20 pts)', `${Math.min(...ns).toFixed(2)}-${Math.max(...ns).toFixed(2)}`, '3.0 +/- 0.15', 'Part 25.335(c)');
}

// 2. Cruise: thrust needed for M0.76 at FL410 (typical cruise), fuel flow, and max level Mach at full thrust
{
  const ac = make({ m: 8600, h: 41000 * FT, V: 225 });
  ac.ctl.thr = 0.7; ac.n1 = 0.7;
  const o = trimLevel(ac, 0.76, { mach: true });
  rec('FL410 M0.76 thrust lever', ac.ctl.thr.toFixed(2), '< 0.9 (cruise power)', `KIAS ${o.KIAS.toFixed(0)}, alpha ${(o.alpha * RAD).toFixed(1)}°, L/D ${(o.CL / o.CD).toFixed(1)}`);
  rec('FL410 M0.76 fuel flow lb/h', (o.ff / LB * 3600).toFixed(0), '~1200-1300');
}
{
  // Max level Mach at FL410 / 8,600 kg: thrust at the MCT rating = 1g drag (direct balance)
  const atm = isa(41000 * FT), W = 8600 * 9.80665;
  const net = (M) => {
    const V = M * atm.a, q = 0.5 * atm.rho * V * V, CL = W / (q * 24.57);
    const D = q * 24.57 * (cd0(atm.rho, V, atm.T, M) + K_IND * CL * CL + cdTrim(CL) + cdWave(M, CL));
    return 2 * cycle(maxN1(M, atm.p, atm.T), M, atm.p, atm.T).F - D;
  };
  let M = 0.95; while (M > 0.6 && net(M) < 0) M -= 0.001;
  rec('FL410 max level Mach, MCT thrust', M.toFixed(3), '>= 0.81 (Mmo reachable in level flight)', `KTAS ${(M * atm.a / KT).toFixed(0)}`);
}

// Breguet range vs the 2,740 nm transcontinental range (SAE 932534): MTOW, full fuel 7,910 lb,
// cruise M0.76 at FL410, 30 min-at-cruise reserve + ~150 nm climb/descent allowance
{
  const atm = isa(41000 * FT), M = 0.76, V = M * atm.a;
  const at = (kg) => { const q = 0.7 * atm.p * M * M, CL = kg * 9.80665 / (q * 24.57);
    const CD = cd0(atm.rho, V, atm.T, M) + K_IND * CL * CL + cdTrim(CL) + cdWave(M, CL), D = q * 24.57 * CD;
    let n = 50; while (n < 102 && cycle(n, M, atm.p, atm.T).F * 2 < D) n += 0.05;      // N1 for thrust = drag
    const c = cycle(n, M, atm.p, atm.T); return { LD: CL / CD, tsfc: c.ff / c.F };   // kg/N/s
  };
  const W0 = MTOW - 700 * LB, W1 = (23500 - 7910) * LB, Wr = W1 + 0.5 * 3600 * 2 * 4.448 * 800 * at(W1).tsfc / 9.80665;   // 30 min reserve
  const mid = at((W0 + Wr) / 2), R = V / (mid.tsfc * 9.80665) * mid.LD * Math.log(W0 / Wr) / 1852 + 150;
  rec('Breguet range, full fuel, 30 min reserve (nm)', R.toFixed(0), 'gross check; NBAA mission: test/mission.mjs', `mid-cruise L/D ${mid.LD.toFixed(1)}, TSFC ${(mid.tsfc * 3600 * 9.80665).toFixed(3)} /h`);
}

// 3. Time to climb, MTOW, 1,500 ft -> FL410 at MCT on the AFM climb schedule
{
  const ac = make({ m: MTOW, h: 1500 * FT, V: 130, dT: 0 });
  ac.ctl.thr = 1; ac.n1 = 1;
  let o = step(ac), vsI = 12, t = 0, prevE = 0, dE = 0; const roc = [];
  const marks = [10000, 25000, 35000, 41000].map((a) => ({ a, t: null }));
  while (t < 2400 && !marks[3].t) {
    const hf = o.h / FT;
    const err = hf < 32000 ? o.KIAS - 250 : (o.M - 0.70) * 600;            // AFM climb schedule (Fig 5-31): 250 KIAS to FL320, M0.70 above
    // pitch for speed: too fast -> climb steeper (PI + rate damping so the phugoid stays quiet)
    dE += ((err - prevE) / DT - dE) * DT / 2; prevE = err;
    vsI = clamp(vsI + err * 0.01 * DT, 0, 40);
    fly(ac, o, clamp(vsI + 0.15 * err + 3 * dE, 0, 40)); o = step(ac); t += DT;
    for (const mk of marks) if (mk.t === null && hf >= mk.a) { mk.t = t; roc.push(`${mk.a / 1000}k ${(t / 60).toFixed(1)}m ${(o.vs / FT * 60).toFixed(0)}fpm ${o.KIAS.toFixed(0)}kt`); }
    if (process.env.TRACE && Math.abs(t % 60) < DT) console.log('climb', (t / 60).toFixed(0), hf.toFixed(0), o.KIAS.toFixed(0), o.M.toFixed(3), (o.vs / FT * 60).toFixed(0));
  }
  rec('time to climb MTOW -> FL410 (min)', marks[3].t ? (marks[3].t / 60).toFixed(1) : `>${(t / 60).toFixed(0)} (stuck ${(o.h / FT).toFixed(0)} ft)`, '~17-17.5 (18-18.5 from brake release, published)', roc.join(', '));
  rec('fuel burned in climb (lb)', ((MTOW - ac.m) / LB).toFixed(0), '~700-900');
}

// 4. Indicated airspeed vs exact compressible CAS at FL350 M0.78
{
  const atm = isa(35000 * FT, 0), M = 0.78;
  const qc = atm.p * ((1 + 0.2 * M * M) ** 3.5 - 1);
  const cas = 340.294 * Math.sqrt(5 * ((qc / 101325 + 1) ** (2 / 7) - 1)) / KT;
  const ac = make({ h: 35000 * FT, V: M * atm.a }); const o = step(ac);
  rec('KIAS at FL350 M0.78 (model vs exact CAS)', o.KIAS.toFixed(1), cas.toFixed(1));
}

// 5. Handling qualities from impulse responses at FL350 M0.78 (trimmed)
function trimmedCruise() {
  const ac = make({ h: 35000 * FT, V: 232 });
  ac.ctl.thr = 0.6; ac.n1 = 0.6;
  trimLevel(ac, 0.78, { mach: true, t: 150 });
  return ac;
}
function freeResponse(ac, kick, sig, secs) {
  const ctl = { ...ac.ctl }; kick(ac); const series = [];
  for (let i = 0; i < secs / DT; i++) { const o = step(ac); series.push(sig(o)); if (i === Math.round(0.5 / DT)) Object.assign(ac.ctl, ctl, { elev: ctl.elev, ail: ctl.ail, rud: ctl.rud }); }
  return series;
}
// Damped-oscillation fit: period from zero crossings, damping from log decrement of peaks
function osc(series, from = 0) {
  const s = series.slice(Math.round(from / DT)); const mean = s.slice(-Math.round(2 / DT)).reduce((a, b) => a + b, 0) / Math.round(2 / DT);
  const x = s.map((v) => v - mean), peaks = [];
  for (let i = 1; i < x.length - 1; i++) if (Math.abs(x[i]) > Math.abs(x[i - 1]) && Math.abs(x[i]) >= Math.abs(x[i + 1]) && Math.sign(x[i]) !== 0) {
    if (peaks.length && Math.sign(peaks[peaks.length - 1].v) === Math.sign(x[i])) { if (Math.abs(x[i]) > Math.abs(peaks[peaks.length - 1].v)) peaks[peaks.length - 1] = { i, v: x[i] }; }
    else peaks.push({ i, v: x[i] });
  }
  if (peaks.length < 3) return { T: NaN, zeta: peaks.length < 2 ? 1 : NaN };
  const T = 2 * (peaks[2].i - peaks[1].i) * DT / 1, d = Math.log(Math.abs(peaks[1].v / peaks[2].v)) * 2 / 2;   // half-period peaks
  const delta = 2 * d;  // log decrement per full period
  return { T, zeta: delta / Math.sqrt(4 * Math.PI ** 2 + delta ** 2) };
}
{
  // Short period: elevator doublet, alpha response over 8 s
  const ac = trimmedCruise();
  const a = freeResponse(ac, (a) => { a.ctl.elev += 0.08 / ELEV_K; }, (o) => o.alpha, 8);
  const sp = osc(a, 0.5);
  rec('short period: period s / damping', `${sp.T.toFixed(2)} / ${sp.zeta.toFixed(2)}`, 'damping 0.35-1.3 (MIL-F-8785C L1)');
  // Phugoid: speed perturbation, 300 s, controls fixed
  const ac2 = trimmedCruise();
  ac2.vel = ac2.vel.map((v) => v * 1.03);
  const sp2 = []; for (let i = 0; i < 400 / DT; i++) { const o = step(ac2); sp2.push(o.V); }
  const ph = osc(sp2.filter((_, i) => i % 24 === 0).flatMap((v) => Array(24).fill(v)), 2);
  rec('phugoid: period s / damping', `${ph.T.toFixed(0)} / ${ph.zeta.toFixed(3)}`, 'damping > 0.04 (L1)', `h drift ${((-ac2.pos[2]) / FT - 35000).toFixed(0)} ft`);
}
{
  // Dutch roll: rudder pulse, YD off
  const ac = trimmedCruise(); ac.ctl.yd = false;
  const b = freeResponse(ac, (a) => { a.ctl.rud = 0.3; }, (o) => o.beta, 25);
  const dr = osc(b, 0.6);
  rec('dutch roll YD off: period s / damping', `${dr.T.toFixed(2)} / ${dr.zeta.toFixed(2)}`, 'damping >= 0.08 (L1), YD on > 0.2');
  const ac2 = trimmedCruise(); ac2.ctl.yd = true;
  const b2 = freeResponse(ac2, (a) => { a.ctl.rud = 0.3; }, (o) => o.beta, 25);
  const dr2 = osc(b2, 0.6);
  rec('dutch roll YD on: period s / damping', `${dr2.T.toFixed(2)} / ${dr2.zeta.toFixed(2)}`, 'damping > 0.2');
}
{
  // Roll performance: full aileron step, time to 30° bank, peak roll rate
  const ac = trimmedCruise(); let t30 = null, pMax = 0;
  for (let i = 0; i < 4 / DT; i++) { ac.ctl.ail = 1; ac.ctl.elev = ac.ctl.elev; const o = step(ac); pMax = Math.max(pMax, o.p); if (!t30 && o.phi > 30 * DEG) t30 = i * DT; }
  rec('roll: time to 30° bank s / peak p °/s', `${t30?.toFixed(2)} / ${(pMax * RAD).toFixed(0)}`, '<= 2.0 s (Class II C/B); bizjet 30-60 °/s');
  // Spiral: 10° bank, hands off (YD on), time-to-double/half
  const ac2 = trimmedCruise(); let o = step(ac2);
  for (let i = 0; i < 6 / DT; i++) { ac2.ctl.ail = clamp(1.5 * (10 * DEG - o.phi) - 0.5 * o.p, -1, 1); o = step(ac2); }   // roll to 10° and hold
  ac2.ctl.ail = 0; ac2.w = [0, o.q, o.r]; const phi0 = o.phi;
  for (let i = 0; i < 30 / DT; i++) o = step(ac2);
  rec('spiral: bank after 30 s from 10°, hands off', (o.phi * RAD).toFixed(1), 'time to double > 20 s (L1)', `ratio ${(o.phi / phi0).toFixed(2)}`);
}
{
  // Static stability: stick-fixed elevator per g (manoeuvre margin) at FL350
  const ac = trimmedCruise(); const e0 = ac.ctl.elev; let o = step(ac);
  for (let i = 0; i < 6 / DT; i++) { ac.ctl.elev = e0 + 0.08 / ELEV_K; ac.ctl.ail = clamp(-2 * o.phi - 0.3 * o.p, -1, 1); o = step(ac); }
  rec('elevator step (dCm 0.0144): steady nz', o.nz.toFixed(2), '1.2-1.4 (full stick ~3-3.5 g)', `alpha ${(o.alpha * RAD).toFixed(1)}°`);
}

const w = [44, 30, 40];
console.log('check'.padEnd(w[0]) + 'model'.padEnd(w[1]) + 'target'.padEnd(w[2]) + 'notes');
for (const r of rows) console.log(r.name.padEnd(w[0]) + String(r.got).padEnd(w[1]) + String(r.target).padEnd(w[2]) + r.note);
