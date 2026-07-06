/** Point-to-point map family: node import, edge keys, hit-testing helpers. */

export function nodePairKey(a, b) {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  return sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
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
    const key = nodePairKey(pair.a, pair.b);
    map[key] = String(edge.type).trim();
  }
  return map;
}

export function edgesMapToArray(edgeMap) {
  const out = [];
  for (const [key, type] of Object.entries(edgeMap || {})) {
    const parts = key.split('|');
    if (parts.length !== 2) continue;
    const pair = normalizeNodePair(parts[0], parts[1]);
    if (!pair || !type) continue;
    out.push({ a: pair.a, b: pair.b, type: String(type) });
  }
  out.sort((e1, e2) =>
    (e1.a < e2.a ? -1 : e1.a > e2.a ? 1 : e1.b < e2.b ? -1 : e1.b > e2.b ? 1 : 0)
  );
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
    const parts = key.split('|');
    if (parts.length === 2) {
      connected.add(parts[0]);
      connected.add(parts[1]);
    }
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
    const parts = key.split('|');
    if (parts.length !== 2) continue;
    for (const id of parts) {
      if (!nodes?.[id]) missing.push({ edge: key, nodeId: id });
    }
  }
  return missing;
}

export function findDuplicateEdges(edges) {
  const seen = new Set();
  const dupes = [];
  for (const edge of edges || []) {
    const key = nodePairKey(edge.a, edge.b);
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
  for (const [key, type] of Object.entries(edgeMap)) {
    const parts = key.split('|');
    if (parts.length !== 2) continue;
    const na = nodes[parts[0]];
    const nb = nodes[parts[1]];
    if (!na || !nb) continue;
    const d = distPointToSegment(worldPt.x, worldPt.y, na.x, na.y, nb.x, nb.y);
    if (d <= bestD) {
      bestD = d;
      best = { a: parts[0], b: parts[1], edgeKey: key, type };
    }
  }
  return best;
}

export const NODE_HIT_TOLERANCE = 14;
export const PTP_EDGE_HIT_TOLERANCE = 10;
