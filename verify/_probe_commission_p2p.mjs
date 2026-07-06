// One-off probe: the PoG + FtP point-to-point launcher projects load with the
// right node counts, the board raster renders, and no page errors fire.
// Serves the PARENT folder (like the launchers) so sibling repos resolve.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PARENT = resolve(REPO, '..');
const NAME = basename(REPO);
const PORT = 8688;

const server = spawn('python3', [resolve(REPO, 'scripts/serve_nocache.py'), String(PORT)], {
  cwd: PARENT, stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1200);

const CASES = [
  { project: 'local/pog-p2p.json', nodes: 289, label: 'PoG' },
  { project: 'local/ftp-p2p.json', nodes: 258, label: 'FtP' },
];

let failures = 0;
const browser = await chromium.launch();
try {
  for (const c of CASES) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://localhost:${PORT}/${NAME}/?project=${c.project}`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.hexwright && window.hexwright.store, { timeout: 20000 });
    await page.waitForFunction(() => Object.keys(window.hexwright.store.state.nodes || {}).length > 0, { timeout: 20000 });
    await sleep(2500); // let the big raster decode + draw

    const res = await page.evaluate(() => {
      const { store, renderer } = window.hexwright;
      renderer.fitView();
      return {
        isPtp: store.isPtp(),
        nodeCount: Object.keys(store.state.nodes || {}).length,
        edgeCount: store.countPtpEdges(),
      };
    });
    await sleep(800);
    const pixel = await page.evaluate(() => {
      const canvas = document.getElementById('map-canvas');
      if (!canvas) return { ok: false, note: 'no canvas' };
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      const pts = [[0.3, 0.3], [0.5, 0.5], [0.7, 0.6], [0.4, 0.7]];
      const samples = pts.map(([fx, fy]) => Array.from(ctx.getImageData(Math.floor(w * fx), Math.floor(h * fy), 1, 1).data));
      const flat = samples.flat();
      const variance = Math.max(...flat) - Math.min(...flat);
      return { ok: variance > 20, note: `variance=${variance}`, samples };
    });

    const checks = [
      ['isPtp', res.isPtp === true, String(res.isPtp)],
      ['nodeCount', res.nodeCount === c.nodes, `${res.nodeCount} (want ${c.nodes})`],
      ['edges start empty', res.edgeCount === 0, String(res.edgeCount)],
      ['board raster renders', pixel.ok, pixel.note],
      ['no page errors', errors.length === 0, errors.slice(0, 3).join(' | ')],
    ];
    for (const [name, ok, note] of checks) {
      if (!ok) failures++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  [${c.label}] ${name}${note ? '  — ' + note : ''}`);
    }
    await page.screenshot({ path: resolve(REPO, `verify/_probe_${c.label.toLowerCase()}_p2p.png`) });
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
