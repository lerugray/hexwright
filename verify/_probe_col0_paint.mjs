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

  
  // Reproduce: paint a col01->col00 diagonal edge via REAL pointer events.
  const setup = await page.evaluate(() => {
    const hw = window.hexwright;
    const { store, renderer, geo } = hw;
    renderer.fitView();
    renderer.view.panX += 300; renderer.draw(); // clear the tool rail
    // col 01 hex mid-map; find its neighbors that live in col 00
    const grid = store.state.grid;
    const results = [];
    for (const code of ['0120', '0121', '0125']) {
      for (let i = 0; i < 6; i++) {
        const nb = geo.edgeNeighborCode(code, i, grid);
        if (nb && nb.startsWith('00') && store.centers[nb]) {
          const ca = geo.hexCenter(code, grid);
          const cb = geo.hexCenter(nb, grid);
          const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
          const sp = renderer.worldToScreen(mid);
          const hit = renderer.nearestEdgeAtScreen(sp);
          results.push({ code, edge: i, nb, screen: { x: Math.round(sp.x), y: Math.round(sp.y) },
                         hitKey: hit ? hit.edgeKey : null });
        }
      }
    }
    return { results, centersHas0120: !!store.centers['0120'] };
  });
  console.log('HIT-TEST:', JSON.stringify(setup, null, 1));
  const target = setup.results.find(r => r.hitKey);
  if (!target) { console.log('NO TARGET EDGE FOUND'); throw new Error('no target'); }

  // enter edge mode, pick first ink, click the midpoint
  await page.keyboard.press('e');
  await sleep(200);
  await page.click('#brush-card .ink >> nth=0');
  await sleep(200);
  const box = await page.locator('#map-canvas').boundingBox();
  await page.mouse.click(box.x + target.screen.x, box.y + target.screen.y);
  await sleep(250);
  const after = await page.evaluate((k) => {
    const arr = window.hexwright.store.state.hexsides[k] || [];
    return { key: k, feats: arr };
  }, target.hitKey);
  console.log('AFTER CLICK:', JSON.stringify(after));
} catch (e) {
  console.log('PROBE FAILED:', e.message);
} finally {
  await browser.close();
  srv.kill();
}
