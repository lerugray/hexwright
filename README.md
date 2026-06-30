# Hexwright

> Private. A hex-wargame map editor — assign hex + hexside terrain/features by hand and export
> the canonical JSON Ray's hex projects share. Engine-agnostic; reusable across GotA, TWU,
> twar-pc, GTA, kreuzfeuer, and any future hex project.

## In plain English

Open a map, see its hex grid, click a hex, and set what each of its six edges is (river, ridge,
impassible, road, rail) and what the hex itself is (terrain) — from simple dropdowns. Edges are
shared, so setting one also sets it for the neighbor. Export the result as the JSON files the games
read. It's the deliberate, correct alternative to trying to auto-detect this from a scanned map —
you already know where the rivers and ridges go; this just lets you say so, fast.

## Why it exists

Auto-snapping hand-traced features to hexsides is brittle (a meandering printed river sits well off
the clean geometric edges). A human-in-the-loop editor is what real wargame studios use: deterministic,
correct, and reusable. It also doubles as the correction surface for any project whose auto-digitized
terrain needs fixing.

## Run it

Zero build. From the repo root:

```
python3 -m http.server 8000
# open http://localhost:8000  → "Load GotA sample"
```

Or open `index.html` directly (the sample loader needs the server for `fetch`; file pickers work either way).

## Data format

- `hexgrid.json` — grid calibration (flat-top even-q; formula + image dims inside the file).
- `terrain.json` — `{"terrain": {"CCRR": type}}`; keys are the land/playable hexes.
- `hexsides.json` — `{ "rivers":[{a,b}], "mountains":[...], "impassible":[...], "roads":[...], "rails":[...] }`
  (each edge stored once, `a<b`; other layers like `theaters`/`boundaries` are preserved untouched).

See `PLAN.md` for the full spec.
