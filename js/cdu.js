// The flight-plan computer's control display unit: a Collins CDU-4200 of the FMS-4200 (Pro Line 4), on the pedestal and
// in a 2D pop-out you can type into. It runs the FMS of js/fms.js.
//
// Sources: the FMS-4200 pilot's guide (Rockwell Collins, 2nd edition, 15 Dec 1999) for the key set, the page names and
// the workflow: a change builds a MOD flight plan, the EXEC key lights, and nothing changes in flight until EXEC is
// pressed (CANCEL MOD drops it); flight plans are VIA / TO lines on the FPLN pages and waypoints on the LEGS pages;
// direct-to goes through the DIR INTC key and the LEGS page. Only the guide's front matter was available, so the exact
// line positions and labels inside each page are modelled on Collins conventions, not copied from the guide. The key
// layout follows the CDU painted on the cockpit model's pedestal. Pages the sim has nothing behind (FIX, SEC FPLN,
// RADIO, the MFD keys) answer NOT AVAILABLE.
//
// Screen: 24 columns x 14 rows: the title / mode line (ACT or MOD, page n/m), six pairs of a small label line and a
// data line beside the line-select keys L1-L6 / R1-R6, and the scratchpad, where messages also show (MSG lights).
// Every key is a js/panel.js control `cdu_<key>`; CDU.KEYS lists them.

import { FMS } from './fms.js';

const NM = 1852;
// keys, as laid out on the unit: two rows of page keys under the screen, the letters, the numbers with PREV / NEXT and
// EXEC, and a bottom row
export const FN = [['INDEX', 'FPLN', 'LEGS', 'DEPARR', 'PERF', 'VNAV'], ['DIR', 'FIX', 'HOLD', 'PROG', 'SECFPLN', 'RADIO']];
const BOTTOM = ['MFDMENU', 'MFDDATA', 'MFDADV', 'MSG', 'UP', 'DOWN'];
const NAVK = ['PREV', 'NEXT', 'EXEC'];
const LABEL = { INDEX: 'INDEX', FPLN: 'FPLN', LEGS: 'LEGS', DEPARR: 'DEP\nARR', PERF: 'PERF', VNAV: 'VNAV', DIR: 'DIR\nINTC', FIX: 'FIX', HOLD: 'HOLD', PROG: 'PROG',
  SECFPLN: 'SEC\nFPLN', RADIO: 'RADIO', MFDMENU: 'MFD\nMENU', MFDDATA: 'MFD\nDATA', MFDADV: 'MFD\nADV', MSG: 'MSG', UP: '↑', DOWN: '↓', PREV: 'PREV\nPAGE', NEXT: 'NEXT\nPAGE', EXEC: 'EXEC' };
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(['SP', '/', 'DEL', 'CLR']);
const NUM = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '+/-'];
const C = { white: '#f2f4f6', cyan: '#4fd8ff', green: '#4dff7a', magenta: '#ff5cf0', amber: '#ffb000', dim: '#7d8b99' };
const brg = (a, b) => ((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI) + 360) % 360;
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const pad3 = (d) => String(Math.round(((d % 360) + 360) % 360) || 360).padStart(3, '0');
const hhmm = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`; };
const fl = (v) => (v >= 18000 ? `FL${String(Math.round(v / 100)).padStart(3, '0')}` : String(Math.round(v)));
const altText = (a) => (!a ? '' : a.d === 'B' ? `${fl(a.a2)}A${fl(a.a1)}B` : fl(a.a1) + (/[+HJV]/.test(a.d) ? 'A' : /[-Y]/.test(a.d) ? 'B' : ''));
const NOT_AVAIL = new Set(['FIX', 'SECFPLN', 'RADIO', 'MFDMENU', 'MFDDATA', 'MFDADV']);
const T = (t, c = C.green, extra = {}) => ({ t, c, ...extra });
// short approach names for the two-column lists: ILS 18R, LOC 08L, RNV Y 10L (RNAV GPS), RNP Z 35R (RNAV RNP)
const short = (n) => n.replace('RNAV (GPS) ', 'RNV ').replace('RNAV (RNP) ', 'RNP ').replace('ILS OR LOC ', 'ILS ').replace(/ ?RWY /, ' ').replace(/\s+/g, ' ').trim();

export class CDU {
  // ctx: { G() game state, findFix(id, ne), log(text), magvar(), airwayLegs(awy, fromFix, toFix) -> legs | null,
  //        procedures(aptId, kind) -> [{ id }], procName(id), replan(changes) -> { legs } | null (the plan rebuilt from the
  //        sortie choices with changes), onExec(changes) (after EXEC, when the sortie choices changed), cycle() }
  constructor(ctx) { this.ctx = ctx; this.page = 'FPLN'; this.n = 0; this.scratch = ''; this.msg = ''; this.msgs = []; this.unread = false; this.mod = null; this.hits = []; }
  static get KEYS() {
    const k = [];
    for (let i = 1; i <= 6; i++) k.push(`L${i}`, `R${i}`);
    return k.concat(FN.flat(), BOTTOM, NAVK, ALPHA, NUM, ['SCREEN']);
  }
  static label(key) { return /^[LR]\d$/.test(key) ? `Line select ${key}` : LABEL[key] ? `${LABEL[key].replace('\n', ' ')} key` : key === 'SP' ? 'Space' : key === 'CLR' ? 'Clear' : key === 'DEL' ? 'Delete' : `Key ${key}`; }

  get fms() { const G = this.ctx.G(); return G && G.fms; }
  ne() { const G = this.ctx.G(); return [G.ac.pos[0], G.ac.pos[1]]; }
  say(m) { this.msg = m; this.msgs.unshift({ m, t: Date.now() }); this.msgs.length = Math.min(this.msgs.length, 12); this.unread = true; }
  go(page) { this.page = page; this.n = 0; }

  // ---- the working plan: the MOD one while there is one, else the active one ----
  get plan() { const F = this.fms; return this.mod ? this.mod : F ? { legs: F.legs, i: F.i } : null; }
  // a scratch FMS on a copy of the plan runs the FMS's own edits (direct-to, insert, delete) into the MOD
  edit(fn, changes) {
    const F = this.fms; if (!F) { this.say('NO FLIGHT PLAN'); return false; }
    const W = new FMS(), base = this.mod || { legs: F.legs, i: F.i };
    W.legs = base.legs.map((l) => ({ ...l })); W.i = base.i; W.cruise = this.mod ? this.mod.cruise : F.cruise;
    if (fn(W) === false) return false;
    this.mod = { legs: W.legs, i: W.i, cruise: W.cruise, changes: { ...(this.mod && this.mod.changes), ...changes } };
    return true;
  }
  exec() {
    const F = this.fms; if (!this.mod || !F) { this.say('NO MOD FPLN'); return; }
    const M = this.mod; this.mod = null;
    F.legs = M.legs; F.cruise = M.cruise; F.activate(Math.min(M.i, F.legs.length - 1), this.ne());
    if (M.changes && Object.keys(M.changes).length && this.ctx.onExec) this.ctx.onExec(M.changes);
    this.ctx.log('FMS: MOD FPLN executed (CDU)');
  }
  // a fix for a typed ident: one in the plan ahead, else the nav database (nearest)
  fixFor(id) {
    const P = this.plan, inPlan = P && P.legs.slice(P.i).find((l) => l.fix && l.fix.id === id);
    return inPlan ? inPlan.fix : this.ctx.findFix(id, this.ne());
  }

  // ---- keys ----
  press(key) {
    if (/^[LR]\d$/.test(key)) return this.lsk(key[0], +key[1]);
    if (key === 'EXEC') return this.exec();
    if (key === 'PREV' || key === 'UP') { this.n = Math.max(0, this.n - 1); return; }
    if (key === 'NEXT' || key === 'DOWN') { this.n++; return; }
    if (key === 'MSG') { this.unread = false; this.go('MSG'); return; }
    if (NOT_AVAIL.has(key)) { this.say(`${LABEL[key].replace('\n', ' ')} NOT AVAILABLE`); return; }
    if (LABEL[key]) { this.go(key); return; }
    if (this.msg) this.msg = '';
    if (key === 'CLR') { this.scratch = this.scratch === 'DELETE' ? '' : this.scratch.slice(0, -1); return; }
    if (key === 'DEL') { this.scratch = this.scratch === '' ? 'DELETE' : this.scratch === 'DELETE' ? '' : this.scratch; return; }
    if (this.scratch === 'DELETE') this.scratch = '';
    if (key === '+/-') { this.scratch = /-$/.test(this.scratch) ? this.scratch.slice(0, -1) + '+' : /\+$/.test(this.scratch) ? this.scratch.slice(0, -1) + '-' : this.scratch + '-'; return; }
    if (this.scratch.length < 22) this.scratch += key === 'SP' ? ' ' : key;
  }
  // the physical keyboard, while the 2D pop-out has focus
  type(e) {
    const k = e.key;
    if (k === 'Backspace') this.press('CLR');
    else if (k === 'Delete') this.press('DEL');
    else if (k === ' ') this.press('SP');
    else if (k === 'Enter') this.press('EXEC');
    else if (k === 'PageUp') this.press('PREV');
    else if (k === 'PageDown') this.press('NEXT');
    else if (/^[a-zA-Z0-9./]$/.test(k)) this.press(k.toUpperCase());
    else if (k === '-' || k === '+') this.press('+/-');
    else return false;
    return true;
  }
  lsk(side, i) {
    const p = this.pages()[this.page]; if (!p) return;
    const fn = (side === 'L' ? p.left : p.right) || {};
    if (fn[i]) fn[i].call(this); else this.say('INVALID ENTRY');
  }
  take() { return this.scratch.trim(); }
  done() { this.scratch = ''; return true; }

  // ---- the pages ----
  pages() {
    return { INDEX: this.indexPage(), FPLN: this.fplnPage(), LEGS: this.legsPage(), DIR: this.dirPage(), DEPARR: this.depArrPage(),
      DEPART: this.procPage('DEP'), ARRIVAL: this.procPage('ARR'), PERF: this.perfPage(), VNAV: this.vnavPage(), PROG: this.progPage(),
      HOLD: this.holdPage(), MSG: this.msgPage(), STATUS: this.statusPage(), DATABASE: this.dbPage() };
  }
  // with a MOD: <CANCEL MOD on L6
  modLine(r6) { return this.mod ? ['', '', T('<CANCEL MOD', C.white), r6 || ''] : null; }
  indexPage() {
    const self = this, items = [['STATUS', 'STATUS'], ['POS INIT', null], ['FMS CTL', null], ['ROUTE MENU', null], ['DATA BASE', 'DATABASE'], ['DEFAULTS', null]];
    const right = [['FPLN', 'FPLN'], ['LEGS', 'LEGS'], ['DEP/ARR', 'DEPARR'], ['PERF', 'PERF'], ['PROG', 'PROG'], ['HOLD', 'HOLD']];
    const left = {}, rgt = {};
    items.forEach(([, to], k) => { left[k + 1] = function () { if (to) self.go(to); else self.say('NOT AVAILABLE'); }; });
    right.forEach(([, to], k) => { rgt[k + 1] = function () { self.go(to); }; });
    return { left, right: rgt, build() {
      return { title: 'INDEX', lines: items.map(([t, to], k) => ['', '', T(`<${t}`, to ? C.white : C.dim), T(`${right[k][0]}>`, C.white)]) };
    } };
  }
  // VIA / TO lines from the plan: consecutive legs with the same via (a SID, airway, STAR or approach name; DIRECT for a
  // fix on its own) make one line, TO being its last fix
  viaTo(P) {
    const rows = [];
    for (let j = P.i; j < P.legs.length; j++) {
      const l = P.legs[j]; if (!l.fix || l.fix.id === 'VECTR' || /^H/.test(l.pt)) continue;
      const via = l.kind === 'ENR' ? (l.proc || 'DIRECT') : (l.proc || l.kind);
      const last = rows.at(-1);
      if (last && last.via === via && via !== 'DIRECT') { last.to = l.fix.id; last.j1 = j; } else rows.push({ via, to: l.fix.id, j0: j, j1: j });
    }
    return rows;
  }
  fplnPage() {
    const self = this;
    // page 1: ORIGIN / DEST, ROUTE / DIST, ALTN / ORIG RWY, then two VIA / TO lines; later pages: five each
    const rowsOn = () => { const P = self.plan; return P ? self.viaTo(P) : []; };
    const slot = (i) => (self.n === 0 ? (i >= 4 && i <= 5 ? i - 4 : -1) : 2 + (self.n - 1) * 5 + i - 1);
    const left = {}, right = {};
    for (let i = 1; i <= 5; i++) {
      left[i] = function () {
        if (slot(i) < 0) return self.say('NOT AVAILABLE');   // ORIGIN / ROUTE / ALTN: set on the sortie screen
        const R = rowsOn(), k = slot(i), r = R[k], s = self.take();
        if (s === 'DELETE') { if (!r) return self.say('INVALID DELETE'); return self.edit((W) => { if (r.j0 <= W.i) { self.say('INVALID DELETE'); return false; } W.legs.splice(r.j0, r.j1 - r.j0 + 1); }) && self.done(); }
        if (!s) { if (r) self.scratch = r.via; return; }
        if (!/^[A-Z]{1,2}\d{1,4}$/.test(s)) return self.say('INVALID ENTRY');   // an airway: J45, V3, Q87, A315
        self.pendingVia = { awy: s }; self.done(); self.msg = `${s}: ENTER TO WPT`;
      };
      right[i] = function () {
        if (slot(i) < 0) return self.say('NOT AVAILABLE');
        const R = rowsOn(), k = slot(i), r = R[k], s = self.take();
        if (!s) { if (r) self.scratch = r.to; return; }
        const fx = self.fixFor(s); if (!fx) return self.say('NOT IN DATA BASE');
        const pv = self.pendingVia; self.pendingVia = null; self.msg = '';
        if (pv) {   // the airway from the previous TO to this fix
          const prev = R[(r ? k : R.length) - 1], from = prev ? self.plan.legs[prev.j1].fix : null;
          const legs = from && self.ctx.airwayLegs(pv.awy, from, fx);
          if (!legs || !legs.length) return self.say('NOT ON AIRWAY');
          return self.edit((W) => { W.legs.splice(r ? r.j0 : self.insertAt(W), 0, ...legs.filter((l) => l.fix.id !== from.id)); }) && self.done();
        }
        self.edit((W) => { W.insertFix(r ? r.j0 : self.insertAt(W), fx, self.ne()); }) && self.done();
      };
    }
    left[6] = function () { if (self.mod) { self.mod = null; self.pendingVia = null; } else self.say('SEC FPLN NOT AVAILABLE'); };
    right[6] = function () { self.go('PERF'); };
    return { left, right, build() {
      const P = self.plan, f = self.ctx.G().free || {}, R = P ? self.viaTo(P) : [];
      let total = 0; if (P) { let at = self.ne(); for (let j = P.i; j < P.legs.length; j++) { const l = P.legs[j]; if (l.fix) { total += dist(at, l.fix.ne); at = l.fix.ne; } if (l.map) break; } }
      const pages = 1 + Math.max(0, Math.ceil((R.length - 2) / 5)); self.n = Math.min(self.n, pages - 1);
      const vt = (r) => (r ? ['VIA', 'TO', T(r.via), T(r.to, r.j0 <= P.i && r.j1 >= P.i ? C.magenta : C.green)] : ['VIA', 'TO', T('-----', C.dim), T('-----', C.dim)]);
      const lines = [];
      if (self.n === 0) {
        lines.push(['ORIGIN', 'DEST', T(f.apt || '----', f.apt ? C.green : C.dim), T(f.arr || '----', f.arr ? C.green : C.dim)]);
        lines.push(['ROUTE', 'DIST', T('--------', C.dim), T(P ? String(Math.round(total / NM)) : '----')]);
        lines.push(['ALTN', 'ORIG RWY', T('----', C.dim), T(f.rwy ? `RW${f.rwy}` : '---', f.rwy ? C.green : C.dim)]);
        lines.push(vt(R[0])); lines.push(vt(R[1]));
      } else for (let i = 0; i < 5; i++) lines.push(vt(R[2 + (self.n - 1) * 5 + i]));
      lines.push(self.modLine(T('PERF INIT>', C.white)) || ['', '', T('<SEC FPLN', C.dim), T('PERF INIT>', C.white)]);
      return { title: `${self.mod ? 'MOD' : 'ACT'} FPLN`, pageNum: `${self.n + 1}/${pages}`, lines };
    } };
  }
  // where a fix added after the last line goes: before the STAR and approach if there are any, else at the end
  insertAt(W) { const k = W.legs.findIndex((l, j) => j >= W.i && (l.kind === 'STAR' || l.kind === 'APP')); return k >= 0 ? k : W.legs.length; }
  // the legs: course / distance above, ident (magenta: active), speed / altitude right. L: an empty scratchpad copies
  // the ident; an ident on L1 of page 1 goes direct, on any other line is inserted before it; DELETE removes it.
  // R: an altitude (5000, FL240, 5000A at or above, 5000B at or below; a speed first: 250/10000) or DELETE
  legsPage() {
    const self = this, rows = () => { const P = self.plan; return P ? P.legs.map((l, j) => ({ l, j })).filter(({ l, j }) => j >= P.i && l.fix) : []; };
    const rowAt = (i) => rows()[self.n * 5 + i - 1];
    const left = {}, right = {};
    for (let i = 1; i <= 5; i++) {
      left[i] = function () {
        const r = rowAt(i), s = self.take();
        if (!self.fms) return self.say('NO FLIGHT PLAN');
        if (!s) { if (r) self.scratch = r.l.fix.id; return; }
        if (s === 'DELETE') { if (!r) return self.say('INVALID DELETE'); return self.edit((W) => { if (!W.deleteLeg(r.j)) { self.say('INVALID DELETE'); return false; } }) && self.done(); }
        const fx = self.fixFor(s); if (!fx) return self.say('NOT IN DATA BASE');
        if (self.n === 0 && i === 1) self.edit((W) => { W.directTo(fx, self.ne()); }) && self.done();
        else self.edit((W) => { W.insertFix(r ? r.j : self.insertAt(W), fx, self.ne()); }) && self.done();
      };
      right[i] = function () {
        const r = rowAt(i), s = self.take(); if (!r) return self.say('INVALID ENTRY');
        if (s === 'DELETE') return self.edit((W) => { W.legs[r.j].alt = null; W.legs[r.j].spd = null; }) && self.done();
        const m = s.match(/^(?:(\d{2,3})\/)?(FL)?(\d{2,5})([AB])?$/); if (!m) return self.say('INVALID ENTRY');
        const v = m[2] ? +m[3] * 100 : +m[3]; if (v > 45000) return self.say('INVALID ENTRY');
        self.edit((W) => { W.legs[r.j].alt = { d: m[4] === 'A' ? '+' : m[4] === 'B' ? '-' : '@', a1: v, a2: null }; if (m[1]) W.legs[r.j].spd = +m[1]; }) && self.done();
      };
    }
    left[6] = function () { if (self.mod) self.mod = null; else self.go('FPLN'); };
    right[6] = function () { self.go('VNAV'); };
    return { left, right, build() {
      const P = self.plan, R = rows(), pages = Math.max(1, Math.ceil(R.length / 5)); self.n = Math.min(self.n, pages - 1);
      if (!P || !R.length) return { title: 'ACT LEGS', lines: [['', '', T('NO FLIGHT PLAN', C.dim, { center: true }), '']] };
      const ne = self.ne(), mv = self.ctx.magvar(), lines = [];
      for (let i = 0; i < 5; i++) {
        const r = R[self.n * 5 + i];
        if (!r) { lines.push(['', '', i === R.length - self.n * 5 ? T('---- END OF FPLN ----', C.white, { center: true }) : '', '']); continue; }
        const prev = r.j === P.i ? ne : (P.legs.slice(0, r.j).reverse().find((x) => x.fix) || {}).fix?.ne || ne, d = dist(prev, r.l.fix.ne) / NM;
        const hold = /^H/.test(r.l.pt) ? ` HOLD ${r.l.turn === 'L' ? 'L' : 'R'}` : '';
        lines.push([`${pad3(brg(prev, r.l.fix.ne) - mv)}°  ${d < 10 ? d.toFixed(1) : Math.round(d)}NM${hold}`, r.l.faf ? 'FAF' : r.l.map ? 'MAP' : '',
          T(r.l.fix.id, r.j === P.i ? C.magenta : C.green), T(`${r.l.spd ? r.l.spd : '---'}/${r.l.alt ? altText(r.l.alt) : '-----'}`, r.l.alt ? C.cyan : C.dim)]);
      }
      lines.push(self.modLine(T('VNAV>', C.white)) || ['', '', T('<FPLN', C.white), T('VNAV>', C.white)]);
      return { title: `${self.mod ? 'MOD' : 'ACT'} LEGS`, pageNum: `${self.n + 1}/${pages}`, lines };
    } };
  }
  // DIR INTC: a typed ident on L1, or one of the fixes ahead; the direct goes into a MOD, shown on the LEGS page for EXEC
  dirPage() {
    const self = this, ahead = () => { const P = self.plan; if (!P) return []; const seen = new Set(), out = [];
      for (let j = P.i; j < P.legs.length; j++) { const l = P.legs[j]; if (l.fix && l.fix.id !== 'VECTR' && !seen.has(l.fix.id)) { seen.add(l.fix.id); out.push(l.fix); } } return out; };
    const left = {};
    for (let i = 1; i <= 5; i++) left[i] = function () {
      const s = self.take(), fx = i === 1 ? (s ? self.fixFor(s) : null) : ahead()[self.n * 4 + i - 2];
      if (!fx) return self.say(s ? 'NOT IN DATA BASE' : 'INVALID ENTRY');
      if (self.edit((W) => { W.directTo(fx, self.ne()); })) { self.done(); self.go('LEGS'); }
    };
    left[6] = function () { if (self.mod) self.mod = null; else self.go('LEGS'); };
    return { left, build() {
      const A = ahead(), ne = self.ne(), mv = self.ctx.magvar(), lines = [['DIRECT TO', '', T('-----', C.white), '']];
      for (let i = 0; i < 4; i++) { const f = A[self.n * 4 + i]; lines.push(f ? [`${pad3(brg(ne, f.ne) - mv)}°  ${Math.round(dist(ne, f.ne) / NM)}NM`, '', T(`<${f.id}`), ''] : ['', '', '', '']); }
      lines.push(self.modLine() || ['', '', T('<LEGS', C.white), '']);
      return { title: 'DIR INTC', pageNum: `${self.n + 1}/${Math.max(1, Math.ceil(A.length / 4))}`, lines };
    } };
  }
  // DEP/ARR INDEX: the origin's departures, the destination's arrivals
  depArrPage() {
    const self = this;
    return { left: { 1() { self.go('DEPART'); } }, right: { 1() { self.go('ARRIVAL'); } }, build() {
      const f = self.ctx.G().free || {};
      return { title: 'DEP/ARR INDEX', lines: [['', '', T(`<DEP  ${f.apt || '----'}`, C.white), T(`${f.arr || '----'}  ARR>`, C.white)],
        ['SID', 'STAR', T(f.sid || '----', f.sid ? C.green : C.dim), T(f.star || '----', f.star ? C.green : C.dim)],
        ['RWY', 'APPROACH', T(f.rwy ? `RW${f.rwy}` : '---', f.rwy ? C.green : C.dim), T(f.app ? short(self.ctx.procName(f.app)) : '----', f.app ? C.green : C.dim)]] };
    } };
  }
  // DEPART (the origin's SIDs) / ARRIVAL (the destination's approaches and STARs): choosing one rebuilds the plan from
  // the FAA CIFP with it into a MOD, flown from the active fix (or the first leg of the changed part) after EXEC
  procPage(which) {
    const self = this, apt = () => { const f = self.ctx.G().free || {}; return which === 'DEP' ? f.apt : f.arr; };
    const list = () => { const a = apt(); if (!a) return []; return which === 'DEP' ? self.ctx.procedures(a, 'SID').map((p) => ({ kind: 'sid', id: p.id, name: p.id }))
      : [...self.ctx.procedures(a, 'APP').map((p) => ({ kind: 'app', id: p.id, name: short(self.ctx.procName(p.id)) })), ...self.ctx.procedures(a, 'STAR').map((p) => ({ kind: 'star', id: p.id, name: p.id }))]; };
    const pick = (it) => {
      const f = self.ctx.G().free || {}, changes = it.kind === 'app' ? { app: it.id, trans: 'auto' } : it.kind === 'star' ? { star: it.id, starTrans: '' } : { sid: it.id, sidTrans: '' };
      const P = self.ctx.replan(changes); if (!P || !P.legs.length) return self.say('NOT IN DATA BASE');
      const F = self.fms, cur = F && F.active && F.active.fix && F.active.fix.id;
      let k = cur ? P.legs.findIndex((l) => l.fix && l.fix.id === cur) : -1;
      if (k < 0) k = Math.max(0, P.legs.findIndex((l) => l.kind === (it.kind === 'app' ? 'APP' : it.kind === 'star' ? 'STAR' : 'SID')));
      self.mod = { legs: P.legs, i: k, cruise: F ? F.cruise : null, changes };
      self.msg = `${it.name}: EXEC TO ACTIVATE`; self.go('LEGS');
    };
    const left = {}, right = {};
    for (let i = 1; i <= 5; i++) {
      left[i] = function () { const it = list()[self.n * 10 + (i - 1) * 2]; if (it) pick(it); else self.say('INVALID ENTRY'); };
      right[i] = function () { const it = list()[self.n * 10 + (i - 1) * 2 + 1]; if (it) pick(it); else self.say('INVALID ENTRY'); };
    }
    left[6] = function () { if (self.mod) self.mod = null; else self.go('DEPARR'); };
    return { left, right, build() {
      const L = list(), pages = Math.max(1, Math.ceil(L.length / 10)); self.n = Math.min(self.n, pages - 1);
      const f = self.ctx.G().free || {}, cur = which === 'DEP' ? [f.sid] : [f.app, f.star], lines = [];
      for (let i = 0; i < 5; i++) {
        const a = L[self.n * 10 + i * 2], b = L[self.n * 10 + i * 2 + 1], col = (it) => (it && cur.includes(it.id) ? C.magenta : C.green);
        lines.push([i === 0 ? (which === 'DEP' ? 'SIDS' : 'APPROACHES / STARS') : '', '', a ? T(`<${a.name}`, col(a)) : '', b ? T(`${b.name}>`, col(b)) : '']);
      }
      lines.push(self.modLine() || ['', '', T('<DEP/ARR', C.white), '']);
      return { title: `${which === 'DEP' ? 'DEPART' : 'ARRIVAL'} ${apt() || ''}`, pageNum: `${self.n + 1}/${pages}`, lines };
    } };
  }
  setCruise() {
    const s = this.take(), m = s.match(/^(FL)?(\d{2,5})$/); if (!m) return this.say('INVALID ENTRY');
    const v = m[1] || +m[2] < 1000 ? +m[2] * 100 : +m[2]; if (v < 1000 || v > 45000) return this.say('INVALID ENTRY');
    this.edit((W) => { W.cruise = v; }) && this.done();
  }
  perfPage() {
    const self = this;
    return { left: { 1() { self.setCruise(); }, 6() { if (self.mod) self.mod = null; } }, right: { 6() { self.go('VNAV'); } }, build() {
      const G = self.ctx.G(), F = self.fms, cr = self.mod ? self.mod.cruise : F && F.cruise, lb = Math.round(G.ac.m / 0.45359);
      return { title: 'PERF INIT', lines: [['CRZ ALT', 'GROSS WT LB', T(cr ? fl(cr) : '-----', cr ? C.cyan : C.dim), T(lb.toLocaleString())],
        ['', 'FUEL LB', '', T(Math.round((G.ac.fuel || 0) / 0.45359).toLocaleString())], ['', '', '', ''], ['', '', '', ''], ['', '', '', ''],
        self.modLine(T('VNAV>', C.white)) || ['', '', '', T('VNAV>', C.white)]] };
    } };
  }
  // VNAV: the targets of js/scenario.js's VNAV (speed on elevator in the climb, 250 kt below 10,000 ft), CRZ ALT
  vnavPage() {
    const self = this;
    return { left: { 1() { self.setCruise(); }, 6() { if (self.mod) self.mod = null; } }, right: { 6() { self.go('LEGS'); } }, build() {
      const G = self.ctx.G(), F = self.fms, cr = self.mod ? self.mod.cruise : F && F.cruise, ap = G.ap, v = ap && ap.vnav;
      return { title: 'VNAV', lines: [['CRZ ALT', 'TGT ALT', T(cr ? fl(cr) : '-----', cr ? C.cyan : C.dim), T(v && v.tgt != null ? fl(v.tgt) : '-----')],
        ['CLB SPD', 'SPD LIMIT', T('280/.70'), T('250/10000')], ['DES ANGLE', 'MODE', T('3.0°'), T(ap ? `${ap.vert}${ap.vertArm ? ' ' + ap.vertArm : ''}` : '---')],
        ['', '', '', ''], ['', '', '', ''], self.modLine(T('LEGS>', C.white)) || ['', '', '', T('LEGS>', C.white)]] };
    } };
  }
  progPage() {
    const self = this;
    return { build() {
      const G = self.ctx.G(), P = self.plan, o = G.ac.out, ne = self.ne(), gs = Math.max(1, o.gs || o.V || 1), lines = [];
      const legs = P ? P.legs.slice(P.i).filter((l) => l.fix) : [];
      let total = 0, at = ne; const cum = legs.map((l) => { total += dist(at, l.fix.ne); at = l.fix.ne; return total; });
      const row = (lab, l, d) => (l ? [lab, 'DIST    ETE', T(l.fix.id, lab === 'TO' ? C.magenta : C.green), T(`${d < 185200 ? (d / NM).toFixed(1) : Math.round(d / NM)}  ${hhmm(d / gs)}`)] : [lab, '', T('-----', C.dim), '']);
      lines.push(row('TO', legs[0], cum[0] || 0)); lines.push(row('NEXT', legs[1], cum[1] || 0));
      const dest = legs.find((l) => l.map) || legs.at(-1);
      lines.push(row('DEST', dest, dest ? cum[legs.indexOf(dest)] : 0));
      lines.push(['GS', 'TAS', T(`${Math.round(gs * 1.94384)}`), T(`${Math.round((o.V || 0) * 1.94384)}`)]);
      lines.push(['FUEL LB', 'ALT', T(`${Math.round((G.ac.fuel || 0) / 0.45359)}`), T(`${Math.round(o.h / 0.3048)}`)]);
      return { title: 'PROGRESS', lines };
    } };
  }
  // HOLD: hold at a fix (the active one with an empty scratchpad, or a typed ident): inbound on the course to the fix,
  // right turns, 1 min legs (1.5 above 14,000 ft); with a hold ahead: its inbound course (magnetic), turn, leg time, and
  // EXIT HOLD (one more circuit, then on)
  holdPage() {
    const self = this, held = () => { const P = self.plan; return P ? P.legs.map((l, j) => ({ l, j })).find(({ l, j }) => j >= P.i && /^H[MAF]$/.test(l.pt)) : null; };
    return { left: {
      1() {
        const P = self.plan; if (!P) return self.say('NO FLIGHT PLAN');
        const s = self.take(), fx = s ? self.fixFor(s) : (P.legs[P.i] || {}).fix; if (!fx) return self.say('NOT IN DATA BASE');
        self.edit((W) => {
          let k = W.legs.findIndex((l, j) => j >= W.i && l.fix && l.fix.id === fx.id && !/^H/.test(l.pt));
          if (k < 0) { W.insertFix(self.insertAt(W), fx, self.ne()); k = W.legs.findIndex((l, j) => j >= W.i && l.fix && l.fix.id === fx.id); }
          const prev = (W.legs.slice(0, k).reverse().find((x) => x.fix) || {}).fix, crs = brg(prev ? prev.ne : self.ne(), fx.ne);
          W.legs.splice(k + 1, 0, { pt: 'HM', fix: { id: fx.id, ne: fx.ne }, crsT: crs, turn: 'R', time: null, alt: W.legs[k].alt, kind: W.legs[k].kind, proc: null });
        }) && self.done();
      },
      2() { const h = held(), m = self.take().match(/^(\d{1,3})$/); if (!h || !m || +m[1] > 360) return self.say('INVALID ENTRY'); self.edit((W) => { W.legs[h.j].crsT = (+m[1] + self.ctx.magvar() + 360) % 360; }) && self.done(); },
      3() { const h = held(), s = self.take(); if (!h || !/^[LR]$/.test(s)) return self.say('INVALID ENTRY'); self.edit((W) => { W.legs[h.j].turn = s; }) && self.done(); },
      4() { const h = held(), m = self.take().match(/^(\d(?:\.\d)?)$/); if (!h || !m) return self.say('INVALID ENTRY'); self.edit((W) => { W.legs[h.j].time = +m[1]; }) && self.done(); },
      6() { if (self.mod) self.mod = null; else self.go('LEGS'); },
    }, right: {
      6() { const h = held(); if (!h) return self.say('NO HOLD'); self.edit((W) => { W.legs[h.j].pt = 'HF'; }); self.msg = 'EXIT HOLD: EXEC'; },
    }, build() {
      const h = held(), mv = self.ctx.magvar(), F = self.fms, inHold = F && F.hold && F.active && /^H/.test(F.active.pt), P = self.plan;
      if (!h) return { title: 'HOLD', lines: [['HOLD AT', '', T(`<${((P && P.legs[P.i]) || {}).fix?.id || '-----'}`, C.white), ''], ['', '', T('L1: HOLD AT THE ACTIVE', C.dim, { center: true }), ''],
        ['', '', T('WPT, OR TYPE A FIX', C.dim, { center: true }), ''], ['', '', '', ''], ['', '', '', ''], self.modLine() || ['', '', T('<LEGS', C.white), '']] };
      const exit = h.l.pt === 'HF' ? T('EXIT ARMED', C.amber) : T('EXIT HOLD>', C.white);
      return { title: `${self.mod ? 'MOD' : 'ACT'} HOLD`, lines: [['FIX', 'ENTRY', T(h.l.fix.id), T(inHold ? String(F.hold.entry || '').toUpperCase() : '----', inHold ? C.green : C.dim)],
        ['INBD CRS', '', T(`${pad3((h.l.crsT || 0) - mv)}°`, C.cyan), ''], ['TURN', '', T(h.l.turn === 'L' ? 'L' : 'R', C.cyan), ''],
        ['LEG TIME', '', T(`${h.l.time || (self.ctx.G().ac.out.h / 0.3048 < 14000 ? 1 : 1.5)} MIN`, C.cyan), ''], ['', '', '', ''],
        self.modLine(exit) || ['', '', T('<LEGS', C.white), exit]] };
    } };
  }
  msgPage() {
    const self = this;
    return { build() { return { title: 'MESSAGES', lines: [0, 1, 2, 3, 4].map((k) => ['', '', self.msgs[k] ? T(self.msgs[k].m, C.amber) : k === 0 ? T('NO MESSAGES', C.dim, { center: true }) : '', '']) }; } };
  }
  statusPage() {
    const self = this;
    return { left: { 6() { self.go('INDEX'); } }, build() {
      return { title: 'STATUS', lines: [['NAV DATA', 'CYCLE', T('FAA CIFP'), T(String(self.ctx.cycle() || '----'))], ['', '', T('NOT FOR NAVIGATION', C.amber), ''],
        ['PROGRAM', '', T('FMS-4200 (SIM)'), ''], ['', '', '', ''], ['', '', '', ''], ['', '', T('<INDEX', C.white), '']] };
    } };
  }
  // DATA BASE: a waypoint, navaid or airport by ident, with its bearing and distance
  dbPage() {
    const self = this;
    return { left: { 1() { const s = self.take(); if (!s) return self.say('INVALID ENTRY'); const fx = self.ctx.findFix(s, self.ne()); if (!fx) return self.say('NOT IN DATA BASE'); self.dbFix = fx; self.done(); }, 6() { self.go('INDEX'); } }, build() {
      const f = self.dbFix, ne = self.ne(), mv = self.ctx.magvar();
      return { title: 'DATA BASE', lines: [['IDENT', '', T(f ? f.id : '-----', f ? C.green : C.dim), ''], f ? ['BRG / DIST', '', T(`${pad3(brg(ne, f.ne) - mv)}°  ${Math.round(dist(ne, f.ne) / NM)}NM`), ''] : ['', '', '', ''],
        ['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', T('<INDEX', C.white), '']] };
    } };
  }

  // ---- drawing: the whole unit into ctx at x, y, w x h (portrait 520 x 796); hits to hud.hits as cdu_<key> ----
  draw(ctx, x, y, w, h, hud) {
    const s = Math.min(w / 520, h / 796), hits = hud ? hud.hits : this.hits;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const push = (bx, by, bw, bh, id) => hits.push({ x: x + bx * s, y: y + by * s, w: bw * s, h: bh * s, id: `cdu_${id}` });
    ctx.fillStyle = '#272b31'; ctx.beginPath(); ctx.roundRect(2, 2, 516, 792, 14); ctx.fill(); ctx.strokeStyle = '#4a4f57'; ctx.lineWidth = 3; ctx.stroke();
    const SX = 70, SY = 16, SW = 380, SH = 316, cw = SW / 24, rh = SH / 14;
    ctx.fillStyle = '#020403'; ctx.fillRect(SX - 6, SY - 6, SW + 12, SH + 12); push(SX - 6, SY - 6, SW + 12, SH + 12, 'SCREEN');
    const p = this.pages()[this.page] || this.pages().FPLN, b = p.build();
    const font = (sz) => { ctx.font = `bold ${sz}px "SF Mono", Menlo, Consolas, monospace`; ctx.textBaseline = 'middle'; };
    const put = (t, col, row, color, align, sz) => { if (!t) return; font(sz); ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(t, SX + (align === 'right' ? SW - col * cw : align === 'center' ? SW / 2 : col * cw), SY + rh * (row + 0.5)); };
    put(b.title, 0, 0, C.white, 'center', 21); if (b.pageNum) put(b.pageNum, 0.2, 0, C.white, 'right', 17);
    (b.lines || []).forEach((ln, k) => {
      if (!ln) return;
      const [ll, lr, dl, dr] = ln, seg = (v, d) => (typeof v === 'string' ? { t: v, c: d } : v || { t: '' });
      put(seg(ll).t, 0.3, 1 + 2 * k, C.cyan, 'left', 14); put(seg(lr).t, 0.3, 1 + 2 * k, C.cyan, 'right', 14);
      const L = seg(dl, C.green), R = seg(dr, C.green);
      if (L.center) put(L.t, 0, 2 + 2 * k, L.c || C.green, 'center', 19); else put(L.t, 0.3, 2 + 2 * k, L.c || C.green, 'left', 21);
      put(R.t, 0.3, 2 + 2 * k, R.c || C.green, 'right', 21);
    });
    put(this.msg || this.scratch, 0.3, 13, this.msg ? C.amber : C.white, 'left', 21);
    const key = (bx, by, bw, bh, lab, id, sz = 15, light) => {
      const g = ctx.createLinearGradient(0, by, 0, by + bh); g.addColorStop(0, '#5b6068'); g.addColorStop(1, '#30343b');
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 5); ctx.fill();
      if (light !== undefined) { ctx.fillStyle = light ? '#5dff6a' : '#16301a'; ctx.shadowColor = '#5dff6a'; ctx.shadowBlur = light ? 10 : 0; ctx.fillRect(bx + bw * 0.25, by + 4, bw * 0.5, 5); ctx.shadowBlur = 0; }
      font(sz); ctx.fillStyle = '#eef1f4'; ctx.textAlign = 'center';
      const parts = String(lab).split('\n'); parts.forEach((t, k) => ctx.fillText(t, bx + bw / 2, by + bh / 2 + (light !== undefined ? 3 : 0) + (k - (parts.length - 1) / 2) * sz * 1.05));
      push(bx, by, bw, bh, id);
    };
    for (let i = 1; i <= 6; i++) { const ky = SY + rh * (2 * i + 0.5) - 13; key(14, ky, 42, 26, '—', `L${i}`); key(464, ky, 42, 26, '—', `R${i}`); }
    FN.forEach((row, r) => row.forEach((k, c) => key(14 + c * 82, 344 + r * 50, 76, 44, LABEL[k], k, LABEL[k].includes('\n') ? 13 : 15)));
    ALPHA.forEach((k, i) => key(14 + (i % 6) * 54, 448 + Math.floor(i / 6) * 58, 50, 52, k, k, k.length > 1 ? 14 : 21));
    key(346, 448, 78, 46, LABEL.PREV, 'PREV', 13); key(428, 448, 78, 46, LABEL.NEXT, 'NEXT', 13);
    key(346, 500, 160, 40, 'EXEC', 'EXEC', 17, !!this.mod);
    NUM.forEach((k, i) => key(346 + (i % 3) * 54, 546 + Math.floor(i / 3) * 46, 50, 42, k, k, 19));
    BOTTOM.forEach((k, i) => key(14 + i * 82, 744, 76, 44, LABEL[k], k, LABEL[k].includes('\n') ? 13 : 17, k === 'MSG' ? this.unread : undefined));
    ctx.restore();
  }
}
