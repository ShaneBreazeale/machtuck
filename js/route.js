// IFR routes: parse a route string (FAA / ICAO / SimBrief style) or an MSFS .pln flight plan, and assemble the whole
// flight plan into one leg list for js/fms.js: departure procedure (SID) for the runway, airways and fixes, arrival
// procedure (STAR), approach with its transition and missed approach. Everything comes from the nav database
// (js/navdb.js): nothing here knows about a particular airport or route.
//
// Route string tokens, in order: [DEP] [SID[.TRANS] | SID TRANS] {FIX | AIRWAY | DCT | lat/lon} [TRANS.STAR | STAR] [ARR]
//   - a SID or STAR may be written with or without its version digit (TBIRD8 or TBIRD), and FAA-style with its
//     transition: TBIRD8.CHEFS (SID.TRANS), LAMMA.GTOUT1 (TRANS.STAR)
//   - an airway runs from the fix before it to the fix after it: CHEFS J79 ORL
//   - coordinates: 2630N08010W (degrees and minutes) or 26N080W
import { toNE, procedureLegs, procedureList, fixLeg, airwayLegs } from './navdb.js';

const norm = (s) => s.replace(/\d$/, '');
// a procedure at an airport by name, with or without its version digit
export function findProc(apt, kind, name) {
  if (!apt || !name) return null;
  const list = procedureList(apt, kind), n = name.toUpperCase();
  return list.find((p) => p.id === n) || list.find((p) => norm(p.id) === norm(n) && /\d$/.test(p.id)) || null;
}
function coordFix(tok) {
  let m = tok.match(/^(\d{2})(\d{2})?([NS])(\d{3})(\d{2})?([EW])$/);
  if (!m) return null;
  const lat = (+m[1] + (+m[2] || 0) / 60) * (m[3] === 'S' ? -1 : 1), lon = (+m[4] + (+m[5] || 0) / 60) * (m[6] === 'W' ? -1 : 1);
  return { id: tok, lat, lon, ne: toNE(lat, lon), kind: 'LL' };
}

// Parse a route string. dep / arr: loaded airports (NavDB.airport). Returns { sid, sidTrans, star, starTrans, enroute:
// [{ kind: 'FIX', fix } | { kind: 'AWY', id }], cruise (ft, from a trailing / embedded FL or altitude), errors }.
export function parseRoute(db, text, dep, arr) {
  const toks = String(text || '').toUpperCase().replace(/[,\n\t]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const r = { sid: null, sidTrans: null, star: null, starTrans: null, enroute: [], cruise: null, errors: [] };
  // strip the airports, speed / level groups (N0450F350, /F350, FL350) and DCT
  const items = [];
  for (const t0 of toks) {
    let t = t0;
    // cruise level: FL240, or a speed / level group (N0450F350, /F240, /A045); never a bare A315 (an airway)
    const lvl = t.match(/^FL(\d{3})$/) || t.match(/^(?:[NKM]\d{4})[FA](\d{3})$/) || t.match(/\/(?:[NKM]\d{4})?[FA](\d{3})$/);
    if (lvl) { r.cruise = 100 * +lvl[1]; t = t.replace(/\/?(?:[NKM]\d{4})?(?:FL|[FA])\d{3}$/, ''); if (!t) continue; }
    if (t === 'DCT' || t === 'SID' || t === 'STAR') continue;
    if ((dep && t === dep.id) || (arr && t === arr.id)) continue;
    items.push(t);
  }
  for (let i = 0; i < items.length; i++) {
    const t = items[i], first = i === 0, last = i === items.length - 1;
    if (t.includes('.')) {   // SID.TRANS or TRANS.STAR
      const [a, b] = t.split('.');
      const sid = first || !r.enroute.length ? findProc(dep, 'SID', a) : null, star = findProc(arr, 'STAR', b) || findProc(arr, 'STAR', a);
      if (sid) { r.sid = sid.id; r.sidTrans = sid.trans.includes(b) ? b : null; if (r.sidTrans) pushFix(db, r, b, dep, arr); continue; }
      if (star) { const isB = star.id === (findProc(arr, 'STAR', b) || {}).id; r.star = star.id; const tr = isB ? a : b; r.starTrans = star.trans.includes(tr) ? tr : null; continue; }
      r.errors.push(`${t}: no such SID at ${dep ? dep.id : '?'} or STAR at ${arr ? arr.id : '?'}`); continue;
    }
    // a SID (first non-airport token) / a STAR (last)
    if (!r.enroute.length && !r.sid) { const sid = findProc(dep, 'SID', t); if (sid && (first || !db.fix(t))) { r.sid = sid.id; const nx = items[i + 1]; if (nx && sid.trans.includes(nx)) r.sidTrans = nx; continue; } }
    if (last) { const star = findProc(arr, 'STAR', t); if (star && !db.fix(t)) { r.star = star.id; const pv = r.enroute.at(-1); if (pv && pv.kind === 'FIX' && star.trans.includes(pv.fix.id)) r.starTrans = pv.fix.id; continue; } }
    if (db.enroute && db.enroute.airways[t]) { r.enroute.push({ kind: 'AWY', id: t }); continue; }
    pushFix(db, r, t, dep, arr);
  }
  // an airway needs a fix on it on each side
  r.enroute.forEach((x, k) => { if (x.kind === 'AWY' && !(r.enroute[k - 1] && r.enroute[k - 1].kind === 'FIX' && r.enroute[k + 1] && r.enroute[k + 1].kind === 'FIX')) r.errors.push(`${x.id}: an airway needs a fix before and after it`); });
  return r;
}
function pushFix(db, r, t, dep, arr) {
  const f = db.fix(t) || coordFix(t) || terminalFix(dep, t) || terminalFix(arr, t);
  if (f) { if (!(r.enroute.at(-1) && r.enroute.at(-1).kind === 'FIX' && r.enroute.at(-1).fix.id === f.id)) r.enroute.push({ kind: 'FIX', fix: f }); }
  else r.errors.push(`${t}: unknown fix, airway or procedure`);
}
// a fix that only appears in an airport's procedures
function terminalFix(apt, id) {
  if (!apt) return null;
  for (const kind of ['SID', 'STAR', 'APP']) for (const p of Object.values(apt.raw.procedures[kind] || {})) for (const legs of Object.values(p.trans)) for (const l of legs)
    if (l.fix && l.fix.id === id) return { id, lat: l.fix.lat, lon: l.fix.lon, ne: toNE(l.fix.lat, l.fix.lon), kind: 'WPT' };
  return null;
}

// Assemble the flight plan. p = { dep, arr (loaded airports), depRwy, sid, sidTrans, enroute, star, starTrans, arrRwy,
// app, appTrans }. Returns { legs, errors, dist (nm) }. Each leg keeps kind SID / ENR / STAR / APP.
export function buildPlan(db, p) {
  const legs = [], errors = [];
  const add = (list, kind) => {
    for (const l0 of list) {
      const l = { ...l0, kind: l0.kind || kind }, prev = legs.at(-1);
      if (prev && l.fix && prev.fix && prev.fix.id === l.fix.id && !/^H/.test(l.pt)) {   // the same fix twice: keep one, the later constraint
        legs[legs.length - 1] = /^H/.test(prev.pt) ? prev : { ...prev, alt: l.alt || prev.alt, spd: l.spd || prev.spd, kind: prev.kind };
        continue;
      }
      // a segment that starts with an initial fix joins the plan by a track from the previous fix (or direct to it
      // after a heading / vectors leg)
      if (prev && l.pt === 'IF') l.pt = prev.fix ? 'TF' : 'DF';
      legs.push(l);
    }
  };
  const tryP = (fn, what) => { try { return fn(); } catch (e) { errors.push(`${what}: ${e.message}`); return []; } };
  if (p.sid && p.dep) add(tryP(() => procedureLegs(p.dep, 'SID', p.sid, { rwy: p.depRwy, trans: p.sidTrans }), p.sid), 'SID');
  const en = p.enroute || [];
  for (let k = 0; k < en.length; k++) {
    const x = en[k];
    if (x.kind === 'FIX') add([fixLeg(x.fix, 'TF')], 'ENR');
    else if (x.kind === 'AWY') {
      const from = legs.at(-1) && legs.at(-1).fix ? legs.at(-1).fix.id : null, to = en[k + 1] && en[k + 1].kind === 'FIX' ? en[k + 1].fix.id : null;
      if (from && to) add(tryP(() => airwayLegs(db, x.id, from, to), `${from} ${x.id} ${to}`), 'ENR');
    }
  }
  if (p.star && p.arr) add(tryP(() => procedureLegs(p.arr, 'STAR', p.star, { trans: p.starTrans, rwy: p.arrRwy }), p.star), 'STAR');
  if (p.app && p.arr) {
    // the approach transition that begins where the route ends, unless one was chosen; with neither, and a route
    // before it, vectors to final (ATC turns the airplane onto the final approach course)
    const ap = procedureList(p.arr, 'APP').find((x) => x.id === p.app), lastFix = legs.filter((l) => l.fix).at(-1);
    const joins = ap && lastFix && ap.trans.includes(lastFix.fix.id);
    const trans = p.appTrans ?? (joins ? lastFix.fix.id : null);
    const app = tryP(() => procedureLegs(p.arr, 'APP', p.app, { trans }), p.app);
    add(lastFix && p.appTrans === undefined && !joins && !app.some((l) => l.fix && l.fix.id === lastFix.fix.id) ? vectorsToFinal(app, lastFix.fix.ne) : app, 'APP');
  }
  let dist = 0, last = null;
  for (const l of legs) if (l.fix) { if (last) dist += Math.hypot(l.fix.ne[0] - last[0], l.fix.ne[1] - last[1]) / 1852; last = l.fix.ne; }
  return { legs, errors, dist };
}

// Vectors to final: replace the approach's initial segment with an intercept of the final approach course, as ATC
// vectors. The intercept point is the fix before the final approach fix when it is 2-10 nm out (keeping its altitude),
// else a point 4 nm outside the FAF at the FAF altitude. The airplane is turned onto the course 3 nm before it, from
// a point 1.7 nm to the side it comes from (a 30 deg intercept). Everything from the intercept point on is kept.
export function vectorsToFinal(app, from) {
  const k = app.findIndex((l) => l.faf); if (k < 1) return app;
  const NM = 1852, faf = app[k], j = app.slice(0, k).map((l, i) => (l.fix ? i : -1)).filter((i) => i >= 0).at(-1), prev = j != null ? app[j] : null;
  const dPrev = prev ? Math.hypot(faf.fix.ne[0] - prev.fix.ne[0], faf.fix.ne[1] - prev.fix.ne[1]) / NM : 0;
  const crs = (faf.crsT ?? (prev ? Math.atan2(faf.fix.ne[1] - prev.fix.ne[1], faf.fix.ne[0] - prev.fix.ne[0]) * 180 / Math.PI : 0)) * Math.PI / 180;
  const u = [Math.cos(crs), Math.sin(crs)], nr = [-u[1], u[0]], deg = crs * 180 / Math.PI;
  const atAlt = (a) => (a ? { d: '@', a1: a.d === 'B' ? a.a2 : a.a1 } : null);
  let P, intercept;
  if (prev && dPrev >= 2 && dPrev <= 10) { P = prev.fix.ne; intercept = { ...prev, pt: 'TF', alt: atAlt(prev.alt) || atAlt(faf.alt), vectors: true }; }
  else { P = [faf.fix.ne[0] - u[0] * 4 * NM, faf.fix.ne[1] - u[1] * 4 * NM]; intercept = { pt: 'TF', fix: { id: 'FINAL', ne: P }, alt: atAlt(faf.alt), kind: 'APP', proc: faf.proc, vectors: true }; }
  const side = Math.sign((from[0] - P[0]) * nr[0] + (from[1] - P[1]) * nr[1]) || 1;
  const E = [P[0] - u[0] * 3 * NM + nr[0] * side * 1.7 * NM, P[1] - u[1] * 3 * NM + nr[1] * side * 1.7 * NM];
  return [{ pt: 'TF', fix: { id: 'VECTR', ne: E }, alt: null, kind: 'APP', proc: faf.proc, vectors: true }, intercept, { ...faf, pt: 'CF', crsT: faf.crsT ?? deg }, ...app.slice(k + 1)];
}

// MSFS / FSX flight plan (.pln XML): departure, destination, cruise altitude and the waypoints with their airways and
// procedures, turned into a route string for parseRoute.
export function parsePln(xml) {
  const tag = (s, t) => { const m = s.match(new RegExp(`<${t}>([^<]*)</${t}>`)); return m ? m[1].trim() : null; };
  const dep = tag(xml, 'DepartureID'), arr = tag(xml, 'DestinationID'), cruise = +(tag(xml, 'CruisingAlt') || 0) || null;
  const wps = [...xml.matchAll(/<ATCWaypoint[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/ATCWaypoint>/g)].map((m) => ({ id: m[1], type: tag(m[2], 'ATCWaypointType'), awy: tag(m[2], 'ATCAirway'), dp: tag(m[2], 'DepartureFP'), ap: tag(m[2], 'ArrivalFP'), pos: tag(m[2], 'WorldPosition') }));
  const toks = []; let sid = null, star = null;
  for (const w of wps) {
    if (w.type === 'Airport') continue;
    if (w.dp && !sid) { sid = w.dp; toks.push(w.dp); }
    if (w.ap && !star) star = w.ap;
    if (w.awy && toks.at(-1) !== w.awy) toks.push(w.awy);
    if (w.type === 'User' && w.pos) { const ll = plnPos(w.pos); if (ll) { toks.push(ll); continue; } }
    toks.push(w.id);
  }
  if (star) toks.push(star);
  return { dep, arr, cruise, route: toks.join(' ') };
}
// "N26° 40' 59.40",W80° 5' 44.16",+000019.00" -> 2641N08006W
function plnPos(s) {
  const m = s.match(/([NS])(\d+)°\s*(\d+)'\s*([\d.]+)"\s*,\s*([EW])(\d+)°\s*(\d+)'\s*([\d.]+)"/); if (!m) return null;
  const mm = (d, mi, se) => Math.round(+mi + +se / 60), pad = (n, w) => String(n).padStart(w, '0');
  return `${pad(+m[2], 2)}${pad(mm(m[2], m[3], m[4]), 2)}${m[1]}${pad(+m[6], 3)}${pad(mm(m[6], m[7], m[8]), 2)}${m[5]}`;
}
