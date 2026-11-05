// Cockpit control layer (js/panel.js): buttons act, knobs step by the half of the knob you click (right-click: down),
// repeat when held (then take the big step), spin when dragged, accelerate on fast wheel ticks, push only on a
// middle-click or Alt+click, a thumbwheel steps by its top and bottom, unknown hits fall through, the hover outline /
// − + zones / press flash draw over the right control, and a tiny control is picked within MIN_PICK px.
// A minimal DOM stub stands in for the tooltip element; a fake clock drives the hold-repeat.
globalThis.innerWidth = 1600; globalThis.innerHeight = 1000;
const el = () => ({ className: '', style: {}, textContent: '', classList: { add() {}, remove() {}, contains: () => false }, append() {}, appendChild() {}, getBoundingClientRect: () => ({ width: 200, height: 40 }) });
globalThis.document = { createElement: el, body: el() };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const { Panel, HOLD, WHEEL, DRAG, MIN_PICK } = await import('../js/panel.js');
let T = 0; const now = () => T;
const runTo = (Q, to) => { while (T < to) { T += 5; Q.tick(T); } };   // the panel's hold timer, every 5 ms

let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
const sounds = [], P = new Panel({ sound: (k) => sounds.push(k), now, timers: false });
const st = { ap: false, hdg: 100, pushed: 0, vs: 0 };
P.define({
  ap: { label: 'Autopilot', kind: 'button', act: () => { st.ap = !st.ap; }, state: () => (st.ap ? 'ENGAGED' : 'OFF') },
  hdg: { label: 'Heading knob', kind: 'knob', turn: (n, big) => { st.hdg += n * (big ? 10 : 1); }, push: () => { st.pushed++; }, state: () => `${st.hdg}` },
  vs: { label: 'VS wheel', kind: 'knob', axis: 'y', turn: (n) => { st.vs += n * 100; } },
});
const hit = (id, fx = 0.5, fy = 0.5) => ({ id, x: 0, y: 0, w: 10, h: 10, fx, fy });

expect(P.click(hit('ap')) && st.ap && sounds.at(-1) === 'button', `button: a click acts (AP ${st.ap ? 'engaged' : 'off'}) with a click sound`);
const tap = (h, opt) => { const r = P.click(h, 0, 0, opt); P.dragEnd(); return r; };   // press and release
tap(hit('hdg', 0.1)); tap(hit('hdg', 0.9)); tap(hit('hdg', 0.9)); tap(hit('hdg', 0.45)); tap(hit('hdg', 0.55));
expect(st.hdg === 101 && st.pushed === 0, `knob: left half -1, right half +1, right next to the centre too (heading 100 -> ${st.hdg})`);
tap(hit('hdg', 0.5)); tap(hit('hdg', 0.52));
expect(st.pushed === 0 && st.hdg === 103, `knob: a plain click on the centre steps, never pushes (pushed ${st.pushed}, heading ${st.hdg})`);
tap(hit('hdg', 0.9), { button: 2 }); expect(st.hdg === 102 && st.pushed === 0, `knob: right-click steps down even on the + half (heading ${st.hdg})`);
tap(hit('hdg', 0.5), { button: 1 }); tap(hit('hdg', 0.9), { button: 0, alt: true });
expect(st.pushed === 2 && st.hdg === 102, `knob: middle-click and Alt+click push it without turning it (pushed ${st.pushed})`);
expect(tap(hit('ap'), { button: 2 }) === false && tap(hit('ap'), { button: 1 }) === false && st.ap, 'button: right / middle clicks are not presses (right-drag still looks around)');
T = 1000; P.wheel(hit('hdg'), -100, false); T += 500; P.wheel(hit('hdg'), -100, true); T += 500; P.wheel(hit('hdg'), 100, false);
expect(st.hdg === 112 && sounds.at(-1) === 'detent', `wheel: up +1, Shift-up +10, down -1 (heading ${st.hdg}), a detent sound`);
tap(hit('vs', 0.5, 0.1)); tap(hit('vs', 0.5, 0.9)); tap(hit('vs', 0.5, 0.1));
expect(st.vs === 100, `thumbwheel: top +100, bottom -100 by vertical position (VS ${st.vs})`);
expect(!P.click(hit('nothing')) && !P.wheel(hit('ap'), -100, false), 'an unregistered hit falls through; the wheel over a button does nothing');
expect(P.setHover(hit('hdg'), 'fgp', 10, 10) && P.hover.id === 'hdg' && P.hover.key === 'fgp' && P.setHover(null, null, 0, 0) === null && P.hover === null, 'hover follows the control under the mouse and clears off it');
// decorate: draws over the hovered control's box only
const ops = []; const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => ops.push([k, ...a])), set: (t, k, v) => { t[k] = v; return true; } });
P.setHover(hit('ap'), 'fgp', 5, 5); P.decorate({ hits: [{ id: 'ap', x: 20, y: 30, w: 40, h: 20 }, { id: 'hdg', x: 100, y: 30, w: 40, h: 40 }, { id: 'other', x: 0, y: 0, w: 5, h: 5 }] }, ctx, 'fgp');
const rects = ops.filter((o) => o[0] === 'roundRect');
T += 50; expect(rects.length === 1 && rects[0][1] === 21 && P.busy(), `decorate: the outline goes round the hovered control only (${rects.length} outline), and recent presses keep it redrawing`);

// levers: press-and-drag, detents, inverted (pull down for more), snapping, wheel steps
{
  const L = { thr: 0.5, flaps: 0 }, Q = new Panel({ sound: (k) => sounds.push(k) });
  Q.define({
    thr: { label: 'Thrust', kind: 'lever', min: -0.3, max: 1, detents: [0, 1], get: () => L.thr, set: (v) => { L.thr = v; } },
    flaps: { label: 'Flaps', kind: 'lever', min: 0, max: 1, detents: [0, 0.2, 0.5, 1], snap: true, invert: true, get: () => L.flaps, set: (v) => { L.flaps = v; } },
  });
  const g = (id) => ({ id, x: 0, y: 0, w: 1, h: 1, dragPx: 130 });
  expect(Q.click(g('thr'), 500, 400) === 'drag', 'a lever press grabs it (drag)');
  Q.dragMove(500, 350); const up = L.thr; Q.dragMove(500, 470); const back = L.thr; Q.dragMove(500, 450); const near = L.thr; Q.dragEnd();
  expect(Math.abs(up - 1) < 1e-9 && Math.abs(back + 0.2) < 1e-9 && near === 0, `drag: up 50 px -> ${up} (the full detent holds it), down 70 px -> ${back.toFixed(2)}, 50 px -> ${near} (the idle detent holds it)`);
  const n0 = sounds.length; Q.click(g('flaps'), 0, 0); Q.dragMove(0, 30); const f1 = L.flaps; Q.dragMove(0, 70); const f2 = L.flaps; Q.dragMove(0, 200); const f3 = L.flaps; Q.dragEnd();
  expect(f1 === 0.2 && f2 === 0.5 && f3 === 1 && sounds.length - n0 >= 4, `inverted, snapping lever: pulling down steps 0 -> ${f1} -> ${f2} -> ${f3}, a click at each detent`);
  Q.wheel(g('flaps'), -100); const w1 = L.flaps; Q.wheel(g('thr'), 100); const w2 = L.thr; Q.wheel(g('thr'), 100);
  expect(w1 === 0.5 && w2 === 0 && L.thr === 0, `wheel: flaps up a detent (${w1}); thrust down to the idle detent (${w2}) and no further`);
}

// knob zones on hover: the lit half, − and + glyphs, and the tooltip says what a click there does right now
{
  const tips = [], Z = new Panel({ now, timers: false });
  Z.tip.append = (...a) => tips.push(...a.map((x) => (typeof x === 'string' ? x : x.textContent)));
  const A = { ft: 15000 };
  Z.define({ alt: { label: 'ALT', kind: 'knob', step: ['100 ft', '1,000 ft'], turn: (n, big) => { A.ft = Math.max(0, A.ft + n * (big ? 1000 : 100)); },
    peek: (n, big) => `${Math.max(0, A.ft + n * (big ? 1000 : 100)).toLocaleString('en-US')} ft`, state: () => `${A.ft} ft` } });
  Z.setHover(hit('alt', 0.2), 'fgp', 5, 5);
  const left = tips.find((t) => t.startsWith('click:'));
  tips.length = 0; Z.setHover(hit('alt', 0.8), 'fgp', 5, 5);
  const right = tips.find((t) => t.startsWith('click:'));
  expect(left === 'click: −100 ft → 14,900 ft' && right === 'click: +100 ft → 15,100 ft', `tooltip: "${left}" over the left half, "${right}" over the right`);
  const zops = []; const zc = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => zops.push([k, ...a])), set: (t, k, v) => { t[k] = v; return true; } });
  Z.setHover(hit('alt', 0.8), 'fgp', 5, 5); Z.decorate({ hits: [{ id: 'alt', x: 100, y: 0, w: 60, h: 60 }] }, zc, 'fgp');
  const lit = zops.find((o) => o[0] === 'fillRect'), glyphs = zops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
  expect(lit && lit[1] === 130 && lit[3] === 30 && glyphs.includes('−') && glyphs.includes('+'), `decorate: the hovered + half is lit (x ${lit && lit[1]}..${lit && lit[1] + lit[3]}) and − / + are drawn`);
}

// press and hold: one step, nothing for HOLD.delay ms, then repeats that speed up, then big steps; release stops
{
  const A = { ft: 15000, log: [] }, Q = new Panel({ now, timers: false });
  Q.define({ alt: { label: 'ALT', kind: 'knob', turn: (n, big) => { A.ft = Math.max(0, A.ft + n * (big ? 1000 : 100)); A.log.push([T, n, big]); }, state: () => `${A.ft}` } });
  T = 10000; expect(Q.click(hit('alt', 0.9), 0, 0) === 'drag' && A.ft === 15100, `hold: the press steps at once (${A.ft})`);
  const run = (to) => { while (T < to) { T += 5; Q.tick(T); } };   // the panel's timer, every 5 ms
  run(10000 + HOLD.delay - 5); const quiet = A.log.length; run(10000 + HOLD.delay); const first = A.log.length;
  run(10000 + HOLD.delay + HOLD.bigAfter - 5);
  const rep = A.log.slice(1), gaps = rep.slice(1).map((l, i) => l[0] - rep[i][0]);
  expect(quiet === 1 && first === 2, `hold: nothing more until ${HOLD.delay} ms, then it repeats (${quiet} -> ${first} steps)`);
  expect(gaps[0] > gaps.at(-1) && gaps[0] <= HOLD.first + 5 && gaps.at(-1) >= HOLD.last && rep.length >= 8 && rep.every((l) => !l[2]), `hold: ${rep.length} repeats in the first ${HOLD.bigAfter} ms, the gap shrinking ${gaps[0]} -> ${gaps.at(-1)} ms, all small steps`);
  const ftBig = A.ft; run(T + 4 * HOLD.bigEvery); const B = A.log.filter((l) => l[2]), bigs = B.length;
  expect(bigs === 4 && A.ft === ftBig + 4000 && B[0][0] - 10000 < HOLD.delay + HOLD.bigAfter + HOLD.last && B.slice(1).every((l, i) => l[0] - B[i][0] === HOLD.bigEvery), `hold: after ~${(HOLD.delay + HOLD.bigAfter) / 1000} s it takes the big step every ${HOLD.bigEvery} ms (${bigs} x 1,000 ft -> ${A.ft})`);
  Q.dragEnd(); const n = A.log.length; T += 5000; Q.tick(T); expect(A.log.length === n, 'hold: release stops the repeat');
  Q.click(hit('alt', 0.1), 0, 0); run(T + HOLD.delay + 300); Q.dragEnd();
  expect(A.log.slice(n).every((l) => l[1] === -1) && A.log.length - n >= 3, `hold on the left half repeats down (${A.log.length - n} steps)`);
  const m = A.log.length; Q.click(hit('alt', 0.9), 0, 0); T += 3000; Q.tick(T); const burst = A.log.length - m; run(T + 2 * HOLD.bigEvery); Q.dragEnd();
  expect(burst === 2 && A.log.length - m > 2, `hold: after a 3 s page stall one tick takes one step, not the ${Math.round(3000 / HOLD.last)} it missed (${burst - 1}), then repeats on`);
}

// press and drag: spins one step per dragPx, right / up = up; the press's step stands if the drag goes the same way,
// is taken back if it goes the other way; a drag stops the hold-repeat
{
  const V = { h: 100, vs: 0 }, Q = new Panel({ now, timers: false });
  Q.define({ hdg: { label: 'HDG', kind: 'knob', turn: (n) => { V.h += n; }, state: () => `${V.h}` },
    vs: { label: 'VS', kind: 'knob', axis: 'y', dragPx: 20, turn: (n) => { V.vs += n * 100; }, state: () => `${V.vs}` } });
  T = 50000; Q.click(hit('hdg', 0.8), 300, 200); Q.dragMove(300 + DRAG.start - 1, 200); const still = V.h;
  Q.dragMove(300 + DRAG.start, 200); Q.dragMove(300 + DRAG.start + 5 * DRAG.px, 200); const right = V.h;
  T += 3000; Q.tick(T); const noRepeat = V.h; Q.dragEnd();
  expect(still === 101 && right === 106 && noRepeat === 106, `drag: under ${DRAG.start} px it is still a press (${still}); then right ${5 * DRAG.px} px = 5 more steps (${right}); no hold-repeat while dragging`);
  V.h = 100; Q.click(hit('hdg', 0.8), 300, 200); Q.dragMove(300 - DRAG.start, 200); const undone = V.h; Q.dragMove(300 - DRAG.start - 3 * DRAG.px, 200); Q.dragMove(300 - DRAG.start - 2 * DRAG.px, 200); Q.dragEnd();
  expect(undone === 100 && V.h === 98, `drag: left from the + half takes the press back (${undone}), 3 steps out and 1 back -> ${V.h}`);
  Q.click(hit('vs', 0.5, 0.3), 0, 500); Q.dragMove(0, 500 - DRAG.start); Q.dragMove(0, 500 - DRAG.start - 60); Q.dragEnd();
  expect(V.vs === 400, `drag: a thumbwheel spins up when dragged up, ${20} px per step (VS ${V.vs})`);
}

// wheel: trackpad deltas add up to a notch; fast consecutive notches take the big step
{
  const V = { h: 0 }, Q = new Panel({ now, timers: false });
  Q.define({ k: { label: 'K', kind: 'knob', turn: (n, big) => { V.h += n * (big ? 10 : 1); } } });
  T = 90000; for (let i = 0; i < 4; i++) Q.wheel(hit('k'), -WHEEL.notch / 5); const partial = V.h; Q.wheel(hit('k'), -WHEEL.notch / 5);
  expect(partial === 0 && V.h === 1, `wheel: small deltas add up to one notch (${partial} -> ${V.h})`);
  V.h = 0; T += 1000; for (let i = 0; i < WHEEL.bigAfter + 3; i++) { Q.wheel(hit('k'), -100); T += WHEEL.fast - 10; }
  expect(V.h === WHEEL.bigAfter + 3 * 10, `wheel: ${WHEEL.bigAfter + 3} fast notches -> ${V.h} (the first ${WHEEL.bigAfter} small, then big)`);
  V.h = 0; T += 1000; for (let i = 0; i < 10; i++) { Q.wheel(hit('k'), -100); T += WHEEL.fast + 20; }
  expect(V.h === 10, `wheel: slow notches stay small (${V.h})`);
}

// the FGP ALT and VS limits through the knob path: ALT never below 0, VS within ±6,000 ft/min, whatever the gesture
{
  const ap = { alt: 200, vs: 5800 }, Q = new Panel({ now, timers: false });
  const altNext = (n, big) => Math.max(0, Math.round(ap.alt / 100) * 100 + n * (big ? 1000 : 100));
  const vsNext = (n, big) => Math.max(-6000, Math.min(6000, ap.vs + n * (big ? 500 : 100)));
  Q.define({ alt: { label: 'ALT', kind: 'knob', turn: (n, big) => { ap.alt = altNext(n, big); }, peek: (n, big) => `${altNext(n, big)} ft`, state: () => `${ap.alt} ft` },
    vs: { label: 'VS', kind: 'knob', axis: 'y', turn: (n, big) => { ap.vs = vsNext(n, big); }, state: () => `${ap.vs}` } });
  T = 200000; Q.click(hit('alt', 0.1)); runTo(Q, T + 4000); Q.dragEnd(); const a1 = ap.alt;
  Q.wheel(hit('alt'), 100, true); Q.click(hit('alt', 0.5), 0, 0, { button: 2 }); Q.dragEnd();
  expect(a1 === 0 && ap.alt === 0, `clamp: holding ALT down stops at ${a1} ft; Shift-wheel and right-click at 0 stay ${ap.alt}`);
  Q.click(hit('vs', 0.5, 0.1)); runTo(Q, T + 4000); Q.dragEnd(); const v1 = ap.vs;
  Q.click(hit('vs', 0.5, 0.9)); runTo(Q, T + 8000); Q.dragEnd();
  expect(v1 === 6000 && ap.vs === -6000, `clamp: VS held up stops at +${v1}, held down at ${ap.vs} ft/min`);
  ap.alt = 0; Q.click(hit('alt', 0.1), 100, 0); Q.dragMove(100 + DRAG.start + 3 * DRAG.px, 0); Q.dragEnd();
  expect(ap.alt === 300, `clamp: a press at the 0 ft stop that turns into a drag right does not take back a step it never made (${ap.alt} ft)`);
}

// small targets: HUD.hit picks a control within MIN_PICK px when it is smaller, but never a neighbour's click
{
  globalThis.window = globalThis.window || { devicePixelRatio: 1 };
  const { HUD } = await import('../js/hud.js');
  const hd = Object.create(HUD.prototype); hd.hits = [{ x: 100, y: 100, w: 10, h: 10, id: 'small' }, { x: 120, y: 100, w: 40, h: 40, id: 'big' }];
  const a = hd.hit(95, 105, MIN_PICK), b = hd.hit(95, 105), c = hd.hit(116, 105, MIN_PICK), dd = hd.hit(113, 105, MIN_PICK), e = hd.hit(80, 105, MIN_PICK);
  expect(a && a.id === 'small' && a.fx === 0 && !b && !c && dd && dd.id === 'small' && dd.fx === 1 && !e,
    `pick: 5 px left of a 10 px knob hits it (fx ${a && a.fx}) with MIN_PICK ${MIN_PICK}, not without; in the gap the nearer control decides (nearer the big one: no pick, never the knob); 20 px off misses`);
}

console.log(fail ? `\n${fail} FAILED` : '\nall panel tests passed');
process.exit(fail ? 1 : 0);
