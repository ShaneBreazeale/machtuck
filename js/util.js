// Math utilities. Quaternions are [w,x,y,z]. Rotation matrices are 9-element row-major, body->NED.
export const DEG = Math.PI / 180, RAD = 180 / Math.PI;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const wrap180 = (d) => { d = ((d + 180) % 360 + 360) % 360 - 180; return d; };
export const wrap360 = (d) => ((d % 360) + 360) % 360;

export function qmul(a, b) {
  return [
    a[0]*b[0] - a[1]*b[1] - a[2]*b[2] - a[3]*b[3],
    a[0]*b[1] + a[1]*b[0] + a[2]*b[3] - a[3]*b[2],
    a[0]*b[2] - a[1]*b[3] + a[2]*b[0] + a[3]*b[1],
    a[0]*b[3] + a[1]*b[2] - a[2]*b[1] + a[3]*b[0],
  ];
}
export function qnorm(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0]/l, q[1]/l, q[2]/l, q[3]/l]; }
// Aerospace ZYX: yaw(psi) -> pitch(theta) -> roll(phi)
export function qfromEuler(psi, theta, phi) {
  const cy = Math.cos(psi/2), sy = Math.sin(psi/2), cp = Math.cos(theta/2), sp = Math.sin(theta/2), cr = Math.cos(phi/2), sr = Math.sin(phi/2);
  return [cr*cp*cy + sr*sp*sy, sr*cp*cy - cr*sp*sy, cr*sp*cy + sr*cp*sy, cr*cp*sy - sr*sp*cy];
}
export function qmat(q) {
  const [w, x, y, z] = q;
  return [
    1 - 2*(y*y + z*z), 2*(x*y - w*z),     2*(x*z + w*y),
    2*(x*y + w*z),     1 - 2*(x*x + z*z), 2*(y*z - w*x),
    2*(x*z - w*y),     2*(y*z + w*x),     1 - 2*(x*x + y*y),
  ];
}
export const mulMV = (R, v) => [R[0]*v[0] + R[1]*v[1] + R[2]*v[2], R[3]*v[0] + R[4]*v[1] + R[5]*v[2], R[6]*v[0] + R[7]*v[1] + R[8]*v[2]];
export const mulMTV = (R, v) => [R[0]*v[0] + R[3]*v[1] + R[6]*v[2], R[1]*v[0] + R[4]*v[1] + R[7]*v[2], R[2]*v[0] + R[5]*v[1] + R[8]*v[2]];
export function eulerFromMat(R) {
  return { theta: Math.asin(clamp(-R[6], -1, 1)), phi: Math.atan2(R[7], R[8]), psi: Math.atan2(R[3], R[0]) };
}
// Integrate body rates into quaternion (exact small rotation)
export function qIntegrate(q, w, dt) {
  const ang = Math.hypot(w[0], w[1], w[2]) * dt;
  if (ang < 1e-9) return q;
  const s = Math.sin(ang/2) / (ang / dt), c = Math.cos(ang/2);
  return qnorm(qmul(q, [c, w[0]*s, w[1]*s, w[2]*s]));
}
// NED (n,e,d) -> render world (x east, y up, z north)
export const nedToWorld = (v) => [v[1], -v[2], v[0]];
