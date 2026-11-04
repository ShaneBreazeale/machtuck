// Learjet 60 six-degree-of-freedom flight model.
// Physics frame: NED (north, east, down). Body frame: x forward, y right, z down.
// Coefficients are engineering approximations tuned to published Lear 60 figures
// (S=264.5 sq ft, MTOW 23,500 lb, 2x PW305A 4,600 lbf, Mmo 0.81, ceiling 51,000 ft).
import { DEG, RAD, clamp, lerp, smoothstep, qfromEuler, qmat, mulMV, mulMTV, eulerFromMat, qIntegrate } from './util.js';
import { isa, G0, KT, RHO0 } from './atmo.js';
import { cd0, K_IND, cdTrim, clAlpha, clBuffet, clMaxCompressible, cdWave, buffetMach } from './aero.js';
import { cycle, maxN1, idleN1, takeoffN1 } from './engine.js';
import { Ground, groundAlt, groundEffect } from './ground.js';

const ALPHA0 = -1.5 * DEG;
// Calibrated airspeed (kt) from Mach and static pressure: the pitot-static formula an air data
// computer solves (subsonic). At FL350 M0.78 it reads ~11 kt above EAS.
const P0 = 101325, A0 = 340.294;
export const casKt = (M, p) => {
  const qc = p * ((1 + 0.2 * M * M) ** 3.5 - 1);
  return A0 * Math.sqrt(5 * ((qc / P0 + 1) ** (2 / 7) - 1)) / KT;
};
// Piecewise-linear table lookup: pts = [[x, y], ...] sorted by x, clamped at the ends
const table = (pts, x) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) return lerp(pts[i - 1][1], pts[i][1], (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]));
  return pts[pts.length - 1][1];
};
// Clean CLmax vs Mach, from documentation where it exists:
//   - low speed: the AFM stall chart (Fig 5-22: 129 KCAS at 23,500 lb, 102 KCAS at 14,000 lb, flaps up, idle -> ~1.55)
//   - M 0.30-0.81: the maneuvering-speed lines of the certified airspeed limits chart (EASA TCDS IM.A.212 Issue 04,
//     p10: VA for 16,500-23,100 lb from sea level to Mmo). Part 25.335(c) sets VA where max lift gives the 3.0 g
//     limit load, so each point is CNmax = 3 W / (q S). Twenty points over four weights collapse onto one curve
//     (scatter ~0.03); extrapolated to M 0.2 it meets the stall chart's 1.55. Max lift falls fast to M 0.5, then
//     holds ~0.97 to Mmo, well above shock-buffet onset (0.52 at M 0.80, SAE 932534): the wing can be pulled deep
//     into buffet before it stalls.
//   - above M 0.81 (undocumented): the section pressure model's Mach falloff (aero.js), anchored at the chart's 0.97.
// Ice cuts it.
export const CLMAX_LOWSPEED = 1.55;
const CLMAX_DOC = [[0.20, 1.55], [0.30, 1.38], [0.34, 1.30], [0.38, 1.23], [0.52, 1.03], [0.60, 1.00], [0.70, 0.98], [0.81, 0.97]];
const M_DOC = 0.81;
const clMaxClean = (M) => M <= M_DOC ? table(CLMAX_DOC, M) : CLMAX_DOC[CLMAX_DOC.length - 1][1] * clMaxCompressible(M) / clMaxCompressible(M_DOC);
const iceFactor = (M, ice) => 1 - 0.22 * ice * (1 - 0.7 * smoothstep(0.5, 0.8, M));
export const clMaxAt = (M, ice = 0) => clMaxClean(M) * iceFactor(M, ice);
// Lift-curve slope: DATCOM/Helmbold (aero.js), collapsing past drag divergence
export const clAlphaAt = (M) => clAlpha(M) * (1 - 0.3 * smoothstep(0.86, 0.98, M));
// Shock-buffet onset Mach for a lift coefficient (aero.js: Pearcey criterion on the section)
export const hiBuffetMach = (CL) => buffetMach(CL);
// Stall warning (AFM): shaker at 0.82 normalized AOA (0 = zero lift, 1 = max lift); above
// ~18,100 ft the system raises the warning speeds ~15 kt, i.e. ~0.70 normalized AOA.
export const shakerAoaN = (h) => (h > 18100 * 0.3048 ? 0.70 : 0.82);
// The warning computer normalizes AOA to max lift on the low-speed side of the envelope; past the
// buffet-boundary hump (~M0.72) max lift is shock-limited and the warning is the buffet itself.
const M_WARN = 0.72;
// Flap lift increment for the lever fraction (0.2 = 8°, 0.5 = 20°, 1 = 40°), from the AFM
// stall chart: at 23,500 lb flaps 8/20/40 stall at 126/121/115 KCAS vs 129 clean.
export const flapCL = (f) => table([[0, 0], [0.2, 0.08], [0.5, 0.22], [1, 0.40]], f);   // gain in MAXIMUM lift (AFM Fig 5-22 stall speeds)
// Lift gained at a given angle of attack: a slotted flap shifts the whole lift curve up by more than it raises maximum
// lift (the flapped wing stalls at a lower AOA). The AFM fixes it: V2 is reached at the +9 deg rotation attitude with a
// positive one-engine gradient (Fig 5-42 / p. 5-1), which needs CL ~1.05 at ~7.5 deg body AOA with flaps 8; flaps 40
// leaves a slightly nose-up attitude on a 3 deg approach at VREF.
export const flapCL0 = (f) => table([[0, 0], [0.2, 0.27], [0.5, 0.45], [1, 0.62]], f);
// Flap placard speeds VFE (AFM): 8° 250, 20° 200, 40° 165 KIAS
export const vfe = (f) => (f >= 1 ? 165 : f >= 0.5 ? 200 : 250);
// Elevator power: full elevator (ctl.elev = +/-1) is worth dCm 0.45 at low Mach. A T-tail estimate (tail ~5.6 m^2, arm
// ~7.5 m, lift slope ~4/rad, elevator effectiveness ~0.5 over ~17 deg) gives ~0.5, and rotating at VR needs it: the main
// wheels sit ~0.6 m behind the CG (TCDS C.G. range vs the gear contact points). Earlier versions used 0.18. Everything
// calibrated per unit of elevator scales with ELEV_K (column force per deflection, tail incidence per deflection,
// autopilot authority), so behaviour per unit of pitching moment, and with it the upset calibration, is unchanged.
export const ELEV_POWER = 0.45, ELEV_K = ELEV_POWER / 0.18;
// Stabilizer trim: ctl.trim u is worth dCm 0.14 per unit. The PTM (ch. 15) gives the stabilizer travel as 1 deg (full
// nose-down) to 12 deg (full nose-up) on the PITCH TRIM indicator. The same tail-volume estimate as the elevator gives
// ~0.054 per stabilizer degree (2.6 deg per unit), and the AFM takeoff trim (Fig 2-2: ~7 deg at mid CG) is what holds
// V2 hands-off, which puts u = 0 at 4.3 deg. Cruise then trims near 5 deg, below the 6.5 deg high-speed index as the
// PTM describes. The accident scenario keeps its calibrated +/-1 range.
export const STAB = { zero: 4.3, perUnit: 2.6, min: (1 - 4.3) / 2.6, max: (12 - 4.3) / 2.6 };
export const stabDeg = (u) => STAB.zero + STAB.perUnit * u;

export class Learjet60 {
  constructor() {
    this.m = 9400;                       // kg, ~20,700 lb after 2h of fuel burn
    this.fuel = 2450;                    // kg (~5,400 lb) left of that; burns off this.m
    this.ff = 0;                         // total fuel flow, kg/s
    this.N1 = 75; this.N1max = 100; this.N1idle = 50; this.engAge = 1;   // physical fan speed %, rating limits
    this.S = 24.57; this.b = 13.34; this.c = this.S / this.b;
    this.Ixx = 40000; this.Iyy = 62000; this.Izz = 92000;
    this.pos = [0, 0, -10668]; this.vel = [0, 0, 0]; this.q = [1, 0, 0, 0]; this.w = [0, 0, 0];
    this.ctl = { elev: 0, ail: 0, rud: 0, thr: 0.5, sb: 0, trim: 0, gear: 0, flaps: 0, yd: true };
    this.n1 = 0.5;                       // spooled thrust fraction
    this.ice = 0;                        // 0..1 wing ice accretion
    this.iceTail = 0;                    // 0..1 T-tail ice accretion
    this.engIce = 0;                     // 0..1 inlet ice (nacelle heat off)
    // Learjet 60 systems the emergency procedures touch
    this.sys = { wingHeat: true, stabHeat: true, nacelleHeat: true, pitotHeat: true, wshldHeat: true, stallWarn: true, machTrim: true, trimMode: 'PRI', machTrimFail: false };
    this.shaker = false;                 // no stick pusher on the Learjet 60 (AFM: AOA, lights, shaker, low-speed cues)
    this.damage = 0; this.broken = false; this.brokenWhat = ''; this.crashed = false;
    this.gnd = new Ground(); this.wow = false; this.crashWhy = '';   // landing gear and ground contact (js/ground.js)
    this.ctl.brakeL = 0; this.ctl.brakeR = 0; this.ctl.park = false; this.ctl.rev = 0;   // rev: thrust-reverser lever 0..1 (ground only)
    this.engFail = null;                 // 'L' / 'R': that engine has failed (spools down, windmills)
    this.failSpool = 0;                  // the failed engine's remaining thrust fraction (spool-down)
    this.apr = true;                     // APR armed (normal for takeoff): a failure raises the live engine's takeoff rating
    this.N1to = 93;                      // takeoff-rated N1 (thrust levers at T/O below 1,500 ft)
    this.tailStalled = false;
    this.failures = { tailIce: true, tuck: true };
    // 'hard' = as-flown realism: sticky iced tail, asymmetric ice, stronger tuck, degraded lateral control
    this.hard = true;
    this.rw = 0;                         // random-walk asymmetry for stall
    this.out = {};
    this.maxG = 1; this.minG = 1; this.maxM = 0; this.maxKEAS = 0; this.maxVS = 0;
    this.nzBand = 1; this.bands = null; this.bandsAge = 0;
  }
  setState({ n, e, d, psi, theta, phi, V }) {
    this.pos = [n, e, d];
    this.q = qfromEuler(psi, theta, phi);
    this.vel = [V * Math.cos(psi), V * Math.sin(psi), 0];   // horizontal flight path; theta sets initial alpha
    this.w = [0, 0, 0];
  }
  // Trim setting that zeroes pitching moment at a given alpha (low Mach, unstalled tail)
  // Static margin (fraction of MAC): pitch stiffness Cm_alpha = -SM * CL_alpha. 0.177 reproduces the
  // earlier -1.1/rad at cruise Mach; at low speed the softer physical lift slope lets full aft
  // stick + nose-up trim reach the stall, as certification requires.
  static SM = 0.177;
  cmAlpha(M) { return -Learjet60.SM * clAlphaAt(M); }
  trimFor(alpha, M = 0.78) { return clamp(-(0.02 + this.cmAlpha(M) * (alpha + 1.5 * DEG)) / 0.14, -1, 1); }
  // Vmo/Mmo, primary instruments (AFM Section I). h meters.
  vmoKias(h) {
    const hf = h / 0.3048;
    if (hf < 8000) return 300;
    if (hf < 20000) return 340;
    if (hf < 23000) return lerp(340, 330, (hf - 20000) / 3000);
    return 330;
  }
  mmo(h) {
    const hf = h / 0.3048;
    const m = hf < 37000 ? 0.81 : hf < 43000 ? lerp(0.81, 0.78, (hf - 37000) / 6000) : 0.78;
    // AFM: 0.77 with Mach trim inoperative (and AP disengaged)
    return this.sys.machTrim && !this.sys.machTrimFail ? m : Math.min(m, 0.77);
  }
  /**
   * Speed envelope (KIAS) at altitude h (m), load factor n and wing ice — the coffin corner.
   *  shaker:   stick-shaker speed at n (shaker fires at 80% of stall AOA, same rule as step())
   *  shakerM:  shaker speed with 30% more g — below it a gust or pull reaches the shaker
   *  buffet:   high-speed buffet onset at n;  buffetM: the same with 30% more g
   *  vmo:      Vmo/Mmo barber pole
   * The window is closed when shakerM >= min(buffetM, vmo).
   */
  speedEnvelope(h, n = 1, ice = this.ice, dT = 7) {
    const atm = isa(Math.max(0, h), dT);
    const W = this.m * G0;
    const clReq = (M, g) => g * W / (0.5 * atm.rho * (M * atm.a) ** 2 * this.S);
    const kSh = shakerAoaN(h);
    const clShaker = (M) => kSh * clMaxAt(Math.min(M, M_WARN), 0);        // the warning computer assumes a clean wing
    const kias = (M) => casKt(M, atm.p);
    const lowEdge = (g) => {           // slowest Mach at which g-load stays under the shaker
      for (let M = 0.15; M < 0.98; M += 0.0025) if (clReq(M, g) <= clShaker(M)) return kias(M);
      return Infinity;
    };
    const highEdge = (g) => {          // shock-buffet onset at this g-load, scanning down from high Mach
      // (at very low Mach the required CL is so large the test trips too: that is the stall
      // side, not shock buffet, so only the top crossing counts). 0 = no buffet-free speed.
      for (let M = 0.98; M > 0.15; M -= 0.0025) if (M <= hiBuffetMach(clReq(M, g))) return kias(M + 0.0025);
      return 0;
    };
    const vmo = Math.min(this.vmoKias(h), kias(this.mmo(h)));
    return { n, shaker: lowEdge(n), shakerM: lowEdge(n * 1.3), buffet: highEdge(n), buffetM: highEdge(n * 1.3), vmo };
  }
  step(dt, env) {
    const { wind = [0, 0, 0], dT = 7 } = env;
    const ctl = this.ctl;
    const R = qmat(this.q);
    const h = -this.pos[2];
    const agl = h - groundAlt(this.pos[0], this.pos[1]) - this.gnd.elev;
    const ge = agl < 2 * this.b ? groundEffect(agl - 0.6, this.b) : null;   // wing ~0.6 m below the CG
    const atm = isa(Math.max(0, h), dT);
    const vrel = [this.vel[0] - wind[0], this.vel[1] - wind[1], this.vel[2] - wind[2]];
    const vb = mulMTV(R, vrel);
    const [u, v, w] = vb;
    const V = Math.max(5, Math.hypot(u, v, w));
    const alpha = Math.atan2(w, u), beta = Math.asin(clamp(v / V, -1, 1));
    const M = V / atm.a, qbar = 0.5 * atm.rho * V * V;
    const [p, qq, r] = this.w;
    const phat = p * this.b / (2 * V), qhat = qq * this.c / (2 * V), rhat = r * this.b / (2 * V);
    const ice = this.ice;

    // ---- Longitudinal aerodynamics ----
    const CLa = clAlphaAt(M);
    const alpha0 = ALPHA0 - flapCL0(ctl.flaps) / CLa;                  // flaps shift the lift curve
    const CLmax0 = clMaxAt(M, ice); let CLmax = CLmax0 + flapCL(ctl.flaps);   // flapped maximum lift
    const CLmin = -0.7 * CLmax0;
    const aStall = alpha0 + CLmax / CLa, aStallN = alpha0 + CLmin / CLa;
    let CL, stalled = false, stallEx = 0;
    if (alpha > aStall) { stallEx = alpha - aStall; CL = Math.max(CLmax - 1.8 * stallEx, 0.45 * CLmax * Math.cos(Math.min(stallEx, 1.2))); stalled = true; }
    else if (alpha < aStallN) { stallEx = aStallN - alpha; CL = Math.min(CLmin + 1.8 * stallEx, 0.45 * CLmin); stalled = true; }
    else CL = CLa * (alpha - alpha0);
    CL += -ctl.sb * (0.15 + 0.45 * ctl.flaps);   // spoilers ahead of the flaps spoil most of the flap lift (lift dump on landing)   // spoilers dump more lift with the flaps out (lift dump on landing)
    if (ge) CL *= ge.lift;
    // Drag: component build-up CD0 (Reynolds + Mach), induced, and Lock wave drag above the
    // critical Mach from the section pressure model; ice roughness adds friction, lowers Mcrit
    let CD = cd0(atm.rho, V, atm.T, M) + 0.014 * ice + K_IND * CL * CL * (ge ? ge.kInd : 1) + cdTrim(CL) + cdWave(M, CL, 0.03 * ice)
      + 0.035 * ctl.sb + 0.025 * ctl.gear + 0.06 * ctl.flaps + 1.0 * stallEx * stallEx;
    // Control effectiveness decays past shock-buffet onset (separation ahead of the hinges).
    // Onset is lift-dependent, so pulling g at high Mach loses elevator authority sooner.
    const Mbuf = hiBuffetMach(CL);
    const effM = 1 - 0.6 * smoothstep(Mbuf - 0.02, Mbuf + 0.10, M);
    // Tailplane: downwash-reduced local angle; ice contaminates the T-tail and lowers its stall margin
    // Stall warning: AOA vanes and a computer calibrated for the CLEAN wing. With ice the wing
    // stalls at a lower AOA than the system assumes, so it can stall before the shaker (AFM: even
    // small leading-edge ice raises the stall speed). STALL WARN OFF (6) silences the shaker.
    const aoaN = (alpha - alpha0) * CLa / (clMaxAt(Math.min(M, M_WARN), 0) + flapCL(ctl.flaps));   // stall-warning AOA, 1 = un-iced max lift (flap-scheduled, AFM)
    const aoaWing = (alpha - alpha0) / (aStall - alpha0);                     // true fraction of the (iced) wing's stall AOA
    this.shaker = this.sys.stallWarn && !this.broken && alpha > 0 && aoaN > shakerAoaN(h);
    const elevCmd = ctl.elev;
    const alphaT = 0.7 * alpha * RAD - 3.0 + (this.hard ? 8.0 : 6.0) * ELEV_K * elevCmd;   // deg; push drives the tail toward its negative stall, full pull re-attaches it
    const iceT = this.iceTail;
    const tailCrit = this.failures.tailIce ? 14 - 11.5 * iceT : 14;
    if (!this.tailStalled && alphaT < -tailCrit) this.tailStalled = true;
    // Contaminated tail re-attaches only with margin: hard mode needs a real pull or less speed
    if (this.tailStalled && alphaT > -tailCrit + (this.hard ? 3.0 : 1.5)) this.tailStalled = false;
    const effTail = this.tailStalled ? (this.hard ? 0.22 : 0.3) : 1 - (this.hard ? 0.45 : 0.25) * iceT;
    let Cm = 0.02 + this.cmAlpha(M) * (alpha - ALPHA0) - 45 * qhat
      + ELEV_POWER * effM * effTail * elevCmd + 0.14 * effM * effTail * ctl.trim;
    if (this.failures.tuck) {
      let tuck = this.hard ? -0.14 * smoothstep(0.78, 0.92, M) : -0.09 * smoothstep(0.80, 0.93, M);   // Mach tuck
      if (this.sys.machTrim && !this.sys.machTrimFail) tuck -= Math.max(tuck, -0.05) * 0.9;            // Mach trim compensator: offsets up to ~0.045 of it
      Cm += tuck;
    }
    if (this.tailStalled) Cm += this.hard ? -0.17 : -0.22;              // tail unload -> pitch down
    if (ge) Cm += ge.cm;                                                 // ground effect: less downwash at the tail
    // AFM FM-123 (Overspeed Recovery, Pitch Axis Malfunction): "significant nose-down pitching moment associated with
    // spoiler deployment" above Vmo/Mmo, hence "do not extend spoilers during any nose-down pitch upset at any speed".
    // Landing gear lowered at high speed: "a moderate nose-up pitching moment which is easily controllable".
    const KIASp = casKt(M, atm.p);
    const overV = Math.max(smoothstep(this.mmo(h) - 0.02, this.mmo(h) + 0.04, M), smoothstep(this.vmoKias(h) - 10, this.vmoKias(h) + 25, KIASp));
    Cm += -ctl.sb * (0.012 + 0.04 * overV) * effM;
    Cm += 0.012 * ctl.gear * smoothstep(150, 320, KIASp);
    if (stalled) Cm += -0.12 * Math.sign(alpha) * Math.min(1, stallEx / 0.08);   // pitch break grows with stall depth
    // Buffet: shock or leading-edge separation onset (one criterion, aero.js), or pre-stall
    const buffet = stalled || Math.abs(CL) > clBuffet(M) * iceFactor(M, ice) || (aoaWing > 0.9 && alpha > 0);

    // ---- Lateral-directional ----
    this.rw += ((Math.random() * 2 - 1) * 6 - this.rw * 2) * dt; this.rw = clamp(this.rw, -1, 1);
    const effA = (1 - 0.4 * smoothstep(0.86, 0.98, M)) * (this.hard ? 1 - 0.3 * ice : 1);
    let rudTot = clamp(ctl.rud + (ctl.yd && !this.wow ? -1.5 * r : 0), -1, 1);   // yaw damper off with weight on wheels
    // Sign convention: positive rudder = nose right. Yaw damper opposes yaw rate.
    // Aileron power: ~50°/s peak roll rate at cruise (full deflection)
    let Cl = -0.08 * beta - 0.42 * phat + 0.08 * rhat + 0.014 * ctl.ail * effA - 0.012 * rudTot;
    let Cn = 0.10 * beta - 0.18 * rhat - 0.02 * phat + 0.07 * rudTot - 0.004 * ctl.ail;
    const CY = -0.75 * beta - 0.15 * rudTot;
    if (stalled) { Cl += 0.05 * this.rw * Math.min(1, stallEx * 8); Cn += 0.01 * this.rw; }
    // Asymmetric ice shedding/accretion: persistent left-wing-heavy rolling moment plus slow wander
    if (this.hard) { Cl += -0.0045 * ice * (1 + 0.6 * this.rw); Cn += 0.001 * ice * this.rw; }
    const KIAS = casKt(M, atm.p);
    if (ctl.flaps > 0 && KIAS > vfe(ctl.flaps)) Cl += -0.006 * ctl.flaps;   // overspeeding flaps: asymmetry

    // ---- Structural failure effects ----
    if (this.broken) {
      if (this.brokenWhat === 'stab') { Cm = -0.30 - 0.4 * (alpha) + (-45 * qhat); }  // horizontal stab gone: no pitch control, nose tucks
      else { CL *= 0.35; Cl += -0.5; CD *= 3; Cm += -0.3; }                              // wing gone
    }

    // ---- Thrust ----
    // Lever -> N1 between flight idle and the rating limit (max continuous); the rating law is
    // a root-find, refreshed at 10 Hz. n1 is the spooled lever-equivalent fraction.
    const tau = ctl.thr > this.n1 ? 2.5 : 1.5;
    this.n1 += (clamp(ctl.thr, 0, 1) - this.n1) * dt / tau;
    this.engAge += dt;
    if (this.engAge >= 0.1) { this.N1max = maxN1(M, atm.p, atm.T); this.N1to = takeoffN1(M, atm.p, atm.T, !!this.engFail && this.apr); this.N1idle = idleN1(); this.engAge = 0; }
    const flameout = this.fuel <= 0;
    // Takeoff rating with the levers at T/O below 1,500 ft (the takeoff segment); otherwise maximum continuous. Reversers
    // (ground only) spool the engines on the reverse lever and turn ~45 % of the thrust forward.
    if (!this.wow) ctl.rev = 0;
    const top = ctl.thr > 0.99 && agl < 457 ? this.N1to : this.N1max;
    const nTgt = ctl.rev > 0 ? lerp(this.N1idle, this.N1max * 0.92, clamp(ctl.rev, 0, 1)) : lerp(this.N1idle, top, this.n1);
    this.N1 = flameout || this.broken ? Math.max(0, this.N1 - 8 * dt) : ctl.rev > 0 ? this.N1 + (nTgt - this.N1) * Math.min(1, dt / 1.5) : nTgt;
    const eng = cycle(this.N1, M, atm.p, atm.T);
    this.failSpool = this.engFail ? Math.max(0, this.failSpool - dt / 1.5) : 1;   // a failed engine runs down over ~1.5 s
    const nEng = this.engFail ? 1 + this.failSpool : 2, revK = ctl.rev > 0 ? -0.45 : 1;
    const T = this.broken || flameout ? 0 : nEng * eng.F * revK * (1 - 0.35 * this.engIce);
    this.ff = flameout || this.broken ? 0 : nEng * eng.ff;
    // one engine out: the live engine (1.31 m off the centreline) yaws the airplane, the dead one windmills
    const yawEng = this.engFail && !this.broken && !flameout ? (this.engFail === 'L' ? -1 : 1) * eng.F * revK * 1.31 * (1 - this.failSpool) : 0;
    if (this.engFail) CD += 0.003;
    const burn = Math.min(this.fuel, this.ff * dt);
    this.fuel -= burn; this.m -= burn;

    // ---- Forces (body) ----
    const L = qbar * this.S * CL, D = qbar * this.S * CD, Y = qbar * this.S * CY;
    const wu = [u / V, v / V, w / V];
    const dz = -wu[2];
    let lx = -dz * wu[0], ly = -dz * wu[1], lz = -1 - dz * wu[2];
    const ln = Math.hypot(lx, ly, lz) || 1; lx /= ln; ly /= ln; lz /= ln;
    const Fb = [-D * wu[0] + L * lx + T, -D * wu[1] + L * ly + Y, -D * wu[2] + L * lz];
    // ---- Ground: gear, tyres, brakes, airframe contact (js/ground.js) ----
    let gnd = null;
    if (agl < 12) {
      gnd = this.gnd.contact(this, R, ctl);
      Fb[0] += gnd.F[0]; Fb[1] += gnd.F[1]; Fb[2] += gnd.F[2];
      this.damage += gnd.dmg;
      if (gnd.crash && !this.crashed) { this.crashed = true; this.crashWhy = gnd.crash; }
    } else if (this.wow || this.gnd.hardOn.size) this.gnd.airborne();
    this.wow = this.gnd.wow;
    const nz = -Fb[2] / (this.m * G0);
    const aN = mulMV(R, [Fb[0] / this.m, Fb[1] / this.m, Fb[2] / this.m]);
    aN[2] += G0;

    // ---- Moments & rates ----
    let Lm = qbar * this.S * this.b * Cl, Mm = qbar * this.S * this.c * Cm, Nm = qbar * this.S * this.b * Cn;
    if (gnd) { Lm += gnd.M[0]; Mm += gnd.M[1]; Nm += gnd.M[2]; }
    Nm += yawEng;
    const pd = (Lm + (this.Iyy - this.Izz) * qq * r) / this.Ixx;
    const qd = (Mm + (this.Izz - this.Ixx) * p * r) / this.Iyy;
    const rd = (Nm + (this.Ixx - this.Iyy) * p * qq) / this.Izz;
    this.w = [p + pd * dt, qq + qd * dt, r + rd * dt];
    this.q = qIntegrate(this.q, this.w, dt);
    this.vel = [this.vel[0] + aN[0] * dt, this.vel[1] + aN[1] * dt, this.vel[2] + aN[2] * dt];
    this.pos = [this.pos[0] + this.vel[0] * dt, this.pos[1] + this.vel[1] * dt, this.pos[2] + this.vel[2] * dt];

    // ---- Structural damage ----
    const KEAS = V * Math.sqrt(atm.rho / RHO0) / KT;
    // Part 25 structure: Vmo/Mmo is an operating limit, not the structural one. Strength is designed to the limit load
    // (AFM: +3.0 / -1.0 g flaps up) up to the design dive speed VD/MD (25.335(b)), ultimate = 1.5 x limit, and the
    // aeroplane must be flutter-free to 1.15 VD (25.629). VD/MD are not in the AFM or the EASA TCDS (EASA.IM.A.212);
    // we use VD 377 KIAS / MD 0.89 (a figure supplied without a source, but exactly the Part 25 margins over Vmo 330 /
    // Mmo 0.81), i.e. VD = Vmo + 47 at every altitude band. Speed alone does no damage below VD/MD; beyond them the
    // allowable g shrinks; past the flutter margin failure is rapid. Rolling pull-outs above Vmo: ~2/3 of the
    // symmetric limit (25.349).
    const VD = this.vmoKias(h) + 47, MD = 0.89;
    const ov = Math.max(clamp((KIAS - VD) / (0.15 * VD), 0, 1), clamp((M - MD) / 0.05, 0, 1));
    const nPos = 3.6 - 1.6 * ov, nNeg = -1.6 + 0.8 * ov;
    let dr = 0;
    if (nz > nPos) dr += (nz - nPos) * 0.9;
    if (nz > 4.5) dr += 5;                                                       // ultimate load
    if (nz < nNeg) dr += (nNeg - nz) * 0.9;
    if (KIAS > 1.15 * VD) dr += (KIAS - 1.15 * VD) / 15 + 0.5;                   // beyond the flutter margin
    if (M > MD + 0.07) dr += (M - MD - 0.07) * 25 + 0.5;
    if (KIAS > this.vmoKias(h) && Math.abs(p) > 0.35 && nz > 2.0) dr += (nz - 2.0) * 0.6;   // rolling pull-out
    if (Math.abs(qq) > 1.2 && qbar > 15000) dr += (Math.abs(qq) - 1.2) * 2;   // violent pitch rate at high q
    // Gear VLE 260 KIAS: beyond it the AFM's overspeed procedure still lowers the gear (flight tested to M0.85 /
    // 320 KIAS); expected consequence is minor gear-door damage, not structural failure. Flaps VFE 250/200/165.
    if (ctl.gear && KIAS > 260) this.gearDoorsDamaged = true;
    const flapLim = vfe(ctl.flaps);
    if (ctl.flaps > 0 && KIAS > flapLim) dr += (KIAS - flapLim) / 40 * 0.4;
    if (!this.broken) {
      this.damage += dr * dt;
      if (this.damage >= 1) {
        this.broken = true;
        this.brokenWhat = (Math.abs(qq) > 0.6 || M > 0.9 || nz > 3) ? 'stab' : 'wing';
      }
    }
    if (agl < -0.3 && !this.crashed) { this.crashed = true; this.crashWhy = this.crashWhy || 'IMPACT'; }   // below the surface: nothing touched first

    const eu = eulerFromMat(qmat(this.q));
    const vs = -this.vel[2];
    this.maxG = Math.max(this.maxG, nz); this.minG = Math.min(this.minG, nz);
    // Load factor for the speed-tape bands, smoothed so turbulence doesn't make them flicker
    this.nzBand += (clamp(nz, 1, 2.5) - this.nzBand) * Math.min(1, dt / 0.8);
    // The envelope scan is ~1k evaluations: refresh it at 10 Hz, not every physics step
    this.bandsAge += dt;
    if (!this.bands || this.bandsAge >= 0.1) { this.bands = this.speedEnvelope(h, this.nzBand, ice, dT); this.bandsAge = 0; }
    this.maxM = Math.max(this.maxM, M); this.maxKEAS = Math.max(this.maxKEAS, KEAS); this.maxVS = Math.min(this.maxVS, vs);
    const Vmo = this.vmoKias(h), Mmo = this.mmo(h);
    this.out = {
      alpha, beta, V, M, KIAS, KEAS, qbar, nz, h, vs, psi: eu.psi, theta: eu.theta, phi: eu.phi,
      p, q: qq, r, stalled, buffet, overspeed: KIAS > Vmo || M > Mmo, Vmo, Mmo, aoaN, tailStalled: this.tailStalled,
      OAT: atm.T - 273.15, gs: Math.hypot(this.vel[0], this.vel[1]), track: Math.atan2(this.vel[1], this.vel[0]),
      thrust: T, n1: this.n1, N1: this.N1, N1max: this.N1max, T4: eng.T4, ff: this.ff, fuel: this.fuel, damage: this.damage, aStall, CL, CD, tailCrit, alphaT, mach_a: atm.a, shaker: this.shaker, iceTail: this.iceTail, engIce: this.engIce,
      Mbuf, bands: this.bands, agl, wow: this.wow, steer: this.gnd.steer, rev: ctl.rev, engFail: this.engFail, toRated: top === this.N1to,
    };
    return this.out;
  }
}
