// THROWAWAY overflow-sweep diagnostic — not part of the permanent suite.
// Usage: node verify/_sweep_overflow.mjs <LABEL>   (LABEL = BEFORE | AFTER)
// Measures scrollHeight/clientHeight/overflow + bottom-control reachability +
// click-leak-to-canvas for every chrome surface at 3 window sizes.
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const LABEL = process.argv[2] || 'RUN';
const DIR = process.cwd();
const SHOTS = '/private/tmp/claude-501/-Users-rayweiss-Desktop-Dev-Work-generalstaff-private/ab164f5a-4352-465b-9465-5e7a0f5e2d76/scratchpad/hexwright-scroll';
const PORT = 8043;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1200);

const sizes = [
  { name: '1600x1000', w: 1600, h: 1000 },
  { name: '1280x720', w: 1280, h: 720 },
  { name: '1100x650', w: 1100, h: 650 },
];

const j = o => JSON.stringify(o);

async function measure(page, sel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      sh: el.scrollHeight, ch: el.clientHeight, oy: cs.overflowY,
      top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight,
      overflow: el.scrollHeight - el.clientHeight,
      beyondViewport: Math.round(r.bottom - window.innerHeight),
    };
  }, sel);
}

async function lastControlClickable(page, panelSel, controlSel) {
  // scroll last control into view (works only if panel scrolls), then check hit-test
  return page.evaluate(async ({ panelSel, controlSel }) => {
    const panel = document.querySelector(panelSel);
    const nodes = Array.from(document.querySelectorAll(panelSel + ' ' + controlSel));
    const last = nodes[nodes.length - 1];
    if (!panel || !last) return { found: false };
    last.scrollIntoView({ block: 'nearest' });
    await new Promise(r => setTimeout(r, 60));
    const lr = last.getBoundingClientRect();
    const inViewport = lr.top >= 0 && lr.bottom <= window.innerHeight + 0.5;
    const at = document.elementFromPoint(lr.left + lr.width / 2, Math.min(lr.top + lr.height / 2, window.innerHeight - 1));
    const hit = !!at && (at === last || last.contains(at) || at.contains(last));
    return { found: true, inViewport, hitTest: hit, lastBottom: Math.round(lr.bottom), vh: window.innerHeight };
  }, { panelSel, controlSel });
}

for (const size of sizes) {
  console.log(`\n===== ${LABEL} ${size.name} =====`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(3000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // ---------- PART A: loaded app ----------
  await page.goto(`http://localhost:${PORT}/?project=samples/gota-project.json`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('count-land');
    return el && /[1-9]/.test(el.textContent);
  }, { timeout: 25000 });
  await sleep(1200);

  console.log('LAYERS', j(await measure(page, '#layers-panel')), j(await lastControlClickable(page, '#layers-panel', '#map-dim')));

  await page.click('#tool-edges').catch(() => {});
  await sleep(200);
  console.log('BRUSH(edges)', j(await measure(page, '#brush-card')), j(await lastControlClickable(page, '#brush-card', '.ink')));
  await page.click('#tool-inspect').catch(() => {});
  await sleep(200);

  console.log('RAIL', j(await measure(page, '#tool-rail')));

  const strip = await page.evaluate(() => {
    const el = document.getElementById('status-strip');
    return { sw: el.scrollWidth, cw: el.clientWidth, hOverflow: el.scrollWidth - el.clientWidth };
  });
  console.log('STRIP', j(strip));

  // popovers
  await page.click('#file-btn');
  await sleep(150);
  console.log('FILE-POPOVER', j(await measure(page, '#file-popover')), j(await lastControlClickable(page, '#file-popover', 'label.file-btn')));
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.click(600, 400); await sleep(120); // close popover via outside click
  await page.keyboard.press('Escape').catch(() => {});
  await page.click('#export-btn'); await sleep(150);
  console.log('EXPORT-POPOVER', j(await measure(page, '#export-popover')), j(await lastControlClickable(page, '#export-popover', 'button')));
  await page.mouse.click(600, 400); await sleep(120);
  await page.keyboard.press('Escape').catch(() => {});

  // hex editor: open + max-populate
  const box = await page.locator('#map-canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  let opened = false, hexCode = '';
  outer:
  for (let dy = -160; dy <= 200 && !opened; dy += 40) {
    for (let dx = -300; dx <= 300; dx += 40) {
      await page.mouse.click(cx + dx, cy + dy);
      await sleep(70);
      if (await page.getAttribute('#hex-editor', 'hidden') === null) {
        opened = true; hexCode = (await page.textContent('#hexed-title'))?.trim() || ''; break outer;
      }
    }
  }
  console.log('hex-editor opened:', opened, hexCode);
  if (opened) {
    // populate: all feature chips on, select an edge, apply all inks
    const featN = await page.locator('#hexed-featrow .feat').count();
    for (let i = 0; i < featN; i++) { await page.locator('#hexed-featrow .feat').nth(i).click({ timeout: 1500 }).catch(() => {}); await sleep(30); }
    const seg = page.locator('#hexed-edges .edge-seg.edge-hit:not(.disabled)').first();
    if (await seg.count() > 0) {
      await seg.click({ timeout: 1500 }).catch(() => {});
      await sleep(100);
      const inkN = await page.locator('#hexed-inkgrid .inkmini').count();
      for (let i = 0; i < inkN; i++) { await page.locator('#hexed-inkgrid .inkmini').nth(i).click({ timeout: 1500 }).catch(() => {}); await sleep(30); }
    }
    await sleep(250);
    console.log('HEXED(populated)', j(await measure(page, '#hex-editor')), j(await lastControlClickable(page, '#hex-editor', '.inkmini')));

    // REAL bottom-control click with effect assertion: toggle the LAST inkmini and
    // verify store.hexsides changes (add or remove — either way JSON changes).
    const beforeHs = await page.evaluate(() => JSON.stringify(window.hexwright.store.state.hexsides));
    let clickErr = '';
    await page.locator('#hexed-inkgrid .inkmini').last().click({ timeout: 2500 }).catch(e => { clickErr = e.message.split('\n')[0]; });
    await sleep(200);
    const afterHs = await page.evaluate(() => JSON.stringify(window.hexwright.store.state.hexsides));
    console.log('HEXED bottom-ink real click', j({ effect: beforeHs !== afterHs, clickErr }));

    await page.screenshot({ path: `${SHOTS}/${LABEL}-${size.name}.png` }).catch(e => console.log('shot err', e.message));

    // ---------- CLICK-LEAK checks ----------
    const snap = () => page.evaluate(() => ({
      title: document.getElementById('hexed-title').textContent,
      hidden: document.getElementById('hex-editor').hasAttribute('hidden'),
      panX: window.hexwright.renderer.view.panX, panY: window.hexwright.renderer.view.panY,
    }));
    const s0 = await snap();
    await page.locator('#feature-layer-rows .eye').first().click({ timeout: 1500 }).catch(() => {});
    await sleep(120);
    const s1 = await snap();
    console.log('LEAK layers-panel', j({ leaked: j(s0) !== j(s1) }));
    await page.locator('#feature-layer-rows .eye').first().click({ timeout: 1500 }).catch(() => {}); await sleep(80);

    await page.click('#tool-terrain').catch(() => {}); await sleep(120);
    const s2 = await snap();
    await page.locator('#brush-ink-list .ink').first().click({ timeout: 1500 }).catch(() => {});
    await sleep(120);
    const s3 = await snap();
    console.log('LEAK brush-card', j({ leaked: j(s2) !== j(s3) }));
    await page.click('#tool-inspect').catch(() => {}); await sleep(120);

    // click inside hex editor (a terr swatch) must not pan or re-select
    const s4 = await snap();
    const p0 = await page.evaluate(() => ({ x: window.hexwright.renderer.view.panX, y: window.hexwright.renderer.view.panY }));
    await page.locator('#hexed-terrain-grid .terr').first().click({ timeout: 1500 }).catch(() => {});
    await sleep(120);
    const p1 = await page.evaluate(() => ({ x: window.hexwright.renderer.view.panX, y: window.hexwright.renderer.view.panY }));
    const s5 = await snap();
    console.log('LEAK hex-editor(terr click)', j({ panChanged: j(p0) !== j(p1), titleChanged: s4.title !== s5.title, closed: s5.hidden }));
  }

  // coach card (force visible)
  await page.evaluate(() => { document.getElementById('coach-card').hidden = false; });
  await sleep(80);
  console.log('COACH', j(await measure(page, '#coach-card')));
  await page.evaluate(() => { document.getElementById('coach-card').hidden = true; });

  // help overlay
  await page.click('#toggle-help').catch(() => {});
  await sleep(200);
  console.log('HELP-SHEET', j(await measure(page, '.help-sheet')), j(await lastControlClickable(page, '.help-sheet', '.helprow, .help-footer')));
  await page.click('#close-help').catch(() => {});
  await sleep(100);

  console.log('page errors:', errors.length ? errors.slice(0, 3) : 'none');

  // ---------- PART B: start screen with 6 fake autosave slots + chooser open ----------
  const page2 = await ctx.newPage();
  page2.setDefaultTimeout(3000);
  await page2.addInitScript(() => {
    for (let i = 1; i <= 6; i++) {
      localStorage.setItem(`hexwright.session.fake-project-${i}`, JSON.stringify({
        savedAt: Date.now() - i * 3600e3,
        project: { name: `Fake Project ${i} With A Long Name`, terrain: { name: 'x', terrain: { '0101': 'clear', '0102': 'woods' } } }
      }));
    }
    localStorage.setItem('hexwright.coach.dismissed', '1');
  });
  await page2.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 15000 });
  await sleep(800);
  // dismiss restore prompt if it appeared
  const restoreVisible = await page2.evaluate(() => !document.getElementById('restore-prompt').hasAttribute('hidden'));
  if (restoreVisible) { await page2.click('#restore-prompt-fresh').catch(() => {}); await sleep(300); }
  const startVisible = await page2.evaluate(() => !document.getElementById('start-screen').hasAttribute('hidden'));
  console.log('start screen visible:', startVisible, 'restore prompt was:', restoreVisible);
  if (startVisible) {
    await page2.click('#card-recent').catch(() => {});
    await sleep(200);
    await page2.click('#card-load').catch(() => {});
    await sleep(200);
    console.log('START-SCREEN', j(await measure(page2, '#start-screen')), 'WRAP', j(await measure(page2, '.start-wrap')));
    const lastRecent = await lastControlClickable(page2, '#start-screen', '.recent-row, #recent-list > *');
    console.log('START bottom recent-row', j(lastRecent));
    await page2.screenshot({ path: `${SHOTS}/${LABEL}-start-${size.name}.png` }).catch(() => {});
  }

  await browser.close();
}

srv.kill();
console.log('\nSWEEP DONE.');
