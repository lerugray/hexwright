# Hexwright

Engine-agnostic hex-map editor for digitizing printed wargame boards. Zero build, vanilla JavaScript and Canvas2D. Load a calibrated grid over a scan, assign terrain, hexside features, and point features by hand, then export canonical JSON your game engine consumes.

## Quick start

No runtime dependencies. Install dev tools once for the verify suite:

```
npm install
npx playwright install chromium
```

Serve from the **parent directory** of this repo so manifest paths can reach sibling map rasters (for example `../my-game/assets/board.jpg`):

```
cd ..
python3 -m http.server 8000
# open http://localhost:8000/hexwright/
```

On macOS, double-click `Launch Hexwright.command` to start a local server and open the editor, or use the `Hexwright.app` bundle (same launcher, wrapped as a regular app with a parchment-hex icon — drag it to the Dock or Applications). Put private project data under `local/` (gitignored); reference it with `?project=local/my-game/project.json`.

## Editor modes

Hexwright has five tool modes on the left rail:

| Mode | Key | Purpose |
| --- | --- | --- |
| **Inspect** | (default) | Click a hex to open the inspector. Toggle terrain, in-hex features, and individual hexside features. |
| **Terrain paint** | `b` | Brush-assign base terrain. Click toggles off a hex already painted with the active ink. Drag paints a stroke (one undo entry per stroke). |
| **Hexside edges** | `e` | Paint shared edges. Click toggles the active feature. Drag sets on. **Shift** snaps the cursor to the nearest valid edge (cyan preview). **Alt+click** or **Alt+drag** erases only the active ink. **Alt+click** with no active ink strips every feature on that edge. A **stroke-opacity** slider fades line strength without affecting terrain fill. |
| **Point features** | `p` | Place typed markers (city, fort, objective, etc.) with optional numeric attributes. Click an existing marker to edit name and attrs. |
| **Grid nudge** | `n` | Drag the scan under the fixed grid, or use arrow keys for 1 px steps (Shift = 10 px). Offset persists in the project autosave. |

Middle-mouse drag pans in every mode. `v` cycles view: Map, Classification, Both. `?` opens the in-app help and shortcut table.

**The inspector** (opened in Inspect mode) docks to the right edge by default. Drag it by its
header to reposition (clamped inside the viewport); double-click the header to re-dock. `Esc`
closes it — if a text field inside has focus, the first `Esc` blurs the field instead of closing.

## Terrain display

`L` toggles terrain labels: each hex shows its palette `abbr` (a short code, e.g. `W` for woods)
below the terrain fill, or a derived initial when the palette omits `abbr`. Set `abbr: ""` on a
palette entry to suppress its label entirely (useful for a default "clear" terrain that doesn't
need marking). Labels fade with zoom and the toggle state persists across reloads.

A **terrain fill-opacity slider** controls how strongly terrain color shows over the base map —
useful for checking painted terrain against the underlying scan without switching to
Classification view.

**Composite terrain classes** split a hex's fill diagonally between two colors: give a palette
terrain entry `"colors": ["#colorA", "#colorB"]` instead of (or alongside) `"color"`, and the
renderer draws a two-color split fill. Handy for combined classes like woods+swamp or
woods+mountain without inventing a new solid color per combination.

## Grid schema

Hex codes use flat-top **even-q** addressing: `"0803"` = column 08, row 03.

### Version 1 (rectangular)

Legacy grids omit `grid_version` or set `grid_version: 1`. Every column has the same row count (`n_rows`, or derived from `image_full` and pitch).

Cell center in image pixels:

```
x = x_intercept_col0 + col * col_pitch_x
y = y_intercept_row0 + row * row_pitch_y + (col even ? even_col_down_offset : 0)
```

Flat-top circumradius: `col_pitch_x / 1.5`.

Required calibration fields (modern or legacy aliases): `x_model.x_intercept_col0`, `x_model.col_pitch_x`, `y_model.y_intercept_row0`, `y_model.row_pitch_y`, `y_model.even_col_down_offset`, plus `image_full: [width, height]`.

### Version 2 (jagged rows)

Set `grid_version: 2` when even and odd columns hold different row counts (common on maps whose printed columns stagger).

```
rowCount(col) = (col % 2 === 0) ? row_counts_by_parity.even : row_counts_by_parity.odd
isValidCell(col, row) = row >= 0 && row < rowCount(col)
```

Centers use `odd_col_y_offset` on odd columns instead of v1 even-column offset:

```
x = x_intercept_col0 + col * col_pitch_x
y = y_intercept_row0 + row * row_pitch_y + (col odd ? odd_col_y_offset : 0)
```

A v2 grid without `row_counts_by_parity` fails load with an explicit error (no silent truncation).

## Hexside layers and class-split export

Internally, hexsides are stored per canonical edge key (`"a|b"` with `a < b`) as an array of palette feature keys. An edge can carry several features (river plus road, primary plus secondary river, etc.).

**Export** regroups edges into named layers for back-compatibility: `{"rivers": [{a,b}, ...], "roads": [...], ...}`. Each feature's `exportLayer` in the palette names its bucket. Edges with multiple features appear in every relevant layer.

**Class-split layers** (for example `rivers-primary` / `rivers-secondary`) map through `hexsideAliases` to distinct palette keys. On load, grouped v1 bundles populate `loadedHexsides`; export merges edited internal state back without duplicating pairs. Dual-perspective keys (`a|b` and `b|a`) and non-canonical ordering are normalized on export.

**Kind** controls rendering: `edge` features draw along the shared side; `crossing` features draw a short rung across the midpoint (roads, rails, bridges).

## Project manifests

A manifest JSON lists paths relative to the served root (typically the parent of this repo):

```json
{
  "name": "My board",
  "map": "../my-game/assets/board.jpg",
  "imageFull": [5000, 3200],
  "hexgrid": "local/my-game/hexgrid.json",
  "terrain": "local/my-game/terrain.json",
  "hexsides": "local/my-game/hexsides.json",
  "features": "local/my-game/features.json",
  "palette": "local/palettes/my-game.json",
  "blankLattice": false,
  "traces": [
    { "name": "rivers", "img": "local/my-game/traces/rivers.png", "layer": "rivers" }
  ]
}
```

| Field | Role |
| --- | --- |
| `name` | Display name and autosave slot key |
| `map` | Board raster (downscaled web JPEG or path to full-res sibling repo) |
| `imageFull` | Full-resolution `[width, height]` for overlay export scaling |
| `hexgrid` | Grid calibration JSON |
| `terrain` | `{"terrain": {"CCRR": "key", ...}}` |
| `hexsides` | Grouped v1 bundle or v2 internal shape (loader migrates) |
| `features` | Point-feature document (see below) |
| `names` | Per-hex location names document: `{"names": {"CCRR": "Name", ...}}` |
| `palette` | Palette JSON (terrain, hexFeatures, hexsideFeatures, aliases) |
| `blankLattice` | When `true`, show every valid grid cell even if terrain is empty (hexside-only projects) |
| `traces` | Optional reference PNG overlays with opacity control |

### Location names

The inspector has a **Name** field per hex, independent of terrain and point features — for
labeling towns, garrisons, or any location the printed map names but doesn't otherwise mark.
Names render under the terrain abbreviation when the labels toggle (`L`) is on. Export/import via
the `names.json` document shape above (same shape as the manifest's `names` field); copy-to-
clipboard mirrors file export.

Boot directly:

```
http://localhost:8000/hexwright/?project=local/my-game/project.json
```

**Launcher pattern:** copy `Launch Hexwright.command`, serve from the parent directory, and open a fixed `?project=` URL. Keep per-game launchers and all of `local/` out of version control; the generic launcher opens the start screen (or a local default manifest if you add one).

## Palette schema

Palettes live in JSON. A neutral example ships at `palettes/default.json`.

```json
{
  "name": "Default",
  "terrain": [{ "key": "clear", "label": "Clear", "color": "#c8b88a" }],
  "hexFeatures": [{
    "key": "city",
    "label": "City",
    "glyph": "◎",
    "attrs": [{ "key": "vp", "label": "VP", "type": "number" }]
  }],
  "hexsideFeatures": [{
    "key": "river",
    "label": "River",
    "color": "#2878ff",
    "kind": "edge",
    "exportLayer": "rivers"
  }, {
    "key": "road",
    "label": "Road",
    "color": "#b96b1f",
    "kind": "crossing",
    "dash": true,
    "exportLayer": "roads"
  }],
  "terrainAliases": { "forest": "woods" },
  "hexsideAliases": { "rivers": "river", "impassible": "impassable" }
}
```

- **terrain**: base fill per hex; `color` drives Classification view and overlay export. `abbr` sets the short label shown by the terrain-labels toggle (`""` suppresses it); `colors: [a, b]` (instead of `color`) renders a two-color diagonal split fill for composite classes.
- **hexFeatures**: point markers; optional `attrs` define inspector fields (`type: "number"` today).
- **hexsideFeatures**: `kind` is `edge` or `crossing`; optional `dash`; `exportLayer` names the v1 export bucket.
- **Aliases**: map legacy import names to palette keys.

Hexwright loads `palettes/default.json` when a manifest omits `palette`. You can also load a palette file from the File menu.

## Exports and imports

**Export menu (canonical, deduped):**

| Output | Shape |
| --- | --- |
| `hexsides.json` | Grouped layers; each pair `{a,b}` with `a < b`, once per layer |
| `terrain.json` | `{"terrain": {"CCRR": key}}` |
| `features.json` | `{"_comment", "features": [{code, type, name?, attrs}]}` sorted by code |
| `names.json` | `{"names": {"CCRR": "Name", ...}}` |
| Classification PNG | Raster at `imageFull` resolution |
| TWU rivers / rail | Strict pair-array contracts for games that use that on-ramp |

**Import menu:**

| Input | Behavior |
| --- | --- |
| Raw `hexsides.json` / `terrain.json` | Replace current layer data |
| `names.json` | Merges into current names (operator entries win on conflict) |
| WMP draft | Classifier output with alias mapping; marks hexes `draft` until touched |
| TWU layer | Validates shape strictly; wrong files fail loud with no mutation |

Copy-to-clipboard actions use the same canonical objects as file export.

## Autosave, restore, and recents

Every edit debounces to `localStorage` (~1 s) keyed by project name slug. On the next visit, a restore prompt appears when a slot is newer than the manifest load. Recents on the start screen list recently opened manifests. A normal refresh reloads editor code but preserves autosaved project state.

**Manifest features and names merge UNDER autosave, operator wins.** When a manifest declares
point features or location names (for example, generated route/paint-guide markers) and a
restored autosave slot also has features or names, the two are merged rather than one replacing
the other: manifest entries fill in first, then autosave entries are layered on top and win any
conflict. This lets generated markers (re-)appear on a fresh manifest load while an operator's
own placements and renames from a prior editing session are never clobbered by Restore.

## Verify suite

```
npm test
```

Runs headless Playwright checks under `verify/`: smoke load, functional store/renderer API, UI interactions, edge and terrain paint, shift-snap, TWU import/export round-trip, blank lattice, class-layer load, hexsides export dedup, v2 terrain fill, autosave slots, per-layer clear, and point features.

Checks that need operator data under `local/` print `SKIP local game data not present (...)` and exit 0 when those files are absent, so a fresh public clone passes `npm test`. With `local/` populated, the full suite runs unchanged.

Run individual checks:

```
node verify/smoke.mjs
node verify/features-check.mjs
node verify/twu-check.mjs
```

See `verify/README.md` for the full list.

## License

MIT. See [LICENSE](LICENSE).
