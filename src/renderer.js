import {
  TERRAIN_COLORS, HEXSIDE_COLORS, paletteTerrainColors, terrainAbbrForKey,
  hexCenter, hexPolygon, sharedEdgeEndpoints, pointInPolygon,
  worldToScreen, screenToWorld, edgeNeighbor, edgeMidpoint, hexRadius, nearestEdge,
  isValidCell, parseCCRR, EDGE_HIT_TOLERANCE, EDGE_SNAP_ASSIST_TOLERANCE
} from './geometry.js';
import {
  nearestNode, nearestPtpEdge, enumeratePtpEdges, ptpEdgesOnPair,
  NODE_HIT_TOLERANCE, PTP_EDGE_HIT_TOLERANCE, PTP_PARALLEL_OFFSET
} from './ptp.js';

const TERRAIN_LABEL_MIN_SCALE = 0.08;
const TERRAIN_LABEL_FADE_SCALE = 0.14;

// Solid near-white casing: traced ink must pop off BOTH the cream paper and the
// map's own printed features (blue-on-blue rivers were unreadable at 0.82 parchment).
const INK_CASING = 'rgba(255,255,255,0.95)';
const SNAP_PREVIEW_STROKE = '#00c8e8';

export class MapRenderer {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.store = store;

    this.view = { baseScale: 1, zoom: 1, panX: 0, panY: 0 };
    this.selectedHex = null;
    this.selectedHexes = new Set();
    this.groupHoverHexes = new Set();
    this.onSelectionChange = null;
    this.highlighted = { hex: null, edge: null, neighbor: null };

    this.viewMode = 'both';          // 'map' | 'classification' | 'both'
    this.terrainFillAlpha = 1;       // View-only terrain fill opacity (UI slider)
    this.terrainFillVisible = true;  // View-only toggle: terrain fill layer
    this.terrainLabelsVisible = false; // View-only terrain abbr labels (default off)
    this.terrainLabelScale = 1;      // View-only label-size multiplier (UI slider, 0.5-3x)
    this.hexsideStrokeAlpha = 1;     // View-only painted hexside ink opacity (UI slider)
    this.hexsideVisibility = {};     // View-only per-feature visibility map
    this.mapDim = 0;                 // View-only raster dimming in both/map modes
    this.nudgeMode = false;          // drag/arrow-key the scan under the grid
    this.nudgeDrag = null;
    this.anomalyMode = false;

    this.brush = {
      active: false,
      terrainKey: null,
      onPaint: null,
      onToggle: null,
      onShiftClick: null,
      onStrokeStart: null,
      onStrokeEnd: null
    };
    this.brushStroke = null;
    this.edgePaint = {
      active: false,
      featureKey: null,
      onToggle: null,
      onSet: null,
      onStrokeStart: null,
      onStrokeEnd: null
    };
    this.edgePaintStroke = null;
    this.featurePaint = {
      active: false,
      featureType: null,
      onPlace: null,
      onEdit: null
    };

    this.ptpEdgePaint = {
      active: false,
      typeKey: null,
      pendingNodeId: null,
      onNodeClick: null,
      onEdgeSelect: null,
      onEdgeDelete: null
    };
    this.selectedPtpEdge = null;
    this.ptpHover = null;

    this.ptpFeaturePaint = {
      active: false,
      onNodeClick: null
    };
    // Inspect tool for p2p: node-then-edge hit precedence, no painting. Node
    // wins within NODE_HIT_TOLERANCE, else the nearest (possibly parallel)
    // edge — same precedence _ptpClickAt uses for the edge-trace mode.
    this.ptpInspect = {
      active: false,
      onNodeClick: null,
      onEdgeSelect: null
    };
    this.nodeFeatureVisibility = {}; // View-only per-feature visibility map (node badges)

    this.shiftHeld = false;
    this.altHeld = false;
    this.lastPointerPt = null;
    this.snapPreview = null;

    this.isDragging = false;
    this.dragStart = null;
    this.panStart = null;
    this.clickMoved = false;

    this.resize();
    window.addEventListener('resize', () => this.resize());

    this._bindPointer();
    this._bindShiftSnap();
    this._bindAltErase();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    this.draw();
  }

  setStore(store) {
    this.store = store;
  }

  setBaseScale() {
    const img = this.store.state.mapImage;
    if (!img || !img.naturalWidth || !this.store.state.imageFull[0]) {
      this.view.baseScale = 1;
      return;
    }
    this.view.baseScale = img.naturalWidth / this.store.state.imageFull[0];
  }

  fitView() {
    const img = this.store.state.mapImage;
    const [fw, fh] = this.store.state.imageFull || [];
    let imgW, imgH;
    if (img && img.naturalWidth) {
      imgW = img.naturalWidth;
      imgH = img.naturalHeight;
    } else if (fw && fh) {
      imgW = fw;
      imgH = fh;
    } else {
      return;
    }
    const pad = 24;
    const zoom = Math.min((this.width - pad * 2) / imgW, (this.height - pad * 2) / imgH);
    this.view.zoom = Math.max(0.02, zoom);
    this.view.panX = (this.width - imgW * this.view.zoom) / 2;
    this.view.panY = (this.height - imgH * this.view.zoom) / 2;
    this.draw();
  }

  setViewMode(mode) {
    if (!['map', 'classification', 'both'].includes(mode)) return;
    this.viewMode = mode;
    this.draw();
  }

  setAnomalyMode(on) {
    this.anomalyMode = !!on;
    this.draw();
  }

  setBrush(config) {
    this.brush = { ...this.brush, ...config };
    if (!this.brush.active) this.brushStroke = null;
  }

  setNudgeMode(on) {
    this.nudgeMode = !!on;
    if (!this.nudgeMode) this.nudgeDrag = null;
    this.canvas.parentElement.style.cursor = this.nudgeMode ? 'move' : '';
  }

  setEdgePaint(config) {
    this.edgePaint = { ...this.edgePaint, ...config };
    if (!this.edgePaint.active) {
      this.edgePaintStroke = null;
      this.clearHighlight();
      this._setSnapPreview(null);
    }
  }

  setFeaturePaint(config) {
    const next = { ...this.featurePaint, ...config };
    // Preserve callbacks when toggling active/type only.
    if (config.onPlace === undefined && this.featurePaint.onPlace) next.onPlace = this.featurePaint.onPlace;
    if (config.onEdit === undefined && this.featurePaint.onEdit) next.onEdit = this.featurePaint.onEdit;
    this.featurePaint = next;
  }

  setPtpEdgePaint(config) {
    this.ptpEdgePaint = { ...this.ptpEdgePaint, ...config };
    if (!this.ptpEdgePaint.active) {
      this.ptpEdgePaint.pendingNodeId = null;
      this.ptpHover = null;
    }
    this.draw();
  }

  setPtpFeaturePaint(config) {
    this.ptpFeaturePaint = { ...this.ptpFeaturePaint, ...config };
    if (!this.ptpFeaturePaint.active) this.ptpHover = null;
    this.draw();
  }

  setPtpInspect(config) {
    this.ptpInspect = { ...this.ptpInspect, ...config };
    if (!this.ptpInspect.active) this.ptpHover = null;
    this.draw();
  }

  clearPtpSelection() {
    this.selectedPtpEdge = null;
    this.ptpEdgePaint.pendingNodeId = null;
    this.ptpHover = null;
    this.draw();
  }

  setSelectedPtpEdge(edge) {
    this.selectedPtpEdge = edge;
    this.draw();
  }

  _ptpHitTolerance(scaleFactor) {
    const s = this.view.baseScale * this.view.zoom;
    return scaleFactor / Math.max(s, 0.02);
  }

  _ptpNodeAtScreen(pt) {
    const world = screenToWorld(pt, this.view);
    return nearestNode(world, this.store.state.nodes, this._ptpHitTolerance(NODE_HIT_TOLERANCE));
  }

  _ptpEdgeAtScreen(pt) {
    const world = screenToWorld(pt, this.view);
    return nearestPtpEdge(
      world,
      this.store.state.nodes,
      this.store.state.ptpEdges,
      this._ptpHitTolerance(PTP_EDGE_HIT_TOLERANCE)
    );
  }

  _ptpEdgeFeatureDecl(typeKey) {
    const palette = this.store.getPalette();
    return (palette?.edgeFeatures || []).find((f) => f.key === typeKey) || null;
  }

  _ptpEdgeStroke(feature, selected = false) {
    if (!feature) return { color: '#888', width: 2, dash: [] };
    return {
      color: feature.color || '#888',
      width: selected ? 4 : (feature.width || 3),
      dash: feature.dash ? [6, 4] : []
    };
  }

  _edgeSnapAssistActive(e = null) {
    if (!this.edgePaint.active) return false;
    if (e && 'shiftKey' in e) return !!e.shiftKey;
    return this.shiftHeld;
  }

  _altEraseActive(e = null) {
    if (!this.edgePaint.active) return false;
    if (e && 'altKey' in e) return !!e.altKey;
    return this.altHeld;
  }

  nearestEdgeAtScreen(pt, { assist = false } = {}) {
    const snapAssist = assist || this._edgeSnapAssistActive();
    return nearestEdge(pt.x, pt.y, {
      view: this.view,
      grid: this.store.state.grid,
      centers: this.store.centers,
      hexAtScreen: (screenPt) => this.hexAtScreen(screenPt),
      toleranceFactor: snapAssist ? EDGE_SNAP_ASSIST_TOLERANCE : EDGE_HIT_TOLERANCE
    });
  }

  _setSnapPreview(hit) {
    const nextKey = hit?.edgeKey ?? null;
    if ((this.snapPreview?.edgeKey ?? null) === nextKey) return;
    this.snapPreview = hit
      ? {
          hex: hit.hex,
          edgeIndex: hit.edgeIndex,
          neighbor: hit.neighbor,
          edgeKey: hit.edgeKey,
          a: hit.a,
          b: hit.b
        }
      : null;
    this.draw();
  }

  _updateEdgePaintHover(pt, e = null) {
    if (e && 'shiftKey' in e) this.shiftHeld = !!e.shiftKey;
    const assist = this._edgeSnapAssistActive(e);
    const hit = this.nearestEdgeAtScreen(pt, { assist });
    if (assist) {
      this._setSnapPreview(hit);
      if (this.highlighted.hex) {
        this.highlighted = { hex: null, edge: null, neighbor: null };
        this.draw();
      }
    } else {
      if (this.snapPreview) this._setSnapPreview(null);
      if (hit) this.setHighlight(hit.hex, hit.edgeIndex, hit.neighbor);
      else this.clearHighlight();
    }
    return hit;
  }

  _bindShiftSnap() {
    const syncShift = (down) => {
      if (this.shiftHeld === down) return;
      this.shiftHeld = down;
      if (!down) this._setSnapPreview(null);
      if (this.edgePaint.active && this.lastPointerPt) {
        this._updateEdgePaintHover(this.lastPointerPt);
      }
    };

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') syncShift(true);
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') syncShift(false);
    });
    window.addEventListener('blur', () => syncShift(false));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') syncShift(false);
    });
  }

  _bindAltErase() {
    const syncAlt = (down) => {
      if (this.altHeld === down) return;
      this.altHeld = down;
    };

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Alt') syncAlt(true);
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') syncAlt(false);
    });
    window.addEventListener('blur', () => syncAlt(false));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') syncAlt(false);
    });
  }

  hexAtScreen(pt) {
    const world = screenToWorld(pt, this.view);
    return this._hexAt(world);
  }

  /**
   * True when the click landed nearest a MISSING-NEIGHBOR hexside (map edge /
   * hole in the lattice). Those edges are unpaintable by design — every
   * hexside is a pair of two real hexes — so the UI should say so instead of
   * silently ignoring the click (bit Ray on col-00's off-map edges, 2026-07-04).
   */
  boundaryEdgeNear(pt) {
    const grid = this.store.state.grid;
    const hex = this.hexAtScreen(pt);
    if (!hex || !grid) return false;
    const s = this.view.baseScale * this.view.zoom;
    const tol = hexRadius(grid) * 0.5 * s;
    for (let i = 0; i < 6; i++) {
      if (edgeNeighbor(hex, i, this.store.centers, grid)) continue;
      const mid = edgeMidpoint(hex, i, grid);
      if (!mid) continue;
      const sp = worldToScreen(mid, this.view);
      if (Math.hypot(sp.x - pt.x, sp.y - pt.y) <= tol) return true;
    }
    return false;
  }

  hexAtWorld(pt) {
    return this._hexAt(pt);
  }

  worldToScreen(pt) {
    return worldToScreen(pt, this.view);
  }

  screenToWorld(pt) {
    return screenToWorld(pt, this.view);
  }

  _bindPointer() {
    const wrap = this.canvas.parentElement;

    // Middle-click must never trigger the browser's autoscroll/paste-scroll.
    wrap.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

    wrap.addEventListener('pointerdown', (e) => {
      if (e.button === 1) {
        // Middle-button drag pans in EVERY mode — paint modes own left-drag,
        // so this is the only way to move the map without leaving the tool.
        e.preventDefault();
        this.middlePan = true;
        this.isDragging = true;
        this.clickMoved = false;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.panStart = { x: this.view.panX, y: this.view.panY };
        wrap.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;
      if (this.store.isPtp() && this.ptpEdgePaint.active) {
        this.isDragging = true;
        this.clickMoved = false;
        this.dragStart = { x: e.clientX, y: e.clientY };
        wrap.setPointerCapture(e.pointerId);
        return;
      }
      if (this.store.isPtp() && this.ptpFeaturePaint.active) {
        this.isDragging = true;
        this.clickMoved = false;
        this.dragStart = { x: e.clientX, y: e.clientY };
        wrap.setPointerCapture(e.pointerId);
        return;
      }
      if (this.store.isPtp() && this.ptpInspect.active) {
        this.isDragging = true;
        this.clickMoved = false;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.panStart = { x: this.view.panX, y: this.view.panY };
        wrap.setPointerCapture(e.pointerId);
        return;
      }
      if (this.nudgeMode) {
        this.isDragging = true;
        const off = this.store.state.mapOffset || [0, 0];
        this.nudgeDrag = { x: e.clientX, y: e.clientY, off: [off[0], off[1]] };
        wrap.setPointerCapture(e.pointerId);
        return;
      }
      if (this.edgePaint.active) {
        this.isDragging = true;
        this.clickMoved = false;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.edgePaintStroke = {
          moved: false,
          strokeOpened: false,
          touched: new Set()
        };
        const pt = this._eventToScreen(e);
        this.lastPointerPt = pt;
        this._updateEdgePaintHover(pt, e);
        wrap.setPointerCapture(e.pointerId);
        return;
      }
      if (this.brush.active) {
        this.isDragging = true;
        this.clickMoved = false;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.brushStroke = {
          moved: false,
          strokeOpened: false,
          touched: new Set()
        };
        wrap.setPointerCapture(e.pointerId);
        return;
      }
      if (this.featurePaint.active) {
        this.isDragging = true;
        this.clickMoved = false;
        this.dragStart = { x: e.clientX, y: e.clientY };
        wrap.setPointerCapture(e.pointerId);
        return;
      }
      this.isDragging = true;
      this.clickMoved = false;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.panStart = { x: this.view.panX, y: this.view.panY };
      wrap.setPointerCapture(e.pointerId);
    });

    wrap.addEventListener('pointermove', (e) => {
      if (this.middlePan && this.isDragging) {
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        this.view.panX = this.panStart.x + dx;
        this.view.panY = this.panStart.y + dy;
        this.draw();
        return;
      }
      if (this.store.isPtp() && this.ptpEdgePaint.active) {
        const pt = this._eventToScreen(e);
        if (!this.isDragging) {
          const node = this._ptpNodeAtScreen(pt);
          const edge = node ? null : this._ptpEdgeAtScreen(pt);
          this.ptpHover = node || edge;
          this.draw();
          return;
        }
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        if (Math.hypot(dx, dy) > 3) this.clickMoved = true;
        return;
      }
      if (this.store.isPtp() && this.ptpFeaturePaint.active) {
        const pt = this._eventToScreen(e);
        if (!this.isDragging) {
          this.ptpHover = this._ptpNodeAtScreen(pt);
          this.draw();
          return;
        }
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        if (Math.hypot(dx, dy) > 3) this.clickMoved = true;
        return;
      }
      if (this.store.isPtp() && this.ptpInspect.active) {
        const pt = this._eventToScreen(e);
        if (!this.isDragging) {
          const node = this._ptpNodeAtScreen(pt);
          const edge = node ? null : this._ptpEdgeAtScreen(pt);
          this.ptpHover = node || edge;
          this.draw();
          return;
        }
        // Drag pans, like hex-mode Inspect — inspect has nothing to paint.
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        if (Math.hypot(dx, dy) > 3) this.clickMoved = true;
        this.view.panX = this.panStart.x + dx;
        this.view.panY = this.panStart.y + dy;
        this.draw();
        return;
      }
      if (this.nudgeMode) {
        if (!this.isDragging || !this.nudgeDrag) return;
        const s = this.view.baseScale * this.view.zoom;
        const nx = this.nudgeDrag.off[0] + (e.clientX - this.nudgeDrag.x) / s;
        const ny = this.nudgeDrag.off[1] + (e.clientY - this.nudgeDrag.y) / s;
        this.store.setMapOffset(nx, ny);
        this.draw();
        return;
      }
      if (this.edgePaint.active) {
        const pt = this._eventToScreen(e);
        this.lastPointerPt = pt;
        if (e && 'altKey' in e) this.altHeld = !!e.altKey;
        const hit = this._updateEdgePaintHover(pt, e);

        if (!this.isDragging) return;

        const session = this.edgePaintStroke;
        if (!session) return;
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        if (!session.moved && Math.hypot(dx, dy) > 3) {
          session.moved = true;
          if (this.edgePaint.onStrokeStart) {
            this.edgePaint.onStrokeStart();
            session.strokeOpened = true;
          }
        }
        if (session.moved && hit) {
          if (!session.touched.has(hit.edgeKey)) {
            session.touched.add(hit.edgeKey);
            if (this.edgePaint.onSet) {
              this.edgePaint.onSet(hit, { eraseAll: this._altEraseActive(e) });
            }
          }
        }
        return;
      }
      if (this.brush.active) {
        const pt = this._eventToScreen(e);
        this.lastPointerPt = pt;
        if (!this.isDragging) {
          this._hoverAt(e);
          return;
        }
        const session = this.brushStroke;
        if (!session) return;
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        if (!session.moved && Math.hypot(dx, dy) > 3) {
          session.moved = true;
          if (this.brush.onStrokeStart) {
            this.brush.onStrokeStart();
            session.strokeOpened = true;
          }
        }
        if (session.moved) {
          const hex = this.hexAtScreen(pt);
          if (hex && !session.touched.has(hex)) {
            session.touched.add(hex);
            if (this.brush.onPaint) this.brush.onPaint(hex);
          }
        }
        return;
      }
      if (this.featurePaint.active) {
        const pt = this._eventToScreen(e);
        if (!this.isDragging) return;
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        if (Math.hypot(dx, dy) > 3) this.clickMoved = true;
        return;
      }
      if (!this.isDragging) {
        this._hoverAt(e);
        return;
      }
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      if (Math.hypot(dx, dy) > 3) this.clickMoved = true;
      this.view.panX = this.panStart.x + dx;
      this.view.panY = this.panStart.y + dy;
      this.draw();
    });

    wrap.addEventListener('pointerup', (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      wrap.releasePointerCapture(e.pointerId);
      if (this.middlePan) {
        this.middlePan = false;
        return;
      }
      if (this.store.isPtp() && this.ptpEdgePaint.active) {
        const pt = this._eventToScreen(e);
        if (!this.clickMoved) this._ptpClickAt(pt, e);
        return;
      }
      if (this.store.isPtp() && this.ptpFeaturePaint.active) {
        const pt = this._eventToScreen(e);
        if (!this.clickMoved) {
          const node = this._ptpNodeAtScreen(pt);
          if (node && this.ptpFeaturePaint.onNodeClick) {
            this.ptpFeaturePaint.onNodeClick(node.id, { altClear: !!e.altKey });
          }
        }
        return;
      }
      if (this.store.isPtp() && this.ptpInspect.active) {
        const pt = this._eventToScreen(e);
        if (!this.clickMoved) {
          const node = this._ptpNodeAtScreen(pt);
          if (node) {
            if (this.ptpInspect.onNodeClick) this.ptpInspect.onNodeClick(node.id);
            return;
          }
          const edge = this._ptpEdgeAtScreen(pt);
          if (edge) {
            if (this.ptpInspect.onEdgeSelect) this.ptpInspect.onEdgeSelect(edge);
            return;
          }
          this.clearPtpSelection();
          this.onPtpClear?.();
        }
        return;
      }
      if (this.nudgeMode) {
        this.nudgeDrag = null;
        return;
      }
      if (this.edgePaint.active) {
        const pt = this._eventToScreen(e);
        this.lastPointerPt = pt;
        if (e && 'shiftKey' in e) this.shiftHeld = !!e.shiftKey;
        if (e && 'altKey' in e) this.altHeld = !!e.altKey;
        const hit = this.nearestEdgeAtScreen(pt, { assist: this._edgeSnapAssistActive(e) });
        if (!this._edgeSnapAssistActive(e)) {
          if (hit) this.setHighlight(hit.hex, hit.edgeIndex, hit.neighbor);
          else this.clearHighlight();
        }
        const session = this.edgePaintStroke;
        this.edgePaintStroke = null;
        if (session) {
          if (session.moved) {
            if (hit && !session.touched.has(hit.edgeKey)) {
              if (this.edgePaint.onSet) {
                this.edgePaint.onSet(hit, { eraseAll: this._altEraseActive(e) });
              }
            }
            if (session.strokeOpened && this.edgePaint.onStrokeEnd) {
              this.edgePaint.onStrokeEnd();
            }
          } else if (hit) {
            if (this._altEraseActive(e)) {
              if (this.edgePaint.onSet) this.edgePaint.onSet(hit, { eraseAll: true });
            } else if (this.edgePaint.onToggle) {
              this.edgePaint.onToggle(hit);
            }
          } else if (this.edgePaint.onBoundary && this.boundaryEdgeNear(pt)) {
            this.edgePaint.onBoundary();
          }
        }
        return;
      }
      if (this.brush.active) {
        const pt = this._eventToScreen(e);
        const hex = this.hexAtScreen(pt);
        const session = this.brushStroke;
        this.brushStroke = null;
        if (hex && e.shiftKey && this.brush.onShiftClick) {
          this.brush.onShiftClick(hex);
          return;
        }
        if (session) {
          if (session.moved) {
            if (hex && !session.touched.has(hex)) {
              if (this.brush.onPaint) this.brush.onPaint(hex);
            }
            if (session.strokeOpened && this.brush.onStrokeEnd) {
              this.brush.onStrokeEnd();
            }
          } else if (hex && this.brush.onToggle) {
            this.brush.onToggle(hex);
          }
        }
        return;
      }
      if (this.featurePaint.active) {
        const pt = this._eventToScreen(e);
        const hex = this.hexAtScreen(pt);
        if (hex) {
          if (this._canMultiSelect(e)) {
            this._toggleSelectedHex(hex);
          } else {
            this.selectedHexes.clear();
            this.selectedHex = hex;
            this.draw();
            this._notifySelectionChange();
            this.onHexSelect?.(hex, pt);
          }
        }
        return;
      }
      if (!this.clickMoved) {
        this._clickAt(e);
      }
    });

    wrap.addEventListener('pointerleave', (e) => {
      if (e && wrap.hasPointerCapture?.(e.pointerId)) return;
      this.isDragging = false;
      if (this.edgePaint.active) {
        const session = this.edgePaintStroke;
        this.edgePaintStroke = null;
        if (session && session.strokeOpened && this.edgePaint.onStrokeEnd) {
          this.edgePaint.onStrokeEnd();
        }
      }
      if (this.brush.active) {
        const session = this.brushStroke;
        this.brushStroke = null;
        if (session && session.strokeOpened && this.brush.onStrokeEnd) {
          this.brush.onStrokeEnd();
        }
      }
    });

    wrap.addEventListener('pointercancel', () => {
      this.isDragging = false;
      const edgeSession = this.edgePaintStroke;
      this.edgePaintStroke = null;
      if (edgeSession && edgeSession.strokeOpened && this.edgePaint.onStrokeEnd) {
        this.edgePaint.onStrokeEnd();
      }
      const brushSession = this.brushStroke;
      this.brushStroke = null;
      if (brushSession && brushSession.strokeOpened && this.brush.onStrokeEnd) {
        this.brush.onStrokeEnd();
      }
    });

    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      this.zoomAt(pointer, factor);
    }, { passive: false });
  }

  zoomAt(screenPt, factor) {
    const oldZoom = this.view.zoom;
    const newZoom = Math.max(0.02, Math.min(40, oldZoom * factor));
    if (newZoom === oldZoom) return;
    const sOld = this.view.baseScale * oldZoom;
    const sNew = this.view.baseScale * newZoom;
    this.view.panX = screenPt.x - (screenPt.x - this.view.panX) * (newZoom / oldZoom);
    this.view.panY = screenPt.y - (screenPt.y - this.view.panY) * (newZoom / oldZoom);
    this.view.zoom = newZoom;
    this.draw();
  }

  _eventToScreen(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _hoverAt(e) {
    const pt = this._eventToScreen(e);
    this.lastPointerPt = pt;
    if (this.edgePaint.active) {
      this._updateEdgePaintHover(pt, e);
      const hit = this.nearestEdgeAtScreen(pt, { assist: this._edgeSnapAssistActive(e) });
      if (hit) this.canvas.title = `${hit.a}|${hit.b}`;
      else this.canvas.title = '';
      return;
    }
    const world = screenToWorld(pt, this.view);
    const hit = this._hexAt(world);
    if (hit) {
      this.canvas.title = hit;
    } else {
      this.canvas.title = '';
    }
  }

  _canMultiSelect(e) {
    return !!(e?.shiftKey && !this.edgePaint.active && !this.brush.active && !this.nudgeMode);
  }

  _notifySelectionChange() {
    this.onSelectionChange?.(new Set(this.selectedHexes));
  }

  _toggleSelectedHex(code) {
    if (!code) return;
    if (this.selectedHexes.has(code)) this.selectedHexes.delete(code);
    else this.selectedHexes.add(code);
    this.selectedHex = code;
    this.draw();
    this._notifySelectionChange();
  }

  clearHexSelection() {
    this.selectedHexes.clear();
    this.selectedHex = null;
    this.groupHoverHexes.clear();
    this.draw();
    this._notifySelectionChange();
  }

  setGroupHover(codes) {
    this.groupHoverHexes = new Set(codes || []);
    this.draw();
  }

  clearGroupHover() {
    if (!this.groupHoverHexes.size) return;
    this.groupHoverHexes.clear();
    this.draw();
  }

  _ptpClickAt(pt, e) {
    const altDelete = !!(e?.altKey);
    const node = this._ptpNodeAtScreen(pt);
    if (node) {
      if (this.ptpEdgePaint.onNodeClick) {
        this.ptpEdgePaint.onNodeClick(node.id, { altDelete });
      }
      return;
    }
    const edge = this._ptpEdgeAtScreen(pt);
    if (edge) {
      if (altDelete) {
        if (this.ptpEdgePaint.onEdgeDelete) this.ptpEdgePaint.onEdgeDelete(edge);
        return;
      }
      if (this.ptpEdgePaint.onEdgeSelect) this.ptpEdgePaint.onEdgeSelect(edge);
      return;
    }
    this.clearPtpSelection();
    this.onPtpClear?.();
  }

  _clickAt(e) {
    const pt = this._eventToScreen(e);
    const world = screenToWorld(pt, this.view);
    const hit = this._hexAt(world);
    // Edge-inspector highlights paint the neighbor hex; clear so map click shows one hex only.
    this.clearHighlight();
    if (!hit) {
      this.selectedHex = null;
      this.selectedHexes.clear();
      this.groupHoverHexes.clear();
      this.draw();
      this._notifySelectionChange();
      this.onHexSelect?.(null);
      return;
    }
    if (this._canMultiSelect(e)) {
      this._toggleSelectedHex(hit);
      return;
    }
    this.selectedHexes.clear();
    this.selectedHex = hit;
    this.draw();
    this._notifySelectionChange();
    this.onHexSelect?.(hit, pt);
  }

  _hexAt(worldPt) {
    if (!this.store.centers) return null;
    const codes = Object.keys(this.store.centers);
    const grid = this.store.state.grid;
    // quick center-distance cull then point-in-polygon
    let nearest = null;
    let nearestD = Infinity;
    for (const code of codes) {
      const c = this.store.centers[code];
      const d = Math.hypot(c.x - worldPt.x, c.y - worldPt.y);
      if (d < nearestD && d < grid.col_pitch_x * 1.5) {
        nearest = code;
        nearestD = d;
      }
    }
    if (nearest) {
      const poly = hexPolygon(nearest, grid);
      if (pointInPolygon(worldPt, poly)) return nearest;
    }
    // fallback full scan, restricted to valid cells so phantom jagged-row
    // hexes are never clickable.
    for (const code of codes) {
      const poly = hexPolygon(code, grid);
      if (pointInPolygon(worldPt, poly)) {
        const { col, row } = parseCCRR(code);
        if (isValidCell(col, row, grid)) return code;
      }
    }
    return null;
  }

  draw() {
    const ctx = this.ctx;
    const { width, height } = this;
    const state = this.store.state;
    const img = state.mapImage;

    ctx.clearRect(0, 0, width, height);

    const hasGrid = state.grid && this.store.centers;
    const hasPtp = this.store.isPtp() && Object.keys(state.nodes || {}).length > 0;
    if (!img && !hasGrid && !hasPtp) {
      ctx.fillStyle = '#0b0c0e';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#555';
      ctx.font = '14px var(--mono)';
      ctx.fillText('Load a project to begin', 20, height / 2);
      return;
    }

    if (hasPtp) {
      if (img) {
        this._drawBaseMap(ctx, this.view);
        if (this.mapDim > 0) {
          ctx.save();
          ctx.fillStyle = `rgba(10,11,14,${this.mapDim})`;
          ctx.fillRect(0, 0, width, height);
          ctx.restore();
        }
      } else {
        ctx.fillStyle = '#eaddcf';
        ctx.fillRect(0, 0, width, height);
      }
      this._drawPtpEdges(ctx, this.view);
      this._drawPtpNodes(ctx, this.view);
      return;
    }

    // Map mode: base map + traces only.
    // Classification mode: parchment background, no map/traces.
    // Both: current behavior (map + traces + classification overlay).
    if (this.viewMode !== 'classification' && img) {
      this._drawBaseMap(ctx, this.view);
      this._drawTraces(ctx, this.view);
      if (this.mapDim > 0) {
        ctx.save();
        ctx.fillStyle = `rgba(10,11,14,${this.mapDim})`;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = '#eaddcf';
      ctx.fillRect(0, 0, width, height);
    }

    if (this.viewMode !== 'map' && state.grid && this.store.centers) {
      const fillMode = this.viewMode === 'classification' ? 'full' : 'overlay';
      const terrainFillEnabled = fillMode === 'full' ? true : this.terrainFillVisible !== false;
      if (terrainFillEnabled) {
        const fillAlpha = fillMode === 'overlay'
          ? Math.max(0, Math.min(1, this.terrainFillAlpha ?? 1))
          : 1;
        if (fillAlpha < 1) {
          ctx.save();
          ctx.globalAlpha = fillAlpha;
          this._drawHexFills(ctx, this.view, fillMode);
          ctx.restore();
        } else {
          this._drawHexFills(ctx, this.view, fillMode);
        }
      }
      if (this.terrainLabelsVisible) {
        this._drawTerrainLabels(ctx, this.view);
      }
      this._drawHexsides(ctx, this.view);
      this._drawFeatureGlyphs(ctx, this.view);
    }

    if (state.grid && this.store.centers) {
      this._drawGrid(ctx, this.view);
    }

    this._drawSelection(ctx, this.view);
    this._drawHighlights(ctx, this.view);
    this._drawSnapPreview(ctx, this.view);

    if (this.anomalyMode) {
      this._drawAnomalies(ctx, this.view);
    }
  }

  _drawBaseMap(ctx, view) {
    const s = view.baseScale * view.zoom;
    const img = this.store.state.mapImage;
    // Stretch to the WORLD extent (imageFull — the grid's calibration space),
    // never the image's natural size: a downscaled raster drawn at natural size
    // renders smaller than the grid by exactly natural/imageFull (the ~4x
    // map-vs-grid mismatch hit 2026-07-01).
    const [fw, fh] = this.store.state.imageFull || [];
    const off = this.store.state.mapOffset || [0, 0];
    ctx.save();
    ctx.translate(view.panX + off[0] * s, view.panY + off[1] * s);
    ctx.scale(s, s);
    ctx.drawImage(img, 0, 0, fw || img.naturalWidth, fh || img.naturalHeight);
    ctx.restore();
  }

  _drawPtpEdges(ctx, view) {
    const nodes = this.store.state.nodes || {};
    const edges = this.store.state.ptpEdges || {};
    const s = view.baseScale * view.zoom;
    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(s, s);
    ctx.lineCap = 'round';
    for (const edge of enumeratePtpEdges(edges, nodes)) {
      const selected = this.selectedPtpEdge?.edgeKey === edge.edgeKey;
      const feature = this._ptpEdgeFeatureDecl(edge.type);
      const stroke = this._ptpEdgeStroke(feature, selected);
      ctx.beginPath();
      ctx.moveTo(edge.x1, edge.y1);
      ctx.lineTo(edge.x2, edge.y2);
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width / s;
      ctx.setLineDash(stroke.dash.map((d) => d / s));
      ctx.stroke();
    }
    const pending = this.ptpEdgePaint.pendingNodeId;
    if (pending && nodes[pending] && this.ptpHover?.id && nodes[this.ptpHover.id]) {
      const a = nodes[pending];
      const b = nodes[this.ptpHover.id];
      if (b.id !== pending) {
        const feature = this._ptpEdgeFeatureDecl(this.ptpEdgePaint.typeKey);
        const stroke = this._ptpEdgeStroke(feature, false);
        const pairEdges = ptpEdgesOnPair(edges, pending, b.id);
        const draftType = String(this.ptpEdgePaint.typeKey || '').trim();
        const types = pairEdges.map((e) => e.type);
        if (draftType && !types.includes(draftType)) types.push(draftType);
        types.sort();
        let offset = 0;
        if (draftType && types.length > 1) {
          const idx = types.indexOf(draftType);
          const step = (2 * PTP_PARALLEL_OFFSET) / (types.length - 1);
          offset = (idx - (types.length - 1) / 2) * step;
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ox = (-dy / len) * offset;
        const oy = (dx / len) * offset;
        ctx.beginPath();
        ctx.moveTo(a.x + ox, a.y + oy);
        ctx.lineTo(b.x + ox, b.y + oy);
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width / s;
        ctx.setLineDash(stroke.dash.map((d) => d / s));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  _drawPtpNodes(ctx, view) {
    const nodes = this.store.state.nodes || {};
    const s = view.baseScale * view.zoom;
    const pending = this.ptpEdgePaint.pendingNodeId;
    const hoverId = this.ptpHover?.id || null;
    const nodeFeatures = this.store.getPalette()?.nodeFeatures || [];
    const visibility = this.nodeFeatureVisibility || {};
    const nodeAttrs = this.store.state.nodeAttrs || {};
    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(s, s);
    for (const node of Object.values(nodes)) {
      const selected = pending === node.id;
      const hovered = hoverId === node.id;
      const r = (selected || hovered ? 7 : 5) / s;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = selected ? '#ff7a1a' : (hovered ? '#ffd080' : '#f0f0f0');
      ctx.fill();
      ctx.strokeStyle = selected ? '#ff7a1a' : '#1a1a1a';
      ctx.lineWidth = 1.5 / s;
      ctx.stroke();
      const label = node.name || node.id;
      ctx.font = `${Math.max(10, 11 / s)}px var(--font-data)`;
      ctx.fillStyle = '#1a1a1a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, node.x, node.y + r + 2 / s);

      this._drawNodeFeatureBadges(ctx, node, r, s, nodeFeatures, visibility, nodeAttrs[node.id]);
    }
    ctx.restore();
  }

  // Tagged-node badge chips: small colored labels stacked horizontally above the
  // node marker, one per visible+tagged palette nodeFeature (in palette order).
  // Content per kind: flag -> feature.badge glyph; level -> the number itself;
  // enum -> the first two letters of the value, uppercased.
  _drawNodeFeatureBadges(ctx, node, nodeRadius, s, nodeFeatures, visibility, attrs) {
    if (!attrs || !nodeFeatures.length) return;
    const chips = [];
    for (const f of nodeFeatures) {
      if (visibility[f.key] === false) continue;
      const val = attrs[f.key];
      if (val === undefined || val === null) continue;
      let text;
      // Legacy migration: a feature retyped flag->level in the palette can carry
      // `true` from older sessions — render the flag glyph, never "true". The
      // value itself is preserved until the operator types a real number.
      if (f.kind === 'level' && val !== true) text = String(val);
      else if (f.kind === 'enum') text = String(val).slice(0, 2).toUpperCase();
      else text = f.badge || (f.label || f.key).slice(0, 1).toUpperCase();
      chips.push({ text, color: f.color || '#888' });
    }
    if (!chips.length) return;

    const chipH = 11 / s;
    const chipGap = 2 / s;
    const chipPad = 3 / s;
    ctx.font = `${Math.max(8, 9 / s)}px var(--font-data)`;
    const widths = chips.map((c) => Math.max(chipH, ctx.measureText(c.text).width + chipPad * 2));
    const totalW = widths.reduce((a, b) => a + b, 0) + chipGap * (chips.length - 1);
    let cx = node.x - totalW / 2;
    const cy = node.y - nodeRadius - chipH - 3 / s;
    for (let i = 0; i < chips.length; i++) {
      const w = widths[i];
      ctx.fillStyle = chips[i].color;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx, cy, w, chipH, chipH / 3);
      else ctx.rect(cx, cy, w, chipH);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(chips[i].text, cx + w / 2, cy + chipH / 2 + 0.5 / s);
      cx += w + chipGap;
    }
  }

  _drawTraces(ctx, view) {
    const s = view.baseScale * view.zoom;
    const [fw, fh] = this.store.state.imageFull || [];
    const off = this.store.state.mapOffset || [0, 0];
    for (const trace of this.store.state.traces) {
      if (!trace.on || !trace.img) continue;
      ctx.save();
      ctx.globalAlpha = trace.opacity;
      // Traces are registered to the scan raster — they nudge WITH the map.
      ctx.translate(view.panX + off[0] * s, view.panY + off[1] * s);
      ctx.scale(s, s);
      ctx.drawImage(trace.img, 0, 0, fw || trace.img.naturalWidth, fh || trace.img.naturalHeight);
      ctx.restore();
    }
  }

  _terrainColor(type, mode = 'overlay') {
    const palette = this.store.getPalette();
    if (palette && palette.terrain) {
      const t = palette.terrain.find(x => x.key === type);
      const resolved = paletteTerrainColors(t, mode);
      if (resolved) return resolved;
    }
    return TERRAIN_COLORS[type] || TERRAIN_COLORS.clear;
  }

  _traceHexPath(ctx, poly) {
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
  }

  _fillHexTerrain(ctx, poly, colors) {
    this._traceHexPath(ctx, poly);
    if (colors.composite) {
      const xs = poly.map(p => p.x);
      const ys = poly.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const [fillA, fillB] = colors.fill;
      ctx.save();
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(minX, minY);
      ctx.lineTo(maxX, minY);
      ctx.lineTo(minX, maxY);
      ctx.closePath();
      ctx.fillStyle = fillA;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(maxX, minY);
      ctx.lineTo(maxX, maxY);
      ctx.lineTo(minX, maxY);
      ctx.closePath();
      ctx.fillStyle = fillB;
      ctx.fill();
      ctx.restore();
      this._traceHexPath(ctx, poly);
    } else {
      ctx.fillStyle = colors.fill;
      ctx.fill();
    }
    ctx.strokeStyle = colors.line;
    ctx.stroke();
  }

  _drawHexFills(ctx, view, mode = 'overlay') {
    const s = view.baseScale * view.zoom;
    const grid = this.store.state.grid;
    const terrain = this.store.state.terrain.terrain || {};
    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(s, s);
    ctx.lineWidth = 1.2 / s;
    // Paint every terrain code — do not gate on store.centers. Hexsides already
    // use grid geometry directly; terrain must render when centers is lattice-only
    // (hexside-tracing autosave) or enumerateGridLattice returned {}.
    for (const code of Object.keys(terrain)) {
      const type = terrain[code];
      if (!type) continue;
      const colors = this._terrainColor(type, mode);
      const poly = hexPolygon(code, grid);
      this._fillHexTerrain(ctx, poly, colors);
    }
    ctx.restore();
  }

  // Canvas 2D's `font` setter parses a raw CSS <font> value with no cascade —
  // it does NOT resolve CSS custom properties (var(--font-data, ...) is an
  // invalid font-family token, so the WHOLE assignment is silently rejected
  // and the previous font is kept, size and all). Resolve --font-data to its
  // concrete computed value once and reuse the literal string.
  _dataFontFamily() {
    if (!this._dataFontFamilyCache) {
      let v = '';
      try { v = getComputedStyle(this.canvas).getPropertyValue('--font-data').trim(); } catch (_) { /* detached */ }
      this._dataFontFamilyCache = v || 'monospace';
    }
    return this._dataFontFamilyCache;
  }

  _drawTerrainLabels(ctx, view) {
    const s = view.baseScale * view.zoom;
    const effScale = s;
    if (effScale < TERRAIN_LABEL_MIN_SCALE) return;
    const fade = effScale >= TERRAIN_LABEL_FADE_SCALE
      ? 1
      : (effScale - TERRAIN_LABEL_MIN_SCALE) / (TERRAIN_LABEL_FADE_SCALE - TERRAIN_LABEL_MIN_SCALE);

    const grid = this.store.state.grid;
    const terrain = this.store.state.terrain.terrain || {};
    const names = this.store.state.names || {};
    const palette = this.store.getPalette();
    const centers = this.store.centers || {};
    const codes = new Set(Object.keys(terrain));
    for (const code of Object.keys(names)) {
      if (names[code] && centers[code]) codes.add(code);
    }

    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (fade < 1) ctx.globalAlpha = fade;

    const dataFont = this._dataFontFamily();
    const drawLabelText = (text, x, y, fontPx, weight = 600) => {
      ctx.font = `${weight} ${fontPx / s}px ${dataFont}`;
      ctx.lineWidth = 3 / s;
      ctx.strokeStyle = INK_CASING;
      ctx.fillStyle = '#1a1a1a';
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    };

    for (const code of codes) {
      const type = terrain[code];
      const entry = type ? palette?.terrain?.find((x) => x.key === type) : null;
      const abbr = type ? terrainAbbrForKey(type, entry) : '';
      const name = names[code]?.trim() || '';
      if (!abbr && !name) continue;

      const center = hexCenter(code, grid);
      const r = hexRadius(grid);
      const labelScale = Math.max(0.5, Math.min(3, this.terrainLabelScale ?? 1));
      const abbrPx = Math.max(8, Math.min(14, r * 0.38 * s)) * labelScale;
      const namePx = Math.max(7, Math.min(11, r * 0.28 * s)) * labelScale;
      if (abbr && abbrPx < 6 && !name) continue;

      const x = center.x;
      if (abbr) {
        drawLabelText(abbr, x, center.y - r * 0.33, abbrPx, 600);
      }
      if (name) {
        const nameY = abbr ? center.y - r * 0.08 : center.y - r * 0.33;
        drawLabelText(name, x, nameY, namePx, 500);
      }
    }
    ctx.restore();
  }

  _drawGrid(ctx, view) {
    const s = view.baseScale * view.zoom;
    const grid = this.store.state.grid;
    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(s, s);
    // Near-black for contrast over parchment scans (was white @22% — invisible
    // on light maps; Ray 2026-07-01).
    ctx.strokeStyle = 'rgba(10,10,10,0.65)';
    ctx.lineWidth = 0.9 / s;
    for (const code of Object.keys(this.store.centers)) {
      const poly = hexPolygon(code, grid);
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  _hexsideStyle(featureKey) {
    const palette = this.store.getPalette();
    if (palette && palette.hexsideFeatures) {
      const f = palette.hexsideFeatures.find(x => x.key === featureKey);
      if (f) {
        return {
          stroke: f.color,
          width: f.key === 'rail' ? 3.0 : 4.2,
          dash: f.dash ? [6, 5] : []
        };
      }
    }
    return HEXSIDE_COLORS[featureKey] || { stroke: '#888', width: 3.0, dash: [] };
  }

  _drawHexsides(ctx, view, { fullOpacity = false } = {}) {
    const s = view.baseScale * view.zoom;
    const grid = this.store.state.grid;
    const palette = this.store.getPalette();
    const strokeAlpha = fullOpacity ? 1 : Math.max(0, Math.min(1, this.hexsideStrokeAlpha ?? 1));
    const isCrossing = (key) => {
      const f = palette && palette.hexsideFeatures ? palette.hexsideFeatures.find(x => x.key === key) : null;
      return !!(f && f.kind === 'crossing');
    };
    ctx.save();
    if (strokeAlpha < 1) ctx.globalAlpha = strokeAlpha;
    ctx.translate(view.panX, view.panY);
    ctx.scale(s, s);
    const spacing = 3.5 / s;
    const visible = this.hexsideVisibility || {};
    for (const [edgeKey, features] of Object.entries(this.store.state.hexsides || {})) {
      if (!features || !features.length) continue;
      const visibleFeatures = features.filter((key) => visible[key] !== false);
      if (!visibleFeatures.length) continue;
      const [a, b] = edgeKey.split('|');
      if (!a || !b) continue;
      const ep = sharedEdgeEndpoints(a, b, grid);
      if (!ep) continue;
      const dx = ep.b.x - ep.a.x;
      const dy = ep.b.y - ep.a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = -dy / len;  // perpendicular unit
      const uy = dx / len;
      const tx = dx / len;   // along-edge unit
      const ty = dy / len;

      // Edge features (river/ridge/cliff/...) run ALONG the hexside — parallel offset lines.
      const edgeFeats = visibleFeatures.filter(k => !isCrossing(k));
      const offBaseE = -((edgeFeats.length - 1) * spacing) / 2;
      const edgeLines = edgeFeats.map((featureKey, idx) => {
        const style = this._hexsideStyle(featureKey);
        const off = offBaseE + idx * spacing;
        return { style, off };
      });
      edgeLines.forEach(({ style, off }) => {
        ctx.beginPath();
        ctx.strokeStyle = INK_CASING;
        ctx.lineWidth = (style.width * 2) / s;
        ctx.lineCap = 'round';
        ctx.setLineDash([]);
        ctx.moveTo(ep.a.x + ux * off, ep.a.y + uy * off);
        ctx.lineTo(ep.b.x + ux * off, ep.b.y + uy * off);
        ctx.stroke();
      });
      edgeLines.forEach(({ style, off }) => {
        ctx.beginPath();
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = style.width / s;
        ctx.lineCap = 'round';
        ctx.setLineDash(style.dash.map(v => v / s));
        ctx.moveTo(ep.a.x + ux * off, ep.a.y + uy * off);
        ctx.lineTo(ep.b.x + ux * off, ep.b.y + uy * off);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // Crossing features (road/rail/bridge) CROSS the hexside — short perpendicular
      // rungs at the edge midpoint, offset along the edge from each other.
      const crossFeats = visibleFeatures.filter(isCrossing);
      if (crossFeats.length) {
        const mx = (ep.a.x + ep.b.x) / 2;
        const my = (ep.a.y + ep.b.y) / 2;
        const rungBase = Math.min(len * 0.30, 11 / s);
        // Wide separation so stacked crossings (road + bridge) read as two
        // distinct rungs; the bridge rung draws LONGER so "the bridge spans"
        // is legible at a glance next to its road.
        const cSpacing = 9.0 / s;
        const offBaseC = -((crossFeats.length - 1) * cSpacing) / 2;
        const crossLines = crossFeats.map((featureKey, idx) => {
          const style = this._hexsideStyle(featureKey);
          const along = offBaseC + idx * cSpacing;
          const cx = mx + tx * along;
          const cy = my + ty * along;
          const coreWidth = style.width + 0.6;
          const rung = featureKey === 'bridge' ? rungBase * 1.5 : rungBase;
          return { style, cx, cy, coreWidth, rung };
        });
        crossLines.forEach(({ cx, cy, coreWidth, rung }) => {
          ctx.beginPath();
          ctx.strokeStyle = INK_CASING;
          ctx.lineWidth = (coreWidth * 2) / s;
          ctx.lineCap = 'round';
          ctx.setLineDash([]);
          ctx.moveTo(cx - ux * rung, cy - uy * rung);
          ctx.lineTo(cx + ux * rung, cy + uy * rung);
          ctx.stroke();
        });
        crossLines.forEach(({ style, cx, cy, coreWidth, rung }) => {
          ctx.beginPath();
          ctx.strokeStyle = style.stroke;
          ctx.lineWidth = coreWidth / s;
          ctx.lineCap = 'round';
          ctx.setLineDash(style.dash.map(v => v / s));
          ctx.moveTo(cx - ux * rung, cy - uy * rung);
          ctx.lineTo(cx + ux * rung, cy + uy * rung);
          ctx.stroke();
          ctx.setLineDash([]);
        });
      }
    }
    ctx.restore();
  }

  _firstNumericAttr(attrs, attrSchema) {
    if (!attrs || typeof attrs !== 'object') return null;
    const keys = (attrSchema || []).filter((a) => a && a.type === 'number').map((a) => a.key);
    const scan = keys.length ? keys : Object.keys(attrs);
    for (const key of scan) {
      const val = attrs[key];
      if (typeof val === 'number' && Number.isFinite(val)) return val;
    }
    return null;
  }

  _drawFeatureGlyphs(ctx, view) {
    const s = view.baseScale * view.zoom;
    const grid = this.store.state.grid;
    const palette = this.store.getPalette();
    if (!palette || !palette.hexFeatures) return;
    const featureTypes = palette.hexFeatures || [];
    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const [code, byType] of Object.entries(this.store.state.features || {})) {
      if (!byType || typeof byType !== 'object') continue;
      const center = hexCenter(code, grid);
      const r = hexRadius(grid);
      const entries = Object.keys(byType).map((type) => {
        const pf = featureTypes.find((x) => x.key === type);
        return { type, rec: byType[type], pf };
      }).filter((e) => e.pf && e.pf.glyph);
      if (!entries.length) continue;

      const fontPx = Math.max(10, Math.min(26, r * 0.65 * s));
      const labelPx = Math.max(8, Math.min(14, r * 0.38 * s));
      const step = fontPx / s;
      ctx.font = `${fontPx}px serif`;

      const drawLabel = (text, x, y) => {
        if (text == null || text === '') return;
        ctx.font = `600 ${labelPx}px var(--font-data, monospace)`;
        ctx.lineWidth = 3 / s;
        ctx.strokeStyle = INK_CASING;
        ctx.fillStyle = '#1a1a1a';
        ctx.strokeText(String(text), x, y + step * 0.55);
        ctx.fillText(String(text), x, y + step * 0.55);
        ctx.font = `${fontPx}px serif`;
      };

      if (entries.length <= 3) {
        const n = entries.length;
        const startX = -(n - 1) * step * 0.5;
        entries.forEach((entry, i) => {
          const x = center.x + startX + i * step;
          const y = center.y;
          ctx.fillStyle = '#1a1a1a';
          ctx.fillText(entry.pf.glyph, x, y);
          const num = this._firstNumericAttr(entry.rec?.attrs, entry.pf.attrs);
          if (num != null) drawLabel(num, x, y);
        });
      } else {
        const n = entries.length;
        const startY = -(n - 1) * step * 0.5;
        entries.forEach((entry, i) => {
          const x = center.x;
          const y = center.y + startY + i * step;
          ctx.fillStyle = '#1a1a1a';
          ctx.fillText(entry.pf.glyph, x, y);
          const num = this._firstNumericAttr(entry.rec?.attrs, entry.pf.attrs);
          if (num != null) drawLabel(num, x, y);
        });
      }
    }

    // Legacy hexFeatures tags (glyph-only, no attrs)
    for (const [code, keys] of Object.entries(this.store.state.hexFeatures || {})) {
      if (!Array.isArray(keys) || !keys.length) continue;
      if (this.store.state.features?.[code]) continue;
      const center = hexCenter(code, grid);
      const r = hexRadius(grid);
      const fontPx = Math.max(10, Math.min(26, r * 0.65 * s));
      const step = fontPx / s;
      ctx.font = `${fontPx}px serif`;
      const glyphs = [];
      for (const key of keys) {
        const f = featureTypes.find(x => x.key === key);
        if (f && f.glyph) glyphs.push(f.glyph);
      }
      if (!glyphs.length) continue;
      if (glyphs.length <= 3) {
        const n = glyphs.length;
        const startX = -(n - 1) * step * 0.5;
        glyphs.forEach((g, i) => {
          ctx.fillStyle = '#1a1a1a';
          ctx.fillText(g, center.x + startX + i * step, center.y);
        });
      } else {
        const n = glyphs.length;
        const startY = -(n - 1) * step * 0.5;
        glyphs.forEach((g, i) => {
          ctx.fillStyle = '#1a1a1a';
          ctx.fillText(g, center.x, center.y + startY + i * step);
        });
      }
    }
    ctx.restore();
  }

  _drawSelection(ctx, view) {
    const s = view.baseScale * view.zoom;
    const grid = this.store.state.grid;
    if (!grid) return; // no project loaded — nothing to outline (hexPolygon needs a lattice)
    const codes = [];
    // Group hover fill is shown behind selection strokes.
    if (this.groupHoverHexes.size) {
      ctx.save();
      ctx.translate(view.panX, view.panY);
      ctx.scale(s, s);
      for (const code of this.groupHoverHexes) {
        const poly = hexPolygon(code, grid);
        if (!poly) continue;
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(122, 217, 255, 0.18)';
        ctx.fill();
        ctx.strokeStyle = '#7ad9ff';
        ctx.lineWidth = 2.0 / s;
        ctx.stroke();
      }
      ctx.restore();
    }
    if (!this.selectedHex && !this.selectedHexes.size) return;
    for (const code of this.selectedHexes) {
      if (code !== this.selectedHex) codes.push(code);
    }
    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(s, s);
    for (const code of codes) {
      const poly = hexPolygon(code, grid);
      if (!poly) continue;
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.strokeStyle = '#ff7a1a';
      ctx.lineWidth = 2.0 / s;
      ctx.stroke();
    }
    // Primary selected hex rendered last with a heavier stroke.
    if (this.selectedHex) {
      const poly = hexPolygon(this.selectedHex, grid);
      if (poly) {
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.closePath();
        ctx.strokeStyle = '#ff7a1a';
        ctx.lineWidth = 2.5 / s;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawHighlights(ctx, view) {
    const { hex, edge, neighbor } = this.highlighted;
    if (!hex || edge == null) return;
    const s = view.baseScale * view.zoom;
    const grid = this.store.state.grid;

    // highlight edge on map
    const nb = neighbor || edgeNeighbor(hex, edge, this.store.centers, grid);
    if (!nb) return;
    const ep = sharedEdgeEndpoints(hex, nb, grid);
    if (ep) {
      ctx.save();
      ctx.translate(view.panX, view.panY);
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(ep.a.x, ep.a.y);
      ctx.lineTo(ep.b.x, ep.b.y);
      ctx.strokeStyle = '#ff7a1a';
      ctx.lineWidth = 5 / s;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.restore();
    }

    // highlight neighbor hex
    if (nb && this.store.centers[nb]) {
      const poly = hexPolygon(nb, grid);
      ctx.save();
      ctx.translate(view.panX, view.panY);
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,122,26,0.22)';
      ctx.fill();
      ctx.strokeStyle = '#ff7a1a';
      ctx.lineWidth = 2.5 / s;
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawSnapPreview(ctx, view) {
    const snap = this.snapPreview;
    if (!snap || !snap.a || !snap.b) return;
    const grid = this.store.state.grid;
    const ep = sharedEdgeEndpoints(snap.a, snap.b, grid);
    if (!ep) return;
    const s = view.baseScale * view.zoom;
    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(ep.a.x, ep.a.y);
    ctx.lineTo(ep.b.x, ep.b.y);
    ctx.strokeStyle = SNAP_PREVIEW_STROKE;
    ctx.lineWidth = 6 / s;
    ctx.setLineDash([10 / s, 6 / s]);
    ctx.stroke();
    ctx.restore();
  }

  // ----------------- anomaly overlay -----------------

  computeAnomalies() {
    const state = this.store.state;
    const terrain = state.terrain && state.terrain.terrain ? state.terrain.terrain : {};
    const centers = this.store.centers || {};
    const land = new Set(Object.keys(centers));

    const unclassified = [];
    for (const code of land) {
      if (!terrain[code]) unclassified.push(code);
    }

    const orphanHexsides = [];
    for (const [edgeKey, features] of Object.entries(state.hexsides || {})) {
      if (!features || !features.length) continue;
      const [a, b] = edgeKey.split('|');
      if (!a || !b) continue;
      if (!terrain[a] || !terrain[b]) {
        orphanHexsides.push({ edgeKey, features: [...features] });
      }
    }

    const draft = [];
    for (const [code, prov] of Object.entries(state.provenance || {})) {
      if (prov === 'draft' && land.has(code)) draft.push(code);
    }

    return {
      unclassified: unclassified.length,
      orphanHexsides: orphanHexsides.length,
      draft: draft.length,
      unclassifiedCodes: unclassified,
      orphanHexsidesDetails: orphanHexsides,
      draftCodes: draft
    };
  }

  _drawAnomalies(ctx, view) {
    const grid = this.store.state.grid;
    if (!grid || !this.store.centers) return;
    const a = this.computeAnomalies();
    const s = view.baseScale * view.zoom;

    // Unclassified land hexes: red hatched outline
    for (const code of a.unclassifiedCodes) {
      this._drawHatchedHex(ctx, view, code, '#d02020', false);
      const poly = hexPolygon(code, grid);
      ctx.save();
      ctx.translate(view.panX, view.panY);
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.strokeStyle = '#d02020';
      ctx.lineWidth = 2 / s;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.restore();
    }

    // Draft provenance: warm cross-hatch fill
    for (const code of a.draftCodes) {
      this._drawHatchedHex(ctx, view, code, '#c07020', true);
    }

    // Orphan hexsides: red X along the edge
    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(s, s);
    ctx.strokeStyle = '#ff2050';
    ctx.lineWidth = 2.5 / s;
    ctx.setLineDash([]);
    for (const { edgeKey } of a.orphanHexsidesDetails) {
      const [aCode, bCode] = edgeKey.split('|');
      const ep = sharedEdgeEndpoints(aCode, bCode, grid);
      if (!ep) continue;
      const mid = { x: (ep.a.x + ep.b.x) / 2, y: (ep.a.y + ep.b.y) / 2 };
      const dx = ep.b.x - ep.a.x;
      const dy = ep.b.y - ep.a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const h = 8 / s;
      ctx.beginPath();
      ctx.moveTo(mid.x - ux * h - uy * h, mid.y - uy * h + ux * h);
      ctx.lineTo(mid.x + ux * h + uy * h, mid.y + uy * h - ux * h);
      ctx.moveTo(mid.x + ux * h - uy * h, mid.y + uy * h + ux * h);
      ctx.lineTo(mid.x - ux * h + uy * h, mid.y - uy * h - ux * h);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawHatchedHex(ctx, view, code, color, cross) {
    const s = view.baseScale * view.zoom;
    const grid = this.store.state.grid;
    const poly = hexPolygon(code, grid);

    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    ctx.clip();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / s;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const step = 7 / s;
    const pad = step;

    ctx.beginPath();
    for (let v = minX + minY - pad; v <= maxX + maxY + pad; v += step) {
      ctx.moveTo(v - minY, minY);
      ctx.lineTo(v - maxY, maxY);
    }
    if (cross) {
      for (let v = minX - maxY - pad; v <= maxX - minY + pad; v += step) {
        ctx.moveTo(v + minY, minY);
        ctx.lineTo(v + maxY, maxY);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // ----------------- classification PNG export -----------------

  exportOverlayPNG(opts = {}) {
    const state = this.store.state;
    const img = state.mapImage;
    // Canvas must be sized in the grid's calibration space (imageFull) — hexes
    // are drawn at full-image coords below (baseScale 1), so sizing to a
    // downscaled map's natural dims would push the overlay 1/baseScale off-canvas.
    // imageFull-sized output is also what aligns 1:1 with the ORIGINAL scan.
    const width = state.imageFull && state.imageFull[0]
      ? state.imageFull[0]
      : (img && img.naturalWidth ? img.naturalWidth : 1);
    const height = state.imageFull && state.imageFull[1]
      ? state.imageFull[1]
      : (img && img.naturalHeight ? img.naturalHeight : 1);

    const oc = document.createElement('canvas');
    oc.width = width;
    oc.height = height;
    const octx = oc.getContext('2d');

    const view = { baseScale: 1, zoom: 1, panX: 0, panY: 0 };

    if (opts.background === 'parchment') {
      octx.fillStyle = '#eaddcf';
      octx.fillRect(0, 0, width, height);
    }

    if (state.grid && this.store.centers) {
      this._drawHexFills(octx, view, 'full');
      this._drawHexsides(octx, view, { fullOpacity: true });
      this._drawFeatureGlyphs(octx, view);
      this._drawGrid(octx, view);
    }

    const dataUrl = oc.toDataURL('image/png');

    if (opts.download !== false) {
      const name = (state.name || 'map').replace(/[^a-z0-9\-_]/gi, '_');
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${name}-classification.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    return dataUrl;
  }

  setHighlight(hex, edge, neighbor) {
    this.highlighted = { hex, edge: edge ?? null, neighbor: neighbor ?? null };
    this.draw();
  }

  clearHighlight() {
    this.highlighted = { hex: null, edge: null, neighbor: null };
    this.draw();
  }

  clearSnapPreview() {
    this._setSnapPreview(null);
  }

  closeInspector() {
    this.selectedHex = null;
    this.selectedHexes.clear();
    this.groupHoverHexes.clear();
    this.clearHighlight();
    this.draw();
    this._notifySelectionChange();
  }
}
