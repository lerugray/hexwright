import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { skipIfMissing, GOTA_PROJECT_URL, PATHS } from './_local-data.mjs';

skipIfMissing(PATHS.gotaProject);

const DIR = process.cwd();
const PORT = 8031;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });

await sleep(1300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
const results = [];

const rec = (name, ok, note = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

try {
  await page.goto(`http://localhost:${PORT}/?project=${GOTA_PROJECT_URL}`, { waitUntil: 'load', timeout: 20000 });

  const btnExists = await page.locator('#toggle-help').count();
  rec('help button exists in topbar', btnExists === 1, `count=${btnExists}`);

  const overlayInitiallyHidden = await page.evaluate(() => document.getElementById('help-overlay')?.hidden === true);
  rec('help overlay is hidden by default', overlayInitiallyHidden === true);

  await page.click('#toggle-help');
  await sleep(150);
  const openAfterButton = await page.evaluate(() => {
    const overlay = document.getElementById('help-overlay');
    const btn = document.getElementById('toggle-help');
    return overlay && !overlay.hidden && btn?.getAttribute('aria-expanded') === 'true';
  });
  rec('button opens help overlay', openAfterButton === true);

  await page.keyboard.press('Escape');
  await sleep(150);
  const closedByEsc = await page.evaluate(() => {
    const overlay = document.getElementById('help-overlay');
    const btn = document.getElementById('toggle-help');
    return overlay && overlay.hidden && btn?.getAttribute('aria-expanded') === 'false';
  });
  rec('Escape closes help overlay', closedByEsc === true);

  await page.keyboard.press('Shift+/');
  await sleep(120);
  const openByQuestionKey = await page.evaluate(() => document.getElementById('help-overlay')?.hidden === false);
  rec('? key opens help overlay', openByQuestionKey === true);

  await page.keyboard.press('Shift+/');
  await sleep(120);
  const closedByQuestionKey = await page.evaluate(() => document.getElementById('help-overlay')?.hidden === true);
  rec('? key closes help overlay', closedByQuestionKey === true);

  await page.click('#toggle-help');
  await sleep(100);
  await page.click('#close-help');
  await sleep(100);
  const closedByX = await page.evaluate(() => document.getElementById('help-overlay')?.hidden === true);
  rec('X button closes help overlay', closedByX === true);

  await page.click('#toggle-help');
  await sleep(100);
  const hasReferenceTitle = await page.evaluate(() => {
    return document.querySelector('.help-sheet h1')?.textContent?.includes('Hexwright reference');
  });
  rec('help sheet has reference title', hasReferenceTitle === true);

  const hasRequiredShortcuts = await page.evaluate(() => {
    const kbds = [...document.querySelectorAll('#help-overlay .kbd')].map((el) => el.textContent.trim().toLowerCase());
    return ['e', 'b', 'n', 'v'].every((key) => kbds.includes(key));
  });
  rec('help content lists e/b/n/v shortcuts', hasRequiredShortcuts === true);

  rec('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  rec('help-check run completed', false, String(err));
}

await browser.close();
srv.kill();

const failed = results.filter((ok) => !ok).length;
console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
process.exit(failed ? 1 : 0);
