# Renaissance prioritized backlog

Status is current to the `cd76da9` baseline. Items are ordered by visitor value, risk and dependency.

## P0 — Make nineteen exhibits navigable by idea

- [x] Add a concise, optional set of curated paths with short transitions between real exhibits.
- [x] Carry a validated path identity between route links; show current position and next exhibit in the shared About surface.
- [x] Add data integrity checks for path IDs, stop counts, references and duplicate stops.
- [x] Add a browser workflow for starting, continuing, skipping to a stop, exiting, direct-loading, and mobile viewing.
- [x] Expose the already documented six-exhibit browser harness as an npm script.

## P1 — Reproducible personal exploration

- [ ] Define a versioned, per-exhibit state envelope and maximum encoded URL/local storage sizes.
- [ ] Audit each exhibit serializer for validation, defaults, finite numeric bounds and deterministic seed behavior.
- [ ] Add optional named local saves and safe export/import only where the state can be accurately restored; document that shared URL data is public.
- [ ] Ensure malformed/old state is recoverable and never prevents opening the exhibit.

## P1 — Product accessibility and mobile

- [ ] Sweep all 19 routes at 320, 390, 768, 1024 and 1440 CSS pixels, portrait and landscape, including every overlay.
- [ ] Review label size, contrast, focus order, dialog semantics, touch target geometry, and screen-reader descriptions.
- [ ] Verify keyboard and touch equivalents for primary actions and support reduced-motion preferences.
- [ ] Perform a manual phone session if an actual device is available; emulation alone is layout evidence.

## P1 — Performance and lifecycle

- [ ] Profile homepage/gallery network and main-thread behavior with timings tied to the selected renderer.
- [ ] Measure lazy exhibit chunks, mounting duration, frame cadence and worker/AudioContext/WebGL cleanup after repeated route changes.
- [ ] Test idle/background suspension, resize/context loss and cancellation during heavy Mandelbrot/lensing work.
- [ ] Repeat suitable performance samples on a physical GPU and mid-range mobile; keep SwiftShader results separate.

## P2 — Automated QA and scientific quality

- [ ] Extend route tests to all 19 for direct load, refresh, controls/about, recovery and invalid URLs.
- [ ] Add exhibit interaction checks for fluid injection, gravity orbit, logic circuit editing, Adder, CPU, neural training, optics, sound, packet routing and lensing.
- [ ] Add stable visual capture and tolerant image-diff workflow for representative desktop/mobile states.
- [ ] Review scientific claims and visible approximations, especially Fluid, Garden, Networks, geometric optics and Where Light Falls.
- [ ] Test limits, invalid parameters, resets, deterministic seeds, worker cancellation, and numerical invariants.

## P2 — Gallery and preview refinement

- [ ] Inspect gallery first paint and preview startup on a clean profile; ensure visibility-driven previews stop when hidden.
- [ ] Check concept search, no-results behavior, favorites/recent handling, and the usefulness of each related link.
- [ ] Keep a single preview budget; do not mount nineteen full simulation engines.
- [ ] Improve card and microcopy legibility where browser review shows a real issue.

## P3 — Developer workflow

- [ ] Document small exhibit integration contracts for metadata, lazy registration, state sharing, controls, accessibility and cleanup.
- [ ] Add a thin exhibit scaffolder only if review confirms routine omissions are recurring.
- [ ] Add development-only rendering/worker diagnostics if they help diagnose measured performance issues.
- [ ] Establish fast, production, browser and extended QA tiers without adding deployment to development CI.

## Acceptance limits

- Never claim physical GPU/mobile performance from SwiftShader or viewport emulation.
- Never claim long-run memory boundedness from a short forced-GC sample.
- Do not lower simulation fidelity to satisfy a render target without exposing the change and validating model semantics.
- Preserve the source worktrees, public site, existing source commits and user changes. No push, merge to main or deployment.
