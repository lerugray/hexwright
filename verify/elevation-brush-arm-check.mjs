// Elevation brush ARMS ON MODE ENTRY (operator path: toolbar click, no digit press).
// Regression for 2026-08-08 field report: entering elevation mode via the toolbar left
// no active brush (setMode never called _setupElevationBrush), so hex clicks fell
// through to the hex editor — "inspect window popping up" instead of painting.
// The pre-existing elevation-check enters via 'h' THEN a digit keypress, and the digit
// path arms the brush as a side effect — which is exactly why this was never caught.
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const DIR = process.cwd();
const PORT = 8067;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1500);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

try {
  await page.goto(`http://localhost:${PORT}/?project=demo/project.json`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('count-land');
    return el && /[1-9]/.test(el.textContent || '');
  }, { timeout: 20000 });
  await sleep(1200);

  // Enter elevation mode the way the operator does: click the toolbar button.
  await page.click('#tool-elevation');
  await sleep(300);

  const state = await page.evaluate(() => ({
    mode: window.hexwright.ui.mode,
    elevationActive: window.hexwright.ui.elevationActive,
  }));
  rec('toolbar click enters elevation mode', state.mode === 'elevation', `mode=${state.mode}`);
  rec('elevationActive is set', state.elevationActive === true, `active=${state.elevationActive}`);

  // Pick a probe hex and click its center on the canvas — a REAL mouse click,
  // with NO digit pressed beforehand.
  const probe = await page.evaluate(() => {
    const { store, renderer } = window.hexwright;
    const centers = store.centers || {};
    const code = Object.keys(centers)[Math.floor(Object.keys(centers).length / 2)];
    const s = renderer.worldToScreen(centers[code]);
    const canvas = document.querySelector('canvas');
    const r = canvas.getBoundingClientRect();
    return { code, x: r.left + s.x, y: r.top + s.y, level: window.hexwright.ui.elevationLevel };
  });
  await page.mouse.click(probe.x, probe.y);
  await sleep(300);

  const after = await page.evaluate((code) => {
    const ed = document.getElementById('hex-editor');
    return {
      elevation: window.hexwright.store.state.elevation?.[code] ?? null,
      editorOpen: !!ed && !ed.hidden && ed.offsetParent !== null,
    };
  }, probe.code);

  rec('hex click PAINTS elevation (no digit press first)',
    after.elevation === probe.level,
    `elevation=${after.elevation}, expected level=${probe.level}`);
  rec('hex editor does NOT pop up on paint', !after.editorOpen, `editorOpen=${after.editorOpen}`);
  rec('no console/page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  rec('check ran to completion', false, String(e).slice(0, 200));
} finally {
  await browser.close();
  srv.kill();
}

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails} PASS / ${fails} FAIL`);
process.exit(fails ? 1 : 0);
