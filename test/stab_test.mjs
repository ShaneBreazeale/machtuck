import { Learjet60 } from '../js/aircraft.js';
import { DEG, RAD } from '../js/util.js';
import { FT } from '../js/atmo.js';
// Open-loop: trimmed cruise, 5 deg roll perturbation, no wind, no AP. Expect slow spiral/dutch roll, no departure.
let worst = 0, nan = false;
for (const yd of [true, false]) {
  const ac = new Learjet60(); ac.ctl.yd = yd;
  ac.setState({ n: 0, e: 0, d: -10668, psi: 0, theta: 1.95 * DEG, phi: 5 * DEG, V: 232 });
  ac.ctl.trim = 0.37; ac.ctl.thr = 0.8; ac.n1 = 0.8;
  const dt = 1 / 200; let rows = [];
  for (let t = 0; t < 40; t += dt) {
    const o = ac.step(dt, { wind: [0, 0, 0] }); worst = Math.max(worst, Math.abs(o.phi)); if (!Number.isFinite(o.phi + o.theta + o.V)) nan = true;
    if (Math.abs(t - Math.round(t)) < dt / 2 && Math.round(t) % 4 === 0) rows.push(`${t.toFixed(0)}\t${(o.h / FT).toFixed(0)}\t${o.M.toFixed(3)}\t${(o.theta * RAD).toFixed(1)}\t${(o.phi * RAD).toFixed(1)}\t${(o.beta * RAD).toFixed(2)}\t${(o.alpha * RAD).toFixed(2)}\t${o.nz.toFixed(2)}\t${(o.p * RAD).toFixed(1)}\t${(o.r * RAD).toFixed(2)}`);
  }
  console.log(`YD=${yd}\nt alt M pitch roll beta alpha nz p r\n` + rows.join('\n'));
}
// pass: no departure from a 5° upset in 40 s hands off (bank stays under 30°, nothing goes non-finite)
const ok = !nan && worst < 30 * DEG;
console.log(ok ? `PASS  no departure: peak bank ${(worst * RAD).toFixed(1)}°` : `FAIL  departure: peak bank ${(worst * RAD).toFixed(1)}°${nan ? ', non-finite state' : ''}`);
process.exit(ok ? 0 : 1);
