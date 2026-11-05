// The FMS CDU (js/cdu.js) on the real FMS and nav database: typing into the scratchpad, CLR / DEL, direct-to from the
// flight plan page and from the DIR page, inserting and deleting fixes, altitude constraints, page turning, error
// messages, and every page building without the sim around it.
import { readFileSync } from 'node:fs';
import { NavDB, procedureLegs } from '../js/navdb.js';
import { FMS } from '../js/fms.js';
import { CDU } from '../js/cdu.js';

let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
const db = new NavDB({ load: async (p) => JSON.parse(readFileSync(new URL('../data/nav/' + p, import.meta.url), 'utf8')) });
await db.init(); const apt = await db.airport('KDJT');
const fms = new FMS(); fms.load(procedureLegs(apt, 'APP', 'I10L', { trans: 'GULLO' }));
const logs = [], G = { fms, apt, ac: { pos: [0, -30000, -900], out: { gs: 100, V: 110, h: 900 }, fuel: 2000 }, free: { apt: 'KDJT', arr: 'KDJT', app: 'I10L' } };
const cdu = new CDU({ G: () => G, findFix: (id, ne) => db.findFix(id, ne), log: (t) => logs.push(t), magvar: () => apt.magvar });
const type = (s) => { for (const c of s) cdu.press(c === ' ' ? 'SP' : c); };
const ids = () => fms.legs.slice(fms.i).filter((l) => l.fix).map((l) => l.fix.id).join(' ');

expect(ids() === 'GULLO WILBA ZISUR RW10L MORGA MORGA', `the loaded plan: ${ids()}`);
type('ZIS'); cdu.press('CLR'); type('SUR');
expect(cdu.scratch === 'ZISUR', `typing and CLR: scratchpad "${cdu.scratch}"`);
cdu.press('L1');
expect(fms.active.fix.id === 'ZISUR' && fms.active.pt === 'DF' && logs.at(-1) === 'DIRECT ZISUR (CDU)' && cdu.scratch === '', `L1 with an ident: direct ZISUR (${fms.active.pt}), the scratchpad clears`);
type('PBI'); cdu.press('L2');
expect(ids().startsWith('ZISUR PBI RW10L'), `L2 with an ident off the plan: inserted before leg 2 (${ids()})`);
cdu.press('DEL'); cdu.press('L2');
expect(ids().startsWith('ZISUR RW10L') && cdu.scratch === '', `DELETE + L2: removed (${ids()})`);
cdu.press('DEL'); cdu.press('L1');
expect(cdu.msg === 'USE DIR TO' && fms.active.fix.id === 'ZISUR', `DELETE on the active leg is refused: "${cdu.msg}"`);
cdu.press('CLR'); cdu.press('L2');
expect(cdu.scratch === 'RW10L', `L2 with an empty scratchpad copies the ident: "${cdu.scratch}"`);
cdu.press('CLR'); cdu.press('CLR'); cdu.press('CLR'); cdu.press('CLR'); cdu.press('CLR');
type('FL050'); cdu.press('R2'); const a1 = fms.legs.find((l) => l.fix && l.fix.id === 'RW10L').alt;
type('3000A'); cdu.press('R1'); const a2 = fms.active.alt;
expect(a1 && a1.a1 === 5000 && a1.d === '@' && a2.a1 === 3000 && a2.d === '+', `altitudes: FL050 at RW10L (${a1 && a1.d}${a1 && a1.a1}), 3000A at ZISUR (${a2.d}${a2.a1})`);
type('NOPEZ'); cdu.press('L3');
expect(cdu.msg === 'NOT IN DATA BASE', `an unknown ident: "${cdu.msg}"`);
cdu.press('CLR'); cdu.scratch = ''; cdu.press('DIR'); cdu.press('L2'); const toFix = fms.active.fix.id;
expect(cdu.page === 'FPL' && toFix === 'RW10L', `DIR page, L2: direct to the second fix ahead (${toFix}), back to the flight plan`);
let ok = true; for (const p of ['IDX', 'FPL', 'DIR', 'PROG', 'DEPARR']) { cdu.press(p); try { const b = cdu.pages()[cdu.page].build(); ok = ok && !!b.title; } catch (e) { ok = false; console.log(p, e.message); } }
cdu.press('FPL'); cdu.press('NEXT'); cdu.pages().FPL.build();
expect(ok && cdu.n === 0, `every page builds; NEXT past the last flight plan page stays on page ${cdu.n + 1}`);
const hits = []; const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
cdu.draw(ctx, 0, 0, 520, 796, { hits });
const want = CDU.KEYS.map((k) => `cdu_${k}`), got = new Set(hits.map((h) => h.id));
expect(want.every((k) => got.has(k)) && hits.length === want.length, `drawing registers a hit box for every key (${hits.length} of ${want.length})`);

console.log(fail ? `\n${fail} FAILED` : '\nall CDU tests passed');
process.exit(fail ? 1 : 0);
