// Real-time frame-rate benchmark of the renderer in headless Chrome (GPU via ANGLE/Metal on macOS), over the
// DevTools protocol. Serve the repo first (python3 -m http.server 8787), then:
//   node tools/bench.mjs [WxH] [port]
// CHROME=/path/to/chrome overrides the browser. Reports fps, scene (raymarch) and output resolution per view.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [W, H] = (process.argv[2] || '1280x660').split('x').map(Number);
const port = process.argv[3] || 8787;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWS = {
  'chase, graupel at core entry': '#view=60,1,2.6,0.12',
  'chase, breakout under the deck': '#view=145,1,2.8,0.05',
  'cockpit, final dive': '#view=146,0,0,0',
  'above the anvil, 17.5 km': '#shot=-30000,17500,-60000,20,-5,60,1,40',
  'under the storm base': '#shot=-2000,900,-12000,320,8,70,1,30',
  'Greenacres from 300 m': '#shot=-12500,300,-9500,30,-14,60,1,140',
};
const chrome = spawn(CHROME, ['--headless=new', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'n722bd-bench-'))}`, '--use-angle=metal', '--enable-gpu',
  '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--remote-debugging-port=9333', '--disable-frame-rate-limit', '--disable-gpu-vsync', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
try {
  await sleep(2500);
  const tabs = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  console.log(`window ${W}x${H}`);
  for (const [name, hash] of Object.entries(VIEWS)) {
    await send('Page.navigate', { url: 'about:blank' }); await sleep(300);
    await send('Page.navigate', { url: `http://localhost:${port}/${hash}` }); await sleep(9000);   // load data, let exposure/TAA/dynamic res settle
    const r = await ev(`new Promise(res=>{let n=0;const t0=performance.now();const f=()=>{n++; if(performance.now()-t0<4000) requestAnimationFrame(f);
      else res({fps:+(n/((performance.now()-t0)/1000)).toFixed(1), scene:SIM.R.T.scene.w+'x'+SIM.R.T.scene.h, out:SIM.R.canvas.width+'x'+SIM.R.canvas.height});};requestAnimationFrame(f);})`);
    console.log(`${name.padEnd(34)} ${String(r?.fps).padStart(6)} fps   scene ${r?.scene}   output ${r?.out}`);
  }
  ws.close();
} finally { chrome.kill(); }
