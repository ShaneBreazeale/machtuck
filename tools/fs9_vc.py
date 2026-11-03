"""Convert the virtual cockpit of an FS2004 (MDL8 / BGL bytecode) aircraft model into web assets.

    python3 tools/fs9_vc.py <model.mdl> <texture dir> data/vc

Writes data/vc/vc.json (node tree, batches, materials), data/vc/vc.bin (float32 pos/nor/uv vertices +
uint16 indices) and one WebP per texture. Built for the Premier Aircraft Design Learjet 60 (lear60_ver25.mdl).

The MDL8 'BGL ' chunk is FS2004 scenery bytecode: 16-bit opcodes, all branch offsets relative to the opcode.
What this decoder relies on (verified on the Learjet model):
  B5 vertex list (u16 n, u32, n x [pos3 nor3 uv2] f32)    B6 material list (17 f32: diffuse, ambient, specular, emissive, power)
  B7 texture list (80 B: class, colour, ?, size, name[64]) B8 set material (u16 material, i16 texture)
  B9 draw tri list (u16 vbase, u16 vcount, u16 icount, idx) AF transform (t xyz, 3x3 rows; row vectors v*R + t)  AE pop
  AD animate (i32 -1, i32 sim var, i32, 4 f32): keyframe track at the current var base, pushes a transform
  89 var base (i32 offset; -1 resets)   8A call32   88 jump32   0D jump   22 return   39/B3 visibility tests
Animation track at the var base: u16 type (1 translation, 3 rotation quaternion xyzw), 0x44 bytes, u16 n keys,
keys (t, value...) with t on 0..100 driven by the sim variable.
Units are 1/512 m; frame x right, y up, z forward (FS reference point at the origin).
"""
import json, os, struct, sys
import numpy as np
from PIL import Image

U = 1 / 512.0
u16 = lambda d, o: struct.unpack_from('<H', d, o)[0]
i16 = lambda d, o: struct.unpack_from('<h', d, o)[0]
i32 = lambda d, o: struct.unpack_from('<i', d, o)[0]

FIXED = {0x00: 2, 0x02: 2, 0x22: 2, 0xAE: 2, 0xBD: 2, 0x0D: 4, 0x23: 4, 0x8E: 4, 0x40: 4, 0xAC: 4,
         0x88: 6, 0x8A: 6, 0x89: 6, 0x3B: 6, 0x41: 6, 0xB8: 6, 0xBC: 6, 0x39: 8, 0x5F: 8, 0x24: 10, 0x34: 10,
         0x3A: 12, 0xB3: 16, 0x46: 22, 0xAD: 30, 0xB2: 44, 0xAF: 50}

def oplen(d, o):
    op = u16(d, o)
    if op in FIXED: return FIXED[op]
    if op == 0xB5: return 8 + u16(d, o + 2) * 32
    if op == 0xB6: return 8 + u16(d, o + 2) * 68
    if op == 0xB7: return 8 + u16(d, o + 2) * 80
    if op == 0xB9: return 8 + u16(d, o + 6) * 2
    raise ValueError('unknown BGL opcode %#x at %#x' % (op, o))

def rel(d, o, wide=False): return o + (i32(d, o + 2) if wide else i16(d, o + 2))

def bgl_start(d):
    o = 12
    while o < len(d):
        tag, n = d[o:o + 4], struct.unpack_from('<I', d, o + 4)[0]
        if tag == b'BGL ': return o + 8
        o += 8 + n
    raise ValueError('no BGL chunk')

def find_vc_entry(d, start):
    """Top-level dispatch: IFMSK on the view-mode variable 0x68; bit 0x0001 selects the virtual cockpit."""
    o = start
    for _ in range(400):
        op = u16(d, o)
        if op == 0x39 and u16(d, o + 4) == 0x68 and u16(d, o + 6) == 0x0001:
            o += 8
            while u16(d, o) not in (0x3B, 0x8A, 0x88): o += oplen(d, o)
            t = rel(d, o, u16(d, o) != 0x3B)
            while u16(d, t) == 0x88: t = rel(d, t, True)
            return t
        o += oplen(d, o)
    raise ValueError('virtual cockpit entry not found')

def read_track(d, base):
    typ, n, o, keys = u16(d, base), u16(d, base + 0x46), base + 0x48, []
    w = {1: 4, 3: 5}[typ]
    for _ in range(n): keys.append(list(struct.unpack_from('<%df' % w, d, o))); o += 4 * w
    if typ == 1: keys = [[k[0], k[1] * U, k[2] * U, k[3] * U] for k in keys]
    return typ, keys

class VC:
    def __init__(self, d):
        self.d, self.nodes, self.draws = d, [{'p': -1}], []
        self.V = None; self.tex = []; self.mat = []

    def run(self, o, node, varbase=None):
        d, stack, mat, tex = self.d, [node], 0, -1
        while True:
            op, n = u16(d, o), oplen(d, o)
            if op in (0x00, 0x22, 0xBD): return
            if op in (0x0D, 0x88): o = rel(d, o, op == 0x88); continue
            if op == 0xB5:
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
                self.draws.append((stack[-1], mat, tex, vs, np.array(struct.unpack_from('<%dH' % ic, d, o + 8))))
            elif op in (0x8A, 0x23): self.run(rel(d, o, op == 0x8A), stack[-1], varbase)
            o += n

    # -- node maths (row vectors) ------------------------------------------------------------
    def local(self, i):
        n, M = self.nodes[i], np.eye(4)
        if 'r' in n: M[:3, :3] = np.array(n['r']).reshape(3, 3); M[3, :3] = n['t']
        return M

    def export(self, out, texdir):
        os.makedirs(out, exist_ok=True)
        # Bake static chains: each draw is expressed in the frame of its innermost animated ancestor (or the root)
        keep, remap = [], {}
        def frame_of(i):
            M = np.eye(4)
            while i >= 0 and 'var' not in self.nodes[i]: M = M @ self.local(i); i = self.nodes[i]['p']
            return M, i
        def keep_node(i):
            if i < 0: return -1
            if i in remap: return remap[i]
            M, a = frame_of(self.nodes[i]['p'])          # static chain between this anim node and the next one up
            n = self.nodes[i]; e = {'p': keep_node(a), 'var': n['var'], 'type': n['type'], 'keys': n['keys']}
            if not np.allclose(M, np.eye(4)): e['m'] = [float(x) for x in np.r_[M[:3, :3].ravel(), M[3, :3]]]
            keep.append(e); remap[i] = len(keep) - 1; return remap[i]
        verts, idx, batches = [], [], []
        groups = {}
        for node, mat, tex, vs, ii in self.draws:
            M, a = frame_of(node)
            used = np.unique(ii); local = np.searchsorted(used, ii)
            v = self.V[vs + used]
            p = np.c_[v[:, :3] * U, np.ones(len(v))] @ M
            nr = v[:, 3:6] @ M[:3, :3]; nr /= np.linalg.norm(nr, axis=1, keepdims=True) + 1e-12
            name = self.tex[tex] if tex >= 0 else ''
            key = (keep_node(a), mat, name)
            g = groups.setdefault(key, {'v': [], 'i': [], 'n': 0})
            g['v'].append(np.c_[p[:, :3], nr, v[:, 6:8]]); g['i'].append(local + g['n']); g['n'] += len(v)
        base = 0; first = 0
        for (node, mat, name), g in sorted(groups.items(), key=lambda kv: (kv[0][2].startswith('$'), kv[0][1] == 4, kv[0][0], kv[0][2])):
            vv = np.concatenate(g['v']); ii = np.concatenate(g['i']) + base
            verts.append(vv); idx.append(ii)
            m = self.mat[mat]
            batches.append({'node': node, 'tex': name.rsplit('.', 1)[0], 'diffuse': [round(x, 4) for x in m[0:4]],
                            'specular': round(m[8], 3), 'power': m[16], 'emissive': round(m[12], 3), 'first': first, 'count': len(ii)})
            base += len(vv); first += len(ii)
        V = np.concatenate(verts).astype('<f4'); I = np.concatenate(idx)
        assert base < 65536
        with open(os.path.join(out, 'vc.bin'), 'wb') as f: f.write(V.tobytes()); f.write(I.astype('<u2').tobytes())
        texs = sorted({b['tex'] for b in batches if b['tex'] and not b['tex'].startswith('$')})
        written = []
        for t in texs:
            src = os.path.join(texdir, t + '.bmp')
            if not os.path.exists(src): print('missing texture', t); continue
            im = decode_bmp(src)
            im.save(os.path.join(out, t + '.webp'), quality=88, method=6); written.append(t)
        for b in batches:
            if b['tex'] and not b['tex'].startswith('$') and b['tex'] not in written: b['tex'] = ''
        json.dump({'units': 'm', 'frame': 'x right, y up, z forward; FS reference point at the origin',
                   'vertices': int(base), 'indices': int(len(I)), 'nodes': keep, 'batches': batches, 'textures': written},
                  open(os.path.join(out, 'vc.json'), 'w'), separators=(',', ':'))
        print('vertices', base, 'triangles', len(I) // 3, 'batches', len(batches), 'anim nodes', len(keep), 'textures', written)

# -- FS2004 'DXT BMP' textures ------------------------------------------------------------------
def _565(c): return np.stack([((c >> 11) & 31) * 255 // 31, ((c >> 5) & 63) * 255 // 63, (c & 31) * 255 // 31], -1)

def _colour(blk, dxt1):
    c0 = blk[:, 0].astype(np.int32) | blk[:, 1].astype(np.int32) << 8; c1 = blk[:, 2].astype(np.int32) | blk[:, 3].astype(np.int32) << 8
    bits = blk[:, 4:8].copy().view('<u4')[:, 0]
    p0, p1 = _565(c0), _565(c1); four = (c0 > c1) | (not dxt1)
    pal = np.stack([p0, p1, np.where(four[:, None], (2 * p0 + p1) // 3, (p0 + p1) // 2), np.where(four[:, None], (p0 + 2 * p1) // 3, 0)], 1)
    ap = np.full((len(blk), 4), 255); ap[:, 3] = np.where(four, 255, 0) if dxt1 else 255
    ix = np.stack([(bits >> (2 * i)) & 3 for i in range(16)], 1).astype(np.int64)
    return np.take_along_axis(pal, ix[:, :, None].repeat(3, 2), 1), np.take_along_axis(ap, ix, 1)

def decode_bmp(path):
    d = open(path, 'rb').read()
    off, (w, h), comp = struct.unpack_from('<I', d, 10)[0], struct.unpack_from('<ii', d, 18), struct.unpack_from('<I', d, 30)[0]
    if comp not in (0x31545844, 0x33545844): return Image.open(path).convert('RGBA')
    dxt1 = comp == 0x31545844; bw, bh = (w + 3) // 4, (h + 3) // 4; bs = 8 if dxt1 else 16
    raw = np.frombuffer(d, np.uint8, bw * bh * bs, off).reshape(-1, bs)
    if dxt1: rgb, a = _colour(raw, True)
    else:
        rgb, _ = _colour(raw[:, 8:], False)
        a = np.stack([(raw[:, i // 2] >> (4 * (i % 2))) & 15 for i in range(16)], 1).astype(np.int32) * 17   # reflection mask
    px = np.concatenate([rgb, a[:, :, None]], 2).reshape(bh, bw, 4, 4, 4).transpose(0, 2, 1, 3, 4).reshape(bh * 4, bw * 4, 4)
    return Image.fromarray(px[:h, :w].astype(np.uint8), 'RGBA')

if __name__ == '__main__':
    mdl, texdir, out = sys.argv[1:4]
    d = open(mdl, 'rb').read()
    assert d[8:12] == b'MDL8', 'expects an FS2004 MDL8 model'
    vc = VC(d); vc.run(find_vc_entry(d, bgl_start(d)), 0)
    vc.export(out, texdir)
