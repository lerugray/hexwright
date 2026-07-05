// Per-layer clear control: arm/confirm two-step (NOT a native confirm() —
// see src/ui.js UI._armLayerClear), empty target layer, preserve others.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { skipIfMissing, GOTA_PROJECT_URL, PATHS } from './_local-data.mjs';

skipIfMissing(PATHS.gotaProject);

const DIR = process.cwd();
const PORT = 8029;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
// Regression guard: clear-layer is destructive and rare, but it must NEVER
// route through a native confirm() again — a dialog-suppression extension
// makes confirm() silently return false with no visible failure (the exact
// bug this two-step arm/confirm replacement fixes). Fail loudly if a real
// browser dialog ever appears.
page.on('dialog', async (d) => { errors.push(`UNEXPECTED NATIVE DIALOG: ${d.message()}`); await d.dismiss(); });

try {
  await page.goto(`http://localhost:${PORT}/?project=${GOTA_PROJECT_URL}`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('count-land');
    return el && /[1-9]/.test(el.textContent);
  }, { timeout: 25000 });
  await sleep(1500);

  // Simulate the operator's actual reported state: dialogs suppressed on this
  // origin. The two-step arm/confirm flow below must work purely off clicks —
  // it must not (and no longer does) depend on window.confirm at all.
  await page.evaluate(() => {
    window.confirm = () => false;
    window.alert = () => {};
    window.prompt = () => null;
  });

  const seeded = await page.evaluate(() => {
    const store = window.hexwright.store;
    const codes = Object.keys(store.state.terrain.terrain || {});
    if (codes.length < 4) return null;
    const a = codes[0];
    const b = codes[1];
    const c = codes[2];
    const d = codes[3];
    store.toggleHexsideFeature(a, b, 'road');
    store.toggleHexsideFeature(b, c, 'road');
    store.toggleHexsideFeature(a, d, 'rail');
    const count = (key) => {
      let n = 0;
      for (const arr of Object.values(store.state.hexsides || {})) {
        if (Array.isArray(arr) && arr.includes(key)) n++;
      }
      return n;
    };
    return {
      river: count('river'),
      road: count('road'),
      rail: count('rail'),
      terrain: Object.keys(store.state.terrain.terrain || {}).length,
      grid: !!store.state.grid
    };
  });

  rec('seed synthetic crossing layers alongside existing edge data',
    !!seeded && seeded.river > 0 && seeded.road >= 2 && seeded.rail >= 1,
    seeded ? `river=${seeded.river} road=${seeded.road} rail=${seeded.rail}` : 'could not seed');

  if (!seeded) throw new Error('Failed to seed synthetic layers');

  await page.waitForSelector('.layer-clear[data-feature-key="river"]', { timeout: 5000 });

  // --- First click arms, does not clear ---
  await page.click('.layer-clear[data-feature-key="river"]');
  await sleep(150);

  const afterFirstClick = await page.evaluate(() => {
    const btn = document.querySelector('.layer-clear[data-feature-key="river"]');
    const store = window.hexwright.store;
    const count = (key) => {
      let n = 0;
      for (const arr of Object.values(store.state.hexsides || {})) {
        if (Array.isArray(arr) && arr.includes(key)) n++;
      }
      return n;
    };
    return {
      river: count('river'),
      road: count('road'),
      rail: count('rail'),
      armed: !!btn && btn.classList.contains('confirming'),
      label: btn?.getAttribute('aria-label') || ''
    };
  });

  rec('first click arms the button instead of clearing', afterFirstClick.armed, JSON.stringify(afterFirstClick));
  rec('armed state leaves river entries intact', afterFirstClick.river === seeded.river, `river=${afterFirstClick.river}`);
  rec('armed state leaves other layers intact',
    afterFirstClick.road === seeded.road && afterFirstClick.rail === seeded.rail,
    `road=${afterFirstClick.road} rail=${afterFirstClick.rail}`);
  rec('armed label mentions layer name and entry count',
    new RegExp(`[Cc]lear river.*${seeded.river}`).test(afterFirstClick.label) || new RegExp(`River.*${seeded.river}`).test(afterFirstClick.label),
    afterFirstClick.label);

  // --- Clicking a DIFFERENT layer's clear button while one is armed re-targets
  // the arm instead of clearing the first-armed layer (no accidental clear of
  // the wrong layer). ---
  await page.click('.layer-clear[data-feature-key="rail"]');
  await sleep(150);

  const afterSwitch = await page.evaluate(() => {
    const store = window.hexwright.store;
    const count = (key) => {
      let n = 0;
      for (const arr of Object.values(store.state.hexsides || {})) {
        if (Array.isArray(arr) && arr.includes(key)) n++;
      }
      return n;
    };
    const riverBtn = document.querySelector('.layer-clear[data-feature-key="river"]');
    const railBtn = document.querySelector('.layer-clear[data-feature-key="rail"]');
    return {
      river: count('river'),
      rail: count('rail'),
      riverArmed: !!riverBtn && riverBtn.classList.contains('confirming'),
      railArmed: !!railBtn && railBtn.classList.contains('confirming')
    };
  });

  rec('clicking a different layer clears nothing yet', afterSwitch.river === seeded.river && afterSwitch.rail === seeded.rail,
    `river=${afterSwitch.river} rail=${afterSwitch.rail}`);
  rec('arm re-targets to the newly clicked layer, not the first one',
    !afterSwitch.riverArmed && afterSwitch.railArmed, JSON.stringify(afterSwitch));

  // --- Timeout disarms automatically (no lingering "confirming" state) ---
  await sleep(3300);
  const afterTimeout = await page.evaluate(() => {
    const btn = document.querySelector('.layer-clear[data-feature-key="rail"]');
    return { armed: !!btn && btn.classList.contains('confirming') };
  });
  rec('confirming state times out on its own', !afterTimeout.armed, JSON.stringify(afterTimeout));

  // --- Second click on the SAME button within the window performs the clear ---
  await page.click('.layer-clear[data-feature-key="river"]');
  await sleep(150);
  await page.click('.layer-clear[data-feature-key="river"]');
  await sleep(300);

  const afterClearRiver = await page.evaluate(() => {
    const store = window.hexwright.store;
    const count = (key) => {
      let n = 0;
      for (const arr of Object.values(store.state.hexsides || {})) {
        if (Array.isArray(arr) && arr.includes(key)) n++;
      }
      return n;
    };
    return {
      river: count('river'),
      road: count('road'),
      rail: count('rail'),
      terrain: Object.keys(store.state.terrain.terrain || {}).length,
      grid: !!store.state.grid,
      riverBtn: !!document.querySelector('.layer-clear[data-feature-key="river"]'),
      roadBtn: !!document.querySelector('.layer-clear[data-feature-key="road"]'),
      railBtn: !!document.querySelector('.layer-clear[data-feature-key="rail"]')
    };
  });

  rec('two clicks (suppressed-confirm state) clear the river layer', afterClearRiver.river === 0, `river=${afterClearRiver.river}`);
  rec('clear river preserves road crossing layer', afterClearRiver.road === seeded.road, `road=${afterClearRiver.road}`);
  rec('clear river preserves rail crossing layer', afterClearRiver.rail === seeded.rail, `rail=${afterClearRiver.rail}`);
  rec('clear river does not touch terrain', afterClearRiver.terrain === seeded.terrain, `terrain=${afterClearRiver.terrain}`);
  rec('clear river does not touch grid', afterClearRiver.grid === seeded.grid);
  rec('cleared layer row hides clear affordance', !afterClearRiver.riverBtn);
  rec('other layers still show clear affordance', afterClearRiver.roadBtn && afterClearRiver.railBtn);

  // --- Two-click clear works for a crossing (rail) layer too ---
  await page.click('.layer-clear[data-feature-key="rail"]');
  await sleep(150);
  await page.click('.layer-clear[data-feature-key="rail"]');
  await sleep(300);

  const afterClearRail = await page.evaluate(() => {
    const store = window.hexwright.store;
    const count = (key) => {
      let n = 0;
      for (const arr of Object.values(store.state.hexsides || {})) {
        if (Array.isArray(arr) && arr.includes(key)) n++;
      }
      return n;
    };
    return { rail: count('rail'), road: count('road') };
  });

  rec('two-click clear works for crossing (rail) layer',
    afterClearRail.rail === 0 && afterClearRail.road === seeded.road,
    `rail=${afterClearRail.rail} road=${afterClearRail.road}`);

  // --- Same arm/confirm two-step for the point-feature "clear layer" button
  // (clearPointFeatureLayer) — shares the exact same _armLayerClear /
  // _isLayerClearArmed machinery as the hexside layer above, but exercised
  // independently since it's a separate data layer (this.store.state.features). ---
  const pfSeed = await page.evaluate(() => {
    const { store } = window.hexwright;
    const decl = (store.getPalette()?.hexFeatures || [])[0];
    if (!decl) return null;
    const codes = Object.keys(store.centers || {}).filter((c) => store.getPointFeaturesAt(c).length === 0);
    if (codes.length < 2) return null;
    store.setPointFeature(codes[0], decl.key, { name: '', attrs: undefined });
    store.setPointFeature(codes[1], decl.key, { name: '', attrs: undefined });
    return { type: decl.key, count: store.countPointFeatureType(decl.key) };
  });

  rec('seed a point-feature layer to clear', !!pfSeed && pfSeed.count >= 2, JSON.stringify(pfSeed));

  if (pfSeed) {
    await page.waitForSelector(`.layer-clear[data-point-feature-key="${pfSeed.type}"]`, { timeout: 5000 });

    await page.click(`.layer-clear[data-point-feature-key="${pfSeed.type}"]`);
    await sleep(150);
    const pfAfterFirst = await page.evaluate((type) => {
      const btn = document.querySelector(`.layer-clear[data-point-feature-key="${type}"]`);
      return {
        count: window.hexwright.store.countPointFeatureType(type),
        armed: !!btn && btn.classList.contains('confirming')
      };
    }, pfSeed.type);
    rec('point-feature layer: first click arms, does not clear',
      pfAfterFirst.armed && pfAfterFirst.count === pfSeed.count, JSON.stringify(pfAfterFirst));

    await page.click(`.layer-clear[data-point-feature-key="${pfSeed.type}"]`);
    await sleep(200);
    const pfAfterSecond = await page.evaluate((type) => ({
      count: window.hexwright.store.countPointFeatureType(type),
      btnGone: !document.querySelector(`.layer-clear[data-point-feature-key="${type}"]`)
    }), pfSeed.type);
    rec('point-feature layer: second click (suppressed-confirm state) clears it',
      pfAfterSecond.count === 0 && pfAfterSecond.btnGone, JSON.stringify(pfAfterSecond));
  }

  rec('no uncaught console/page errors, no native dialogs', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('clear-layer harness completed', false, err.message);
}

await browser.close();
srv.kill();

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
