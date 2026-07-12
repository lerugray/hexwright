// Manifest restore regression guard: disk grid recalibration wins over a stale
// autosave grid without discarding session work, while matching grids retain
// the saved map nudge and Start fresh removes the rejected session slot.
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const DIR = process.cwd();
const PORT = 8055;
const PROJECT_URL = 'demo/project.json';
const SESSION_KEY = 'hexwright.session.hexwright-demo-ferrum-valley';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

const diskGrid = {
  grid_version: 1,
  image_full: [1330, 1180],
  n_cols: 12,
  n_rows: 9,
  x_intercept_col0: 100,
  col_pitch_x: 100,
  y_intercept_row0: 100,
  row_pitch_y: 115,
  even_col_y_offset: 57.5
};

function session(grid, mapOffset = [17, -9]) {
  return {
    savedAt: Date.now(),
    project: {
      schemaVersion: 2,
      name: 'Hexwright Demo — Ferrum Valley',
      mapImage: null,
      imageFull: [1330, 1180],
      grid,
      terrain: { terrain: { '0101': 'clear', '0102': 'woods' } },
      features: {},
      names: {},
      hexFeatures: { '0101': ['city'] },
      hexsides: {},
      provenance: {},
      groups: [],
      mapOffset,
      traces: [{ name: 'saved trace', img: null, layer: 'rivers', on: false, opacity: 0.3 }]
    }
  };
}

async function seededPage(browser, slot, errors) {
  const context = await browser.newContext();
  await context.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: SESSION_KEY, value: slot });
  const page = await context.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`http://localhost:${PORT}/?project=${PROJECT_URL}`, { waitUntil: 'load' });
  await page.waitForSelector('#restore-prompt:not([hidden])', { timeout: 10000 });
  return { context, page };
}

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1300);
const browser = await chromium.launch();

// Case A: a real grid-parameter change uses the disk grid and clears map nudge.
{
  const errors = [];
  const staleGrid = { ...diskGrid, col_pitch_x: 99, _comment: 'old calibration' };
  const { context, page } = await seededPage(browser, session(staleGrid), errors);
  const prompt = await page.locator('#restore-prompt-msg').textContent();
  rec('divergent grid is called out in the restore prompt', /grid changed on disk/i.test(prompt || ''), prompt);
  await page.click('#restore-prompt-restore');
  await page.waitForFunction(() => window.hexwright?.store?.state?.grid?.col_pitch_x === 100);
  const restored = await page.evaluate(() => {
    const state = window.hexwright.store.state;
    return {
      grid: state.grid,
      mapOffset: state.mapOffset,
      land: state.terrain.terrain,
      features: state.hexFeatures,
      traces: state.traces.map((trace) => trace.name)
    };
  });
  rec('divergent Resume uses disk grid and zeroes mapOffset',
    restored.grid.col_pitch_x === 100 && restored.mapOffset[0] === 0 && restored.mapOffset[1] === 0,
    JSON.stringify({ pitch: restored.grid.col_pitch_x, mapOffset: restored.mapOffset }));
  rec('divergent Resume keeps saved traces, terrain, and edits',
    restored.traces[0] === 'saved trace' && restored.land['0102'] === 'woods' && restored.features['0101'][0] === 'city',
    JSON.stringify({ traces: restored.traces, land: restored.land, features: restored.features }));
  rec('case A has no console/page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

// Case B: volatile metadata differences do not count as grid divergence.
{
  const errors = [];
  const matchingGrid = { ...diskGrid, _comment: 'saved copy', fit_quality: { rms: 9 }, _generated: true };
  const { context, page } = await seededPage(browser, session(matchingGrid, [23, -11]), errors);
  const prompt = await page.locator('#restore-prompt-msg').textContent();
  rec('volatile grid metadata does not trigger divergence warning', !/grid changed on disk/i.test(prompt || ''), prompt);
  await page.click('#restore-prompt-restore');
  await page.waitForFunction(() => window.hexwright?.store?.state?.mapOffset?.[0] === 23);
  const restored = await page.evaluate(() => ({
    grid: window.hexwright.store.state.grid,
    mapOffset: window.hexwright.store.state.mapOffset,
    land: window.hexwright.store.state.terrain.terrain
  }));
  rec('matching-grid Resume keeps the saved grid state and mapOffset',
    restored.grid._comment === 'saved copy' && restored.grid.fit_quality.rms === 9 &&
      restored.mapOffset[0] === 23 && restored.mapOffset[1] === -11 && restored.land['0102'] === 'woods',
    JSON.stringify(restored));
  rec('case B has no console/page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

// Case C: rejecting a manifest restore removes the per-project session key.
{
  const errors = [];
  const { context, page } = await seededPage(browser, session(diskGrid), errors);
  await page.click('#restore-prompt-fresh');
  await page.waitForFunction(() => window.hexwright?.store?.state?.name === 'Hexwright Demo — Ferrum Valley');
  await sleep(1000);
  const remains = await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY);
  rec('Start fresh removes the project session key', remains === null, remains || 'removed');
  rec('case C has no console/page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

await browser.close();
server.kill();
if (results.some((ok) => !ok)) process.exit(1);
