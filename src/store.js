import { EDITABLE_LAYERS, normalizePair, buildLandIndex, buildAdjacency } from './geometry.js';

const MAX_UNDO = 64;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function emptyHexsides() {
  const out = {};
  for (const layer of EDITABLE_LAYERS) out[layer] = [];
  return out;
}

function buildEdgeIndex(hexsides, centers, grid) {
  const idx = new Map();
  for (const layer of EDITABLE_LAYERS) {
    const list = hexsides[layer] || [];
    for (const pair of list) {
      const { a, b } = pair;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      idx.set(key, layer);
    }
  }
  return idx;
}

export class ProjectStore {
  constructor() {
    this.state = this.makeEmpty();
    this.undoStack = [];
    this.redoStack = [];
    this.centers = null;
    this.adj = null;
    this.edgeIndex = null;
    this.listeners = [];
  }

  makeEmpty() {
    return {
      name: '',
      mapImage: null,       // HTMLImageElement (downscaled display map)
      imageFull: [0, 0],
      grid: null,
      terrain: { terrain: {} },
      hexsides: emptyHexsides(),
      traces: [],           // { name, img: HTMLImageElement, layer, on, opacity }
      loadedHexsides: null  // original imported file for preserving extra layers
    };
  }

  onChange(cb) { this.listeners.push(cb); }
  offChange(cb) { this.listeners = this.listeners.filter(fn => fn !== cb); }
  notify(reason) {
    for (const cb of this.listeners) cb(reason);
  }

  setProject(patch) {
    this.pushUndo();
    Object.assign(this.state, patch);
    this.rebuildIndex();
    this.notify('project');
  }

  loadProject({ name, mapImage, imageFull, grid, terrain, hexsides, traces }) {
    this.undoStack = [];
    this.redoStack = [];
    this.state = {
      name: name || '',
      mapImage,
      imageFull: imageFull || [0, 0],
      grid,
      terrain: terrain || { terrain: {} },
      hexsides: deepClone(hexsides || emptyHexsides()),
      traces: traces || [],
      loadedHexsides: hexsides ? deepClone(hexsides) : null
    };
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
    this.edgeIndex = buildEdgeIndex(this.state.hexsides, this.centers, this.state.grid);
  }

  pushUndo() {
    const snap = {
      terrain: deepClone(this.state.terrain),
      hexsides: deepClone(this.state.hexsides)
    };
    this.undoStack.push(snap);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo() { return this.undoStack.length > 0; }

  undo() {
    if (!this.canUndo()) return false;
    const snap = this.undoStack.pop();
    this.redoStack.push({
      terrain: deepClone(this.state.terrain),
      hexsides: deepClone(this.state.hexsides)
    });
    this.state.terrain = snap.terrain;
    this.state.hexsides = snap.hexsides;
    this.rebuildIndex();
    this.notify('undo');
    return true;
  }

  setTerrainType(code, type) {
    if (!this.state.terrain.terrain || this.state.terrain.terrain[code] === type) return;
    this.pushUndo();
    this.state.terrain.terrain[code] = type;
    this.notify('terrain');
  }

  setEdgeLayer(code, edgeIndex, layer, neighbor) {
    const pair = normalizePair(code, neighbor);
    const key = `${pair.a}|${pair.b}`;
    const current = this.edgeIndex.get(key) || null;
    if (current === layer) return; // '' means none
    this.pushUndo();

    // remove from any editable layer
    for (const l of EDITABLE_LAYERS) {
      const list = this.state.hexsides[l] || (this.state.hexsides[l] = []);
      this.state.hexsides[l] = list.filter(p => !(p.a === pair.a && p.b === pair.b));
    }
    // add if assigned
    if (layer && EDITABLE_LAYERS.includes(layer)) {
      this.state.hexsides[layer].push(pair);
      this.state.hexsides[layer].sort((p1, p2) =>
        (p1.a < p2.a ? -1 : p1.a > p2.a ? 1 : p1.b < p2.b ? -1 : 1)
      );
    }
    this.rebuildIndex();
    this.notify('hexsides');
  }

  getEdgeLayer(code, neighbor) {
    const pair = normalizePair(code, neighbor);
    return this.edgeIndex.get(`${pair.a}|${pair.b}`) || null;
  }

  importHexsides(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    this.pushUndo();
    // merge: replace editable layers, preserve other keys/layers
    const merged = deepClone(this.state.loadedHexsides || {});
    for (const layer of EDITABLE_LAYERS) {
      if (Array.isArray(data[layer])) merged[layer] = deepClone(data[layer]);
      else if (!merged[layer]) merged[layer] = [];
    }
    // ensure all loaded extras are kept
    for (const key of Object.keys(data)) {
      if (!EDITABLE_LAYERS.includes(key)) merged[key] = deepClone(data[key]);
    }
    this.state.hexsides = merged;
    this.state.loadedHexsides = deepClone(merged);
    this.rebuildIndex();
    this.notify('import');
  }

  importTerrain(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    this.pushUndo();
    const terr = data.terrain || data;
    this.state.terrain = { terrain: deepClone(terr) };
    this.rebuildIndex();
    this.notify('terrain');
  }

  exportHexsidesObject() {
    // preserve original loaded structure, replacing editable layers
    const base = deepClone(this.state.loadedHexsides || {});
    for (const layer of EDITABLE_LAYERS) {
      base[layer] = deepClone(this.state.hexsides[layer] || []);
    }
    return base;
  }

  exportHexsidesJson() {
    return JSON.stringify(this.exportHexsidesObject(), null, 2);
  }

  exportTerrainObject() {
    return { terrain: deepClone(this.state.terrain.terrain || {}) };
  }

  exportTerrainJson() {
    return JSON.stringify(this.exportTerrainObject(), null, 2);
  }

  getCounts() {
    const land = Object.keys(this.state.terrain.terrain || {}).length;
    const layers = {};
    for (const layer of EDITABLE_LAYERS) {
      layers[layer] = (this.state.hexsides[layer] || []).length;
    }
    return { land, layers };
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
