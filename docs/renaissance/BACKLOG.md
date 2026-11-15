# Renaissance prioritized backlog

Status is current to the simulation interaction QA checkpoint on `renaissance/next-generation`. Items are ordered by visitor value, risk and dependency.

## P0 — Make nineteen exhibits navigable by idea

- [x] Add a concise, optional set of curated paths with short transitions between real exhibits.
- [x] Carry a validated path identity between route links; show current position and next exhibit in the shared About surface.
- [x] Add data integrity checks for path IDs, stop counts, references and duplicate stops.
- [x] Add a browser workflow for starting, continuing, skipping to a stop, exiting, direct-loading, and mobile viewing.
- [x] Expose the already documented six-exhibit browser harness as an npm script.
- [x] Put named saved configurations near the collection entrance when any exist.

## P1 — Reproducible personal exploration

- [x] Version new shared URLs; retain decoding of existing unversioned links and reject unknown future envelopes.
- [x] Define a versioned local notebook with a 16 KiB per-state limit, twelve entries and 128 KiB aggregate limit.
- [x] Apply bounded safe-JSON validation to shared state encoding/decoding, including finite numbers, nesting, field counts, cycles and unsafe keys; preserve safe legacy links.
- [x] Apply exhibit-range bounds and valid-choice recovery to restored numerical settings in nine high-risk models, including procedural generations, simulation rates, force parameters and uint32 seeds; keep the full per-exhibit parameter audit open.
- [x] Restore all Shape of Sound shareable settings and reject invalid Fourier partials by number, amplitude, phase, and duplicate order; sound remains off on entry.
- [x] Add optional named local saves, safe JSON/exhibit validation, reopen/delete actions, browser recovery tests and honest replay/privacy copy.
- [ ] Audit each exhibit serializer for validation, defaults, finite numeric bounds and deterministic seed behavior.
- [ ] Add export/import only where the state can be accurately restored; document that shared URL data is public.
- [x] Ensure malformed/unsupported versions and corrupted local notebook data are recoverable without preventing exhibit entry.
- [x] Test supported share links and route restoration across all 19 exhibits in the browser; exercise malformed/future-version entry recovery.

## P1 — Product accessibility and mobile

- [x] Sweep all 19 routes at 320×740, 390×844, 768×1024, 1024×768, 1440×900, and 844×390, including Controls, About, and the route selector.
- [x] Keep every core phone dock action inside the viewport with 44×44 px targets; verify that all nineteen 44 px selector rows remain reachable by scrolling.
- [x] Move focus into shared overlays and return it to the trigger on Escape, including when an exhibit control panel mounts after its lazy module loads.
- [x] Audit visible controls in shared Controls, About and selector surfaces for a discoverable DOM name across all exhibits and viewport shapes.
- [ ] Review label size, contrast, reading order, dialog semantics and screen-reader descriptions with assistive technology.
- [ ] Verify keyboard and touch equivalents for primary actions and support reduced-motion preferences.
- [ ] Perform a manual phone session if an actual device is available; emulation alone is layout evidence.
- [x] Keep simulation diagnostics development-only and verify they are absent from production JavaScript.
- [x] Make pointer strokes and the keyboard “Stir the centre” action visibly change GPU Fluid while paused; mirror paused input behavior in the Canvas2D fallback.

## P1 — Performance and lifecycle

- [ ] Profile homepage/gallery network and main-thread behavior with timings tied to the selected renderer.
- [ ] Measure lazy exhibit chunks, mounting duration, frame cadence and worker/AudioContext/WebGL cleanup after repeated route changes.
- [ ] Test idle/background suspension, resize/context loss and cancellation during heavy Mandelbrot/lensing work.
- [ ] Repeat suitable performance samples on a physical GPU and mid-range mobile; keep SwiftShader results separate.

## P2 — Automated QA and scientific quality

- [ ] Extend route tests to all 19 for direct load, refresh, controls/about, recovery and invalid URLs.
- [x] Add browser checks that assert actual state changes for Mandelbrot zoom/reset, Fluid pointer/button input, reaction-diffusion painting, gravity orbit creation/recovery, CPU stepping, neural training, keyboard-edited logic, gate-level addition and cellular-automaton stepping.
- [x] Add representative browser state-change checks for geometry optics, sound synthesis, packet routing and gravitational lensing; prefer visible output or model values over fragile screenshot equality.
- [x] On all 19 routes, reject a deeply nested shared-state envelope and recover with safe defaults without entering the error boundary.
- [ ] Exercise the Fluid Canvas2D fallback in a browser with WebGL disabled; the fallback code now applies paused strokes synchronously, but the current browser ran its WebGL renderer.
- [ ] Add stable visual capture and tolerant image-diff workflow for representative desktop/mobile states.
- [ ] Review scientific claims and visible approximations, especially Fluid, Garden, Networks, geometric optics and Where Light Falls.
- [ ] Test limits, invalid parameters, resets, deterministic seeds, worker cancellation, and numerical invariants.

## P2 — Gallery and preview refinement

- [x] Inspect first paint for all 19 previews on desktop and phone; test interactive hover/reset and reduced-motion behavior.
- [x] Terminate the shared Mandelbrot preview worker and clear preview canvases when the gallery unmounts; verify the worker does not return on gallery remount with cached previews.
- [x] Test that a live preview evolves while visible, suspends outside the visible region, and resumes on return.
- [x] Add six optional idea searches backed by structured concepts across all 19 exhibits, and curate two to three related destinations per exhibit.
- [x] Check concept search result accuracy, no-results recovery, favourites/recent behavior, phone targets, and related links across all 19 routes.
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
