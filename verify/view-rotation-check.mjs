import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { homedir } from 'node:os';
import { createServer } from 'node:http';
import { MapRenderer } from '../src/renderer.js';
import { UI } from '../src/ui.js';
import { ProjectStore } from '../src/store.js';
import * as geo from '../src/geometry.js';

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const point = (a,b) => { close(a.x,b.x); close(a.y,b.y); };
// A small affine recording context verifies the actual drawing helpers against
// pointer conversion; it is not a substitute for the browser PNG checks below.
function recordingContext() {
  let m=[1,0,0,1,0,0];
  const mul=n=>{const [a,b,c,d,e,f]=m;const [g,h,i,j,k,l]=n;m=[a*g+c*h,b*g+d*h,a*i+c*j,b*i+d*j,a*k+c*l+e,b*k+d*l+f];};
  return {
    translate:(x,y)=>mul([1,0,0,1,x,y]),
    rotate:a=>mul([Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]),
    scale:(x,y)=>mul([x,0,0,y,0,0]),
    at:({x,y})=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]}),
    getTransform:()=>({a:m[0],b:m[1],c:m[2],d:m[3]})
  };
}
const grid = JSON.parse(readFileSync(new URL('../demo/hexgrid.json', import.meta.url)));
const store = new ProjectStore();
store.setProject({ name: 'Rotation fixture', grid, imageFull: grid.image_full,
  terrain: JSON.parse(readFileSync(new URL('../demo/terrain.json', import.meta.url))),
  names: { '0202': 'Upright' } });
const r = Object.create(MapRenderer.prototype);
Object.assign(r, {store, width: 1100, height: 800, view: {baseScale:1, zoom:1, panX:0, panY:0, rotation:0}, draw() {}});
const handlers = {};
const wrap = { addEventListener: (name, fn) => { handlers[name] = fn; },
  setPointerCapture() {}, releasePointerCapture() {}, getBoundingClientRect: () => ({left:17,top:23}) };
r.canvas = {parentElement:wrap};
r._bindPointer();
const baseline = JSON.stringify(store.exportProjectObject());
for (const rotation of [0,90,180,270]) {
  check(`${rotation}: turning preserves viewport center`,()=>{
    const center={x:r.width/2,y:r.height/2}; const native=r.screenToWorld(center);
    r.setRotation(rotation);point(r.screenToWorld(center),native);
  });
  r.fitView();
  check(`${rotation}: raster/overlay context agrees with picking`,()=>{
    const ctx=recordingContext();r._applyView(ctx,r.view,[13,-17]);
    point(ctx.at({x:140,y:235}),r.worldToScreen({x:153,y:218}));
  });
  check(`${rotation}: label group layout stays upright at rotated anchor`,()=>{
    const ctx=recordingContext();r._applyView(ctx,r.view);
    const center={x:300,y:200}, anchor=ctx.at(center);
    r._uprightGroup(ctx,r.view,center);point(ctx.at(center),anchor);
    const offset=ctx.at({x:300,y:210});
    point(offset,{x:anchor.x,y:anchor.y+10*r.view.baseScale*r.view.zoom});
  });
  check(`${rotation}: clockwise basis`, () => {
    const expected = [[1,0],[0,1],[-1,0],[0,-1]][rotation/90];
    const p = geo.rotatePoint({x:1,y:0},rotation); point(p,{x:expected[0],y:expected[1]});
  });
  check(`${rotation}: every hex picks in native coordinates`, () => {
    for (const [code,c] of Object.entries(store.centers)) {
      const p = r.worldToScreen(c); point(r.screenToWorld(p),c);
      assert.equal(r.hexAtScreen(p),code);
    }
  });
  check(`${rotation}: edge picks`, () => {
    for (let edge = 0; edge < 6; edge++) {
      const code = '0202'; const neighbor = geo.edgeNeighbor(code,edge,store.centers,grid);
      assert.ok(neighbor);
      const p = r.worldToScreen(geo.edgeMidpoint(code,edge,grid));
      const hit = geo.nearestEdge(p.x,p.y,{grid,centers:store.centers,view:r.view,hexAtScreen:p=>r.hexAtScreen(p)});
      assert.equal(hit?.edgeKey,geo.pairKey(code,neighbor));
    }
  });
  check(`${rotation}: fit contains all four corners`, () => {
    const [w,h] = store.state.imageFull;
    for (const p of [{x:0,y:0},{x:w,y:0},{x:0,y:h},{x:w,y:h}]) {
      const q=r.worldToScreen(p);
      assert.ok(q.x >= 24-1e-7 && q.x <= r.width-24+1e-7 && q.y >= 24-1e-7 && q.y <= r.height-24+1e-7);
    }
  });
  check(`${rotation}: cursor zoom anchor`, () => {
    const p={x:321,y:246}, before=r.screenToWorld(p);
    handlers.wheel({clientX:p.x+17,clientY:p.y+23,deltaY:-100,preventDefault(){}}); point(r.screenToWorld(p),before);
  });
  check(`${rotation}: pan tracks screen delta`, () => {
    const p={x:300,y:200}, before=r.worldToScreen(p);
    handlers.pointerdown({button:1,clientX:100,clientY:100,pointerId:1,preventDefault(){}});
    handlers.pointermove({clientX:173,clientY:61});
    handlers.pointerup({pointerId:1});
    point(r.worldToScreen(p),{x:before.x+73,y:before.y-39});
  });
  check(`${rotation}: project export byte identity`, () => assert.equal(JSON.stringify(store.exportProjectObject()),baseline));
  check(`${rotation}: text counter-rotation`, () => {
    const calls=[]; const angle=rotation*Math.PI/180;
    const ctx={ getTransform:()=>({a:Math.cos(angle),b:Math.sin(angle)}), save(){},restore(){},translate(){},rotate:a=>calls.push(a),fillText:()=>{} };
    r._text(ctx,'fillText','Label',12,34);
    close((calls[0] || 0) + Math.atan2(Math.sin(angle),Math.cos(angle)),0);
  });
}
const memory = new Map();
globalThis.localStorage = {getItem:k=>memory.get(k) ?? null,setItem:(k,v)=>memory.set(k,v)};
const ui = Object.create(UI.prototype);
Object.assign(ui,{store,renderer:r,els:{'rotate-view':{textContent:''}}});
check('manifest default, saved override, and project isolation',()=>{
  store.viewDefaults={rotation:90}; ui._loadProjectRotation(); assert.equal(r.view.rotation,90);
  ui.rotateView(); assert.equal(r.view.rotation,180);
  ui._loadProjectRotation(); assert.equal(r.view.rotation,180);
  store.state.name='Other project';store.viewDefaults={};ui._loadProjectRotation();assert.equal(r.view.rotation,0);
  store.state.name='Rotation fixture';ui._loadProjectRotation();assert.equal(r.view.rotation,180);
  assert.equal(JSON.stringify(store.exportProjectObject()),baseline);
});
check('invalid default falls back to zero',()=>{
  memory.clear();store.viewDefaults={rotation:45};ui._loadProjectRotation();assert.equal(r.view.rotation,0);
});
delete globalThis.localStorage;
console.log(`${passed} Node rotation checks passed`);
if (process.argv.includes('--unit-only')) process.exit(0);

const { chromium } = await import('playwright');
const root=resolve('.');
const usc=process.env.USCW_MAP_DIR || join(homedir(),'Desktop/Dev Work/us-civil-war-digital/materials/map-data/uscw');
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  let file;
  if(url.pathname==='/uscw-project.json') {
    const manifest=JSON.parse(readFileSync(join(usc,'project.json')));
    for(const key of ['map','hexgrid','palette','terrain','hexsides','features','names']) {
      if(typeof manifest[key]==='string') manifest[key]='/uscw/'+manifest[key].split('/').at(-1);
    }
    manifest.view={rotation:90};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(manifest));return;
  }
  file=url.pathname.startsWith('/uscw/') ? join(usc,url.pathname.slice(6)) : join(root,url.pathname==='/'?'index.html':url.pathname);
  try {
    res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml'})[extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  } catch {res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true,args:['--mute-audio']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(`${base}/?project=demo/project.json`);
  await page.waitForFunction(()=>window.hexwright?.store.centers && Object.keys(window.hexwright.store.centers).length>0);
  await page.evaluate(()=>{document.getElementById('coach-card')?.remove();});
  const native=await page.evaluate(()=>{
    const {store,renderer}=window.hexwright;
    return {json:JSON.stringify(store.exportProjectObject()),png:renderer.exportOverlayPNG({download:false})};
  });
  for(const rotation of [0,90,180,270]) {
    await page.evaluate(rotation=>{
      const {renderer,ui}=window.hexwright;renderer.setRotation(rotation);renderer.fitView();ui.setMode('inspect');
    },rotation);
    const canvas=await page.locator('#map-canvas').boundingBox();
    const target=await page.evaluate(()=>{const {store,renderer}=window.hexwright;const code='0505';return {code,...renderer.worldToScreen(store.centers[code])};});
    await page.mouse.click(canvas.x+target.x,canvas.y+target.y);
    const selected = await page.evaluate(()=>window.hexwright.renderer.selectedHex);
    check(`${rotation}: browser click selects hex`,()=>assert.equal(selected,target.code));
    await page.keyboard.press('Escape');
    const pan=await page.evaluate(()=>({...window.hexwright.renderer.view}));
    await page.mouse.move(canvas.x+100,canvas.y+100);await page.mouse.down({button:'middle'});
    await page.mouse.move(canvas.x+163,canvas.y+127);await page.mouse.up({button:'middle'});
    const moved=await page.evaluate(()=>({...window.hexwright.renderer.view}));
    check(`${rotation}: browser drag pan`,()=>{close(moved.panX-pan.panX,63);close(moved.panY-pan.panY,27);});
    const wp=await page.evaluate(()=>window.hexwright.renderer.screenToWorld({x:200,y:200}));
    await page.mouse.move(canvas.x+200,canvas.y+200);await page.mouse.wheel(0,-150);
    await page.waitForTimeout(100);
    const after=await page.evaluate(()=>window.hexwright.renderer.screenToWorld({x:200,y:200}));
    check(`${rotation}: browser wheel anchor`,()=>point(after,wp));
    const exported=await page.evaluate(()=>({json:JSON.stringify(window.hexwright.store.exportProjectObject()),png:window.hexwright.renderer.exportOverlayPNG({download:false})}));
    check(`${rotation}: JSON and PNG byte identity`,()=>assert.deepEqual(exported,native));
    await page.keyboard.press('Escape');
  }
  await page.evaluate(()=>window.hexwright.renderer.setRotation(0));
  await page.keyboard.press('r');
  assert.equal(await page.evaluate(()=>window.hexwright.renderer.view.rotation),90);
  await page.reload();await page.waitForFunction(()=>window.hexwright?.renderer.view.rotation===90);
  check('toolbar/shortcut and per-project persistence',()=>{});
  if(process.argv.includes('--frames')) {
    assert.ok(existsSync(join(usc,'project.json')),'USCW source missing');
    const out=join(root,'verify/out/view-rotation-s312');mkdirSync(out,{recursive:true});
    await page.evaluate(()=>{document.getElementById('coach-card')?.remove();window.hexwright.renderer.fitView();});
    await page.screenshot({path:join(out,'demo-90.png')});
    await page.goto(`${base}/?project=uscw-project.json`);
    await page.waitForFunction(()=>window.hexwright?.store.state.mapImage && window.hexwright.renderer.view.rotation===90);
    check('USCW manifest default opens at 90',()=>{});
    for(const rotation of [0,90]) {
      await page.evaluate(rotation=>{document.getElementById('coach-card')?.remove();const r=window.hexwright.renderer;r.setRotation(rotation);r.fitView();},rotation);
      await page.screenshot({path:join(out,`uscw-${rotation}.png`)});
    }
  }
  assert.deepEqual(errors,[]);
  console.log(`${passed} rotation checks passed`);
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
