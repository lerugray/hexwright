// Point-to-point mode: nodes import, edges export/import, dedup, orphans, round-trip.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ProjectStore } from '../src/store.js';
import {
  validateNodesDocument,
  validateEdgesDocument,
  findDuplicateEdges,
  findOrphanNodeIds,
  findMissingNodeRefs,
  nodePairKey
} from '../src/ptp.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PALETTE = JSON.parse(readFileSync(resolve(REPO, 'verify/fixtures/ptp-palette.json'), 'utf8'));
const FIXTURE_NODES = JSON.parse(readFileSync(resolve(REPO, 'verify/fixtures/ptp-nodes.json'), 'utf8'));
const FIXTURE_EDGES = JSON.parse(readFileSync(resolve(REPO, 'verify/fixtures/ptp-edges.json'), 'utf8'));
const PTP_PROJECT_URL = 'samples/ptp-fixture-project.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

// --- Unit: nodes validation ---
try {
  validateNodesDocument(FIXTURE_NODES);
  rec('nodes fixture validates', true);
} catch (err) {
  rec('nodes fixture validates', false, err.message);
}

try {
  validateNodesDocument({ nodes: [{ id: 'a', name: 'A', x: 1, y: 2 }, { id: 'a', name: 'B', x: 3, y: 4 }] });
  rec('duplicate node id fails loudly', false, 'no throw');
} catch (err) {
  rec('duplicate node id fails loudly', /duplicate/i.test(err.message), err.message.slice(0, 60));
}

// --- Unit: export shape + dedup + orphans ---
const store = new ProjectStore();
store.setPalette(FIXTURE_PALETTE);
store.importNodes(FIXTURE_NODES, { skipUndo: true });
store.setPtpEdge('alpha', 'beta', 'road');
store.setPtpEdge('beta', 'gamma', 'rail');

const exported = store.exportPtpEdgesObject();
rec('export has _comment + edges array', exported._comment && Array.isArray(exported.edges), exported._comment?.slice(0, 30));
rec('export meta.count per type', exported.meta?.count?.road === 1 && exported.meta?.count?.rail === 1,
  JSON.stringify(exported.meta?.count));

const dupes = findDuplicateEdges(exported.edges);
rec('export no duplicate edge pairs', dupes.length === 0, dupes.join(','));

rec('export canonical a<b', exported.edges.every((e) => e.a < e.b), `${exported.edges.length} edges`);

const orphans = findOrphanNodeIds(store.state.nodes, store.state.ptpEdges);
rec('orphan-node warning lists delta (zero edges)', orphans.includes('delta') && orphans.length === 1,
  orphans.join(','));

// Missing node ref detection
store.state.ptpEdges['alpha|ghost'] = 'road';
const missing = findMissingNodeRefs(store.state.nodes, store.state.ptpEdges);
rec('missing node ref detected', missing.some((m) => m.nodeId === 'ghost'), JSON.stringify(missing));

delete store.state.ptpEdges['alpha|ghost'];

try {
  validateEdgesDocument(exported);
  rec('export passes validateEdgesDocument', true);
} catch (err) {
  rec('export passes validateEdgesDocument', false, err.message);
}

// Round-trip
const round = new ProjectStore();
round.setPalette(FIXTURE_PALETTE);
round.importNodes(FIXTURE_NODES, { skipUndo: true });
round.importPtpEdges(exported, { skipUndo: true });
const reExported = round.exportPtpEdgesObject();
rec('round-trip export identical', JSON.stringify(exported.edges) === JSON.stringify(reExported.edges));

try {
  validateEdgesDocument({ edges: [{ a: 'b', b: 'a', type: 'road' }] });
  rec('non-canonical a<b rejected on import', false, 'no throw');
} catch (err) {
  rec('non-canonical a<b rejected on import', /canonical/i.test(err.message), err.message.slice(0, 60));
}

// Per-type dedup: setting same pair twice keeps one entry
const dedupStore = new ProjectStore();
dedupStore.setPalette(FIXTURE_PALETTE);
dedupStore.importNodes(FIXTURE_NODES, { skipUndo: true });
dedupStore.setPtpEdge('alpha', 'beta', 'road');
dedupStore.setPtpEdge('alpha', 'beta', 'rail');
rec('per-type dedup: one edge per pair', dedupStore.countPtpEdges() === 1,
  `count=${dedupStore.countPtpEdges()} type=${dedupStore.getPtpEdge('alpha', 'beta')}`);

// --- Headless UI harness ---
const PORT = 8040;
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

  const isPtp = await page.evaluate(() => window.hexwright.store.isPtp());
  rec('fixture manifest loads as ptp', isPtp);

  const edgeCount = await page.evaluate(() => window.hexwright.store.countPtpEdges());
  rec('fixture edges imported', edgeCount === 2, `count=${edgeCount}`);

  await page.evaluate(() => {
    window.hexwright.ui.setMode('edges');
    window.hexwright.ui.setPtpEdgeType('road');
    window.hexwright.renderer.fitView();
  });
  await sleep(200);

  const orphanWarn = await page.evaluate(() => {
    const orphans = window.hexwright.store.getOrphanNodeIds();
    const el = document.getElementById('ptp-orphan-warn');
    return { orphans, hidden: el?.hidden, text: el?.textContent || '' };
  });
  rec('orphan warning visible in layers panel',
    !orphanWarn.hidden && /orphan/i.test(orphanWarn.text), orphanWarn.text);

  const placed = await page.evaluate(() => {
    const { store, renderer } = window.hexwright;
    const nodes = store.state.nodes;
    const a = renderer.worldToScreen({ x: nodes.gamma.x, y: nodes.gamma.y });
    const b = renderer.worldToScreen({ x: nodes.delta.x, y: nodes.delta.y });
    const canvas = document.getElementById('map-canvas');
    const box = canvas.getBoundingClientRect();
    return { a, b, box: { x: box.x, y: box.y } };
  });

  const clickAt = async (pt) => {
    await page.mouse.click(placed.box.x + pt.x, placed.box.y + pt.y);
    await sleep(150);
  };

  await clickAt(placed.a);
  await clickAt(placed.b);

  const newEdge = await page.evaluate(() => window.hexwright.store.getPtpEdge('delta', 'gamma'));
  rec('click node A then B creates edge', newEdge === 'road', `type=${newEdge}`);

  const exportFromUi = await page.evaluate(() => window.hexwright.store.exportPtpEdgesObject());
  rec('UI export shape', Array.isArray(exportFromUi.edges) && exportFromUi.edges.length >= 3,
    `edges=${exportFromUi.edges?.length}`);

  const importRound = await page.evaluate((payload) => {
    const store = window.hexwright.store;
    const before = JSON.stringify(store.exportPtpEdgesObject().edges);
    store.importPtpEdges(payload);
    const after = JSON.stringify(store.exportPtpEdgesObject().edges);
    store.importPtpEdges(payload);
    return { before, after };
  }, exportFromUi);
  rec('UI round-trip import/export equality',
    importRound.before === JSON.stringify(exportFromUi.edges) &&
    importRound.after === JSON.stringify(exportFromUi.edges));

  rec('no uncaught console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('ptp-check harness completed', false, err.message);
}

await browser.close();
srv.kill();

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
