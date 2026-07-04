import { chromium } from 'playwright';
import { spawn } from 'child_process';

const DIR = process.cwd();
const PORT = 8029;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

try {
  await page.goto(`http://localhost:${PORT}/?project=samples/gota-project.json`, { waitUntil: 'load', timeout: 20000 });
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
    const terrainKey = palette?.terrain?.find((t) => t.key === 'woods')?.key
      || palette?.terrain?.[1]?.key;
    if (!terrainKey) return null;

    const centers = store.centers || {};
    const grid = store.state.grid;
    const codes = Object.keys(centers);
    let chosen = null;

    for (const code of codes) {
      const pt = renderer.worldToScreen(geo.hexCenter(code, grid));
      if (renderer.hexAtScreen(pt) !== code) continue;
      const neighbors = [];
      for (let i = 0; i < 6; i++) {
        const nb = geo.edgeNeighborCode(code, i, grid);
        if (nb && centers[nb] && renderer.hexAtScreen(renderer.worldToScreen(geo.hexCenter(nb, grid))) === nb) {
          neighbors.push(nb);
        }
      }
      if (neighbors.length >= 2) {
        chosen = { code, neighbors: neighbors.slice(0, 2) };
        break;
      }
    }
    if (!chosen) return null;

    const ptForCode = (hexCode) => {
      const world = geo.hexCenter(hexCode, grid);
      return renderer.worldToScreen(world);
    };

    return {
      code: chosen.code,
      neighborCodes: chosen.neighbors,
      terrainKey,
      altTerrainKey: palette?.terrain?.find((t) => t.key !== terrainKey && t.key !== 'clear')?.key
        || palette?.terrain?.find((t) => t.key !== terrainKey)?.key
        || null,
      points: {
        p1: ptForCode(chosen.code),
        p2: ptForCode(chosen.neighbors[0]),
        p3: ptForCode(chosen.neighbors[1])
      }
    };
  });

  rec('probe board geometry for terrain-paint checks', !!setup, setup ? `hex=${setup.code}` : 'no suitable hex found');
  if (!setup) throw new Error('No suitable probe hex found');

  const canvasBox = await page.locator('#map-canvas').boundingBox();
  if (!canvasBox) throw new Error('map canvas bounds unavailable');
  const asPagePoint = (pt) => ({ x: canvasBox.x + pt.x, y: canvasBox.y + pt.y });
  const p1 = asPagePoint(setup.points.p1);
  const p2 = asPagePoint(setup.points.p2);
  const p3 = asPagePoint(setup.points.p3);

  await page.keyboard.press('b');
  await sleep(150);
  await page.click(`#brush-card .ink[data-ink-key="${setup.terrainKey}"]`);
  await sleep(150);

  // click = assign terrain (hex may start with a different type)
  await page.mouse.click(p1.x, p1.y);
  await sleep(100);
  const clickOn = await page.evaluate(({ code, terrainKey }) => {
    return window.hexwright.store.state.terrain.terrain[code] === terrainKey;
  }, { code: setup.code, terrainKey: setup.terrainKey });
  rec('click assigns selected terrain', clickOn, setup.code);

  // click again = clear (toggle off)
  await page.mouse.click(p1.x, p1.y);
  await sleep(100);
  const clickOff = await page.evaluate(({ code, terrainKey }) => {
    return window.hexwright.store.state.terrain.terrain[code] !== terrainKey;
  }, { code: setup.code, terrainKey: setup.terrainKey });
  rec('second click clears same terrain', clickOff, setup.code);

  const stillClickable = await page.evaluate(({ code, pt }) => {
    const r = window.hexwright.renderer;
    return r.hexAtScreen(pt) === code && !!r.store.centers[code];
  }, { code: setup.code, pt: setup.points.p1 });
  rec('cleared hex stays hit-testable', stillClickable, setup.code);

  // drag = set over multiple hexes, one undo entry
  const dragCodes = [setup.code, ...setup.neighborCodes];
  const beforeDrag = await page.evaluate(() => window.hexwright.store.undoStack.length);
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(p2.x, p2.y, { steps: 8 });
  await page.mouse.move(p3.x, p3.y, { steps: 8 });
  await page.mouse.up({ button: 'left' });
  await sleep(150);

  const dragSet = await page.evaluate(({ codes, terrainKey, beforeDragUndo }) => {
    const s = window.hexwright.store;
    const terrain = s.state.terrain.terrain || {};
    const allSet = codes.every((c) => terrain[c] === terrainKey);
    const undoDelta = s.undoStack.length - beforeDragUndo;
    return { allSet, undoDelta };
  }, {
    codes: dragCodes,
    terrainKey: setup.terrainKey,
    beforeDragUndo: beforeDrag
  });
  rec('drag paints three hexes idempotently', dragSet.allSet, dragCodes.join(', '));
  rec('drag stroke creates one undo batch', dragSet.undoDelta === 1, `undo delta=${dragSet.undoDelta}`);

  await page.locator('#undo:not([disabled])').click({ timeout: 5000 });
  await sleep(200);
  const undoRevert = await page.evaluate(({ codes, terrainKey }) => {
    const terrain = window.hexwright.store.state.terrain.terrain || {};
    return codes.every((c) => terrain[c] !== terrainKey);
  }, { codes: dragCodes, terrainKey: setup.terrainKey });
  rec('single undo reverts whole drag stroke', undoRevert);

  // idempotent drag over already-painted hex — must NOT toggle off
  await page.mouse.click(p1.x, p1.y);
  await sleep(100);
  const paintedBeforeIdem = await page.evaluate(({ code, terrainKey }) => {
    return window.hexwright.store.state.terrain.terrain[code] === terrainKey;
  }, { code: setup.code, terrainKey: setup.terrainKey });
  rec('pre-drag click paints probe hex', paintedBeforeIdem, setup.code);

  const beforeIdemUndo = await page.evaluate(() => window.hexwright.store.undoStack.length);
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(p2.x, p2.y, { steps: 8 });
  await page.mouse.move(p1.x, p1.y, { steps: 8 });
  await page.mouse.up({ button: 'left' });
  await sleep(150);

  const idem = await page.evaluate(({ code, neighbor, terrainKey, beforeUndo }) => {
    const s = window.hexwright.store;
    const terrain = s.state.terrain.terrain || {};
    return {
      stillPainted: terrain[code] === terrainKey,
      neighborPainted: terrain[neighbor] === terrainKey,
      undoDelta: s.undoStack.length - beforeUndo
    };
  }, {
    code: setup.code,
    neighbor: setup.neighborCodes[0],
    terrainKey: setup.terrainKey,
    beforeUndo: beforeIdemUndo
  });
  rec('drag over pre-painted hex does not toggle it off', idem.stillPainted, setup.code);
  rec('idempotent drag still paints new hexes', idem.neighborPainted, setup.neighborCodes[0]);
  rec('idempotent drag remains one undo batch', idem.undoDelta === 1, `undo delta=${idem.undoDelta}`);

  if (setup.altTerrainKey) {
    await page.click(`#brush-card .ink[data-ink-key="${setup.altTerrainKey}"]`);
    await sleep(150);
    await page.mouse.click(p1.x, p1.y);
    await sleep(100);
    const reassigned = await page.evaluate(({ code, altTerrainKey }) => {
      return window.hexwright.store.state.terrain.terrain[code] === altTerrainKey;
    }, { code: setup.code, altTerrainKey: setup.altTerrainKey });
    rec('click with different terrain reassigns hex', reassigned, `${setup.terrainKey} -> ${setup.altTerrainKey}`);
  } else {
    rec('click with different terrain reassigns hex', true, 'only one terrain in palette');
  }

  rec('no uncaught console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('terrain-paint harness completed', false, err.message);
}

await browser.close();
srv.kill();

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
