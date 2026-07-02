# Hexwright — Design Register

**Identity.** Hexwright is an *instrument*, not a game surface. It is the
workbench where Ray hand-traces commissioned map art (GotA, TWU, TWAR)
into canonical hex data. The user is one person, sessions are long
(hundreds of hexes per sitting), and the tool is critical path for
shipping the wargames. Every design call optimizes for: the MAP is the
star, the UI recedes, state is always legible at a glance, keyboard-first
with visible state.

**Provenance.** Original UI by Opus (2026-06-30). Fable overhaul
commissioned by Ray 2026-07-01, verbatim: "the UI is a little crowded…
could be a little clearer/cleaner… hard to see where the existing
mountain hexsides are… need instructions also (or more cleanly surfaced
to me in the UI) how to designate what type of hexside im drawing…
critical for this as its a tool for me to get these tools across the
finishline." Ray delegated the aesthetic ("just have you redo it as
fable") — leans below are Fable's, certified by Ray at sign-off.

## Locked art direction (Fable leans, 2026-07-01)

- **Darkroom instrument.** Near-black cool-neutral chrome (the
  Lightroom/Blender posture): the parchment map art becomes the
  brightest object on screen and overlay inks pop against it. NOT
  period-styled — no brass, no parchment chrome. The games get period
  registers; the workbench gets clarity.
- **One accent.** Cool cyan for the active tool/selection state —
  deliberately outside the warm palette of the map art so "what is UI
  state" vs "what is map" is never ambiguous. A single amber reserved
  for unsaved/dirty and destructive-confirm states.
- **Type.** IBM Plex Sans (400/500/600) for UI labels; IBM Plex Mono
  (400/500) for data — hex codes (CCRR), counts, coordinates, keyboard
  chips. Vendored woff2 + OFL in `design-systems/hexwright-instrument/
  fonts/` (L6: no remote fonts).
- **Chrome is an overlay (L7).** Tool rail, panels, status strip float
  over the canvas at fixed positions; the canvas never reflows.
- **Keyboard-first, visibly.** Every mode/brush shows its key as a kbd
  chip inline. The active mode is impossible to miss (accent ring +
  named in the status strip with a one-line usage hint).

## The four functional commitments (from Ray's brief)

1. **Active-brush clarity.** A persistent Brush card shows the current
   mode AND, in hexside mode, exactly which layer ink (river/road/rail/
   mountain/impassible) is loaded — swatch, name, key. Cursor carries
   the ink color.
2. **Overlay legibility: the casing system.** Every hexside stroke =
   saturated core + pale casing halo (cartographic road-casing), so
   strokes read against both light parchment and dark forest art.
   Mountains get a high-contrast crimson core — never brown-on-brown.
   Per-layer eye toggles + a map-dim slider ("boost overlays") in a
   Layers panel.
3. **Clean slate.** A Start screen: New blank project (grid from
   calibration, empty layers) / Open recent / Load manifest. No more
   inheriting a worked example to get going.
4. **Guidance in the UI.** Per-mode hint line in the status strip;
   redesigned `?` reference overlay; dismissible first-run coach card.
5. **Hex assignment is legible (Ray, mid-session add: "clicking on a
   hex and assigning stuff is a bit cryptic as its just a bunch of
   boxes").** The click-a-hex editor becomes a docked, labeled panel:
   terrain as a named swatch grid, features as named toggle chips, and
   a large 6-edge hex diagram whose edges draw with their actual inks
   (casing + core) and carry compass labels — select an edge, tap a
   named ink to add/remove. Every ink is visible before it's applied;
   no unlabeled checkbox clusters.

## Component inventory (as mocked)

Tool rail (left) · Brush card (under rail) · Layers panel (right) ·
Inspector (right, collapsible) · Status strip (top) · Start screen ·
Help overlay · kbd chips · eye toggles · opacity slider.

## References

- `opendesign/mockups/hexwright-overhaul/` — the spec mockups.
- Map-area content in mockups is a synthetic parchment placeholder —
  commercial map art never enters mockups or Claude Design pushes.
