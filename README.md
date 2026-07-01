<div align="center">

# Hexwright

**An engine-agnostic hex-map terrain/feature editor. Zero build, vanilla JavaScript + Canvas2D.**

Load a hex map, assign each hex's terrain, its in-hex features, and its multi-feature hexsides by hand,
and export the canonical `hexgrid` / `terrain` / `hexsides` JSON your game reads.

![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![Zero build](https://img.shields.io/badge/build-none-brightgreen)
![Dependencies: none](https://img.shields.io/badge/runtime%20deps-0-brightgreen)
![Vanilla JS](https://img.shields.io/badge/vanilla-JS%20%2B%20Canvas2D-f7df1e)

![Hexwright editing a hex map](docs/screenshot-both.png)

</div>

## Contents

- [What it is](#what-it-is)
- [Why](#why)
- [Quick start](#quick-start)
- [Features](#features)
- [Data model](#data-model)
- [Make it your own game](#make-it-your-own-game)
- [WMP pipeline](#wmp-pipeline-auto-guess-then-refine)
- [Testing](#testing)
- [License](#license)

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
rough first pass (see the [WMP pipeline](#wmp-pipeline-auto-guess-then-refine)), Hexwright imports it
as an editable draft you refine.

## Quick start

Zero build, no runtime dependencies. From the repo root:

```
npm run serve          # or: python3 -m http.server 8000
# open http://localhost:8000  ->  "Load GotA sample"
```

The sample loader needs the local server for `fetch`; the file pickers work either way.

## Features

- **Base terrain** per hex, from a configurable palette.
- **In-hex features** (city, town, fort, port, airfield, objective, resource...), multiple per hex.
- **Multi-feature hexsides** — each edge can carry several features at once (a stream *and* a road).
  They render distinctly: **edge features** (river, ridge, cliff) run as lines *along* the edge, while
  **crossings** (road, rail, bridge) draw as short rungs *across* the edge midpoint, so a road that
  crosses a river reads at a glance. The inspector groups the two kinds accordingly.
- **View modes** — *Map* (scan + reference traces), *Classification* (data only, no photo), *Both*.
- **Overlay export** — render the current classification to a PNG at the source-map resolution, so you
  can drop it beside the scan and spot mistakes.
- **Anomaly check** — highlight unclassified hexes, orphan hexsides, and unconfirmed *draft* hexes.
- **Configurable palette** — terrain, features, hexside features, kinds, and colors live in a JSON
  config; any game supplies its own vocabulary. The bundled default is GotA's (`palettes/gota.json`).
- **WMP draft import** — ingest a wargame-map-parser classification as a low-confidence draft to refine.
- **Reference trace overlays** with opacity control, brush drag-assign, keyboard shortcuts
  (`1`-`0` terrain, `b` brush, `v` view mode, `Esc` close), undo/redo, and a palette-driven legend.
- **Session autosave** — your work persists to `localStorage` on every change and restores on the next
  visit, so an accidental reload never loses hand-assignment work.

## Data model

A project is flat-top even-q, addressed by CCRR hex codes (`"0803"` = column 08, row 03).

- **`hexgrid`** — grid calibration (the hex-to-pixel formula + image dimensions).
- **`terrain`** — `{"terrain": {"CCRR": terrainKey}}`; one base terrain per hex.
- **`hexsides`** (exported) — grouped by layer for back-compatibility:
  `{"rivers":[{a,b}], "roads":[...], "mountains":[...], ...}`, each shared edge stored once with `a<b`.
  An edge carrying several features appears in each of its layers. Untouched layers such as `theaters`
  and `boundaries` survive a load/export round-trip verbatim.
- **`hexFeatures`** — `{"CCRR": ["city", ...]}` in-hex point features.

Internally hexsides are per-edge feature arrays; the grouped shape is the export contract.

## Make it your own game

Terrain, in-hex features, hexside features, and colors are defined by a palette config. Copy
`palettes/gota.json`, change the vocabulary and colors, and load it with the **Palette** button.
Each hexside feature has a `kind` (`edge` or `crossing`) that drives how it draws, an `exportLayer`
that sets its grouped-export key, and `terrainAliases` / `hexsideAliases` normalize inbound names
(e.g. `forest` -> `woods`).

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
npm test               # headless Playwright suites: load / assign / export / round-trip / UI / autosave
```

## License

[MIT](LICENSE) © Ray Weiss
