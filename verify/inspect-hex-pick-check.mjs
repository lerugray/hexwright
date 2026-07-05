// Inspect-mode hex pick: one highlight on click; geometric hit matches inspector code.
// Covers v1/v2 grids, odd/even columns, center vs inset-near-edge clicks.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = REPO;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

const PALETTE = {
  terrain: [{ key: 'clear', color: '#c8b88a', abbr: '' }],
  hexFeatures: [],
  hexsideFeatures: []
};

const GRID_V1 = {
  grid_version: 1,
  n_cols: 6,
  n_rows: 4,
  col_pitch_x: 120,
  row_pitch_y: 120,
  x_intercept_col0: 100,
  y_intercept_row0: 100,
  even_col_y_offset: 60,
  image_full: [900, 550]
};

const GRID_V2 = {
  grid_version: 2,
  n_cols: 6,
  row_counts_by_parity: { even: 4, odd: 5 },
  col_pitch_x: 120,
  row_pitch_y: 120,
  x_intercept_col0: 100,
  y_intercept_row0: 100,
  odd_col_y_offset: 60,
  image_full: [900, 620]
};

const PORT = 8051;
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

async function bootGrid(grid) {
  await page.evaluate(({ grid, PALETTE }) => {
    const { store, renderer, ui } = window.hexwright;
    store.setPalette(PALETTE);
    store.setProject({
      grid,
      imageFull: grid.image_full,
      terrain: { terrain: {} },
      hexsides: {},
      features: {},
      mapImage: null
    });
    store.rebuildIndex();
    renderer.fitView();
    ui.setMode('inspect');
    const start = document.getElementById('start-screen');
    if (start) start.hidden = true;
    const coach = document.getElementById('coach-card');
    if (coach) coach.hidden = true;
  }, { grid, PALETTE });
  await sleep(200);
}

async function clickWorldPoint(worldPt) {
  const screen = await page.evaluate((wp) => {
    const { renderer } = window.hexwright;
    return renderer.worldToScreen(wp);
  }, worldPt);

  const box = await page.locator('#map-canvas').boundingBox();
  await page.keyboard.press('Escape');
  await sleep(80);
  await page.mouse.click(box.x + screen.x, box.y + screen.y);
  await sleep(200);

  return page.evaluate(({ x, y }) => {
    const { renderer, ui, geo } = window.hexwright;
    const grid = ui.store?.state?.grid || window.hexwright.store.state.grid;
    const centers = window.hexwright.store.centers;
    const world = renderer.screenToWorld({ x, y });
    const geometric = (() => {
      for (const code of Object.keys(centers)) {
        const poly = geo.hexPolygon(code, grid);
        if (geo.pointInPolygon(world, poly)) {
          const { col, row } = geo.parseCCRR(code);
          if (geo.isValidCell(col, row, grid)) return code;
        }
      }
      return null;
    })();
    const pick = renderer.hexAtScreen({ x, y });
    const hl = renderer.highlighted;
    const highlightCount = (renderer.selectedHex ? 1 : 0)
      + (hl?.hex && hl?.edge != null && hl?.neighbor ? 1 : 0);
    return {
      pick,
      geometric,
      selectedHex: renderer.selectedHex,
      inspectorHex: ui.inspectorHex,
      highlighted: { ...hl },
      highlightCount,
      centerCode: document.getElementById('hexed-center-code')?.textContent?.trim() || null
    };
  }, screen);
}

async function runCase(label, grid, code, worldPt) {
  const geoCheck = await page.evaluate(({ code, worldPt, grid }) => {
    const { geo, store } = window.hexwright;
    const poly = geo.hexPolygon(code, grid);
    return geo.pointInPolygon(worldPt, poly);
  }, { code, worldPt, grid });

  if (!geoCheck) {
    rec(`${label}: fixture point inside ${code}`, false, 'world point not in target hex');
    return;
  }

  const st = await clickWorldPoint(worldPt);
  const ok = st.pick === code
    && st.geometric === code
    && st.selectedHex === code
    && st.inspectorHex === code
    && st.centerCode === code
    && st.highlighted.hex === null
    && st.highlighted.neighbor === null
    && st.highlightCount === 1;

  rec(
    label,
    ok,
    ok ? `code=${code}` : `pick=${st.pick} geom=${st.geometric} sel=${st.selectedHex} insp=${st.inspectorHex} hl=${JSON.stringify(st.highlighted)} count=${st.highlightCount}`
  );
}

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => window.hexwright?.store, { timeout: 15000 });

  const cases = [
    { grid: GRID_V1, label: 'v1', evenCode: '0201', oddCode: '0102' },
    { grid: GRID_V2, label: 'v2 jagged', evenCode: '0201', oddCode: '0102' }
  ];

  for (const { grid, label, evenCode, oddCode } of cases) {
    await bootGrid(grid);

    const meta = await page.evaluate(({ evenCode, oddCode, grid }) => {
      const { geo } = window.hexwright;
      const edgeWithNeighbor = (code) => {
        for (let i = 0; i < 6; i++) {
          const nb = geo.edgeNeighborCode(code, i, grid);
          if (nb && window.hexwright.store.centers[nb]) return i;
        }
        return 0;
      };
      return {
        evenCenter: geo.hexCenter(evenCode, grid),
        oddCenter: geo.hexCenter(oddCode, grid),
        evenEdge: edgeWithNeighbor(evenCode),
        oddEdge: edgeWithNeighbor(oddCode)
      };
    }, { evenCode, oddCode, grid });

    await runCase(`${label} even col center ${evenCode}`, grid, evenCode, meta.evenCenter);
    await runCase(
      `${label} even col inset ${evenCode}`,
      grid,
      evenCode,
      await page.evaluate(({ evenCode, grid, edge, factor }) => {
        const { geo } = window.hexwright;
        const c = geo.hexCenter(evenCode, grid);
        const m = geo.edgeMidpoint(evenCode, edge, grid);
        return { x: c.x + (m.x - c.x) * factor, y: c.y + (m.y - c.y) * factor };
      }, { evenCode, grid, edge: meta.evenEdge, factor: 0.88 })
    );

    await runCase(`${label} odd col center ${oddCode}`, grid, oddCode, meta.oddCenter);
    await runCase(
      `${label} odd col inset ${oddCode}`,
      grid,
      oddCode,
      await page.evaluate(({ oddCode, grid, edge, factor }) => {
        const { geo } = window.hexwright;
        const c = geo.hexCenter(oddCode, grid);
        const m = geo.edgeMidpoint(oddCode, edge, grid);
        return { x: c.x + (m.x - c.x) * factor, y: c.y + (m.y - c.y) * factor };
      }, { oddCode, grid, edge: meta.oddEdge, factor: 0.88 })
    );
  }

  rec('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('FATAL', String(e));
  rec('run', false, String(e));
} finally {
  await browser.close();
  srv.kill();
  const fails = results.filter((x) => !x.ok).length;
  console.log(`\n=== ${results.length - fails}/${results.length} passed ===`);
  process.exit(fails ? 1 : 0);
}
