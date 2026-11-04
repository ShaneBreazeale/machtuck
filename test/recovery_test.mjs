// Pass/fail judgement: an early takeover that just holds level flight must not count as a recovery.
// Runs the as-flown scenario with three pilots and compares the old rule (AP off 3 s, then 3 s stable) with
// RecoveryJudge (a real upset first, then 10 s of stable flight). Exits non-zero on a failed expectation.
import { Learjet60, ELEV_K, ELEV_POWER, STAB } from '../js/aircraft.js';
import { Environment, Autopilot, buildGhost, RecoveryJudge, UPSET_T, EVENT_T } from '../js/scenario.js';
import { DEG } from '../js/util.js';
import { FT } from '../js/atmo.js';

// MODE=trainer runs the trainer's autopilot (slower auto-trim, no nose-down handover trim); the airplane is the same
const HARD = process.env.MODE !== 'trainer';
const ghost = buildGhost(), clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// Turbulence, gusts and lightning draw on Math.random: seed it per run so each case is reproducible
const seed = (n) => { let a = n >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const SEEDS = (process.env.SEEDS || '1,2,3,4,5').split(',').map(Number);

function run(hyp, pilot, takeoverT = null) {
  const ac = new Learjet60(), env = new Environment(hyp, HARD), ap = new Autopilot(HARD);
  ac.failures.tailIce = env.hyp.tailIce; ac.failures.tuck = env.hyp.tuck;
  const g0 = ghost[0];
  ac.setState({ n: g0.n, e: g0.e, d: g0.d, psi: g0.hdg, theta: 1.95 * DEG, phi: 0, V: 232 });
  ac.ctl.trim = 0.37; ac.ctl.thr = 0.83; ac.n1 = 0.83; ac.ice = 0.15; ac.iceTail = 0.25; ac.sys.machTrimFail = !!env.hyp.machTrimFail;
  const judge = new RecoveryJudge(), dt = 1 / 200;
  let t = 0, apOffAt = null, oldRecovered = null, oldStable = 0;
  while (t < 220 && !ac.crashed && !ac.broken) {
    const wind = env.wind(ac.pos, t, dt);
    if (takeoverT !== null && t >= takeoverT && ap.on) ap.disconnect('PILOT');
    const out = ac.step(dt, { wind });
    const ir = env.iceRates(env.L, ac);
    ac.ice = clamp(ac.ice + ir.wing * dt, 0, 1); ac.iceTail = clamp(ac.iceTail + ir.tail * dt, 0, 1); ac.engIce = clamp(ac.engIce + ir.eng * dt, 0, 1);
    ap.hdgTgt = t < 25 ? 58 : Math.min(100, 58 + (t - 25) * (42 / 45));
    if (env.hyp.trimRunaway && t > UPSET_T && t < UPSET_T + 12 && ac.sys.trimMode === 'PRI') ac.ctl.trim = Math.max(STAB.min, ac.ctl.trim - 0.3 * dt);   // as main.js
    ap.step(ac, dt, out);
    env.scriptedUpset(ac, ap, t); if (ac.tailStalled && ap.on) ap.disconnect('PITCH');
    if (ap.on && env.hyp.trimRunaway && ac.ctl.trim < -0.5) ap.disconnect('TRIM');
    if (!ap.on && apOffAt === null) apOffAt = t;
    if (!ap.on) pilot(ac, out, t, apOffAt);
    // the rule main.js used before RecoveryJudge
    if (apOffAt !== null && oldRecovered === null && t - apOffAt > 3 && Math.abs(out.phi) < 15 * DEG && out.theta > -5 * DEG && out.vs > -7.6 && out.nz > 0.6 && out.nz < 1.6 && !out.overspeed) {
      oldStable += dt; if (oldStable > 3) oldRecovered = t;
    } else oldStable = 0;
    judge.update(t, dt, out, ac);
    if (process.env.DBG && Math.floor(t / (+process.env.DBG || 10)) !== Math.floor((t - dt) / (+process.env.DBG || 10)) && t > 90 && t < 135) console.log('   ', t.toFixed(0), 'phi', (out.phi / DEG).toFixed(0), 'th', (out.theta / DEG).toFixed(1), 'vs', Math.round(out.vs / FT * 60), 'nzF', judge.nzF.toFixed(2), 'aoaF', judge.aoaF.toFixed(2), 'aoaN', out.aoaN.toFixed(2), 'os', out.overspeed, 'ts', ac.tailStalled, 'M', out.M.toFixed(3), 'elev', ac.ctl.elev.toFixed(2), 'trim', ac.ctl.trim.toFixed(2), 'thr', ac.ctl.thr, 'done', !!ac._done, 'iceT', ac.iceTail.toFixed(2));
    t += dt;
  }
  return { t, crashed: ac.crashed, broken: ac.broken, apOffAt, oldRecovered, upsetAt: judge.upsetAt, why: judge.why, recoveredAt: judge.recoveredAt,
    recoveredFt: judge.recoveredAt !== null ? judge.recoveredAlt / FT : null, avoidedAt: judge.avoidedAt };
}

// Attitude hold: wings level, pitch +2 deg (what a pilot does after clicking the AP off in cruise)
const holdLevel = (ac, out) => {
  ac.ctl.ail = clamp(2.0 * (-out.phi) - 0.3 * out.p, -1, 1);
  ac.ctl.elev = clamp(ac.ctl.elev + (3 * (2 * DEG - out.theta) - 0.8 * out.q) * (1 / 200) * 4 / ELEV_K, -1 / ELEV_K, 1 / ELEV_K);
};
const noPilot = () => {};
// Textbook upset recovery per AFM FM-123 Overspeed Recovery: idle, AP off, identify attitude, level wings (no pull
// while banked steeply), elevator and pitch trim to raise the nose, gear down when speed/attitude is extreme.
// No spoilers: the AFM forbids them in a nose-down upset (nose-down pitching moment above Vmo/Mmo).
const textbook = (ac, out, t, t0) => {
  if (t - t0 < 2.5) return;
  ac.ctl.thr = 0; ac.ctl.sb = 0;
  if (out.overspeed && (out.M > 0.85 || Math.abs(out.phi) > 60 * DEG)) ac.ctl.gear = 1;
  ac.ctl.ail = clamp(2.0 * (-out.phi) - 0.3 * out.p, -1, 1);
  let gCmd = Math.abs(out.phi) < 40 * DEG ? (out.M > 0.86 ? 1.8 : 2.4) : 1.0;
  if (out.buffet || out.stalled) gCmd = Math.min(gCmd, 0.9);
  ac.ctl.elev = clamp(ac.ctl.elev + (gCmd - out.nz) * 0.9 * (1 / 200) * 60 / ELEV_K, -1 / ELEV_K, 1 / ELEV_K);
  if (out.theta > 5 * DEG && out.vs > 0) ac.ctl.elev = 0;
  ac.ctl.trim = clamp(ac.ctl.trim + 0.25 / 200 * (ac.ctl.elev > 0.3 / ELEV_K ? 1 : ac.ctl.elev < -0.05 / ELEV_K ? -1 : 0), STAB.min, STAB.max);   // trim off the force either way
};

let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
const f = (v) => v === null ? '—' : v.toFixed(1);
for (const hyp of (process.env.HYP ? process.env.HYP.split(',') : ['combined', 'tail', 'tuck', 'trim'])) {
  console.log(`\n== ${hyp}`);
  const R = { early: [], none: [], good: [] };
  for (const sd of SEEDS) {
    seed(sd); R.early.push(run(hyp, holdLevel, 20)); seed(sd); R.none.push(run(hyp, noPilot)); seed(sd); R.good.push(run(hyp, textbook));
  }
  for (const [k, name] of [['early', 'take over at t 20, hold level'], ['none', 'no pilot input'], ['good', 'textbook recovery']]) for (const [i, r] of R[k].entries())
    console.log(`  ${name.padEnd(30)} seed ${SEEDS[i]}  end ${f(r.t)}${r.crashed ? ' CRASH' : ''}${r.broken ? ' BREAKUP' : ''} | old rule recovered ${f(r.oldRecovered)} | upset ${f(r.upsetAt)} (${r.why || '-'}) recovered ${f(r.recoveredAt)}${r.recoveredFt !== null ? ` at ${Math.round(r.recoveredFt)} ft` : ''} avoided ${f(r.avoidedAt)}`);
  expect(R.early.every(r => r.recoveredAt === null || r.upsetAt !== null && r.recoveredAt > r.upsetAt && r.upsetAt >= EVENT_T), `${hyp}: early takeover never credited before an upset (${SEEDS.length} seeds)`);
  expect(R.early.some(r => r.oldRecovered !== null && r.oldRecovered < UPSET_T), `${hyp}: (regression) the old rule did credit it before the upset`);
  // As flown, the autopilot hands over trimmed nose-down, so hands-off never recovers. The trainer's autopilot doesn't, and
  // the airplane can fly itself out (the judge credits that correctly): reported there, not asserted.
  const noneRec = R.none.filter(r => r.recoveredAt !== null).length;
  if (HARD) expect(noneRec === 0, `${hyp}: no pilot input never credited (${SEEDS.length} seeds)`);
  else console.log(`  no pilot input, trainer autopilot: recovers on its own ${noneRec}/${SEEDS.length}`);
  // A genuine recovery must still be credited: hand-flying through the event at cruise power (the early-takeover pilot)
  // rides out the upset and stabilises. Not in trim, where nobody selects SEC/OFF and the runaway wins.
  const heldOn = R.early.filter(r => r.upsetAt !== null && r.recoveredAt !== null).length;
  if (hyp !== 'trim') expect(heldOn === SEEDS.length, `${hyp}: hand-flown recovery through the event is credited (${heldOn}/${SEEDS.length} seeds)`);
  // The scripted textbook pilot stays at idle after the pull-up and ends up riding
  // the stick shaker or mushing past stall AOA; the old 3 s window called that RECOVERED. Reported, not asserted.
  const credited = R.good.filter(r => r.recoveredAt !== null && r.recoveredAt > r.upsetAt).length, oldC = R.good.filter(r => r.oldRecovered !== null).length;
  console.log(`  textbook pilot (AFM: idle, no spoilers, gear down if extreme): credited ${credited}/${SEEDS.length}, old rule ${oldC}/${SEEDS.length}`);
}
console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
