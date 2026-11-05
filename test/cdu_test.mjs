// The FMS CDU-4200 (js/cdu.js) on the real FMS and nav database: edits build a MOD flight plan that only flies after
// EXEC (CANCEL MOD drops it); LEGS: direct-to, insert, delete, speed / altitude; DIR INTC; FPLN VIA / TO with an airway
// entry; HOLD at a fix and EXIT HOLD; DEP ARR: a new approach rebuilt into the plan; PERF: cruise altitude; messages;
// every page and key.
import { readFileSync } from 'node:fs';
import { NavDB, procedureLegs, procedureList, airwayLegs, fixLeg } from '../js/navdb.js';
import { FMS } from '../js/fms.js';
import { CDU } from '../js/cdu.js';

let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
const db = new NavDB({ load: async (p) => JSON.parse(readFileSync(new URL('../data/nav/' + p, import.meta.url), 'utf8')) });
await db.init(); const apt = await db.airport('KDJT');
const fms = new FMS(); fms.load(procedureLegs(apt, 'APP', 'I10L', { trans: 'GULLO' }), 0, 21000);
const logs = [], execs = [], G = { fms, apt, ap: { vert: 'ALT', vnav: null }, ac: { pos: [0, -30000, -900], m: 9400, out: { gs: 100, V: 110, h: 900 }, fuel: 2000 }, free: { apt: 'KDJT', arr: 'KDJT', app: 'I10L', trans: 'GULLO' } };
const cdu = new CDU({ G: () => G, findFix: (id, ne) => db.findFix(id, ne), log: (t) => logs.push(t), magvar: () => apt.magvar, cycle: () => db.index.cycle,
  procName: (id) => id, procedures: (id, kind) => procedureList(apt, kind),
  airwayLegs: (awy, from, to) => { try { return airwayLegs(db, awy, from.id, to.id); } catch { return null; } },
  replan: (ch) => ({ legs: procedureLegs(apt, 'APP', ch.app || 'I10L', { trans: null }) }), onExec: (ch) => execs.push(ch) });
const type = (s) => { for (const c of s) cdu.press(c === ' ' ? 'SP' : c); };
const ids = (P = fms) => P.legs.slice(P.i).filter((l) => l.fix).map((l) => l.fix.id).join(' ');

expect(ids() === 'GULLO WILBA ZISUR RW10L MORGA MORGA', `the loaded plan: ${ids()}`);
cdu.press('LEGS'); type('ZIS'); cdu.press('CLR'); type('SUR'); cdu.press('L1');
expect(cdu.mod && ids(cdu.mod).startsWith('ZISUR') && fms.active.fix.id === 'GULLO' && cdu.scratch === '', `LEGS L1 with an ident: a MOD direct to ZISUR (${ids(cdu.mod).split(' ')[0]}) while the active plan still flies to ${fms.active.fix.id}`);
cdu.press('EXEC');
expect(!cdu.mod && fms.active.fix.id === 'ZISUR' && fms.active.pt === 'DF' && logs.at(-1).includes('executed'), `EXEC: the active plan goes direct ZISUR (${fms.active.pt})`);
type('PBI'); cdu.press('L2'); cdu.press('L6');
expect(!cdu.mod && ids().startsWith('ZISUR RW10L'), 'an insert, then CANCEL MOD (L6): the plan is untouched');
type('PBI'); cdu.press('L2'); cdu.press('EXEC');
expect(ids().startsWith('ZISUR PBI RW10L'), `insert PBI before leg 2, EXEC: ${ids()}`);
cdu.press('DEL'); cdu.press('L2'); cdu.press('EXEC');
expect(ids().startsWith('ZISUR RW10L'), `DELETE + L2, EXEC: ${ids()}`);
cdu.press('DEL'); cdu.press('L1');
expect(cdu.msg === 'INVALID DELETE' && !cdu.mod, `DELETE on the active leg is refused: "${cdu.msg}"`);
cdu.press('CLR'); cdu.press('L2');
expect(cdu.scratch === 'RW10L', `L2 with an empty scratchpad copies the ident: "${cdu.scratch}"`);
cdu.scratch = ''; type('210/FL050'); cdu.press('R2'); type('3000A'); cdu.press('R1'); cdu.press('EXEC');
const a1 = fms.legs.find((l) => l.fix && l.fix.id === 'RW10L'), a2 = fms.active;
expect(a1.alt.a1 === 5000 && a1.spd === 210 && a2.alt.a1 === 3000 && a2.alt.d === '+', `speed / altitude: 210/FL050 at RW10L (${a1.spd}/${a1.alt.a1}), 3000A at ZISUR (${a2.alt.d}${a2.alt.a1})`);
type('NOPEZ'); cdu.press('L3');
expect(cdu.msg === 'NOT IN DATA BASE' && cdu.unread, `an unknown ident: "${cdu.msg}", MSG lights`);
cdu.scratch = ''; cdu.press('DIR'); cdu.press('L3'); const d = cdu.mod && cdu.mod.legs[cdu.mod.i].fix.id; cdu.press('EXEC');
expect(cdu.page === 'LEGS' && d === 'RW10L' && fms.active.fix.id === 'RW10L', `DIR INTC: a fix ahead (${d}) into a MOD on the LEGS page, EXEC flies it`);
// FPLN: VIA / TO, an airway entry
const f2 = new FMS(); f2.load([fixLeg(db.fix('ZBV'))], 0, 21000); G.fms = f2; cdu.go('FPLN');
type('A315'); cdu.press('L5'); type('JAYEE'); cdu.press('R5'); cdu.press('EXEC');
expect(ids(f2) === 'ZBV SWIMM TINKY PEKRE JAYEE' && cdu.pages().FPLN.build().lines[4][2].t === 'A315', `FPLN: VIA A315 TO JAYEE after ZBV expands the airway (${ids(f2)}), shown as one VIA / TO line`);
type('J999'); cdu.press('L5'); type('PBI'); cdu.press('R5');
expect(cdu.msg === 'NOT ON AIRWAY', `an airway that doesn't join: "${cdu.msg}"`);
G.fms = fms; cdu.scratch = ''; cdu.msg = '';
// HOLD at the active fix, then EXIT HOLD
cdu.press('HOLD'); cdu.press('L1'); cdu.press('EXEC'); const h = fms.legs.find((l, j) => j > fms.i && l.pt === 'HM');
cdu.press('R6'); cdu.press('EXEC'); const hx = fms.legs.find((l, j) => j > fms.i && /^H/.test(l.pt) && l.fix.id === h.fix.id);
expect(h && h.fix.id === 'RW10L' && h.turn === 'R' && hx.pt === 'HF', `HOLD L1: a hold at ${h && h.fix.id} (right turns); EXIT HOLD makes it one more circuit (${hx && hx.pt})`);
// DEP ARR: a new approach
const apps = procedureList(apt, 'APP'); cdu.press('DEPARR'); cdu.press('R1'); cdu.press('L1');
const want = apps[0].id; cdu.press('EXEC');
expect(execs.at(-1) && execs.at(-1).app === want && fms.legs.some((l) => l.proc === want), `ARRIVAL: choosing ${want} rebuilds the plan into a MOD; EXEC flies it and the sortie choices follow`);
// PERF: cruise altitude
cdu.press('PERF'); type('FL250'); cdu.press('L1'); const before = fms.cruise; cdu.press('EXEC');
expect(before === 21000 && fms.cruise === 25000, `PERF CRZ ALT FL250: ${before} -> ${fms.cruise} after EXEC`);
cdu.press('EXEC'); expect(cdu.msg === 'NO MOD FPLN', `EXEC with nothing to execute: "${cdu.msg}"`);
cdu.press('FIX'); expect(cdu.msg === 'FIX NOT AVAILABLE', `a key the sim has nothing behind: "${cdu.msg}"`);
let ok = true; for (const p of Object.keys(cdu.pages())) { cdu.page = p; try { ok = ok && !!cdu.pages()[p].build().title; } catch (e) { ok = false; console.log(p, e.message); } }
expect(ok, `every page builds (${Object.keys(cdu.pages()).length})`);
const hits = []; const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
cdu.page = 'FPLN'; cdu.draw(ctx, 0, 0, 520, 796, { hits });
const wantK = CDU.KEYS.map((k) => `cdu_${k}`), got = new Set(hits.map((x) => x.id));
expect(wantK.every((k) => got.has(k)) && hits.length === wantK.length, `drawing registers a hit box for every key (${hits.length} of ${wantK.length})`);

console.log(fail ? `\n${fail} FAILED` : '\nall CDU tests passed');
process.exit(fail ? 1 : 0);
