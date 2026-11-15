# Project Renaissance progress

## Current checkpoint

- **Branch/worktree:** `renaissance/next-generation` at `/home/charlie/experiments-next`.
- **Base:** `cd76da9` (nineteen-exhibit expansion), verified to contain `dfe47f7` combined-release history.
- **Safety:** Source branches/worktrees and the public site have not been modified. No push or deployment.
- **Working tree:** Curated paths are implemented and browser-verified; the next checkpoint is a local saved-state notebook or another measured high-value discovery improvement.

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
- Remaining for this milestone: improve search/recommendation relevance, review all 19 route control overlays with fresh browsers, and inspect preview scheduling/first paint under a clean profile.

### 3 — New product capabilities: queued

Evaluate versioned share-state restoration and a small privacy-preserving saved-experiment notebook. Confirm how each exhibit serializes before saving state; keep large buffers out of URLs/local storage.

### 4–10 — Performance, accessibility/mobile, automated QA, developer infrastructure, scientific integrity, creative innovation, final review: queued

Priorities and acceptance limits are in [`BACKLOG.md`](BACKLOG.md). This checkpoint does not claim completion of these milestones.

## Design decisions

- Preserve lazy route loading and the exhibit-specific visual/simulation systems.
- Keep collection journeys optional and editorial, rather than requiring onboarding or turning the gallery into a dashboard.
- Keep user data local and small; do not add analytics, accounts, a backend or external dependencies without a demonstrated need.
- Distinguish simulation fidelity from rendering quality and software-rendered browser behavior from physical GPU results.
- Curated path data contains only stable exhibit IDs and editorial transition notes. Path context is a non-sensitive `journey` query value; no progress is stored or sent elsewhere.
- A path's About panel remains open while navigating between its stops, but the shared dock's ordinary navigation remains free to leave the path.

## Latest verification

- `npm ci` — passed; 73 packages installed, zero vulnerabilities reported.
- `npm run verify` — passed at baseline (`cd76da9`); build, eight test groups, and site checks.
- `npm run qa:existing` — passed 13 × desktop/mobile direct routes.
- `node scripts/qa-invisible-world.mjs` — passed six added exhibits, 50 captures, 12 route entries.
- `npm run qa:resources` — completed in a fresh browser profile; software-WebGL results are recorded at [`evidence/baseline-runtime-resource-samples.json`](evidence/baseline-runtime-resource-samples.json).
- `npm run qa:journeys` — passed nine desktop/mobile scenarios after the production build; `docs/renaissance/evidence/journey-browser-checks.json` reports no browser or HTTP errors.

## Next action

Review the full diff, commit the baseline and curated-path milestone, then audit current per-exhibit serializers before designing versioned local saves. Keep the source branch and production untouched.
