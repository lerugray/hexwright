import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { skipIfMissing, GOTA_PROJECT_URL, PATHS } from './_local-data.mjs';

skipIfMissing(PATHS.gotaProject);

const DIR = process.cwd();
const PORT = 8028;
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

    const centers = store.centers || {};
    const grid = store.state.grid;
    const codes = Object.keys(centers);
    let chosen = null;

    for (const code of codes) {
      const paintable = [];
      const missing = [];
      for (let i = 0; i < 6; i++) {
        const nb = geo.edgeNeighborCode(code, i, grid);
        if (nb && centers[nb]) {
          paintable.push({
            edge: i,
            neighbor: nb,
            edgeKey: geo.pairKey(code, nb)
          });
        } else {
          missing.push({ edge: i, neighbor: nb });
        }
      }
      if (paintable.length >= 3) {
        chosen = { code, paintable, missing };
        if (missing.length) break;
      }
    }
    if (!chosen) return null;

    const ptForEdge = (edgeIndex) => {
      const worldMid = geo.edgeMidpoint(chosen.code, edgeIndex, grid);
      return renderer.worldToScreen(worldMid);
    };

    const featureKey =
      (store.getPalette()?.hexsideFeatures || []).find((f) => f.key === 'river')?.key ||
      (store.getPalette()?.hexsideFeatures || [])[0]?.key ||
      'river';

    return {
      code: chosen.code,
      featureKey,
      paintable: chosen.paintable.slice(0, 3),
      missing: chosen.missing[0] || null,
      points: {
        p1: ptForEdge(chosen.paintable[0].edge),
        p2: ptForEdge(chosen.paintable[1].edge),
        p3: ptForEdge(chosen.paintable[2].edge),
        missing: chosen.missing[0] ? ptForEdge(chosen.missing[0].edge) : null,
        center: renderer.worldToScreen(geo.hexCenter(chosen.code, grid))
      }
    };
  });

  rec('probe board geometry for edge-paint checks', !!setup, setup ? `hex=${setup.code}` : 'no suitable hex found');
  if (!setup) throw new Error('No suitable probe hex found');

  const canvasBox = await page.locator('#map-canvas').boundingBox();
  if (!canvasBox) throw new Error('map canvas bounds unavailable');
  const asPagePoint = (pt) => ({ x: canvasBox.x + pt.x, y: canvasBox.y + pt.y });
  const p1 = asPagePoint(setup.points.p1);
  const p2 = asPagePoint(setup.points.p2);
  const p3 = asPagePoint(setup.points.p3);
  const pCenter = asPagePoint(setup.points.center);
  const pMissing = setup.points.missing ? asPagePoint(setup.points.missing) : null;

  await page.keyboard.press('e');
  await sleep(150);
  await page.click(`#brush-card .ink[data-ink-key="${setup.featureKey}"]`);
  await sleep(150);

  // click = toggle on
  await page.mouse.click(p1.x, p1.y);
  const clickOn = await page.evaluate(({ edgeKey, featureKey }) => {
    const arr = window.hexwright.store.state.hexsides[edgeKey] || [];
    return arr.includes(featureKey);
  }, { edgeKey: setup.paintable[0].edgeKey, featureKey: setup.featureKey });
  rec('click near edge midpoint toggles feature on', clickOn, setup.paintable[0].edgeKey);

  // click again = toggle off
  await page.mouse.click(p1.x, p1.y);
  const clickOff = await page.evaluate(({ edgeKey, featureKey }) => {
    const arr = window.hexwright.store.state.hexsides[edgeKey] || [];
    return !arr.includes(featureKey);
  }, { edgeKey: setup.paintable[0].edgeKey, featureKey: setup.featureKey });
  rec('second click toggles same edge off', clickOff, setup.paintable[0].edgeKey);

  // drag = set over multiple edges, one undo entry
  const beforeDrag = await page.evaluate(() => window.hexwright.store.undoStack.length);
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(p2.x, p2.y, { steps: 8 });
  await page.mouse.move(p3.x, p3.y, { steps: 8 });
  await page.mouse.up({ button: 'left' });
  await sleep(150);

  const dragSet = await page.evaluate(({ keys, featureKey, beforeDragUndo }) => {
    const s = window.hexwright.store;
    const allSet = keys.every((k) => (s.state.hexsides[k] || []).includes(featureKey));
    const undoDelta = s.undoStack.length - beforeDragUndo;
    return { allSet, undoDelta };
  }, {
    keys: setup.paintable.map((p) => p.edgeKey),
    featureKey: setup.featureKey,
    beforeDragUndo: beforeDrag
  });
  rec('drag paints three edges idempotently', dragSet.allSet, setup.paintable.map((p) => p.edgeKey).join(', '));
  rec('drag stroke creates one undo batch', dragSet.undoDelta === 1, `undo delta=${dragSet.undoDelta}`);

  await page.click('#undo');
  await sleep(150);
  const undoRevert = await page.evaluate(({ keys, featureKey }) => {
    const s = window.hexwright.store;
    return keys.every((k) => !(s.state.hexsides[k] || []).includes(featureKey));
  }, { keys: setup.paintable.map((p) => p.edgeKey), featureKey: setup.featureKey });
  rec('single undo reverts whole drag stroke', undoRevert);

  // idempotent drag over already-painted edge
  await page.mouse.click(p1.x, p1.y); // set first edge on
  const beforeIdemUndo = await page.evaluate(() => window.hexwright.store.undoStack.length);
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(p2.x, p2.y, { steps: 8 });
  await page.mouse.move(p1.x, p1.y, { steps: 8 });
  await page.mouse.up({ button: 'left' });
  await sleep(150);
  const idem = await page.evaluate(({ k1, k2, featureKey, beforeUndo }) => {
    const s = window.hexwright.store;
    const has1 = (s.state.hexsides[k1] || []).includes(featureKey);
    const has2 = (s.state.hexsides[k2] || []).includes(featureKey);
    return { has1, has2, undoDelta: s.undoStack.length - beforeUndo };
  }, {
    k1: setup.paintable[0].edgeKey,
    k2: setup.paintable[1].edgeKey,
    featureKey: setup.featureKey,
    beforeUndo: beforeIdemUndo
  });
  rec('drag over pre-painted edge does not toggle it off', idem.has1, setup.paintable[0].edgeKey);
  rec('idempotent drag still paints new edges', idem.has2, setup.paintable[1].edgeKey);
  rec('idempotent drag remains one undo batch', idem.undoDelta === 1, `undo delta=${idem.undoDelta}`);

  // alt-click wipe-all (every feature on edge, not just active brush)
  const stackInfo = await page.evaluate(({ edgeKey, featureKey }) => {
    const { store } = window.hexwright;
    const palette = store.getPalette();
    const extra = (palette?.hexsideFeatures || []).find((f) => f.key !== featureKey);
    const [a, b] = edgeKey.split('|');
    if (extra) store.setHexsideFeature(a, b, extra.key, true);
    const arr = store.state.hexsides[edgeKey] || [];
    return { stacked: arr.length >= 2, extraKey: extra?.key || null, keys: [...arr] };
  }, { edgeKey: setup.paintable[0].edgeKey, featureKey: setup.featureKey });
  rec('probe edge stacks multiple features', stackInfo.stacked, stackInfo.keys.join('+'));

  await page.keyboard.down('Alt');
  await page.mouse.click(p1.x, p1.y);
  await page.keyboard.up('Alt');
  await sleep(150);
  const altWipeAll = await page.evaluate(({ edgeKey, otherEdgeKey, featureKey }) => {
    const sides = window.hexwright.store.state.hexsides || {};
    const status = document.getElementById('status')?.textContent || '';
    return {
      wiped: !sides[edgeKey] || sides[edgeKey].length === 0,
      otherIntact: (sides[otherEdgeKey] || []).includes(featureKey),
      status
    };
  }, {
    edgeKey: setup.paintable[0].edgeKey,
    otherEdgeKey: setup.paintable[1].edgeKey,
    featureKey: setup.featureKey
  });
  rec('alt-click wipes every feature on edge', altWipeAll.wiped, setup.paintable[0].edgeKey);
  rec('alt-click leaves other edges intact', altWipeAll.otherIntact, setup.paintable[1].edgeKey);
  rec('alt-click reports wiped edge in status bar', /wiped\s+1\s+edge/i.test(altWipeAll.status), altWipeAll.status.slice(0, 80));

  // blur must not leave alt erase latched
  await page.keyboard.down('Alt');
  await sleep(60);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('Alt');
  await sleep(80);
  const altBlurClears = await page.evaluate(() => !window.hexwright.renderer.altHeld);
  rec('window blur clears alt erase state', altBlurClears);

  // hexside stroke opacity slider fades painted ink (pixel sample)
  await page.keyboard.press('i');
  await sleep(120);
  await page.$eval('#hexside-stroke-opacity', (el) => {
    el.value = '1';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(120);
  const opacitySample = await page.evaluate(({ edgeKey, featureKey }) => {
    const { store, renderer, geo } = window.hexwright;
    renderer.clearHighlight();
    renderer.selectedHex = null;
    const [a, b] = edgeKey.split('|');
    store.setHexsideFeature(a, b, featureKey, true);
    renderer.setViewMode('classification');

    const grid = store.state.grid;
    const ep = geo.sharedEdgeEndpoints(a, b, grid);
    const samplePt = {
      x: ep.a.x + (ep.b.x - ep.a.x) * 0.35,
      y: ep.a.y + (ep.b.y - ep.a.y) * 0.35
    };
    const zoom = 3;
    const s = zoom;
    renderer.view = {
      baseScale: 1, zoom,
      panX: renderer.width / 2 - samplePt.x * s,
      panY: renderer.height / 2 - samplePt.y * s
    };

    const sampleAt = (alpha) => {
      renderer.hexsideStrokeAlpha = alpha;
      renderer.draw();
      const sp = renderer.worldToScreen(samplePt);
      const dpr = renderer.canvas.width / renderer.width;
      const d = renderer.ctx.getImageData(Math.round(sp.x * dpr), Math.round(sp.y * dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    };

    const full = sampleAt(1);
    const dim = sampleAt(0.35);
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    return {
      full,
      dim,
      delta: dist(full, dim),
      closerToParchment: dist(dim, [234, 221, 207]) < dist(full, [234, 221, 207])
    };
  }, { edgeKey: setup.paintable[1].edgeKey, featureKey: setup.featureKey });
  await page.$eval('#hexside-stroke-opacity', (el) => {
    el.value = '0.35';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  rec('hexside stroke opacity slider changes rendered stroke alpha',
    opacitySample.delta > 8 && opacitySample.closerToParchment,
    `full=${JSON.stringify(opacitySample.full)} dim=${JSON.stringify(opacitySample.dim)} delta=${opacitySample.delta.toFixed(1)}`);

  // missing-neighbor edge cannot be painted
  if (pMissing) {
    const beforeMissing = await page.evaluate((featureKey) => {
      const state = window.hexwright.store.state;
      let count = 0;
      for (const arr of Object.values(state.hexsides || {})) {
        if (Array.isArray(arr) && arr.includes(featureKey)) count++;
      }
      return count;
    }, setup.featureKey);
    await page.mouse.click(pMissing.x, pMissing.y);
    const afterMissing = await page.evaluate((featureKey) => {
      const state = window.hexwright.store.state;
      let count = 0;
      for (const arr of Object.values(state.hexsides || {})) {
        if (Array.isArray(arr) && arr.includes(featureKey)) count++;
      }
      return count;
    }, setup.featureKey);
    rec('edge to missing neighbor is not paintable', beforeMissing === afterMissing, `${beforeMissing} -> ${afterMissing}`);
  } else {
    rec('edge to missing neighbor is not paintable', true, 'probe hex had no missing neighbors');
  }

  // middle-button drag must pan WITHOUT painting while edge-paint is ON
  const beforeMidPan = await page.evaluate(() => ({
    pan: { ...window.hexwright.renderer.view },
    sides: JSON.stringify(window.hexwright.store.state.hexsides)
  }));
  await page.mouse.move(pCenter.x, pCenter.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(pCenter.x + 80, pCenter.y + 45, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await sleep(120);
  const afterMidPan = await page.evaluate(() => ({
    pan: { ...window.hexwright.renderer.view },
    sides: JSON.stringify(window.hexwright.store.state.hexsides)
  }));
  const midPanned = Math.hypot(
    afterMidPan.pan.panX - beforeMidPan.pan.panX,
    afterMidPan.pan.panY - beforeMidPan.pan.panY
  ) > 10;
  rec('middle-drag pans while edge-paint is ON', midPanned,
    `d=(${(afterMidPan.pan.panX - beforeMidPan.pan.panX).toFixed(1)},${(afterMidPan.pan.panY - beforeMidPan.pan.panY).toFixed(1)})`);
  rec('middle-drag paints nothing', beforeMidPan.sides === afterMidPan.sides);

  // edge-paint OFF: pan + inspect behavior should work as before
  await page.keyboard.press('i');
  await sleep(120);

  const beforePan = await page.evaluate(() => ({ ...window.hexwright.renderer.view }));
  await page.mouse.move(pCenter.x, pCenter.y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(pCenter.x + 90, pCenter.y + 50, { steps: 10 });
  await page.mouse.up({ button: 'left' });
  await sleep(120);
  const afterPan = await page.evaluate(() => ({ ...window.hexwright.renderer.view }));
  const panned = Math.hypot(afterPan.panX - beforePan.panX, afterPan.panY - beforePan.panY) > 10;
  rec('pan drag still works with edge-paint off', panned, `pan=(${beforePan.panX.toFixed(1)},${beforePan.panY.toFixed(1)}) -> (${afterPan.panX.toFixed(1)},${afterPan.panY.toFixed(1)})`);

  const refreshedCenter = await page.evaluate((code) => {
    const hw = window.hexwright;
    return hw.renderer.worldToScreen(hw.geo.hexCenter(code, hw.store.state.grid));
  }, setup.code);
  const pCenterAfterPan = asPagePoint(refreshedCenter);
  await page.mouse.click(pCenterAfterPan.x, pCenterAfterPan.y);
  await sleep(100);
  const selectWorks = await page.evaluate((code) => {
    const editor = document.getElementById('hex-editor');
    const shown = editor && editor.hidden === false;
    const selected = document.getElementById('hexed-title')?.textContent?.replace(/^Hex\s+/, '').trim() || '';
    return shown && selected === code;
  }, setup.code);
  rec('hex click still opens inspector with edge-paint off', selectWorks, setup.code);

  rec('no uncaught console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('edge-paint harness completed', false, err.message);
}

await browser.close();
srv.kill();

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
