// class-layer-load-check — proves the loader actually LOADS every palette-mapped
// hexside layer from a v1 grouped bundle (NaB class-split). Regression guard for
// the 2026-07-04 bug where V1_EXPORT_LAYERS was hardcoded and the four class-split
// layers (rivers/roads primary+secondary) were silently dropped while bridges loaded.
// Counts are asserted against local/nab/hexsides.json itself, not hardcoded.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PARENT = resolve(REPO, '..');
const REPO_NAME = basename(REPO);
const PORT = 8031;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

// Expected counts straight from the bundle + palette alias map.
const bundle = JSON.parse(readFileSync(resolve(REPO, 'local/nab/hexsides.json'), 'utf8'));
const palette = JSON.parse(readFileSync(resolve(REPO, 'palettes/nab.json'), 'utf8'));
const aliases = palette.hexsideAliases || {};
const expected = {};
for (const [layer, list] of Object.entries(bundle)) {
  if (!Array.isArray(list)) continue;
  const key = aliases[layer];
  if (key) expected[key] = (expected[key] || 0) + list.length;
}

// Serve from the PARENT folder (like the NaB launcher) so the sibling-repo map
// raster path in project.json resolves.
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: PARENT, stdio: 'ignore' });
await sleep(1300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
const warns = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
  if (m.type() === 'warning') warns.push(m.text());
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

try {
  await page.goto(
    `http://localhost:${PORT}/${REPO_NAME}/?project=local/nab/project.json`,
    { waitUntil: 'load', timeout: 20000 }
  );
  await page.waitForFunction(() => {
    const hw = window.hexwright;
    return hw && hw.store && hw.store.state && hw.store.state.hexsides
      && Object.keys(hw.store.state.hexsides).length > 0;
  }, { timeout: 25000 });
  await sleep(500);

  const counts = await page.evaluate(() => {
    const out = {};
    for (const arr of Object.values(window.hexwright.store.state.hexsides)) {
      if (!Array.isArray(arr)) continue;
      for (const f of arr) out[f] = (out[f] || 0) + 1;
    }
    return out;
  });

  for (const [key, want] of Object.entries(expected)) {
    const got = counts[key] || 0;
    rec(`layer "${key}" fully loaded`, got === want, `${got}/${want}`);
  }
  const dropWarns = warns.filter((w) => w.includes('NOT loaded'));
  rec('no layers dropped with a warning', dropWarns.length === 0, dropWarns.join(' | '));
  rec('no uncaught console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('class-layer harness completed', false, err.message);
}

await browser.close();
srv.kill();

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
