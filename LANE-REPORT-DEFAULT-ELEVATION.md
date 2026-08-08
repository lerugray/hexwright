# Lane report: per-map default elevation

## What changed

- Added optional manifest field `defaultElevation`. Integer values 1–9 enable it; absent, `0`, or invalid values preserve the previous painted-only derivation behavior.
- Stored the normalized value in project state and in autosave/project exports.
- Added `getEffectiveElevation()`: a painted value wins, otherwise the map default applies.
- Updated slope/escarpment derivation to enumerate every valid in-grid cell when a default is enabled. Adjacent effective levels derive a slope at delta 1 and an escarpment at delta 2 or greater.
- Kept raw `elevation.json` data painted-only, and added a top-level `defaultElevation` header when enabled.
- Kept derived `hexsides.json` slope/escarpment arrays regenerated from effective elevations.
- Made the current manifest's normalized default win during session restore, including when restoring an older snapshot that lacks the field.
- Enabled `"defaultElevation": 1` only for TWAR Crimea, Danube, and Sevastopol.
- Documented the manifest and export shapes.

## Terrain and renderer choice

The default applies to every in-grid hex regardless of terrain, including water and coast. A painted elevation still overrides the default. The focused regression explicitly uses adjacent sea/coast hexes.

The renderer was deliberately left unchanged. Its elevation overlay still iterates only `state.elevation`, so defaulted unpainted hexes receive neither a numeral nor hypsometric tint. The slope overlay changes naturally because it consumes the updated derived edges.

## Files

- `src/store.js`
- `src/app.js`
- `verify/default-elevation-check.mjs`
- `verify/resume-grid-divergence-check.mjs`
- `package.json`
- `README.md`
- `local/twar-crimea/project.json`
- `local/twar-danube/project.json`
- `local/twar-sevastopol/project.json`
- `LANE-REPORT-DEFAULT-ELEVATION.md`

The `local/` directory is gitignored in this checkout, but the three requested manifest files were edited in place. A scan of every `local/*/project.json` confirmed that no other map manifest contains the new field.

## Tests

- Before: 29 configured test scripts, 490 explicit `rec(...)` assertions.
- After: 30 configured test scripts, 504 explicit assertions.
- Focused default-elevation regression: 12/12 passed.
- Syntax checks: every `src/*.js` and `verify/*.mjs` file passed `node --check`.
- JSON checks: `package.json` and all three edited manifests parse successfully.
- `git diff --check`: passed.

Both the baseline and after-change `npm test` attempts were blocked by this managed macOS sandbox when Playwright tried to launch Chromium. In the after-change run, the new 12/12 regression and the existing 5/5 pre-browser checks passed first; Chromium then aborted before browser assertions with Mach port registration `Permission denied (1100)`. The full browser suite therefore needs to be rerun by the orchestrator or another unsandboxed runner.

## Deliberately skipped

- No renderer implementation changes, so the painted-only elevation overlay contract stays intact.
- No terrain, feature, hand-painted hexside, or point-to-point behavior changes.
- No other map manifests were touched.
- No dependencies were added.
- No commit or push was performed.
