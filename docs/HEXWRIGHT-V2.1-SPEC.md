# Hexwright v2.1 — Assignment-Session Pass (2026-07-01)

Status: approved direction (Ray, 2026-07-01: "make your own additions/changes to it
based on what it's supposed to be, and cover my other games other than GotA").
Implementation delegated off-cap; Fable orchestrates + verifies.

v2 review verdict this pass is built on: v2 is solid — 40/40 suites re-run green,
config-driven palette works, geometry natively matches the TWU/GotA flat-top even-q
CCRR convention (geometry.js already reads both grid field spellings). The gaps are
workflow speed for a human hexside-assignment marathon, and a second-game on-ramp.

Guiding constraints (unchanged from v2): zero-build vanilla JS + Canvas2D,
engine-agnostic, no framework, keep the module split, nothing marked done without
the verification gate.

---

## 1. Edge-paint mode (the headline)

Assigning hexsides today requires opening the inspector per hex and ticking
checkboxes — untenable for hundreds of river/ridge edges. Add direct on-canvas
edge painting:

- Toolbar toggle **"Edge paint"** (+ keyboard `e`). When active, a **hexside feature
  picker** (chips from `palette.hexsideFeatures`) selects the active feature.
- **Pointer routing (load-bearing — audited):** while edge-paint mode is active it
  takes POINTER PRIORITY: pointer events route to edge painting BEFORE the pan
  handler and BEFORE hex-select/inspector (today `_bindPointer` pans on drag and
  `_clickAt` → `hexAtScreen` → inspector would swallow these). Exiting the mode
  restores current behavior exactly.
- Semantics: **click = toggle** the active feature on the hit edge. **Drag = SET**
  (paint) the feature on every edge whose midpoint the pointer passes near —
  idempotent within a stroke, never toggles. **Alt-click / alt-drag = erase.**
  (No right-click binding — the existing handler early-returns on `e.button !== 0`;
  keep it that way.)
- Hit-testing: geometry.js gains `nearestEdge(px, py)` → normalized `a|b` edgeKey or
  null, tolerance ~0.35 × hex radius in screen space (zoom-aware). **O(1), not a
  full-board scan:** resolve the hex under the cursor via the existing
  `hexAtScreen`, then test only that hex's 6 edge midpoints (plus the neighbor
  hex's edges when the cursor sits near a vertex) — a 4k+-hex board must not jank
  on mousemove. Edges to nonexistent neighbors are not paintable.
- **Batch undo API:** store gains `beginStroke()` / `endStroke()` so one drag =
  ONE undo entry (today `toggleHexsideFeature` pushes undo per edge). Inspector
  single-edge edits keep per-edit undo.
- Visual affordance: hover highlights the candidate edge; painted strokes render
  immediately; the active feature chip is visibly selected.
- Inspector flow unchanged (both paths coexist). Provenance: edge-painting does NOT
  change hex terrain provenance.

## 2. Per-project session autosave (ships SECOND — protects the marathon)

Autosave currently uses a single localStorage key — switching GotA ↔ TWU
mid-session clobbers the other game's unsaved work. Change to per-project slots:

- Key = `hexwright.session.<slug(project name)>` (project name from the loaded
  manifest / project object; fallback slug `untitled`).
- Restore prompt offers the slot matching the project being loaded (and the legacy
  single-key session migrates into its project's slot once, then the legacy key is
  removed). Boot-time restore (no project loaded yet) offers the most recent slot.
- Cap slots at a sane count (keep newest ~6 by savedAt timestamp) to respect
  localStorage limits.
- **The autosave-check.mjs update ships IN THIS SAME CHUNK** — the existing suite
  asserts single-key reload semantics and would go red between chunks otherwise.

## 3. TWU on-ramp (second game, concrete)

TWU (twu-deluxe-digital) is the same grid family (flat-top, even-q, CCRR,
pixel-center calibration — its data/hexgrid.json loads in geometry.js as-is).
Its engine ALREADY consumes per-layer files; its rivers data is LOW-confidence
auto-digitization needing manual verify, and its rail data is EMPTY. Hexwright is
the tool for both. Ship:

- **Scope: rivers + rail ONLY.** Fortresses are deliberately CUT from the on-ramp:
  TWU's `loadFortresses()` requires `{hex, sp, name}` entries (skips anything
  without a finite `sp`), Hexwright's `hexFeatures` is a bare `string[]` with no
  payload slot, and the fortress data is already extracted at 0.97–0.99 confidence
  and cross-validated — there is nothing to edit. Do not import or export
  fortresses; do not add a fortress feature to the TWU palette.
- **`palettes/twu.json`** — terrain vocab can start as the GotA set (TWU terrain is
  already digitized separately; terrain editing is not the TWU use case); hexside
  features: `river` (edge, exportLayer `rivers`), `rail` (crossing, dash,
  exportLayer `rails`).
- **Import TWU layers** (toolbar, next to Import-WMP-draft): file picker, one file
  per pick (rivers and rail are two picks — that's fine), each import ONE undo
  step, hexes touched get provenance `draft`:
  - `rivers.json`: `{ hexsides: [["3924","4025"], ...] }` → river on each pair.
  - `rail.json`: `{ links: [...] }` → rail crossing on each link pair (tolerate
    pair-arrays and `{a,b}` objects).
  - **Detection with validation, not bare key-sniffing:** `hexsides` present AND
    an array of 2-element pairs → rivers; `links` present AND pair-shaped → rail;
    anything else → explicit error toast naming the expected shapes (a mis-picked
    file must fail loudly, not import garbage). Ignore `_comment`/metadata keys.
- **Export TWU layers**: a separate exporter — do NOT reuse or modify the existing
  grouped `exportHexsidesObject()` path (its `{a,b}`-object shape is the
  GotA/Hexwright contract; TWU's is different). Produces two downloads:
  - `rivers.json`: `{ "_comment": "edited in Hexwright v2.1 <date>", "hexsides":
    [["a","b"], ...] }` — bare sorted pairs.
  - `rail.json`: same header plus `{ "links": [["a","b"], ...], "hexes": [...] }`
    where `hexes` = sorted union of all link endpoints (TWU's `loadRail()` ingests
    both; a standalone-hex concept isn't editable here, endpoints-union is the
    correct derivation for hand-assigned nets).
- **`samples/twu-project.json`** manifest TEMPLATE + README recipe: clone
  twu-deluxe-digital as a SIBLING checkout and serve from the parent directory
  (`python3 -m http.server` one level up) so `../twu-deluxe-digital/...` paths
  resolve — the board scan is commercial-game material and must NOT be vendored
  into this public repo. Use the board image whose pixel dimensions match the
  grid's `image_web` (verify at load; today that is [3165, 2125]).
- **NO coordinate scaling in the loader.** The renderer already maps hex centers
  through `grid.image_full` (`baseScale = naturalWidth / imageFull[0]`), and both
  project-load paths prefer `grid.image_full` over the loaded image's dimensions.
  Loading the web-resolution board against full-resolution calibration works
  as-is. The one thing to VERIFY (and fix only if broken): the standalone
  "load map" file-picker path must also preserve `grid.image_full` rather than
  overwrite it with the swapped image's natural size.

## 4. Docs

- README: "Bring your own game" section (grid JSON contract, palette contract,
  manifest fields, the TWU import/export pipeline as the worked example #2).
- README: edge-paint mode usage + shortcuts table update.

## 5. Verification gate (no "done" without this)

Extend the suites (keep all 40 existing checks green):
1. **edge-paint-check.mjs**: PIN the viewport (fixed window size + explicit
   fitView/zoom before synthetic events — compute expected screen points from the
   store's own geometry, don't hardcode pixels). Click near a known edge midpoint
   → feature lands on the correct normalized edgeKey; click again → toggled off;
   drag across 3 edges → 3 edges painted, ONE undo step reverts all; drag over an
   already-painted edge → still painted (idempotent, no toggle); alt-click erases;
   edge to a missing neighbor is not painted; pan and hex-select still work with
   edge-paint OFF.
2. **twu-check.mjs**: synthetic fixtures in `verify/fixtures/` (tiny hand-written
   rivers/rail files — NO TWU board assets in this public repo). Import both
   shapes → correct features + draft provenance; a wrong-shaped file → loud
   error, nothing imported; export → shape matches the TWU contract exactly
   (bare pairs under `hexsides`; `links` pairs + `hexes` endpoint-union);
   import→export round-trip lossless.
3. **autosave-check.mjs**: extend IN THE SAME CHUNK as the autosave change — two
   projects with different names autosave to separate slots; legacy single-key
   session migrates once; boot restore offers the newest slot.
4. Visual check (headed capture): edge-paint hover highlight + a painted
   multi-feature edge look right at two zoom levels.
5. **Cross-repo integration check** (after TWU export ships): run
   twu-deluxe-digital's actual `loadRivers`/`loadRail` against a Hexwright-exported
   file in a node one-liner — green Hexwright tests alone don't prove the
   consumer loads it.

## 6. Build order

1. Chunk A — edge-paint (geometry.nearestEdge + pointer-priority routing +
   beginStroke/endStroke batch undo + renderer hover highlight) +
   edge-paint-check.mjs.
2. Chunk B — per-project autosave + autosave-check extension (SECOND: it protects
   the GotA marathon that starts immediately; TWU can wait a chunk).
3. Chunk C — TWU on-ramp (import/export + palette + manifest template + README
   recipe) + twu-check.mjs + the cross-repo integration check.
4. README (edge-paint usage + bring-your-own-game section) last.

Cross-repo sibling (separate dispatch, NOT this repo): guns-of-the-americas engine
hexside consumption — see guns-of-the-americas/docs/handoffs/
hexside-engine-wiring-2026-07-01.md.
