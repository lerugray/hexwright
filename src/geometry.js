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
  mountains:  { stroke: '#be8228', width: 4.0, dash: [] },
  impassible: { stroke: '#dc2828', width: 4.0, dash: [] },
  roads:      { stroke: '#c9a06a', width: 3.0, dash: [] },
  rails:      { stroke: '#8a8f98', width: 3.0, dash: [6, 5] }
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
  const mid = edgeMidpoint(code, edgeIndex, grid);
  let best = null;
  let bestD = Infinity;
  const threshold = (hexRadius(grid) * 1.8);
  for (const [other, c] of Object.entries(centers)) {
    if (other === code) continue;
    const d = distance(mid, c);
    if (d < bestD && d < threshold) {
      bestD = d;
      best = other;
    }
  }
  return best;
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
