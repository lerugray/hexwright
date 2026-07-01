# Hexwright

An engine-agnostic hex-map terrain/feature editor. Zero build, vanilla JavaScript + Canvas2D.
Load a scanned or rendered hex map, assign each hex's terrain, its in-hex features, and its
multi-feature hexsides by hand, and export the canonical `hexgrid` / `terrain` / `hexsides`
JSON your game reads. Reusable across any flat-top even-q hex project.

## What it is

Open a map, see its hex grid, click a hex. Set the hex's base terrain, toggle in-hex features
(city, town, fort, port, objective...), and set what each of its six edges carries. Hexsides hold
several features at once, so a single edge can be both a river and a road. Edges are shared, so
assigning one also assigns it for the neighbor. Export the result as the JSON files your engine loads.

It is the deliberate, human-in-the-loop alternative to auto-detecting this from a scan. You already
know where the rivers and ridges go; Hexwright lets you say so quickly, and check your work at a glance.

## Why

Auto-snapping hand-traced features to hexsides is brittle: a meandering printed river sits well off
the clean geometric edges, so proximity matching fails. A human-in-the-loop editor is what real
wargame studios use. It is deterministic, correct, and reusable, and it doubles as the correction
surface for any project whose auto-digitized terrain needs fixing. When a classifier can produce a
rough first pass (see the WMP pipeline below), Hexwright imports it as an editable draft you refine.

## Quick start

Zero build. From the repo root:

```
npm run serve          # or: python3 -m http.server 8000
# open http://localhost:8000  ->  "Load GotA sample"
```

The sample loader needs the local server for `fetch`; the file pickers work either way.

## Features

- **Base terrain** per hex, from a configurable palette.
- **In-hex features** (city, town, fort, port, airfield, objective, resource...), multiple per hex.
- **Multi-feature hexsides**: each of the six edges can carry several features at once (e.g. a stream
  and a road on the same edge), drawn as parallel offset lines.
- **View modes**: *Map* (scan + reference traces), *Classification* (data only, no photo), *Both*.
- **Overlay export**: render the current classification to a PNG at the source-map resolution, so you
  can drop it beside the scan and spot mistakes.
- **Anomaly check**: highlight unclassified hexes, orphan hexsides, and unconfirmed *draft* hexes, with
  live counts.
- **Configurable palette**: terrain, in-hex features, hexside features, and their colors live in a JSON
  config, so any game supplies its own vocabulary. The bundled default is GotA's (`palettes/gota.json`).
- **WMP draft import**: ingest a wargame-map-parser terrain classification as a low-confidence draft to
  refine (see below).
- **Reference trace overlays** with opacity control, brush drag-assign, keyboard shortcuts
  (`1`-`0` terrain, `b` brush, `v` view mode, `Esc` close), undo/redo, and a palette-driven legend.
- **Session autosave**: your work (data + grid) persists to `localStorage` on every change and restores
  on the next visit, so an accidental reload never loses hand-assignment work.

## Data model

A project is flat-top even-q, addressed by CCRR hex codes (`"0803"` = column 08, row 03).

- **`hexgrid`** — grid calibration (the hex-to-pixel formula + image dimensions).
- **`terrain`** — `{"terrain": {"CCRR": terrainKey}}`; one base terrain per hex.
- **`hexsides`** (exported) — grouped by layer for back-compatibility:
  `{"rivers":[{a,b}], "roads":[...], "mountains":[...], ...}`, each shared edge stored once with `a<b`.
  An edge carrying several features appears in each of its layers. Untouched layers such as `theaters`
  and `boundaries` are preserved verbatim through a load/export round-trip.
- **`hexFeatures`** — `{"CCRR": ["city", ...]}` in-hex point features.

Internally hexsides are per-edge feature arrays; the grouped shape is the export contract.

## Make it your own game

Terrain, in-hex features, hexside features, and colors are defined by a palette config. Copy
`palettes/gota.json`, change the vocabulary and colors, and load it with the **Palette** button.
`terrainAliases` / `hexsideAliases` normalize inbound names (e.g. `forest` -> `woods`), and each
hexside feature's `exportLayer` sets the grouped-export key.

## WMP pipeline (auto-guess, then refine)

[wargame-map-parser](https://github.com/lerugray/wargame-map-parser) can classify hex-fill terrain
from a scan. Its output already uses the same CCRR addressing:

```
python -m parser.export_hexwright wmp-terrain.json -o gota-terrain.hexwright.json
```

In Hexwright, **Import WMP draft** loads that file, marks every imported hex as an unconfirmed *draft*
(visible in the Anomaly overlay), and you refine + confirm from there. The full loop:
scan -> WMP rough classify -> Hexwright hand-refine -> canonical export.

## Testing

```
npm test               # headless Playwright smoke over load / assign / export / round-trip
```

## License

MIT. See [LICENSE](LICENSE).
