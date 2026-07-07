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

// --- Unit: FtP palette declares resource as a numeric level feature (the
// printed Strategic Will value on Confederate resource spaces) — guards
// against a regression back to flag-only tagging.
{
  const ftpPalette = JSON.parse(readFileSync(resolve(REPO, 'palettes/ftp.json'), 'utf8'));
  const resource = (ftpPalette.nodeFeatures || []).find((f) => f.key === 'resource');
  rec('FtP palette: resource is a level (numeric) node feature',
    resource?.kind === 'level' && Number.isFinite(resource?.max),
    JSON.stringify(resource));
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
store.state.ptpEdges['alpha|ghost|road'] = 'road';
const missing = findMissingNodeRefs(store.state.nodes, store.state.ptpEdges);
rec('missing node ref detected', missing.some((m) => m.nodeId === 'ghost'), JSON.stringify(missing));

delete store.state.ptpEdges['alpha|ghost|road'];

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

// Per-type dedup: parallel types on same pair coexist; same-type dup rejected
const parallelStore = new ProjectStore();
parallelStore.setPalette(FIXTURE_PALETTE);
parallelStore.importNodes(FIXTURE_NODES, { skipUndo: true });
parallelStore.setPtpEdge('alpha', 'beta', 'road');
parallelStore.setPtpEdge('alpha', 'beta', 'rail');
rec('parallel edges: road+rail same pair coexist', parallelStore.countPtpEdges() === 2,
  `count=${parallelStore.countPtpEdges()}`);

const sameTypeDup = parallelStore.setPtpEdge('alpha', 'beta', 'road');
rec('same-type duplicate rejected', sameTypeDup === false && parallelStore.countPtpEdges() === 2,
  `ret=${sameTypeDup} count=${parallelStore.countPtpEdges()}`);

const parallelExported = parallelStore.exportPtpEdgesObject();
const parallelRound = new ProjectStore();
parallelRound.setPalette(FIXTURE_PALETTE);
parallelRound.importNodes(FIXTURE_NODES, { skipUndo: true });
parallelRound.importPtpEdges(parallelExported, { skipUndo: true });
rec('parallel edges export round-trip',
  parallelRound.countPtpEdges() === 2 &&
  parallelRound.getPtpEdge('alpha', 'beta', 'road') === 'road' &&
  parallelRound.getPtpEdge('alpha', 'beta', 'rail') === 'rail');

const parallelDupes = findDuplicateEdges(parallelExported.edges);
rec('parallel export no duplicate (a,b,type)', parallelDupes.length === 0, parallelDupes.join(','));

// --- Unit: explicit edge deletion (per-type identity) ---
{
  const delStore = new ProjectStore();
  delStore.setPalette(FIXTURE_PALETTE);
  delStore.importNodes(FIXTURE_NODES, { skipUndo: true });
  delStore.setPtpEdge('alpha', 'beta', 'road');
  delStore.setPtpEdge('alpha', 'beta', 'rail');
  delStore.deletePtpEdge('alpha', 'beta', 'road');
  rec('delete: removes only the selected edge type on a parallel pair',
    delStore.getPtpEdge('alpha', 'beta', 'road') === null &&
    delStore.getPtpEdge('alpha', 'beta', 'rail') === 'rail' &&
    delStore.countPtpEdges() === 1,
    `count=${delStore.countPtpEdges()}`);

  const undoStore = new ProjectStore();
  undoStore.setPalette(FIXTURE_PALETTE);
  undoStore.importNodes(FIXTURE_NODES, { skipUndo: true });
  undoStore.setPtpEdge('alpha', 'beta', 'road');
  undoStore.setPtpEdge('alpha', 'beta', 'rail');
  undoStore.deletePtpEdge('alpha', 'beta', 'road');
  undoStore.undo();
  rec('delete: undo restores the deleted edge',
    undoStore.getPtpEdge('alpha', 'beta', 'road') === 'road' &&
    undoStore.getPtpEdge('alpha', 'beta', 'rail') === 'rail');

  const expStore = new ProjectStore();
  expStore.setPalette(FIXTURE_PALETTE);
  expStore.importNodes(FIXTURE_NODES, { skipUndo: true });
  expStore.setPtpEdge('alpha', 'beta', 'road');
  expStore.setPtpEdge('alpha', 'beta', 'rail');
  expStore.deletePtpEdge('alpha', 'beta', 'road');
  const afterDelExport = expStore.exportPtpEdgesObject();
  const impStore = new ProjectStore();
  impStore.setPalette(FIXTURE_PALETTE);
  impStore.importNodes(FIXTURE_NODES, { skipUndo: true });
  impStore.importPtpEdges(afterDelExport, { skipUndo: true });
  rec('delete: export/import round-trip keeps deletion',
    impStore.countPtpEdges() === 1 &&
    impStore.getPtpEdge('alpha', 'beta', 'rail') === 'rail' &&
    !impStore.getPtpEdge('alpha', 'beta', 'road'));
}

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

  // --- Inspect tool (p2p): toolbar entry, panel actually visible on-screen
  // (the 2026-07-05/06 position:fixed lesson — check geometry, not just
  // hidden=false), in-place numeric edit, node-vs-edge hit precedence. ---
  const inspectToolState = await page.evaluate(() => {
    const { ui } = window.hexwright;
    ui.setMode('inspect');
    const btn = document.getElementById('tool-inspect');
    return { hidden: btn.hidden, mode: ui.mode, active: btn.classList.contains('is-active') };
  });
  rec('inspect tool visible + selectable in p2p',
    !inspectToolState.hidden && inspectToolState.mode === 'inspect' && inspectToolState.active,
    JSON.stringify(inspectToolState));

  const alphaPt = await page.evaluate(() => {
    const { store, renderer } = window.hexwright;
    const n = store.state.nodes.alpha;
    const pt = renderer.worldToScreen({ x: n.x, y: n.y });
    const box = document.getElementById('map-canvas').getBoundingClientRect();
    return { x: box.x + pt.x, y: box.y + pt.y };
  });
  await page.mouse.click(alphaPt.x, alphaPt.y);
  await sleep(200);

  const nodeInsp = await page.evaluate(() => {
    const panel = document.getElementById('node-feature-inspector');
    const r = panel.getBoundingClientRect();
    return {
      hidden: panel.hidden,
      onScreen: r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 &&
        r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      meta: document.getElementById('node-insp-meta')?.textContent || '',
      hasLevelInput: !!panel.querySelector('.node-feat-level[data-node-feat-key="fortress"]')
    };
  });
  rec('inspect: node click opens node inspector, visibly on-screen',
    !nodeInsp.hidden && nodeInsp.onScreen, JSON.stringify(nodeInsp));
  rec('inspect: node inspector shows id meta + numeric level field',
    /id alpha/.test(nodeInsp.meta) && nodeInsp.hasLevelInput, `meta="${nodeInsp.meta}"`);

  await page.fill('#node-feature-inspector .node-feat-level[data-node-feat-key="fortress"]', '3');
  await page.click('#node-insp-save');
  await sleep(150);
  const savedLevel = await page.evaluate(() => window.hexwright.store.getNodeAttrs('alpha').fortress);
  rec('inspect: numeric value editable in place (fortress=3 saved)',
    savedLevel === 3, `value=${JSON.stringify(savedLevel)}`);

  const precision = await page.evaluate(() => {
    const { store, renderer } = window.hexwright;
    const a = store.state.nodes.alpha;
    const b = store.state.nodes.beta;
    const pa = renderer.worldToScreen({ x: a.x, y: a.y });
    const pb = renderer.worldToScreen({ x: b.x, y: b.y });
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    const ux = (pb.x - pa.x) / len;
    const uy = (pb.y - pa.y) / len;
    const box = document.getElementById('map-canvas').getBoundingClientRect();
    return {
      nearNode: { x: box.x + pa.x + ux * 8, y: box.y + pa.y + uy * 8 },
      midEdge: { x: box.x + (pa.x + pb.x) / 2, y: box.y + (pa.y + pb.y) / 2 }
    };
  });
  await page.mouse.click(precision.midEdge.x, precision.midEdge.y);
  await sleep(200);
  const edgeInsp = await page.evaluate(() => ({
    edgeHidden: document.getElementById('ptp-edge-inspector').hidden,
    nodeHidden: document.getElementById('node-feature-inspector').hidden,
    title: document.getElementById('ptp-edge-insp-title').textContent
  }));
  rec('inspect: edge click opens per-edge inspector (node inspector closed)',
    !edgeInsp.edgeHidden && edgeInsp.nodeHidden && /alpha/.test(edgeInsp.title) && /beta/.test(edgeInsp.title),
    JSON.stringify(edgeInsp));

  await page.mouse.click(precision.nearNode.x, precision.nearNode.y);
  await sleep(200);
  const nodeWins = await page.evaluate(() => ({
    nodeHidden: document.getElementById('node-feature-inspector').hidden,
    edgeHidden: document.getElementById('ptp-edge-inspector').hidden,
    title: document.getElementById('node-insp-title').textContent
  }));
  rec('inspect: node hit wins over edge within node radius',
    !nodeWins.nodeHidden && nodeWins.edgeHidden && /alpha/i.test(nodeWins.title),
    JSON.stringify(nodeWins));

  // --- Edge inspector Delete: per-type removal on a parallel pair, undo, export ---
  await page.evaluate(() => {
    const { store, ui } = window.hexwright;
    store.setPtpEdge('alpha', 'beta', 'rail');
    ui.setMode('edges');
    ui._onPtpEdgeSelect({ a: 'alpha', b: 'beta', type: 'road', edgeKey: 'alpha|beta|road' });
  });
  await sleep(150);
  const inspOpen = await page.evaluate(() => ({
    hidden: document.getElementById('ptp-edge-inspector').hidden,
    which: document.getElementById('ptp-edge-insp-which')?.value || '',
    whichVisible: !document.getElementById('ptp-edge-insp-which-wrap')?.hidden
  }));
  rec('delete UI: parallel pair opens inspector with connection picker',
    !inspOpen.hidden && inspOpen.whichVisible && inspOpen.which === 'road',
    JSON.stringify(inspOpen));

  await page.click('#ptp-edge-insp-delete');
  await sleep(150);
  const afterDelete = await page.evaluate(() => ({
    road: window.hexwright.store.getPtpEdge('alpha', 'beta', 'road'),
    rail: window.hexwright.store.getPtpEdge('alpha', 'beta', 'rail'),
    panelHidden: document.getElementById('ptp-edge-inspector').hidden
  }));
  rec('delete UI: inspector Delete removes only the selected parallel edge',
    afterDelete.road === null && afterDelete.rail === 'rail' && afterDelete.panelHidden,
    JSON.stringify(afterDelete));

  await page.evaluate(() => window.hexwright.store.undo());
  const afterUndo = await page.evaluate(() => ({
    road: window.hexwright.store.getPtpEdge('alpha', 'beta', 'road'),
    rail: window.hexwright.store.getPtpEdge('alpha', 'beta', 'rail')
  }));
  rec('delete UI: undo restores the inspector-deleted edge',
    afterUndo.road === 'road' && afterUndo.rail === 'rail',
    JSON.stringify(afterUndo));

  const exportAfterDelete = await page.evaluate(() => {
    const { store } = window.hexwright;
    store.deletePtpEdge('alpha', 'beta', 'road');
    return store.exportPtpEdgesObject();
  });
  const roadInExport = exportAfterDelete.edges.some((e) => e.a === 'alpha' && e.b === 'beta' && e.type === 'road');
  const railInExport = exportAfterDelete.edges.some((e) => e.a === 'alpha' && e.b === 'beta' && e.type === 'rail');
  rec('delete UI: export after deletion omits the removed edge type',
    !roadInExport && railInExport,
    `edges=${JSON.stringify(exportAfterDelete.edges.filter((e) => e.a === 'alpha' && e.b === 'beta'))}`);

  rec('no uncaught console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('ptp-check harness completed', false, err.message);
}

await browser.close();
srv.kill();

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
