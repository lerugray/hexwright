// Composite palette terrain — diagonal two-color hex fill (pixel sample).
//
// Self-contained: synthetic v2 grid + inline palette with `colors: [c1, c2]`.
// Classification mode (solid fills) for exact RGB; samples upper-left and
// lower-right triangle regions of one painted hex.
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const DIR = process.cwd();
const PORT = 8038;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 20000 });
  await sleep(400);

  const FIX = {
    grid: {
      grid_version: 2,
      n_cols: 4,
      row_counts_by_parity: { even: 4, odd: 3 },
      col_pitch_x: 100,
      row_pitch_y: 100,
      x_intercept_col0: 120,
      y_intercept_row0: 120,
      odd_col_y_offset: 50,
      image_full: [600, 600]
    },
    palette: {
      terrain: [
        { key: 'woods_mountain', colors: ['#5c7a4a', '#a98a5c'] }
      ],
      hexsideFeatures: []
    },
    cell: '0001',
    upperRGB: [92, 122, 74],   // #5c7a4a
    lowerRGB: [169, 138, 92]   // #a98a5c
  };

  const sample = await page.evaluate((FIX) => {
    const { store, renderer, geo } = window.hexwright;
    store.setPalette(FIX.palette);
    store.setProject({
      grid: FIX.grid,
      imageFull: FIX.grid.image_full,
      terrain: { terrain: { [FIX.cell]: 'woods_mountain' } },
      hexsides: {},
      mapImage: null,
      blankLattice: false
    });
    store.rebuildIndex();
    renderer.setViewMode('classification');

    const grid = store.state.grid;
    const c = geo.hexCenter(FIX.cell, grid);
    const r = geo.hexRadius(grid);
    const zoom = 2;
    const s = 1 * zoom;
    renderer.view = {
      baseScale: 1, zoom,
      panX: renderer.width / 2 - c.x * s,
      panY: renderer.height / 2 - c.y * s
    };
    renderer.draw();

    const canvas = renderer.canvas;
    const px = (wx, wy) => {
      const sp = renderer.worldToScreen({ x: wx, y: wy });
      const dpr = canvas.width / renderer.width;
      const d = renderer.ctx.getImageData(
        Math.round(sp.x * dpr), Math.round(sp.y * dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    };

    return {
      terrainKey: store.state.terrain.terrain[FIX.cell],
      upperLeft: px(c.x - r * 0.35, c.y - r * 0.35),
      lowerRight: px(c.x + r * 0.35, c.y + r * 0.35)
    };
  }, FIX);

  const near = (a, b, tol = 4) =>
    a && b && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

  rec('composite terrain stored as plain string key',
    sample.terrainKey === 'woods_mountain', sample.terrainKey);
  rec('composite fill upper-left triangle color',
    near(sample.upperLeft, FIX.upperRGB), `got=${JSON.stringify(sample.upperLeft)} expected=${JSON.stringify(FIX.upperRGB)}`);
  rec('composite fill lower-right triangle color',
    near(sample.lowerRight, FIX.lowerRGB), `got=${JSON.stringify(sample.lowerRight)} expected=${JSON.stringify(FIX.lowerRGB)}`);
  rec('composite triangles are distinct colors',
    !near(sample.upperLeft, sample.lowerRight, 2),
    `upper=${JSON.stringify(sample.upperLeft)} lower=${JSON.stringify(sample.lowerRight)}`);

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
