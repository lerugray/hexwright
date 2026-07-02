// Hexwright geometry helpers

export const TERRAIN_COLORS = {
  water:   { fill: 'rgba(56,112,164,0.40)', line: 'rgba(86,150,210,0.55)' },
  clear:   { fill: 'rgba(190,210,140,0.25)', line: 'rgba(210,225,165,0.45)' },
  desert:  { fill: 'rgba(210,175,90,0.35)',  line: 'rgba(230,200,120,0.50)' },
  rough:   { fill: 'rgba(150,120,80,0.35)',  line: 'rgba(180,150,100,0.50)' },
  woods:   { fill: 'rgba(40,115,40,0.35)',   line: 'rgba(70,150,70,0.50)' },
  swamp:   { fill: 'rgba(120,140,100,0.35)', line: 'rgba(150,170,120,0.50)' }
};

export const HEXSIDE_COLORS = {
  rivers:     { stroke: '#2878ff', width: 3.5, dash: [] },
  mountains:  { stroke: '#c2333b', width: 4.0, dash: [] },
  impassible: { stroke: '#3a3f4a', width: 4.0, dash: [6, 5] },
  roads:      { stroke: '#b96b1f', width: 3.0, dash: [] },
  rails:      { stroke: '#7a4fa3', width: 3.0, dash: [6, 5] }
};

export const EDITABLE_LAYERS = ['rivers', 'mountains', 'impassible', 'roads', 'rails'];
export const ADJACENCY_THRESHOLD = 160;

export function parseCCRR(code) {
  const s = String(code);
  return { col: parseInt(s.slice(0, 2), 10), row: parseInt(s.slice(2), 10) };
}

export function formatCCRR(col, row) {
  return String(col).padStart(2, '0') + String(row).padStart(2, '0');
}

export function hexCenter(code, grid) {
  const { col, row } = parseCCRR(code);
  const xIntercept = grid.x_model?.x_intercept_col0 ?? grid.x_intercept_col0 ?? 0;
  const yIntercept = grid.y_model?.y_intercept_row0 ?? grid.y_intercept_row0 ?? 0;
  const colPitch = grid.col_pitch_x ?? grid.x_model?.col_pitch_x ?? 1;
  const rowPitch = grid.row_pitch_y ?? grid.y_model?.row_pitch_y ?? 1;
  const evenOffset = grid.even_col_y_offset ?? grid.y_model?.even_col_down_offset ?? (rowPitch / 2);
  const x = xIntercept + col * colPitch;
  const offset = (col % 2 === 0) ? evenOffset : 0;
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
  const evenColOffset = grid?.even_col_y_offset ?? grid?.y_model?.even_col_down_offset ?? 0;
  const scheme = evenColOffset >= 0 ? EVEN_DOWN_EDGE_OFFSETS : EVEN_UP_EDGE_OFFSETS;
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
    toleranceFactor = 0.35
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
    for (let edgeIndex = 0; edgeIndex < 6; edgeIndex++) {
      const neighbor = edgeNeighborCode(code, edgeIndex, grid);
      if (!neighbor || !centers[neighbor]) continue;
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
