import { EDITABLE_LAYERS, normalizePair, buildLandIndex, buildAdjacency } from './geometry.js';

const MAX_UNDO = 64;
const DEFAULT_PALETTE_URL = 'palettes/gota.json';

// Legacy v1 grouped layers (all possible) so migration/export preserve any shape.
const V1_EXPORT_LAYERS = ['rivers', 'streams', 'roads', 'rails', 'mountains', 'cliffs',
  'escarpments', 'walls', 'bridges', 'impassible'];

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function sortPairArrays(pairs) {
  pairs.sort((p1, p2) => (p1[0] < p2[0] ? -1 : p1[0] > p2[0] ? 1 : p1[1] < p2[1] ? -1 : p1[1] > p2[1] ? 1 : 0));
  return pairs;
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function parseTwuPairArrayEntry(entry, label, index) {
  if (!Array.isArray(entry) || entry.length !== 2) {
    throw new Error(`${label} index ${index} must be a 2-element [a,b] array.`);
  }
  const a = String(entry[0] || '').trim();
  const b = String(entry[1] || '').trim();
  if (!a || !b || a === b) {
    throw new Error(`${label} index ${index} must provide two distinct hex codes.`);
  }
  return normalizePair(a, b);
}

function parseTwuPairFlexibleEntry(entry, label, index) {
  if (Array.isArray(entry)) return parseTwuPairArrayEntry(entry, label, index);
  if (!entry || typeof entry !== 'object') {
    throw new Error(`${label} index ${index} must be [a,b] or {a,b}.`);
  }
  const a = String(entry.a || '').trim();
  const b = String(entry.b || '').trim();
  if (!a || !b || a === b) {
    throw new Error(`${label} index ${index} must provide two distinct hex codes.`);
  }
  return normalizePair(a, b);
}

function isV1Project(project) {
  // v1 has no schemaVersion; v2 stores a top-level schemaVersion.
  return project && !project.schemaVersion;
}

function normalizeTerrainKey(value, aliases) {
  if (!value || typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (aliases && aliases[key]) return aliases[key];
  return key;
}

function normalizeHexsideKey(value, aliases) {
  if (!value || typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (aliases && aliases[key]) return aliases[key];
  return key;
}

function emptyHexsidesState() {
  return {};
}

export class ProjectStore {
  constructor() {
    this.state = this.makeEmpty();
    this.undoStack = [];
    this.redoStack = [];
    this.strokeActive = false;
    this.strokeChanged = false;
    this.strokeSnap = null;
    this.centers = null;
    this.adj = null;
    this.edgeIndex = null; // edgeKey -> featureKey[]
    this.listeners = [];
    this.palette = null;
    this.palettePromise = null;
  }

  makeEmpty() {
    return {
      name: '',
      mapImage: null,
      imageFull: [0, 0],
      grid: null,
      terrain: { terrain: {} },
      hexFeatures: {},
      hexsides: emptyHexsidesState(),
      provenance: {},
      traces: [],
      loadedHexsides: null,
      mapOffset: [0, 0],
      schemaVersion: 2
    };
  }

  onChange(cb) { this.listeners.push(cb); }
  offChange(cb) { this.listeners = this.listeners.filter(fn => fn !== cb); }
  notify(reason) {
    for (const cb of this.listeners) cb(reason);
  }

  getPalette() { return this.palette; }

  async loadPalette(urlOrObject) {
    if (urlOrObject && typeof urlOrObject === 'object' && !urlOrObject.then) {
      return this.setPalette(urlOrObject);
    }
    const url = urlOrObject || DEFAULT_PALETTE_URL;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load palette: ${url}`);
    return this.setPalette(await res.json());
  }

  setPalette(configObject) {
    this.palette = deepClone(configObject);
    this.notify('palette');
    return this.palette;
  }

  ensurePalette() {
    if (this.palette) return Promise.resolve(this.palette);
    if (this.palettePromise) return this.palettePromise;
    this.palettePromise = this.loadPalette(DEFAULT_PALETTE_URL)
      .catch(err => {
        console.error('Default palette failed:', err);
        return null;
      });
    return this.palettePromise;
  }

  // ----------------- project loading / migration -----------------

  async loadProject(project) {
    if (project && project.palette && typeof project.palette === 'object') {
      await this.loadPalette(project.palette);
    } else {
      await this.ensurePalette();
    }
    this.undoStack = [];
    this.redoStack = [];
    this.strokeActive = false;
    this.strokeChanged = false;
    this.strokeSnap = null;

    const palette = this.palette || {};
    const terrAliases = palette.terrainAliases || {};
    const sideAliases = palette.hexsideAliases || {};

    const migrated = this.migrateToV2(project, terrAliases, sideAliases);

    this.state = {
      name: project.name || '',
      mapImage: project.mapImage || null,
      imageFull: project.imageFull || [0, 0],
      grid: project.grid || null,
      terrain: { terrain: deepClone(migrated.terrain || {}) },
      hexFeatures: deepClone(migrated.hexFeatures || {}),
      hexsides: deepClone(migrated.hexsides || emptyHexsidesState()),
      provenance: deepClone(migrated.provenance || {}),
      traces: project.traces || [],
      loadedHexsides: project.hexsides ? deepClone(project.hexsides) : null,
      mapOffset: Array.isArray(project.mapOffset)
        ? [Number(project.mapOffset[0]) || 0, Number(project.mapOffset[1]) || 0]
        : [0, 0],
      schemaVersion: 2
    };

    this.rebuildIndex();
    this.notify('project');
  }

  migrateToV2(project, terrAliases, sideAliases) {
    if (!project) return {};
    const terrain = {};
    const hexFeatures = {};
    const hexsides = {};
    const provenance = {};

    const sourceTerrain = project.terrain && project.terrain.terrain
      ? project.terrain.terrain
      : (project.terrain || {});
    for (const code of Object.keys(sourceTerrain)) {
      const key = normalizeTerrainKey(sourceTerrain[code], terrAliases);
      if (key) terrain[code] = key;
    }

    if (isV1Project(project)) {
      // v1 hexsides are grouped export-layer lists; migrate into per-edge arrays.
      for (const layer of V1_EXPORT_LAYERS) {
        const list = project.hexsides && project.hexsides[layer];
        if (!Array.isArray(list)) continue;
        for (const pair of list) {
          const a = pair.a, b = pair.b;
          if (!a || !b) continue;
          const key = pairKey(a, b);
          const featureKey = this._toFeatureKey(layer);
          if (!featureKey) continue;
          const arr = hexsides[key] || (hexsides[key] = []);
          if (!arr.includes(featureKey)) arr.push(featureKey);
        }
      }
    } else {
      // Already v2: copy per-edge arrays, aliasing feature keys.
      const sourceHexsides = project.hexsides || {};
      for (const key of Object.keys(sourceHexsides)) {
        const arr = sourceHexsides[key];
        if (!Array.isArray(arr)) continue;
        const normalized = [];
        for (const f of arr) {
          const k = this._toFeatureKey(f);
          if (k && !normalized.includes(k)) normalized.push(k);
        }
        if (normalized.length) hexsides[key] = normalized;
      }
      const sourceFeatures = project.hexFeatures || {};
      for (const code of Object.keys(sourceFeatures)) {
        const arr = sourceFeatures[code];
        if (Array.isArray(arr)) hexFeatures[code] = deepClone(arr);
      }
      const sourceProv = project.provenance || {};
      for (const code of Object.keys(sourceProv)) {
        if (sourceProv[code] === 'draft' || sourceProv[code] === 'confirmed') {
          provenance[code] = sourceProv[code];
        }
      }
    }

    return { terrain, hexFeatures, hexsides, provenance };
  }

  setProject(patch) {
    this.pushUndo();
    Object.assign(this.state, patch);
    this.rebuildIndex();
    this.notify('project');
  }

  rebuildIndex() {
    if (!this.state.grid) {
      this.centers = null;
      this.adj = null;
      this.edgeIndex = null;
      return;
    }
    this.centers = buildLandIndex(this.state.terrain, this.state.grid);
    this.adj = buildAdjacency(this.centers);
    this.edgeIndex = this.buildEdgeIndex(this.state.hexsides);
  }

  buildEdgeIndex(hexsides) {
    const idx = new Map();
    for (const [key, arr] of Object.entries(hexsides || {})) {
      if (arr && arr.length) idx.set(key, [...arr]);
    }
    return idx;
  }

  // ----------------- undo / redo -----------------

  pushUndo() {
    const snap = {
      terrain: deepClone(this.state.terrain),
      hexFeatures: deepClone(this.state.hexFeatures),
      hexsides: deepClone(this.state.hexsides),
      provenance: deepClone(this.state.provenance)
    };
    if (this.strokeActive) {
      if (!this.strokeSnap) this.strokeSnap = snap;
      this.strokeChanged = true;
      return;
    }
    this.undoStack.push(snap);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  beginStroke() {
    if (this.strokeActive) return;
    this.strokeActive = true;
    this.strokeChanged = false;
    this.strokeSnap = null;
  }

  endStroke() {
    if (!this.strokeActive) return false;
    this.strokeActive = false;
    if (this.strokeChanged && this.strokeSnap) {
      this.undoStack.push(this.strokeSnap);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.redoStack = [];
    }
    this.strokeChanged = false;
    this.strokeSnap = null;
    return true;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    if (!this.canUndo()) return false;
    const snap = this.undoStack.pop();
    this.redoStack.push({
      terrain: deepClone(this.state.terrain),
      hexFeatures: deepClone(this.state.hexFeatures),
      hexsides: deepClone(this.state.hexsides),
      provenance: deepClone(this.state.provenance)
    });
    this.applySnap(snap);
    this.rebuildIndex();
    this.notify('undo');
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    const snap = this.redoStack.pop();
    this.undoStack.push({
      terrain: deepClone(this.state.terrain),
      hexFeatures: deepClone(this.state.hexFeatures),
      hexsides: deepClone(this.state.hexsides),
      provenance: deepClone(this.state.provenance)
    });
    this.applySnap(snap);
    this.rebuildIndex();
    this.notify('redo');
    return true;
  }

  applySnap(snap) {
    this.state.terrain = snap.terrain;
    this.state.hexFeatures = snap.hexFeatures;
    this.state.hexsides = snap.hexsides;
    this.state.provenance = snap.provenance;
  }

  // ----------------- terrain -----------------

  setTerrain(code, key) {
    const current = this.state.terrain.terrain[code];
    if (current === key) return;
    this.pushUndo();
    this.state.terrain.terrain[code] = key;
    this.state.provenance[code] = 'confirmed';
    this.centers = buildLandIndex(this.state.terrain, this.state.grid);
    this.adj = buildAdjacency(this.centers);
    this.notify('terrain');
  }

  // Legacy alias kept for ui.js/renderer.js until multi-select lands.
  setTerrainType(code, type) {
    this.setTerrain(code, type);
  }

  importTerrain(input, opts = {}) {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    const palette = this.palette || {};
    const aliases = palette.terrainAliases || {};
    const source = data.terrain || data;
    if (!source || typeof source !== 'object') return;

    this.pushUndo();
    let count = 0;
    for (const code of Object.keys(source)) {
      const key = normalizeTerrainKey(source[code], aliases);
      if (!key) continue;
      this.state.terrain.terrain[code] = key;
      if (opts.provenance === 'draft') this.state.provenance[code] = 'draft';
      count++;
    }
    this.centers = buildLandIndex(this.state.terrain, this.state.grid);
    this.adj = buildAdjacency(this.centers);
    this.notify('terrain');
    return count;
  }

  // ----------------- hex features -----------------

  getHexFeatures(code) {
    return this.state.hexFeatures[code] ? [...this.state.hexFeatures[code]] : [];
  }

  setHexFeatures(code, keysArray) {
    const next = Array.isArray(keysArray) ? keysArray.slice() : [];
    const current = this.state.hexFeatures[code] || [];
    if (current.length === next.length && next.every((k, i) => current[i] === k)) return;
    this.pushUndo();
    if (next.length) this.state.hexFeatures[code] = next;
    else delete this.state.hexFeatures[code];
    this.notify('hexFeatures');
  }

  toggleHexFeature(code, key) {
    const arr = this.getHexFeatures(code);
    const i = arr.indexOf(key);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(key);
    this.setHexFeatures(code, arr);
  }

  // ----------------- hexsides (per-edge arrays) -----------------

  _toCanonicalHexside(value) {
    return this._toFeatureKey(value);
  }

  _toFeatureKey(value) {
    if (!value || typeof value !== 'string') return '';
    const palette = this.palette || {};
    const aliases = palette.hexsideAliases || {};
    const lower = value.trim().toLowerCase();
    if (aliases[lower]) return aliases[lower];
    for (const f of palette.hexsideFeatures || []) {
      if (f.key === lower) return f.key;
      if (f.exportLayer && f.exportLayer.toLowerCase() === lower) return f.key;
    }
    return lower;
  }

  _toExportLayer(featureKey) {
    if (!featureKey) return '';
    const palette = this.palette || {};
    for (const f of palette.hexsideFeatures || []) {
      if (f.key === featureKey) return f.exportLayer || f.key;
    }
    return featureKey;
  }

  edgeFeatures(a, b) {
    const key = pairKey(a, b);
    return this.edgeIndex.get(key) || [];
  }

  getEdgeLayer(code, neighbor) {
    // Backward-compatible single-layer read for the current UI.
    const features = this.edgeFeatures(code, neighbor);
    return features.length ? this._toExportLayer(features[0]) : null;
  }

  setEdgeLayer(code, edgeIndex, layer, neighbor) {
    // Backward-compatible single-layer write for the current UI.
    const pair = normalizePair(code, neighbor);
    const key = pairKey(pair.a, pair.b);
    const canonical = layer ? this._toCanonicalHexside(layer) : '';
    const current = this.edgeFeatures(pair.a, pair.b);
    if (current.length === 1 && current[0] === canonical) return;
    this.pushUndo();
    if (canonical) this.state.hexsides[key] = [canonical];
    else delete this.state.hexsides[key];
    this.rebuildIndex();
    this.notify('hexsides');
  }

  toggleHexsideFeature(a, b, featureKey) {
    const pair = normalizePair(a, b);
    const key = pairKey(pair.a, pair.b);
    const current = this.edgeFeatures(pair.a, pair.b);
    const arr = current.slice();
    const i = arr.indexOf(featureKey);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(featureKey);
    const unchanged = arr.length === current.length &&
      arr.every((k, idx) => current[idx] === k);
    if (unchanged) return;
    this.pushUndo();
    if (arr.length === 0) delete this.state.hexsides[key];
    else this.state.hexsides[key] = arr;
    this.rebuildIndex();
    this.notify('hexsides');
  }

  setHexsideFeature(a, b, featureKey, on = true) {
    const pair = normalizePair(a, b);
    const key = pairKey(pair.a, pair.b);
    const current = this.edgeFeatures(pair.a, pair.b);
    const has = current.includes(featureKey);
    if ((on && has) || (!on && !has)) return false;
    const arr = on
      ? [...current, featureKey]
      : current.filter(k => k !== featureKey);
    this.pushUndo();
    if (arr.length === 0) delete this.state.hexsides[key];
    else this.state.hexsides[key] = arr;
    this.rebuildIndex();
    this.notify('hexsides');
    return true;
  }

  _importHexsidePairs(featureKey, pairs, opts = {}) {
    const canonicalFeature = this._toFeatureKey(featureKey);
    if (!canonicalFeature) throw new Error(`Unknown hexside feature: ${featureKey}`);
    let changed = false;
    const touched = new Set();
    const landTouched = new Set();
    const terrain = this.state.terrain?.terrain || {};
    const markDraft = opts.provenance === 'draft';

    const ensureUndo = () => {
      if (!changed) {
        this.pushUndo();
        changed = true;
      }
    };

    for (const pair of pairs) {
      const normalized = normalizePair(String(pair.a || '').trim(), String(pair.b || '').trim());
      if (!normalized.a || !normalized.b || normalized.a === normalized.b) continue;
      touched.add(normalized.a);
      touched.add(normalized.b);
      if (Object.prototype.hasOwnProperty.call(terrain, normalized.a)) landTouched.add(normalized.a);
      if (Object.prototype.hasOwnProperty.call(terrain, normalized.b)) landTouched.add(normalized.b);
      const key = pairKey(normalized.a, normalized.b);
      const current = this.state.hexsides[key] || [];
      if (current.includes(canonicalFeature)) continue;
      ensureUndo();
      this.state.hexsides[key] = [...current, canonicalFeature];
    }

    if (markDraft) {
      for (const code of touched) {
        if (!Object.prototype.hasOwnProperty.call(terrain, code)) continue;
        if (this.state.provenance[code] === 'draft') continue;
        ensureUndo();
        this.state.provenance[code] = 'draft';
      }
    }

    if (changed) {
      this.rebuildIndex();
      this.notify('hexsides');
    }
    return markDraft ? landTouched.size : touched.size;
  }

  importTwuRivers(input, opts = {}) {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    const raw = data?.hexsides;
    if (!Array.isArray(raw)) {
      throw new Error('Expected rivers payload shape: {"hexsides":[["a","b"], ...]}.');
    }
    const pairs = raw.map((entry, idx) => parseTwuPairArrayEntry(entry, 'hexsides', idx));
    return this._importHexsidePairs('river', pairs, { provenance: opts.provenance || 'draft' });
  }

  importTwuRail(input, opts = {}) {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    const raw = data?.links;
    if (!Array.isArray(raw)) {
      throw new Error('Expected rail payload shape: {"links":[["a","b"], ...]} (also accepts {a,b} entries).');
    }
    const pairs = raw.map((entry, idx) => parseTwuPairFlexibleEntry(entry, 'links', idx));
    return this._importHexsidePairs('rail', pairs, { provenance: opts.provenance || 'draft' });
  }

  importHexsides(input) {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    this.pushUndo();

    // Merge grouped v1 layers into per-edge arrays.
    for (const layer of V1_EXPORT_LAYERS) {
      const list = data[layer];
      if (!Array.isArray(list)) continue;
      for (const pair of list) {
        const a = pair.a, b = pair.b;
        if (!a || !b) continue;
        const key = pairKey(a, b);
        const featureKey = this._toFeatureKey(layer);
        if (!featureKey) continue;
        const arr = this.state.hexsides[key] || (this.state.hexsides[key] = []);
        if (!arr.includes(featureKey)) arr.push(featureKey);
      }
    }

    // Preserve untouched non-editable keys verbatim.
    const mergedExtras = deepClone(this.state.loadedHexsides || {});
    for (const key of Object.keys(data)) {
      if (!V1_EXPORT_LAYERS.includes(key)) mergedExtras[key] = deepClone(data[key]);
    }
    this.state.loadedHexsides = mergedExtras;

    this.rebuildIndex();
    this.notify('import');
  }

  // ----------------- export -----------------

  exportHexsidesObject() {
    // Preserve any untouched keys (version, counts, theaters, boundaries),
    // but drop internal edge keys since we regenerate grouped layers.
    const base = {};
    for (const [k, v] of Object.entries(this.state.loadedHexsides || {})) {
      if (!k.includes('|')) base[k] = deepClone(v);
    }

    // Clear all editable export layers we will regenerate.
    for (const layer of V1_EXPORT_LAYERS) {
      base[layer] = [];
    }

    const palette = this.palette || {};
    const features = palette.hexsideFeatures || [];
    const exportLayerFor = new Map();
    for (const f of features) {
      if (f.exportLayer) exportLayerFor.set(f.key, f.exportLayer);
    }

    for (const [edgeKey, arr] of Object.entries(this.state.hexsides || {})) {
      const [a, b] = edgeKey.split('|');
      if (!a || !b) continue;
      const seen = new Set();
      for (const featureKey of (arr || [])) {
        const layer = exportLayerFor.get(featureKey);
        if (!layer || seen.has(layer)) continue;
        seen.add(layer);
        if (!base[layer]) base[layer] = [];
        base[layer].push({ a, b });
      }
    }

    // Sort each layer for deterministic output.
    for (const layer of V1_EXPORT_LAYERS) {
      if (Array.isArray(base[layer])) {
        base[layer].sort((p1, p2) =>
          (p1.a < p2.a ? -1 : p1.a > p2.a ? 1 : p1.b < p2.b ? -1 : 1)
        );
      }
    }

    return base;
  }

  exportHexsidesJson() {
    return JSON.stringify(this.exportHexsidesObject(), null, 2);
  }

  _exportPairsForFeature(featureKey) {
    const canonical = this._toFeatureKey(featureKey);
    const pairs = [];
    for (const [edgeKey, features] of Object.entries(this.state.hexsides || {})) {
      if (!Array.isArray(features) || !features.includes(canonical)) continue;
      const [a, b] = edgeKey.split('|');
      if (!a || !b) continue;
      pairs.push([a, b]);
    }
    return sortPairArrays(pairs);
  }

  exportTwuRiversObject() {
    return {
      _comment: `edited in Hexwright v2.1 ${todayStamp()}`,
      hexsides: this._exportPairsForFeature('river')
    };
  }

  exportTwuRailObject() {
    const links = this._exportPairsForFeature('rail');
    const endpoints = new Set();
    for (const [a, b] of links) {
      endpoints.add(a);
      endpoints.add(b);
    }
    return {
      _comment: `edited in Hexwright v2.1 ${todayStamp()}`,
      links,
      hexes: [...endpoints].sort()
    };
  }

  exportTwuRiversJson() {
    return JSON.stringify(this.exportTwuRiversObject(), null, 2);
  }

  exportTwuRailJson() {
    return JSON.stringify(this.exportTwuRailObject(), null, 2);
  }

  exportTerrainObject() {
    return { terrain: deepClone(this.state.terrain.terrain || {}) };
  }

  exportTerrainJson() {
    return JSON.stringify(this.exportTerrainObject(), null, 2);
  }

  exportProjectObject() {
    return {
      schemaVersion: 2,
      name: this.state.name,
      mapImage: null, // not serializable
      imageFull: deepClone(this.state.imageFull),
      grid: deepClone(this.state.grid),
      terrain: this.exportTerrainObject(),
      hexFeatures: deepClone(this.state.hexFeatures),
      hexsides: deepClone(this.state.hexsides),
      provenance: deepClone(this.state.provenance),
      mapOffset: deepClone(this.state.mapOffset || [0, 0]),
      palette: this.palette?.name || 'gota'
    };
  }

  // ----------------- read helpers -----------------

  getCounts() {
    const land = Object.keys(this.state.terrain.terrain || {}).length;
    const layers = {};
    for (const layer of EDITABLE_LAYERS) layers[layer] = 0;
    const obj = this.exportHexsidesObject();
    for (const layer of EDITABLE_LAYERS) {
      layers[layer] = (obj[layer] || []).length;
    }
    return { land, layers };
  }

  // ----------------- trace controls -----------------

  // ----------------- map nudge (scan alignment) -----------------
  // World-pixel offset applied to the base map + traces at draw time so the
  // printed grid can be aligned to the calibrated digital grid by eye. The
  // grid/hex data stays canonical; only the imagery shifts. Persisted with
  // the project (autosave + export).

  setMapOffset(x, y) {
    const off = this.state.mapOffset || [0, 0];
    if (off[0] === x && off[1] === y) return;
    this.state.mapOffset = [x, y];
    this.notify('mapOffset');
  }

  nudgeMapOffset(dx, dy) {
    const off = this.state.mapOffset || [0, 0];
    this.setMapOffset(off[0] + dx, off[1] + dy);
  }

  setTraceOpacity(index, opacity) {
    const t = this.state.traces[index];
    if (!t || t.opacity === opacity) return;
    t.opacity = opacity;
    this.notify('trace');
  }

  setTraceOn(index, on) {
    const t = this.state.traces[index];
    if (!t || t.on === on) return;
    t.on = on;
    this.notify('trace');
  }
}
