import {
  TERRAIN_COLORS, EDITABLE_LAYERS, HEXSIDE_COLORS,
  hexCenter, hexPolygon, edgeNeighbor
} from './geometry.js';

const LAYER_LABELS = {
  rivers: 'river',
  mountains: 'ridge',
  impassible: 'impass',
  roads: 'road',
  rails: 'rail',
  border: 'border'
};

const EDGE_NAMES = ['E', 'NE', 'NW', 'W', 'SW', 'SE'];
const EYE_OPEN_SVG = '<svg viewBox="0 0 24 24"><path d="M2 12 s4 -6 10 -6 s10 6 10 6 s-4 6 -10 6 s-10 -6 -10 -6 z"/><circle cx="12" cy="12" r="2.6"/></svg>';
const EYE_OFF_SVG = '<svg viewBox="0 0 24 24"><path d="M4 4 l16 16 M2 12 s4 -6 10 -6 c2 0 3.8 0.7 5.3 1.6 M22 12 s-4 6 -10 6 c-2 0 -3.8 -0.7 -5.3 -1.6"/></svg>';

export class UI {
  constructor(store, renderer) {
    this.store = store;
    this.renderer = renderer;
    this.els = {};
    this.gatherElements();

    this._lastPalette = null;
    this.hexedEdgeGroups = [];
    this.hexedEdgePts = [];
    this.hexedEdgeLabels = [];
    this.hexedSelectedEdge = null;

    this.mode = 'inspect';
    this.brushActive = false;
    this.brushTerrain = 'clear';
    this.lastBrushHex = null;
    this.lastBrushScreen = null;
    this.edgePaintActive = false;
    this.edgePaintFeature = null;
    this.nudgeActive = false;
    this.anomalyActive = false;
    this.helpOpen = false;
    this.projectSub = '';

    this.buildHexEditor();
    this.bindGlobal();
    this.bindControls();
    this._setupBrush();
    this._setupEdgePaint();
    this.setMode('inspect');
    this.updateUI();
  }

  gatherElements() {
    const ids = [
      'strip-project-name', 'strip-project-sub', 'mode-hint', 'save-state',
      'load-map', 'load-grid', 'load-terrain', 'load-sides', 'load-sample',
      'fit-view', 'undo', 'clear-select', 'toggle-help',
      'view-mode', 'tool-rail', 'tool-inspect', 'tool-terrain', 'tool-edges', 'tool-nudge',
      'brush-card', 'brush-mode-tag', 'brush-ink-list',
      'layers-panel', 'feature-layer-rows', 'terrain-layer-wrap', 'terrain-fill-row', 'terrain-fill-eye', 'terrain-fill-count',
      'trace-layer-wrap', 'trace-layer-rows',
      'trace-opacity', 'trace-opacity-value', 'overlay-opacity', 'overlay-opacity-value',
      'map-dim', 'map-dim-value',
      'canvas-wrap',
      'export-overlay', 'toggle-anomaly', 'anomaly-count', 'load-palette', 'anomaly-status',
      'import-sides', 'import-terrain', 'import-wmp', 'file-btn', 'file-popover', 'export-btn', 'export-popover',
      'import-twu',
      'export-sides-file', 'export-sides-copy', 'export-terrain-file', 'export-terrain-copy', 'export-twu',
      'hex-editor', 'hexed-close', 'hexed-title', 'hexed-terrain-current', 'hexed-terrain-grid',
      'hexed-feat-count', 'hexed-featrow', 'hexed-edges-meta', 'hexed-svg', 'hexed-fill',
      'hexed-edges', 'hexed-edge-labels', 'hexed-center-code', 'hexed-on-edge-label',
      'hexed-edchips', 'hexed-inkgrid',
      'count-land', 'layer-counts', 'status',
      'help-overlay', 'close-help'
    ];
    for (const id of ids) this.els[id] = document.getElementById(id);
  }

  buildHexEditor() {
    this._buildHexEditorDiagram();
    this._rebuildHexEditorPalette();
  }

  _hexEditorVertices() {
    const cx = 108;
    const cy = 100;
    const r = 58;
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return { cx, cy, r, pts };
  }

  _buildHexEditorDiagram() {
    const svgNs = 'http://www.w3.org/2000/svg';
    const edgesG = this.els['hexed-edges'];
    const labelsG = this.els['hexed-edge-labels'];
    edgesG.innerHTML = '';
    labelsG.innerHTML = '';
    this.hexedEdgeGroups = [];
    this.hexedEdgePts = [];
    this.hexedEdgeLabels = [];

    const { cx, cy, pts } = this._hexEditorVertices();
    this.els['hexed-fill'].setAttribute('points', pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));

    for (let i = 0; i < 6; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 6];
      const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
      this.hexedEdgePts.push({ a, b });

      const group = document.createElementNS(svgNs, 'g');
      group.setAttribute('data-edge', String(i));

      const hit = document.createElementNS(svgNs, 'path');
      hit.setAttribute('class', 'edge-seg edge-hit');
      hit.setAttribute('d', d);
      hit.setAttribute('data-edge', String(i));
      hit.setAttribute('stroke', '#4a4e57');
      hit.setAttribute('stroke-width', '10');
      hit.setAttribute('stroke-linecap', 'round');
      hit.setAttribute('fill', 'none');
      hit.addEventListener('click', () => this._selectHexEditorEdge(i));
      hit.addEventListener('mouseenter', () => this._highlightHexEditorEdge(i));
      hit.addEventListener('mouseleave', () => this._unhighlightHexEditorEdge());
      group.appendChild(hit);

      const inks = document.createElementNS(svgNs, 'g');
      inks.setAttribute('class', 'edge-inks');
      group.appendChild(inks);

      const sel = document.createElementNS(svgNs, 'path');
      sel.setAttribute('class', 'edge-sel-overlay');
      sel.setAttribute('d', d);
      sel.setAttribute('stroke', 'var(--hx-accent)');
      sel.setAttribute('stroke-width', '16');
      sel.setAttribute('stroke-linecap', 'round');
      sel.setAttribute('fill', 'none');
      sel.setAttribute('opacity', '0');
      sel.setAttribute('pointer-events', 'none');
      group.appendChild(sel);

      edgesG.appendChild(group);
      this.hexedEdgeGroups.push(group);

      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dx = mid.x - cx;
      const dy = mid.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      const label = document.createElementNS(svgNs, 'text');
      label.setAttribute('class', 'edge-label');
      label.setAttribute('data-edge', String(i));
      label.setAttribute('x', String(mid.x + (dx / len) * 18));
      label.setAttribute('y', String(mid.y + (dy / len) * 18 + 3));
      label.setAttribute('text-anchor', 'middle');
      label.textContent = EDGE_NAMES[i];
      labelsG.appendChild(label);
      this.hexedEdgeLabels.push(label);
    }
  }

  _rebuildHexEditorPalette() {
    const palette = this.store.getPalette();
    const terrain = palette?.terrain || [];
    const hexFeatures = palette?.hexFeatures || [];
    const hexsideFeatures = palette?.hexsideFeatures || [];

    this.els['hexed-terrain-grid'].innerHTML = terrain.map(t => `
      <button type="button" class="terr" data-terrain="${t.key}">
        <span class="tswatch" style="background:${t.color || '#888'}"></span>
        <span>${t.label || t.key}</span>
      </button>
    `).join('');

    this.els['hexed-featrow'].innerHTML = hexFeatures.map(f => `
      <button type="button" class="feat" data-feature="${f.key}">
        <span class="fdot"></span>
        ${f.glyph ? `<span class="hx-data">${f.glyph}</span>` : ''}
        <span>${f.label || f.key}</span>
      </button>
    `).join('');

    this.els['hexed-inkgrid'].innerHTML = hexsideFeatures.map(f => `
      <button type="button" class="inkmini" data-feature="${f.key}">
        <span class="swatch" style="background:${this._hexsideFeatureColor(f)}"></span>
        <span>${f.label || f.key}</span>
      </button>
    `).join('');
  }

  _selectHexEditorEdge(i) {
    if (!this.inspectorHex) return;
    const nb = edgeNeighbor(this.inspectorHex, i, this.store.centers, this.store.state.grid);
    if (!nb) return;
    this.hexedSelectedEdge = i;
    this._highlightHexEditorEdge(i);

    const code = this.inspectorHex;
    let marked = 0;
    for (let j = 0; j < 6; j++) {
      const n = edgeNeighbor(code, j, this.store.centers, this.store.state.grid);
      if (n && this.store.edgeFeatures(code, n).length) marked++;
    }
    this.els['hexed-edges-meta'].textContent = `${marked} of 6 marked · ${EDGE_NAMES[i]} selected`;
    this.hexedEdgeLabels.forEach((label, idx) => label.classList.toggle('sel', idx === i));

    this._refreshHexEditorEdgePanel();
    this._paintHexEditorDiagram();
  }

  _highlightHexEditorEdge(i) {
    if (!this.inspectorHex) return;
    const nb = edgeNeighbor(this.inspectorHex, i, this.store.centers, this.store.state.grid);
    if (nb) this.renderer.setHighlight(this.inspectorHex, i, nb);
    else this.renderer.clearHighlight();
  }

  _unhighlightHexEditorEdge() {
    if (this.hexedSelectedEdge !== null && this.inspectorHex) {
      this._highlightHexEditorEdge(this.hexedSelectedEdge);
      return;
    }
    this.renderer.clearHighlight();
  }

  _refreshHexEditorEdgePanel() {
    const i = this.hexedSelectedEdge;
    const label = this.els['hexed-on-edge-label'];
    const chips = this.els['hexed-edchips'];
    const grid = this.els['hexed-inkgrid'];

    if (i === null || !this.inspectorHex) {
      label.textContent = 'On edge —';
      chips.innerHTML = '';
      grid.querySelectorAll('.inkmini').forEach(el => el.classList.remove('applied'));
      return;
    }

    const code = this.inspectorHex;
    const nb = edgeNeighbor(code, i, this.store.centers, this.store.state.grid);
    label.textContent = nb ? `On edge ${EDGE_NAMES[i]}` : 'On edge —';
    const palette = this.store.getPalette();
    const features = palette?.hexsideFeatures || [];
    const current = nb ? this.store.edgeFeatures(code, nb) : [];

    chips.innerHTML = current.map(key => {
      const f = features.find(x => x.key === key);
      const color = this._hexsideFeatureColor(f);
      const name = f?.label || key;
      return `<span class="edgechip" data-feature="${key}"><span class="dot" style="background:${color}"></span>${name}<span class="x" data-remove="${key}">×</span></span>`;
    }).join('');

    grid.querySelectorAll('.inkmini').forEach(el => {
      el.classList.toggle('applied', current.includes(el.dataset.feature));
    });
  }

  bindGlobal() {
    document.addEventListener('keydown', (e) => {
      const tag = e.target?.tagName || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'Escape') {
        if (this.helpOpen) {
          e.preventDefault();
          this.toggleHelp(false);
          return;
        }
        if (!typing) this.closeInspector();
        return;
      }

      if (typing) return;

      if (this._isHelpToggleKey(e)) {
        e.preventDefault();
        this.toggleHelp();
        return;
      }

      if (this.helpOpen) return;

      if (e.key.toLowerCase() === 'i') this.setMode('inspect');
      if (e.key.toLowerCase() === 'b') this.setMode('terrain');
      if (e.key.toLowerCase() === 'e') this.setMode('edges');
      if (e.key.toLowerCase() === 'n') this.setMode('nudge');
      if (this.nudgeActive && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1; // world (full-image) pixels
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        this.store.nudgeMapOffset(dx, dy);
        this.renderer.draw();
        const off = this.store.state.mapOffset || [0, 0];
        this.status(`Map offset: ${Math.round(off[0])}, ${Math.round(off[1])} px`, 2500);
      }
      if (e.key.toLowerCase() === 'v') this.cycleViewMode();
      if (/^[0-9]$/.test(e.key)) {
        const idx = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
        if (this.mode === 'edges') this._selectEdgeFeatureByIndex(idx);
        else this._selectTerrainByIndex(idx);
      }
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        this.renderer.fitView();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.store.redo();
        else this.store.undo();
      }
    });

    this.store.onChange((reason) => {
      // Loads aren't edits: booting a project/palette must not flag "unsaved edit"
      // (the autosave listener registers after boot-load, so nothing would clear it).
      if (reason !== 'project' && reason !== 'palette') this.markDirty();
      this.updateUI(reason);
    });
    this.renderer.onHexSelect = (code, screenPt) => {
      if (code) this.openInspector(code, screenPt);
      else this.closeInspector();
    };

    // close popovers on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#export-btn, #export-popover')) {
        this.els['export-popover'].classList.remove('open');
        this.els['export-btn'].setAttribute('aria-expanded', 'false');
      }
      if (!e.target.closest('#file-btn, #file-popover')) {
        this.els['file-popover'].classList.remove('open');
        this.els['file-btn'].setAttribute('aria-expanded', 'false');
      }
    });
  }

  bindControls() {
    this.els['fit-view'].addEventListener('click', () => this.renderer.fitView());
    this.els['undo'].addEventListener('click', () => this.store.undo());
    this.els['clear-select'].addEventListener('click', () => this.closeInspector());
    this.els['hexed-close'].addEventListener('click', () => this.closeInspector());
    this.els['toggle-help'].addEventListener('click', () => this.toggleHelp());
    this.els['close-help'].addEventListener('click', () => this.toggleHelp(false));
    this.els['help-overlay'].addEventListener('click', (e) => {
      if (e.target === this.els['help-overlay']) this.toggleHelp(false);
    });
    // The hex editor floats over the map canvas, inside the same wrapper that has the
    // pan/hex-select pointer handler. Without this, a trusted click on any inspector
    // control also fires the canvas pointerdown/up -> it re-selects the hex under the
    // control and rebuilds the inspector mid-click, swallowing the control's own click
    // (chips/dropdowns silently do nothing on real clicks, only synthetic events work).
    ['pointerdown','pointerup','mousedown','mouseup'].forEach(evt =>
      this.els['hex-editor'].addEventListener(evt, (e) => e.stopPropagation()));

    this.els['hex-editor'].addEventListener('click', (e) => {
      const terr = e.target.closest('.terr[data-terrain]');
      if (terr && this.inspectorHex) {
        this.store.setTerrain(this.inspectorHex, terr.dataset.terrain);
        this.brushTerrain = terr.dataset.terrain;
        this._reflectBrush();
        return;
      }
      const feat = e.target.closest('.feat[data-feature]');
      if (feat) {
        this._toggleHexFeature(feat.dataset.feature);
        return;
      }
      const ink = e.target.closest('.inkmini[data-feature]');
      if (ink) {
        this._toggleHexEditorInk(ink.dataset.feature);
        return;
      }
      const remove = e.target.closest('.edgechip .x[data-remove]');
      if (remove) {
        this._toggleHexEditorInk(remove.dataset.remove);
      }
    });

    this.els['file-btn'].addEventListener('click', () => {
      const next = !this.els['file-popover'].classList.contains('open');
      this.els['file-popover'].classList.toggle('open', next);
      this.els['file-btn'].setAttribute('aria-expanded', String(next));
      if (next) {
        this.els['export-popover'].classList.remove('open');
        this.els['export-btn'].setAttribute('aria-expanded', 'false');
      }
    });

    this.els['export-btn'].addEventListener('click', () => {
      const next = !this.els['export-popover'].classList.contains('open');
      this.els['export-popover'].classList.toggle('open', next);
      this.els['export-btn'].setAttribute('aria-expanded', String(next));
      if (next) {
        this.els['file-popover'].classList.remove('open');
        this.els['file-btn'].setAttribute('aria-expanded', 'false');
      }
    });
    this.els['export-sides-file'].addEventListener('click', () => this._download('hexsides.json', this.store.exportHexsidesJson()));
    this.els['export-sides-copy'].addEventListener('click', () => this._copy(this.store.exportHexsidesJson(), 'hexsides.json'));
    this.els['export-terrain-file'].addEventListener('click', () => this._download('terrain.json', this.store.exportTerrainJson()));
    this.els['export-terrain-copy'].addEventListener('click', () => this._copy(this.store.exportTerrainJson(), 'terrain.json'));
    this.els['export-twu'].addEventListener('click', () => {
      if (this.loadHandlers?.exportTwu) this.loadHandlers.exportTwu();
    });


    this.els['brush-ink-list'].addEventListener('click', (e) => {
      const row = e.target.closest('.ink[data-ink-key]');
      if (!row) return;
      const key = row.dataset.inkKey;
      if (this.mode === 'edges') this.setEdgePaintFeature(key);
      else this.setBrushTerrain(key);
    });

    this.els['feature-layer-rows'].addEventListener('click', (e) => {
      const eye = e.target.closest('.eye[data-feature-key]');
      if (!eye) return;
      this.toggleHexsideLayerVisibility(eye.dataset.featureKey);
    });

    this.els['terrain-fill-eye'].addEventListener('click', () => {
      this.renderer.terrainFillVisible = !this.renderer.terrainFillVisible;
      this._renderLayersPanel();
      this.renderer.draw();
    });

    this.els['trace-layer-rows'].addEventListener('click', (e) => {
      const eye = e.target.closest('.eye[data-trace-index]');
      if (!eye) return;
      const idx = Number(eye.dataset.traceIndex);
      const trace = this.store.state.traces[idx];
      if (!trace) return;
      this.store.setTraceOn(idx, !trace.on);
    });

    this.els['trace-opacity'].addEventListener('input', (e) => {
      const op = parseFloat(e.target.value);
      for (let i = 0; i < this.store.state.traces.length; i++) {
        this.store.setTraceOpacity(i, op);
      }
      this.els['trace-opacity-value'].textContent = `${Math.round(op * 100)}%`;
    });

    // Terrain-fill (classification overlay) opacity — lets the scan show
    // through in Both view for hand-tracing; hexsides/grid stay full-strength.
    // Dragging it in Map/Classification view switches to Both first: the
    // slider only means something where map AND fills are drawn together, so
    // it must never silently no-op.
    this.els['overlay-opacity'].addEventListener('input', (e) => {
      if (this.renderer.viewMode !== 'both') this.setViewMode('both');
      this.renderer.overlayAlpha = parseFloat(e.target.value);
      this.els['overlay-opacity-value'].textContent = `${Math.round(this.renderer.overlayAlpha * 100)}%`;
      this.els['terrain-fill-count'].textContent = `${Math.round(this.renderer.overlayAlpha * 100)}%`;
      this.renderer.draw();
    });

    this.els['map-dim'].addEventListener('input', (e) => {
      this.renderer.mapDim = parseFloat(e.target.value);
      this.els['map-dim-value'].textContent = `${Math.round(this.renderer.mapDim * 100)}%`;
      this.renderer.draw();
    });

    // View mode
    this.els['view-mode'].addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn) return;
      this.setViewMode(btn.dataset.mode);
    });

    this.els['tool-rail'].addEventListener('click', (e) => {
      const btn = e.target.closest('.tool[data-mode]');
      if (!btn) return;
      this.setMode(btn.dataset.mode);
    });

    // Export overlay PNG
    this.els['export-overlay'].addEventListener('click', () => {
      this.renderer.exportOverlayPNG();
      this.status('Exported classification PNG', 2000);
    });

    // Anomaly toggle
    this.els['toggle-anomaly'].addEventListener('click', () => this.toggleAnomaly());

    // Load palette
    this.els['load-palette'].addEventListener('change', (e) => this._loadPalette(e.target.files[0]));
  }

  setLoadHandlers(handlers) {
    this.loadHandlers = handlers || {};
    this.els['load-map'].addEventListener('change', (e) => handlers.map(e.target.files[0]));
    this.els['load-grid'].addEventListener('change', (e) => handlers.grid(e.target.files[0]));
    this.els['load-terrain'].addEventListener('change', (e) => handlers.terrain(e.target.files[0]));
    this.els['load-sides'].addEventListener('change', (e) => handlers.sides(e.target.files[0]));
    this.els['load-sample'].addEventListener('click', handlers.sample);
    this.els['import-sides'].addEventListener('change', (e) => handlers.importSides(e.target.files[0]));
    this.els['import-terrain'].addEventListener('change', (e) => handlers.importTerrain(e.target.files[0]));
    this.els['import-wmp'].addEventListener('change', (e) => handlers.importWmp(e.target.files[0]));
    this.els['import-twu'].addEventListener('change', (e) => handlers.importTwu(e.target.files[0]));
  }

  // ----------------- toolbar -----------------

  setViewMode(mode) {
    this.renderer.setViewMode(mode);
    this._reflectViewMode();
  }

  _isHelpToggleKey(e) {
    return e.key === '?' || (e.key === '/' && e.shiftKey);
  }

  toggleHelp(force) {
    const next = typeof force === 'boolean' ? force : !this.helpOpen;
    if (next === this.helpOpen) return;
    this.helpOpen = next;
    this.els['help-overlay'].hidden = !next;
    document.body.classList.toggle('modal-open', next);
    this._reflectHelp();
    if (next) this.els['close-help'].focus();
    else this.els['toggle-help'].focus();
  }

  _reflectHelp() {
    const btn = this.els['toggle-help'];
    btn.classList.toggle('active', this.helpOpen);
    btn.setAttribute('aria-expanded', String(this.helpOpen));
  }

  cycleViewMode() {
    const modes = ['map', 'both', 'classification'];
    const current = this.renderer.viewMode;
    const idx = modes.indexOf(current);
    const next = modes[(idx + 1) % modes.length];
    this.setViewMode(next);
  }

  _reflectViewMode() {
    const mode = this.renderer.viewMode;
    this.els['view-mode'].querySelectorAll('button[data-mode]').forEach(btn => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', String(active));
    });
  }

  setProjectSource(label = '') {
    this.projectSub = label || '';
    this._updateProjectInfo();
  }

  _updateProjectInfo() {
    const name = this.store.state?.name || 'Hexwright';
    this.els['strip-project-name'].textContent = name;
    this.els['strip-project-sub'].textContent = this.projectSub || '';
  }

  markDirty() {
    const el = this.els['save-state'];
    if (!el) return;
    el.textContent = 'unsaved edit';
    el.classList.add('dirty');
  }

  markAutosaved() {
    const el = this.els['save-state'];
    if (!el) return;
    el.textContent = 'autosaved';
    el.classList.remove('dirty');
  }

  setMode(mode) {
    if (!['inspect', 'terrain', 'edges', 'nudge'].includes(mode)) return;
    this.mode = mode;
    this.brushActive = mode === 'terrain';
    this.edgePaintActive = mode === 'edges';
    this.nudgeActive = mode === 'nudge';

    this._setupBrush();
    this._setupEdgePaint();
    this.renderer.setNudgeMode(this.nudgeActive);

    if (this.nudgeActive && this.renderer.viewMode !== 'both') {
      this.setViewMode('both');
      this.status('Nudge map: drag the scan under the grid, or arrow keys (shift = ×10). Offset autosaves with the project.', 6000);
    }

    this._reflectMode();
    this._updateModeHint();
    this._reflectBrush();
    this._reflectEdgePaint();
    this._renderBrushCard();
    this._renderLayersPanel();
    this._updateCanvasCursor();
    this.renderer.draw();
  }

  _reflectMode() {
    this.els['tool-rail'].querySelectorAll('.tool[data-mode]').forEach((btn) => {
      const active = btn.dataset.mode === this.mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', String(active));
    });
  }

  _edgeFeatureLabel() {
    const palette = this.store.getPalette();
    const feature = (palette?.hexsideFeatures || []).find((f) => f.key === this.edgePaintFeature);
    return feature?.label || feature?.key || 'Edge';
  }

  _activeTerrainLabel() {
    const palette = this.store.getPalette();
    const terrain = (palette?.terrain || []).find((t) => t.key === this.brushTerrain);
    return terrain?.label || this.brushTerrain || 'Terrain';
  }

  _updateModeHint() {
    const hint = this.els['mode-hint'];
    if (!hint) return;
    if (this.mode === 'terrain') {
      hint.innerHTML = `<b>Terrain brush · ${this._activeTerrainLabel()}</b> — click or drag hexes to paint<span class="hint-extra"> · <span class="kbd">B</span> terrain · <span class="kbd">1</span>–<span class="kbd">0</span> terrain keys</span>`;
      return;
    }
    if (this.mode === 'edges') {
      hint.innerHTML = `<b>Edge paint · ${this._edgeFeatureLabel()}</b> — click edge to toggle · drag to paint<span class="hint-extra"> · <span class="kbd">⌥</span> erase · <span class="kbd">1</span>–<span class="kbd">0</span> switch ink</span>`;
      return;
    }
    if (this.mode === 'nudge') {
      hint.innerHTML = '<b>Nudge map</b> — drag scan or arrow keys to align<span class="hint-extra"> · <span class="kbd">Shift</span> + arrows = ×10</span>';
      return;
    }
    hint.innerHTML = '<b>Inspect</b> — click a hex to edit it<span class="hint-extra"> · <span class="kbd">Esc</span> close · edges apply the ink you tap</span>';
  }

  toggleBrush() {
    this.setMode('terrain');
  }

  setBrushTerrain(key) {
    this.brushTerrain = key;
    this._setupBrush();
    this._reflectBrush();
    this._renderBrushCard();
    this._updateCanvasCursor();
  }

  _setupBrush() {
    this.renderer.setBrush({
      active: this.brushActive,
      terrainKey: this.brushTerrain,
      onPaint: (code) => {
        this.store.setTerrain(code, this.brushTerrain);
        this.lastBrushHex = code;
        this.lastBrushScreen = this.renderer.worldToScreen(this.store.centers[code]);
      },
      onShiftClick: (code) => this._paintStraightRun(code)
    });
  }

  _reflectBrush() {
    const btn = this.els['tool-terrain'];
    const palette = this.store.getPalette();
    const t = palette?.terrain?.find(x => x.key === this.brushTerrain);
    if (btn) btn.title = `Terrain brush (B) — ${t ? t.label : this.brushTerrain}`;
    this._updateModeHint();
  }

  toggleEdgePaint() {
    this.setMode('edges');
  }

  toggleNudge() {
    this.setMode('nudge');
  }

  _reflectNudge() {
    const btn = this.els['tool-nudge'];
    if (btn) btn.classList.toggle('is-active', this.mode === 'nudge');
  }

  setEdgePaintFeature(key) {
    this.edgePaintFeature = key;
    this._setupEdgePaint();
    this._reflectEdgePaint();
    this._renderBrushCard();
    this._updateCanvasCursor();
  }

  _setupEdgePaint() {
    this.renderer.setEdgePaint({
      active: this.edgePaintActive,
      featureKey: this.edgePaintFeature,
      onStrokeStart: () => this.store.beginStroke(),
      onStrokeEnd: () => this.store.endStroke(),
      onToggle: (hit) => {
        if (!this.edgePaintFeature) return;
        this.store.toggleHexsideFeature(hit.a, hit.b, this.edgePaintFeature);
      },
      onSet: (hit, opts = {}) => {
        if (!this.edgePaintFeature) return;
        const erase = !!opts.erase;
        this.store.setHexsideFeature(hit.a, hit.b, this.edgePaintFeature, !erase);
      },
      onBoundary: () => {
        this.status('That hexside faces off-map — no hex on the other side, so it cannot carry a feature. Map-edge roads/rivers need no tracing; the game handles entry/exit by hex, not hexside.', 6000);
      }
    });
  }

  _reflectEdgePaint() {
    const btn = this.els['tool-edges'];
    const palette = this.store.getPalette();
    const feature = (palette?.hexsideFeatures || []).find(f => f.key === this.edgePaintFeature);
    btn.title = `Edge paint mode (E)${feature ? ` — ${feature.label || feature.key}` : ''}`;
    this._updateModeHint();
  }

  _selectTerrainByIndex(idx) {
    const palette = this.store.getPalette();
    const t = palette?.terrain?.[idx];
    if (!t) return;
    this.setBrushTerrain(t.key);
    if (this.inspectorHex) this.store.setTerrain(this.inspectorHex, t.key);
    this.status(`Terrain ${idx + 1}: ${t.label}`, 1200);
  }

  _selectEdgeFeatureByIndex(idx) {
    const palette = this.store.getPalette();
    const feature = palette?.hexsideFeatures?.[idx];
    if (!feature) return;
    this.setEdgePaintFeature(feature.key);
    this.status(`Ink ${idx + 1}: ${feature.label || feature.key}`, 1200);
  }

  _shortcutLabel(idx) {
    if (idx < 0 || idx > 9) return '';
    return idx === 9 ? '0' : String(idx + 1);
  }

  _featureCounts() {
    const counts = {};
    for (const features of Object.values(this.store.state.hexsides || {})) {
      if (!Array.isArray(features)) continue;
      for (const key of features) counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  _hexsideFeatureColor(feature) {
    if (feature?.color) return feature.color;
    const fallback = HEXSIDE_COLORS[feature?.key];
    return fallback?.stroke || '#888';
  }

  _renderBrushCard() {
    const card = this.els['brush-card'];
    const list = this.els['brush-ink-list'];
    if (!card || !list) return;

    const show = this.mode === 'terrain' || this.mode === 'edges';
    card.style.display = show ? '' : 'none';
    if (!show) return;

    const palette = this.store.getPalette() || {};
    this.els['brush-mode-tag'].textContent = this.mode === 'edges' ? 'Edge paint' : 'Terrain';

    if (this.mode === 'edges') {
      const counts = this._featureCounts();
      const features = palette.hexsideFeatures || [];
      if (features.length && !features.some((f) => f.key === this.edgePaintFeature)) {
        this.edgePaintFeature = features[0].key;
        this._setupEdgePaint();
      }
      list.innerHTML = features.map((f, idx) => {
        const active = f.key === this.edgePaintFeature;
        const keycap = this._shortcutLabel(idx);
        const swatch = this._hexsideFeatureColor(f);
        return `<div class="ink${active ? ' is-active' : ''}" data-ink-key="${f.key}">
          <span class="swatch" style="background:${swatch}"></span>
          <span class="name">${f.label || f.key}</span>
          <span class="count">${counts[f.key] || 0}</span>
          ${keycap ? `<span class="kbd">${keycap}</span>` : ''}
        </div>`;
      }).join('');
      return;
    }

    const terrain = palette.terrain || [];
    list.innerHTML = terrain.map((t, idx) => {
      const active = t.key === this.brushTerrain;
      const keycap = this._shortcutLabel(idx);
      return `<div class="ink terrain-ink${active ? ' is-active' : ''}" data-ink-key="${t.key}">
        <span class="swatch" style="background:${t.color || '#888'}"></span>
        <span class="name">${t.label || t.key}</span>
        ${keycap ? `<span class="kbd">${keycap}</span>` : ''}
      </div>`;
    }).join('');
  }

  _featureVisible(featureKey) {
    const visibility = this.renderer.hexsideVisibility || {};
    return visibility[featureKey] !== false;
  }

  toggleHexsideLayerVisibility(featureKey) {
    if (!featureKey) return;
    if (!this.renderer.hexsideVisibility) this.renderer.hexsideVisibility = {};
    this.renderer.hexsideVisibility[featureKey] = !this._featureVisible(featureKey);
    this._renderLayersPanel();
    this.renderer.draw();
  }

  _traceColor(trace) {
    const palette = this.store.getPalette();
    const feature = (palette?.hexsideFeatures || []).find((f) => f.key === trace.layer || f.exportLayer === trace.layer);
    if (feature) return this._hexsideFeatureColor(feature);
    return HEXSIDE_COLORS[trace.layer]?.stroke || '#888';
  }

  _renderLayersPanel() {
    const palette = this.store.getPalette() || {};
    const counts = this._featureCounts();
    const features = palette.hexsideFeatures || [];
    const featureRows = this.els['feature-layer-rows'];

    featureRows.innerHTML = features.map((f) => {
      const on = this._featureVisible(f.key);
      return `<div class="layer-row${on ? '' : ' dimmed'}">
        <button type="button" class="eye${on ? '' : ' off'}" data-feature-key="${f.key}" aria-label="Toggle ${f.label || f.key}">
          ${on ? EYE_OPEN_SVG : EYE_OFF_SVG}
        </button>
        <span class="swatch" style="background:${this._hexsideFeatureColor(f)}"></span>
        <span class="name">${f.label || f.key}</span>
        <span class="count">${counts[f.key] || 0}</span>
      </div>`;
    }).join('');

    const terrainFillOn = this.renderer.terrainFillVisible !== false;
    this.els['terrain-fill-row'].classList.toggle('dimmed', !terrainFillOn);
    this.els['terrain-fill-eye'].classList.toggle('off', !terrainFillOn);
    this.els['terrain-fill-eye'].innerHTML = terrainFillOn ? EYE_OPEN_SVG : EYE_OFF_SVG;

    const overlayOpacity = Math.max(0, Math.min(1, this.renderer.overlayAlpha ?? 1));
    this.els['overlay-opacity'].value = String(overlayOpacity);
    this.els['overlay-opacity-value'].textContent = `${Math.round(overlayOpacity * 100)}%`;
    this.els['terrain-fill-count'].textContent = `${Math.round(overlayOpacity * 100)}%`;

    const traces = this.store.state.traces || [];
    this.els['trace-layer-wrap'].hidden = traces.length === 0;
    if (traces.length) {
      this.els['trace-layer-rows'].innerHTML = traces.map((trace, idx) => {
        const on = trace.on !== false;
        return `<div class="layer-row${on ? '' : ' dimmed'}">
          <button type="button" class="eye${on ? '' : ' off'}" data-trace-index="${idx}" aria-label="Toggle ${trace.name}">
            ${on ? EYE_OPEN_SVG : EYE_OFF_SVG}
          </button>
          <span class="swatch" style="background:${this._traceColor(trace)}"></span>
          <span class="name">${trace.name}</span>
          <span class="count">${on ? 'on' : 'off'}</span>
        </div>`;
      }).join('');
      const traceOpacity = Number.isFinite(traces[0]?.opacity) ? traces[0].opacity : 0.5;
      this.els['trace-opacity'].value = String(traceOpacity);
      this.els['trace-opacity-value'].textContent = `${Math.round(traceOpacity * 100)}%`;
    }

    const mapDim = Math.max(0, Math.min(0.85, this.renderer.mapDim || 0));
    this.els['map-dim'].value = String(mapDim);
    this.els['map-dim-value'].textContent = `${Math.round(mapDim * 100)}%`;
  }

  _terrainColorForCursor() {
    const palette = this.store.getPalette();
    const terrain = (palette?.terrain || []).find((t) => t.key === this.brushTerrain);
    return terrain?.color || '#cccccc';
  }

  _edgeColorForCursor() {
    const palette = this.store.getPalette();
    const feature = (palette?.hexsideFeatures || []).find((f) => f.key === this.edgePaintFeature);
    return this._hexsideFeatureColor(feature);
  }

  _buildInkCursor(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
      <path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5" stroke="rgba(255,255,255,0.85)" stroke-width="1.4" stroke-linecap="round"/>
      <circle cx="12" cy="12" r="4.6" fill="${color}" stroke="rgba(255,255,255,0.95)" stroke-width="1.8"/>
    </svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
  }

  _updateCanvasCursor() {
    const wrap = this.els['canvas-wrap'];
    if (!wrap) return;
    if (this.mode === 'nudge') {
      wrap.style.cursor = 'move';
      return;
    }
    if (this.mode === 'inspect') {
      wrap.style.cursor = 'default';
      return;
    }
    const color = this.mode === 'edges' ? this._edgeColorForCursor() : this._terrainColorForCursor();
    wrap.style.cursor = this._buildInkCursor(color);
  }

  _paintStraightRun(toCode) {
    if (!this.lastBrushHex || !this.lastBrushScreen) return;
    const toCenter = this.store.centers[toCode];
    if (!toCenter) return;
    const toScreen = this.renderer.worldToScreen(toCenter);
    const dx = toScreen.x - this.lastBrushScreen.x;
    const dy = toScreen.y - this.lastBrushScreen.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 24));
    const painted = new Set();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = this.lastBrushScreen.x + dx * t;
      const y = this.lastBrushScreen.y + dy * t;
      const code = this.renderer.hexAtScreen({ x, y });
      if (code && !painted.has(code)) {
        painted.add(code);
        this.store.setTerrain(code, this.brushTerrain);
      }
    }
    this.lastBrushHex = toCode;
    this.lastBrushScreen = toScreen;
  }

  toggleAnomaly() {
    this.anomalyActive = !this.anomalyActive;
    this.renderer.setAnomalyMode(this.anomalyActive);
    this._reflectAnomaly();
    this._updateAnomalyStatus();
  }

  _reflectAnomaly() {
    this.els['toggle-anomaly'].classList.toggle('active', this.anomalyActive);
    this.els['toggle-anomaly'].setAttribute('aria-pressed', String(this.anomalyActive));
  }

  _updateAnomalyStatus() {
    const c = this.renderer.computeAnomalies();
    this.els['anomaly-count'].textContent = String(c.unclassified + c.orphanHexsides + c.draft);
    const el = this.els['anomaly-status'];
    if (!this.anomalyActive) { el.textContent = ''; return; }
    el.textContent = `${c.unclassified} unclass, ${c.orphanHexsides} orphan, ${c.draft} draft`;
  }

  async _loadPalette(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const config = JSON.parse(text);
      this.store.setPalette(config);
      this.status(`Palette loaded: ${config.name || file.name}`, 2000);
    } catch (e) {
      this.status(`Palette load failed: ${e.message}`, 3000);
    }
  }

  // ----------------- inspector -----------------

  openInspector(code) {
    this.inspectorHex = code;
    this.hexedSelectedEdge = null;
    this.els['hexed-title'].textContent = `Hex ${code}`;
    this.els['hex-editor'].hidden = false;
    this.els['layers-panel'].hidden = true;
    this._refreshInspector();
    for (let i = 0; i < 6; i++) {
      if (edgeNeighbor(code, i, this.store.centers, this.store.state.grid)) {
        this._selectHexEditorEdge(i);
        break;
      }
    }
  }

  _refreshInspector() {
    if (!this.inspectorHex) return;
    const code = this.inspectorHex;
    const palette = this.store.getPalette();
    const terrainKey = this.store.state.terrain.terrain[code] || 'clear';
    const terrain = (palette?.terrain || []).find(t => t.key === terrainKey);
    this.els['hexed-terrain-current'].textContent = terrain?.label || terrainKey;
    this.els['hexed-center-code'].textContent = code;

    const terrainColor = terrain?.color || '#888';
    this.els['hexed-fill'].setAttribute('fill', terrainColor);
    this.els['hexed-fill'].setAttribute('fill-opacity', '0.18');

    this.els['hexed-terrain-grid'].querySelectorAll('.terr[data-terrain]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.terrain === terrainKey);
    });

    const currentFeatures = this.store.getHexFeatures(code);
    this.els['hexed-feat-count'].textContent = String(currentFeatures.length);
    this.els['hexed-featrow'].querySelectorAll('.feat[data-feature]').forEach(btn => {
      btn.classList.toggle('is-active', currentFeatures.includes(btn.dataset.feature));
    });

    const centers = this.store.centers;
    const grid = this.store.state.grid;
    let marked = 0;
    for (let i = 0; i < 6; i++) {
      const nb = edgeNeighbor(code, i, centers, grid);
      const hit = this.hexedEdgeGroups[i]?.querySelector('.edge-hit');
      if (hit) {
        hit.classList.toggle('disabled', !nb);
        hit.style.pointerEvents = nb ? 'auto' : 'none';
      }
      if (nb && this.store.edgeFeatures(code, nb).length) marked++;
    }

    const selLabel = this.hexedSelectedEdge !== null ? EDGE_NAMES[this.hexedSelectedEdge] : '—';
    this.els['hexed-edges-meta'].textContent = `${marked} of 6 marked · ${selLabel} selected`;

    this.hexedEdgeLabels.forEach((label, i) => {
      label.classList.toggle('sel', i === this.hexedSelectedEdge);
    });

    this._paintHexEditorDiagram();
    this._refreshHexEditorEdgePanel();
  }

  closeInspector() {
    this.inspectorHex = null;
    this.hexedSelectedEdge = null;
    this.els['hex-editor'].hidden = true;
    this.els['layers-panel'].hidden = false;
    this.renderer.closeInspector();
  }

  _toggleHexFeature(key) {
    if (!this.inspectorHex) return;
    this.store.toggleHexFeature(this.inspectorHex, key);
  }

  _toggleHexEditorInk(featureKey) {
    if (!this.inspectorHex || this.hexedSelectedEdge === null) return;
    const i = this.hexedSelectedEdge;
    const nb = edgeNeighbor(this.inspectorHex, i, this.store.centers, this.store.state.grid);
    if (!nb) return;
    this.store.toggleHexsideFeature(this.inspectorHex, nb, featureKey);
  }

  _paintHexEditorDiagram() {
    if (!this.inspectorHex) return;
    const svgNs = 'http://www.w3.org/2000/svg';
    const centers = this.store.centers;
    const grid = this.store.state.grid;
    const palette = this.store.getPalette();
    const features = palette?.hexsideFeatures || [];
    const code = this.inspectorHex;

    for (let i = 0; i < 6; i++) {
      const group = this.hexedEdgeGroups[i];
      const hit = group.querySelector('.edge-hit');
      const inksG = group.querySelector('.edge-inks');
      const sel = group.querySelector('.edge-sel-overlay');
      inksG.innerHTML = '';

      const nb = edgeNeighbor(code, i, centers, grid);
      const current = nb ? this.store.edgeFeatures(code, nb) : [];
      const { a, b } = this.hexedEdgePts[i];
      const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;

      if (!current.length) {
        hit.setAttribute('stroke', '#4a4e57');
        hit.setAttribute('stroke-width', '10');
      } else {
        hit.setAttribute('stroke', 'transparent');
        hit.setAttribute('stroke-width', '14');
        current.forEach((featureKey, idx) => {
          const f = features.find(x => x.key === featureKey);
          if (!f) return;
          const color = this._hexsideFeatureColor(f);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = -dy / len;
          const uy = dx / len;
          const n = current.length;
          const off = -((n - 1) * 4) / 2 + idx * 4;
          const x1 = a.x + ux * off;
          const y1 = a.y + uy * off;
          const x2 = b.x + ux * off;
          const y2 = b.y + uy * off;
          const segD = `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`;

          const casing = document.createElementNS(svgNs, 'path');
          casing.setAttribute('d', segD);
          casing.setAttribute('stroke', 'var(--ink-casing)');
          casing.setAttribute('stroke-width', '12');
          casing.setAttribute('stroke-linecap', 'round');
          casing.setAttribute('fill', 'none');
          casing.setAttribute('pointer-events', 'none');
          inksG.appendChild(casing);

          const core = document.createElementNS(svgNs, 'path');
          core.setAttribute('d', segD);
          core.setAttribute('stroke', color);
          core.setAttribute('stroke-width', '6');
          core.setAttribute('stroke-linecap', 'round');
          core.setAttribute('fill', 'none');
          core.setAttribute('pointer-events', 'none');
          if (f.dash) core.setAttribute('stroke-dasharray', '7 5');
          inksG.appendChild(core);
        });
      }

      sel.setAttribute('d', d);
      sel.setAttribute('opacity', i === this.hexedSelectedEdge ? '0.28' : '0');
    }
  }

  updateUI(reason) {
    this._updateProjectInfo();
    const palette = this.store.getPalette();
    const paletteChanged = palette !== this._lastPalette;
    if (paletteChanged) {
      this._lastPalette = palette;
      this._rebuildHexEditorPalette();
      this._setupEdgePaint();
      if (this.inspectorHex) this._refreshInspector();
    }
    this._renderBrushCard();
    this._renderLayersPanel();
    this._updateCounts();
    this._updateAnomalyStatus();
    this.els['undo'].disabled = !this.store.canUndo();
    this._reflectViewMode();
    this._reflectMode();
    this._updateModeHint();
    this._reflectBrush();
    this._reflectEdgePaint();
    this._updateCanvasCursor();

    if (this.inspectorHex && !paletteChanged) {
      this._refreshInspector();
    }

    // Batch canvas repaints so rapid edits (brush drag) don't thrash the GPU.
    if (!this._drawRaf) {
      this._drawRaf = requestAnimationFrame(() => {
        this._drawRaf = null;
        this.renderer.draw();
      });
    }
  }

  _updateCounts() {
    const counts = this.store.getCounts();
    this.els['count-land'].textContent = counts.land;
    const lc = this.els['layer-counts'];
    const palette = this.store.getPalette();
    lc.innerHTML = EDITABLE_LAYERS.map(l => {
      let color = '#888';
      if (palette && palette.hexsideFeatures) {
        const f = palette.hexsideFeatures.find(x => x.exportLayer === l || x.key === l);
        if (f) color = f.color;
      }
      if (color === '#888' && HEXSIDE_COLORS[l]) color = HEXSIDE_COLORS[l].stroke;
      return `
      <div class="layer-count">
        <span><span class="layer-dot" style="background:${color}"></span>${LAYER_LABELS[l] || l}</span>
        <span class="mono">${counts.layers[l] || 0}</span>
      </div>`;
    }).join('');
  }

  status(msg, timeout = 0) {
    const el = this.els['status'];
    if (!msg) { el.textContent = ''; return; }
    el.textContent = msg;
    if (timeout) {
      clearTimeout(this._statusTimer);
      this._statusTimer = setTimeout(() => { el.textContent = ''; }, timeout);
    }
  }

  _download(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    this.status(`Downloaded ${filename}`, 2000);
  }

  async _copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      this.status(`Copied ${label} to clipboard`, 2000);
    } catch (e) {
      this.status('Clipboard copy failed', 3000);
    }
  }
}
