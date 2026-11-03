// Learjet 60 six-degree-of-freedom flight model.
// Physics frame: NED (north, east, down). Body frame: x forward, y right, z down.
// Coefficients are engineering approximations tuned to published Lear 60 figures
// (S=264.5 sq ft, MTOW 23,500 lb, 2x PW305A 4,600 lbf, Mmo 0.81, ceiling 51,000 ft).
import { DEG, RAD, clamp, lerp, smoothstep, qfromEuler, qmat, mulMV, mulMTV, eulerFromMat, qIntegrate } from './util.js';
import { isa, G0, KT, RHO0 } from './atmo.js';

const KIASest = (V, rho) => V * Math.sqrt(rho / RHO0) / KT;
const ALPHA0 = -1.5 * DEG;
// Max lift coefficient: falls with Mach (shock-induced separation), and with wing ice
export const clMaxAt = (M, ice = 0) =>
  lerp(1.25, 0.62, smoothstep(0.35, 0.86, M)) * (1 - 0.22 * ice * (1 - 0.7 * smoothstep(0.5, 0.8, M)));
// Lift-curve slope with Prandtl-Glauert compressibility, collapsing past drag divergence
export const clAlphaAt = (M) =>
  5.0 / Math.sqrt(Math.max(0.2, 1 - Math.min(M, 0.86) ** 2)) * (1 - 0.3 * smoothstep(0.86, 0.98, M));
// High-speed (shock) buffet onset Mach. Falls as the wing works harder: at 1g cruise
// (CL ~0.4) it sits near 0.85; a 1.5g pull at FL370 brings it down to ~0.81, so the top
// edge of the envelope comes down in a bank or gust, not only the bottom edge up.
export const hiBuffetMach = (CL) => 0.86 - 0.2 * Math.max(0, Math.abs(CL) - 0.35);
// Speed indication used by the model and the tape: EAS with a crude compressibility bump
const kiasOf = (V, rho, M) => V * Math.sqrt(rho / RHO0) / KT * (1 + 0.02 * M * M);
export class Learjet60 {
  constructor() {
    this.m = 9400;                       // kg, ~20,700 lb after 2h of fuel burn
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
    this.pusher = false; this.shaker = false;
    this.damage = 0; this.broken = false; this.brokenWhat = ''; this.crashed = false;
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
  trimFor(alpha) { return clamp(-(0.02 - 1.1 * (alpha + 1.5 * DEG)) / 0.14, -1, 1); }
  vmoKias(h) { // h meters. Lear 60 schedule (approx): 300 KIAS low, 340 KIAS mid, Mmo .81 high
    const hf = h / 0.3048;
    if (hf < 8000) return 300;
    if (hf < 25000) return 340;
    return 340;
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
    const clShaker = (M) => 0.8 * clMaxAt(M, ice) - 0.2 * clAlphaAt(M) * ALPHA0;
    const kias = (M) => kiasOf(M * atm.a, atm.rho, M);
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
    const vmo = Math.min(this.vmoKias(h), kias(0.81));
    return { n, shaker: lowEdge(n), shakerM: lowEdge(n * 1.3), buffet: highEdge(n), buffetM: highEdge(n * 1.3), vmo };
  }
  step(dt, env) {
    const { wind = [0, 0, 0], dT = 7 } = env;
    const ctl = this.ctl;
    const R = qmat(this.q);
    const h = -this.pos[2];
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
    const alpha0 = ALPHA0;
    let CLmax = clMaxAt(M, ice);
    const CLmin = -0.7 * CLmax;
    const aStall = alpha0 + CLmax / CLa, aStallN = alpha0 + CLmin / CLa;
    let CL, stalled = false, stallEx = 0;
    if (alpha > aStall) { stallEx = alpha - aStall; CL = Math.max(CLmax - 1.8 * stallEx, 0.45 * CLmax * Math.cos(Math.min(stallEx, 1.2))); stalled = true; }
    else if (alpha < aStallN) { stallEx = aStallN - alpha; CL = Math.min(CLmin + 1.8 * stallEx, 0.45 * CLmin); stalled = true; }
    else CL = CLa * (alpha - alpha0);
    CL += 0.35 * ctl.flaps - 0.15 * ctl.sb;
    const Mcr = 0.75 - 0.05 * Math.abs(CL) - 0.03 * ice;
    let CD = 0.021 + 0.014 * ice + 0.058 * CL * CL + (M > Mcr ? 35 * Math.pow(M - Mcr, 4) : 0)
      + 0.035 * ctl.sb + 0.025 * ctl.gear + 0.06 * ctl.flaps + 1.0 * stallEx * stallEx;
    // Control effectiveness decays past shock-buffet onset (separation ahead of the hinges).
    // Onset is lift-dependent, so pulling g at high Mach loses elevator authority sooner.
    const Mbuf = hiBuffetMach(CL);
    const effM = 1 - 0.6 * smoothstep(Mbuf - 0.02, Mbuf + 0.10, M);
    // Tailplane: downwash-reduced local angle; ice contaminates the T-tail and lowers its stall margin
    // Stall warning: shaker at ~80% of stall AOA, pusher at ~90% (the Learjet pusher is aggressive; with wing ice it fires at low AOA)
    this.shaker = !this.broken && alpha > 0 && alpha > aStall * 0.8;
    this.pusher = this.sys.stallWarn && !this.broken && alpha > 0 && alpha > aStall * 0.9 && qbar > 3000;
    const elevCmd = this.pusher ? Math.min(ctl.elev, -0.45) : ctl.elev;
    const alphaT = 0.7 * alpha * RAD - 3.0 + (this.hard ? 8.0 : 6.0) * elevCmd;   // deg; push drives the tail toward its negative stall, full pull re-attaches it
    const iceT = this.iceTail;
    const tailCrit = this.failures.tailIce ? 14 - 11.5 * iceT : 14;
    if (!this.tailStalled && alphaT < -tailCrit) this.tailStalled = true;
    // Contaminated tail re-attaches only with margin: hard mode needs a real pull or less speed
    if (this.tailStalled && alphaT > -tailCrit + (this.hard ? 3.0 : 1.5)) this.tailStalled = false;
    const effTail = this.tailStalled ? (this.hard ? 0.22 : 0.3) : 1 - (this.hard ? 0.45 : 0.25) * iceT;
    let Cm = 0.02 - 1.1 * (alpha - alpha0) - 45 * qhat
      + 0.18 * effM * effTail * elevCmd + 0.14 * effM * effTail * ctl.trim;
    if (this.failures.tuck) {
      let tuck = this.hard ? -0.14 * smoothstep(0.78, 0.92, M) : -0.09 * smoothstep(0.80, 0.93, M);   // Mach tuck
      if (this.sys.machTrim && !this.sys.machTrimFail) tuck -= Math.max(tuck, -0.05) * 0.9;            // Mach trim compensator: offsets up to ~0.045 of it
      Cm += tuck;
    }
    if (this.tailStalled) Cm += this.hard ? -0.17 : -0.22;              // tail unload -> pitch down
    if (stalled) Cm += -0.12 * Math.sign(alpha) * Math.min(1, stallEx / 0.08);   // pitch break grows with stall depth
    const buffet = stalled || M > Mbuf || (alpha > aStall * 0.85 && alpha > 0);

    // ---- Lateral-directional ----
    this.rw += ((Math.random() * 2 - 1) * 6 - this.rw * 2) * dt; this.rw = clamp(this.rw, -1, 1);
    const effA = (1 - 0.4 * smoothstep(0.86, 0.98, M)) * (this.hard ? 1 - 0.3 * ice : 1);
    let rudTot = clamp(ctl.rud + (ctl.yd ? -1.5 * r : 0), -1, 1);
    // Sign convention: positive rudder = nose right. Yaw damper opposes yaw rate.
    let Cl = -0.08 * beta - 0.42 * phat + 0.08 * rhat + 0.022 * ctl.ail * effA - 0.012 * rudTot;
    let Cn = 0.10 * beta - 0.18 * rhat - 0.02 * phat + 0.07 * rudTot - 0.004 * ctl.ail;
    const CY = -0.75 * beta - 0.15 * rudTot;
    if (stalled) { Cl += 0.05 * this.rw * Math.min(1, stallEx * 8); Cn += 0.01 * this.rw; }
    // Asymmetric ice shedding/accretion: persistent left-wing-heavy rolling moment plus slow wander
    if (this.hard) { Cl += -0.0045 * ice * (1 + 0.6 * this.rw); Cn += 0.001 * ice * this.rw; }
    if (ctl.flaps > 0 && KIASest(V, atm.rho) > (ctl.flaps >= 1 ? 150 : 200)) Cl += -0.006 * ctl.flaps;   // overspeeding flaps: asymmetry

    // ---- Structural failure effects ----
    if (this.broken) {
      if (this.brokenWhat === 'stab') { Cm = -0.30 - 0.4 * (alpha) + (-45 * qhat); }  // horizontal stab gone: no pitch control, nose tucks
      else { CL *= 0.35; Cl += -0.5; CD *= 3; Cm += -0.3; }                              // wing gone
    }

    // ---- Thrust ----
    const tau = ctl.thr > this.n1 ? 2.5 : 1.5;
    this.n1 += (clamp(ctl.thr, 0, 1) - this.n1) * dt / tau;
    const Tmax = 2 * 20460 * Math.pow(atm.rho / RHO0, 0.72) * (1 - 0.12 * M);
    const T = this.broken ? 0 : Tmax * lerp(0.04, 1, this.n1) * (1 - 0.35 * this.engIce);

    // ---- Forces (body) ----
    const L = qbar * this.S * CL, D = qbar * this.S * CD, Y = qbar * this.S * CY;
    const wu = [u / V, v / V, w / V];
    const dz = -wu[2];
    let lx = -dz * wu[0], ly = -dz * wu[1], lz = -1 - dz * wu[2];
    const ln = Math.hypot(lx, ly, lz) || 1; lx /= ln; ly /= ln; lz /= ln;
    const Fb = [-D * wu[0] + L * lx + T, -D * wu[1] + L * ly + Y, -D * wu[2] + L * lz];
    const nz = -Fb[2] / (this.m * G0);
    const aN = mulMV(R, [Fb[0] / this.m, Fb[1] / this.m, Fb[2] / this.m]);
    aN[2] += G0;

    // ---- Moments & rates ----
    const Lm = qbar * this.S * this.b * Cl, Mm = qbar * this.S * this.c * Cm, Nm = qbar * this.S * this.b * Cn;
    const pd = (Lm + (this.Iyy - this.Izz) * qq * r) / this.Ixx;
    const qd = (Mm + (this.Izz - this.Ixx) * p * r) / this.Iyy;
    const rd = (Nm + (this.Ixx - this.Iyy) * p * qq) / this.Izz;
    this.w = [p + pd * dt, qq + qd * dt, r + rd * dt];
    this.q = qIntegrate(this.q, this.w, dt);
    this.vel = [this.vel[0] + aN[0] * dt, this.vel[1] + aN[1] * dt, this.vel[2] + aN[2] * dt];
    this.pos = [this.pos[0] + this.vel[0] * dt, this.pos[1] + this.vel[1] * dt, this.pos[2] + this.vel[2] * dt];

    // ---- Structural damage ----
    const KEAS = V * Math.sqrt(atm.rho / RHO0) / KT;
    const KIAS = KEAS * (1 + 0.02 * M * M);     // crude compressibility correction
    let dr = 0;
    if (nz > 3.6) dr += (nz - 3.6) * 0.9;
    if (nz < -1.6) dr += (-1.6 - nz) * 0.9;
    if (KEAS > 370) dr += (KEAS - 370) / 35;
    if (KEAS > 440) dr += 5;
    if (M > 0.93) dr += (M - 0.93) * 12;
    if (M > 0.88 && nz > 2.2) dr += (nz - 2.2) * (M - 0.88) * 20;
    if (Math.abs(qq) > 1.2 && qbar > 15000) dr += (Math.abs(qq) - 1.2) * 2;   // violent pitch rate at high q
    // Gear 260 KIAS, flaps 8/20: 200 KIAS, flaps 40: 150 KIAS
    if (ctl.gear && KIAS > 260) dr += (KIAS - 260) / 60 * 0.3;
    const flapLim = ctl.flaps >= 1 ? 150 : 200;
    if (ctl.flaps > 0 && KIAS > flapLim) dr += (KIAS - flapLim) / 40 * 0.4;
    if (!this.broken) {
      this.damage += dr * dt;
      if (this.damage >= 1) {
        this.broken = true;
        this.brokenWhat = (Math.abs(qq) > 0.6 || M > 0.9 || nz > 3) ? 'stab' : 'wing';
      }
    }
    if (h <= 0 && !this.crashed) this.crashed = true;

    const eu = eulerFromMat(qmat(this.q));
    const vs = -this.vel[2];
    this.maxG = Math.max(this.maxG, nz); this.minG = Math.min(this.minG, nz);
    // Load factor for the speed-tape bands, smoothed so turbulence doesn't make them flicker
    this.nzBand += (clamp(nz, 1, 2.5) - this.nzBand) * Math.min(1, dt / 0.8);
    // The envelope scan is ~1k evaluations: refresh it at 10 Hz, not every physics step
    this.bandsAge += dt;
    if (!this.bands || this.bandsAge >= 0.1) { this.bands = this.speedEnvelope(h, this.nzBand, ice, dT); this.bandsAge = 0; }
    this.maxM = Math.max(this.maxM, M); this.maxKEAS = Math.max(this.maxKEAS, KEAS); this.maxVS = Math.min(this.maxVS, vs);
    const Vmo = this.vmoKias(h);
    this.out = {
      alpha, beta, V, M, KIAS, KEAS, qbar, nz, h, vs, psi: eu.psi, theta: eu.theta, phi: eu.phi,
      p, q: qq, r, stalled, buffet, overspeed: KIAS > Vmo || M > 0.81, Vmo, tailStalled: this.tailStalled,
      OAT: atm.T - 273.15, gs: Math.hypot(this.vel[0], this.vel[1]), track: Math.atan2(this.vel[1], this.vel[0]),
      thrust: T, n1: this.n1, damage: this.damage, aStall, CL, CD, tailCrit, alphaT, mach_a: atm.a, pusher: this.pusher, shaker: this.shaker, iceTail: this.iceTail, engIce: this.engIce,
      Mbuf, bands: this.bands,
    };
    return this.out;
  }
}
