// Elevation layer + auto-derived slopes/escarpments check.
// Uses the bundled demo map (no local/ operator data needed).
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const DIR = process.cwd();
const VER = DIR + '/verify';
const PORT = 8061;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1500);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

try {
  await page.goto(`http://localhost:${PORT}/?project=demo/project.json`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('count-land');
    return el && /[1-9]/.test(el.textContent || '');
  }, { timeout: 20000 });
  await sleep(1200);

  // Enter elevation mode and pick level 3.
  await page.keyboard.press('h');
  await sleep(200);
  await page.keyboard.press('3');
  await sleep(200);

  const modeAfterKey = await page.evaluate(() => window.hexwright.ui.mode);
  const levelAfterKey = await page.evaluate(() => window.hexwright.ui.elevationLevel);
  rec('H key enters elevation mode', modeAfterKey === 'elevation', `mode=${modeAfterKey}`);
  rec('digit 3 sets elevation level 3', levelAfterKey === 3, `level=${levelAfterKey}`);

  // Find a probe hex with at least two neighbors.
  const probe = await page.evaluate(() => {
    const { renderer, store, geo } = window.hexwright;
    const grid = store.state.grid;
    const centers = store.centers || {};
    for (const code of Object.keys(centers)) {
      const nbs = [];
      for (let i = 0; i < 6; i++) {
        const nb = geo.edgeNeighborCode(code, i, grid);
        if (nb && centers[nb]) nbs.push(nb);
      }
      if (nbs.length >= 2) return { code, nbs };
    }
    return null;
  });
  rec('found probe hex with neighbors', !!probe, probe ? `code=${probe.code}` : 'none');
  if (!probe) throw new Error('no probe hex');

  // Paint the probe level 3, one neighbor level 2 (slope, delta 1),
  // another neighbor level 1 (escarpment? no — delta 2 from 3 -> escarpment),
  // and a third neighbor level 3 (no slope).
  const setElev = async (code, level) => {
    await page.evaluate(({ code, level }) => {
      window.hexwright.store.setElevation(code, level);
    }, { code, level });
  };
  await setElev(probe.code, 3);
  await setElev(probe.nbs[0], 2);
  await setElev(probe.nbs[1], 1);
  await setElev(probe.nbs[2], 3);

  const derived = await page.evaluate(({ code, nbs }) => {
    const slopes = window.hexwright.store.deriveSlopes();
    const map = new Map();
    for (const [k, v] of slopes) map.set(k, v);
    const keyFor = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
    return {
      slopeCount: slopes.size,
      probe2: map.get(keyFor(code, nbs[0])),
      probe1: map.get(keyFor(code, nbs[1])),
      probe3: map.get(keyFor(code, nbs[2]))
    };
  }, probe);

  rec('deriveSlopes sees slope + escarpment',
    derived.probe2?.type === 'slope' && derived.probe1?.type === 'escarpment',
    JSON.stringify({ slope: derived.probe2, escarpment: derived.probe1 }));
  rec('slope delta is 1', derived.probe2?.delta === 1, `delta=${derived.probe2?.delta}`);
  rec('escarpment delta is 2', derived.probe1?.delta === 2, `delta=${derived.probe1?.delta}`);
  rec('equal-elevation edge produces no slope', !derived.probe3, `probe3=${JSON.stringify(derived.probe3)}`);
  rec('slope direction points to higher hex',
    derived.probe2?.higher === probe.code && derived.probe1?.higher === probe.code,
    JSON.stringify({ slopeHigher: derived.probe2?.higher, escarpmentHigher: derived.probe1?.higher }));

  // Recompute after edit: change neighbor 1 from level 1 to level 3.
  await setElev(probe.nbs[1], 3);
  const recomputed = await page.evaluate(({ code, nbs }) => {
    const slopes = window.hexwright.store.deriveSlopes();
    const map = new Map();
    for (const [k, v] of slopes) map.set(k, v);
    const keyFor = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
    return {
      slopeCount: slopes.size,
      probe2: map.get(keyFor(code, nbs[0])),
      probe1: map.get(keyFor(code, nbs[1]))
    };
  }, probe);
  rec('recompute removes stale escarpment', !recomputed.probe1, `probe1=${JSON.stringify(recomputed.probe1)}`);
  rec('slope remains after recomputation', recomputed.probe2?.type === 'slope', `probe2=${JSON.stringify(recomputed.probe2)}`);

  // Restore a 2-level delta for the export escarpment check.
  await setElev(probe.nbs[1], 1);

  // Export shape pins.
  const exportData = await page.evaluate(() => {
    const store = window.hexwright.store;
    return {
      elevation: store.exportElevationObject(),
      hexsides: store.exportHexsidesObject()
    };
  });
  const elevKeys = Object.keys(exportData.elevation.elevation || {});
  rec('exportElevationObject has _comment + elevation map',
    typeof exportData.elevation._comment === 'string' && elevKeys.length >= 4,
    `keys=${elevKeys.join(',')}`);
  rec('hexsides export carries derived slopes',
    Array.isArray(exportData.hexsides.slopes) && exportData.hexsides.slopes.some((e) => e.a && e.b && e.higher),
    `slopes=${exportData.hexsides.slopes.length}`);
  rec('hexsides export carries derived escarpments',
    Array.isArray(exportData.hexsides.escarpments) && exportData.hexsides.escarpments.some((e) => e.a && e.b && e.higher),
    `escarpments=${exportData.hexsides.escarpments.length}`);
  rec('derived entries have higher direction',
    exportData.hexsides.slopes.every((e) => e.higher === e.a || e.higher === e.b),
    'higher is one endpoint');

  // Render-style contract: overlays toggle on and produce non-trivial screenshots.
  await page.evaluate(() => {
    const r = window.hexwright.renderer;
    r.elevationOverlayVisible = true;
    r.slopeOverlayVisible = true;
    r.terrainFillVisible = true;
    r.fitView();
    r.draw();
  });
  await sleep(400);
  const elevShot = await page.locator('#map-canvas').screenshot({ path: `${VER}/elevation-overlay-demo.png` });
  rec('elevation+slope overlay screenshot non-trivial', elevShot.length > 8000, `bytes=${elevShot.length}`);

  // Verify brush card renders elevation chips.
  const chipCount = await page.locator('#brush-card .ink[data-ink-key]').count();
  rec('brush card renders elevation chips', chipCount === 10, `chips=${chipCount}`);

  // Inspector elevation grid renders for selected hex (switch to inspect first).
  await page.keyboard.press('i');
  await sleep(200);
  const centerPt = await page.evaluate(({ code }) => {
    const { renderer, store, geo } = window.hexwright;
    return renderer.worldToScreen(geo.hexCenter(code, store.state.grid));
  }, probe);
  const canvasBox = await page.locator('#map-canvas').boundingBox();
  await page.mouse.click(canvasBox.x + centerPt.x, canvasBox.y + centerPt.y);
  await sleep(300);
  const gridChipCount = await page.locator('#hexed-elevation-grid .elevation-chip').count();
  rec('inspector renders 10 elevation chips', gridChipCount === 10, `chips=${gridChipCount}`);
  const currentElev = await page.textContent('#hexed-elevation-current');
  rec('inspector shows current elevation', /Level 3/.test(currentElev || ''), `text=${currentElev?.trim()}`);

  rec('no console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('elevation check completed', false, err.message);
} finally {
  await browser.close();
  srv.kill();
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n=== ${results.length - fails}/${results.length} passed ===`);
  process.exit(fails ? 1 : 0);
}
