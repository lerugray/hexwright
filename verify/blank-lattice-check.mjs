// Batch 5: blank project with hexgrid.json — lattice visible + paintable.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const DIR = process.cwd();
const VER = DIR + '/verify';
const PORT = 8031;
const terrainCodesInJson = (text) => [...text.matchAll(/"(\d{4})":/g)].map((m) => m[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? '  — ' + note : ''}`);
};

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
let exportedTerrain = null;
page.on('download', async (d) => {
  try {
    if (d.suggestedFilename() === 'terrain.json') {
      const p = VER + '/export-terrain.json';
      await d.saveAs(p);
      exportedTerrain = p;
    }
  } catch (_) { /* ignore download capture errors */ }
});
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 20000 });
  await sleep(500);

  // Start screen → with a hexgrid.json
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#new-with-grid')
  ]);
  await fileChooser.setFiles(path.join(DIR, 'samples/gota-hexgrid.json'));
  await sleep(2000);

  const status = (await page.textContent('#status-strip'))?.trim() || '';
  rec('status strip shows untitled', /untitled/i.test(status), `status="${status.slice(0, 80)}"`);

  const latticeInfo = await page.evaluate(() => {
    const s = window.hexwright.store;
    const g = s.state.grid;
    const { geo } = window.hexwright;
    return {
      blankLattice: s.state.blankLattice,
      centerCount: s.centers ? Object.keys(s.centers).length : 0,
      land: Object.keys(s.state.terrain.terrain || {}).length,
      gridVersion: g ? (g.grid_version || 1) : null,
      rowCountsByParity: g ? g.row_counts_by_parity : null,
      rowCountChecks: g ? {
        v1Even: geo.rowCount(0, g),
        v1Odd: geo.rowCount(1, g)
      } : null
    };
  });
  rec('blankLattice flag set', latticeInfo.blankLattice === true, JSON.stringify(latticeInfo));
  rec('lattice centers populated', latticeInfo.centerCount > 100, `centers=${latticeInfo.centerCount}`);
  rec('lattice rowCount matches rectangular v1 grid', latticeInfo.gridVersion === 1 && latticeInfo.rowCountChecks.v1Even === latticeInfo.rowCountChecks.v1Odd, JSON.stringify(latticeInfo.rowCountChecks));

  const gridShot = await page.locator('#map-canvas').screenshot({ path: VER + '/blank-lattice-grid.png' });
  rec('grid lattice visible (non-trivial screenshot)', gridShot.length > 8000, `bytes=${gridShot.length}`);

  // Press B, click a hex → terrain paints
  await page.keyboard.press('b');
  await sleep(300);
  const box = await page.locator('#map-canvas').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  let painted = false;
  let paintedCode = '';
  outer:
  for (let dy = -200; dy <= 200; dy += 40) {
    for (let dx = -300; dx <= 300; dx += 40) {
      await page.mouse.click(cx + dx, cy + dy);
      await sleep(100);
      const land = await page.evaluate(() => Object.keys(window.hexwright.store.state.terrain.terrain || {}).length);
      if (land > 0) {
        painted = true;
        paintedCode = await page.evaluate(() => Object.keys(window.hexwright.store.state.terrain.terrain)[0]);
        break outer;
      }
    }
  }
  rec('terrain brush paints a lattice hex', painted, `code=${paintedCode}`);

  const synthetic = await page.evaluate(({ paintedCode }) => {
    const s = window.hexwright.store;
    const codes = Object.keys(s.centers || {}).filter((c) => c !== paintedCode).sort();
    const second = codes[0];
    if (!second) return null;
    s.setTerrain(second, 'desert');
    const expected = {};
    for (const code of Object.keys(s.state.terrain.terrain || {}).sort()) {
      expected[code] = s.state.terrain.terrain[code];
    }
    return { second, expected };
  }, { paintedCode });
  rec('synthetic second terrain assignment', !!synthetic?.second, synthetic ? `codes=${Object.keys(synthetic.expected).join(',')}` : 'no spare lattice hex');

  const exportJson = await page.evaluate(() => window.hexwright.store.exportTerrainJson());
  const exportObj = JSON.parse(exportJson);
  const exportKeys = terrainCodesInJson(exportJson);
  const keysSorted = exportKeys.every((code, i, arr) => i === 0 || arr[i - 1].localeCompare(code) <= 0);
  rec('exportTerrainObject has _comment + sorted terrain keys',
    typeof exportObj._comment === 'string' && exportObj._comment.length > 0 && keysSorted,
    `_comment=${JSON.stringify(exportObj._comment?.slice(0, 40))} keys=[${exportKeys.join(',')}]`);
  const expectedMatch = synthetic && exportKeys.length === Object.keys(synthetic.expected).length
    && exportKeys.every((code) => exportObj.terrain[code] === synthetic.expected[code]);
  rec('exportTerrainObject entries match assigned terrain', !!expectedMatch,
    synthetic ? JSON.stringify(synthetic.expected) : 'no synthetic setup');

  await page.click('#export-btn');
  await sleep(300);
  await page.click('#export-terrain-file');
  await sleep(1200);
  if (exportedTerrain) {
    let downloaded = null;
    let parseOk = false;
    try {
      downloaded = JSON.parse(fs.readFileSync(exportedTerrain, 'utf8'));
      parseOk = true;
    } catch (_) { /* parse failure handled below */ }
    rec('export terrain.json download is parseable JSON', parseOk, exportedTerrain);
    if (parseOk && synthetic) {
      const rawDownload = fs.readFileSync(exportedTerrain, 'utf8');
      const dlKeys = terrainCodesInJson(rawDownload);
      const dlSorted = dlKeys.every((code, i, arr) => i === 0 || arr[i - 1].localeCompare(code) <= 0);
      const dlMatch = dlKeys.length === exportKeys.length
        && dlKeys.every((code) => downloaded.terrain[code] === exportObj.terrain[code]);
      rec('downloaded terrain.json matches exportTerrainObject',
        typeof downloaded._comment === 'string' && dlSorted && dlMatch,
        `keys=[${dlKeys.join(',')}]`);
    }
  } else {
    rec('export terrain.json download is parseable JSON', false, 'no download captured');
  }

  const paintState = await page.evaluate(() => {
    const s = window.hexwright.store;
    const code = Object.keys(s.state.terrain.terrain)[0];
    return {
      type: s.state.terrain.terrain[code],
      provenance: s.state.provenance[code],
      stillInCenters: !!s.centers[code]
    };
  });
  rec('painted hex has terrain + confirmed provenance', paintState.type && paintState.provenance === 'confirmed' && paintState.stillInCenters,
    JSON.stringify(paintState));

  // Press E, paint an edge between two lattice hexes via canvas click at edge midpoint
  await page.keyboard.press('e');
  await sleep(300);
  await page.keyboard.press('1');
  await sleep(200);

  const edgeTarget = await page.evaluate(() => {
    const r = window.hexwright.renderer;
    const s = window.hexwright.store;
    const g = window.hexwright.geo;
    const grid = s.state.grid;
    const cx = r.width / 2;
    const cy = r.height / 2;
    let best = null;
    let bestD = Infinity;
    for (const code of Object.keys(s.centers)) {
      for (let ei = 0; ei < 6; ei++) {
        const nb = g.edgeNeighborCode(code, ei, grid);
        if (!nb || !s.centers[nb]) continue;
        const mid = g.edgeMidpoint(code, ei, grid);
        const screen = r.worldToScreen(mid);
        const d = Math.hypot(screen.x - cx, screen.y - cy);
        if (d < bestD) {
          bestD = d;
          best = { screen, pair: `${code}|${nb}` };
        }
      }
    }
    return best;
  });

  let edgePainted = null;
  if (edgeTarget) {
    await page.locator('#canvas-wrap').click({ position: { x: edgeTarget.screen.x, y: edgeTarget.screen.y }, force: true });
    await sleep(400);
    edgePainted = await page.evaluate(() => ({
      hexsides: Object.keys(window.hexwright.store.state.hexsides).length,
      keys: Object.keys(window.hexwright.store.state.hexsides)
    }));
  }
  rec('edge paint adds hexside pair', edgePainted && edgePainted.hexsides > 0, JSON.stringify({ edgeTarget: edgeTarget?.pair, edgePainted }));

  rec('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  rec('run', false, String(e));
} finally {
  await browser.close();
  srv.kill();
  const fails = results.filter((x) => !x.ok).length;
  console.log(`\n=== ${results.length - fails}/${results.length} passed ===`);
  process.exit(fails ? 1 : 0);
}
