// Point-to-point node-features tagging: palette schema, store API, export/import
// round-trip, draft-shape (commission-repo space-attrs-draft.json) conversion,
// unknown-id warning, badge rendering.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ProjectStore, validateNodeAttrsDocument, draftSpacesToNodeAttrs } from '../src/store.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PALETTE = JSON.parse(readFileSync(resolve(REPO, 'verify/fixtures/ptp-palette.json'), 'utf8'));
const FIXTURE_NODES = JSON.parse(readFileSync(resolve(REPO, 'verify/fixtures/ptp-nodes.json'), 'utf8'));
const PTP_PROJECT_URL = 'verify/fixtures/ptp-fixture-project.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

// --- Unit: palette schema ---
rec('fixture palette declares nodeFeatures (flag/level/enum)',
  Array.isArray(FIXTURE_PALETTE.nodeFeatures) && FIXTURE_PALETTE.nodeFeatures.length === 3,
  JSON.stringify(FIXTURE_PALETTE.nodeFeatures?.map((f) => `${f.key}:${f.kind}`)));

// --- Unit: store tagging API ---
const store = new ProjectStore();
store.setPalette(FIXTURE_PALETTE);
store.importNodes(FIXTURE_NODES, { skipUndo: true });

rec('setNodeAttr tags a flag feature', store.setNodeAttr('alpha', 'vp', true) === true);
rec('getNodeAttrs reflects the tag', store.getNodeAttrs('alpha').vp === true);
rec('countNodeFeatureTagged counts it', store.countNodeFeatureTagged('vp') === 1);

store.setNodeAttr('beta', 'fortress', 3);
rec('setNodeAttr tags a level feature', store.getNodeAttrs('beta').fortress === 3);

store.setNodeAttr('gamma', 'terrain', 'forest');
rec('setNodeAttr tags an enum feature', store.getNodeAttrs('gamma').terrain === 'forest');

const clearedOk = store.clearNodeAttr('alpha', 'vp');
rec('clearNodeAttr removes the tag', clearedOk === true && store.getNodeAttrs('alpha').vp === undefined);
store.setNodeAttr('alpha', 'vp', true); // retag for the rest of the suite

const bulkOk = store.setNodeAttrs('delta', { vp: true, fortress: 2, terrain: null });
const deltaAfterBulk = store.getNodeAttrs('delta');
rec('setNodeAttrs bulk-writes + clears in one call',
  bulkOk === true && deltaAfterBulk.vp === true && deltaAfterBulk.fortress === 2 && !('terrain' in deltaAfterBulk));

rec('undo reverts a node-attr tag', (() => {
  const before = store.countNodeFeatureTagged('fortress');
  store.setNodeAttr('gamma', 'fortress', 1);
  const mid = store.countNodeFeatureTagged('fortress');
  store.undo();
  const after = store.countNodeFeatureTagged('fortress');
  return before + 1 === mid && after === before;
})());

// --- Unit: export shape + sort + validate + round-trip ---
const exported = store.exportNodeAttrsObject();
rec('export has meta.version + spaces object', exported.meta?.version === 1 && typeof exported.spaces === 'object');
const spaceIds = Object.keys(exported.spaces);
rec('export spaces sorted by node id',
  JSON.stringify(spaceIds) === JSON.stringify([...spaceIds].sort((a, b) => a.localeCompare(b))));

try {
  validateNodeAttrsDocument(exported);
  rec('export passes validateNodeAttrsDocument', true);
} catch (err) {
  rec('export passes validateNodeAttrsDocument', false, err.message);
}

const round = new ProjectStore();
round.setPalette(FIXTURE_PALETTE);
round.importNodes(FIXTURE_NODES, { skipUndo: true });
const importResult = round.importNodeAttrs(exported, { skipUndo: true });
const reExported = round.exportNodeAttrsObject();
rec('round-trip export identical', JSON.stringify(exported.spaces) === JSON.stringify(reExported.spaces));
rec('round-trip import reports no unknown ids', importResult.unknown.length === 0);

// --- Unit: unknown node id — loud warning, not silent drop ---
const withUnknown = { meta: { version: 1 }, spaces: { ...exported.spaces, ghost: { vp: true } } };
const unknownResult = round.importNodeAttrs(withUnknown, { skipUndo: true });
rec('unknown node id reported in import result', unknownResult.unknown.includes('ghost'));
rec('unknown node id excluded from imported state', !('ghost' in round.state.nodeAttrs));

// --- Unit: bulk layer clear ---
const clearCount = round.clearNodeFeatureLayer('vp');
rec('clearNodeFeatureLayer clears every vp tag', clearCount > 0 && round.countNodeFeatureTagged('vp') === 0);

// --- Unit: draft-shape import (commission-repo space-attrs-draft.json compat) ---
const draftStore = new ProjectStore();
draftStore.setPalette(FIXTURE_PALETTE);
draftStore.importNodes(FIXTURE_NODES, { skipUndo: true });

const fieldMap = {
  fortress: { feature: 'fortress', kind: 'level' },
  vpSpace: { feature: 'vp', kind: 'flag' },
  capital: { feature: 'vp', kind: 'flag' }, // non-boolean truthy value (a country code) must still set the flag
  terrain: { feature: 'terrain', kind: 'enum' }
};
const draftDoc = {
  spaces: {
    alpha: { fortress: 2, notes: 'ignored — no palette mapping' },
    beta: { vpSpace: true },
    gamma: { terrain: 'forest' },
    delta: { terrain: 'ocean', capital: 'FR' }, // 'ocean' invalid enum; capital -> vp flag
    ghost: { vpSpace: true } // unknown node id
  }
};
const draftResult = draftStore.importNodeAttrs(draftDoc, { fieldMap, skipUndo: true });

rec('draft-shape: level field maps to palette feature', draftStore.getNodeAttrs('alpha').fortress === 2);
rec('draft-shape: unmapped draft field (notes) ignored without error', !('notes' in draftStore.getNodeAttrs('alpha')));
rec('draft-shape: bool flag field maps correctly', draftStore.getNodeAttrs('beta').vp === true);
rec('draft-shape: enum field maps correctly', draftStore.getNodeAttrs('gamma').terrain === 'forest');
rec('draft-shape: non-boolean truthy value still sets a flag', draftStore.getNodeAttrs('delta').vp === true);
rec('draft-shape: invalid enum value skipped, not written', !('terrain' in draftStore.getNodeAttrs('delta')));
rec('draft-shape: invalid enum value reported in skipped[]',
  draftResult.skipped.some((s) => s.nodeId === 'delta' && s.draftKey === 'terrain'));
rec('draft-shape: unknown node id reported, not silently dropped', draftResult.unknown.includes('ghost'));

// --- Headless UI harness ---
const PORT = 8041;
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await sleep(1300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

try {
  await page.goto(`http://localhost:${PORT}/?project=${PTP_PROJECT_URL}`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('count-land');
    return el && el.textContent === '4';
  }, { timeout: 15000 });
  await sleep(800);

  const paletteLoaded = await page.evaluate(() => {
    const nf = window.hexwright.store.getPalette()?.nodeFeatures || [];
    return nf.map((f) => f.key);
  });
  rec('palette nodeFeatures load in the running app',
    JSON.stringify(paletteLoaded) === JSON.stringify(['fortress', 'vp', 'terrain']), JSON.stringify(paletteLoaded));

  // Enter node-features mode, arm the flag feature, enable paint mode.
  await page.evaluate(() => {
    const { ui } = window.hexwright;
    ui.setMode('nodeFeatures');
    ui.setNodeFeaturePaintType('vp');
    ui.nodeFeaturePaintMode = true;
    ui._renderNodeFeaturePaintControls();
  });
  await sleep(150);

  const toolShown = await page.evaluate(() => !document.getElementById('tool-node-features').hidden);
  rec('ptp mode reveals the node-features tool button', toolShown);

  const nodeScreen = await page.evaluate(() => {
    const { store, renderer } = window.hexwright;
    const node = store.state.nodes.gamma;
    const pt = renderer.worldToScreen({ x: node.x, y: node.y });
    const canvas = document.getElementById('map-canvas');
    const box = canvas.getBoundingClientRect();
    return { x: box.x + pt.x, y: box.y + pt.y };
  });
  await page.mouse.click(nodeScreen.x, nodeScreen.y);
  await sleep(200);

  const taggedViaClick = await page.evaluate(() => window.hexwright.store.getNodeAttrs('gamma').vp === true);
  rec('paint-mode click tags the active feature via store API', taggedViaClick);

  // Alt-click clears it. page.mouse.click() has no `modifiers` option (that's a
  // locator/elementHandle-click-only field) — hold the key via the keyboard API.
  await page.keyboard.down('Alt');
  await page.mouse.click(nodeScreen.x, nodeScreen.y);
  await page.keyboard.up('Alt');
  await sleep(200);
  const clearedViaAltClick = await page.evaluate(() => window.hexwright.store.getNodeAttrs('gamma').vp === undefined);
  rec('alt-click in paint mode clears the active feature', clearedViaAltClick);

  // Re-tag + verify the canvas actually paints a badge chip (pixel check, not just state).
  await page.evaluate(() => {
    const { store, renderer } = window.hexwright;
    store.setNodeAttr('gamma', 'vp', true);
    renderer.draw();
  });
  await sleep(150);

  const badgePixel = await page.evaluate(() => {
    const { store, renderer } = window.hexwright;
    const node = store.state.nodes.gamma;
    const s = renderer.view.baseScale * renderer.view.zoom;
    const chipCenterWorld = { x: node.x, y: node.y - (7 / s) - (5.5 / s) - (3 / s) };
    const pt = renderer.worldToScreen(chipCenterWorld);
    const canvas = document.getElementById('map-canvas');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const data = ctx.getImageData(Math.round(pt.x * dpr), Math.round(pt.y * dpr), 1, 1).data;
    return [data[0], data[1], data[2]];
  });
  // vp's palette color is #c0392b = rgb(192, 57, 43) — allow modest AA/scale tolerance.
  const closeToVpColor = Math.abs(badgePixel[0] - 192) < 40 && Math.abs(badgePixel[1] - 57) < 40 && Math.abs(badgePixel[2] - 43) < 40;
  rec('tagged node badge chip renders in the vp feature color', closeToVpColor, JSON.stringify(badgePixel));

  // Layers-panel: per-feature row present with a live count.
  const layerRow = await page.evaluate(() => {
    const rows = document.getElementById('node-feature-layer-rows');
    return { hidden: document.getElementById('node-feature-layer-wrap').hidden, html: rows?.innerHTML || '' };
  });
  rec('node-feature-layer-wrap is visible with tagged-count rows',
    !layerRow.hidden && /vp/.test(layerRow.html) && /fortress/.test(layerRow.html), layerRow.html.slice(0, 120));

  // Node inspector: click without paint mode opens the batch editor.
  await page.evaluate(() => {
    const { ui } = window.hexwright;
    ui.nodeFeaturePaintMode = false;
  });
  await page.mouse.click(nodeScreen.x, nodeScreen.y);
  await sleep(150);
  const inspectorOpen = await page.evaluate(() => !document.getElementById('node-feature-inspector').hidden);
  rec('non-paint-mode click opens the node feature inspector', inspectorOpen);

  await page.evaluate(() => window.hexwright.ui.closeNodeInspector());

  rec('no uncaught console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('attrs-check harness completed', false, err.message);
}

await browser.close();
srv.kill();

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
