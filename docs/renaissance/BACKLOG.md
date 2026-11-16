# Renaissance prioritized backlog

Status includes the validated home/gallery performance sample and adaptive ambient-field resolution change in `9e258c7`, the nineteen-study model-boundary audit in `6ba7883`, and the verified shared-control readability/accessibility checkpoint. Items are ordered by visitor value, risk and dependency.

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
- [x] Apply exhibit-range bounds and valid-choice recovery to restored numerical settings in twelve high-risk routes, including procedural generations, simulation rates, force parameters, optical placements, mass-scaled photon impact, and uint32 seeds.
- [x] Restore every serialized optics, wave, and lensing setting; state explicitly that shared wave links recreate the selected beginning, not live pulses or drawn walls.
- [x] Bound imported Mandelbrot zoom to its supported 0.72×–10^500 range and reject overlong camera coordinates before fixed-point conversion.
- [x] Share bounded CPU operands and up to 2,000 characters of custom assembly; restart safely at the first instruction and disclose that program text is included in the public link.
- [x] Restore all Shape of Sound shareable settings and reject invalid Fourier partials by number, amplitude, phase, and duplicate order; sound remains off on entry.
- [x] Serialize cellular drawings compactly, including Brian’s Brain refractory cells; reject malformed grids and browser-test a drawn still-life share/reload.
- [x] Restore Fluid preset and clear state in its Canvas 2D fallback; align Reaction Diffusion fallback presets, palettes, seeds and bounds with GPU state.
- [x] Add optional named local saves, safe JSON/exhibit validation, reopen/delete actions, browser recovery tests and honest replay/privacy copy.
- [x] Finish the route-by-route audit of deterministic seeds and replay limits, with emphasis on starting dimensions, reset behavior and which random histories are intentionally regenerated. Current scope is documented in `STATE-REPLAY.md`.
- [x] Share up to 128 bounded user examples and the model initialization seed for Neural Networks; browser-check a custom lesson and fresh-weight reset round trip, reject malformed examples, and disclose that point positions and labels appear in the public URL.
- [x] Add bounded, versioned JSON notebook export/import for settings-only states; merge without replacing, deduplicate, reject unknown versions, disclose readable file contents, and exercise the real browser download/import workflow (`4034d22`).
- [x] Share and restore user-built Logic Laboratory circuits with validated node/wire limits, switch values and goal state; verify a custom XOR build and challenge after reload.
- [x] Share and restore bounded Invisible Forces source charges and normalized camera framing while leaving released particle history out of the URL.
- [x] Share and restore bounded Gravity body edits and normalized camera framing; trails and collision history restart, and restored IDs remain collision-free.
- [x] Share and restore up to sixteen normalized Flocking field marks with their interaction kinds; verify viewport changes, oldest-mark replacement, explicit clearing, and malformed recovery.
- [x] Ensure malformed/unsupported versions and corrupted local notebook data are recoverable without preventing exhibit entry.
- [x] Test supported share links and route restoration across all 19 exhibits in the browser; exercise malformed/future-version entry recovery.

## P1 — Product accessibility and mobile

- [x] Sweep all 19 routes at 320×740, 390×844, 768×1024, 1024×768, 1440×900, and 844×390, including Controls, About, and the route selector.
- [x] Read Chrome's computed accessibility tree for the gallery/search and every exhibit's Controls, About and selector; verify interactive names, shared-landmark names, expanded state, moved focus, and bounded slider values (`qa:accessibility-tree`).
- [x] Keep every core phone dock action inside the viewport with 44×44 px targets; verify that all nineteen 44 px selector rows remain reachable by scrolling.
- [x] Move focus into shared overlays and return it to the trigger on Escape, including when an exhibit control panel mounts after its lazy module loads.
- [x] Audit visible controls in shared Controls, About and selector surfaces for a discoverable DOM name across all exhibits and viewport shapes.
- [x] Enlarge the shared Controls/About reading copy and saved-state privacy note; keep About actions and selected study links at useful touch sizes; verify 320px, 390px and desktop layout across all 19 routes.
- [x] Add a reduced-motion browser matrix; confirm all 19 studies begin paused when that preference is active at three viewport sizes.
- [x] Give shared segmented and preset choices a named group and `aria-pressed` state matching the selected visual option.
- [x] Add an automated Controls/About typography and target-size check; see `npm run qa:accessibility` and `evidence/accessibility-readability-review.json`.
- [x] Make L-system and attractor cameras focusable; support arrows, plus/minus and Home with a visible keyboard-only instruction and focus ring; preserve those keys from global exhibit navigation.
- [x] Test Tab, keyboard panning/rotation, zoom and exact camera restore in a rendered Canvas2D browser at phone and desktop sizes.
- [x] Give Boids an always-available Controls action to place the selected field mark at centre; announce placement/clear and verify raster change plus exact paused-state recovery.
- [x] Make the cellular grid Tab-focusable and editable with arrows, Enter and Home; show its active cell and announce row, column and population changes.
- [x] Name the cellular Paint/Erase/Pan group and expose pressed state; size its tools, Step/Pause and shared-panel buttons to 44px on mobile, tablet and coarse-pointer layouts.
- [x] Exercise the flock and automaton tasks in Chromium at 320×740, 390×844, 844×390 and 1024×768; check rendered state changes, recovery, status and mobile instruction spacing.
- [x] Add keyboard body selection/nudging in Gravity and coordinate-based Add/Probe/Erase in Neural Networks; validate live status, recovery and visible canvas changes across phone, landscape and desktop sizes. Neural example dragging remains pointer-first.
- [ ] Review formal contrast, reading order, dialog semantics, status announcements and screen-reader descriptions with assistive technology.
- [ ] Perform a manual phone session if an actual device is available; emulation alone is layout evidence.
- [x] Keep simulation diagnostics development-only and verify they are absent from production JavaScript.
- [x] Make pointer strokes and the keyboard “Stir the centre” action visibly change GPU Fluid while paused; mirror paused input behavior in the Canvas2D fallback.

## P1 — Performance and lifecycle

- [x] Profile cold homepage/gallery loading, search, main-thread long tasks, animation callbacks, and GPU/compositor traces in HeadlessChrome 157 / SwiftShader; reduce only decorative ambient pixel density after repeated slow frames and preserve before/after evidence.
- [x] Measure lazy exhibit chunks, mounting duration, frame cadence and worker/AudioContext/WebGL cleanup after repeated route changes (`qa:route-lifecycle`).
- [ ] Re-measure route-mount outliers and frame pacing in a controlled, uninstrumented browser on physical GPU and mid-range mobile hardware when available.
- [x] Instrument workers and audio contexts during two complete nineteen-route SPA passes; confirm every route-owned worker terminates and each explicitly started audio context closes on exit.
- [x] Profile the 1,400-agent Flocking predator scenario before/after optimization under a fixed headless browser and workload; preserve exact trial data and the software-renderer caveat.
- [x] Test a real background-tab switch: network ticks ignore throttled hidden callbacks; deep Mandelbrot worker work cancels, stays idle, and resumes in a newer generation.
- [x] Force fast Mandelbrot WebGL context loss/restoration; verify the progressive fallback and rebuilt shader output in the browser.
- [x] Test lensing resize, hidden-tab cancellation/resume, and cancellation during an in-flight sky raster, including a forced no-worker recovery; numerical checks require byte-identical synchronous/cooperative source pixels and raster output.
- [ ] Exercise the Mandelbrot WebGPU `device.lost` recovery with a real WebGPU-capable implementation; headless SwiftShader only exposes WebGL in the current run.
- [ ] Repeat suitable performance samples on a physical GPU and mid-range mobile; keep SwiftShader results separate.
- [x] Add route-level progress reporting and supervise lifecycle-test timeout, browser shutdown and child-process cleanup.
- [ ] After the host gate passes, rerun lifecycle QA with one owned browser; verify Fluid shared-shader accounting and investigate the prior Shape of Sound CDP timeout.

## P2 — Automated QA and scientific quality

- [ ] Extend route tests to all 19 for direct load, refresh, controls/about, recovery and invalid URLs.
- [x] Add browser checks that assert actual state changes for Mandelbrot zoom/reset, Fluid pointer/button input, reaction-diffusion painting, gravity orbit creation/recovery, CPU stepping, neural training, keyboard-edited logic, gate-level addition and cellular-automaton stepping.
- [x] Add representative browser state-change checks for geometry optics, sound synthesis, packet routing and gravitational lensing; prefer visible output or model values over fragile screenshot equality.
- [x] On all 19 routes, reject a deeply nested shared-state envelope and recover with safe defaults without entering the error boundary.
- [x] Exercise seventeen extreme/invalid shared-state cases across thirteen routes; cover enum/default recovery, model bounds, optical placements, oversized fractal zoom/coordinates, CPU source execution, and browser-painted cellular-board replay.
- [x] Exercise Fluid and Reaction Diffusion Canvas 2D fallbacks with WebGL disabled; restore WebGL2 and verify a fallback-created Reaction setup keeps its preset and pigment.
- [ ] Add stable visual capture and tolerant image-diff workflow for representative desktop/mobile states.
- [x] Compare visitor-facing model descriptions with all nineteen implementations and record evidence/limitations in `SCIENCE.md`.
- [x] Add selected numerical checks for softened gravity force/potential and momentum, neural backpropagation, electrostatic field/potential, and wrapped cellular-automaton updates.
- [ ] Add GPU fluid and reaction–diffusion residual/grid-refinement checks without duplicating the production solver.
- [ ] Add attractor step-refinement/reference trajectory checks and direct L-system rewrite-rule tests.
- [ ] Obtain independent specialist review of Where Light Falls model language and imagery.
- [ ] Extend numerical bounds/reset/determinism/cancellation testing in the remaining uncovered routes and extreme-parameter combinations.

## P2 — Gallery and preview refinement

- [x] Inspect first paint for all 19 previews on desktop and phone; test interactive hover/reset and reduced-motion behavior.
- [x] Terminate the shared Mandelbrot preview worker and clear preview canvases when the gallery unmounts; verify the worker does not return on gallery remount with cached previews.
- [x] Test that a live preview evolves while visible, suspends outside the visible region, and resumes on return.
- [x] Add six optional idea searches backed by structured concepts across all 19 exhibits, and curate two to three related destinations per exhibit.
- [x] Check concept search result accuracy, no-results recovery, favourites/recent behavior, phone targets, and related links across all 19 routes.
- [ ] Keep a single preview budget; do not mount nineteen full simulation engines.
- [x] Improve collection concept labels, category-chip size and phone target reach after screenshot review; browser checks verify 11 px text, 44 px targets, an actual touch swipe, full filter reach and no overflow.

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
