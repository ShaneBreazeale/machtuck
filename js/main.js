import { Learjet60, hiBuffetMach } from './aircraft.js';
import { Environment, Autopilot, buildGhost, ghostAt, STORM, TIMELINE, HYPOTHESES, clockStr, NexradField, NEXRAD_VOLUMES } from './scenario.js';
import { Renderer } from './render.js';
import { HUD } from './hud.js';
import { Cockpit } from './cockpit.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { DEG, RAD, clamp, qmat, mulMV, nedToWorld, lerp, smoothstep, qfromEuler, wrap180 } from './util.js';
import { isa, RHO0, G0 } from './atmo.js';
import { FT, KT } from './atmo.js';

const glc = document.getElementById('gl'), hc = document.getElementById('hud');
const R = new Renderer(glc), H = new HUD(hc), IN = new Input(hc), AU = new Audio();
let CK = null; try { CK = new Cockpit(document.getElementById('ck')); } catch (e) { console.warn('3D cockpit unavailable, using the 2D panel:', e); }
IN.onPad = (msg) => log('SYS', msg);
const ghost = buildGhost();
const ghostLine = new Float32Array(ghost.length * 3);
ghost.forEach((p, i) => { const w = nedToWorld([p.n, p.e, p.d]); ghostLine.set(w, i * 3); });
const ghostProfile = ghost.map(p => ({ t: p.t, alt: -p.d / FT }));
const ghostAlt = (t) => -ghostAt(ghost, t).d / FT;
const SUN = (() => { const v = [-0.116, 0.743, -0.66]; const l = Math.hypot(...v); return v.map(x => x / l); })();
const UPSET_T = 76;   // 12:48:16 — start of the actual rapid descent
let G = null;
let NEX = null;            // [{f: NexradField, t}, {f, t}]
// The posted clip is edited: silences between transmissions were cut. Piecewise map clip time -> sim time (s after 12:47:00),
// aligned from the clip's captions against the ATC timeline (12:47:16 turbulence, 12:47:33 ice, 12:48:02 climb request,
// 12:48:28 Mayday, 12:48:37 overspeed, 12:49:02 banking 60, 12:49:21 final).
const ATC = { el: new window.Audio('audio/atc_liveatc.mp3'), on: false, shift: +(localStorage.getItem('n722bd_atc_shift') || 0),
  map: [{ c0: 0, c1: 11.9, off: 15 }, { c0: 11.9, c1: 38.5, off: 18 }, { c0: 38.5, c1: 52.5, off: 20 }, { c0: 52.5, c1: 81.5, off: 33 }, { c0: 81.5, c1: 117, off: 37 }] };
ATC.el.preload = 'auto';
const SETTINGS = { comms: false, callouts: true, nexrad: true, wxr: true, wxrRange: 40, efb: 'MAP' };
NexradField.load(NEXRAD_VOLUMES[0].base).then(async (a) => {
  const b = await NexradField.load(NEXRAD_VOLUMES[1].base);
  NEX = [{ f: a, t: NEXRAD_VOLUMES[0].t }, { f: b, t: NEXRAD_VOLUMES[1].t }];
  R.setNexrad(a, b); if (G) G.env.nex = NEX; buildNexImages();
  console.log('[NEXRAD] loaded', a.file, b.file);
}).catch(e => console.warn('[NEXRAD] not available', e));
function atcSync() {
  const el = ATC.el; if (!ATC.on || !G || (G.phase !== 'run' && G.phase !== 'replay') || G.paused) { if (!el.paused) el.pause(); return; }
  const ts = G.t + ATC.shift;   // user trim: positive plays the tape earlier relative to the sim
  const piece = ATC.map.find(m => ts >= m.c0 + m.off && ts < m.c1 + m.off);
  if (!piece) { if (!el.paused) el.pause(); return; }
  const want = ts - piece.off;
  el.playbackRate = G.timeScale;
  if (el.paused) { el.currentTime = want; el.play().catch(() => {}); }
  else if (Math.abs(el.currentTime - want) > 0.6) el.currentTime = want;
}
function newGame(hypKey, hard = true) {
  const ac = new Learjet60(), env = new Environment(hypKey, hard), ap = new Autopilot(hard); ac.hard = hard;
  ac.failures.tailIce = env.hyp.tailIce; ac.failures.tuck = env.hyp.tuck;
  const g0 = ghost[0];
  ac.setState({ n: g0.n, e: g0.e, d: g0.d, psi: g0.hdg, theta: 1.95 * DEG, phi: 0, V: 232 });
  // trimmed M0.77 at FL350, ISA+7 (see test/flight_test.mjs)
  ac.ctl.thr = 0.83; ac.n1 = 0.83; ac.ctl.trim = 0.37; ac.ice = 0.12; ac.iceTail = 0.25; ac.sys.machTrimFail = !!env.hyp.machTrimFail;
  env.nex = NEX; env.useNex = SETTINGS.nexrad;
  env.wind(ac.pos, 0, 0); ac.step(0, { wind: [0, 0, 0] });   // prime telemetry for the first frame
  ATC.el.pause();
  G = { ac, env, ap, t: 0, phase: 'run', hypKey, hard, hypName: HYPOTHESES[hypKey].name + (hard ? ' · AS FLOWN' : ' · TRAINER'), fdr: [], lastFdr: -1, lastSave: 0, log: [], logIdx: 0, hist: [], trail: [], lastHist: -1, lastTrail: -1,
    recovered: null, recoveredAlt: 0, apOffAt: null, apOffWall: -99, ext: false, timeScale: 1, paused: false, help: false, showGhost: true, antiice: false,
    camPos: null, shake: 0, endMsg: null, stabTime: 0, bangDone: false, upsetT: UPSET_T, time: 0, hideHud: false, camMode: 0, replay: null, recon: false, camEff: 0, ckActive: null, trimRunaway: false };
  document.getElementById('debrief').classList.add('hidden');
}
function log(who, txt) { G.log.push({ t: G.t, who, txt }); }

function stepSim(h, held) {
  const { ac, env, ap } = G; const t = G.t;
  const wind = env.wind(ac.pos, t, h);
  const wasOn = ap.on;
  if (ap.on && held) ap.disconnect('PILOT');
  if (!ap.on) { ac.ctl.elev = IN.axes.elev; ac.ctl.ail = IN.axes.ail; ac.ctl.rud = IN.axes.rud; }
  G.trimRunaway = env.hyp.trimRunaway && t > UPSET_T && t < UPSET_T + 12 && ac.sys.trimMode === 'PRI';
  if (G.trimRunaway) ac.ctl.trim = Math.max(-1, ac.ctl.trim - 0.3 * h);
  const out = ac.step(h, { wind });
  const ir = env.iceRates(env.L, ac);
  ac.ice = clamp(ac.ice + ir.wing * h, 0, 1); ac.iceTail = clamp(ac.iceTail + ir.tail * h, 0, 1); ac.engIce = clamp(ac.engIce + ir.eng * h, 0, 1);
  ap.hdgTgt = t < 25 ? 58 : Math.min(100, 58 + (t - 25) * (42 / 45));
  ap.step(ac, h, out);
  if (ac.tailStalled && ap.on) ap.disconnect('PITCH');
  env.scriptedUpset(ac, ap, t);
  if (ac.tailStalled && ap.on) ap.disconnect('PITCH');
  if (ap.on && env.hyp.trimRunaway && ac.ctl.trim < -0.5) ap.disconnect('TRIM');
  if (wasOn && !ap.on) { G.apOffAt = t; G.apOffWall = performance.now() / 1000; AU.apDisconnect(); log('SYS', `AUTOPILOT DISCONNECT — ${ap.why}. YOUR AIRPLANE.`); }
  G.t += h;
  while (G.logIdx < TIMELINE.length && TIMELINE[G.logIdx].t <= G.t) { const e = TIMELINE[G.logIdx++]; G.log.push({ t: e.t, who: e.who, txt: e.txt }); if (SETTINGS.comms && !ATC.on && (e.who === 'FO' || e.who === 'MIA')) AU.say(e.txt, 0); }
  if (G.t - G.lastHist >= 0.25) { G.lastHist = G.t; G.hist.push({ t: G.t, h: out.h, M: out.M, nz: out.nz, KIAS: out.KIAS }); }
  // Flight data recorder: 4 Hz, persisted to localStorage every 5 s and on end (key n722bd_fdr)
  if (G.t - G.lastFdr >= 0.25) {
    G.lastFdr = G.t; const c = ac.ctl;
    G.fdr.push([G.t, out.h / FT, out.KIAS, out.M, out.vs / FT * 60, out.theta * RAD, out.phi * RAD, out.alpha * RAD, out.nz, c.elev, c.ail, c.rud, c.thr, c.sb, c.trim, ac.ice, ac.tailStalled ? 1 : 0, out.stalled ? 1 : 0, ac.damage, ap.on ? 1 : 0, ac.pos[0], ac.pos[1], out.psi * RAD, ac.n1].map(v => +(+v).toFixed(3)));
    if (G.t - G.lastSave > 5) { G.lastSave = G.t; saveFdr(); }
  }
  if (G.t - G.lastTrail >= 0.5) { G.lastTrail = G.t; G.trail.push(...nedToWorld(ac.pos)); (G.trailNE = G.trailNE || []).push([ac.pos[0], ac.pos[1]]); }
  if (ac.broken && !G.bangDone) { G.bangDone = true; AU.bang(); log('SYS', ac.brokenWhat === 'stab' ? 'HORIZONTAL STABILIZER SEPARATED — PITCH CONTROL LOST' : 'WING STRUCTURAL FAILURE'); G.endMsg = ac.brokenWhat === 'stab' ? 'STRUCTURAL FAILURE — HORIZONTAL STABILIZER SEPARATED' : 'STRUCTURAL FAILURE — WING'; }
  if (ac.crashed && G.phase === 'run') { G.phase = 'end'; G.endMsg = `IMPACT ${clockStr(G.t)} EST`; AU.bang(); debrief(); }
  // recovery: wings level, nose above -5°, sink under 1,500 fpm, ~1 g, sustained 3 s after the AP let go
  if (G.apOffAt !== null && G.recovered === null && !ac.broken && G.t - G.apOffAt > 3 && Math.abs(out.phi) < 15 * DEG && out.theta > -5 * DEG && out.vs > -7.6 && out.nz > 0.6 && out.nz < 1.6 && !out.overspeed) {
    G.stabTime += h; if (G.stabTime > 3) { G.recovered = G.t; G.recoveredAlt = out.h; log('SYS', `RECOVERED at ${Math.round(out.h / FT)} ft, ${(G.t - UPSET_T).toFixed(0)} s after the actual upset time.`); AU.say('Recovered'); setTimeout(debrief, 1500); }
  } else G.stabTime = 0;
  return out;
}

const FDR_COLS = ['t', 'alt_ft', 'kias', 'mach', 'vs_fpm', 'pitch', 'roll', 'alpha', 'nz', 'elev', 'ail', 'rud', 'thr', 'spoiler', 'trim', 'ice', 'tailStall', 'wingStall', 'damage', 'ap', 'n', 'e', 'hdg', 'n1'];
function saveFdr() {
  try { localStorage.setItem('n722bd_fdr', JSON.stringify({ hyp: G.hypKey, hard: G.hard, saved: new Date().toISOString(), recovered: G.recovered, broken: G.ac.brokenWhat, crashed: G.ac.crashed, cols: FDR_COLS, rows: G.fdr })); } catch (e) {}
}
function fdrCsv() { return FDR_COLS.join(',') + '\n' + G.fdr.map(r => r.join(',')).join('\n'); }
// ---------- Systems switches (keys and clickable panel) ----------
function toggleSwitch(id) {
  const { ac, ap } = G; const sys = ac.sys;
  switch (id) {
    case 'wingHeat': case 'stabHeat': { const v = !(sys.wingHeat && sys.stabHeat); sys.wingHeat = v; sys.stabHeat = v; G.antiice = v; log('SYS', `WING/STAB HEAT ${v ? 'ON' : 'OFF'}`); break; }
    case 'nacelleHeat': sys.nacelleHeat = !sys.nacelleHeat; log('SYS', `NAC HEAT L/R ${sys.nacelleHeat ? 'ON' : 'OFF'}`); break;
    case 'pitotHeat': sys.pitotHeat = !sys.pitotHeat; sys.wshldHeat = sys.pitotHeat; break;
    case 'stallWarn': sys.stallWarn = !sys.stallWarn; log('SYS', `STALL WARN L/R ${sys.stallWarn ? 'ON' : 'OFF — shaker silenced'}`); break;
    case 'machTrim': if (!sys.machTrimFail) { sys.machTrim = !sys.machTrim; log('SYS', `MACH TRIM ${sys.machTrim ? 'ON' : 'OFF'}`); } else log('SYS', 'MACH TRIM — FAIL (inop this scenario)'); break;
    case 'trimMode': sys.trimMode = sys.trimMode === 'PRI' ? 'SEC' : sys.trimMode === 'SEC' ? 'OFF' : 'PRI'; log('SYS', `PITCH TRIM selector — ${sys.trimMode}`); break;
    case 'ap': if (ap.on) ap.disconnect('PILOT'); else if (ap.engage(ac.out)) log('SYS', 'AUTOPILOT ENGAGED — ALT/HDG hold'); else log('SYS', 'AP will not engage: attitude out of limits'); break;
    case 'yd': ac.ctl.yd = !ac.ctl.yd; break;
    case 'sb': ac.ctl.sb = ac.ctl.sb ? 0 : 1; break;
    case 'gear': ac.ctl.gear = ac.ctl.gear ? 0 : 1; if (ac.ctl.gear && ac.out.KIAS > 200) log('SYS', `GEAR extended above VLO 200 KIAS${ac.out.KIAS > 260 ? ' and VLE 260 — door damage' : ''}`); break;
    case 'flaps': ac.ctl.flaps = ac.ctl.flaps >= 1 ? 0 : ac.ctl.flaps >= 0.5 ? 1 : ac.ctl.flaps >= 0.2 ? 0.5 : 0.2; break;
    case 'atc': ATC.on = !ATC.on; log('SYS', `Real ATC audio ${ATC.on ? 'ON (LiveATC recording)' : 'OFF'}`); break;
    case 'efb': SETTINGS.efb = SETTINGS.efb === 'MAP' ? 'CHECKLIST' : SETTINGS.efb === 'CHECKLIST' ? 'OFF' : 'MAP'; break;
    case 'ckback': G.ckActive = null; SETTINGS.efb = 'CHECKLIST'; break;
    default: if (id.startsWith('ck')) { G.ckActive = +id.slice(2); SETTINGS.efb = 'CHECKLIST'; }
  }
}
// ---------- Emergency / abnormal procedures (own wording; evaluated live) ----------
const PROCEDURES = [
  { key: '1', title: 'UPSET RECOVERY — NOSE LOW / HIGH SPEED', steps: [
    ['Autopilot — DISCONNECT (X)', () => !G.ap.on],
    ['Thrust levers — IDLE (0)', () => G.ac.ctl.thr < 0.05],
    ['Spoilers — EXTEND (B)', () => G.ac.ctl.sb > 0],
    ['Roll — WINGS LEVEL, nearest horizon', () => Math.abs(G.ac.out.phi) < 15 * DEG],
    ['Pitch — recover smoothly; respect shaker, ≤ 2.5 g', () => Math.abs(G.ac.out.phi) < 15 * DEG && G.ac.out.vs > -7.6],
    ['Pitch trim — NOSE UP as speed decreases (.)', () => G.ac.ctl.trim > 0.15],
    ['Below Vmo/Mmo — spoilers RETRACT, thrust as required', () => !G.ac.out.overspeed && G.ac.ctl.sb === 0 && G.ac.out.vs > -7.6 && G.ac.ctl.thr > 0.2] ] },
  { key: '2', title: 'OVERSPEED — Vmo / Mmo EXCEEDED', steps: [
    ['Thrust levers — REDUCE / IDLE', () => G.ac.ctl.thr < 0.1],
    ['Spoilers — EXTEND', () => G.ac.ctl.sb > 0],
    ['Pitch — INCREASE gently (no abrupt pull above M.81)', () => G.ac.out.vs > -10],
    ['Mach trim — CHECK ON', () => G.ac.sys.machTrim && !G.ac.sys.machTrimFail],
    ['Airspeed — below Vmo / Mmo', () => !G.ac.out.overspeed] ] },
  { key: '3', title: 'TAILPLANE STALL — ICE CONTAMINATED', steps: [
    ['Control wheel — PULL, full nose-up as required', () => G.ac.ctl.elev > 0.8 || !G.ac.tailStalled],
    ['STAB HEAT — ON (verify)', () => G.ac.sys.stabHeat],
    ['Flaps — UP / do not extend', () => G.ac.ctl.flaps === 0],
    ['Thrust — REDUCE', () => G.ac.ctl.thr < 0.4],
    ['Pitch trim — NOSE UP (.)', () => G.ac.ctl.trim > 0.1],
    ['Tail re-attached: airspeed REDUCE, wings level', () => !G.ac.tailStalled && Math.abs(G.ac.out.phi) < 15 * DEG] ] },
  { key: '4', title: 'RUNAWAY PITCH TRIM', steps: [
    ['Control wheel — HOLD against the trim', () => Math.abs(G.ac.ctl.elev) > 0.3 || !G.trimRunaway],
    ['Autopilot / trim — DISCONNECT (X)', () => !G.ap.on],
    ['PITCH TRIM selector — OFF (7)', () => G.ac.sys.trimMode !== 'PRI'],
    ['Re-trim on SECONDARY (7 → SEC, then , .)', () => G.ac.sys.trimMode === 'SEC' && G.ac.ctl.trim > -0.2],
    ['Airspeed — reduce; configure early, expect high control forces', () => G.ac.out.KIAS < 250] ] },
  { key: '5', title: 'EMERGENCY DESCENT', steps: [
    ['Thrust levers — IDLE', () => G.ac.ctl.thr < 0.05],
    ['Spoilers — EXTEND', () => G.ac.ctl.sb > 0],
    ['Landing gear — DOWN below 260 KIAS (G)', () => G.ac.ctl.gear > 0 && G.ac.out.KIAS < 265],
    ['Descend at Vmo / Mmo — no faster', () => G.ac.out.vs < -20 && !G.ac.out.overspeed],
    ['Level-off: spoilers RETRACT, thrust as required', () => G.ac.out.h < 3500 && G.ac.out.vs > -5] ] },
  { key: '6', title: 'ICING — ANTI-ICE SYSTEMS', steps: [
    ['NAC HEAT L/R — ON (9)', () => G.ac.sys.nacelleHeat],
    ['WING/STAB HEAT — ON (I)', () => G.ac.sys.wingHeat && G.ac.sys.stabHeat],
    ['Thrust — N1 ≥ 60% for wing bleed heat', () => G.ac.n1 > 0.4],
    ['PITOT/STATIC, WSHLD HEAT — ON', () => G.ac.sys.pitotHeat],
    ['Exit icing — deviate; with wing ice the stall can come BEFORE the shaker', () => G.env.L.cloud < 0.2] ] },
];
function evalProcedures() {
  const lists = PROCEDURES.map(P => ({ key: P.key, title: P.title, steps: P.steps.map(([text, fn]) => ({ text, done: (() => { try { return !!fn(); } catch (e) { return false; } })() })) }));
  const o = G.ac.out, ac = G.ac; let rec = null;
  if (ac.tailStalled) rec = 2; else if (G.trimRunaway) rec = 3; else if (o.overspeed && o.vs < -15) rec = 1; else if (!G.ap.on && o.vs < -20) rec = 0; else if ((ac.ice > 0.5 || ac.iceTail > 0.5) && !(ac.sys.wingHeat && ac.sys.stabHeat)) rec = 5;
  return { lists, active: G.ckActive, recommended: rec };
}
// ---------- EFB map helpers ----------
const coastX = (n) => 9000 + 700 * Math.sin(n * 0.00011 + 1) + 300 * Math.sin(n * 0.00047 + 0.5);
const ghostNE = ghost.filter((p, i) => i % 2 === 0).map(p => [p.n, p.e]);
let nexImgs = null;
function buildNexImages() {
  nexImgs = NEX.map(({ f }) => {
    const c = document.createElement('canvas'); c.width = f.nx; c.height = f.nz; const g = c.getContext('2d'); const im = g.createImageData(f.nx, f.nz);
    for (let iz = 0; iz < f.nz; iz++) for (let ix = 0; ix < f.nx; ix++) {
      let m = 0; for (let iy = 0; iy < f.ny; iy++) m = Math.max(m, f.data[(iz * f.ny + iy) * f.nx + ix]);
      const dbz = m === 0 ? -30 : m / 4 - 10; const k = ((f.nz - 1 - iz) * f.nx + ix) * 4;   // row 0 = north
      let rgb = null; if (dbz >= 50) rgb = [255, 64, 255]; else if (dbz >= 40) rgb = [255, 40, 40]; else if (dbz >= 30) rgb = [255, 220, 60]; else if (dbz >= 20) rgb = [40, 190, 40]; else if (dbz >= 10) rgb = [20, 110, 30];
      if (rgb) { im.data[k] = rgb[0]; im.data[k + 1] = rgb[1]; im.data[k + 2] = rgb[2]; im.data[k + 3] = 200; }
    }
    g.putImageData(im, 0, 0); return c;
  });
}
// ---------- Reconstruction: rows synthesized from the reported ADS-B track (no physics, no pilot) ----------
function buildReconRows() {
  const rows = []; const last = ghost[ghost.length - 1];
  for (let t = 0; t <= last.t; t += 0.25) {
    const g = ghostAt(ghost, t); const h = -g.d; const atm = isa(Math.max(0, h), 7);
    const kias = g.V * Math.sqrt(atm.rho / RHO0) / KT, mach = g.V / atm.a;
    const gam = g.gamma * RAD;
    // bank: 12° in the course change, then a tightening right spiral (reported 60° at 12:49:02)
    const bank = t < 25 ? 0 : t < 70 ? 12 * smoothstep(25, 30, t) : t < 76 ? 12 * (1 - smoothstep(70, 76, t)) + 4 : t < 100 ? lerp(8, 42, (t - 76) / 24) : t < 122 ? lerp(42, 60, (t - 100) / 22) : lerp(60, 78, (t - 122) / 30);
    const alpha = t < 76 ? 2.0 : lerp(2.0, -1.0, smoothstep(76, 86, t));
    const nz = t < 76 ? 1 + 0.15 * Math.sin(t * 1.7) * (t > 16 ? 1 : 0.3) : clamp(1 / Math.cos(bank * DEG), 1, 2.6);
    const ice = t < 56 ? lerp(0.1, 0.35, t / 56) : lerp(0.35, 0.95, smoothstep(56, 80, t));
    const thr = t < 76 ? 0.62 : t < 90 ? 0.55 : 0.35;
    const damage = smoothstep(118, 134, t);   // breakup indicated before impact; stabilizer separates ~12:49:14
    rows.push([t, h / FT, kias, mach, g.vs / FT * 60, gam + alpha * 0.6, bank, alpha, nz, 0, 0, 0, thr, 0, t < 76 ? 0.3 : -0.2, ice, 0, 0, damage, t < 76 ? 1 : 0, g.n, g.e, g.hdg * RAD, thr]);
  }
  return rows;
}
function startReconstruction() {
  newGame('combined', true); G.fdr = buildReconRows(); G.hist = G.fdr.map(r => ({ t: r[0], h: r[1] * FT, M: r[3], nz: r[8], KIAS: r[2] }));
  G.showGhost = false; G.recon = true; G.hypName = 'RECONSTRUCTION OF THE REPORTED ADS-B TRACK · no physics, no pilot'; startReplay(); G.camMode = 3;
}
// ---------- Replay of the recorded run (positions + attitudes from the FDR) ----------
function startReplay() {
  if (!G.fdr || G.fdr.length < 4) return;
  const rows = G.fdr.slice(); const last = rows[rows.length - 1];
  G.replay = { rows, i: 0, end: last[0], site: [last[20], last[21]] }; G.trailNE = []; G.trail = []; G.lastTrailR = null;
  G.phase = 'replay'; G.t = rows[0][0]; G.camMode = 1; G.ext = true; G.endMsg = null; G.log = G.log.filter(l => l.t <= G.t);
  G.ac.broken = false; G.ac.crashed = false; G.ac.tailStalled = false;
  document.getElementById('debrief').classList.add('hidden'); ATC.el.pause();
}
const C = Object.fromEntries(FDR_COLS.map((c, i) => [c, i]));
function replayStep(dt) {
  const R_ = G.replay, rows = R_.rows; G.t += dt * G.timeScale;
  if (G.t >= R_.end) { G.phase = 'end'; G.t = R_.end; debrief(); return G.ac.out; }
  while (R_.i < rows.length - 2 && rows[R_.i + 1][0] <= G.t) R_.i++;
  const a = rows[R_.i], b = rows[R_.i + 1], f = clamp((G.t - a[0]) / Math.max(1e-3, b[0] - a[0]), 0, 1);
  const L = (c) => lerp(a[C[c]], b[C[c]], f);
  const hdg = (a[C.hdg] + wrap180(b[C.hdg] - a[C.hdg]) * f) * DEG, theta = L('pitch') * DEG, phi = (a[C.roll] + wrap180(b[C.roll] - a[C.roll]) * f) * DEG;
  const ac = G.ac, h = L('alt_ft') * FT;
  ac.pos = [L('n'), L('e'), -h]; ac.q = qfromEuler(hdg, theta, phi);
  if (!G.lastTrailR || G.t - G.lastTrailR > 0.5) { G.lastTrailR = G.t; (G.trailNE = G.trailNE || []).push([ac.pos[0], ac.pos[1]]); G.trail.push(...nedToWorld(ac.pos)); }
  ac.ctl.elev = L('elev'); ac.ctl.ail = L('ail'); ac.ctl.thr = L('thr'); ac.ctl.sb = Math.round(L('spoiler')); ac.ctl.trim = L('trim'); ac.ice = L('ice'); ac.iceTail = L('ice'); ac.n1 = L('n1'); ac.damage = L('damage');
  ac.tailStalled = a[C.tailStall] > 0.5; const dmg = ac.damage >= 1; ac.broken = dmg; ac.brokenWhat = dmg ? 'stab' : '';
  const atm = isa(Math.max(0, h), 7); const V = L('kias') * KT / Math.sqrt(atm.rho / RHO0);
  const vs = L('vs_fpm') * FT / 60;
  ac.vel = [V * Math.cos(hdg), V * Math.sin(hdg), -vs];
  const out = { ...ac.out, h, KIAS: L('kias'), KEAS: L('kias'), M: L('mach'), vs, theta, phi, psi: hdg, track: hdg, alpha: L('alpha') * DEG, beta: 0, nz: L('nz'), V, qbar: 0.5 * atm.rho * V * V,
    gs: V, OAT: atm.T - 273.15, stalled: a[C.wingStall] > 0.5, buffet: a[C.wingStall] > 0.5 || L('mach') > hiBuffetMach(L('nz') * ac.m * G0 / Math.max(1, 0.5 * atm.rho * V * V * ac.S)),
    bands: ac.speedEnvelope(h, clamp(L('nz'), 1, 2.5), ac.ice, 7), overspeed: L('mach') > ac.mmo(h) || L('kias') > ac.vmoKias(h), Vmo: ac.vmoKias(h), Mmo: ac.mmo(h), aStall: 0.1, aoaN: 0, tailStalled: ac.tailStalled, n1: ac.n1, damage: ac.damage, p: 0, q: 0, r: 0 };
  ac.out = out; G.ap.on = a[C.ap] > 0.5;
  G.env.wind(ac.pos, G.t, dt * G.timeScale);
  while (G.logIdx > 0 && TIMELINE[G.logIdx - 1].t > G.t) G.logIdx--;
  while (G.logIdx < TIMELINE.length && TIMELINE[G.logIdx].t <= G.t) { const e = TIMELINE[G.logIdx++]; G.log.push({ t: e.t, who: e.who, txt: e.txt }); }
  if (dmg && !G.endMsg) G.endMsg = 'STRUCTURAL FAILURE — HORIZONTAL STABILIZER SEPARATED';
  return out;
}
function debrief() {
  saveFdr(); console.log('[FDR] run saved to localStorage n722bd_fdr;', G.fdr.length, 'rows');
  const { ac } = G, o = ac.out; const d = document.getElementById('debrief'); d.classList.remove('hidden');
  const title = G.recon ? 'RECONSTRUCTION — IMPACT 12:49:32 (reported)' : ac.crashed ? (ac.broken ? 'AIRFRAME FAILURE, THEN IMPACT' : 'IMPACT') : G.recovered !== null ? 'RECOVERED' : 'DEBRIEF';
  const fmt = (v, u = '') => `${v}${u}`;
  if (G.recon) {
    const r = G.fdr; const col = (i) => r.map(x => x[i]);
    d.querySelector('table').innerHTML = `<tr><th></th><th>Reconstruction (from reports)</th></tr>
      <tr><td>Cruise</td><td>FL350, ~M 0.77, heading 058 → 100 near Palm Beach</td></tr>
      <tr><td>Core entry</td><td>12:47:56, 34 dBZ at FL350, cell top growing 33,600 → 48,300 ft</td></tr>
      <tr><td>Upset</td><td>12:48:06 +450 ft, 12:48:16 descent begins</td></tr>
      <tr><td>Peak Mach / TAS</td><td>${Math.max(...col(3)).toFixed(2)} / ~600 kt (ADS-B estimate)</td></tr>
      <tr><td>Peak descent</td><td>${Math.abs(Math.round(Math.min(...col(4)))).toLocaleString()} ft/min (encoder pegged at 32,640)</td></tr>
      <tr><td>Bank</td><td>60° reported 12:49:02; track turned 100° → 292° in 75 s</td></tr>
      <tr><td>Breakup</td><td>indications before impact (NTSB); stabilizer loss suggested by video</td></tr>
      <tr><td>Impact</td><td>12:49:32, Military Trail near Greenacres, 76 s after FL350</td></tr>`;
    d.querySelector('p.tip').textContent = 'This is the reported flight path replayed through the real KAMX radar volume. Attitudes, bank and the breakup time are inferred, not recorded. Press "Fly it" in the briefing to take the airplane at 12:48:16 yourself.';
    return;
  }
  d.querySelector('h2').textContent = G.recon ? title : `${title} — ${clockStr(G.t)} EST`;
  d.querySelector('h2').style.color = G.recovered !== null && !ac.crashed ? '#6cff6c' : '#ff3b3b';
  d.querySelector('table').innerHTML = `<tr><th></th><th>You</th><th>Actual N722BD (reported)</th></tr>
    <tr><td>Lowest altitude</td><td>${G.hist.length ? fmt(Math.round(Math.max(0, Math.min(...G.hist.map(p => p.h))) / FT), ' ft') : '—'}</td><td>impact, 12:49:32</td></tr>
    <tr><td>Peak Mach</td><td>${ac.maxM.toFixed(3)}</td><td>≈0.9 (est. from ADS-B; Mmo 0.81)</td></tr>
    <tr><td>Peak descent</td><td>${Math.abs(Math.round(ac.maxVS / FT * 60)).toLocaleString()} ft/min</td><td>&gt;32,640 ft/min (encoder limit)</td></tr>
    <tr><td>Peak load factor</td><td>${ac.maxG.toFixed(2)} g / ${ac.minG.toFixed(2)} g</td><td>unknown; in-flight breakup indicated</td></tr>
    <tr><td>Peak EAS</td><td>${Math.round(ac.maxKEAS)} KEAS</td><td>575–600 KTAS est. (~470 KEAS at 15,000 ft)</td></tr>
    <tr><td>Airframe stress</td><td>${Math.round(ac.damage * 100)}%${ac.broken ? ' — ' + (ac.brokenWhat === 'stab' ? 'horizontal stabilizer separated' : 'wing failure') : ''}</td><td>video suggests missing horizontal stabilizer before impact (unconfirmed)</td></tr>
    <tr><td>Recovery</td><td>${G.recovered !== null ? `${Math.round(G.recoveredAlt / FT)} ft, ${(G.recovered - UPSET_T).toFixed(0)} s after 12:48:16` : 'none'}</td><td>none; 76 s from FL350 to ground</td></tr>`;
  let tip = '';
  if (ac.broken) tip = ac.maxM > 0.9 ? 'You exceeded roughly Mach 0.9 with load on the airframe. Above Mmo the stabilizer sees enormous loads; thrust to idle and spoilers out before pulling, then pull smoothly.' : 'Pulled too hard. Limit load is about +3 g; a Learjet at high EAS breaks at roughly 1.5× that. Roll level first, then pull progressively, watching the G readout.';
  else if (ac.crashed) tip = Math.abs(o.phi) > 30 * DEG ? 'The spiral never got unwound: with bank on, pulling only tightens the turn and raises G. Wings level FIRST, then pull.' : 'Not enough nose-up authority in time. Idle, spoilers, nose-up trim, and a steady pull started earlier.';
  else tip = 'Textbook: idle, spoilers, level the wings, unload, then a smooth sustained pull. The actual crew faced this in a convective core, in severe turbulence, in the dark of the cloud, with ice on the tail, at Mach .8 — and with 20 seconds between "request climb" and Mayday.';
  d.querySelector('p.tip').textContent = tip;
}

function handleEvents() {
  for (const e of IN.drain()) {
    const { ac, ap } = G;
    if (e === 'ap_toggle') toggleSwitch('ap');
    else if (['efb', 'ckback', 'ck0', 'ck1', 'ck2', 'ck3', 'ck4', 'ck5', 'trimMode', 'machTrim', 'nacelleHeat'].includes(e)) toggleSwitch(e);
    else if (e === 'atc') toggleSwitch('atc');
    else if (e === 'atc_earlier' || e === 'atc_later') { ATC.shift += e === 'atc_earlier' ? 1 : -1; localStorage.setItem('n722bd_atc_shift', ATC.shift); log('SYS', `ATC tape shift ${ATC.shift >= 0 ? '+' : ''}${ATC.shift} s (${ATC.shift > 0 ? 'tape earlier' : ATC.shift < 0 ? 'tape later' : 'as aligned'})`); }
    else if (e === 'comms') { SETTINGS.comms = !SETTINGS.comms; log('SYS', `Synthesized comms voice ${SETTINGS.comms ? 'ON' : 'OFF'}`); }
    else if (e === 'nexrad') { SETTINGS.nexrad = !SETTINGS.nexrad; G.env.useNex = SETTINGS.nexrad; log('SYS', `NEXRAD volume ${SETTINGS.nexrad ? 'ON (KAMX 17:45:48Z→17:51:04Z)' : 'OFF (synthetic cell)'}`); }
    else if (e === 'wxr') SETTINGS.wxr = !SETTINGS.wxr;
    else if (e === 'wxr_range') { SETTINGS.wxrRange = SETTINGS.wxrRange === 40 ? 80 : SETTINGS.wxrRange === 80 ? 20 : 40; }
    else if (e === 'sb' || e === 'gear' || e === 'flaps') toggleSwitch(e);
    else if (e === 'cam') { G.camMode = (G.camMode + 1) % (G.phase === 'replay' ? 4 : 2); G.ext = G.camMode > 0; }
    else if (e === 'hud') G.hideHud = !G.hideHud;
    else if (e === 'pause') G.paused = !G.paused;
    else if (e === 'restart') { newGame(G.hypKey, G.hard); }
    else if (e === 'skip' && G.phase === 'replay') { if (G.t < 70) G.t = 70; else if (G.t < 118) G.t = 118; }
    else if (e === 'skip' && G.t < 50) { while (G.t < 50) stepSim(1 / 120, false); }
    else if (e === 'quality') { R.quality = R.quality >= 1.4 ? 0.6 : +(R.quality + 0.4).toFixed(1); R.scale = R.quality >= 1.4 ? 0.75 : R.quality >= 1 ? 0.5 : 0.4; }
    else if (e === 'slower') G.timeScale = Math.max(0.25, G.timeScale / 2);
    else if (e === 'faster') G.timeScale = Math.min(1, G.timeScale * 2);
    else if (e === 'antiice') toggleSwitch('wingHeat');
    else if (e === 'yd') toggleSwitch('yd');
    else if (e === 'help') G.help = !G.help;
    else if (e === 'ghost') G.showGhost = !G.showGhost;
    else if (e === 'idle') ac.ctl.thr = 0;
    else if (e === 'mute') AU.muted = !AU.muted;
  }
}

let last = performance.now(), fps = 60;
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000); last = now; fps = lerp(fps, 1 / Math.max(dt, 1e-3), 0.05);
  handleEvents();
  const { ac, env, ap } = G;
  let out = ac.out;
  if (G.phase === 'run' && !G.paused) {
    const held = IN.update(dt);
    if (!ap.on) { ac.ctl.thr = clamp(ac.ctl.thr + IN.thrDelta, 0, 1); const tr = ac.sys.trimMode === 'PRI' ? 1 : ac.sys.trimMode === 'SEC' ? 0.45 : 0; ac.ctl.trim = clamp(ac.ctl.trim + IN.trimDelta * tr, -1, 1); }
    const simDt = dt * G.timeScale; const sub = Math.max(1, Math.ceil(simDt / (1 / 240))); const h = simDt / sub;
    for (let i = 0; i < sub; i++) out = stepSim(h, held);
    G.time += simDt;
  } else if (G.phase === 'replay' && !G.paused) { IN.update(dt); out = replayStep(dt); }
  else if (G.phase === 'end') { IN.update(dt); }
  // ---------- camera ----------
  const Rm = qmat(ac.q);
  const fwd = nedToWorld(mulMV(Rm, [1, 0, 0])), right = nedToWorld(mulMV(Rm, [0, 1, 0])), up = nedToWorld(mulMV(Rm, [0, 0, -1]));
  const posW = nedToWorld(ac.pos);
  const buffetAmp = (out.buffet ? 0.08 : 0) + 0.025 * env.L.turb + (ac.broken ? 0.3 : 0);
  const sh = (k) => (Math.sin(G.time * 37 * k) + Math.sin(G.time * 61 * k + 1)) * buffetAmp;
  let cam;
  let camMode = G.camMode;
  if (G.phase === 'replay' && G.camMode === 3) {   // AUTO: chase -> cockpit into the core -> chase for the upset -> ground cam for the final 30 s
    const t = G.t; camMode = t < 48 ? 1 : t < 86 ? 0 : t < G.replay.end - 32 ? 1 : 2;
  }
  G.ext = camMode > 0; G.camEff = camMode;
  if (G.ext && camMode === 2 && G.replay) {
    // Ground camera: a fixed observer ~600 m south-west of the impact point, tracking the aircraft
    const site = nedToWorld([G.replay.site[0] - 450, G.replay.site[1] - 400, -2]);
    const dir = [0, 1, 2].map(i => posW[i] - site[i]); const dl = Math.hypot(...dir) || 1; dir.forEach((v, i) => dir[i] = v / dl);
    const rr = [dir[2], 0, -dir[0]]; const rrl = Math.hypot(rr[0], rr[2]) || 1; rr[0] /= rrl; rr[2] /= rrl;
    const uu = [dir[1] * rr[2] - dir[2] * rr[1], dir[2] * rr[0] - dir[0] * rr[2], dir[0] * rr[1] - dir[1] * rr[0]];
    cam = { pos: site, right: rr, up: uu, fwd: dir };
    G.groundFov = clamp(Math.atan2(45, dl) * 2, 1.2 * DEG, 50 * DEG);
  } else if (!G.ext) {
    // Pilot's head: right-drag looks around (default slightly down so the panel is in view), wheel zooms
    G.head = Cockpit.head(clamp(IN.orbit.yaw, -2.2, 2.2), clamp(-IN.orbit.pitch, -1.1, 0.9) - 0.22);
    G.shakeEye = [sh(1.3) * 0.004, sh(0.9) * 0.004, 0];
    const eye = [0, 1, 2].map(i => posW[i] + fwd[i] * 6.0 + up[i] * 0.55 + right[i] * sh(1.3) * 0.4 + up[i] * sh(0.9) * 0.4);
    const toW = (h) => [0, 1, 2].map(i => right[i] * h[0] + up[i] * h[1] + fwd[i] * h[2]);
    cam = CK ? { pos: eye, right: toW(G.head.right), up: toW(G.head.up), fwd: toW(G.head.fwd) } : { pos: eye, right, up, fwd };
  } else {
    const fh = [fwd[0], 0, fwd[2]]; const l = Math.hypot(fh[0], fh[2]) || 1; fh[0] /= l; fh[2] /= l;
    const oy = IN.orbit.yaw, op = IN.orbit.pitch, cy = Math.cos(oy), sy = Math.sin(oy);
    const back = [fh[0] * cy + fh[2] * sy, 0, fh[2] * cy - fh[0] * sy];
    const dist = 34 * Math.cos(op), lift = 9 + 34 * Math.sin(op);
    const des = [posW[0] - back[0] * dist + right[0] * 6 * cy, Math.max(posW[1] + lift, 3), posW[2] - back[2] * dist + right[2] * 6 * cy];
    G.camPos = des;
    const dir = [0, 1, 2].map(i => posW[i] - G.camPos[i]); const dl = Math.hypot(...dir); dir.forEach((v, i) => dir[i] = v / dl);
    // right = worldUp x dir, up = dir x right (world is x east, y up, z north; right-handed)
    const rr = [dir[2], 0, -dir[0]]; const rrl = Math.hypot(rr[0], rr[2]) || 1; rr[0] /= rrl; rr[2] /= rrl;
    const uu = [dir[1] * rr[2] - dir[2] * rr[1], dir[2] * rr[0] - dir[0] * rr[2], dir[0] * rr[1] - dir[1] * rr[0]];
    cam = { pos: G.camPos, right: rr, up: uu, fwd: dir };
  }
  // ---------- ghost ----------
  const gp = ghostAt(ghost, G.t); const gW = nedToWorld([gp.n, gp.e, gp.d]);
  const bank = (G.t < 70 ? 12 * smoothstep(25, 35, G.t) * (1 - smoothstep(65, 72, G.t)) : 20 + 45 * smoothstep(76, 120, G.t)) * DEG;
  const gf = [Math.sin(gp.hdg) * Math.cos(gp.gamma), Math.sin(gp.gamma), Math.cos(gp.hdg) * Math.cos(gp.gamma)];
  let gr = [Math.cos(gp.hdg), 0, -Math.sin(gp.hdg)]; let gu = [gf[1] * gr[2] - gf[2] * gr[1], gf[2] * gr[0] - gf[0] * gr[2], gf[0] * gr[1] - gf[1] * gr[0]];
  const gr2 = gr.map((v, i) => v * Math.cos(bank) - gu[i] * Math.sin(bank)), gu2 = gr.map((v, i) => v * Math.sin(bank) + gu[i] * Math.cos(bank));
  const stormT = STORM.top(G.t);
  const S = {
    cam, fov: G.camEff === 2 && G.replay ? G.groundFov : G.ext ? 60 * DEG : (CK ? clamp(64 * IN.zoom, 26, 78) : 70) * DEG, time: G.time, sun: SUN, ac: { pos: posW, fwd, right, up }, ext: G.ext, stabGone: ac.broken && ac.brokenWhat === 'stab',
    ghost: { pos: gW, fwd: gf, right: gr2, up: gu2 }, showGhost: G.showGhost && G.t < ghost[ghost.length - 1].t,
    storm: { pos: [STORM.e + STORM.drift[1] * G.t, stormT, STORM.n + STORM.drift[0] * G.t], r: STORM.rCore, base: STORM.base },
    flash: env.flash, cloudBase: 6400, cloudTop: 10500, useNex: SETTINGS.nexrad, nexMix: NEX ? clamp((G.t - NEX[0].t) / (NEX[1].t - NEX[0].t), 0, 1) : 0,
    lines: [{ data: ghostLine, color: [1, 0.25, 0.75, G.recon ? 0 : G.showGhost ? 0.9 : 0.25], strip: true }, { data: new Float32Array(G.trail), color: [0.4, 1, 0.4, 0.9], strip: true }],
  };
  R.render(S); G.lastFov = S.fov;
  const HS = { out, ac, ap, t: G.t, log: G.log, inCloud: env.L.cloud, core: env.L.core, updraft: env.L.updraft, ext: G.ext, hist: G.hist, ghostProfile, ghostAlt, recovered: G.recovered, recoveredAlt: G.recoveredAlt, upsetT: UPSET_T,
    apOffAt: G.apOffAt, apOffWall: G.apOffWall, timeScale: G.timeScale, quality: R.quality, help: G.help, paused: G.paused, hypName: G.hypName, endMsg: G.endMsg, antiice: G.antiice, flash: env.flash, fps,
    wxr: SETTINGS.wxr && NEX ? { range: SETTINGS.wxrRange, sample: (n, e, h0, h1) => { h0 -= 1500; const w = clamp((G.t - NEX[0].t) / (NEX[1].t - NEX[0].t), 0, 1); return lerp(NEX[0].f.dbzBand(n, e, h0, h1), NEX[1].f.dbzBand(n, e, h0, h1), w); } } : null,
    efb: { mode: SETTINGS.efb, range: SETTINGS.wxrRange }, checklist: evalProcedures(), trimRunaway: G.trimRunaway,
    map: { n: ac.pos[0], e: ac.pos[1], hdg: out.psi || 0, coastX, ghost: ghostNE, trail: G.trailNE || [], nexImg: nexImgs ? nexImgs[(NEX && G.t > (NEX[0].t + NEX[1].t) / 2) ? 1 : 0] : null, nexN0: NEX ? NEX[0].f.z0 : 0, nexN1: NEX ? NEX[0].f.z0 + NEX[0].f.nz * NEX[0].f.d : 0, nexE0: NEX ? NEX[0].f.x0 : 0, nexE1: NEX ? NEX[0].f.x0 + NEX[0].f.nx * NEX[0].f.d : 0 },
    atcOn: ATC.on, atcShift: ATC.shift, hideHud: G.hideHud, replay: G.phase === 'replay', camMode: G.camEff, camAuto: G.camMode === 3, recon: !!G.recon, nexOn: SETTINGS.nexrad && !!NEX, dbz: env.L.dbz,
    cockpit3d: !!CK && !G.ext };
  if (HS.cockpit3d) {
    CK.update(HS);
    CK.render({ ctl: ac.ctl, sunWorld: SUN, acBasis: { right, up, fwd }, inCloud: env.L.cloud, core: env.L.core, flash: env.flash },
      G.head, G.shakeEye, S.fov, innerWidth / innerHeight);
  } else if (CK) CK.hide();
  H.draw(HS);
  atcSync();
  if (G.phase === 'run' && !G.paused) IN.haptics({ shaker: !!ac.shaker && !ac.broken, buffet: !!out.buffet, broken: ac.broken });
  AU.update(dt, { qbar: out.qbar || 0, V: out.V || 0, n1: ac.n1, overspeed: !!out.overspeed, stall: !!out.stalled && out.alpha > 0, buffet: !!out.buffet, inCloud: env.L.cloud, ext: G.ext, broken: ac.broken, flash: env.flash, flashDist: env.L.r });
  if ((G.phase === 'run' || G.phase === 'replay') && !G.paused) {
    if (Math.abs(out.phi) > 45 * DEG) AU.say('Bank angle', 3);
    if (out.vs < -30 && out.h < 3000) AU.say('Pull up', 2);
    if (out.overspeed) AU.say('Overspeed', 6);
  }
  requestAnimationFrame(frame);
}

// ---------- boot ----------
const sel = document.getElementById('hyp');
for (const [k, v] of Object.entries(HYPOTHESES)) { const o = document.createElement('option'); o.value = k; o.textContent = v.name; sel.appendChild(o); }
document.getElementById('begin').addEventListener('click', () => {
  document.getElementById('brief').classList.add('hidden'); AU.start();
  ATC.on = document.getElementById('atcbox').checked; SETTINGS.nexrad = document.getElementById('nexbox').checked;
  newGame(sel.value, document.getElementById('diff').value === 'hard'); hc.focus();
});
document.getElementById('replay').addEventListener('click', () => { if (G.recon) startReconstruction(); else startReplay(); hc.focus(); });
document.getElementById('watch').addEventListener('click', () => {
  document.getElementById('brief').classList.add('hidden'); AU.start();
  ATC.on = document.getElementById('atcbox').checked; SETTINGS.nexrad = document.getElementById('nexbox').checked;
  startReconstruction(); hc.focus();
});
document.getElementById('csv').addEventListener('click', () => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([fdrCsv()], { type: 'text/csv' })); a.download = `n722bd_${G.hypKey}_${G.hard ? 'asflown' : 'trainer'}_${Math.round(G.t)}s.csv`; a.click();
});
document.getElementById('again').addEventListener('click', () => { newGame(G.hypKey, G.hard); });
document.getElementById('continue').addEventListener('click', () => { document.getElementById('debrief').classList.add('hidden'); });
document.getElementById('brief-again').addEventListener('click', () => { document.getElementById('debrief').classList.add('hidden'); document.getElementById('brief').classList.remove('hidden'); });
document.getElementById('nexbox').checked = true; document.getElementById('atcbox').checked = false;   // Chrome restores form state on reload
newGame('combined'); G.paused = true;
IN.onClick = (x, y) => {
  let h = null;
  if (CK && !G.ext && G.head) { const p = CK.pick(2 * x / innerWidth - 1, 1 - 2 * y / innerHeight, G.head, G.lastFov || 64 * DEG, innerWidth / innerHeight); h = p && p.hit; }
  else h = H.hit(x, y);
  if (!h) return false; toggleSwitch(h.id); return true;
};
window.SIM = { get G() { return G; }, ATC, SETTINGS, IN, get NEX() { return NEX; } };   // debug / flight-data access from the console
requestAnimationFrame(frame);
