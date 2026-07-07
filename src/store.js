import { EDITABLE_LAYERS, normalizePair, buildLandIndex, buildAdjacency, enumerateGridLattice, validateGrid, parseCCRR, isValidCell, hexCenter } from './geometry.js';
import {
  validateNodesDocument, nodesDocumentToMap, validateEdgesDocument, edgesArrayToMap,
  edgesMapToArray, nodePairKey, ptpEdgeKey, normalizeNodePair, normalizePtpEdgeMap,
  countEdgesByType, findOrphanNodeIds, findMissingNodeRefs, ptpEdgesOnPair
} from './ptp.js';

const MAX_UNDO = 64;
const DEFAULT_PALETTE_URL = 'palettes/default.json';

// Legacy v1 grouped layers (all possible) so migration/export preserve any shape.
const V1_EXPORT_LAYERS = ['rivers', 'streams', 'roads', 'rails', 'mountains', 'cliffs',
  'escarpments', 'walls', 'bridges', 'impassible', 'border'];

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

export function validateNamesDocument(data, label = 'names') {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Expected ${label} shape: {"names":{"code":"Name",...}}.`);
  }
  if (!data.names || typeof data.names !== 'object' || Array.isArray(data.names)) {
    throw new Error(`Expected ${label}.names to be an object.`);
  }
  for (const [code, name] of Object.entries(data.names)) {
    if (typeof name !== 'string') {
      throw new Error(`${label}.names[${JSON.stringify(code)}] must be a string.`);
    }
  }
  return data;
}

function namesDocumentToState(data) {
  const state = {};
  for (const [code, name] of Object.entries(data.names || {})) {
    const trimmed = String(name).trim();
    if (trimmed) state[String(code).trim()] = trimmed;
  }
  return state;
}

export function validateFeaturesDocument(data, label = 'features') {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Expected ${label} shape: {"features":[{"code","type","name?","attrs"},...]}.`);
  }
  if (!Array.isArray(data.features)) {
    throw new Error(`Expected ${label}.features to be an array.`);
  }
  data.features.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${label}.features[${idx}] must be an object.`);
    }
    if (typeof entry.code !== 'string' || !String(entry.code).trim()) {
      throw new Error(`${label}.features[${idx}].code must be a non-empty string.`);
    }
    if (typeof entry.type !== 'string' || !String(entry.type).trim()) {
      throw new Error(`${label}.features[${idx}].type must be a non-empty string.`);
    }
    if (entry.name !== undefined && typeof entry.name !== 'string') {
      throw new Error(`${label}.features[${idx}].name must be a string when present.`);
    }
    if (entry.attrs !== undefined && (typeof entry.attrs !== 'object' || Array.isArray(entry.attrs) || entry.attrs === null)) {
      throw new Error(`${label}.features[${idx}].attrs must be an object when present.`);
    }
  });
  return data;
}

function featuresArrayToState(features) {
  const state = {};
  for (const entry of features) {
    const code = String(entry.code).trim();
    const type = String(entry.type).trim();
    if (!code || !type) continue;
    if (!state[code]) state[code] = {};
    state[code][type] = {
      name: entry.name != null ? String(entry.name) : '',
      attrs: deepClone(entry.attrs || {})
    };
  }
  return state;
}

function exportFeaturesArrayFromState(featuresState) {
  const out = [];
  const codes = Object.keys(featuresState || {}).sort((a, b) => a.localeCompare(b));
  for (const code of codes) {
    const byType = featuresState[code];
    if (!byType || typeof byType !== 'object') continue;
    for (const type of Object.keys(byType).sort((a, b) => a.localeCompare(b))) {
      const rec = byType[type];
      if (!rec) continue;
      const item = { code, type, attrs: deepClone(rec.attrs || {}) };
      if (rec.name) item.name = rec.name;
      out.push(item);
    }
  }
  return out;
}

function defaultAttrsFromSchema(attrSchema) {
  const attrs = {};
  for (const a of attrSchema || []) {
    if (!a || !a.key) continue;
    attrs[a.key] = a.type === 'number' ? 0 : '';
  }
  return attrs;
}

// Fallback point-feature TYPE declarations synthesized from the point-feature
// DATA already loaded into state. Used when a project's palette declares no
// `hexFeatures` (so the features picker + inspector never render a dead panel).
// Attr schema is inferred from the attrs present on the loaded instances; a
// numeric-looking value implies `type:number`, else text.
export function syntheticHexFeaturesFromFeatures(featuresState) {
  const byType = new Map();
  for (const bucket of Object.values(featuresState || {})) {
    if (!bucket || typeof bucket !== 'object') continue;
    for (const [type, rec] of Object.entries(bucket)) {
      if (!type) continue;
      let entry = byType.get(type);
      if (!entry) { entry = { key: type, attrs: new Map() }; byType.set(type, entry); }
      const attrs = (rec && rec.attrs) || {};
      for (const [k, v] of Object.entries(attrs)) {
        const isNum = typeof v === 'number' || (v !== '' && v != null && Number.isFinite(Number(v)));
        // once seen as text, stays text
        if (!entry.attrs.has(k) || (entry.attrs.get(k) === 'number' && !isNum)) {
          entry.attrs.set(k, isNum ? 'number' : 'text');
        }
      }
    }
  }
  return [...byType.values()].map((e) => ({
    key: e.key,
    label: e.key,
    attrs: [...e.attrs.entries()].map(([k, t]) => ({ key: k, label: k, type: t }))
  }));
}

export function validateNodeAttrsDocument(data, label = 'node-attrs') {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Expected ${label} shape: {"meta":{...},"spaces":{<nodeId>:{<featureKey>:value}}}.`);
  }
  if (!data.spaces || typeof data.spaces !== 'object' || Array.isArray(data.spaces)) {
    throw new Error(`Expected ${label}.spaces to be an object.`);
  }
  for (const [nodeId, attrs] of Object.entries(data.spaces)) {
    if (attrs !== null && (typeof attrs !== 'object' || Array.isArray(attrs))) {
      throw new Error(`${label}.spaces[${JSON.stringify(nodeId)}] must be an object.`);
    }
  }
  return data;
}

// Converts a commission-repo "space-attrs-draft.json" (arbitrary per-game field
// names, one row per node id) into the native node-attrs `spaces` shape, given an
// explicit fieldMap: { draftKey: { feature: paletteFeatureKey, kind: 'flag'|'level'|'enum' } }.
// - flag: any non-null/true-ish value (typically `true`) sets the palette flag to true.
// - level: coerced to a finite Number.
// - enum: coerced to a trimmed string; skipped + reported if not in the palette
//   feature's declared `values` (never silently written as an invalid enum value).
// Draft fields absent from fieldMap (e.g. free-text `notes`) are ignored — the
// mapping is deliberately explicit and per-game, not auto-sniffed.
export function draftSpacesToNodeAttrs(draftSpaces, fieldMap, paletteNodeFeatures = []) {
  const featuresByKey = new Map((paletteNodeFeatures || []).map((f) => [f.key, f]));
  const spaces = {};
  const skipped = [];
  for (const [nodeId, draftAttrs] of Object.entries(draftSpaces || {})) {
    if (!draftAttrs || typeof draftAttrs !== 'object') continue;
    const bucket = {};
    for (const [draftKey, mapping] of Object.entries(fieldMap || {})) {
      if (!mapping || !(draftKey in draftAttrs)) continue;
      const raw = draftAttrs[draftKey];
      if (raw === null || raw === undefined || raw === '') continue;
      const featureKey = mapping.feature;
      let value;
      if (mapping.kind === 'flag') {
        // Any surviving non-null/''/false value counts as tagged — draft flag
        // fields are sometimes `true`, sometimes a non-boolean marker (e.g. PoG's
        // `capital` holds a country code string) that still means "flag is set".
        // Explicit `false` is the one value that means "not tagged".
        if (raw !== false) value = true;
      } else if (mapping.kind === 'level') {
        const n = Number(raw);
        if (Number.isFinite(n)) value = n;
      } else if (mapping.kind === 'enum') {
        const v = String(raw).trim();
        const decl = featuresByKey.get(featureKey);
        if (decl?.values && !decl.values.includes(v)) {
          skipped.push({ nodeId, draftKey, value: v, reason: `"${v}" not in ${featureKey} palette values` });
        } else if (v) {
          value = v;
        }
      }
      if (value !== undefined) bucket[featureKey] = value;
    }
    if (Object.keys(bucket).length) spaces[nodeId] = bucket;
  }
  return { spaces, skipped };
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

function readPaletteMigrationCursor(project) {
  if (!project) return 0;
  if (Number.isInteger(project.paletteMigrationCursor)) return project.paletteMigrationCursor;
  const nested = project.terrain && project.terrain.paletteMigrationCursor;
  if (Number.isInteger(nested)) return nested;
  return 0;
}

// Palette terrainMigrations: sequential full passes over cell values only.
function applyTerrainMigrations(terrainMap, migrations, cursor) {
  if (!terrainMap || !Array.isArray(migrations) || cursor >= migrations.length) return;
  for (let i = cursor; i < migrations.length; i++) {
    const step = migrations[i];
    if (!step || !step.from || !step.to) continue;
    const fromKey = String(step.from).trim().toLowerCase();
    const toKey = String(step.to).trim().toLowerCase();
    for (const code of Object.keys(terrainMap)) {
      if (terrainMap[code] === fromKey) terrainMap[code] = toKey;
    }
  }
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
      mapFamily: 'hex',
      grid: null,
      terrain: { terrain: {} },
      features: {},
      names: {},
      hexFeatures: {},
      hexsides: emptyHexsidesState(),
      provenance: {},
      groups: [],
      traces: [],
      loadedHexsides: null,
      nodes: {},
      nodesMeta: {},
      nodesFile: '',
      ptpEdges: {},
      nodeAttrs: {},
      mapOffset: [0, 0],
      schemaVersion: 2,
      blankLattice: false,
      paletteMigrationCursor: 0
    };
  }

  isPtp() {
    return this.state.mapFamily === 'ptp';
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

    if (project?.grid) {
      validateGrid(project.grid, { source: 'loadProject' });
    }

    const migrated = this.migrateToV2(project, terrAliases, sideAliases);

    const terrainMigrations = palette.terrainMigrations || [];
    const migrationCursor = readPaletteMigrationCursor(project);
    applyTerrainMigrations(migrated.terrain, terrainMigrations, migrationCursor);

    this.state = {
      name: project.name || '',
      mapImage: project.mapImage || null,
      imageFull: project.imageFull || [0, 0],
      mapFamily: project.mapFamily === 'ptp' ? 'ptp' : 'hex',
      grid: project.grid || null,
      terrain: { terrain: deepClone(migrated.terrain || {}) },
      features: deepClone(migrated.features || {}),
      names: deepClone(migrated.names || {}),
      hexFeatures: deepClone(migrated.hexFeatures || {}),
      hexsides: deepClone(migrated.hexsides || emptyHexsidesState()),
      provenance: deepClone(migrated.provenance || {}),
      groups: deepClone(migrated.groups || []),
      traces: project.traces || [],
      loadedHexsides: project.hexsides ? deepClone(project.hexsides) : null,
      nodes: deepClone(project.nodes || {}),
      nodesMeta: deepClone(project.nodesMeta || {}),
      nodesFile: project.nodesFile || '',
      ptpEdges: {},
      nodeAttrs: {},
      mapOffset: Array.isArray(project.mapOffset)
        ? [Number(project.mapOffset[0]) || 0, Number(project.mapOffset[1]) || 0]
        : [0, 0],
      schemaVersion: 2,
      blankLattice: project.blankLattice === true,
      paletteMigrationCursor: terrainMigrations.length
    };

    if (Array.isArray(project.edges?.edges)) {
      this.state.ptpEdges = edgesArrayToMap(project.edges.edges);
    } else if (project.ptpEdges && typeof project.ptpEdges === 'object' && !Array.isArray(project.ptpEdges)) {
      this.state.ptpEdges = normalizePtpEdgeMap(deepClone(project.ptpEdges));
    }

    // Raw internal nodeAttrs map (nodeId -> {featureKey: value}), the autosave/
    // exportProjectObject shape. The manifest-pointer `attrs` doc ({meta,spaces})
    // is a DIFFERENT shape, loaded separately via importNodeAttrs — same split as
    // ptpEdges (raw map here) vs edges (meta+array doc via importPtpEdges).
    if (project.nodeAttrs && typeof project.nodeAttrs === 'object' && !Array.isArray(project.nodeAttrs)) {
      this.state.nodeAttrs = deepClone(project.nodeAttrs);
    }

    this.rebuildIndex();
    this.notify('project');
  }

  migrateToV2(project, terrAliases, sideAliases) {
    if (!project) return {};
    const terrain = {};
    const features = {};
    const hexFeatures = {};
    const hexsides = {};
    const provenance = {};
    const groups = Array.isArray(project.groups) ? deepClone(project.groups) : [];

    const sourceTerrain = project.terrain && project.terrain.terrain
      ? project.terrain.terrain
      : (project.terrain || {});
    for (const code of Object.keys(sourceTerrain)) {
      const key = normalizeTerrainKey(sourceTerrain[code], terrAliases);
      if (key) terrain[code] = key;
    }

    if (isV1Project(project)) {
      // v1 hexsides are grouped export-layer lists; migrate into per-edge arrays.
      // Iterate the layers actually PRESENT in the file, not just the legacy
      // hardcoded list — palette-defined class-split layers (roads-secondary etc.)
      // must never be silently dropped. Legacy names keep their exact old
      // behavior; new names must resolve to a palette feature key, else warn LOUD.
      const validKeys = new Set(
        ((this.palette || {}).hexsideFeatures || []).map((f) => f.key)
      );
      const layerNames = new Set([
        ...V1_EXPORT_LAYERS,
        ...Object.keys(project.hexsides || {})
      ]);
      for (const layer of layerNames) {
        const list = project.hexsides && project.hexsides[layer];
        if (!Array.isArray(list)) continue;
        const featureKey = this._toFeatureKey(layer);
        if (!featureKey) continue;
        if (!V1_EXPORT_LAYERS.includes(layer) && !validKeys.has(featureKey)) {
          if (list.length) {
            console.warn(
              `hexwright: hexside layer "${layer}" (${list.length} entries) NOT loaded — no palette feature mapping`
            );
          }
          continue;
        }
        for (const pair of list) {
          const a = pair.a, b = pair.b;
          if (!a || !b) continue;
          const key = pairKey(a, b);
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

    // Point features load on BOTH paths: a manifest project can pair v1 grouped
    // hexsides (which route through the branch above) with a features.json
    // document — the TWU bundle does exactly that.
    if (project.features) {
      if (Array.isArray(project.features)) {
        Object.assign(features, featuresArrayToState(validateFeaturesDocument({ features: project.features }).features));
      } else if (typeof project.features === 'object') {
        if (Array.isArray(project.features.features)) {
          Object.assign(features, featuresArrayToState(validateFeaturesDocument(project.features).features));
        } else {
          for (const code of Object.keys(project.features)) {
            const byType = project.features[code];
            if (!byType || typeof byType !== 'object' || Array.isArray(byType)) continue;
            features[code] = deepClone(byType);
          }
        }
      }
    }

    const names = {};
    if (project.names) {
      if (typeof project.names === 'object' && !Array.isArray(project.names)) {
        if (project.names.names && typeof project.names.names === 'object' && !Array.isArray(project.names.names)) {
          Object.assign(names, namesDocumentToState(validateNamesDocument(project.names)));
        } else if (!project.names.features) {
          for (const [code, name] of Object.entries(project.names)) {
            if (typeof name === 'string' && String(name).trim()) names[String(code).trim()] = String(name).trim();
          }
        }
      }
    }

    return { terrain, features, names, hexFeatures, hexsides, provenance, groups };
  }

  setProject(patch) {
    if (patch?.grid) {
      validateGrid(patch.grid, { source: 'setProject' });
    }
    this.pushUndo();
    Object.assign(this.state, patch);
    this.rebuildIndex();
    this.notify('project');
  }

  rebuildIndex() {
    if (this.isPtp()) {
      this.centers = null;
      this.adj = null;
      this.edgeIndex = null;
      return;
    }
    if (!this.state.grid) {
      this.centers = null;
      this.adj = null;
      this.edgeIndex = null;
      return;
    }
    const previousCenters = this.centers ? { ...this.centers } : {};
    this.centers = buildLandIndex(this.state.terrain, this.state.grid);
    // Terrain codes always anchor centers for hit-testing and grid outlines,
    // even when lattice merge is skipped (manifest projects with land data).
    const terrainMap = this.state.terrain?.terrain || {};
    for (const code of Object.keys(terrainMap)) {
      if (!this.centers[code]) this.centers[code] = hexCenter(code, this.state.grid);
    }
    // A valid grid must always show its editable cells. buildLandIndex is empty
    // for hexside-only / fresh projects (no terrain codes yet), so enumerate the
    // full lattice whenever it is explicitly requested OR there is no land to
    // draw at all — otherwise the grid + terrain layer silently renders nothing
    // when the blankLattice manifest flag is absent or lost (e.g. NaB loaded via
    // raw hexgrid/terrain/hexsides files, v1 rectangular or v2 jagged). Both
    // _drawGrid and _drawHexFills iterate store.centers, so an empty index draws
    // an empty screen.
    const noLand = Object.keys(this.centers).length === 0;
    if ((this.state.blankLattice || noLand) && this.state.grid) {
      const lattice = enumerateGridLattice(this.state.grid);
      for (const code of Object.keys(lattice)) {
        if (!this.centers[code]) this.centers[code] = lattice[code];
      }
    }
    // Cleared terrain hexes stay hit-testable for brush toggle / undo restore.
    for (const code of Object.keys(previousCenters)) {
      if (this.centers[code]) continue;
      const { col, row } = parseCCRR(code);
      if (isValidCell(col, row, this.state.grid)) {
        this.centers[code] = hexCenter(code, this.state.grid);
      }
    }
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
      features: deepClone(this.state.features),
      names: deepClone(this.state.names || {}),
      hexFeatures: deepClone(this.state.hexFeatures),
      hexsides: deepClone(this.state.hexsides),
      provenance: deepClone(this.state.provenance),
      groups: deepClone(this.state.groups || []),
      ptpEdges: deepClone(this.state.ptpEdges || {}),
      nodeAttrs: deepClone(this.state.nodeAttrs || {})
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
      features: deepClone(this.state.features),
      names: deepClone(this.state.names || {}),
      hexFeatures: deepClone(this.state.hexFeatures),
      hexsides: deepClone(this.state.hexsides),
      provenance: deepClone(this.state.provenance),
      groups: deepClone(this.state.groups || []),
      ptpEdges: deepClone(this.state.ptpEdges || {}),
      nodeAttrs: deepClone(this.state.nodeAttrs || {})
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
      features: deepClone(this.state.features),
      names: deepClone(this.state.names || {}),
      hexFeatures: deepClone(this.state.hexFeatures),
      hexsides: deepClone(this.state.hexsides),
      provenance: deepClone(this.state.provenance),
      groups: deepClone(this.state.groups || []),
      ptpEdges: deepClone(this.state.ptpEdges || {}),
      nodeAttrs: deepClone(this.state.nodeAttrs || {})
    });
    this.applySnap(snap);
    this.rebuildIndex();
    this.notify('redo');
    return true;
  }

  applySnap(snap) {
    this.state.terrain = snap.terrain;
    this.state.features = snap.features || {};
    this.state.names = snap.names || {};
    this.state.hexFeatures = snap.hexFeatures;
    this.state.hexsides = snap.hexsides;
    this.state.provenance = snap.provenance;
    this.state.groups = snap.groups || [];
    this.state.ptpEdges = snap.ptpEdges || {};
    this.state.nodeAttrs = snap.nodeAttrs || {};
  }

  // ----------------- terrain -----------------

  setTerrain(code, key) {
    const current = this.state.terrain.terrain[code];
    if (current === key) return;
    this.pushUndo();
    this.state.terrain.terrain[code] = key;
    this.state.provenance[code] = 'confirmed';
    this.rebuildIndex();
    this.notify('terrain');
  }

  clearTerrain(code) {
    if (!this.state.terrain.terrain[code]) return;
    this.pushUndo();
    delete this.state.terrain.terrain[code];
    delete this.state.provenance[code];
    this.rebuildIndex();
    this.notify('terrain');
  }

  applyTerrainBrush(code, key) {
    const current = this.state.terrain.terrain[code];
    if (current === key) this.clearTerrain(code);
    else this.setTerrain(code, key);
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
    this.rebuildIndex();
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

  _paletteFeatureType(type) {
    const palette = this.palette || {};
    return (palette.hexFeatures || []).find((f) => f.key === type) || null;
  }

  getPointFeature(code, type) {
    const rec = this.state.features?.[code]?.[type];
    return rec ? deepClone(rec) : null;
  }

  getPointFeaturesAt(code) {
    const byType = this.state.features?.[code];
    if (!byType) return [];
    return Object.keys(byType).map((type) => ({ type, ...deepClone(byType[type]) }));
  }

  _pointFeatureEqual(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.name === b.name && JSON.stringify(a.attrs || {}) === JSON.stringify(b.attrs || {});
  }

  setPointFeature(code, type, { name = '', attrs } = {}) {
    const paletteFeature = this._paletteFeatureType(type);
    const nextAttrs = attrs != null
      ? deepClone(attrs)
      : defaultAttrsFromSchema(paletteFeature?.attrs);
    const next = { name: name != null ? String(name) : '', attrs: nextAttrs };
    const current = this.state.features?.[code]?.[type];
    if (current && this._pointFeatureEqual(current, next)) return;
    this.pushUndo();
    if (!this.state.features) this.state.features = {};
    if (!this.state.features[code]) this.state.features[code] = {};
    this.state.features[code][type] = next;
    this.notify('features');
  }

  deletePointFeature(code, type) {
    const bucket = this.state.features?.[code];
    if (!bucket || !bucket[type]) return;
    this.pushUndo();
    delete bucket[type];
    if (!Object.keys(bucket).length) delete this.state.features[code];
    this.notify('features');
  }

  countPointFeatureType(type) {
    let count = 0;
    for (const byType of Object.values(this.state.features || {})) {
      if (byType && byType[type]) count++;
    }
    return count;
  }

  clearPointFeatureType(type) {
    const count = this.countPointFeatureType(type);
    if (count === 0) return 0;
    this.pushUndo();
    for (const code of Object.keys(this.state.features || {})) {
      const bucket = this.state.features[code];
      if (!bucket || !bucket[type]) continue;
      delete bucket[type];
      if (!Object.keys(bucket).length) delete this.state.features[code];
    }
    this.notify('features');
    return count;
  }

  importFeatures(input) {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    validateFeaturesDocument(data);
    const imported = featuresArrayToState(data.features);
    this.pushUndo();
    this.state.features = imported;
    this.notify('features');
    return data.features.length;
  }

  exportFeaturesObject() {
    return {
      _comment: `edited in Hexwright v2.1 ${todayStamp()}`,
      features: exportFeaturesArrayFromState(this.state.features)
    };
  }

  exportFeaturesJson() {
    return JSON.stringify(this.exportFeaturesObject(), null, 2);
  }

  getHexName(code) {
    return this.state.names?.[code] || '';
  }

  setHexName(code, name) {
    const trimmed = name != null ? String(name).trim() : '';
    const current = this.state.names?.[code] || '';
    if (current === trimmed) return;
    this.pushUndo();
    if (!this.state.names) this.state.names = {};
    if (trimmed) this.state.names[code] = trimmed;
    else delete this.state.names[code];
    this.notify('names');
  }

  importNames(input) {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    validateNamesDocument(data);
    const imported = namesDocumentToState(data);
    this.pushUndo();
    if (!this.state.names) this.state.names = {};
    for (const code of Object.keys(imported)) {
      this.state.names[code] = imported[code];
    }
    this.notify('names');
    return Object.keys(imported).length;
  }

  exportNamesObject() {
    const source = this.state.names || {};
    const names = {};
    for (const code of Object.keys(source).sort((a, b) => a.localeCompare(b))) {
      names[code] = source[code];
    }
    return {
      _comment: `edited in Hexwright v2.1 ${todayStamp()}`,
      names
    };
  }

  exportNamesJson() {
    return JSON.stringify(this.exportNamesObject(), null, 2);
  }

  importNodes(input, opts = {}) {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    validateNodesDocument(data);
    const nodes = nodesDocumentToMap(data);
    if (!opts.skipUndo) this.pushUndo();
    this.state.mapFamily = 'ptp';
    this.state.nodes = nodes;
    this.state.nodesMeta = deepClone(data.meta || {});
    if (opts.nodesFile) this.state.nodesFile = String(opts.nodesFile);
    this.rebuildIndex();
    this.notify('nodes');
    return Object.keys(nodes).length;
  }

  importPtpEdges(input, opts = {}) {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    validateEdgesDocument(data);
    const imported = edgesArrayToMap(data.edges);
    if (!opts.skipUndo) this.pushUndo();
    this.state.ptpEdges = imported;
    if (data.meta && typeof data.meta === 'object') {
      this.state.nodesMeta = { ...this.state.nodesMeta, ...deepClone(data.meta) };
    }
    this.notify('ptpEdges');
    return data.edges.length;
  }

  setPtpEdge(a, b, type) {
    const pair = normalizeNodePair(a, b);
    if (!pair || !type) return false;
    if (!this.state.nodes[pair.a] || !this.state.nodes[pair.b]) return false;
    const key = ptpEdgeKey(pair.a, pair.b, type);
    const canonical = String(type).trim();
    if (!key || this.state.ptpEdges[key] === canonical) return false;
    this.pushUndo();
    this.state.ptpEdges[key] = canonical;
    this.notify('ptpEdges');
    return true;
  }

  deletePtpEdge(a, b, type) {
    const pair = normalizeNodePair(a, b);
    if (!pair || !type) return false;
    const key = ptpEdgeKey(pair.a, pair.b, type);
    if (!key || !this.state.ptpEdges[key]) return false;
    this.pushUndo();
    delete this.state.ptpEdges[key];
    this.notify('ptpEdges');
    return true;
  }

  getPtpEdge(a, b, type) {
    const pair = normalizeNodePair(a, b);
    if (!pair) return null;
    if (type) {
      const key = ptpEdgeKey(pair.a, pair.b, type);
      return key ? (this.state.ptpEdges[key] || null) : null;
    }
    const onPair = ptpEdgesOnPair(this.state.ptpEdges, pair.a, pair.b);
    return onPair[0]?.type || null;
  }

  getPtpEdgesOnPair(a, b) {
    return ptpEdgesOnPair(this.state.ptpEdges, a, b);
  }

  countPtpEdges() {
    return Object.keys(this.state.ptpEdges || {}).length;
  }

  getPtpEdgeCounts() {
    return countEdgesByType(this.state.ptpEdges);
  }

  getOrphanNodeIds() {
    return findOrphanNodeIds(this.state.nodes, this.state.ptpEdges);
  }

  getMissingPtpNodeRefs() {
    return findMissingNodeRefs(this.state.nodes, this.state.ptpEdges);
  }

  exportPtpEdgesObject() {
    const edges = edgesMapToArray(this.state.ptpEdges);
    const count = countEdgesByType(this.state.ptpEdges);
    const meta = {
      game: this.state.nodesMeta?.game || this.state.name || '',
      nodesFile: this.state.nodesFile || '',
      count
    };
    return {
      _comment: `edited in Hexwright v2.1 ${todayStamp()}`,
      meta,
      edges
    };
  }

  exportPtpEdgesJson() {
    return JSON.stringify(this.exportPtpEdgesObject(), null, 2);
  }

  // ----------------- node attrs (point-to-point) -----------------
  // Palette-defined `nodeFeatures` tagging on p2p nodes: {kind:"flag"|"level"|"enum"}.
  // Stored as this.state.nodeAttrs = { nodeId: { featureKey: value, ... } }. Mirrors
  // the hex point-feature pattern (getPointFeature/setPointFeature/etc) one layer
  // down: value here is a raw scalar (true / level number / enum string), not a
  // {name, attrs} record, since node features have no free-form sub-attrs.

  getNodeAttrs(nodeId) {
    return deepClone(this.state.nodeAttrs?.[nodeId] || {});
  }

  countNodeFeatureTagged(featureKey) {
    let count = 0;
    for (const bucket of Object.values(this.state.nodeAttrs || {})) {
      if (bucket && Object.prototype.hasOwnProperty.call(bucket, featureKey)) count++;
    }
    return count;
  }

  setNodeAttr(nodeId, featureKey, value) {
    if (!this.state.nodes[nodeId] || !featureKey) return false;
    if (value === null || value === undefined || value === '') {
      return this.clearNodeAttr(nodeId, featureKey);
    }
    const current = this.state.nodeAttrs[nodeId]?.[featureKey];
    if (current === value) return false;
    this.pushUndo();
    if (!this.state.nodeAttrs[nodeId]) this.state.nodeAttrs[nodeId] = {};
    this.state.nodeAttrs[nodeId][featureKey] = value;
    this.notify('nodeAttrs');
    return true;
  }

  clearNodeAttr(nodeId, featureKey) {
    const bucket = this.state.nodeAttrs[nodeId];
    if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, featureKey)) return false;
    this.pushUndo();
    delete bucket[featureKey];
    if (!Object.keys(bucket).length) delete this.state.nodeAttrs[nodeId];
    this.notify('nodeAttrs');
    return true;
  }

  // Bulk replace for the node inspector's Save: every key present becomes the new
  // value, EXCEPT null/undefined/'' which explicitly clears that feature — so a
  // single Save can both add and remove tags on one node in one undo step.
  setNodeAttrs(nodeId, attrsObject) {
    if (!this.state.nodes[nodeId]) return false;
    const bucket = { ...(this.state.nodeAttrs[nodeId] || {}) };
    let changed = false;
    for (const [key, value] of Object.entries(attrsObject || {})) {
      if (value === null || value === undefined || value === '') {
        if (Object.prototype.hasOwnProperty.call(bucket, key)) { delete bucket[key]; changed = true; }
      } else if (bucket[key] !== value) {
        bucket[key] = value;
        changed = true;
      }
    }
    if (!changed) return false;
    this.pushUndo();
    if (Object.keys(bucket).length) this.state.nodeAttrs[nodeId] = bucket;
    else delete this.state.nodeAttrs[nodeId];
    this.notify('nodeAttrs');
    return true;
  }

  clearNodeFeatureLayer(featureKey) {
    const count = this.countNodeFeatureTagged(featureKey);
    if (count === 0) return 0;
    this.pushUndo();
    for (const nodeId of Object.keys(this.state.nodeAttrs || {})) {
      const bucket = this.state.nodeAttrs[nodeId];
      if (bucket && Object.prototype.hasOwnProperty.call(bucket, featureKey)) {
        delete bucket[featureKey];
        if (!Object.keys(bucket).length) delete this.state.nodeAttrs[nodeId];
      }
    }
    this.notify('nodeAttrs');
    return count;
  }

  // Strict native shape: {"meta":{...},"spaces":{<nodeId>:{<featureKey>:value}}}.
  // opts.fieldMap (optional) switches to draft-shape acceptance: an explicit
  // {draftKey: {feature, kind, values?}} map converts a commission repo's raw
  // space-attrs-draft.json (arbitrary per-game field names) into palette feature
  // keys via draftSpacesToNodeAttrs — see tools/convert-space-attrs.mjs for the
  // real per-game maps used to pre-seed local/pog-attrs.json + local/ftp-attrs.json.
  importNodeAttrs(input, opts = {}) {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    let spacesDoc;
    let skipped = [];
    if (opts.fieldMap) {
      const spacesSource = data.spaces && typeof data.spaces === 'object' ? data.spaces : data;
      const converted = draftSpacesToNodeAttrs(spacesSource, opts.fieldMap, this.palette?.nodeFeatures || []);
      spacesDoc = converted.spaces;
      skipped = converted.skipped;
    } else {
      validateNodeAttrsDocument(data);
      spacesDoc = data.spaces;
    }

    const known = this.state.nodes || {};
    const hasKnownNodes = Object.keys(known).length > 0;
    const unknown = [];
    const next = {};
    for (const [nodeId, attrs] of Object.entries(spacesDoc || {})) {
      if (hasKnownNodes && !known[nodeId]) { unknown.push(nodeId); continue; }
      if (!attrs || typeof attrs !== 'object') continue;
      const bucket = {};
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === '') continue;
        bucket[key] = value;
      }
      if (Object.keys(bucket).length) next[nodeId] = bucket;
    }

    if (!opts.skipUndo) this.pushUndo();
    this.state.nodeAttrs = next;
    this.notify('nodeAttrs');
    return { count: Object.keys(next).length, unknown, skipped };
  }

  exportNodeAttrsObject() {
    const spaces = {};
    const nodeIds = Object.keys(this.state.nodeAttrs || {}).sort((a, b) => a.localeCompare(b));
    for (const nodeId of nodeIds) {
      const bucket = this.state.nodeAttrs[nodeId];
      if (bucket && Object.keys(bucket).length) spaces[nodeId] = deepClone(bucket);
    }
    return {
      meta: {
        version: 1,
        game: this.state.nodesMeta?.game || this.state.name || '',
        exported: todayStamp()
      },
      spaces
    };
  }

  exportNodeAttrsJson() {
    return JSON.stringify(this.exportNodeAttrsObject(), null, 2);
  }

  // ----------------- groups (multi-hex assignments) -----------------

  _nextGroupId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      try { return crypto.randomUUID(); } catch (_) { /* fall through */ }
    }
    return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  _validGroupId(id) {
    return typeof id === 'string' && id.trim().length > 0;
  }

  _sanitizeHexes(list) {
    if (!Array.isArray(list)) return [];
    const set = new Set();
    for (const code of list) {
      const s = String(code || '').trim();
      if (s && this._isValidHexCode(s)) set.add(s);
    }
    return [...set];
  }

  getGroups() {
    return deepClone(this.state.groups || []);
  }

  getGroup(id) {
    const g = (this.state.groups || []).find((x) => x.id === id);
    return g ? deepClone(g) : null;
  }

  getGroupsForHex(code) {
    return (this.state.groups || []).filter((g) => g.hexes && g.hexes.includes(code)).map((g) => g.id);
  }

  createGroup({ name = '', kind = '', value = '', hexes = [] } = {}) {
    const sanitized = this._sanitizeHexes(hexes);
    const group = {
      id: this._nextGroupId(),
      name: String(name != null ? name : '').trim(),
      kind: String(kind != null ? kind : '').trim(),
      value: value != null ? value : '',
      hexes: sanitized
    };
    this.pushUndo();
    if (!this.state.groups) this.state.groups = [];
    this.state.groups = [...this.state.groups, group];
    this.notify('groups');
    return group.id;
  }

  updateGroup(id, patch) {
    if (!this._validGroupId(id)) return false;
    const idx = (this.state.groups || []).findIndex((g) => g.id === id);
    if (idx < 0) return false;
    const current = this.state.groups[idx];
    const next = { ...current };
    if (patch.name !== undefined) next.name = String(patch.name != null ? patch.name : '').trim();
    if (patch.kind !== undefined) next.kind = String(patch.kind != null ? patch.kind : '').trim();
    if (patch.value !== undefined) next.value = patch.value != null ? patch.value : '';
    if (patch.hexes !== undefined) next.hexes = this._sanitizeHexes(patch.hexes);
    if (JSON.stringify(current) === JSON.stringify(next)) return false;
    this.pushUndo();
    this.state.groups = this.state.groups.slice();
    this.state.groups[idx] = next;
    this.notify('groups');
    return true;
  }

  renameGroup(id, name) {
    return this.updateGroup(id, { name });
  }

  setGroupKind(id, kind) {
    return this.updateGroup(id, { kind });
  }

  setGroupValue(id, value) {
    return this.updateGroup(id, { value });
  }

  setGroupHexes(id, hexes) {
    return this.updateGroup(id, { hexes });
  }

  /** isValidCell takes (col, row, grid) — parse the CCRR code first. */
  _isValidHexCode(code) {
    try {
      const { col, row } = parseCCRR(code);
      return isValidCell(col, row, this.state.grid);
    } catch {
      return false;
    }
  }

  addHexToGroup(id, code) {
    if (!this._validGroupId(id) || !code) return false;
    const g = this.getGroup(id);
    if (!g) return false;
    const s = String(code).trim();
    if (!this._isValidHexCode(s)) return false;
    if (g.hexes.includes(s)) return false;
    return this.updateGroup(id, { hexes: [...g.hexes, s] });
  }

  removeHexFromGroup(id, code) {
    if (!this._validGroupId(id) || !code) return false;
    const g = this.getGroup(id);
    if (!g) return false;
    const s = String(code).trim();
    if (!g.hexes.includes(s)) return false;
    return this.updateGroup(id, { hexes: g.hexes.filter((h) => h !== s) });
  }

  deleteGroup(id) {
    if (!this._validGroupId(id)) return false;
    const before = (this.state.groups || []).length;
    const next = (this.state.groups || []).filter((g) => g.id !== id);
    if (next.length === before) return false;
    this.pushUndo();
    this.state.groups = next;
    this.notify('groups');
    return true;
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

  countHexsideFeature(featureKey) {
    const canonical = this._toFeatureKey(featureKey);
    if (!canonical) return 0;
    let count = 0;
    for (const arr of Object.values(this.state.hexsides || {})) {
      if (Array.isArray(arr) && arr.includes(canonical)) count++;
    }
    return count;
  }

  clearHexsideFeatureLayer(featureKey) {
    const canonical = this._toFeatureKey(featureKey);
    if (!canonical) return 0;
    const count = this.countHexsideFeature(canonical);
    if (count === 0) return 0;
    this.pushUndo();
    for (const [key, arr] of Object.entries(this.state.hexsides || {})) {
      if (!Array.isArray(arr) || !arr.includes(canonical)) continue;
      const next = arr.filter((k) => k !== canonical);
      if (next.length === 0) delete this.state.hexsides[key];
      else this.state.hexsides[key] = next;
    }
    this.rebuildIndex();
    this.notify('hexsides');
    return count;
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

  /** Remove every feature on an edge. Returns feature count removed (0 if already empty). */
  clearAllEdgeFeatures(a, b) {
    const pair = normalizePair(a, b);
    const key = pairKey(pair.a, pair.b);
    const current = this.edgeFeatures(pair.a, pair.b);
    if (!current.length) return 0;
    this.pushUndo();
    delete this.state.hexsides[key];
    this.rebuildIndex();
    this.notify('hexsides');
    return current.length;
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

  _exportLayerMaps() {
    const exportLayerFor = new Map();
    const regeneratableLayers = new Set(V1_EXPORT_LAYERS);
    for (const f of (this.palette?.hexsideFeatures || [])) {
      const layer = f.exportLayer || f.key;
      exportLayerFor.set(f.key, layer);
      regeneratableLayers.add(layer);
    }
    return { exportLayerFor, regeneratableLayers };
  }

  exportHexsidesObject() {
    const { exportLayerFor, regeneratableLayers } = this._exportLayerMaps();

    // Preserve metadata (version, counts, theaters, boundaries). Edge-layer
    // arrays are always regenerated — including palette class-split layers
    // (rivers-primary etc.) that are outside V1_EXPORT_LAYERS.
    const base = {};
    for (const [k, v] of Object.entries(this.state.loadedHexsides || {})) {
      if (k.includes('|')) continue;
      if (regeneratableLayers.has(k) && Array.isArray(v)) continue;
      base[k] = deepClone(v);
    }

    for (const layer of regeneratableLayers) {
      base[layer] = [];
    }

    const seenByLayer = new Map();
    for (const layer of regeneratableLayers) {
      seenByLayer.set(layer, new Set());
    }

    for (const [edgeKey, arr] of Object.entries(this.state.hexsides || {})) {
      const parts = edgeKey.split('|');
      if (parts.length !== 2) continue;
      const pair = normalizePair(parts[0], parts[1]);
      const canonicalEdge = pairKey(pair.a, pair.b);
      const seenFeatures = new Set();
      for (const featureKey of (arr || [])) {
        const layer = exportLayerFor.get(featureKey);
        if (!layer || seenFeatures.has(layer)) continue;
        seenFeatures.add(layer);
        const layerSeen = seenByLayer.get(layer);
        if (!layerSeen) {
          seenByLayer.set(layer, new Set());
        }
        const bucket = seenByLayer.get(layer);
        if (bucket.has(canonicalEdge)) continue;
        bucket.add(canonicalEdge);
        if (!base[layer]) base[layer] = [];
        base[layer].push({ a: pair.a, b: pair.b });
      }
    }

    for (const layer of regeneratableLayers) {
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
    const seen = new Set();
    const pairs = [];
    for (const [edgeKey, features] of Object.entries(this.state.hexsides || {})) {
      if (!Array.isArray(features) || !features.includes(canonical)) continue;
      const parts = edgeKey.split('|');
      if (parts.length !== 2) continue;
      const pair = normalizePair(parts[0], parts[1]);
      const canonicalEdge = pairKey(pair.a, pair.b);
      if (seen.has(canonicalEdge)) continue;
      seen.add(canonicalEdge);
      pairs.push([pair.a, pair.b]);
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
    const source = this.state.terrain.terrain || {};
    const terrain = {};
    for (const code of Object.keys(source).sort((a, b) => a.localeCompare(b))) {
      terrain[code] = source[code];
    }
    return {
      _comment: `edited in Hexwright v2.1 ${todayStamp()}`,
      terrain
    };
  }

  exportTerrainJson() {
    const obj = this.exportTerrainObject();
    const codes = Object.keys(obj.terrain).sort((a, b) => a.localeCompare(b));
    if (!codes.length) {
      return JSON.stringify({ _comment: obj._comment, terrain: {} }, null, 2);
    }
    const inner = codes.map((code, i) =>
      `    ${JSON.stringify(code)}: ${JSON.stringify(obj.terrain[code])}${i < codes.length - 1 ? ',' : ''}`
    ).join('\n');
    return `{\n  "_comment": ${JSON.stringify(obj._comment)},\n  "terrain": {\n${inner}\n  }\n}`;
  }

  exportProjectObject() {
    const base = {
      schemaVersion: 2,
      name: this.state.name,
      mapImage: null, // not serializable
      imageFull: deepClone(this.state.imageFull),
      mapFamily: this.state.mapFamily || 'hex',
      grid: deepClone(this.state.grid),
      terrain: this.exportTerrainObject(),
      features: this.exportFeaturesObject(),
      names: this.exportNamesObject(),
      hexFeatures: deepClone(this.state.hexFeatures),
      hexsides: deepClone(this.state.hexsides),
      provenance: deepClone(this.state.provenance),
      groups: deepClone(this.state.groups || []),
      mapOffset: deepClone(this.state.mapOffset || [0, 0]),
      palette: this.palette?.name || 'default',
      paletteMigrationCursor: this.state.paletteMigrationCursor || 0,
      ...(this.state.blankLattice ? { blankLattice: true } : {})
    };
    if (this.isPtp()) {
      base.nodes = deepClone(this.state.nodes);
      base.nodesMeta = deepClone(this.state.nodesMeta || {});
      base.nodesFile = this.state.nodesFile || '';
      base.ptpEdges = deepClone(this.state.ptpEdges || {});
      base.nodeAttrs = deepClone(this.state.nodeAttrs || {});
    }
    return base;
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
