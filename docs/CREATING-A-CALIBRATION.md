# Creating your own calibration

The bundled demo (`demo/`) is a working template for every file Hexwright
consumes. This page walks the same path with **your own scan**: build a
`hexgrid.json` that places a hex lattice over your board image, wrap it in a
project manifest, and open it with `?project=`.

## 1. Measure the grid on your scan

Open your board raster in any image viewer that shows pixel coordinates and
take four measurements (flat-top hexes, **even-q** addressing — column first,
`"0803"` = column 08, row 03):

| Field | What to measure |
| --- | --- |
| `x_intercept_col0` | x (px) of the **center** of the top-left hex (column 0) |
| `y_intercept_row0` | y (px) of that same hex center |
| `col_pitch_x` | x-distance between two adjacent column centers |
| `row_pitch_y` | y-distance between two vertically adjacent hex centers in one column |
| `even_col_y_offset` | how far even columns sit **below** odd ones — usually `row_pitch_y / 2` (negative if your even columns sit higher) |

Then count `n_cols` / `n_rows` and note the raster's full size as
`image_full: [width, height]`.

## 2. Write hexgrid.json

The demo's grid, as a shape reference (`demo/hexgrid.json`):

```json
{
  "grid_version": 1,
  "image_full": [1330, 1180],
  "n_cols": 12,
  "n_rows": 9,
  "x_intercept_col0": 100,
  "col_pitch_x": 100,
  "y_intercept_row0": 100,
  "row_pitch_y": 115,
  "even_col_y_offset": 57.5
}
```

If your printed map staggers — even and odd columns hold **different row
counts** — use `grid_version: 2` with `row_counts_by_parity: {"even": N, "odd": M}`
and `odd_col_y_offset` instead. Full schema (v1 + v2, plus legacy aliases) is
in the README under **Grid schema**.

Expect to iterate: load, look, adjust the numbers, reload. The measurements
from step 1 usually land within a hex on the first try, and step 5 below
tells you which number is wrong from how the drift looks.

## 3. Wrap it in a project manifest

```json
{
  "name": "My board",
  "map": "local/my-game/board.jpg",
  "imageFull": [5000, 3200],
  "hexgrid": "local/my-game/hexgrid.json",
  "palette": "palettes/default.json"
}
```

Paths resolve relative to the page URL. Keep private game data under
`local/` (gitignored). `terrain` / `hexsides` / `features` / `names` entries
are all optional — start with just `map` + `hexgrid` and paint from scratch.
No scan at all? Set `"blankLattice": true` and omit `map` (that's how the
demo works).

## 4. Open it

```
python3 -m http.server 8000
# open http://localhost:8000/?project=local/my-game/project.json
```

To reach full-resolution rasters in **sibling** repos (`../my-game/...`
paths), serve from the parent directory instead and open
`http://localhost:8000/hexwright/?project=...` — that's what
`Launch Hexwright.command` does on macOS. For a board you return to often,
copy that launcher and hard-code your `?project=` URL (keep per-game
launchers out of version control, per the README's launcher pattern).

## 5. Sanity-check the fit

Turn on Grid nudge (`n`) and drag the scan until hex centers sit under the
printed hexes; the offset persists in autosave. If rows drift as you move
right, your `col_pitch_x` is off; if columns drift as you move down, fix
`row_pitch_y`. A wrong `even_col_y_offset` sign shows up immediately as
every other column sitting a half-hex wrong.
