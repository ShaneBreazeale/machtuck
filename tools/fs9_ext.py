"""Convert the exterior model of an FS2004 (MDL8 / BGL bytecode) aircraft into web assets, alongside tools/fs9_vc.py.

    python3 tools/fs9_ext.py <model.mdl> <texture dir> data/ext

Writes data/ext/ext.json (node tree, batches, materials, texture notes), data/ext/ext.bin (float32 pos/nor/uv
vertices, then uint16 indices, or uint32 when "index32" is set) and one WebP per texture. Built for the Premier
Aircraft Design Learjet 60 (lear60_ver25.mdl); the bytecode reader, keyframe tracks and texture decoder are fs9_vc's.

Exterior specifics (verified on the Learjet model):
  - Top-level dispatch IFMSK 0x39 on the view-mode variable 0x68: mask 0x8002 is the exterior (its shadow pass, mask
    0x1000 branch, reuses the same geometry), 0x0001 the virtual cockpit, 0x0010 only landing-light halos (0xB2).
  - The model has a single exterior level of detail: there are no size or distance tests (0x5F etc.) in the tree.
  - Conditional geometry is resolved here (fs9_vc falls through every test):
      0x39 IFMSK  (i16 jump, u16 var, u16 mask)       skip unless var & mask
      0x24 IFIN1  (i16 jump, u16 var, i16 lo, i16 hi) skip unless lo <= var <= hi
      0xB3 IFINF  (i16 jump, u16 ?, u16 var, f32 lo, f32 hi)
    with the state below: lights off but their lenses kept as tagged batches, engines and wheels stopped, gear up.
  - 0x46 POINT_VICALL (i16 call, i16 x y z, then pitch, pitch var, bank, bank var, heading, heading var; all u16)
    calls geometry rotated by a sim variable in the current frame (the hinge frame set by the preceding 0xAF).
    Control surfaces use it (ailerons, elevator, rudder); those get a synthesised rotation track so the renderer
    drives them like the 0xAD keyframe nodes. Wheel spin, fan spin and nose-wheel steering are baked at rest.
  - 0xB2 is a light/halo effect with no geometry; 0xAC (z-bias) is ignored.
"""
import json, math, os, struct, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fs9_vc import U, u16, i16, i32, oplen, rel, bgl_start, read_track, decode_bmp, VC

# -- conditional geometry ------------------------------------------------------------------------
LIGHTS = 0x250                                   # light-state bits (FS LIGHT_*: 1 nav, 2 beacon, 4 landing, 8 taxi)
LIGHT_TAG = {0x1: 'nav', 0x2: 'beacon'}           # self-lit lenses: kept, tagged, so a renderer can switch them
OPTIONS = 0x90                                   # model option bits: 0x4 tail beacon housing + tail lights, 0x80 crew;
OPTION_TAKE = {0x4: None, 0x80: 'crew'}          # 0x800 (skipped) an alternative nose piece lying in the radome skin
STATE = {0xF6: 0, 0xFA: 0,                       # engine 1/2 fan speed: 0..4096 stopped blades, 4097..8192 blur disc
         0x194: 0,                               # nose-wheel speed (0..8192 always shown)
         0x98: 0.0}                              # anim var 152 (left main gear) for the gear-leg landing/taxi lenses

def condition(d, o, op):
    """'take' (fall through), 'skip' (jump) or a tag name (take, and tag the geometry)."""
    if op == 0x39:
        var, mask = u16(d, o + 4), u16(d, o + 6)
        if var == LIGHTS: return LIGHT_TAG.get(mask, 'skip')
        if var == OPTIONS:
            if mask not in OPTION_TAKE: return 'skip'
            return OPTION_TAKE[mask] or 'take'
        raise ValueError('IFMSK on unknown var %#x at %#x' % (var, o))
    if op == 0x24:
        var, lo, hi = u16(d, o + 4), i16(d, o + 6), i16(d, o + 8)
        if var not in STATE: raise ValueError('IFIN1 on unknown var %#x at %#x' % (var, o))
        return 'take' if lo <= STATE[var] <= hi else 'skip'
    if op == 0xB3:
        var, (lo, hi) = u16(d, o + 6), struct.unpack_from('<2f', d, o + 8)
        if var not in STATE: raise ValueError('IFINF on unknown var %#x at %#x' % (var, o))
        return 'take' if lo <= STATE[var] <= hi else 'skip'
    return 'take'

# -- control surfaces on 0x46 POINT_VICALL -------------------------------------------------------
# sim var -> (what, local hinge axis, rotation in degrees at t = 0, 50, 100). Rotations are right-handed about the
# hinge axis of the frame the call sits in; t is laid out like the VC yoke and pedals (t = 50 + 50 * control).
# Each surface lies aft of its hinge (local -z), so +x rotation lifts the trailing edge, -y swings it right.
#   ailerons  t = 50 + 50 * ail  (ail > 0 roll right: left trailing edge down, right up), 18 deg each way
#   elevator  t = 50 + 50 * elev (elev > 0 pull: trailing edge up 17 deg, push: down 15.5 deg)
#   rudder    t = 50 + 50 * rud  (rud > 0 yaw right: trailing edge right), 30 deg each way
SURFACES = {110: ('left aileron', 0, (18.0, 0.0, -18.0)), 112: ('right aileron', 0, (-18.0, 0.0, 18.0)),
            118: ('elevator', 0, (-15.5, 0.0, 17.0)), 120: ('rudder', 1, (30.0, 0.0, -30.0))}

def surface_keys(axis, degs):
    """Keys in the format of the model's own rotation tracks: the renderer's quatM applies the conjugate of the
    stored quaternion to row vectors, so store the inverse of the wanted rotation."""
    keys = []
    for t, a in zip((0.0, 50.0, 100.0), degs):
        q = [0.0, 0.0, 0.0, math.cos(math.radians(a) / 2)]; q[axis] = -math.sin(math.radians(a) / 2)
        keys.append([t] + q)
    return keys

# what the model's 0xAD keyframe variables drive (identified from geometry position and key ranges)
VARS = {
    152: 'left main gear: leg, wheel, doors. t 0 retracted, 100 down and locked, 100..200 oleo compression',
    156: 'right main gear (as 152)', 160: 'nose gear and its doors (as 152)',
    164: 'right spoiler panel: t 0 stowed, 100 fully up (~50 deg)', 168: 'left spoiler panel (as 164)',
    172: 'right thrust reverser buckets: stowed for t 0..100, deploy over t 100..200',
    176: 'left thrust reverser buckets (as 172)',
    440: 'left flap: t 0 up, 40 = 8 deg, 70 = 20 deg, 100 = 40 deg', 444: 'right flap (as 440)',
    318: 'main cabin airstair door (forward left): t 0 closed, opens over t 0..100',
    338: 'cockpit-to-cabin door (inside, seen through the windows): t 0 closed',
}

class EXT(VC):
    def __init__(self, d):
        super().__init__(d); self.draws = []

    def run(self, o, node, varbase=None, tag=None):
        d, stack, mat, tex, until = self.d, [node], 0, -1, None
        while True:
            if o == until: tag, until = outer, None   # execution reached the test's skip target: tagged block over
            op, n = u16(d, o), oplen(d, o)
            if op in (0x00, 0x22, 0xBD): return
            if op in (0x0D, 0x88): o = rel(d, o, op == 0x88); continue
            if op in (0x39, 0x24, 0xB3):
                c = condition(d, o, op)
                if c == 'skip': o = rel(d, o); continue
                if c != 'take' and until is None: outer, tag, until = tag, c, rel(d, o)
            elif op == 0xB5:
                c = u16(d, o + 2); self.V = np.frombuffer(d, '<f4', c * 8, o + 8).reshape(c, 8).astype(np.float64)
            elif op == 0xB6: self.mat = [struct.unpack_from('<17f', d, o + 8 + i * 68) for i in range(u16(d, o + 2))]
            elif op == 0xB7:
                self.tex = [d[o + 24 + i * 80:o + 88 + i * 80].split(b'\0')[0].decode() for i in range(u16(d, o + 2))]
            elif op == 0xAF:
                t = [x * U for x in struct.unpack_from('<3f', d, o + 2)]
                self.nodes.append({'p': stack[-1], 'r': list(struct.unpack_from('<9f', d, o + 14)), 't': t}); stack.append(len(self.nodes) - 1)
            elif op == 0xAD:
                typ, keys = read_track(d, varbase)
                self.nodes.append({'p': stack[-1], 'var': i32(d, o + 6), 'type': typ, 'keys': keys}); stack.append(len(self.nodes) - 1)
            elif op == 0xAE: stack.pop()
            elif op == 0x89: v = i32(d, o + 2); varbase = None if v == -1 else o + v
            elif op == 0xB8: mat, tex = u16(d, o + 2), i16(d, o + 4)
            elif op == 0xB9:
                vs, ic = u16(d, o + 2), u16(d, o + 6)
                self.draws.append((stack[-1], mat, tex, vs, np.array(struct.unpack_from('<%dH' % ic, d, o + 8)), tag))
            elif op in (0x8A, 0x23): self.run(rel(d, o, op == 0x8A), stack[-1], varbase, tag)
            elif op == 0x46:
                if any(i16(d, o + k) for k in (4, 6, 8)): raise ValueError('VICALL with an offset at %#x' % o)
                vars_ = [u16(d, o + k) for k in (12, 16, 20)]
                sv = [v for v in vars_ if v in SURFACES]
                parent = stack[-1]
                if sv:
                    what, axis, degs = SURFACES[sv[0]]
                    self.nodes.append({'p': parent, 'var': sv[0], 'type': 3, 'keys': surface_keys(axis, degs), 'surface': what})
                    parent = len(self.nodes) - 1
                self.run(rel(d, o), parent, varbase, tag)
            o += n

    def export(self, out, texdir):
        os.makedirs(out, exist_ok=True)
        keep, remap = [], {}
        def frame_of(i):
            M = np.eye(4)
            while i >= 0 and 'var' not in self.nodes[i]: M = M @ self.local(i); i = self.nodes[i]['p']
            return M, i
        def keep_node(i):
            if i < 0: return -1
            if i in remap: return remap[i]
            M, a = frame_of(self.nodes[i]['p'])
            n = self.nodes[i]; e = {'p': keep_node(a), 'var': n['var'], 'type': n['type'], 'keys': n['keys']}
            if not np.allclose(M, np.eye(4)): e['m'] = [float(x) for x in np.r_[M[:3, :3].ravel(), M[3, :3]]]
            if 'surface' in n: e['vicall'] = True
            keep.append(e); remap[i] = len(keep) - 1; return remap[i]
        groups = {}
        for node, mat, tex, vs, ii, tag in self.draws:
            M, a = frame_of(node)
            used = np.unique(ii); local = np.searchsorted(used, ii)
            v = self.V[vs + used]
            p = np.c_[v[:, :3] * U, np.ones(len(v))] @ M
            nr = v[:, 3:6] @ M[:3, :3]; nr /= np.linalg.norm(nr, axis=1, keepdims=True) + 1e-12
            name = self.tex[tex].rsplit('.', 1)[0] if tex >= 0 else ''
            g = groups.setdefault((keep_node(a), mat, name, tag or ''), {'v': [], 'i': [], 'n': 0})
            g['v'].append(np.c_[p[:, :3], nr, v[:, 6:8]]); g['i'].append(local + g['n']); g['n'] += len(v)
        texs = sorted({k[2] for k in groups if k[2]})
        written, notes = [], {}
        for t in texs:
            src = os.path.join(texdir, t + '.bmp')
            if not os.path.exists(src): print('missing texture', t); continue
            im = decode_bmp(src); im.save(os.path.join(out, t + '.webp'), quality=88, method=6); written.append(t)
            notes[t] = alpha_note(np.asarray(im)[:, :, 3])
        verts, idx, batches, base, first = [], [], [], 0, 0
        # opaque first, then self-lit lenses, then glass (diffuse alpha < 1)
        order = lambda kv: (self.mat[kv[0][1]][3] < 0.99, kv[0][3] != '', kv[0][0], kv[0][2], kv[0][1])
        for (node, mat, name, tag), g in sorted(groups.items(), key=order):
            vv = np.concatenate(g['v']); ii = np.concatenate(g['i']) + base
            verts.append(vv); idx.append(ii)
            m = self.mat[mat]
            b = {'node': node, 'tex': name if name in written else '', 'diffuse': [round(x, 4) for x in m[0:4]],
                 'specular': round(m[8], 3), 'power': m[16], 'emissive': round(m[12], 3), 'first': first, 'count': len(ii)}
            if m[3] < 0.99: b['glass'] = True
            if tag: b['tag'] = tag
            batches.append(b); base += len(vv); first += len(ii)
        V = np.concatenate(verts).astype('<f4'); I = np.concatenate(idx)
        wide = base >= 65536
        with open(os.path.join(out, 'ext.bin'), 'wb') as f: f.write(V.tobytes()); f.write(I.astype('<u4' if wide else '<u2').tobytes())
        lo, hi = rest_bbox(keep, batches, V, I)
        meta = {'units': 'm', 'frame': 'x right, y up, z forward; FS reference point at the origin',
                'vertices': int(base), 'indices': int(len(I)), 'index32': wide,
                'rest_pose': 'node tracks at t 0 except control surfaces (vicall nodes) at t 50: gear up, flaps up, '
                             'spoilers and reversers stowed, doors closed',
                'front_face': 'triangles are one-sided: index order (a, b, c) has cross(b - a, c - a) against the '
                              'outward normal (D3D clockwise); cull back faces or inner shells show through the skin',
                'glass': 'batches with "glass": diffuse alpha < 1 is the opacity; texture alpha is never opacity here',
                'bbox': {'min': [round(float(x), 3) for x in lo], 'max': [round(float(x), 3) for x in hi]},
                'vars': {str(k): v for k, v in sorted({**VARS, **{k: s[0] + ': t 50 neutral, see README' for k, s in SURFACES.items()}}.items())},
                'nodes': keep, 'batches': batches, 'textures': written, 'texture_alpha': notes}
        json.dump(meta, open(os.path.join(out, 'ext.json'), 'w'), separators=(',', ':'))
        print('vertices', base, 'triangles', len(I) // 3, 'batches', len(batches), 'anim nodes', len(keep), 'textures', written)
        return meta

def rest_bbox(nodes, batches, V, I):
    """Bounds of the rest pose (key 0, or the neutral t 50 key of control surfaces), posed as js/cockpit.js does."""
    W = []
    for n in nodes:
        k = n['keys'][1 if n.get('vicall') else 0]; M = np.eye(4)
        if n['type'] == 1: M[3, :3] = k[1:4]
        else:
            x, y, z, w = k[1:5]
            M[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
        if 'm' in n: S = np.eye(4); S[:3, :3] = np.reshape(n['m'][:9], (3, 3)); S[3, :3] = n['m'][9:]; M = M @ S
        W.append(M if n['p'] < 0 else M @ W[n['p']])
    P = []
    for b in batches:
        v = V[np.unique(I[b['first']:b['first'] + b['count']]), :3].astype(np.float64)
        P.append(v if b['node'] < 0 else (np.c_[v, np.ones(len(v))] @ W[b['node']])[:, :3])
    P = np.concatenate(P); return P.min(0), P.max(0)

def alpha_note(a):
    """FS DXT3 alpha on exterior textures is the reflection/specular mask (255 = no reflection), not opacity."""
    if a.min() == 255: return 'none'
    return 'mask (reflection/specular; not opacity), mean %.2f' % (a.mean() / 255)

def find_ext_entry(d, start):
    """Top-level dispatch: IFMSK on the view-mode variable 0x68; the branch with bit 0x0002 is the exterior."""
    o = start
    for _ in range(400):
        op = u16(d, o)
        if op == 0x39 and u16(d, o + 4) == 0x68 and u16(d, o + 6) & 0x0002 and not u16(d, o + 6) & 0x0001:
            o += 8
            while u16(d, o) not in (0x3B, 0x8A, 0x88): o += oplen(d, o)
            t = rel(d, o, u16(d, o) != 0x3B)
            while u16(d, t) == 0x88: t = rel(d, t, True)
            return t
        o += oplen(d, o)
    raise ValueError('exterior entry not found')

if __name__ == '__main__':
    mdl, texdir, out = sys.argv[1:4]
    d = open(mdl, 'rb').read()
    assert d[8:12] == b'MDL8', 'expects an FS2004 MDL8 model'
    m = EXT(d); m.run(find_ext_entry(d, bgl_start(d)), 0)
    meta = m.export(out, texdir)
    print('bbox', meta['bbox'])
