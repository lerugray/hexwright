// v2 jagged-grid terrain rendering — pixel-sample check.
//
// Guards two things the code path must hold on an odd-q v2 grid:
//   1. Layer visibility: a valid grid with NO land codes and NO blankLattice
//      flag still populates store.centers (regression for the hexside-only /
//      raw-file-load path that used to render an empty screen).
//   2. Right cells / right positions: assigned terrain draws its palette color
//      at the geometry-computed center of BOTH an even column and a staggered
//      odd column, and NOT one hex-radius outside it.
//
// Self-contained: builds a synthetic v2 grid in-page (no committed v2 sample
// needed — NaB lives under gitignored local/). Fast: one page, no map raster,
// ~4 draws, solid classification-mode fills for exact pixels.
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const DIR = process.cwd();
const PORT = 8034;
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
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 20000 });
  await sleep(400);

  // A jagged odd-q v2 grid: odd columns hold one fewer row and sit half a pitch
  // lower (odd_col_y_offset). Palette gives solid classification-mode colors.
  const V2 = {
    grid: {
      grid_version: 2,
      n_cols: 6,
      row_counts_by_parity: { even: 5, odd: 4 },
      col_pitch_x: 100,
      row_pitch_y: 100,
      x_intercept_col0: 120,
      y_intercept_row0: 120,
      odd_col_y_offset: 50,
      image_full: [900, 800]
    },
    palette: {
      terrain: [
        { key: 'water', color: '#3f78b4' }, // 63,120,180
        { key: 'woods', color: '#2e7d32' }  // 46,125,50
      ],
      hexsideFeatures: []
    },
    evenCell: '0002', // even column 0, parity-0
    oddCell: '0301',  // odd column 3, parity-1 (staggered down)
    evenRGB: [63, 120, 180],
    oddRGB: [46, 125, 50]
  };

  // (1) Layer-visibility regression: grid, empty terrain, NO blankLattice flag.
  const latticeCount = await page.evaluate((V2) => {
    const { store } = window.hexwright;
    store.setPalette(V2.palette);
    store.setProject({
      grid: V2.grid,
      imageFull: V2.grid.image_full,
      terrain: { terrain: {} },
      hexsides: {},
      mapImage: null,
      blankLattice: false
    });
    return Object.keys(store.centers || {}).length;
  }, V2);
  // even cols 0,2,4 -> 5 rows; odd cols 1,3,5 -> 4 rows == 15 + 12 = 27.
  rec('empty-land v2 grid populates lattice (no blankLattice flag)',
    latticeCount === 27, `centers=${latticeCount} (expected 27)`);

  // (2) Assign terrain to an even and a staggered-odd cell, render each centered
  // in classification (solid-fill) mode, pixel-sample at the computed center and
  // one hex-radius outside it.
  const sampleCell = async (code, expectRGB) => {
    return await page.evaluate(({ code, V2 }) => {
      const { store, renderer, geo } = window.hexwright;
      store.state.terrain.terrain[code] = code === V2.evenCell ? 'water' : 'woods';
      store.rebuildIndex();
      renderer.setViewMode('classification');

      const grid = store.state.grid;
      const c = geo.hexCenter(code, grid);
      const r = geo.hexRadius(grid);
      const zoom = 2;
      const s = 1 * zoom; // baseScale 1 (no map)
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
        parity: (parseInt(code.slice(0, 2), 10) % 2),
        atCenter: px(c.x, c.y),
        outside: px(c.x + r * 1.6, c.y) // beyond the hex, into parchment
      };
    }, { code, V2 });
  };

  const near = (a, b, tol = 4) =>
    a && b && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

  const ev = await sampleCell(V2.evenCell, V2.evenRGB);
  rec('v2 even-col fill renders at computed center',
    near(ev.atCenter, V2.evenRGB), `center=${JSON.stringify(ev.atCenter)} expected=${JSON.stringify(V2.evenRGB)}`);
  rec('v2 even-col fill does NOT bleed one radius outside',
    !near(ev.outside, V2.evenRGB), `outside=${JSON.stringify(ev.outside)}`);

  const od = await sampleCell(V2.oddCell, V2.oddRGB);
  rec('v2 odd-col (staggered) fill renders at computed center',
    od.parity === 1 && near(od.atCenter, V2.oddRGB), `parity=${od.parity} center=${JSON.stringify(od.atCenter)} expected=${JSON.stringify(V2.oddRGB)}`);

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
