import { ProjectStore, validateNamesDocument } from './store.js';
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

function countHexsideEdges(project) {
  if (!project || !project.hexsides) return 0;
  return Object.keys(project.hexsides).length;
}

function countGroups(project) {
  if (!project || !Array.isArray(project.groups)) return 0;
  return project.groups.length;
}

function countPointFeatures(project) {
  const features = project?.features;
  if (!features) return 0;
  if (Array.isArray(features.features)) return features.features.length;
  if (typeof features === 'object' && !Array.isArray(features)) {
    let count = 0;
    for (const code of Object.keys(features)) {
      if (code === '_comment') continue;
      const byType = features[code];
      if (byType && typeof byType === 'object' && !Array.isArray(byType)) {
        count += Object.keys(byType).length;
      }
    }
    return count;
  }
  return 0;
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
    land: countLandHexes(project),
    sides: countHexsideEdges(project),
    groups: countGroups(project)
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

function formatRelativeTime(ts) {
  if (!ts) return 'unknown time';
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return sec <= 1 ? 'just now' : `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? '1 min ago' : `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? '1 hr ago' : `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return day === 1 ? '1 day ago' : `${day} days ago`;
}

function sniffJsonKind(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (Array.isArray(obj.nodes) && obj.meta) return 'nodes';
  if (Array.isArray(obj.edges) && (obj.meta || obj._comment !== undefined)) return 'edges';
  if (obj.grid_version !== undefined || obj.col_pitch_x !== undefined || obj.x_model !== undefined) return 'grid';
  if (obj.terrain !== undefined) return 'terrain';
  if (Array.isArray(obj.rivers) || Array.isArray(obj.mountains)) return 'sides';
  if (Object.keys(obj).some((k) => /^[a-f0-9]{4}$/i.test(k))) return 'sides';
  if (obj.map && obj.hexgrid) return 'manifest';
  return null;
}

function makeBlankProject({ grid = null, blankLattice = false, mapFamily = 'hex' } = {}) {
  return {
    name: 'untitled',
    mapFamily,
    mapImage: null,
    imageFull: grid?.image_full || [100, 100],
    grid,
    terrain: { terrain: {} },
    hexsides: null,
    palette: null,
    traces: [],
    hexFeatures: {},
    features: {},
    names: {},
    provenance: {},
    groups: [],
    nodes: {},
    nodesMeta: {},
    nodesFile: '',
    ptpEdges: {},
    ...(blankLattice ? { blankLattice: true } : {})
  };
}

function promptRestore(slot, kind = 'boot') {
  return new Promise((resolve) => {
    if (!slot || !slot.project) {
      resolve(false);
      return;
    }
    const prompt = document.getElementById('restore-prompt');
    const msg = document.getElementById('restore-prompt-msg');
    const restoreBtn = document.getElementById('restore-prompt-restore');
    const freshBtn = document.getElementById('restore-prompt-fresh');
    if (!prompt || !msg || !restoreBtn || !freshBtn) {
      resolve(true);
      return;
    }

    const name = slot.project.name || 'untitled';
    const when = slot.savedAt ? formatRelativeTime(slot.savedAt) : 'unknown time';
    msg.textContent = kind === 'project'
      ? `Restore autosave for ${name} (${when})?`
      : `Restore autosave for ${name} (${when})?`;

    const finish = (choice) => {
      prompt.hidden = true;
      document.removeEventListener('keydown', onKey);
      restoreBtn.onclick = null;
      freshBtn.onclick = null;
      resolve(choice);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
    };

    restoreBtn.onclick = () => finish(true);
    freshBtn.onclick = () => finish(false);
    document.addEventListener('keydown', onKey);
    prompt.hidden = false;
    restoreBtn.focus();
  });
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
  const isPtp = manifest.mapFamily === 'ptp' || !!manifest.nodes;
  const mapUrl = manifest.map ? new URL(manifest.map, base).href : null;
  const gridUrl = manifest.hexgrid ? new URL(manifest.hexgrid, base).href : null;
  const terrainUrl = manifest.terrain ? new URL(manifest.terrain, base).href : null;
  const sidesUrl = manifest.hexsides ? new URL(manifest.hexsides, base).href : null;
  const featuresUrl = manifest.features ? new URL(manifest.features, base).href : null;
  const namesUrl = manifest.names ? new URL(manifest.names, base).href : null;
  const nodesUrl = manifest.nodes ? new URL(manifest.nodes, base).href : null;
  const edgesUrl = manifest.edges ? new URL(manifest.edges, base).href : null;
  const paletteUrl = typeof manifest.palette === 'string'
    ? new URL(manifest.palette, base).href
    : null;

  const [mapImg, grid, terrain, hexsides, features, names, nodesDoc, edgesDoc, palette] = await Promise.all([
    mapUrl ? loadImage(mapUrl) : Promise.resolve(null),
    gridUrl ? fetch(gridUrl).then(r => r.json()) : Promise.resolve(null),
    terrainUrl ? fetch(terrainUrl).then(r => r.json()) : Promise.resolve(isPtp ? { terrain: {} } : null),
    sidesUrl ? fetch(sidesUrl).then(r => r.json()) : Promise.resolve(null),
    featuresUrl ? fetch(featuresUrl).then(r => r.json()) : Promise.resolve(null),
    namesUrl ? fetch(namesUrl).then(r => r.json()) : Promise.resolve(null),
    nodesUrl ? fetch(nodesUrl).then(r => r.json()) : Promise.resolve(null),
    edgesUrl ? fetch(edgesUrl).then(r => r.json()) : Promise.resolve(null),
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
    mapFamily: manifest.mapFamily || (nodesDoc ? 'ptp' : 'hex'),
    mapImage: mapImg,
    imageFull: manifest.imageFull || grid?.image_full || nodesDoc?.meta?.imageFull || [mapImg.naturalWidth, mapImg.naturalHeight],
    grid: nodesDoc ? null : grid,
    terrain: nodesDoc ? { terrain: {} } : terrain,
    hexsides: nodesDoc ? null : hexsides,
    features: nodesDoc ? null : features,
    names: nodesDoc ? null : names,
    nodes: nodesDoc ? undefined : {},
    nodesMeta: nodesDoc?.meta || {},
    nodesFile: manifest.nodes || '',
    edges: edgesDoc || null,
    groups: Array.isArray(manifest.groups) ? manifest.groups : null,
    palette,
    traces,
    blankLattice: manifest.blankLattice === true,
    ...(nodesDoc ? { _nodesDocument: nodesDoc } : {})
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

  const startScreen = document.getElementById('start-screen');
  const recentList = document.getElementById('recent-list');
  const recentListWrap = document.getElementById('recent-list-wrap');
  const recentMeta = document.getElementById('recent-meta');
  const loadChooser = document.getElementById('load-chooser');
  const coachCard = document.getElementById('coach-card');
  let _awaitingBlankGrid = false;
  let _coachHiddenSession = false;

  function isStartScreenVisible() {
    return startScreen && !startScreen.hidden;
  }

  function hideStartScreen() {
    if (startScreen) startScreen.hidden = true;
    if (loadChooser) loadChooser.hidden = true;
  }

  function showStartScreen() {
    if (startScreen) startScreen.hidden = false;
    if (coachCard) coachCard.hidden = true;
    populateRecentList();
  }

  function maybeShowCoach() {
    if (isStartScreenVisible() || _coachHiddenSession) return;
    if (localStorage.getItem('hexwright.coach.dismissed') === '1') return;
    if (coachCard) coachCard.hidden = false;
  }

  function hideCoach() {
    _coachHiddenSession = true;
    if (coachCard) coachCard.hidden = true;
  }

  function dismissCoachForever() {
    localStorage.setItem('hexwright.coach.dismissed', '1');
    hideCoach();
  }

  function finishProjectLoad() {
    hideStartScreen();
    maybeShowCoach();
  }

  function isRenderableProject() {
    const s = store.state;
    return !!(s.mapImage || s.grid || (s.mapFamily === 'ptp' && Object.keys(s.nodes || {}).length));
  }

  function maybeFinishPartialLoad() {
    if (isRenderableProject()) finishProjectLoad();
  }

  function populateRecentList() {
    const slots = listSessionSlots().slice(0, MAX_SESSION_SLOTS);
    if (!recentList || !recentListWrap || !recentMeta) return;

    recentList.innerHTML = '';
    if (!slots.length) {
      recentListWrap.hidden = true;
      recentMeta.textContent = 'no autosaves yet';
      recentMeta.classList.add('dimmed');
      return;
    }

    recentListWrap.hidden = false;
    recentMeta.classList.remove('dimmed');
    const newest = slots[0];
    recentMeta.textContent = `${newest.project.name || 'untitled'} · ${formatRelativeTime(newest.savedAt)}`;

    for (const slot of slots) {
      const row = document.createElement('div');
      row.className = 'recent-row';
      row.dataset.key = slot.key;
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = slot.project.name || 'untitled';
      const detail = document.createElement('span');
      detail.className = 'detail hx-data';
      const summary = slot.land > 0 ? `${slot.land} hexes` : slot.sides > 0 ? `${slot.sides} edges` : slot.groups > 0 ? `${slot.groups} groups` : 'empty';
      detail.textContent = `${summary} · ${formatRelativeTime(slot.savedAt)}`;
      row.append(name, detail);
      row.addEventListener('click', () => restoreFromSlot(slot));
      recentList.appendChild(row);
    }
  }

  async function restoreFromSlot(slot) {
    if (!slot?.project) return;
    const proj = slot.project;
    proj.mapImage = null;
    await loadAndRender(proj);
    if (store.isPtp()) {
      renderer.setViewMode('map');
      ui.onPtpProjectLoaded();
    } else {
      renderer.setViewMode('classification');
    }
    ui.setProjectSource('');
    ui.status(`Restored session for ${proj.name || 'untitled'} (data + grid). Load the base map to see it under the grid.`, 6000);
    finishProjectLoad();
  }

  async function loadAndRender(project) {
    if (project._nodesDocument) {
      const nodesDoc = project._nodesDocument;
      delete project._nodesDocument;
      project.nodes = {};
      await store.loadProject(project);
      store.importNodes(nodesDoc, { nodesFile: project.nodesFile || '', skipUndo: true });
      if (project.edges) store.importPtpEdges(project.edges, { skipUndo: true });
      ui.onPtpProjectLoaded();
    } else {
      await store.loadProject(project);
      if (store.isPtp()) ui.onPtpProjectLoaded();
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    renderer.resize();
    renderer.setBaseScale();
    renderer.fitView();
    if (store.isPtp()) {
      const nodeCount = Object.keys(store.state.nodes || {}).length;
      ui.status(`${project.name || 'Project'} loaded — ${nodeCount} nodes`, 3000);
    } else {
      const land = Object.keys(project.terrain?.terrain || {}).length;
      if (land > 0) {
        ui.status(`${project.name || 'Project'} loaded — ${land} land hexes`, 3000);
      }
    }
    ui._updateProjectInfo();
  }

  async function loadManifestWithRestore(manifestUrl) {
    const manifestLabel = String(manifestUrl || '').split('/').pop() || '';
    const project = await loadProjectFromManifest(manifestUrl);
    const slot = getSessionSlotForName(project.name);
    if (slot && (slot.land > 0 || slot.sides > 0 || slot.groups > 0) && await promptRestore(slot, 'project')) {
      const restored = slot.project;
      restored.mapImage = project.mapImage;
      restored.traces = project.traces || [];
      if (!restored.imageFull || !restored.imageFull[0]) restored.imageFull = project.imageFull;
      if (!restored.grid) restored.grid = project.grid;
      if (project.palette) restored.palette = project.palette;
      // Hexside-only autosaves (common during GotA tracing) must not discard the
      // manifest's production terrain layer on restore. But this must ONLY backfill
      // when the autosave has NO terrain at all — comparing counts (manifestLand >
      // restoredLand) wholesale-discarded any PARTIAL operator terrain painting
      // (fewer cells than the shipped sample) on restore, destroying real work
      // (2026-07-05 incident: a night of GotA terrain painting lost this way).
      const manifestLand = countLandHexes(project);
      const restoredLand = countLandHexes(restored);
      if (restoredLand === 0 && manifestLand > 0) restored.terrain = project.terrain;
      // Manifest point features merge UNDER the autosave's: a (code,type) the
      // operator placed always wins; manifest-only entries (e.g. generated
      // route/paint-guide markers) still appear.
      if (project.features) {
        const manifestFeatures = Array.isArray(project.features?.features)
          ? project.features.features
          : (Array.isArray(project.features) ? project.features : null);
        if (manifestFeatures) {
          const restoredFeatures = restored.features || {};
          for (const entry of manifestFeatures) {
            const code = String(entry.code || '').trim();
            const type = String(entry.type || '').trim();
            if (!code || !type) continue;
            if (restoredFeatures[code] && restoredFeatures[code][type]) continue;
            if (!restoredFeatures[code]) restoredFeatures[code] = {};
            restoredFeatures[code][type] = {
              name: entry.name != null ? String(entry.name) : '',
              attrs: JSON.parse(JSON.stringify(entry.attrs || {}))
            };
          }
          restored.features = restoredFeatures;
        }
      }
      if (project.names) {
        let manifestNames = null;
        try {
          manifestNames = validateNamesDocument(
            project.names.names && typeof project.names.names === 'object'
              ? project.names
              : { names: project.names }
          ).names;
        } catch (err) {
          console.warn('hexwright: manifest names skipped:', err.message);
        }
        if (manifestNames) {
          const restoredDoc = restored.names;
          const restoredNames = restoredDoc?.names && typeof restoredDoc.names === 'object'
            ? { ...restoredDoc.names }
            : (restoredDoc && typeof restoredDoc === 'object' && !Array.isArray(restoredDoc)
              ? { ...restoredDoc }
              : {});
          for (const [code, name] of Object.entries(manifestNames)) {
            if (restoredNames[code]) continue;
            restoredNames[code] = name;
          }
          restored.names = restoredNames;
        }
      }
      // Merge manifest groups under restored groups: restored wins by id; manifest-only
      // groups are appended so operator work is preserved while missing groups backfill.
      if (Array.isArray(project.groups) && project.groups.length) {
        const restoredGroups = Array.isArray(restored.groups) ? restored.groups.slice() : [];
        const existingIds = new Set(restoredGroups.map((g) => g.id));
        for (const g of project.groups) {
          if (g && g.id && !existingIds.has(g.id)) {
            restoredGroups.push(g);
            existingIds.add(g.id);
          }
        }
        restored.groups = restoredGroups;
      }
      await loadAndRender(restored);
      renderer.setViewMode('both');
      ui.setProjectSource(manifestLabel);
      ui.status(`Restored autosave for ${project.name}.`, 4500);
      finishProjectLoad();
      return;
    }
    await loadAndRender(project);
    ui.setProjectSource(manifestLabel);
    finishProjectLoad();
  }

  ui.setLoadHandlers({
    map: async (file) => {
      ui.status('Loading map image...');
      const dataUrl = await readFile(file, 'dataurl');
      const img = await loadImage(dataUrl);
      const gridFull = store.state.grid && store.state.grid.image_full;
      store.setProject({ mapImage: img, imageFull: gridFull || [img.naturalWidth, img.naturalHeight] });
      renderer.setBaseScale();
      renderer.fitView();
      ui.setProjectSource(file?.name || '');
      maybeFinishPartialLoad();
    },
    grid: async (file) => {
      const text = await readFile(file);
      const grid = JSON.parse(text);
      if (_awaitingBlankGrid) {
        _awaitingBlankGrid = false;
        await loadAndRender(makeBlankProject({ grid, blankLattice: true }));
        ui.setProjectSource(file?.name || '');
        ui.status('Blank project loaded — assign terrain on the grid.', 4000);
        finishProjectLoad();
        return;
      }
      store.setProject({ grid, imageFull: grid.image_full || store.state.imageFull });
      renderer.setBaseScale();
      renderer.fitView();
      ui.setProjectSource(file?.name || '');
      maybeFinishPartialLoad();
    },
    terrain: async (file) => {
      const text = await readFile(file);
      const terrain = JSON.parse(text);
      store.importTerrain(terrain);
      renderer.fitView();
      ui.setProjectSource(file?.name || '');
      maybeFinishPartialLoad();
    },
    sides: async (file) => {
      const text = await readFile(file);
      const hexsides = JSON.parse(text);
      store.importHexsides(hexsides);
      ui.setProjectSource(file?.name || '');
      maybeFinishPartialLoad();
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
    nodes: async (file) => {
      if (!file) return;
      try {
        const text = await readFile(file);
        const count = store.importNodes(text, { nodesFile: file.name });
        if (!store.state.mapImage) {
          const meta = store.state.nodesMeta || {};
          if (meta.imageFull) store.setProject({ imageFull: meta.imageFull });
        }
        renderer.setBaseScale();
        renderer.fitView();
        ui.onPtpProjectLoaded();
        ui.setProjectSource(file.name);
        ui.status(`Imported ${count} nodes`, 3000);
        maybeFinishPartialLoad();
      } catch (err) {
        ui.status(`Nodes import failed: ${err.message}`, 7000);
      }
    },
    importEdges: async (file) => {
      if (!file) return;
      try {
        const text = await readFile(file);
        const count = store.importPtpEdges(text);
        ui.status(`Imported ${count} edges`, 3000);
        ui._renderBrushCard();
        ui._renderLayersPanel();
      } catch (err) {
        ui.status(`Edges import failed: ${err.message}`, 7000);
      }
    },
    importNames: async (file) => {
      const text = await readFile(file);
      const count = store.importNames(text);
      ui.status(`Imported names.json (${count} hexes)`, 2000);
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

  // Start screen interactions
  document.getElementById('new-with-grid')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _awaitingBlankGrid = true;
    document.getElementById('load-grid')?.click();
  });

  document.getElementById('new-gridless')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await loadAndRender(makeBlankProject());
    ui.setProjectSource('');
    ui.status('No grid loaded — import a hexgrid.json via File ▾ to begin assigning', 0);
    finishProjectLoad();
  });

  document.getElementById('card-load')?.addEventListener('click', (e) => {
    if (e.target.closest('button, input')) return;
    if (loadChooser) loadChooser.hidden = !loadChooser.hidden;
    document.getElementById('card-load')?.classList.toggle('is-open', loadChooser && !loadChooser.hidden);
  });

  document.getElementById('manifest-load-btn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const url = document.getElementById('manifest-url')?.value?.trim();
    if (!url) return;
    ui.status(`Loading ${url}...`);
    try {
      await loadManifestWithRestore(url);
    } catch (err) {
      console.error(err);
      ui.status(`Project load failed: ${err.message}`, 7000);
    }
  });

  document.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-pick');
      document.getElementById(id)?.click();
    });
  });

  document.getElementById('coach-got-it')?.addEventListener('click', hideCoach);
  document.getElementById('coach-dismiss')?.addEventListener('click', dismissCoachForever);
  document.getElementById('coach-dismiss')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dismissCoachForever();
    }
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;

    let mapFile = null;
    let gridFile = null;
    let terrainFile = null;
    let sidesFile = null;
    let nodesFile = null;
    let manifestUrl = null;

    for (const file of files) {
      if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name) || file.type.startsWith('image/')) {
        mapFile = file;
        continue;
      }
      if (!/\.json$/i.test(file.name) && file.type !== 'application/json') continue;
      try {
        const text = await readFile(file);
        const obj = JSON.parse(text);
        const kind = sniffJsonKind(obj);
        if (kind === 'grid') gridFile = file;
        else if (kind === 'terrain') terrainFile = file;
        else if (kind === 'sides') sidesFile = file;
        else if (kind === 'nodes') nodesFile = file;
        else if (kind === 'edges') {
          if (!store.isPtp() && !nodesFile) continue;
          try { store.importPtpEdges(obj); } catch (_) { /* paired with nodes in same drop */ }
        }
        else if (kind === 'manifest' && obj.hexgrid) {
          manifestUrl = URL.createObjectURL(file);
        } else if (kind === 'manifest' && obj.map && obj.nodes) {
          manifestUrl = URL.createObjectURL(file);
        }
      } catch (_) { /* skip unreadable json */ }
    }

    if (manifestUrl && !mapFile && !gridFile && !terrainFile && !sidesFile && !nodesFile) {
      ui.status('Drop companion map/grid/terrain/sides files with a manifest, or paste its URL in Load a project.');
      URL.revokeObjectURL(manifestUrl);
      return;
    }

    if (mapFile || gridFile || terrainFile || sidesFile || nodesFile) {
      try {
        if (nodesFile) {
          const mapDataUrl = mapFile ? await readFile(mapFile, 'dataurl') : null;
          const mapImg = mapDataUrl ? await loadImage(mapDataUrl) : null;
          const nodesText = await readFile(nodesFile);
          const project = makeBlankProject({ mapFamily: 'ptp' });
          project.name = nodesFile.name.replace(/\.json$/i, '');
          project.mapImage = mapImg;
          project.imageFull = mapImg ? [mapImg.naturalWidth, mapImg.naturalHeight] : [800, 600];
          project.nodesFile = nodesFile.name;
          project._nodesDocument = JSON.parse(nodesText);
          await loadAndRender(project);
          ui.setProjectSource([mapFile, nodesFile].filter(Boolean).map((f) => f.name).join(' + '));
          finishProjectLoad();
          return;
        }
        const project = await loadUserFiles(mapFile, gridFile, terrainFile, sidesFile);
        await loadAndRender(project);
        ui.setProjectSource([mapFile, gridFile, terrainFile, sidesFile].filter(Boolean).map((f) => f.name).join(' + '));
        finishProjectLoad();
      } catch (err) {
        console.error(err);
        ui.status(`Drop load failed: ${err.message}`, 7000);
      }
      return;
    }

    ui.status('No recognizable map/grid/terrain/sides files in drop.', 4000);
  });

  const bootManifest = new URLSearchParams(window.location.search).get('project');
  if (bootManifest) {
    try {
      migrateLegacySessionOnce();
      ui.status(`Loading ${bootManifest}...`);
      await loadManifestWithRestore(bootManifest);
    } catch (err) {
      console.error(err);
      ui.status(`Project load failed: ${err.message} — use Load a project on the start screen.`, 7000);
      showStartScreen();
    }
  } else {
    migrateLegacySessionOnce();
    showStartScreen();
  }

  let _autosaveTimer = null;
  store.onChange(() => {
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(() => {
      try {
        // Content = terrain OR hexsides. Hexside-only projects (NaB) were
        // previously gated on land>0 and NEVER autosaved — edits silently
        // lived only in the tab (ate Ray's edge fixes, 2026-07-04).
        const land = Object.keys(store.state.terrain.terrain || {}).length;
        const sides = Object.keys(store.state.hexsides || {}).length;
        const ptpEdges = store.countPtpEdges();
        const feats = countPointFeatures(store.exportProjectObject());
        const named = Object.keys(store.state.names || {}).length;
        const groups = (store.state.groups || []).length;
        const nodes = Object.keys(store.state.nodes || {}).length;
        if (land > 0 || sides > 0 || feats > 0 || named > 0 || groups > 0 || ptpEdges > 0 || nodes > 0) {
          const project = store.exportProjectObject();
          localStorage.setItem(
            sessionKeyForName(project.name),
            encodeSessionRecord(project)
          );
          pruneSessionSlots();
          ui.markAutosaved();
        }
      } catch (_) { /* quota or serialization issue — skip this autosave */ }
    }, 800);
  });

  // Warn before closing if there are unsaved edits (a project with NO content
  // at all doesn't autosave, so the exported file is the only durable copy).
  window.addEventListener('beforeunload', (e) => {
    if (store.canUndo()) {
      e.preventDefault();
      e.returnValue = '';
      return '';
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
