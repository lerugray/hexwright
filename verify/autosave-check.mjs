// v2.1 chunk B test: per-project autosave slots + legacy migration + newest boot restore.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
const DIR=process.cwd(); const PORT=8027;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:DIR,stdio:'ignore'});
await sleep(1300);
const b=await chromium.launch();
const results=[]; const rec=(n,ok,note='')=>{results.push(ok);console.log(`${ok?'PASS':'FAIL'}  ${n}${note?'  — '+note:''}`);};
const slug=(name)=>String(name||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'untitled';
const now=Date.now();

async function makePage(context, errors) {
  const page = await context.newPage({viewport:{width:1600,height:1000}});
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  return page;
}

async function loadSampleFromStart(page) {
  await page.click('#card-load');
  await page.fill('#manifest-url', 'samples/gota-project.json');
  await page.click('#manifest-load-btn');
}

async function restoreNewestRecent(page) {
  await page.waitForSelector('.recent-row', { timeout: 10000 });
  await page.click('.recent-row >> nth=0');
}

// Case 1: two projects autosave to separate per-project slots + reload restore.
{
  const errors = [];
  const ctx = await b.newContext();
  const page = await makePage(ctx, errors);
  await page.goto(`http://localhost:${PORT}/`,{waitUntil:'load'});
  await loadSampleFromStart(page);
  await page.waitForFunction(()=>{const el=document.getElementById('count-land');return el&&/[1-9]/.test(el.textContent);},{timeout:25000});
  await page.evaluate(()=>{const s=window.hexwright.store; s.setHexFeatures(Object.keys(s.state.terrain.terrain)[0],['city']);});
  await sleep(1100);

  const perProject = await page.evaluate(()=>{
    const s = window.hexwright.store;
    const projectName = s.state.name;
    const slug = String(projectName||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'untitled';
    const gotaKey = `hexwright.session.${slug}`;
    const gotaRaw = localStorage.getItem(gotaKey);
    const gota = gotaRaw ? JSON.parse(gotaRaw) : null;

    const beta = {
      schemaVersion: 2,
      name: 'TWU Test Board',
      mapImage: null,
      imageFull: s.state.imageFull,
      grid: s.state.grid,
      terrain: { terrain: { '0000': 'sea', '0001': 'coast' } },
      hexFeatures: {},
      hexsides: {},
      provenance: {}
    };
    return window.hexwright.store.loadProject(beta).then(()=>{
      const betaSlug = 'twu-test-board';
      const betaKey = `hexwright.session.${betaSlug}`;
      return new Promise((resolve)=>{
        setTimeout(()=>{
          const betaRaw = localStorage.getItem(betaKey);
          const betaSaved = betaRaw ? JSON.parse(betaRaw) : null;
          resolve({
            gotaKey,
            betaKey,
            hasLegacy: !!localStorage.getItem('hexwright:session'),
            gotaSaved: !!gota,
            gotaLand: gota && gota.project ? Object.keys(gota.project.terrain.terrain||{}).length : 0,
            gotaFeat: gota && gota.project ? Object.keys(gota.project.hexFeatures||{}).length : 0,
            betaSaved: !!betaSaved,
            betaName: betaSaved && betaSaved.project ? betaSaved.project.name : '',
            keys: Object.keys(localStorage).filter(k=>k.startsWith('hexwright.session.')).sort()
          });
        }, 1100);
      });
    });
  });

  await page.reload({waitUntil:'load'});
  await restoreNewestRecent(page);
  await sleep(2200);
  const restored = await page.evaluate(()=>{ const s=window.hexwright.store.state; return {name:s.name, land:Object.keys(s.terrain.terrain||{}).length, viewMode:window.hexwright.renderer.viewMode}; });

  rec('autosave writes GotA slot key', perProject.gotaSaved && perProject.gotaKey===`hexwright.session.${slug('Guns of the Americas')}`, perProject.gotaKey);
  rec('autosave writes second project slot key', perProject.betaSaved && perProject.betaKey===`hexwright.session.${slug('TWU Test Board')}`, perProject.betaKey);
  rec('slots carry project-specific payloads', perProject.gotaLand===4176 && perProject.gotaFeat>=1 && perProject.betaName==='TWU Test Board', JSON.stringify({gotaLand:perProject.gotaLand, gotaFeat:perProject.gotaFeat, betaName:perProject.betaName}));
  rec('legacy single key not used for new saves', !perProject.hasLegacy, perProject.keys.join(','));
  rec('reload restores newest slot via start screen', restored.name==='TWU Test Board' && restored.land===2, JSON.stringify(restored));
  rec('reload restore keeps classification view', restored.viewMode==='classification', restored.viewMode);
  rec('case 1 has no console/page errors', errors.length===0, errors.slice(0,2).join(' | '));
  await ctx.close();
}

// Case 2: legacy single-key session migrates once then key removed.
{
  const errors = [];
  const ctx = await b.newContext();
  await ctx.addInitScript(()=>{
    const legacy = {
      schemaVersion: 2,
      name: 'Legacy One',
      mapImage: null,
      imageFull: [100, 100],
      grid: null,
      terrain: { terrain: { '1111': 'sea' } },
      hexFeatures: {},
      hexsides: {},
      provenance: {}
    };
    localStorage.setItem('hexwright:session', JSON.stringify(legacy));
  });
  const page = await makePage(ctx, errors);
  await page.goto(`http://localhost:${PORT}/`,{waitUntil:'load'});
  await sleep(900);

  const migrated = await page.evaluate(()=>{
    const key = 'hexwright.session.legacy-one';
    const raw = localStorage.getItem(key);
    const payload = raw ? JSON.parse(raw) : null;
    return {
      hasLegacy: !!localStorage.getItem('hexwright:session'),
      hasSlot: !!payload,
      slotName: payload && payload.project ? payload.project.name : '',
      slotLand: payload && payload.project ? Object.keys(payload.project.terrain.terrain||{}).length : 0
    };
  });

  await page.reload({waitUntil:'load'});
  await sleep(500);
  const afterReload = await page.evaluate(()=>{
    return {
      hasLegacy: !!localStorage.getItem('hexwright:session'),
      slotCount: Object.keys(localStorage).filter(k=>k.startsWith('hexwright.session.legacy-one')).length
    };
  });

  rec('legacy key removed after migration', !migrated.hasLegacy, JSON.stringify(migrated));
  rec('legacy payload migrated to project slot', migrated.hasSlot && migrated.slotName==='Legacy One' && migrated.slotLand===1, JSON.stringify(migrated));
  rec('migration runs once (no legacy key on reload)', !afterReload.hasLegacy && afterReload.slotCount===1, JSON.stringify(afterReload));
  rec('case 2 has no console/page errors', errors.length===0, errors.slice(0,2).join(' | '));
  await ctx.close();
}

// Case 3: boot restore picks newest slot by savedAt.
{
  const errors = [];
  const older = {
    savedAt: now - 60_000,
    project: {
      schemaVersion: 2,
      name: 'Older Slot',
      mapImage: null,
      imageFull: [100, 100],
      grid: null,
      terrain: { terrain: { '1000': 'sea' } },
      hexFeatures: {},
      hexsides: {},
      provenance: {}
    }
  };
  const newer = {
    savedAt: now,
    project: {
      schemaVersion: 2,
      name: 'Newest Slot',
      mapImage: null,
      imageFull: [100, 100],
      grid: null,
      terrain: { terrain: { '2000': 'sea', '2001': 'coast', '2002': 'coast' } },
      hexFeatures: {},
      hexsides: {},
      provenance: {}
    }
  };
  const ctx = await b.newContext();
  await ctx.addInitScript(({older,newer})=>{
    localStorage.setItem('hexwright.session.older-slot', JSON.stringify(older));
    localStorage.setItem('hexwright.session.newest-slot', JSON.stringify(newer));
  }, { older, newer });
  const page = await makePage(ctx, errors);
  await page.goto(`http://localhost:${PORT}/`,{waitUntil:'load'});
  await restoreNewestRecent(page);
  await sleep(1200);
  const bootRestored = await page.evaluate(()=>{
    const s=window.hexwright.store.state;
    return {name:s.name, land:Object.keys(s.terrain.terrain||{}).length, viewMode:window.hexwright.renderer.viewMode};
  });
  rec('start screen restore chooses newest saved slot', bootRestored.name==='Newest Slot' && bootRestored.land===3, JSON.stringify(bootRestored));
  rec('boot restore stays in classification view', bootRestored.viewMode==='classification', bootRestored.viewMode);
  rec('case 3 has no console/page errors', errors.length===0, errors.slice(0,2).join(' | '));
  await ctx.close();
}

// Case 4: HEXSIDE-ONLY project (no terrain — the NaB shape) must still autosave.
// Regression guard: the old land>0 gate meant hexside-only projects NEVER
// autosaved and edits lived only in the tab (2026-07-04).
{
  const errors = [];
  const ctx = await b.newContext();
  const page = await makePage(ctx, errors);
  await page.goto(`http://localhost:${PORT}/`,{waitUntil:'load'});
  await page.waitForFunction(()=>!!window.hexwright,{timeout:15000});
  await page.evaluate(()=>{
    window.hexwright.store.loadProject({
      schemaVersion: 2,
      name: 'Sides Only',
      mapImage: null,
      imageFull: [100, 100],
      grid: null,
      terrain: { terrain: {} },
      hexFeatures: {},
      hexsides: { '0101|0102': ['river'] },
      provenance: {}
    });
  });
  await sleep(1400); // > 800ms debounce
  const slotRaw = await page.evaluate(()=>localStorage.getItem('hexwright.session.sides-only'));
  let slotOk = false, note = 'no slot written';
  if (slotRaw) {
    const parsed = JSON.parse(slotRaw);
    const sides = Object.keys(parsed.project?.hexsides || {}).length;
    slotOk = sides === 1;
    note = `slot sides=${sides}`;
  }
  rec('hexside-only project autosaves (no terrain)', slotOk, note);
  rec('case 4 has no console/page errors', errors.length===0, errors.slice(0,2).join(' | '));
  await ctx.close();
}

await b.close(); srv.kill(); const fails=results.filter(x=>!x).length; console.log(`\n=== ${results.length-fails}/${results.length} passed ===`); process.exit(fails?1:0);
