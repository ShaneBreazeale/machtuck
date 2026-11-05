// Navigation database: the FAA CIFP converted by tools/fetch_cifp.py (data/nav). Loads airports on demand, projects
// lat/lon to the sim's local frame (metres north / east of 26.6832 N, 80.0956 W, the same projection as the imagery and
// weather data), turns magnetic courses into true, and assembles procedures (SID / STAR / approach with a transition)
// into leg lists for js/fms.js. No procedure is hand-coded: everything here comes from the data files.
const DEG = Math.PI / 180, NM = 1852, FT = 0.3048;
export const LAT0 = 26.6832, LON0 = -80.0956;
export const toNE = (lat, lon) => [(lat - LAT0) * 111320, (lon - LON0) * 111320 * Math.cos((lat + LAT0) / 2 * DEG)];
export const wrap360 = (d) => ((d % 360) + 360) % 360;

const browserLoad = (base) => (p) => fetch(base + p).then((r) => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });

export class NavDB {
  constructor({ base = 'data/nav/', load = null } = {}) { this.load = load || browserLoad(base); this.apts = new Map(); this.index = null; this.enroute = null; }
  async init() {
    [this.index, this.enroute, this.markers] = await Promise.all([this.load('index.json'), this.load('enroute.json'),
      this.load('markers.json').catch(() => null)]);   // operational ILS markers from the FAA NASR (tools/fetch_markers.py), optional
    this.byId = new Map();
    for (const w of this.enroute.waypoints) this.byId.set(w.id, { ...w, ne: toNE(w.lat, w.lon), kind: 'WPT' });
    for (const v of this.enroute.vhf) this.byId.set(v.id, { ...v, ne: toNE(v.lat, v.lon), kind: 'VOR' });   // VHF (MHz)
    for (const v of this.enroute.ndb) this.byId.set(v.id, { ...v, ne: toNE(v.lat, v.lon), kind: 'NDB' });   // NDB (kHz)
    for (const a of this.index.airports) this.byId.set(a.id, { ...a, ne: toNE(a.lat, a.lon), kind: 'APT' });
    return this;
  }
  airportList() { return this.index ? this.index.airports : []; }
  async airport(id) {
    if (this.apts.has(id)) return this.apts.get(id);
    const raw = await this.load(`apt/${id}.json`);
    const apt = { id, raw, info: raw.airport, magvar: raw.airport.magvar ?? 0, elev: raw.airport.elev ?? 0, ne: toNE(raw.airport.lat, raw.airport.lon), runways: {}, ils: {} };
    for (const [rid, r] of Object.entries(raw.runways)) apt.runways[rid] = { ...r, ne: toNE(r.lat, r.lon), brgT: wrap360(r.brgMag + apt.magvar) };
    for (const [iid, l] of Object.entries(raw.ils)) {
      const rw = apt.runways[l.runway];
      apt.ils[iid] = { ...l, ne: toNE(l.lat, l.lon), crsT: wrap360(l.brgMag + (l.decl ?? apt.magvar)), dmeNe: l.dmeLat ? toNE(l.dmeLat, l.dmeLon) : null,
        thr: rw ? rw.ne : null, thrElev: rw ? rw.elev : apt.elev, apt: id,
        markers: ((this.markers && this.markers.airports[id] || {})[iid] || []).map((m) => ({ type: m.type, ne: toNE(m.lat, m.lon), elev: m.elev ?? apt.elev })) };
    }
    this.apts.set(id, apt);
    return apt;
  }
  loaded(id) { return this.apts.get(id) || null; }
  allIls() { const o = []; for (const a of this.apts.values()) o.push(...Object.values(a.ils)); return o; }
  // a fix by ident: enroute waypoint, navaid or airport (terminal fixes come with their procedures)
  fix(id) { return this.byId ? this.byId.get(id) || null : null; }
  // a fix by ident for a direct-to: enroute fixes, navaids and airports, plus the terminal fixes and navaids of the loaded
  // airports' procedures. Idents repeat between regions: the one nearest `near` ([n, e]) wins. { id, ne } or null.
  findFix(id, near = [0, 0]) {
    id = id.trim().toUpperCase(); if (!id) return null;
    const c = []; const f = this.fix(id); if (f) c.push({ id, ne: f.ne });
    for (const a of this.apts.values()) {
      for (const n of Object.values(a.raw.navaids || {})) if (n.id === id) c.push({ id, ne: toNE(n.lat, n.lon) });
      for (const kind of Object.values(a.raw.procedures || {})) for (const p of Object.values(kind))
        for (const legs of Object.values(p.trans)) for (const l of legs) if (l.fix && l.fix.id === id) { c.push({ id, ne: toNE(l.fix.lat, l.fix.lon) }); break; }
    }
    const d = (x) => Math.hypot(x.ne[0] - near[0], x.ne[1] - near[1]);
    return c.length ? c.reduce((a, b) => (d(b) < d(a) ? b : a)) : null;
  }
}

// Assemble a procedure into legs. kind: 'SID' | 'STAR' | 'APP'; trans: the transition name (runway 'RW10L' for SIDs /
// STARs, enroute fix, or an approach transition such as 'GULLO'); rwy: runway for SID / STAR runway transitions.
// Order: SID runway -> common -> enroute transition; STAR enroute -> common -> runway; approach transition -> final.
export function procedureLegs(apt, kind, id, { trans = null, rwy = null } = {}) {
  const p = apt.raw.procedures[kind] && apt.raw.procedures[kind][id];
  if (!p) throw new Error(`${apt.id} has no ${kind} ${id}`);
  const parts = Object.entries(p.trans).map(([k, legs]) => { const [rt, t] = k.split(':'); return { rt, t, legs }; });
  const rwyPart = parts.filter((x) => /^RW/.test(x.t)), common = parts.filter((x) => x.t === '' || x.t === 'ALL'), enr = parts.filter((x) => x.t && x.t !== 'ALL' && !/^RW/.test(x.t));
  let seq = [];
  const pick = (list, name) => list.find((x) => x.t === name) || null;
  if (kind === 'APP') {
    const tr = trans ? pick(enr, trans) : null;
    const fin = parts.filter((x) => x.rt !== 'A');
    seq = [...(tr ? tr.legs : []), ...fin.flatMap((x) => x.legs)];
  } else {
    const r = rwy ? pick(rwyPart, rwy.startsWith('RW') ? rwy : 'RW' + rwy) || rwyPart.find((x) => x.t.startsWith((rwy.startsWith('RW') ? rwy : 'RW' + rwy).replace(/[LRC]$/, '') + 'B')) : null;
    const e = trans ? pick(enr, trans) : null;
    seq = kind === 'SID' ? [...(r ? r.legs : []), ...common.flatMap((x) => x.legs), ...(e ? e.legs : [])] : [...(e ? e.legs : []), ...common.flatMap((x) => x.legs), ...(r ? r.legs : [])];
  }
  const out = [];
  let prevRaw = null;
  for (const l0 of seq) {
    // a hold with no navaid of its own, at the fix the previous leg flew to on a navaid's course: same course reference
    const l = /^H/.test(l0.pt) && !l0.nav && prevRaw && prevRaw.nav && prevRaw.fix && l0.fix && prevRaw.fix.id === l0.fix.id ? { ...l0, nav: prevRaw.nav } : l0;
    prevRaw = l;
    const leg = resolveLeg(apt, l, kind, id);
    const prev = out[out.length - 1];
    // a transition ends where the next part begins: drop the repeated fix (keep the later leg's constraints)
    if (prev && leg.fix && prev.fix && prev.fix.id === leg.fix.id && (leg.pt === 'IF' || prev.pt === 'IF') && !/^H/.test(leg.pt)) {
      if (/^H/.test(prev.pt)) continue;                                      // a hold at the fix (course reversal) keeps its own data
      out[out.length - 1] = leg.pt === 'IF' ? { ...prev, alt: leg.alt || prev.alt } : { ...leg, alt: leg.alt || prev.alt };
      continue;
    }
    out.push(leg);
  }
  return out;
}
export function procedureList(apt, kind) {
  const ps = apt.raw.procedures[kind] || {};
  return Object.values(ps).map((p) => ({ id: p.id, trans: Object.keys(p.trans).map((k) => k.split(':')[1]).filter((t) => t && t !== 'ALL') }));
}
function resolveLeg(apt, l, kind, procId) {
  const nav = l.nav ? apt.raw.navaids[l.nav] : null;
  const decl = nav && nav.decl != null ? nav.decl : apt.magvar;   // VHF-referenced courses use the station declination
  const leg = { pt: l.pt, proc: procId, kind, turn: l.turn || null, alt: l.alt || null, spd: l.spd || null, vang: l.vang || null,
    flyover: !!(l.flags && l.flags.includes('flyover')), faf: !!(l.flags && l.flags.includes('faf')), map: !!(l.flags && l.flags.includes('map')),
    time: l.time ?? null, dist: l.dist ?? null, rho: l.rho ?? null, theta: l.theta ?? null };
  if (l.fix) leg.fix = { id: l.fix.id, ne: toNE(l.fix.lat, l.fix.lon) };
  if (l.crs != null) leg.crsT = l.crsTrue ? l.crs : wrap360(l.crs + decl);
  if (l.crs != null && !l.crsTrue) leg.crsMag = l.crs;   // as published, for display
  if (nav) leg.nav = { id: nav.id, ne: toNE(nav.lat, nav.lon) };
  if (l.ctr) leg.ctr = { id: l.ctr.id, ne: toNE(l.ctr.lat, l.ctr.lon) };
  return leg;
}
// a direct-to or enroute fix as a leg
export const fixLeg = (fx, pt = 'TF', alt = null) => ({ pt, fix: { id: fx.id, ne: fx.ne }, alt, kind: 'ENR', proc: null, turn: null });
// airway legs between two fixes on it
export function airwayLegs(db, awy, from, to) {
  const pts = db.enroute.airways[awy]; if (!pts) throw new Error(`no airway ${awy}`);
  const i = pts.findIndex((p) => p.id === from), j = pts.findIndex((p) => p.id === to);
  if (i < 0 || j < 0) throw new Error(`${awy} does not join ${from} and ${to}`);
  const seg = i < j ? pts.slice(i + 1, j + 1) : pts.slice(j, i).reverse();
  return seg.map((p) => ({ pt: 'TF', fix: { id: p.id, ne: toNE(p.lat, p.lon) }, alt: null, kind: 'ENR', proc: awy, turn: null }));
}
