// 3D Learjet 60 cockpit from the left seat. The geometry is the virtual cockpit of the Premier Aircraft Design
// Learjet 60 (FSX model by Premier Aircraft Design, FS2004 MDL8 format, converted by tools/fs9_vc.py into data/vc/): textured panel, glareshield, yokes, pedestal,
// seats, side consoles and window glass, with its animated parts (yokes, rudder pedals, thrust, flap and spoiler
// levers) driven by our controls. Frame: x right, y up, z forward, metres; drawn with the pilot's eye at the origin.
// The live instruments are the HUD's instrument code drawn into canvases and mapped onto the panel at the gauge
// positions of the original panel.cfg; clicks are ray-cast onto those quads and handed to the HUD hit-tests.
import { HUD } from './hud.js';
import { clamp, lerp, RAD, wrap360 } from './util.js';
import { GAUGES } from './vcgauges.js';
import { drawPfd } from './pfd.js';
import { I4, mul4, quatM, track } from './anim.js';

const VS = `#version 300 es
in vec3 aPos; in vec3 aNor; in vec2 aUv;
uniform mat3 uHead; uniform mat4 uModel; uniform vec2 uProj; uniform vec3 uEye;
out vec3 vNor; out vec2 vUv; out vec3 vPos;
void main(){
  vec4 wp = uModel * vec4(aPos, 1.); vPos = wp.xyz - uEye; vNor = mat3(uModel) * aNor; vUv = aUv;
  vec3 v = transpose(uHead) * vPos;
  float n = 0.02, f = 30.;
  gl_Position = vec4(v.x / uProj.x, v.y / uProj.y, v.z * (f + n) / (f - n) - 2. * f * n / (f - n), v.z);
}`;
const FS = `#version 300 es
precision highp float;
in vec3 vNor; in vec2 vUv; in vec3 vPos; out vec4 o;
uniform int uMode; uniform sampler2D uTex; uniform bool uHasTex; uniform vec4 uDiffuse; uniform float uSpec, uPower, uSpecMask;
uniform vec3 uSun; uniform float uAmb, uSunI, uFlash, uScreen, uLamp;
void main(){
  vec3 n = normalize(vNor), vd = normalize(-vPos);
  if (dot(n, vd) < 0.) n = -n;
  vec3 h = normalize(uSun + vd);
  if (uMode == 0) {                          // textured / painted surfaces
    vec4 t = uHasTex ? texture(uTex, vUv) : vec4(1.);
    vec3 base = uHasTex ? t.rgb : uDiffuse.rgb;
    // daylight through the windows from above and ahead, darker low in the cockpit; sun through the glass
    float sky = 0.5 + 0.3 * n.y + 0.2 * max(-n.z, 0.);
    float low = clamp(1. + vPos.y * 0.45, 0.55, 1.);
    vec3 l = vec3(uAmb * sky * low + uSunI * max(dot(n, uSun), 0.) + uFlash * 0.9 * sky) + uLamp * vec3(1., 0.86, 0.68) * 0.35;
    vec3 c = base * l;
    float ks = 0.05 + uSpec * 0.25 + uSpecMask * (1. - t.a) * 0.6;
    c += pow(max(dot(n, h), 0.), max(uPower, 24.)) * uSunI * ks;
    o = vec4(pow(c, vec3(1. / 1.08)), 1.);
  } else if (uMode == 1) {                   // emissive display behind glass
    vec4 t = texture(uTex, vUv);
    float fr = pow(1. - max(dot(n, vd), 0.), 4.);
    vec3 glare = vec3(0.55, 0.6, 0.66) * (0.03 + 0.45 * fr) * (uAmb * 0.6 + uSunI * 0.4);
    o = vec4(t.rgb * uScreen + glare, t.a);
  } else {                                   // window glass: tint + reflections, weather painted on the windshield
    float fr = pow(1. - max(dot(n, vd), 0.), 3.);
    float sp = pow(max(dot(n, h), 0.), 80.) * uSunI;
    float a = 0.06 + 0.3 * fr + sp * 0.5;
    vec3 c = mix(uDiffuse.rgb * 2., vec3(0.75, 0.8, 0.88), fr) * (uAmb * 0.6 + uSunI) + sp;
    vec3 d = normalize(vPos);                // weather canvas spans the forward view: +-60 deg, +25..-15 deg
    vec2 uv = vec2(0.5 + atan(d.x, d.z) / 2.1, (0.44 - asin(clamp(d.y, -1., 1.))) / 0.7);
    vec4 w = texture(uTex, uv) * smoothstep(0.2, 0.6, d.z);
    float oa = w.a + a * (1. - w.a);
    o = vec4((w.rgb * w.a + c * a * (1. - w.a)) / max(oa, 1e-4), oa);
  }
}`;

// sim variables of the FS2004 model -> our controls (t on 0..100 along each keyframe track)
const VAR = { YOKE_PITCH: 524, YOKE_ROLL: 528, RUDDER: 532, THR_L: 472, THR_R: 476, FLAPS: 552, SPOILER: 544 };
// Thrust levers: the model's own lever track, max (t 0) to idle (t 50), 17.5 deg; t 50..100 lifts the reversers
const THR_T = (thr) => 50 * (1 - clamp(thr, 0, 1));
// pilot eye in model coordinates: aircraft.cfg eyepoint (-16.7, -1.6, 2.0 ft from the datum, datum 34.5 ft ahead of the origin)
export const EYE = [-1.6 * 0.3048, 2.0 * 0.3048, (34.5 - 16.7) * 0.3048];

const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] };
// Live instruments on the panel: [instrument, panel texture, x, y, w, h] in the panel.cfg pixel space of that texture
const SLOTS = [
  ['pfd', '$panL', 297, 216, 150, 178], ['mfd', '$panL', 505, 220, 150, 178], ['eng', '$panL', 683, 168, 122, 305],
  ['pfd', '$panR', 122, 216, 150, 178], ['mfd', '$panR', 330, 222, 150, 178],
];

export class Cockpit {
  // Own full-resolution, antialiased, transparent canvas layered between the world and the 2D overlay
  constructor(canvas, base = 'data/vc/') {
    this.canvas = canvas; this.ready = false;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no WebGL2');
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const p = this.prog = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.u = {}; for (const n of ['uHead', 'uModel', 'uProj', 'uEye', 'uMode', 'uTex', 'uHasTex', 'uDiffuse', 'uSpec', 'uPower', 'uSpecMask', 'uSun', 'uAmb', 'uSunI', 'uFlash', 'uScreen', 'uLamp']) this.u[n] = gl.getUniformLocation(p, n);
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    // instruments: offscreen canvases drawn by the existing HUD code (and vcgauges.js for the standby gauges)
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const hud = new HUD(c); hud.W = w; hud.H = h; return { c, hud, tex: this.mkTex(), frame: 0 }; };
    this.inst = { pfd: mk(840, 1000), mfd: mk(840, 1000), eng: mk(400, 1000), glass: mk(1024, 512) };
    for (const [k, g] of Object.entries(GAUGES)) this.inst[k] = mk(g.w, g.h);
    this.surfaces = []; this.frame = 0;
    this.loaded = this.load(base).then(() => { this.ready = true; }, (e) => { console.warn('virtual cockpit failed to load, using the 2D panel:', e); this.failed = true; });
  }
  mkTex(repeat) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    return t;
  }
  vao(data) {
    const gl = this.gl, va = gl.createVertexArray(); gl.bindVertexArray(va);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    [['aPos', 3, 0], ['aNor', 3, 12], ['aUv', 2, 24]].forEach(([n, k, off]) => { const l = gl.getAttribLocation(this.prog, n); if (l < 0) return; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, k, gl.FLOAT, false, 32, off); });
    return va;
  }
  async load(base) {
    const gl = this.gl, get = (f, how) => fetch(base + f).then(r => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r[how](); });
    const [meta, bin] = await Promise.all([get('vc.json', 'json'), get('vc.bin', 'arrayBuffer')]);
    const imgs = await Promise.all(meta.textures.map(n => new Promise((res, rej) => { const im = new Image(); im.onload = () => res([n, im]); im.onerror = () => rej(new Error(n)); im.src = `${base}${n}.webp`; })));
    this.tex = {};
    for (const [n, im] of imgs) {
      const t = this.tex[n] = this.mkTex(true); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); gl.generateMipmap(gl.TEXTURE_2D);
    }
    const nv = meta.vertices, V = new Float32Array(bin, 0, nv * 8), Ix = new Uint16Array(bin, nv * 32, meta.indices);
    this.va = this.vao(V);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, Ix, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const m4 = (m) => m && [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, m[9], m[10], m[11], 1];
    this.nodes = meta.nodes.map(n => ({ ...n, m: m4(n.m) }));
    this.batches = meta.batches;
    // The dynamic-texture quads of the original panel ($panL, $panR, ...): corners from their uv-mapped vertices
    this.pans = {};
    for (const b of this.batches.filter(b => b.tex.startsWith('$'))) {
      const corner = (u, v) => { let best = null, bd = 9; for (let k = b.first; k < b.first + b.count; k++) { const i = Ix[k], d = Math.hypot(V[i * 8 + 6] - u, V[i * 8 + 7] - v); if (d < bd) { bd = d; best = [V[i * 8], V[i * 8 + 1], V[i * 8 + 2]]; } } return best; };
      this.pans[b.tex] = { tl: corner(0, 0), tr: corner(1, 0), br: corner(1, 1), bl: corner(0, 1), size: b.tex === '$panup' ? 512 : b.tex === '$pancompass' ? 256 : 1024 };
    }
    for (const [key, pan, x, y, w, h] of SLOTS) this.slot(key, pan, x, y, w, h);
    for (const [key, g] of Object.entries(GAUGES)) { for (const r of g.at || []) this.slot(key, ...r); if (g.quad) this.quadSurface(key, ...g.quad); }
  }
  // A quad for instrument `key` on panel texture `pan` at pixel rect x, y, w, h, raised d toward the pilot
  slot(key, pan, x, y, w, h, d = 0.0015) {
    const P = this.pans[pan]; if (!P) return;
    const at = (px, py) => { const u = px / P.size, v = py / P.size; return v3.lerp(v3.lerp(P.tl, P.tr, u), v3.lerp(P.bl, P.br, u), v); };
    const n = v3.norm(v3.cross(v3.sub(P.bl, P.tl), v3.sub(P.tr, P.tl)));
    const off = v3.mul(v3.dot(n, v3.sub(EYE, P.tl)) > 0 ? n : v3.mul(n, -1), d);
    this.quadSurface(key, v3.add(at(x, y), off), v3.add(at(x + w, y), off), v3.add(at(x + w, y + h), off), v3.add(at(x, y + h), off));
  }
  quadSurface(key, tl, tr, br, bl) {
    const n = v3.norm(v3.cross(v3.sub(tr, tl), v3.sub(bl, tl))), V = (p, u, v) => [...p, ...n, u, v];
    const va = this.vao(new Float32Array([...V(tl, 0, 0), ...V(tr, 1, 0), ...V(br, 1, 1), ...V(tl, 0, 0), ...V(br, 1, 1), ...V(bl, 0, 1)]));
    this.gl.bindVertexArray(null);
    this.surfaces.push({ key, va, tl, tr, br, bl });
  }
  // Redraw the instrument canvases with the HUD's own instrument code and upload them
  update(S) {
    const f = ++this.frame, I = this.inst, blink = Math.floor(performance.now() / 280) % 2 === 0;
    const draw = (k, every, fn, bg = '#050607') => {
      const it = I[k], live = this.controls && (this.controls.hover && this.controls.hover.key === k || this.controls.busy());
      if (f % every !== 0 && it.frame && !live) return;
      const ctx = it.hud.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, it.c.width, it.c.height); } else ctx.clearRect(0, 0, it.c.width, it.c.height);
      it.hud.hits = []; fn(it.hud, ctx); it.frame = f;
      if (this.controls) { ctx.setTransform(1, 0, 0, 1, 0, 0); this.controls.decorate(it.hud, ctx, k); }   // hover outline, press flash
      const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, it.tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, it.c); gl.generateMipmap(gl.TEXTURE_2D);
    };
    draw('pfd', 1, (h) => drawPfd(h, S, blink, 0, 0, 840, 1000));   // Pro Line 4 PFD (js/pfd.js), the whole display
    draw('mfd', 3, (h) => h.mfd(S, 0, 0, 840, 1000));
    draw('eng', 3, (h) => h.engines(S, 0, 0, 400, 1000));
    for (const [k, g] of Object.entries(GAUGES)) draw(k, g.every || 2, (h, ctx) => g.draw(ctx, S, h, blink), g.bg === undefined ? '#050607' : g.bg);
    draw('glass', 2, (h) => { h.W = 1024; h.H = 512 / 0.56; h.windshield(S); }, null);
  }
  // Head orientation in the cockpit frame (yaw right +, pitch up +): columns right, up, fwd
  static head(yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    return { right: [cy, 0, -sy], up: [-sp * sy, cp, -sp * cy], fwd: [cp * sy, sp, cp * cy] };
  }
  hide() { if (this.shown) { const gl = this.gl; gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); this.shown = false; } }
  // World matrices of the model's animated nodes for the current control positions
  pose(ctl) {
    const t = new Map([[VAR.YOKE_PITCH, 50 + 50 * clamp(ctl.elev, -1, 1)], [VAR.YOKE_ROLL, 50 + 50 * clamp(ctl.ail, -1, 1)], [VAR.RUDDER, 50 + 50 * clamp(ctl.rud, -1, 1)],
      [VAR.THR_L, THR_T(ctl.thr)], [VAR.THR_R, THR_T(ctl.thr)], [VAR.FLAPS, 100 * clamp(ctl.flaps, 0, 1)], [VAR.SPOILER, 100 * clamp(ctl.sb, 0, 1)]]);
    const W = this.W || (this.W = []);
    this.nodes.forEach((n, i) => {
      let m = track(n.keys, n.type, t.has(n.var) ? t.get(n.var) : 0);
      if (n.m) m = mul4(m, n.m);
      W[i] = n.p < 0 ? m : mul4(m, W[n.p]);
    });
    return W;
  }
  render(S, head, eye, fov, aspect) {
    const gl = this.gl, u = this.u, dpr = Math.min(window.devicePixelRatio || 1, 2), cw = Math.floor(innerWidth * dpr), ch = Math.floor(innerHeight * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    gl.viewport(0, 0, cw, ch); this.shown = true;
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.ready) return;
    gl.useProgram(this.prog); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.uniformMatrix3fv(u.uHead, false, [...head.right, ...head.up, ...head.fwd]);
    const tf = Math.tan(fov / 2); gl.uniform2f(u.uProj, tf * aspect, tf); gl.uniform3fv(u.uEye, v3.add(EYE, eye));
    // sun in the cockpit frame; ambient from the outside light (darker in the storm)
    const sw = S.sunWorld, b = S.acBasis, sun = v3.norm([v3.dot(sw, b.right), v3.dot(sw, b.up), v3.dot(sw, b.fwd)]);
    const dim = 1 - 0.55 * clamp(S.inCloud, 0, 1) - 0.25 * clamp(S.core, 0, 1);
    gl.uniform3fv(u.uSun, sun); gl.uniform1f(u.uAmb, 0.85 * dim + 0.2); gl.uniform1f(u.uSunI, sun[2] > -0.2 ? 0.5 * dim * clamp(1 - S.inCloud, 0, 1) : 0.05);
    gl.uniform1f(u.uFlash, S.flash || 0); gl.uniform1f(u.uScreen, 1.0); gl.uniform1f(u.uLamp, clamp(1 - dim, 0, 1) * 0.6);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(u.uTex, 0);
    const W = this.pose(S.ctl), model = (bt) => bt.node < 0 ? I4 : W[bt.node];
    gl.bindVertexArray(this.va);
    const glass = [];
    gl.uniform1i(u.uMode, 0);
    for (const bt of this.batches) {
      if (bt.tex.startsWith('$')) continue;
      if (bt.diffuse[3] < 0.99) { glass.push(bt); continue; }
      const t = bt.tex && this.tex[bt.tex];
      gl.uniformMatrix4fv(u.uModel, false, model(bt));
      gl.uniform1i(u.uHasTex, t ? 1 : 0); if (t) gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform4fv(u.uDiffuse, bt.diffuse); gl.uniform1f(u.uSpec, bt.specular); gl.uniform1f(u.uPower, bt.power);
      gl.uniform1f(u.uSpecMask, bt.tex === 'chrome' || bt.tex === 'learjet_fuse' ? 1 : 0);
      gl.drawElements(gl.TRIANGLES, bt.count, gl.UNSIGNED_SHORT, bt.first * 2);
    }
    // instruments (emissive, sampled from the instrument canvases)
    gl.uniformMatrix4fv(u.uModel, false, I4); gl.uniform1i(u.uMode, 1);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const sf of this.surfaces) { gl.bindTexture(gl.TEXTURE_2D, this.inst[sf.key].tex); gl.bindVertexArray(sf.va); gl.drawArrays(gl.TRIANGLES, 0, 6); }
    // window glass with rain / ice / lightning, alpha-blended over the world
    gl.depthMask(false); gl.bindVertexArray(this.va); gl.uniform1i(u.uMode, 2); gl.bindTexture(gl.TEXTURE_2D, this.inst.glass.tex);
    for (const bt of glass) {
      gl.uniformMatrix4fv(u.uModel, false, model(bt)); gl.uniform4fv(u.uDiffuse, bt.diffuse);
      gl.drawElements(gl.TRIANGLES, bt.count, gl.UNSIGNED_SHORT, bt.first * 2);
    }
    gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.bindVertexArray(null);
  }
  // Click: ray from the eye through the pixel, onto the instrument quads; returns { key, hit } for a HUD hit-test
  pick(nx, ny, head, fov, aspect) {
    const tf = Math.tan(fov / 2), d0 = [nx * tf * aspect, ny * tf, 1];
    const d = v3.norm(v3.add(v3.add(v3.mul(head.right, d0[0]), v3.mul(head.up, d0[1])), v3.mul(head.fwd, d0[2])));
    let best = null;
    for (const sf of this.surfaces) {
      const tl = v3.sub(sf.tl, EYE), ex = v3.sub(sf.tr, sf.tl), ey = v3.sub(sf.bl, sf.tl), n = v3.cross(ex, ey), den = v3.dot(n, d);
      if (Math.abs(den) < 1e-9) continue;
      const t = v3.dot(n, tl) / den; if (t <= 0 || (best && t >= best.t)) continue;
      const p = v3.sub(v3.mul(d, t), tl);
      const uu = v3.dot(p, ex) / v3.dot(ex, ex), vv = v3.dot(p, ey) / v3.dot(ey, ey);
      if (uu < 0 || uu > 1 || vv < 0 || vv > 1) continue;
      const it = this.inst[sf.key];
      best = { t, key: sf.key, hit: it.hud.hit(uu * it.c.width, vv * it.c.height) };
    }
    return best;
  }
}
