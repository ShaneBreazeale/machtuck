// Cockpit control layer (js/panel.js): buttons act, knobs step by the third of the knob you click and turn with the
// wheel, a thumbwheel steps by its top and bottom, the centre of a knob pushes it, unknown hits fall through, and the
// hover outline / press flash draw over the right control. A minimal DOM stub stands in for the tooltip element.
globalThis.innerWidth = 1600; globalThis.innerHeight = 1000;
const el = () => ({ className: '', style: {}, textContent: '', classList: { add() {}, remove() {}, contains: () => false }, append() {}, appendChild() {}, getBoundingClientRect: () => ({ width: 200, height: 40 }) });
globalThis.document = { createElement: el, body: el() };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const { Panel } = await import('../js/panel.js');

let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
const sounds = [], P = new Panel({ sound: (k) => sounds.push(k) });
const st = { ap: false, hdg: 100, pushed: 0, vs: 0 };
P.define({
  ap: { label: 'Autopilot', kind: 'button', act: () => { st.ap = !st.ap; }, state: () => (st.ap ? 'ENGAGED' : 'OFF') },
  hdg: { label: 'Heading knob', kind: 'knob', turn: (n, big) => { st.hdg += n * (big ? 10 : 1); }, push: () => { st.pushed++; }, state: () => `${st.hdg}` },
  vs: { label: 'VS wheel', kind: 'knob', axis: 'y', turn: (n) => { st.vs += n * 100; } },
});
const hit = (id, fx = 0.5, fy = 0.5) => ({ id, x: 0, y: 0, w: 10, h: 10, fx, fy });

expect(P.click(hit('ap')) && st.ap && sounds.at(-1) === 'button', `button: a click acts (AP ${st.ap ? 'engaged' : 'off'}) with a click sound`);
P.click(hit('hdg', 0.1)); P.click(hit('hdg', 0.9)); P.click(hit('hdg', 0.9));
expect(st.hdg === 101 && st.pushed === 0, `knob: left third -1, right third +1 (heading 100 -> ${st.hdg})`);
P.click(hit('hdg', 0.5)); expect(st.pushed === 1 && st.hdg === 101, 'knob: the centre pushes it');
P.wheel(hit('hdg'), -100, false); P.wheel(hit('hdg'), -100, true); P.wheel(hit('hdg'), 100, false);
expect(st.hdg === 111 && sounds.at(-1) === 'detent', `wheel: up +1, Shift-up +10, down -1 (heading ${st.hdg}), a detent sound`);
P.click(hit('vs', 0.5, 0.1)); P.click(hit('vs', 0.5, 0.9)); P.click(hit('vs', 0.5, 0.1));
expect(st.vs === 100, `thumbwheel: top +100, bottom -100 by vertical position (VS ${st.vs})`);
expect(!P.click(hit('nothing')) && !P.wheel(hit('ap'), -100, false), 'an unregistered hit falls through; the wheel over a button does nothing');
expect(P.setHover(hit('hdg'), 'fgp', 10, 10) && P.hover.id === 'hdg' && P.hover.key === 'fgp' && P.setHover(null, null, 0, 0) === null && P.hover === null, 'hover follows the control under the mouse and clears off it');
// decorate: draws over the hovered control's box only
const ops = []; const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => ops.push([k, ...a])), set: (t, k, v) => { t[k] = v; return true; } });
P.setHover(hit('ap'), 'fgp', 5, 5); P.decorate({ hits: [{ id: 'ap', x: 20, y: 30, w: 40, h: 20 }, { id: 'hdg', x: 100, y: 30, w: 40, h: 40 }, { id: 'other', x: 0, y: 0, w: 5, h: 5 }] }, ctx, 'fgp');
const rects = ops.filter((o) => o[0] === 'roundRect');
expect(rects.length === 1 && rects[0][1] === 21 && P.busy(), `decorate: the outline goes round the hovered control only (${rects.length} outline), and recent presses keep it redrawing`);

console.log(fail ? `\n${fail} FAILED` : '\nall panel tests passed');
process.exit(fail ? 1 : 0);
