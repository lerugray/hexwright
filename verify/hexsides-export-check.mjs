// hexsides-export-check — regression for duplicate edge pairs on export.
// NaB class-split layers lived in loadedHexsides outside V1_EXPORT_LAYERS, so
// exportHexsidesObject appended regenerated pairs onto the preserved copy (2x).
// Also guards non-canonical edge keys (b|a) and dual-perspective internal storage.
import { ProjectStore } from '../src/store.js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PATHS } from './_local-data.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NAB_FIXTURE_PALETTE = {
  name: 'Napoleon at Bay',
  terrain: [
    { key: 'clear', label: 'Clear', color: '#c8b88a' },
    { key: 'woods', label: 'Woods', color: '#5c7a4a' },
    { key: 'water', label: 'Water', color: '#3f78b4' },
    { key: 'urban', label: 'Urban', color: '#9a9a9a' }
  ],
  hexFeatures: [],
  hexsideFeatures: [
    { key: 'river_primary', label: 'Primary River', color: '#1e5fd8', kind: 'edge', exportLayer: 'rivers-primary' },
    { key: 'river_secondary', label: 'Secondary River', color: '#6fb0ff', kind: 'edge', exportLayer: 'rivers-secondary' },
    { key: 'road_primary', label: 'Primary Road', color: '#c8321e', kind: 'crossing', exportLayer: 'roads-primary' },
    { key: 'road_secondary', label: 'Secondary Road', color: '#b96b1f', kind: 'crossing', exportLayer: 'roads-secondary' },
    { key: 'bridge', label: 'Bridge', color: '#e0c060', kind: 'crossing', exportLayer: 'bridges' }
  ],
  terrainAliases: { forest: 'woods', lake: 'water' },
  hexsideAliases: {
    'rivers-primary': 'river_primary',
    'rivers-secondary': 'river_secondary',
    'roads-primary': 'road_primary',
    'roads-secondary': 'road_secondary',
    bridges: 'bridge',
    rivers: 'river_secondary',
    roads: 'road_primary',
    river: 'river_primary',
    road: 'road_primary'
  }
};

function loadNabPalette() {
  if (existsSync(PATHS.nabPalette)) {
    return JSON.parse(readFileSync(PATHS.nabPalette, 'utf8'));
  }
  return NAB_FIXTURE_PALETTE;
}
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

function canonicalPairKey(p) {
  return p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`;
}

function countDupes(list) {
  const seen = new Set();
  let dupes = 0;
  for (const p of list || []) {
    const k = canonicalPairKey(p);
    if (seen.has(k)) dupes++;
    else seen.add(k);
  }
  return { total: (list || []).length, unique: seen.size, dupes };
}

function assertLayerExport(store, layer, want) {
  const exp = store.exportHexsidesObject();
  const list = exp[layer] || [];
  const { total, unique, dupes } = countDupes(list);
  rec(`export ${layer} count`, total === want, `${total}/${want}`);
  rec(`export ${layer} canonical a<b`, list.every((p) => p.a < p.b), `${list.length} pairs`);
  rec(`export ${layer} no duplicate keys`, dupes === 0, `${unique} unique, ${dupes} dupes`);
  return { exp, list, dupes };
}

// --- Synthetic store: plain + crossing + class-split layers ---
const store = new ProjectStore();
store.setPalette(loadNabPalette());

// loadedHexsides mirrors a real NaB bundle: class-split arrays present pre-edit.
store.state.loadedHexsides = {
  _comment: 'fixture',
  'rivers-primary': [{ a: '0010', b: '0011' }],
  'rivers-secondary': [{ a: '0012', b: '0013' }],
  'roads-primary': [{ a: '0014', b: '0015' }],
  'roads-secondary': [{ a: '0016', b: '0017' }],
  bridges: [{ a: '0018', b: '0019' }],
  theaters: { A: [] },
};

// Internal edges: canonical + reversed keys, both hex perspectives, multi-class edge.
store.state.hexsides = {
  '0010|0011': ['river_primary'],
  '0011|0010': ['river_primary'],
  '0012|0013': ['river_secondary'],
  '0015|0014': ['road_primary'],
  '0016|0017': ['road_secondary'],
  '0018|0019': ['bridge'],
  '0020|0021': ['river_primary', 'river_secondary'],
  '0021|0020': ['river_primary'],
};

assertLayerExport(store, 'rivers-primary', 2);
assertLayerExport(store, 'rivers-secondary', 2);
assertLayerExport(store, 'roads-primary', 1);
assertLayerExport(store, 'roads-secondary', 1);
assertLayerExport(store, 'bridges', 1);

const exp1 = store.exportHexsidesObject();
rec('metadata preserved', exp1._comment === 'fixture' && exp1.theaters != null, JSON.stringify({ c: exp1._comment, t: !!exp1.theaters }));
rec('clipboard path uses same object', store.exportHexsidesJson().includes('"rivers-primary"'), 'exportHexsidesJson ok');

// Round-trip: export -> migrate -> re-export must be identical (class-split inks preserved).
const round = new ProjectStore();
round.setPalette(loadNabPalette());
round.state.loadedHexsides = structuredClone(exp1);
const migrated = round.migrateToV2({ hexsides: exp1 }, {}, round.palette.hexsideAliases);
round.state.hexsides = migrated.hexsides;
const exp2 = round.exportHexsidesObject();

for (const layer of ['rivers-primary', 'rivers-secondary', 'roads-primary', 'roads-secondary', 'bridges']) {
  rec(
    `round-trip ${layer}`,
    JSON.stringify(exp1[layer]) === JSON.stringify(exp2[layer]),
    `${(exp1[layer] || []).length} -> ${(exp2[layer] || []).length}`
  );
}

// --- Real NaB bundle must not double on export ---
if (!existsSync(PATHS.nabHexsides)) {
  console.log('SKIP local game data not present (local/nab/hexsides.json)');
} else {
const nabPalette = loadNabPalette();
const nab = new ProjectStore();
nab.setPalette(nabPalette);
const bundle = JSON.parse(readFileSync(PATHS.nabHexsides, 'utf8'));
nab.state.loadedHexsides = structuredClone(bundle);
const nabMigrated = nab.migrateToV2({ hexsides: bundle }, {}, nab.palette.hexsideAliases);
nab.state.hexsides = nabMigrated.hexsides;

for (const layer of ['rivers-primary', 'rivers-secondary', 'roads-primary', 'roads-secondary', 'bridges']) {
  const source = bundle[layer];
  if (!Array.isArray(source)) continue;
  const exported = nab.exportHexsidesObject()[layer] || [];
  const { dupes } = countDupes(exported);
  rec(`NaB ${layer} export matches source`, exported.length === source.length && dupes === 0,
    `${exported.length}/${source.length}, dupes=${dupes}`);
}

}

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
