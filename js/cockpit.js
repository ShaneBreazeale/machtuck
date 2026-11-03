// 3D Learjet 60 cockpit, seen from the left seat. Procedural geometry in the pilot's eye frame
// (x right, y up, z forward, metres, eye at the origin), lit by the sun through the windshield.
// The instruments are the existing HUD instruments drawn into offscreen canvases and mapped onto
// the panel screens; clicks are ray-cast onto those screens and handed to the HUD hit-tests.
import { HUD } from './hud.js';
import { clamp, lerp, DEG } from './util.js';

const VS = `#version 300 es
in vec3 aPos; in vec3 aNor; in vec3 aCol; in vec2 aUv;
uniform mat3 uHead; uniform mat4 uModel; uniform vec2 uProj; uniform vec3 uEye;
out vec3 vNor; out vec3 vCol; out vec2 vUv; out vec3 vPos;
void main(){
  vec4 wp = uModel * vec4(aPos, 1.); vPos = wp.xyz; vNor = mat3(uModel) * aNor; vCol = aCol; vUv = aUv;
  vec3 v = transpose(uHead) * (wp.xyz - uEye);
  float n = 0.03, f = 20.;
  gl_Position = vec4(v.x / uProj.x, v.y / uProj.y, v.z * (f + n) / (f - n) - 2. * f * n / (f - n), v.z);
}`;
const FS = `#version 300 es
precision highp float;
in vec3 vNor; in vec3 vCol; in vec2 vUv; in vec3 vPos; out vec4 o;
uniform int uMode; uniform sampler2D uTex; uniform vec3 uSun; uniform float uAmb, uSunI, uFlash, uScreen;
void main(){
  vec3 n = normalize(vNor), vd = normalize(-vPos);
  if (dot(n, vd) < 0.) n = -n;
  if (uMode == 0) {                       // painted / fabric surfaces
    float d = max(dot(n, uSun), 0.);
    float sky = 0.55 + 0.45 * n.y;        // light from the windshield above and ahead
    vec3 c = vCol * (uAmb * sky + uSunI * d + uFlash * 0.9 * sky);
    vec3 h = normalize(uSun + vd);
    c += pow(max(dot(n, h), 0.), 28.) * uSunI * 0.12;
    o = vec4(pow(c, vec3(1. / 1.1)), 1.);
  } else if (uMode == 1) {                // emissive display behind glass
    vec3 t = texture(uTex, vUv).rgb * uScreen;
    float fr = pow(1. - max(dot(n, vd), 0.), 4.);
    vec3 glare = vec3(0.55, 0.6, 0.66) * (0.06 + 0.5 * fr) * (uAmb * 0.6 + uSunI * 0.4);
    o = vec4(t + glare, 1.);
  } else if (uMode == 2) {                // windshield glass: rain, ice, lightning (alpha)
    o = texture(uTex, vUv);
  } else {                                // window opening: let the world through
    o = vec4(0.);
  }
}`;

const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; } };

// Mesh builder: interleaved pos(3) nor(3) col(3) uv(2)
class MB {
  constructor() { this.v = []; }
  tri(a, b, c, col, n, uv) {
    const t = uv || [[0, 0], [0, 0], [0, 0]];
    [[a, t[0]], [b, t[1]], [c, t[2]]].forEach(([p, q]) => this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2], q[0], q[1]));
  }
  // a b c d around the face; normal faces 'toward' (default: the eye at the origin)
  quad(a, b, c, d, col, uv, toward) {
    let n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(d, a)));
    const ctr = v3.mul(v3.add(v3.add(a, b), v3.add(c, d)), 0.25);
    const dir = toward || v3.mul(ctr, -1);
    if (v3.dot(n, dir) < 0) n = v3.mul(n, -1);
    this.tri(a, b, c, col, n, uv && [uv[0], uv[1], uv[2]]); this.tri(a, c, d, col, n, uv && [uv[0], uv[2], uv[3]]);
  }
  // Box from a centre, three half-axis vectors (any orientation)
  box(c, ax, ay, az, col) {
    const P = (i, j, k) => v3.add(c, v3.add(v3.mul(ax, i), v3.add(v3.mul(ay, j), v3.mul(az, k))));
    const faces = [[[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1], ax], [[-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1], v3.mul(ax, -1)],
      [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1], ay], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], v3.mul(ay, -1)],
      [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], az], [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], v3.mul(az, -1)]];
    for (const [a, b, d, e, out] of faces) this.quad(P(...a), P(...b), P(...d), P(...e), col, null, out);
  }
  // Bar between two points, w wide (along 'side'), t thick
  bar(p0, p1, side, w, t, col) {
    const ax = v3.mul(v3.sub(p1, p0), 0.5), c = v3.add(p0, ax);
    const ay = v3.mul(v3.norm(side), w / 2), az = v3.mul(v3.norm(v3.cross(ax, ay)), t / 2);
    this.box(c, ax, ay, az, col);
  }
  cyl(c, axis, r, len, col, seg = 14) {
    const a = v3.norm(axis), u = v3.norm(v3.cross(a, Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), w = v3.cross(a, u);
    const top = v3.add(c, v3.mul(a, len)), ring = (base, i) => { const t = i / seg * 2 * Math.PI; return v3.add(base, v3.add(v3.mul(u, r * Math.cos(t)), v3.mul(w, r * Math.sin(t)))); };
    for (let i = 0; i < seg; i++) {
      const p0 = ring(c, i), p1 = ring(c, i + 1), q0 = ring(top, i), q1 = ring(top, i + 1);
      const mid = v3.sub(v3.mul(v3.add(p0, p1), 0.5), c);
      this.quad(p0, p1, q1, q0, col, null, mid);
      this.tri(top, q0, q1, col, a);
    }
  }
}

// Panel surface: P(x, s) with s = 0 at the top edge (under the glareshield), 1 at the bottom
const PY0 = -0.16, PY1 = -0.6, PZ0 = 0.72, PZ1 = 0.63;
const P = (x, s) => [x, lerp(PY0, PY1, s), lerp(PZ0, PZ1, s)];
const PN = v3.norm([0, PZ0 - PZ1, PY1 - PY0]);   // panel normal, toward the pilot
const WSB_Y = -0.075, WSB_Z = 0.96, WST_Y = 0.36, WST_Z = 0.55;   // windshield bottom / top edges

const C = { panel: [0.165, 0.17, 0.18], bezel: [0.095, 0.1, 0.105], knob: [0.04, 0.04, 0.045], glare: [0.035, 0.035, 0.04],
  lip: [0.11, 0.115, 0.12], shell: [0.5, 0.47, 0.42], pedal: [0.1, 0.1, 0.11], post: [0.8, 0.78, 0.72], liner: [0.74, 0.7, 0.62], wall: [0.62, 0.58, 0.5], ped: [0.6, 0.61, 0.62],
  yoke: [0.16, 0.16, 0.17], grip: [0.085, 0.085, 0.09], lever: [0.55, 0.56, 0.58], leverKnob: [0.92, 0.92, 0.9], floor: [0.24, 0.23, 0.22],
  fire: [0.5, 0.07, 0.05], seat: [0.68, 0.62, 0.52], cb: [0.12, 0.12, 0.13], cbCap: [0.05, 0.05, 0.05], cbRed: [0.5, 0.08, 0.06], compass: [0.06, 0.06, 0.07] };

export class Cockpit {
  // Own full-resolution, antialiased, transparent canvas layered between the world and the 2D overlay
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no WebGL2');
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const p = this.prog = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.u = {}; for (const n of ['uHead', 'uModel', 'uProj', 'uEye', 'uMode', 'uTex', 'uSun', 'uAmb', 'uSunI', 'uFlash', 'uScreen']) this.u[n] = gl.getUniformLocation(p, n);
    // instruments: offscreen canvases drawn by the existing HUD code
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const hud = new HUD(c); hud.W = w; hud.H = h; return { c, hud, tex: null, frame: 0 }; };
    this.inst = { pfd: mk(1024, 840), mfd: mk(1024, 840), eng: mk(330, 1000), glare: mk(2048, 220), cdu: mk(420, 520), sw: mk(520, 560), efb: mk(560, 760), glass: mk(1024, 512) };
    this.surfaces = [];
    this.build();
    this.frame = 0;
  }
  vao(data) {
    const gl = this.gl, va = gl.createVertexArray(); gl.bindVertexArray(va);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const st = 11 * 4, loc = (n) => gl.getAttribLocation(this.prog, n);
    [['aPos', 3, 0], ['aNor', 3, 12], ['aCol', 3, 24], ['aUv', 2, 36]].forEach(([n, k, off]) => { const l = loc(n); if (l < 0) return; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, k, gl.FLOAT, false, st, off); });
    return { va, n: data.length / 11 };
  }
  // A screen on the panel: rectangle in panel coordinates (x0..x1, s0..s1), raised d toward the pilot
  screen(key, x0, x1, s0, s1, d = 0.012) {
    const o = v3.mul(PN, d), tl = v3.add(P(x0, s0), o), tr = v3.add(P(x1, s0), o), br = v3.add(P(x1, s1), o), bl = v3.add(P(x0, s1), o);
    this.quadSurface(key, tl, tr, br, bl);
    // bezel: a dark frame slightly larger, set just behind the glass, with two knobs at the bottom
    const m = 0.014, ob = v3.mul(PN, d * 0.5);
    this.mb.quad(v3.add(P(x0 - m, s0 - m * 2.1), ob), v3.add(P(x1 + m, s0 - m * 2.1), ob), v3.add(P(x1 + m, s1 + m * 2.6), ob), v3.add(P(x0 - m, s1 + m * 2.6), ob), C.bezel);
    for (const fx of [0.12, 0.88]) this.mb.cyl(v3.add(P(lerp(x0, x1, fx), s1 + m * 1.5), ob), PN, 0.009, 0.012, C.knob);
  }
  quadSurface(key, tl, tr, br, bl, mode = 1) {
    const mb = new MB(); mb.quad(tl, tr, br, bl, [1, 1, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.surfaces.push({ key, mode, geo: this.vao(mb.v), tl, tr, br, bl });
  }
  build() {
    const mb = this.mb = new MB();
    // main instrument panel across both seats (pilot at x = 0, aircraft centreline at x = +0.38)
    mb.quad(P(-0.6, 0), P(1.36, 0), P(1.36, 1), P(-0.6, 1), C.panel);
    // glareshield hood: underside, sloped annunciator face, top, turned-down ends, ENG FIRE PULL lights
    const fB = [-0.18, 0.585], fT = [-0.065, 0.645];                 // face bottom / top edge (y, z)
    mb.quad([-0.62, fB[0], fB[1]], [1.38, fB[0], fB[1]], [1.38, PY0, PZ0], [-0.62, PY0, PZ0], C.glare);
    mb.quad([-0.62, fB[0], fB[1]], [1.38, fB[0], fB[1]], [1.38, fT[0], fT[1]], [-0.62, fT[0], fT[1]], C.lip);
    mb.quad([-0.62, fT[0], fT[1]], [1.38, fT[0], fT[1]], [1.38, WSB_Y, WSB_Z], [-0.62, WSB_Y, WSB_Z], C.glare);
    for (const [x0, x1] of [[-0.62, -0.7], [1.38, 1.46]]) {
      mb.quad([x0, fT[0], fT[1]], [x1, fT[0] - 0.09, fT[1] + 0.04], [x1, -0.25, PZ0], [x0, fB[0], fB[1]], C.glare);
      mb.quad([x0, fT[0], fT[1]], [x1, fT[0] - 0.09, fT[1] + 0.04], [x1, WSB_Y - 0.09, WSB_Z], [x0, WSB_Y, WSB_Z], C.glare);
    }
    const onFace = (x, f, d = 0.004) => [x, lerp(fB[0], fT[0], f), lerp(fB[1], fT[1], f) - d];
    this.quadSurface('glare', onFace(-0.36, 0.86), onFace(1.12, 0.86), onFace(1.12, 0.14), onFace(-0.36, 0.14));
    for (const x of [-0.44, 1.2]) mb.box(onFace(x, 0.5, 0.008), [0.04, 0, 0], [0, 0.02, 0.011], [0, -0.003, 0.006], C.fire);
    // screens: switch panel | PFD | MFD | engine stack | copilot MFD | copilot PFD
    this.screen('sw', -0.47, -0.2, 0.12, 0.66, 0.006);
    this.screen('pfd', -0.17, 0.07, 0.14, 0.58);
    this.screen('mfd', 0.09, 0.33, 0.14, 0.58);
    this.screen('eng', 0.355, 0.455, 0.05, 0.8, 0.006);
    this.screen('mfd', 0.48, 0.72, 0.14, 0.58);
    this.screen('pfd', 0.74, 0.98, 0.14, 0.58);
    // EFB tablet clamped at the left of the panel, angled toward the pilot
    const e0 = [-0.62, -0.18, 0.5], e1 = [-0.5, -0.18, 0.64], e2 = [-0.5, -0.41, 0.6], e3 = [-0.62, -0.41, 0.46];
    mb.quad(v3.add(e0, [-0.01, 0.012, 0.01]), v3.add(e1, [0.01, 0.012, 0.01]), v3.add(e2, [0.01, -0.012, 0.01]), v3.add(e3, [-0.01, -0.012, 0.01]), [0.06, 0.06, 0.065]);
    this.quadSurface('efb', e0, e1, e2, e3);
    // windshield frame: centre post, side posts, top bow, sills
    const wsBot = (x) => [x, WSB_Y, WSB_Z], wsTop = (x) => [x, WST_Y, WST_Z];
    mb.bar(wsBot(0.38), wsTop(0.38), [1, 0, 0], 0.11, 0.05, C.post);
    mb.box([0.38, 0.25, 0.62], [0.045, 0, 0], [0, 0.045, 0], [0, 0, 0.03], C.post);             // compass housing on the post
    mb.cyl([0.38, 0.25, 0.588], [0, 0, -1], 0.03, 0.006, C.compass, 18);
    mb.bar(wsBot(-0.58), wsTop(-0.5), [1, 0, 0.35], 0.1, 0.06, C.post);
    mb.bar(wsBot(1.34), wsTop(1.26), [1, 0, -0.35], 0.1, 0.06, C.post);
    mb.bar(wsTop(-0.55), wsTop(1.31), [0, 0.3, 1], 0.09, 0.05, C.post);
    // headliner and side walls with the side-window sills
    mb.quad([-0.7, 0.4, 0.58], [1.46, 0.4, 0.58], [1.46, 0.45, -0.5], [-0.7, 0.45, -0.5], C.liner);
    mb.quad([-0.66, -0.12, 0.62], [-0.66, -0.12, -0.5], [-0.66, -1.0, -0.5], [-0.66, -1.0, 0.62], C.wall, null, [1, 0, 0]);
    mb.quad([1.42, -0.12, 0.62], [1.42, -0.12, -0.5], [1.42, -1.0, -0.5], [1.42, -1.0, 0.62], C.wall, null, [-1, 0, 0]);
    mb.bar([-0.64, -0.12, 0.62], [-0.64, -0.12, -0.45], [0, 1, 0], 0.05, 0.08, C.post);
    mb.bar([-0.62, 0.36, 0.58], [-0.62, 0.36, -0.45], [0, 1, 0], 0.06, 0.08, C.post);
    mb.bar([-0.65, -0.12, -0.2], [-0.63, 0.36, -0.2], [0, 0, 1], 0.06, 0.06, C.post);
    // lower panel, knee panel and floor
    mb.quad(P(-0.6, 1), P(1.36, 1), [1.36, -0.82, 0.55], [-0.6, -0.82, 0.55], C.panel);
    mb.quad([-0.66, -0.98, 0.7], [1.42, -0.98, 0.7], [1.42, -1.0, -0.4], [-0.66, -1.0, -0.4], C.floor, null, [0, 1, 0]);
    // centre pedestal with a sloped top
    mb.box([0.38, -0.8, 0.36], [0.085, 0, 0], [0, 0.2, 0], [0, 0, 0.3], C.ped);
    mb.quad([0.295, -0.6, 0.66], [0.465, -0.6, 0.66], [0.465, -0.6, 0.36], [0.295, -0.6, 0.36], C.ped, null, [0, 1, 0]);
    mb.quad([0.295, -0.6, 0.36], [0.465, -0.6, 0.36], [0.465, -0.66, 0.06], [0.295, -0.66, 0.06], [0.2, 0.2, 0.21], null, [0, 1, 0.2]);
    this.quadSurface('cdu', [0.305, -0.605, 0.33], [0.455, -0.605, 0.33], [0.455, -0.65, 0.12], [0.305, -0.65, 0.12]);
    // copilot seat (visible looking right) and the pilot's seat edge
    for (const [x0, w] of [[0.8, 0.27], [-0.02, 0.27]]) {
      mb.box([x0, -0.66, 0.05], [w / 2, 0, 0], [0, 0.06, 0], [0, 0, 0.24], C.seat);
      mb.box([x0, -0.3, -0.24], [w / 2, 0, 0], [0, 0.34, 0.06], [0, -0.02, 0.06], C.seat);
      for (const sx of [-1, 1]) mb.box([x0 + sx * (w / 2 + 0.03), -0.55, 0.0], [0.025, 0, 0], [0, 0.025, 0], [0, 0, 0.18], [0.2, 0.2, 0.2]);
    }
    // side consoles with circuit-breaker rows
    for (const [xs, nx] of [[1.39, -1], [-0.63, 1]]) {
      mb.quad([xs, -0.36, 0.5], [xs, -0.36, -0.3], [xs + nx * 0.04, -0.72, -0.3], [xs + nx * 0.04, -0.72, 0.5], C.cb, null, [nx, 0.3, 0]);
      for (let r = 0; r < 6; r++) for (let c = 0; c < 15; c++) {
        const f = (r + 0.5) / 6, y = lerp(-0.4, -0.68, f), x = xs + nx * (0.004 + 0.04 * f), z = lerp(0.44, -0.24, (c + 0.5) / 15);
        mb.cyl([x, y, z], [nx, 0.3, 0], 0.0065, 0.012, (r * 7 + c * 3) % 11 === 0 ? C.cbRed : C.cbCap, 8);
      }
    }
    this.staticGeo = this.vao(mb.v);
    // closed cabin shell around the pilot (so nothing shows through gaps) and the window openings cut into it
    const shell = new MB(); shell.box([0.38, -0.27, 0.25], [1.06, 0, 0], [0, 0.75, 0], [0, 0, 0.9], C.shell);
    this.shellGeo = this.vao(shell.v);
    const cut = new MB(), wb = (x) => [x, WSB_Y, WSB_Z], wt = (x) => [x, WST_Y, WST_Z];
    cut.quad(wt(-0.5), wt(1.26), wb(1.34), wb(-0.58), [0, 0, 0]);
    cut.quad([-0.655, -0.11, 0.57], [-0.655, 0.35, 0.57], [-0.655, 0.35, -0.42], [-0.655, -0.11, -0.42], [0, 0, 0], null, [1, 0, 0]);
    cut.quad([1.415, -0.11, 0.57], [1.415, 0.35, 0.57], [1.415, 0.35, -0.42], [1.415, -0.11, -0.42], [0, 0, 0], null, [-1, 0, 0]);
    this.cutGeo = this.vao(cut.v);
    const pd = new MB(); pd.box([0, 0, 0], [0.045, 0, 0], [0, 0.07, 0], [0, 0, 0.012], C.pedal);
    this.pedalGeo = this.vao(pd.v);
    // animated parts, built around their pivots
    const yk = new MB();
    yk.bar([0, -0.02, 0.03], [0, -0.52, 0.2], [1, 0, 0], 0.035, 0.035, [0.05, 0.05, 0.055]);        // column to the floor
    yk.box([0, 0, 0.005], [0.055, 0, 0], [0, 0.045, 0], [0, 0, 0.025], C.yoke);                    // hub
    for (const sx of [-1, 1]) {                                                                   // ram horns
      yk.bar([sx * 0.05, -0.01, 0], [sx * 0.12, -0.035, 0.005], [0, 1, 0], 0.04, 0.03, C.yoke);
      yk.bar([sx * 0.12, -0.035, 0.005], [sx * 0.15, 0.06, 0], [1, 0, 0], 0.042, 0.036, C.grip);
      yk.bar([sx * 0.15, 0.06, 0], [sx * 0.13, 0.11, -0.005], [1, 0, 0], 0.036, 0.032, C.grip);
      yk.cyl([sx * 0.14, 0.1, -0.022], [0, 0, -1], 0.006, 0.006, [0.6, 0.08, 0.06], 8);           // AP disconnect / trim buttons
    }
    yk.box([0, 0.004, -0.022], [0.035, 0, 0], [0, 0.022, 0], [0, 0, 0.004], [0.35, 0.35, 0.37]);  // logo plate
    this.yokeGeo = this.vao(yk.v);
    const lv = new MB();
    lv.bar([0, 0, 0], [0, 0.13, 0], [1, 0, 0], 0.012, 0.012, C.lever);
    lv.box([0, 0.14, 0], [0.018, 0, 0], [0, 0.016, 0], [0, 0, 0.022], C.leverKnob);
    this.leverGeo = this.vao(lv.v);
    for (const k of Object.keys(this.inst)) this.inst[k].tex = this.mkTex();
  }
  mkTex() {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  // Redraw the instrument canvases with the HUD's own instrument code and upload them
  update(S) {
    const f = ++this.frame, I = this.inst, blink = Math.floor(performance.now() / 280) % 2 === 0;
    const draw = (k, every, fn, bg = '#050607') => {
      const it = I[k]; if (f % every !== 0 && it.frame) return;
      const ctx = it.hud.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, it.c.width, it.c.height); } else ctx.clearRect(0, 0, it.c.width, it.c.height);
      it.hud.hits = []; fn(it.hud); it.frame = f;
      const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, it.tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, it.c); gl.generateMipmap(gl.TEXTURE_2D);
    };
    draw('pfd', 1, (h) => h.pfd(S, blink, 470, 360, 600));
    draw('glare', 2, (h) => h.annunciators(S, blink, 0, 0, 2048, 220));
    draw('cdu', 10, (h) => this.cduPage(h, S));
    draw('mfd', 3, (h) => h.mfd(S, 0, 0, 1024, 840));
    draw('eng', 3, (h) => h.engines(S, 0, 0, 330, 1000));
    draw('sw', 4, (h) => h.switches(S, 0, 0, 520, 560));
    draw('efb', 4, (h) => h.efb(S, 0, 0, 560, 760));
    draw('glass', 2, (h) => { h.W = 1024; h.H = 512 / 0.56; h.windshield(S); }, null);
  }
  // FMS control display unit: a progress page from the sim state (our own layout)
  cduPage(h, S) {
    const ctx = h.ctx, o = S.out, ac = S.ac, T = (t, x, y, c = '#e8f0e8', sz = 26, al = 'left') => h.text(t, x, y, sz, c, al);
    ctx.fillStyle = '#20232a'; ctx.fillRect(0, 0, 420, 520); ctx.fillStyle = '#020403'; ctx.fillRect(18, 16, 384, 300);
    T('PROGRESS 1/2', 210, 36, '#e8f0e8', 22, 'center');
    T('FROM', 30, 74, '#7fd7ff', 18); T('KAUS', 30, 98); T('TO', 230, 74, '#7fd7ff', 18); T('MYEH', 230, 98);
    T('GS', 30, 136, '#7fd7ff', 18); T(`${Math.round((o.gs || 0) / 0.514444)} KT`, 30, 160);
    T('ALT', 230, 136, '#7fd7ff', 18); T(`FL${String(Math.round(o.h / 0.3048 / 100)).padStart(3, '0')}`, 230, 160);
    const fuelLb = (ac.fuel || 0) / 0.45359237, ffLb = (ac.ff || 0) / 0.45359237 * 3600;
    T('FUEL REM', 30, 198, '#7fd7ff', 18); T(`${Math.round(fuelLb / 10) * 10} LB`, 30, 222);
    T('FUEL FLOW', 230, 198, '#7fd7ff', 18); T(`${Math.round(ffLb / 10) * 10} PPH`, 230, 222);
    T('ENDURANCE', 30, 260, '#7fd7ff', 18); T(ffLb > 1 ? `${(fuelLb / ffLb).toFixed(1)} HR` : '--', 30, 284);
    T('SAT', 230, 260, '#7fd7ff', 18); T(`${Math.round(o.OAT)}°C`, 230, 284);
    ctx.fillStyle = '#3a3e46';
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) ctx.fillRect(22 + c * 64, 340 + r * 42, 54, 32);
  }
  // Head orientation in the cockpit frame (yaw right +, pitch up +): columns right, up, fwd
  static head(yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    return { right: [cy, 0, -sy], up: [-sp * sy, cp, -sp * cy], fwd: [cp * sy, sp, cp * cy] };
  }
  hide() { if (this.shown) { const gl = this.gl; gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); this.shown = false; } }
  render(S, head, eye, fov, aspect) {
    const gl = this.gl, u = this.u, dpr = Math.min(window.devicePixelRatio || 1, 2), cw = Math.floor(innerWidth * dpr), ch = Math.floor(innerHeight * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    gl.viewport(0, 0, cw, ch); this.shown = true;
    gl.useProgram(this.prog); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.disable(gl.BLEND);
    gl.uniformMatrix3fv(u.uHead, false, [...head.right, ...head.up, ...head.fwd]);
    const tf = Math.tan(fov / 2); gl.uniform2f(u.uProj, tf * aspect, tf); gl.uniform3fv(u.uEye, eye);
    // sun in the cockpit frame; ambient from the outside light (darker in the storm)
    const sw = S.sunWorld, b = S.acBasis, sun = v3.norm([v3.dot(sw, b.right), v3.dot(sw, b.up), v3.dot(sw, b.fwd)]);
    const dim = 1 - 0.55 * clamp(S.inCloud, 0, 1) - 0.25 * clamp(S.core, 0, 1);
    gl.uniform3fv(u.uSun, sun); gl.uniform1f(u.uAmb, 0.95 * dim + 0.22); gl.uniform1f(u.uSunI, sun[2] > -0.2 ? 0.55 * dim * clamp(1 - S.inCloud, 0, 1) : 0.05);
    gl.uniform1f(u.uFlash, S.flash || 0); gl.uniform1f(u.uScreen, 1.0);
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const drawGeo = (g, mode, model = I) => { gl.uniform1i(u.uMode, mode); gl.uniformMatrix4fv(u.uModel, false, model); gl.bindVertexArray(g.va); gl.drawArrays(gl.TRIANGLES, 0, g.n); };
    drawGeo(this.shellGeo, 0);
    drawGeo(this.cutGeo, 3);
    drawGeo(this.staticGeo, 0);
    // rudder pedals: push forward with rudder, both seats
    for (const [x0, sgn] of [[-0.13, -1], [0.09, 1], [0.67, -1], [0.89, 1]]) {
      const dz = sgn * clamp(S.ctl.rud, -1, 1) * 0.05;
      drawGeo(this.pedalGeo, 0, [1, 0, 0, 0, 0, 0.82, -0.57, 0, 0, 0.57, 0.82, 0, x0, -0.9, 0.62 + dz, 1]);
    }
    // yokes: travel fore/aft with elevator, rotate with aileron
    const ctl = S.ctl;
    for (const x0 of [-0.02, 0.78]) {
      const z = 0.42 - clamp(ctl.elev, -1, 1) * 0.06, a = -clamp(ctl.ail, -1, 1) * 40 * DEG, c = Math.cos(a), s = Math.sin(a);
      drawGeo(this.yokeGeo, 0, [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, x0, -0.47, z, 1]);
    }
    // thrust levers: pivot on the pedestal, forward with thrust
    for (const x0 of [0.355, 0.405]) {
      const a = lerp(-28, 26, clamp(ctl.thr, 0, 1)) * DEG, c = Math.cos(a), s = Math.sin(a);
      drawGeo(this.leverGeo, 0, [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, x0, -0.63, 0.42, 1]);
    }
    // screens (emissive, sampled from the instrument canvases)
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(u.uTex, 0);
    for (const sf of this.surfaces) { gl.bindTexture(gl.TEXTURE_2D, this.inst[sf.key].tex); drawGeo(sf.geo, 1); }
    // windshield glass with rain / ice / lightning, alpha-blended over the world
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    if (!this.glassGeo) {
      const mb = new MB(), wb = (x) => [x, WSB_Y, WSB_Z], wt = (x) => [x, WST_Y, WST_Z];
      mb.quad(wt(-0.5), wt(0.38), wb(0.38), wb(-0.58), [1, 1, 1], [[0, 0], [0.5, 0], [0.5, 1], [0, 1]]);
      mb.quad(wt(0.38), wt(1.26), wb(1.34), wb(0.38), [1, 1, 1], [[0.5, 0], [1, 0], [1, 1], [0.5, 1]]);
      this.glassGeo = this.vao(mb.v);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.inst.glass.tex); drawGeo(this.glassGeo, 2);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.bindVertexArray(null);
  }
  // Click: ray from the eye through the pixel, onto the screens; returns { key, hit } for a HUD hit-test
  pick(nx, ny, head, fov, aspect) {
    const tf = Math.tan(fov / 2), d0 = [nx * tf * aspect, ny * tf, 1];
    const d = v3.norm(v3.add(v3.add(v3.mul(head.right, d0[0]), v3.mul(head.up, d0[1])), v3.mul(head.fwd, d0[2])));
    let best = null;
    for (const sf of this.surfaces) {
      const ex = v3.sub(sf.tr, sf.tl), ey = v3.sub(sf.bl, sf.tl), n = v3.cross(ex, ey), den = v3.dot(n, d);
      if (Math.abs(den) < 1e-9) continue;
      const t = v3.dot(n, sf.tl) / den; if (t <= 0 || (best && t >= best.t)) continue;
      const p = v3.sub(v3.mul(d, t), sf.tl);
      const uu = v3.dot(p, ex) / v3.dot(ex, ex), vv = v3.dot(p, ey) / v3.dot(ey, ey);
      if (uu < 0 || uu > 1 || vv < 0 || vv > 1) continue;
      const it = this.inst[sf.key];
      best = { t, key: sf.key, hit: it.hud.hit(uu * it.c.width, vv * it.c.height) };
    }
    return best;
  }
}
