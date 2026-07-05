// Hexwright geometry helpers

/** Palette terrain entry -> canvas fill/line; optional composite `colors: [c1, c2]`. */
export function paletteTerrainColors(entry, mode = 'overlay') {
  if (!entry) return null;
  const composite = Array.isArray(entry.colors) && entry.colors.length >= 2
    ? [entry.colors[0], entry.colors[1]]
    : null;
  const base = entry.color || composite?.[0];
  if (!base) return null;
  const suffix = (alpha) => (mode === 'full' ? '' : alpha);
  const paint = (c, alpha) => `${c}${suffix(alpha)}`;
  if (composite) {
    return {
      composite: true,
      fill: [paint(composite[0], '40'), paint(composite[1], '40')],
      line: paint(composite[0], '73')
    };
  }
  return { fill: paint(base, '40'), line: paint(base, '73') };
}

/** Short terrain label: palette `abbr` when set (empty string suppresses); else derived. */
export function terrainAbbrForKey(key, entry) {
  if (entry && Object.prototype.hasOwnProperty.call(entry, 'abbr')) return entry.abbr;
  const parts = String(key || '').split('_').filter(Boolean);
  if (parts.length > 1) {
    return parts.map((p) => p.charAt(0).toUpperCase()).join('+');
  }
  const p = (parts[0] || '').toLowerCase();
  const singles = {
    woods: 'W', forest: 'W', swamp: 'SW', marsh: 'SW', urban: 'U',
    mountain: 'MT', rough: 'MT', water: 'WTR', lake: 'WTR', clear: ''
  };
  if (Object.prototype.hasOwnProperty.call(singles, p)) return singles[p];
  return p ? p.charAt(0).toUpperCase() : '';
}

/** CSS background for terrain swatches (solid or diagonal split). */
export function terrainSwatchBackground(entry, fallback = '#888') {
  if (Array.isArray(entry?.colors) && entry.colors.length >= 2) {
    const [c1, c2] = entry.colors;
    return `linear-gradient(135deg, ${c1} 50%, ${c2} 50%)`;
  }
  return entry?.color || fallback;
}

export const TERRAIN_COLORS = {
  water:   { fill: 'rgba(56,112,164,0.40)', line: 'rgba(86,150,210,0.55)' },
  clear:   { fill: 'rgba(190,210,140,0.25)', line: 'rgba(210,225,165,0.45)' },
  desert:  { fill: 'rgba(210,175,90,0.35)',  line: 'rgba(230,200,120,0.50)' },
  rough:   { fill: 'rgba(150,120,80,0.35)',  line: 'rgba(180,150,100,0.50)' },
  broken:  { fill: 'rgba(150,120,80,0.35)',  line: 'rgba(180,150,100,0.50)' },
  woods:   { fill: 'rgba(40,115,40,0.35)',   line: 'rgba(70,150,70,0.50)' },
  swamp:   { fill: 'rgba(120,140,100,0.35)', line: 'rgba(150,170,120,0.50)' }
};

export const HEXSIDE_COLORS = {
  rivers:     { stroke: '#2878ff', width: 3.5, dash: [] },
  mountains:  { stroke: '#c2333b', width: 4.0, dash: [] },
  impassible: { stroke: '#3a3f4a', width: 4.0, dash: [6, 5] },
  roads:      { stroke: '#b96b1f', width: 3.0, dash: [] },
  rails:      { stroke: '#7a4fa3', width: 3.0, dash: [6, 5] },
  border:     { stroke: '#d926a9', width: 3.5, dash: [7, 4] }
};

export const EDITABLE_LAYERS = ['rivers', 'mountains', 'impassible', 'roads', 'rails', 'border'];
export const ADJACENCY_THRESHOLD = 160;
export const EDGE_HIT_TOLERANCE = 0.35;
export const EDGE_SNAP_ASSIST_TOLERANCE = 0.65;

export function parseCCRR(code) {
  const s = String(code);
  return { col: parseInt(s.slice(0, 2), 10), row: parseInt(s.slice(2), 10) };
}

export function formatCCRR(col, row) {
  return String(col).padStart(2, '0') + String(row).padStart(2, '0');
}

export function gridVersion(grid) {
  if (!grid || typeof grid !== 'object') return 1;
  const v = Number(grid.grid_version);
  if (Number.isFinite(v) && v >= 1) return v;
  // Legacy grids have no grid_version field.
  return 1;
}

export function getRowCountsByParity(grid) {
  if (!grid || typeof grid !== 'object') return null;
  const rcbp = grid.row_counts_by_parity;
  if (rcbp && typeof rcbp === 'object' && Number.isFinite(rcbp.even) && Number.isFinite(rcbp.odd)) {
    return rcbp;
  }
  return null;
}

function latticeImageSize(grid) {
  const imageFull = grid?.image_full;
  if (!Array.isArray(imageFull) || imageFull.length < 2) return null;
  const [imgW, imgH] = imageFull;
  if (!Number.isFinite(imgW) || !Number.isFinite(imgH) || imgW <= 0 || imgH <= 0) return null;
  return { imgW, imgH };
}

// When n_cols / n_rows are absent (legacy v1 grids like GotA), derive iteration
// bounds from image_full + pitch + intercept so enumerateGridLattice is not
// capped at the arbitrary 99×99 fallback. Per-cell image_full clipping remains
// the authoritative gate for off-map phantom hexes.
function colCountFromImage(grid) {
  const size = latticeImageSize(grid);
  const colPitch = grid?.col_pitch_x ?? grid?.x_model?.col_pitch_x;
  if (!size || !colPitch || colPitch <= 0) return null;
  const xIntercept = grid.x_model?.x_intercept_col0 ?? grid.x_intercept_col0 ?? 0;
  const margin = colPitch / 2;
  return Math.max(1, Math.floor((size.imgW + margin - xIntercept) / colPitch) + 1);
}

function rowCountFromImage(grid) {
  const size = latticeImageSize(grid);
  const rowPitch = grid?.row_pitch_y ?? grid?.y_model?.row_pitch_y;
  if (!size || !rowPitch || rowPitch <= 0) return null;
  const yIntercept = grid.y_model?.y_intercept_row0 ?? grid.y_intercept_row0 ?? 0;
  let parityOffset = rowPitch / 2;
  if (gridVersion(grid) >= 2) {
    parityOffset = Math.abs(grid.odd_col_y_offset ?? rowPitch / 2);
  } else {
    parityOffset = Math.abs(grid.even_col_y_offset ?? grid.y_model?.even_col_down_offset ?? rowPitch / 2);
  }
  const margin = rowPitch / 2;
  return Math.max(1, Math.floor((size.imgH + margin - yIntercept - parityOffset) / rowPitch) + 1);
}

export function rowCount(col, grid) {
  const v = gridVersion(grid);
  const nCols = grid.n_cols ?? grid.x_model?.n_cols;
  if (Number.isFinite(nCols) && nCols > 0) {
    if (col < 0 || col >= nCols) return 0;
  }
  if (v >= 2) {
    const rcbp = getRowCountsByParity(grid);
    if (!rcbp) {
      throw new Error(
        'grid_version >= 2 requires "row_counts_by_parity" with even/odd counts (jagged-row schema).'
      );
    }
    return col % 2 === 0 ? rcbp.even : rcbp.odd;
  }
  // v1 rectangular grids use n_rows; else derive from image_full; 99 is last resort.
  const nRows = grid.n_rows ?? grid.y_model?.n_rows;
  if (Number.isFinite(nRows) && nRows > 0) return nRows;
  return rowCountFromImage(grid) ?? 99;
}

export function colCount(grid) {
  const nCols = grid?.n_cols ?? grid?.x_model?.n_cols;
  if (Number.isFinite(nCols) && nCols > 0) return nCols;
  return colCountFromImage(grid) ?? 99;
}

export function isValidCell(col, row, grid) {
  if (row < 0) return false;
  return row < rowCount(col, grid);
}

export function hexCenter(code, grid) {
  const { col, row } = parseCCRR(code);
  const xIntercept = grid.x_model?.x_intercept_col0 ?? grid.x_intercept_col0 ?? 0;
  const yIntercept = grid.y_model?.y_intercept_row0 ?? grid.y_intercept_row0 ?? 0;
  const colPitch = grid.col_pitch_x ?? grid.x_model?.col_pitch_x ?? 1;
  const rowPitch = grid.row_pitch_y ?? grid.y_model?.row_pitch_y ?? 1;
  // v2 uses odd_col_y_offset; v1 uses even_col_y_offset / even_col_down_offset.
  let offset = 0;
  if (gridVersion(grid) >= 2) {
    const oddOffset = grid.odd_col_y_offset ?? (rowPitch / 2);
    if (col % 2 === 1) offset = oddOffset;
  } else {
    const evenOffset = grid.even_col_y_offset ?? grid.y_model?.even_col_down_offset ?? (rowPitch / 2);
    if (col % 2 === 0) offset = evenOffset;
  }
  const x = xIntercept + col * colPitch;
  const y = yIntercept + row * rowPitch + offset;
  return { x, y };
}

export function hexRadius(grid) {
  // flat-top side length / circumradius = 2/3 of column pitch
  return grid.col_pitch_x / 1.5;
}

export function hexPolygon(code, grid) {
  const c = hexCenter(code, grid);
  const r = hexRadius(grid);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i; // 0, 60, ... 300 (flat-top)
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return pts;
}

export function edgeMidpoint(code, edgeIndex, grid) {
  const poly = hexPolygon(code, grid);
  const a = poly[edgeIndex];
  const b = poly[(edgeIndex + 1) % 6];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const EVEN_DOWN_EDGE_OFFSETS = {
  even: [[1, 1], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, 0]],
  odd: [[1, 0], [0, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
};

const EVEN_UP_EDGE_OFFSETS = {
  even: [[1, 0], [0, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]],
  odd: [[1, 1], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, 0]]
};

function edgeOffsetsForCode(code, grid) {
  const { col } = parseCCRR(code);
  const v = gridVersion(grid);
  // Which parity is shifted down? v1 = even; v2 = odd. If the offset value is
  // negative the shift is up, which inverts the neighbor table.
  let evenShiftedDown;
  if (v >= 2) {
    const oddOffset = grid?.odd_col_y_offset ?? 0;
    evenShiftedDown = oddOffset < 0; // odd-down == even-up
  } else {
    const evenColOffset = grid?.even_col_y_offset ?? grid?.y_model?.even_col_down_offset ?? 0;
    evenShiftedDown = evenColOffset >= 0;
  }
  const scheme = evenShiftedDown ? EVEN_DOWN_EDGE_OFFSETS : EVEN_UP_EDGE_OFFSETS;
  return (col % 2 === 0) ? scheme.even : scheme.odd;
}

export function edgeNeighborCode(code, edgeIndex, grid) {
  const { col, row } = parseCCRR(code);
  const offsets = edgeOffsetsForCode(code, grid);
  const pair = offsets[edgeIndex];
  if (!pair) return null;
  return formatCCRR(col + pair[0], row + pair[1]);
}

export function sharedEdgeEndpoints(aCode, bCode, grid) {
  const ca = hexCenter(aCode, grid);
  const cb = hexCenter(bCode, grid);
  const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return null;
  const r = hexRadius(grid);
  const half = r / 2;
  const ux = -dy / dist;
  const uy = dx / dist;
  return {
    a: { x: mid.x + ux * half, y: mid.y + uy * half },
    b: { x: mid.x - ux * half, y: mid.y - uy * half }
  };
}

export function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

export function buildLandIndex(terrain, grid) {
  const centers = {};
  const codes = Object.keys(terrain.terrain || terrain || {});
  for (const code of codes) {
    centers[code] = hexCenter(code, grid);
  }
  return centers;
}

export function validateGrid(grid, { source = 'grid' } = {}) {
  if (!grid || typeof grid !== 'object') return;
  const v = gridVersion(grid);
  if (v >= 2) {
    if (!getRowCountsByParity(grid)) {
      throw new Error(
        `${source}: grid_version ${v} requires "row_counts_by_parity" with even/odd counts (jagged-row schema).`
      );
    }
  }
}

export function enumerateGridLattice(grid) {
  if (!grid) return {};
  const imageFull = grid.image_full;
  if (!Array.isArray(imageFull) || imageFull.length < 2) return {};
  const colPitch = grid.col_pitch_x ?? grid.x_model?.col_pitch_x ?? 0;
  const rowPitch = grid.row_pitch_y ?? grid.y_model?.row_pitch_y ?? 0;
  if (colPitch <= 0 || rowPitch <= 0) return {};

  validateGrid(grid, { source: 'enumerateGridLattice' });

  const imgW = imageFull[0];
  const imgH = imageFull[1];
  const xMin = -colPitch / 2;
  const xMax = imgW + colPitch / 2;
  const yMin = -rowPitch / 2;
  const yMax = imgH + rowPitch / 2;
  const nCols = colCount(grid);

  const centers = {};
  for (let col = 0; col < nCols; col++) {
    const maxRow = rowCount(col, grid);
    for (let row = 0; row < maxRow; row++) {
      const code = formatCCRR(col, row);
      const c = hexCenter(code, grid);
      if (c.x < xMin || c.x > xMax || c.y < yMin || c.y > yMax) continue;
      centers[code] = c;
    }
  }
  return centers;
}

export function buildAdjacency(centers, threshold = ADJACENCY_THRESHOLD) {
  const codes = Object.keys(centers);
  const adj = {};
  for (const code of codes) adj[code] = [];
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      const a = codes[i], b = codes[j];
      if (distance(centers[a], centers[b]) < threshold) {
        adj[a].push(b);
        adj[b].push(a);
      }
    }
  }
  return adj;
}

export function edgeNeighbor(code, edgeIndex, centers, grid) {
  const neighbor = edgeNeighborCode(code, edgeIndex, grid);
  if (!neighbor) return null;
  return centers && centers[neighbor] ? neighbor : null;
}

export function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function screenToWorld(pt, view) {
  const s = view.baseScale * view.zoom;
  return { x: (pt.x - view.panX) / s, y: (pt.y - view.panY) / s };
}

export function worldToScreen(pt, view) {
  const s = view.baseScale * view.zoom;
  return { x: pt.x * s + view.panX, y: pt.y * s + view.panY };
}

export function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function normalizePair(a, b) {
  return a < b ? { a, b } : { a: b, b: a };
}

export function pairsEqual(p1, p2) {
  return (p1.a === p2.a && p1.b === p2.b) || (p1.a === p2.b && p1.b === p2.a);
}

export function nearestEdge(px, py, opts = {}) {
  const {
    view,
    grid,
    centers,
    hexAtScreen,
    toleranceFactor = EDGE_HIT_TOLERANCE
  } = opts;
  if (!grid || !centers || typeof hexAtScreen !== 'function' || !view) return null;

  let hex = hexAtScreen({ x: px, y: py });
  if (!hex) {
    // Border clicks can land exactly on polygon edges where point-in-polygon
    // returns false; probe a tiny fixed screen-space ring to recover a host hex.
    const probes = [
      [-2, 0], [2, 0], [0, -2], [0, 2],
      [-2, -2], [2, -2], [-2, 2], [2, 2]
    ];
    for (const [dx, dy] of probes) {
      hex = hexAtScreen({ x: px + dx, y: py + dy });
      if (hex) break;
    }
  }
  if (!hex || !centers[hex]) return null;

  const world = screenToWorld({ x: px, y: py }, view);
  const tolerance = hexRadius(grid) * toleranceFactor;
  const candidates = new Map();

  const addHexCandidates = (code) => {
    const { col, row } = parseCCRR(code);
    if (!isValidCell(col, row, grid)) return;
    for (let edgeIndex = 0; edgeIndex < 6; edgeIndex++) {
      const neighbor = edgeNeighborCode(code, edgeIndex, grid);
      if (!neighbor || !centers[neighbor]) continue;
      const nbCell = parseCCRR(neighbor);
      if (!isValidCell(nbCell.col, nbCell.row, grid)) continue;
      const pair = normalizePair(code, neighbor);
      const edgeKey = pairKey(pair.a, pair.b);
      if (candidates.has(edgeKey)) continue;
      candidates.set(edgeKey, {
        edgeKey,
        a: pair.a,
        b: pair.b,
        hex: code,
        neighbor,
        edgeIndex
      });
    }
  };

  addHexCandidates(hex);

  const poly = hexPolygon(hex, grid);
  const nearVertex = poly.some(pt => distance(world, pt) <= tolerance * 1.15);
  if (nearVertex) {
    for (let edgeIndex = 0; edgeIndex < 6; edgeIndex++) {
      const neighbor = edgeNeighborCode(hex, edgeIndex, grid);
      if (!neighbor || !centers[neighbor]) continue;
      addHexCandidates(neighbor);
    }
  }

  let best = null;
  let bestDistance = Infinity;
  for (const cand of candidates.values()) {
    const mid = edgeMidpoint(cand.hex, cand.edgeIndex, grid);
    const d = distance(world, mid);
    if (d < bestDistance) {
      bestDistance = d;
      best = cand;
    }
  }

  if (!best || bestDistance > tolerance) return null;
  return { ...best, distance: bestDistance, tolerance };
}
