// v2 UI-interaction test (trusted clicks): view-mode buttons, inspector feature chip,
// anomaly toggle, overlay PNG export button, tool-rail mode selection.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
const DIR = process.cwd();
const DESK = DIR + '/verify';
const PORT = 8022;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const srv = spawn('python3',['-m','http.server',String(PORT)],{cwd:DIR,stdio:'ignore'});
await sleep(1300);
const browser = await chromium.launch();
const page = await browser.newPage({viewport:{width:1600,height:1000}});
const errors=[]; const downloads=[];
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
page.on('download', async d=>{ downloads.push(d.suggestedFilename()); try{ await d.saveAs(DESK+'/hexwright-'+d.suggestedFilename()); }catch(e){} });
const results=[];
const rec=(n,ok,note='')=>{results.push({ok});console.log(`${ok?'PASS':'FAIL'}  ${n}${note?'  — '+note:''}`);};
try{
  await page.goto(`http://localhost:${PORT}/`,{waitUntil:'load',timeout:20000});
  await page.click('#file-btn');
  await page.click('#load-sample');
  await page.waitForFunction(()=>{const el=document.getElementById('count-land');return el&&/[1-9]/.test(el.textContent);},{timeout:25000});
  await sleep(1800);

  // 1. VIEW MODE: screenshot both, switch to classification, screenshot, compare
  const bothShot = await page.screenshot();
  await page.click('#view-mode [data-mode="classification"]');
  await sleep(1200);
  const classShot = await page.screenshot({path: DESK+'/hexwright-classification-view.png'});
  const ratio = Math.abs(bothShot.length - classShot.length) / Math.max(bothShot.length, classShot.length);
  rec('view-mode button visibly changes render (both vs classification)', ratio > 0.03, `byte-delta=${(ratio*100).toFixed(1)}% (both=${bothShot.length} class=${classShot.length})`);
  // back to both for inspector work
  await page.click('#view-mode [data-mode="both"]'); await sleep(500);

  // 2. INSPECTOR feature checkbox -> store.hexFeatures
  const box = await page.locator('#map-canvas').boundingBox();
  const cx=box.x+box.width/2, cy=box.y+box.height/2;
  let opened=false, code='';
  outer: for(let dy=-200;dy<=200&&!opened;dy+=40){ for(let dx=-300;dx<=300;dx+=40){ await page.mouse.click(cx+dx,cy+dy); await sleep(80); const hidden=await page.getAttribute('#inspector','hidden'); if(hidden===null){opened=true; code=(await page.textContent('#inspector-hex'))?.trim()||''; break outer;} } }
  let featOk=false, featNote='inspector did not open';
  if(opened){
    const n = await page.locator('#inspector-features input[type=checkbox]').count();
    if(n>0){
      const totalFeat = ()=>page.evaluate(()=>{const s=window.hexwright.store.state; return Object.values(s.hexFeatures).reduce((a,v)=>a+(v?v.length:0),0);});
      const ihex = await page.evaluate(()=>window.hexwright.ui && window.hexwright.ui.inspectorHex);
      const before = await totalFeat();
      await page.locator('#inspector-features label.feature-chip').first().click().catch(async()=>{ await page.locator('#inspector-features input[type=checkbox]').first().click({force:true}).catch(()=>{}); });
      await sleep(300);
      const after = await totalFeat();
      featOk = after > before; featNote=`inspectorHex=${ihex}, total features ${before}->${after}, ${n} checkboxes`;
    } else featNote=`inspector open (hex ${code}) but 0 feature checkboxes`;
  }
  rec('inspector feature checkbox writes store.hexFeatures', featOk, featNote);

  // 3. ANOMALY toggle -> status text populated
  await page.click('#toggle-anomaly').catch(()=>{});
  await sleep(600);
  const anomTxt = (await page.textContent('#anomaly-status'))?.trim()||'';
  rec('anomaly toggle populates status with counts', /\d/.test(anomTxt), `status="${anomTxt.slice(0,60)}"`);

  // 4. EXPORT overlay PNG -> download fires
  const before = downloads.length;
  await page.click('#export-btn').catch(()=>{});
  await page.click('#export-overlay').catch(()=>{});
  await sleep(1500);
  rec('export-overlay button triggers a PNG download', downloads.length>before, `downloads=[${downloads.join(', ')}]`);

  // 5. TOOL mode reflects active state
  await page.click('#tool-terrain').catch(()=>{});
  await sleep(300);
  const toolActive = await page.evaluate(()=>{const b=document.getElementById('tool-terrain'); return b.classList.contains('is-active') && b.getAttribute('aria-checked')==='true';});
  rec('terrain tool reflects active rail state', !!toolActive, `toolActive=${toolActive}`);

  rec('no console/page errors during UI interaction', errors.length===0, errors.slice(0,3).join(' | '));
}catch(e){ console.log('FATAL',String(e)); rec('run',false,String(e)); }
finally{ await browser.close(); srv.kill(); const fails=results.filter(x=>!x.ok).length; console.log(`\n=== ${results.length-fails}/${results.length} passed ===  (screenshots in verify/)`); process.exit(fails?1:0); }
