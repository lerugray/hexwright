import {
  TERRAIN_COLORS, HEXSIDE_COLORS,
  hexCenter, hexPolygon, sharedEdgeEndpoints, pointInPolygon,
  worldToScreen, screenToWorld, edgeNeighbor, hexRadius, nearestEdge
} from './geometry.js';

const INK_CASING = 'rgba(247,242,226,0.82)';

export class MapRenderer {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.store = store;

    this.view = { baseScale: 1, zoom: 1, panX: 0, panY: 0 };
    this.selectedHex = null;
    this.highlighted = { hex: null, edge: null, neighbor: null };

    this.viewMode = 'both';          // 'map' | 'classification' | 'both'
    this.overlayAlpha = 1;           // Both-view terrain-fill opacity (UI slider)
    this.terrainFillVisible = true;  // View-only toggle: terrain fill layer
    this.hexsideVisibility = {};     // View-only per-feature visibility map
    this.mapDim = 0;                 // View-only raster dimming in both/map modes
    this.nudgeMode = false;          // drag/arrow-key the scan under the grid
    this.nudgeDrag = null;
    this.anomalyMode = false;

    this.brush = { active: false, terrainKey: null, onPaint: null, onShiftClick: null };
    this.brushLastHex = null;
    this.edgePaint = {
      active: false,
      featureKey: null,
      onToggle: null,
      onSet: null,
      onStrokeStart: null,
      onStrokeEnd: null
    };
    this.edgePaintStroke = null;

    this.isDragging = false;
    this.dragStart = null;
    this.panStart = null;
    this.clickMoved = false;

    this.resize();
    window.addEventListener('resize', () => this.resize());

    this._bindPointer();
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
    if (!img || !img.naturalWidth) return;
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
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
    }
  }

  nearestEdgeAtScreen(pt) {
    return nearestEdge(pt.x, pt.y, {
      view: this.view,
      grid: this.store.state.grid,
      centers: this.store.centers,
      hexAtScreen: (screenPt) => this.hexAtScreen(screenPt),
      toleranceFactor: 0.35
    });
  }

  hexAtScreen(pt) {
    const world = screenToWorld(pt, this.view);
    return this._hexAt(world);
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

    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
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
          alt: !!e.altKey,
          moved: false,
          strokeOpened: false,
          touched: new Set()
        };
        const pt = this._eventToScreen(e);
        const hit = this.nearestEdgeAtScreen(pt);
        if (hit) this.setHighlight(hit.hex, hit.edgeIndex, hit.neighbor);
        else this.clearHighlight();
        wrap.setPointerCapture(e.pointerId);
        return;
      }
      this.isDragging = true;
      this.clickMoved = false;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.panStart = { x: this.view.panX, y: this.view.panY };
      this.brushLastHex = null;
      wrap.setPointerCapture(e.pointerId);
    });

    wrap.addEventListener('pointermove', (e) => {
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
        const hit = this.nearestEdgeAtScreen(pt);
        if (hit) this.setHighlight(hit.hex, hit.edgeIndex, hit.neighbor);
        else this.clearHighlight();

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
              this.edgePaint.onSet(hit, { erase: session.alt });
            }
          }
        }
        return;
      }
      if (!this.isDragging) {
        this._hoverAt(e);
        return;
      }
      if (this.brush.active) {
        const pt = this._eventToScreen(e);
        const hex = this.hexAtScreen(pt);
        if (hex && hex !== this.brushLastHex) {
          this.brushLastHex = hex;
          if (this.brush.onPaint) this.brush.onPaint(hex);
        }
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
      if (this.nudgeMode) {
        this.nudgeDrag = null;
        return;
      }
      if (this.edgePaint.active) {
        const pt = this._eventToScreen(e);
        const hit = this.nearestEdgeAtScreen(pt);
        if (hit) this.setHighlight(hit.hex, hit.edgeIndex, hit.neighbor);
        else this.clearHighlight();
        const session = this.edgePaintStroke;
        this.edgePaintStroke = null;
        if (session) {
          if (session.moved) {
            if (hit && !session.touched.has(hit.edgeKey)) {
              if (this.edgePaint.onSet) {
                this.edgePaint.onSet(hit, { erase: session.alt });
              }
            }
            if (session.strokeOpened && this.edgePaint.onStrokeEnd) {
              this.edgePaint.onStrokeEnd();
            }
          } else if (hit) {
            if (session.alt) {
              if (this.edgePaint.onSet) this.edgePaint.onSet(hit, { erase: true });
            } else if (this.edgePaint.onToggle) {
              this.edgePaint.onToggle(hit);
            }
          }
        }
        return;
      }
      if (this.brush.active) {
        const pt = this._eventToScreen(e);
        const hex = this.hexAtScreen(pt);
        if (hex) {
          if (e.shiftKey && this.brush.onShiftClick) {
            this.brush.onShiftClick(hex);
          } else if (this.brush.onPaint) {
            this.brush.onPaint(hex);
          }
        }
        this.brushLastHex = null;
        return;
      }
      if (!this.clickMoved) {
        this._clickAt(e);
      }
    });

    wrap.addEventListener('pointerleave', () => {
      this.isDragging = false;
      if (this.edgePaint.active) {
        const session = this.edgePaintStroke;
        this.edgePaintStroke = null;
        if (session && session.strokeOpened && this.edgePaint.onStrokeEnd) {
          this.edgePaint.onStrokeEnd();
        }
      }
    });

    wrap.addEventListener('pointercancel', () => {
      this.isDragging = false;
      const session = this.edgePaintStroke;
      this.edgePaintStroke = null;
      if (session && session.strokeOpened && this.edgePaint.onStrokeEnd) {
        this.edgePaint.onStrokeEnd();
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
    if (this.edgePaint.active) {
      const hit = this.nearestEdgeAtScreen(pt);
      if (hit) {
        this.setHighlight(hit.hex, hit.edgeIndex, hit.neighbor);
        this.canvas.title = `${hit.a}|${hit.b}`;
      } else {
        this.clearHighlight();
        this.canvas.title = '';
      }
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

  _clickAt(e) {
    const pt = this._eventToScreen(e);
    const world = screenToWorld(pt, this.view);
    const hit = this._hexAt(world);
    if (hit) {
      this.selectedHex = hit;
      this.draw();
      this.onHexSelect?.(hit, pt);
    } else {
      this.selectedHex = null;
      this.draw();
      this.onHexSelect?.(null);
    }
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
    // fallback full scan
    for (const code of codes) {
      const poly = hexPolygon(code, grid);
      if (pointInPolygon(worldPt, poly)) return code;
    }
    return null;
  }

  draw() {
    const ctx = this.ctx;
    const { width, height } = this;
    const state = this.store.state;
    const img = state.mapImage;

    ctx.clearRect(0, 0, width, height);

    if (!img) {
      ctx.fillStyle = '#0b0c0e';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#555';
      ctx.font = '14px var(--mono)';
      ctx.fillText('Load a project to begin', 20, height / 2);
      return;
    }

    // Map mode: base map + traces only.
    // Classification mode: parchment background, no map/traces.
    // Both: current behavior (map + traces + classification overlay).
    if (this.viewMode !== 'classification') {
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
      if (terrainFillEnabled && fillMode === 'overlay') {
        // Both view: terrain fills fade with the Overlay slider so the scan
        // underneath stays traceable; hexsides/glyphs/grid keep full strength.
        ctx.save();
        ctx.globalAlpha = this.overlayAlpha;
        this._drawHexFills(ctx, this.view, fillMode);
        ctx.restore();
      } else if (terrainFillEnabled) {
        this._drawHexFills(ctx, this.view, fillMode);
      }
      this._drawHexsides(ctx, this.view);
      this._drawFeatureGlyphs(ctx, this.view);
    }

    if (state.grid && this.store.centers) {
      this._drawGrid(ctx, this.view);
    }

    this._drawSelection(ctx, this.view);
    this._drawHighlights(ctx, this.view);

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
      if (t) {
        const c = t.color;
        return mode === 'full'
          ? { fill: c, line: c }
          : { fill: `${c}40`, line: `${c}73` };
      }
    }
    return TERRAIN_COLORS[type] || TERRAIN_COLORS.clear;
  }

  _drawHexFills(ctx, view, mode = 'overlay') {
    const s = view.baseScale * view.zoom;
    const grid = this.store.state.grid;
    const terrain = this.store.state.terrain.terrain;
    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(s, s);
    ctx.lineWidth = 1.2 / s;
    for (const code of Object.keys(this.store.centers)) {
      const type = terrain[code];
      const colors = this._terrainColor(type, mode);
      const poly = hexPolygon(code, grid);
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fillStyle = colors.fill;
      ctx.fill();
      ctx.strokeStyle = colors.line;
      ctx.stroke();
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
          width: f.key === 'rail' ? 3.0 : 3.5,
          dash: f.dash ? [6, 5] : []
        };
      }
    }
    return HEXSIDE_COLORS[featureKey] || { stroke: '#888', width: 3.0, dash: [] };
  }

  _drawHexsides(ctx, view) {
    const s = view.baseScale * view.zoom;
    const grid = this.store.state.grid;
    const palette = this.store.getPalette();
    const isCrossing = (key) => {
      const f = palette && palette.hexsideFeatures ? palette.hexsideFeatures.find(x => x.key === key) : null;
      return !!(f && f.kind === 'crossing');
    };
    ctx.save();
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
        const rung = Math.min(len * 0.30, 11 / s);
        const cSpacing = 4.5 / s;
        const offBaseC = -((crossFeats.length - 1) * cSpacing) / 2;
        const crossLines = crossFeats.map((featureKey, idx) => {
          const style = this._hexsideStyle(featureKey);
          const along = offBaseC + idx * cSpacing;
          const cx = mx + tx * along;
          const cy = my + ty * along;
          const coreWidth = style.width + 0.6;
          return { style, cx, cy, coreWidth };
        });
        crossLines.forEach(({ cx, cy, coreWidth }) => {
          ctx.beginPath();
          ctx.strokeStyle = INK_CASING;
          ctx.lineWidth = (coreWidth * 2) / s;
          ctx.lineCap = 'round';
          ctx.setLineDash([]);
          ctx.moveTo(cx - ux * rung, cy - uy * rung);
          ctx.lineTo(cx + ux * rung, cy + uy * rung);
          ctx.stroke();
        });
        crossLines.forEach(({ style, cx, cy, coreWidth }) => {
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

  _drawFeatureGlyphs(ctx, view) {
    const s = view.baseScale * view.zoom;
    const grid = this.store.state.grid;
    const palette = this.store.getPalette();
    if (!palette || !palette.hexFeatures) return;
    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1a1a1a';

    for (const [code, keys] of Object.entries(this.store.state.hexFeatures || {})) {
      if (!Array.isArray(keys) || !keys.length) continue;
      const center = hexCenter(code, grid);
      const r = hexRadius(grid);
      const fontPx = Math.max(10, Math.min(26, r * 0.65 * s));
      const step = fontPx / s;
      ctx.font = `${fontPx}px serif`;

      const glyphs = [];
      for (const key of keys) {
        const f = palette.hexFeatures.find(x => x.key === key);
        if (f && f.glyph) glyphs.push(f.glyph);
      }
      if (!glyphs.length) continue;

      if (glyphs.length <= 3) {
        const n = glyphs.length;
        const startX = -(n - 1) * step * 0.5;
        glyphs.forEach((g, i) => {
          ctx.fillText(g, center.x + startX + i * step, center.y);
        });
      } else {
        const n = glyphs.length;
        const startY = -(n - 1) * step * 0.5;
        glyphs.forEach((g, i) => {
          ctx.fillText(g, center.x, center.y + startY + i * step);
        });
      }
    }
    ctx.restore();
  }

  _drawSelection(ctx, view) {
    if (!this.selectedHex) return;
    const s = view.baseScale * view.zoom;
    const grid = this.store.state.grid;
    const poly = hexPolygon(this.selectedHex, grid);
    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    ctx.strokeStyle = '#ff7a1a';
    ctx.lineWidth = 2.5 / s;
    ctx.stroke();
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
      this._drawHexsides(octx, view);
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

  closeInspector() {
    this.selectedHex = null;
    this.clearHighlight();
    this.draw();
  }
}
