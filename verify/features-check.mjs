// Point-feature editing: place, edit attrs, delete, export shape, round-trip, autosave, manifest load.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ProjectStore, validateFeaturesDocument, syntheticHexFeaturesFromFeatures } from '../src/store.js';
import { GOTA_PROJECT_URL, PATHS } from './_local-data.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = REPO;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

// --- Unit: export shape + validation + round-trip (no browser) ---
const unitStore = new ProjectStore();
unitStore.setPalette(JSON.parse(readFileSync(resolve(REPO, 'palettes/default.json'), 'utf8')));
unitStore.state.features = {};
unitStore.setPointFeature('3706', 'objective', { name: 'Test Objective', attrs: { vp: 25 } });
unitStore.setPointFeature('3606', 'fort', { name: 'Test Fort', attrs: { strength: 4 } });

const exported = unitStore.exportFeaturesObject();
rec('export has _comment + features array', exported._comment && Array.isArray(exported.features), exported._comment?.slice(0, 30));
rec('export sorted by code', exported.features[0]?.code === '3606' && exported.features[1]?.code === '3706',
  exported.features.map((f) => f.code).join(','));

try {
  validateFeaturesDocument(exported);
  rec('export passes validateFeaturesDocument', true);
} catch (err) {
  rec('export passes validateFeaturesDocument', false, err.message);
}

rec('export item shape matches schema',
  exported.features.every((f) => f.code && f.type && typeof f.attrs === 'object'),
  JSON.stringify(exported.features[0]));

const round = new ProjectStore();
round.setPalette(unitStore.getPalette());
round.importFeatures(JSON.stringify(exported));
const reExported = round.exportFeaturesObject();
rec('round-trip export identical', JSON.stringify(exported.features) === JSON.stringify(reExported.features));

try {
  validateFeaturesDocument({ features: 'nope' });
  rec('invalid import fails loudly', false, 'no throw');
} catch (err) {
  rec('invalid import fails loudly', /Expected features/.test(err.message), err.message.slice(0, 60));
}

// --- Unit: picker fallback when palette declares no hexFeatures (never a dead panel) ---
const fbStore = new ProjectStore();
fbStore.setPalette({ name: 'no-decl', terrain: [], hexsideFeatures: [] }); // NO hexFeatures
fbStore.setPointFeature('0101', 'vp', { name: 'Town', attrs: { vp: 7 } });
fbStore.setPointFeature('0202', 'fortress', { name: 'Fort', attrs: { sp: 4 } });
const synth = syntheticHexFeaturesFromFeatures(fbStore.state.features);
rec('fallback synthesizes picker types from loaded data when palette declares none',
  synth.length === 2 && synth.some((f) => f.key === 'vp') && synth.some((f) => f.key === 'fortress'),
  synth.map((f) => f.key).join(','));
const vpDecl = synth.find((f) => f.key === 'vp');
rec('fallback infers numeric attr schema from data',
  vpDecl?.attrs?.[0]?.key === 'vp' && vpDecl?.attrs?.[0]?.type === 'number',
  JSON.stringify(vpDecl?.attrs));
rec('fallback yields empty list when no point-feature data present',
  syntheticHexFeaturesFromFeatures({}).length === 0);

// --- Headless UI harness (requires operator sample under local/) ---
if (!existsSync(PATHS.gotaProject)) {
  console.log('SKIP local game data not present (local/samples/gota/gota-project.json)');
} else {
const PORT = 8032;
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

try {
  await page.goto(`http://localhost:${PORT}/?project=${GOTA_PROJECT_URL}`, { waitUntil: 'load', timeout: 20000 });
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

    const palette = store.getPalette();
    const featureType = palette?.hexFeatures?.find((f) => f.key === 'city')?.key
      || palette?.hexFeatures?.[0]?.key;
    if (!featureType) return null;

    const centers = store.centers || {};
    const grid = store.state.grid;
    for (const code of Object.keys(centers)) {
      const pt = renderer.worldToScreen(geo.hexCenter(code, grid));
      if (renderer.hexAtScreen(pt) !== code) continue;
      const el = document.elementFromPoint(
        pt.x + document.getElementById('map-canvas').getBoundingClientRect().x,
        pt.y + document.getElementById('map-canvas').getBoundingClientRect().y
      );
      if (el && (el.id === 'map-canvas' || el.closest('#canvas-wrap'))) {
        return { code, featureType, pt };
      }
    }
    return null;
  });

  rec('probe hex for feature placement', !!setup, setup ? `${setup.code}/${setup.featureType}` : 'none');
  if (!setup) throw new Error('No probe hex');

  await page.keyboard.press('p');
  await sleep(150);
  const modeOn = await page.evaluate(() => window.hexwright.ui.mode === 'features');
  rec('P switches to features mode', modeOn);

  const canvasBox = await page.locator('#map-canvas').boundingBox();
  const clickPt = { x: canvasBox.x + setup.pt.x, y: canvasBox.y + setup.pt.y };

  // Select-not-place guard: entering features mode arms NO type, and a bare click
  // must never silently add a feature (the operator's "silently added" bug).
  const noArm = await page.evaluate(() => window.hexwright.ui.featurePaintType == null);
  rec('features mode starts with no type armed (select-not-place)', noArm);
  const beforeNoSel = await page.evaluate(() => window.hexwright.store.undoStack.length);
  await page.mouse.click(clickPt.x, clickPt.y);
  await sleep(200);
  const noSelResult = await page.evaluate(({ code }) => ({
    added: window.hexwright.store.getPointFeaturesAt(code).length,
    undoDelta: window.hexwright.store.undoStack.length
  }), setup);
  rec('bare click with no type armed adds nothing',
    noSelResult.added === 0 && noSelResult.undoDelta === beforeNoSel,
    `added=${noSelResult.added} undo=${noSelResult.undoDelta}/${beforeNoSel}`);

  await page.click(`#brush-card .ink[data-ink-key="${setup.featureType}"]`);
  await sleep(150);

  const beforeUndo = await page.evaluate(() => window.hexwright.store.undoStack.length);
  await page.mouse.click(clickPt.x, clickPt.y);
  await sleep(200);

  const placed = await page.evaluate(({ code, featureType }) => {
    const rec = window.hexwright.store.getPointFeature(code, featureType);
    return !!rec;
  }, setup);
  rec('click empty hex places selected feature type', placed, setup.code);

  const undoDeltaPlace = await page.evaluate((before) => {
    return window.hexwright.store.undoStack.length - before;
  }, beforeUndo);
  rec('place creates one undo step', undoDeltaPlace === 1, `delta=${undoDeltaPlace}`);

  await page.mouse.click(clickPt.x, clickPt.y);
  await sleep(200);
  const inspOpen = await page.evaluate(() => !document.getElementById('feature-inspector').hidden);
  rec('click existing feature opens inspector', inspOpen);

  const beforeEditUndo = await page.evaluate(() => window.hexwright.store.undoStack.length);
  await page.evaluate(({ code, featureType }) => {
    const ui = window.hexwright.ui;
    document.getElementById('feat-insp-name').value = 'Test City';
    const input = document.querySelector('#feat-insp-attrs .feat-attr');
    if (input) input.value = '3';
    ui._saveFeatureInspector();
  }, setup);
  await sleep(200);

  const edited = await page.evaluate(({ code, featureType }) => {
    const rec = window.hexwright.store.getPointFeature(code, featureType);
    return { name: rec?.name, vp: rec?.attrs?.vp };
  }, setup);
  rec('inspector saves name + attrs', edited.name === 'Test City' && Number(edited.vp) === 3,
    JSON.stringify(edited));

  const undoDeltaEdit = await page.evaluate((before) => {
    return window.hexwright.store.undoStack.length - before;
  }, beforeEditUndo);
  rec('edit save creates one undo step', undoDeltaEdit === 1, `delta=${undoDeltaEdit}`);

  page.once('dialog', (d) => d.accept());
  await page.evaluate(({ code, featureType }) => {
    window.hexwright.ui.openFeatureInspector(code, featureType);
    window.hexwright.ui._deleteFeatureInspector();
  }, setup);
  await sleep(200);

  const deleted = await page.evaluate(({ code, featureType }) => {
    return !window.hexwright.store.getPointFeature(code, featureType);
  }, setup);
  rec('inspector delete removes feature', deleted);

  // --- Inspect-panel point-feature list + per-row delete (fix #3) ---
  // Place a feature, open it in INSPECT mode, confirm the row renders, then delete
  // via the inspect panel's × button and assert exactly one feature is removed.
  await page.mouse.click(clickPt.x, clickPt.y); // re-place (type still armed)
  await sleep(150);
  await page.evaluate(({ code }) => {
    const ui = window.hexwright.ui;
    ui.setMode('inspect');
    ui.openInspector(code);
  }, setup);
  await sleep(150);
  const rowShown = await page.evaluate(({ featureType }) =>
    !!document.querySelector(`#hexed-point-feats .point-feat-row[data-pf-type="${featureType}"] .pf-del`), setup);
  rec('inspect panel lists the hex point feature with a delete control', rowShown);

  const beforeInspDel = await page.evaluate(({ code }) =>
    window.hexwright.store.getPointFeaturesAt(code).length, setup);
  page.once('dialog', (d) => d.accept());
  await page.click(`#hexed-point-feats .point-feat-row[data-pf-type="${setup.featureType}"] .pf-del`);
  await sleep(200);
  const inspDelResult = await page.evaluate(({ code, featureType }) => ({
    after: window.hexwright.store.getPointFeaturesAt(code).length,
    gone: !window.hexwright.store.getPointFeature(code, featureType)
  }), setup);
  rec('inspect-panel delete removes exactly one feature',
    inspDelResult.gone && inspDelResult.after === beforeInspDel - 1,
    `before=${beforeInspDel} after=${inspDelResult.after}`);

  // Re-place for export + autosave checks (back into features mode, type still armed)
  await page.evaluate(() => window.hexwright.ui.setMode('features'));
  await sleep(100);
  await page.mouse.click(clickPt.x, clickPt.y);
  await sleep(150);

  const exportShape = await page.evaluate(() => {
    const obj = window.hexwright.store.exportFeaturesObject();
    return {
      ok: Array.isArray(obj.features) && obj.features.length >= 1,
      first: obj.features[0] || null,
      json: window.hexwright.store.exportFeaturesJson()
    };
  });
  rec('export features.json shape from UI store', exportShape.ok && exportShape.first?.code && exportShape.first?.type,
    JSON.stringify(exportShape.first));

  const copyOk = await page.evaluate(() => {
    const json = window.hexwright.store.exportFeaturesJson();
    const parsed = JSON.parse(json);
    return Array.isArray(parsed.features) && parsed.features.length >= 1;
  });
  rec('copy features uses canonical export', copyOk, 'exportFeaturesJson');

  await sleep(1200);
  const autosaveSlot = await page.evaluate(() => {
    const project = window.hexwright.store.exportProjectObject();
    const slug = String(project.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
    const raw = localStorage.getItem(`hexwright.session.${slug}`);
    if (!raw) return { ok: false, note: 'no slot' };
    const parsed = JSON.parse(raw);
    const feats = parsed.project?.features?.features || [];
    return { ok: feats.length >= 1, count: feats.length, code: feats[0]?.code };
  });
  rec('autosave persists features in project slot', autosaveSlot.ok, JSON.stringify(autosaveSlot));

  const manifestLoad = await page.evaluate(async () => {
    const payload = {
      _comment: 'fixture',
      features: [
        { code: '0010', type: 'city', name: 'Fix City', attrs: { vp: 2, bp: 1 } }
      ]
    };
    const store = window.hexwright.store;
    const before = Object.keys(store.state.features || {}).length;
    store.importFeatures(payload);
    const rec = store.getPointFeature('0010', 'city');
    return {
      imported: !!rec && rec.name === 'Fix City' && rec.attrs.vp === 2,
      before,
      after: Object.keys(store.state.features || {}).length
    };
  });
  rec('manifest-style features import loads into store', manifestLoad.imported, JSON.stringify(manifestLoad));

  rec('no uncaught console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('features-check harness completed', false, err.message);
}

await browser.close();
srv.kill();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
