// Standby and secondary instruments of the Learjet 60 virtual cockpit, drawn into small canvases (our own artwork)
// and placed at the gauge positions of the original panel.cfg: { w, h: canvas size, at: [[panel texture, x, y, w, h]],
// every: redraw interval in frames, bg: background (null = transparent), draw(ctx, S, hud, blink) }.
import { DEG, RAD, clamp, wrap360, lerp } from './util.js';
import { FT } from './atmo.js';

const FONT = '"SF Mono", Menlo, Consolas, monospace';
const txt = (ctx, s, x, y, size, color = '#e8eef4', align = 'center', weight = 'bold') => {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
};
// Round bezel with a black face; returns the face radius
function bezel(ctx, w, h) {
  const r = Math.min(w, h) / 2, cx = w / 2, cy = h / 2;
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r);
  g.addColorStop(0, '#4a4e55'); g.addColorStop(1, '#16181b');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
  ctx.fillStyle = '#050505'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.88, 0, 7); ctx.fill();
  return r * 0.88;
}
const glassShine = (ctx, w, h, r) => {
  const g = ctx.createLinearGradient(0, h / 2 - r, 0, h / 2); g.addColorStop(0, 'rgba(255,255,255,0.1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(w / 2, h / 2 - r * 0.45, r * 0.75, r * 0.45, 0, 0, 7); ctx.fill();
};
function needle(ctx, cx, cy, a, len, wid, col = '#f2f2f2') {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(-wid, len * 0.15); ctx.lineTo(0, -len); ctx.lineTo(wid, len * 0.15); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(cx, cy, wid * 1.6, 0, 7); ctx.fill();
}
function dialTicks(ctx, cx, cy, r, n, a0, a1, major, labels, fs) {
  ctx.strokeStyle = '#eee';
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n), big = i % major === 0; ctx.lineWidth = big ? 3 : 1.5;
    ctx.beginPath(); ctx.moveTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r); ctx.lineTo(cx + Math.sin(a) * r * (big ? 0.82 : 0.9), cy - Math.cos(a) * r * (big ? 0.82 : 0.9)); ctx.stroke();
    if (big && labels) { const s = labels(i / major); if (s !== null) txt(ctx, s, cx + Math.sin(a) * r * 0.66, cy - Math.cos(a) * r * 0.66, fs, '#eee'); }
  }
}

// Attitude ball: pitch ladder and bank pointer inside radius r (shared by the standby ADI)
function attitude(ctx, cx, cy, r, theta, phi) {
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate(-phi); const ppd = r / 28; ctx.translate(0, theta * RAD * ppd);
  ctx.fillStyle = '#2a78c8'; ctx.fillRect(-3 * r, -6 * r, 6 * r, 6 * r); ctx.fillStyle = '#7a5226'; ctx.fillRect(-3 * r, 0, 6 * r, 6 * r);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-3 * r, 0); ctx.lineTo(3 * r, 0); ctx.stroke();
  ctx.lineWidth = 1.5;
  for (let d = -60; d <= 60; d += 10) { if (!d) continue; const y = -d * ppd, w = d % 20 === 0 ? r * 0.45 : r * 0.22; ctx.beginPath(); ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); ctx.stroke(); if (d % 20 === 0) txt(ctx, Math.abs(d), w / 2 + r * 0.14, y, r * 0.14, '#fff'); }
  ctx.restore();
  ctx.save(); ctx.translate(cx, cy); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  for (const a of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) { ctx.save(); ctx.rotate(a * DEG); ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, -r * (a % 30 === 0 ? 0.86 : 0.92)); ctx.stroke(); ctx.restore(); }
  ctx.rotate(-phi); ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.moveTo(0, -r * 0.84); ctx.lineTo(-r * 0.06, -r * 0.72); ctx.lineTo(r * 0.06, -r * 0.72); ctx.fill(); ctx.restore();
  ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = Math.max(3, r * 0.05); ctx.beginPath();
  ctx.moveTo(cx - r * 0.55, cy); ctx.lineTo(cx - r * 0.2, cy); ctx.lineTo(cx - r * 0.1, cy + r * 0.1); ctx.moveTo(cx + r * 0.55, cy); ctx.lineTo(cx + r * 0.2, cy); ctx.lineTo(cx + r * 0.1, cy + r * 0.1); ctx.stroke();
  ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.03, 0, 7); ctx.fill();
}

// Compass rose (HSI lower half of the PFD, RMI): heading up, lubber line, track diamond
export function rose(ctx, cx, cy, r, hdg, trk, fs) {
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.rotate(-hdg * DEG); ctx.strokeStyle = '#fff';
  for (let d = 0; d < 360; d += 5) {
    const big = d % 10 === 0; ctx.lineWidth = big ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, -r * (big ? 0.88 : 0.93)); ctx.stroke();
    if (d % 30 === 0) { const lab = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] || String(d / 10); txt(ctx, lab, 0, -r * 0.76, fs, '#fff'); }
    ctx.rotate(5 * DEG);
  }
  ctx.restore();
  ctx.save(); ctx.translate(cx, cy); ctx.rotate((trk - hdg) * DEG); ctx.fillStyle = '#6cff6c';
  ctx.beginPath(); ctx.moveTo(0, -r * 0.99); ctx.lineTo(-r * 0.04, -r * 0.92); ctx.lineTo(0, -r * 0.85); ctx.lineTo(r * 0.04, -r * 0.92); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(cx, cy - r * 1.0); ctx.lineTo(cx - r * 0.05, cy - r * 1.1); ctx.lineTo(cx + r * 0.05, cy - r * 1.1); ctx.fill();
  // aircraft symbol
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.25); ctx.lineTo(cx, cy + r * 0.3); ctx.moveTo(cx - r * 0.2, cy); ctx.lineTo(cx + r * 0.2, cy); ctx.moveTo(cx - r * 0.09, cy + r * 0.25); ctx.lineTo(cx + r * 0.09, cy + r * 0.25); ctx.stroke();
}

const flagLight = (ctx, x, y, w, h, label, on, col, fs) => {
  ctx.fillStyle = on ? col : '#141517'; ctx.strokeStyle = '#3a3e44'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill(); ctx.stroke();
  const lines = label.split('\n'); lines.forEach((l, i) => txt(ctx, l, x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * fs * 1.05, fs, on ? '#000' : '#3e434a'));
};

export const GAUGES = {
  // glareshield: our annunciator row and flight-guidance strip over the painted annunciator grid
  // two rows of lights like the painted grid, labels wrapped so they can be set large; FGC modes over the target readout
  ann: { w: 900, h: 74, every: 2, at: [['$panup', 34, 426, 440, 36]], draw(ctx, S, h, blink) {
    ctx.fillStyle = '#16181c'; ctx.fillRect(0, 0, 900, 74);
    const L = h.annLights(S), per = Math.ceil(L.length / 2), lw = 560 / per;
    L.forEach(([label, lit, col, flash], i) => {
      const r = Math.floor(i / per), c = i % per, on = lit && (flash ? blink : true);
      const lab = label.length > 7 ? label.replace(' ', '\n') : label, longest = Math.max(...lab.split('\n').map(t => t.length));
      flagLight(ctx, 4 + c * lw, 3 + r * 35, lw - 5, 33, lab, on, col, Math.min(13, (lw - 12) / (longest * 0.62)));
    });
    ctx.fillStyle = '#060708'; ctx.strokeStyle = '#3a3e44'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(572, 3, 324, 68, 4); ctx.fill(); ctx.stroke();
    h.fgcModes(S).forEach(([m, act], i) => txt(ctx, m, 606 + i * 64, 22, 17, act ? '#6cff6c' : '#3b434d'));
    txt(ctx, h.fgcText(S), 734, 52, 15, S.ap.on ? '#7fd7ff' : '#ffb000', 'center', '');
  } },
  // flight-guidance push-buttons on the glareshield face either side of the trim display (4x the 512 panel
  // space from x 100, y 466): labelled caps, green bar lit for the engaged modes; AP and YD are clickable
  apLights: { w: 1168, h: 92, every: 3, bg: null, at: [['$panup', 100, 466, 292, 23]], draw(ctx, S, h) {
    const ap = S.ap.on, yd = S.ac.ctl.yd;
    const groups = [[8, 84, [['HDG', ap, 'ap'], ['NAV', false, 'ap'], ['APR', false, 'ap'], ['ALT', ap, 'ap'], ['VS', false, 'ap']]],
      [670, 97, [['AP', ap, 'ap'], ['YD', yd, 'yd'], ['FD', ap, 'ap'], ['IAS', false, 'ap'], ['MACH', ap, 'ap']]]];
    for (const [x0, bw, btns] of groups) {
      const gw = btns.length * bw + 12;
      ctx.fillStyle = '#1b1d21'; ctx.strokeStyle = '#4a4e56'; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(x0, 2, gw, 88, 8); ctx.fill(); ctx.stroke();
      btns.forEach(([lab, on, id], i) => {
        const x = x0 + 6 + i * bw;
        const g = ctx.createLinearGradient(0, 8, 0, 84); g.addColorStop(0, '#5a5e66'); g.addColorStop(1, '#30333a');
        ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x + 4, 8, bw - 8, 76, 6); ctx.fill();
        ctx.fillStyle = on ? '#5dff6a' : '#16301a'; ctx.shadowColor = '#5dff6a'; ctx.shadowBlur = on ? 16 : 0;
        ctx.fillRect(x + 18, 14, bw - 36, 12); ctx.shadowBlur = 0;
        txt(ctx, lab, x + bw / 2, 56, 24, '#eef2f6');
        h.hits.push({ x: x + 4, y: 8, w: bw - 8, h: 76, id });
      });
    }
  } },
  // MASTER WARNING / MASTER CAUTION pair at the top of the pilot's panel
  master: { w: 164, h: 112, every: 2, at: [['$panL', 625, 140, 41, 28]], draw(ctx, S, h, blink) {
    const o = S.out, ac = S.ac;
    const warn = ac.broken || o.stalled && o.alpha > 0 || (o.vs < -30 && o.h < 3000);
    const caut = o.overspeed || ac.iceTail > 0.5 || ac.engIce > 0.3 || (!S.ap.on && S.apOffAt !== null && S.t - S.apOffAt < 4);
    flagLight(ctx, 4, 4, 156, 50, 'MASTER\nWARNING', warn && blink, '#ff3030', 18); flagLight(ctx, 4, 58, 156, 50, 'MASTER\nCAUTION', caut && blink, '#ffb000', 18);
  } },
  // standby attitude indicator
  sadi: { w: 320, h: 320, every: 1, at: [['$panL', 913, 134, 104, 104]], draw(ctx, S) {
    const r = bezel(ctx, 320, 320); attitude(ctx, 160, 160, r * 0.96, S.out.theta, S.out.phi); glassShine(ctx, 320, 320, r);
    txt(ctx, 'STBY', 160, 160 + r * 0.72, 18, '#ddd');
  } },
  // standby airspeed: 40..450 KIAS, one and a half turns compressed onto 320 deg
  sasi: { w: 240, h: 240, every: 2, at: [['$panL', 832, 152, 70, 72]], draw(ctx, S) {
    const r = bezel(ctx, 240, 240), cx = 120, cy = 120, a = (v) => (-160 + 320 * Math.pow(clamp((v - 40) / 410, 0, 1), 0.8)) * DEG;
    ctx.strokeStyle = '#d22'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, r * 0.94, a(S.out.Vmo || 306) - Math.PI / 2, a(450) - Math.PI / 2); ctx.stroke();
    for (let v = 40; v <= 450; v += 10) { const big = v % 50 === 0, aa = a(v); ctx.strokeStyle = '#eee'; ctx.lineWidth = big ? 3 : 1.2; ctx.beginPath(); ctx.moveTo(cx + Math.sin(aa) * r, cy - Math.cos(aa) * r); ctx.lineTo(cx + Math.sin(aa) * r * (big ? 0.82 : 0.9), cy - Math.cos(aa) * r * (big ? 0.82 : 0.9)); ctx.stroke();
      if (big && v % 100 === 0 || v === 50) txt(ctx, v / 10 | 0, cx + Math.sin(aa) * r * 0.66, cy - Math.cos(aa) * r * 0.66, 22); }
    txt(ctx, 'KNOTS', cx, cy + r * 0.35, 15, '#bbb'); txt(ctx, `M${S.out.M.toFixed(2).slice(1)}`, cx, cy - r * 0.32, 16, '#bbb', 'center', '');
    needle(ctx, cx, cy, a(S.out.KIAS), r * 0.85, 7); glassShine(ctx, 240, 240, r);
  } },
  // standby altimeter (copilot side): 100-ft pointer plus a drum readout
  salt: { w: 240, h: 240, every: 2, at: [['$panR', 0, 152, 70, 72]], draw(ctx, S) {
    const r = bezel(ctx, 240, 240), cx = 120, cy = 120, ft = S.out.h / FT;
    dialTicks(ctx, cx, cy, r, 50, 0, 2 * Math.PI, 5, (i) => i < 10 ? String(i) : null, 24);
    ctx.fillStyle = '#111'; ctx.strokeStyle = '#555'; ctx.fillRect(cx - 52, cy - 50, 104, 34); ctx.strokeRect(cx - 52, cy - 50, 104, 34);
    txt(ctx, String(Math.round(ft / 20) * 20).padStart(5, '0'), cx, cy - 33, 26, '#eee');
    txt(ctx, '29.92', cx, cy + r * 0.45, 16, '#bbb', 'center', '');
    needle(ctx, cx, cy, (ft % 1000) / 1000 * 2 * Math.PI, r * 0.86, 7); glassShine(ctx, 240, 240, r);
  } },
  // RMI / standby heading at the centre of the panel
  rmi: { w: 360, h: 360, every: 2, at: [['$panL', 903, 240, 120, 120]], draw(ctx, S) {
    const r = bezel(ctx, 360, 360), hdg = wrap360((S.out.psi || 0) * RAD), trk = wrap360((S.out.track ?? S.out.psi ?? 0) * RAD);
    rose(ctx, 180, 180, r * 0.92, hdg, trk, 26); glassShine(ctx, 360, 360, r);
  } },
  // panel clock: elapsed-time digits under the hands, scenario local time
  clock: { w: 240, h: 240, every: 10, at: [['$panL', 170, 240, 75, 75], ['$panR', 530, 244, 75, 75]], draw(ctx, S) {
    const r = bezel(ctx, 240, 240), cx = 120, cy = 120, t = 12 * 3600 + 47 * 60 + (S.t || 0);
    dialTicks(ctx, cx, cy, r, 60, 0, 2 * Math.PI, 5, (i) => i < 12 ? String(i || 12) : null, 22);
    needle(ctx, cx, cy, ((t / 3600) % 12) / 12 * 2 * Math.PI, r * 0.5, 7); needle(ctx, cx, cy, ((t / 60) % 60) / 60 * 2 * Math.PI, r * 0.8, 5);
    needle(ctx, cx, cy, (t % 60) / 60 * 2 * Math.PI, r * 0.85, 2, '#e33'); glassShine(ctx, 240, 240, r);
  } },
  // landing gear: three greens / red in transit, and the lever (click to cycle)
  gear: { w: 180, h: 135, every: 4, at: [['$panL', 924, 376, 60, 45]], draw(ctx, S) {
    const dn = S.ac.ctl.gear > 0, unsafe = S.out.KIAS > 260 && dn;
    for (const [x, y, l] of [[90, 30, 'NOSE'], [40, 95, 'LH'], [140, 95, 'RH']]) flagLight(ctx, x - 34, y - 22, 68, 44, l, dn, unsafe ? '#ff3030' : '#3cff50', 16);
  } },
  gearLever: { w: 72, h: 300, every: 4, bg: '#1a1c1f', at: [['$panL', 985, 340, 24, 100]], draw(ctx, S, h) {
    const dn = S.ac.ctl.gear > 0; h.hits.push({ x: 0, y: 0, w: 72, h: 300, id: 'gear' });
    ctx.fillStyle = '#0b0b0c'; ctx.fillRect(28, 20, 16, 260); txt(ctx, 'UP', 36, 10, 14, '#bbb'); txt(ctx, 'DN', 36, 292, 14, '#bbb');
    const y = dn ? 230 : 70; ctx.fillStyle = '#ccc'; ctx.fillRect(31, Math.min(y, 150), 10, Math.abs(y - 150));
    ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.arc(36, y, 26, 0, 7); ctx.fill(); ctx.strokeStyle = '#888'; ctx.lineWidth = 3; ctx.stroke();
  } },
  // fuel quantity readout above the engine column
  fuel: { w: 306, h: 132, every: 15, at: [['$panL', 699, 120, 102, 44]], draw(ctx, S) {
    const lb = (S.ac.fuel || 0) / 0.45359237;
    ctx.fillStyle = '#111'; ctx.fillRect(4, 4, 298, 124); txt(ctx, 'FUEL QTY  LB', 153, 24, 18, '#aab');
    txt(ctx, String(Math.round(lb / 10) * 10), 153, 78, 46, '#ff5a3a', 'center', 'bold'); txt(ctx, 'TOTAL', 153, 114, 14, '#889');
  } },
  // flap / spoiler position indicators (copilot panel)
  spdbrk: { w: 150, h: 210, every: 4, at: [['$panR', 0, 368, 50, 70]], draw(ctx, S) { posGauge(ctx, 'SPOILER', S.ac.ctl.sb, ['RET', 'EXT']); } },
  flapsInd: { w: 150, h: 210, every: 4, at: [['$panR', 51, 368, 50, 70]], draw(ctx, S) { posGauge(ctx, 'FLAPS', S.ac.ctl.flaps, ['0', '8', '20', '40']); } },
  // pitch trim indicator
  trim: { w: 81, h: 264, every: 3, at: [['$panL', 892, 363, 27, 88]], draw(ctx, S) {
    const tr = S.ac.ctl.trim; ctx.fillStyle = '#111'; ctx.fillRect(4, 4, 73, 256); txt(ctx, 'NU', 40, 18, 14, '#bbb'); txt(ctx, 'ND', 40, 246, 14, '#bbb');
    ctx.fillStyle = '#2a7a2a'; ctx.fillRect(30, 90, 20, 60); ctx.fillStyle = '#eee'; const y = 132 - tr * 100; ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(60, y - 9); ctx.lineTo(60, y + 9); ctx.fill();
  } },
  // whiskey compass on the windshield centre post
  compass: { w: 256, h: 256, every: 2, at: [['$pancompass', 65, 70, 125, 140]], draw(ctx, S) {
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, 256, 256);
    const hdg = wrap360((S.out.psi || 0) * RAD), ppd = 4; ctx.save(); ctx.beginPath(); ctx.rect(14, 60, 228, 136); ctx.clip();
    ctx.fillStyle = '#d8d0b8'; ctx.fillRect(14, 60, 228, 136); ctx.strokeStyle = '#111';
    for (let d = Math.floor(hdg - 30); d <= hdg + 30; d++) { if (d % 5) continue; const x = 128 + (d - hdg) * ppd, v = wrap360(d); ctx.lineWidth = v % 10 ? 1 : 2; ctx.beginPath(); ctx.moveTo(x, 60); ctx.lineTo(x, v % 10 ? 82 : 92); ctx.stroke();
      if (v % 30 === 0) txt(ctx, { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[v] || String(v / 10), x, 130, 34, '#111'); }
    ctx.restore(); ctx.strokeStyle = '#e22'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(128, 56); ctx.lineTo(128, 200); ctx.stroke();
  } },
  // anti-ice / stall / trim / flight-control switch panel (clickable), outboard of the pilot's PFD
  sw: { w: 400, h: 340, every: 4, at: [['$panL', 132, 124, 134, 113]], draw: (ctx, S, h) => h.switches(S, 0, 0, 400, 340) },
  // EFB tablet clamped to the left side window frame
  efb: { w: 560, h: 760, every: 4, quad: [[-0.9, 0.16, 5.98], [-0.75, 0.16, 6.16], [-0.75, -0.08, 6.12], [-0.9, -0.08, 5.94]], draw: (ctx, S, h) => h.efb(S, 0, 0, 560, 760) },
};

function posGauge(ctx, label, f, marks) {
  ctx.fillStyle = '#111'; ctx.fillRect(4, 4, 142, 202); txt(ctx, label, 75, 22, 16, '#bbb');
  marks.forEach((m, i) => txt(ctx, m, 112, 52 + i * 136 / Math.max(1, marks.length - 1), 15, '#ccc'));
  ctx.fillStyle = '#333'; ctx.fillRect(48, 48, 10, 140); ctx.fillStyle = '#eee';
  const y = 52 + clamp(f, 0, 1) * 136; ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(80, y - 10); ctx.lineTo(80, y + 10); ctx.fill();
}
