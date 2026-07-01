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
    this.buildInspectorEdges();
    this.bindGlobal();
    this.bindControls();
    this.updateUI();
  }

  gatherElements() {
    const ids = [
      'load-map', 'load-grid', 'load-terrain', 'load-sides', 'load-sample',
      'fit-view', 'undo', 'clear-select',
      'import-sides', 'import-terrain', 'export-btn', 'export-popover',
      'export-sides-file', 'export-sides-copy', 'export-terrain-file', 'export-terrain-copy',
      'inspector', 'inspector-close', 'inspector-hex', 'inspector-terrain',
      'hex-svg', 'hex-shape', 'hex-edges', 'edge-selects',
      'terrain-legend', 'trace-controls', 'trace-opacity',
      'count-land', 'layer-counts', 'status'
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
      g.appendChild(line);

      // select at edge midpoint
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const sel = document.createElement('select');
      sel.dataset.edge = i;
      sel.setAttribute('aria-label', `Edge ${i + 1} layer`);
      sel.innerHTML = `
        <option value="">—</option>
        ${EDITABLE_LAYERS.map(l => `<option value="${l}">${LAYER_LABELS[l] || l}</option>`).join('')}
      `;
      sel.style.left = `${120 + mid.x}px`;
      sel.style.top = `${110 + mid.y}px`;
      sel.addEventListener('mouseenter', () => this._highlightEdge(i));
      sel.addEventListener('mouseleave', () => this._unhighlightEdge());
      sel.addEventListener('focus', () => this._highlightEdge(i));
      sel.addEventListener('blur', () => this._unhighlightEdge());
      sel.addEventListener('change', () => this._setEdgeLayer(i, sel.value));
      selects.appendChild(sel);
    }
    this.edgeLines = Array.from(g.children);
    this.edgeSelects = Array.from(selects.children);
  }

  bindGlobal() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeInspector();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.store.undo();
      }
    });

    this.store.onChange((reason) => this.updateUI(reason));
    this.renderer.onHexSelect = (code, screenPt) => {
      if (code) this.openInspector(code, screenPt);
      else this.closeInspector();
    };

    // close export popover on outside click
    document.addEventListener('click', (e) => {
      if (!this.els['export-popover'].contains(e.target) && e.target !== this.els['export-btn']) {
        this.els['export-popover'].classList.remove('open');
      }
    });
  }

  bindControls() {
    this.els['fit-view'].addEventListener('click', () => this.renderer.fitView());
    this.els['undo'].addEventListener('click', () => this.store.undo());
    this.els['clear-select'].addEventListener('click', () => this.closeInspector());
    this.els['inspector-close'].addEventListener('click', () => this.closeInspector());

    this.els['export-btn'].addEventListener('click', () => {
      this.els['export-popover'].classList.toggle('open');
    });
    this.els['export-sides-file'].addEventListener('click', () => this._download('hexsides.json', this.store.exportHexsidesJson()));
    this.els['export-sides-copy'].addEventListener('click', () => this._copy(this.store.exportHexsidesJson(), 'hexsides.json'));
    this.els['export-terrain-file'].addEventListener('click', () => this._download('terrain.json', this.store.exportTerrainJson()));
    this.els['export-terrain-copy'].addEventListener('click', () => this._copy(this.store.exportTerrainJson(), 'terrain.json'));

    this.els['inspector-terrain'].addEventListener('change', () => {
      if (this.inspectorHex) this.store.setTerrainType(this.inspectorHex, this.els['inspector-terrain'].value);
    });

    this.els['trace-opacity'].addEventListener('input', (e) => {
      const op = parseFloat(e.target.value);
      for (let i = 0; i < this.store.state.traces.length; i++) {
        this.store.setTraceOpacity(i, op);
      }
    });
  }

  setLoadHandlers(handlers) {
    this.els['load-map'].addEventListener('change', (e) => handlers.map(e.target.files[0]));
    this.els['load-grid'].addEventListener('change', (e) => handlers.grid(e.target.files[0]));
    this.els['load-terrain'].addEventListener('change', (e) => handlers.terrain(e.target.files[0]));
    this.els['load-sides'].addEventListener('change', (e) => handlers.sides(e.target.files[0]));
    this.els['load-sample'].addEventListener('click', handlers.sample);
    this.els['import-sides'].addEventListener('change', (e) => handlers.importSides(e.target.files[0]));
    this.els['import-terrain'].addEventListener('change', (e) => handlers.importTerrain(e.target.files[0]));
  }

  openInspector(code, screenPt) {
    this.inspectorHex = code;
    this.els['inspector-hex'].textContent = code;
    this.els['inspector'].hidden = false;

    const terrain = this.store.state.terrain.terrain[code] || 'clear';
    this._fillTerrainSelect();
    this.els['inspector-terrain'].value = terrain;

    // populate edge selects
    const centers = this.store.centers;
    const grid = this.store.state.grid;
    for (let i = 0; i < 6; i++) {
      const nb = edgeNeighbor(code, i, centers, grid);
      const layer = nb ? this.store.getEdgeLayer(code, nb) : '';
      this.edgeSelects[i].disabled = !nb;
      this.edgeSelects[i].value = layer || '';
      this.edgeSelects[i].title = nb ? `→ ${nb}` : 'no neighbor';
      if (nb) this.edgeLines[i].classList.remove('dim');
      else this.edgeLines[i].classList.add('dim');
    }

    this._paintEdges();
    this._positionInspector(screenPt);
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
    this.edgeLines[i].classList.add('active');
    this.renderer.setHighlight(this.inspectorHex, i, nb);
    if (nb) this.status(`Edge ${EDGE_NAMES[i]} → ${nb}`, 2000);
  }

  _unhighlightEdge() {
    for (const line of this.edgeLines) line.classList.remove('active');
    this.renderer.clearHighlight();
    this.status('');
  }

  _focusEdgeSelect(i) {
    this.edgeSelects[i].focus();
  }

  _setEdgeLayer(i, layer) {
    if (!this.inspectorHex) return;
    const nb = edgeNeighbor(this.inspectorHex, i, this.store.centers, this.store.state.grid);
    if (!nb) {
      this.edgeSelects[i].value = '';
      return;
    }
    this.store.setEdgeLayer(this.inspectorHex, i, layer, nb);
  }

  // Colour each edge of the inspector hexagon by its assigned hexside layer,
  // so an assignment is visible on the illustration itself (not just the map).
  _paintEdges() {
    if (!this.inspectorHex) return;
    const centers = this.store.centers;
    const grid = this.store.state.grid;
    const palette = this.store.getPalette();
    for (let i = 0; i < 6; i++) {
      const nb = edgeNeighbor(this.inspectorHex, i, centers, grid);
      const layer = nb ? this.store.getEdgeLayer(this.inspectorHex, nb) : '';
      let color = '';
      if (layer) {
        const feature = palette && palette.hexsideFeatures && palette.hexsideFeatures.find(f => f.key === layer || f.exportLayer === layer);
        if (feature) color = feature.color;
        else if (HEXSIDE_COLORS[layer]) color = HEXSIDE_COLORS[layer].stroke;
      }
      if (color) {
        this.edgeLines[i].style.stroke = color;
        this.edgeLines[i].style.strokeWidth = '8';
      } else {
        this.edgeLines[i].style.stroke = '';
        this.edgeLines[i].style.strokeWidth = '';
      }
    }
  }

  updateUI(reason) {
    this._updateLegend();
    this._updateTraceControls();
    this._updateCounts();
    this.els['undo'].disabled = !this.store.canUndo();

    if (this.inspectorHex) {
      // refresh inspector selects without moving it
      const terrain = this.store.state.terrain.terrain[this.inspectorHex] || 'clear';
      this.els['inspector-terrain'].value = terrain;
      const grid = this.store.state.grid;
      const centers = this.store.centers;
      for (let i = 0; i < 6; i++) {
        const nb = edgeNeighbor(this.inspectorHex, i, centers, grid);
        const layer = nb ? this.store.getEdgeLayer(this.inspectorHex, nb) : '';
        this.edgeSelects[i].value = layer || '';
      }
      this._paintEdges();
    }
  }

  _updateLegend() {
    const ul = this.els['terrain-legend'];
    if (ul.dataset.ready) return;
    const palette = this.store.getPalette();
    if (palette && palette.terrain) {
      ul.innerHTML = palette.terrain.map(t =>
        `<li><span class="legend-swatch" style="background:${t.color};border-color:${t.color}"></span>${t.label || t.key}</li>`
      ).join('');
    } else {
      ul.innerHTML = Object.entries(TERRAIN_COLORS).map(([type, c]) =>
        `<li><span class="legend-swatch" style="background:${c.fill};border-color:${c.line}"></span>${type}</li>`
      ).join('');
    }
    ul.dataset.ready = '1';
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
