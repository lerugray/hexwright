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

  
  // Click hex 0041's WEST (off-map) edge in edge mode -> expect the boundary status message.
  const target = await page.evaluate(() => {
    const hw = window.hexwright;
    const { store, renderer, geo } = hw;
    renderer.fitView();
    renderer.view.panX += 320; renderer.draw();
    const grid = store.state.grid;
    const mid = geo.edgeMidpoint('0041', 3, grid);   // NW edge -> col -1
    const sp = renderer.worldToScreen(mid);
    return { x: sp.x, y: sp.y };
  });
  await page.keyboard.press('e');
  await sleep(200);
  await page.click('#brush-card .ink >> nth=3');
  await sleep(200);
  const box = await page.locator('#map-canvas').boundingBox();
  const before = await page.evaluate(() => JSON.stringify(window.hexwright.store.state.hexsides).length);
  await page.mouse.click(box.x + target.x, box.y + target.y);
  await sleep(300);
  const after = await page.evaluate(() => ({
    status: document.getElementById('status')?.textContent || '(no status el)',
    sidesLen: JSON.stringify(window.hexwright.store.state.hexsides).length
  }));
  console.log('STATUS:', after.status.slice(0, 90));
  console.log('DATA UNCHANGED:', after.sidesLen === before);
} catch (e) {
  console.log('PROBE FAILED:', e.message);
} finally {
  await browser.close();
  srv.kill();
}
