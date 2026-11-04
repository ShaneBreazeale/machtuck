// ILS for the KPBI runways (free flight): localizer on the runway centreline, glideslope from the touchdown zone.
// Geometry from js/ground.js (OpenStreetMap thresholds). The glidepath angle (3.00 deg) and threshold crossing height
// (55 ft) are the standard values, not published KPBI data (the FAA's open ILS dataset has no KPBI entries).
// Indications follow the usual standards: localizer full scale (2 dots) = 105 m either side at the threshold, about
// +/-2.5 deg at the far end; glideslope full scale (2 dots) = 0.7 deg; usable within 18 nm / +/-35 deg (LOC) and 10 nm /
// +/-8 deg (G/S).
import { RUNWAYS, runwayFrame, groundAlt } from './ground.js';

const NM = 1852, FT = 0.3048, DEG = Math.PI / 180;
export const ILS = [
  { id: 'ILS 10L', rw: '10L/28R', fromB: false, gs: 3.0, tch: 55 },
  { id: 'ILS 28R', rw: '10L/28R', fromB: true, gs: 3.0, tch: 55 },
];
export const ilsFrame = (ils) => runwayFrame(RUNWAYS.find((r) => r.id === ils.rw), ils.fromB);

// deviations for an aircraft at (n, e, h): loc / gs in dots (+ = aircraft left of course / below the glidepath, i.e. fly
// right / fly up), distance to the threshold (nm), and validity
export function ilsDeviation(ils, n, e, h) {
  const f = ilsFrame(ils);
  const dn = n - f.thr[0], de = e - f.thr[1];
  const along = dn * f.u[0] + de * f.u[1];                     // + past the threshold, - on final
  const cross = -dn * f.u[1] + de * f.u[0];                    // + right of the centreline
  const locAnt = f.L + 300;                                    // localizer antenna beyond the far end
  const dLoc = locAnt - along;                                 // distance from the localizer antenna
  const azLoc = Math.atan2(cross, dLoc);
  const halfWidth = Math.atan2(105, locAnt);                   // full-scale half angle
  const loc = -azLoc / halfWidth * 2;
  const gsX = Math.tan(ils.gs * DEG), gsOrigin = ils.tch * FT / gsX;   // glidepath meets the runway this far past the threshold
  const dGs = gsOrigin - along, hRel = h - groundAlt(f.thr[0], f.thr[1]);
  const angle = Math.atan2(hRel, Math.max(1, dGs)) / DEG;
  const gs = (ils.gs - angle) / 0.35;                          // dots: 0.35 deg per dot
  const dme = Math.hypot(dn, de) / NM;
  const locValid = dLoc > 0 && dLoc < 18 * NM + locAnt && Math.abs(azLoc) < 35 * DEG && along < f.L;
  const gsValid = locValid && dGs > 0 && dGs < 10 * NM && Math.abs(azLoc) < 8 * DEG;
  const gsErrM = hRel - Math.max(0, dGs) * gsX;               // height above (+) the glidepath, m
  return { gsErrM, id: ils.id, loc: Math.max(-2.5, Math.min(2.5, loc)), gs: Math.max(-2.5, Math.min(2.5, gs)), locRaw: loc, gsRaw: gs, dme, locValid, gsValid, course: f.hdg, along, cross, hRel, gsAngle: ils.gs };
}
// the ILS whose localizer the aircraft is most nearly lined up with (within its coverage)
export function nearestIls(n, e, h, track) {
  let best = null;
  for (const ils of ILS) {
    const d = ilsDeviation(ils, n, e, h);
    if (!d.locValid) continue;
    const score = Math.abs(Math.atan2(Math.sin(track - d.course), Math.cos(track - d.course)));
    if (score < Math.PI / 2 && (!best || score < best.score)) best = { ...d, ils, score };
  }
  return best;
}
