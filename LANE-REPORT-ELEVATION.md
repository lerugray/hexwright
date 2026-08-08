# Lane Report: Elevation + Auto-Derived Slopes

## What was built

Per-hex integer elevation (1–9) plus automatically derived slope/escarpment hexsides.

## Design decisions

- **Storage model**: elevation is stored as a flat `state.elevation: { CCRR: level }`. Levels are clamped to 0–9 on write; only 1–9 are persisted/exported. `0`/missing means "no elevation data".
- **Slopes are derived, not painted**: `ProjectStore.deriveSlopes()` walks every painted hex and its six neighbors. When both sides have data and `|delta| >= 1`, the shared edge gets a classification:
  - `delta == 1` → `slope`
  - `delta >= 2` → `escarpment`
- **Direction is explicit**: each derived entry records `higher` and `lower` hex codes so consumers know which side is uphill.
- **No stale duplicates**: slopes are recomputed on every render/export/edit. They are not stored in `state.hexsides` and never exported as hand-editable layers.
- **Render contract**: the elevation overlay shows a cased numeral and a subtle translucent hypsometric tint per painted hex. Slopes render as downhill tick marks on the **lower** side (classic hachure). Escarpments use a heavier stroke and longer ticks than slopes.
- **Toggles**: both overlays are view-only, default off, with eye buttons in the Layers panel. Visibility persists in the same view-settings localStorage key as terrain fill/labels.

## Files changed

- `src/store.js` — elevation read/write/import/export, undo/redo snapshots, `deriveSlopes()`.
- `src/renderer.js` — `_drawElevationOverlay()` and `_drawSlopes()`.
- `src/ui.js` — elevation mode wiring (brush card, rail, inspector, keys `h`/`1`–`0`, layer eyes, view-settings persistence).
- `src/app.js` — `importElevation` handler.
- `src/style.css` — elevation chip grid styles.
- `index.html` — elevation tool, import/export menu items, layer rows, inspector section.
- `package.json` — added `verify/elevation-check.mjs` to `npm test`.
- `verify/elevation-check.mjs` — new headless check for derivation, recompute, export shape, brush/inspector rendering, screenshot.
- `verify/ptp-check.mjs`, `verify/attrs-check.mjs` — moved p2p click targets left so they are not hidden under the now-taller Layers panel.
- `README.md` — documented elevation mode, derivation, export schema.

## Export schema samples

`elevation.json`:

```json
{
  "_comment": "edited in Hexwright v2.1 2026-08-08",
  "elevation": {
    "1000": 3,
    "1001": 1,
    "1101": 2,
    "0901": 1
  }
}
```

`hexsides.json` (excerpt; `slopes`/`escarpments` added alongside grouped layers):

```json
{
  "_comment": "edited in Hexwright v2.1 2026-08-08",
  "version": 2,
  "river_count": 0,
  ...
  "slopes": [
    { "a": "1000", "b": "1101", "higher": "1000" }
  ],
  "escarpments": [
    { "a": "1000", "b": "1001", "higher": "1000" }
  ]
}
```

## Verification

- `npm test` passes with the full suite green.
- Synthetic screenshot captured by `verify/elevation-check.mjs`:
  - `verify/elevation-overlay-demo.png` — elevation numerals + hypsometric tint + downhill slope ticks visible on the demo map.

## Regression/fix notes

Adding the Elevation section to the Layers panel increased its height enough that the rightmost p2p fixture node (`gamma`) in `verify/ptp-check.mjs` and `verify/attrs-check.mjs` fell under the panel and stopped receiving canvas clicks. Fixed by selecting click targets on the left side of the viewport (`alpha`/`delta`) where the panel does not overlap.

## Assumptions / known limits

- Elevation is hex-only; it is disabled (tool hidden, derivation skipped) for point-to-point projects.
- The derivation uses raw integer deltas; it does not model gradual slopes across multiple hexes.
- Escarpment threshold is `delta >= 2`; the consuming game decides whether that blocks LOS, adds movement cost, etc.
- Slope/escarpment arrays in `hexsides.json` are regenerated on export, so importing an older `hexsides.json` that lacks them is fine — they will appear on the next export once elevation data exists.
