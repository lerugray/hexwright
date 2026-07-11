// Bundled demo map check — the one check guaranteed to run on a fresh public
// clone (no local/ operator data needed). Serves the repo root and boots the
// editor on ?project=demo/project.json: the page must load with zero console/
// page errors, count real land hexes, load the hexside layers, and actually
// paint hexes onto the canvas.
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const DIR = process.cwd();
const PORT = 8057;
const results = [];
const rec = (name, ok, note = '') => { results.push({ name, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? '  — ' + note : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1500);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

try {
  await page.goto(`http://localhost:${PORT}/?project=demo/project.json`, { waitUntil: 'load', timeout: 20000 });
  rec('demo page loads', true);

  await page.waitForFunction(() => {
    const el = document.getElementById('count-land');
    return el && /[1-9]/.test(el.textContent || '');
  }, { timeout: 20000 });
  await sleep(1200); // render settle

  const landTxt = (await page.textContent('#count-land'))?.trim();
  rec('demo terrain loads (108 hexes)', landTxt === '108', `count-land="${landTxt}" (expect 108)`);

  const layerTxt = (await page.textContent('#layer-counts'))?.replace(/\s+/g, ' ').trim() || '';
  rec('demo hexside layers load (rivers present)', /river/i.test(layerTxt) || /\b23\b/.test(layerTxt), `layer-counts="${layerTxt}"`);

  // Hexes actually render: sample painted pixels at real hex centers through
  // the renderer (same pattern as gota-terrain-render-check.mjs).
  const paint = await page.evaluate(async () => {
    const { renderer, store, geo } = window.hexwright;
    renderer.setViewMode('both');
    renderer.terrainFillVisible = true;
    renderer.terrainFillAlpha = 1;
    renderer.fitView();
    renderer.draw();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    renderer.draw();
    const terrain = store.state.terrain.terrain || {};
    const codes = ['0000', '0604', '0204', '1007', '0505'].filter((c) => terrain[c]);
    const dpr = renderer.canvas.width / renderer.width;
    const samples = codes.map((code) => {
      const sp = renderer.worldToScreen(geo.hexCenter(code, store.state.grid));
      const d = renderer.ctx.getImageData(Math.round(sp.x * dpr), Math.round(sp.y * dpr), 1, 1).data;
      return { code, type: terrain[code], rgba: [d[0], d[1], d[2], d[3]] };
    });
    const painted = samples.filter((s) => s.rgba[3] > 10 && (s.rgba[0] + s.rgba[1] + s.rgba[2]) > 30);
    const distinct = new Set(painted.map((s) => s.rgba.slice(0, 3).map((v) => v >> 4).join(','))).size;
    return { sampled: samples.length, painted: painted.length, distinct, samples };
  });
  rec('hexes render on canvas (painted centers, multiple terrain colors)',
    paint.sampled >= 4 && paint.painted === paint.sampled && paint.distinct >= 2,
    JSON.stringify(paint));

  const startHidden = await page.evaluate(() => document.getElementById('start-screen')?.hidden === true);
  rec('start screen dismissed (editor active)', startHidden);

  rec('zero console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('demo check completed', false, err.message);
} finally {
  await browser.close();
  srv.kill();
}

const failed = results.filter(r => !r.ok);
console.log(failed.length ? `\n${failed.length} FAILURE(S)` : '\nALL PASS');
process.exit(failed.length ? 1 : 0);
