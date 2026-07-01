import {
  TERRAIN_COLORS, HEXSIDE_COLORS, EDITABLE_LAYERS,
  hexCenter, hexPolygon, sharedEdgeEndpoints, pointInPolygon,
  worldToScreen, screenToWorld, edgeNeighbor
} from './geometry.js';

export class MapRenderer {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.store = store;

    this.view = { baseScale: 1, zoom: 1, panX: 0, panY: 0 };
    this.selectedHex = null;
    this.highlighted = { hex: null, edge: null, neighbor: null };

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

  _bindPointer() {
    const wrap = this.canvas.parentElement;

    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.clickMoved = false;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.panStart = { x: this.view.panX, y: this.view.panY };
      wrap.setPointerCapture(e.pointerId);
    });

    wrap.addEventListener('pointermove', (e) => {
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
      if (!this.clickMoved) {
        this._clickAt(e);
      }
    });

    wrap.addEventListener('pointerleave', () => {
      this.isDragging = false;
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
    ctx.clearRect(0, 0, width, height);

    const state = this.store.state;
    const img = state.mapImage;
    if (!img) {
      ctx.fillStyle = '#0b0c0e';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#555';
      ctx.font = '14px var(--mono)';
      ctx.fillText('Load a project to begin', 20, height / 2);
      return;
    }

    // base map
    const s = this.view.baseScale * this.view.zoom;
    ctx.save();
    ctx.translate(this.view.panX, this.view.panY);
    ctx.scale(s, s);
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
    ctx.restore();

    // traces
    this._drawTraces(s);

    if (state.grid && this.store.centers) {
      this._drawHexFills(s);
      this._drawHexsides(s);
      this._drawGrid(s);
      this._drawSelection(s);
      this._drawHighlights(s);
    }
  }

  _drawTraces(s) {
    const ctx = this.ctx;
    for (const trace of this.store.state.traces) {
      if (!trace.on || !trace.img) continue;
      ctx.save();
      ctx.globalAlpha = trace.opacity;
      ctx.translate(this.view.panX, this.view.panY);
      ctx.scale(s, s);
      ctx.drawImage(trace.img, 0, 0, trace.img.naturalWidth, trace.img.naturalHeight);
      ctx.restore();
    }
  }

  _drawHexFills(s) {
    const ctx = this.ctx;
    const grid = this.store.state.grid;
    const terrain = this.store.state.terrain.terrain;
    ctx.save();
    ctx.translate(this.view.panX, this.view.panY);
    ctx.scale(s, s);
    ctx.lineWidth = 1.2 / s;
    for (const code of Object.keys(this.store.centers)) {
      const type = terrain[code];
      const colors = TERRAIN_COLORS[type] || TERRAIN_COLORS.clear;
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

  _drawGrid(s) {
    const ctx = this.ctx;
    const grid = this.store.state.grid;
    ctx.save();
    ctx.translate(this.view.panX, this.view.panY);
    ctx.scale(s, s);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 0.6 / s;
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

  _drawHexsides(s) {
    const ctx = this.ctx;
    const grid = this.store.state.grid;
    const seen = new Set();
    ctx.save();
    ctx.translate(this.view.panX, this.view.panY);
    ctx.scale(s, s);
    for (const layer of EDITABLE_LAYERS) {
      const list = this.store.state.hexsides[layer] || [];
      const style = HEXSIDE_COLORS[layer];
      if (!style) continue;
      ctx.beginPath();
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.width / s;
      ctx.setLineDash(style.dash.map(v => v / s));
      for (const pair of list) {
        const key = pair.a < pair.b ? `${pair.a}|${pair.b}` : `${pair.b}|${pair.a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const ep = sharedEdgeEndpoints(pair.a, pair.b, grid);
        if (!ep) continue;
        ctx.moveTo(ep.a.x, ep.a.y);
        ctx.lineTo(ep.b.x, ep.b.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  _drawSelection(s) {
    if (!this.selectedHex) return;
    const ctx = this.ctx;
    const grid = this.store.state.grid;
    const poly = hexPolygon(this.selectedHex, grid);
    ctx.save();
    ctx.translate(this.view.panX, this.view.panY);
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

  _drawHighlights(s) {
    const { hex, edge, neighbor } = this.highlighted;
    if (!hex || edge == null) return;
    const ctx = this.ctx;
    const grid = this.store.state.grid;

    // highlight edge on map
    const nb = neighbor || edgeNeighbor(hex, edge, this.store.centers, grid);
    if (!nb) return;
    const ep = sharedEdgeEndpoints(hex, nb, grid);
    if (ep) {
      ctx.save();
      ctx.translate(this.view.panX, this.view.panY);
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
      ctx.translate(this.view.panX, this.view.panY);
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
