import { chromium } from 'playwright';
import { spawn } from 'child_process';

const DIR = process.cwd();
const PORT = 8029;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

try {
  await page.goto(`http://localhost:${PORT}/?project=samples/gota-project.json`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('count-land');
    return el && /[1-9]/.test(el.textContent);
  }, { timeout: 25000 });
  await sleep(1500);

  const setup = await page.evaluate(() => {
    const hw = window.hexwright;
    const { store, renderer, geo } = hw;
    renderer.fitView();
    renderer.zoomAt({ x: renderer.width / 2, y: renderer.height / 2 }, 1.15);

    const centers = store.centers || {};
    const grid = store.state.grid;
    const r = geo.hexRadius(grid);
    const normalTol = r * geo.EDGE_HIT_TOLERANCE;
    const assistTol = r * geo.EDGE_SNAP_ASSIST_TOLERANCE;
    const offsetDist = (normalTol + assistTol) / 2;

    let chosen = null;
    for (const code of Object.keys(centers)) {
      for (let edge = 0; edge < 6; edge++) {
        const nb = geo.edgeNeighborCode(code, edge, grid);
        if (!nb || !centers[nb]) continue;
        const nbCell = geo.parseCCRR(nb);
        if (!geo.isValidCell(nbCell.col, nbCell.row, grid)) continue;
        const cell = geo.parseCCRR(code);
        if (!geo.isValidCell(cell.col, cell.row, grid)) continue;

        const mid = geo.edgeMidpoint(code, edge, grid);
        const center = geo.hexCenter(code, grid);
        const dx = center.x - mid.x;
        const dy = center.y - mid.y;
        const len = Math.hypot(dx, dy) || 1;
        const inward = { x: mid.x + (dx / len) * offsetDist, y: mid.y + (dy / len) * offsetDist };
        const screenPt = renderer.worldToScreen(inward);
        const edgeKey = geo.pairKey(code, nb);

        const noAssist = geo.nearestEdge(screenPt.x, screenPt.y, {
          view: renderer.view,
          grid,
          centers,
          hexAtScreen: (pt) => renderer.hexAtScreen(pt),
          toleranceFactor: geo.EDGE_HIT_TOLERANCE
        });
        const withAssist = geo.nearestEdge(screenPt.x, screenPt.y, {
          view: renderer.view,
          grid,
          centers,
          hexAtScreen: (pt) => renderer.hexAtScreen(pt),
          toleranceFactor: geo.EDGE_SNAP_ASSIST_TOLERANCE
        });

        if (!noAssist && withAssist && withAssist.edgeKey === edgeKey) {
          chosen = { code, edge, edgeKey, screenPt, offsetDist };
          break;
        }
      }
      if (chosen) break;
    }

    const featureKey =
      (store.getPalette()?.hexsideFeatures || []).find((f) => f.key === 'river')?.key ||
      (store.getPalette()?.hexsideFeatures || [])[0]?.key ||
      'river';

    return chosen ? { ...chosen, featureKey } : null;
  });

  rec('probe off-edge assist point', !!setup, setup ? `hex=${setup.code} edge=${setup.edge}` : 'no suitable point');
  if (!setup) throw new Error('No suitable assist probe point');

  const canvasBox = await page.locator('#map-canvas').boundingBox();
  if (!canvasBox) throw new Error('map canvas bounds unavailable');
  const pagePt = { x: canvasBox.x + setup.screenPt.x, y: canvasBox.y + setup.screenPt.y };

  await page.keyboard.press('e');
  await sleep(150);
  await page.click(`#brush-card .ink[data-ink-key="${setup.featureKey}"]`);
  await sleep(150);

  // Ensure target edge starts unpainted
  await page.evaluate(({ edgeKey, featureKey }) => {
    const s = window.hexwright.store;
    const arr = s.state.hexsides[edgeKey];
    if (Array.isArray(arr) && arr.includes(featureKey)) {
      const [a, b] = edgeKey.split('|');
      s.setHexsideFeature(a, b, featureKey, false);
    }
  }, { edgeKey: setup.edgeKey, featureKey: setup.featureKey });
  await sleep(100);

  await page.keyboard.down('Shift');
  await page.mouse.move(pagePt.x, pagePt.y);
  await sleep(120);

  const previewOn = await page.evaluate(({ edgeKey }) => {
    const r = window.hexwright.renderer;
    return r.snapPreview?.edgeKey === edgeKey;
  }, { edgeKey: setup.edgeKey });
  rec('shift-hover shows snap preview on nearest edge', previewOn, setup.edgeKey);

  await page.keyboard.up('Shift');
  await sleep(80);
  const previewOff = await page.evaluate(() => !window.hexwright.renderer.snapPreview);
  rec('snap preview clears when shift releases', previewOff);

  // Shift-click away from edge but within assist radius
  await page.keyboard.down('Shift');
  await page.mouse.click(pagePt.x, pagePt.y);
  await page.keyboard.up('Shift');
  await sleep(120);
  const shiftClickPainted = await page.evaluate(({ edgeKey, featureKey }) => {
    const arr = window.hexwright.store.state.hexsides[edgeKey] || [];
    return arr.includes(featureKey);
  }, { edgeKey: setup.edgeKey, featureKey: setup.featureKey });
  rec('shift-click within assist radius paints nearest edge', shiftClickPainted, setup.edgeKey);

  // Clear painted edge again
  await page.evaluate(({ edgeKey, featureKey }) => {
    const [a, b] = edgeKey.split('|');
    window.hexwright.store.setHexsideFeature(a, b, featureKey, false);
  }, { edgeKey: setup.edgeKey, featureKey: setup.featureKey });
  await sleep(80);

  await page.mouse.click(pagePt.x, pagePt.y);
  await sleep(120);
  const noShiftClick = await page.evaluate(({ edgeKey, featureKey }) => {
    const arr = window.hexwright.store.state.hexsides[edgeKey] || [];
    return arr.includes(featureKey);
  }, { edgeKey: setup.edgeKey, featureKey: setup.featureKey });
  rec('same point without shift does not paint', !noShiftClick, setup.edgeKey);

  // blur must not leave shift assist latched
  await page.keyboard.down('Shift');
  await page.mouse.move(pagePt.x, pagePt.y);
  await sleep(80);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('Shift');
  await sleep(80);
  const blurClears = await page.evaluate(() => (
    !window.hexwright.renderer.shiftHeld && !window.hexwright.renderer.snapPreview
  ));
  rec('window blur clears shift snap state', blurClears);

  rec('no uncaught console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('shift-snap harness completed', false, err.message);
}

await browser.close();
srv.kill();

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
