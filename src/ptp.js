/** Point-to-point map family: node import, edge keys, hit-testing helpers. */

export function nodePairKey(a, b) {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  return sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
}

/** Storage key for one p2p edge: canonical pair + connection type. */
export function ptpEdgeKey(a, b, type) {
  const pair = normalizeNodePair(a, b);
  const t = String(type || '').trim();
  if (!pair || !t) return null;
  return `${nodePairKey(pair.a, pair.b)}|${t}`;
}

export const PTP_PARALLEL_OFFSET = 5;

export function parsePtpEdgeKey(key, fallbackType = '') {
  const parts = String(key || '').split('|');
  if (parts.length === 2) {
    const pair = normalizeNodePair(parts[0], parts[1]);
    if (!pair) return null;
    const type = String(fallbackType || '').trim();
    if (!type) return { a: pair.a, b: pair.b, pairKey: nodePairKey(pair.a, pair.b), type: '', edgeKey: key };
    return {
      a: pair.a, b: pair.b, pairKey: nodePairKey(pair.a, pair.b), type,
      edgeKey: ptpEdgeKey(pair.a, pair.b, type)
    };
  }
  if (parts.length >= 3) {
    const pair = normalizeNodePair(parts[0], parts[1]);
    if (!pair) return null;
    const type = String(parts[2] || fallbackType || '').trim();
    return {
      a: pair.a, b: pair.b, pairKey: nodePairKey(pair.a, pair.b), type,
      edgeKey: ptpEdgeKey(pair.a, pair.b, type)
    };
  }
  return null;
}

/** Migrate legacy pair-only keys (`a|b` -> type) to `a|b|type`. */
export function normalizePtpEdgeMap(map) {
  const out = {};
  for (const [key, type] of Object.entries(map || {})) {
    const parsed = parsePtpEdgeKey(key, type);
    if (!parsed) continue;
    const edgeType = parsed.type || String(type || '').trim();
    if (!edgeType) continue;
    const canon = ptpEdgeKey(parsed.a, parsed.b, edgeType);
    out[canon] = edgeType;
  }
  return out;
}

function perpendicularDelta(na, nb, offsetPx) {
  const dx = nb.x - na.x;
  const dy = nb.y - na.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: (-dy / len) * offsetPx, y: (dx / len) * offsetPx };
}

/** Enumerate edges with render/hit-test offsets for parallel connections on one pair. */
export function enumeratePtpEdges(edgeMap, nodes) {
  const byPair = new Map();
  for (const [key, type] of Object.entries(edgeMap || {})) {
    const parsed = parsePtpEdgeKey(key, type);
    if (!parsed || !parsed.type) continue;
    const na = nodes?.[parsed.a];
    const nb = nodes?.[parsed.b];
    if (!na || !nb) continue;
    const pk = parsed.pairKey;
    if (!byPair.has(pk)) byPair.set(pk, []);
    byPair.get(pk).push({
      a: parsed.a,
      b: parsed.b,
      pairKey: pk,
      type: parsed.type,
      edgeKey: ptpEdgeKey(parsed.a, parsed.b, parsed.type),
      na,
      nb
    });
  }
  const out = [];
  for (const list of byPair.values()) {
    list.sort((e1, e2) => e1.type.localeCompare(e2.type));
    const n = list.length;
    list.forEach((edge, i) => {
      let offset = 0;
      if (n > 1) {
        const step = (2 * PTP_PARALLEL_OFFSET) / (n - 1);
        offset = (i - (n - 1) / 2) * step;
      }
      const delta = perpendicularDelta(edge.na, edge.nb, offset);
      out.push({ ...edge, offset, x1: edge.na.x + delta.x, y1: edge.na.y + delta.y, x2: edge.nb.x + delta.x, y2: edge.nb.y + delta.y });
    });
  }
  return out;
}

export function normalizeNodePair(a, b) {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  if (!sa || !sb || sa === sb) return null;
  return sa < sb ? { a: sa, b: sb } : { a: sb, b: sa };
}

export function validateNodesDocument(data, label = 'nodes') {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Expected ${label} shape: {"meta":{...},"nodes":[{"id","name","x","y"},...]}.`);
  }
  if (!Array.isArray(data.nodes)) {
    throw new Error(`Expected ${label}.nodes to be an array.`);
  }
  const seen = new Set();
  data.nodes.forEach((node, idx) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error(`${label}.nodes[${idx}] must be an object.`);
    }
    const id = String(node.id || '').trim();
    if (!id) throw new Error(`${label}.nodes[${idx}].id must be a non-empty string.`);
    if (seen.has(id)) throw new Error(`${label}.nodes[${idx}].id duplicates "${id}".`);
    seen.add(id);
    if (typeof node.name !== 'string') {
      throw new Error(`${label}.nodes[${idx}].name must be a string.`);
    }
    if (!Number.isFinite(Number(node.x)) || !Number.isFinite(Number(node.y))) {
      throw new Error(`${label}.nodes[${idx}] must have numeric x and y.`);
    }
  });
  return data;
}

export function nodesDocumentToMap(data) {
  const map = {};
  for (const node of data.nodes || []) {
    const id = String(node.id).trim();
    map[id] = {
      id,
      name: String(node.name || id),
      x: Number(node.x),
      y: Number(node.y),
      ...(node.zone != null ? { zone: String(node.zone) } : {})
    };
  }
  return map;
}

export function validateEdgesDocument(data, label = 'edges') {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Expected ${label} shape: {"edges":[{"a","b","type"},...]}.`);
  }
  if (!Array.isArray(data.edges)) {
    throw new Error(`Expected ${label}.edges to be an array.`);
  }
  data.edges.forEach((edge, idx) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
      throw new Error(`${label}.edges[${idx}] must be an object.`);
    }
    const a = String(edge.a || '').trim();
    const b = String(edge.b || '').trim();
    const type = String(edge.type || '').trim();
    if (!a || !b || a === b) {
      throw new Error(`${label}.edges[${idx}] must have distinct a and b node ids.`);
    }
    if (!type) throw new Error(`${label}.edges[${idx}].type must be a non-empty string.`);
    if (a >= b) {
      throw new Error(`${label}.edges[${idx}] must be canonical (a < b); got a=${JSON.stringify(a)}, b=${JSON.stringify(b)}.`);
    }
  });
  return data;
}

export function edgesArrayToMap(edges) {
  const map = {};
  for (const edge of edges || []) {
    const pair = normalizeNodePair(edge.a, edge.b);
    if (!pair) continue;
    const type = String(edge.type).trim();
    if (!type) continue;
    const key = ptpEdgeKey(pair.a, pair.b, type);
    if (!key) continue;
    map[key] = type;
  }
  return map;
}

export function edgesMapToArray(edgeMap) {
  const out = [];
  for (const [key, type] of Object.entries(edgeMap || {})) {
    const parsed = parsePtpEdgeKey(key, type);
    if (!parsed || !parsed.type) continue;
    out.push({ a: parsed.a, b: parsed.b, type: parsed.type });
  }
  out.sort((e1, e2) => {
    const c = e1.a.localeCompare(e2.a);
    if (c) return c;
    const d = e1.b.localeCompare(e2.b);
    if (d) return d;
    return e1.type.localeCompare(e2.type);
  });
  return out;
}

export function countEdgesByType(edgeMap) {
  const counts = {};
  for (const type of Object.values(edgeMap || {})) {
    const key = String(type);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function findOrphanNodeIds(nodes, edgeMap) {
  const connected = new Set();
  for (const key of Object.keys(edgeMap || {})) {
    const parsed = parsePtpEdgeKey(key, edgeMap[key]);
    if (!parsed) continue;
    connected.add(parsed.a);
    connected.add(parsed.b);
  }
  const orphans = [];
  for (const id of Object.keys(nodes || {})) {
    if (!connected.has(id)) orphans.push(id);
  }
  orphans.sort((a, b) => a.localeCompare(b));
  return orphans;
}

export function findMissingNodeRefs(nodes, edgeMap) {
  const missing = [];
  for (const key of Object.keys(edgeMap || {})) {
    const parsed = parsePtpEdgeKey(key, edgeMap[key]);
    if (!parsed) continue;
    for (const id of [parsed.a, parsed.b]) {
      if (!nodes?.[id]) missing.push({ edge: key, nodeId: id });
    }
  }
  return missing;
}

export function findDuplicateEdges(edges) {
  const seen = new Set();
  const dupes = [];
  for (const edge of edges || []) {
    const key = ptpEdgeKey(edge.a, edge.b, edge.type);
    if (!key) continue;
    if (seen.has(key)) dupes.push(key);
    else seen.add(key);
  }
  return dupes;
}

export function nearestNode(worldPt, nodes, tolerance) {
  if (!worldPt || !nodes) return null;
  let best = null;
  let bestD = tolerance;
  for (const node of Object.values(nodes)) {
    const d = Math.hypot(node.x - worldPt.x, node.y - worldPt.y);
    if (d <= bestD) {
      bestD = d;
      best = node;
    }
  }
  return best;
}

function distPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const nx = x1 + t * dx;
  const ny = y1 + t * dy;
  return Math.hypot(px - nx, py - ny);
}

export function nearestPtpEdge(worldPt, nodes, edgeMap, tolerance) {
  if (!worldPt || !nodes || !edgeMap) return null;
  let best = null;
  let bestD = tolerance;
  for (const edge of enumeratePtpEdges(edgeMap, nodes)) {
    const d = distPointToSegment(worldPt.x, worldPt.y, edge.x1, edge.y1, edge.x2, edge.y2);
    if (d <= bestD) {
      bestD = d;
      best = { a: edge.a, b: edge.b, edgeKey: edge.edgeKey, type: edge.type, pairKey: edge.pairKey };
    }
  }
  return best;
}

export function ptpEdgesOnPair(edgeMap, a, b) {
  const pair = normalizeNodePair(a, b);
  if (!pair) return [];
  const prefix = `${nodePairKey(pair.a, pair.b)}|`;
  const legacy = nodePairKey(pair.a, pair.b);
  const out = [];
  for (const [key, type] of Object.entries(edgeMap || {})) {
    if (key === legacy || key.startsWith(prefix)) {
      const parsed = parsePtpEdgeKey(key, type);
      if (parsed?.type) out.push({ a: parsed.a, b: parsed.b, type: parsed.type, edgeKey: ptpEdgeKey(parsed.a, parsed.b, parsed.type) });
    }
  }
  out.sort((e1, e2) => e1.type.localeCompare(e2.type));
  return out;
}

export const NODE_HIT_TOLERANCE = 14;
export const PTP_EDGE_HIT_TOLERANCE = 10;
