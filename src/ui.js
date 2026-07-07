import {
  TERRAIN_COLORS, EDITABLE_LAYERS, HEXSIDE_COLORS, terrainSwatchBackground,
  hexCenter, hexPolygon, edgeNeighbor
} from './geometry.js';
import { syntheticHexFeaturesFromFeatures } from './store.js';

const LAYER_LABELS = {
  rivers: 'river',
  mountains: 'ridge',
  impassible: 'impass',
  roads: 'road',
  rails: 'rail',
  border: 'border'
};

const VIEW_SETTINGS_KEY = 'hexwright.view';
const INSPECTOR_POS_KEY = 'hexwright.inspectorPos';
const INSPECTOR_MARGIN = 12;

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
    this.featurePaintActive = false;
    this.featurePaintType = null;
    this.featureInspector = null;
    this._inspectorDrag = null;
    this._edgeWipeCount = 0;
    this.nudgeActive = false;
    this.anomalyActive = false;
    this.helpOpen = false;
    this.projectSub = '';
    // Arm/confirm state for the destructive "clear whole layer" buttons (never a
    // native confirm() — dialog-suppression extensions make confirm() silently
    // return false and veto the action with no visible failure). First click arms
    // a few-second "confirming" window; a second click on the SAME button within
    // that window executes the clear. See _armLayerClear / _isLayerClearArmed.
    this.pendingLayerClear = null;
    this._layerClearTimer = null;

    this._selectedGroupId = null;
    this._groupDeleteArmedId = null;
    this._groupDeleteTimer = null;

    this.ptpPendingNodeId = null;
    this.ptpSelectedEdge = null;

    this.nodeFeaturePaintActive = false;
    this.nodeFeaturePaintType = null;
    this.nodeFeaturePaintValue = null;
    this.nodeFeaturePaintLevel = 1;
    this.nodeFeaturePaintMode = false;
    this.nodeInspector = null;

    this.buildHexEditor();
    this._setupInspectorDrag();
    this.bindGlobal();
    this.bindControls();
    this._loadViewSettings();
    this._setupBrush();
    this._setupEdgePaint();
    this._setupFeaturePaint();
    this._setupPtpEdgePaint();
    this._setupNodeFeaturePaint();
    this.setMode('inspect');
    this.updateUI();
  }

  gatherElements() {
    const ids = [
      'strip-project-name', 'strip-project-sub', 'mode-hint', 'save-state',
      'load-map', 'load-grid', 'load-terrain', 'load-sides',
      'fit-view', 'undo', 'clear-select', 'toggle-help',
      'view-mode', 'tool-rail', 'tool-inspect', 'tool-terrain', 'tool-edges', 'tool-features', 'tool-nudge',
      'tool-node-features',
      'brush-card', 'brush-mode-tag', 'brush-ink-list',
      'node-paint-controls', 'node-paint-mode-toggle', 'node-paint-value-row',
      'layers-panel', 'feature-layer-rows', 'point-feature-layer-wrap', 'point-feature-layer-rows',
      'node-feature-layer-wrap', 'node-feature-layer-rows',
      'terrain-layer-wrap', 'terrain-fill-row', 'terrain-fill-eye', 'terrain-fill-count', 'terrain-labels-toggle',
      'group-layer-wrap', 'group-layer-rows', 'group-edit-form', 'group-edit-id', 'group-edit-name', 'group-edit-kind', 'group-edit-value', 'group-edit-save', 'group-edit-cancel',
      'group-create-name', 'group-create-kind', 'group-create-value', 'group-create-btn',
      'group-add-sel-btn', 'group-remove-sel-btn',
      'trace-layer-wrap', 'trace-layer-rows',
      'trace-opacity', 'trace-opacity-value', 'terrain-fill-opacity', 'terrain-fill-opacity-value',
      'terrain-label-size-row', 'terrain-label-size', 'terrain-label-size-value',
      'hexside-stroke-opacity', 'hexside-stroke-opacity-value',
      'map-dim', 'map-dim-value',
      'canvas-wrap',
      'export-overlay', 'toggle-anomaly', 'anomaly-count', 'load-palette', 'anomaly-status',
      'import-sides', 'import-terrain', 'import-names', 'import-wmp', 'file-btn', 'file-popover', 'export-btn', 'export-popover',
      'import-twu',
      'export-sides-file', 'export-sides-copy', 'export-terrain-file', 'export-terrain-copy',
      'export-features-file', 'export-features-copy', 'export-names-file', 'export-names-copy', 'export-twu',
      'feature-inspector', 'feat-insp-close', 'feat-insp-title', 'feat-insp-name', 'feat-insp-attrs',
      'feat-insp-delete', 'feat-insp-save',
      'hex-editor', 'hexed-close', 'hexed-title', 'hexed-name', 'hexed-terrain-current', 'hexed-terrain-grid',
      'hexed-feat-count', 'hexed-featrow', 'hexed-point-feats', 'hexed-point-feat-add',
      'hexed-add-feat-select', 'hexed-add-feat-btn', 'hexed-edges-meta', 'hexed-svg', 'hexed-fill',
      'hexed-edges', 'hexed-edge-labels', 'hexed-center-code', 'hexed-on-edge-label',
      'hexed-edchips', 'hexed-inkgrid',
      'count-land', 'layer-counts', 'status',
      'help-overlay', 'close-help',
      'load-nodes', 'import-edges', 'import-attrs',
      'export-edges-file', 'export-edges-copy', 'export-attrs-file', 'export-attrs-copy',
      'ptp-edge-inspector', 'ptp-edge-insp-close', 'ptp-edge-insp-title',
      'ptp-edge-insp-which-wrap', 'ptp-edge-insp-which',
      'ptp-edge-insp-type', 'ptp-edge-insp-delete',
      'node-feature-inspector', 'node-insp-title', 'node-insp-fields',
      'node-insp-close', 'node-insp-save', 'node-insp-clear'
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
        <span class="tswatch" style="background:${terrainSwatchBackground(t)}"></span>
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
        const isTextField = tag === 'INPUT' || tag === 'TEXTAREA';
        if (isTextField && (this.inspectorHex || this.featureInspector || this.nodeInspector)) {
          e.target?.blur();
          return;
        }
        if (this.featureInspector) {
          e.preventDefault();
          this.closeFeatureInspector();
          return;
        }
        if (this.nodeInspector) {
          e.preventDefault();
          this.closeNodeInspector();
          return;
        }
        if (this.inspectorHex) {
          e.preventDefault();
          this.els['clear-select'].click();
        }
        if (this._selectedGroupId || this.renderer.selectedHexes.size) {
          e.preventDefault();
          this._deselectGroup();
          this.renderer.clearHexSelection();
          return;
        }
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
      if (e.key.toLowerCase() === 'p') this.setMode('features');
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
      if (e.key.toLowerCase() === 'l') this.toggleTerrainLabels();
      if (/^[0-9]$/.test(e.key)) {
        const idx = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
        if (this.mode === 'edges') this._selectEdgeFeatureByIndex(idx);
        else if (this.mode === 'features') this._selectPointFeatureByIndex(idx);
        else if (this.mode === 'nodeFeatures') this._selectNodeFeatureByIndex(idx);
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
    window.addEventListener('resize', () => {
      if (this.inspectorHex) this._positionInspector();
    });
    this.renderer.onHexSelect = (code, screenPt) => {
      if (this.featurePaintActive && code) {
        // Armed type: click an empty hex to place it, click an existing one to edit.
        if (this.featurePaintType) {
          const existing = this.store.getPointFeature(code, this.featurePaintType);
          if (existing) this.openFeatureInspector(code, this.featurePaintType);
          else {
            this.store.setPointFeature(code, this.featurePaintType, { name: '', attrs: undefined });
            this.status(`Placed ${this._activePointFeatureLabel()} on ${code}`, 1800);
          }
          return;
        }
        // No type armed (select-not-place): NEVER silently add. Edit an existing
        // feature if the hex has one, else prompt the operator to pick a type.
        const present = this.store.getPointFeaturesAt(code);
        if (present.length) {
          this.openFeatureInspector(code, present[0].type);
        } else {
          this.status('Pick a feature type below (or press 1–0) to place it — a bare click adds nothing.', 2600);
        }
        return;
      }
      if (code) this.openInspector(code, screenPt);
      else this.closeInspector();
    };
    this.renderer.onSelectionChange = () => {
      this._reflectGroupActionButtons();
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
    this.els['hexed-name'].addEventListener('change', () => {
      if (!this.inspectorHex) return;
      this.store.setHexName(this.inspectorHex, this.els['hexed-name'].value);
    });
    this.els['feat-insp-close'].addEventListener('click', () => this.closeFeatureInspector());
    this.els['feat-insp-save'].addEventListener('click', () => this._saveFeatureInspector());
    this.els['feat-insp-delete'].addEventListener('click', () => this._deleteFeatureInspector());
    this.els['hexed-add-feat-btn']?.addEventListener('click', () => this._addInspectorPointFeature());
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup'].forEach((evt) => {
      this.els['feature-inspector']?.addEventListener(evt, (e) => e.stopPropagation());
    });
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
      const pfDel = e.target.closest('.pf-del[data-pf-type]');
      if (pfDel) {
        this._deleteInspectorPointFeature(pfDel.dataset.pfType);
        return;
      }
      const pfEdit = e.target.closest('.pf-edit[data-pf-type]');
      if (pfEdit && this.inspectorHex) {
        this.openFeatureInspector(this.inspectorHex, pfEdit.dataset.pfType);
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
    this.els['export-features-file'].addEventListener('click', () => this._download('features.json', this.store.exportFeaturesJson()));
    this.els['export-features-copy'].addEventListener('click', () => this._copy(this.store.exportFeaturesJson(), 'features.json'));
    this.els['export-names-file'].addEventListener('click', () => this._download('names.json', this.store.exportNamesJson()));
    this.els['export-names-copy'].addEventListener('click', () => this._copy(this.store.exportNamesJson(), 'names.json'));
    this.els['export-twu'].addEventListener('click', () => {
      if (this.loadHandlers?.exportTwu) this.loadHandlers.exportTwu();
    });
    this.els['export-edges-file']?.addEventListener('click', () => this._download('edges.json', this.store.exportPtpEdgesJson()));
    this.els['export-edges-copy']?.addEventListener('click', () => this._copy(this.store.exportPtpEdgesJson(), 'edges.json'));
    this.els['export-attrs-file']?.addEventListener('click', () => this._download('node-attrs.json', this.store.exportNodeAttrsJson()));
    this.els['export-attrs-copy']?.addEventListener('click', () => this._copy(this.store.exportNodeAttrsJson(), 'node-attrs.json'));
    this.els['ptp-edge-insp-delete']?.addEventListener('click', () => this._deletePtpEdgeInspector());
    this.els['ptp-edge-insp-close']?.addEventListener('click', () => this.closePtpEdgeInspector());
    this.els['ptp-edge-insp-which']?.addEventListener('change', () => this._switchPtpEdgeInspector());
    this.els['ptp-edge-insp-type']?.addEventListener('change', () => this._retypePtpEdgeInspector());

    this.els['node-insp-close']?.addEventListener('click', () => this.closeNodeInspector());
    this.els['node-insp-save']?.addEventListener('click', () => this._saveNodeInspector());
    this.els['node-insp-clear']?.addEventListener('click', () => this._clearNodeInspector());
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup'].forEach((evt) => {
      this.els['node-feature-inspector']?.addEventListener(evt, (e) => e.stopPropagation());
    });
    this.els['node-insp-fields']?.addEventListener('click', (e) => {
      const flag = e.target.closest('.node-feat-flag[data-node-feat-key]');
      if (!flag || !this.nodeInspector) return;
      const key = flag.dataset.nodeFeatKey;
      const draft = this.nodeInspector.draft;
      if (draft[key] === true) delete draft[key];
      else draft[key] = true;
      this._renderNodeInspectorFields();
    });
    this.els['node-insp-fields']?.addEventListener('change', (e) => {
      if (!this.nodeInspector) return;
      const level = e.target.closest('.node-feat-level[data-node-feat-key]');
      if (level) {
        const key = level.dataset.nodeFeatKey;
        const n = Number(level.value);
        if (level.value === '' || !Number.isFinite(n)) delete this.nodeInspector.draft[key];
        else this.nodeInspector.draft[key] = n;
        return;
      }
      const enumSel = e.target.closest('.node-feat-enum[data-node-feat-key]');
      if (enumSel) {
        const key = enumSel.dataset.nodeFeatKey;
        if (enumSel.value === '') delete this.nodeInspector.draft[key];
        else this.nodeInspector.draft[key] = enumSel.value;
      }
    });

    this.els['node-paint-mode-toggle']?.addEventListener('click', () => {
      this.nodeFeaturePaintMode = !this.nodeFeaturePaintMode;
      this._renderNodeFeaturePaintControls();
      this._updateModeHint();
    });
    this.els['node-paint-value-row']?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-enum-value]');
      if (!chip) return;
      this.nodeFeaturePaintValue = chip.dataset.enumValue;
      this._renderNodeFeaturePaintControls();
    });
    this.els['node-paint-value-row']?.addEventListener('change', (e) => {
      const input = e.target.closest('#node-paint-level-input');
      if (!input) return;
      const n = Number(input.value);
      this.nodeFeaturePaintLevel = Number.isFinite(n) && n > 0 ? n : 1;
    });

    this.els['brush-ink-list'].addEventListener('click', (e) => {
      const row = e.target.closest('.ink[data-ink-key]');
      if (!row) return;
      const key = row.dataset.inkKey;
      if (this.mode === 'edges') {
        if (this.store.isPtp()) this.setPtpEdgeType(key);
        else this.setEdgePaintFeature(key);
      }
      else if (this.mode === 'features') this.setFeaturePaintType(key);
      else if (this.mode === 'nodeFeatures') this.setNodeFeaturePaintType(key);
      else this.setBrushTerrain(key);
    });

    this.els['feature-layer-rows'].addEventListener('click', (e) => {
      const clearBtn = e.target.closest('.layer-clear[data-feature-key]');
      if (clearBtn) {
        const row = clearBtn.closest('.layer-row');
        const label = row?.querySelector('.name')?.textContent?.trim() || clearBtn.dataset.featureKey;
        this.clearHexsideLayer(clearBtn.dataset.featureKey, label);
        return;
      }
      const eye = e.target.closest('.eye[data-feature-key]');
      if (!eye) return;
      this.toggleHexsideLayerVisibility(eye.dataset.featureKey);
    });

    this.els['point-feature-layer-rows'].addEventListener('click', (e) => {
      const clearBtn = e.target.closest('.layer-clear[data-point-feature-key]');
      if (!clearBtn) return;
      const row = clearBtn.closest('.layer-row');
      const label = row?.querySelector('.name')?.textContent?.trim() || clearBtn.dataset.pointFeatureKey;
      this.clearPointFeatureLayer(clearBtn.dataset.pointFeatureKey, label);
    });

    this.els['node-feature-layer-rows']?.addEventListener('click', (e) => {
      const clearBtn = e.target.closest('.layer-clear[data-node-feature-key]');
      if (clearBtn) {
        const row = clearBtn.closest('.layer-row');
        const label = row?.querySelector('.name')?.textContent?.trim() || clearBtn.dataset.nodeFeatureKey;
        this.clearNodeFeatureLayer(clearBtn.dataset.nodeFeatureKey, label);
        return;
      }
      const eye = e.target.closest('.eye[data-node-feature-key]');
      if (!eye) return;
      this.toggleNodeFeatureLayerVisibility(eye.dataset.nodeFeatureKey);
    });

    this.els['group-layer-rows']?.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.group-del[data-group-id]');
      if (delBtn) {
        this._deleteGroup(delBtn.dataset.groupId);
        return;
      }
      const editBtn = e.target.closest('.group-edit[data-group-id]');
      const row = e.target.closest('.group-row[data-group-id]');
      const id = editBtn?.dataset.groupId || row?.dataset.groupId;
      if (id) this._selectGroup(id);
    });
    this.els['group-create-btn']?.addEventListener('click', () => this._createGroupFromSelection());
    this.els['group-edit-save']?.addEventListener('click', () => this._saveGroupEdit());
    this.els['group-edit-cancel']?.addEventListener('click', () => this._deselectGroup());
    this.els['group-add-sel-btn']?.addEventListener('click', () => this._addSelectedToGroup());
    this.els['group-remove-sel-btn']?.addEventListener('click', () => this._removeSelectedFromGroup());
    this.els['group-edit-form']?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._saveGroupEdit();
      }
    });

    this.els['terrain-fill-eye'].addEventListener('click', () => {
      this.renderer.terrainFillVisible = !this.renderer.terrainFillVisible;
      this._saveViewSettings();
      this._renderLayersPanel();
      this.renderer.draw();
    });

    this.els['terrain-labels-toggle'].addEventListener('click', () => {
      this.toggleTerrainLabels();
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

    // Terrain-fill opacity — lets the scan show through in Both view for
    // hand-tracing; hexsides/glyphs/grid stay full-strength.
    this.els['terrain-fill-opacity'].addEventListener('input', (e) => {
      if (this.renderer.viewMode !== 'both') this.setViewMode('both');
      this.renderer.terrainFillAlpha = parseFloat(e.target.value);
      this.els['terrain-fill-opacity-value'].textContent = `${Math.round(this.renderer.terrainFillAlpha * 100)}%`;
      this._saveViewSettings();
      this.renderer.draw();
    });

    // Label size — multiplier on the terrain-abbr/hex-name label font (L toggle).
    // Only meaningful when labels are visible; row is shown/hidden in
    // _renderLayersPanel alongside the Lbl toggle state.
    this.els['terrain-label-size'].addEventListener('input', (e) => {
      this.renderer.terrainLabelScale = Math.max(0.5, Math.min(3, parseFloat(e.target.value)));
      this.els['terrain-label-size-value'].textContent = `${Math.round(this.renderer.terrainLabelScale * 100)}%`;
      this._saveViewSettings();
      this.renderer.draw();
    });

    this.els['hexside-stroke-opacity'].addEventListener('input', (e) => {
      this.renderer.hexsideStrokeAlpha = parseFloat(e.target.value);
      this.els['hexside-stroke-opacity-value'].textContent = `${Math.round(this.renderer.hexsideStrokeAlpha * 100)}%`;
      this._saveViewSettings();
      this.renderer.draw();
    });

    this.els['map-dim'].addEventListener('input', (e) => {
      this.renderer.mapDim = parseFloat(e.target.value);
      this.els['map-dim-value'].textContent = `${Math.round(this.renderer.mapDim * 100)}%`;
      this._saveViewSettings();
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
    this.els['import-sides'].addEventListener('change', (e) => handlers.importSides(e.target.files[0]));
    this.els['import-terrain'].addEventListener('change', (e) => handlers.importTerrain(e.target.files[0]));
    this.els['import-names'].addEventListener('change', (e) => handlers.importNames(e.target.files[0]));
    this.els['import-wmp'].addEventListener('change', (e) => handlers.importWmp(e.target.files[0]));
    this.els['import-twu'].addEventListener('change', (e) => handlers.importTwu(e.target.files[0]));
    this.els['load-nodes']?.addEventListener('change', (e) => handlers.nodes?.(e.target.files[0]));
    this.els['import-edges']?.addEventListener('change', (e) => handlers.importEdges?.(e.target.files[0]));
    this.els['import-attrs']?.addEventListener('change', (e) => handlers.importAttrs?.(e.target.files[0]));
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
    if (this.store.isPtp()) {
      if (mode === 'features') mode = 'nodeFeatures';
      if (!['edges', 'nodeFeatures'].includes(mode)) mode = 'edges';
    } else if (!['inspect', 'terrain', 'edges', 'features', 'nudge'].includes(mode)) {
      return;
    }
    this.mode = mode;
    this.brushActive = mode === 'terrain' && !this.store.isPtp();
    this.edgePaintActive = mode === 'edges' && !this.store.isPtp();
    this.featurePaintActive = mode === 'features' && !this.store.isPtp();
    this.nodeFeaturePaintActive = mode === 'nodeFeatures';
    this.nudgeActive = mode === 'nudge' && !this.store.isPtp();

    if (mode !== 'features') this.closeFeatureInspector();
    if (mode !== 'nodeFeatures') this.closeNodeInspector();

    if (this.featurePaintActive) {
      // Select-not-place default: entering features mode must NOT auto-arm a type
      // (that silently placed a feature on the operator's first click). A type is
      // armed only when the user explicitly picks one from the picker or 1–0 keys.
      // Drop a stale arm that no longer exists in the current palette/data.
      if (this.featurePaintType && !this._hexFeatureDecl(this.featurePaintType)) {
        this.featurePaintType = null;
      }
    }
    if (this.nodeFeaturePaintActive && this.nodeFeaturePaintType && !this._nodeFeatureDecl(this.nodeFeaturePaintType)) {
      this.nodeFeaturePaintType = null;
    }

    this._setupBrush();
    this._setupEdgePaint();
    this._setupFeaturePaint();
    this._setupPtpEdgePaint();
    this._setupNodeFeaturePaint();
    this.renderer.setNudgeMode(this.nudgeActive);

    if (this.nudgeActive && this.renderer.viewMode !== 'both') {
      this.setViewMode('both');
      this.status('Nudge map: drag the scan under the grid, or arrow keys (shift = ×10). Offset autosaves with the project.', 6000);
    }

    this._reflectMode();
    this._updateModeHint();
    this._reflectBrush();
    this._reflectEdgePaint();
    this._reflectFeaturePaint();
    this._reflectNodeFeaturePaint();
    this._renderBrushCard();
    this._renderLayersPanel();
    this._updateCanvasCursor();
    this.renderer.draw();
  }

  _reflectMapFamily() {
    document.body.classList.toggle('map-family-ptp', this.store.isPtp());
    const ptpOnly = ['tool-inspect', 'tool-terrain', 'tool-features', 'tool-nudge'];
    for (const id of ptpOnly) {
      const el = this.els[id];
      if (el) el.hidden = this.store.isPtp();
    }
    const hexOnly = ['hex-editor', 'terrain-layer-wrap', 'group-layer-wrap', 'feature-layer-rows'];
    for (const id of hexOnly) {
      const el = document.getElementById(id);
      if (el) el.hidden = this.store.isPtp();
    }
    const ptpWrap = document.getElementById('ptp-layer-wrap');
    if (ptpWrap) ptpWrap.hidden = !this.store.isPtp();
    const nodeFeatBtn = this.els['tool-node-features'];
    if (nodeFeatBtn) nodeFeatBtn.hidden = !this.store.isPtp();
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
    if (this.mode === 'edges' && this.store.isPtp()) {
      const label = this._activePtpEdgeLabel();
      hint.innerHTML = `<b>Edge trace · ${label}</b> — click node A then node B · click edge to select<span class="hint-extra"> · <span class="kbd">⌥</span> click edge to delete · <span class="kbd">1</span>–<span class="kbd">0</span> switch type</span>`;
      return;
    }
    if (this.mode === 'nodeFeatures') {
      const feature = this._nodeFeatureDecl(this.nodeFeaturePaintType);
      if (this.nodeFeaturePaintMode && feature) {
        hint.innerHTML = `<b>Node features · ${this._activeNodeFeatureLabel()} — paint mode</b> — click a node to tag · <span class="kbd">⌥</span> click to clear<span class="hint-extra"> · <span class="kbd">P</span> features · <span class="kbd">1</span>–<span class="kbd">0</span> switch type</span>`;
      } else {
        hint.innerHTML = '<b>Node features</b> — click a node to open its inspector<span class="hint-extra"> · pick a type below + Paint mode to batch-tag · <span class="kbd">1</span>–<span class="kbd">0</span> pick type</span>';
      }
      return;
    }
    if (this.mode === 'terrain') {
      hint.innerHTML = `<b>Terrain brush · ${this._activeTerrainLabel()}</b> — click or drag hexes to paint<span class="hint-extra"> · <span class="kbd">B</span> terrain · <span class="kbd">1</span>–<span class="kbd">0</span> terrain keys</span>`;
      return;
    }
    if (this.mode === 'edges') {
      hint.innerHTML = `<b>Edge paint · ${this._edgeFeatureLabel()}</b> — click edge to toggle · drag to paint<span class="hint-extra"> · <span class="kbd">⌥</span> wipe all layers on edge · <span class="kbd">1</span>–<span class="kbd">0</span> switch ink</span>`;
      return;
    }
    if (this.mode === 'features') {
      if (this.featurePaintType) {
        hint.innerHTML = `<b>Features · ${this._activePointFeatureLabel()}</b> — click hex to place · click again to edit<span class="hint-extra"> · <span class="kbd">P</span> features · <span class="kbd">1</span>–<span class="kbd">0</span> switch type</span>`;
      } else {
        hint.innerHTML = `<b>Features</b> — pick a type below, then click a hex to place · click an existing feature to edit<span class="hint-extra"> · <span class="kbd">1</span>–<span class="kbd">0</span> pick type</span>`;
      }
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
      onStrokeStart: () => this.store.beginStroke(),
      onStrokeEnd: () => this.store.endStroke(),
      onToggle: (code) => {
        this.store.applyTerrainBrush(code, this.brushTerrain);
        this.lastBrushHex = code;
        const center = this.store.centers[code];
        if (center) this.lastBrushScreen = this.renderer.worldToScreen(center);
      },
      onPaint: (code) => {
        this.store.setTerrain(code, this.brushTerrain);
        this.lastBrushHex = code;
        const center = this.store.centers[code];
        if (center) this.lastBrushScreen = this.renderer.worldToScreen(center);
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

  _setupPtpEdgePaint() {
    this.renderer.setPtpEdgePaint({
      active: this.store.isPtp() && this.mode === 'edges',
      typeKey: this.edgePaintFeature,
      pendingNodeId: this.ptpPendingNodeId,
      onNodeClick: (nodeId, opts) => this._onPtpNodeClick(nodeId, opts),
      onEdgeSelect: (edge) => this._onPtpEdgeSelect(edge),
      onEdgeDelete: (edge) => this._onPtpEdgeDelete(edge)
    });
    this.renderer.onPtpClear = () => this.closePtpEdgeInspector();
  }

  _effectiveEdgeFeatures() {
    const palette = this.store.getPalette() || {};
    if (this.store.isPtp()) return palette.edgeFeatures || [];
    return palette.hexsideFeatures || [];
  }

  _activePtpEdgeLabel() {
    const feature = this._effectiveEdgeFeatures().find((f) => f.key === this.edgePaintFeature);
    return feature?.label || feature?.key || 'Edge';
  }

  setPtpEdgeType(key) {
    this.edgePaintFeature = key;
    this._setupPtpEdgePaint();
    this._reflectEdgePaint();
    this._renderBrushCard();
    this._updateCanvasCursor();
  }

  _onPtpNodeClick(nodeId, opts = {}) {
    if (!this.edgePaintFeature) {
      this.status('Pick an edge type in the Brush card first.', 2500);
      return;
    }
    if (opts.altDelete) {
      this.status('Alt-click an edge line to delete it.', 2500);
      return;
    }
    if (!this.ptpPendingNodeId) {
      this.ptpPendingNodeId = nodeId;
      this._setupPtpEdgePaint();
      this.renderer.draw();
      this.status(`Start: ${nodeId} — click the other node`, 3000);
      return;
    }
    if (this.ptpPendingNodeId === nodeId) {
      this.ptpPendingNodeId = null;
      this._setupPtpEdgePaint();
      this.renderer.draw();
      return;
    }
    const from = this.ptpPendingNodeId;
    this.ptpPendingNodeId = null;
    this._setupPtpEdgePaint();
    if (this.store.setPtpEdge(from, nodeId, this.edgePaintFeature)) {
      this.status(`Edge ${from}–${nodeId} (${this.edgePaintFeature})`, 2500);
      this._renderBrushCard();
      this._renderLayersPanel();
    }
    this.renderer.draw();
  }

  _onPtpEdgeSelect(edge) {
    this.ptpSelectedEdge = edge;
    this.ptpPendingNodeId = null;
    this._setupPtpEdgePaint();
    this.openPtpEdgeInspector(edge);
    this.renderer.setSelectedPtpEdge(edge);
  }

  _onPtpEdgeDelete(edge) {
    if (this.store.deletePtpEdge(edge.a, edge.b, edge.type)) {
      this.status(`Deleted ${edge.type} edge ${edge.a}–${edge.b}`, 2000);
      this.closePtpEdgeInspector();
      this._renderBrushCard();
      this._renderLayersPanel();
    }
    this.renderer.draw();
  }

  openPtpEdgeInspector(edge) {
    const panel = this.els['ptp-edge-inspector'];
    if (!panel || !edge) return;
    const features = this._effectiveEdgeFeatures();
    const onPair = this.store.getPtpEdgesOnPair(edge.a, edge.b);
    const whichWrap = this.els['ptp-edge-insp-which-wrap'];
    const which = this.els['ptp-edge-insp-which'];
    this.els['ptp-edge-insp-title'].textContent = `${edge.a} ↔ ${edge.b}`;
    if (whichWrap && which) {
      if (onPair.length > 1) {
        whichWrap.hidden = false;
        which.innerHTML = onPair.map((e) => {
          const label = features.find((f) => f.key === e.type)?.label || e.type;
          return `<option value="${e.type}"${e.type === edge.type ? ' selected' : ''}>${label}</option>`;
        }).join('');
      } else {
        whichWrap.hidden = true;
        which.innerHTML = '';
      }
    }
    const select = this.els['ptp-edge-insp-type'];
    select.innerHTML = features.map((f) =>
      `<option value="${f.key}"${f.key === edge.type ? ' selected' : ''}>${f.label || f.key}</option>`
    ).join('');
    panel.hidden = false;
    this.els['layers-panel'].hidden = true;
  }

  _switchPtpEdgeInspector() {
    if (!this.ptpSelectedEdge) return;
    const type = this.els['ptp-edge-insp-which']?.value;
    if (!type || type === this.ptpSelectedEdge.type) return;
    const { a, b } = this.ptpSelectedEdge;
    const edge = this.store.getPtpEdgesOnPair(a, b).find((e) => e.type === type);
    if (!edge) return;
    this._onPtpEdgeSelect(edge);
  }

  closePtpEdgeInspector() {
    this.ptpSelectedEdge = null;
    if (this.els['ptp-edge-inspector']) this.els['ptp-edge-inspector'].hidden = true;
    if (!this.inspectorHex) this.els['layers-panel'].hidden = false;
    this.renderer.clearPtpSelection();
  }

  _retypePtpEdgeInspector() {
    if (!this.ptpSelectedEdge) return;
    const type = this.els['ptp-edge-insp-type']?.value;
    if (!type) return;
    const { a, b, type: oldType } = this.ptpSelectedEdge;
    if (type === oldType) return;
    if (this.store.getPtpEdge(a, b, type)) {
      this.status(`A ${type} edge already exists on ${a}–${b}.`, 2500);
      this.els['ptp-edge-insp-type'].value = oldType;
      return;
    }
    if (this.store.deletePtpEdge(a, b, oldType) && this.store.setPtpEdge(a, b, type)) {
      const edgeKey = `${a < b ? a : b}|${a < b ? b : a}|${type}`;
      this.ptpSelectedEdge = { a, b, type, edgeKey };
      this.status(`Retyped ${a}–${b} from ${oldType} to ${type}`, 2000);
      this.openPtpEdgeInspector(this.ptpSelectedEdge);
      this._renderBrushCard();
      this._renderLayersPanel();
      this.renderer.setSelectedPtpEdge(this.ptpSelectedEdge);
    }
  }

  _deletePtpEdgeInspector() {
    if (!this.ptpSelectedEdge) return;
    this._onPtpEdgeDelete(this.ptpSelectedEdge);
  }

  onPtpProjectLoaded() {
    this.ptpPendingNodeId = null;
    this.ptpSelectedEdge = null;
    const features = this._effectiveEdgeFeatures();
    if (features.length && !features.some((f) => f.key === this.edgePaintFeature)) {
      this.edgePaintFeature = features[0].key;
    }
    this.setMode('edges');
    this._reflectMapFamily();
    this._renderBrushCard();
    this._renderLayersPanel();
  }

  // ----------------- node features (point-to-point node tagging) -----------------
  // Two flows share one "active type": (1) default — click a node opens the full
  // inspector (all palette nodeFeatures for that node, batch-editable, Save
  // commits); (2) Paint mode ON — click a node applies the armed feature+value
  // directly (no inspector), alt-click clears it. Paint mode is what makes
  // tagging hundreds of nodes fast; the inspector is for careful single-node edits.

  _nodeFeatureDecl(key) {
    return (this.store.getPalette()?.nodeFeatures || []).find((f) => f.key === key) || null;
  }

  _activeNodeFeatureLabel() {
    const feature = this._nodeFeatureDecl(this.nodeFeaturePaintType);
    return feature?.label || feature?.key || 'Feature';
  }

  _selectNodeFeatureByIndex(idx) {
    const features = this.store.getPalette()?.nodeFeatures || [];
    const feature = features[idx];
    if (!feature) return;
    this.setNodeFeaturePaintType(feature.key);
    this.status(`Node feature ${idx + 1}: ${feature.label || feature.key}`, 1200);
  }

  setNodeFeaturePaintType(key) {
    this.nodeFeaturePaintType = key;
    const feature = this._nodeFeatureDecl(key);
    this.nodeFeaturePaintValue = feature?.kind === 'enum' ? (feature.values?.[0] || null) : null;
    this.nodeFeaturePaintLevel = 1;
    this._setupNodeFeaturePaint();
    this._reflectNodeFeaturePaint();
    this._renderBrushCard();
    this._updateCanvasCursor();
  }

  _setupNodeFeaturePaint() {
    this.renderer.setPtpFeaturePaint({
      active: this.store.isPtp() && this.mode === 'nodeFeatures',
      onNodeClick: (nodeId, opts) => this._onPtpNodeFeatureClick(nodeId, opts)
    });
  }

  _reflectNodeFeaturePaint() {
    const btn = this.els['tool-node-features'];
    const feature = this._nodeFeatureDecl(this.nodeFeaturePaintType);
    if (btn) btn.title = `Node features mode (P)${feature ? ` — ${feature.label || feature.key}` : ''}`;
    this._updateModeHint();
  }

  _renderNodeFeaturePaintControls() {
    const wrap = this.els['node-paint-controls'];
    if (!wrap) return;
    const feature = this._nodeFeatureDecl(this.nodeFeaturePaintType);
    wrap.hidden = !feature;
    const toggle = this.els['node-paint-mode-toggle'];
    if (toggle) {
      toggle.classList.toggle('on', this.nodeFeaturePaintMode);
      toggle.setAttribute('aria-pressed', String(this.nodeFeaturePaintMode));
    }
    const valueRow = this.els['node-paint-value-row'];
    if (!valueRow) return;
    if (!feature) {
      valueRow.innerHTML = '';
      return;
    }
    if (feature.kind === 'level') {
      const max = feature.max || 1;
      valueRow.innerHTML = `<label class="field-row"><span class="lbl">Level to paint</span>
        <input type="number" id="node-paint-level-input" class="field-input" min="1" max="${max}" value="${this.nodeFeaturePaintLevel}" /></label>`;
    } else if (feature.kind === 'enum') {
      const values = feature.values || [];
      valueRow.innerHTML = `<div class="ink-list">${values.map((v) => {
        const active = this.nodeFeaturePaintValue === v;
        return `<div class="ink${active ? ' is-active' : ''}" data-enum-value="${v}"><span class="name">${v}</span></div>`;
      }).join('')}</div>`;
    } else {
      valueRow.innerHTML = '';
    }
  }

  _onPtpNodeFeatureClick(nodeId, opts = {}) {
    if (this.nodeFeaturePaintMode && this.nodeFeaturePaintType) {
      const feature = this._nodeFeatureDecl(this.nodeFeaturePaintType);
      const label = this._activeNodeFeatureLabel();
      if (opts.altClear) {
        if (this.store.clearNodeAttr(nodeId, this.nodeFeaturePaintType)) {
          this.status(`Cleared ${label} on ${nodeId}`, 1200);
        }
        return;
      }
      let value;
      if (feature?.kind === 'level') value = this.nodeFeaturePaintLevel;
      else if (feature?.kind === 'enum') value = this.nodeFeaturePaintValue;
      else value = true;
      if (value == null) {
        this.status('Pick a value below first.', 2000);
        return;
      }
      this.store.setNodeAttr(nodeId, this.nodeFeaturePaintType, value);
      this.status(`Tagged ${label}${feature?.kind !== 'flag' ? ` = ${value}` : ''} on ${nodeId}`, 1200);
      return;
    }
    // Select-not-paint default: always open the full inspector so the operator
    // can see/edit every feature on this node, never a silent single-value write.
    this.openNodeInspector(nodeId);
  }

  openNodeInspector(nodeId) {
    const node = this.store.state.nodes?.[nodeId];
    if (!node) return;
    this.nodeInspector = { nodeId, draft: this.store.getNodeAttrs(nodeId) };
    this.els['node-insp-title'].textContent = node.name || nodeId;
    this._renderNodeInspectorFields();
    this.els['node-feature-inspector'].hidden = false;
    this.els['layers-panel'].hidden = true;
    if (this.ptpSelectedEdge) this.closePtpEdgeInspector();
  }

  _renderNodeInspectorFields() {
    const wrap = this.els['node-insp-fields'];
    if (!wrap || !this.nodeInspector) return;
    const features = this.store.getPalette()?.nodeFeatures || [];
    const draft = this.nodeInspector.draft || {};
    wrap.innerHTML = features.map((f) => {
      const val = draft[f.key];
      if (f.kind === 'flag') {
        const active = val === true;
        return `<label class="field-row">
          <span class="lbl">${f.label || f.key}</span>
          <span class="feat node-feat-flag${active ? ' is-active' : ''}" data-node-feat-key="${f.key}" role="button" tabindex="0">
            <span class="fdot"></span>${f.badge || f.label || f.key}
          </span>
        </label>`;
      }
      if (f.kind === 'level') {
        const shown = Number.isFinite(val) ? val : '';
        return `<label class="field-row">
          <span class="lbl">${f.label || f.key} (max ${f.max || 1})</span>
          <input type="number" class="field-input node-feat-level" data-node-feat-key="${f.key}" min="1" max="${f.max || 99}" value="${shown}" placeholder="—" />
        </label>`;
      }
      const values = f.values || [];
      return `<label class="field-row">
        <span class="lbl">${f.label || f.key}</span>
        <select class="field-input node-feat-enum" data-node-feat-key="${f.key}">
          <option value="">—</option>
          ${values.map((v) => `<option value="${v}"${val === v ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>`;
    }).join('');
  }

  _saveNodeInspector() {
    if (!this.nodeInspector) return;
    const { nodeId, draft } = this.nodeInspector;
    const features = this.store.getPalette()?.nodeFeatures || [];
    const payload = {};
    for (const f of features) payload[f.key] = draft[f.key] !== undefined ? draft[f.key] : null;
    this.store.setNodeAttrs(nodeId, payload);
    this.status(`Updated features on ${nodeId}`, 1800);
    this.closeNodeInspector();
  }

  _clearNodeInspector() {
    if (!this.nodeInspector) return;
    const { nodeId } = this.nodeInspector;
    const features = this.store.getPalette()?.nodeFeatures || [];
    const payload = {};
    for (const f of features) payload[f.key] = null;
    this.store.setNodeAttrs(nodeId, payload);
    this.status(`Cleared all features on ${nodeId}`, 1800);
    this.closeNodeInspector();
  }

  closeNodeInspector() {
    this.nodeInspector = null;
    if (this.els['node-feature-inspector']) this.els['node-feature-inspector'].hidden = true;
    if (!this.inspectorHex && !this.featureInspector) this.els['layers-panel'].hidden = false;
  }

  _nodeFeatureVisible(featureKey) {
    const visibility = this.renderer.nodeFeatureVisibility || {};
    return visibility[featureKey] !== false;
  }

  toggleNodeFeatureLayerVisibility(featureKey) {
    if (!featureKey) return;
    if (!this.renderer.nodeFeatureVisibility) this.renderer.nodeFeatureVisibility = {};
    this.renderer.nodeFeatureVisibility[featureKey] = !this._nodeFeatureVisible(featureKey);
    this._renderLayersPanel();
    this.renderer.draw();
  }

  clearNodeFeatureLayer(featureKey, label) {
    if (!featureKey) return;
    const count = this.store.countNodeFeatureTagged(featureKey);
    if (count === 0) return;
    if (!this._isLayerClearArmed('nodeFeature', featureKey)) {
      this._armLayerClear('nodeFeature', featureKey);
      return;
    }
    this._disarmLayerClear();
    this.store.clearNodeFeatureLayer(featureKey);
  }

  _setupEdgePaint() {
    this.renderer.setEdgePaint({
      active: this.edgePaintActive,
      featureKey: this.edgePaintFeature,
      onStrokeStart: () => {
        this._edgeWipeCount = 0;
        this.store.beginStroke();
      },
      onStrokeEnd: () => {
        this.store.endStroke();
        if (this._edgeWipeCount > 0) {
          const n = this._edgeWipeCount;
          this.status(`Wiped ${n} edge${n === 1 ? '' : 's'}`, 2500);
          this._edgeWipeCount = 0;
        }
      },
      onToggle: (hit) => {
        if (!this.edgePaintFeature) return;
        this.store.toggleHexsideFeature(hit.a, hit.b, this.edgePaintFeature);
      },
      onSet: (hit, opts = {}) => {
        if (!this.edgePaintFeature) return;
        if (opts.eraseAll) {
          const removed = this.store.clearAllEdgeFeatures(hit.a, hit.b);
          if (removed <= 0) return;
          if (this.store.strokeActive) {
            this._edgeWipeCount++;
          } else {
            this.status(`Wiped 1 edge (${removed} feature${removed === 1 ? '' : 's'})`, 2500);
          }
          return;
        }
        this.store.setHexsideFeature(hit.a, hit.b, this.edgePaintFeature, true);
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

  toggleFeaturePaint() {
    this.setMode('features');
  }

  // Point-feature TYPE declarations that drive the picker + inspector. Prefer the
  // palette's declared `hexFeatures`; when a project declares none, synthesize the
  // types from the point-feature data actually loaded — so the picker is never a
  // dead panel and placed/imported features remain editable.
  _effectiveHexFeatures() {
    const declared = this.store.getPalette()?.hexFeatures || [];
    if (declared.length) return declared;
    return syntheticHexFeaturesFromFeatures(this.store.state.features);
  }

  _hexFeatureDecl(type) {
    return this._effectiveHexFeatures().find((f) => f.key === type) || null;
  }

  _activePointFeatureLabel() {
    const feature = this._hexFeatureDecl(this.featurePaintType);
    return feature?.label || feature?.key || 'Feature';
  }

  setFeaturePaintType(key) {
    this.featurePaintType = key;
    this._setupFeaturePaint();
    this._reflectFeaturePaint();
    this._renderBrushCard();
    this._updateCanvasCursor();
  }

  _setupFeaturePaint() {
    this.renderer.setFeaturePaint({
      active: this.featurePaintActive,
      featureType: this.featurePaintType
    });
  }

  _reflectFeaturePaint() {
    const btn = this.els['tool-features'];
    const feature = this._hexFeatureDecl(this.featurePaintType);
    if (btn) btn.title = `Features mode (P)${feature ? ` — ${feature.label || feature.key}` : ''}`;
    this._updateModeHint();
  }

  _selectPointFeatureByIndex(idx) {
    const feature = this._effectiveHexFeatures()[idx];
    if (!feature) return;
    this.setFeaturePaintType(feature.key);
    this.status(`Feature ${idx + 1}: ${feature.label || feature.key}`, 1200);
  }

  _pointFeatureCounts() {
    const counts = {};
    for (const byType of Object.values(this.store.state.features || {})) {
      if (!byType || typeof byType !== 'object') continue;
      for (const type of Object.keys(byType)) counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
  }

  // Arm/confirm two-step for the "clear whole layer" buttons. Deliberately NOT
  // a native confirm() — a browser/extension set to suppress dialogs on this
  // origin makes confirm() return false immediately, silently vetoing the
  // clear with no visible failure (the operator has confirm()s turned off on
  // purpose for the routine single-feature deletes; a bulk clear-all still
  // needs a real "are you sure" that suppression can't defeat). First click
  // arms a short "confirming" window on that exact button; a second click on
  // the SAME button within the window performs the clear; anything else
  // (timeout, clicking a different layer's button) disarms it.
  _isLayerClearArmed(kind, key) {
    return !!(this.pendingLayerClear && this.pendingLayerClear.kind === kind && this.pendingLayerClear.key === key);
  }

  _armLayerClear(kind, key) {
    if (this._layerClearTimer) clearTimeout(this._layerClearTimer);
    this.pendingLayerClear = { kind, key };
    this._layerClearTimer = setTimeout(() => {
      this.pendingLayerClear = null;
      this._layerClearTimer = null;
      this._renderLayersPanel();
    }, 3000);
    this._renderLayersPanel();
  }

  _disarmLayerClear() {
    if (this._layerClearTimer) { clearTimeout(this._layerClearTimer); this._layerClearTimer = null; }
    this.pendingLayerClear = null;
  }

  clearPointFeatureLayer(type, label) {
    if (!type) return;
    const count = this.store.countPointFeatureType(type);
    if (count === 0) return;
    if (!this._isLayerClearArmed('point', type)) {
      this._armLayerClear('point', type);
      return;
    }
    this._disarmLayerClear();
    this.store.clearPointFeatureType(type);
  }

  openFeatureInspector(code, type) {
    const pf = this._hexFeatureDecl(type);
    const rec = this.store.getPointFeature(code, type);
    if (!rec) return;
    this.featureInspector = { code, type };
    this.els['feat-insp-title'].textContent = `${pf?.label || type} · ${code}`;
    // Name inheritance: hexes are named separately (Inspect panel's Name field,
    // the names layer). A feature with no name of its own defaults to the
    // hex's name — pre-filled, still editable — instead of presenting a blank
    // field the operator has to retype for a hex they already named.
    this.els['feat-insp-name'].value = rec.name || this.store.getHexName(code) || '';
    this._renderFeatureInspectorAttrs(pf, rec);
    this.els['feature-inspector'].hidden = false;
    this.els['layers-panel'].hidden = true;
    if (this.inspectorHex) this.closeInspector();
  }

  _renderFeatureInspectorAttrs(paletteFeature, rec) {
    const wrap = this.els['feat-insp-attrs'];
    const schema = paletteFeature?.attrs || [];
    if (!schema.length) {
      wrap.innerHTML = '<p class="hx-data dimmed">No attributes for this type.</p>';
      return;
    }
    wrap.innerHTML = schema.map((a) => {
      const val = rec.attrs?.[a.key];
      const inputType = a.type === 'number' ? 'number' : 'text';
      const shown = val != null ? val : (a.type === 'number' ? 0 : '');
      return `<label class="field-row">
        <span class="lbl">${a.label || a.key}</span>
        <input type="${inputType}" class="field-input feat-attr" data-attr-key="${a.key}" data-attr-type="${a.type || 'text'}" value="${shown}" />
      </label>`;
    }).join('');
  }

  _collectFeatureInspectorValues() {
    const attrs = {};
    this.els['feat-insp-attrs'].querySelectorAll('.feat-attr[data-attr-key]').forEach((input) => {
      const key = input.dataset.attrKey;
      if (input.dataset.attrType === 'number') {
        const n = Number(input.value);
        attrs[key] = Number.isFinite(n) ? n : 0;
      } else {
        attrs[key] = input.value;
      }
    });
    return {
      name: this.els['feat-insp-name'].value.trim(),
      attrs
    };
  }

  _saveFeatureInspector() {
    if (!this.featureInspector) return;
    const { code, type } = this.featureInspector;
    const values = this._collectFeatureInspectorValues();
    this.store.setPointFeature(code, type, values);
    this.status(`Updated ${type} on ${code}`, 1800);
    this.closeFeatureInspector();
  }

  _deleteFeatureInspector() {
    if (!this.featureInspector) return;
    const { code, type } = this.featureInspector;
    // No confirm() here on purpose — a single point feature is low-stakes
    // (autosave + export both cover it) and a native dialog silently no-ops
    // under browser dialog-suppression, which reads as a broken Delete button.
    this.store.deletePointFeature(code, type);
    this.status(`Deleted ${type} on ${code}`, 1800);
    this.closeFeatureInspector();
  }

  closeFeatureInspector() {
    this.featureInspector = null;
    if (this.els['feature-inspector']) this.els['feature-inspector'].hidden = true;
    if (!this.inspectorHex) this.els['layers-panel'].hidden = false;
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
    const feature = this._effectiveEdgeFeatures()[idx];
    if (!feature) return;
    if (this.store.isPtp()) this.setPtpEdgeType(feature.key);
    else this.setEdgePaintFeature(feature.key);
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

    const show = this.mode === 'terrain' || this.mode === 'edges' || this.mode === 'features' || this.mode === 'nodeFeatures';
    card.style.display = show ? '' : 'none';
    if (this.mode !== 'nodeFeatures' && this.els['node-paint-controls']) {
      this.els['node-paint-controls'].hidden = true;
    }
    if (!show) return;

    const palette = this.store.getPalette() || {};
    this.els['brush-mode-tag'].textContent = this.mode === 'edges'
      ? 'Edge paint'
      : (this.mode === 'features' ? 'Features' : (this.mode === 'nodeFeatures' ? 'Node features' : 'Terrain'));

    if (this.mode === 'nodeFeatures') {
      const features = palette.nodeFeatures || [];
      // Drop a stale arm that no longer exists in the current palette.
      if (this.nodeFeaturePaintType && !features.some((f) => f.key === this.nodeFeaturePaintType)) {
        this.nodeFeaturePaintType = null;
        this._setupNodeFeaturePaint();
      }
      list.innerHTML = features.map((f, idx) => {
        const active = f.key === this.nodeFeaturePaintType;
        const keycap = this._shortcutLabel(idx);
        const count = this.store.countNodeFeatureTagged(f.key);
        return `<div class="ink${active ? ' is-active' : ''}" data-ink-key="${f.key}">
          <span class="swatch" style="background:${f.color || '#888'}"></span>
          <span class="name">${f.label || f.key}</span>
          <span class="count">${count}</span>
          ${keycap ? `<span class="kbd">${keycap}</span>` : ''}
        </div>`;
      }).join('');
      this._renderNodeFeaturePaintControls();
      return;
    }

    if (this.mode === 'features') {
      const counts = this._pointFeatureCounts();
      const features = this._effectiveHexFeatures();
      // Select-not-place: do NOT force an armed type here. Only clear a stale arm
      // that isn't a real type anymore; null means "nothing armed" (no silent add).
      if (this.featurePaintType && !features.some((f) => f.key === this.featurePaintType)) {
        this.featurePaintType = null;
        this._setupFeaturePaint();
      }
      list.innerHTML = features.map((f, idx) => {
        const active = f.key === this.featurePaintType;
        const keycap = this._shortcutLabel(idx);
        const glyph = f.glyph ? `<span class="hx-data">${f.glyph}</span>` : '';
        return `<div class="ink${active ? ' is-active' : ''}" data-ink-key="${f.key}">
          ${glyph}
          <span class="name">${f.label || f.key}</span>
          <span class="count">${counts[f.key] || 0}</span>
          ${keycap ? `<span class="kbd">${keycap}</span>` : ''}
        </div>`;
      }).join('');
      return;
    }

    if (this.mode === 'edges') {
      const counts = this.store.isPtp() ? this.store.getPtpEdgeCounts() : this._featureCounts();
      const features = this._effectiveEdgeFeatures();
      if (features.length && !features.some((f) => f.key === this.edgePaintFeature)) {
        this.edgePaintFeature = features[0].key;
        if (this.store.isPtp()) this._setupPtpEdgePaint();
        else this._setupEdgePaint();
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
        <span class="swatch" style="background:${terrainSwatchBackground(t)}"></span>
        <span class="name">${t.label || t.key}</span>
        ${keycap ? `<span class="kbd">${keycap}</span>` : ''}
      </div>`;
    }).join('');
  }

  _featureVisible(featureKey) {
    const visibility = this.renderer.hexsideVisibility || {};
    return visibility[featureKey] !== false;
  }

  toggleTerrainLabels(force) {
    const next = typeof force === 'boolean' ? force : !this.renderer.terrainLabelsVisible;
    this.renderer.terrainLabelsVisible = next;
    this._saveViewSettings();
    this._renderLayersPanel();
    this.renderer.draw();
  }

  toggleHexsideLayerVisibility(featureKey) {
    if (!featureKey) return;
    if (!this.renderer.hexsideVisibility) this.renderer.hexsideVisibility = {};
    this.renderer.hexsideVisibility[featureKey] = !this._featureVisible(featureKey);
    this._renderLayersPanel();
    this.renderer.draw();
  }

  _loadViewSettings() {
    try {
      const raw = localStorage.getItem(VIEW_SETTINGS_KEY);
      if (!raw) return;
      const v = JSON.parse(raw);
      if (Number.isFinite(v.terrainFillAlpha)) {
        this.renderer.terrainFillAlpha = Math.max(0, Math.min(1, v.terrainFillAlpha));
      } else if (Number.isFinite(v.overlayAlpha)) {
        this.renderer.terrainFillAlpha = Math.max(0, Math.min(1, v.overlayAlpha));
      }
      if (Number.isFinite(v.hexsideStrokeAlpha)) {
        this.renderer.hexsideStrokeAlpha = Math.max(0, Math.min(1, v.hexsideStrokeAlpha));
      }
      if (Number.isFinite(v.mapDim)) {
        this.renderer.mapDim = Math.max(0, Math.min(0.85, v.mapDim));
      }
      if (typeof v.terrainFillVisible === 'boolean') {
        this.renderer.terrainFillVisible = v.terrainFillVisible;
      }
      if (typeof v.terrainLabelsVisible === 'boolean') {
        this.renderer.terrainLabelsVisible = v.terrainLabelsVisible;
      }
      if (Number.isFinite(v.terrainLabelScale)) {
        this.renderer.terrainLabelScale = Math.max(0.5, Math.min(3, v.terrainLabelScale));
      }
    } catch (_) { /* ignore corrupt view settings */ }
  }

  _saveViewSettings() {
    try {
      localStorage.setItem(VIEW_SETTINGS_KEY, JSON.stringify({
        terrainFillAlpha: this.renderer.terrainFillAlpha,
        hexsideStrokeAlpha: this.renderer.hexsideStrokeAlpha,
        mapDim: this.renderer.mapDim,
        terrainFillVisible: this.renderer.terrainFillVisible !== false,
        terrainLabelsVisible: !!this.renderer.terrainLabelsVisible,
        terrainLabelScale: Math.max(0.5, Math.min(3, this.renderer.terrainLabelScale ?? 1))
      }));
    } catch (_) { /* quota */ }
  }

  clearHexsideLayer(featureKey, label) {
    if (!featureKey) return;
    const count = this._featureCounts()[featureKey] || 0;
    if (count === 0) return;
    if (!this._isLayerClearArmed('hexside', featureKey)) {
      this._armLayerClear('hexside', featureKey);
      return;
    }
    this._disarmLayerClear();
    this.store.clearHexsideFeatureLayer(featureKey);
  }

  // ----------------- groups (multi-hex assignments) -----------------

  _deselectGroup() {
    if (!this._selectedGroupId) return;
    this._selectedGroupId = null;
    this.renderer.clearGroupHover();
    this._disarmGroupDelete();
    this._renderGroupsPanel();
    this._reflectGroupActionButtons();
  }

  _validateSelectedGroup() {
    if (!this._selectedGroupId) return;
    if (!this.store.getGroup(this._selectedGroupId)) this._deselectGroup();
  }

  _selectGroup(id) {
    if (this._selectedGroupId === id) return;
    this._selectedGroupId = id;
    const group = this.store.getGroup(id);
    this.renderer.setGroupHover(group?.hexes || []);
    this._disarmGroupDelete();
    this._renderGroupsPanel();
    this._reflectGroupActionButtons();
    if (this.inspectorHex) this.closeInspector();
  }

  _isGroupDeleteArmed(id) {
    return this._groupDeleteArmedId === id;
  }

  _armGroupDelete(id) {
    this._disarmGroupDelete();
    this._groupDeleteArmedId = id;
    if (this._groupDeleteTimer) clearTimeout(this._groupDeleteTimer);
    this._groupDeleteTimer = setTimeout(() => this._disarmGroupDelete(), 3000);
    this._renderGroupsPanel();
  }

  _disarmGroupDelete() {
    if (!this._groupDeleteArmedId) return;
    this._groupDeleteArmedId = null;
    if (this._groupDeleteTimer) clearTimeout(this._groupDeleteTimer);
    this._groupDeleteTimer = null;
    this._renderGroupsPanel();
  }

  _escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  _renderGroupsPanel() {
    const wrap = this.els['group-layer-wrap'];
    const rows = this.els['group-layer-rows'];
    if (!wrap || !rows) return;
    const groups = this.store.getGroups();
    wrap.hidden = false;
    rows.innerHTML = groups.map((g) => {
      const selected = this._selectedGroupId === g.id;
      const armed = this._isGroupDeleteArmed(g.id);
      return `<div class="group-row${selected ? ' is-selected' : ''}" data-group-id="${this._escHtml(g.id)}">
        <div class="group-main">
          <span class="group-name">${this._escHtml(g.name || '(unnamed)')}</span>
          <span class="group-meta">${g.hexes.length} hex${g.hexes.length === 1 ? '' : 'es'} · ${this._escHtml(g.kind || '—')} · ${this._escHtml(g.value != null ? String(g.value) : '')}</span>
        </div>
        <div class="group-actions">
          <button type="button" class="group-edit" data-group-id="${this._escHtml(g.id)}" aria-label="Edit ${this._escHtml(g.name || 'group')}">✎</button>
          <button type="button" class="group-del${armed ? ' confirming' : ''}" data-group-id="${this._escHtml(g.id)}" aria-label="${armed ? 'Confirm delete' : 'Delete group'}">${armed ? '✓' : '×'}</button>
        </div>
      </div>`;
    }).join('');

    const editForm = this.els['group-edit-form'];
    if (editForm) {
      const editing = this._selectedGroupId ? this.store.getGroup(this._selectedGroupId) : null;
      editForm.hidden = !editing;
      if (editing) {
        this.els['group-edit-id'].value = editing.id;
        this.els['group-edit-name'].value = editing.name || '';
        this.els['group-edit-kind'].value = editing.kind || '';
        this.els['group-edit-value'].value = editing.value != null ? String(editing.value) : '';
      }
    }
  }

  _createGroupFromSelection() {
    const hexes = [...this.renderer.selectedHexes];
    if (!hexes.length) return;
    const name = this.els['group-create-name'].value.trim();
    const kind = this.els['group-create-kind'].value.trim();
    const value = this.els['group-create-value'].value;
    const id = this.store.createGroup({ name, kind, value, hexes });
    this.els['group-create-name'].value = '';
    this.els['group-create-kind'].value = '';
    this.els['group-create-value'].value = '';
    this.renderer.clearHexSelection();
    this._selectGroup(id);
    this.status(`Created group${name ? ` "${name}"` : ''} with ${hexes.length} hex${hexes.length === 1 ? '' : 'es'}.`, 2500);
  }

  _saveGroupEdit() {
    const id = this.els['group-edit-id'].value;
    if (!id) return;
    const name = this.els['group-edit-name'].value.trim();
    const kind = this.els['group-edit-kind'].value.trim();
    const value = this.els['group-edit-value'].value;
    const group = this.store.getGroup(id);
    if (!group) return;
    const changed = name !== (group.name || '') || kind !== (group.kind || '') || value !== (group.value != null ? String(group.value) : '');
    if (changed) {
      this.store.updateGroup(id, { name, kind, value });
    }
    this._renderGroupsPanel();
  }

  _deleteGroup(id) {
    if (!this._isGroupDeleteArmed(id)) {
      this._armGroupDelete(id);
      return;
    }
    this._disarmGroupDelete();
    if (this._selectedGroupId === id) this._selectedGroupId = null;
    this.store.deleteGroup(id);
    this.renderer.clearGroupHover();
    this._reflectGroupActionButtons();
  }

  _addSelectedToGroup() {
    if (!this._selectedGroupId) return;
    const hexes = [...this.renderer.selectedHexes];
    if (!hexes.length) return;
    let added = 0;
    for (const code of hexes) {
      if (this.store.addHexToGroup(this._selectedGroupId, code)) added++;
    }
    if (added) {
      this._renderGroupsPanel();
      const group = this.store.getGroup(this._selectedGroupId);
      this.renderer.setGroupHover(group?.hexes || []);
      this.status(`Added ${added} hex${added === 1 ? '' : 'es'} to group.`, 1800);
    }
  }

  _removeSelectedFromGroup() {
    if (!this._selectedGroupId) return;
    const hexes = [...this.renderer.selectedHexes];
    if (!hexes.length) return;
    let removed = 0;
    for (const code of hexes) {
      if (this.store.removeHexFromGroup(this._selectedGroupId, code)) removed++;
    }
    if (removed) {
      this._renderGroupsPanel();
      const group = this.store.getGroup(this._selectedGroupId);
      this.renderer.setGroupHover(group?.hexes || []);
      this.status(`Removed ${removed} hex${removed === 1 ? '' : 'es'} from group.`, 1800);
    }
  }

  _reflectGroupActionButtons() {
    const hasSel = this.renderer.selectedHexes.size > 0;
    const hasGroup = !!this._selectedGroupId;
    const createBtn = this.els['group-create-btn'];
    if (createBtn) createBtn.disabled = !hasSel;
    const addBtn = this.els['group-add-sel-btn'];
    if (addBtn) addBtn.disabled = !(hasSel && hasGroup);
    const removeBtn = this.els['group-remove-sel-btn'];
    if (removeBtn) removeBtn.disabled = !(hasSel && hasGroup);
  }

  _traceColor(trace) {
    const palette = this.store.getPalette();
    const feature = (palette?.hexsideFeatures || []).find((f) => f.key === trace.layer || f.exportLayer === trace.layer);
    if (feature) return this._hexsideFeatureColor(feature);
    return HEXSIDE_COLORS[trace.layer]?.stroke || '#888';
  }

  _renderLayersPanel() {
    const palette = this.store.getPalette() || {};
    const featureRows = this.els['feature-layer-rows'];

    if (this.store.isPtp()) {
      const counts = this.store.getPtpEdgeCounts();
      const features = palette.edgeFeatures || [];
      featureRows.innerHTML = features.map((f) => {
        const n = counts[f.key] || 0;
        return `<div class="layer-row">
          <span class="swatch" style="background:${this._hexsideFeatureColor(f)}"></span>
          <span class="name">${f.label || f.key}</span>
          <span class="count">${n}</span>
        </div>`;
      }).join('');
      const nodeCount = Object.keys(this.store.state.nodes || {}).length;
      const edgeCount = this.store.countPtpEdges();
      const orphans = this.store.getOrphanNodeIds();
      const ptpMeta = document.getElementById('ptp-layer-meta');
      if (ptpMeta) {
        ptpMeta.textContent = `${nodeCount} nodes · ${edgeCount} edges`;
        ptpMeta.title = orphans.length
          ? `Orphan nodes (no edges): ${orphans.slice(0, 12).join(', ')}${orphans.length > 12 ? '…' : ''}`
          : '';
      }
      const warn = document.getElementById('ptp-orphan-warn');
      if (warn) {
        warn.hidden = orphans.length === 0;
        warn.textContent = orphans.length
          ? `${orphans.length} orphan node${orphans.length === 1 ? '' : 's'} (no edges)`
          : '';
      }

      const nodeFeatures = palette.nodeFeatures || [];
      const nodeFeatWrap = this.els['node-feature-layer-wrap'];
      const nodeFeatRows = this.els['node-feature-layer-rows'];
      if (nodeFeatWrap && nodeFeatRows) {
        nodeFeatWrap.hidden = nodeFeatures.length === 0;
        nodeFeatRows.innerHTML = nodeFeatures.map((f) => {
          const on = this._nodeFeatureVisible(f.key);
          const n = this.store.countNodeFeatureTagged(f.key);
          const armed = this._isLayerClearArmed('nodeFeature', f.key);
          const clearBtn = n > 0
            ? `<button type="button" class="layer-clear${armed ? ' confirming' : ''}" data-node-feature-key="${f.key}" aria-label="${armed ? `Confirm clear ${f.label || f.key} — click again to permanently remove ${n} entries` : `Clear ${f.label || f.key}`}" title="${armed ? 'Click again to permanently clear this layer' : 'Clear layer'}">${armed ? '✓' : '×'}</button>`
            : '';
          return `<div class="layer-row${on ? '' : ' dimmed'}">
            <button type="button" class="eye${on ? '' : ' off'}" data-node-feature-key="${f.key}" aria-label="Toggle ${f.label || f.key}">
              ${on ? EYE_OPEN_SVG : EYE_OFF_SVG}
            </button>
            <span class="swatch" style="background:${f.color || '#888'}"></span>
            <span class="name">${f.label || f.key}</span>
            <span class="count">${n}</span>
            ${clearBtn}
          </div>`;
        }).join('');
      }
      return;
    }

    const counts = this._featureCounts();
    const features = palette.hexsideFeatures || [];

    featureRows.innerHTML = features.map((f) => {
      const on = this._featureVisible(f.key);
      const n = counts[f.key] || 0;
      const armed = this._isLayerClearArmed('hexside', f.key);
      const clearBtn = n > 0
        ? `<button type="button" class="layer-clear${armed ? ' confirming' : ''}" data-feature-key="${f.key}" aria-label="${armed ? `Confirm clear ${f.label || f.key} — click again to permanently remove ${n} entries` : `Clear ${f.label || f.key}`}" title="${armed ? 'Click again to permanently clear this layer' : 'Clear layer'}">${armed ? '✓' : '×'}</button>`
        : '';
      return `<div class="layer-row${on ? '' : ' dimmed'}">
        <button type="button" class="eye${on ? '' : ' off'}" data-feature-key="${f.key}" aria-label="Toggle ${f.label || f.key}">
          ${on ? EYE_OPEN_SVG : EYE_OFF_SVG}
        </button>
        <span class="swatch" style="background:${this._hexsideFeatureColor(f)}"></span>
        <span class="name">${f.label || f.key}</span>
        <span class="count">${n}</span>
        ${clearBtn}
      </div>`;
    }).join('');

    const pointFeatures = this._effectiveHexFeatures();
    const pointCounts = this._pointFeatureCounts();
    const pointWrap = this.els['point-feature-layer-wrap'];
    const pointRows = this.els['point-feature-layer-rows'];
    if (pointWrap && pointRows) {
      pointWrap.hidden = pointFeatures.length === 0;
      pointRows.innerHTML = pointFeatures.map((f) => {
        const n = pointCounts[f.key] || 0;
        const armed = this._isLayerClearArmed('point', f.key);
        const clearBtn = n > 0
          ? `<button type="button" class="layer-clear${armed ? ' confirming' : ''}" data-point-feature-key="${f.key}" aria-label="${armed ? `Confirm clear ${f.label || f.key} — click again to permanently remove ${n} entries` : `Clear ${f.label || f.key}`}" title="${armed ? 'Click again to permanently clear this layer' : 'Clear layer'}">${armed ? '✓' : '×'}</button>`
          : '';
        return `<div class="layer-row">
          <span class="swatch point-feat-glyph hx-data">${f.glyph || '•'}</span>
          <span class="name">${f.label || f.key}</span>
          <span class="count">${n}</span>
          ${clearBtn}
        </div>`;
      }).join('');
    }

    const terrainFillOn = this.renderer.terrainFillVisible !== false;
    this.els['terrain-fill-row'].classList.toggle('dimmed', !terrainFillOn);
    this.els['terrain-fill-eye'].classList.toggle('off', !terrainFillOn);
    this.els['terrain-fill-eye'].innerHTML = terrainFillOn ? EYE_OPEN_SVG : EYE_OFF_SVG;

    const labelsOn = !!this.renderer.terrainLabelsVisible;
    const labelsBtn = this.els['terrain-labels-toggle'];
    if (labelsBtn) {
      labelsBtn.classList.toggle('on', labelsOn);
      labelsBtn.setAttribute('aria-pressed', labelsOn ? 'true' : 'false');
    }
    const labelSizeRow = this.els['terrain-label-size-row'];
    if (labelSizeRow) labelSizeRow.hidden = !labelsOn;
    const labelScale = Math.max(0.5, Math.min(3, this.renderer.terrainLabelScale ?? 1));
    this.els['terrain-label-size'].value = String(labelScale);
    this.els['terrain-label-size-value'].textContent = `${Math.round(labelScale * 100)}%`;

    const terrainCount = Object.keys(this.store.state.terrain?.terrain || {}).length;
    this.els['terrain-fill-count'].textContent = String(terrainCount);

    const terrainFillOpacity = Math.max(0, Math.min(1, this.renderer.terrainFillAlpha ?? 1));
    this.els['terrain-fill-opacity'].value = String(terrainFillOpacity);
    this.els['terrain-fill-opacity-value'].textContent = `${Math.round(terrainFillOpacity * 100)}%`;

    const hexsideStrokeOpacity = Math.max(0, Math.min(1, this.renderer.hexsideStrokeAlpha ?? 1));
    this.els['hexside-stroke-opacity'].value = String(hexsideStrokeOpacity);
    this.els['hexside-stroke-opacity-value'].textContent = `${Math.round(hexsideStrokeOpacity * 100)}%`;

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

    this._renderGroupsPanel();
  }

  _terrainColorForCursor() {
    const palette = this.store.getPalette();
    const terrain = (palette?.terrain || []).find((t) => t.key === this.brushTerrain);
    return terrain?.color || terrain?.colors?.[0] || '#cccccc';
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
    if (this.mode === 'features' || this.mode === 'nodeFeatures') {
      wrap.style.cursor = 'crosshair';
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
    this.renderer.clearHighlight();
    this._updateInspectorTitle(code);
    this.els['hex-editor'].hidden = false;
    this.els['layers-panel'].hidden = true;
    this._refreshInspector();
    requestAnimationFrame(() => {
      this._positionInspector();
    });
  }

  _inspectorViewport() {
    const strip = document.querySelector('.status-strip');
    const minTop = (strip ? strip.getBoundingClientRect().bottom : 40) + INSPECTOR_MARGIN;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return { minTop, vw, vh };
  }

  _clampInspectorRect(left, top, pw, ph) {
    const { minTop, vw, vh } = this._inspectorViewport();
    const M = INSPECTOR_MARGIN;
    const maxLeft = Math.max(M, vw - pw - M);
    const maxTop = Math.max(minTop, vh - ph - M);
    return {
      left: Math.min(Math.max(M, left), maxLeft),
      top: Math.min(Math.max(minTop, top), maxTop)
    };
  }

  _loadInspectorPos() {
    try {
      const raw = localStorage.getItem(INSPECTOR_POS_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (Number.isFinite(v.left) && Number.isFinite(v.top)) return v;
    } catch (_) { /* ignore corrupt inspector position */ }
    return null;
  }

  _saveInspectorPos(left, top) {
    try {
      localStorage.setItem(INSPECTOR_POS_KEY, JSON.stringify({
        left: Math.round(left),
        top: Math.round(top)
      }));
    } catch (_) { /* quota */ }
  }

  _dockInspector() {
    const panel = this.els['hex-editor'];
    if (!panel) return;
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    try { localStorage.removeItem(INSPECTOR_POS_KEY); } catch (_) { /* ignore */ }
  }

  _positionInspector() {
    const panel = this.els['hex-editor'];
    if (!panel || panel.hidden) return;

    const saved = this._loadInspectorPos();
    if (!saved) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '';
      return;
    }

    panel.style.right = 'auto';
    const { width: pw, height: ph } = panel.getBoundingClientRect();
    const clamped = this._clampInspectorRect(saved.left, saved.top, pw, ph);
    panel.style.left = `${Math.round(clamped.left)}px`;
    panel.style.top = `${Math.round(clamped.top)}px`;
    if (Math.abs(clamped.left - saved.left) > 0.5 || Math.abs(clamped.top - saved.top) > 0.5) {
      this._saveInspectorPos(clamped.left, clamped.top);
    }
  }

  _setupInspectorDrag() {
    const panel = this.els['hex-editor'];
    const head = panel?.querySelector('.head');
    if (!head) return;

    const drag = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      startLeft: 0,
      startTop: 0,
      moved: false
    };
    this._inspectorDrag = drag;

    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.collapse')) return;
      drag.active = true;
      drag.pointerId = e.pointerId;
      drag.moved = false;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      drag.startLeft = rect.left;
      drag.startTop = rect.top;
      panel.style.right = 'auto';
      panel.style.left = `${Math.round(rect.left)}px`;
      panel.style.top = `${Math.round(rect.top)}px`;
      head.classList.add('is-dragging');
      head.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    head.addEventListener('pointermove', (e) => {
      if (!drag.active || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
      const { width: pw, height: ph } = panel.getBoundingClientRect();
      const clamped = this._clampInspectorRect(drag.startLeft + dx, drag.startTop + dy, pw, ph);
      panel.style.left = `${Math.round(clamped.left)}px`;
      panel.style.top = `${Math.round(clamped.top)}px`;
    });

    const finishDrag = (e) => {
      if (!drag.active || e.pointerId !== drag.pointerId) return;
      drag.active = false;
      drag.pointerId = null;
      head.classList.remove('is-dragging');
      if (head.hasPointerCapture(e.pointerId)) head.releasePointerCapture(e.pointerId);
      if (drag.moved) {
        const rect = panel.getBoundingClientRect();
        this._saveInspectorPos(rect.left, rect.top);
      }
    };

    head.addEventListener('pointerup', finishDrag);
    head.addEventListener('pointercancel', finishDrag);

    head.addEventListener('dblclick', (e) => {
      if (e.target.closest('.collapse')) return;
      e.preventDefault();
      this._dockInspector();
    });
  }

  _updateInspectorTitle(code) {
    const name = this.store.getHexName(code);
    this.els['hexed-title'].textContent = name ? `Hex ${code} — ${name}` : `Hex ${code}`;
  }

  _setHexEditorFill(terrain) {
    const fill = this.els['hexed-fill'];
    if (Array.isArray(terrain?.colors) && terrain.colors.length >= 2) {
      const svgNs = 'http://www.w3.org/2000/svg';
      const svg = this.els['hexed-svg'];
      let defs = svg.querySelector('defs');
      if (!defs) {
        defs = document.createElementNS(svgNs, 'defs');
        svg.insertBefore(defs, svg.firstChild);
      }
      let grad = defs.querySelector('#hexed-fill-grad');
      if (!grad) {
        grad = document.createElementNS(svgNs, 'linearGradient');
        grad.id = 'hexed-fill-grad';
        grad.setAttribute('gradientUnits', 'objectBoundingBox');
        grad.setAttribute('x1', '0');
        grad.setAttribute('y1', '0');
        grad.setAttribute('x2', '1');
        grad.setAttribute('y2', '1');
        for (let i = 0; i < 4; i++) grad.appendChild(document.createElementNS(svgNs, 'stop'));
        defs.appendChild(grad);
      }
      const [c1, c2] = terrain.colors;
      const stops = grad.querySelectorAll('stop');
      stops[0].setAttribute('offset', '0%');
      stops[0].setAttribute('stop-color', c1);
      stops[1].setAttribute('offset', '50%');
      stops[1].setAttribute('stop-color', c1);
      stops[2].setAttribute('offset', '50%');
      stops[2].setAttribute('stop-color', c2);
      stops[3].setAttribute('offset', '100%');
      stops[3].setAttribute('stop-color', c2);
      fill.setAttribute('fill', 'url(#hexed-fill-grad)');
    } else {
      fill.setAttribute('fill', terrain?.color || '#888');
    }
    fill.setAttribute('fill-opacity', '0.18');
  }

  _refreshInspector() {
    if (!this.inspectorHex) return;
    const code = this.inspectorHex;
    this._updateInspectorTitle(code);
    const palette = this.store.getPalette();
    const terrainKey = this.store.state.terrain.terrain[code] || 'clear';
    const terrain = (palette?.terrain || []).find(t => t.key === terrainKey);
    this.els['hexed-terrain-current'].textContent = terrain?.label || terrainKey;
    this.els['hexed-center-code'].textContent = code;
    this.els['hexed-name'].value = this.store.getHexName(code);

    this._setHexEditorFill(terrain);

    this.els['hexed-terrain-grid'].querySelectorAll('.terr[data-terrain]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.terrain === terrainKey);
    });

    const currentFeatures = this.store.getHexFeatures(code);
    this.els['hexed-feat-count'].textContent = String(currentFeatures.length);
    this.els['hexed-featrow'].querySelectorAll('.feat[data-feature]').forEach(btn => {
      btn.classList.toggle('is-active', currentFeatures.includes(btn.dataset.feature));
    });
    this._renderInspectorPointFeatures(code);
    this._renderInspectorAddFeature(code);

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
    requestAnimationFrame(() => {
      if (this.inspectorHex) this._positionInspector();
    });
  }

  closeInspector() {
    this.inspectorHex = null;
    this.hexedSelectedEdge = null;
    this.els['hex-editor'].hidden = true;
    if (!this.featureInspector) this.els['layers-panel'].hidden = false;
    this.renderer.closeInspector();
  }

  _toggleHexFeature(key) {
    if (!this.inspectorHex) return;
    this.store.toggleHexFeature(this.inspectorHex, key);
  }

  // Inspect-mode list of the hex's POINT features (type/name/value) with per-row
  // Edit (reuses the feature inspector) + Delete. Renders nothing when the hex has
  // no point features. Edits/deletes route through the same store mutation path the
  // features tool uses, so autosave + export stay consistent.
  _renderInspectorPointFeatures(code) {
    const el = this.els['hexed-point-feats'];
    if (!el) return;
    const present = this.store.getPointFeaturesAt(code);
    if (!present.length) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = present.map((pf) => {
      const decl = this._hexFeatureDecl(pf.type);
      const label = decl?.label || pf.type;
      const glyph = decl?.glyph ? `<span class="hx-data pf-glyph">${decl.glyph}</span>` : '';
      const attrs = pf.attrs || {};
      const attrStr = Object.entries(attrs)
        .map(([k, v]) => `${k} ${v}`).join(' · ');
      const nameStr = pf.name ? `<span class="pf-name">${pf.name}</span>` : '';
      return `<div class="point-feat-row" data-pf-type="${pf.type}">
        ${glyph}
        <span class="pf-label">${label}</span>
        ${nameStr}
        <span class="hx-data pf-val">${attrStr}</span>
        <button type="button" class="pf-edit" data-pf-type="${pf.type}" title="Edit ${label}">Edit</button>
        <button type="button" class="pf-del" data-pf-type="${pf.type}" aria-label="Delete ${label}" title="Delete">×</button>
      </div>`;
    }).join('');
  }

  // Add-from-Inspect: pick a not-yet-present type (same declarations the
  // features-mode picker uses) and create it, then immediately open the full
  // feature editor to set its fields — so working hex-by-hex in Inspect never
  // requires a detour through Features mode just to add one feature.
  _renderInspectorAddFeature(code) {
    const wrap = this.els['hexed-point-feat-add'];
    const select = this.els['hexed-add-feat-select'];
    if (!wrap || !select) return;
    const present = new Set(this.store.getPointFeaturesAt(code).map((pf) => pf.type));
    const available = this._effectiveHexFeatures().filter((f) => !present.has(f.key));
    if (!available.length) { wrap.hidden = true; select.innerHTML = ''; return; }
    wrap.hidden = false;
    select.innerHTML = available.map((f) => `<option value="${f.key}">${f.label || f.key}</option>`).join('');
  }

  _addInspectorPointFeature() {
    const code = this.inspectorHex;
    const type = this.els['hexed-add-feat-select']?.value;
    if (!code || !type) return;
    const decl = this._hexFeatureDecl(type);
    const label = decl?.label || type;
    // Same store mutation path as features-mode placement (blank name/attrs —
    // openFeatureInspector below pre-fills the name from the hex name if set).
    this.store.setPointFeature(code, type, { name: '', attrs: undefined });
    this.status(`Added ${label} on ${code}`, 1800);
    this.openFeatureInspector(code, type);
  }

  _deleteInspectorPointFeature(type) {
    const code = this.inspectorHex;
    if (!code || !type) return;
    const decl = this._hexFeatureDecl(type);
    const label = decl?.label || type;
    // No confirm() here on purpose — same reasoning as _deleteFeatureInspector
    // above: single-feature delete is low-stakes, and a suppressed confirm()
    // silently vetoes the × button with no visible failure.
    this.store.deletePointFeature(code, type);
    this.status(`Deleted ${label} on ${code}`, 1800);
    // onChange -> updateUI -> _refreshInspector re-renders the list.
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
      this._setupFeaturePaint();
      this._setupPtpEdgePaint();
      this._setupNodeFeaturePaint();
      if (this.inspectorHex) this._refreshInspector();
    }
    this._reflectMapFamily();
    this._renderBrushCard();
    this._renderLayersPanel();
    this._validateSelectedGroup();
    this._reflectGroupActionButtons();
    this._updateCounts();
    this._updateAnomalyStatus();
    this.els['undo'].disabled = !this.store.canUndo();
    this._reflectViewMode();
    this._reflectMode();
    this._updateModeHint();
    this._reflectBrush();
    this._reflectEdgePaint();
    this._reflectFeaturePaint();
    this._reflectNodeFeaturePaint();
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
    if (this.store.isPtp()) {
      const nodeCount = Object.keys(this.store.state.nodes || {}).length;
      this.els['count-land'].textContent = nodeCount;
      const lc = this.els['layer-counts'];
      const counts = this.store.getPtpEdgeCounts();
      const features = this.store.getPalette()?.edgeFeatures || [];
      lc.innerHTML = features.map((f) => `
      <div class="layer-count">
        <span><span class="layer-dot" style="background:${f.color || '#888'}"></span>${f.label || f.key}</span>
        <span class="mono">${counts[f.key] || 0}</span>
      </div>`).join('');
      return;
    }
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
