// Flight management: one engine that flies any ARINC 424 leg sequence (procedures from js/navdb.js, airways, direct-to)
// and gives the autopilot / flight director a track or heading to fly and a vertical target. Nothing airport-specific.
//
// Leg types (path terminators): IF initial fix; TF track to fix; CF course to fix; DF direct to fix; CA / FA / VA course,
// course-from-fix or heading to an altitude; CD / FD / VD to a DME distance; CI / VI course or heading to intercept the
// next leg; FM / VM manual termination; RF radius-to-fix arc; AF DME arc; HF / HA / HM holds (one circuit, to an
// altitude, until manually terminated), entered direct, teardrop or parallel by the standard 70 / 110 deg sectors.
// Fly-by fixes are turned early by the turn radius (25 deg bank); fly-over fixes are crossed first; a published turn
// direction is respected. Altitude constraints: '@' at, '+' at or above, '-' at or below, 'B' between, and the
// glideslope / step-down codes (G I X at; H J V at or above; Y at or below).
const DEG = Math.PI / 180, NM = 1852, FT = 0.3048, G = 9.81;
const wrap360 = (d) => ((d % 360) + 360) % 360, wrap180 = (d) => ((d + 540) % 360) - 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const brg = (a, b) => wrap360(Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG);
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
// position relative to a path through `fix` along course `crs` (deg true): metres to go, metres right of the path
function rel(pos, fix, crs) {
  const u = [Math.cos(crs * DEG), Math.sin(crs * DEG)], d = [fix[0] - pos[0], fix[1] - pos[1]];
  return { togo: d[0] * u[0] + d[1] * u[1], cross: -(-d[0] * u[1] + d[1] * u[0]) };
}
const intercept = (crs, cross, k = 0.012, cap = 45) => wrap360(crs - clamp(cross * k, -cap, cap));   // steer back onto a path

export class FMS {
  constructor() { this.legs = []; this.i = 0; this.from = null; this.hold = null; this.events = []; this.turnDir = 0; this.bank = 25; this.cruise = null; this.descending = false; this.atcVectors = true; }
  load(legs, i = 0, cruise = null) { this.legs = legs; this.cruise = cruise; this.descending = false; this.activate(i, null); }
  get active() { return this.legs[this.i] || null; }
  get next() { return this.legs[this.i + 1] || null; }
  activate(i, pos) {
    this.i = i; this.hold = null; this.legT = 0; this.turnDir = 0; this.lastX = null;
    const leg = this.legs[i]; if (!leg) return;
    // the path of a TF leg starts at the previous fix (or where the airplane is)
    const prev = this.legs[i - 1];
    this.from = prev && prev.fix ? prev.fix.ne : pos;
    if (leg.turn && pos && !/^H/.test(leg.pt)) this.turnDir = leg.turn === 'L' ? -1 : 1;   // published turn direction: the first turn of the leg goes that way
    this.events.push({ type: 'leg', i, leg });
  }
  // Direct to a fix (the pilot's DIR key, or ATC). fx = { id, ne }. A fix the plan ends a leg at, ahead (missed approach
  // included), is flown direct and the legs before it are dropped from the active sequence; any other fix is inserted
  // ahead of the plan, which resumes from it. The leg keeps its altitude constraint and approach flags (FAF, MAP, the
  // localizer); a published turn direction is cleared: the pilot asked for the short way. Holds stay holds: the direct
  // goes to the holding fix and the entry follows. Returns the index of the direct leg.
  directTo(fx, pos) {
    const ends = (l) => l.fix && /^(IF|TF|CF|DF|RF|AF|HA|HF|HM)$/.test(l.pt);
    let k = this.legs.findIndex((l, j) => j >= this.i && ends(l) && l.fix.id === fx.id);
    const leg = k >= 0 ? this.legs[k] : null;
    const df = { ...(leg || { kind: 'ENR', proc: null, alt: null }), pt: 'DF', fix: leg ? leg.fix : { id: fx.id, ne: fx.ne }, turn: null, flyover: false, direct: true };
    if (leg && !/^H/.test(leg.pt)) this.legs[k] = df;
    else {
      if (!leg) { k = this.i; const cur = this.legs[k]; if (cur && !ends(cur)) this.legs.splice(k, 1); }   // a heading, altitude or vector leg is over
      this.legs.splice(k, 0, df);
    }
    this.activate(k, pos);
    return k;
  }
  // A fix inserted before leg k (the CDU): the plan flies to it, then on to leg k. At the active leg it becomes the
  // active leg (flown from the previous fix, or direct from where the airplane is). Returns k.
  insertFix(k, fx, pos) {
    k = Math.max(this.i, Math.min(k, this.legs.length));
    this.legs.splice(k, 0, { pt: 'TF', fix: { id: fx.id, ne: fx.ne }, alt: null, kind: 'ENR', proc: null, turn: null, inserted: true });
    if (k === this.i) this.activate(k, pos);
    return k;
  }
  // Delete leg k (the CDU); the active leg can't be deleted (use direct-to). The next leg is then flown from the fix
  // before the deleted one. Returns true if deleted.
  deleteLeg(k) {
    if (k <= this.i || k >= this.legs.length) return false;
    this.legs.splice(k, 1);
    return true;
  }

  legCourse(leg, fromNe) {
    if (!leg) return null;
    if (leg.pt === 'TF' && leg.fix && fromNe) return brg(fromNe, leg.fix.ne);
    if (leg.crsT != null && /^(CF|CA|FA|CD|FD|CI|VA|VI|VM|VD|FM)$/.test(leg.pt)) return leg.crsT;
    return null;
  }
  // index of the missed-approach point and the legs after it
  mapIndex() { return this.legs.findIndex((l) => l.map); }
  fafIndex() { return this.legs.findIndex((l) => l.faf); }
  // highest altitude the missed approach climbs to (ft), or null
  missedAlt() { const a = this.missedLegs().filter((l) => l.alt).map((l) => l.alt.a1); return a.length ? Math.max(...a) : null; }
  // the ILS the loaded approach is flown on (its final legs reference the localizer), or null
  approachNav() { const k = this.fafIndex(); const l = k >= 0 ? this.legs[k] : null; return l && l.nav ? l.nav.id : null; }

  // ctx: { ne:[n,e], h (ft MSL), trk, hdg (deg true), gs (m/s), dt }. Returns { trk | hdg, turnDir, alt }.
  update(ctx) {
    const leg = this.active; if (!leg) return null;
    this.legT += ctx.dt;
    const R = Math.max(500, ctx.gs * ctx.gs / (G * Math.tan(this.bank * DEG)));
    // radar vectors (a heading or course to manual termination, FM / VM): in the sim, ATC clears the airplane direct
    // to the next fix after a minute
    if (this.atcVectors && (leg.pt === 'FM' || leg.pt === 'VM') && this.legT > 60) {
      const k = this.legs.findIndex((l, j) => j > this.i && l.fix);
      if (k > 0) { this.events.push({ type: 'atc', txt: `proceed direct ${this.legs[k].fix.id}` }); this.directTo(this.legs[k].fix, ctx.ne); return this.update({ ...ctx, dt: 0 }); }
    }
    const had = this.turnDir;
    let g = this.guide(leg, ctx, R);
    // published turn direction: hold it until close to the wanted track (not on the step that ordered the turn)
    if (had && this.turnDir === had && g) { const want = g.trk ?? g.hdg, now = g.trk != null ? ctx.trk : ctx.hdg; if (Math.abs(wrap180(want - now)) < 30) this.turnDir = 0; }
    if (g && g.done) { this.activate(this.i + 1, ctx.ne); return this.update({ ...ctx, dt: 0 }); }
    if (g) g.turnDir = this.turnDir || g.turnDir || 0;
    this.last = g;
    return g;
  }
  guide(leg, ctx, R) {
    const pos = ctx.ne, pt = leg.pt;
    const nextCrs = () => this.legCourse(this.next, leg.fix ? leg.fix.ne : null);
    const lead = (crs) => { const n = nextCrs(); if (leg.flyover || n == null || crs == null) return 0; const d = Math.min(120, Math.abs(wrap180(n - crs))); return R * Math.tan(d / 2 * DEG); };
    switch (pt) {
      case 'IF': case 'TF': case 'CF': case 'DF': {
        if (!leg.fix) return { done: true };
        let crs;
        if (pt === 'DF' || (pt === 'IF') || (pt === 'TF' && !this.from)) crs = brg(pos, leg.fix.ne);
        else if (pt === 'TF') crs = brg(this.from, leg.fix.ne);
        else crs = leg.crsT ?? brg(pos, leg.fix.ne);
        const r = rel(pos, leg.fix.ne, crs);
        const direct = pt === 'DF' || pt === 'IF' || (pt === 'TF' && !this.from);
        const trk = direct ? crs : intercept(crs, r.cross);
        const done = r.togo < Math.max(lead(crs), leg.flyover ? 0 : 30) || (direct && dist(pos, leg.fix.ne) < 150);
        return { trk, done, togo: r.togo, xtk: direct ? 0 : r.cross };
      }
      case 'CA': case 'VA': case 'FA': {
        const done = leg.alt && ctx.h >= leg.alt.a1 - 20;
        return pt === 'VA' ? { hdg: leg.crsT, done } : { trk: leg.crsT, done };
      }
      case 'CD': case 'FD': case 'VD': {
        const ref = leg.nav ? leg.nav.ne : leg.fix ? leg.fix.ne : pos;
        const done = leg.dist != null && dist(pos, ref) / NM >= leg.dist;
        return pt === 'VD' ? { hdg: leg.crsT, done } : { trk: leg.crsT, done };
      }
      case 'CI': case 'VI': {   // fly the course / heading until the next leg's path is within the turn's reach
        const n = this.next, nc = this.legCourse(n, n && n.fix ? n.fix.ne : null);
        let done = !n;
        if (n && n.fix && nc != null) {
          const r = rel(pos, n.fix.ne, nc), cut = Math.abs(wrap180((leg.crsT ?? nc) - nc));
          done = Math.abs(r.cross) < Math.max(150, R * (1 - Math.cos(cut * DEG))) || (this.lastX != null && Math.sign(this.lastX) !== Math.sign(r.cross));
          this.lastX = r.cross;
        } else if (n && n.fix) done = true;
        if (done) this.lastX = null;
        return pt === 'VI' ? { hdg: leg.crsT, done } : { trk: leg.crsT, done };
      }
      case 'FM': case 'VM': return pt === 'VM' ? { hdg: leg.crsT, done: false } : { trk: leg.crsT, done: false };
      case 'RF': case 'AF': {   // arcs: constant radius about the centre (RF) or the DME navaid (AF)
        const c = pt === 'RF' ? leg.ctr && leg.ctr.ne : leg.nav && leg.nav.ne;
        if (!c || !leg.fix) return { done: true };
        const r0 = pt === 'RF' ? dist(c, leg.fix.ne) : (leg.rho ?? dist(c, leg.fix.ne) / NM) * NM;
        const dir = leg.turn === 'L' ? -1 : 1, b = brg(c, pos), e = dist(c, pos) - r0;
        const trk = wrap360(b + dir * 90 + dir * clamp(e * 0.012, -45, 45));
        const rem = wrap360(dir * (brg(c, leg.fix.ne) - b));   // degrees of arc still to fly
        const done = rem < Math.max(1, lead(wrap360(brg(c, leg.fix.ne) + dir * 90)) / r0 / DEG) || rem > 300;
        return { trk, done, xtk: -dir * e };
      }
      case 'HF': case 'HA': case 'HM': return this.holdGuide(leg, ctx, R);
      default:   // anything else: go to its fix if it has one
        if (leg.fix) return { trk: brg(pos, leg.fix.ne), done: dist(pos, leg.fix.ne) < 300 };
        return { done: true };
    }
  }
  // Holding: inbound course leg.crsT to the fix, turns leg.turn (default right), leg time (min) or distance (nm).
  holdGuide(leg, ctx, R) {
    const pos = ctx.ne, c = leg.crsT ?? brg(pos, leg.fix.ne), o = wrap360(c + 180), dir = leg.turn === 'L' ? -1 : 1;
    const r = rel(pos, leg.fix.ne, c);   // r.cross: right of the inbound course
    const legSec = leg.dist ? leg.dist * NM / Math.max(50, ctx.gs) : (leg.time || (ctx.h < 14000 ? 1 : 1.5)) * 60;
    let H = this.hold;
    if (!H) {   // not yet at the fix: fly to it, then pick the entry from the track on arrival
      if (dist(pos, leg.fix.ne) > Math.max(400, R * 0.3) && r.togo > -200) return { trk: brg(pos, leg.fix.ne), done: false };
      const x = wrap180(ctx.trk - c);
      const entry = dir > 0 ? (x >= -110 && x <= 70 ? 'direct' : x > 70 ? 'teardrop' : 'parallel') : (x >= -70 && x <= 110 ? 'direct' : x < -70 ? 'teardrop' : 'parallel');
      H = this.hold = { phase: entry === 'direct' ? 'turnOut' : entry, t: 0, entry, laps: 0 };
      if (entry === 'direct') this.turnDir = dir;
      this.events.push({ type: 'hold', entry, leg });
    }
    H.t += ctx.dt;
    const D = 2 * R;   // the outbound leg runs one turn diameter out on the holding side
    switch (H.phase) {
      case 'teardrop': if (H.t > legSec) { H.phase = 'turnIn'; this.turnDir = dir; } return { hdg: wrap360(o - 30 * dir), done: false };
      case 'parallel': if (H.t > legSec) { H.phase = 'entryTurn'; this.turnDir = -dir; } return { trk: o, done: false };
      case 'entryTurn': if (!this.turnDir) H.phase = 'inbound'; return { hdg: wrap360(c - 45 * dir), done: false };
      case 'turnOut': if (!this.turnDir) { H.phase = 'outbound'; H.t = 0; } return { hdg: o, done: false };
      case 'outbound': {
        const want = dir * D, rr = rel(pos, leg.fix.ne, c);   // holding side: right of the inbound course for right turns
        if (H.t > legSec) { H.phase = 'turnIn'; this.turnDir = dir; }
        return { trk: wrap360(o + clamp((rr.cross - want) * 0.008, -20, 20) * 1), done: false };
      }
      case 'turnIn': if (!this.turnDir) H.phase = 'inbound'; return { hdg: c, done: false };
      case 'inbound': {
        if (r.togo <= 0) {   // over the fix: exit (HF after a circuit, HA at its altitude) or go round again
          H.laps++;
          if (leg.pt === 'HF' || (leg.pt === 'HA' && leg.alt && ctx.h >= leg.alt.a1 - 50)) return { trk: c, done: true };
          H.phase = 'turnOut'; this.turnDir = dir; return { hdg: o, done: false };
        }
        return { trk: intercept(c, r.cross), done: false, xtk: r.cross };
      }
    }
    return { trk: c, done: false };
  }

  // ---- vertical: the altitude to be at now, from the constraints ahead (ft MSL), and a path climb / descent rate ----
  // Climb toward the next at / at-or-above constraint; descend on the path (3 deg, or the leg's vertical angle) to the
  // next at / at-or-below one, never below an at-or-above constraint still ahead of it.
  // With a cruise level (a route): climb to it, bounded by any at-or-below departure constraint still ahead, and hold
  // it until the descent path to the arrival constraints comes down to it (top of descent).
  vertical(ctx) {
    const r = this.constraintTarget(ctx), c = this.cruise;
    if (!c) return r;
    const arr = this.legs.findIndex((l) => l.kind === 'STAR' || l.kind === 'APP');
    if (arr >= 0 && this.i >= arr) this.descending = true;
    if (this.descending) return r;
    if (r && r.path != null && r.path < Math.min(ctx.h, c) - 30) { this.descending = ctx.h > c - 1000; return r; }
    if (r && r.path == null && r.alt > ctx.h + 50) return r;                       // a climb constraint
    let ceil = c;
    for (let k = this.i; k < (arr >= 0 ? arr : this.legs.length); k++) { const a = this.legs[k].alt; if (a && (a.d === '-' || a.d === '@' || a.d === 'B' || a.d === 'Y' || a.d === 'X' || !a.d)) { ceil = Math.min(ceil, a.d === 'B' ? a.a1 : a.a1); break; } }
    return { alt: Math.max(Math.min(c, ceil, r && r.path != null ? Math.max(r.path, ctx.h) : c), Math.min(ctx.h, c)) };
  }
  constraintTarget(ctx) {
    const pos = ctx.ne; let along = 0, last = pos, floor = -Infinity;
    for (let k = this.i; k < this.legs.length; k++) {
      const l = this.legs[k];
      if (l.fix) { along += dist(last, l.fix.ne); last = l.fix.ne; }
      if (!l.alt) continue;
      const a = l.alt, d = a.d, a1 = a.a1, a2 = a.a2 ?? a1;
      if (/^(CA|FA|VA|HA)$/.test(l.pt)) return { alt: Math.max(a1, floor), vs: null, fix: l, along };   // climbs (missed approach, departures)
      // ARINC 424 descriptions: + / V / H / J at or above alt1; - / Y at or below; B between; @, blank, X, G, I at alt1
      const atOrAbove = d === '+' || d === 'V' || d === 'H' || d === 'J', atOrBelow = d === '-' || d === 'Y', between = d === 'B';
      const lo = between ? a2 : atOrBelow ? -Infinity : a1, hi = between ? a1 : atOrAbove ? Infinity : a1;
      if (ctx.h < lo - 50) return { alt: lo, vs: null, fix: l, along };              // climb to it
      if (ctx.h > hi + 50 && Number.isFinite(hi)) {                                  // descend on a path to it
        const ang = Math.abs(l.vang || 3), path = hi + along / FT * Math.tan(ang * DEG);
        return { alt: Math.max(hi, floor), path: Math.max(path, floor), ang, fix: l, along };
      }
      if (atOrAbove) floor = Math.max(floor, a1);
      if (Number.isFinite(lo) && !atOrAbove && !between) return { alt: a1, fix: l, along };   // already there: hold it
    }
    return null;
  }
  // the legs after the missed-approach point (for display / go-around)
  missedLegs() { const m = this.mapIndex(); return m >= 0 ? this.legs.slice(m + 1) : []; }
}
