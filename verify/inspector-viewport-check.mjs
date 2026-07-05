// Inspector viewport: right-docked default, fully on-screen, draggable header, persistence.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
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

const NAB_PALETTE_PATH = resolve(REPO, 'local/palettes/nab.json');
const NAB_PALETTE = existsSync(NAB_PALETTE_PATH)
  ? JSON.parse(readFileSync(NAB_PALETTE_PATH, 'utf8'))
  : {
    name: 'Napoleon at Bay (fixture)',
    terrain: [
      { key: 'clear', label: 'Clear', color: '#c8b88a' },
      { key: 'woods', label: 'Woods', color: '#5c7a4a' },
      { key: 'water', label: 'Water', color: '#3f78b4' },
      { key: 'swamp', label: 'Marsh/Swamp', color: '#6b7a5a' },
      { key: 'mountain', label: 'Hills', color: '#a98a5c' },
      { key: 'woods_mountain', label: 'Woods+Hills', colors: ['#5c7a4a', '#a98a5c'] },
      { key: 'woods_swamp', label: 'Woods+Marsh', colors: ['#5c7a4a', '#6b7a5a'] },
      { key: 'urban', label: 'Town (extracted — reclassify)', color: '#9a9a9a' },
      { key: 'town_primary', label: 'Primary town', color: '#a8422e' },
      { key: 'town_secondary', label: 'Secondary town', color: '#c9835f' },
      { key: 'woods_town_secondary', label: 'Woods+Secondary town', colors: ['#5c7a4a', '#c9835f'] },
      { key: 'woods_town_primary', label: 'Woods+Primary town', colors: ['#5c7a4a', '#a8422e'] }
    ],
    hexFeatures: [
      { key: 'garrison', label: 'Garrison', glyph: '\u26e8' },
      { key: 'depot', label: 'Depot (supply)', glyph: '\u25a3' }
    ],
    hexsideFeatures: [
      { key: 'river_primary', label: 'Primary River', color: '#1e5fd8', kind: 'edge', exportLayer: 'rivers-primary' },
      { key: 'road_primary', label: 'Primary Road', color: '#c8321e', kind: 'crossing', exportLayer: 'roads-primary' },
      { key: 'bridge', label: 'Bridge', color: '#e0c060', kind: 'crossing', exportLayer: 'bridges' }
    ]
  };

const GRID = {
  grid_version: 2,
  n_cols: 14,
  row_counts_by_parity: { even: 10, odd: 10 },
  col_pitch_x: 120,
  row_pitch_y: 120,
  x_intercept_col0: 100,
  y_intercept_row0: 100,
  odd_col_y_offset: 60,
  image_full: [1800, 1400]
};

function panelBoundsOk(panelRect, vw, vh, eps = 1) {
  return panelRect.left >= -eps
    && panelRect.top >= -eps
    && panelRect.right <= vw + eps
    && panelRect.bottom <= vh + eps;
}

function isRightDocked(panelRect, vw, margin = 12, eps = 4) {
  return Math.abs(panelRect.right - (vw - margin)) <= eps;
}

function overlapsCanvasCenterThird(panelRect, canvasRect) {
  const centerLeft = canvasRect.left + canvasRect.width / 3;
  const centerRight = canvasRect.left + (2 * canvasRect.width) / 3;
  return panelRect.left < centerRight && panelRect.right > centerLeft;
}

const PORT = 8048;
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

async function bootProject({ clearInspectorPos = false } = {}) {
  await page.evaluate(({ GRID, NAB_PALETTE, clearInspectorPos }) => {
    if (clearInspectorPos) localStorage.removeItem('hexwright.inspectorPos');
    const { store, renderer } = window.hexwright;
    store.setPalette(NAB_PALETTE);
    store.setProject({
      grid: GRID,
      imageFull: GRID.image_full,
      terrain: { terrain: { '0001': 'clear', '1309': 'woods' } },
      hexsides: {},
      features: {},
      mapImage: null
    });
    store.rebuildIndex();
    renderer.fitView();
    const start = document.getElementById('start-screen');
    if (start) start.hidden = true;
    const coach = document.getElementById('coach-card');
    if (coach) coach.hidden = true;
  }, { GRID, NAB_PALETTE, clearInspectorPos });
}

async function readInspectorState() {
  return page.evaluate(() => {
    const panel = document.getElementById('hex-editor');
    const canvas = document.getElementById('map-canvas');
    const open = panel && !panel.hidden;
    if (!open) return { open: false };

    const panelRect = panel.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const wrapChips = panel.querySelectorAll('.terr, .feat');
    const allChips = panel.querySelectorAll('.terr, .feat, .inkmini, .edgechip');
    const wrapStates = [...wrapChips].map((el) => {
      const r = el.getBoundingClientRect();
      const inViewport = r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh;
      return el.offsetParent !== null && r.width > 0 && r.height > 0 && inViewport;
    });
    const allPresent = [...allChips].every((el) => {
      const r = el.getBoundingClientRect();
      return el.offsetParent !== null && r.width > 0 && r.height > 0;
    });

    return {
      open: true,
      panelRect: {
        left: panelRect.left,
        top: panelRect.top,
        right: panelRect.right,
        bottom: panelRect.bottom,
        width: panelRect.width,
        height: panelRect.height
      },
      canvasRect: {
        left: canvasRect.left,
        top: canvasRect.top,
        right: canvasRect.right,
        bottom: canvasRect.bottom,
        width: canvasRect.width,
        height: canvasRect.height
      },
      vw,
      vh,
      wrapChipCount: wrapChips.length,
      allChipCount: allChips.length,
      wrapBad: wrapStates.filter((ok) => !ok).length,
      allPresent,
      savedPos: localStorage.getItem('hexwright.inspectorPos')
    };
  });
}

async function clickEdgeHex(edge) {
  const target = await page.evaluate((edge) => {
    const { store, renderer, geo } = window.hexwright;
    const grid = store.state.grid;
    const codes = Object.keys(store.centers);
    let bestCode = codes[0];
    let bestScore = -Infinity;
    for (const code of codes) {
      const sp = renderer.worldToScreen(geo.hexCenter(code, grid));
      const score = edge === 'right' ? sp.x : sp.y;
      if (score > bestScore) {
        bestScore = score;
        bestCode = code;
      }
    }
    const center = geo.hexCenter(bestCode, grid);
    const sp = renderer.worldToScreen(center);
    const canvasW = renderer.width;
    const canvasH = renderer.height;
    const aimX = edge === 'right' ? canvasW * 0.93 : canvasW * 0.5;
    const aimY = edge === 'bottom' ? canvasH * 0.93 : canvasH * 0.5;
    renderer.view.panX += aimX - sp.x;
    renderer.view.panY += aimY - sp.y;
    renderer.draw();
    const clickPt = renderer.worldToScreen(center);
    return { code: bestCode, x: clickPt.x, y: clickPt.y };
  }, edge);

  await page.keyboard.press('Escape');
  await sleep(120);

  const box = await page.locator('#map-canvas').boundingBox();
  await page.mouse.click(box.x + target.x, box.y + target.y);
  await sleep(250);

  let opened = await page.evaluate(() => !document.getElementById('hex-editor').hidden);
  if (!opened) {
    await page.evaluate(({ x, y }) => {
      const { renderer } = window.hexwright;
      const hex = renderer.hexAtScreen({ x, y });
      if (hex) renderer.onHexSelect?.(hex, { x, y });
    }, target);
    await sleep(250);
  }

  return readInspectorState();
}

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => window.hexwright?.store, { timeout: 15000 });
  await sleep(400);
  await bootProject({ clearInspectorPos: true });

  rec('NaB palette exposes 12 terrain classes', NAB_PALETTE.terrain.length === 12);

  const right = await clickEdgeHex('right');
  rec('inspector opens on right-edge hex click', right.open, right.open ? '' : 'panel hidden');
  if (right.open) {
    const boundsOk = panelBoundsOk(right.panelRect, right.vw, right.vh);
    rec(
      'right-edge click: inspector fully inside viewport',
      boundsOk,
      `panel=[${right.panelRect.left.toFixed(0)},${right.panelRect.top.toFixed(0)},${right.panelRect.right.toFixed(0)},${right.panelRect.bottom.toFixed(0)}] vw=${right.vw} vh=${right.vh}`
    );
    rec(
      'right-edge click: default docked on right side',
      isRightDocked(right.panelRect, right.vw),
      `right=${right.panelRect.right.toFixed(0)} vw=${right.vw}`
    );
    rec(
      'right-edge click: does not overlap map center third',
      !overlapsCanvasCenterThird(right.panelRect, right.canvasRect),
      `panel=[${right.panelRect.left.toFixed(0)},${right.panelRect.right.toFixed(0)}] canvas center=[${(right.canvasRect.left + right.canvasRect.width / 3).toFixed(0)},${(right.canvasRect.left + 2 * right.canvasRect.width / 3).toFixed(0)}]`
    );
    rec(
      'right-edge click: terrain/feature chips visible in viewport',
      right.wrapChipCount >= 12 && right.wrapBad === 0 && right.allPresent,
      `wrap=${right.wrapChipCount} wrapBad=${right.wrapBad} all=${right.allChipCount} present=${right.allPresent}`
    );

    const modeBeforeEsc = await page.evaluate(() => window.hexwright.ui.mode);
    await page.keyboard.press('Escape');
    await sleep(120);
    const afterEsc = await readInspectorState();
    const modeAfterEsc = await page.evaluate(() => window.hexwright.ui.mode);
    rec('Escape closes hex inspector', !afterEsc.open);
    rec('Escape does not change mode', modeBeforeEsc === modeAfterEsc, `mode=${modeAfterEsc}`);

    await clickEdgeHex('right');
    await page.focus('#hexed-name');
    await sleep(80);
    await page.keyboard.press('Escape');
    await sleep(120);
    const afterNameEsc = await page.evaluate(() => ({
      open: !document.getElementById('hex-editor').hidden,
      nameFocused: document.activeElement === document.getElementById('hexed-name')
    }));
    rec(
      'Escape in Name field blurs without closing inspector',
      afterNameEsc.open && !afterNameEsc.nameFocused,
      `open=${afterNameEsc.open} nameFocused=${afterNameEsc.nameFocused}`
    );
    await page.keyboard.press('Escape');
    await sleep(120);
    const afterSecondEsc = await readInspectorState();
    rec('Second Escape closes inspector after Name blur', !afterSecondEsc.open);
  }

  const bottom = await clickEdgeHex('bottom');
  rec('inspector opens on bottom-edge hex click', bottom.open, bottom.open ? '' : 'panel hidden');
  if (bottom.open) {
    const boundsOk = panelBoundsOk(bottom.panelRect, bottom.vw, bottom.vh);
    rec(
      'bottom-edge click: inspector fully inside viewport',
      boundsOk,
      `panel=[${bottom.panelRect.left.toFixed(0)},${bottom.panelRect.top.toFixed(0)},${bottom.panelRect.right.toFixed(0)},${bottom.panelRect.bottom.toFixed(0)}] vw=${bottom.vw} vh=${bottom.vh}`
    );
    rec(
      'bottom-edge click: default docked on right side',
      isRightDocked(bottom.panelRect, bottom.vw),
      `right=${bottom.panelRect.right.toFixed(0)} vw=${bottom.vw}`
    );
    rec(
      'bottom-edge click: does not overlap map center third',
      !overlapsCanvasCenterThird(bottom.panelRect, bottom.canvasRect),
      `panel=[${bottom.panelRect.left.toFixed(0)},${bottom.panelRect.right.toFixed(0)}]`
    );
    rec(
      'bottom-edge click: terrain/feature chips visible in viewport',
      bottom.wrapChipCount >= 12 && bottom.wrapBad === 0 && bottom.allPresent,
      `wrap=${bottom.wrapChipCount} wrapBad=${bottom.wrapBad} all=${bottom.allChipCount} present=${bottom.allPresent}`
    );
  }

  const beforeDrag = await readInspectorState();
  const head = page.locator('#hex-editor .head');
  const headBox = await head.boundingBox();
  await page.mouse.move(headBox.x + 40, headBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(headBox.x - 180, headBox.y + 90, { steps: 12 });
  await page.mouse.up();
  await sleep(200);

  const afterDrag = await readInspectorState();
  const moved = afterDrag.open
    && (Math.abs(afterDrag.panelRect.left - beforeDrag.panelRect.left) > 20
      || Math.abs(afterDrag.panelRect.top - beforeDrag.panelRect.top) > 20);
  rec(
    'drag header moves inspector panel',
    moved,
    moved
      ? `from=[${beforeDrag.panelRect.left.toFixed(0)},${beforeDrag.panelRect.top.toFixed(0)}] to=[${afterDrag.panelRect.left.toFixed(0)},${afterDrag.panelRect.top.toFixed(0)}]`
      : 'panel did not move enough'
  );
  rec(
    'dragged panel stays fully inside viewport',
    afterDrag.open && panelBoundsOk(afterDrag.panelRect, afterDrag.vw, afterDrag.vh),
    afterDrag.open ? '' : 'panel closed'
  );
  rec(
    'drag saves position to localStorage',
    !!afterDrag.savedPos,
    afterDrag.savedPos || 'missing hexwright.inspectorPos'
  );

  const draggedLeft = afterDrag.panelRect.left;
  const draggedTop = afterDrag.panelRect.top;
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.hexwright?.store, { timeout: 15000 });
  await sleep(400);
  await bootProject();
  await clickEdgeHex('right');
  await sleep(200);

  const afterReload = await readInspectorState();
  const persisted = afterReload.open
    && Math.abs(afterReload.panelRect.left - draggedLeft) <= 3
    && Math.abs(afterReload.panelRect.top - draggedTop) <= 3;
  rec(
    'dragged position persists across reload',
    persisted,
    persisted
      ? `pos=[${afterReload.panelRect.left.toFixed(0)},${afterReload.panelRect.top.toFixed(0)}]`
      : `expected~[${draggedLeft.toFixed(0)},${draggedTop.toFixed(0)}] got=[${afterReload.panelRect.left.toFixed(0)},${afterReload.panelRect.top.toFixed(0)}]`
  );

  const headBox2 = await head.boundingBox();
  await page.mouse.dblclick(headBox2.x + 40, headBox2.y + 8);
  await sleep(200);

  const redocked = await readInspectorState();
  rec(
    'double-click header re-docks inspector to right side',
    redocked.open && isRightDocked(redocked.panelRect, redocked.vw) && !redocked.savedPos,
    redocked.open
      ? `right=${redocked.panelRect.right.toFixed(0)} saved=${redocked.savedPos}`
      : 'panel closed'
  );
  rec(
    're-docked panel fully inside viewport',
    redocked.open && panelBoundsOk(redocked.panelRect, redocked.vw, redocked.vh),
    redocked.open ? '' : 'panel closed'
  );

  rec('no console/page errors during inspector viewport checks', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  rec('inspector-viewport-check harness completed', false, err.message);
} finally {
  await browser.close();
  srv.kill();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
