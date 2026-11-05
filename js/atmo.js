// International Standard Atmosphere with temperature offset. Heights in meters.
export const FT = 0.3048, KT = 0.514444, G0 = 9.80665, RHO0 = 1.225;
export function isa(h, dT = 0) {
  const T0 = 288.15, p0 = 101325, L = 0.0065, R = 287.053;
  let T, p;
  if (h < 11000) { T = T0 - L * h; p = p0 * Math.pow(T / T0, G0 / (L * R)); }
  else { T = 216.65; p = 22632.06 * Math.exp(-G0 * (h - 11000) / (R * T)); }
  T += dT;                       // temperature deviation from ISA, K (the accident day: ISA+11, KMFL sounding)
  const rho = p / (R * T), a = Math.sqrt(1.4 * R * T);
  return { T, p, rho, a };
}
