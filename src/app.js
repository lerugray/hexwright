import { ProjectStore } from './store.js';
import { MapRenderer } from './renderer.js';
import { UI } from './ui.js';
import * as geo from './geometry.js';

async function readFile(file, type = 'text') {
  if (!file) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    if (type === 'dataurl') reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => { try { await img.decode(); } catch (_) {} resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

async function loadProjectFromManifest(manifestUrl) {
  const manifestRes = await fetch(manifestUrl);
  if (!manifestRes.ok) throw new Error(`Failed to fetch manifest: ${manifestUrl}`);
  const manifest = await manifestRes.json();

  const base = window.location.href;
  const mapUrl = new URL(manifest.map, base).href;
  const gridUrl = new URL(manifest.hexgrid, base).href;
  const terrainUrl = new URL(manifest.terrain, base).href;
  const sidesUrl = manifest.hexsides ? new URL(manifest.hexsides, base).href : null;

  const [mapImg, grid, terrain, hexsides] = await Promise.all([
    loadImage(mapUrl),
    fetch(gridUrl).then(r => r.json()),
    fetch(terrainUrl).then(r => r.json()),
    sidesUrl ? fetch(sidesUrl).then(r => r.json()) : Promise.resolve(null)
  ]);

  const traces = [];
  if (Array.isArray(manifest.traces)) {
    const traceImgs = await Promise.all(
      manifest.traces.map(t => loadImage(new URL(t.img, base).href).catch(() => null))
    );
    for (let i = 0; i < manifest.traces.length; i++) {
      const t = manifest.traces[i];
      traces.push({
        name: t.name,
        img: traceImgs[i],
        layer: t.layer,
        on: !!traceImgs[i],
        opacity: 0.5
      });
    }
  }

  return {
    name: manifest.name,
    mapImage: mapImg,
    imageFull: manifest.imageFull || grid.image_full || [mapImg.naturalWidth, mapImg.naturalHeight],
    grid,
    terrain,
    hexsides,
    traces
  };
}

async function loadUserFiles(mapFile, gridFile, terrainFile, sidesFile) {
  const [mapDataUrl, gridText, terrainText, sidesText] = await Promise.all([
    mapFile ? readFile(mapFile, 'dataurl') : Promise.resolve(null),
    gridFile ? readFile(gridFile) : Promise.resolve(null),
    terrainFile ? readFile(terrainFile) : Promise.resolve(null),
    sidesFile ? readFile(sidesFile) : Promise.resolve(null)
  ]);

  let mapImg = null;
  if (mapDataUrl) mapImg = await loadImage(mapDataUrl);

  const grid = gridText ? JSON.parse(gridText) : null;
  const terrain = terrainText ? JSON.parse(terrainText) : { terrain: {} };
  const hexsides = sidesText ? JSON.parse(sidesText) : null;

  const imageFull = grid?.image_full || [mapImg?.naturalWidth || 0, mapImg?.naturalHeight || 0];

  return {
    name: 'Custom project',
    mapImage: mapImg,
    imageFull,
    grid,
    terrain,
    hexsides,
    traces: []
  };
}

async function main() {
  const canvas = document.getElementById('map-canvas');
  const store = new ProjectStore();
  const renderer = new MapRenderer(canvas, store);
  const ui = new UI(store, renderer);

  async function loadAndRender(project) {
    store.loadProject(project);
    // Let the flex layout settle so the canvas has real dimensions before we
    // measure + fit — otherwise the first render sizes against a stale/zero
    // rect and draws nothing until a later event forces a redraw.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    renderer.resize();
    renderer.setBaseScale();
    renderer.fitView();
    ui.status(`${project.name || 'Project'} loaded — ${Object.keys(project.terrain.terrain || {}).length} land hexes`, 3000);
  }

  ui.setLoadHandlers({
    map: async (file) => {
      ui.status('Loading map image...');
      const dataUrl = await readFile(file, 'dataurl');
      const img = await loadImage(dataUrl);
      store.setProject({ mapImage: img, imageFull: [img.naturalWidth, img.naturalHeight] });
      renderer.setBaseScale();
      renderer.fitView();
    },
    grid: async (file) => {
      const text = await readFile(file);
      const grid = JSON.parse(text);
      store.setProject({ grid, imageFull: grid.image_full || store.state.imageFull });
      renderer.setBaseScale();
      renderer.fitView();
    },
    terrain: async (file) => {
      const text = await readFile(file);
      const terrain = JSON.parse(text);
      store.importTerrain(terrain);
      renderer.fitView();
    },
    sides: async (file) => {
      const text = await readFile(file);
      const hexsides = JSON.parse(text);
      store.importHexsides(hexsides);
    },
    sample: async () => {
      ui.status('Loading GotA sample...');
      try {
        const project = await loadProjectFromManifest('samples/gota-project.json');
        await loadAndRender(project);
      } catch (err) {
        console.error(err);
        ui.status(`Sample load failed: ${err.message}`, 5000);
      }
    },
    importSides: async (file) => {
      const text = await readFile(file);
      store.importHexsides(text);
      ui.status('Imported hexsides.json', 2000);
    },
    importTerrain: async (file) => {
      const text = await readFile(file);
      store.importTerrain(text);
      ui.status('Imported terrain.json', 2000);
    },
    importWmp: async (file) => {
      const text = await readFile(file);
      const count = store.importTerrain(text, { provenance: 'draft' });
      ui.status(`Imported ${count || 0} hexes as WMP draft — refine + confirm (toggle Anomalies to see draft hexes)`, 4000);
    }
  });

  // Expose minimal API for console debugging
  window.hexwright = { store, renderer, ui, geo };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
