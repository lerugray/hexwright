// Verify palette terrainMigrations: ordered renames applied to terrain cells only,
// cursor prevents re-application, and exported project carries paletteMigrationCursor.
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const DIR = process.cwd();
const PORT = 8031;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const rec = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => !!(window.hexwright && window.hexwright.store), { timeout: 15000 });

  const syntheticPalette = {
    name: 'migration-test-palette',
    terrain: [
      { key: 'clear', name: 'Clear', color: '#e8e0c5' },
      { key: 'woods', name: 'Woods', color: '#6b8c42' },
      { key: 'rough', name: 'Rough', color: '#a89f91' },
      { key: 'desert', name: 'Desert', color: '#d2b48c' },
      { key: 'broken', name: 'Broken', color: '#8b7d6b' }
    ],
    hexsideFeatures: [{ key: 'road', name: 'Road' }],
    pointFeatures: [{ key: 'city', name: 'City' }],
    terrainMigrations: [
      { from: 'rough', to: 'broken' },
      { from: 'desert', to: 'rough' }
    ]
  };

  const baseProject = {
    schemaVersion: 2,
    name: 'Migration Test',
    mapImage: null,
    imageFull: [100, 100],
    grid: null,
    terrain: {
      terrain: {
        '0000': 'desert',
        '0001': 'rough',
        '0002': 'woods',
        '0003': 'desert'
      }
    },
    hexFeatures: { '0002': [{ type: 'city', name: 'Aldburg', attrs: {} }] },
    features: {},
    names: { '0001': 'Ridge' },
    hexsides: { '0000|0001': ['road'] },
    provenance: { '0000': 'draft' },
    palette: syntheticPalette
  };

  // Case (a): old-vocab project with no cursor field — migrations run from start.
  const caseA = await page.evaluate((project) => {
    const store = window.hexwright.store;
    return store.loadProject(project).then(() => ({
      terrain: { ...store.state.terrain.terrain },
      cursor: store.state.paletteMigrationCursor,
      hexFeatures: { ...store.state.hexFeatures },
      names: { ...store.state.names },
      hexsides: JSON.parse(JSON.stringify(store.state.hexsides)),
      provenance: { ...store.state.provenance }
    }));
  }, baseProject);

  rec('case A: desert -> rough',
    caseA.terrain['0000'] === 'rough' && caseA.terrain['0003'] === 'rough',
    JSON.stringify(caseA.terrain));
  rec('case A: rough -> broken',
    caseA.terrain['0001'] === 'broken',
    JSON.stringify(caseA.terrain));
  rec('case A: woods unchanged',
    caseA.terrain['0002'] === 'woods',
    JSON.stringify(caseA.terrain));
  rec('case A: cursor set to migration count',
    caseA.cursor === 2,
    `cursor=${caseA.cursor}`);
  rec('case A: hexFeatures untouched',
    JSON.stringify(caseA.hexFeatures['0002']) === JSON.stringify([{ type: 'city', name: 'Aldburg', attrs: {} }]),
    JSON.stringify(caseA.hexFeatures));
  rec('case A: names untouched',
    caseA.names['0001'] === 'Ridge',
    JSON.stringify(caseA.names));
  rec('case A: hexsides untouched',
    JSON.stringify(caseA.hexsides['0000|0001']) === JSON.stringify(['road']),
    JSON.stringify(caseA.hexsides));
  rec('case A: provenance untouched',
    caseA.provenance['0000'] === 'draft',
    JSON.stringify(caseA.provenance));

  // Case (b): already-migrated project with cursor === migration count.
  const migratedProject = {
    schemaVersion: 2,
    name: 'Already Migrated',
    mapImage: null,
    imageFull: [100, 100],
    grid: null,
    paletteMigrationCursor: 2,
    terrain: {
      terrain: {
        '0000': 'rough',
        '0001': 'broken',
        '0002': 'woods'
      }
    },
    hexFeatures: {},
    features: {},
    names: {},
    hexsides: {},
    provenance: {},
    palette: syntheticPalette
  };

  const caseB = await page.evaluate((project) => {
    const store = window.hexwright.store;
    return store.loadProject(project).then(() => ({
      terrain: { ...store.state.terrain.terrain },
      cursor: store.state.paletteMigrationCursor
    }));
  }, migratedProject);

  rec('case B: rough stays rough',
    caseB.terrain['0000'] === 'rough',
    JSON.stringify(caseB.terrain));
  rec('case B: broken stays broken',
    caseB.terrain['0001'] === 'broken',
    JSON.stringify(caseB.terrain));
  rec('case B: woods unchanged',
    caseB.terrain['0002'] === 'woods',
    JSON.stringify(caseB.terrain));
  rec('case B: cursor preserved',
    caseB.cursor === 2,
    `cursor=${caseB.cursor}`);

  // Case (c): exported project includes paletteMigrationCursor; re-loading is idempotent.
  // Re-load the 4-cell case-A fixture first: the store still holds case B's 3-cell
  // state at this point, and the assertions below are written against case A's cells.
  const exported = await page.evaluate((project) => {
    const store = window.hexwright.store;
    return store.loadProject(project).then(() => store.exportProjectObject());
  }, baseProject);

  rec('case C: export includes top-level paletteMigrationCursor',
    exported.paletteMigrationCursor === 2,
    `paletteMigrationCursor=${exported.paletteMigrationCursor}`);
  rec('case C: exported terrain matches in-memory',
    exported.terrain && exported.terrain.terrain &&
    exported.terrain.terrain['0000'] === 'rough' &&
    exported.terrain.terrain['0001'] === 'broken' &&
    exported.terrain.terrain['0002'] === 'woods' &&
    exported.terrain.terrain['0003'] === 'rough',
    JSON.stringify(exported.terrain && exported.terrain.terrain));

  // Re-load the exported object by itself; palette string falls back to default,
  // but paletteMigrationCursor must guard against re-applying.
  const caseC = await page.evaluate((project) => {
    const store = window.hexwright.store;
    return store.loadProject(project).then(() => ({
      terrain: { ...store.state.terrain.terrain },
      cursor: store.state.paletteMigrationCursor
    }));
  }, exported);

  rec('case C: reload from export is idempotent',
    caseC.terrain['0000'] === 'rough' &&
    caseC.terrain['0001'] === 'broken' &&
    caseC.terrain['0002'] === 'woods' &&
    caseC.terrain['0003'] === 'rough' &&
    caseC.cursor === 2,
    `terrain=${JSON.stringify(caseC.terrain)} cursor=${caseC.cursor}`);

  // Case (D): cursor read order — project.terrain.paletteMigrationCursor is legacy fallback.
  const legacyCursorProject = {
    schemaVersion: 2,
    name: 'Legacy Cursor',
    mapImage: null,
    imageFull: [100, 100],
    grid: null,
    terrain: {
      paletteMigrationCursor: 2,
      terrain: {
        '0000': 'rough',
        '0001': 'broken',
        '0002': 'woods'
      }
    },
    hexFeatures: {},
    features: {},
    names: {},
    hexsides: {},
    provenance: {},
    palette: syntheticPalette
  };

  const caseD = await page.evaluate((project) => {
    const store = window.hexwright.store;
    return store.loadProject(project).then(() => ({
      terrain: { ...store.state.terrain.terrain },
      cursor: store.state.paletteMigrationCursor
    }));
  }, legacyCursorProject);

  rec('case D: legacy cursor in terrain object honored',
    caseD.cursor === 2 &&
    caseD.terrain['0000'] === 'rough' &&
    caseD.terrain['0001'] === 'broken',
    `cursor=${caseD.cursor} terrain=${JSON.stringify(caseD.terrain)}`);

  rec('no uncaught console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  rec('palette-migration harness completed', false, err.message);
}

await browser.close();
srv.kill();

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
