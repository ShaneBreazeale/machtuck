// Primary flight display in the style of the Learjet 60's Collins Pro Line 4: flight-guidance mode band (active modes
// green, armed white, AC 25.1329-1C 44c), attitude with a single-cue (V-bar) flight director, speed tape with trend
// vector and Mach, altitude tape with preselect, baro and minimums, vertical speed scale, localizer / glideslope (or FMS
// lateral / vertical) deviation, and an HSI with the heading bug, course pointer and deviation bar. Drawn into any box:
// portrait (the 3D panel) shows the whole compass rose, landscape (the 2D panel) the top of it.
import { DEG, RAD, clamp, wrap360 } from './util.js';
import { FT, KT } from './atmo.js';

const C = { sky: '#2e78d6', gnd: '#8c5a22', tape: '#1c2868', tapeHi: '#2a3a8c', band: '#0b1a5e', green: '#3dff5a', cyan: '#46e0ff', mag: '#ff4fd8', white: '#f2f5f8', amber: '#ffb000', red: '#ff3b3b', grey: '#9aa4b0' };
const pad3 = (d) => String(Math.round(wrap360(d)) || 360).padStart(3, '0');
const VERT_NAME = { ALTS: 'ALTS CAP', TO: 'TO', GA: 'GA' };

export function drawPfd(H, S, blink, x, y, w, h) {
  const ctx = H.ctx, o = S.out, ap = S.ap, mv = S.magvar ?? 0;
  const T = (s, X, Y, sz, col, al = 'center', wt = 'bold') => H.text(s, X, Y, sz, col, al, wt);
  const u = Math.min(w, h * 0.9);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h);
  // ---- layout ----
  const bandH = u * 0.07, adiW = w * 0.5, adiH = Math.min(h * 0.42, adiW * 0.92), cx = x + w * 0.465, top = y + bandH + u * 0.012, cy = top + adiH / 2;
  const tapeW = w * 0.135, tapeH = adiH * 1.06, ty = cy - tapeH / 2, sx = cx - adiW / 2 - u * 0.018 - tapeW, ax = cx + adiW / 2 + u * 0.035, vx = ax + tapeW + u * 0.006, vw = w * 0.07;
  const fs = u * 0.034;

  // ---- flight-guidance mode band ----
  {
    const bx = sx, bw = vx + vw - sx, by = y + u * 0.006, bh = bandH - u * 0.008, my = by + bh / 2;
    ctx.fillStyle = C.band; ctx.fillRect(bx, by, bw, bh);
    const g = ap.on || ap.fd, sz = Math.min(bh * 0.42, fs * 1.15);
    if (g) {
      T(ap.lat, bx + bw * 0.04, my - bh * 0.2, sz, C.green, 'left');
      if (ap.latArm) T(ap.latArm, bx + bw * 0.04, my + bh * 0.24, sz * 0.85, C.white, 'left');
      T(VERT_NAME[ap.vert] || ap.vert, bx + bw * 0.96, my - bh * 0.2, sz, C.green, 'right');
      const va = [ap.vertArm, /^(VS|VNAV|TO|GA)$/.test(ap.vert) ? 'ALTS' : null].filter(Boolean).join(' ');
      if (va) T(va, bx + bw * 0.96, my + bh * 0.24, sz * 0.85, C.white, 'right');
    }
    const recentOff = !ap.on && S.apOffWall != null && performance.now() / 1000 - S.apOffWall < 5;
    const mid = [ap.on ? ['AP', C.green] : recentOff ? ['AP', blink ? C.red : C.amber] : null, S.ac.ctl.yd ? ['YD', C.green] : null].filter(Boolean);
    mid.forEach((m, i) => T(m[0], bx + bw / 2 + (i - (mid.length - 1) / 2) * sz * 2.4, my, sz, m[1]));
    if (!g && ap.why) T(`AP OFF ${ap.why}`, bx + bw * 0.04, my, sz * 0.8, C.amber, 'left');
  }

  // ---- attitude ----
  const th = o.theta, ph = o.phi, ppd = adiH / 42;   // pixels per degree of pitch
  ctx.save(); ctx.beginPath(); ctx.rect(cx - adiW / 2, top, adiW, adiH); ctx.clip();
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-ph); ctx.translate(0, th * RAD * ppd);
  ctx.fillStyle = C.sky; ctx.fillRect(-3 * adiW, -6 * adiH, 6 * adiW, 6 * adiH);
  ctx.fillStyle = C.gnd; ctx.fillRect(-3 * adiW, 0, 6 * adiW, 6 * adiH);
  ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.5, u * 0.004); ctx.beginPath(); ctx.moveTo(-3 * adiW, 0); ctx.lineTo(3 * adiW, 0); ctx.stroke();
  ctx.lineWidth = Math.max(1, u * 0.003);
  const p0 = th * RAD;
  for (let d = -90; d <= 90; d += 2.5) {
    if (d === 0 || Math.abs(d - p0) > 24) continue;
    const yy = -d * ppd, big = d % 10 === 0, mid = d % 5 === 0, L = big ? adiW * 0.26 : mid ? adiW * 0.13 : adiW * 0.06;
    ctx.beginPath(); ctx.moveTo(-L / 2, yy); ctx.lineTo(L / 2, yy); ctx.stroke();
    if (big) { T(String(Math.abs(d)), -L / 2 - fs * 1.1, yy, fs * 0.85, C.white); T(String(Math.abs(d)), L / 2 + fs * 1.1, yy, fs * 0.85, C.white); }
  }
  ctx.restore();
  // roll scale (rotates with the horizon) and the fixed pointer with the slip / skid bar
  const rr = adiH * 0.44;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-ph); ctx.strokeStyle = C.white; ctx.fillStyle = C.white; ctx.lineWidth = Math.max(1.5, u * 0.004);
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    ctx.save(); ctx.rotate(a * DEG);
    if (a === 0) { ctx.beginPath(); ctx.moveTo(0, -rr); ctx.lineTo(-u * 0.016, -rr - u * 0.028); ctx.lineTo(u * 0.016, -rr - u * 0.028); ctx.closePath(); ctx.fill(); }
    else if (Math.abs(a) === 45) { ctx.beginPath(); ctx.moveTo(0, -rr); ctx.lineTo(-u * 0.009, -rr - u * 0.018); ctx.lineTo(u * 0.009, -rr - u * 0.018); ctx.closePath(); ctx.stroke(); }
    else { const L = Math.abs(a) % 30 === 0 ? u * 0.035 : u * 0.018; ctx.beginPath(); ctx.moveTo(0, -rr); ctx.lineTo(0, -rr - L); ctx.stroke(); }
    ctx.restore();
  }
  ctx.restore();
  {
    ctx.fillStyle = Math.abs(ph) > 35 * DEG ? C.amber : C.white;
    ctx.beginPath(); ctx.moveTo(cx, cy - rr + u * 0.002); ctx.lineTo(cx - u * 0.016, cy - rr + u * 0.03); ctx.lineTo(cx + u * 0.016, cy - rr + u * 0.03); ctx.closePath(); ctx.fill();
    const sk = clamp((o.beta || 0) * RAD * u * 0.006, -u * 0.04, u * 0.04);
    ctx.fillRect(cx - u * 0.018 + sk, cy - rr + u * 0.034, u * 0.036, u * 0.008);
  }
  // single-cue flight director: magenta V-bars, offset by the pitch command and banked by the roll command
  const L = adiW * 0.27, dV = adiW * 0.075;
  if (ap.fd && ap.fdTheta != null && ap.fdPhi != null) {
    const dy = clamp(-(ap.fdTheta - th) * RAD * ppd, -adiH * 0.4, adiH * 0.4);
    ctx.save(); ctx.translate(cx, cy + dy); ctx.rotate(clamp(ap.fdPhi - ph, -40 * DEG, 40 * DEG));
    ctx.fillStyle = C.mag; ctx.strokeStyle = '#3a0030'; ctx.lineWidth = 1;
    for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sgn * L * 0.08, -dV * 0.05); ctx.lineTo(sgn * L * 1.05, dV * 0.62); ctx.lineTo(sgn * L * 1.05, dV * 1.0); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
  // aircraft symbol: the white delta the cue settles onto
  ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = '#e8e8e8'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
  for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(sgn * L, dV * 0.95); ctx.lineTo(sgn * L * 0.55, dV * 0.95); ctx.lineTo(0, dV * 0.42); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = '#555'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-L * 0.55, dV * 0.95); ctx.lineTo(0, dV * 0.42); ctx.closePath(); ctx.fill();
  ctx.restore();
  // marker beacon, radio altitude, g and angle of attack, warnings
  if (S.marker) { const mc = S.marker === 'OM' ? '#38f' : S.marker === 'MM' ? '#fb2' : '#fff'; ctx.fillStyle = mc; ctx.fillRect(cx + adiW / 2 - u * 0.09, top + u * 0.012, u * 0.075, u * 0.04); T(S.marker, cx + adiW / 2 - u * 0.052, top + u * 0.032, fs * 0.85, '#000'); }
  if (S.free && !S.free.wow && S.free.agl < 2500 * FT) T(String(Math.round(S.free.agl / FT / 10) * 10), cx, top + adiH - u * 0.075, fs * 1.05, S.mins && o.h / FT < S.mins ? C.amber : C.white);
  T(`G ${o.nz.toFixed(1)}`, cx - adiW / 2 + u * 0.01, top + adiH - u * 0.022, fs * 0.82, o.nz > 3 || o.nz < -1 ? C.red : o.nz > 2.5 ? C.amber : C.white, 'left');
  T(`α ${(o.alpha * RAD).toFixed(1)}`, cx + adiW / 2 - u * 0.01, top + adiH - u * 0.022, fs * 0.82, o.stalled ? C.red : C.white, 'right');
  let warn = null;
  if (S.ac.broken) warn = ['STRUCTURAL FAILURE', C.red];
  else if (o.alpha > 0 && (o.stalled || o.aoaN > 0.82)) warn = ['STALL', C.red];
  else if (o.overspeed) warn = ['OVERSPEED', C.red];
  else if (o.vs < -30 && o.h < 3000) warn = ['PULL UP', C.red];
  else if (Math.abs(ph) > 45 * DEG) warn = ['BANK ANGLE', C.amber];
  if (warn && blink) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(cx - adiW * 0.36, cy + adiH * 0.15, adiW * 0.72, fs * 2.2); T(warn[0], cx, cy + adiH * 0.15 + fs * 1.1, fs * 1.5, warn[1]); }
  ctx.restore();

  // ---- deviation: localizer under the attitude, glideslope on its right edge (green = ILS, magenta = FMS) ----
  const N = S.nav;
  {
    const ly = top + adiH + u * 0.03, dot = adiW * 0.1, gx = cx + adiW / 2 - u * 0.028;
    const dmd = (X, Y, col, hollow) => { const r = u * 0.017; ctx.beginPath(); ctx.moveTo(X, Y - r); ctx.lineTo(X + r * 0.75, Y); ctx.lineTo(X, Y + r); ctx.lineTo(X - r * 0.75, Y); ctx.closePath(); if (hollow) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); } else { ctx.fillStyle = col; ctx.fill(); } };
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1, u * 0.003);
    if (N && N.dev != null) {
      for (const k of [-2, -1, 1, 2]) { ctx.beginPath(); ctx.arc(cx + k * dot, ly, u * 0.007, 0, 7); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx, ly - u * 0.016); ctx.lineTo(cx, ly + u * 0.016); ctx.stroke();
      dmd(cx + clamp(N.dev, -2.4, 2.4) * dot, ly, N.col, Math.abs(N.dev) > 2.4);
    }
    const vd = S.ils && S.ils.gsValid ? { v: S.ils.gs, col: C.green } : S.vdev != null ? { v: S.vdev, col: C.mag } : null;
    if (vd) {
      for (const k of [-2, -1, 1, 2]) { ctx.beginPath(); ctx.arc(gx, cy + k * dot, u * 0.007, 0, 7); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(gx - u * 0.016, cy); ctx.lineTo(gx + u * 0.016, cy); ctx.stroke();
      dmd(gx, cy - clamp(vd.v, -2.4, 2.4) * dot, vd.col, Math.abs(vd.v) > 2.4);
    }
  }

  // ---- speed tape ----
  {
    const k = o.KIAS, pk = tapeH / 90, cyT = cy;
    ctx.save(); ctx.beginPath(); ctx.rect(sx, ty, tapeW, tapeH); ctx.clip(); ctx.fillStyle = C.tape; ctx.fillRect(sx, ty, tapeW, tapeH);
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1, u * 0.003);
    for (let v = Math.floor((k - 50) / 5) * 5; v <= k + 50; v += 5) {
      if (v < 30) continue; const yy = cyT - (v - k) * pk, big = v % 10 === 0;
      ctx.beginPath(); ctx.moveTo(sx + tapeW - (big ? u * 0.02 : u * 0.011), yy); ctx.lineTo(sx + tapeW, yy); ctx.stroke();
      if (v % 20 === 0) T(String(v), sx + tapeW - u * 0.028, yy, fs, C.white, 'right');
    }
    // speed bands: barber pole below the shaker and above Vmo / Mmo; amber where 30% more g reaches the shaker / buffet
    const B = o.bands, strip = (from, to, col) => { const y1 = cyT - (to - k) * pk, y2 = cyT - (from - k) * pk; if (col === 'barber') { const seg = u * 0.012; for (let yy = Math.max(ty, y1); yy < Math.min(ty + tapeH, y2); yy += seg) { ctx.fillStyle = Math.floor((yy - y1) / seg) % 2 ? C.red : C.white; ctx.fillRect(sx + tapeW - u * 0.008, yy, u * 0.008, seg); } } else { ctx.fillStyle = col; ctx.fillRect(sx + tapeW - u * 0.008, y1, u * 0.008, y2 - y1); } };
    const vmoEff = Math.min(o.Vmo || 999, o.M > 0.01 ? k * (o.Mmo || 0.81) / o.M : 999);
    strip(vmoEff, 999, 'barber');
    if (B) { if (Number.isFinite(B.shaker)) { strip(0, B.shaker, 'barber'); strip(B.shaker, B.shakerM, C.amber); } strip(Math.min(B.buffetM || 999, B.vmo), vmoEff, C.amber); }
    for (const b of (S.free && S.free.bugs) || []) { const yy = cyT - (b.v - k) * pk; ctx.strokeStyle = C.cyan; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx + tapeW - u * 0.03, yy); ctx.lineTo(sx + tapeW, yy); ctx.stroke(); T(b.t, sx + tapeW - u * 0.034, yy, fs * 0.7, C.cyan, 'right'); }
    // trend vector: where the speed will be in 10 s
    const now = S.t ?? 0, m = H._spd || (H._spd = { k, t: now, tr: 0 });
    if (now > m.t) { m.tr += ((k - m.k) / (now - m.t) * 10 - m.tr) * Math.min(1, (now - m.t) * 2); m.k = k; m.t = now; } else if (now < m.t) { m.k = k; m.t = now; m.tr = 0; }
    if (Math.abs(m.tr) > 1) { ctx.strokeStyle = C.mag; ctx.lineWidth = Math.max(2, u * 0.005); ctx.beginPath(); ctx.moveTo(sx + tapeW - u * 0.012, cyT); ctx.lineTo(sx + tapeW - u * 0.012, cyT - clamp(m.tr, -45, 45) * pk); ctx.stroke(); }
    ctx.restore();
    readout(H, sx + u * 0.004, cyT, tapeW * 0.78, fs * 1.75, String(Math.round(k)), 'right', fs * 1.3, o.overspeed ? C.red : C.white);
    if (o.M > 0.4) T(`M.${Math.round(o.M * 1000).toString().padStart(3, '0')}`, sx + tapeW / 2, ty + tapeH + fs * 0.9, fs, o.M > (o.Mmo || 0.81) ? C.red : C.white);
  }

  // ---- altitude tape, preselect, baro, minimums ----
  {
    const a = o.h / FT, pf = tapeH / 900, cyT = cy, sel = ap.altTgt / FT;
    ctx.save(); ctx.beginPath(); ctx.rect(ax, ty, tapeW, tapeH); ctx.clip(); ctx.fillStyle = C.tape; ctx.fillRect(ax, ty, tapeW, tapeH);
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1, u * 0.003);
    for (let v = Math.floor((a - 500) / 100) * 100; v <= a + 500; v += 100) {
      const yy = cyT - (v - a) * pf, big = v % 500 === 0;
      ctx.beginPath(); ctx.moveTo(ax, yy); ctx.lineTo(ax + (big ? u * 0.022 : u * 0.012), yy); ctx.stroke();
      if (v % 200 === 0) T(String(v), ax + u * 0.028, yy, fs * 0.9, C.white, 'left');
    }
    const sy = cyT - (sel - a) * pf;   // preselect bug
    ctx.fillStyle = C.cyan; ctx.fillRect(ax, clamp(sy, ty, ty + tapeH) - u * 0.012, u * 0.01, u * 0.024);
    if (S.mins) { const my = cyT - (S.mins - a) * pf; ctx.strokeStyle = C.cyan; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax, my); ctx.lineTo(ax + tapeW * 0.6, my); ctx.stroke(); }
    ctx.restore();
    readout(H, ax + tapeW * 0.12, cyT, tapeW * 0.88, fs * 1.75, String(Math.round(a / 10) * 10), 'left', fs * 1.2, C.white);
    ctx.fillStyle = '#000'; ctx.fillRect(ax + 1, ty + 1, tapeW - 2, fs * 1.5); T(String(Math.round(sel / 100) * 100), ax + tapeW / 2, ty + fs * 0.8, fs * 1.05, C.cyan);   // preselect
    T('29.92', ax + tapeW / 2, ty + tapeH + fs * 0.9, fs * 0.9, C.cyan);
    if (S.mins) T(`MIN ${Math.round(S.mins)}`, ax + tapeW / 2, ty + tapeH + fs * 2.1, fs * 0.8, o.h / FT < S.mins && blink ? C.amber : C.cyan);
  }

  // ---- vertical speed ----
  {
    const vs = o.vs / FT * 60, vy = (v) => cy - Math.sign(v) * (Math.abs(v) <= 1000 ? Math.abs(v) / 1000 * 0.42 : Math.abs(v) <= 2000 ? 0.42 + (Math.abs(v) - 1000) / 1000 * 0.24 : 0.66 + Math.min(1, (Math.abs(v) - 2000) / 4000) * 0.3) * tapeH * 0.5;
    ctx.fillStyle = C.tape; ctx.beginPath(); ctx.moveTo(vx, ty + tapeH * 0.04); ctx.lineTo(vx + vw * 0.6, ty); ctx.lineTo(vx + vw * 0.6, ty + tapeH); ctx.lineTo(vx, ty + tapeH * 0.96); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1, u * 0.003);
    for (const v of [-6000, -4000, -2000, -1000, -500, 0, 500, 1000, 2000, 4000, 6000]) { const yy = vy(v); ctx.beginPath(); ctx.moveTo(vx + vw * 0.08, yy); ctx.lineTo(vx + vw * (Math.abs(v) % 1000 ? 0.16 : 0.24), yy); ctx.stroke(); if (v && !(Math.abs(v) % 1000) && Math.abs(v) !== 6000) T(String(Math.abs(v) / 1000), vx + vw * 0.42, yy, fs * 0.8, C.white); }
    ctx.strokeStyle = Math.abs(vs) > 6000 ? C.red : C.green; ctx.lineWidth = Math.max(2, u * 0.005);
    ctx.beginPath(); ctx.moveTo(Math.min(x + w - 2, vx + vw * 1.6), cy); ctx.lineTo(vx + vw * 0.1, vy(clamp(vs, -7000, 7000))); ctx.stroke();
    if (Math.abs(vs) >= 400) T(String(Math.round(vs / 50) * 50), vx + vw * 0.3, vs > 0 ? ty - fs * 0.85 : ty + tapeH + fs * 0.9, fs * 0.9, Math.abs(vs) > 6000 ? C.red : C.green);
  }

  // ---- HSI ----
  {
    const hdg = o.psi * RAD, hy0 = top + adiH + u * 0.085, avail = y + h - hy0 - u * 0.03;
    const r = clamp(avail * 0.46, w * 0.2, w * 0.31), hcx = cx, hcy = hy0 + u * 0.045 + r;
    // nav source and course (left), distance / waypoint (right)
    if (N) {
      T(N.src, x + w * 0.03, hy0 + fs * 2.2, fs * 1.05, N.col, 'left');
      if (N.crs != null) T(`${N.src.startsWith('FMS') ? 'DTK' : 'CRS'} ${pad3(N.crs - mv)}`, x + w * 0.03, hy0 + fs * 3.45, fs * 0.95, N.col, 'left');
      if (N.dist != null) T(`${N.dist.toFixed(1)} NM`, x + w * 0.97, hy0 + fs * 2.2, fs, C.white, 'right');
      if (N.wpt) T(N.wpt, x + w * 0.97, hy0 + fs * 3.45, fs * 0.95, N.col, 'right');
    }
    T(`HDG ${pad3(ap.hdgTgt)}`, x + w * 0.03, y + h - fs * 0.9, fs * 0.9, C.cyan, 'left');
    // heading readout
    ctx.fillStyle = '#000'; ctx.strokeStyle = C.white; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(hcx - fs * 1.6, hy0 - fs * 0.75, fs * 3.2, fs * 1.5); ctx.fill(); ctx.stroke();
    T(pad3(hdg - mv), hcx, hy0, fs * 1.2, C.white);
    // rose
    ctx.save(); ctx.translate(hcx, hcy); ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1, u * 0.003);
    ctx.save(); ctx.rotate(-(hdg - mv) * DEG);
    for (let d = 0; d < 360; d += 5) {
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, -r * (d % 10 ? 0.95 : 0.9)); ctx.stroke();
      if (d % 30 === 0) T({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] || String(d / 10), 0, -r * 0.8, fs * 1.05, C.white);
      ctx.rotate(5 * DEG);
    }
    ctx.restore();
    for (const a of [45, 90, 135, 180, 225, 270, 315]) { ctx.save(); ctx.rotate(a * DEG); ctx.beginPath(); ctx.moveTo(0, -r * 1.02); ctx.lineTo(0, -r * 1.08); ctx.stroke(); ctx.restore(); }
    ctx.fillStyle = C.white; ctx.beginPath(); ctx.moveTo(0, -r * 1.0); ctx.lineTo(-u * 0.012, -r - u * 0.024); ctx.lineTo(u * 0.012, -r - u * 0.024); ctx.closePath(); ctx.fill();   // lubber
    // heading bug (notched, magenta like the Pro Line photo)
    ctx.save(); ctx.rotate((ap.hdgTgt - (hdg - mv)) * DEG); ctx.fillStyle = C.mag;
    ctx.beginPath(); ctx.moveTo(-u * 0.026, -r); ctx.lineTo(-u * 0.026, -r - u * 0.022); ctx.lineTo(-u * 0.01, -r - u * 0.022); ctx.lineTo(0, -r - u * 0.008); ctx.lineTo(u * 0.01, -r - u * 0.022); ctx.lineTo(u * 0.026, -r - u * 0.022); ctx.lineTo(u * 0.026, -r); ctx.closePath(); ctx.fill(); ctx.restore();
    // bearing to the active waypoint (cyan) and the course pointer with its deviation bar
    if (N && N.brg != null) { ctx.save(); ctx.rotate((N.brg - hdg) * DEG); ctx.strokeStyle = C.cyan; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -r * 0.98); ctx.lineTo(0, -r * 0.62); ctx.moveTo(-u * 0.016, -r * 0.84); ctx.lineTo(0, -r * 0.98); ctx.lineTo(u * 0.016, -r * 0.84); ctx.moveTo(0, r * 0.62); ctx.lineTo(0, r * 0.98); ctx.stroke(); ctx.restore(); }
    if (N && N.crs != null) {
      ctx.save(); ctx.rotate((N.crs - hdg) * DEG); ctx.strokeStyle = N.col; ctx.fillStyle = N.col; ctx.lineWidth = Math.max(2.5, u * 0.006);
      const dot = r * 0.17, dv = clamp(N.dev ?? 0, -2.5, 2.5) * dot;
      ctx.beginPath(); ctx.moveTo(0, -r * 0.88); ctx.lineTo(0, -r * 0.45); ctx.moveTo(0, r * 0.45); ctx.lineTo(0, r * 0.88); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -r * 0.92); ctx.lineTo(-u * 0.02, -r * 0.76); ctx.lineTo(u * 0.02, -r * 0.76); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(dv, -r * 0.42); ctx.lineTo(dv, r * 0.42); ctx.stroke();
      ctx.strokeStyle = C.white; ctx.lineWidth = 1.5; for (const k of [-2, -1, 1, 2]) { ctx.beginPath(); ctx.arc(k * dot, 0, u * 0.007, 0, 7); ctx.stroke(); }
      ctx.restore();
    }
    // airplane
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(2, u * 0.005); ctx.beginPath();
    ctx.moveTo(0, -r * 0.16); ctx.lineTo(0, r * 0.2); ctx.moveTo(-r * 0.14, 0); ctx.lineTo(r * 0.14, 0); ctx.moveTo(-r * 0.06, r * 0.18); ctx.lineTo(r * 0.06, r * 0.18); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// black readout box with a pointer toward the tape
function readout(H, x, cy, w, h, txt, point, size, col) {
  const ctx = H.ctx, n = h * 0.32;
  ctx.fillStyle = '#000'; ctx.strokeStyle = C.white; ctx.lineWidth = 1.5; ctx.beginPath();
  if (point === 'right') { ctx.moveTo(x, cy - h / 2); ctx.lineTo(x + w, cy - h / 2); ctx.lineTo(x + w, cy - n); ctx.lineTo(x + w + n, cy); ctx.lineTo(x + w, cy + n); ctx.lineTo(x + w, cy + h / 2); ctx.lineTo(x, cy + h / 2); }
  else { ctx.moveTo(x + w, cy - h / 2); ctx.lineTo(x, cy - h / 2); ctx.lineTo(x, cy - n); ctx.lineTo(x - n, cy); ctx.lineTo(x, cy + n); ctx.lineTo(x, cy + h / 2); ctx.lineTo(x + w, cy + h / 2); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  H.text(txt, point === 'right' ? x + w - h * 0.15 : x + w - h * 0.15, cy, size, col, 'right', 'bold');
}
