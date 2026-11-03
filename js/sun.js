// Solar position (NOAA low-precision ephemeris, ~0.01 deg over 1950-2050) for the scenario clock.
// World frame: x east, y up, z north. Returns a unit vector toward the sun plus elevation / azimuth in degrees.
const D2R = Math.PI / 180;

export function sunVector(dateUtc, latDeg, lonDeg) {
  const jd = dateUtc.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const ha = ((gmst * 15 + lonDeg) * D2R - ra);
  const lat = latDeg * D2R;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));   // from north, clockwise
  // atmospheric refraction (Saemundsson), negligible at these elevations but cheap
  const elDeg = el / D2R; const R = elDeg > -1 ? 1.02 / Math.tan((elDeg + 10.3 / (elDeg + 5.11)) * D2R) / 60 : 0;
  const e = (elDeg + R) * D2R;
  return { v: [Math.cos(e) * Math.sin(az), Math.sin(e), Math.cos(e) * Math.cos(az)], el: elDeg + R, az: ((az / D2R) + 360) % 360 };
}

// Scenario: t = 0 is 12:47:00 EST = 17:47:00 UTC, 1 Nov 2026; KPBI.
export const T0_UTC = Date.UTC(2026, 10, 1, 17, 47, 0);
export const KPBI = { lat: 26.6832, lon: -80.0956 };
export const scenarioSun = (t) => sunVector(new Date(T0_UTC + t * 1000), KPBI.lat, KPBI.lon);
