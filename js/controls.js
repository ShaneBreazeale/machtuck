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
import { clamp, smoothstep } from './util.js';

const KTS = 0.514444;
const Q250 = 0.5 * 1.225 * (250 * KTS) ** 2;      // dynamic pressure at 250 KEAS, Pa

export const FORCE = {
  // force (lb) for full surface deflection at 250 KEAS, subsonic
  elevFull250: 66,     // -> ~100 lb to hold full nose-down trim at Vmo (needs ~0.78 elevator)
  ailFull250: 34,
  rudFull250: 120,     // rudder boost (servo) takes ~40% of the pedal force when armed (AFM: engages near 50 lb)
  // pilot capability (lb): sustained, burst
  pitch: [60, 150], roll: [40, 90], yaw: [150, 250],
  apClutch: { pitch: 25, roll: 15 },   // force at which the autopilot servo clutches slip
};

export class PilotControls {
  constructor() { this.reset(); }
  // Input -> force is progressive (|input|^1.5): fine control for small corrections, full strength at full deflection
  avail(ax) { return FORCE[ax][0] + (FORCE[ax][1] - FORCE[ax][0]) * this.stamina; }
  forceFor(input, ax) { const e = clamp(input, -1, 1); return Math.sign(e) * Math.abs(e) ** 1.5 * this.avail(ax); }
  inputFor(force, ax) { const f = clamp(force / this.avail(ax), -1, 1); return Math.sign(f) * Math.abs(f) ** (1 / 1.5); }
  reset() { this.stamina = 1; this.pitchLb = 0; this.rollLb = 0; this.yawLb = 0; this.need = { pitch: 0, roll: 0 }; this.pulse = 0; this.slipping = false; }

  // input: {elev, ail, rud} in [-1, 1] (fraction of the pilot's available force); st: aircraft telemetry + state
  // ap: {on, elev, ail} the autopilot's own servo commands. Returns surface deflections {elev, ail, rud}.
  step(dt, input, st, ap) {
    const q = Math.max(st.qbar || 0, 200), M = st.M || 0;
    const trans = 1 + 0.5 * smoothstep(0.82, 0.93, M);               // transonic hinge-moment growth
    let needE = FORCE.elevFull250 * q / Q250 * trans;                 // lb for full elevator
    const needA = FORCE.ailFull250 * q / Q250 * trans, needR = FORCE.rudFull250 * q / Q250 * 0.6;
    // stalled iced tail: elevator floats, forces go light (and pulse, below)
    if (st.tailStalled) needE *= 0.45;
    const fP = this.forceFor(input.elev, 'pitch'), fA = this.forceFor(input.ail, 'roll'), fR = this.forceFor(input.rud, 'yaw');
    let dE, dA;
    this.slipping = false;
    if (ap && ap.on) {
      // Clutched servos: the autopilot holds its command until the pilot's force exceeds the slip force,
      // then the surface follows the excess (and the AP keeps trimming against it)
      const slip = (f, c) => Math.sign(f) * Math.max(0, Math.abs(f) - c);
      const eP = slip(fP, FORCE.apClutch.pitch), eA = slip(fA, FORCE.apClutch.roll);
      this.slipping = eP !== 0 || eA !== 0;
      dE = clamp(ap.elev + eP / needE, -1, 1); dA = clamp(ap.ail + eA / needA, -1, 1);
    } else {
      dE = clamp(fP / needE, -1, 1); dA = clamp(fA / needA, -1, 1);
    }
    const dR = clamp(fR / needR, -1, 1);
    // the force actually on the column: what holds the achieved deflection (full travel can be reached with force to spare)
    this.pitchLb = dE * needE; this.rollLb = dA * needA; this.yawLb = dR * needR;
    if (ap && ap.on) { this.pitchLb = fP; this.rollLb = fA; }
    // column pulsing with ice on the stabilizer (AFM), stronger with a stalled tail and with power
    const iceP = st.tailStalled ? 1 : smoothstep(0.35, 0.8, st.iceTail || 0) * 0.5;
    this.pulse += dt * 9.0;
    const jitter = iceP * (0.06 + 0.06 * (st.n1 || 0)) * Math.sin(this.pulse) * Math.sin(this.pulse * 0.37 + 1);
    dE = clamp(dE + jitter, -1, 1);
    // stamina: drains while the pull exceeds what can be held, recovers when relaxed
    const over = Math.max(0, Math.abs(this.pitchLb) - FORCE.pitch[0]) / (FORCE.pitch[1] - FORCE.pitch[0])
      + Math.max(0, Math.abs(this.rollLb) - FORCE.roll[0]) / (FORCE.roll[1] - FORCE.roll[0]);
    this.stamina = clamp(this.stamina - dt * 0.11 * over + (over < 0.02 ? dt * 0.035 : 0), 0, 1);
    this.need = { pitch: needE, roll: needA };
    return { elev: dE, ail: dA, rud: dR };
  }
}
