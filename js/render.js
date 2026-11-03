// WebGL2 renderer. Passes per frame:
//   sky-view LUT (atmosphere seen from the camera altitude) -> cloud-shadow map -> scene raymarch (HDR, jittered,
//   reduced resolution; ground imagery, aerial perspective, volumetric clouds, SDF Learjet) -> temporal AA/upsample to
//   output resolution -> bloom chain -> eye adaptation -> ACES tonemap to the canvas -> ghost track / trail lines.
// Static at start-up: atmosphere transmittance + multiple-scattering LUTs, baked tileable cloud noise volumes.
import * as SH from './shaders.js';
import { mul4, track } from './anim.js';

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s); const lines = src.split('\n');
    const m = /ERROR: 0:(\d+)/.exec(log); const ctx = m ? lines.slice(Math.max(0, +m[1] - 3), +m[1] + 2).join('\n') : '';
    throw new Error(log + '\n' + ctx);
  }
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram(); gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aNor'); gl.bindAttribLocation(p, 2, 'aUv'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const loc = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); const nm = a.name.replace(/\[0\]$/, ''); loc[nm] = gl.getUniformLocation(p, a.name); }
  return { p, loc };
}

const mat3cols = (r, u, f) => [r[0], r[1], r[2], u[0], u[1], u[2], f[0], f[1], f[2]];
const HALTON = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 not available');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float not available (needed for HDR targets)');
    gl.getExtension('OES_texture_float_linear');
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const P = (fs) => program(gl, SH.VS_QUAD, fs);
    this.pTrans = P(SH.FS_TRANS); this.pMS = P(SH.FS_MS); this.pSky = P(SH.FS_SKYVIEW); this.pNoise = P(SH.FS_NOISE);
    this.pShadow = P(SH.FS_SHADOW); this.pCity = P(SH.FS_CITY); this.pScene = P(SH.FS_SCENE); this.pTAA = P(SH.FS_TAA);
    this.pDown = P(SH.FS_DOWN); this.pUp = P(SH.FS_UP); this.pExpo = P(SH.FS_EXPO); this.pFinal = P(SH.FS_FINAL);
    this.line = program(gl, SH.VS_LINE, SH.FS_LINE); this.pMesh = program(gl, SH.VS_MESH, SH.FS_MESH); this.ext = null; this.pRain = program(gl, SH.VS_RAIN, SH.FS_RAIN); this.pBld = program(gl, SH.VS_BLD, SH.FS_BLD); this.bld = null; this.pTree = this.programTree(SH.VS_TREE, SH.FS_TREE); this.trees = null; this.bolt = null; this.emptyVao = gl.createVertexArray();
    this.quad = gl.createVertexArray(); gl.bindVertexArray(this.quad);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.lineVao = gl.createVertexArray(); gl.bindVertexArray(this.lineVao);
    this.lineBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.scale = 0.5; this.quality = 1.0; this.mie = 1.6; this.sunE = 10; this.dyn = 1; this.dynT = 0; this.ema = 1 / 60; this.targetFps = 55;
    this.frame = 0; this.prev = null; this.T = {}; this.expoSnap = 0;
    // static LUTs
    this.trans = this.target(256, 64, gl.RGBA16F); this.ms = this.target(32, 32, gl.RGBA16F);
    this.sky = this.target(192, 108, gl.RGBA16F); this.shadow = this.target(1024, 1024, gl.RGBA16F); this.shadowPart = 0;
    // 3D ground detail cell map: 512 x 512 cells of 16 m (8.2 km) around the camera, two RGBA16F targets (MRT)
    this.city = this.target(512, 512, gl.RGBA16F, gl.NEAREST); this.city.tex2 = this.makeTex2D(512, 512, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.city.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.city.tex2, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]); gl.bindFramebuffer(gl.FRAMEBUFFER, null); this.cityO = null;
    this.expo = [this.target(1, 1, gl.R32F, gl.NEAREST), this.target(1, 1, gl.R32F, gl.NEAREST)];
    this.pass(this.pTrans, this.trans, (u) => this.atmoU(u));
    this.pass(this.pMS, this.ms, (u) => { this.atmoU(u); this.tex(u, 'uTrans', this.trans.tex, 0); });
    this.noise = this.bakeNoise(128, 0); this.detail = this.bakeNoise(32, 1);
    // placeholders for optional data textures
    this.dummy2 = this.makeTex2D(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    this.dummy3 = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, this.dummy3); gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, 1, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    this.nexTex = null; this.ground = null; this.goes = null;
  }

  // ---------- GL helpers ----------
  makeTex2D(w, h, ifmt, fmt, type, data, filter) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
    const f = filter || gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  target(w, h, ifmt, filter) {
    const gl = this.gl; const info = { [gl.RGBA16F]: [gl.RGBA, gl.HALF_FLOAT], [gl.R32F]: [gl.RED, gl.FLOAT], [gl.RG32F]: [gl.RG, gl.FLOAT], [gl.RGBA8]: [gl.RGBA, gl.UNSIGNED_BYTE] }[ifmt];
    const tex = this.makeTex2D(w, h, ifmt, info[0], info[1], null, filter);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }
  free(t) { if (!t) return; const gl = this.gl; gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); if (t.tex2) gl.deleteTexture(t.tex2); if (t.depth) gl.deleteRenderbuffer(t.depth); }
  tex(u, name, t, unit, target) { const gl = this.gl; if (u[name] == null) return; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target || gl.TEXTURE_2D, t); gl.uniform1i(u[name], unit); }
  pass(prog, tgt, setup) {
    const gl = this.gl; gl.useProgram(prog.p); gl.bindFramebuffer(gl.FRAMEBUFFER, tgt ? tgt.fb : null);
    const w = tgt ? tgt.w : this.canvas.width, h = tgt ? tgt.h : this.canvas.height; gl.viewport(0, 0, w, h);
    setup(prog.loc, w, h); gl.bindVertexArray(this.quad); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  atmoU(u) { const gl = this.gl; if (u.uMie) gl.uniform1f(u.uMie, this.mie); }
  bakeNoise(N, kind) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, N, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.useProgram(this.pNoise.p); gl.bindVertexArray(this.quad); gl.viewport(0, 0, N, N);
    const u = this.pNoise.loc; gl.uniform1f(u.uSize, N); gl.uniform1i(u.uKind, kind);
    for (let z = 0; z < N; z++) { gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t, 0, z); gl.uniform1f(u.uZ, z); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb);
    gl.bindTexture(gl.TEXTURE_3D, t); gl.generateMipmap(gl.TEXTURE_3D);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT);
    return t;
  }

  // ---------- data ----------
  // Two gridded reflectivity volumes as R8 3D textures (layout [north][up][east] -> depth=z, height=y, width=x)
  setNexrad(fa, fb) {
    const gl = this.gl; const mk = (f) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, f.nx, f.ny, f.nz, 0, gl.RED, gl.UNSIGNED_BYTE, f.data);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
      return t; };
    this.nexTex = [mk(fa), mk(fb)]; this.nexO = [fa.x0, fa.y0, fa.z0]; this.nexS = [fa.nx * fa.d, fa.ny * fa.d, fa.nz * fa.d];
  }
  imageTex(img, srgb, mips) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso && mips) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return t;
  }
  // Real ground imagery (data/ground, see tools/fetch_imagery.py). Optional: falls back to the procedural coast.
  async loadGround(base = 'data/ground/') {
    const meta = await (await fetch(base + 'ground.json')).json();
    const load = (f) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = base + f; });
    const [near, far, site, wn, wf, det] = await Promise.all(['near.jpg', 'far.jpg', 'site.jpg', 'near_water.png', 'far_water.png', 'detail.jpg'].map(f => load(f).catch(() => null)));
    if (!near || !far) throw new Error('ground imagery incomplete');
    const b = (k) => { const m = meta[k] || meta.bounds?.[k]; return m ? [m.e0, m.e1, m.n0, m.n1] : [0, 0, 0, 0]; };
    // water mask -> alpha channel of the imagery (one sampler per image)
    const pack = (img, mask) => {
      const w = img.naturalWidth, h = img.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true });
      let m = null; if (mask) { x.drawImage(mask, 0, 0, w, h); m = x.getImageData(0, 0, w, h).data; }
      x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, w, h);
      for (let i = 3, j = 0; i < d.data.length; i += 4, j += 4) d.data[i] = m ? m[j] : 0;
      return d; };
    const nearTex = this.imageTex(pack(near, wn), true, true), farTex = this.imageTex(pack(far, wf), true, true);
    this.expoSnap = 3;
    this.ground = { near: nearTex, far: farTex, site: site ? this.imageTex(pack(site, null), true, true) : this.dummy2,
      detail: det ? this.imageTex(pack(det, null), true, true) : this.dummy2, bDetail: det ? b('detail') : [0, 0, 0, 0],
      bNear: b('near'), bFar: b('far'), bSite: site ? b('site') : [0, 0, 0, 0] };
    return meta;
  }
  // GOES-19 ABI cloud field (data/goes, see tools/fetch_goes.py): visible reflectance, cloud-top height, mask
  async loadGoes(base = 'data/goes/') {
    const meta = await (await fetch(base + 'goes.json')).json();
    const scans = meta.scans || meta.files || [];
    const load = (f) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = base + f; });
    const imgs = await Promise.all(scans.map(s => load(s.file)));
    const b = meta.bounds || meta.grid; const bb = [b.e0, b.n0, b.e1 - b.e0, b.n1 - b.n0];
    this.expoSnap = 3;
    this.goes = { tex: imgs.map(im => this.imageTex(im, false, false)), t: scans.map(s => s.t_sim_s ?? s.t_sim ?? s.t), b: bb };
    return meta;
  }

  // Exterior Learjet 60 mesh (data/ext, tools/fs9_ext.py): vertices pos3 nor3 uv2, uint16 indices, animated nodes
  async loadExterior(base = 'data/ext/', livery = Object.fromEntries(['learjet_fuse', 'LWING', 'RWING', 'Elevator', 'engineL60'].map(n => [n, n + '_N722BD']))) {
    const gl = this.gl;
    const [meta, bin] = await Promise.all([fetch(base + 'ext.json').then(r => r.json()), fetch(base + 'ext.bin').then(r => r.arrayBuffer())]);
    const nv = meta.vertices, ni = meta.indices;
    const va = gl.createVertexArray(); gl.bindVertexArray(va);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bin, 0, nv * 8), gl.STATIC_DRAW);
    [0, 1, 2].forEach((l, i) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, [3, 3, 2][i], gl.FLOAT, false, 32, [0, 12, 24][i]); });
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    const I = meta.index32 ? new Uint32Array(bin, nv * 32, ni) : new Uint16Array(bin, nv * 32, ni); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const load = (n) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = `${base}${n}.webp`; });
    const tex = {};
    await Promise.all(meta.textures.map(async (n) => { const im = (livery[n] && await load(livery[n])) || await load(n); if (im) tex[n] = this.imageTex(im, true, true); }));
    // texture repeat for UVs outside 0..1
    for (const t of Object.values(tex)) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT); }
    this.ext = { va, nodes: meta.nodes, batches: meta.batches, tex, I32: !!meta.index32, W: [] };
    return meta;
  }
  // node world matrices for the current controls (t 50 = neutral for the control surfaces, t 0 = gear up / stowed)
  extPose(ctl) {
    const c = ctl || {}; const cl = (v, a, b) => Math.min(b, Math.max(a, v || 0));
    const t = new Map([[110, 50 + 50 * cl(c.ail, -1, 1)], [112, 50 + 50 * cl(c.ail, -1, 1)], [118, 50 + 50 * cl(c.elev, -1, 1)], [120, 50 + 50 * cl(c.rud, -1, 1)],
      [440, 100 * cl(c.flaps, 0, 1)], [444, 100 * cl(c.flaps, 0, 1)], [164, 100 * cl(c.sb, 0, 1)], [168, 100 * cl(c.sb, 0, 1)],
      [152, c.gear ? 100 : 0], [156, c.gear ? 100 : 0], [160, c.gear ? 100 : 0]]);
    const W = this.ext.W;
    this.ext.nodes.forEach((n, i) => { let m = track(n.keys, n.type, t.has(n.var) ? t.get(n.var) : (n.vicall ? 50 : 0)); if (n.m) m = mul4(m, n.m); W[i] = n.p < 0 ? m : mul4(m, W[n.p]); });
    return W;
  }
  // Cloud-to-ground lightning channel from the cloud base to the ground at (x, z): midpoint-displaced polyline + branches
  strike(x, z, base) {
    const seg = [], R = Math.random;
    const path = (a, b, depth, rough) => { if (depth === 0) { seg.push(...a, ...b); return; }
      const m = [(a[0] + b[0]) / 2 + (R() - 0.5) * rough, (a[1] + b[1]) / 2 + (R() - 0.5) * rough * 0.3, (a[2] + b[2]) / 2 + (R() - 0.5) * rough];
      path(a, m, depth - 1, rough * 0.55); path(m, b, depth - 1, rough * 0.55);
      if (depth > 3 && R() < 0.3) { const e = [m[0] + (R() - 0.5) * 1500, m[1] - 300 - R() * 600, m[2] + (R() - 0.5) * 1500]; path(m, e, depth - 3, rough * 0.4); } };
    path([x + (R() - 0.5) * 2000, base, z + (R() - 0.5) * 2000], [x, 0, z], 9, 1400);
    this.bolt = { x, z, v: new Float32Array(seg) };
  }
  // Real building footprints (data/ground/buildings.bin, OpenStreetMap, ODbL): walls + hip roofs (houses) or ear-clipped
  // flat roofs, one static mesh in metres relative to the area's south-west corner
  async loadBuildings(base = 'data/ground/') {
    const gl = this.gl;
    const meta = await (await fetch(base + 'buildings.json')).json(); const buf = new DataView(await (await fetch(base + 'buildings.bin')).arrayBuffer());
    // vertex: position (3 f32, metres from the area's south-west corner; y = world height) + (kind 0 wall / 1 roof, seed)
    let V = new Float32Array(1 << 22), I = new Uint32Array(1 << 22), nv = 0, ni = 0;
    const grow = () => { if (nv * 5 + 64 * 5 > V.length) { const W = new Float32Array(V.length * 2); W.set(V); V = W; } if (ni + 64 * 12 > I.length) { const J = new Uint32Array(I.length * 2); J.set(I); I = J; } };
    const push = (x, y, z, k, sd) => { const o = nv * 5; V[o] = x; V[o + 1] = y; V[o + 2] = z; V[o + 3] = k; V[o + 4] = sd; return nv++; };
    const tri = (a, b, c) => { I[ni++] = a; I[ni++] = b; I[ni++] = c; };
    const R2 = 12720000, gyAt = (x, z) => ((x + meta.e0) ** 2 + (z + meta.n0) ** 2) / R2;   // spherical-Earth ground (world y)
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const earclip = (P, cb) => {   // P counter-clockwise; cb(i0, i1, i2) per triangle
      const idx = P.map((_, i) => i); let guard = 0;
      const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
      while (idx.length > 3 && guard++ < 4000) { let cut = false;
        for (let k = 0; k < idx.length; k++) { const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
          if (cross(P[i0], P[i1], P[i2]) <= 0) continue;
          let bad = false; for (const j of idx) if (j !== i0 && j !== i1 && j !== i2 && inside(P[j], P[i0], P[i1], P[i2])) { bad = true; break; }
          if (bad) continue; cb(i0, i1, i2); idx.splice(k, 1); cut = true; break; }
        if (!cut) break; }
      if (idx.length === 3) cb(idx[0], idx[1], idx[2]);
    };
    let o = 0;
    while (o < buf.byteLength) {
      const n = buf.getUint8(o), h = buf.getUint8(o + 1) / 4, fl = buf.getUint8(o + 2); o += 3;
      const P = []; for (let i = 0; i < n; i++) { P.push([buf.getUint16(o, true) / 4, buf.getUint16(o + 2, true) / 4]); o += 4; }
      let area = 0; for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
      if (Math.abs(area) < 16) continue; if (area < 0) P.reverse();
      grow();
      let cx = 0, cz = 0; for (const p of P) { cx += p[0]; cz += p[1]; } cx /= n; cz /= n;
      const gy = gyAt(cx, cz), sd = Math.abs((Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453) % 1);
      // hip roof over the footprint's oriented box (ridge along the longest edge); eaves at total height minus the rise
      let roof = null, eave = h;
      if ((fl & 1) && n >= 4) {
        let best = 0, ax = [1, 0]; for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > best) { best = L; ax = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; } }
        const pr = [-ax[1], ax[0]]; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
        for (const p of P) { const u = (p[0] - cx) * ax[0] + (p[1] - cz) * ax[1], v = (p[0] - cx) * pr[0] + (p[1] - cz) * pr[1]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
        u0 -= 0.5; u1 += 0.5; v0 -= 0.5; v1 += 0.5; const W = (v1 - v0) / 2, rise = Math.min(W * 0.42, Math.max(1, h - 2.6));
        eave = Math.max(2.6, h - rise); roof = { ax, pr, u0, u1, v0, v1, W, rise, uc: (u0 + u1) / 2, vc: (v0 + v1) / 2, rl: Math.max(0, (u1 - u0) / 2 - W) };
      }
      const top = gy + eave, base = nv;
      for (const p of P) { push(p[0], gy - 0.5, p[1], 0, sd); push(p[0], top, p[1], 0, sd); }   // shared wall vertices
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, a0 = base + 2 * i, a1 = a0 + 1, b0 = base + 2 * j, b1 = b0 + 1; tri(a0, b0, b1); tri(a0, b1, a1); }
      if (roof) {
        const { ax, pr, u0, u1, v0, v1, rise, uc, vc, rl } = roof; const Wp = (u, v, y) => push(cx + ax[0] * u + pr[0] * v, y, cz + ax[1] * u + pr[1] * v, 1, sd);
        const c0 = Wp(u0, v0, top), c1 = Wp(u1, v0, top), c2 = Wp(u1, v1, top), c3 = Wp(u0, v1, top), r0 = Wp(uc - rl, vc, top + rise), r1 = Wp(uc + rl, vc, top + rise);
        tri(c0, c1, r1); tri(c0, r1, r0); tri(c2, c3, r0); tri(c2, r0, r1); tri(c1, c2, r1); tri(c3, c0, r0);
      } else {
        const rb = nv; for (const p of P) push(p[0], top, p[1], 1, sd);
        earclip(P, (a, b, c) => tri(rb + a, rb + b, rb + c));
      }
    }
    const va = gl.createVertexArray(); gl.bindVertexArray(va);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, V.subarray(0, nv * 5), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 20, 12);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I.subarray(0, ni), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.bld = { va, count: ni, origin: [meta.e0, 0, meta.n0], bounds: [meta.e0, meta.e1, meta.n0, meta.n1], n: meta.count };
    this.cityO = null;   // regenerate the cell map without the colour-guessed houses in this area
    return { buildings: meta.count, vertices: nv, triangles: ni / 3, MB: +((nv * 20 + ni * 4) / 1e6).toFixed(1) };
  }
  programTree(vs, fs) {   // like program() but with the per-instance attribute locations bound
    const gl = this.gl; const p = gl.createProgram(); gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    [['aPos', 0], ['aNor', 1], ['aUv', 2], ['iTree', 3], ['iSeed', 4]].forEach(([n, l]) => gl.bindAttribLocation(p, l, n)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {}; const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) { const a = gl.getActiveUniform(p, i); loc[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
    return { p, loc };
  }
  // Real trees (data/ground/trees.bin, Meta/WRI canopy height map): instanced unit meshes, two LODs, 200 m buckets
  async loadTrees(base = 'data/ground/') {
    const gl = this.gl;
    const meta = await (await fetch(base + 'trees.json')).json(); const d = new DataView(await (await fetch(base + 'trees.bin')).arrayBuffer());
    const RS = 7, n = d.byteLength / RS, T = new Float32Array(n * 5), kind = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const o = i * RS; T[i * 5] = d.getUint16(o, true) / 4; T[i * 5 + 1] = d.getUint16(o + 2, true) / 4; T[i * 5 + 2] = d.getUint8(o + 4) / 4;
      T[i * 5 + 3] = Math.min(7, d.getUint8(o + 5) / 20); T[i * 5 + 4] = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1; kind[i] = d.getUint8(o + 6); }
    const BK = 200, nbx = Math.ceil((meta.e1 - meta.e0) / BK), nbz = Math.ceil((meta.n1 - meta.n0) / BK), buckets = Array.from({ length: nbx * nbz }, () => []);
    for (let i = 0; i < n; i++) { const bx = Math.min(nbx - 1, Math.floor(T[i * 5] / BK)), bz = Math.min(nbz - 1, Math.floor(T[i * 5 + 1] / BK)); buckets[bz * nbx + bx].push(i); }
    // unit meshes: icosphere lobes (canopy spans y 0.25..1, xz -1..1) + 6-sided trunk (part 1, y 0..0.55)
    const ico = (sub) => { const t = (1 + Math.sqrt(5)) / 2; let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(v => { const l = Math.hypot(...v); return v.map(x => x / l); });
      let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      for (let s2 = 0; s2 < sub; s2++) { const cache = {}, mid = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; if (cache[k] !== undefined) return cache[k]; const m = [0, 1, 2].map(j => (V[a][j] + V[b][j]) / 2), l = Math.hypot(...m); V.push(m.map(x => x / l)); return cache[k] = V.length - 1; };
        const G = []; for (const [a, b, c] of F) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); G.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); } F = G; }
      return { V, F }; };
    const build = (lobes, trunk, sub) => { const v = [], idx = []; const S = ico(sub);
      for (const [cx, cy, cz, rx, ry, rz] of lobes) { const b = v.length / 8; for (const p of S.V) v.push(cx + p[0] * rx, cy + p[1] * ry, cz + p[2] * rz, p[0] / rx, p[1] / ry, p[2] / rz, 0, 0); for (const f of S.F) idx.push(b + f[0], b + f[2], b + f[1]); }
      if (trunk) { const b = v.length / 8, K = 6; for (let k = 0; k < K; k++) { const a = k / K * 6.2832, x = Math.cos(a), z = Math.sin(a); v.push(x, 0, z, x, 0, z, 1, 0, x, 0.55, z, x, 0, z, 1, 0); }
        for (let k = 0; k < K; k++) { const a0 = b + 2 * k, a1 = a0 + 1, b0 = b + 2 * ((k + 1) % K), b1 = b0 + 1; idx.push(a0, b0, b1, a0, b1, a1); } }
      const va = gl.createVertexArray(); gl.bindVertexArray(va);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
      [[0, 3, 0], [1, 3, 12], [2, 2, 24]].forEach(([l, k, off]) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, k, gl.FLOAT, false, 32, off); });
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      const inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 20, 0); gl.vertexAttribDivisor(3, 1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 20, 16); gl.vertexAttribDivisor(4, 1);
      gl.bindVertexArray(null); return { va, inst, count: idx.length, n: 0 }; };
    const lobes = [[0, 0.62, 0, 0.8, 0.38, 0.8], [0.42, 0.52, 0.12, 0.6, 0.3, 0.6], [-0.3, 0.5, -0.38, 0.6, 0.3, 0.6]];
    // palm: slender trunk (part 2) to 0.9 h, nine drooping fronds (part 0) of crown-radius length, a small head
    const palm = (fronds, segs) => { const v = [], idx = [];
      const K = 6, b0 = 0; for (let k = 0; k < K; k++) { const a = k / K * 6.2832, x = Math.cos(a), z = Math.sin(a); v.push(x, 0, z, x, 0, z, 2, 0, x, 0.9, z, x, 0, z, 2, 0); }
      for (let k = 0; k < K; k++) { const a0 = b0 + 2 * k, a1 = a0 + 1, c0 = b0 + 2 * ((k + 1) % K), c1 = c0 + 1; idx.push(a0, c0, c1, a0, c1, a1); }
      for (let f = 0; f < fronds; f++) { const th = f / fronds * 6.2832 + (f % 2) * 0.2, dx = Math.cos(th), dz = Math.sin(th), px = -dz, pz = dx, lift = f % 3 === 0 ? 0.06 : 0; const b = v.length / 8;
        for (let i = 0; i <= segs; i++) { const t = i / segs, r = 0.05 + t, y = 0.9 + lift + 0.06 * Math.sin(Math.PI * t * 0.8) - 0.16 * t * t, w = 0.27 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.03;
          for (const sgn of [-1, 1]) v.push(dx * r + px * w * sgn, y, dz * r + pz * w * sgn, 0.25 * dx, 1, 0.25 * dz, 0, 0); }
        for (let i = 0; i < segs; i++) { const a0 = b + 2 * i, a1 = a0 + 1, c0 = a0 + 2, c1 = a0 + 3; idx.push(a0, c0, c1, a0, c1, a1); } }
      return { v, idx }; };
    const buildRaw = ({ v, idx }) => { const va = gl.createVertexArray(); gl.bindVertexArray(va);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
      [[0, 3, 0], [1, 3, 12], [2, 2, 24]].forEach(([l, k, off]) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, k, gl.FLOAT, false, 32, off); });
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      const inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 20, 0); gl.vertexAttribDivisor(3, 1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 20, 16); gl.vertexAttribDivisor(4, 1);
      gl.bindVertexArray(null); return { va, inst, count: idx.length, n: 0, twoSided: true }; };
    // forms from the measured shape: palm (kind 1, from the data); slash pine = tall (>= 15 m) with a narrow crown
    // (<= 4.5 m) -> high, flat-topped crown on a long trunk; other broadleaf split by seed into a rounded and a spreading crown
    for (let i = 0; i < n; i++) if (kind[i] === 0) { const h = T[i * 5 + 2], r = T[i * 5 + 3]; kind[i] = h >= 15 && r <= 4.5 ? 3 : T[i * 5 + 4] < 0.45 ? 2 : 0; }
    const spread = [[0, 0.58, 0, 1.0, 0.3, 0.95], [0.55, 0.5, 0.25, 0.62, 0.24, 0.62], [-0.5, 0.48, -0.3, 0.6, 0.24, 0.6], [0.1, 0.66, -0.5, 0.55, 0.22, 0.55]];
    const pine = [[0, 0.88, 0, 0.75, 0.13, 0.75], [0.35, 0.8, 0.2, 0.45, 0.11, 0.45], [-0.3, 0.83, -0.25, 0.45, 0.1, 0.45]];
    this.trees = { T, kind, buckets, nbx, nbz, BK, origin: [meta.e0, 0, meta.n0], bounds: [meta.e0, meta.e1, meta.n0, meta.n1],
      near: build(lobes, true, 1), mid: build([[0, 0.6, 0, 0.85, 0.4, 0.85]], true, 0),
      spreadNear: build(spread, true, 1), spreadMid: build([[0, 0.56, 0, 1.0, 0.3, 1.0]], true, 0),
      pineNear: build(pine, true, 1), pineMid: build([[0, 0.86, 0, 0.7, 0.15, 0.7]], true, 0),
      palmNear: buildRaw(palm(11, 5)), palmMid: buildRaw(palm(7, 2)), at: null, n, palms: kind.reduce((a, k) => a + (k === 1), 0), pines: kind.reduce((a, k) => a + (k === 3), 0) };
    this.trees.pineNear.trunkLen = this.trees.pineMid.trunkLen = 0.8;
    return { trees: n, palms: this.trees.palms, pines: this.trees.pines };
  }
  updateTreeInstances(cam) {   // gather near (< 600 m, full trees) and mid (< 2.5 km, blobs) instances when the camera has moved 40 m
    const R = this.trees, gl = this.gl, cx = cam[0] - R.origin[0], cz = cam[2] - R.origin[2];
    if (R.at && Math.hypot(cx - R.at[0], cz - R.at[1]) < 40) return; R.at = [cx, cz];
    const L = [[], [], [], [], [], [], [], []], r1 = 600, r2 = 2500, b0x = Math.max(0, Math.floor((cx - r2) / R.BK)), b1x = Math.min(R.nbx - 1, Math.floor((cx + r2) / R.BK)), b0z = Math.max(0, Math.floor((cz - r2) / R.BK)), b1z = Math.min(R.nbz - 1, Math.floor((cz + r2) / R.BK));
    for (let bz = b0z; bz <= b1z; bz++) for (let bx = b0x; bx <= b1x; bx++) for (const i of R.buckets[bz * R.nbx + bx]) {
      const dx = R.T[i * 5] - cx, dz = R.T[i * 5 + 1] - cz, dd = dx * dx + dz * dz; if (dd > r2 * r2) continue;
      L[R.kind[i] * 2 + (dd < r1 * r1 ? 0 : 1)].push(R.T[i * 5], R.T[i * 5 + 1], R.T[i * 5 + 2], R.T[i * 5 + 3], R.T[i * 5 + 4]); }
    for (const [LL, arr] of [[R.near, L[0]], [R.mid, L[1]], [R.palmNear, L[2]], [R.palmMid, L[3]], [R.spreadNear, L[4]], [R.spreadMid, L[5]], [R.pineNear, L[6]], [R.pineMid, L[7]]]) { gl.bindBuffer(gl.ARRAY_BUFFER, LL.inst); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW); LL.n = arr.length / 5; }
  }
  drawTrees(S, camM, tanF, aspect) {
    const gl = this.gl, R = this.trees, T = this.T, m = T.msaa, u = this.pTree.loc, c = S.cam;
    this.updateTreeInstances(c.pos);
    gl.useProgram(this.pTree.p); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW);
    this.atmoU(u); this.cloudU(u, S);
    this.tex(u, 'uTrans', this.trans.tex, 0); this.tex(u, 'uMS', this.ms.tex, 1); this.tex(u, 'uSkyView', this.sky.tex, 8); this.tex(u, 'uCShadow', this.shadow.tex, 9);
    this.tex(u, 'uGSite', this.ground.site, 10); this.tex(u, 'uSceneDep', T.scene.tex2, 11); this.tex(u, 'uBg', T.hist[this.frame & 1].tex, 12);
    gl.uniform4fv(u.uGBSite, this.ground.bSite); gl.uniform4fv(u.uCSO, this.cso); gl.uniform1f(u.uFarTau, this.goes && S.useGoes ? 60 : 0); gl.uniform1f(u.uSunE, this.sunE);
    gl.uniform1f(u.uFlash, S.flash); gl.uniform3fv(u.uFlashPos, S.flashPos || [S.storm.pos[0], 8000, S.storm.pos[2]]);
    gl.uniform3fv(u.uCamPos, c.pos); gl.uniform3fv(u.uOrigin, R.origin); gl.uniform2f(u.uOutRes, m.w, m.h);
    gl.uniform3f(u.uOff, R.origin[0] - c.pos[0], -c.pos[1], R.origin[2] - c.pos[2]);
    gl.uniformMatrix3fv(u.uCam, false, camM); gl.uniform1f(u.uTanFov, tanF); gl.uniform1f(u.uAspect, aspect);
    for (const L of [R.near, R.mid, R.spreadNear, R.spreadMid, R.pineNear, R.pineMid, R.palmNear, R.palmMid]) if (L.n) { if (L.twoSided) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
      gl.uniform1f(u.uTrunk, L.trunkLen || 0.55); gl.bindVertexArray(L.va); gl.drawElementsInstanced(gl.TRIANGLES, L.count, gl.UNSIGNED_SHORT, 0, L.n); }
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.bindVertexArray(null);
  }
  drawBuildings(S, camM, tanF, aspect) {
    const gl = this.gl, B = this.bld, T = this.T, m = T.msaa, u = this.pBld.loc, c = S.cam;
    gl.useProgram(this.pBld.p); gl.bindVertexArray(B.va);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    this.atmoU(u); this.cloudU(u, S);
    this.tex(u, 'uTrans', this.trans.tex, 0); this.tex(u, 'uMS', this.ms.tex, 1); this.tex(u, 'uSkyView', this.sky.tex, 8); this.tex(u, 'uCShadow', this.shadow.tex, 9);
    this.tex(u, 'uGSite', this.ground.site, 10); this.tex(u, 'uSceneDep', T.scene.tex2, 11); this.tex(u, 'uBg', T.hist[this.frame & 1].tex, 12);
    gl.uniform4fv(u.uGBSite, this.ground.bSite); gl.uniform4fv(u.uCSO, this.cso); gl.uniform1f(u.uFarTau, this.goes && S.useGoes ? 60 : 0); gl.uniform1f(u.uSunE, this.sunE);
    gl.uniform1f(u.uFlash, S.flash); gl.uniform3fv(u.uFlashPos, S.flashPos || [S.storm.pos[0], 8000, S.storm.pos[2]]);
    gl.uniform3fv(u.uCamPos, c.pos); gl.uniform3fv(u.uOrigin, B.origin); gl.uniform2f(u.uOutRes, m.w, m.h);
    gl.uniform3f(u.uOff, B.origin[0] - c.pos[0], -c.pos[1], B.origin[2] - c.pos[2]);
    gl.uniformMatrix3fv(u.uCam, false, camM); gl.uniform1f(u.uTanFov, tanF); gl.uniform1f(u.uAspect, aspect);
    gl.drawElements(gl.TRIANGLES, B.count, gl.UNSIGNED_INT, 0);
    gl.disable(gl.DEPTH_TEST); gl.bindVertexArray(null);
  }
  // ---------- frame ----------
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ow = Math.floor(window.innerWidth * Math.min(dpr, 1.5)), oh = Math.floor(window.innerHeight * Math.min(dpr, 1.5));
    if (this.canvas.width !== ow || this.canvas.height !== oh) { this.canvas.width = ow; this.canvas.height = oh; }
    // dynamic resolution: the scene raymarch runs at scale * dyn (TAA upsamples to the output); dyn tracks frame time
    const sc = this.scale * this.dyn;
    const sw = Math.max(64, Math.floor(window.innerWidth * dpr * sc)), sh = Math.max(36, Math.floor(window.innerHeight * dpr * sc));
    const gl = this.gl, T = this.T;
    if (!T.scene || T.scene.w !== sw || T.scene.h !== sh) {
      this.free(T.scene);
      const s = this.target(sw, sh, gl.RGBA16F);
      s.tex2 = this.makeTex2D(sw, sh, gl.RG32F, gl.RG, gl.FLOAT, null, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, s.tex2, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      T.scene = s;

    }
    if (!T.hist || T.hist[0].w !== ow || T.hist[0].h !== oh) {
      if (T.hist) T.hist.forEach(t => this.free(t)); if (T.bloom) T.bloom.forEach(t => this.free(t));
      T.hist = [this.target(ow, oh, gl.RGBA16F), this.target(ow, oh, gl.RGBA16F)];
      // exterior aircraft: 4x MSAA HDR colour + depth at output resolution, resolved into T.mesh
      if (T.msaa) { gl.deleteFramebuffer(T.msaa.fb); gl.deleteRenderbuffer(T.msaa.c); gl.deleteRenderbuffer(T.msaa.d); } this.free(T.mesh);
      const ns = Math.min(4, (gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES) || [0])[0] || 0);
      const m = { fb: gl.createFramebuffer(), c: gl.createRenderbuffer(), d: gl.createRenderbuffer(), w: ow, h: oh };
      gl.bindRenderbuffer(gl.RENDERBUFFER, m.c); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, ns, gl.RGBA16F, ow, oh);
      gl.bindRenderbuffer(gl.RENDERBUFFER, m.d); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, ns, gl.DEPTH_COMPONENT24, ow, oh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, m.fb); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, m.c); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, m.d);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); T.msaa = m; T.mesh = this.target(ow, oh, gl.RGBA16F);
      T.bloom = []; let w = ow, h = oh; for (let i = 0; i < 6; i++) { w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); T.bloom.push(this.target(w, h, gl.RGBA16F)); }
      this.prev = null;
    }
  }
  viewProj(cam, aspect, fov) {
    const { right: r, up: u, fwd: f, pos: p } = cam;
    const view = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0,
      -(r[0]*p[0] + r[1]*p[1] + r[2]*p[2]), -(u[0]*p[0] + u[1]*p[1] + u[2]*p[2]), (f[0]*p[0] + f[1]*p[1] + f[2]*p[2]), 1];
    const n = 2, fa = 300000, t = 1 / Math.tan(fov / 2);
    const proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0];
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += proj[k*4 + j] * view[i*4 + k]; out[i*4 + j] = s; }
    return out;
  }
  groundU(u) {
    const gl = this.gl, G = this.ground; gl.uniform1i(u.uGround, G ? 1 : 0);
    this.tex(u, 'uGNear', G ? G.near : this.dummy2, 10); this.tex(u, 'uGFar', G ? G.far : this.dummy2, 11); this.tex(u, 'uGSite', G ? G.site : this.dummy2, 12);
    this.tex(u, 'uGDetail', G ? G.detail : this.dummy2, 15);
    if (G) { gl.uniform4fv(u.uGBNear, G.bNear); gl.uniform4fv(u.uGBFar, G.bFar); gl.uniform4fv(u.uGBSite, G.bSite); gl.uniform4fv(u.uGBDetail, G.bDetail); }
  }
  cloudU(u, S) {
    const gl = this.gl;
    gl.uniform3fv(u.uSun, S.sun); gl.uniform1f(u.uTime, S.time);
    gl.uniform3fv(u.uStorm, S.storm.pos); gl.uniform1f(u.uStormR, S.storm.r); gl.uniform1f(u.uStormBase, S.storm.base); gl.uniform1f(u.uStormCB, S.stormCB ?? 900); gl.uniform1f(u.uDeckBase, S.deckBase ?? 1830);
    gl.uniform3f(u.uLayer, S.cloudBase, S.cloudTop, S.cloudCover ?? 0.35); gl.uniform1f(u.uLayerSig, S.layerSigma ?? 0.03);
    gl.uniform2fv(u.uWind, S.windXZ || [0, 0]);
    const useNex = this.nexTex && S.useNex ? 1 : 0; gl.uniform1i(u.uUseNex, useNex);
    this.tex(u, 'uNoise', this.noise, 2, gl.TEXTURE_3D); this.tex(u, 'uDetail', this.detail, 3, gl.TEXTURE_3D);
    this.tex(u, 'uNexA', this.nexTex ? this.nexTex[0] : this.dummy3, 4, gl.TEXTURE_3D); this.tex(u, 'uNexB', this.nexTex ? this.nexTex[1] : this.dummy3, 5, gl.TEXTURE_3D);
    if (this.nexTex) { gl.uniform1f(u.uNexMix, S.nexMix); gl.uniform3fv(u.uNexO, this.nexO); gl.uniform3fv(u.uNexS, this.nexS); }
    const G = this.goes && S.useGoes ? this.goes : null;
    gl.uniform1i(u.uUseGoes, G ? 1 : 0);
    if (G) {
      let i = 0; while (i < G.t.length - 2 && S.simT > G.t[i + 1]) i++;
      const j = Math.min(i + 1, G.t.length - 1); const m = j === i ? 0 : Math.min(1, Math.max(0, (S.simT - G.t[i]) / (G.t[j] - G.t[i])));
      this.tex(u, 'uGoes', G.tex[i], 6); this.tex(u, 'uGoes2', G.tex[j], 7); gl.uniform1f(u.uGoesMix, m); gl.uniform4fv(u.uGoesB, G.b);
    } else { this.tex(u, 'uGoes', this.dummy2, 6); this.tex(u, 'uGoes2', this.dummy2, 7); }
  }
  drawExterior(S, camM, tanF, aspect, rel, bg) {
    const gl = this.gl, E = this.ext, T = this.T, m = T.msaa, u = this.pMesh.loc, a = S.ac;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(this.extFront ?? gl.CCW);
    gl.useProgram(this.pMesh.p); gl.bindVertexArray(E.va);
    this.atmoU(u); this.cloudU(u, S);
    this.tex(u, 'uTrans', this.trans.tex, 0); this.tex(u, 'uMS', this.ms.tex, 1); this.tex(u, 'uSkyView', this.sky.tex, 8); this.tex(u, 'uCShadow', this.shadow.tex, 9); this.tex(u, 'uBg', bg.tex, 11);
    gl.uniform4fv(u.uCSO, this.cso); gl.uniform1f(u.uFarTau, this.goes && S.useGoes ? 60 : 0); gl.uniform1f(u.uSunE, this.sunE);
    gl.uniform1f(u.uFlash, S.flash); gl.uniform3fv(u.uFlashPos, S.flashPos || [S.storm.pos[0], 8000, S.storm.pos[2]]);
    gl.uniform3fv(u.uCamPos, S.cam.pos); gl.uniform2f(u.uOutRes, m.w, m.h); gl.uniform1f(u.uBeacon, (S.time % 1.0) < 0.08 ? 1 : 0);
    gl.uniformMatrix3fv(u.uAcB, false, mat3cols(a.right, a.up, a.fwd)); gl.uniform3fv(u.uAcRel, rel);
    gl.uniformMatrix3fv(u.uCam, false, camM); gl.uniform1f(u.uTanFov, tanF); gl.uniform1f(u.uAspect, aspect);
    const W = this.extPose(S.ctl); const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    gl.uniform1i(u.uTex, 10);
    for (const b of E.batches) {
      if (S.stabGone && b.tex === 'Elevator') continue;
      gl.uniformMatrix4fv(u.uModel, false, b.node < 0 ? I4 : W[b.node]);
      const t = b.tex && E.tex[b.tex]; gl.uniform1i(u.uHasTex, t ? 1 : 0); gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, t || this.dummy2);
      gl.uniform4fv(u.uDiffuse, b.diffuse); gl.uniform1i(u.uKind, b.glass ? 1 : b.tag === 'nav' ? 2 : b.tag === 'beacon' ? 3 : 0);
      gl.drawElements(gl.TRIANGLES, b.count, E.I32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, b.first * (E.I32 ? 4 : 2));
    }
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.frontFace(gl.CCW); gl.bindVertexArray(null);
  }
  render(S) {
    if (this.dbg) S = Object.assign({}, S, this.dbg);   // console overrides, e.g. SIM.R.dbg = {cloudCover: 0}
    const gl = this.gl; this.resize(); const T = this.T;
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    const c = S.cam, R = 6360, camR = R + Math.max(0.005, c.pos[1] / 1000 - (c.pos[0] ** 2 + c.pos[2] ** 2) / 12720000000);
    const sun = S.sun; const sunMu = sun[1];   // local vertical ~ world y within the play area
    const dt = Math.min(0.1, Math.max(0, S.dt ?? 1 / 60));
    if (dt > 0) { this.ema += (dt - this.ema) * 0.05; this.dynT += dt;
      if (this.dynT > 0.75) { this.dynT = 0; const f = 1 / this.ema;
        if (f < this.targetFps * 0.92 && this.dyn > 0.45) this.dyn = Math.max(0.45, +(this.dyn - 0.1).toFixed(2));
        else if (f > this.targetFps * 1.35 && this.dyn < 1) this.dyn = Math.min(1, +(this.dyn + 0.1).toFixed(2)); } }
    // sky-view LUT
    this.pass(this.pSky, this.sky, (u) => { this.atmoU(u); this.tex(u, 'uTrans', this.trans.tex, 0); this.tex(u, 'uMS', this.ms.tex, 1);
      gl.uniform1f(u.uCamR, camR); gl.uniform1f(u.uSunMu, sunMu); gl.uniform1f(u.uSunE, this.sunE); });
    // cloud-shadow map, centred on the camera, snapped to texels
    // 220 km square, re-centred (full refresh) only after the camera moves 25 km; otherwise one quarter refreshed per frame
    const csz = 220000, tx = csz / 1024;
    const full = !this.cso || Math.abs(c.pos[0] - (this.cso[0] + csz / 2)) > 25000 || Math.abs(c.pos[2] - (this.cso[1] + csz / 2)) > 25000;
    if (full) this.cso = [Math.round(c.pos[0] / tx) * tx - csz / 2, Math.round(c.pos[2] / tx) * tx - csz / 2, csz, 0];
    if (!full) { gl.enable(gl.SCISSOR_TEST); gl.scissor(0, this.shadowPart * 256, 1024, 256); this.shadowPart = (this.shadowPart + 1) % 4; }
    this.pass(this.pShadow, this.shadow, (u) => { this.cloudU(u, S); gl.uniform4fv(u.uCSO, this.cso); gl.uniform1f(u.uTop, 17500); });
    gl.disable(gl.SCISSOR_TEST);
    // scene
    const jit = [HALTON((this.frame % 16) + 1, 2) - 0.5, HALTON((this.frame % 16) + 1, 3) - 0.5];
    const sw = T.scene.w, sh = T.scene.h;
    const camM = mat3cols(c.right, c.up, c.fwd); const tanF = Math.tan(S.fov / 2);
    const a = S.ac, acM = mat3cols(a.fwd, a.right, a.up);
    const rel = [a.pos[0] - c.pos[0], a.pos[1] - c.pos[1], a.pos[2] - c.pos[2]];
    // cell map for the 3D houses / trees: regenerate when low and >2 km from its centre (or imagery just arrived)
    const CELL = 16, NC = 512, low = this.ground && c.pos[1] < 2200 && S.city !== false;
    if (low && (!this.cityO || this.cityGround !== this.ground || Math.hypot(c.pos[0] - (this.cityO[0] + NC * CELL / 2), c.pos[2] - (this.cityO[1] + NC * CELL / 2)) > 2000)) {
      this.cityO = [Math.floor(c.pos[0] / CELL - NC / 2) * CELL, Math.floor(c.pos[2] / CELL - NC / 2) * CELL, NC, CELL]; this.cityGround = this.ground;
      this.pass(this.pCity, this.city, (u) => { this.groundU(u); gl.uniform4fv(u.uCityO, this.cityO); gl.uniform4fv(u.uOsmB, this.bld ? this.bld.bounds : [0, 0, 0, 0]); });
    }
    const mesh = !!(this.ext && S.ext && Math.hypot(...rel) < 25000);
    this.pass(this.pScene, T.scene, (u) => {
      this.atmoU(u); this.cloudU(u, S);
      this.tex(u, 'uTrans', this.trans.tex, 0); this.tex(u, 'uMS', this.ms.tex, 1); this.tex(u, 'uSkyView', this.sky.tex, 8); this.tex(u, 'uCShadow', this.shadow.tex, 9);
      gl.uniform4fv(u.uCSO, this.cso); gl.uniform1f(u.uFarTau, this.goes && S.useGoes ? 60 : 0);
      gl.uniform2f(u.uRes, sw, sh); gl.uniform2f(u.uJit, jit[0] * 2 / sw, jit[1] * 2 / sh); gl.uniform1i(u.uFrame, this.frame);
      gl.uniform3fv(u.uCamPos, c.pos); gl.uniformMatrix3fv(u.uCam, false, camM); gl.uniform1f(u.uTanFov, tanF);
      gl.uniform1f(u.uSunE, this.sunE); gl.uniform1f(u.uQual, this.quality);
      gl.uniform3fv(u.uAcPos, a.pos); gl.uniformMatrix3fv(u.uAcRot, false, acM);
      gl.uniform1i(u.uExt, S.ext && !this.ext ? 1 : 0); gl.uniform1i(u.uStabGone, S.stabGone ? 1 : 0);
      const g = S.ghost; gl.uniform3fv(u.uGhPos, g.pos); gl.uniformMatrix3fv(u.uGhRot, false, mat3cols(g.fwd, g.right, g.up)); gl.uniform1i(u.uGhost, S.showGhost ? 1 : 0);
      gl.uniform1f(u.uFlash, S.flash); gl.uniform3fv(u.uFlashPos, S.flashPos || [S.storm.pos[0], 8000, S.storm.pos[2]]);
      this.groundU(u); gl.uniform1i(u.uCity, low && this.cityO ? 1 : 0);
      this.tex(u, 'uCityA', this.city.tex, 13); this.tex(u, 'uCityB', this.city.tex2, 14); gl.uniform4fv(u.uCityO, this.cityO || [0, 0, 0, 16]);
    });
    // temporal AA into the history ping-pong at output resolution
    const ow = this.canvas.width, oh = this.canvas.height, aspect = ow / oh;
    const cur = { pos: c.pos.slice(), cam: camM, tan: tanF, acPos: a.pos.slice(), acM, fov: S.fov };
    const p = this.prev;
    const reset = !p || Math.hypot(c.pos[0] - p.pos[0], c.pos[1] - p.pos[1], c.pos[2] - p.pos[2]) > 400 || Math.abs(S.fov - p.fov) > 0.05 * S.fov;
    const hi = this.frame & 1, hOut = T.hist[hi], hIn = T.hist[hi ^ 1];
    this.pass(this.pTAA, hOut, (u) => {
      this.tex(u, 'uCur', T.scene.tex, 0); this.tex(u, 'uDep', T.scene.tex2, 1); this.tex(u, 'uHist', hIn.tex, 2);
      gl.uniform2f(u.uCurRes, sw, sh); gl.uniform2f(u.uOutRes, ow, oh); gl.uniform2f(u.uJitUv, jit[0] / sw, jit[1] / sh);
      gl.uniform3fv(u.uCamPos, c.pos); gl.uniformMatrix3fv(u.uCam, false, camM); gl.uniform1f(u.uTanFov, tanF); gl.uniform1f(u.uAspect, aspect);
      const q = p || cur;
      gl.uniform3fv(u.uPCamPos, q.pos); gl.uniformMatrix3fv(u.uPCam, false, q.cam); gl.uniform1f(u.uPTanFov, q.tan);
      gl.uniform3fv(u.uAcPos, a.pos); gl.uniformMatrix3fv(u.uAcRot, false, acM); gl.uniform3fv(u.uPAcPos, q.acPos); gl.uniformMatrix3fv(u.uPAcRot, false, q.acM);
      gl.uniform1i(u.uReset, reset ? 1 : 0); gl.uniform1f(u.uBlend, 0.1);
    });
    this.prev = cur;
    // full-resolution 4x MSAA forward pass: the aircraft and the real buildings, resolved and composited in the final pass
    const blds = !!(this.bld && this.ground && c.pos[1] < 3500 && c.pos[0] > this.bld.bounds[0] - 9000 && c.pos[0] < this.bld.bounds[1] + 9000 && c.pos[2] > this.bld.bounds[2] - 9000 && c.pos[2] < this.bld.bounds[3] + 9000 && S.buildings !== false);
    const fwd = mesh || blds;
    if (fwd) {
      const m = T.msaa; gl.bindFramebuffer(gl.FRAMEBUFFER, m.fb); gl.viewport(0, 0, m.w, m.h);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clearBufferfi(gl.DEPTH_STENCIL, 0, 1, 0);
      if (blds) this.drawBuildings(S, camM, tanF, aspect);
      if (blds && this.trees) this.drawTrees(S, camM, tanF, aspect);
      if (mesh) this.drawExterior(S, camM, tanF, aspect, rel, hOut);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, m.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.mesh.fb);
      gl.blitFramebuffer(0, 0, m.w, m.h, 0, 0, m.w, m.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    // lightning channel (cloud-to-ground strokes) into the HDR image so bloom gives it a glow
    if (this.bolt && S.flash > 0.05) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, hOut.fb); gl.viewport(0, 0, ow, oh); gl.useProgram(this.line.p); gl.bindVertexArray(this.lineVao);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniformMatrix4fv(this.line.loc.uVP, false, this.viewProj(c, aspect, S.fov)); gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      const d = Math.hypot(this.bolt.x - c.pos[0], this.bolt.z - c.pos[2]), k = S.flash * 400 * Math.exp(-d / 14000);
      gl.bufferData(gl.ARRAY_BUFFER, this.bolt.v, gl.DYNAMIC_DRAW); gl.uniform4f(this.line.loc.uColor, k * 0.85, k * 0.9, k, 1);
      gl.drawArrays(gl.LINES, 0, this.bolt.v.length / 3); gl.disable(gl.BLEND);
    }
    // bloom chain
    let src = hOut;
    for (let i = 0; i < T.bloom.length; i++) { const dst = T.bloom[i];
      this.pass(this.pDown, dst, (u) => { this.tex(u, 'uSrc', src.tex, 0); gl.uniform2f(u.uDst, dst.w, dst.h); gl.uniform1i(u.uKaris, i === 0 ? 1 : 0); }); src = dst; }
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = T.bloom.length - 1; i > 0; i--) { const s = T.bloom[i], d = T.bloom[i - 1];
      this.pass(this.pUp, d, (u) => { this.tex(u, 'uSrc', s.tex, 0); gl.uniform1f(u.uRadius, 1.0); gl.uniform2f(u.uDst, d.w, d.h); }); }
    gl.disable(gl.BLEND);
    // eye adaptation
    const ei = this.frame & 1, eOut = this.expo[ei], eIn = this.expo[ei ^ 1];
    this.pass(this.pExpo, eOut, (u) => { this.tex(u, 'uSrc', T.bloom[T.bloom.length - 1].tex, 0); this.tex(u, 'uPrev', eIn.tex, 1);
      gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uRef, this.sunE * 0.12); gl.uniform1i(u.uReset, this.frame < 2 || reset || this.expoSnap > 0 ? 1 : 0); });
    if (this.expoSnap > 0) this.expoSnap--;
    // tonemap to the canvas
    this.pass(this.pFinal, null, (u) => { this.tex(u, 'uHdr', hOut.tex, 0); this.tex(u, 'uBloom', T.bloom[0].tex, 1); this.tex(u, 'uExpo', eOut.tex, 2);
      gl.uniform2f(u.uOutRes, ow, oh); gl.uniform1f(u.uBloomStr, 0.045); gl.uniform1i(u.uFrame, this.frame);
      this.tex(u, 'uGhost', T.bloom[2].tex, 3); this.tex(u, 'uMeshTex', T.mesh.tex, 4); this.tex(u, 'uSceneTex', T.scene.tex, 5); gl.uniform1f(u.uSunR, 0.00466 / (2 * tanF)); gl.uniform1i(u.uHasMesh, fwd ? 1 : 0);
      const sv = [0, 1, 2].map(i => S.sun[0] * camM[3 * i] + S.sun[1] * camM[3 * i + 1] + S.sun[2] * camM[3 * i + 2]);   // sun in camera (right, up, fwd)
      gl.uniform3f(u.uSunScr, 0.5 + 0.5 * sv[0] / (sv[2] * tanF * aspect), 0.5 + 0.5 * sv[1] / (sv[2] * tanF), sv[2] > 0.05 ? 1 : 0); });
    // precipitation streaks
    const camVel = S.camVel || (this.prevCamPos && dt > 0 ? [0, 1, 2].map(i => (c.pos[i] - this.prevCamPos[i]) / dt) : [0, 0, 0]); this.prevCamPos = c.pos.slice();
    if ((S.precip || 0) > 0.02) {
      const fall = S.precipFall || [0, -7, 0]; const rel = [fall[0] - camVel[0], fall[1] - camVel[1], fall[2] - camVel[2]];
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, ow, oh); gl.useProgram(this.pRain.p); gl.bindVertexArray(this.emptyVao);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      const u = this.pRain.loc; gl.uniformMatrix4fv(u.uVP, false, this.viewProj(c, aspect, S.fov));
      gl.uniform3fv(u.uCamPos, c.pos); gl.uniform3fv(u.uFall, fall); gl.uniform3fv(u.uRel, rel); gl.uniform1f(u.uBox, 70); gl.uniform1f(u.uTime, S.time % 1000); gl.uniform1f(u.uLen, 1 / 120);
      const b = S.precipBright ?? 0.6; gl.uniform4f(u.uColor, b, b, b * 1.05, 0.3 * Math.min(1, S.precip) + 0.4 * (S.flash || 0));
      gl.drawArrays(gl.LINES, 0, Math.floor(2 * 7000 * Math.min(1, S.precip)));
      gl.disable(gl.BLEND);
    }
    // lines
    if (S.lines && S.lines.length) {
      gl.useProgram(this.line.p); gl.bindVertexArray(this.lineVao);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniformMatrix4fv(this.line.loc.uVP, false, this.viewProj(c, aspect, S.fov));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      for (const L of S.lines) {
        if (L.data.length < 6) continue;
        gl.bufferData(gl.ARRAY_BUFFER, L.data, gl.DYNAMIC_DRAW);
        gl.uniform4fv(this.line.loc.uColor, L.color);
        gl.drawArrays(L.strip ? gl.LINE_STRIP : gl.LINES, 0, L.data.length / 3);
      }
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
    this.frame++;
  }
}
