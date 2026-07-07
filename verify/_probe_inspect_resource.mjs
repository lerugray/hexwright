// One-off probe: FtP numeric resource values + the p2p Inspect tool, driven
// end-to-end against the REAL For the People launcher project (not fixtures).
// Serves the PARENT folder (like the launchers) so the sibling
// for-the-people-digital repo resolves. Own browser profile — never touches
// the operator's real Firefox session.
//
// Phase 1 (fresh boot): palette resource=level, seeded Strategic Will values
//   import, Inspect toolbar button works, node click opens a VISIBLE inspector
//   with the value, typing a value + Save writes the store, edge click opens
//   the per-edge inspector, badge chip actually paints.
// Phase 2 (reload): autosaved session restores — the typed value survived.
// Phase 3 (legacy sim): a flag-era `resource: true` in the session survives
//   restore untouched (operator value wins over the numeric seed) and the
//   inspector shows the tagged placeholder instead of destroying it.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PARENT = resolve(REPO, '..');
const NAME = basename(REPO);
const PORT = 8691;
const URL = `http://localhost:${PORT}/${NAME}/?project=local/ftp-p2p.json`;

const server = spawn('python3', [resolve(REPO, 'scripts/serve_nocache.py'), String(PORT)], {
  cwd: PARENT, stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1200);

const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

async function loadFtp(page) {
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.hexwright && window.hexwright.store, { timeout: 20000 });
  await page.waitForFunction(() => Object.keys(window.hexwright.store.state.nodes || {}).length > 0, { timeout: 20000 });
  await sleep(2000); // big raster decode
}

// Center a node at s=3 world->screen scale so the click can't hit a neighbor.
async function centerNode(page, nodeId) {
  return page.evaluate((id) => {
    const { store, renderer } = window.hexwright;
    const n = store.state.nodes[id];
    const view = renderer.view;
    view.zoom = 3 / view.baseScale;
    const canvas = document.getElementById('map-canvas');
    const box = canvas.getBoundingClientRect();
    const s = view.baseScale * view.zoom;
    view.panX = box.width / 2 - n.x * s;
    view.panY = box.height / 2 - n.y * s;
    renderer.draw();
    const pt = renderer.worldToScreen({ x: n.x, y: n.y });
    return { x: box.x + pt.x, y: box.y + pt.y };
  }, nodeId);
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

try {
  // --- Phase 1: fresh boot ---
  await loadFtp(page);

  const paletteState = await page.evaluate(() => {
    const f = (window.hexwright.store.getPalette()?.nodeFeatures || []).find((x) => x.key === 'resource');
    return f || null;
  });
  rec('FtP palette loads resource as level/max12', paletteState?.kind === 'level' && paletteState?.max === 12,
    JSON.stringify(paletteState));

  const seeded = await page.evaluate(() => ({
    atlanta: window.hexwright.store.getNodeAttrs('atlanta').resource,
    richmond: window.hexwright.store.getNodeAttrs('richmond').resource,
    memphis: window.hexwright.store.getNodeAttrs('memphis').resource
  }));
  rec('seeded Strategic Will values import as numbers',
    seeded.atlanta === 5 && seeded.richmond === 12 && seeded.memphis === 5, JSON.stringify(seeded));

  // Real toolbar interaction: the Inspect button must be visible in p2p and enter the mode.
  const inspectBtnVisible = await page.evaluate(() => !document.getElementById('tool-inspect').hidden);
  rec('Inspect tool button visible in p2p toolbar', inspectBtnVisible);
  await page.click('#tool-inspect');
  await sleep(150);
  const modeNow = await page.evaluate(() => window.hexwright.ui.mode);
  rec('clicking the toolbar button enters inspect mode', modeNow === 'inspect', `mode=${modeNow}`);

  // Click atlanta -> inspector visible on-screen, resource input pre-filled with 5.
  const atlantaPt = await centerNode(page, 'atlanta');
  await page.mouse.click(atlantaPt.x, atlantaPt.y);
  await sleep(250);
  const inspState = await page.evaluate(() => {
    const panel = document.getElementById('node-feature-inspector');
    const r = panel.getBoundingClientRect();
    const input = panel.querySelector('.node-feat-level[data-node-feat-key="resource"]');
    return {
      hidden: panel.hidden,
      onScreen: r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 &&
        r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      meta: document.getElementById('node-insp-meta')?.textContent || '',
      value: input ? input.value : null
    };
  });
  rec('node click opens a visibly on-screen inspector with the resource value',
    !inspState.hidden && inspState.onScreen && inspState.value === '5' && /id atlanta/.test(inspState.meta),
    JSON.stringify(inspState));

  // Type a value on a node with no resource yet (cairo, a Union port) + Save.
  const cairoPt = await centerNode(page, 'cairo');
  await page.mouse.click(cairoPt.x, cairoPt.y);
  await sleep(250);
  await page.fill('#node-feature-inspector .node-feat-level[data-node-feat-key="resource"]', '7');
  await page.click('#node-insp-save');
  await sleep(200);
  const cairoSaved = await page.evaluate(() => window.hexwright.store.getNodeAttrs('cairo').resource);
  rec('typing a resource value in the inspector + Save writes the store', cairoSaved === 7,
    `value=${JSON.stringify(cairoSaved)}`);

  // Badge chip really paints: sample the chip band above the node for the
  // resource brown (#8a6d3b) — not just store state.
  const chipPixel = await page.evaluate(() => {
    const { store, renderer } = window.hexwright;
    const n = store.state.nodes.cairo;
    const pt = renderer.worldToScreen({ x: n.x, y: n.y });
    const canvas = document.getElementById('map-canvas');
    const ctx2 = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    // chip band sits ~6..20 CSS px above the node center
    for (let dy = 4; dy <= 26; dy++) {
      for (let dx = -30; dx <= 30; dx++) {
        const px = Math.round((pt.x + dx) * dpr);
        const py = Math.round((pt.y - dy) * dpr);
        if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
        const [r, g, b] = ctx2.getImageData(px, py, 1, 1).data;
        if (Math.abs(r - 138) < 25 && Math.abs(g - 109) < 25 && Math.abs(b - 59) < 25) {
          return { found: true, at: [dx, -dy], rgb: [r, g, b] };
        }
      }
    }
    return { found: false };
  });
  rec('resource badge chip paints on the canvas next to the node', chipPixel.found, JSON.stringify(chipPixel));

  // Edge branch on the real map: trace one edge via the store, click its midpoint.
  const edgeMid = await page.evaluate(() => {
    const { store, renderer } = window.hexwright;
    store.setPtpEdge('cairo', 'paducah', 'river') || store.setPtpEdge('cairo', 'saint-louis', 'road');
    const key = Object.keys(store.state.ptpEdges)[0];
    const [a, b] = key.split('|');
    const na = store.state.nodes[a];
    const nb = store.state.nodes[b];
    renderer.draw();
    const pa = renderer.worldToScreen({ x: na.x, y: na.y });
    const pb = renderer.worldToScreen({ x: nb.x, y: nb.y });
    const box = document.getElementById('map-canvas').getBoundingClientRect();
    return { x: box.x + (pa.x + pb.x) / 2, y: box.y + (pa.y + pb.y) / 2, key };
  });
  await page.mouse.click(edgeMid.x, edgeMid.y);
  await sleep(250);
  const edgeInsp = await page.evaluate(() => ({
    edgeHidden: document.getElementById('ptp-edge-inspector').hidden,
    nodeHidden: document.getElementById('node-feature-inspector').hidden
  }));
  rec('edge click in inspect mode opens the per-edge inspector',
    !edgeInsp.edgeHidden && edgeInsp.nodeHidden, JSON.stringify(edgeInsp) + ` edge=${edgeMid.key}`);

  // --- Phase 2: reload -> restore -> the typed value survived ---
  await sleep(1300); // autosave debounce
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#restore-prompt:not([hidden])', { timeout: 15000 });
  await page.click('#restore-prompt-restore');
  await page.waitForFunction(() => window.hexwright?.store?.isPtp?.() &&
    Object.keys(window.hexwright.store.state.nodes || {}).length > 0, { timeout: 20000 });
  await sleep(1500);
  const afterReload = await page.evaluate(() => ({
    cairo: window.hexwright.store.getNodeAttrs('cairo').resource,
    atlanta: window.hexwright.store.getNodeAttrs('atlanta').resource
  }));
  rec('resource values survive reload + session restore',
    afterReload.cairo === 7 && afterReload.atlanta === 5, JSON.stringify(afterReload));

  // Renders after restore too (cairo chip again).
  const chipAfterReload = await page.evaluate(() => {
    const { store, renderer } = window.hexwright;
    const view = renderer.view;
    const n = store.state.nodes.cairo;
    view.zoom = 3 / view.baseScale;
    const canvas = document.getElementById('map-canvas');
    const box = canvas.getBoundingClientRect();
    const s = view.baseScale * view.zoom;
    view.panX = box.width / 2 - n.x * s;
    view.panY = box.height / 2 - n.y * s;
    renderer.draw();
    const pt = renderer.worldToScreen({ x: n.x, y: n.y });
    const ctx2 = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    for (let dy = 4; dy <= 26; dy++) {
      for (let dx = -30; dx <= 30; dx++) {
        const px = Math.round((pt.x + dx) * dpr);
        const py = Math.round((pt.y - dy) * dpr);
        if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
        const [r, g, b] = ctx2.getImageData(px, py, 1, 1).data;
        if (Math.abs(r - 138) < 25 && Math.abs(g - 109) < 25 && Math.abs(b - 59) < 25) return { found: true };
      }
    }
    return { found: false };
  });
  rec('restored resource value renders its badge chip', chipAfterReload.found, JSON.stringify(chipAfterReload));

  // --- Phase 3: legacy flag-era `resource: true` in the session ---
  await page.evaluate(() => window.hexwright.store.setNodeAttr('memphis', 'resource', true));
  await sleep(1300); // autosave
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#restore-prompt:not([hidden])', { timeout: 15000 });
  await page.click('#restore-prompt-restore');
  await page.waitForFunction(() => window.hexwright?.store?.isPtp?.() &&
    Object.keys(window.hexwright.store.state.nodes || {}).length > 0, { timeout: 20000 });
  await sleep(1500);
  const legacy = await page.evaluate(() => window.hexwright.store.getNodeAttrs('memphis').resource);
  rec('legacy flag-value true survives restore untouched (operator value beats the numeric seed)',
    legacy === true, `value=${JSON.stringify(legacy)}`);

  await page.evaluate(() => window.hexwright.ui.setMode('inspect'));
  const memphisPt = await centerNode(page, 'memphis');
  await page.mouse.click(memphisPt.x, memphisPt.y);
  await sleep(250);
  const legacyInsp = await page.evaluate(() => {
    const input = document.querySelector('#node-feature-inspector .node-feat-level[data-node-feat-key="resource"]');
    return input ? { value: input.value, placeholder: input.placeholder } : null;
  });
  rec('inspector shows the legacy tag as a placeholder, ready for a typed value',
    legacyInsp?.value === '' && /tagged/.test(legacyInsp?.placeholder || ''), JSON.stringify(legacyInsp));

  rec('no uncaught console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('probe harness completed', false, err.message);
}

await browser.close();
server.kill();

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
