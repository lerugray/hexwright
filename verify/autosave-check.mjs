// v2 test: session autosave + restore-across-reload (data + grid, classification view).
import { chromium } from 'playwright';
import { spawn } from 'child_process';
const DIR=process.cwd(); const PORT=8027;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:DIR,stdio:'ignore'});
await sleep(1300);
const b=await chromium.launch(); const page=await b.newPage({viewport:{width:1600,height:1000}});
const errors=[]; page.on('pageerror',e=>errors.push(String(e))); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto(`http://localhost:${PORT}/`,{waitUntil:'load'});
await page.click('#load-sample');
await page.waitForFunction(()=>{const el=document.getElementById('count-land');return el&&/[1-9]/.test(el.textContent);},{timeout:25000});
// make an edit + let the 800ms debounce fire
await page.evaluate(()=>{const s=window.hexwright.store; s.setHexFeatures(Object.keys(s.state.terrain.terrain)[0],['city']);});
await sleep(1100);
const saved = await page.evaluate(()=>{ const s=localStorage.getItem('hexwright:session'); if(!s) return null; const p=JSON.parse(s); return {land:Object.keys(p.terrain.terrain||{}).length, hasGrid:!!p.grid, hasFeat:Object.keys(p.hexFeatures||{}).length}; });
// reload (same context keeps localStorage) -> should auto-restore
await page.reload({waitUntil:'load'});
await sleep(2200);
const restored = await page.evaluate(()=>{ const s=window.hexwright.store.state; return {land:Object.keys(s.terrain.terrain||{}).length, feat:Object.keys(s.hexFeatures||{}).length, viewMode:window.hexwright.renderer.viewMode, status:(document.getElementById('status')?.textContent||'').slice(0,40)}; });
console.log('SAVED:', JSON.stringify(saved));
console.log('RESTORED:', JSON.stringify(restored));
const results=[]; const rec=(n,ok,note='')=>{results.push(ok);console.log(`${ok?'PASS':'FAIL'}  ${n}${note?'  — '+note:''}`);};
rec('autosave persisted sample (land + grid)', saved && saved.land===4176 && saved.hasGrid, JSON.stringify(saved));
rec('autosave persisted the edit (hexFeatures)', saved && saved.hasFeat>=1, 'feat='+(saved&&saved.hasFeat));
rec('restored land hexes after reload', restored.land===4176, 'land='+restored.land);
rec('restored the edit', restored.feat>=1, 'feat='+restored.feat);
rec('restore switches to classification view', restored.viewMode==='classification', restored.viewMode);
rec('status announces restore', /restor/i.test(restored.status), restored.status);
rec('no console/page errors', errors.length===0, errors.slice(0,2).join(' | '));
await b.close(); srv.kill(); const fails=results.filter(x=>!x).length; console.log(`\n=== ${results.length-fails}/${results.length} passed ===`); process.exit(fails?1:0);
