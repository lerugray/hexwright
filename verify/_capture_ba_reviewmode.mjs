// Post-fix capture: Bloody April review-mode defaults.
// Serves from the parent dir (so bloody-april-digital is reachable), opens the
// BA manifest via the same URL shape as the .command launcher, turns on anomaly
// mode, and saves a full-viewport screenshot for operator comparison.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { resolve, basename } from 'path';

const REPO = '/Users/rayweiss/Desktop/Dev Work/hexwright';
const PARENT = resolve(REPO, '..');
const REPO_NAME = basename(REPO);
const PORT = 8642;
const OUT = '/Users/rayweiss/Desktop/hexwright-reviewmode-after-2026-07-31.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: PARENT, stdio: 'ignore' });
await sleep(1300);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 300)));

try {
  await page.goto(
    `http://localhost:${PORT}/${REPO_NAME}/?project=../bloody-april-digital/data/map/hexwright/BA-arras-hexwright.json`,
    { waitUntil: 'load', timeout: 20000 }
  );
  await page.waitForFunction(() => {
    const el = document.getElementById('count-land');
    return el && /[1-9]/.test(el.textContent);
  }, { timeout: 45000, polling: 500 });
  await sleep(1500); // let the map raster settle

  // Dismiss the coach card so the operator comparison isn't obscured.
  await page.locator('#coach-card button').filter({ hasText: /Got it/i }).click().catch(() => {});

  const state = await page.evaluate(() => {
    const hw = window.hexwright;
    const { renderer, ui } = hw;
    renderer.fitView();
    // Turn on anomaly cross-hatch so the screenshot proves it still renders.
    if (!ui.anomalyActive) ui.toggleAnomaly();
    return {
      reviewMode: hw.store.state.reviewMode,
      pointFeatureVisibility: renderer.pointFeatureVisibility,
      pointFeatureLabelsVisible: renderer.pointFeatureLabelsVisible,
      anomalyActive: ui.anomalyActive
    };
  });
  await sleep(800);

  console.log('state:', JSON.stringify(state, null, 2));

  await page.screenshot({ path: OUT, fullPage: false });

  // Verify a hidden layer can be toggled back on (non-destructive, data stays loaded).
  await page.locator('#point-feature-layer-rows .eye.off').first().click();
  await sleep(300);
  const toggled = await page.evaluate(() => {
    const hw = window.hexwright;
    const firstOff = Object.keys(hw.renderer.pointFeatureVisibility).find(
      (k) => hw.renderer.pointFeatureVisibility[k] === false
    );
    return { toggledType: firstOff, visibleCount: Object.values(hw.renderer.pointFeatureVisibility).filter((v) => v !== false).length };
  });
  console.log('toggle-on check:', JSON.stringify(toggled));
  console.log('captured BA review mode ->', OUT);
} catch (e) {
  console.log('CAPTURE FAILED:', e.message);
} finally {
  await browser.close();
  srv.kill();
}
