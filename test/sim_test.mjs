import { Learjet60 } from '../js/aircraft.js';
import { Environment, Autopilot, buildGhost, ghostAt, STORM } from '../js/scenario.js';
import { DEG, RAD } from '../js/util.js';
import { FT, KT } from '../js/atmo.js';

const ghost = buildGhost();
const last = ghost[ghost.length - 1];
console.log('ghost pts', ghost.length, 'impact t', last.t, 'at n,e (km)', (last.n / 1000).toFixed(1), (last.e / 1000).toFixed(1), 'start', (ghost[0].n/1000).toFixed(1), (ghost[0].e/1000).toFixed(1));
console.log('ghost @142 alt ft', (-ghostAt(ghost,142).d/FT).toFixed(0), '@108', (-ghostAt(ghost,108).d/FT).toFixed(0));

function run(hyp, pilot, label, hard = true) {
  const ac = new Learjet60(), env = new Environment(hyp, hard), ap = new Autopilot(hard); ac.hard = hard;
  ac.failures.tailIce = env.hyp.tailIce; ac.failures.tuck = env.hyp.tuck;
  const g0 = ghost[0];
  ac.setState({ n: g0.n, e: g0.e, d: g0.d, psi: g0.hdg, theta: 1.4 * DEG, phi: 0, V: 232 });
  ac.ctl.trim = ac.trimFor(1.4 * DEG); ac.ctl.thr = 0.5; ac.n1 = 0.5; ac.ice = 0.15; ac.iceTail = 0.25; ac.sys.machTrimFail = !!env.hyp.machTrimFail;
  const dt = 1 / 200; let t = 0, lastLog = -1, recoveredAt = null, apOffAt = null;
  const rows = [];
  while (t < 200 && !ac.crashed && !ac.broken) {
    const wind = env.wind(ac.pos, t, dt);
    const out = ac.step(dt, { wind });
    const ir = env.iceRates(env.L, ac); ac.ice = Math.max(0, Math.min(1, ac.ice + ir.wing * dt)); ac.iceTail = Math.max(0, Math.min(1, ac.iceTail + ir.tail * dt)); ac.engIce = Math.max(0, Math.min(1, ac.engIce + ir.eng * dt));
    if (env.hyp.trimRunaway && t > 76) ac.ctl.trim = Math.max(-1, ac.ctl.trim - 0.35 * dt);
    ap.step(ac, dt, out);
    env.scriptedUpset(ac, ap, t); if (ac.tailStalled && ap.on) ap.disconnect('PITCH');
    ap.hdgTgt = t < 25 ? 58 : Math.min(100, 58 + (t - 25) * (42 / 45));
    if (!ap.on && apOffAt === null) apOffAt = t;
    if (!ap.on) pilot(ac, out, t, apOffAt);
    if (apOffAt !== null && recoveredAt === null && Math.abs(out.phi) < 15 * DEG && out.theta > -5 * DEG && out.vs > -5 && t - apOffAt > 2) recoveredAt = t;
    if (Math.floor(t) !== lastLog) { lastLog = Math.floor(t); if (lastLog % 4 === 0 || (t>70 && t<100 && lastLog%2===0)) rows.push([lastLog, (out.h / FT).toFixed(0), out.M.toFixed(3), out.KIAS.toFixed(0), (out.vs / FT * 60).toFixed(0), (out.theta * RAD).toFixed(1), (out.phi * RAD).toFixed(1), (out.alpha * RAD).toFixed(1), out.nz.toFixed(2), ac.iceTail.toFixed(2), out.tailStalled ? 'TS' : '', out.stalled ? 'ST' : '', ap.on ? 'AP' : '', env.L.core.toFixed(2), wind[2].toFixed(1), ac.ctl.trim.toFixed(2), ac.damage.toFixed(2)]); }
    t += dt;
  }
  console.log(`\n== ${label} (${hyp}) end t=${t.toFixed(1)} crashed=${ac.crashed} broken=${ac.broken}(${ac.brokenWhat}) apOff=${apOffAt?.toFixed(1)} (${ap.why}) recovered=${recoveredAt?.toFixed(1)} maxG=${ac.maxG.toFixed(2)} minG=${ac.minG.toFixed(2)} maxM=${ac.maxM.toFixed(3)} maxKEAS=${ac.maxKEAS.toFixed(0)} minAlt=${(-ac.pos[2]/FT).toFixed(0)}`);
  console.log('t alt M KIAS VS pitch roll alpha nz ice TS ST AP core wZ trim dmg');
  for (const r of rows) console.log(r.join('\t'));
}
const noPilot = () => {};
const goodPilot = (ac, out, t, t0) => {
  if (t - t0 < 2.5) return;   // human reaction time
  // Upset recovery: idle, speedbrakes, roll wings level, then unload/pull smoothly to ~2.3g, avoid buffet.
  ac.ctl.thr = 0; ac.ctl.sb = 1;
  const rollErr = -out.phi; ac.ctl.ail = Math.max(-1, Math.min(1, 2.0 * rollErr - 0.3 * out.p));
  const level = Math.abs(out.phi) < 40 * DEG;
  let gCmd = level ? (out.M > 0.86 ? 1.8 : 2.4) : 1.0;
  if (out.buffet || out.stalled) gCmd = Math.min(gCmd, 0.9);   // unload when the iced wing lets go
  ac.ctl.elev = Math.max(-1, Math.min(1, ac.ctl.elev + (gCmd - out.nz) * 0.9 * (1/200) * 60));
  if (out.theta > 5 * DEG && out.vs > 0) ac.ctl.elev = 0;
  ac.ctl.trim = Math.min(1, ac.ctl.trim + 0.25 / 200 * (ac.ctl.elev > 0.3 ? 1 : 0));
};
const wingsLevel = (ac, out) => { ac.ctl.ail = Math.max(-1, Math.min(1, 2.0 * (-out.phi) - 0.3 * out.p)); ac.ctl.elev = 0; };
const wingsLevelIdle = (ac, out) => { wingsLevel(ac, out); ac.ctl.thr = 0; ac.ctl.sb = 1; };
run('combined', noPilot, 'HARD no pilot input');
run('combined', wingsLevel, 'HARD wings level only');
run('combined', wingsLevelIdle, 'HARD wings level + idle + spoilers');
run('combined', goodPilot, 'HARD textbook');
run('combined', wingsLevel, 'TRAINER wings level only', false);
run('tail', goodPilot, 'HARD textbook'); run('tuck', goodPilot, 'HARD textbook'); run('trim', goodPilot, 'HARD textbook');
