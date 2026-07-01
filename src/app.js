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

const TWU_RIVERS_SHAPE = '{"hexsides":[["a","b"], ...]}';
const TWU_RAIL_SHAPE = '{"links":[["a","b"], ...]} (also accepts {a,b} link entries)';

function parseStrictPairArray(list, fieldName) {
  if (!Array.isArray(list)) {
    throw new Error(`Expected ${fieldName} shape ${TWU_RIVERS_SHAPE}.`);
  }
  return list.map((entry, idx) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error(`${fieldName}[${idx}] must be a 2-element [a,b] array.`);
    }
    const a = String(entry[0] || '').trim();
    const b = String(entry[1] || '').trim();
    if (!a || !b || a === b) {
      throw new Error(`${fieldName}[${idx}] must contain two distinct hex codes.`);
    }
    return [a, b];
  });
}

function parseFlexiblePairArray(list, fieldName) {
  if (!Array.isArray(list)) {
    throw new Error(`Expected ${fieldName} shape ${TWU_RAIL_SHAPE}.`);
  }
  return list.map((entry, idx) => {
    if (Array.isArray(entry)) {
      if (entry.length !== 2) throw new Error(`${fieldName}[${idx}] must be [a,b] or {a,b}.`);
      const a = String(entry[0] || '').trim();
      const b = String(entry[1] || '').trim();
      if (!a || !b || a === b) throw new Error(`${fieldName}[${idx}] must contain two distinct hex codes.`);
      return [a, b];
    }
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${fieldName}[${idx}] must be [a,b] or {a,b}.`);
    }
    const a = String(entry.a || '').trim();
    const b = String(entry.b || '').trim();
    if (!a || !b || a === b) throw new Error(`${fieldName}[${idx}] must contain two distinct hex codes.`);
    return [a, b];
  });
}

function detectTwuLayer(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Expected a TWU JSON object: rivers ${TWU_RIVERS_SHAPE} OR rail ${TWU_RAIL_SHAPE}.`);
  }

  const hasHexsides = Object.prototype.hasOwnProperty.call(payload, 'hexsides');
  const hasLinks = Object.prototype.hasOwnProperty.call(payload, 'links');
  const errors = [];

  let riversValid = false;
  let railValid = false;

  if (hasHexsides) {
    try {
      parseStrictPairArray(payload.hexsides, 'hexsides');
      riversValid = true;
    } catch (err) {
      errors.push(err.message);
    }
  }
  if (hasLinks) {
    try {
      parseFlexiblePairArray(payload.links, 'links');
      railValid = true;
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (riversValid && !railValid) return 'rivers';
  if (railValid && !riversValid) return 'rail';
  if (riversValid && railValid) {
    throw new Error('File matches both rivers and rail shapes. Import one TWU layer per file.');
  }

  if (errors.length) {
    throw new Error(`TWU import validation failed: ${errors[0]} Expected rivers ${TWU_RIVERS_SHAPE} OR rail ${TWU_RAIL_SHAPE}.`);
  }
  throw new Error(`TWU import validation failed: expected rivers ${TWU_RIVERS_SHAPE} OR rail ${TWU_RAIL_SHAPE}.`);
}

function twuCommentDate() {
  return new Date().toISOString().slice(0, 10);
}

const LEGACY_SESSION_KEY = 'hexwright:session';
const SESSION_KEY_PREFIX = 'hexwright.session.';
const MAX_SESSION_SLOTS = 6;

function slugProjectName(name) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'untitled';
}

function sessionKeyForName(name) {
  return `${SESSION_KEY_PREFIX}${slugProjectName(name)}`;
}

function countLandHexes(project) {
  if (!project || !project.terrain) return 0;
  const terrain = project.terrain.terrain || project.terrain || {};
  return Object.keys(terrain).length;
}

function parseSessionRecord(raw) {
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return null;

  let project = parsed;
  let savedAt = 0;
  if (parsed.project && typeof parsed.project === 'object') {
    project = parsed.project;
    savedAt = Number(parsed.savedAt) || 0;
  } else if (Number.isFinite(Number(parsed.savedAt))) {
    savedAt = Number(parsed.savedAt) || 0;
  }
  if (!project || typeof project !== 'object') return null;

  return {
    project,
    savedAt,
    land: countLandHexes(project)
  };
}

function encodeSessionRecord(project, savedAt = Date.now()) {
  return JSON.stringify({ savedAt, project });
}

function listSessionSlots() {
  const slots = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(SESSION_KEY_PREFIX)) continue;
    try {
      const record = parseSessionRecord(localStorage.getItem(key));
      if (!record) continue;
      slots.push({ key, ...record });
    } catch (_) { /* ignore a corrupt slot */ }
  }
  slots.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return slots;
}

function getSessionSlotForName(name) {
  const key = sessionKeyForName(name);
  try {
    const record = parseSessionRecord(localStorage.getItem(key));
    return record ? { key, ...record } : null;
  } catch (_) {
    return null;
  }
}

function getNewestSessionSlot() {
  const slots = listSessionSlots();
  return slots.length ? slots[0] : null;
}

function askToRestore(slot, kind = 'boot') {
  if (!slot || !slot.project) return false;
  const name = slot.project.name || 'untitled';
  const when = slot.savedAt
    ? new Date(slot.savedAt).toLocaleString()
    : 'unknown time';
  const message = kind === 'project'
    ? `Restore autosaved session for "${name}" (${when})?`
    : `Restore your most recent autosaved session "${name}" (${when})?`;
  try {
    return window.confirm(message);
  } catch (_) {
    // In non-interactive contexts, default to restore.
    return true;
  }
}

function pruneSessionSlots() {
  const slots = listSessionSlots();
  for (let i = MAX_SESSION_SLOTS; i < slots.length; i++) {
    localStorage.removeItem(slots[i].key);
  }
}

function migrateLegacySessionOnce() {
  const legacyRaw = localStorage.getItem(LEGACY_SESSION_KEY);
  if (!legacyRaw) return;

  try {
    const legacy = parseSessionRecord(legacyRaw);
    if (!legacy || legacy.land <= 0) return;

    const targetKey = sessionKeyForName(legacy.project.name);
    const existingRaw = localStorage.getItem(targetKey);
    let shouldWrite = true;
    if (existingRaw) {
      const existing = parseSessionRecord(existingRaw);
      if (existing && (existing.savedAt || 0) > (legacy.savedAt || 0)) {
        shouldWrite = false;
      }
    }
    if (shouldWrite) {
      localStorage.setItem(targetKey, encodeSessionRecord(legacy.project, legacy.savedAt || Date.now()));
    }
  } catch (_) {
    /* ignore corrupt legacy payload */
  } finally {
    // Remove legacy key after first migration attempt.
    localStorage.removeItem(LEGACY_SESSION_KEY);
    pruneSessionSlots();
  }
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
  const paletteUrl = typeof manifest.palette === 'string'
    ? new URL(manifest.palette, base).href
    : null;

  const [mapImg, grid, terrain, hexsides, palette] = await Promise.all([
    loadImage(mapUrl),
    fetch(gridUrl).then(r => r.json()),
    fetch(terrainUrl).then(r => r.json()),
    sidesUrl ? fetch(sidesUrl).then(r => r.json()) : Promise.resolve(null),
    paletteUrl ? fetch(paletteUrl).then(r => r.json()) : Promise.resolve(manifest.palette && typeof manifest.palette === 'object' ? manifest.palette : null)
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
    palette,
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

  // Load a project manifest, offering the matching autosave slot first —
  // shared by the sample button and the ?project=<url> boot parameter.
  async function loadManifestWithRestore(manifestUrl) {
    const project = await loadProjectFromManifest(manifestUrl);
    const slot = getSessionSlotForName(project.name);
    if (slot && slot.land > 0 && askToRestore(slot, 'project')) {
      const restored = slot.project;
      restored.mapImage = project.mapImage;
      restored.traces = project.traces || [];
      if (!restored.imageFull || !restored.imageFull[0]) restored.imageFull = project.imageFull;
      if (!restored.grid) restored.grid = project.grid;
      if (project.palette) restored.palette = project.palette;
      await loadAndRender(restored);
      renderer.setViewMode('classification');
      ui.status(`Restored autosave for ${project.name}.`, 4500);
      return;
    }
    await loadAndRender(project);
  }

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
      // Preserve the grid's calibration space if a grid is loaded — swapping in
      // a different-resolution raster must not re-anchor world coordinates.
      const gridFull = store.state.grid && store.state.grid.image_full;
      store.setProject({ mapImage: img, imageFull: gridFull || [img.naturalWidth, img.naturalHeight] });
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
        await loadManifestWithRestore('samples/gota-project.json');
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
    },
    importTwu: async (file) => {
      if (!file) return;
      try {
        const text = await readFile(file);
        const payload = JSON.parse(text);
        const layer = detectTwuLayer(payload);
        if (layer === 'rivers') {
          const touched = store.importTwuRivers(payload, { provenance: 'draft' });
          ui.status(`Imported TWU rivers (${touched} touched hexes, marked draft).`, 4500);
        } else {
          const touched = store.importTwuRail(payload, { provenance: 'draft' });
          ui.status(`Imported TWU rail (${touched} touched hexes, marked draft).`, 4500);
        }
      } catch (err) {
        ui.status(`TWU import failed: ${err.message}`, 7000);
      }
    },
    exportTwu: async () => {
      const rivers = store.exportTwuRiversObject();
      const rail = store.exportTwuRailObject();
      if (!rivers._comment) rivers._comment = `edited in Hexwright v2.1 ${twuCommentDate()}`;
      if (!rail._comment) rail._comment = `edited in Hexwright v2.1 ${twuCommentDate()}`;

      const downloadObject = (filename, obj) => {
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      };

      downloadObject('rivers.json', rivers);
      downloadObject('rail.json', rail);
      ui.status('Exported TWU rivers.json + rail.json', 3000);
    }
  });

  // Session autosave: debounced-persist the working project to localStorage on
  // every change (data + grid; the base-map bitmap is not serialized), and restore
  // it on the next visit so an accidental reload never loses hand-assignment work.
  // ?project=<manifest-url> boots straight into a project (used by the
  // double-click launcher for the full-res local GotA manifest). Falls back
  // to the normal newest-slot restore prompt when absent or failing.
  const bootManifest = new URLSearchParams(window.location.search).get('project');
  if (bootManifest) {
    try {
      migrateLegacySessionOnce();
      ui.status(`Loading ${bootManifest}...`);
      await loadManifestWithRestore(bootManifest);
    } catch (err) {
      console.error(err);
      ui.status(`Project load failed: ${err.message} — use Load GotA sample or the file pickers.`, 7000);
    }
  } else try {
    migrateLegacySessionOnce();
    const newest = getNewestSessionSlot();
    if (newest && newest.land > 0 && askToRestore(newest, 'boot')) {
      const proj = newest.project;
      proj.mapImage = null;
      await loadAndRender(proj);
      renderer.setViewMode('classification');
      ui.status(`Restored your last session for ${proj.name || 'untitled'} (data + grid). Load the base map to see it under the grid, or Load GotA sample to start fresh.`, 6000);
    }
  } catch (_) { /* ignore a corrupt autosave */ }

  let _autosaveTimer = null;
  store.onChange(() => {
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(() => {
      try {
        const land = Object.keys(store.state.terrain.terrain || {}).length;
        if (land > 0) {
          const project = store.exportProjectObject();
          localStorage.setItem(
            sessionKeyForName(project.name),
            encodeSessionRecord(project)
          );
          pruneSessionSlots();
        }
      } catch (_) { /* quota or serialization issue — skip this autosave */ }
    }, 800);
  });

  // Expose minimal API for console debugging
  window.hexwright = { store, renderer, ui, geo };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
