# Project Renaissance progress

## Current checkpoint

- **Branch/worktree:** `renaissance/next-generation` at `/home/charlie/experiments-next`.
- **Base:** `cd76da9` (nineteen-exhibit expansion), verified to contain `dfe47f7` combined-release history.
- **Safety:** Source branches/worktrees and the public site have not been modified. No push or deployment.
- **Working tree:** Clean after the shared-shell accessibility/mobile milestone. Curated paths, versioned local experiment notebook and overlay/navigation fixes are browser-verified.

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
- Remaining for this milestone: improve search/recommendation relevance and inspect preview scheduling/first paint under a clean profile.

### 3 — New product capabilities: in progress

- The shared URL format now writes `{"$armsteel":1,"state":...}`; older unversioned settings links continue to decode. Unknown future envelope versions fail closed.
- Added optional named local configurations for all exhibits that report shareable settings. Each saved entry uses a versioned local record, validates JSON-safe values and registered exhibit IDs, stays within 16 KiB per state, twelve entries and 128 KiB total, and can be deleted individually. Storage failure falls back to tab memory with a clear confirmation.
- Settings and presets are saved; live simulation buffers and full running history are not. UI and privacy copy say so. No account, server, analytics, or third-party storage was introduced.
- `test:storage` covers schema version, malformed data, unsupported values, invalid exhibit IDs, count/byte caps, legacy URL reads, unsupported future URL versions, deletion and blocked storage. `qa:saved-experiments` covers changed Cellular Automata settings from save through refresh and deletion on desktop and narrow mobile.
- Remaining: audit each exhibit’s parameter bounds and deterministic-seed behavior; add export/import only if it can preserve the model honestly; test shared links across all exhibits and malformed state in the browser.
- Closed the cross-exhibit support gap found during the browser sweep: The Adder now shares/restores its width, architecture, valid operands and speed. Its changed 8-bit look-ahead link restored 23 + 17 and the displayed result was 40.
- The Living Network restores its bounded 48-character message payload as well as endpoints; the input, save form and privacy page warn that this text appears in saved/shared settings and should not contain private information.

### 4–10 — Performance, broader accessibility/mobile, automated QA, developer infrastructure, scientific integrity, creative innovation, final review: queued

Priorities and acceptance limits are in [`BACKLOG.md`](BACKLOG.md). This checkpoint does not claim completion of these milestones.

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
- `npm run verify` — passed after the shared-shell changes, including all simulations, exhaustive 4-/8-bit Adder cases, storage validation, 19 exhibit metadata/routes, and static SEO/sitemap checks.
- `npm run qa:exhibit-overlays` — passed 456 checks for the dock, Controls, About and selector over 19 exhibits at 320×740, 390×844, 768×1024, 1024×768, 1440×900 and 844×390. All focus movement, Escape close/return, panel bounds, scroll reach, selector row height, mobile dock target size, and browser/network-error checks passed. This is headless SwiftShader plus viewport/touch emulation, not a physical phone or screen-reader test.
- Current build payload: initial JS 351.64 kB raw / 113.45 kB gzip; initial CSS 107.92 / 23.45 kB gzip. Exhibit chunks remain lazy; no dependency or service was added.

## Next action

Next: investigate gallery preview startup and concept-based search/recommendations. Follow with reduced-motion, keyboard and screen-reader review across the full collection; physical-device claims remain open until a real device is available.
