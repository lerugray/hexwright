import { ProjectStore } from '../src/store.js';
import { edgeNeighborCode } from '../src/geometry.js';

const results = [];
const rec = (name, ok, note = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

const grid = {
  grid_version: 1,
  image_full: [500, 500],
  n_cols: 4,
  n_rows: 4,
  x_intercept_col0: 50,
  col_pitch_x: 100,
  y_intercept_row0: 50,
  row_pitch_y: 100,
  even_col_y_offset: 50
};
const store = new ProjectStore();
await store.loadProject({
  name: 'default elevation fixture',
  grid,
  terrain: { terrain: { '0101': 'sea', '0201': 'coast' } },
  elevation: {},
  defaultElevation: 1,
  palette: {}
});

const center = '0101';
const neighbors = [];
for (let i = 0; i < 6; i++) {
  const code = edgeNeighborCode(center, i, grid);
  if (code && !neighbors.includes(code)) neighbors.push(code);
}
const edgeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
const slopeFor = (a, b) => store.deriveSlopes().get(edgeKey(a, b));

rec('fixture has enough adjacent in-grid hexes', neighbors.length >= 3, neighbors.join(','));
rec('both-unpainted default-level hexes derive no edge', !slopeFor(center, neighbors[0]));

store.setElevation(neighbors[0], 2);
rec('painted coast level 2 next to unpainted sea default 1 derives a slope',
  slopeFor(center, neighbors[0])?.type === 'slope');

store.setElevation(neighbors[0], 3);
const escarpment = slopeFor(center, neighbors[0]);
rec('delta >= 2 against the default derives an escarpment',
  escarpment?.type === 'escarpment' && escarpment.delta === 2,
  JSON.stringify(escarpment));

store.setElevation(neighbors[1], 1);
rec('painted level 1 equals default level 1 and derives no edge',
  !slopeFor(center, neighbors[1]));

const elevationExport = store.exportElevationObject();
const elevationJson = JSON.parse(store.exportElevationJson());
rec('elevation export includes the defaultElevation header',
  elevationExport.defaultElevation === 1 && elevationJson.defaultElevation === 1);
rec('elevation export remains painted-only',
  Object.keys(elevationExport.elevation).length === 2
    && elevationExport.elevation[neighbors[0]] === 3
    && elevationExport.elevation[neighbors[1]] === 1,
  JSON.stringify(elevationExport.elevation));

const sidesExport = store.exportHexsidesObject();
rec('hexside export derives escarpment edges with the default applied',
  sidesExport.escarpments.some((edge) => edgeKey(edge.a, edge.b) === edgeKey(center, neighbors[0])));

const projectExport = store.exportProjectObject();
rec('project/autosave export preserves defaultElevation', projectExport.defaultElevation === 1);

store.state.elevation = {};
store.state.defaultElevation = 0;
store.setElevation(neighbors[0], 2);
rec('defaultElevation 0 preserves painted-only derivation',
  !slopeFor(center, neighbors[0]));
store.setElevation(center, 3);
rec('defaultElevation 0 still derives edges between two painted hexes',
  slopeFor(center, neighbors[0])?.type === 'slope');
rec('disabled default is omitted from elevation export',
  !Object.hasOwn(store.exportElevationObject(), 'defaultElevation'));

const fails = results.filter((ok) => !ok).length;
console.log(`\n=== ${results.length - fails}/${results.length} passed ===`);
process.exit(fails ? 1 : 0);
