// Keyframe animation helpers for the FS2004 models converted by tools/fs9_vc.py and tools/fs9_ext.py
import { lerp } from './util.js';
// 4x4 row-major, row vectors (p' = p M): exactly the layout WebGL reads as the column-major transpose
export const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const mul4 = (a, b) => { const r = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + a[i * 4 + 3] * b[12 + j]; return r; };
// Keyframe quaternions rotate the other way from D3DX's row-vector matrix (checked on the model: the airstair door
// swings out, the flap lever is forward at flaps up, the spoiler lever comes aft to extend), so use the transpose
export const quatM = ([x, y, z, w]) => [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0, 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0,
  2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
// Keyframe track at t: translation (type 1) or quaternion rotation (type 3), interpolated between keys (slerp).
// Outside the keys the end values are held.
export function track(keys, type, t) {
  let a = keys[0], b = keys[Math.min(1, keys.length - 1)], f = 0;
  if (t >= keys[keys.length - 1][0]) a = b = keys[keys.length - 1];
  else if (t > keys[0][0]) { let i = 0; while (keys[i + 1][0] <= t) i++; a = keys[i]; b = keys[i + 1]; f = (t - a[0]) / (b[0] - a[0]); }
  else b = a;
  if (type === 1) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f), 1];
  let d = a[1] * b[1] + a[2] * b[2] + a[3] * b[3] + a[4] * b[4]; const s = d < 0 ? -1 : 1; d = Math.min(Math.abs(d), 1);
  const th = Math.acos(d), sn = Math.sin(th);
  const wa = sn < 1e-6 ? 1 - f : Math.sin((1 - f) * th) / sn, wb = sn < 1e-6 ? f : Math.sin(f * th) / sn;
  const q = [1, 2, 3, 4].map(k => a[k] * wa + s * b[k] * wb), l = Math.hypot(...q);
  return quatM(q.map(v => v / l));
}

