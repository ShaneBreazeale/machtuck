// The flight-plan computer's control display unit (CDU) on the pedestal: a screen with six line-select keys (LSK) each
// side, function keys and a full keypad, laid over the CDU painted on the cockpit model (js/vcgauges.js cdu) and in a 2D
// pop-out you can type into. It runs the FMS of js/fms.js: the active flight plan, direct-to, inserting and deleting
// fixes, altitude constraints, progress.
//
// The Learjet 60's FMS is the Collins FMS-4200 (Pro Line 4). The page set and layout here are PROVISIONAL, a generic
// Collins-style CDU, until they are matched to the FMS-4200 pilot's guide: page names, key labels and line positions
// are kept in the tables below so they can follow the manual.
//
// Screen: 24 columns x 14 rows. Row 0 is the page title; rows 1-12 are six pairs of a small label line and a large data
// line, each pair next to a line-select key (L1-L6 / R1-R6); row 13 is the scratchpad.
// Keys: line-select L1..L6 R1..R6, function keys (FN), A-Z, 0-9, '.', '/', '+/-', SP, DEL, CLR. Each key is a control
// with the id `cdu_<key>` for js/panel.js; CDU.KEYS lists them.

const NM = 1852;
const FN = [['IDX', 'FPL', 'DIR', 'PROG', 'DEPARR'], ['PREV', 'NEXT', 'MSG', 'EXEC', 'NAV']];
const FN_LABEL = { DEPARR: 'DEP\nARR', IDX: 'IDX', FPL: 'FPL', DIR: 'DIR', PROG: 'PROG', PREV: 'PREV\nPAGE', NEXT: 'NEXT\nPAGE', MSG: 'MSG', EXEC: 'EXEC', NAV: 'NAV' };
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(['SP', '/', 'DEL', 'CLR']);
const NUM = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '+/-'];
const COL = { white: '#f2f4f6', cyan: '#4fd8ff', green: '#4dff7a', magenta: '#ff5cf0', amber: '#ffb000', dim: '#8796a6' };
const brg = (a, b) => ((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI) + 360) % 360;
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const pad3 = (d) => String(Math.round(d) % 360 || 360).padStart(3, '0');
const hhmm = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`; };
const altText = (a) => {
  if (!a) return '';
  const f = (v) => (v >= 18000 ? `FL${Math.round(v / 100)}` : String(Math.round(v)));
  if (a.d === 'B') return `${f(a.a2)}A${f(a.a1)}B`;
  return f(a.a1) + (/[+HJV]/.test(a.d) ? 'A' : /[-Y]/.test(a.d) ? 'B' : '');
};

export class CDU {
  // ctx: { G() -> game state, findFix(id, ne), log(text), magvar() }
  constructor(ctx) { this.ctx = ctx; this.page = 'FPL'; this.n = 0; this.scratch = ''; this.msg = ''; this.hits = []; }
  static get KEYS() {
    const k = [];
    for (let i = 1; i <= 6; i++) k.push(`L${i}`, `R${i}`);
    return k.concat(FN.flat(), ALPHA, NUM, ['SCREEN']);
  }
  static label(key) { return /^[LR]\d$/.test(key) ? `Line select ${key}` : FN_LABEL[key] ? `${FN_LABEL[key].replace('\n', ' ')} key` : key === 'SP' ? 'Space' : key === 'CLR' ? 'Clear' : key === 'DEL' ? 'Delete' : `Key ${key}`; }

  get fms() { const G = this.ctx.G(); return G && G.fms; }
  say(m) { this.msg = m; }
  // ---- keys ----
  press(key) {
    if (/^[LR]\d$/.test(key)) return this.lsk(key[0], +key[1]);
    if (FN_LABEL[key]) return this.fn(key);
    if (this.msg) this.msg = '';
    if (key === 'CLR') { this.scratch = this.scratch === 'DELETE' ? '' : this.scratch.slice(0, -1); return; }
    if (key === 'DEL') { this.scratch = 'DELETE'; return; }
    if (this.scratch === 'DELETE') this.scratch = '';
    const ch = key === 'SP' ? ' ' : key === '+/-' ? (this.scratch.endsWith('-') ? '+' : '-') : key;
    if (key === '+/-' && /[+-]$/.test(this.scratch)) this.scratch = this.scratch.slice(0, -1);
    if (this.scratch.length < 22) this.scratch += ch;
  }
  // the physical keyboard, while the 2D pop-out has focus
  type(e) {
    const k = e.key;
    if (k === 'Backspace') this.press('CLR');
    else if (k === 'Delete') this.press('DEL');
    else if (k === ' ') this.press('SP');
    else if (/^[a-zA-Z0-9./]$/.test(k)) this.press(k.toUpperCase());
    else if (k === '-' || k === '+') this.press('+/-');
    else return false;
    return true;
  }
  fn(key) {
    this.msg = '';
    if (key === 'PREV') { this.n = Math.max(0, this.n - 1); return; }
    if (key === 'NEXT') { this.n++; return; }
    if (key === 'EXEC') { this.say('NO MODIFICATION'); return; }   // changes take effect at once (provisional)
    if (key === 'MSG') { this.say('NO MESSAGES'); return; }
    if (key === 'NAV') { this.page = 'PROG'; this.n = 0; return; }
    this.page = key; this.n = 0;
  }
  // a fix for a typed ident: one in the plan ahead, else the nav database (nearest)
  fixFor(id) {
    const F = this.fms, G = this.ctx.G();
    const inPlan = F && F.legs.slice(F.i).find((l) => l.fix && l.fix.id === id);
    return inPlan ? inPlan.fix : this.ctx.findFix(id, [G.ac.pos[0], G.ac.pos[1]]);
  }
  ne() { const G = this.ctx.G(); return [G.ac.pos[0], G.ac.pos[1]]; }
  lsk(side, i) {
    const p = this.pages()[this.page]; if (!p) return;
    const fn = side === 'L' ? p.left && p.left[i] : p.right && p.right[i];
    if (fn) fn.call(this); else this.say('INVALID ENTRY');
  }
  // ---- pages: each returns { title, rows: [[label left, label right], [data left, data right]] x 6, left: {i: fn}, right: {i: fn} }
  pages() {
    const self = this;
    return {
      IDX: { build() { const w = (t) => ({ t: `<${t}`, c: COL.white }); return { title: 'INDEX', lines: [['', '', w('FLIGHT PLAN'), ''], ['', '', w('DIRECT TO'), ''], ['', '', w('PROGRESS'), ''], ['', '', w('DEP / ARR'), '']] }; },
        left: { 1() { self.page = 'FPL'; self.n = 0; }, 2() { self.page = 'DIR'; self.n = 0; }, 3() { self.page = 'PROG'; self.n = 0; }, 4() { self.page = 'DEPARR'; self.n = 0; } } },
      FPL: this.fplPage(), DIR: this.dirPage(), PROG: this.progPage(), DEPARR: this.depArrPage(),
    };
  }
  // the active flight plan from the active leg on, six legs a page: ident (magenta: active), course / distance above,
  // altitude constraint right. L-key: empty scratchpad copies the ident; an ident goes direct (first line) or is
  // inserted before that leg; DELETE removes it. R-key: an altitude (5000, FL240, 5000A at or above, 5000B at or below)
  fplPage() {
    const self = this, rows = () => { const F = self.fms; return F ? F.legs.map((l, j) => ({ l, j })).filter(({ l, j }) => j >= F.i && l.fix) : []; };
    const rowAt = (i) => rows()[self.n * 6 + i - 1];
    const left = {}, right = {};
    for (let i = 1; i <= 6; i++) {
      left[i] = function () {
        const F = self.fms, r = rowAt(i), s = self.scratch.trim();
        if (!F) return self.say('NO FLIGHT PLAN');
        if (!s) { if (r) self.scratch = r.l.fix.id; return; }
        if (s === 'DELETE') { if (!r) return self.say('INVALID DELETE'); if (!F.deleteLeg(r.j)) return self.say(r.j === F.i ? 'USE DIR TO' : 'INVALID DELETE'); self.scratch = ''; return; }
        const fx = self.fixFor(s); if (!fx) return self.say('NOT IN DATA BASE');
        if (r && r.j === F.i && self.n === 0 && i === 1) { F.directTo(fx, self.ne()); self.ctx.log(`DIRECT ${s} (CDU)`); }
        else { F.insertFix(r ? r.j : F.legs.length, fx, self.ne()); self.ctx.log(`${s} inserted (CDU)`); }
        self.scratch = '';
      };
      right[i] = function () {
        const r = rowAt(i), s = self.scratch.trim(); if (!r) return self.say('INVALID ENTRY');
        if (s === 'DELETE') { r.l.alt = null; self.scratch = ''; return; }
        const m = s.match(/^(FL)?(\d{2,5})([AB])?$/); if (!m) return self.say('INVALID ENTRY');
        const v = m[1] ? +m[2] * 100 : +m[2]; if (v < 0 || v > 45000) return self.say('INVALID ENTRY');
        r.l.alt = { d: m[3] === 'A' ? '+' : m[3] === 'B' ? '-' : '@', a1: v, a2: null }; self.scratch = '';
      };
    }
    return { left, right, build() {
      const F = self.fms, R = rows(), pages = Math.max(1, Math.ceil(R.length / 6));
      self.n = Math.min(self.n, pages - 1);
      const lines = [];
      if (!F || !R.length) return { title: 'ACT FPL', lines: [['', '', { t: 'NO FLIGHT PLAN', c: COL.dim, center: true }, '']] };
      const ne = self.ne(), mv = self.ctx.magvar();
      for (let i = 0; i < 6; i++) {
        const r = R[self.n * 6 + i]; if (!r) { lines.push(['', '', i === R.length - self.n * 6 ? { t: '-----  END  -----', c: COL.white, center: true } : '', '']); continue; }
        const prev = r.j === F.i ? ne : (F.legs.slice(0, r.j).reverse().find((x) => x.fix) || {}).fix?.ne || ne;
        const crs = pad3(brg(prev, r.l.fix.ne) - mv), d = dist(prev, r.l.fix.ne) / NM;
        lines.push([`${crs}°  ${d < 10 ? d.toFixed(1) : Math.round(d)}NM${r.l.kind && r.l.kind !== 'ENR' ? '  ' + r.l.kind : ''}`, r.l.faf ? 'FAF' : r.l.map ? 'MAP' : '',
          { t: r.l.fix.id, c: r.j === F.i ? COL.magenta : COL.green }, { t: altText(r.l.alt), c: COL.cyan }]);
      }
      return { title: `ACT FPL`, pageNum: `${self.n + 1}/${pages}`, lines };
    } };
  }
  // direct to: the fixes ahead, or a typed ident on L1
  dirPage() {
    const self = this, ahead = () => { const F = self.fms; if (!F) return []; const seen = new Set(), out = [];
      for (let j = F.i; j < F.legs.length; j++) { const l = F.legs[j]; if (l.fix && l.fix.id !== 'VECTR' && !seen.has(l.fix.id)) { seen.add(l.fix.id); out.push(l.fix); } } return out; };
    const left = {};
    for (let i = 1; i <= 6; i++) left[i] = function () {
      const F = self.fms; if (!F) return self.say('NO FLIGHT PLAN');
      const s = self.scratch.trim(), fx = s && i === 1 ? self.fixFor(s) : ahead()[self.n * 6 + i - 1];
      if (!fx) return self.say(s ? 'NOT IN DATA BASE' : 'INVALID ENTRY');
      F.directTo(fx, self.ne()); self.ctx.log(`DIRECT ${fx.id} (CDU)`); self.scratch = ''; self.page = 'FPL'; self.n = 0;
    };
    return { left, build() {
      const A = ahead(), ne = self.ne(), mv = self.ctx.magvar(), lines = [];
      for (let i = 0; i < 6; i++) { const f = A[self.n * 6 + i]; lines.push(f ? [`${pad3(brg(ne, f.ne) - mv)}°  ${Math.round(dist(ne, f.ne) / NM)}NM`, '', { t: `<${f.id}`, c: COL.green }, ''] : ['', '', '', '']); }
      if (!A.length) lines[0] = ['DIRECT TO', '', { t: '<-----', c: COL.dim }, ''];
      return { title: 'DIRECT TO', pageNum: `${self.n + 1}/${Math.max(1, Math.ceil(A.length / 6))}`, lines };
    } };
  }
  // progress: the active fix, the next, the destination (along the plan), ground speed, fuel
  progPage() {
    const self = this;
    return { build() {
      const G = self.ctx.G(), F = self.fms, o = G.ac.out, ne = self.ne(), gs = Math.max(1, o.gs || o.V || 1), lines = [];
      const legs = F ? F.legs.slice(F.i).filter((l) => l.fix) : [];
      let total = 0, at = ne; const cum = legs.map((l) => { total += dist(at, l.fix.ne); at = l.fix.ne; return total; });
      const row = (lab, l, d) => (l ? [lab, 'DIST     ETE', { t: l.fix.id, c: lab === 'TO' ? COL.magenta : COL.green }, { t: `${d < 100 ? (d / NM).toFixed(1) : Math.round(d / NM)}  ${hhmm(d / gs)}`, c: COL.green }] : [lab, '', { t: '-----', c: COL.dim }, '']);
      lines.push(row('TO', legs[0], cum[0] || 0));
      lines.push(row('NEXT', legs[1], cum[1] || 0));
      const dest = legs.filter((l) => l.kind === 'APP' || l.map).find((l) => l.map) || legs.at(-1);
      lines.push(row('DEST', dest, dest ? cum[legs.indexOf(dest)] : 0));
      lines.push(['GS', 'TAS', { t: `${Math.round(gs * 1.94384)}`, c: COL.green }, { t: `${Math.round((o.V || 0) * 1.94384)}`, c: COL.green }]);
      lines.push(['FUEL LB', 'ALT', { t: `${Math.round((G.ac.fuel || 0) / 0.45359)}`, c: COL.green }, { t: `${Math.round(o.h / 0.3048)}`, c: COL.green }]);
      return { title: 'PROGRESS', lines };
    } };
  }
  // departure / arrival as planned on the sortie screen (read-only here)
  depArrPage() {
    const self = this;
    return { build() {
      const G = self.ctx.G(), f = G.free || {}, d = (v) => ({ t: v || '----', c: v ? COL.green : COL.dim });
      return { title: 'DEP / ARR', lines: [['ORIGIN', 'DEST', d(f.apt), d(f.arr)], ['RWY', 'APPROACH', d(f.rwy), d(f.app)], ['SID', 'STAR', d(f.sid), d(f.star)],
        ['SID TRANS', 'STAR TRANS', d(f.sidTrans), d(f.starTrans)], ['', '', { t: 'PLAN ON THE SORTIE', c: COL.dim, center: true }, ''], ['', '', { t: 'SCREEN', c: COL.dim, center: true }, '']] };
    } };
  }

  // ---- drawing: the whole unit into ctx at x, y, w x h (portrait); hits go to hud.hits as cdu_<key> ----
  draw(ctx, x, y, w, h, hud) {
    const s = Math.min(w / 520, h / 796), hits = hud ? hud.hits : this.hits;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const push = (bx, by, bw, bh, id) => hits.push({ x: x + bx * s, y: y + by * s, w: bw * s, h: bh * s, id: `cdu_${id}` });
    ctx.fillStyle = '#272b31'; ctx.beginPath(); ctx.roundRect(2, 2, 516, 792, 14); ctx.fill(); ctx.strokeStyle = '#4a4f57'; ctx.lineWidth = 3; ctx.stroke();
    // screen
    const SX = 70, SY = 18, SW = 380, SH = 318, cw = SW / 24, rh = SH / 14;
    ctx.fillStyle = '#020403'; ctx.fillRect(SX - 6, SY - 6, SW + 12, SH + 12); push(SX - 6, SY - 6, SW + 12, SH + 12, 'SCREEN');
    const p = this.pages()[this.page] || this.pages().FPL, b = p.build();
    const font = (sz) => { ctx.font = `bold ${sz}px "SF Mono", Menlo, Consolas, monospace`; ctx.textBaseline = 'middle'; };
    const put = (t, col, row, color, align, sz) => { if (!t) return; font(sz); ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(t, SX + (align === 'right' ? SW - col * cw : align === 'center' ? SW / 2 : col * cw), SY + rh * (row + 0.5)); };
    put(b.title, 0, 0, COL.white, 'center', 22); if (b.pageNum) put(b.pageNum, 0, 0, COL.white, 'right', 18);
    (b.lines || []).forEach((ln, k) => {
      const [ll, lr, dl, dr] = ln, seg = (v, d) => (typeof v === 'string' ? { t: v, c: d } : v || { t: '' });
      put(seg(ll).t, 0.3, 1 + 2 * k, COL.cyan, 'left', 15); put(seg(lr).t, 0.3, 1 + 2 * k, COL.cyan, 'right', 15);
      const L = seg(dl, COL.green), R = seg(dr, COL.green);
      if (L.center) put(L.t, 0, 2 + 2 * k, L.c || COL.green, 'center', 21);
      else put(L.t, 0.3, 2 + 2 * k, L.c || COL.green, 'left', 22);
      put(R.t, 0.3, 2 + 2 * k, R.c || COL.green, 'right', 22);
    });
    put(this.msg || this.scratch, 0.3, 13, this.msg ? COL.amber : COL.white, 'left', 22);
    // line-select keys
    const key = (bx, by, bw, bh, lab, id, sz = 15) => {
      const g = ctx.createLinearGradient(0, by, 0, by + bh); g.addColorStop(0, '#5b6068'); g.addColorStop(1, '#30343b');
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 5); ctx.fill();
      font(sz); ctx.fillStyle = '#eef1f4'; ctx.textAlign = 'center';
      const parts = String(lab).split('\n'); parts.forEach((t, k) => ctx.fillText(t, bx + bw / 2, by + bh / 2 + (k - (parts.length - 1) / 2) * sz * 1.05));
      push(bx, by, bw, bh, id);
    };
    for (let i = 1; i <= 6; i++) { const ky = SY + rh * (2 * i + 0.5) - 14; key(14, ky, 42, 28, '—', `L${i}`); key(464, ky, 42, 28, '—', `R${i}`); }
    // function keys
    FN.forEach((row, r) => row.forEach((k, c) => key(22 + c * 96, 350 + r * 54, 88, 46, FN_LABEL[k], k, k.length > 4 || FN_LABEL[k].includes('\n') ? 14 : 16)));
    // numeric (left) and alpha (right) keypads
    NUM.forEach((k, i) => key(16 + (i % 3) * 52, 470 + Math.floor(i / 3) * 76, 46, 66, k, k, 22));
    ALPHA.forEach((k, i) => key(178 + (i % 6) * 56, 466 + Math.floor(i / 6) * 64, 50, 56, k, k, k.length > 1 ? 15 : 22));
    ctx.restore();
  }
}
