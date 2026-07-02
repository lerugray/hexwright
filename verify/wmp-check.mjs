// v2 test: WMP draft-import button end-to-end — forest/lake aliasing, draft provenance,
// anomaly draft count, status message.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
const DIR=process.cwd(); const PORT=8026;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:DIR,stdio:'ignore'});
await sleep(1300);
const b=await chromium.launch(); const page=await b.newPage({viewport:{width:1600,height:1000}});
const errors=[]; page.on('pageerror',e=>errors.push(String(e))); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto(`http://localhost:${PORT}/?project=samples/gota-project.json`,{waitUntil:'load'});
await page.waitForFunction(()=>{const el=document.getElementById('count-land');return el&&/[1-9]/.test(el.textContent);},{timeout:25000});
await sleep(1200);
// Upload a WMP-style classification (forest->woods, lake->water; provenance should be draft)
const wmp = JSON.stringify({ terrain: { '2312': 'forest', '2412': 'lake', '2512': 'clear' } });
await page.setInputFiles('#import-wmp', { name:'wmp-out.json', mimeType:'application/json', buffer: Buffer.from(wmp) });
await sleep(700);
const r = await page.evaluate(()=>{
  const s=window.hexwright.store.state;
  return { t2312:s.terrain.terrain['2312'], t2412:s.terrain.terrain['2412'], t2512:s.terrain.terrain['2512'],
           p2312:s.provenance['2312'], p2412:s.provenance['2412'], p2512:s.provenance['2512'],
           anomalyDraft: window.hexwright.renderer.computeAnomalies().draft,
           status: document.getElementById('status')?.textContent||'' };
});
console.log(JSON.stringify(r,null,1));
const results=[];
const rec=(n,ok,note='')=>{results.push(ok);console.log(`${ok?'PASS':'FAIL'}  ${n}${note?'  — '+note:''}`);};
rec('forest aliased to woods', r.t2312==='woods', r.t2312);
rec('lake aliased to water', r.t2412==='water', r.t2412);
rec('clear stays clear', r.t2512==='clear', r.t2512);
rec('imported hexes marked provenance=draft', r.p2312==='draft'&&r.p2412==='draft'&&r.p2512==='draft', `${r.p2312}/${r.p2412}/${r.p2512}`);
rec('anomaly draft count >= 3', r.anomalyDraft>=3, 'draft='+r.anomalyDraft);
rec('status shows WMP draft import', /wmp|draft/i.test(r.status), r.status.slice(0,50));
rec('no console/page errors', errors.length===0, errors.slice(0,2).join(' | '));
await b.close(); srv.kill(); const fails=results.filter(x=>!x).length; console.log(`\n=== ${results.length-fails}/${results.length} passed ===`); process.exit(fails?1:0);
