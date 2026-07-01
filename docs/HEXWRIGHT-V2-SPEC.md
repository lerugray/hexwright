# Hexwright v2 — Professional-Grade Spec (2026-07-01)

Status: approved (Ray, 2026-07-01). Scope = full professional pass, built public-ready but repo stays private until Ray flips it.

Extends the shipped v1 (calibrated flat-top even-q editor: base terrain per hex + single-feature hexsides + trace overlays + undo/redo + 11-check smoke). This spec adds: in-hex point features, multi-feature hexsides, a config-driven palette, a classification/overlay render mode with PNG export + anomaly check, WMP draft-import with provenance, and public packaging.

Guiding constraints (unchanged): zero-build vanilla JS + Canvas2D, engine-agnostic, no framework, keep the module split (app/store/renderer/ui/geometry/style). Everything must work end-to-end and be exercised by the smoke test — no stubs surfaced as done.

---

## 1. Config-driven palette (the reusability spine)

New concept: a **palette config** object defines all vocabulary + colors. Defaults to GotA's, but any project supplies its own. Loadable at runtime ("Load palette" button) and embeddable in a project file.

```json
{
  "name": "GotA default",
  "terrain": [
    {"key": "clear",  "label": "Clear",  "color": "#c8b88a"},
    {"key": "woods",  "label": "Woods",  "color": "#5c7a4a"},
    {"key": "rough",  "label": "Rough",  "color": "#a98a5c"},
    {"key": "swamp",  "label": "Swamp",  "color": "#6b7a5a"},
    {"key": "water",  "label": "Water",  "color": "#3f78b4"},
    {"key": "desert", "label": "Desert", "color": "#d8c88a"},
    {"key": "urban",  "label": "Urban",  "color": "#9a9a9a"}
  ],
  "hexFeatures": [
    {"key": "city",      "label": "City",      "glyph": "◉"},
    {"key": "town",      "label": "Town",      "glyph": "○"},
    {"key": "fort",      "label": "Fort",      "glyph": "✦"},
    {"key": "port",      "label": "Port",      "glyph": "⚓"},
    {"key": "airfield",  "label": "Airfield",  "glyph": "✈"},
    {"key": "objective", "label": "Objective", "glyph": "★"},
    {"key": "resource",  "label": "Resource",  "glyph": "◈"}
  ],
  "hexsideFeatures": [
    {"key": "river",      "label": "River",       "color": "#2878ff", "exportLayer": "rivers"},
    {"key": "stream",     "label": "Stream",      "color": "#6fb0e8", "exportLayer": "streams"},
    {"key": "road",       "label": "Road",        "color": "#c9a06a", "exportLayer": "roads"},
    {"key": "rail",       "label": "Rail",        "color": "#8a8f98", "dash": true, "exportLayer": "rails"},
    {"key": "ridge",      "label": "Ridge/Mtn",   "color": "#be8228", "exportLayer": "mountains"},
    {"key": "cliff",      "label": "Cliff",       "color": "#7a5a2a", "exportLayer": "cliffs"},
    {"key": "escarpment", "label": "Escarpment",  "color": "#9a6a3a", "exportLayer": "escarpments"},
    {"key": "wall",       "label": "Wall",        "color": "#b0b0b0", "exportLayer": "walls"},
    {"key": "bridge",     "label": "Bridge",      "color": "#e0c060", "exportLayer": "bridges"},
    {"key": "impassable", "label": "Impassable",  "color": "#dc2828", "exportLayer": "impassible"}
  ],
  "terrainAliases": {"forest": "woods", "lake": "water"},
  "hexsideAliases": {"mountains": "ridge", "impassible": "impassable"}
}
```

Notes:
- `exportLayer` = the grouped-list key used on export for back-compat (e.g. `ridge` → `mountains`, `impassable` → `impassible` matching the shipped v1 export). Internal feature keys are clean/singular; export uses `exportLayer`.
- `terrainAliases` / `hexsideAliases` normalize inbound data on import (WMP `forest`→`woods`, `lake`→`water`; legacy v1 hexside keys `mountains`/`impassible` → `ridge`/`impassable`).
- Colors move OUT of the hardcoded `HEXSIDE_COLORS` / terrain color maps into this config. `renderer.js`, `ui.js` read from the active palette.
- Ship the GotA default at `palettes/gota.json`; load it by default so existing behavior is preserved.

## 2. Project data model v2

```jsonc
{
  "schemaVersion": 2,
  "hexgrid": { /* unchanged v1 calibration */ },
  "terrain":     { "0803": "clear", ... },              // base terrain, ONE per hex (unchanged)
  "hexFeatures": { "0803": ["city", "port"], ... },      // NEW: in-hex point features, ARRAY (may be empty/absent)
  "hexsides":    { /* canonical internal: edgeKey "a|b" -> ["river","road"] */ },  // NOW multi-feature
  "provenance":  { "0803": "draft" | "confirmed", ... }, // NEW: per-hex, tracks WMP-auto vs human-confirmed
  "palette": "gota" | { /* inline palette config */ }
}
```

- **Back-compat load:** accept v1 projects (no `schemaVersion`, terrain as `{code:str}`, hexsides as grouped lists `{rivers:[{a,b}],...}`). Migrate on load: grouped lists → per-edge feature arrays (an edge appearing in `rivers` and `roads` → `["river","road"]`), applying `hexsideAliases`. Absent `hexFeatures`/`provenance` default to empty. Preserve untouched layers `theaters`/`boundaries` verbatim.
- **Back-compat export:** emit the grouped-by-layer shape derived from per-edge arrays via `exportLayer` (edge with `["river","road"]` appears in both `rivers` and `roads`), PLUS `theaters`/`boundaries` preserved, PLUS terrain + hexFeatures. Round-trip (load→export) of a v1 project must be lossless for the layers v1 had.
- **Edge key normalization:** unchanged — `a<b` CCRR pair; `edgeKey = a + "|" + b`.

## 3. UI (ui.js + index.html)

**Inspector (click a hex):**
- Terrain dropdown (from palette.terrain) — unchanged behavior; sets provenance `confirmed` on change.
- NEW: In-hex features — a checkbox group from `palette.hexFeatures`; toggling updates `hexFeatures[code]` array.
- 6 edges — convert each single-select to a **multi-select checkbox group** from `palette.hexsideFeatures` (each edge can hold several). Disabled edges (no neighbor) unchanged. The SVG edge illustration paints each edge with its feature color(s); multiple features shown as stacked swatches.

**Toolbar (topbar):**
- **View mode** toggle: `Map` / `Classification` / `Both` (default Both = current behavior).
- **Export overlay PNG** button — see §4.
- **Anomaly check** toggle — see §4.
- **Import WMP draft** button — see §5.
- **Load palette** button (file picker for a palette JSON).
- **Brush** toggle — when on, click-drag paints the currently-selected terrain onto hexes (rubber-band by drag); Shift-click a second hex to paint a straight run.
- Keyboard shortcuts: number keys `1..9,0` select terrain by palette order; `b` toggles brush; `v` cycles view mode; `Esc` closes inspector.

**Legend** — generated from the active palette (terrain swatches + hexside line samples + feature glyphs).

## 4. Renderer (renderer.js)

- **View modes:** `Map` (base map + traces only), `Both` (current: map + traces + classification atop), `Classification` (blank/parchment bg, NO map/traces, full-opacity terrain fills + features + hexsides — read the whole classification cleanly).
- **Multi-feature hexsides:** draw each feature on an edge as a **parallel line offset perpendicular to the edge** (offset index by feature order, ~3–4px spacing) so `stream + road` render as two adjacent lines. Respect `dash` (rail).
- **In-hex feature glyphs:** draw `palette.hexFeatures[].glyph` centered in the hex (small stack if multiple), scaled with zoom.
- **Export overlay → PNG:** render the current classification to an offscreen canvas at **base-map resolution** (so it aligns 1:1 with the source scan) and trigger a download (`<map>-classification.png`). Offer bg = transparent OR parchment (parameter). This is the "drop it beside the scan to spot errors" artifact.
- **Anomaly overlay (toggle):** highlight (a) hexes with NO terrain assigned (unclassified) with a hatched red outline; (b) orphan hexsides (edge feature where a neighbor hex is missing); (c) `provenance == "draft"` hexes with a dim/hatch marker so WMP-auto vs human-confirmed is visible at a glance. Show a count badge ("12 unclassified, 40 draft").
- Colors sourced from active palette, not hardcoded.

## 5. WMP draft-import pipeline

Goal: WMP auto-classifies terrain → Hexwright imports it as a draft → human refines → canonical export. (Reference: `wargame-map-parser` emits `{hexcode: terrainClass}`, same CCRR scheme; classes include `forest`/`lake`; no hexsides, no confidence.)

- **Hexwright side:** "Import WMP draft" → file picker → accept `{terrain:{...}}` or raw `{code:class}` → apply `palette.terrainAliases` (`forest→woods`, `lake→water`) → load into `terrain`, set `provenance[code] = "draft"` for every imported hex. On any later manual edit of a hex, flip its provenance to `confirmed`. The anomaly/classification view surfaces draft hexes distinctly (§4). Undo-able as one step.
- **WMP side (close the loop):** add `wargame-map-parser` a small exporter `parser/export_hexwright.py` (or a `--export-hexwright PATH` flag on the existing CLI) that runs `classify_all()` and writes `{"terrain": {...}}` with `forest→woods`/`lake→water` already applied — so the operator gets a Hexwright-ready file in one command. Keep it dependency-free (stdlib json). Document the two-tool pipeline in both repos' READMEs.
- Hexsides + in-hex features remain manual in Hexwright (WMP doesn't classify them) — that division is intentional and documented.

## 6. Public packaging + polish

- `LICENSE` — MIT (generic tool, no game IP).
- `package.json` — name `hexwright`, version `2.0.0`, scripts: `serve` (python3 -m http.server 8000 or a tiny node static server), `test` (node verify/smoke.mjs). No runtime deps.
- `README.md` — remove "Private"; add: what it is, quickstart (serve + open), the data model, the config-palette system (how to define your own game's palette), the WMP pipeline, screenshots (map / classification / overlay export). Written for a stranger.
- **Autosave** — persist the working project to `localStorage` on mutation (debounced); offer "restore last session" on load. Explicit project save/load (export) unchanged.
- Genericize: ensure nothing GotA-specific is hardcoded in engine code — GotA lives only in `samples/` + `palettes/gota.json`.
- Repo stays private; Ray flips public when satisfied.

## 7. Verification gate (no "done" without this)

Update `verify/smoke.mjs` (headless Playwright) to cover v2 and keep v1 checks green:
1. Load GotA sample (v1 project) → migrates to v2, 4176 hexes render.
2. Assign an in-hex feature → present in export `hexFeatures`.
3. Assign TWO features to one hexside (river + road) → both render (parallel lines) AND both appear in the back-compat grouped export (`rivers` and `roads`).
4. Switch to Classification view → map hidden, terrain fills full-opacity, no JS errors.
5. Export overlay PNG → a non-empty PNG blob at map resolution downloads.
6. Anomaly check → reports a count; a deliberately-unclassified hex is flagged.
7. Import a small WMP-style `{terrain:{"0101":"forest"}}` → hex becomes `woods`, provenance `draft`; editing it flips to `confirmed`.
8. Load a non-default palette → legend + dropdowns reflect it.
9. Round-trip a v1 project (load→export) → lossless for v1 layers (terrain + the grouped hexside lists + theaters/boundaries).

Plus a **visual check** (headed capture): Classification view + exported overlay PNG must actually look right (objective eyeball, per the verify-visual-defects discipline) — not just green unit checks.

## 8. Build order (dependencies)

1. Palette config + data model v2 + migration + back-compat export (store.js, new `palettes/gota.json`) — the spine.
2. Renderer (view modes, multi-feature parallel lines, glyphs, PNG export, anomaly overlay).
3. UI (inspector multi-select + in-hex features, toolbar controls, brush, shortcuts, legend).
4. WMP import (Hexwright side) + WMP exporter (parser side).
5. Packaging (LICENSE, package.json, README, autosave).
6. Verify (smoke v2 + visual).

Off-cap delegation implements each; Opus orchestrates + adversarially verifies + does the visual check. Nothing marked done until §7 passes end-to-end.
