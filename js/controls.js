// Pilot control forces for the Learjet 60's reversible (cable / push-rod, unboosted) ailerons and elevator.
//
// The player's input axes are treated as the FORCE the pilot applies, as a fraction of what a pilot can apply; the
// surface moves until its hinge moment balances that force. Hinge moment grows with dynamic pressure, and with Mach
// in the transonic range, so at high speed the same pull buys less elevator. The horizontal stabilizer trims as a
// whole (electric actuator, no tab), so trim changes how much elevator is needed rather than the force per degree:
// mis-trim shows up as a large standing elevator deflection, i.e. a large standing force.
//
// Calibration: AFM FM-123 (Change 37, Pitch Axis Malfunction): "a nose-down pitch trim system runaway, or nose-down
// overspeed can ... require control forces in excess of 75 pounds for recovery". Here, holding full nose-down trim at
// Vmo (about 350 KIAS) takes ~100 lb. Pilot strength follows the FAR 25.143 levels for two hands: ~60 lb can be held,
// short bursts reach ~150 lb and tire within ~10 s (stamina). Ice on the stabilizer: the AFM lists "changes in elevator
// forces, and control column oscillations/pulsing"; with a stalled iced tail the column goes light and pulses.
//
// The autopilot drives the same surfaces through clutched servos the pilot can overpower; while it stays engaged its
// auto-trim keeps trimming against the pilot (the classic way to inherit a badly mis-trimmed airplane).
//
// With a force-feedback stick (js/ffb.js) the roles swap, as in the airplane: the stick's POSITION is the column's
// position, and the motor supplies the hinge moment. The spring's stiffness is the force per deflection (it grows with
// dynamic pressure and transonic Mach, and halves with a stalled iced tail); with the autopilot engaged its servo holds
// the spring centre at its command and the spring's saturation is the clutch slip force. The simulated pilot's
// strength still applies: the elevator never goes further than the pilot could hold against the hinge moment.
import { clamp, smoothstep } from './util.js';
import { ELEV_K } from './aircraft.js';

const KTS = 0.514444;
const Q250 = 0.5 * 1.225 * (250 * KTS) ** 2;      // dynamic pressure at 250 KEAS, Pa

export const FORCE = {
  // force (lb) for full surface deflection at 250 KEAS, subsonic
  elevFull250: 66 * ELEV_K,   // 165 lb -> ~100 lb to hold full nose-down trim at Vmo (needs ~0.31 elevator)
  ailFull250: 34,
  rudFull250: 120,     // rudder boost (servo) takes ~40% of the pedal force when armed (AFM: engages near 50 lb)
  // pilot capability (lb): sustained, burst
  pitch: [60, 150], roll: [40, 90], yaw: [150, 250],
  apClutch: { pitch: 25, roll: 15 },   // force at which the autopilot servo clutches slip
};
// force feedback scaling: the column force (lb) that the stick's strongest spring stands for, and the stiffness of
// an engaged autopilot servo (lb for full stick travel away from its command)
export const FEEL = { pitchLb: 150 * ELEV_K, rollLb: 90, apStiff: { pitch: 60 * ELEV_K, roll: 36 } };

export class PilotControls {
  constructor() { this.reset(); }
  // Input -> force is progressive (|input|^1.5): fine control for small corrections, full strength at full deflection
  avail(ax) { return FORCE[ax][0] + (FORCE[ax][1] - FORCE[ax][0]) * this.stamina; }
  forceFor(input, ax) { const e = clamp(input, -1, 1); return Math.sign(e) * Math.abs(e) ** 1.5 * this.avail(ax); }
  inputFor(force, ax) { const f = clamp(force / this.avail(ax), -1, 1); return Math.sign(f) * Math.abs(f) ** (1 / 1.5); }
  reset() { this.ap = null; this.iceP = 0; this.stamina = 1; this.pitchLb = 0; this.rollLb = 0; this.yawLb = 0; this.need = { pitch: 0, roll: 0 }; this.pulse = 0; this.slipping = false; }

  // input: {elev, ail, rud} in [-1, 1] (fraction of the pilot's available force); st: aircraft telemetry + state
  // ap: {on, elev, ail} the autopilot's own servo commands. Returns surface deflections {elev, ail, rud}.
  step(dt, input, st, ap) {
    const q = Math.max(st.qbar || 0, 200), M = st.M || 0;
    const trans = 1 + 0.5 * smoothstep(0.82, 0.93, M);               // transonic hinge-moment growth
    let needE = FORCE.elevFull250 * q / Q250 * trans;                 // lb for full elevator
    const needA = FORCE.ailFull250 * q / Q250 * trans, needR = FORCE.rudFull250 * q / Q250 * 0.6;
    // stalled iced tail: elevator floats, forces go light (and pulse, below)
    if (st.tailStalled) needE *= 0.45;
    let fP = this.forceFor(input.elev, 'pitch'), fA = this.forceFor(input.ail, 'roll');
    const fR = this.forceFor(input.rud, 'yaw');
    // force-feedback stick: its position is the column's (input.posElev / posAil, null without one)
    const pE = input.posElev ?? null, pA = input.posAil ?? null;
    let dE, dA;
    this.slipping = false; this.ap = ap && ap.on ? ap : null;
    if (ap && ap.on) {
      // a stick held away from the servo's command loads the clutch
      if (pE !== null) fP += (pE - ap.elev) * FEEL.apStiff.pitch;
      if (pA !== null) fA += (pA - ap.ail) * FEEL.apStiff.roll;
      // Clutched servos: the autopilot holds its command until the pilot's force exceeds the slip force,
      // then the surface follows the excess (and the AP keeps trimming against it)
      const slip = (f, c) => Math.sign(f) * Math.max(0, Math.abs(f) - c);
      const eP = slip(fP, FORCE.apClutch.pitch), eA = slip(fA, FORCE.apClutch.roll);
      this.slipping = eP !== 0 || eA !== 0;
      dE = clamp(ap.elev + eP / needE, -1, 1); dA = clamp(ap.ail + eA / needA, -1, 1);
    } else {
      // position from the stick (other inputs add force on top), limited to what the pilot can hold
      const pos = (p, f, need, ax) => { const lim = Math.min(1, this.avail(ax) / need); return clamp(p + f / need, -lim, lim); };
      dE = pE !== null ? pos(pE, fP, needE, 'pitch') : clamp(fP / needE, -1, 1);
      dA = pA !== null ? pos(pA, fA, needA, 'roll') : clamp(fA / needA, -1, 1);
    }
    const dR = clamp(fR / needR, -1, 1);
    // the force actually on the column: what holds the achieved deflection (full travel can be reached with force to spare)
    this.pitchLb = dE * needE; this.rollLb = dA * needA; this.yawLb = dR * needR;
    if (ap && ap.on) { this.pitchLb = fP; this.rollLb = fA; }
    // column pulsing with ice on the stabilizer (AFM), stronger with a stalled tail and with power
    const iceP = st.tailStalled ? 1 : smoothstep(0.35, 0.8, st.iceTail || 0) * 0.5;
    this.pulse += dt * 9.0;
    const jitter = iceP * (0.06 + 0.06 * (st.n1 || 0)) / ELEV_K * Math.sin(this.pulse) * Math.sin(this.pulse * 0.37 + 1);
    dE = clamp(dE + jitter, -1, 1);
    // stamina: drains while the pull exceeds what can be held, recovers when relaxed
    const over = Math.max(0, Math.abs(this.pitchLb) - FORCE.pitch[0]) / (FORCE.pitch[1] - FORCE.pitch[0])
      + Math.max(0, Math.abs(this.rollLb) - FORCE.roll[0]) / (FORCE.roll[1] - FORCE.roll[0]);
    this.stamina = clamp(this.stamina - dt * 0.11 * over + (over < 0.02 ? dt * 0.035 : 0), 0, 1);
    this.need = { pitch: needE, roll: needA }; this.iceP = iceP;
    return { elev: dE, ail: dA, rud: dR };
  }

  // What the column feels like now, for a force-feedback stick (js/ffb.js), from the last step(). Stick units:
  // centre -1..1 (+ = pull / right), k = stiffness (1 = the stick's strongest spring = FEEL lb per full travel),
  // sat = force cap. Shake: the stick shaker, buffet, breakup, and the iced-tail column pulsing.
  feel({ shaker = false, buffet = false, broken = false } = {}) {
    const ap = this.ap, n = this.need;
    const axis = (ax, need, fullLb) => ap
      ? { centre: clamp(ax === 'pitch' ? ap.elev : ap.ail, -1, 1), k: clamp(FEEL.apStiff[ax] / fullLb, 0, 1), sat: clamp(FORCE.apClutch[ax] / fullLb, 0, 1) }
      : { centre: 0, k: clamp(need / fullLb, 0, 1), sat: 1 };   // the stabilizer trims as a whole: zero elevator, zero force
    const shake = broken ? { mag: 0.8, periodMs: 45 } : shaker ? { mag: 0.35, periodMs: 70 } : buffet ? { mag: 0.18, periodMs: 110 }
      : this.iceP > 0.05 ? { mag: 0.25 * this.iceP, periodMs: 700 } : { mag: 0, periodMs: 100 };
    return { pitch: axis('pitch', n.pitch || 0, FEEL.pitchLb), roll: axis('roll', n.roll || 0, FEEL.rollLb), damp: 0.08 + 0.12 * clamp((n.pitch || 0) / FEEL.pitchLb, 0, 1), shake };
  }
}
