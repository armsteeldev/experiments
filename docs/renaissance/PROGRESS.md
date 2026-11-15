# Project Renaissance progress

## Current checkpoint

- **Branch/worktree:** `renaissance/next-generation` at `/home/charlie/experiments-next`.
- **Base:** `cd76da9` (nineteen-exhibit expansion), verified to contain `dfe47f7` combined-release history.
- **Safety:** Source branches/worktrees and the public site have not been modified. No push or deployment.
- **Latest clean checkpoint:** `a259f2a` verifies state-changing interactions and fixes paused Fluid input in the WebGL and Canvas2D paths. Current local work hardens URL-state validation across all exhibits.

## Milestones

### 1 — Baseline and integration: complete

- Verified 19 unique exhibit registrations, static routes, and 21 canonical URLs via `npm run verify`.
- `npm run qa:existing` passed 13 established routes at desktop and mobile viewports with no overflow or browser/HTTP errors.
- `node scripts/qa-invisible-world.mjs` passed the six added routes, interaction tasks, audio cleanup, and 12 repeated entries with 50 captures and no browser/HTTP errors.
- Captured initial JavaScript/CSS/lazy-chunk sizes and a fresh garden frame/heap/lifecycle sample; see [`BASELINE.md`](BASELINE.md).
- The host has a GTX 1660 SUPER, but headless Chromium uses SwiftShader; physical-GPU performance remains unmeasured.
- The starting checkout has uncommitted work on `improvement/accessible-depth`. It remains untouched; equivalent homepage, Fluid, Reaction Diffusion and Cellular Automata improvements are already in the new branch, while its older Adder change targets a superseded implementation.

### 2 — Core experience quality: in progress

- Added four optional editorial paths (18 exhibit stops) under `src/data/journeys.json`, presented as a compact chooser and connected sequence in the gallery.
- Each exhibit step carries the validated journey ID in its URL. About shows position, a contextual explanation, previous/next, completion, and “Explore freely.” Unrelated or invalid path IDs are ignored; share links retain the journey parameter.
- Added `test:journeys`, `qa:journeys`, and the previously documented `qa:invisible-world` npm command. The new browser flow passes desktop, keyboard, touch-emulated mobile, direct link, refresh, invalid association, exit, and completion cases at 320/390px and landscape 844×390.
- Captures and machine-readable results are in [`evidence/`](evidence/); none use a production or real mobile device.
- Build delta from the baseline: initial JS 338.41 → 344.92 kB raw (109.27 → 111.22 kB gzip); initial CSS 97.60 → 103.68 kB raw (21.38 → 22.68 kB gzip). Lazy exhibit chunks are unchanged.
- The optional local notebook now sits before the long card grid, so saved setups are visible near the collection’s first choices. Its entries can be named, reopened, refreshed, or removed.
- Fixed two measured shared-navigation gaps: phone dock actions were partly off-screen and below a useful touch size, and the exhibit chooser CSS targeted direct children while its options are nested in a list. At widths up to 420px the dock now keeps six core actions at 44×44 px and moves sequential navigation into the full exhibit chooser; every chooser row is 44 px and its final option is scroll-reachable.
- Added `qa:exhibit-overlays`: all nineteen routes × six viewport shapes × dock, Controls, About and chooser (456 checks). The browser found a lazy-mount race where a controls panel could open before its exhibit loaded and miss keyboard focus. The shared shell now waits for that panel to mount before moving focus. The rerun passed with zero layout/accessibility findings and zero browser/network errors. See [`evidence/exhibit-overlay-review.json`](evidence/exhibit-overlay-review.json) and [320px mobile chooser/dock capture](evidence/exhibit-selector-320-mobile.png).
- Expanded the overlay harness to audit names for visible buttons, links and form controls in Controls, About and the collection chooser. All nineteen exhibits and six viewports passed: 4,452 control observations, zero unnamed items, zero layout findings, and no browser/network errors. This uses a DOM naming heuristic rather than Chrome’s computed accessibility tree and does not replace a screen-reader or assistive-technology test. For faster diagnosis, `ARMSTEEL_QA_EXHIBITS` and `ARMSTEEL_QA_VIEWPORTS` accept comma-separated filters; the default remains the full 456-check matrix.
- Added a gallery preview browser sweep across all 19 cards at desktop and touch-emulated phone sizes. All 38 previews paint visibly, neither viewport has horizontal overflow, L-system hover changes the rendered pixels and pointer leave restores the exact sampled base image. Emulated reduced motion keeps that preview static.
- The sweep exposed a lifecycle leak: the shared Mandelbrot preview raster worker remained alive after leaving the gallery. Preview canvases now use reference-counted ownership; when the last gallery preview unmounts, pending cache entries and raster/background canvases are cleared and the worker terminates. Returning to the gallery reuses its cached preview without reopening the worker. Browser instrumentation verified one worker created, one terminated, zero active after unmount and still zero active on return.
- Captures and the machine-readable run are in [`evidence/`](evidence/); browser validation is HeadlessChrome 157 with SwiftShader and phone emulation, not physical hardware. The production build is 351.89 kB initial JS raw / 113.55 kB gzip and 107.92 kB initial CSS raw / 23.45 kB gzip; exhibit chunks remain lazy.
- Added a pixel-signature regression check for visibility-driven scheduling: the live attractor preview evolves while visible, becomes static outside the viewport, and resumes on return. The full gallery preview harness still passes all 38 first-paint checks with no browser/network errors.
- Added curated concept tags for all nineteen studies. The optional search panel offers six idea prompts—Emergence, Recursion, Waves, Learning, Fields and Computation—and concept searches include editorial terms absent from titles. Every study now links to two or three hand-picked related works; the lensing panel intentionally has two to avoid a weaker third connection.
- `qa:collection-discovery` passed all six concept queries against expected result sets, no-result recovery and Escape/focus return, favourites, recent visits, six 40 px mobile targets without overflow, all nineteen About-panel recommendation lists, and a real related-link transition. It recorded no browser/network errors. Desktop and phone captures plus the full result matrix are in [`evidence/`](evidence/).
- A production bundle check now rejects development-only simulation diagnostics. The Mandelbrot metrics hook was the remaining unguarded global; it is DEV-only and removed when its exhibit unmounts. This reduces the lazy fractal chunk and prevents internal render telemetry from becoming a production surface. `npm run verify` passes with the new static guard.
- Added `qa:original-interactions`, which drives the rendered application and checks nine actual state transitions: fractal zoom/reset; paused Fluid drag and its visible “Stir the centre” action; reaction-diffusion painting; gravity orbit launch/removal; one CPU instruction; neural training loss; keyboard-operated logic switches; a completed 7 + 9 gate-level sum; and one automaton generation. Ten current-state captures and canvas hashes are recorded in [`evidence/original-interaction-browser-checks.json`](evidence/original-interaction-browser-checks.json). The run used HeadlessChrome 157 with SwiftShader, had no browser/network errors, and does not establish physical GPU or phone performance.
- That sweep found paused Fluid strokes were queued for the simulation loop, which stops while paused. Both the WebGL and Canvas2D fallback paths now apply a stroke immediately to the visible field while leaving time evolution paused; the “Stir the centre” action uses the same path. Browser checks confirm visible changes after both pointer and button input.
- The gallery continues to expose its category and favourites filters alongside idea search and editorial paths. Remaining for this milestone: review the gallery’s first-visit hierarchy and improve card legibility only where further browser evidence shows a clear need.

### 3 — New product capabilities: in progress

- The shared URL format now writes `{"$armsteel":1,"state":...}`; older unversioned settings links continue to decode. Unknown future envelope versions fail closed.
- Added optional named local configurations for all exhibits that report shareable settings. Each saved entry uses a versioned local record, validates JSON-safe values and registered exhibit IDs, stays within 16 KiB per state, twelve entries and 128 KiB total, and can be deleted individually. Storage failure falls back to tab memory with a clear confirmation.
- Settings and presets are saved; live simulation buffers and full running history are not. UI and privacy copy say so. No account, server, analytics, or third-party storage was introduced.
- `test:storage` covers schema version, malformed data, unsupported values, invalid exhibit IDs, count/byte caps, legacy URL reads, unsupported future URL versions, deletion and blocked storage. `qa:saved-experiments` covers changed Cellular Automata settings from save through refresh and deletion on desktop and narrow mobile.
- Remaining: audit each exhibit’s parameter bounds and deterministic-seed behavior; add export/import only if it can preserve the model honestly; test shared links across all exhibits and malformed state in the browser.
- Closed the cross-exhibit support gap found during the browser sweep: The Adder now shares/restores its width, architecture, valid operands and speed. Its changed 8-bit look-ahead link restored 23 + 17 and the displayed result was 40.
- The Living Network restores its bounded 48-character message payload as well as endpoints; the input, save form and privacy page warn that this text appears in saved/shared settings and should not contain private information.
- Shared URL state now uses the same safe-JSON boundaries as the local notebook: plain records only, finite numbers, bounded depth/field counts, and rejection of unsafe property names and cyclic values. Legacy links receive the same validation. Unit checks cover these edge cases; the browser share/restore sweep now sends a deeply nested invalid envelope to all 19 routes and confirms each opens with safe defaults, with no error boundary or browser/network errors. Per-exhibit parameter-range and seed validation remains a separate open audit.

### 4–10 — Performance, broader accessibility/mobile, automated QA, developer infrastructure, scientific integrity, creative innovation, final review: in progress

Priorities and acceptance limits are in [`BACKLOG.md`](BACKLOG.md). This checkpoint does not claim completion of these milestones.

- Automated QA now covers all nineteen overlay/selector routes and gallery previews plus nine representative state-changing interactions. Remaining coverage is prioritized in [`BACKLOG.md`](BACKLOG.md).
- Creative collection capabilities include optional curated journeys, concept discovery, and local reproducible settings. Additional milestones remain open; this is not a release candidate.

## Design decisions

- Preserve lazy route loading and the exhibit-specific visual/simulation systems.
- Keep collection journeys optional and editorial, rather than requiring onboarding or turning the gallery into a dashboard.
- Keep user data local and small; do not add analytics, accounts, a backend or external dependencies without a demonstrated need.
- Distinguish simulation fidelity from rendering quality and software-rendered browser behavior from physical GPU results.
- Curated path data contains only stable exhibit IDs and editorial transition notes. Path context is a non-sensitive `journey` query value; no progress is stored or sent elsewhere.
- A path's About panel remains open while navigating between its stops, but the shared dock's ordinary navigation remains free to leave the path.
- URL settings are Base64 URL encoded, not encrypted. Version 1 is unwrapped for exhibit consumers; versionless links remain supported. Named settings live only in local storage (or current-tab memory if storage is unavailable), with a 12-entry/128-KiB notebook cap.
- At phone widths, the collection selector is the primary route navigator; this preserves all nineteen destinations and frees space for 44 px home, settings, About, pause and fullscreen targets.
- Shared overlay focus waits for lazily mounted exhibit controls, then returns to the opening trigger on Escape. The observer disconnects on focus, overlay close or after 2.5 seconds if a failed module never creates its panel.

## Latest verification

- `npm ci` — passed; 73 packages installed, zero vulnerabilities reported.
- `npm run verify` — passed at baseline (`cd76da9`); build, eight test groups, and site checks.
- `npm run qa:existing` — passed 13 × desktop/mobile direct routes.
- `node scripts/qa-invisible-world.mjs` — passed six added exhibits, 50 captures, 12 route entries.
- `npm run qa:resources` — completed in a fresh browser profile; software-WebGL results are recorded at [`evidence/baseline-runtime-resource-samples.json`](evidence/baseline-runtime-resource-samples.json).
- `npm run qa:journeys` — passed nine desktop/mobile scenarios after the production build; `docs/renaissance/evidence/journey-browser-checks.json` reports no browser or HTTP errors.
- `npm run test:storage` — passed schema, validation, legacy/future version, size, count, recovery, removal, and storage-fallback cases.
- `npm run qa:saved-experiments` — passed setting changes, named save, URL restoration, deep-link refresh, 390px and 320px gallery fit, removal target size, deletion, privacy disclosure, and zero browser/network errors. Screenshots and results are in [`evidence/`](evidence/).
- `npm run qa:state-sharing` — passed share → reload for all 19 exhibits, state-size and current-envelope checks, including edited Adder values; no browser or HTTP errors. The harness also verifies restored Adder controls and calculated result.
- `npm run verify` — passed after the shared-shell changes and again after the structured discovery update, including all simulations, exhaustive 4-/8-bit Adder cases, storage validation, 19 exhibit metadata/routes and static SEO/sitemap checks.
- `npm run qa:exhibit-overlays` — passed 456 checks for the dock, Controls, About and selector over 19 exhibits at 320×740, 390×844, 768×1024, 1024×768, 1440×900 and 844×390. All focus movement, Escape close/return, panel bounds, scroll reach, selector row height, mobile dock target size, 4,452 visible-control name observations, and browser/network-error checks passed. This is headless SwiftShader plus viewport/touch emulation, not a physical phone or screen-reader test.
- `npm run verify` — passed after the Fluid pause-path changes; initial JS is 354.35 kB raw / 114.25 kB gzip, initial CSS is 108.79 kB raw / 23.66 kB gzip. Fluid is 29.76 kB raw / 10.18 kB gzip and Mandelbrot is 52.79 kB raw / 17.27 kB gzip.
- The static built-asset scan confirms no Mandelbrot, Gravity, Attractors or Growth development diagnostic global is present in production JavaScript.
- `npm run qa:original-interactions` — passed nine state-changing scenarios across nine exhibits against the built production bundle on isolated local port 5217, with ten captures and paired before/after canvas hashes for Fluid and reaction-diffusion; zero browser/network errors. Browser: HeadlessChrome 157, SwiftShader/Vulkan, desktop 1440×900 emulation. Port 5215 belongs to the MIDAS app and was not used.
- `npm run qa:invisible-world` — passed the six expanded studies against the isolated local production preview: 50 captures, 12 repeated SPA entries, successful audio closure, optical source manipulation, sound harmonics, packet delivery through the live network, and keyboard lensing response. All 19 gallery pieces and concept search passed; no browser/HTTP errors. The gallery/evolved captures are committed baseline assets and were restored after the run, while dynamic packet counts were not retained as source changes.
- `npm run qa:state-sharing` — passed share/restore plus malformed deeply nested state recovery for all 19 exhibits on the production preview; the structured evidence records the routes and restoration result. No browser/HTTP errors.
- No dependency, service or tracking code was added; exhibit chunks remain lazy.

## Next action

Next: exercise repeated route/resource cleanup across all nineteen studies, then continue the per-exhibit settings-bound audit and accessibility/scientific-model reviews. Physical-device and physical-GPU claims remain open until tested on real devices.
