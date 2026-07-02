import {
  TERRAIN_COLORS, EDITABLE_LAYERS, HEXSIDE_COLORS,
  hexCenter, hexPolygon, edgeNeighbor
} from './geometry.js';

const LAYER_LABELS = {
  rivers: 'river',
  mountains: 'ridge',
  impassible: 'impass',
  roads: 'road',
  rails: 'rail'
};

const EDGE_NAMES = ['E', 'NE', 'NW', 'W', 'SW', 'SE'];

export class UI {
  constructor(store, renderer) {
    this.store = store;
    this.renderer = renderer;
    this.els = {};
    this.gatherElements();

    this._lastPalette = null;
    this.edgeGroups = [];
    this.edgePoints = [];
    this.edgeSelectGroups = [];

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

    this.buildInspectorEdges();
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
      'edge-paint-picker', 'export-overlay', 'toggle-anomaly', 'anomaly-count', 'load-palette', 'anomaly-status',
      'import-sides', 'import-terrain', 'import-wmp', 'file-btn', 'file-popover', 'export-btn', 'export-popover',
      'import-twu',
      'export-sides-file', 'export-sides-copy', 'export-terrain-file', 'export-terrain-copy', 'export-twu',
      'inspector', 'inspector-close', 'inspector-hex', 'inspector-terrain',
      'hex-svg', 'hex-shape', 'hex-edges', 'edge-selects', 'inspector-features',
      'terrain-legend', 'hexside-legend', 'feature-legend', 'trace-controls', 'trace-opacity',
      'overlay-opacity', 'count-land', 'layer-counts', 'status',
      'help-overlay', 'close-help'
    ];
    for (const id of ids) this.els[id] = document.getElementById(id);
  }

  buildInspectorEdges() {
    const g = this.els['hex-edges'];
    const selects = this.els['edge-selects'];
    const r = 90; // illustration radius
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    const pointsAttr = pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    this.els['hex-shape'].setAttribute('points', pointsAttr);

    for (let i = 0; i < 6; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 6];
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('data-edge', i);
      g.appendChild(group);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x);
      line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x);
      line.setAttribute('y2', b.y);
      line.setAttribute('class', 'hex-edge');
      line.setAttribute('data-edge', i);
      line.addEventListener('mouseenter', () => this._highlightEdge(i));
      line.addEventListener('mouseleave', () => this._unhighlightEdge());
      line.addEventListener('click', () => this._focusEdgeSelect(i));
      group.appendChild(line);

      this.edgeGroups.push(group);
      this.edgePoints.push({ a, b });
    }

    this._rebuildEdgeControls();
    this._rebuildFeatureControls();
    this._rebuildEdgePaintPicker();
  }

  _rebuildEdgeControls() {
    const selects = this.els['edge-selects'];
    selects.innerHTML = '';
    this.edgeSelectGroups = [];
    const palette = this.store.getPalette();
    const features = palette?.hexsideFeatures || [];

    for (let i = 0; i < 6; i++) {
      const a = { x: 90 * Math.cos((Math.PI / 3) * i), y: 90 * Math.sin((Math.PI / 3) * i) };
      const b = { x: 90 * Math.cos((Math.PI / 3) * ((i + 1) % 6)), y: 90 * Math.sin((Math.PI / 3) * ((i + 1) % 6)) };
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

      const edgeDiv = document.createElement('div');
      edgeDiv.className = 'edge-features';
      edgeDiv.dataset.edge = i;
      edgeDiv.style.left = `${120 + mid.x}px`;
      edgeDiv.style.top = `${110 + mid.y}px`;
      edgeDiv.setAttribute('role', 'group');
      edgeDiv.setAttribute('aria-label', `Edge ${EDGE_NAMES[i]}`);

      const label = document.createElement('span');
      label.className = 'edge-label';
      label.textContent = EDGE_NAMES[i];
      edgeDiv.appendChild(label);

      const chips = document.createElement('div');
      chips.className = 'edge-chips';
      let prevKind = null;
      for (const f of features) {
        const kind = f.kind === 'crossing' ? 'crossing' : 'edge';
        if (prevKind !== null && kind !== prevKind) {
          const divider = document.createElement('span');
          divider.className = 'edge-chip-divider';
          divider.title = 'crossings (road / rail / bridge)';
          chips.appendChild(divider);
        }
        prevKind = kind;
        const chip = document.createElement('div');
        chip.className = 'edge-chip' + (kind === 'crossing' ? ' edge-chip--crossing' : '');
        chip.title = (f.label || f.key) + (kind === 'crossing' ? ' (crosses this hexside)' : '');
        chip.dataset.edge = i;
        chip.dataset.feature = f.key;
        chip.dataset.kind = kind;
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.tabIndex = -1;
        chk.dataset.edge = i;
        chk.dataset.feature = f.key;
        chk.style.accentColor = f.color;
        chip.appendChild(chk);
        chip.addEventListener('click', () => { if (chk.disabled) return; this._toggleEdgeFeature(i, f.key); });
        chips.appendChild(chip);
      }
      edgeDiv.appendChild(chips);

      edgeDiv.addEventListener('mouseenter', () => this._highlightEdge(i));
      edgeDiv.addEventListener('mouseleave', () => this._unhighlightEdge());

      selects.appendChild(edgeDiv);
      this.edgeSelectGroups.push(edgeDiv);
    }
  }

  _rebuildFeatureControls() {
    const container = this.els['inspector-features'];
    container.innerHTML = '';
    const palette = this.store.getPalette();
    const features = palette?.hexFeatures || [];
    for (const f of features) {
      const chip = document.createElement('div');
      chip.className = 'feature-chip';
      chip.dataset.feature = f.key;
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.tabIndex = -1;
      chk.dataset.feature = f.key;
      const glyph = document.createElement('span');
      glyph.className = 'feature-glyph';
      glyph.textContent = f.glyph || '◆';
      const name = document.createElement('span');
      name.className = 'feature-label';
      name.textContent = f.label || f.key;
      chip.appendChild(chk);
      chip.appendChild(glyph);
      chip.appendChild(name);
      chip.addEventListener('click', () => this._toggleHexFeature(f.key));
      container.appendChild(chip);
    }
  }

  _rebuildEdgePaintPicker() {
    const container = this.els['edge-paint-picker'];
    if (!container) return;
    container.innerHTML = '';
    const palette = this.store.getPalette();
    const features = palette?.hexsideFeatures || [];
    if (!features.length) return;
    if (!this.edgePaintFeature || !features.some(f => f.key === this.edgePaintFeature)) {
      this.edgePaintFeature = features[0].key;
    }
    for (const f of features) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'edge-paint-chip';
      chip.dataset.feature = f.key;
      chip.title = f.label || f.key;
      chip.setAttribute('aria-label', f.label || f.key);

      const swatch = document.createElement('span');
      swatch.className = 'edge-paint-chip-swatch';
      swatch.style.background = f.color || '#888';
      if (f.dash) swatch.classList.add('edge-paint-chip-swatch-dash');
      chip.appendChild(swatch);

      const text = document.createElement('span');
      text.className = 'edge-paint-chip-label';
      text.textContent = f.label || f.key;
      chip.appendChild(text);

      chip.addEventListener('click', () => this.setEdgePaintFeature(f.key));
      container.appendChild(chip);
    }
    this._reflectEdgePaint();
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
        this._selectTerrainByIndex(idx);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.store.undo();
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
    this.els['inspector-close'].addEventListener('click', () => this.closeInspector());
    this.els['toggle-help'].addEventListener('click', () => this.toggleHelp());
    this.els['close-help'].addEventListener('click', () => this.toggleHelp(false));
    this.els['help-overlay'].addEventListener('click', (e) => {
      if (e.target === this.els['help-overlay']) this.toggleHelp(false);
    });
    // The inspector floats over the map canvas, inside the same wrapper that has the
    // pan/hex-select pointer handler. Without this, a trusted click on any inspector
    // control also fires the canvas pointerdown/up -> it re-selects the hex under the
    // control and rebuilds the inspector mid-click, swallowing the control's own click
    // (chips/dropdowns silently do nothing on real clicks, only synthetic events work).
    ['pointerdown','pointerup','mousedown','mouseup'].forEach(evt =>
      this.els['inspector'].addEventListener(evt, (e) => e.stopPropagation()));

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

    this.els['inspector-terrain'].addEventListener('change', () => {
      const key = this.els['inspector-terrain'].value;
      if (this.inspectorHex) this.store.setTerrain(this.inspectorHex, key);
      this.brushTerrain = key;
      this._reflectBrush();
    });

    this.els['trace-opacity'].addEventListener('input', (e) => {
      const op = parseFloat(e.target.value);
      for (let i = 0; i < this.store.state.traces.length; i++) {
        this.store.setTraceOpacity(i, op);
      }
    });

    // Terrain-fill (classification overlay) opacity — lets the scan show
    // through in Both view for hand-tracing; hexsides/grid stay full-strength.
    // Dragging it in Map/Classification view switches to Both first: the
    // slider only means something where map AND fills are drawn together, so
    // it must never silently no-op.
    this.els['overlay-opacity'].addEventListener('input', (e) => {
      if (this.renderer.viewMode !== 'both') this.setViewMode('both');
      this.renderer.overlayAlpha = parseFloat(e.target.value);
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

  _updateModeHint() {
    const hint = this.els['mode-hint'];
    if (!hint) return;
    if (this.mode === 'terrain') {
      hint.innerHTML = '<b>Terrain brush</b> — click or drag hexes to paint<span class="hint-extra"> · <span class="kbd">B</span> terrain · <span class="kbd">1</span>–<span class="kbd">0</span> terrain keys</span>';
      return;
    }
    if (this.mode === 'edges') {
      hint.innerHTML = `<b>Edge paint · ${this._edgeFeatureLabel()}</b> — click edge to toggle · drag to paint<span class="hint-extra"> · <span class="kbd">⌥</span> erase · <span class="kbd">E</span> edges</span>`;
      return;
    }
    if (this.mode === 'nudge') {
      hint.innerHTML = '<b>Nudge map</b> — drag scan or arrow keys to align<span class="hint-extra"> · <span class="kbd">Shift</span> + arrows = ×10</span>';
      return;
    }
    hint.innerHTML = '<b>Inspect</b> — click hex to inspect and edit<span class="hint-extra"> · <span class="kbd">I</span> inspect</span>';
  }

  toggleBrush() {
    this.setMode('terrain');
  }

  setBrushTerrain(key) {
    this.brushTerrain = key;
    this._setupBrush();
    this._reflectBrush();
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
      }
    });
  }

  _reflectEdgePaint() {
    const btn = this.els['tool-edges'];
    const picker = this.els['edge-paint-picker'];
    const palette = this.store.getPalette();
    const feature = (palette?.hexsideFeatures || []).find(f => f.key === this.edgePaintFeature);
    btn.title = `Edge paint mode (E)${feature ? ` — ${feature.label || feature.key}` : ''}`;
    picker.classList.toggle('active', this.edgePaintActive);
    picker.querySelectorAll('.edge-paint-chip').forEach((chip) => {
      chip.classList.toggle('selected', chip.dataset.feature === this.edgePaintFeature);
    });
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

  openInspector(code, screenPt) {
    this.inspectorHex = code;
    this.els['inspector-hex'].textContent = code;
    this.els['inspector'].hidden = false;

    const terrain = this.store.state.terrain.terrain[code] || 'clear';
    this._fillTerrainSelect();
    this.els['inspector-terrain'].value = terrain;

    this._refreshInspector();
    this._positionInspector(screenPt);
  }

  _refreshInspector() {
    if (!this.inspectorHex) return;
    const code = this.inspectorHex;
    const terrain = this.store.state.terrain.terrain[code] || 'clear';
    this.els['inspector-terrain'].value = terrain;

    // in-hex features
    const currentFeatures = this.store.getHexFeatures(code);
    this.els['inspector-features'].querySelectorAll('input[type="checkbox"]').forEach(ch => {
      ch.checked = currentFeatures.includes(ch.dataset.feature);
    });

    // edges
    const centers = this.store.centers;
    const grid = this.store.state.grid;
    for (let i = 0; i < 6; i++) {
      const nb = edgeNeighbor(code, i, centers, grid);
      const current = nb ? this.store.edgeFeatures(code, nb) : [];
      const group = this.edgeSelectGroups[i];
      group.classList.toggle('disabled', !nb);
      group.querySelectorAll('input[type="checkbox"]').forEach(ch => {
        ch.disabled = !nb;
        ch.checked = nb ? current.includes(ch.dataset.feature) : false;
      });
      if (nb) this.edgeGroups[i].classList.remove('dim');
      else this.edgeGroups[i].classList.add('dim');
    }

    this._paintEdges();
  }

  _fillTerrainSelect() {
    const sel = this.els['inspector-terrain'];
    if (sel.dataset.ready) return;
    const palette = this.store.getPalette();
    const items = palette && palette.terrain ? palette.terrain : Object.keys(TERRAIN_COLORS).map(k => ({ key: k, label: k }));
    sel.innerHTML = items.map(t =>
      `<option value="${t.key}">${t.label || t.key}</option>`
    ).join('');
    sel.dataset.ready = '1';
  }

  _positionInspector(screenPt) {
    const rect = this.els['inspector'].getBoundingClientRect();
    const wrap = this.canvasWrapRect();
    let x = (screenPt?.x ?? wrap.width / 2) + 18;
    let y = (screenPt?.y ?? wrap.height / 2) - rect.height / 2;
    if (x + rect.width > wrap.width) x = Math.max(8, (screenPt?.x ?? wrap.width / 2) - rect.width - 18);
    if (y + rect.height > wrap.height) y = Math.max(8, wrap.height - rect.height - 8);
    if (y < 8) y = 8;
    this.els['inspector'].style.left = `${x}px`;
    this.els['inspector'].style.top = `${y}px`;
  }

  canvasWrapRect() {
    return document.getElementById('canvas-wrap').getBoundingClientRect();
  }

  closeInspector() {
    this.inspectorHex = null;
    this.els['inspector'].hidden = true;
    this.renderer.closeInspector();
  }

  _highlightEdge(i) {
    if (!this.inspectorHex) return;
    const nb = edgeNeighbor(this.inspectorHex, i, this.store.centers, this.store.state.grid);
    const line = this.edgeGroups[i].querySelector('.hex-edge');
    if (line) line.classList.add('active');
    this.renderer.setHighlight(this.inspectorHex, i, nb);
    if (nb) this.status(`Edge ${EDGE_NAMES[i]} → ${nb}`, 2000);
  }

  _unhighlightEdge() {
    for (const g of this.edgeGroups) {
      const line = g.querySelector('.hex-edge');
      if (line) line.classList.remove('active');
    }
    this.renderer.clearHighlight();
    this.status('');
  }

  _focusEdgeSelect(i) {
    const chk = this.edgeSelectGroups[i].querySelector('input[type="checkbox"]');
    if (chk) chk.focus();
  }

  _toggleHexFeature(key) {
    if (!this.inspectorHex) return;
    this.store.toggleHexFeature(this.inspectorHex, key);
  }

  _toggleEdgeFeature(i, featureKey) {
    if (!this.inspectorHex) return;
    const nb = edgeNeighbor(this.inspectorHex, i, this.store.centers, this.store.state.grid);
    if (!nb) return;
    this.store.toggleHexsideFeature(this.inspectorHex, nb, featureKey);
  }

  // Paint each edge of the inspector hexagon by its assigned hexside feature(s).
  _paintEdges() {
    if (!this.inspectorHex) return;
    const centers = this.store.centers;
    const grid = this.store.state.grid;
    const palette = this.store.getPalette();
    const features = palette?.hexsideFeatures || [];

    for (let i = 0; i < 6; i++) {
      const nb = edgeNeighbor(this.inspectorHex, i, centers, grid);
      const current = nb ? this.store.edgeFeatures(this.inspectorHex, nb) : [];
      const group = this.edgeGroups[i];

      // remove old feature strokes
      group.querySelectorAll('.hex-edge-layer').forEach(el => el.remove());

      const { a, b } = this.edgePoints[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = -dy / len;
      const uy = dx / len;
      const spacing = 5;
      const n = current.length;
      const offsetBase = -((n - 1) * spacing) / 2;

      current.forEach((featureKey, idx) => {
        const f = features.find(x => x.key === featureKey);
        if (!f) return;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'hex-edge-layer');
        const off = offsetBase + idx * spacing;
        line.setAttribute('x1', a.x + ux * off);
        line.setAttribute('y1', a.y + uy * off);
        line.setAttribute('x2', b.x + ux * off);
        line.setAttribute('y2', b.y + uy * off);
        line.setAttribute('stroke', f.color);
        line.setAttribute('stroke-width', '5');
        line.setAttribute('stroke-linecap', 'round');
        group.appendChild(line);
      });
    }
  }

  updateUI(reason) {
    this._updateProjectInfo();
    const palette = this.store.getPalette();
    const paletteChanged = palette !== this._lastPalette;
    if (paletteChanged) {
      this._lastPalette = palette;
      this._rebuildEdgeControls();
      this._rebuildFeatureControls();
      this._rebuildEdgePaintPicker();
      this.els['inspector-terrain'].dataset.ready = '';
      this.els['terrain-legend'].dataset.ready = '';
      this.els['hexside-legend'].dataset.ready = '';
      this.els['feature-legend'].dataset.ready = '';
      this.els['trace-controls'].dataset.ready = '';
      this._setupEdgePaint();
      if (this.inspectorHex) this._refreshInspector();
    }

    this._fillTerrainSelect();
    this._updateLegend();
    this._updateTraceControls();
    this._updateCounts();
    this._updateAnomalyStatus();
    this.els['undo'].disabled = !this.store.canUndo();
    this._reflectViewMode();
    this._reflectMode();
    this._updateModeHint();
    this._reflectBrush();
    this._reflectEdgePaint();

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

  _updateLegend() {
    const ulTerrain = this.els['terrain-legend'];
    if (ulTerrain.dataset.ready) return;
    const palette = this.store.getPalette() || {};

    ulTerrain.innerHTML = (palette.terrain || []).map(t =>
      `<li><span class="legend-swatch" style="background:${t.color};border-color:${t.color}"></span>${t.label || t.key}</li>`
    ).join('');

    this.els['hexside-legend'].innerHTML = (palette.hexsideFeatures || []).map(f => {
      const dash = f.dash ? 'border-top-style: dashed;' : '';
      return `<li><span class="legend-line" style="background:${f.color};${dash}"></span>${f.label || f.key}</li>`;
    }).join('');

    this.els['feature-legend'].innerHTML = (palette.hexFeatures || []).map(f =>
      `<li><span class="legend-glyph">${f.glyph || '◆'}</span>${f.label || f.key}</li>`
    ).join('');

    ulTerrain.dataset.ready = '1';
  }

  _updateTraceControls() {
    const container = this.els['trace-controls'];
    if (container.dataset.ready) return;
    const palette = this.store.getPalette();
    container.innerHTML = this.store.state.traces.map((t, i) => {
      let color = '#888';
      if (palette && palette.hexsideFeatures) {
        const f = palette.hexsideFeatures.find(x => x.key === t.layer || x.exportLayer === t.layer);
        if (f) color = f.color;
      }
      if (color === '#888' && HEXSIDE_COLORS[t.layer]) color = HEXSIDE_COLORS[t.layer].stroke;
      return `
      <div class="trace-row">
        <label>
          <input type="checkbox" data-trace="${i}" ${t.on ? 'checked' : ''} />
          <span class="layer-dot" style="background:${color}"></span>
          ${t.name}
        </label>
      </div>`;
    }).join('');
    container.querySelectorAll('input[data-trace]').forEach(ch => {
      ch.addEventListener('change', (e) => {
        this.store.setTraceOn(Number(e.target.dataset.trace), e.target.checked);
      });
    });
    container.dataset.ready = '1';
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
