// v2 functional test: store + renderer API — in-hex features, multi-feature hexsides,
// WMP-alias import + draft provenance, view modes, overlay PNG export, anomaly counts.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { skipIfMissing, GOTA_PROJECT_URL, PATHS } from './_local-data.mjs';

skipIfMissing(PATHS.gotaProject);

const DIR = process.cwd();
const PORT = 8021;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const srv = spawn('python3',['-m','http.server',String(PORT)],{cwd:DIR,stdio:'ignore'});
await sleep(1300);
const browser = await chromium.launch();
const page = await browser.newPage({viewport:{width:1600,height:1000}});
const errors=[];
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
const results=[];
const rec=(n,ok,note='')=>{results.push({ok});console.log(`${ok?'PASS':'FAIL'}  ${n}${note?'  — '+note:''}`);};
try{
  await page.goto(`http://localhost:${PORT}/?project=${GOTA_PROJECT_URL}`,{waitUntil:'load',timeout:20000});
  await page.waitForFunction(()=>{const el=document.getElementById('count-land');return el&&/[1-9]/.test(el.textContent);},{timeout:25000});
  await sleep(1500);
  const r = await page.evaluate(async ()=>{
    const out={};
    const hw=window.hexwright, store=hw.store, ren=hw.renderer;
    if(store.palettePromise) { try{ await store.palettePromise; }catch(e){} }
    const st=()=> store.getState?store.getState():(store.state||store);
    out.methods={ setHexFeatures:typeof store.setHexFeatures, toggleHexsideFeature:typeof store.toggleHexsideFeature, importTerrain:typeof store.importTerrain, setTerrain:typeof store.setTerrain };
    out.rmethods={ setViewMode:typeof ren.setViewMode, exportOverlayPNG:typeof ren.exportOverlayPNG, computeAnomalies:typeof ren.computeAnomalies, setAnomalyMode:typeof ren.setAnomalyMode };
    const terr=(st().terrain&&st().terrain.terrain)||{}; const codes=Object.keys(terr);
    try{ store.setHexFeatures(codes[0],['city','port']); out.hexFeatures=(st().hexFeatures&&st().hexFeatures[codes[0]])||null; }catch(e){ out.hexErr=String(e); }
    try{ store.toggleHexsideFeature('2312','2412','river'); store.toggleHexsideFeature('2312','2412','road');
      const hs=st().hexsides||{}; let f=null; for(const k in hs){const v=hs[k]; if(Array.isArray(v)&&v.includes('river')&&v.includes('road')){f={k,v};break;}} out.multi=f;
    }catch(e){ out.multiErr=String(e); }
    try{ const c1=codes[1]; store.importTerrain({[c1]:'forest'},{provenance:'draft'});
      out.imp={ terrain:st().terrain.terrain[c1], prov:(st().provenance&&st().provenance[c1])||null }; }catch(e){ out.impErr=String(e); }
    try{ ren.setViewMode('classification'); ren.setViewMode('map'); ren.setViewMode('both'); out.viewOk=true; }catch(e){ out.viewErr=String(e); }
    try{ const a=ren.computeAnomalies(); out.anom={unclassified:a.unclassified,orphanHexsides:a.orphanHexsides,draft:a.draft}; }catch(e){ out.anomErr=String(e); }
    try{ const url=ren.exportOverlayPNG({download:false}); out.pngOk=typeof url==='string'&&url.startsWith('data:image/png'); out.pngLen=(url||'').length; }catch(e){ out.pngErr=String(e); }
    return out;
  });
  console.log(JSON.stringify(r,null,1));
  rec('store methods present', Object.values(r.methods).every(t=>t==='function'), JSON.stringify(r.methods));
  rec('renderer methods present', Object.values(r.rmethods).every(t=>t==='function'), JSON.stringify(r.rmethods));
  rec('in-hex features set', Array.isArray(r.hexFeatures)&&r.hexFeatures.includes('city'), JSON.stringify(r.hexFeatures)+(r.hexErr||''));
  rec('multi-feature hexside on one edge', !!r.multi, JSON.stringify(r.multi)+(r.multiErr||''));
  rec('WMP import alias forest->woods + draft prov', r.imp&&r.imp.terrain==='woods'&&r.imp.prov==='draft', JSON.stringify(r.imp)+(r.impErr||''));
  rec('view modes switch w/o error', r.viewOk===true, r.viewErr||'');
  rec('computeAnomalies draft>=1', r.anom&&r.anom.draft>=1, JSON.stringify(r.anom)+(r.anomErr||''));
  rec('exportOverlayPNG returns png url', r.pngOk===true, 'len='+r.pngLen+(r.pngErr||''));
  rec('no console/page errors', errors.length===0, errors.slice(0,3).join(' | '));
}catch(e){ console.log('FATAL',String(e)); rec('run',false,String(e)); }
finally{ await browser.close(); srv.kill(); const fails=results.filter(x=>!x.ok).length; console.log(`\n=== ${results.length-fails}/${results.length} passed ===`); process.exit(fails?1:0); }
