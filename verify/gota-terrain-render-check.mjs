// GotA manifest load: production terrain must paint (pixel sample).
// Also guards hexside-only autosave restore discarding manifest terrain.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { skipIfMissing, GOTA_PROJECT_URL, PATHS } from './_local-data.mjs';

skipIfMissing(PATHS.gotaProject);

const DIR = process.cwd();
const PORT = 8045;
const SESSION_KEY = 'hexwright.session.guns-of-the-americas';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

function sampleTerrainPixels(page) {
  return page.evaluate(async () => {
    const { store, renderer, geo } = window.hexwright;
    if (!store.state.grid) return { error: 'no grid', landCount: 0, paintedCount: 0, samples: [] };
    renderer.resize();
    renderer.setBaseScale();
    renderer.setViewMode('both');
    renderer.terrainFillVisible = true;
    renderer.terrainFillAlpha = 1;
    renderer.fitView();
    renderer.draw();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    renderer.draw();

    const terrain = store.state.terrain.terrain || {};
    const terrainKeys = Object.keys(terrain);
    const centers = Object.keys(store.centers || {});
    const withTerrain = centers.filter((c) => terrain[c]);
    const sampleCodes = terrainKeys.filter((c) => terrain[c] === 'woods').slice(0, 3);
    if (!sampleCodes.length) sampleCodes.push(terrainKeys.find((c) => terrain[c] === 'water') || terrainKeys[0]);

    const canvas = renderer.canvas;
    const dpr = canvas.width / renderer.width;
    const sampleAt = (code) => {
      const world = geo.hexCenter(code, store.state.grid);
      const sp = renderer.worldToScreen(world);
      const d = renderer.ctx.getImageData(Math.round(sp.x * dpr), Math.round(sp.y * dpr), 1, 1).data;
      return { code, type: terrain[code], rgba: [d[0], d[1], d[2], d[3]] };
    };

    const samples = sampleCodes.map(sampleAt);
    const painted = samples.filter((s) => s.rgba[3] > 10 && (s.rgba[0] + s.rgba[1] + s.rgba[2]) > 30);
    return {
      landCount: terrainKeys.length,
      centerCount: centers.length,
      centersWithTerrain: withTerrain.length,
      samples,
      paintedCount: painted.length
    };
  });
}

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1300);

const browser = await chromium.launch();
const errors = [];
const pageForErrors = (page) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
};

try {
  // (1) Fresh manifest load
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    pageForErrors(page);
    await page.goto(`http://localhost:${PORT}/?project=${GOTA_PROJECT_URL}`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('count-land');
      return el && /[1-9]/.test(el.textContent);
    }, { timeout: 25000 });
    await sleep(1500);

    const diag = await sampleTerrainPixels(page);
    rec('GotA manifest loads production terrain count', diag.landCount === 4176, `land=${diag.landCount}`);
    rec('centers include all terrain codes', diag.centersWithTerrain === diag.landCount,
      `centersWithTerrain=${diag.centersWithTerrain}`);
    rec('terrain overlay paints hex centers (pixel sample)', diag.paintedCount >= 2,
      JSON.stringify(diag.samples));
    await page.close();
  }

  // (2) Hexside-only autosave restore must keep manifest terrain
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    pageForErrors(page);
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(({ key }) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify({
        savedAt: Date.now(),
        project: {
          name: 'Guns of the Americas',
          terrain: { terrain: {} },
          hexsides: { '0803|0903': ['river'] },
          hexFeatures: {},
          provenance: {},
          grid: null,
          imageFull: [11772, 7566],
          mapImage: null,
          traces: [],
          schemaVersion: 2
        }
      }));
    }, { key: SESSION_KEY });

    await page.goto(`http://localhost:${PORT}/?project=${GOTA_PROJECT_URL}`, { waitUntil: 'load', timeout: 20000 });
    await sleep(500);
    const restoreBtn = page.locator('#restore-prompt-restore');
    try {
      await restoreBtn.waitFor({ state: 'visible', timeout: 15000 });
      await restoreBtn.click();
    } catch (_) {
      // No autosave prompt — fresh manifest load.
    }
    await page.waitForFunction(() => {
      const el = document.getElementById('count-land');
      return el && el.textContent.trim() === '4176';
    }, { timeout: 35000 });
    await page.waitForFunction(() => {
      const hw = window.hexwright;
      return hw?.renderer?.width > 100 && hw?.store?.state?.grid;
    }, { timeout: 10000 });
    await sleep(2000);

    const diag = await sampleTerrainPixels(page);
    rec('autosave restore keeps manifest terrain count', diag.landCount === 4176, `land=${diag.landCount}`);
    rec('autosave restore still paints terrain overlay', diag.paintedCount >= 2,
      JSON.stringify(diag.samples));
    await page.close();
  }

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
