import { chromium } from 'playwright';
import { spawn } from 'child_process';

const DIR = process.cwd();
const VER = DIR + '/verify';
const PORT = 8019;
const results = [];
const rec = (name, ok, note='') => { results.push({name, ok, note}); console.log(`${ok?'PASS':'FAIL'}  ${name}${note?'  — '+note:''}`); };
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const srv = spawn('python3', ['-m','http.server', String(PORT)], {cwd: DIR, stdio:'ignore'});
await sleep(1500);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1600,height:1000} });
const errors = [];
page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e=> errors.push('PAGEERROR: '+e.message));
let exported = null;
page.on('download', async d => { try { const p = VER+'/export-hexsides.json'; await d.saveAs(p); exported = p; } catch(e){} });

try {
  await page.goto(`http://localhost:${PORT}/`, {waitUntil:'load', timeout:20000});
  rec('page loads', true);

  await page.click('#file-btn');
  await page.click('#load-sample');
  // wait for land count to populate
  await page.waitForFunction(() => {
    const el = document.getElementById('count-land');
    return el && /[1-9]/.test(el.textContent);
  }, {timeout:25000});
  await sleep(2000); // render settle
  await page.screenshot({path: VER+'/01-loaded.png'});

  const landTxt = (await page.textContent('#count-land'))?.trim();
  rec('GotA sample loads + land hexes counted', landTxt === '4176', `count-land="${landTxt}" (expect 4176)`);

  const layerTxt = (await page.textContent('#layer-counts'))?.replace(/\s+/g,' ').trim();
  rec('hexside layers loaded (mountains from draft)', /431|mountain/i.test(layerTxt||''), `layer-counts="${layerTxt}"`);

  // introspect API
  const api = await page.evaluate(() => {
    const hw = window.hexwright || {};
    const o = { top:Object.keys(hw) };
    for (const k of o.top) { try { o[k]=Object.keys(hw[k]).slice(0,20); } catch(e){} }
    return o;
  });
  console.log('API:', JSON.stringify(api));

  // Open hex editor by scanning canvas clicks around center
  const box = await page.locator('#map-canvas').boundingBox();
  let opened=false, hexCode='';
  const cx = box.x+box.width/2, cy = box.y+box.height/2;
  outer:
  for (let dy=-200; dy<=200 && !opened; dy+=50) {
    for (let dx=-300; dx<=300; dx+=50) {
      await page.mouse.click(cx+dx, cy+dy);
      await sleep(120);
      const hidden = await page.getAttribute('#hex-editor','hidden');
      if (hidden === null) { opened=true; hexCode=(await page.textContent('#hexed-title'))?.replace(/^Hex\s+/,'').trim()||''; break outer; }
    }
  }
  rec('click a hex opens the hex editor', opened, opened?`hex=${hexCode}`:'hex editor never unhid across scan');
  if (opened) await page.screenshot({path: VER+'/02-inspector.png'});

  // Assign a river via trusted clicks: pick a diagram edge with a neighbor, then tap river ink
  let assigned=false;
  if (opened) {
    const edgeSeg = page.locator('#hexed-edges .edge-seg.edge-hit:not(.disabled)').first();
    const edgeCount = await page.locator('#hexed-edges .edge-seg.edge-hit:not(.disabled)').count();
    const riverInk = page.locator('#hexed-inkgrid .inkmini[data-feature="river"]').first();
    if (await edgeSeg.count() > 0 && await riverInk.count() > 0) {
      await edgeSeg.click({ timeout: 5000 }).catch(()=>{});
      await sleep(200);
      await riverInk.click({ timeout: 5000 }).catch(()=>{});
      await sleep(400);
      assigned = await page.evaluate(()=>{
        try { const s = window.hexwright.store; const hs = JSON.stringify(s.state?.hexsides || {}); return /"river"/.test(hs); }
        catch(e) { return false; }
      });
    }
    rec('assign a river hexside via hex editor (trusted click)', assigned, `${edgeCount} clickable edges`);
    await page.screenshot({path: VER+'/03-assigned.png'});
  }

  // Export hexsides.json (download) and validate
  await page.click('#export-btn').catch(()=>{});
  await sleep(300);
  await page.click('#export-sides-file').catch(()=>{});
  await sleep(1200);
  if (exported) {
    const fs = await import('fs');
    let data=null, parseOk=false;
    try { data = JSON.parse(fs.readFileSync(exported,'utf8')); parseOk=true; } catch(e){}
    rec('export produces parseable hexsides.json', parseOk, exported);
    if (parseOk) {
      const layers = Object.keys(data);
      const hasTheaters = Array.isArray(data.theaters) && data.theaters.length>0;
      const hasBoundaries = Array.isArray(data.boundaries) && data.boundaries.length>0;
      const hasMountains = Array.isArray(data.mountains) && data.mountains.length>0;
      const rivers = Array.isArray(data.rivers)?data.rivers.length:0;
      rec('export preserves theaters+boundaries (untouched layers)', hasTheaters && hasBoundaries, `theaters=${data.theaters?.length}, boundaries=${data.boundaries?.length}`);
      rec('export preserves mountains layer', hasMountains, `mountains=${data.mountains?.length}`);
      rec('assigned river is in the export', rivers>0, `rivers=${rivers}; layers=[${layers}]`);
      // schema: entries are {a,b} with a<b
      const sample = (data.rivers&&data.rivers[0]) || (data.mountains&&data.mountains[0]);
      const schemaOk = sample && typeof sample.a==='string' && typeof sample.b==='string';
      rec('hexside entries match {a,b} schema', !!schemaOk, JSON.stringify(sample));
    }
  } else {
    rec('export produces parseable hexsides.json', false, 'no download captured');
  }
} catch(e) {
  rec('harness completed', false, e.message);
}

rec('no uncaught JS console/page errors', errors.length===0, errors.slice(0,5).join(' | '));

await browser.close();
srv.kill();
const passed = results.filter(r=>r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every(r=>r.ok)?0:1);
