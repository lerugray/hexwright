// Per-layer clear control: confirm dialog, empty target layer, preserve others.
import { chromium } from 'playwright';
import { spawn } from 'child_process';

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

try {
  await page.goto(`http://localhost:${PORT}/?project=samples/gota-project.json`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('count-land');
    return el && /[1-9]/.test(el.textContent);
  }, { timeout: 25000 });
  await sleep(1500);

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

  let cancelMsg = '';
  page.once('dialog', async (dialog) => {
    cancelMsg = dialog.message();
    await dialog.dismiss();
  });
  await page.click('.layer-clear[data-feature-key="river"]');
  await sleep(200);

  const afterCancel = await page.evaluate(() => {
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
      terrain: Object.keys(store.state.terrain.terrain || {}).length
    };
  });

  rec('confirm dialog mentions layer name and entry count',
    new RegExp(`Clear River \\(${seeded.river} entries\\)`).test(cancelMsg) && cancelMsg.includes('cannot be undone'),
    cancelMsg.slice(0, 80));
  rec('canceled confirm leaves river entries intact', afterCancel.river === seeded.river, `river=${afterCancel.river}`);
  rec('canceled confirm leaves other layers intact',
    afterCancel.road === seeded.road && afterCancel.rail === seeded.rail,
    `road=${afterCancel.road} rail=${afterCancel.rail}`);

  let acceptMsg = '';
  page.once('dialog', async (dialog) => {
    acceptMsg = dialog.message();
    await dialog.accept();
  });
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

  rec('accepted confirm clears river layer', afterClearRiver.river === 0, `river=${afterClearRiver.river}`);
  rec('clear river preserves road crossing layer', afterClearRiver.road === seeded.road, `road=${afterClearRiver.road}`);
  rec('clear river preserves rail crossing layer', afterClearRiver.rail === seeded.rail, `rail=${afterClearRiver.rail}`);
  rec('clear river does not touch terrain', afterClearRiver.terrain === seeded.terrain, `terrain=${afterClearRiver.terrain}`);
  rec('clear river does not touch grid', afterClearRiver.grid === seeded.grid);
  rec('cleared layer row hides clear affordance', !afterClearRiver.riverBtn);
  rec('other layers still show clear affordance', afterClearRiver.roadBtn && afterClearRiver.railBtn);

  let railMsg = '';
  page.once('dialog', async (dialog) => {
    railMsg = dialog.message();
    await dialog.accept();
  });
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

  rec('confirm dialog works for crossing (rail) layer', /Clear Rail \(1 entries\)/.test(railMsg), railMsg.slice(0, 60));
  rec('clear rail empties crossing layer only', afterClearRail.rail === 0 && afterClearRail.road === seeded.road,
    `rail=${afterClearRail.rail} road=${afterClearRail.road}`);

  rec('no uncaught console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('clear-layer harness completed', false, err.message);
}

await browser.close();
srv.kill();

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
