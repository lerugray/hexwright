// Terrain labels toggle + fill-opacity slider — pixel/text regression.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { terrainAbbrForKey } from '../src/geometry.js';

const DIR = process.cwd();
const PORT = 8035;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

rec('terrainAbbrForKey derives singles', terrainAbbrForKey('woods', null) === 'W' && terrainAbbrForKey('swamp', null) === 'SW');
rec('terrainAbbrForKey derives compounds', terrainAbbrForKey('woods_mountain', null) === 'W+M');
rec('terrainAbbrForKey honors abbr empty', terrainAbbrForKey('clear', { key: 'clear', abbr: '' }) === '');

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

const GRID = {
  grid_version: 2,
  n_cols: 4,
  row_counts_by_parity: { even: 3, odd: 3 },
  col_pitch_x: 120,
  row_pitch_y: 120,
  x_intercept_col0: 100,
  y_intercept_row0: 100,
  odd_col_y_offset: 60,
  image_full: [700, 500]
};

const PALETTE = {
  terrain: [
    { key: 'clear', color: '#c8b88a', abbr: '' },
    { key: 'woods', color: '#5c7a4a', abbr: 'W' },
    { key: 'water', color: '#3f78b4', abbr: 'WTR' }
  ],
  hexFeatures: [{ key: 'city', label: 'City', glyph: '\u25c9' }],
  hexsideFeatures: []
};

const sample = (renderer, wx, wy) => {
  const sp = renderer.worldToScreen({ x: wx, y: wy });
  const canvas = renderer.canvas;
  const dpr = canvas.width / renderer.width;
  const d = renderer.ctx.getImageData(Math.round(sp.x * dpr), Math.round(sp.y * dpr), 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
};

const isDarkInk = (px) => px[3] > 200 && px[0] < 60 && px[1] < 60 && px[2] < 60;

const sampleRegion = (renderer, wx, wy, radiusPx = 4) => {
  const sp = renderer.worldToScreen({ x: wx, y: wy });
  const canvas = renderer.canvas;
  const dpr = canvas.width / renderer.width;
  const cx = Math.round(sp.x * dpr);
  const cy = Math.round(sp.y * dpr);
  const r = Math.max(1, Math.round(radiusPx * dpr));
  const data = renderer.ctx.getImageData(cx - r, cy - r, r * 2 + 1, r * 2 + 1).data;
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) pixels.push([data[i], data[i + 1], data[i + 2], data[i + 3]]);
  return pixels;
};

const regionHasDarkInk = (pixels) => pixels.some(isDarkInk);

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 20000 });
  await sleep(400);

  const setup = await page.evaluate(({ GRID, PALETTE }) => {
    const { store, renderer, geo } = window.hexwright;
    store.setPalette(PALETTE);
    store.setProject({
      grid: GRID,
      imageFull: GRID.image_full,
      terrain: { terrain: { '0001': 'woods', '0101': 'clear', '0201': 'water' } },
      hexsides: {},
      features: { '0001': { city: { name: 'X', attrs: { vp: 1 } } } },
      mapImage: null,
      blankLattice: false
    });
    store.rebuildIndex();
    renderer.setViewMode('classification');
    const code = '0001';
    const c = geo.hexCenter(code, GRID);
    const r = geo.hexRadius(GRID);
    const zoom = 2.5;
    renderer.view = {
      baseScale: 1, zoom,
      panX: renderer.width / 2 - c.x * zoom,
      panY: renderer.height / 2 - c.y * zoom
    };
    return { c, r, code };
  }, { GRID, PALETTE });

  const drawSample = async (opts) => page.evaluate(({ setup, opts }) => {
    const { renderer } = window.hexwright;
    if (opts.viewMode) renderer.setViewMode(opts.viewMode);
    renderer.terrainLabelsVisible = !!opts.labels;
    renderer.terrainFillAlpha = opts.alpha ?? 1;
    renderer.draw();
    const { c, r } = setup;
    const upper = { x: c.x, y: c.y - r * 0.33 };
    const center = { x: c.x, y: c.y };
    const sampleRegion = (pt) => {
      const sp = renderer.worldToScreen(pt);
      const dpr = renderer.canvas.width / renderer.width;
      const cx = Math.round(sp.x * dpr);
      const cy = Math.round(sp.y * dpr);
      const rad = 6;
      const data = renderer.ctx.getImageData(cx - rad, cy - rad, rad * 2 + 1, rad * 2 + 1).data;
      const pixels = [];
      for (let i = 0; i < data.length; i += 4) pixels.push([data[i], data[i + 1], data[i + 2], data[i + 3]]);
      return pixels;
    };
    const isDark = (px) => px[3] > 200 && px[0] < 60 && px[1] < 60 && px[2] < 60;
    const upperPx = sampleRegion(upper);
    const centerPx = sampleRegion(center);
    const mean = (pixels) => pixels.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0])
      .map((v) => v / pixels.length);
    return {
      upperHasInk: upperPx.some(isDark),
      centerHasInk: centerPx.some(isDark),
      centerMean: mean(centerPx)
    };
  }, { setup, opts });

  const off = await drawSample({ labels: false });
  rec('labels off: no dark ink at upper third', !off.upperHasInk);

  const on = await drawSample({ labels: true });
  rec('labels on: dark ink at upper third', on.upperHasInk);
  rec('labels on: center glyph still dark at center', on.centerHasInk);
  rec('label upper third distinct from center glyph row',
    on.upperHasInk && on.centerHasInk, 'both regions have ink at different Y');

  // Label-size slider: measure the actual rendered ink width of the hex-name
  // label at a small vs. large scale (objective pixel measurement, not a glance —
  // see verify-reported-visual-defects-objectively.md).
  const measureNameLabelWidth = async (labelScale) => page.evaluate(({ GRID, labelScale }) => {
    const { store, renderer, geo } = window.hexwright;
    store.state.names = { '0001': 'Testburgmontagne' };
    store.state.terrain.terrain = { '0001': 'woods' };
    store.rebuildIndex();
    renderer.terrainLabelsVisible = true;
    renderer.terrainLabelScale = labelScale;
    const code = '0001';
    const c = geo.hexCenter(code, GRID);
    const r = geo.hexRadius(GRID);
    const zoom = 2.5;
    renderer.view = {
      baseScale: 1, zoom,
      panX: renderer.width / 2 - c.x * zoom,
      panY: renderer.height / 2 - c.y * zoom
    };
    renderer.draw();
    // Name sits at center.y - r*0.08 in world space when an abbr is also present.
    const sp = renderer.worldToScreen({ x: c.x, y: c.y - r * 0.08 });
    const dpr = renderer.canvas.width / renderer.width;
    const cy = Math.round(sp.y * dpr);
    const cx = Math.round(sp.x * dpr);
    const half = Math.round(220 * dpr);
    const x0 = Math.max(0, cx - half);
    const w = Math.min(renderer.canvas.width - x0, half * 2);
    const data = renderer.ctx.getImageData(x0, cy, w, 1).data;
    let minX = null, maxX = null;
    for (let i = 0; i < data.length; i += 4) {
      const dark = data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60 && data[i + 3] > 200;
      if (dark) {
        const x = i / 4;
        if (minX === null) minX = x;
        maxX = x;
      }
    }
    return minX === null ? 0 : (maxX - minX);
  }, { GRID, labelScale });

  const widthSmall = await measureNameLabelWidth(0.6);
  const widthLarge = await measureNameLabelWidth(2.5);
  rec('label-size slider measurably widens rendered name-label ink',
    widthSmall > 0 && widthLarge > widthSmall * 1.5,
    `small=${widthSmall}px large=${widthLarge}px`);

  const clearOnly = await page.evaluate(({ GRID, PALETTE }) => {
    const { store, renderer, geo } = window.hexwright;
    store.state.terrain.terrain = { '0101': 'clear' };
    store.rebuildIndex();
    const code = '0101';
    const c = geo.hexCenter(code, GRID);
    const r = geo.hexRadius(GRID);
    renderer.terrainLabelsVisible = true;
    renderer.draw();
    const upper = { x: c.x, y: c.y - r * 0.33 };
    const sp = renderer.worldToScreen(upper);
    const dpr = renderer.canvas.width / renderer.width;
    const cx = Math.round(sp.x * dpr);
    const cy = Math.round(sp.y * dpr);
    const rad = 6;
    const data = renderer.ctx.getImageData(cx - rad, cy - rad, rad * 2 + 1, rad * 2 + 1).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60 && data[i + 3] > 200) return true;
    }
    return false;
  }, { GRID, PALETTE });
  rec('abbr empty suppresses label on clear', clearOnly === false);

  const opacitySample = async (alpha) => page.evaluate(({ GRID, alpha }) => {
    const { store, renderer, geo } = window.hexwright;
    store.state.terrain.terrain = { '0201': 'woods' };
    store.state.features = {};
    store.rebuildIndex();
    renderer.setViewMode('both');
    renderer.terrainLabelsVisible = false;
    renderer.terrainFillAlpha = alpha;
    renderer.terrainFillVisible = true;
    const code = '0201';
    const c = geo.hexCenter(code, GRID);
    const zoom = 2.5;
    renderer.view = {
      baseScale: 1, zoom,
      panX: renderer.width / 2 - c.x * zoom,
      panY: renderer.height / 2 - c.y * zoom
    };
    renderer.draw();
    const sp = renderer.worldToScreen(c);
    const dpr = renderer.canvas.width / renderer.width;
    const cx = Math.round(sp.x * dpr);
    const cy = Math.round(sp.y * dpr);
    const d = renderer.ctx.getImageData(cx, cy, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, { GRID, alpha });

  const lowRgb = await opacitySample(0.2);
  const highRgb = await opacitySample(1);
  rec('fill opacity slider lowers fill strength',
    lowRgb[1] > highRgb[1], `lowG=${lowRgb[1]} highG=${highRgb[1]} rgbLow=${lowRgb.join(',')} rgbHigh=${highRgb.join(',')}`);

  // UI wiring: toggle button + localStorage persistence
  await page.evaluate(({ GRID, PALETTE }) => {
    const { store, ui } = window.hexwright;
    store.setPalette(PALETTE);
    store.setProject({
      grid: GRID,
      imageFull: GRID.image_full,
      terrain: { terrain: { '0201': 'water' } },
      hexsides: {},
      mapImage: null
    });
    ui.toggleTerrainLabels(true);
  }, { GRID, PALETTE });

  const btnOn = await page.evaluate(() => {
    const btn = document.getElementById('terrain-labels-toggle');
    return btn?.classList.contains('on') && btn?.getAttribute('aria-pressed') === 'true';
  });
  rec('Lbl button reflects on state', btnOn === true);

  await page.keyboard.press('l');
  await sleep(80);
  const toggledOff = await page.evaluate(() => !window.hexwright.renderer.terrainLabelsVisible);
  rec('L keyboard shortcut toggles labels off', toggledOff);

  const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem('hexwright.view');
    const v = JSON.parse(raw);
    return typeof v.terrainLabelsVisible === 'boolean' && typeof v.terrainFillAlpha === 'number';
  });
  rec('view settings persist labels + fill opacity', persisted);

  await page.locator('#terrain-fill-opacity').fill('0.35');
  await sleep(80);
  const sliderVal = await page.evaluate(() => window.hexwright.renderer.terrainFillAlpha);
  rec('terrain fill opacity slider updates renderer', Math.abs(sliderVal - 0.35) < 0.01, String(sliderVal));

  // Label-size slider: visibility gating, live-update, persistence, reload.
  await page.evaluate(() => window.hexwright.ui.toggleTerrainLabels(true));
  const rowVisibleWhenOn = await page.evaluate(() => !document.getElementById('terrain-label-size-row').hidden);
  rec('label-size row visible when labels on', rowVisibleWhenOn);

  await page.locator('#terrain-label-size').fill('2');
  await sleep(80);
  const scaleVal = await page.evaluate(() => window.hexwright.renderer.terrainLabelScale);
  rec('label-size slider updates renderer', Math.abs(scaleVal - 2) < 0.01, String(scaleVal));

  const scalePersisted = await page.evaluate(() => {
    const raw = localStorage.getItem('hexwright.view');
    const v = JSON.parse(raw);
    return typeof v.terrainLabelScale === 'number' && Math.abs(v.terrainLabelScale - 2) < 0.01;
  });
  rec('label-size persists in view settings', scalePersisted);

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.hexwright?.store, { timeout: 15000 });
  await sleep(300);
  const afterReload = await page.evaluate(() => ({
    scale: window.hexwright.renderer.terrainLabelScale,
    sliderVal: parseFloat(document.getElementById('terrain-label-size').value),
    rowVisible: !document.getElementById('terrain-label-size-row').hidden
  }));
  rec('label-size scale survives reload', Math.abs(afterReload.scale - 2) < 0.01, String(afterReload.scale));
  rec('label-size slider reflects restored value after reload', Math.abs(afterReload.sliderVal - 2) < 0.01, String(afterReload.sliderVal));
  rec('label-size row visible after reload (labels were on)', afterReload.rowVisible);

  await page.evaluate(() => window.hexwright.ui.toggleTerrainLabels(false));
  const rowHiddenWhenOff = await page.evaluate(() => document.getElementById('terrain-label-size-row').hidden);
  rec('label-size row hides when labels off', rowHiddenWhenOff);

  rec('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  rec('run', false, String(e));
} finally {
  await browser.close();
  srv.kill();
  const fails = results.filter((x) => !x.ok).length;
  console.log(`\n=== ${results.length - fails}/${results.length} passed ===`);
  process.exit(fails ? 1 : 0);
}
