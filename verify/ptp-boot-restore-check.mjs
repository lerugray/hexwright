// Boot-precedence regression guard (2026-07-06 incident): a ?project= manifest
// boot must NOT silently discard a matching autosaved session just because the
// session has 0 land hexes / 0 hexsides / 0 groups. A p2p (point-to-point)
// project can carry hundreds of real edges (the incident: 466 Paths-of-Glory
// edges) or node-attr tags with all three of those at zero — the old gate
// (`slot.land>0 || slot.sides>0 || slot.groups>0`) never counted ptpEdges or
// nodeAttrs, so the restore prompt never fired and boot silently loaded fresh.
//
// Also guards: choosing "start fresh" clears the rejected session slot, while
// a later REAL edit still creates a new autosave normally.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

const PORT = 8052;
const PTP_PROJECT_URL = 'verify/fixtures/ptp-fixture-project.json';
const SESSION_KEY = 'hexwright.session.ptp-fixture';

// canonical ptpEdgeKey: alpha<beta<delta<gamma
const SEEDED_EDGES = { 'alpha|beta|road': 'road', 'beta|gamma|rail': 'rail', 'alpha|delta|road': 'road' };
const FIXTURE_NODES = {
  alpha: { id: 'alpha', name: 'Alpha', x: 80, y: 150 },
  beta: { id: 'beta', name: 'Beta', x: 200, y: 80 },
  gamma: { id: 'gamma', name: 'Gamma', x: 320, y: 150 },
  delta: { id: 'delta', name: 'Delta', x: 200, y: 220 }
};

function seededSession({ ptpEdges = {}, nodeAttrs = {} } = {}) {
  return {
    savedAt: Date.now(),
    project: {
      schemaVersion: 2,
      name: 'PTP fixture',
      mapImage: null,
      imageFull: [400, 300],
      mapFamily: 'ptp',
      grid: null,
      terrain: { terrain: {} },
      features: {},
      names: {},
      hexFeatures: {},
      hexsides: {},
      provenance: {},
      groups: [],
      nodes: FIXTURE_NODES,
      nodesMeta: {},
      nodesFile: '',
      ptpEdges,
      nodeAttrs
    }
  };
}

function pageWithErrors(errors) {
  return (page) => {
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  };
}

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await sleep(1300);
const browser = await chromium.launch();

// --- Case A: a matching p2p session (0 land, 0 hexsides, 0 groups, N edges)
// must trigger the restore prompt, and Resume must bring the edges back live.
{
  const errors = [];
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  pageWithErrors(errors)(page);

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(({ key, slot }) => localStorage.setItem(key, JSON.stringify(slot)),
    { key: SESSION_KEY, slot: seededSession({ ptpEdges: SEEDED_EDGES }) });

  await page.goto(`http://localhost:${PORT}/?project=${PTP_PROJECT_URL}`, { waitUntil: 'load' });

  let promptShown = true;
  try {
    await page.waitForSelector('#restore-prompt:not([hidden])', { timeout: 10000 });
  } catch (_) {
    promptShown = false;
  }
  rec('boot with a matching edge-only p2p session shows the resume prompt (466-edge-class incident)', promptShown);

  const msgText = promptShown ? await page.locator('#restore-prompt-msg').textContent() : '';
  rec('resume prompt names the edge count', /3 edges/.test(msgText || ''), msgText);

  if (promptShown) await page.click('#restore-prompt-restore');
  await page.waitForFunction(() => window.hexwright?.store?.isPtp?.(), { timeout: 15000 });
  await sleep(400);
  const afterResume = await page.evaluate(() => ({
    isPtp: window.hexwright.store.isPtp(),
    edgeCount: window.hexwright.store.countPtpEdges()
  }));
  rec('resume restores the session\'s p2p edges (not the manifest\'s fewer baseline)',
    afterResume.isPtp && afterResume.edgeCount === 3, JSON.stringify(afterResume));

  rec('case A: no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// --- Case B: choosing "start fresh" clears the rejected session slot, but a
// REAL edit made afterward must still autosave normally.
{
  const errors = [];
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  pageWithErrors(errors)(page);

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(({ key, slot }) => localStorage.setItem(key, JSON.stringify(slot)),
    { key: SESSION_KEY, slot: seededSession({ ptpEdges: SEEDED_EDGES }) });

  await page.goto(`http://localhost:${PORT}/?project=${PTP_PROJECT_URL}`, { waitUntil: 'load' });
  await page.waitForSelector('#restore-prompt:not([hidden])', { timeout: 10000 });
  await page.click('#restore-prompt-fresh');

  await page.waitForFunction(() => window.hexwright?.store?.isPtp?.(), { timeout: 15000 });
  await sleep(400);
  const freshEdgeCount = await page.evaluate(() => window.hexwright.store.countPtpEdges());
  rec('start-fresh loads the manifest baseline (2 edges, fewer than the session\'s 3)',
    freshEdgeCount === 2, `edges=${freshEdgeCount}`);

  // Past the 800ms debounce with no edit made — the rejected slot stays gone.
  await sleep(1500);
  const slotAfterFresh = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, SESSION_KEY);
  rec('choosing "start fresh" removes the rejected session slot',
    slotAfterFresh === null, JSON.stringify(slotAfterFresh));

  // Now make a REAL edit post-load — autosave must still work normally.
  await page.evaluate(() => window.hexwright.store.setPtpEdge('gamma', 'delta', 'road'));
  await sleep(1200);
  const slotAfterEdit = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, SESSION_KEY);
  const edgesAfterEdit = slotAfterEdit ? slotAfterEdit.project.ptpEdges || {} : {};
  rec('a real edit after "start fresh" still autosaves (reflects fresh state + the new edit, not the stale session)',
    edgesAfterEdit['delta|gamma|road'] === 'road' && !('alpha|delta|road' in edgesAfterEdit) && Object.keys(edgesAfterEdit).length === 3,
    JSON.stringify(edgesAfterEdit));

  rec('case B: no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// --- Case C: the start-screen recent-list must not label an edge-only p2p
// slot "empty" (parseSessionRecord previously only counted land/sides/groups).
{
  const errors = [];
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  pageWithErrors(errors)(page);

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(({ key, slot }) => localStorage.setItem(key, JSON.stringify(slot)),
    { key: SESSION_KEY, slot: seededSession({ ptpEdges: SEEDED_EDGES }) });
  await page.reload({ waitUntil: 'load' });

  await page.waitForSelector('.recent-row', { timeout: 10000 });
  const detailText = await page.locator('.recent-row').first().locator('.detail').textContent();
  rec('recent-list detail for an edge-only p2p slot names the edges (not "empty"/"no content")',
    /3 edges/.test(detailText || '') && !/no content/i.test(detailText || ''), detailText);

  rec('case C: no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// --- Case D: a nodeAttrs-only slot (0 edges too) must still trigger the prompt.
{
  const errors = [];
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  pageWithErrors(errors)(page);

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(({ key, slot }) => localStorage.setItem(key, JSON.stringify(slot)),
    { key: SESSION_KEY, slot: seededSession({ nodeAttrs: { alpha: { fortress: 2 } } }) });

  await page.goto(`http://localhost:${PORT}/?project=${PTP_PROJECT_URL}`, { waitUntil: 'load' });
  let promptShown = true;
  try {
    await page.waitForSelector('#restore-prompt:not([hidden])', { timeout: 10000 });
  } catch (_) {
    promptShown = false;
  }
  rec('boot with a nodeAttrs-only (0-edge) p2p session also shows the resume prompt', promptShown);
  if (promptShown) await page.click('#restore-prompt-restore');

  rec('case D: no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// --- Case E: numeric node-attr values (level features, e.g. FtP resource
// Strategic Will) must survive resume as NUMBERS, and a legacy boolean `true`
// on a feature later retyped flag->level must load untouched (migration is
// lossless — never coerced, never dropped).
{
  const errors = [];
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  pageWithErrors(errors)(page);

  const seededAttrs = {
    alpha: { fortress: 3 },        // numeric level value
    beta: { vp: true },            // ordinary flag
    gamma: { fortress: true }      // legacy flag-value on a level feature
  };
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(({ key, slot }) => localStorage.setItem(key, JSON.stringify(slot)),
    { key: SESSION_KEY, slot: seededSession({ ptpEdges: SEEDED_EDGES, nodeAttrs: seededAttrs }) });

  await page.goto(`http://localhost:${PORT}/?project=${PTP_PROJECT_URL}`, { waitUntil: 'load' });
  await page.waitForSelector('#restore-prompt:not([hidden])', { timeout: 10000 });
  await page.click('#restore-prompt-restore');
  await page.waitForFunction(() => window.hexwright?.store?.isPtp?.(), { timeout: 15000 });
  await sleep(400);

  const restored = await page.evaluate(() => ({
    alphaFortress: window.hexwright.store.getNodeAttrs('alpha').fortress,
    betaVp: window.hexwright.store.getNodeAttrs('beta').vp,
    gammaFortress: window.hexwright.store.getNodeAttrs('gamma').fortress
  }));
  rec('resume restores a numeric level value as a number (fortress=3)',
    restored.alphaFortress === 3, `value=${JSON.stringify(restored.alphaFortress)}`);
  rec('resume preserves a legacy true on a level feature untouched (lossless migration)',
    restored.gammaFortress === true && restored.betaVp === true,
    JSON.stringify(restored));

  // A real edit re-autosaves — the numeric + legacy values must round-trip
  // through the session slot, not just the live store.
  await page.evaluate(() => window.hexwright.store.setNodeAttr('delta', 'fortress', 2));
  await sleep(1200);
  const slotAttrs = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).project.nodeAttrs : null;
  }, SESSION_KEY);
  rec('autosave round-trips numeric + legacy node-attr values',
    !!slotAttrs && slotAttrs.alpha?.fortress === 3 && slotAttrs.gamma?.fortress === true &&
      slotAttrs.delta?.fortress === 2,
    JSON.stringify(slotAttrs));

  rec('case E: no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// --- Case F: an edge deleted in-session must survive autosave + resume (per-type
// identity — parallel siblings on the same pair must not be wiped).
{
  const errors = [];
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  pageWithErrors(errors)(page);

  const seededEdges = {
    ...SEEDED_EDGES,
    'alpha|beta|rail': 'rail'
  };
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(({ key, slot }) => localStorage.setItem(key, JSON.stringify(slot)),
    { key: SESSION_KEY, slot: seededSession({ ptpEdges: seededEdges }) });

  await page.goto(`http://localhost:${PORT}/?project=${PTP_PROJECT_URL}`, { waitUntil: 'load' });
  await page.waitForSelector('#restore-prompt:not([hidden])', { timeout: 10000 });
  await page.click('#restore-prompt-restore');
  await page.waitForFunction(() => window.hexwright?.store?.isPtp?.(), { timeout: 15000 });
  await sleep(400);

  await page.evaluate(() => window.hexwright.store.deletePtpEdge('alpha', 'beta', 'road'));
  await sleep(1200);
  const slotEdges = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).project.ptpEdges || {} : {};
  }, SESSION_KEY);
  rec('autosave after delete drops only the removed (a,b,type) key',
    !('alpha|beta|road' in slotEdges) && slotEdges['alpha|beta|rail'] === 'rail',
    JSON.stringify(Object.keys(slotEdges).filter((k) => k.startsWith('alpha|beta'))));

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#restore-prompt:not([hidden])', { timeout: 10000 });
  await page.click('#restore-prompt-restore');
  await page.waitForFunction(() => window.hexwright?.store?.isPtp?.(), { timeout: 15000 });
  await sleep(400);
  const afterResume = await page.evaluate(() => ({
    road: window.hexwright.store.getPtpEdge('alpha', 'beta', 'road'),
    rail: window.hexwright.store.getPtpEdge('alpha', 'beta', 'rail'),
    count: window.hexwright.store.countPtpEdges()
  }));
  rec('resume after delete restores the session without the deleted edge type',
    afterResume.road === null && afterResume.rail === 'rail' && afterResume.count === 3,
    JSON.stringify(afterResume));

  rec('case F: no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
srv.kill();

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
