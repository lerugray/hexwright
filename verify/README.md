# verify/

Headless Playwright checks. Boot GotA via `?project=samples/gota-project.json` (or the start screen for blank-project flows). Run:
```
npm i playwright && npx playwright install chromium
node verify/smoke.mjs
node verify/func-check.mjs
node verify/edge-paint-check.mjs
node verify/wmp-check.mjs
node verify/twu-check.mjs
node verify/ui-check.mjs
node verify/help-check.mjs
node verify/autosave-check.mjs
node verify/blank-lattice-check.mjs
```
