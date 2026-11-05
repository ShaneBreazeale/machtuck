import { Learjet60, hiBuffetMach, STAB } from './aircraft.js';
import { Environment, Autopilot, buildGhost, ghostAt, STORM, TIMELINE, HYPOTHESES, clockStr, NexradField, NEXRAD_VOLUMES, RecoveryJudge, UPSET_T, ACCIDENT_DT } from './scenario.js';
import { Renderer } from './render.js';
import { scenarioSun } from './sun.js';
import { PilotControls } from './controls.js';
import { HUD } from './hud.js';
import { Cockpit } from './cockpit.js';
import { Input } from './input.js';
import { HardwarePanel } from './hwui.js';
import { ForceFeedback } from './ffb.js';
import { FreeEnv, setupStart, setWeight, configureGuidance, frameFor, approachRunway, STARTS, WEATHER, WEIGHTS, FAILURES } from './freeflight.js';
import { takeoffSpeeds, vref, MAX_LANDING_LB } from './afm.js';
import { runwayAt } from './ground.js';
import { nearestIls } from './nav.js';
import { NavDB, procedureLegs, procedureList } from './navdb.js';
import { parseRoute, buildPlan, parsePln } from './route.js';
import { FMS } from './fms.js';
import { Audio } from './audio.js';
import { DEG, RAD, clamp, qmat, mulMV, nedToWorld, lerp, smoothstep, qfromEuler, wrap180, wrap360 } from './util.js';
import { isa, RHO0, G0 } from './atmo.js';
import { FT, KT } from './atmo.js';

const glc = document.getElementById('gl'), hc = document.getElementById('hud');
const R = new Renderer(glc), H = new HUD(hc), IN = new Input(hc), AU = new Audio();
let CK = null; try { CK = new Cockpit(document.getElementById('ck')); } catch (e) { console.warn('3D cockpit unavailable, using the 2D panel:', e); }
IN.onPad = (msg) => log('SYS', msg);
// controls / hardware binding panel: pauses the sim while open
const FF = new ForceFeedback();   // USB PID force-feedback stick over WebHID (js/ffb.js): position in, hinge moment out
IN.hw.isFfb = (gp) => FF.matchesPad(gp);
FF.reconnect().then((ok) => { if (ok) log('SYS', `${FF.status}. Its stick position is now the column position.`); });
const HP = new HardwarePanel(IN.hw, { ffb: FF, onOpen: () => { HP.wasPaused = G.paused; G.paused = true; }, onClose: () => { G.paused = HP.wasPaused; hc.focus(); } });
const ghost = buildGhost();
const ghostLine = new Float32Array(ghost.length * 3);
ghost.forEach((p, i) => { const w = nedToWorld([p.n, p.e, p.d]); ghostLine.set(w, i * 3); });
const ghostProfile = ghost.map(p => ({ t: p.t, alt: -p.d / FT }));
const ghostAlt = (t) => -ghostAt(ghost, t).d / FT;
let SUN = scenarioSun(0).v;   // real solar position for the scenario clock (js/sun.js), updated each frame
let G = null;
// Navigation database (FAA CIFP via tools/fetch_cifp.py): airports, runways, ILS and procedures for free-flight sorties
const DB = new NavDB();
const DB_READY = DB.init().then(() => DB.airport('KDJT')).then(() => { console.log('[NAVDB] cycle', DB.index.cycle, DB.airportList().length, 'airports'); return DB; })
  .catch((e) => { console.warn('[NAVDB] not available', e); return null; });
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
// Real-world environment beyond the radar: GOES-19 cloud tops, GLM lightning, USGS imagery (see tools/fetch_*.py)
let GLM = null;
fetch('data/glm_flashes.json').then(r => r.json()).then(j => { GLM = j.flashes; if (G && G.env && SETTINGS.nexrad && G.mode !== 'free') { G.env.glm = GLM; } console.log('[GLM]', GLM.length, 'flashes'); }).catch(e => console.warn('[GLM] not available', e));
R.loadExterior().then(() => console.log('[EXT] exterior model loaded')).catch(e => console.warn('[EXT] exterior model not available, SDF airframe', e));
R.loadGround().then(() => { console.log('[GROUND] USGS imagery loaded'); return Promise.all([R.loadBuildings().then(r => console.log('[BUILDINGS]', r)).catch(e => console.warn('[BUILDINGS] footprints not available', e)), R.loadTrees().then(r => console.log('[TREES]', r)).catch(e => console.warn('[TREES] canopy trees not available', e))]); }).catch(e => console.warn('[GROUND] imagery not available, procedural ground', e));
R.loadGoes().then(m => console.log('[GOES] loaded', m.scans.map(s => s.time_utc).join(', '))).catch(e => console.warn('[GOES] not available', e));
// KPBI 17:53Z METAR: 08016G28KT 10SM -RA SCT026 SCT050 OVC060 -> cumulus 790-1700 m, MCS deck base 1830 m
const WX = { cuBase: 790, cuTop: 1700, cuCover: 0.14, deckBase: 1830, drift: [STORM.drift[1], STORM.drift[0]] };
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
  DTO.el.classList.add('hidden');
  const ac = new Learjet60(), env = new Environment(hypKey, hard), ap = new Autopilot(hard);
  ac.failures.tailIce = env.hyp.tailIce; ac.failures.tuck = env.hyp.tuck;
  const g0 = ghost[0];
  ac.setState({ n: g0.n, e: g0.e, d: g0.d, psi: g0.hdg, theta: 1.95 * DEG, phi: 0, V: 232 });
  // trimmed M0.77 at FL350 (see test/flight_test.mjs)
  ac.ctl.thr = 0.83; ac.n1 = 0.83; ac.ctl.trim = 0.37; ac.ice = 0.12; ac.iceTail = 0.25; ac.sys.machTrimFail = !!env.hyp.machTrimFail;
  env.nex = NEX; env.useNex = SETTINGS.nexrad; env.glm = SETTINGS.nexrad ? GLM : null;   // real weather off: modelled lightning too
  env.wind(ac.pos, 0, 0); ac.step(0, { wind: [0, 0, 0] });   // prime telemetry for the first frame
  ATC.el.pause();
  G = { mode: 'accident', ac, env, ap, t: 0, phase: 'run', hypKey, hard, hypName: HYPOTHESES[hypKey].name + (hard ? ' · AS FLOWN' : ' · TRAINER'), fdr: [], lastFdr: -1, lastSave: 0, log: [], logIdx: 0, hist: [], trail: [], lastHist: -1, lastTrail: -1,
    recovered: null, recoveredAlt: 0, pc: new PilotControls(), slipLogged: false, apOffAt: null, apOffWall: -99, ext: false, timeScale: 1, paused: false, help: false, showGhost: true, antiice: false,
    camPos: null, shake: 0, endMsg: null, judge: new RecoveryJudge(), avoided: null, bangDone: false, upsetT: UPSET_T, time: 0, hideHud: false, camMode: 0, replay: null, recon: false, camEff: 0, ckActive: null, trimRunaway: false };
  document.getElementById('debrief').classList.add('hidden');
}
// Free flight sortie (js/freeflight.js): no storm, no script. The airport, runway and approach come from the nav
// database; the flight plan is flown by the FMS (js/fms.js) through the autopilot / flight director.
const FREE_KEY = 'n722bd_sortie_v3';
const magOf = (apt, t) => String(Math.round(wrap360(t - (apt ? apt.magvar : 0))) || 360).padStart(3, '0');
const altTxt = (a) => !a ? '' : a.d === '+' || a.d === 'H' || a.d === 'J' || a.d === 'V' ? ` ≥${a.a1.toLocaleString()}` : a.d === '-' || a.d === 'Y' ? ` ≤${a.a1.toLocaleString()}` : a.d === 'B' ? ` ${a.a2.toLocaleString()}–${a.a1.toLocaleString()}` : ` ${a.a1.toLocaleString()}`;
// one line per leg, plain language, from the leg data
function legText(apt, l) {
  const fx = l.fix ? l.fix.id : '', crs = l.crsMag != null ? String(Math.round(l.crsMag) || 360).padStart(3, '0') + '°' : l.crsT != null ? magOf(apt, l.crsT) + '°' : '', turn = l.turn ? (l.turn === 'L' ? 'left ' : 'right ') : '';
  if (l.vectors) return fx === 'VECTR' ? 'ATC vectors to final' : `intercept the final approach course at ${fx}${altTxt(l.alt)}`;
  switch (l.pt) {
    case 'IF': return `${fx}${altTxt(l.alt)}`;
    case 'TF': case 'DF': return `${turn}direct ${fx}${altTxt(l.alt)}`;
    case 'CF': return `${turn}course ${crs} to ${fx}${altTxt(l.alt)}`;
    case 'CA': case 'FA': return `${turn}course ${crs} to${altTxt(l.alt)} ft`;
    case 'VA': return `${turn}heading ${crs} to${altTxt(l.alt)} ft`;
    case 'CI': case 'VI': return `${turn}${l.pt === 'VI' ? 'heading' : 'course'} ${crs} to intercept`;
    case 'CD': case 'FD': case 'VD': return `${turn}${crs} to ${l.dist} DME`;
    case 'RF': case 'AF': return `${turn}arc to ${fx}${altTxt(l.alt)}`;
    case 'HF': case 'HA': case 'HM': return `hold at ${fx}, inbound ${crs}, ${l.turn === 'L' ? 'left' : 'right'} turns${altTxt(l.alt)}${l.pt === 'HM' ? '' : l.pt === 'HF' ? ' (one circuit)' : ' (to the altitude)'}`;
    default: return `${l.pt} ${fx}`;
  }
}
// the route part (SID / airways / STAR) as fix names; the approach in full
function planSummary(apt, legs) {
  const a0 = legs.findIndex((l) => l.kind === 'APP');
  const route = (a0 >= 0 ? legs.slice(0, a0) : legs.filter((l) => l.kind && l.kind !== 'APP')).filter((l) => l.fix).map((l) => l.fix.id);
  const app = a0 >= 0 ? legs.slice(a0) : legs.some((l) => l.kind === 'APP') ? legs : [];
  const appTxt = app.length ? approachSummary(apt, app) : '';
  return route.length ? `${route.join(' ')}${appTxt ? ' — APPROACH: ' + appTxt : ''}` : appTxt;
}
function approachSummary(apt, legs) {
  const m = legs.findIndex((l) => l.map);
  const fin = legs.slice(0, m + 1).map((l) => legText(apt, l) + (l.faf ? ' (FAF)' : l.map ? ' (MAP)' : '')), miss = legs.slice(m + 1).map((l) => legText(apt, l));
  return `${fin.join(' · ')}${miss.length ? ` — MISSED APPROACH: ${miss.join(', then ')}` : ''}`;
}
// Approach minimums from the FAA plate (tools/fetch_plates.py reads them from each chart's text layer; CIFP has none).
// The Learjet 60 is approach Category C: VREF at the 19,500 lb maximum landing weight is 139 kt (121-140 kt).
// Line of minimums by procedure: ILS -> S-ILS, LOC -> S-LOC, LDA -> S-LDA, RNAV (GPS) -> LNAV/VNAV (baro-VNAV, no
// WAAS), else LNAV; RNAV (RNP) -> RNP 0.30. Returns { alt (ft MSL), type, chart } or null.
const APPROACH_CAT = 'C';
function plateMinimums(app, rwy, aptId) {
  if (!PL.meta || !app || !rwy || (aptId && PL.meta.icao !== aptId)) return null;   // plates are fetched for one airport
  const k = app[0], want = { I: ['S-ILS'], L: ['S-LOC'], X: ['S-LDA'], R: ['LNAV/VNAV', 'LNAV'], H: ['RNP 0.30', 'RNP 0.11'] }[k] || [];
  const title = procName(app), charts = PL.meta.charts.filter((c) => c.code === 'IAP' && c.title.endsWith('RWY ' + rwy) &&
    (k === 'I' ? /^ILS/.test(c.title) : k === 'L' ? /LOC/.test(c.title) : c.title === title));
  for (const t of want) for (const c of charts) {
    const m = (c.minimums || []).find((x) => x.type === t && (!x.rwy || x.rwy === rwy));
    if (m && m.cat[APPROACH_CAT]) return { alt: m.cat[APPROACH_CAT].alt, rvr: m.cat[APPROACH_CAT].rvr, type: t, chart: `${c.title}${c.amdt ? ' Amdt ' + c.amdt : ''}` };
  }
  return null;
}
// The sortie's flight plan: departure procedure, the route string's airways and fixes, arrival procedure, approach.
// o: the planner's selections. Returns { dep, arr, legs, errors, dist, parse } (null while an airport is loading).
const runwayOfApp = (app) => { const m = (app || '').slice(1).match(/^(\d\d[LRC]?)/); return m ? m[1] : null; };
function sortiePlan(o) {
  const dep = DB.loaded(o.apt), arr = DB.loaded(o.arr || o.apt);
  if (!dep || !arr) return null;
  const parse = parseRoute(DB, o.route || '', dep, arr);
  const plan = buildPlan(DB, { dep, arr, depRwy: o.rwy, sid: o.sid || null, sidTrans: o.sidTrans || null, enroute: parse.enroute,
    star: o.star || null, starTrans: o.starTrans || null, arrRwy: runwayOfApp(o.app), app: o.app || null, appTrans: o.trans === 'auto' ? undefined : (o.trans || null) });
  return { dep, arr, parse, ...plan, errors: [...parse.errors, ...plan.errors] };
}
function newFreeFlight(o) {
  DTO.el.classList.add('hidden');
  const P = sortiePlan(o);
  if (!P) { console.warn('airport not loaded', o.apt, o.arr); return; }
  const { dep, arr, legs } = P, apt = arr, cruise = o.cruise ? +o.cruise : null;
  const ac = new Learjet60(), env = new FreeEnv(o.wx), ap = new Autopilot(true), fms = new FMS();
  setWeight(ac, o.weight);
  const r = setupStart(ac, { ...o, arr: arr.id, cruise }, env, legs);
  env.wind(ac.pos, 0, 0); ac.step(0, { wind: [0, 0, 0] });
  // the ILS: the loaded approach's localizer, else the nearest one ahead
  ap.nav = (q) => { const id = fms.approachNav(), il = id && arr.ils[id]; return nearestIls(il ? [il] : DB.allIls(), ac.pos[0], ac.pos[1], q.h, q.track ?? q.psi); };
  configureGuidance(ap, fms, r, { ...o, cruise }, legs, ac.out);
  ATC.el.pause(); ATC.on = false;
  newGame('combined', true);   // builds the shared state; then swap in the free-flight pieces
  const dr = dep.runways[(o.rwy || '').startsWith('RW') ? o.rwy : 'RW' + o.rwy], fieldFt = dr && dr.elev != null ? dr.elev : dep.elev || 0;   // the departure field's elevation
  const lb = ac.m / 0.45359237, V = takeoffSpeeds(lb, fieldFt), hasApp = legs.some((l) => l.kind === 'APP');
  const rwy = hasApp ? approachRunway(legs, o.app) : null, il = hasApp && fms.approachNav() ? arr.ils[fms.approachNav()] : null;
  const tdze = rwy && arr.runways['RW' + rwy] ? arr.runways['RW' + rwy].elev : arr.elev;
  const routeTxt = dep.id !== arr.id || legs.some((l) => l.kind !== 'APP') ? `${dep.id}${o.sid ? ' ' + o.sid : ''} → ${arr.id}` : `${arr.id}`;
  Object.assign(G, { mode: 'free', free: o, ac, env, ap, fms, apt: o.start === 'rwy' ? dep : arr, legs, hypKey: 'free', vsp: { ...V, ref: vref(Math.min(lb, 23100)) }, co: {}, failAt: o.fail === 'climb' ? 400 + Math.random() * 1100 : null, autoSb: true,
    mins: null, minsFrom: null, legI: -1,
    hypName: `SORTIE · ${routeTxt}${o.app ? ' · ' + o.app + (o.trans && o.trans !== 'auto' ? '.' + o.trans : '') : ''}${cruise ? ' · ' + (cruise >= 18000 ? 'FL' + cruise / 100 : cruise.toLocaleString() + ' ft') : ''} · ${STARTS[o.start].name.split(',')[0]} · ${WEATHER[o.wx].name.split(':')[0]} · ${WEIGHTS[o.weight].name.split(' (')[0]}` });
  const pm = hasApp ? plateMinimums(o.app, rwy, arr.id) : null;
  const precision = !!(il && il.gs && /^I/.test(o.app || ''));   // an ILS with a glideslope: DA 200 ft above touchdown; LOC, RNAV and the rest 400
  G.mins = pm ? pm.alt : hasApp ? tdze + (precision ? 200 : 400) : null; G.minsFrom = pm;
  log('SYS', r.msg);
  if (legs.length) {
    log('SYS', `FLIGHT PLAN (FAA CIFP ${DB.index.cycle}${P.dist ? `, ${Math.round(P.dist)} nm` : ''}): ${planSummary(apt, legs)}`);
    if (P.errors.length) log('SYS', `Not in the plan: ${P.errors.join('; ')}`);
  }
  if (hasApp) {
    const minTxt = pm ? `${pm.type} ${/MDA|LOC|LNAV$|LDA/.test(pm.type) && !/VNAV/.test(pm.type) ? 'MDA' : 'DA'} ${pm.alt} ft (${Math.round(pm.alt - tdze)} above touchdown, Cat ${APPROACH_CAT}${pm.rvr ? `, RVR ${pm.rvr}` : ''}; ${pm.chart})`
      : `${Math.round(G.mins)} ft (no plate minimums for this approach: ${precision ? 200 : 400} ft above touchdown)`;
    if (il) log('SYS', `${il.id.replace(/^I/, 'I-')} ${il.freq.toFixed(2)}, course ${magOf(arr, il.crsT)}°, ${o.app[0] === 'I' ? `glideslope ${il.gs.toFixed(1)}°` : 'localizer only: no glideslope (GP flies the FMS path)'}. Minimums: ${minTxt}.${PL.meta && PL.meta.icao === arr.id ? ' Press ~ for the plates.' : ''}`);
    else log('SYS', `Minimums: ${minTxt}.`);
  }
  if (r.onGround) log('SYS', `AFM takeoff speeds, flaps 8, ${Math.round(lb).toLocaleString()} lb: V1 ${Math.round(V.v1)}, VR ${Math.round(V.vr)}, V2 ${Math.round(V.v2)} KIAS (bugs on the speed tape).`);
  else if (o.start === 'final') log('SYS', `VREF flaps 40: ${Math.round(G.vsp.ref)} KIAS${lb > MAX_LANDING_LB ? ` (above the ${MAX_LANDING_LB.toLocaleString()} lb maximum landing weight)` : ''}.`);
  if (o.fail && o.fail !== 'none') log('SYS', `Failure armed: ${FAILURES[o.fail].name}.`);
}
function log(who, txt) { G.log.push({ t: G.t, who, txt }); }

// Free flight per physics step: failures, autospoilers, callouts, liftoff and stopping reports
function freeTick(h, out) {
  const { ac } = G, V = G.vsp, co = G.co, kias = out.KIAS, ft = (out.agl - 1.6) / FT;
  G.airT = ac.wow ? 0 : G.airT + h;
  if (G.onGround && G.airT > 1 && out.agl > 3) { G.onGround = false; G.td = null; G.stopLogged = false; log('SYS', `LIFTOFF ${Math.round(kias)} KIAS`); }
  // engine failure (free-flight option): at V1 on the takeoff roll, or at a random height after takeoff
  if (!ac.engFail && G.free.fail === 'v1' && ac.wow && ac.ctl.thr > 0.8 && kias >= V.v1) failEngine();
  if (!ac.engFail && G.failAt !== null && !ac.wow && ft > G.failAt && out.vs > 0) failEngine();
  // autospoilers (armed): deploy on the ground with the levers at idle above 60 kt (landing or rejected takeoff); stow when thrust comes up
  if (G.autoSb && ac.wow && ac.ctl.thr < 0.05 && out.gs > 60 * KT && !ac.ctl.sb) { ac.ctl.sb = 1; log('SYS', 'SPOILERS — auto deployed'); }
  if (G.autoSb && ac.wow && ac.ctl.thr > 0.5 && ac.ctl.sb) ac.ctl.sb = 0;
  // takeoff callouts, then radio altitude on the way down with the gear down
  if (ac.wow && ac.ctl.thr > 0.8) {
    if (kias >= V.v1 && !co.v1) { co.v1 = 1; AU.say('V one', 0); }
    if (kias >= V.vr && !co.vr) { co.vr = 1; AU.say('Rotate', 0); }
  }
  if (!ac.wow && co.vr && kias >= V.v2 && !co.v2) { co.v2 = 1; AU.say('V two', 0); }
  if (ft > 700) co.ra = {};
  if (!ac.wow && ac.ctl.gear && out.vs < -0.5) { co.ra = co.ra || {}; for (const a of [500, 100, 50, 40, 30, 20, 10]) if (ft <= a && ft > a - 25 && !co.ra[a]) { co.ra[a] = 1; AU.say(a === 500 ? 'Five hundred' : a === 100 ? 'One hundred' : String(a), 0); } }
  if (ac.wow && out.gs < 0.5 && ac.ctl.thr < 0.1) co.v1 = co.vr = co.v2 = 0;
  // flight plan: the missed approach and holds as the FMS sequences them
  const F = G.fms, ap = G.ap;
  if (F) {
    for (const ev of F.events.splice(0)) {
      if (ev.type === 'hold') log('SYS', `${ev.leg.fix.id}: ${ev.entry} entry — ${legText(G.apt, ev.leg)}`);
      else if (ev.type === 'atc') { log('ATC', `Lear 60, ${ev.txt}.`); if (SETTINGS.comms) AU.say(ev.txt, 0); }
      else if (ev.type === 'leg' && G.legI >= 0) { const m = F.mapIndex(); if (m >= 0 && ev.i === m + 1) log('SYS', `MISSED APPROACH: ${F.missedLegs().map((l) => legText(G.apt, l)).join(', then ')}`); }
    }
    G.legI = F.i;
  }
  // minimums (radio callouts on the barometric bug), on an approach with the gear down
  const hft = out.h / FT;
  if (ac.ctl.gear && out.vs < 0 && !ac.wow && G.mins) {
    if (hft <= G.mins + 100 && !co.amin) { co.amin = 1; AU.say('Approaching minimums', 0); }
    if (hft <= G.mins && !co.min) { co.min = 1; AU.say('Minimums', 0); log('SYS', `MINIMUMS ${Math.round(G.mins)} ft: runway in sight to continue, otherwise go around (?)`); }
  }
  if (hft > (G.mins || 0) + 400) { co.amin = 0; co.min = 0; }
  // marker passage
  const mk = ap.ils ? ap.ils.marker : null;
  if (mk && mk !== G.lastMk) log('SYS', mk === 'OM' ? 'OUTER MARKER' : mk === 'MM' ? 'MIDDLE MARKER' : 'INNER MARKER');
  G.lastMk = mk;
  // flight guidance mode changes (positive capture annunciation, AC 25.1329-1C 65c(2)); loss of approach mode alerts
  const mode = ap.on || ap.fd ? `${ap.lat}/${ap.vert}` : 'off', was = G.apMode || '';
  if (was && mode !== was && (ap.on || ap.fd)) {
    const [la, va] = mode.split('/'), [lw, vw] = was.split('/');
    if (la !== lw && /LOC|LNAV/.test(la)) log('SYS', `${la === 'LOC' ? 'LOCALIZER' : 'LNAV'} captured`);
    if (va !== vw && /GS|GP|VNAV|ALT$/.test(va)) log('SYS', va === 'GS' ? 'GLIDESLOPE captured' : va === 'GP' ? 'GLIDEPATH captured' : va === 'VNAV' ? 'VNAV path' : `ALTITUDE ${Math.round(ap.altTgt / FT).toLocaleString()} captured`);
    // the pilot monitoring sets the missed-approach altitude once established on final (AC 25.1329-1C 67a)
    if ((va === 'GS' || va === 'GP') && F) { const ma = F.missedAlt(); if (ma && ma * FT > ap.altTgt + 30) { ap.altTgt = ma * FT; log('PM', `Missed-approach altitude ${ma.toLocaleString()} set`); } }
  }
  if (ap.lost) { log('SYS', `${ap.lost === 'LOC' ? 'APPROACH MODE LOST — localizer' : ap.lost + ' LOST'}: holding heading and altitude`); AU.apDisconnect(); ap.lost = null; }
  G.apMode = mode;
  // stopped after a landing: distance from touchdown and runway left
  if (G.td && !G.stopLogged && ac.wow && out.gs < 1) {
    G.stopLogged = true; const rw = runwayAt(ac.pos[0], ac.pos[1], out.track) || {};
    const lda = ldaFt(G.td.apt, G.td.id), sFt = rw.s !== undefined ? rw.s / FT : null;
    const ldaTxt = lda && sFt !== null ? (sFt <= lda ? `, ${Math.round(lda - sFt).toLocaleString()} ft of the ${lda.toLocaleString()} ft landing distance available left` : `, ${Math.round(sFt - lda).toLocaleString()} ft BEYOND the ${lda.toLocaleString()} ft landing distance available`) : '';
    log('SYS', `STOPPED ${Math.round((((rw.s ?? G.td.s) - G.td.s)) / FT).toLocaleString()} ft after touchdown${rw.left !== undefined ? `, ${Math.round(rw.left / FT).toLocaleString()} ft of runway ${G.td.id} pavement left` : ''}${ldaTxt}.`);
    if (lda && sFt !== null && sFt > lda) AU.say('Overrun', 0);
  }
}
// landing distance available, ft: landing threshold to the far end of the pavement (CIFP runway data)
function ldaFt(apt, id) { try { const f = frameFor(apt, id); return Math.round((f.L - f.disp) / FT); } catch { return null; } }
// what the PFD's course pointer and deviation show: the localizer when it is the approach being flown (or no plan is
// active), otherwise the flight plan's active leg (deviation 0.5 nm a dot, 0.15 nm on the final approach)
function navSource(ac, ap, F) {
  const il = ap.ils, g = ap.fmsG, leg = F && F.active;
  if (il && il.locValid && (ap.lat === 'LOC' || ap.latArm === 'LOC' || !leg)) return { src: 'LOC1', col: '#3dff5a', crs: il.course * RAD, dev: il.loc, dist: il.dme, wpt: il.ident || null, brg: null };
  if (!leg || !g) return null;
  const pos = [ac.pos[0], ac.pos[1]], fx = leg.fix ? leg.fix.ne : null, brg = fx ? wrap360(Math.atan2(fx[1] - pos[1], fx[0] - pos[0]) * RAD) : null;
  const crs = F.legCourse(leg, F.from) ?? g.trk ?? g.hdg ?? null, scale = F.i > F.fafIndex() && F.fafIndex() >= 0 && F.i <= F.mapIndex() ? 0.15 : 0.5;
  return { src: 'FMS1', col: '#ff4fd8', crs, dev: g.xtk != null ? -g.xtk / 1852 / scale : null, dist: fx ? Math.hypot(fx[0] - pos[0], fx[1] - pos[1]) / 1852 : null, wpt: leg.fix ? leg.fix.id : leg.pt, brg };
}
function failEngine() {
  const side = Math.random() < 0.5 ? 'L' : 'R'; G.ac.engFail = side;
  log('SYS', `ENGINE FAILURE — ${side === 'L' ? 'LEFT' : 'RIGHT'} engine. APR armed: the live engine goes to APR thrust. Rudder against the yaw.`); AU.say('Engine failure', 0);
}
function stepSim(h, held) {
  const { ac, env, ap } = G; const t = G.t;
  const wind = env.wind(ac.pos, t, h);
  const wasOn = G.apWas ?? ap.on;   // as of the last step: X, manual trim or TOGA disconnect between steps
  // Pilot forces on unboosted controls (js/controls.js): input = force; the autopilot's clutched servos can be
  // overpowered but it stays engaged, and keeps trimming, until disconnected (X / yoke button, or manual trim)
  const pc = G.pc, st = ac.out || {};
  const surf = pc.step(h, IN.axes, { qbar: st.qbar, M: st.M, tailStalled: ac.tailStalled, iceTail: ac.iceTail, n1: ac.n1 },
    ap.on ? { on: true, elev: ap.cmdElev ?? ac.ctl.elev, ail: ap.cmdAil ?? ac.ctl.ail } : null);
  if (ap.on && pc.slipping && !G.slipLogged) { G.slipLogged = true; log('SYS', 'AP SERVO SLIPPING — the autopilot is still engaged and trimming against you. Disconnect: X.'); }
  ac.ctl.elev = surf.elev; ac.ctl.ail = surf.ail; ac.ctl.rud = surf.rud;   // the autopilot has no rudder channel (the yaw damper is separate)
  G.trimRunaway = env.hyp.trimRunaway && t > UPSET_T && t < UPSET_T + 12 && ac.sys.trimMode === 'PRI';
  if (G.trimRunaway) ac.ctl.trim = Math.max(STAB.min, ac.ctl.trim - 0.3 * h);   // runs to the nose-down stop
  const out = ac.step(h, { wind, dT: env.dT });   // the accident day from the KMFL sounding (js/scenario.js Environment); free flight per weather
  const ir = env.iceRates(env.L, ac);
  ac.ice = clamp(ac.ice + ir.wing * h, 0, 1); ac.iceTail = clamp(ac.iceTail + ir.tail * h, 0, 1); ac.engIce = clamp(ac.engIce + ir.eng * h, 0, 1);
  if (G.mode === 'accident') ap.hdgTgt = t < 25 ? 58 : Math.min(100, 58 + (t - 25) * (42 / 45));
  else if (ap.on && ac.wow) ap.disconnect('ON GROUND');
  ap.step(ac, h, out);
  if (ap.on) { ac.ctl.elev = surf.elev; ac.ctl.ail = surf.ail; }   // AP wrote its servo command; the surfaces are where the forces put them
  if (ac.tailStalled && ap.on) ap.disconnect('PITCH');
  env.scriptedUpset(ac, ap, t);
  if (ac.tailStalled && ap.on) ap.disconnect('PITCH');
  if (ap.on && env.hyp.trimRunaway && ac.ctl.trim < -0.5) ap.disconnect('TRIM');
  if (wasOn && !ap.on) { G.apOffAt = t; G.apOffWall = performance.now() / 1000; AU.apDisconnect(); log('SYS', `AUTOPILOT DISCONNECT — ${ap.why}. YOUR AIRPLANE.`); }
  G.apWas = ap.on;
  G.t += h;
  while (G.mode === 'accident' && G.logIdx < TIMELINE.length && TIMELINE[G.logIdx].t <= G.t) { const e = TIMELINE[G.logIdx++]; G.log.push({ t: e.t, who: e.who, txt: e.txt }); if (SETTINGS.comms && !ATC.on && (e.who === 'FO' || e.who === 'MIA')) AU.say(e.txt, 0); }
  if (G.t - G.lastHist >= 0.25) { G.lastHist = G.t; G.hist.push({ t: G.t, h: out.h, M: out.M, nz: out.nz, KIAS: out.KIAS }); }
  // Flight data recorder: 4 Hz, persisted to localStorage every 5 s and on end (key n722bd_fdr)
  if (G.t - G.lastFdr >= 0.25) {
    G.lastFdr = G.t; const c = ac.ctl;
    G.fdr.push([G.t, out.h / FT, out.KIAS, out.M, out.vs / FT * 60, out.theta * RAD, out.phi * RAD, out.alpha * RAD, out.nz, c.elev, c.ail, c.rud, c.thr, c.sb, c.trim, ac.ice, ac.tailStalled ? 1 : 0, out.stalled ? 1 : 0, ac.damage, ap.on ? 1 : 0, ac.pos[0], ac.pos[1], out.psi * RAD, ac.n1].map(v => +(+v).toFixed(3)));
    if (G.t - G.lastSave > 5) { G.lastSave = G.t; saveFdr(); }
  }
  if (G.t - G.lastTrail >= 0.5) { G.lastTrail = G.t; G.trail.push(...nedToWorld(ac.pos)); (G.trailNE = G.trailNE || []).push([ac.pos[0], ac.pos[1]]); }
  if (ac.broken && !G.bangDone) { G.bangDone = true; AU.bang(); log('SYS', ac.brokenWhat === 'stab' ? 'HORIZONTAL STABILIZER SEPARATED — PITCH CONTROL LOST' : 'WING STRUCTURAL FAILURE'); G.endMsg = ac.brokenWhat === 'stab' ? 'STRUCTURAL FAILURE — HORIZONTAL STABILIZER SEPARATED' : 'STRUCTURAL FAILURE — WING'; }
  // ground contact (js/ground.js): touchdowns, hard landings, strikes
  for (const e of ac.gnd.drain()) {
    if (e.type === 'msg') log('SYS', e.txt);
    else if (e.type === 'touch' && e.leg !== 'nose' && !G.onGround) {
      G.onGround = true;
      if (G.mode === 'free') {
        const rw = runwayAt(ac.pos[0], ac.pos[1], out.track); G.td = rw ? { s: rw.s, id: rw.id, apt: rw.apt } : null;
        log('SYS', `TOUCHDOWN ${Math.round(Math.max(0, e.fps) * 60)} ft/min, ${Math.round(out.KIAS)} KIAS${rw ? `, ${Math.round(rw.s / FT).toLocaleString()} ft past the ${rw.id} threshold, ${Math.abs(rw.c / FT).toFixed(0)} ft ${rw.c >= 0 ? 'right' : 'left'} of the centreline${ldaFt(rw.apt, rw.id) ? `, ${Math.round(ldaFt(rw.apt, rw.id) - rw.s / FT).toLocaleString()} ft of landing distance available left${ldaFt(rw.apt, rw.id) - rw.s / FT < 3000 ? ' — LONG' : ''}` : ''}` : ', off the runway'}`);
      }
    }
  }
  if (G.mode === 'free') freeTick(h, out);
  if (ac.crashed && G.phase === 'run') { G.phase = 'end'; G.endMsg = G.mode === 'free' ? ac.crashWhy || 'IMPACT' : `IMPACT ${clockStr(G.t)} EST`; AU.bang(); debrief(); }
  // pass / fail (RecoveryJudge, scenario.js): a real upset during the event first, then 10 s of stable flight
  const ev = G.phase === 'run' && G.mode === 'accident' ? G.judge.update(G.t, h, out, ac) : null;
  if (ev === 'upset') log('SYS', `UPSET — ${G.judge.why}, ${Math.round(out.h / FT)} ft`);
  else if (ev === 'recovered') {
    G.recovered = G.t; G.recoveredAlt = out.h;
    log('SYS', `RECOVERED at ${Math.round(out.h / FT)} ft, ${(G.t - UPSET_T).toFixed(0)} s after the actual upset time (lost ${Math.round((G.judge.upsetAlt - G.judge.minAlt) / FT)} ft).`);
    AU.say('Recovered'); setTimeout(debrief, 1500);
  } else if (ev === 'avoided') { G.avoided = G.t; log('SYS', 'UPSET AVOIDED — stable through the event, no loss of control.'); AU.say('Upset avoided'); setTimeout(debrief, 1500); }
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
    // glareshield flight-guidance caps (js/vcgauges.js): the same actions as their keys
    case 'fgc_nav': IN.events.push('lnav'); break;
    case 'fgc_apr': IN.events.push('appr'); break;
    case 'fgc_fd': IN.events.push('fd'); break;
    case 'fgc_hdg': if (ap.on || ap.fd) { ap.lat = 'HDG'; ap.latArm = null; ap.setHdg(wrap360(ac.out.psi * RAD)); log('SYS', `HDG ${String(Math.round(ap.hdgTgt)).padStart(3, '0')}°`); } else log('SYS', 'HDG: engage the autopilot (X) or flight director (|) first'); break;
    case 'fgc_alt': if (ap.on || ap.fd) { ap.vert = 'ALT'; ap.vertArm = null; ap.altTgt = ac.out.h; log('SYS', `ALT hold ${Math.round(ac.out.h / FT).toLocaleString()} ft`); } else log('SYS', 'ALT: engage the autopilot (X) or flight director (|) first'); break;
    case 'fgc_vs': if (ap.on || ap.fd) { ap.vert = 'VS'; ap.vertArm = null; ap.vsTgt = clamp(Math.round(ac.out.vs / 0.508) * 0.508, -20, 20); log('SYS', `VS ${Math.round(ap.vsTgt * 196.85)} ft/min, to the preselected altitude`); } else log('SYS', 'VS: engage the autopilot (X) or flight director (|) first'); break;
    case 'fgc_ias': case 'fgc_mach': log('SYS', `${id === 'fgc_ias' ? 'IAS' : 'MACH'}: speed modes come with VNAV's climb (no autothrottle); press ) for VNAV`); break;
    case 'machTrim': if (!sys.machTrimFail) { sys.machTrim = !sys.machTrim; log('SYS', `MACH TRIM ${sys.machTrim ? 'ON' : 'OFF'}`); } else log('SYS', 'MACH TRIM — FAIL (inop this scenario)'); break;
    case 'trimMode': sys.trimMode = sys.trimMode === 'PRI' ? 'SEC' : sys.trimMode === 'SEC' ? 'OFF' : 'PRI'; log('SYS', `PITCH TRIM selector — ${sys.trimMode}`); break;
    case 'ap': if (ap.on) ap.disconnect('PILOT'); else if (ac.wow) log('SYS', 'AP will not engage on the ground'); else if (ap.engage(ac.out)) log('SYS', 'AUTOPILOT ENGAGED — ALT/HDG hold'); else log('SYS', 'AP will not engage: attitude out of limits'); break;
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
  // 1-2 follow the order of AFM FM-123 Overspeed Recovery (Change 37), in our own words
  { key: '1', title: 'UPSET RECOVERY — NOSE LOW / HIGH SPEED', steps: [
    ['Thrust levers — IDLE (0)', () => G.ac.ctl.thr < 0.05],
    ['Autopilot — DISCONNECT (X)', () => !G.ap.on],
    ['Identify pitch AND roll attitude (roll is hard to read nose-low)', () => !G.ap.on && G.ac.ctl.thr < 0.05],
    ['Wings — LEVEL before any pull (pulling banked tightens the spiral)', () => Math.abs(G.ac.out.phi) < 15 * DEG],
    ['Elevator + pitch trim NOSE UP (.) to raise the nose; expect > 75 lb', () => Math.abs(G.ac.out.phi) < 15 * DEG && G.ac.ctl.trim > 0.1 && G.ac.out.vs > -15],
    ['Extreme speed / attitude — LANDING GEAR DOWN (G)', () => G.ac.ctl.gear > 0 || (!G.ac.out.overspeed && G.ac.out.vs > -15)],
    ['Spoilers — STAY IN (nose-down moment above Vmo/Mmo)', () => G.ac.ctl.sb === 0] ] },
  { key: '2', title: 'OVERSPEED — Vmo / Mmo EXCEEDED', steps: [
    ['Thrust levers — IDLE', () => G.ac.ctl.thr < 0.05],
    ['Autopilot — DISCONNECT', () => !G.ap.on],
    ['Wings level, then pitch — INCREASE gently; limit g to keep roll control', () => Math.abs(G.ac.out.phi) < 15 * DEG && G.ac.out.vs > -10],
    ['Spoilers — DO NOT EXTEND above Vmo / Mmo', () => G.ac.ctl.sb === 0],
    ['Severe: LANDING GEAR DOWN (tested to M.85 / 320 KIAS)', () => G.ac.ctl.gear > 0 || !G.ac.out.overspeed],
    ['Airspeed — below Vmo / Mmo', () => !G.ac.out.overspeed] ] },
  { key: '3', title: 'TAILPLANE STALL — ICE CONTAMINATED', steps: [
    ['Control wheel — PULL, full nose-up as required', () => IN.axes.elev > 0.8 || !G.ac.tailStalled],
    ['STAB HEAT — ON (verify)', () => G.ac.sys.stabHeat],
    ['Flaps — UP / do not extend', () => G.ac.ctl.flaps === 0],
    ['Thrust — REDUCE', () => G.ac.ctl.thr < 0.4],
    ['Pitch trim — NOSE UP (.)', () => G.ac.ctl.trim > 0.1],
    ['Tail re-attached: airspeed REDUCE, wings level', () => !G.ac.tailStalled && Math.abs(G.ac.out.phi) < 15 * DEG] ] },
  { key: '4', title: 'RUNAWAY PITCH TRIM', steps: [
    ['Control wheel — HOLD against the trim (> 75 lb)', () => G.pc.pitchLb > 40 || !G.trimRunaway],
    ['Autopilot / trim — DISCONNECT (X)', () => !G.ap.on],
    ['PITCH TRIM selector — OFF (7)', () => G.ac.sys.trimMode !== 'PRI'],
    ['Re-trim on SECONDARY (7 → SEC, then , .)', () => G.ac.sys.trimMode === 'SEC' && G.ac.ctl.trim > -0.2],
    ['Airspeed — reduce; configure early, expect high control forces', () => G.ac.out.KIAS < 250] ] },
  { key: '5', title: 'EMERGENCY DESCENT', steps: [
    ['Thrust levers — IDLE', () => G.ac.ctl.thr < 0.05],
    ['Spoilers — EXTEND', () => G.ac.ctl.sb > 0],
    ['Spoilers only below Vmo / Mmo; landing gear — DOWN below 260 KIAS (G)', () => G.ac.ctl.gear > 0 && G.ac.out.KIAS < 265],
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
    const g = ghostAt(ghost, t); const h = -g.d; const atm = isa(Math.max(0, h), ACCIDENT_DT);
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
  const atm = isa(Math.max(0, h), ACCIDENT_DT); const V = L('kias') * KT / Math.sqrt(atm.rho / RHO0);
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
  const title = G.recon ? 'RECONSTRUCTION — IMPACT 12:49:32 (reported)' : ac.crashed ? (ac.broken ? 'AIRFRAME FAILURE, THEN IMPACT' : 'IMPACT') : G.recovered !== null ? 'RECOVERED' : G.avoided !== null ? 'UPSET AVOIDED' : 'DEBRIEF';
  const fmt = (v, u = '') => `${v}${u}`;
  if (G.mode === 'free') {
    const why = ac.crashWhy || (ac.broken ? 'STRUCTURAL FAILURE' : 'FLIGHT ENDED');
    d.querySelector('h2').textContent = why; d.querySelector('h2').style.color = '#ff3b3b';
    d.querySelector('table').innerHTML = `<tr><th></th><th>This flight</th><th>Limit</th></tr>
      <tr><td>Last touchdown</td><td>${ac.gnd.touchFpm !== null ? Math.round(ac.gnd.touchFpm) + ' ft/min' : '—'}</td><td>600 ft/min (Part 25 limit, 10 ft/s); collapse near 960</td></tr>
      <tr><td>Peak load factor</td><td>${ac.maxG.toFixed(2)} g / ${ac.minG.toFixed(2)} g</td><td>+3.0 / −1.0 g flaps up, +2.0 g flaps down</td></tr>
      <tr><td>Peak speed</td><td>${Math.round(ac.maxKEAS)} KEAS, M ${ac.maxM.toFixed(2)}</td><td>Vmo 300 / 340 KIAS, Mmo 0.81</td></tr>
      <tr><td>Airframe stress</td><td>${Math.round(ac.damage * 100)}%${ac.gnd.gearDamage > 0 ? `, gear damage ${Math.round(Math.min(1, ac.gnd.gearDamage) * 100)}%` : ''}</td><td>—</td></tr>`;
    d.querySelector('p.tip').textContent = /GEAR-UP/.test(why) ? 'Gear down (G) before 200 KIAS on the approach; the gear horn is not modelled yet.'
      : /COLLAPSE|HARD/.test(why) ? 'Flare from about 30 ft: ease the nose up, thrust to idle, let the descent rate come back to 100-300 ft/min before the mains touch.'
      : /IMPACT/.test(why) ? 'Keep the descent rate under control close to the ground, and the wings level: the wingtips touch at about 14° of bank on the runway.'
      : 'Fly it again, or change the start and weather on the briefing screen.';
    return;
  }
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
  d.querySelector('h2').style.color = (G.recovered !== null || G.avoided !== null) && !ac.crashed ? '#6cff6c' : '#ff3b3b';
  d.querySelector('table').innerHTML = `<tr><th></th><th>You</th><th>Actual N722BD (reported)</th></tr>
    <tr><td>Lowest altitude</td><td>${G.hist.length ? fmt(Math.round(Math.max(0, Math.min(...G.hist.map(p => p.h))) / FT), ' ft') : '—'}</td><td>impact, 12:49:32</td></tr>
    <tr><td>Peak Mach</td><td>${ac.maxM.toFixed(3)}</td><td>≈0.9 (est. from ADS-B; Mmo 0.81)</td></tr>
    <tr><td>Peak descent</td><td>${Math.abs(Math.round(ac.maxVS / FT * 60)).toLocaleString()} ft/min</td><td>&gt;32,640 ft/min (encoder limit)</td></tr>
    <tr><td>Peak load factor</td><td>${ac.maxG.toFixed(2)} g / ${ac.minG.toFixed(2)} g</td><td>unknown; in-flight breakup indicated</td></tr>
    <tr><td>Peak EAS</td><td>${Math.round(ac.maxKEAS)} KEAS</td><td>575–600 KTAS est. (~470 KEAS at 15,000 ft)</td></tr>
    <tr><td>Airframe stress</td><td>${Math.round(ac.damage * 100)}%${ac.broken ? ' — ' + (ac.brokenWhat === 'stab' ? 'horizontal stabilizer separated' : 'wing failure') : ''}</td><td>video suggests missing horizontal stabilizer before impact (unconfirmed)</td></tr>
    <tr><td>Upset</td><td>${G.judge.upsetAt !== null ? `${G.judge.why}, ${clockStr(G.judge.upsetAt)}` : 'none'}</td><td>12:48:06 balloon, 12:48:16 descent</td></tr>
    <tr><td>Recovery</td><td>${G.recovered !== null ? `${Math.round(G.recoveredAlt / FT)} ft, ${(G.recovered - UPSET_T).toFixed(0)} s after 12:48:16` : G.avoided !== null ? 'not needed: upset avoided' : 'none'}</td><td>none; 76 s from FL350 to ground</td></tr>`;
  let tip = '';
  if (ac.broken && ac.minG < -1.5 && ac.maxM <= 0.9) tip = 'The wing failed in negative g. When the tail stalled, the nose went over hard enough to load the wing to about -2 g, past the -1.5 g ultimate. At Mach .8 the wing still has the lift to do that. Catch the pitch-down in the first seconds: firm back pressure, idle, wings level, nose-up trim.';
  else if (ac.broken) tip = ac.maxM > 0.9 ?'Past the design dive speed the allowable loads shrink, and the negative g from a tucking or stalled tail did the damage. Overspeed alone is survivable: idle, wings level, nose-up trim to take the column force, gear down if extreme, then pull smoothly. Spoilers stay in: above Vmo/Mmo they pitch the nose down.' : 'Pulled too hard. Limit load is about +3 g; a Learjet at high EAS breaks at roughly 1.5× that. Roll level first, then pull progressively, watching the G readout.';
  else if (ac.crashed) tip = Math.abs(o.phi) > 30 * DEG ? 'The spiral never got unwound: with bank on, pulling only tightens the turn and raises G. Wings level FIRST, then pull.' : 'Not enough nose-up authority in time. With unboosted controls the column force at this speed is more than a pilot can hold for long: idle, wings level, nose-up trim to take the load off, gear down, and start sooner. The recovery window closes within seconds.';
  else tip = 'Textbook (AFM): idle, autopilot off, read the attitude, level the wings, then elevator and nose-up trim; gear down if extreme; no spoilers. The actual crew faced this in a convective core, in severe turbulence, in the dark of the cloud, with ice on the tail, at Mach .8 — and with 20 seconds between "request climb" and Mayday.';
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
    else if (e === 'nexrad') { SETTINGS.nexrad = !SETTINGS.nexrad; G.env.useNex = SETTINGS.nexrad; if (G.mode !== 'free') G.env.glm = SETTINGS.nexrad ? GLM : null; log('SYS', `NEXRAD volume ${SETTINGS.nexrad ? 'ON (KAMX 17:45:48Z→17:51:04Z)' : 'OFF (synthetic cell)'}`); }
    else if (e === 'wxr') SETTINGS.wxr = !SETTINGS.wxr;
    else if (e === 'wxr_range') { SETTINGS.wxrRange = SETTINGS.wxrRange === 40 ? 80 : SETTINGS.wxrRange === 80 ? 20 : 40; }
    else if (e === 'sb' || e === 'gear' || e === 'flaps') toggleSwitch(e);
    else if (e === 'cam') { G.camMode = (G.camMode + 1) % (G.phase === 'replay' ? 4 : 2); G.ext = G.camMode > 0; }
    else if (e === 'hud') G.hideHud = !G.hideHud;
    else if (e === 'pause') G.paused = !G.paused;
    else if (e === 'restart') { if (G.mode === 'free') newFreeFlight(G.free); else newGame(G.hypKey, G.hard); }
    else if (e === 'park') { if (ac.ctl.park) { ac.ctl.park = false; log('SYS', 'PARKING BRAKE released'); } else if (ac.out.gs < 1) { ac.ctl.park = true; log('SYS', 'PARKING BRAKE set'); } else log('SYS', 'Parking brake: stop first'); }
    else if (e === 'skip' && G.phase === 'replay') { if (G.t < 70) G.t = 70; else if (G.t < 118) G.t = 118; }
    else if (e === 'skip' && G.t < 50 && G.mode === 'accident') { while (G.t < 50) stepSim(1 / 120, false); }
    else if (e === 'quality') { R.quality = R.quality >= 1.4 ? 0.6 : +(R.quality + 0.4).toFixed(1); R.scale = R.quality >= 1.4 ? 0.75 : R.quality >= 1 ? 0.5 : 0.4; }
    else if (e === 'slower') G.timeScale = Math.max(0.25, G.timeScale / 2);
    else if (e === 'faster') G.timeScale = Math.min(1, G.timeScale * 2);
    else if (e === 'antiice') toggleSwitch('wingHeat');
    else if (e === 'yd') toggleSwitch('yd');
    else if (e === 'help') G.help = !G.help;
    else if (e === 'ghost') G.showGhost = !G.showGhost;
    else if (e === 'idle') { ac.ctl.thr = 0; ac.ctl.rev = 0; }
    else if (e === 'mute') AU.muted = !AU.muted;
    else if (e === 'controls') HP.toggle();
    else if (e === 'hdg_up' || e === 'hdg_dn') { ap.bumpHdg(e === 'hdg_up' ? 5 : -5, ac.out.psi * RAD); log('SYS', `HDG bug ${String(Math.round(ap.hdgTgt)).padStart(3, '0')}°${ap.on ? '' : ' (AP off)'}`); }
    else if (e === 'alt_up' || e === 'alt_dn') { const a = Math.max(1000, Math.round(ap.altTgt / FT / 500) * 500 + (e === 'alt_up' ? 500 : -500)); ap.setAlt(a * FT, ac.out); log('SYS', `ALT preselect ${a.toLocaleString()} ft${ap.on ? (ap.vert === 'VS' ? ` — ${ap.vsTgt > 0 ? 'climbing' : 'descending'} ${Math.round(Math.abs(ap.vsTgt) * 196.85)} ft/min` : '') : ' (AP off)'}`); }
    else if (e === 'plates') togglePlates();
    else if (e === 'fd') { ap.fd = !ap.fd; if (ap.fd && !ap.on) { if (ac.wow) ap.takeoff(ac.out.psi * RAD, Math.max(ap.altTgt, ac.out.h + 1000 * FT)); else { ap.lat = 'HDG'; ap.vert = 'ALT'; ap.hdgTgt = wrap360(ac.out.psi * RAD); ap.altTgt = ac.out.h; ap.thRef = null; } } log('SYS', `FLIGHT DIRECTOR ${ap.fd ? 'ON' : 'OFF'}`); }
    else if (e === 'toga') {
      if (G.mode !== 'free') log('SYS', 'GO AROUND: free flight only');
      else if (ac.wow) { ap.takeoff(ac.out.psi * RAD, Math.max(ap.altTgt, 3000 * FT)); log('SYS', `FD TAKEOFF mode: +9° on the runway heading${ap.latArm ? ', LNAV armed (400 ft)' : ''}`); }
      else { ap.goAround(ac.out); const miss = G.fms ? G.fms.missedLegs() : []; log('SYS', `GO AROUND — T/O thrust, pitch to the FD (10°), flaps 20, positive rate gear up. ${miss.length ? `LNAV armed (400 ft): ${miss.map((l) => legText(G.apt, l)).join(', then ')}` : 'No missed approach loaded: runway heading.'}${ap.altTgt > ac.out.h ? ` Climbing to ${Math.round(ap.altTgt / FT).toLocaleString()} ft.` : ' Set a missed-approach altitude above you (> / <).'}`); }
    }
    else if (e === 'appr') {
      if (!ap.on && !ap.fd) log('SYS', 'APR: engage the autopilot (X) or flight director (|) first');
      else if (!(G.fms && G.fms.fafIndex() >= 0) && !(ap.nav && ap.nav(ac.out))) log('SYS', 'APR: no approach loaded and no localizer in range');
      else { ap.appr = !ap.appr; if (!ap.appr) { ap.latArm = ap.vertArm = null; if (ap.lat === 'LOC') { ap.lat = 'HDG'; ap.hdgTgt = wrap360(ac.out.psi * RAD); } if (ap.vert === 'GS' || ap.vert === 'GP') { ap.vert = 'ALT'; ap.altTgt = ac.out.h; } } log('SYS', ap.appr ? `APR armed: ${ap.latArm || 'LOC'} then ${ap.vertArm || 'GS'}` : 'APR off'); }
    }
    else if (e === 'direct') dtoToggle();
    else if (e === 'lnav') { if (G.fms && ap.armLnav()) log('SYS', ap.lat === 'LNAV' ? 'LNAV' : 'LNAV armed: engages on the flight-plan path'); else log('SYS', 'LNAV: no flight plan'); }
    else if (e === 'vnav') { if (G.fms && ap.armVnav()) log('SYS', 'VNAV armed: flies the plan\'s altitude constraints within the preselected altitude'); else log('SYS', 'VNAV: no flight plan'); }
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
    if (IN.trimDelta && ap.on) { ap.disconnect('TRIM'); }   // AFM: manual pitch trim input disconnects the autopilot
    if (IN.thrSet !== null) { ac.ctl.thr = IN.thrSet; IN.thrSet = null; }   // a moved hardware lever sets the thrust levers
    ac.ctl.brakeL = IN.brakeL; ac.ctl.brakeR = IN.brakeR;                   // wheel brakes (js/ground.js); a press releases the parking brake
    if (ac.ctl.park && Math.max(IN.brakeL, IN.brakeR) > 0.5) { ac.ctl.park = false; log('SYS', 'PARKING BRAKE released'); }
    // thrust reversers on the ground: pulling the levers back past idle lifts them into reverse; forward stows first
    if (IN.revHold && ac.wow) { if (!ac.ctl.rev) log('SYS', 'THRUST REVERSERS deployed'); ac.ctl.thr = 0; ac.ctl.rev = 1; G.revBtn = true; }
    else if (G.revBtn) { G.revBtn = false; ac.ctl.rev = 0; log('SYS', 'THRUST REVERSERS stowed'); }
    else if (ac.wow && (ac.ctl.rev > 0 || (ac.ctl.thr <= 0 && IN.thrDelta < 0))) {
      const was = ac.ctl.rev; ac.ctl.rev = clamp(ac.ctl.rev - IN.thrDelta * 2, 0, 1); ac.ctl.thr = 0;
      if (!was && ac.ctl.rev > 0) log('SYS', 'THRUST REVERSERS deployed'); else if (was && !ac.ctl.rev) log('SYS', 'THRUST REVERSERS stowed');
    } else ac.ctl.thr = clamp(ac.ctl.thr + IN.thrDelta, 0, 1);    // no autothrottle: the levers are always the pilot's
    if (!ap.on) { const tr = ac.sys.trimMode === 'PRI' ? 1 : ac.sys.trimMode === 'SEC' ? 0.45 : 0; ac.ctl.trim = clamp(ac.ctl.trim + IN.trimDelta * tr, STAB.min, STAB.max); }
    const simDt = dt * G.timeScale; const sub = Math.max(1, Math.ceil(simDt / (1 / 240))); const h = simDt / sub;
    for (let i = 0; i < sub; i++) out = stepSim(h, held);
    G.time += simDt;
  } else if (G.phase === 'replay' && !G.paused) { IN.update(dt); out = replayStep(dt); }
  else if (G.phase === 'end') { IN.update(dt); }
  else if (G.paused && !HP.open && G.phase === 'run' && document.getElementById('brief').classList.contains('hidden')) IN.pollPaused();   // a controller's pause button can resume
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
  // debug: SIM.camOverride = {pos:[x,y,z] world m, yaw (deg from north), pitch (deg), fov (deg)} for free inspection shots
  const CO = window.SIM && window.SIM.camOverride;
  if (CO) { const y = CO.yaw * DEG, p = CO.pitch * DEG; const f = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
    const rr = [Math.cos(y), 0, -Math.sin(y)]; const uu = [f[1] * rr[2] - f[2] * rr[1], f[2] * rr[0] - f[0] * rr[2], f[0] * rr[1] - f[1] * rr[0]];
    cam = { pos: CO.pos, right: rr, up: uu, fwd: f }; G.ext = true; }
  // ---------- ghost ----------
  const gp = ghostAt(ghost, G.t); const gW = nedToWorld([gp.n, gp.e, gp.d]);
  const bank = (G.t < 70 ? 12 * smoothstep(25, 35, G.t) * (1 - smoothstep(65, 72, G.t)) : 20 + 45 * smoothstep(76, 120, G.t)) * DEG;
  const gf = [Math.sin(gp.hdg) * Math.cos(gp.gamma), Math.sin(gp.gamma), Math.cos(gp.hdg) * Math.cos(gp.gamma)];
  let gr = [Math.cos(gp.hdg), 0, -Math.sin(gp.hdg)]; let gu = [gf[1] * gr[2] - gf[2] * gr[1], gf[2] * gr[0] - gf[0] * gr[2], gf[0] * gr[1] - gf[1] * gr[0]];
  const gr2 = gr.map((v, i) => v * Math.cos(bank) - gu[i] * Math.sin(bank)), gu2 = gr.map((v, i) => v * Math.sin(bank) + gu[i] * Math.cos(bank));
  const stormT = STORM.top(G.t);
  SUN = scenarioSun(G.t).v;
  const S = {
    cam, dt, simT: G.t, ctl: ac.ctl, fov: CO && CO.fov ? CO.fov * DEG : G.camEff === 2 && G.replay ? G.groundFov : G.ext ? 60 * DEG : (CK ? clamp(64 * IN.zoom, 26, 78) : 70) * DEG, time: G.time, sun: SUN, ac: { pos: posW, fwd, right, up }, ext: G.ext, stabGone: ac.broken && ac.brokenWhat === 'stab',
    ghost: { pos: gW, fwd: gf, right: gr2, up: gu2 }, showGhost: G.showGhost && G.t < ghost[ghost.length - 1].t,
    storm: { pos: [STORM.e + STORM.drift[1] * G.t, stormT, STORM.n + STORM.drift[0] * G.t], r: STORM.rCore, base: STORM.base },
    flash: env.flash, flashPos: env.flashPos, cloudBase: WX.cuBase, cloudTop: WX.cuTop, cloudCover: WX.cuCover, deckBase: WX.deckBase, stormCB: WX.deckBase, windXZ: WX.drift, useNex: SETTINGS.nexrad, useGoes: SETTINGS.nexrad, nexMix: NEX ? clamp((G.t - NEX[0].t) / (NEX[1].t - NEX[0].t), 0, 1) : 0,
    lines: [{ data: ghostLine, color: [1, 0.25, 0.75, G.recon ? 0 : G.showGhost ? 0.9 : 0.25], strip: true }, { data: new Float32Array(G.trail), color: [0.4, 1, 0.4, 0.9], strip: true }],
  };
  // precipitation around the camera (NEXRAD reflectivity at the aircraft) and cloud-to-ground strokes for ~35% of GLM flashes
  S.precip = SETTINGS.nexrad ? smoothstep(12, 50, env.L.dbz || -30) : 0.4 * env.L.core;
  if (G.mode === 'free') {   // no storm, no radar volume, no satellite deck: the chosen weather's cumulus only
    Object.assign(S, { useNex: false, useGoes: false, cloudCover: env.wx.cu, deckBase: 1e7, stormCB: 1e7, precip: 0, showGhost: false, detailLayer: 'airport' });
    S.storm = { pos: S.storm.pos, r: S.storm.r, base: 1e7 }; S.lines[0].color[3] = 0;
  }
  S.precipFall = [WX.drift[0], posW[1] > 4780 ? -1.5 : -7, WX.drift[1]];   // snow/graupel above the freezing level (KMFL 4,780 m), rain below
  S.precipBright = 0.55 + 0.35 * clamp(posW[1] / 10000, 0, 1);
  S.camVel = CO || G.camEff === 2 ? [0, 0, 0] : [ac.vel[1], -ac.vel[2], ac.vel[0]];   // attached cameras move with the airplane
  if (env.flashId !== undefined && env.flashId !== G.lastFlashId) { G.lastFlashId = env.flashId; if (Math.random() < 0.35 && env.flashPos) R.strike(env.flashPos[0], env.flashPos[2], WX.deckBase + 400); else R.bolt = null; }
  R.render(S); G.lastFov = S.fov;
  const HS = { out, ac, ap, t: G.t, magvar: G.apt ? G.apt.magvar : (DB.loaded('KDJT') || { magvar: -6 }).magvar, log: G.log, inCloud: env.L.cloud, core: env.L.core, updraft: env.L.updraft, ext: G.ext, hist: G.hist, ghostProfile, ghostAlt, recovered: G.recovered, recoveredAlt: G.recoveredAlt, upsetT: UPSET_T,
    apOffAt: G.apOffAt, apOffWall: G.apOffWall, timeScale: G.timeScale, quality: R.quality, help: G.help, paused: G.paused, hypName: G.hypName, endMsg: G.endMsg, antiice: G.antiice, flash: env.flash, fps,
    wxr: wxrSource(env),
    efb: { mode: SETTINGS.efb, range: SETTINGS.wxrRange }, checklist: evalProcedures(), trimRunaway: G.trimRunaway,
    map: { n: ac.pos[0], e: ac.pos[1], hdg: out.psi || 0, coastX, ghost: ghostNE, trail: G.trailNE || [], nexImg: nexImgs ? nexImgs[(NEX && G.t > (NEX[0].t + NEX[1].t) / 2) ? 1 : 0] : null, nexN0: NEX ? NEX[0].f.z0 : 0, nexN1: NEX ? NEX[0].f.z0 + NEX[0].f.nz * NEX[0].f.d : 0, nexE0: NEX ? NEX[0].f.x0 : 0, nexE1: NEX ? NEX[0].f.x0 + NEX[0].f.nx * NEX[0].f.d : 0 },
    atcOn: ATC.on, atcShift: ATC.shift, hideHud: G.hideHud, replay: G.phase === 'replay', camMode: G.camEff, camAuto: G.camMode === 3, recon: !!G.recon, nexOn: SETTINGS.nexrad && !!NEX && G.mode !== 'free', freeFlight: G.mode === 'free', dbz: env.L.dbz,
    cockpit3d: !!CK && CK.ready && !G.ext,
    force: G.phase === 'run' ? { pitchLb: G.pc.pitchLb, rollLb: G.pc.rollLb, availP: G.pc.avail('pitch'), availR: G.pc.avail('roll'), stamina: G.pc.stamina, slipping: ap.on && G.pc.slipping } : null };
  if (G.mode === 'free') {
    const c = ac.ctl;
    const V = G.vsp, bugs = ac.wow || (out.agl < 300 && c.flaps <= 0.25 && !G.td) ? [{ v: V.v1, t: '1' }, { v: V.vr, t: 'R' }, { v: V.v2, t: '2' }] : c.flaps >= 0.5 || c.gear ? [{ v: V.ref, t: 'REF' }] : [];
    HS.free = { agl: out.agl, wow: ac.wow, gs: out.gs, park: c.park, brake: Math.max(c.brakeL, c.brakeR), flaps: c.flaps, gear: c.gear, touchFpm: ac.gnd.touchFpm, steer: ac.gnd.steer, wind: env.wx, gearDamage: ac.gnd.gearDamage, rev: c.rev, sb: c.sb, engFail: ac.engFail, bugs };
    const il = ap.ils; HS.ils = il && il.locValid ? il : null;
    HS.marker = HS.ils ? HS.ils.marker : null;
    if (G.fms && G.fms.legs.length) { const F = G.fms, m = F.mapIndex(); HS.map.route = { active: F.i, pts: F.legs.map((l, i) => ({ i, id: l.fix ? l.fix.id : null, ne: l.fix ? l.fix.ne : null, missed: m >= 0 && i > m })) }; }
    HS.mins = G.mins; HS.nav = navSource(ac, ap, G.fms); HS.vdev = ap.vnav && ap.vnav.path != null && /VNAV|GP/.test(ap.vert + (ap.vertArm || '')) ? (ap.vnav.path - out.h / FT) / 100 : null;
    HS.ghostProfile = null; HS.wxr = null; HS.nexOn = false; HS.map.nexImg = null; HS.map.ghost = []; HS.dbz = -30;   // clear air: nothing on the radar
  }
  if (HS.cockpit3d) {
    CK.update(HS);
    CK.render({ ctl: ac.ctl, sunWorld: SUN, acBasis: { right, up, fwd }, inCloud: env.L.cloud, core: env.L.core, flash: env.flash },
      G.head, G.shakeEye, S.fov, innerWidth / innerHeight);
  } else if (CK) CK.hide();
  H.draw(HS);
  atcSync();
  if (G.phase === 'run' && !G.paused) IN.haptics({ shaker: !!ac.shaker && !ac.broken, buffet: !!out.buffet, broken: ac.broken });
  // force feedback: the column's feel while flying, a light centring spring otherwise (paused, briefing, replay)
  FF.update(G.phase === 'run' && !G.paused ? G.pc.feel({ shaker: !!ac.shaker && !ac.broken, buffet: !!out.buffet, broken: ac.broken }) : null, dt);
  AU.update(dt, { marker: G.mode === 'free' && G.phase === 'run' && !G.paused ? HS.marker : null, qbar: out.qbar || 0, V: out.V || 0, n1: ac.n1, overspeed: !!out.overspeed, stall: !!out.stalled && out.alpha > 0, buffet: !!out.buffet, inCloud: env.L.cloud, ext: G.ext, broken: ac.broken, flash: env.flash, flashDist: env.flashDist ?? env.L.r });
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
// ---------- free-flight sortie planner (selections remembered in this browser) ----------
const $ = (id) => document.getElementById(id);
const SORTIE = $('sortie');
const PROC_KIND = { I: 'ILS', L: 'LOC', R: 'RNAV (GPS)', H: 'RNAV (RNP)', V: 'VOR', S: 'VOR', D: 'VOR/DME', N: 'NDB', Q: 'NDB/DME', B: 'LOC BC', X: 'LDA', U: 'SDF', P: 'GPS', J: 'GLS' };
// procedure ident -> chart-style name: I10L -> ILS RWY 10L, R10LY -> RNAV (GPS) Y RWY 10L, H14-Z -> RNAV (RNP) Z RWY 14
const procName = (id) => { const m = id.slice(1).match(/^(\d\d[LRC]?)-?([A-Z]?)$/); return m ? `${PROC_KIND[id[0]] || id[0]} ${m[2] ? m[2] + ' ' : ''}RWY ${m[1]}` : `${PROC_KIND[id[0]] || ''} ${id.slice(1)}`.trim(); };
const setOpts = (el, list, want) => { el.innerHTML = ''; for (const [v, t] of list) { const o = document.createElement('option'); o.value = v; o.textContent = t; el.appendChild(o); } el.value = list.some((x) => x[0] === want) ? want : list.length ? list[0][0] : ''; };
const SK = (() => { try { return JSON.parse(localStorage.getItem(FREE_KEY) || '{}'); } catch { return {}; } })();
setOpts($('sstart'), Object.entries(STARTS).map(([k, v]) => [k, v.name]), SK.start || 'rwy');
setOpts($('swx'), Object.entries(WEATHER).map(([k, v]) => [k, v.name]), SK.wx || 'calm');
setOpts($('swt'), Object.entries(WEIGHTS).map(([k, v]) => [k, v.name]), SK.weight || 'typical');
setOpts($('sfail'), Object.entries(FAILURES).map(([k, v]) => [k, v.name]), SK.fail || 'none');
function cruiseLabel(a) { return a >= 18000 ? `FL${a / 100}` : `${a.toLocaleString()} ft`; }
setOpts($('scruise'), [['', 'None (local flight)'], ...[3000, 5000, 7000, 9000, 11000, 13000, 15000, 17000, 19000, 21000, 23000, 25000, 27000, 29000, 31000, 33000, 35000, 37000, 39000, 41000]
  .map((a) => [String(a), cruiseLabel(a)])], SK.cruise ?? '');
// a cruise altitude from a route (FL240), a .pln or the saved settings: added to the list, in order, if it isn't one of
// the offered odd thousands (IFR eastbound levels); westbound even levels and others come in this way
function setCruise(v) {
  v = Math.round(+v / 100) * 100; if (!(v >= 1000 && v <= 45000)) return false;
  const sel = $('scruise');
  if (![...sel.options].some((x) => +x.value === v)) {
    const o = new Option(cruiseLabel(v), String(v)), after = [...sel.options].find((x) => +x.value > v);
    sel.insertBefore(o, after || null);
  }
  sel.value = String(v); return true;
}
if (SK.cruise) setCruise(SK.cruise);
$('sroute').value = SK.route || '';
const sortieSel = () => ({ apt: $('sapt').value, rwy: $('srwy').value, sid: $('ssid').value, sidTrans: $('ssidt').value, route: $('sroute').value.trim(), cruise: $('scruise').value,
  arr: $('sarr').value, star: $('sstar').value, starTrans: $('sstart2').value, app: $('sapp').value, trans: $('strans').value,
  start: $('sstart').value, wx: $('swx').value, weight: $('swt').value, fail: $('sfail').value });
// procedure selectors: [id, name] lists with their transitions
const procOpts = (apt, kind) => (apt ? procedureList(apt, kind).sort((a, b) => a.id.localeCompare(b.id)) : []);
function fillTrans(sel, apt, kind, id, want, none) {
  const p = procOpts(apt, kind).find((x) => x.id === id), list = p ? p.trans.filter((t) => !/^RW/.test(t)) : [];
  setOpts(sel, [...none, ...list.map((t) => [t, t])], want ?? (none.length ? none[0][0] : list[0]));
  sel.disabled = !id;
}
function sortiePreview() {
  const o = sortieSel(), el = $('splan'), needApp = o.start === 'app' || o.start === 'final';
  el.classList.remove('err');
  if (needApp && !o.app) { el.textContent = 'This start needs an approach.'; el.classList.add('err'); $('ffgo').disabled = true; return; }
  const P = sortiePlan(o); if (!P) { el.textContent = 'Loading…'; $('ffgo').disabled = true; return; }
  $('ffgo').disabled = false;
  const route = P.legs.some((l) => l.kind !== 'APP');
  el.textContent = P.legs.length ? `${route ? `${P.dep.id} → ${P.arr.id}, ${Math.round(P.dist)} nm${o.cruise ? ' at ' + $('scruise').selectedOptions[0].textContent : ''}: ` : ''}${planSummary(P.arr, P.legs)}` : 'No flight plan: fly it by hand, heading and altitude modes.';
  if (P.errors.length) { el.textContent += `  ⚠ ${P.errors.join('; ')}`; el.classList.add('err'); }
}
// a route string names a SID / STAR / cruise level: select them
function sortieRoute() {
  const dep = DB.loaded($('sapt').value), arr = DB.loaded($('sarr').value); if (!dep || !arr) return sortiePreview();
  const r = parseRoute(DB, $('sroute').value, dep, arr);
  if (r.sid) { $('ssid').value = r.sid; fillTrans($('ssidt'), dep, 'SID', r.sid, r.sidTrans || '', [['', 'None']]); }
  if (r.star) { $('sstar').value = r.star; fillTrans($('sstart2'), arr, 'STAR', r.star, r.starTrans || '', [['', 'None']]); }
  if (r.cruise) setCruise(r.cruise);
  sortiePreview();
}
async function sortieDep(id, keep = {}) {
  const apt = await DB.airport(id);
  const rwys = Object.keys(apt.runways).map((k) => k.slice(2)).filter((r) => { try { frameFor(id, r); return true; } catch { return false; } });
  setOpts($('srwy'), rwys.map((r) => [r, `Runway ${r} · ${apt.runways['RW' + r].length.toLocaleString()} ft`]), keep.rwy);
  setOpts($('ssid'), [['', 'None'], ...procOpts(apt, 'SID').map((p) => [p.id, p.id])], keep.sid ?? '');
  fillTrans($('ssidt'), apt, 'SID', $('ssid').value, keep.sidTrans ?? '', [['', 'None']]);
  sortiePreview();
}
async function sortieArr(id, keep = {}) {
  const apt = await DB.airport(id);
  setOpts($('sstar'), [['', 'None'], ...procOpts(apt, 'STAR').map((p) => [p.id, p.id])], keep.star ?? '');
  fillTrans($('sstart2'), apt, 'STAR', $('sstar').value, keep.starTrans ?? '', [['', 'None']]);
  const apps = procOpts(apt, 'APP');
  setOpts($('sapp'), [['', 'None'], ...apps.map((p) => [p.id, procName(p.id)])], keep.app ?? (apps.find((p) => p.id[0] === 'I') || apps[0] || { id: '' }).id);
  fillTrans($('strans'), apt, 'APP', $('sapp').value, keep.trans, [['auto', 'Auto (route / vectors)'], ['', 'None (from the intermediate fix)']]);
  sortiePreview();
}
DB_READY.then(async (db) => {
  if (!db) { $('splan').textContent = 'Nav database not available (run tools/fetch_cifp.py).'; $('ffgo').disabled = true; return; }
  $('cycle').textContent = db.index.cycle;
  const list = db.airportList().slice().sort((a, b) => (a.id === 'KDJT' ? -1 : b.id === 'KDJT' ? 1 : a.id.localeCompare(b.id)));
  const opts = list.map((a) => [a.id, `${a.id} · ${a.name}`]), has = (x) => x && list.some((a) => a.id === x);
  setOpts($('sapt'), opts, has(SK.apt) ? SK.apt : 'KDJT'); setOpts($('sarr'), opts, has(SK.arr) ? SK.arr : $('sapt').value);
  await sortieDep($('sapt').value, SK); await sortieArr($('sarr').value, SK);
});
$('sapt').addEventListener('change', async () => { await sortieDep($('sapt').value); sortieRoute(); });
$('sarr').addEventListener('change', async () => { await sortieArr($('sarr').value); sortieRoute(); });
$('ssid').addEventListener('change', () => { fillTrans($('ssidt'), DB.loaded($('sapt').value), 'SID', $('ssid').value, undefined, [['', 'None']]); sortiePreview(); });
$('sstar').addEventListener('change', () => { fillTrans($('sstart2'), DB.loaded($('sarr').value), 'STAR', $('sstar').value, undefined, [['', 'None']]); sortiePreview(); });
$('sapp').addEventListener('change', () => { fillTrans($('strans'), DB.loaded($('sarr').value), 'APP', $('sapp').value, undefined, [['auto', 'Auto (route / vectors)'], ['', 'None (from the intermediate fix)']]); sortiePreview(); });
$('sroute').addEventListener('change', sortieRoute);
for (const id of ['sstart', 'strans', 'srwy', 'ssidt', 'sstart2', 'scruise']) $(id).addEventListener('change', sortiePreview);
// imports: an MSFS .pln file, or the latest SimBrief flight plan for a username (fetched only when asked)
async function importPlan({ dep, arr, route, cruise, depRwy, arrRwy }) {
  const ok = (x) => x && DB.airportList().some((a) => a.id === x);
  const miss = [dep, arr].filter((x) => x && !ok(x));
  if (ok(dep)) { $('sapt').value = dep; await sortieDep(dep, { rwy: depRwy }); }
  if (ok(arr)) { $('sarr').value = arr; await sortieArr(arr, {}); if (arrRwy) { const a = procOpts(DB.loaded(arr), 'APP').find((p) => p.id === 'I' + arrRwy) || procOpts(DB.loaded(arr), 'APP').find((p) => runwayOfApp(p.id) === arrRwy); if (a) { $('sapp').value = a.id; fillTrans($('strans'), DB.loaded(arr), 'APP', a.id, 'auto', [['auto', 'Auto (route / vectors)'], ['', 'None (from the intermediate fix)']]); } } }
  $('sroute').value = route || '';
  if (cruise) setCruise(cruise);
  sortieRoute();
  if (miss.length) { $('splan').textContent = `${miss.join(', ')} not in the nav database (airports within 160 nm of Palm Beach). ` + $('splan').textContent; $('splan').classList.add('err'); }
}
$('splnbtn').addEventListener('click', () => $('spln').click());
$('spln').addEventListener('change', async () => { const f = $('spln').files[0]; if (!f) return; const p = parsePln(await f.text()); await importPlan(p); $('spln').value = ''; });
$('ssbbtn').addEventListener('click', async () => {
  const u = $('ssbuser').value.trim(); if (!u) return;
  $('splan').textContent = 'Fetching the latest SimBrief flight plan…';
  try {
    const j = await (await fetch(`https://www.simbrief.com/api/xml.fetcher.php?username=${encodeURIComponent(u)}&json=1`)).json();
    if (!j.origin) throw new Error(j.fetch && j.fetch.status || 'no flight plan');
    await importPlan({ dep: j.origin.icao_code, arr: j.destination.icao_code, route: j.general.route, cruise: +j.general.initial_altitude || null, depRwy: j.origin.plan_rwy, arrRwy: j.destination.plan_rwy });
  } catch (e) { $('splan').textContent = `SimBrief: ${e.message || e}`; $('splan').classList.add('err'); }
});
$('tosortie').addEventListener('click', () => { $('brief').classList.add('hidden'); SORTIE.classList.remove('hidden'); });
$('sback').addEventListener('click', () => { SORTIE.classList.add('hidden'); $('brief').classList.remove('hidden'); });
$('ffgo').addEventListener('click', () => {
  const o = sortieSel(); if (!DB.loaded(o.apt) || !DB.loaded(o.arr)) return;
  localStorage.setItem(FREE_KEY, JSON.stringify(o));
  SORTIE.classList.add('hidden'); AU.start();
  newFreeFlight(o); hc.focus();
});
if (location.hash === '#sortie') { $('brief').classList.add('hidden'); SORTIE.classList.remove('hidden'); }
document.getElementById('replay').addEventListener('click', () => { if (G.recon) startReconstruction(); else startReplay(); hc.focus(); });
document.getElementById('watch').addEventListener('click', () => {
  document.getElementById('brief').classList.add('hidden'); AU.start();
  ATC.on = document.getElementById('atcbox').checked; SETTINGS.nexrad = document.getElementById('nexbox').checked;
  startReconstruction(); hc.focus();
});
document.getElementById('csv').addEventListener('click', () => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([fdrCsv()], { type: 'text/csv' })); a.download = `n722bd_${G.hypKey}_${G.hard ? 'asflown' : 'trainer'}_${Math.round(G.t)}s.csv`; a.click();
});
document.getElementById('hwbtn').addEventListener('click', () => HP.show());
// ---------- approach plates (FAA d-TPP, data/plates; tools/fetch_plates.py) ----------
const PL = { el: document.getElementById('plates'), meta: null, i: 0, rot: 0 };
fetch('data/plates/plates.json').then((r) => r.json()).then((m) => {
  PL.meta = m; const tabs = PL.el.querySelector('.ptabs');
  m.charts.forEach((c, i) => { const b = document.createElement('button'); b.className = 'alt sm'; b.textContent = c.title.replace('ILS OR LOC ', 'ILS '); b.onclick = () => showPlate(i); tabs.appendChild(b); });
  PL.el.querySelector('.pnote').textContent = `${m.airport} (${m.icao}) · FAA d-TPP cycle ${m.cycle}, ${m.valid_from} to ${m.valid_to} · public domain · NOT FOR NAVIGATION`;
}).catch(() => {});
function showPlate(i) {
  if (!PL.meta) return; PL.i = i; const c = PL.meta.charts[i];
  PL.rot = c.code === 'APD' ? 90 : 0;   // this airport diagram is printed sideways: north-up after a quarter turn
  PL.src = new Image(); PL.src.onload = applyRot; PL.src.src = 'data/plates/' + c.file;
  PL.el.querySelectorAll('.ptabs button').forEach((b, k) => b.classList.toggle('on', k === i));
}
// rotate the pixels (a CSS transform leaves the layout box unrotated and clips the chart)
function applyRot() {
  const im = PL.src, img = PL.el.querySelector('.pimg'); if (!im || !im.naturalWidth) return;
  if (!PL.rot) { img.src = im.src; return; }
  const q = PL.rot % 180 !== 0, c = document.createElement('canvas'); c.width = q ? im.naturalHeight : im.naturalWidth; c.height = q ? im.naturalWidth : im.naturalHeight;
  const x = c.getContext('2d'); x.translate(c.width / 2, c.height / 2); x.rotate(PL.rot * Math.PI / 180); x.drawImage(im, -im.naturalWidth / 2, -im.naturalHeight / 2);
  img.src = c.toDataURL('image/png');
}
// the weather radar's reflectivity source: the KAMX volume (real weather), the modelled cell (real weather off), or clear
// air in free flight (no storm there)
function wxrSource(env) {
  if (!SETTINGS.wxr) return null;
  const range = SETTINGS.wxrRange;
  if (G.mode === 'free') return { range, sample: () => -30 };
  if (SETTINGS.nexrad && NEX) return { range, sample: (n, e, h0, h1) => { h0 -= 1500; const w = clamp((G.t - NEX[0].t) / (NEX[1].t - NEX[0].t), 0, 1); return lerp(NEX[0].f.dbzBand(n, e, h0, h1), NEX[1].f.dbzBand(n, e, h0, h1), w); } };
  return { range, sample: (n, e, h0, h1) => env.local([n, e, -(h0 + h1) / 2], G.t).dbz };
}
// ---- direct to (the FMS DIR key, @): a fix of the plan ahead, or any fix by ident ----
const DTO = { el: document.getElementById('dto') };
DTO.inp = document.getElementById('dtofix'); DTO.list = DTO.el.querySelector('.dlist'); DTO.note = DTO.el.querySelector('.dnote');
const toFix = (ne, fx) => { const dn = fx[0] - ne[0], de = fx[1] - ne[1]; return { nm: Math.hypot(dn, de) / 1852, brg: wrap360(Math.atan2(de, dn) * RAD - (G.apt ? G.apt.magvar : 0)) }; };
function dtoClose() { DTO.el.classList.add('hidden'); DTO.inp.blur(); document.getElementById('hud').focus(); }
function dtoToggle() {
  if (!DTO.el.classList.contains('hidden')) { dtoClose(); return; }
  if (!G || G.mode !== 'free' || !G.fms) { log('SYS', 'DIRECT TO: free flight only'); return; }
  const F = G.fms, ne = [G.ac.pos[0], G.ac.pos[1]], seen = new Set();
  DTO.list.textContent = ''; DTO.note.textContent = ''; DTO.inp.value = '';
  for (let j = F.i; j < F.legs.length && seen.size < 12; j++) {
    const l = F.legs[j]; if (!l.fix || l.fix.id === 'VECTR' || seen.has(l.fix.id)) continue; seen.add(l.fix.id);
    const b = document.createElement('button'), d = toFix(ne, l.fix.ne); b.className = 'alt';
    b.append(l.fix.id); const sp = document.createElement('span'); sp.textContent = `${String(Math.round(d.brg) || 360).padStart(3, '0')}° ${d.nm.toFixed(0)} nm`; b.append(sp);
    b.onclick = () => dtoGo(l.fix.id); DTO.list.append(b);
  }
  if (!seen.size) DTO.note.textContent = 'No fixes ahead in the flight plan: type any fix, navaid or airport.';
  DTO.el.classList.remove('hidden'); DTO.inp.focus();
}
function dtoGo(id) {
  const { fms: F, ac, ap } = G; id = id.trim().toUpperCase(); if (!id) return;
  const ne = [ac.pos[0], ac.pos[1]], inPlan = F.legs.slice(F.i).find((l) => l.fix && l.fix.id === id);
  const fx = inPlan ? inPlan.fix : DB.findFix(id, ne);
  if (!fx) { DTO.note.textContent = `${id}: not in the flight plan or the nav database`; return; }
  F.directTo(fx, ne);
  const d = toFix(ne, fx.ne), rest = F.next ? `, then ${legText(G.apt, F.next)}` : '';
  log('SYS', `DIRECT ${id}: ${String(Math.round(d.brg) || 360).padStart(3, '0')}°, ${d.nm.toFixed(1)} nm${rest}${ap.lat === 'LNAV' ? '' : ap.latArm === 'LNAV' ? ' (LNAV armed)' : '. Press ( for LNAV'}`);
  dtoClose();
}
DTO.inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { dtoGo(DTO.inp.value); e.preventDefault(); } else if (e.key === 'Escape') { dtoClose(); e.preventDefault(); } });
document.getElementById('dtogo').onclick = () => dtoGo(DTO.inp.value);
document.getElementById('dtox').onclick = dtoClose;

function togglePlates() {
  if (!PL.meta) { log('SYS', 'Approach plates not loaded'); return; }
  if (PL.el.classList.contains('hidden')) {
    let i = 0;   // open on the approach ahead, or the airport diagram on the ground
    if (G && G.mode === 'free') {
      const here = G.ac.wow ? G.free.apt : (G.apt ? G.apt.id : G.free.apt);   // the field you're at, or the one you're going to
      if (PL.meta.icao && here !== PL.meta.icao) { log('SYS', `No approach plates for ${here} in this build (plates ship for ${PL.meta.icao} only)`); return; }
      const rw = G.legs && G.legs.length ? approachRunway(G.legs, G.free.app) : null;
      const app = G.free.app || '', mine = (c) => c.code === 'IAP' && c.title.endsWith('RWY ' + rw) && (app[0] === 'I' ? /^ILS/.test(c.title) : app[0] === 'L' ? /LOC/.test(c.title) : c.title === procName(app));
      const k = G.ac.wow || !rw ? PL.meta.charts.findIndex((c) => c.code === 'APD') : PL.meta.charts.findIndex(mine);
      if (k >= 0) i = k;
    }
    showPlate(i); PL.el.classList.remove('hidden');
  } else { PL.el.classList.add('hidden'); hc.focus(); }
}
PL.el.querySelector('.pclose').addEventListener('click', togglePlates);
PL.el.querySelector('.prot').addEventListener('click', () => { PL.rot = (PL.rot + 90) % 360; applyRot(); });
document.getElementById('platebtn').addEventListener('click', togglePlates);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !PL.el.classList.contains('hidden')) togglePlates(); });
document.getElementById('again').addEventListener('click', () => { if (G.mode === 'free') newFreeFlight(G.free); else newGame(G.hypKey, G.hard); });
document.getElementById('continue').addEventListener('click', () => { document.getElementById('debrief').classList.add('hidden'); });
document.getElementById('brief-again').addEventListener('click', () => { document.getElementById('debrief').classList.add('hidden'); (G && G.mode === 'free' ? SORTIE : document.getElementById('brief')).classList.remove('hidden'); });
document.getElementById('nexbox').checked = true; document.getElementById('atcbox').checked = false;   // Chrome restores form state on reload
newGame('combined'); G.paused = true;
IN.onClick = (x, y) => {
  let h = null;
  if (CK && CK.ready && !G.ext && G.head) { const p = CK.pick(2 * x / innerWidth - 1, 1 - 2 * y / innerHeight, G.head, G.lastFov || 64 * DEG, innerWidth / innerHeight); h = p && p.hit; }
  else h = H.hit(x, y);
  if (!h) return false; toggleSwitch(h.id); return true;
};
window.SIM = { get G() { return G; }, R, ATC, SETTINGS, IN, FF, CK, H, toggle: toggleSwitch, get NEX() { return NEX; } };   // debug / flight-data access from the console
// debug inspection shots: #shot=x,y,z,yaw,pitch,fov[,nex 0/1[,t]]  (starts the reconstruction paused at t with a free camera)
if (location.hash.startsWith('#shot=')) {
  const v = location.hash.slice(6).split(',').map(Number);
  document.getElementById('brief').classList.add('hidden'); SETTINGS.nexrad = v[6] !== 0; startReconstruction();
  if (v[7]) { while (G.t < v[7]) replayStep(1 / 30); }
  G.paused = true; G.hideHud = true; window.SIM.camOverride = { pos: [v[0], v[1], v[2]], yaw: v[3], pitch: v[4], fov: v[5] || 70 };
}
// debug: #view=t,camMode,orbitYaw,orbitPitch[,hud]  (reconstruction paused at t with a sim camera: 0 cockpit, 1 chase, 2 ground)
if (location.hash.startsWith('#view=')) {
  const v = location.hash.slice(6).split(',').map(Number);
  document.getElementById('brief').classList.add('hidden');
  const go = () => { if (!NEX || !R.goes || !R.ground) return setTimeout(go, 100);   // wait for the weather and imagery
    startReconstruction(); G.env.nex = NEX;
    while (G.t < v[0]) replayStep(1 / 30);
    G.paused = true; G.hideHud = !v[4]; G.camMode = v[1] | 0; IN.orbit.yaw = v[2] || 0; IN.orbit.pitch = v[3] || 0; };
  go();
}
requestAnimationFrame(frame);
