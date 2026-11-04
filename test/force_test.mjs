// Control-force model (js/controls.js): calibration against the AFM figure, normal handling, pilot fatigue, the
// autopilot's clutched servos, and the as-flown upset recovered by an AFM-procedure pilot with and without force limits.
import { Learjet60, ELEV_K, ELEV_POWER, STAB } from '../js/aircraft.js';
import { Environment, Autopilot, buildGhost, UPSET_T } from '../js/scenario.js';
import { PilotControls, FORCE } from '../js/controls.js';
import { DEG } from '../js/util.js';
import { FT } from '../js/atmo.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const KT = 0.514444, qOf = (keas) => 0.5 * 1.225 * (keas * KT) ** 2;
let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
const seed = (n) => { let a = n >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// ---- calibration ----
{
  const pc = new PilotControls();
  // AFM: nose-down trim runaway / nose-down overspeed "require control forces in excess of 75 pounds". Full nose-down
  // trim needs ~0.78 elevator (Cm 0.14 trim vs 0.18 elevator per unit); at Vmo ~350 KEAS, M 0.80:
  pc.step(1 / 60, { elev: 0, ail: 0, rud: 0 }, { qbar: qOf(350), M: 0.80 }, null);
  const holdRunaway = (0.14 / ELEV_POWER) * pc.need.pitch;
  expect(holdRunaway > 75 && holdRunaway < 140, `holding full nose-down trim at Vmo takes ${holdRunaway.toFixed(0)} lb (AFM: in excess of 75 lb)`);
  // cruise FL350 M0.77 (~255 KEAS): a normal correction is light
  const c = new PilotControls(); const s = c.step(1 / 60, { elev: 0.15, ail: 0, rud: 0 }, { qbar: qOf(255), M: 0.77 }, null);
  expect(Math.abs(c.pitchLb) < 25 && s.elev > 0.1 / ELEV_K, `cruise: 15% effort gives ${s.elev.toFixed(2)} elevator for ${c.pitchLb.toFixed(0)} lb`);
  // approach 130 KEAS: full travel well within a held force
  const a = new PilotControls(); const sa = a.step(1 / 60, { elev: 1, ail: 1, rud: 0 }, { qbar: qOf(130), M: 0.2 }, null);
  expect(sa.elev === 1 && Math.abs(a.pitchLb) < FORCE.pitch[0], `approach: full elevator for ${a.pitchLb.toFixed(0)} lb`);
  // 380 KEAS, M 0.88: even a full-strength pull buys only part of the elevator
  const h = new PilotControls(); const sh = h.step(1 / 60, { elev: 1, ail: 1, rud: 0 }, { qbar: qOf(380), M: 0.88 }, null);
  expect(sh.elev < 0.85 / ELEV_K && sh.elev > 0.4 / ELEV_K, `380 KEAS M0.88: full-strength pull gives ${sh.elev.toFixed(2)} elevator (${h.pitchLb.toFixed(0)} lb), aileron ${sh.ail.toFixed(2)}`);
  // fatigue: a full-strength pull at high speed tires within ~10 s
  const f = new PilotControls(); let t = 0; while (t < 30 && f.avail('pitch') > 90) { f.step(0.05, { elev: 1, ail: 0, rud: 0 }, { qbar: qOf(380), M: 0.88 }, null); t += 0.05; }
  expect(t > 5 && t < 15, `full-strength pull at 380 KEAS: available force falls below 90 lb after ${t.toFixed(1)} s (now ${f.pitchLb.toFixed(0)} lb)`);
  // autopilot clutches: a light push leaves the AP's command; a firm one slips the clutch
  const ap = new PilotControls();
  const s1 = ap.step(1 / 60, { elev: 0.2, ail: 0, rud: 0 }, { qbar: qOf(255), M: 0.77 }, { on: true, elev: 0.05, ail: 0 });
  const s2 = ap.step(1 / 60, { elev: 0.8, ail: 0, rud: 0 }, { qbar: qOf(255), M: 0.77 }, { on: true, elev: 0.05, ail: 0 });
  expect(s1.elev === 0.05, `AP engaged, light push (${ap.forceFor(0.2, 'pitch').toFixed(0)} lb): elevator stays at the AP's ${s1.elev.toFixed(2)}`);
  expect(s2.elev > 0.3 && ap.slipping, `AP engaged, firm pull: clutch slips, elevator ${s2.elev.toFixed(2)}`);
}

// ---- the as-flown upset, AFM-procedure pilot, with and without force limits ----
const ghost = buildGhost();
function run(hyp, limited, sd, delay = 2.0) {
  seed(sd);
  const ac = new Learjet60(), env = new Environment(hyp, true), ap = new Autopilot(true), pc = new PilotControls(); ac.hard = true;
  ac.failures.tailIce = env.hyp.tailIce; ac.failures.tuck = env.hyp.tuck;
  const g0 = ghost[0];
  ac.setState({ n: g0.n, e: g0.e, d: g0.d, psi: g0.hdg, theta: 1.95 * DEG, phi: 0, V: 232 });
  ac.ctl.trim = 0.37; ac.ctl.thr = 0.83; ac.n1 = 0.83; ac.ice = 0.15; ac.iceTail = 0.25; ac.sys.machTrimFail = !!env.hyp.machTrimFail;
  const dt = 1 / 200; let t = 0, apOff = null, stable = 0, rec = null, minH = 1e9, maxLb = 0, want = { elev: 0, ail: 0 };
  let recT = null;
  while (t < 200 && !ac.crashed && !ac.broken && !(recT !== null && t > recT + 10)) {   // the AFM procedure ends once recovered: stop 10 s later

    const wind = env.wind(ac.pos, t, dt);
    let out = ac.out || {};
    if (apOff !== null) {
      if (limited) {   // the pilot asks for a deflection; strength decides what the surfaces get
        const inp = { elev: pc.inputFor(want.elev * (pc.need.pitch || 50), 'pitch'), ail: pc.inputFor(want.ail * (pc.need.roll || 30), 'roll'), rud: 0 };
        const s = pc.step(dt, inp, { qbar: out.qbar, M: out.M, tailStalled: ac.tailStalled, iceTail: ac.iceTail, n1: ac.n1 }, null);
        ac.ctl.elev = s.elev; ac.ctl.ail = s.ail; maxLb = Math.max(maxLb, Math.abs(pc.pitchLb));
      } else { ac.ctl.elev = want.elev; ac.ctl.ail = want.ail; }
    }
    out = ac.step(dt, { wind });
    const ir = env.iceRates(env.L, ac);
    ac.ice = clamp(ac.ice + ir.wing * dt, 0, 1); ac.iceTail = clamp(ac.iceTail + ir.tail * dt, 0, 1); ac.engIce = clamp(ac.engIce + ir.eng * dt, 0, 1);
    ap.hdgTgt = t < 25 ? 58 : Math.min(100, 58 + (t - 25) * (42 / 45));
    if (env.hyp.trimRunaway && t > UPSET_T && t < UPSET_T + 12 && ac.sys.trimMode === 'PRI') ac.ctl.trim = Math.max(STAB.min, ac.ctl.trim - 0.3 * dt);
    ap.step(ac, dt, out);
    env.scriptedUpset(ac, ap, t); if (ac.tailStalled && ap.on) ap.disconnect('PITCH');
    if (ap.on && env.hyp.trimRunaway && ac.ctl.trim < -0.5) ap.disconnect('TRIM');
    if (!ap.on && apOff === null) { apOff = t; want = { elev: ac.ctl.elev, ail: ac.ctl.ail }; }
    if (apOff !== null && t - apOff > delay) {
      // AFM FM-123 overspeed recovery: idle, identify attitude, level wings, elevator + pitch trim to raise the nose,
      // gear down when extreme; no spoilers. Trim runaway: selector OFF first.
      ac.ctl.thr = 0; ac.ctl.sb = 0;
      if (env.hyp.trimRunaway) ac.sys.trimMode = 'OFF';
      if (out.overspeed && (out.M > 0.85 || Math.abs(out.phi) > 60 * DEG)) ac.ctl.gear = 1;
      want.ail = clamp(2.0 * (-out.phi) - 0.3 * out.p, -1, 1);
      const gCmd = Math.abs(out.phi) < 30 * DEG ? (out.M > 0.86 ? 1.8 : 2.3) : 1.0;
      want.elev = clamp(want.elev + ((out.buffet || out.stalled ? Math.min(gCmd, 0.9) : gCmd) - out.nz) * 0.9 * dt * 60 / ELEV_K, -1 / ELEV_K, 1 / ELEV_K);   // the scripted pilot's authority, in pitching moment, as calibrated
      if (out.theta > 3 * DEG && out.vs > 0) want.elev = Math.min(want.elev, 0.05 / ELEV_K);
      // trim off the column force, either way (with the full stabilizer range, never trimming back zooms the airplane)
      if (ac.sys.trimMode !== 'OFF' && want.elev > 0.25 / ELEV_K && out.nz < gCmd) ac.ctl.trim = Math.min(STAB.max, ac.ctl.trim + 0.25 * dt);   // not into a g overshoot
      else if (ac.sys.trimMode !== 'OFF' && want.elev < -0.05 / ELEV_K) ac.ctl.trim = Math.max(STAB.min, ac.ctl.trim - 0.25 * dt);
    }
    minH = Math.min(minH, out.h);
    if (apOff !== null && t > UPSET_T && Math.abs(out.phi) < 15 * DEG && out.vs > -7.6 && out.nz > 0.6 && out.nz < 1.6) { stable += dt; if (stable > 5 && rec === null) { rec = out.h; recT = t; } } else stable = 0;
    t += dt;
  }
  return { crashed: ac.crashed, broken: ac.broken, rec, minH, maxLb, why: ac.broken ? `${ac.brokenWhat} M${ac.maxM.toFixed(2)} ${Math.round(ac.maxKEAS)}KEAS ${ac.maxG.toFixed(1)}g/${ac.minG.toFixed(1)}g` : '' };
}
const fmt = (r) => `${r.broken ? 'BREAKUP' : r.crashed ? 'CRASH' : r.rec !== null ? `recovered ${Math.round(r.rec / FT)} ft` : 'not stabilised'}, lowest ${Math.round(r.minH / FT)} ft${r.maxLb ? `, peak column ${r.maxLb.toFixed(0)} lb` : ''}`;
const summary = { free: 0, limited: 0 };
for (const hyp of ['combined', 'tail', 'tuck', 'trim']) {
  console.log(`\n== ${hyp}`);
  for (const sd of [1, 2, 3]) {
    const a = run(hyp, false, sd), b = run(hyp, true, sd);
    console.log(`  seed ${sd}  free controls: ${fmt(a)}\n          force-limited: ${fmt(b)}`);
    summary.free += a.rec !== null; summary.limited += b.rec !== null;
    expect(Number.isFinite(b.minH), `${hyp} seed ${sd}: force-limited run is finite`);
  }
}
console.log(`\nrecovered (stable 5 s): free controls ${summary.free}/12, force-limited ${summary.limited}/12`);
// How fast the window closes: the same force-limited AFM pilot, starting the recovery N s after the autopilot lets go
console.log('\nreaction delay sweep (force-limited, seed 1): outcome / lowest altitude');
for (const hyp of ['combined', 'tail', 'tuck', 'trim']) {
  const row = [2, 5, 8, 12, 16, 20].map(d => { const r = run(hyp, true, 1, d); return `${String(d).padStart(2)} s: ${r.broken ? 'BREAKUP ' + r.why : r.crashed ? 'CRASH' : r.rec !== null ? Math.round(r.rec / FT) + ' ft' : 'unstable'}`; });
  console.log(`  ${hyp.padEnd(9)} ${row.join(' | ')}`);
}
expect(summary.limited <= summary.free, 'force limits never make the recovery easier');
console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
