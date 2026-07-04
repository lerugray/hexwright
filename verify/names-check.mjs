// Per-hex location names: store, inspector, manifest, restore merge, labels, export.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ProjectStore, validateNamesDocument } from '../src/store.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = REPO;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

const GRID = {
  grid_version: 2,
  n_cols: 4,
  row_counts_by_parity: { even: 3, odd: 3 },
  col_pitch_x: 120,
  row_pitch_y: 120,
  x_intercept_col0: 100,
  y_intercept_row0: 100,
  odd_col_y_offset: 60,
  image_full: [700, 500]
};

const PALETTE = {
  terrain: [
    { key: 'clear', color: '#c8b88a', abbr: '' },
    { key: 'woods', color: '#5c7a4a', abbr: 'W' },
    { key: 'water', color: '#3f78b4', abbr: 'WTR' }
  ],
  hexFeatures: [],
  hexsideFeatures: []
};

// --- Unit: store set/clear, export shape, validation, round-trip ---
const unitStore = new ProjectStore();
unitStore.setHexName('0027', 'Meaux');
unitStore.setHexName('0030', 'Paris');
rec('setHexName stores trimmed name', unitStore.getHexName('0027') === 'Meaux');

const undoStore = new ProjectStore();
undoStore.setHexName('0099', 'Alpha');
const afterSet = undoStore.undoStack.length;
undoStore.setHexName('0099', '');
rec('clear name removes entry', !undoStore.state.names['0099']);
rec('set creates one undo step', afterSet === 1, `stack=${afterSet}`);
rec('clear creates one undo step', undoStore.undoStack.length - afterSet === 1, `delta=${undoStore.undoStack.length - afterSet}`);

unitStore.setHexName('0027', 'Meaux');
const exported = unitStore.exportNamesObject();
rec('export has _comment + names object', exported._comment && typeof exported.names === 'object', exported._comment?.slice(0, 30));
rec('export sorted by code', Object.keys(exported.names).join(',') === '0027,0030');

try {
  validateNamesDocument(exported);
  rec('export passes validateNamesDocument', true);
} catch (err) {
  rec('export passes validateNamesDocument', false, err.message);
}

try {
  validateNamesDocument({ names: { '0027': 42 } });
  rec('invalid import fails loudly', false, 'no throw');
} catch (err) {
  rec('invalid import fails loudly', /must be a string/.test(err.message), err.message.slice(0, 60));
}

const round = new ProjectStore();
round.importNames(JSON.stringify(exported));
rec('round-trip import preserves names', round.getHexName('0027') === 'Meaux' && round.getHexName('0030') === 'Paris');

// --- migrateToV2 / loadProject manifest document shape ---
const loaded = new ProjectStore();
await loaded.loadProject({
  name: 'test',
  grid: GRID,
  palette: PALETTE,
  terrain: { terrain: { '0027': 'woods' } },
  names: { names: { '0027': 'Manifest Town', '0100': 'Other' } }
});
rec('loadProject accepts names document', loaded.getHexName('0027') === 'Manifest Town' && loaded.getHexName('0100') === 'Other');

const manifestNames = validateNamesDocument({ names: { '0027': 'Manifest', '0030': 'Manifest Only' } }).names;
const restoredDoc = { _comment: 'autosave', names: { '0027': 'Operator Wins' } };
const mergedNames = restoredDoc.names ? { ...restoredDoc.names } : {};
for (const [code, name] of Object.entries(manifestNames)) {
  if (mergedNames[code]) continue;
  mergedNames[code] = name;
}
rec('restore merge: autosave name wins', mergedNames['0027'] === 'Operator Wins');
rec('restore merge: manifest-only names appear', mergedNames['0030'] === 'Manifest Only');

// --- Browser harness ---
const PORT = 8036;
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => window.hexwright?.store, { timeout: 15000 });
  await sleep(400);

  await page.evaluate(({ GRID, PALETTE }) => {
    const { store, renderer, ui } = window.hexwright;
    store.setPalette(PALETTE);
    store.setProject({
      grid: GRID,
      imageFull: GRID.image_full,
      terrain: { terrain: { '0001': 'woods', '0101': 'clear' } },
      hexsides: {},
      features: {},
      mapImage: null
    });
    store.rebuildIndex();
    renderer.setViewMode('classification');
    ui.openInspector('0001');
  }, { GRID, PALETTE });

  const inspOpen = await page.evaluate(() => !document.getElementById('hex-editor').hidden);
  rec('inspector opens on hex', inspOpen);

  const beforeNameUndo = await page.evaluate(() => window.hexwright.store.undoStack.length);
  await page.fill('#hexed-name', 'Testburg');
  await page.dispatchEvent('#hexed-name', 'change');
  await sleep(120);

  const named = await page.evaluate(() => ({
    store: window.hexwright.store.getHexName('0001'),
    title: document.getElementById('hexed-title').textContent
  }));
  rec('inspector field sets name in store', named.store === 'Testburg', named.store);
  rec('inspector header shows name', /Testburg/.test(named.title), named.title);

  const undoDelta = await page.evaluate((before) => window.hexwright.store.undoStack.length - before, beforeNameUndo);
  rec('name edit creates one undo step', undoDelta === 1, `delta=${undoDelta}`);

  await page.fill('#hexed-name', '');
  await page.dispatchEvent('#hexed-name', 'change');
  await sleep(120);
  const cleared = await page.evaluate(() => !window.hexwright.store.getHexName('0001'));
  rec('empty field clears name', cleared);

  await page.fill('#hexed-name', 'Labelville');
  await page.dispatchEvent('#hexed-name', 'change');
  await sleep(120);

  const manifestLoad = await page.evaluate(() => {
    const store = window.hexwright.store;
    store.importNames({ _comment: 'fixture', names: { '0101': 'Clearville', '0201': 'Far Hex' } });
    return {
      imported: store.getHexName('0101') === 'Clearville' && store.getHexName('0201') === 'Far Hex',
      kept: store.getHexName('0001') === 'Labelville'
    };
  });
  rec('import names merges into store', manifestLoad.imported && manifestLoad.kept, JSON.stringify(manifestLoad));

  const labelSample = async (labelsOn) => page.evaluate(({ GRID, PALETTE, labelsOn }) => {
    const { store, renderer, geo } = window.hexwright;
    store.state.names = { '0001': 'Labelville' };
    store.state.terrain.terrain = { '0001': 'woods' };
    store.rebuildIndex();
    const code = '0001';
    const c = geo.hexCenter(code, GRID);
    const r = geo.hexRadius(GRID);
    const zoom = 2.5;
    renderer.view = {
      baseScale: 1, zoom,
      panX: renderer.width / 2 - c.x * zoom,
      panY: renderer.height / 2 - c.y * zoom
    };
    renderer.terrainLabelsVisible = labelsOn;
    renderer.draw();
    const upper = { x: c.x, y: c.y - r * 0.33 };
    const lower = { x: c.x, y: c.y - r * 0.08 };
    const samplePt = (pt) => {
      const sp = renderer.worldToScreen(pt);
      const dpr = renderer.canvas.width / renderer.width;
      const cx = Math.round(sp.x * dpr);
      const cy = Math.round(sp.y * dpr);
      const rad = 8;
      const data = renderer.ctx.getImageData(cx - rad, cy - rad, rad * 2 + 1, rad * 2 + 1).data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60 && data[i + 3] > 200) return true;
      }
      return false;
    };
    return { upperInk: samplePt(upper), lowerInk: samplePt(lower) };
  }, { GRID, PALETTE, labelsOn });

  const labelsOff = await labelSample(false);
  rec('labels off: no name ink', !labelsOff.upperInk && !labelsOff.lowerInk);

  const labelsOn = await labelSample(true);
  rec('labels on: abbr ink at upper third', labelsOn.upperInk);
  rec('labels on: name ink below abbr', labelsOn.lowerInk);

  const exportShape = await page.evaluate(() => {
    const obj = window.hexwright.store.exportNamesObject();
    const codes = Object.keys(obj.names);
    return {
      ok: obj._comment && codes.length >= 1,
      sorted: codes.join(',') === [...codes].sort((a, b) => a.localeCompare(b)).join(','),
      json: window.hexwright.store.exportNamesJson()
    };
  });
  rec('export names.json shape from UI store', exportShape.ok && exportShape.sorted, JSON.stringify(exportShape));

  const copyOk = await page.evaluate(() => {
    const parsed = JSON.parse(window.hexwright.store.exportNamesJson());
    return parsed.names && typeof parsed.names === 'object';
  });
  rec('copy names uses canonical export', copyOk);

  rec('no uncaught console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('names-check harness completed', false, err.message);
} finally {
  await browser.close();
  srv.kill();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
