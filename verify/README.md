# verify/

Headless Playwright checks. Most browser harnesses boot a project via `?project=local/samples/gota/gota-project.json` when that gitignored path exists; blank-project flows use the start screen instead.

Checks that depend on `local/` print `SKIP local game data not present (...)` and exit 0 on a fresh clone.

```
npm i playwright && npx playwright install chromium
npm test
```

Or run individual scripts:

```
node verify/smoke.mjs
node verify/func-check.mjs
node verify/ui-check.mjs
node verify/help-check.mjs
node verify/wmp-check.mjs
node verify/autosave-check.mjs
node verify/edge-paint-check.mjs
node verify/terrain-paint-check.mjs
node verify/shift-snap-check.mjs
node verify/twu-check.mjs
node verify/blank-lattice-check.mjs
node verify/class-layer-load-check.mjs
node verify/hexsides-export-check.mjs
node verify/v2-terrain-fill-check.mjs
node verify/gota-terrain-render-check.mjs
node verify/clear-layer-check.mjs
node verify/features-check.mjs
```
