// One-off: zoomed capture of a road+bridge hexside with the new rendering.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { resolve, basename } from 'path';

const REPO = '/Users/rayweiss/Desktop/Dev Work/hexwright';
const PARENT = resolve(REPO, '..');
const REPO_NAME = basename(REPO);
const PORT = 8047;
const OUT = process.argv[2] || '/tmp/left-edge.png';
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

  const pt = await page.evaluate(() => {
    const hw = window.hexwright;
    const { renderer } = hw;
    renderer.fitView();
    const world = { x: 110, y: 1250 };
    let sp = renderer.worldToScreen(world);
    renderer.zoomAt(sp, 7);
    sp = renderer.worldToScreen(world);
    renderer.zoomAt(sp, 2.0);
    sp = renderer.worldToScreen(world);
    return { target: 'left-edge', x: sp.x, y: sp.y };
  });
  await sleep(900);
  const box = await page.locator('#map-canvas').boundingBox();
  const cx = box.x + pt.x, cy = box.y + pt.y;
  await page.screenshot({
    path: OUT,
    clip: { x: Math.max(0, cx - 420), y: Math.max(0, cy - 300), width: 840, height: 600 }
  });
  console.log('captured', pt.target, '->', OUT);
} catch (e) {
  console.log('CAPTURE FAILED:', e.message);
} finally {
  await browser.close();
  srv.kill();
}
