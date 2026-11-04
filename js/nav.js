// ILS deviations from the navigation database (js/navdb.js, FAA CIFP): localizer antenna position and course, the
// runway's landing threshold and elevation, glideslope angle and threshold crossing height, DME antenna. Works for any
// ILS in the database; nothing here is airport-specific.
// Indications: localizer full scale (2 dots) is the published course width either side (half the CIFP localizer
// width); glideslope full scale (2 dots) = 0.7 deg; usable within 18 nm / +/-35 deg (LOC), 10 nm / +/-8 deg (G/S).
const NM = 1852, FT = 0.3048, DEG = Math.PI / 180;

// il: an ILS from NavDB.airport(...).ils; n, e (m), h (m MSL)
export function ilsDeviation(il, n, e, h) {
  const crs = il.crsT * DEG, u = [Math.cos(crs), Math.sin(crs)];
  const thr = il.thr || il.ne;
  const dn = n - thr[0], de = e - thr[1];
  const along = dn * u[0] + de * u[1];                          // + past the landing threshold, - on final
  const cross = -dn * u[1] + de * u[0];                         // + right of the centreline
  const ln = n - il.ne[0], le = e - il.ne[1];
  const dLoc = -(ln * u[0] + le * u[1]);                        // distance before the localizer antenna
  const azLoc = Math.atan2(-ln * u[1] + le * u[0], Math.max(1, dLoc));
  const halfWidth = (il.width ? il.width / 2 : 2.5) * DEG;
  const loc = -azLoc / halfWidth * 2;
  const gsX = Math.tan((il.gs || 3) * DEG), gsOrigin = (il.tch || 50) * FT / gsX;   // the glidepath meets the runway this far past the threshold
  const dGs = gsOrigin - along, hRel = h - (il.thrElev || 0) * FT;
  const angle = Math.atan2(hRel, Math.max(1, dGs)) / DEG;
  const gs = ((il.gs || 3) - angle) / 0.35;
  const dmeAt = il.dmeNe || il.ne;
  const dme = Math.hypot(n - dmeAt[0], e - dmeAt[1]) / NM;
  const locValid = dLoc > 0 && dLoc < 18 * NM && Math.abs(azLoc) < 35 * DEG && along < 2000;
  const gsValid = !!il.gs && locValid && dGs > 0 && dGs < 10 * NM && Math.abs(azLoc) < 8 * DEG;
  const gsErrM = hRel - Math.max(0, dGs) * gsX;                 // height above (+) the glidepath, m
  return { id: `ILS ${(il.runway || '').replace(/^RW/, '')}`, ident: il.id, freq: il.freq, apt: il.apt, il,
    loc: Math.max(-2.5, Math.min(2.5, loc)), gs: Math.max(-2.5, Math.min(2.5, gs)), locRaw: loc, gsRaw: gs, dme, locValid, gsValid,
    course: il.crsT * DEG, along, cross, hRel, gsAngle: il.gs || 3, gsErrM, marker: null };
}
// the ILS whose localizer the aircraft is most nearly lined up with, among `list` (e.g. NavDB.allIls())
export function nearestIls(list, n, e, h, track) {
  let best = null;
  for (const il of list || []) {
    if (Math.abs(il.ne[0] - n) > 40 * NM || Math.abs(il.ne[1] - e) > 40 * NM) continue;
    const d = ilsDeviation(il, n, e, h);
    if (!d.locValid) continue;
    const score = Math.abs(Math.atan2(Math.sin(track - d.course), Math.cos(track - d.course)));
    if (score < Math.PI / 2 && (!best || score < best.score)) best = { ...d, score };
  }
  return best;
}
