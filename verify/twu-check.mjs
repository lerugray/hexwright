import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { skipIfMissing, GOTA_PROJECT_URL, PATHS } from './_local-data.mjs';

skipIfMissing(PATHS.gotaProject);

const DIR = process.cwd();
const PORT = 8030;
const FIXTURES_DIR = path.join(DIR, 'verify', 'fixtures');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

const normalizeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const sorted = (arr) => [...arr].sort();
const unique = (arr) => [...new Set(arr)];

const pairSetFromPairArrays = (pairs = []) =>
  new Set(
    pairs
      .filter((entry) => Array.isArray(entry) && entry.length === 2)
      .map(([a, b]) => normalizeKey(String(a), String(b)))
  );

function assertSortedPairArrays(pairs) {
  for (const pair of pairs || []) {
    if (!Array.isArray(pair) || pair.length !== 2) return false;
    if (typeof pair[0] !== 'string' || typeof pair[1] !== 'string') return false;
    if (!pair[0] || !pair[1]) return false;
    if (!(pair[0] < pair[1])) return false;
  }
  for (let i = 1; i < (pairs || []).length; i++) {
    const prev = pairs[i - 1];
    const next = pairs[i];
    if (prev[0] > next[0] || (prev[0] === next[0] && prev[1] > next[1])) return false;
  }
  return true;
}

const fixtureRivers = JSON.parse(await fs.readFile(path.join(FIXTURES_DIR, 'twu-rivers.json'), 'utf8'));
const fixtureRail = JSON.parse(await fs.readFile(path.join(FIXTURES_DIR, 'twu-rail.json'), 'utf8'));
const fixtureInvalidPath = path.join(FIXTURES_DIR, 'twu-invalid.json');

const expectedRiverKeys = sorted([...pairSetFromPairArrays(fixtureRivers.hexsides)]);
const expectedRailKeys = sorted([...pairSetFromPairArrays(
  fixtureRail.links.map((entry) => Array.isArray(entry) ? entry : [entry.a, entry.b])
)]);
const expectedTouchedHexes = sorted(unique([
  ...fixtureRivers.hexsides.flat(),
  ...fixtureRail.links.flatMap((entry) => (Array.isArray(entry) ? entry : [entry.a, entry.b]))
].map((v) => String(v))));

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept().catch(() => {}));

try {
  await page.goto(`http://localhost:${PORT}/?project=${GOTA_PROJECT_URL}`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const el = document.getElementById('count-land');
    return el && /[1-9]/.test(el.textContent || '');
  }, { timeout: 25000 });
  await sleep(1200);

  const beforeRiversUndo = await page.evaluate(() => window.hexwright.store.undoStack.length);
  await page.setInputFiles('#import-twu', path.join(FIXTURES_DIR, 'twu-rivers.json'));
  await sleep(350);

  const riversState = await page.evaluate(({ expectedKeys, beforeUndo }) => {
    const s = window.hexwright.store;
    const terrain = s.state.terrain?.terrain || {};
    const provenance = s.state.provenance || {};
    const riverKeys = Object.entries(s.state.hexsides || {})
      .filter(([, features]) => Array.isArray(features) && features.includes('river'))
      .map(([k]) => k)
      .sort();
    const missing = expectedKeys.filter((key) => !riverKeys.includes(key));
    const touched = Array.from(new Set(expectedKeys.flatMap((key) => key.split('|')))).sort();
    const draftFailures = touched
      .filter((code) => Object.prototype.hasOwnProperty.call(terrain, code))
      .filter((code) => provenance[code] !== 'draft');
    return {
      undoDelta: s.undoStack.length - beforeUndo,
      missing,
      draftFailures,
      status: document.getElementById('status')?.textContent || ''
    };
  }, { expectedKeys: expectedRiverKeys, beforeUndo: beforeRiversUndo });

  rec('rivers fixture imports expected edge pairs', riversState.missing.length === 0, riversState.missing.join(','));
  rec('rivers import marks touched terrain hexes as draft', riversState.draftFailures.length === 0, riversState.draftFailures.join(','));
  rec('rivers import is one undo step', riversState.undoDelta === 1, `undo delta=${riversState.undoDelta}`);

  const beforeRailUndo = await page.evaluate(() => window.hexwright.store.undoStack.length);
  await page.setInputFiles('#import-twu', path.join(FIXTURES_DIR, 'twu-rail.json'));
  await sleep(350);

  const railState = await page.evaluate(({ expectedKeys, touchedHexes, beforeUndo }) => {
    const s = window.hexwright.store;
    const terrain = s.state.terrain?.terrain || {};
    const provenance = s.state.provenance || {};
    const railKeys = Object.entries(s.state.hexsides || {})
      .filter(([, features]) => Array.isArray(features) && features.includes('rail'))
      .map(([k]) => k)
      .sort();
    const missing = expectedKeys.filter((key) => !railKeys.includes(key));
    const draftFailures = touchedHexes
      .filter((code) => Object.prototype.hasOwnProperty.call(terrain, code))
      .filter((code) => provenance[code] !== 'draft');
    return {
      undoDelta: s.undoStack.length - beforeUndo,
      missing,
      draftFailures,
      status: document.getElementById('status')?.textContent || ''
    };
  }, { expectedKeys: expectedRailKeys, touchedHexes: expectedTouchedHexes, beforeUndo: beforeRailUndo });

  rec('rail fixture imports expected link pairs', railState.missing.length === 0, railState.missing.join(','));
  rec('rail import keeps touched terrain hexes as draft', railState.draftFailures.length === 0, railState.draftFailures.join(','));
  rec('rail import is one undo step', railState.undoDelta === 1, `undo delta=${railState.undoDelta}`);

  const beforeInvalid = await page.evaluate(() => {
    const s = window.hexwright.store;
    return {
      river: s.exportTwuRiversObject(),
      rail: s.exportTwuRailObject()
    };
  });

  await page.setInputFiles('#import-twu', fixtureInvalidPath);
  await sleep(300);

  const afterInvalid = await page.evaluate(() => {
    const s = window.hexwright.store;
    return {
      river: s.exportTwuRiversObject(),
      rail: s.exportTwuRailObject(),
      status: document.getElementById('status')?.textContent || ''
    };
  });

  rec(
    'wrong-shaped TWU file fails loudly',
    /pair-list import failed/i.test(afterInvalid.status) && /expected rivers/i.test(afterInvalid.status),
    afterInvalid.status.slice(0, 120)
  );
  rec(
    'wrong-shaped TWU file imports nothing',
    JSON.stringify(beforeInvalid.river) === JSON.stringify(afterInvalid.river)
      && JSON.stringify(beforeInvalid.rail) === JSON.stringify(afterInvalid.rail)
  );

  const exported = await page.evaluate(() => {
    const s = window.hexwright.store;
    return {
      rivers: s.exportTwuRiversObject(),
      rail: s.exportTwuRailObject()
    };
  });

  const riversShapeOk =
    typeof exported.rivers?._comment === 'string'
    && Array.isArray(exported.rivers?.hexsides)
    && assertSortedPairArrays(exported.rivers.hexsides)
    && Object.keys(exported.rivers).every((k) => ['_comment', 'hexsides'].includes(k));
  rec('rivers export matches TWU shape contract', riversShapeOk);

  const railShapeOk =
    typeof exported.rail?._comment === 'string'
    && Array.isArray(exported.rail?.links)
    && Array.isArray(exported.rail?.hexes)
    && assertSortedPairArrays(exported.rail.links)
    && JSON.stringify(exported.rail.hexes) === JSON.stringify(sorted(unique(exported.rail.links.flat())))
    && Object.keys(exported.rail).every((k) => ['_comment', 'links', 'hexes'].includes(k));
  rec('rail export matches TWU shape contract (links + endpoint-union hexes)', railShapeOk);

  await page.setInputFiles('#import-twu', {
    name: 'roundtrip-rivers.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported.rivers))
  });
  await sleep(250);
  await page.setInputFiles('#import-twu', {
    name: 'roundtrip-rail.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported.rail))
  });
  await sleep(250);

  const exportedAgain = await page.evaluate(() => {
    const s = window.hexwright.store;
    return {
      rivers: s.exportTwuRiversObject(),
      rail: s.exportTwuRailObject()
    };
  });

  rec(
    'import -> export round-trip stays lossless',
    JSON.stringify(exported.rivers) === JSON.stringify(exportedAgain.rivers)
      && JSON.stringify(exported.rail) === JSON.stringify(exportedAgain.rail)
  );

  rec('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  rec('twu check completed', false, err.message);
}

await browser.close();
srv.kill();

const failed = results.filter((ok) => !ok).length;
console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
process.exit(failed ? 1 : 0);
