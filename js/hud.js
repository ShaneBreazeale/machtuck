// 2D overlay: Pro Line 4-style Learjet 60 panel (glareshield annunciators + FGC strip, PFD, engine column, MFD weather
// radar, anti-ice / stall-warning / trim switch panel, pedestal), EFB tablet (moving map with the NEXRAD composite,
// procedures), profile chart, comm log, windshield weather effects.
import { DEG, RAD, clamp, wrap360, lerp } from './util.js';
import { FT, KT } from './atmo.js';
import { clockStr, TIMELINE } from './scenario.js';

const FONT = '"SF Mono", Menlo, Consolas, monospace';
const COL = { bezel: '#23262c', panel: '#15171b', face: '#0b0c0f', text: '#dfe6ee', dim: '#8a94a0', green: '#6cff6c', amber: '#ffb000', red: '#ff3b3b', cyan: '#7fd7ff', magenta: '#ff40c0' };

export class HUD {
  constructor(canvas) { this.c = canvas; this.ctx = canvas.getContext('2d'); this.W = 0; this.H = 0; this.hits = []; this.efbImg = null; }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    if (this.c.width !== Math.floor(W * dpr) || this.c.height !== Math.floor(H * dpr)) { this.c.width = Math.floor(W * dpr); this.c.height = Math.floor(H * dpr); }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.W = W; this.H = H;
  }
  hit(x, y) { return this.hits.find(h => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h); }
  text(s, x, y, size, color, align = 'left', weight = '') { const ctx = this.ctx; ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); }
  box(x, y, w, h, fill = COL.panel, stroke = '#2d313a', r = 5) { const ctx = this.ctx; ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.stroke(); }

  draw(S) {
    this.resize(); const ctx = this.ctx, W = this.W, H = this.H; ctx.clearRect(0, 0, W, H); this.hits = [];
    const blink = Math.floor(performance.now() / 280) % 2 === 0;
    if (!S.ext && !S.cockpit3d) { this.windshield(S); this.cockpitFrame(S); }
    if (S.hideHud) {
      if (S.endMsg) this.text(S.endMsg, W / 2, H - 32, 12, 'rgba(255,90,90,0.8)', 'center', 'bold');
      if (S.replay) this.text(`${S.recon ? 'RECONSTRUCTION' : 'REPLAY'} ${clockStr(S.t)} EST  ·  ${S.camAuto ? 'AUTO: ' : ''}${['COCKPIT', 'CHASE (right-drag orbits)', 'GROUND CAM'][S.camMode]}  ·  Z hud  C camera`, W / 2, H - 14, 12, 'rgba(255,255,255,0.6)', 'center');
      return;
    }
    if (S.cockpit3d) { /* the instruments are on the 3D panel */ } else if (!S.ext) this.panel(S, blink); else this.extLayout(S, blink);
    this.profile(S);
    this.commLog(S);
    this.header(S);
    this.warnings(S, blink);
    if (S.help) this.help();
    if (S.paused) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H); this.text('PAUSED', W / 2, H / 2, 42, '#fff', 'center'); }
  }

  // ---------------- Cockpit panel layout ----------------
  panel(S, blink) {
    const W = this.W, H = this.H, top = H * 0.56;
    const gy = top + 6, gh = H * 0.065;
    this.annunciators(S, blink, 8, gy, W - 16, gh);
    const y1 = gy + gh + 6, rowH = H - y1 - H * 0.058 - 4;
    const cols = [[0.004, 0.185], [0.19, 0.445], [0.45, 0.545], [0.55, 0.77], [0.775, 0.996]];
    const X = (f) => f * W;
    // EFB / procedures
    this.efb(S, X(cols[0][0]), y1, X(cols[0][1]) - X(cols[0][0]), rowH);
    // PFD
    const pw = X(cols[1][1]) - X(cols[1][0]); const s = Math.min(pw / 1.62, rowH / 1.28);
    this.pfd(S, blink, X(cols[1][0]) + pw * 0.5 - s * 0.02, y1 + s * 0.52, s);
    // Engines
    this.engines(S, X(cols[2][0]), y1, X(cols[2][1]) - X(cols[2][0]), rowH);
    // MFD
    this.mfd(S, X(cols[3][0]), y1, X(cols[3][1]) - X(cols[3][0]), rowH);
    // Switch panel
    this.switches(S, X(cols[4][0]), y1, X(cols[4][1]) - X(cols[4][0]), rowH);
    // Pedestal
    this.pedestal(S, 8, H - H * 0.058, W - 16, H * 0.055);
  }
  extLayout(S, blink) {
    const W = this.W, H = this.H; const s = Math.min(W * 0.2, H * 0.3);
    this.pfd(S, blink, W / 2, H - s * 0.56 - 10, s);
    this.mfd(S, 10, H - s * 0.9 - 10, s * 1.3, s * 0.9);
    this.switches(S, W - s * 1.25 - 10, H - s * 1.15 - 10, s * 1.25, s * 1.15);
    this.annunciators(S, blink, W / 2 - s * 0.95, H - s * 1.18 - 34, s * 1.9, 24);
  }

  // ---------------- Glareshield: annunciators + flight guidance strip ----------------
  annunciators(S, blink, x, y, w, h) {
    const o = S.out, ac = S.ac; this.box(x, y, w, h, COL.bezel, '#3a3f48', 6);
    const lights = [
      ['MASTER WARN', ac.broken || o.stalled && o.alpha > 0 || (o.vs < -30 && o.h < 3000), COL.red, true],
      ['MASTER CAUT', o.overspeed || ac.iceTail > 0.5 || ac.engIce > 0.3 || (!S.ap.on && S.apOffAt !== null && S.t - S.apOffAt < 4), COL.amber, true],
      ['AP OFF', !S.ap.on, COL.amber], ['SHAKER', ac.shaker, COL.amber], ['OVERSPEED', o.overspeed, COL.red],
      ['STAB ICE', ac.iceTail > 0.5, COL.amber], ['WING ICE', ac.ice > 0.5, COL.amber], ['ENG ICE', ac.engIce > 0.3, COL.amber],
      ['TRIM', ac.sys.trimMode !== 'PRI' || (S.trimRunaway), ac.sys.trimMode === 'OFF' ? COL.amber : COL.red], ['MACH TRIM', ac.sys.machTrimFail || !ac.sys.machTrim, COL.amber],
      ['SPOILER', ac.ctl.sb > 0, COL.green], ['GEAR', ac.ctl.gear > 0, COL.green], ['YD OFF', !ac.ctl.yd, COL.amber],
    ];
    const n = lights.length, lw = (w * 0.62) / n, ly = y + h * 0.5;
    lights.forEach((L, i) => {
      const lx = x + 10 + i * lw; const on = L[1] && (L[3] ? blink : true);
      this.box(lx, ly - h * 0.3, lw - 4, h * 0.6, on ? L[2] : '#101216', on ? L[2] : '#2a2e36', 3);
      this.text(L[0], lx + (lw - 4) / 2, ly, Math.max(8, Math.min(10, lw * 0.13)), on ? '#000' : '#4b525c', 'center', 'bold');
    });
    // FGC (flight guidance) mode strip
    const fx = x + w * 0.64, fw = w * 0.355;
    this.box(fx, y + 4, fw, h - 8, COL.face, '#3a3f48', 4);
    const modes = [['AP', S.ap.on], ['YD', ac.ctl.yd], ['HDG', S.ap.on], ['ALT', S.ap.on], ['MACH', S.ap.on]];
    const mw = fw / (modes.length + 1.2);
    modes.forEach((m, i) => this.text(m[0], fx + 10 + i * mw, y + h / 2, 12, m[1] ? COL.green : '#3b434d', 'left', 'bold'));
    this.text(S.ap.on ? `ALT ${Math.round(S.ap.altTgt / FT / 100) * 100}  HDG ${Math.round(S.ap.hdgTgt)}°` : (S.ap.why ? `AP OFF · ${S.ap.why}` : 'AP OFF'), fx + fw - 8, y + h / 2, 11, S.ap.on ? COL.cyan : COL.amber, 'right');
  }

  // ---------------- PFD ----------------
  pfd(S, blink, cx, cy, s) {
    const ctx = this.ctx, o = S.out, ac = S.ac;
    const th = o.theta * RAD, ph = o.phi;
    ctx.save(); ctx.beginPath(); ctx.roundRect(cx - s / 2, cy - s / 2, s, s, 8); ctx.clip();
    ctx.translate(cx, cy); ctx.rotate(-ph);
    const ppd = s / 44; ctx.translate(0, th * ppd);
    ctx.fillStyle = '#1e6ec8'; ctx.fillRect(-3 * s, -4 * s, 6 * s, 4 * s);
    ctx.fillStyle = '#6b4a1e'; ctx.fillRect(-3 * s, 0, 6 * s, 4 * s);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-3 * s, 0); ctx.lineTo(3 * s, 0); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.font = `${Math.max(10, s * 0.045)}px ${FONT}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    for (let d = -90; d <= 90; d += 5) { if (d === 0) continue; const y = -d * ppd; const big = d % 10 === 0; const w = big ? s * 0.18 : s * 0.08; ctx.beginPath(); ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); ctx.stroke(); if (big) { ctx.fillText(Math.abs(d), -w / 2 - s * 0.05, y); ctx.fillText(Math.abs(d), w / 2 + s * 0.05, y); } }
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.roundRect(cx - s / 2, cy - s / 2, s, s, 8); ctx.clip(); ctx.translate(cx, cy);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { ctx.save(); ctx.rotate(a * DEG); const l = (a % 30 === 0 || a === 0) ? s * 0.06 : s * 0.035; ctx.beginPath(); ctx.moveTo(0, -s * 0.44); ctx.lineTo(0, -s * 0.44 + l); ctx.stroke(); ctx.restore(); }
    ctx.save(); ctx.rotate(-ph); ctx.fillStyle = Math.abs(ph) > 35 * DEG ? COL.amber : '#fff'; ctx.beginPath(); ctx.moveTo(0, -s * 0.44 + s * 0.065); ctx.lineTo(-s * 0.025, -s * 0.44 + s * 0.12); ctx.lineTo(s * 0.025, -s * 0.44 + s * 0.12); ctx.fill(); ctx.restore();
    ctx.strokeStyle = '#ffe34d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-s * 0.22, 0); ctx.lineTo(-s * 0.08, 0); ctx.lineTo(-s * 0.08, s * 0.04); ctx.moveTo(s * 0.22, 0); ctx.lineTo(s * 0.08, 0); ctx.lineTo(s * 0.08, s * 0.04); ctx.stroke(); ctx.fillStyle = '#ffe34d'; ctx.fillRect(-2, -2, 4, 4);
    const fx = clamp(o.beta * RAD, -20, 20) * ppd, fy = clamp(o.alpha * RAD, -20, 20) * ppd;
    ctx.strokeStyle = COL.green; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(fx, fy, s * 0.025, 0, 6.28); ctx.moveTo(fx - s * 0.025, fy); ctx.lineTo(fx - s * 0.07, fy); ctx.moveTo(fx + s * 0.025, fy); ctx.lineTo(fx + s * 0.07, fy); ctx.moveTo(fx, fy - s * 0.025); ctx.lineTo(fx, fy - s * 0.05); ctx.stroke();
    const g = o.nz; this.text(`G ${g.toFixed(2)}`, -s * 0.46, s * 0.44, s * 0.055, g > 3.5 || g < -1 ? COL.red : g > 2.5 ? COL.amber : '#fff', 'left', 'bold');
    this.text(`α ${(o.alpha * RAD).toFixed(1)}°`, s * 0.46, s * 0.44, s * 0.045, o.stalled ? COL.red : '#cfd', 'right');
    const apTxt = S.ap.on ? 'AP  ALT  HDG  YD' : (S.ap.why ? `AP OFF (${S.ap.why})` : 'AP OFF');
    this.text(apTxt, 0, -s * 0.44, s * 0.05, S.ap.on ? COL.green : (blink || performance.now() / 1000 - S.apOffWall > 6 ? COL.amber : '#000'), 'center', 'bold');
    let warn = null;
    if (ac.broken) warn = ['STRUCTURAL FAILURE', COL.red];
    else if (o.alpha > 0 && (o.stalled || o.aoaN > 0.82)) warn = ['STALL', COL.red];
    else if (o.overspeed) warn = ['OVERSPEED', COL.red];
    else if (o.vs < -30 && o.h < 3000) warn = ['PULL UP', COL.red];
    else if (Math.abs(ph) > 45 * DEG) warn = ['BANK ANGLE', COL.amber];
    if (warn && blink) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(-s * 0.3, s * 0.14, s * 0.6, s * 0.1); this.text(warn[0], 0, s * 0.19, s * 0.075, warn[1], 'center', 'bold'); }
    ctx.restore();
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(cx - s / 2, cy - s / 2, s, s, 8); ctx.stroke();
    const tw = s * 0.21, tx = cx - s / 2 - 6 - tw, ty = cy - s / 2;
    // Coffin-corner bands (from the model's speed envelope at the current, smoothed g):
    //   red/white below the stick-shaker speed; amber where 30% more g (a gust or a pull)
    //   reaches the shaker or shock buffet; red/white above Vmo/Mmo. Bank or climb and
    //   watch the amber close in from both ends.
    const B = o.bands, bands = [];
    if (B) {
      const top = Math.min(B.buffetM || 0, B.vmo);
      if (Number.isFinite(B.shaker)) bands.push({ from: 0, to: B.shaker, style: 'barber' }, { from: B.shaker, to: B.shakerM, color: COL.amber });
      else bands.push({ from: 0, to: 9999, style: 'barber' });
      bands.push({ from: top, to: 9999, color: COL.amber });
    }
    this.tape(tx, ty, tw, s, o.KIAS, 10, 20, s * 0.062, (v) => v < 0 ? null : v, (v) => { const vmoEff = Math.min(o.Vmo, o.M > 0.01 ? o.KIAS * (o.Mmo || 0.81) / o.M : 999); return v >= vmoEff ? 'barber' : null; }, '#fff', false, bands);
    this.text(`M ${o.M.toFixed(3)}`, tx + tw / 2, ty + s + 14, s * 0.055, o.M > (o.Mmo || 0.81) ? COL.red : '#fff', 'center', 'bold');
    this.text(`GS ${(o.gs / KT).toFixed(0)}`, tx + tw / 2, ty + s + 32, s * 0.042, '#9ad', 'center');
    if (B) {
      // Usable speed window at this g: shaker up to the lower of shock buffet and Vmo/Mmo
      const win = Math.min(B.buffet || 0, B.vmo) - B.shaker, winM = Math.min(B.buffetM || 0, B.vmo) - B.shakerM;
      const closed = !(win > 0);   // no speed between the shaker and buffet/Vmo at this g
      this.text(closed ? 'NO SPEED WINDOW' : `WINDOW ${Math.round(win)} KT`, tx + tw / 2, ty + s + 48, s * 0.042,
        closed ? COL.red : (winM > 0 ? COL.dim : COL.amber), 'center', 'bold');   // amber: a 1.3g gust would close it
    }
    const ax = cx + s / 2 + 6, aw = s * 0.24;
    this.tape(ax, ty, aw, s, o.h / FT, 100, 500, s * 0.062 / 100 * 100 * 0.5, (v) => Math.round(v), () => null, '#fff', true);
    const vx = ax + aw + 4, vsf = o.vs / FT * 60;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(vx, ty, s * 0.09, s);
    const vsy = (v) => cy - clamp(Math.sign(v) * Math.log10(1 + Math.abs(v) / 300) * s * 0.22, -s * 0.47, s * 0.47);
    ctx.strokeStyle = '#999'; ctx.lineWidth = 1; for (const v of [-20000, -6000, -2000, -1000, 0, 1000, 2000, 6000, 20000]) { const y = vsy(v); ctx.beginPath(); ctx.moveTo(vx, y); ctx.lineTo(vx + 6, y); ctx.stroke(); if (v !== 0) this.text(Math.abs(v) / 1000, vx + s * 0.06, y, s * 0.035, '#aaa', 'center'); }
    ctx.strokeStyle = vsf < -6000 ? COL.red : '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(vx, vsy(vsf)); ctx.lineTo(vx + s * 0.085, cy + (vsy(vsf) - cy) * 0.5); ctx.stroke();
    this.text(`${vsf > 0 ? '+' : ''}${Math.round(vsf / 100) * 100}`, vx + s * 0.045, ty + s + 14, s * 0.045, Math.abs(vsf) > 6000 ? COL.red : '#fff', 'center', 'bold');
    const hy = cy + s / 2 + 8, hh = s * 0.11, hdg = wrap360(o.psi * RAD), trk = wrap360(o.track * RAD);
    ctx.save(); ctx.beginPath(); ctx.rect(cx - s / 2, hy, s, hh); ctx.clip(); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(cx - s / 2, hy, s, hh);
    const pph = s / 70; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    for (let d = -40; d <= 40; d += 5) { const v = wrap360(Math.round((hdg + d) / 5) * 5); const x = cx + (v - hdg + 540) % 360 * pph - 180 * pph; ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(x, hy + (v % 10 === 0 ? 10 : 5)); ctx.stroke(); if (v % 30 === 0) this.text(v === 0 ? 'N' : v === 90 ? 'E' : v === 180 ? 'S' : v === 270 ? 'W' : v / 10, x, hy + hh * 0.62, s * 0.045, '#fff', 'center'); }
    const txo = ((trk - hdg + 540) % 360 - 180) * pph; ctx.fillStyle = COL.green; ctx.beginPath(); ctx.moveTo(cx + txo, hy + 2); ctx.lineTo(cx + txo - 5, hy + 10); ctx.lineTo(cx + txo + 5, hy + 10); ctx.fill();
    ctx.restore(); ctx.fillStyle = '#ffe34d'; ctx.beginPath(); ctx.moveTo(cx, hy); ctx.lineTo(cx - 6, hy - 8); ctx.lineTo(cx + 6, hy - 8); ctx.fill();
    this.text(`${Math.round(hdg).toString().padStart(3, '0')}°`, cx, hy + hh + 10, s * 0.05, '#fff', 'center', 'bold');
  }
  tape(x, y, w, h, val, minor, major, pxPerMinor, fmt, mark, color, isAlt = false, bands = []) {
    const ctx = this.ctx; ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x, y, w, h);
    const cy = y + h / 2, pxPerUnit = pxPerMinor / minor; const range = h / pxPerUnit / 2;
    const v0 = Math.floor((val - range) / minor) * minor, v1 = Math.ceil((val + range) / minor) * minor;
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1;
    for (let v = v0; v <= v1; v += minor) { const lab = fmt(v); if (lab === null) continue; const yy = cy - (v - val) * pxPerUnit; const isMaj = Math.round(v) % major === 0; ctx.beginPath(); ctx.moveTo(x + w - (isMaj ? 10 : 5), yy); ctx.lineTo(x + w, yy); ctx.stroke(); if (isMaj) this.text(lab, x + w - 14, yy, h * 0.05, color, 'right'); if (mark(v) === 'barber') { ctx.fillStyle = (Math.round(v / minor) % 2) ? COL.red : '#fff'; ctx.fillRect(x + w - 4, yy - pxPerMinor, 4, pxPerMinor); } }
    // Speed bands: continuous strips on the tick edge (finer than the per-tick barber marks)
    for (const b of bands) {
      const yTop = Math.max(y, cy - (b.to - val) * pxPerUnit), yBot = Math.min(y + h, cy - (b.from - val) * pxPerUnit);
      if (!(yBot > yTop)) continue;
      if (b.style === 'barber') {
        const seg = pxPerMinor / 2;
        for (let yy = yBot; yy > yTop; yy -= seg) { ctx.fillStyle = (Math.floor((cy - yy) / seg + 1e4) % 2) ? COL.red : '#fff'; ctx.fillRect(x + w - 4, Math.max(yTop, yy - seg), 4, Math.min(seg, yy - yTop)); }
      } else { ctx.fillStyle = b.color; ctx.fillRect(x + w - 4, yTop, 4, yBot - yTop); }
    }
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x + 2, cy - h * 0.045, w - 4, h * 0.09, 3); ctx.fill(); ctx.stroke();
    this.text(isAlt ? Math.round(val / 20) * 20 : Math.round(val), x + w / 2, cy, h * 0.062, '#fff', 'center', 'bold');
    ctx.restore();
  }

  // ---------------- Engine instrument column ----------------
  gauge(x, y, r, frac, label, value, warn) {
    const ctx = this.ctx; ctx.strokeStyle = '#3a3f48'; ctx.lineWidth = Math.max(3, r * 0.18); ctx.beginPath(); ctx.arc(x, y, r, 0.75 * Math.PI, 2.25 * Math.PI); ctx.stroke();
    ctx.strokeStyle = warn ? COL.red : COL.green; ctx.beginPath(); ctx.arc(x, y, r, 0.75 * Math.PI, 0.75 * Math.PI + 1.5 * Math.PI * clamp(frac, 0, 1)); ctx.stroke();
    this.text(value, x, y + r * 0.1, Math.max(9, r * 0.5), warn ? COL.red : '#fff', 'center', 'bold'); this.text(label, x, y + r * 0.95, Math.max(8, r * 0.33), COL.dim, 'center');
  }
  engines(S, x, y, w, h) {
    const ac = S.ac; this.box(x, y, w, h, COL.panel);
    const n1 = ac.N1 ?? lerp(28, 98, ac.n1), itt = lerp(380, 780, ac.n1) + 60 * ac.engIce, n2 = lerp(55, 99, ac.n1), ff = (ac.ff || 0) / 2 / 0.45359237 * 3600;   // per engine, lb/h, from the model's TSFC
    const r = Math.min(w * 0.19, h * 0.056); const cxL = x + w * 0.3, cxR = x + w * 0.7; let gy = y + r * 1.5;
    const rows = [['N1', n1 / 100, `${n1.toFixed(0)}`, false], ['ITT', itt / 900, `${itt.toFixed(0)}`, itt > 760], ['N2', n2 / 100, `${n2.toFixed(0)}`, false], ['FF', ff / 2000, `${Math.round(ff)}`, false]];
    for (const [lab, f, v, warn] of rows) { this.gauge(cxL, gy, r, f, lab, v, warn); this.gauge(cxR, gy, r, f * (1 - 0.02 * ac.engIce), lab, v, warn); gy += r * 2.45; }
    this.text('L            R', x + w / 2, y + 7, 8, COL.dim, 'center');
    let iy = gy - r * 0.9; const barW = w - 16; const fs = Math.max(7.5, Math.min(9, w * 0.085));
    const ind = (label, f, col, marker) => { if (iy + 14 > y + h) return; this.text(label, x + 8, iy, fs, COL.dim); iy += 9; this.box(x + 8, iy - 3, barW, 6, '#2a2e36', '#3a3f48', 2); this.ctx.fillStyle = col; if (marker) this.ctx.fillRect(x + 8 + f * barW - 2, iy - 5, 4, 10); else this.ctx.fillRect(x + 8, iy - 3, f * barW, 6); iy += 13; };
    ind(`TRIM ${ac.ctl.trim < 0 ? 'ND' : 'NU'} ${Math.abs(ac.ctl.trim).toFixed(2)} ${ac.sys.trimMode}`, 0.5 + ac.ctl.trim * 0.48, ac.ctl.trim < -0.4 ? COL.red : '#fff', true);
    ind(`SPLR ${ac.ctl.sb ? 'EXT' : 'RET'} · FLAP ${ac.ctl.flaps ? Math.round(ac.ctl.flaps * 40) : 'UP'}`, Math.max(ac.ctl.sb, ac.ctl.flaps), COL.green);
    ind(`STRESS ${Math.round(ac.damage * 100)}%`, ac.damage, ac.damage > 0.7 ? COL.red : COL.amber);
    ind(`ICE W ${Math.round(ac.ice * 100)}% · STAB ${Math.round(ac.iceTail * 100)}%`, ac.iceTail, ac.iceTail > 0.5 ? COL.red : COL.cyan);
  }

  // ---------------- MFD: weather radar + data ----------------
  mfd(S, x, y, w, h) {
    this.box(x, y, w, h, COL.face);
    const o = S.out;
    if (S.wxr) this.wxRadar(S, x + 6, y + 6, w - 12, h * 0.68);
    else this.text('WX RADAR OFF (O)', x + w / 2, y + h * 0.35, 12, COL.dim, 'center');
    let ly = y + h * 0.76; const fs = Math.max(9, Math.min(12, w * 0.04));
    const row = (k, v, col = '#fff') => { this.text(k, x + 10, ly, fs, COL.dim); this.text(v, x + w - 10, ly, fs, col, 'right'); ly += fs * 1.45; };
    row('OAT / SAT', `${o.OAT.toFixed(0)}°C`); row('IN CLOUD', S.core > 0.3 ? 'CONVECTIVE CORE' : S.inCloud > 0.2 ? 'IMC' : 'VMC', S.core > 0.3 ? COL.red : '#fff');
    row('VERT AIR', `${S.updraft > 0 ? '+' : ''}${(S.updraft / FT * 60).toFixed(0)} ft/min`, Math.abs(S.updraft) > 10 ? COL.amber : '#fff');
    row('CLOCK EST', clockStr(S.t), '#ffe34d'); row('SIM RATE', `${S.timeScale}x  Q${S.quality}  ${Math.round(S.fps)} fps`);
  }
  wxRadar(S, x0, y0, w, h) {
    const ctx = this.ctx, o = S.out;
    const ox = x0 + w / 2, oy = y0 + h - 4, R = h - 14, rangeM = S.wxr.range * 1852, half = 60 * DEG;
    const nAz = 60, nR = 36, psi = o.psi, pos = S.ac.pos, hAc = o.h;
    for (let i = 0; i < nAz; i++) {
      const az = -half + (i + 0.5) / nAz * 2 * half, azAbs = psi + az;
      for (let j = 0; j < nR; j++) {
        const r = (j + 0.5) / nR * rangeM; const n = pos[0] + r * Math.cos(azAbs), e = pos[1] + r * Math.sin(azAbs);
        const dbz = S.wxr.sample(n, e, Math.max(0, hAc - 1500), hAc + 1500);
        if (dbz < 18) continue;
        ctx.fillStyle = dbz >= 50 ? '#ff40ff' : dbz >= 40 ? '#ff2020' : dbz >= 30 ? '#ffe040' : '#20c020';
        const r0 = j / nR * R, r1 = (j + 1) / nR * R, a0 = -Math.PI / 2 + az - half / nAz, a1 = a0 + 2 * half / nAz;
        ctx.beginPath(); ctx.arc(ox, oy, r1, a0, a1); ctx.arc(ox, oy, r0, a1, a0, true); ctx.fill();
      }
    }
    ctx.strokeStyle = '#4a6'; ctx.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75, 1]) { ctx.beginPath(); ctx.arc(ox, oy, R * f, -Math.PI / 2 - half, -Math.PI / 2 + half); ctx.stroke(); this.text(Math.round(S.wxr.range * f), ox + R * f * Math.sin(half) + 4, oy - R * f * Math.cos(half), 9, '#8c8', 'left'); }
    for (const a of [-60, -30, 0, 30, 60]) { ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + R * Math.sin(a * DEG), oy - R * Math.cos(a * DEG)); ctx.stroke(); }
    this.text(`WX  ${S.wxr.range} NM  TILT 0  ${S.nexOn ? 'KAMX' : 'SYNTH'}`, x0, y0 + 6, 10, '#8c8', 'left', 'bold');
    this.text(`${Math.round(wrap360(o.psi * RAD))}°`, ox, y0 + 6, 10, '#fff', 'center', 'bold');
    if (S.dbz > -20) this.text(`HERE ${S.dbz.toFixed(0)} dBZ`, x0 + w, y0 + 6, 10, S.dbz > 30 ? '#ff6060' : '#8c8', 'right');
  }

  // ---------------- Switch panel (clickable) ----------------
  switches(S, x, y, w, h) {
    this.box(x, y, w, h, COL.panel); const ac = S.ac;
    const fs = Math.max(9, Math.min(12, w * 0.048)); let sy = y + 10; const rh = Math.min(26, (h - 20) / 15);
    this.text('ANTI-ICE · STALL · TRIM · FLT CTL', x + 10, sy + 6, fs * 0.9, COL.dim, 'left', 'bold'); sy += rh;
    const sw = (id, label, state, on, key, col = COL.green) => {
      const bx = x + w - 10 - w * 0.34; this.hits.push({ x: x + 4, y: sy - rh * 0.45, w: w - 8, h: rh * 0.9, id });
      this.text(`${label}`, x + 10, sy, fs, '#dfe6ee'); if (key) this.text(key, bx - 6, sy, fs * 0.85, COL.dim, 'right');
      this.box(bx, sy - rh * 0.36, w * 0.34, rh * 0.72, on ? col : '#2a2e36', on ? col : '#3a3f48', 3);
      this.text(state, bx + w * 0.17, sy, fs * 0.95, on ? '#000' : '#9aa3ae', 'center', 'bold'); sy += rh;
    };
    sw('wingHeat', 'WING HEAT', ac.sys.wingHeat ? (ac.n1 < 0.4 ? 'ON·LOW' : 'ON') : 'OFF', ac.sys.wingHeat, 'I', ac.n1 < 0.4 ? COL.amber : COL.green);
    sw('stabHeat', 'STAB HEAT', ac.sys.stabHeat ? 'ON' : 'OFF', ac.sys.stabHeat, 'I');
    sw('nacelleHeat', 'NAC HEAT L/R', ac.sys.nacelleHeat ? 'ON' : 'OFF', ac.sys.nacelleHeat, '9');
    sw('pitotHeat', 'PITOT / WSHLD', ac.sys.pitotHeat ? 'ON' : 'OFF', ac.sys.pitotHeat, '');
    sw('stallWarn', 'STALL WARN L/R', ac.sys.stallWarn ? 'ON' : 'OFF', ac.sys.stallWarn, '6', ac.shaker ? COL.amber : COL.green);
    sw('machTrim', 'MACH TRIM', ac.sys.machTrimFail ? 'FAIL' : ac.sys.machTrim ? 'ON' : 'OFF', ac.sys.machTrim && !ac.sys.machTrimFail, '8', ac.sys.machTrimFail ? COL.amber : COL.green);
    sw('trimMode', 'PITCH TRIM', ac.sys.trimMode, ac.sys.trimMode !== 'OFF', '7', ac.sys.trimMode === 'SEC' ? COL.amber : COL.green);
    sw('ap', 'AUTOPILOT', S.ap.on ? 'ENG' : 'OFF', S.ap.on, 'X');
    sw('yd', 'YAW DAMPER', ac.ctl.yd ? 'ON' : 'OFF', ac.ctl.yd, 'Y');
    sw('sb', 'SPOILERS', ac.ctl.sb ? 'EXT' : 'RET', ac.ctl.sb > 0, 'B');
    sw('gear', 'LANDING GEAR', ac.ctl.gear ? 'DOWN' : 'UP', ac.ctl.gear > 0, 'G', S.out.KIAS > 260 && ac.ctl.gear ? COL.red : COL.green);
    sw('flaps', 'FLAPS', ac.ctl.flaps ? `${Math.round(ac.ctl.flaps * 40)}°` : 'UP', ac.ctl.flaps > 0, 'F');
    sw('atc', 'ATC AUDIO', S.atcOn ? 'ON' : 'OFF', S.atcOn, 'T', COL.cyan);
    sw('efb', 'EFB', S.efb.mode, S.efb.mode !== 'OFF', 'TAB', COL.cyan);
  }

  // ---------------- Pedestal ----------------
  pedestal(S, x, y, w, h) {
    this.box(x, y, w, h, COL.bezel, '#3a3f48', 6); const ac = S.ac;
    const lever = (lx, label, f, col) => { this.box(lx, y + 4, 14, h - 8, '#0b0c0f', '#3a3f48', 2); this.ctx.fillStyle = col; this.ctx.fillRect(lx + 2, y + 4 + (h - 8) * (1 - f) - 3, 10, 6); this.text(label, lx + 7, y + h - 6, 8, COL.dim, 'center'); };
    const cx = x + w / 2;
    lever(cx - 40, 'L', ac.ctl.thr, '#ddd'); lever(cx - 22, 'R', ac.ctl.thr, '#ddd');
    lever(cx + 10, 'SPLR', ac.ctl.sb, COL.green); lever(cx + 32, 'FLAP', ac.ctl.flaps, COL.green);
    this.text(`THRUST ${Math.round(ac.ctl.thr * 100)}%   N1 ${Math.round(lerp(28, 98, ac.n1))}%`, cx - 60, y + h / 2, 10, '#dfe6ee', 'right');
    this.text(`TRIM ${ac.ctl.trim >= 0 ? 'NU' : 'ND'} ${Math.abs(ac.ctl.trim).toFixed(2)}  [, .]   ${ac.sys.trimMode}`, cx + 60, y + h / 2, 10, ac.ctl.trim < -0.4 ? COL.red : '#dfe6ee', 'left');
    this.text(`−/= thrust · 0 idle · B spoilers · F flaps · G gear`, x + w - 10, y + h / 2, 9, COL.dim, 'right');
  }

  // ---------------- EFB tablet: map / procedures ----------------
  efb(S, x, y, w, h) {
    const ctx = this.ctx; this.box(x, y, w, h, '#0a0b0d', '#3a3f48', 10);
    this.hits.push({ x, y, w, h: 18, id: 'efb' });
    const mode = S.efb.mode;
    this.text(`EFB · ${mode === 'MAP' ? 'MAP' : mode === 'CHECKLIST' ? 'PROCEDURES' : 'OFF'} · ${clockStr(S.t)}`, x + 8, y + 10, 10, COL.cyan, 'left', 'bold');
    this.text('TAB', x + w - 8, y + 10, 9, COL.dim, 'right');
    if (mode === 'OFF') return;
    const cy0 = y + 22, ch = h - 28;
    if (mode === 'MAP') this.efbMap(S, x + 4, cy0, w - 8, ch); else this.efbChecklist(S, x + 4, cy0, w - 8, ch);
  }
  efbMap(S, x, y, w, h) {
    const ctx = this.ctx, M = S.map; ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    const rangeM = S.efb.range * 1852, sc = (h / 2) / rangeM; const cx = x + w / 2, cy = y + h / 2;
    const P = (n, e) => [cx + (e - M.e) * sc, cy - (n - M.n) * sc];
    // land / ocean
    ctx.fillStyle = '#1b2a1b'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#0d2238'; ctx.beginPath(); let first = true;
    for (let n = M.n - rangeM * 1.2; n <= M.n + rangeM * 1.2; n += 2000) { const [px, py] = P(n, M.coastX(n)); if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py); }
    ctx.lineTo(x + w + 10, y - 10); ctx.lineTo(x + w + 10, y + h + 10); ctx.closePath(); ctx.fill();
    const [lx, ly] = P(26000, -56000); ctx.beginPath(); ctx.arc(lx, ly, 24000 * sc, 0, 6.28); ctx.fill();
    // NEXRAD composite image (pre-rendered per volume, blended)
    if (M.nexImg) { const img = M.nexImg; const [ix, iy] = P(M.nexN1, M.nexE0); ctx.globalAlpha = 0.85; ctx.imageSmoothingEnabled = false; ctx.drawImage(img, ix, iy, (M.nexE1 - M.nexE0) * sc, (M.nexN1 - M.nexN0) * sc); ctx.globalAlpha = 1; }
    // range rings
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; for (const f of [0.5, 1]) { ctx.beginPath(); ctx.arc(cx, cy, rangeM * sc * f, 0, 6.28); ctx.stroke(); }
    // airport
    const [ax, ay] = P(0, 0); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax - 1500 * sc * Math.cos(10 * DEG), ay - 1500 * sc * Math.sin(10 * DEG)); ctx.lineTo(ax + 1500 * sc * Math.cos(10 * DEG), ay + 1500 * sc * Math.sin(10 * DEG)); ctx.stroke(); this.text('KPBI', ax + 6, ay - 8, 9, '#fff');
    // reported track (magenta) and own trail (green)
    ctx.strokeStyle = COL.magenta; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.beginPath(); M.ghost.forEach((p, i) => { const [px, py] = P(p[0], p[1]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke(); ctx.setLineDash([]);
    const [gx, gy] = P(M.ghost[M.ghost.length - 1][0], M.ghost[M.ghost.length - 1][1]); ctx.strokeStyle = COL.magenta; ctx.beginPath(); ctx.moveTo(gx - 5, gy - 5); ctx.lineTo(gx + 5, gy + 5); ctx.moveTo(gx + 5, gy - 5); ctx.lineTo(gx - 5, gy + 5); ctx.stroke();
    ctx.strokeStyle = COL.green; ctx.lineWidth = 2; ctx.beginPath(); M.trail.forEach((p, i) => { const [px, py] = P(p[0], p[1]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke();
    // own ship
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(M.hdg); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, -h * 0.45); ctx.stroke(); ctx.restore();
    ctx.restore();
    this.text(`${S.efb.range} NM · N UP · KAMX composite · GS ${(S.out.gs / KT).toFixed(0)} · ALT ${Math.round(S.out.h / FT)}`, x + w / 2, y + h - 8, 8.5, '#cfd', 'center');
    this.text('J range', x + w - 4, y + 10, 8, COL.dim, 'right');
  }
  efbChecklist(S, x, y, w, h) {
    const C = S.checklist; const fs = Math.max(8.5, Math.min(10.5, w * 0.042)); let ly = y + 8;
    if (C.recommended !== null && C.recommended !== C.active) { this.box(x + 2, ly - 7, w - 4, fs * 1.8, '#3a2a00', COL.amber, 3); this.text(`▶ RECOMMENDED: ${C.lists[C.recommended].key} ${C.lists[C.recommended].title}`, x + 8, ly + fs * 0.2, fs * 0.85, COL.amber, 'left', 'bold'); ly += fs * 2.2; }
    if (C.active === null) {
      this.text('EMERGENCY / ABNORMAL', x + 8, ly, fs, '#fff', 'left', 'bold'); ly += fs * 1.6;
      C.lists.forEach((L, i) => { this.hits.push({ x, y: ly - fs * 0.7, w, h: fs * 1.4, id: `ck${i}` }); this.text(`${L.key}  ${L.title}`, x + 8, ly, fs * 0.95, i === C.recommended ? COL.amber : '#dfe6ee'); ly += fs * 1.55; });
      ly += fs; this.text('Press 1–6 or tap. ` returns.', x + 8, ly, fs * 0.85, COL.dim);
      return;
    }
    const L = C.lists[C.active];
    this.text(`${L.key}  ${L.title}`, x + 8, ly, fs, '#fff', 'left', 'bold'); ly += fs * 1.6;
    L.steps.forEach((st) => {
      const done = st.done; const lines = this.wrap(st.text, w - 34, fs * 0.95);
      this.text(done ? '✓' : '○', x + 8, ly, fs, done ? COL.green : COL.amber, 'left', 'bold');
      lines.forEach((ln, k) => { if (ly < y + h - 24) this.text(ln, x + 24, ly, fs * 0.95, done ? '#9fb' : '#dfe6ee'); ly += fs * 1.22; if (k === lines.length - 1) ly += fs * 0.3; });
    });
    const n = L.steps.filter(s => s.done).length; this.text(`${n}/${L.steps.length} complete`, x + w - 8, y + h - 10, fs * 0.9, n === L.steps.length ? COL.green : COL.dim, 'right');
    this.hits.push({ x, y: y + h - 22, w: 80, h: 20, id: 'ckback' }); this.text('‹ list', x + 8, y + h - 10, fs * 0.9, COL.cyan);
  }
  wrap(txt, maxW, fs) { const ctx = this.ctx; ctx.font = `${fs}px ${FONT}`; const words = txt.split(' '); const lines = []; let cur = ''; for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = wd; } else cur = t; } if (cur) lines.push(cur); return lines; }

  // ---------------- Shared: windshield, frame, header, warnings, profile, log, help ----------------
  windshield(S) {
    const ctx = this.ctx, W = this.W, H = this.H, o = S.out; const top = H * 0.56;
    const n = Math.floor(90 * S.inCloud * clamp(o.V / 200, 0.3, 1.5));
    if (n > 0) { ctx.strokeStyle = 'rgba(220,230,255,0.28)'; ctx.lineWidth = 1.2; ctx.beginPath(); const slant = Math.sin(o.beta) * 2.5, len = 10 + o.V * 0.25; for (let i = 0; i < n; i++) { const x = Math.random() * W, y = Math.random() * top; ctx.moveTo(x, y); ctx.lineTo(x + slant * len * 0.3 + (Math.random() - 0.5) * 2, y + len * (0.6 + Math.random() * 0.6)); } ctx.stroke(); }
    if (S.core > 0.3) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; for (let i = 0; i < 25 * S.core; i++) { ctx.beginPath(); ctx.arc(Math.random() * W, Math.random() * top, 1 + Math.random() * 2, 0, 6.28); ctx.fill(); } }
    if (S.inCloud > 0) { ctx.fillStyle = `rgba(${S.core > 0.3 ? '40,42,50' : '200,205,215'},${0.15 * S.inCloud + 0.35 * S.core})`; ctx.fillRect(0, 0, W, top); }
    const ice = S.ac.sys.wshldHeat ? S.ac.ice * 0.5 : S.ac.ice;
    if (ice > 0.02) {
      const g = ctx.createRadialGradient(W / 2, top * 0.45, Math.max(10, W * 0.25 * (1.25 - ice)), W / 2, top * 0.45, W * 0.75);
      g.addColorStop(0, 'rgba(235,240,250,0)'); g.addColorStop(1, `rgba(235,240,250,${0.25 + 0.65 * ice})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, top);
      const bg = ctx.createLinearGradient(0, top - (20 + 110 * ice), 0, top); bg.addColorStop(0, 'rgba(240,244,250,0)'); bg.addColorStop(1, `rgba(240,244,250,${0.55 + 0.4 * ice})`);
      ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(0, top);
      for (let x = 0; x <= W; x += 6) ctx.lineTo(x, top - (20 + 110 * ice) * (0.55 + 0.25 * Math.sin(x * 0.011 + 1.3) + 0.2 * Math.sin(x * 0.031 + ice * 7)));
      ctx.lineTo(W, top); ctx.fill();
    }
    if (S.flash > 0) { ctx.fillStyle = `rgba(230,235,255,${S.flash * 0.55})`; ctx.fillRect(0, 0, W, top); }
  }
  cockpitFrame(S) {
    const ctx = this.ctx, W = this.W, H = this.H, top = H * 0.56;
    ctx.fillStyle = '#1b1c20';
    ctx.beginPath(); ctx.moveTo(W / 2 - 9, 0); ctx.lineTo(W / 2 + 9, 0); ctx.lineTo(W / 2 + 15, top); ctx.lineTo(W / 2 - 15, top); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.09, 0); ctx.lineTo(W * 0.02, top); ctx.lineTo(0, top); ctx.fill();
    ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W * 0.91, 0); ctx.lineTo(W * 0.98, top); ctx.lineTo(W, top); ctx.fill();
    ctx.fillRect(0, 0, W, H * 0.035);
    const g = ctx.createLinearGradient(0, top, 0, H); g.addColorStop(0, '#2a2b30'); g.addColorStop(0.08, '#15161a'); g.addColorStop(1, '#0c0c0f');
    ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
    ctx.fillStyle = '#3a3b42'; ctx.fillRect(0, top - 3, W, 5);
  }
  header(S) {
    const y = 14;
    this.text(`N722BD · LEARJET 60 · ${clockStr(S.t)} EST${S.replay ? (S.recon ? '  ·  RECONSTRUCTION · ' : '  ·  REPLAY · ') + (S.camAuto ? 'AUTO/' : '') + ['COCKPIT', 'CHASE', 'GROUND CAM'][S.camMode] : ''}`, 12, y, 13, '#ffe34d', 'left', 'bold');
    this.text(S.recon ? S.hypName : `HYPOTHESIS: ${S.hypName}`, 12, y + 17, 11, S.recon ? '#ff80d0' : '#9ab');
    this.text(`[H] help  [C] camera  [V] ghost  [N] skip  [R] restart  [T] ATC ${S.atcOn ? 'ON' : 'off'}${S.atcShift ? ` (${S.atcShift > 0 ? '+' : ''}${S.atcShift}s)` : ''}  [U] NEXRAD ${S.nexOn ? 'ON' : 'off'}  [TAB] EFB  [1-6] procedures  [Z] hide HUD`, 12, y + 33, 11, '#678');
  }
  warnings(S, blink) {
    const W = this.W, H = this.H, ac = S.ac; let msg = null, col = COL.red;
    if (S.endMsg) { msg = S.endMsg; col = S.recovered && !ac.broken && !ac.crashed ? COL.green : COL.red; }
    else if (S.recovered !== null && S.t - S.recovered < 6) { msg = `RECOVERED · ${Math.round(S.recoveredAlt / FT / 100) * 100} FT · ${(S.recovered - S.upsetT).toFixed(0)} s AFTER UPSET`; col = COL.green; }
    else if (S.apOffAt !== null && S.t - S.apOffAt < 4 && blink) { msg = 'AUTOPILOT DISCONNECT'; col = COL.amber; }
    if (msg) { const ctx = this.ctx; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(W / 2 - 300, H * 0.09, 600, 44); this.text(msg, W / 2, H * 0.09 + 22, 22, col, 'center', 'bold'); }
  }
  profile(S) {
    const ctx = this.ctx, W = this.W; const w = Math.min(W * 0.26, 400), h = w * 0.48, x = W - w - 12, y = 12;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill();
    const px = (t) => x + 36 + (t / 160) * (w - 46), py = (alt) => y + 8 + (1 - alt / 42000) * (h - 30);
    ctx.strokeStyle = '#444'; ctx.lineWidth = 1; for (const a of [0, 10000, 20000, 30000, 40000]) { ctx.beginPath(); ctx.moveTo(px(0), py(a)); ctx.lineTo(px(160), py(a)); ctx.stroke(); this.text(a / 1000, x + 30, py(a), 9, '#888', 'right'); }
    for (const t of [0, 30, 60, 90, 120, 150]) this.text(t, px(t), y + h - 8, 9, '#888', 'center');
    ctx.strokeStyle = COL.magenta; ctx.lineWidth = 2; ctx.beginPath(); S.ghostProfile.forEach((p, i) => i ? ctx.lineTo(px(p.t), py(p.alt)) : ctx.moveTo(px(p.t), py(p.alt))); ctx.stroke();
    ctx.strokeStyle = COL.green; ctx.lineWidth = 2; ctx.beginPath(); S.hist.forEach((p, i) => i ? ctx.lineTo(px(p.t), py(p.h / FT)) : ctx.moveTo(px(p.t), py(p.h / FT))); ctx.stroke();
    for (const ev of TIMELINE) if (ev.who === 'ACT') { const gp = S.ghostAlt(ev.t); ctx.fillStyle = COL.magenta; ctx.beginPath(); ctx.arc(px(ev.t), py(gp), 3, 0, 6.28); ctx.fill(); }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px(Math.min(S.t, 160)), y + 8); ctx.lineTo(px(Math.min(S.t, 160)), y + h - 20); ctx.stroke();
    this.text('ACTUAL (ADS-B)', x + w - 8, y + 12, 10, COL.magenta, 'right', 'bold'); this.text('YOU', x + w - 8, y + 24, 10, COL.green, 'right', 'bold');
    if (!S.recon) this.text(`max G ${S.ac.maxG.toFixed(1)}  max M ${S.ac.maxM.toFixed(2)}  max ${Math.abs(S.ac.maxVS / FT * 60).toFixed(0)} fpm`, x + 36, y + 12, 10, '#ccc');
  }
  commLog(S) {
    const H = this.H; const lines = S.log.slice(-6); let y = S.cockpit3d ? 64 : H * 0.56 - 16 - lines.length * 17;
    if (S.ext) y = H - 40 - lines.length * 17 - Math.min(this.W * 0.2, H * 0.3) * 0.95;
    for (const l of lines) { const col = l.who === 'MIA' ? '#9cf' : l.who === 'FO' || l.who === 'CA' ? '#ffe34d' : l.who === 'ACT' ? COL.magenta : '#ff9a3b'; const ctx = this.ctx; ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.font = `12px ${FONT}`; const tw = ctx.measureText(`${clockStr(l.t)} ${l.who}: ${l.txt}`).width + 12; ctx.fillRect(10, y - 8, tw, 16); this.text(`${clockStr(l.t)} ${l.who}: ${l.txt}`, 16, y, 12, col); y += 17; }
  }
  help() {
    const ctx = this.ctx, W = this.W, H = this.H; ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(W / 2 - 380, H / 2 - 250, 760, 500);
    const L = ['CONTROLS', '', 'Pitch: ↑/↓ or W/S (↓ or S = pull)  ·  Roll: ←/→ or A/D  ·  Rudder: Q/E  ·  mouse-drag = stick', 'Throttle: − / =   ·   0 = idle   ·   B spoilers   ·   G gear (VLO 200 / VLE 260 KIAS)   ·   F flaps 8/20/40 (VFE 250/200/165 KIAS)', 'Pitch trim: , nose-down  . nose-up (PRI/SEC only)   ·   7 = trim PRI/SEC/OFF   ·   8 = Mach trim', 'I = wing+stab heat   ·   9 = nacelle heat   ·   6 = stall warning (shaker) cutout   ·   Y = yaw damper', 'X = autopilot off / engage   ·   TAB = EFB map / procedures / off   ·   1–6 = procedure card   ·   ` = back', 'C camera (right-drag orbits)   ·   V ghost   ·   T ATC audio   ·   ; / \' nudge tape   ·   U NEXRAD   ·   O/J radar', 'N skip   ·   [ ] sim rate   ·   K quality   ·   P pause   ·   R restart   ·   M mute   ·   Z hide HUD   ·   H help', 'Controller (DualShock/DualSense/Xbox): L stick pitch/roll · R stick rudder · R2/L2 thrust · R1/L1 trim up/down · ✕ AP · ○ spoilers · □ idle · △ camera · D-pad ↑ gear ↓ flaps · L3 yaw damper · Options pause · Create help · rumble on shaker/buffet (Chrome)', '3D cockpit: right-drag to look around, mouse wheel to zoom; the switch panel and EFB are clickable.', '', 'UPSET RECOVERY (nose low, high speed):', '1. Recognize, AP off.  2. Thrust IDLE, spoilers OUT.  3. Stalled? UNLOAD first.', '4. Roll to nearest horizon.  5. Pull smoothly ~2 g; with ice the wing can stall before the shaker.', '6. Re-trim nose-up. Above M.81 the tuck fights you; speed must come off first.'];
    L.forEach((l, i) => this.text(l, W / 2, H / 2 - 225 + i * 30, i === 0 || i === 11 ? 16 : 12, i === 0 || i === 11 ? '#ffe34d' : '#ddd', 'center', i === 0 ? 'bold' : ''));
  }
}
