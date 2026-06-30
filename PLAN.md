# Hexwright — plan & build spec

A standalone, engine-agnostic **web editor for assigning hex + hexside terrain/features**
on hex-wargame maps, exporting the canonical JSON the hex projects already share
(`hexgrid.json` + `terrain.json` + `hexsides.json`). Human-in-the-loop replacement for
brittle CV trace-snapping; reusable across GotA, TWU, twar-pc, GTA, kreuzfeuer, etc.

## Why this exists
Hexside terrain (rivers / ridges / impassible / roads / rails) is **deterministic when a
human assigns it, brittle when inferred** — 4 CV-snap attempts on GotA failed (the operator
traces along the meandering printed course, which sits 25–50px off the clean hexsides). Real
wargame studios use a map editor. The operator already knows where every feature goes (he
traced them). Hexwright is also the **correction surface** for any project whose auto-digitized
terrain is off (e.g. TWU's terrain re-verification).

## Data model (canonical — match the existing files)
- **Grid:** read from `hexgrid.json`. Flat-top, even-q. The file carries the formula + dims:
  `col=int(CCRR[:2]); row=int(CCRR[2:]); x = x_intercept_col0 + col*col_pitch_x;
  y = y_intercept_row0 + row*row_pitch_y + (col%2==0 ? even_col_down_offset : 0)` in
  FULL-image pixels. `image_full = [W,H]`. Don't hardcode GotA's numbers — read them from the file.
- **Hexes:** the keys of `terrain.json` (`{"terrain":{"CCRR": type, ...}}`) are the land/playable
  hexes. Each has a hex-fill terrain type.
- **Hexsides:** the shared edge between two adjacent hexes, stored ONCE as `{"a":"CCRR","b":"CCRR"}`
  with `a<b`, grouped by layer at the top level of `hexsides.json`:
  `{ "mountains":[{a,b}...], "rivers":[...], "impassible":[...], "roads":[...], "rails":[...],
  ...preserve any other layers like "theaters"/"boundaries" untouched... }`.
  (GotA's `hexsides.draft.json` uses exactly this shape: `mountains`/`theaters`/`boundaries`.)
  A hex has up to 6 hexside features.
- **Adjacency:** two hexes are neighbors iff their centers are < 160px apart (full-res) — robust,
  matches the existing parser toolkit. (Equivalent to the 6 even-q flat-top neighbors.)

## Coordinates / display
- All grid coords are FULL-RES pixels.
- Display uses a downscaled map (`samples/gota-map.jpg`, 3000px wide). `scale = displayMap.naturalWidth
  / image_full[0]`. Render world*scale, plus a user pan (drag) + zoom (wheel) transform.

## Features (v1 — ALL required; do not stub any)
1. **Load a project** — file pickers for map image + `hexgrid.json` + `terrain.json` (+ optional
   existing `hexsides.json`), OR one-click **"Load GotA sample"** (reads `samples/gota-project.json`).
2. **Canvas workspace** — render the base map; overlay the hex grid for land hexes only (from
   terrain.json keys), flat-top hexagons at calibrated positions; pan (drag) + zoom (wheel); fit-to-view.
3. **Hex fill** — each land hex tinted by terrain type (legend colors, semi-transparent so the map
   shows through); a hex-terrain dropdown in the inspector to change it.
4. **Hex inspector (THE signature element)** — click a hex → a floating panel anchored near it with an
   **enlarged hexagon illustration whose 6 edges are individually selectable**; each edge has a dropdown
   (none / river / ridge(mountain) / impassible / road / rail); plus the hex's terrain-type dropdown.
   Hovering/selecting an edge **highlights both that edge and the adjacent hex it co-assigns** on the
   map. Assigning writes the shared `{a,b}` into the chosen layer ONCE (both hexes read it). Show the
   neighbor's CCRR for each edge so it's unambiguous.
5. **Hexside rendering** — assigned hexsides drawn on the map in type-distinct colors, thick enough to
   read: river `#2878ff`, ridge/mountain `#be8228`, impassible `#dc2828`, road `#c9a06a`,
   rail `#8a8f98` (dashed).
6. **Trace underlay** — load the downscaled colored trace overlays (`samples/traces-display/*.png`) as
   toggleable semi-transparent layers aligned to the map, so the operator clicks hexsides along their own
   traced lines. Per-layer toggle + opacity.
7. **Import / Export** — export `hexsides.json` (the grouped-by-layer schema above; **preserve any layers
   not edited**, e.g. theaters/boundaries) + export edited `terrain.json`. Import existing to keep editing.
   Download as files AND copy-to-clipboard.
8. **Quality floor** — undo (at least last N actions), Esc closes the inspector, a legend, live counts
   (land hexes; assigned hexsides per layer), keyboard-focusable controls, reduced-motion respected.

## Aesthetic (frontend-design — an instrument, not a brochure)
Function-first: the **map is the hero**, chrome recedes. Charcoal desk surround (~`#15171a`), map
bright in focus. **Mono utility face** for coordinates/counts (true to grid data) + a clean grotesque
for UI labels. Accent = surveyor orange (`#ff7a1a`) for the active selection. The hexside-type colors
(above) are the palette. The **hex-inspector hexagon is the one bold element** — keep everything else
quiet and disciplined. NO Claude Design / DesignSync push (operator-internal tool; no approval gate).

## Stack
Single-page, **zero build**: `index.html` + `src/app.js` (+ split modules if cleaner) + `src/style.css`.
Vanilla JS + Canvas2D, no framework, no bundler — opens in a browser or via a tiny static server
(`python3 -m http.server`). Engine-agnostic + trivially runnable on any of Ray's machines.

## Verification gate (features ship on behavior, not decoration)
NOT done until, in a real browser: Load GotA sample → grid renders ALIGNED on the map → click a hex →
inspector opens → assign a river hexside → it renders on the map AND co-highlights the adjacent hex →
Export → the produced `hexsides.json` parses and matches the canonical schema (and preserves
theaters/boundaries). Verified via headless browser screenshot + scripted interaction, not "code exists."

## Build approach
Delegated to an off-Anthropic coder lane (cursor-agent), spec = this doc. Claude (Opus) orchestrates +
verifies end-to-end before declaring done. Don't shortcut to prove-it's-possible — ship the working tool.

## Roadmap (post-v1)
Cities / ports / objectives markers; per-edge road+rail simultaneously with terrain; multi-project
manifests; and use as the TWU terrain-correction surface.
