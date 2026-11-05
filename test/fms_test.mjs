// Flight management from the FAA CIFP (js/navdb.js + js/fms.js) flown by the autopilot (js/scenario.js): procedures
// are assembled from the data, never hand-coded. KDJT ILS 10L via GULLO from the approach start: LNAV / VNAV to the
// localizer and glideslope, a go-around at 200 ft, the published missed approach (climb to 600, left turn heading 317
// true to intercept the PBI course to MORGA) and the MORGA hold; hold entries; VNAV and the preselected altitude.
import { readFileSync } from 'node:fs';
import { Learjet60 } from '../js/aircraft.js';
import { Autopilot } from '../js/scenario.js';
import { setupStart, setWeight, FreeEnv, configureGuidance } from '../js/freeflight.js';
import { NavDB, procedureLegs, rnavListMinimums } from '../js/navdb.js';
import { FMS } from '../js/fms.js';
import { nearestIls } from '../js/nav.js';
import { vref } from '../js/afm.js';
import { DEG, clamp } from '../js/util.js';
import { FT } from '../js/atmo.js';

let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
const DT = 1 / 60, env = { wind: [0, 0, 0], dT: 0 };
const db = new NavDB({ load: async (p) => JSON.parse(readFileSync(new URL('../data/nav/' + p, import.meta.url), 'utf8')) });
await db.init(); const apt = await db.airport('KDJT');
const wrap180 = (d) => ((d + 540) % 360) - 180, trkDeg = (o) => ((o.track / DEG) % 360 + 360) % 360;
const speedHold = (ac, o, kias) => { ac.ctl.thr = clamp(ac.ctl.thr + (kias - o.KIAS) * 0.004 * DT * 60, 0, 1); };

// ---- procedure assembly from the data ----
{
  const legs = procedureLegs(apt, 'APP', 'I10L', { trans: 'GULLO' });
  const seq = legs.map((l) => l.pt + (l.fix ? ' ' + l.fix.id : '')).join(', ');
  expect(seq === 'IF GULLO, TF WILBA, CF ZISUR, CF RW10L, CA, VI, CF MORGA, HM MORGA', `I10L via GULLO: ${seq}`);
  const hold = legs.at(-1), faf = legs.find((l) => l.faf), map = legs.find((l) => l.map);
  expect(faf.fix.id === 'ZISUR' && faf.alt.a1 === 2000 && map.fix.id === 'RW10L' && hold.turn === 'R' && Math.abs(hold.crsT - 340.2) < 0.2,
    `FAF ${faf.fix.id} ${faf.alt.a1} ft, MAP ${map.fix.id}, hold right turns inbound ${hold.crsT.toFixed(1)}° true (343.2° on PBI, declination −3°)`);
  const w = procedureLegs(apt, 'APP', 'I10L', { trans: 'WILBA' })[0];
  expect(w.pt === 'HF' && w.turn === 'L' && Math.abs(w.crsT - 92.8) < 0.2, `WILBA transition: course-reversal hold ${w.pt}, ${w.turn} turns, inbound ${w.crsT.toFixed(1)}° true`);
}

// ---- minimums: from the FAA plates' text layer (tools/fetch_plates.py), Category C ----
{
  const plates = JSON.parse(readFileSync(new URL('../data/plates/plates.json', import.meta.url), 'utf8'));
  const min = (title, type) => { const c = plates.charts.find((x) => x.title === title); const m = c && c.minimums.find((x) => x.type === type); return m ? m.cat.C.alt : null; };
  const got = [min('ILS OR LOC RWY 10L', 'S-ILS'), min('ILS OR LOC RWY 10L', 'S-LOC'), min('ILS OR LOC RWY 28R', 'S-ILS'), min('ILS OR LOC RWY 28R', 'S-LOC'), min('RNAV (GPS) Y RWY 14', 'LNAV/VNAV'), min('RNAV (GPS) Y RWY 10L', 'LNAV')];
  expect(got.join(' ') === '216 380 218 460 338 440', `plate minimums (Cat C): ILS 10L DA ${got[0]}, LOC 10L MDA ${got[1]}, ILS 28R DA ${got[2]}, LOC 28R MDA ${got[3]}, RNAV Y 14 LNAV/VNAV DA ${got[4]}, RNAV Y 10L LNAV MDA ${got[5]}`);
}
// ---- minimums at every airport: the plates' text layer, all 72 airports (tools/fetch_plates.py --all) ----
{
  const M = JSON.parse(readFileSync(new URL('../data/plates/minimums.json', import.meta.url), 'utf8'));
  const get = (apt, title, type) => { const c = M.airports[apt].charts.find((x) => x.title === title), m = c && c.minimums.find((x) => x.type === type); return m ? m.cat.C.alt : null; };
  const got = [get('KMCO', 'ILS OR LOC RWY 18R', 'S-ILS'), get('KMIA', 'LOC RWY 08L', 'S-LOC'), get('KPIE', 'VOR RWY 04', 'S-VOR'), get('KFLL', 'RNAV (GPS) RWY 10R', 'LNAV/VNAV'), get('KFLL', 'RNAV (GPS) RWY 10R', 'LNAV')];
  const n = Object.values(M.airports).reduce((s, a) => s + a.charts.filter((c) => c.minimums.length).length, 0);
  const ocr = [get('KCOF', 'ILS OR LOC RWY 03', 'S-ILS'), get('KCOF', 'ILS OR LOC RWY 03', 'S-LOC'), get('KMCF', 'ILS OR LOC RWY 05', 'S-LOC'), get('KNQX', 'RNAV (GPS) RWY 26', 'LNAV/VNAV'), get('KNQX', 'RNAV (GPS) RWY 26', 'LNAV'), get('KNQX', 'VOR/DME RWY 26', 'S-VOR/DME')];
  const copter = M.airports.KNQX.charts.find((c) => /COPTER/.test(c.title));
  expect(ocr.join() === '205,460,420,383,520,520' && M.airports.KCOF.charts[0].ocr && copter && !copter.minimums.length,
    `military plates by OCR (no usable text layer): KCOF ILS 3 ${ocr[0]} / LOC ${ocr[1]}, KMCF LOC 5 ${ocr[2]} (read "S-10C5"), KNQX RNAV 26 LNAV/VNAV ${ocr[3]} / LNAV ${ocr[4]}, VOR/DME 26 ${ocr[5]} (no column letters read); helicopter-only minimums skipped`);
  expect(got.join() === '294,440,1000,355,460' && n >= 310, `cycle ${M.cycle}: KMCO ILS 18R ${got[0]}, KMIA LOC 8L ${got[1]} ("S-8L" on the plate), KPIE VOR 4 ${got[2]} ("S-4"), KFLL RNAV 10R LNAV/VNAV ${got[3]} / LNAV ${got[4]} (split header); ${n} plates with straight-in minimums`);
}

// ---- RNAV minimums where no plate is loaded: the FAA master RNAV list (tools/fetch_rnav_minimums.py) ----
{
  const L = db.rnavMins, exact = rnavListMinimums(L, 'KMCO', 'RNAV (GPS) RWY 17R'), renamed = rnavListMinimums(L, 'KMCO', 'RNAV (GPS) Y RWY 18R');
  expect(exact && exact.type === 'LNAV/VNAV' && exact.alt === 526, `KMCO RNAV (GPS) RWY 17R: ${exact && exact.type} ${exact && exact.alt} ft (list, effective ${L && L.effective['LNAV/VNAV']})`);
  expect(renamed && /listed as RNAV \(GPS\) RWY 18R/.test(renamed.chart) && !rnavListMinimums(L, 'KMCO', 'RNAV (GPS) RWY 99'), `renamed since the list (Y RWY 18R): ${renamed && renamed.chart.split(',')[0]}; an unknown runway gives none`);
}

// ---- approach arming by procedure type ----
{
  const arm = (app) => { const ap = new Autopilot(true), fms = new FMS(); fms.load(procedureLegs(apt, 'APP', app)); ap.fms = fms; ap.fd = true; ap.on = false; ap.appr = true;
    const ac = new Learjet60(); ac.pos = [-30000, -40000, -900]; ap.step(ac, DT, { h: 900, vs: 0, theta: 0, phi: 0, psi: 1.6, p: 0, q: 0, M: 0.3, gs: 90, V: 90, agl: 900 }); return `${ap.latArm || ap.lat}+${ap.vertArm || ap.vert}`; };
  const got = ['I10L', 'L10L', 'R10LY'].map(arm);
  expect(got.join(' ') === 'LOC+GS LOC+GP LNAV+GP', `APR arms: ILS ${got[0]}, LOC ${got[1]}, RNAV ${got[2]}`);
}
// ---- hold entries by arrival sector (right-hand hold, inbound 360) ----
{
  const fix = { id: 'X', ne: [0, 0] }, got = [];
  for (const trk of [0, 60, 100, 160, 200, 230, 270]) {
    const f = new FMS(); f.load([{ pt: 'HM', fix, crsT: 0, turn: 'R', time: 1 }]);
    const t = trk * DEG, pos = [-Math.cos(t) * 100, -Math.sin(t) * 100];   // 100 m before the fix on the arrival track
    f.update({ ne: pos, h: 3000, trk, hdg: trk, gs: 100, dt: DT });
    got.push(`${trk}:${f.hold && f.hold.entry}`);
  }
  // x = track - inbound: direct -110..70, teardrop > 70, parallel < -110
  expect(got.join(' ') === '0:direct 60:direct 100:teardrop 160:teardrop 200:parallel 230:parallel 270:direct', `entries ${got.join(' ')}`);
}

// ---- the approach, go-around and missed approach, flown by the autopilot from the data ----
{
  const ac = new Learjet60(); setWeight(ac, 'typical'); const fe = new FreeEnv('calm');
  const s = { apt: 'KDJT', start: 'app', app: 'I10L', trans: 'GULLO' }, legs = procedureLegs(apt, 'APP', s.app, { trans: s.trans });
  const r = setupStart(ac, s, fe, legs); let o = ac.step(0, env);
  const ap = new Autopilot(true), fms = new FMS();
  ap.nav = (q) => { const id = fms.approachNav(); return nearestIls(id ? [apt.ils[id]] : db.allIls(), ac.pos[0], ac.pos[1], q.h, q.track ?? q.psi); };
  configureGuidance(ap, fms, r, s, legs, o);
  const ref = vref(ac.m / 0.45359); let conf = 0, t = 0, ga = null, legLog = [], modeLog = [], at3000 = null, maxDev = 0, wilba = null, zisur = null, hold = null;
  for (; t < 1500; t += DT) {
    const ft = (o.agl - 1.6) / FT, leg = fms.active, d = ap.ils;
    const key = `${ap.lat}${ap.latArm ? '(' + ap.latArm + ')' : ''}/${ap.vert}${ap.vertArm ? '(' + ap.vertArm + ')' : ''}`;
    if (modeLog.at(-1) !== key) modeLog.push(key);
    const lk = leg ? leg.pt + (leg.fix ? ' ' + leg.fix.id : '') : 'end'; if (legLog.at(-1) !== lk) legLog.push(lk);
    if (leg && leg.fix && leg.fix.id === 'ZISUR' && !wilba) wilba = { h: o.h / FT };
    if (leg && leg.fix && leg.fix.id === 'RW10L' && !zisur) zisur = { h: o.h / FT };
    // the crew: missed-approach altitude set at glideslope capture; gear down, flaps 20 there; flaps 40 at 1,500 ft
    if (ap.vert === 'GS' && conf === 0) { conf = 1; ap.altTgt = fms.missedAlt() * FT; ac.ctl.gear = 1; ac.ctl.flaps = 0.5; }
    if (conf === 1 && ft < 1500) { conf = 2; ac.ctl.flaps = 1; }
    if (conf === 2 && ft < 1000 && ft > 250 && d) maxDev = Math.max(maxDev, Math.abs(d.locRaw), Math.abs(d.gsRaw));
    if (conf < 3) speedHold(ac, o, conf === 0 ? 180 : conf === 1 ? 150 : ref + 5);
    // go around at 200 ft: TOGA (the AP lets go), T/O thrust, flaps 20, gear up; the AP back on at 1,000 ft
    if (conf === 2 && ft <= 200) { conf = 3; ap.goAround(o); ac.ctl.thr = 1; ac.ctl.flaps = 0.5; ga = { t, leg: lk }; }
    if (conf === 3) {
      if (o.vs > 2) ac.ctl.gear = 0;
      if (ft > 1000 && !ap.on) { ap.engage(o); ac.ctl.flaps = 0; }
      if (ft > 1000 && t > ga.t + 20) speedHold(ac, o, 180);
      if (!ga.turn && leg && leg.pt === 'VI') ga.turn = { h: o.h / FT, x: ac.pos[1] };
      if (!at3000 && ap.vert === 'ALT' && Math.abs(o.h / FT - 3000) < 50) at3000 = t;
      if (leg && leg.pt === 'HM' && fms.hold) {
        hold = hold || { phases: [], inb: [], alt: [] }; const ph = fms.hold.phase; if (hold.phases.at(-1) !== ph) { hold.phases.push(ph); }
        hold.alt.push(o.h / FT); if (process.env.DBG && Math.round(t * 60) % 300 === 0) console.log('    .', ph, 'ap', ap.on, 'phi', (o.phi / DEG).toFixed(0), 'hdg', (o.psi / DEG).toFixed(0), 'fdPhi', (ap.fdPhi / DEG).toFixed(0), 'kias', o.KIAS.toFixed(0), 'turnDir', fms.last && fms.last.turnDir, 'agl', ap.agl.toFixed(0)); if (ph === 'inbound') hold.inb.push(trkDeg(o));
        if (fms.hold.laps >= 2) break;
      }
    }
    if (conf < 3) { ap.step(ac, DT, o); } else { ap.step(ac, DT, o); if (!ap.on) flyFd(ac, ap, o); }
    o = ac.step(DT, env);
    if (ac.crashed) break;
  }
  console.log('      legs:', legLog.join(' > ')); console.log('      modes:', modeLog.join(' > '));
  expect(modeLog.includes('LNAV(LOC)/VNAV(GS)') && modeLog.includes('LOC/GS'), 'LNAV / VNAV with LOC and GS armed, then LOC / GS captured');
  expect(wilba && wilba.h > 2950 && zisur && Math.abs(zisur.h - 2000) < 100, `VNAV: WILBA at ${wilba && Math.round(wilba.h)} ft (at or above 3,000), ZISUR at ${zisur && Math.round(zisur.h)} ft (glideslope intercept 2,000)`);
  expect(ga && maxDev < 0.6, `coupled 1,000 to 250 ft within ${maxDev.toFixed(2)} dot; go-around at 200 ft on leg ${ga && ga.leg}`);
  expect(ga && ga.turn && ga.turn.h > 550 && ga.turn.x > -1500, `missed approach: straight ahead to 600 ft, then the left turn (at ${ga && ga.turn && Math.round(ga.turn.h)} ft, ${ga && ga.turn && Math.round(ga.turn.x)} m east of the origin)`);
  expect(legLog.join(' > ').endsWith('CA > VI > CF MORGA > HM MORGA'), 'sequenced CA > VI > CF MORGA > HM MORGA');
  const inbAvg = hold && hold.inb.length ? hold.inb.reduce((a, x) => a + wrap180(x - 340.2), 0) / hold.inb.length : 99;
  const altSpread = hold ? Math.max(...hold.alt.slice(200)) - Math.min(...hold.alt.slice(200)) : 999;
  expect(hold && hold.phases[0] === 'turnOut' && hold.phases.join(' ').includes('outbound turnIn inbound') && Math.abs(inbAvg) < 6 && altSpread < 250 && !ac.crashed,
    `MORGA hold: ${hold && hold.phases.slice(0, 5).join(' > ')}; inbound track ${(340.2 + inbAvg).toFixed(0)}° true (340), altitude spread ${Math.round(altSpread)} ft; reached 3,000 ft ${at3000 && (at3000 - ga.t).toFixed(0)} s after the go-around`);
}

// ---- VNAV never descends through the preselected altitude ----
{
  const ac = new Learjet60(); setWeight(ac, 'typical'); const fe = new FreeEnv('calm');
  const s = { apt: 'KDJT', start: 'app', app: 'I10L', trans: 'GULLO' }, legs = procedureLegs(apt, 'APP', s.app, { trans: s.trans });
  const r = setupStart(ac, s, fe, legs); let o = ac.step(0, env);
  const ap = new Autopilot(true), fms = new FMS(); configureGuidance(ap, fms, r, s, legs, o);
  ap.appr = false; ap.altTgt = 4000 * FT; let minH = 1e9;
  for (let t = 0; t < 240; t += DT) { speedHold(ac, o, 180); ap.step(ac, DT, o); o = ac.step(DT, env); if (t > 60) minH = Math.min(minH, o.h / FT); }
  expect(Math.abs(minH - 4000) < 60, `preselect 4,000 ft with WILBA at or above 3,000: VNAV levels at ${Math.round(minH)} ft`);
}

// ---- direct to: a fix of the plan ahead, a holding fix, a fix off the plan ----
{
  const seq = (f) => f.legs.slice(f.i).map((l) => l.pt + (l.fix ? ' ' + l.fix.id : '')).join(', ');
  const f = new FMS(); f.load(procedureLegs(apt, 'APP', 'I10L', { trans: 'GULLO' }));
  f.directTo({ id: 'ZISUR' }, [0, 0]);
  expect(seq(f) === 'DF ZISUR, CF RW10L, CA, VI, CF MORGA, HM MORGA' && f.active.faf && f.active.alt.a1 === 2000, `direct ZISUR (FAF) skips GULLO, WILBA and keeps the FAF and 2,000 ft: ${seq(f)}`);
  const v = new FMS(); v.load(procedureLegs(apt, 'APP', 'I10L', { trans: 'GULLO' }), 4);
  const pbi = db.findFix('PBI', [0, 0]); v.directTo(pbi, [0, 0]);
  expect(seq(v) === 'DF PBI, VI, CF MORGA, HM MORGA', `direct PBI (off the plan) during the missed approach's climb: the altitude leg is dropped, the plan resumes: ${seq(v)}`);
  const h = new FMS(); h.load(procedureLegs(apt, 'APP', 'I10L', { trans: 'WILBA' }));
  h.directTo({ id: 'WILBA' }, [0, 0]);
  expect(/^DF WILBA, HF WILBA/.test(seq(h)) && !h.active.turn, `direct WILBA (course-reversal hold): the hold stays after the direct: ${seq(h).split(', ').slice(0, 3).join(', ')}`);
  const z = db.findFix('zisur', [0, 0]), zl = f.active.fix.ne;
  expect(z && Math.hypot(z.ne[0] - zl[0], z.ne[1] - zl[1]) < 1 && !db.findFix('NOPEZ'), `terminal fix by ident from the loaded procedures: ZISUR ${z ? 'found' : 'missing'}, NOPEZ not found`);
}
// ---- direct to, flown: from the approach start, direct PBI (off the plan) on LNAV, then back to the plan ----
{
  const ac = new Learjet60(); setWeight(ac, 'typical'); const fe = new FreeEnv('calm');
  const s = { apt: 'KDJT', start: 'app', app: 'I10L', trans: 'GULLO' }, legs = procedureLegs(apt, 'APP', s.app, { trans: s.trans });
  const r = setupStart(ac, s, fe, legs); let o = ac.step(0, env);
  const ap = new Autopilot(true), fms = new FMS(); configureGuidance(ap, fms, r, s, legs, o);
  ap.appr = false; ap.altTgt = 3000 * FT;
  const pbi = db.findFix('PBI', [ac.pos[0], ac.pos[1]]), was = fms.active.fix.id;
  let minD = 1e9, after = null, trkErr = null;
  for (let t = 0; t < 900 && !after; t += DT) {
    if (Math.abs(t - 5) < DT / 2) fms.directTo(pbi, [ac.pos[0], ac.pos[1]]);
    speedHold(ac, o, 200); ap.step(ac, DT, o); o = ac.step(DT, env);
    const d = Math.hypot(pbi.ne[0] - ac.pos[0], pbi.ne[1] - ac.pos[1]) / 1852; minD = Math.min(minD, d);
    if (t > 60 && trkErr === null && d > 3) trkErr = Math.abs(wrap180(trkDeg(o) - ((Math.atan2(pbi.ne[1] - ac.pos[1], pbi.ne[0] - ac.pos[0]) / DEG + 360) % 360)));
    if (t > 6 && fms.active && fms.active.fix && fms.active.fix.id !== 'PBI') after = { t, id: fms.active.fix.id, lat: ap.lat };
  }
  expect(trkErr !== null && trkErr < 3 && minD < 0.6, `flies direct PBI on LNAV: track ${trkErr && trkErr.toFixed(1)}° off the bearing a minute in, passes ${minD.toFixed(2)} nm from it`);
  expect(after && after.id === was && after.lat === 'LNAV', `then resumes the plan at ${after && after.id} (was ${was}) in ${after && after.lat} after ${after && (after.t / 60).toFixed(1)} min`);
}

function flyFd(ac, ap, o) {
  const e = ap.fdTheta - o.theta; ac.fI = clamp((ac.fI || 0) + e * DT * 4, -0.5, 0.5);
  ac.ctl.elev = clamp((6 * e - 2 * o.q) / 2.5 + ac.fI, -1, 1);
  ac.ctl.ail = clamp(1.2 * (ap.fdPhi - o.phi) - 0.5 * o.p, -1, 1);
}
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); } else console.log('\nall passed');
