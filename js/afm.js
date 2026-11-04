// Learjet 60 AFM FM-123 Section V speeds, transcribed from the archive.org scan (numbers only):
//   Fig 5-42  Uncorrected takeoff speeds, flaps 8, rudder boost on (all aircraft), ISA columns:
//             sea level at 60 F, 5,000 ft at 40 F. V1 must not exceed VR.
//   Fig 5-66  Approach speeds, normal landings: VREF, flaps 40, gear down (4,000 ft and below = 5,000 ft column).
// Weights in lb, speeds KIAS. Between and beyond the two altitudes: linear in altitude, clamped to 0..5,000 ft.
const TO_W = [15000, 16000, 17000, 18000, 19000, 20000, 21000, 22000, 22750, 23000, 23500];
const TO8 = {
  0:    { v1: [111, 113, 114, 117, 120, 124, 127, 130, 133, 134, 136], vr: [125, 125, 127, 130, 133, 136, 139, 142, 144, 144, 145], v2: [138, 138, 138, 138, 140, 143, 146, 149, 151, 152, 153] },
  5000: { v1: [111, 112, 114, 116, 120, 123, 126, 130, 132, 133, 135], vr: [125, 125, 127, 131, 134, 137, 139, 142, 144, 145, 146], v2: [138, 138, 138, 138, 141, 144, 147, 149, 151, 152, 153] },
};
const REF_W = [15000, 16000, 17000, 18000, 19000, 19500, 20000, 21000, 22000, 23000, 23100];
const VREF = [124, 128, 131, 135, 138, 139, 141, 144, 147, 149, 149];
export const MAX_LANDING_LB = 19500;

const interp = (xs, ys, x) => {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
};
// takeoff speeds, flaps 8, for weight (lb) and field pressure altitude (ft)
export function takeoffSpeeds(lb, altFt = 0) {
  const k = Math.max(0, Math.min(1, altFt / 5000)), o = {};
  for (const s of ['v1', 'vr', 'v2']) o[s] = interp(TO_W, TO8[0][s], lb) * (1 - k) + interp(TO_W, TO8[5000][s], lb) * k;
  o.v1 = Math.min(o.v1, o.vr);
  return o;
}
export const vref = (lb) => interp(REF_W, VREF, lb);
