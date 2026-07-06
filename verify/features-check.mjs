// Point-feature editing: place, edit attrs, delete, export shape, round-trip, autosave, manifest load.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ProjectStore, validateFeaturesDocument, syntheticHexFeaturesFromFeatures } from '../src/store.js';
import { GOTA_PROJECT_URL, PATHS, REPO_PARENT, REPO_NAME } from './_local-data.mjs';

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

// --- Unit: GotA capitol vp/bp parity with city (palette-driven; skip if local palette absent) ---
const GOTA_PALETTE_PATH = resolve(REPO, 'local/palettes/gota.json');
if (!existsSync(GOTA_PALETTE_PATH)) {
  console.log('SKIP GotA palette not present (local/palettes/gota.json)');
} else {
  const gotaPalette = JSON.parse(readFileSync(GOTA_PALETTE_PATH, 'utf8'));
  const cityDecl = gotaPalette.hexFeatures?.find((f) => f.key === 'city');
  const capitolDecl = gotaPalette.hexFeatures?.find((f) => f.key === 'capitol');
  const cityNumericKeys = (cityDecl?.attrs || []).filter((a) => a.type === 'number').map((a) => a.key);
  const capitolNumericKeys = (capitolDecl?.attrs || []).filter((a) => a.type === 'number').map((a) => a.key);
  rec('GotA capitol declares same numeric attrs as city (vp, bp)',
    cityNumericKeys.includes('vp') && cityNumericKeys.includes('bp') &&
    capitolNumericKeys.includes('vp') && capitolNumericKeys.includes('bp'),
    `city=${cityNumericKeys.join(',')} capitol=${capitolNumericKeys.join(',')}`);

  const gotaStore = new ProjectStore();
  gotaStore.setPalette(gotaPalette);
  gotaStore.state.features = {};
  gotaStore.setPointFeature('1001', 'capitol', { name: 'Test Capitol', attrs: { vp: 5, bp: 3 } });
  const capExported = gotaStore.exportFeaturesObject();
  const capItem = capExported.features.find((f) => f.type === 'capitol');
  rec('GotA capitol export includes vp+bp attrs',
    capItem?.attrs?.vp === 5 && capItem?.attrs?.bp === 3,
    JSON.stringify(capItem));

  gotaStore.setPointFeature('1002', 'capitol', { name: 'Default Capitol' });
  const capDefaults = gotaStore.getPointFeature('1002', 'capitol');
  rec('GotA capitol placement defaults vp+bp from palette schema',
    capDefaults?.attrs?.vp === 0 && capDefaults?.attrs?.bp === 0,
    JSON.stringify(capDefaults?.attrs));

  try {
    validateFeaturesDocument({
      features: [{ code: '2001', type: 'capitol', name: 'Imported', attrs: { vp: 2, bp: 1 } }]
    });
    rec('GotA capitol features import validates', true);
  } catch (err) {
    rec('GotA capitol features import validates', false, err.message);
  }
}

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
// Regression guard: no editing-path action should EVER trigger a real browser
// dialog again (a dialog-suppression extension makes confirm() silently
// return false with no visible failure — that was the whole bug). If one
// somehow fires, dismiss it (never let it hang the test) and fail loudly.
page.on('dialog', async (d) => { errors.push(`UNEXPECTED NATIVE DIALOG: ${d.message()}`); await d.dismiss(); });

try {
  await page.goto(`http://localhost:${PORT}/?project=${GOTA_PROJECT_URL}`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('count-land');
    return el && /[1-9]/.test(el.textContent);
  }, { timeout: 25000 });
  await sleep(1500);

  // Simulate the operator's actual reported state: dialogs suppressed on this
  // origin, so confirm()/alert() return immediately with no real dialog ever
  // shown. Every delete below must still work — this is the exact condition
  // that silently no-op'd the Inspect-panel × before the fix.
  await page.evaluate(() => {
    window.confirm = () => false;
    window.alert = () => {};
    window.prompt = () => null;
  });

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

  // No confirm() involved anymore — and window.confirm is stubbed to always
  // return false above, so if this still called confirm() the delete would
  // silently no-op and the assertion below would catch it.
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

  // --- Inspect-panel per-row Edit (bug fix 2026-07-05): #feature-inspector was missing
  // position:fixed entirely, so it rendered in normal document flow at (0,0) and was
  // ALWAYS painted behind the fixed-position #map-canvas — the panel unhid correctly
  // (a plain `.hidden` check passes) but was never visible on screen. Assert real
  // screen visibility (computed position + what's actually painted at its center),
  // not just the hidden attribute, or this regresses silently again. ---
  await page.click(`#hexed-point-feats .point-feat-row[data-pf-type="${setup.featureType}"] .pf-edit`);
  await sleep(200);

  const editVisible = await page.evaluate(() => {
    const fi = document.getElementById('feature-inspector');
    if (fi.hidden) return { hidden: true };
    const rect = fi.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    return {
      hidden: false,
      position: getComputedStyle(fi).position,
      onTop: !!(topEl && fi.contains(topEl))
    };
  });
  rec('inspect-panel Edit opens a genuinely on-screen editor (not just unhidden)',
    !editVisible.hidden && editVisible.position === 'fixed' && editVisible.onTop,
    JSON.stringify(editVisible));

  const vpAttrInput = page.locator('#feat-insp-attrs .feat-attr[data-attr-key="vp"]');
  const hasVpAttr = (await vpAttrInput.count()) > 0;
  rec('probe feature type has a vp attr to edit', hasVpAttr);
  if (hasVpAttr) {
    await vpAttrInput.click();
    await vpAttrInput.fill('42');
    await page.click('#feat-insp-save');
    await sleep(200);

    const savedVp = await page.evaluate(({ code, featureType }) =>
      window.hexwright.store.getPointFeature(code, featureType)?.attrs?.vp, setup);
    rec('inspect-panel Edit save persists the attr change through the store',
      Number(savedVp) === 42, `vp=${savedVp}`);

    await page.evaluate(({ code }) => {
      const ui = window.hexwright.ui;
      ui.setMode('inspect');
      ui.openInspector(code);
    }, setup);
    await sleep(150);
    const rowAfterEdit = await page.evaluate(({ featureType }) => {
      const row = document.querySelector(`#hexed-point-feats .point-feat-row[data-pf-type="${featureType}"]`);
      return row ? row.textContent : '';
    }, setup);
    rec('re-inspect shows the edited value', /42/.test(rowAfterEdit), rowAfterEdit.trim().replace(/\s+/g, ' ').slice(0, 80));
  }

  const beforeInspDel = await page.evaluate(({ code }) =>
    window.hexwright.store.getPointFeaturesAt(code).length, setup);
  // Real click on the Inspect-panel × (the exact control the operator hit
  // suppressed-confirm on). window.confirm is stubbed to false above; the
  // click must still delete, unassisted by any dialog.
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

  // --- Add-from-Inspect + name inheritance (2026-07-05): adding a feature must
  // be possible directly from the Inspect panel (no detour through Features
  // mode), and its name field must default to the hex's own name when the hex
  // is already named (editable, never a blank required-feeling field). Uses a
  // fresh, isolated hex (via the store API, not a mouse click) so it can't
  // interfere with any other case's assumptions about hex/feature state. ---
  const addSetup = await page.evaluate(({ excludeCode }) => {
    const { store } = window.hexwright;
    const codes = Object.keys(store.centers || {});
    return codes.find((c) => c !== excludeCode && store.getPointFeaturesAt(c).length === 0) || null;
  }, { excludeCode: setup.code });
  rec('found an isolated hex for the Add-from-Inspect check', !!addSetup, addSetup);

  if (addSetup) {
    await page.evaluate(({ code }) => {
      const { store, ui } = window.hexwright;
      store.setHexName(code, 'Testhaven');
      ui.setMode('inspect');
      ui.openInspector(code);
    }, { code: addSetup });
    await sleep(200);

    const addRowState = await page.evaluate(() => {
      const wrap = document.getElementById('hexed-point-feat-add');
      const select = document.getElementById('hexed-add-feat-select');
      return { hidden: wrap?.hidden, options: select ? Array.from(select.options).map((o) => o.value) : [] };
    });
    rec('inspect panel offers an Add-feature control for available types',
      !addRowState.hidden && addRowState.options.length > 0, JSON.stringify(addRowState));

    if (addRowState.options.length) {
      const addType = addRowState.options[0];
      await page.selectOption('#hexed-add-feat-select', addType);
      await page.click('#hexed-add-feat-btn');
      await sleep(200);

      const addVisible = await page.evaluate(() => {
        const fi = document.getElementById('feature-inspector');
        if (fi.hidden) return { hidden: true };
        const rect = fi.getBoundingClientRect();
        const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          hidden: false,
          position: getComputedStyle(fi).position,
          onTop: !!(topEl && fi.contains(topEl)),
          nameValue: document.getElementById('feat-insp-name')?.value
        };
      });
      rec('Add-from-Inspect opens a genuinely on-screen editor',
        !addVisible.hidden && addVisible.position === 'fixed' && addVisible.onTop, JSON.stringify(addVisible));
      rec('Add-from-Inspect pre-fills the name field from the hex name (editable, not blank)',
        addVisible.nameValue === 'Testhaven', `name="${addVisible.nameValue}"`);

      await page.click('#feat-insp-save');
      await sleep(200);
      const addedRec = await page.evaluate(({ code, type }) =>
        window.hexwright.store.getPointFeature(code, type), { code: addSetup, type: addType });
      rec('Add-from-Inspect saves through the same store mutation path',
        !!addedRec && addedRec.name === 'Testhaven', JSON.stringify(addedRec));
    }
  }

  rec('no uncaught console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('features-check harness completed', false, err.message);
}

await browser.close();
srv.kill();
}

// --- Side-by-side TWU-EP parity (operator's real project; gitignored local
// state, skip when absent). Confirms the Edit-visibility fix + attr editing
// work identically on TWU's own palette/data, not just GotA's — the palette
// declares attrs just as richly as GotA's (fortress: sp, vp: vp), so the two
// projects are expected to behave IDENTICALLY, not differently. ---
if (!existsSync(PATHS.twuEpProject)) {
  console.log('SKIP TWU-EP local project not present (local/twu-ep/project.json)');
} else {
  const TWU_PORT = 8033;
  // Serve the PARENT dir: twu-ep/project.json's map path escapes the repo
  // (see "Launch Hexwright - TWU East Prussia.command").
  const twuSrv = spawn('python3', ['-m', 'http.server', String(TWU_PORT)], { cwd: REPO_PARENT, stdio: 'ignore' });
  await sleep(1300);

  const twuBrowser = await chromium.launch();
  const twuPage = await twuBrowser.newPage({ viewport: { width: 1500, height: 980 } });
  const twuErrors = [];
  twuPage.on('console', (m) => { if (m.type() === 'error') twuErrors.push(m.text()); });
  twuPage.on('pageerror', (e) => twuErrors.push(`PAGEERROR: ${e.message}`));

  try {
    await twuPage.goto(`http://localhost:${TWU_PORT}/${REPO_NAME}/?project=local/twu-ep/project.json`, { waitUntil: 'load', timeout: 20000 });
    await twuPage.waitForFunction(() => {
      const el = document.getElementById('count-land');
      return el && /[1-9]/.test(el.textContent);
    }, { timeout: 25000 });
    await sleep(1000);

    // Real fortress hex from the operator's own features.json, via the exact
    // Inspect-panel Edit control (not a JS shortcut).
    await twuPage.evaluate(() => {
      const ui = window.hexwright.ui;
      ui.setMode('inspect');
      ui.openInspector('3506');
    });
    await sleep(200);

    const hasEditRow = await twuPage.evaluate(() =>
      !!document.querySelector('#hexed-point-feats .point-feat-row[data-pf-type="fortress"] .pf-edit'));
    rec('TWU-EP: inspect panel lists the real fortress feature with Edit', hasEditRow);

    await twuPage.click('#hexed-point-feats .point-feat-row[data-pf-type="fortress"] .pf-edit');
    await sleep(200);

    const twuVisible = await twuPage.evaluate(() => {
      const fi = document.getElementById('feature-inspector');
      if (fi.hidden) return { hidden: true };
      const rect = fi.getBoundingClientRect();
      const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { hidden: false, position: getComputedStyle(fi).position, onTop: !!(topEl && fi.contains(topEl)) };
    });
    rec('TWU-EP: Edit opens a genuinely on-screen editor (parity with GotA)',
      !twuVisible.hidden && twuVisible.position === 'fixed' && twuVisible.onTop, JSON.stringify(twuVisible));

    const spInput = twuPage.locator('#feat-insp-attrs .feat-attr[data-attr-key="sp"]');
    const hasSpAttr = (await spInput.count()) > 0;
    rec('TWU-EP: fortress palette declares an editable SP attr', hasSpAttr);
    if (hasSpAttr) {
      await spInput.click();
      await spInput.fill('9');
      await twuPage.click('#feat-insp-save');
      await sleep(200);
      const afterSp = await twuPage.evaluate(() => window.hexwright.store.getPointFeature('3506', 'fortress')?.attrs?.sp);
      rec('TWU-EP: SP edit saves through the store', Number(afterSp) === 9, `sp=${afterSp}`);
    }

    // Add-from-Inspect + name inheritance, on a fresh isolated TWU hex (parity
    // with the GotA case above — same code path, real project data).
    const twuAddSetup = await twuPage.evaluate(() => {
      const { store } = window.hexwright;
      const codes = Object.keys(store.centers || {});
      return codes.find((c) => c !== '3506' && store.getPointFeaturesAt(c).length === 0) || null;
    });
    rec('TWU-EP: found an isolated hex for the Add-from-Inspect check', !!twuAddSetup, twuAddSetup);

    if (twuAddSetup) {
      await twuPage.evaluate(({ code }) => {
        const { store, ui } = window.hexwright;
        store.setHexName(code, 'Testhaven');
        ui.setMode('inspect');
        ui.openInspector(code);
      }, { code: twuAddSetup });
      await sleep(200);

      const twuAddRowState = await twuPage.evaluate(() => {
        const wrap = document.getElementById('hexed-point-feat-add');
        const select = document.getElementById('hexed-add-feat-select');
        return { hidden: wrap?.hidden, options: select ? Array.from(select.options).map((o) => o.value) : [] };
      });
      rec('TWU-EP: inspect panel offers an Add-feature control for available types',
        !twuAddRowState.hidden && twuAddRowState.options.length > 0, JSON.stringify(twuAddRowState));

      if (twuAddRowState.options.length) {
        const twuAddType = twuAddRowState.options[0];
        await twuPage.selectOption('#hexed-add-feat-select', twuAddType);
        await twuPage.click('#hexed-add-feat-btn');
        await sleep(200);

        const twuAddVisible = await twuPage.evaluate(() => {
          const fi = document.getElementById('feature-inspector');
          if (fi.hidden) return { hidden: true };
          const rect = fi.getBoundingClientRect();
          const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            hidden: false,
            position: getComputedStyle(fi).position,
            onTop: !!(topEl && fi.contains(topEl)),
            nameValue: document.getElementById('feat-insp-name')?.value
          };
        });
        rec('TWU-EP: Add-from-Inspect opens a genuinely on-screen editor',
          !twuAddVisible.hidden && twuAddVisible.position === 'fixed' && twuAddVisible.onTop, JSON.stringify(twuAddVisible));
        rec('TWU-EP: Add-from-Inspect pre-fills the name field from the hex name',
          twuAddVisible.nameValue === 'Testhaven', `name="${twuAddVisible.nameValue}"`);

        await twuPage.click('#feat-insp-save');
        await sleep(200);
        const twuAddedRec = await twuPage.evaluate(({ code, type }) =>
          window.hexwright.store.getPointFeature(code, type), { code: twuAddSetup, type: twuAddType });
        rec('TWU-EP: Add-from-Inspect saves through the same store mutation path',
          !!twuAddedRec && twuAddedRec.name === 'Testhaven', JSON.stringify(twuAddedRec));
      }
    }

    rec('TWU-EP: no uncaught console/page errors', twuErrors.length === 0, twuErrors.slice(0, 4).join(' | '));
  } catch (err) {
    rec('TWU-EP parity check completed', false, err.message);
  }

  await twuBrowser.close();
  twuSrv.kill();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
