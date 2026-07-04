// One-off: zoomed capture of a road+bridge hexside with the new rendering.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { resolve, basename } from 'path';

const REPO = '/Users/rayweiss/Desktop/Dev Work/hexwright';
const PARENT = resolve(REPO, '..');
const REPO_NAME = basename(REPO);
const PORT = 8047;
const OUT = process.argv[2] || '/tmp/bridge-zoom.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: PARENT, stdio: 'ignore' });
await sleep(1300);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 300)));
try {
  await page.goto(`http://localhost:${PORT}/${REPO_NAME}/?project=local/nab/project.json`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const hw = window.hexwright;
    return hw && hw.store && hw.store.state && Object.keys(hw.store.state.hexsides || {}).length > 0;
  }, { timeout: 45000, polling: 500 });
  await sleep(1800); // let the map raster arrive

  
  // Functional probe: is a col-00 edge paintable? What element sits at its screen point?
  const report = await page.evaluate(() => {
    const hw = window.hexwright;
    const { store, renderer, geo } = hw;
    renderer.fitView();
    // known col-00 pair from the bundle
    const a = '0010', b = '0011';
    const ca = geo.hexCenter(a, store.state.grid);
    const cb = geo.hexCenter(b, store.state.grid);
    const world = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
    const out = { fit: {}, panned: {} };
    const probe = (label) => {
      const sp = renderer.worldToScreen(world);
      const canvas = document.getElementById('map-canvas');
      const rect = canvas.getBoundingClientRect();
      const el = document.elementFromPoint(rect.left + sp.x, rect.top + sp.y);
      const hit = renderer.nearestEdgeAtScreen(sp);
      out[label] = {
        screen: { x: Math.round(sp.x), y: Math.round(sp.y) },
        topElement: el ? (el.id || el.className || el.tagName) : 'none',
        edgeHit: hit ? hit.edgeKey : null
      };
    };
    probe('fit');
    renderer.view.panX += 260; renderer.draw();
    probe('panned');
    return out;
  });
  console.log(JSON.stringify(report, null, 1));
} catch (e) {
  console.log('PROBE FAILED:', e.message);
} finally {
  await browser.close();
  srv.kill();
}
