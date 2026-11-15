# Renaissance baseline

Captured 2026-11-15 on `renaissance/next-generation` at `cd76da9` (`Elevate the Invisible World exhibits`), before Renaissance implementation. The base is a descendant of combined-release commit `dfe47f7`; the original nineteen-exhibit expansion and shared worktrees remain untouched.

## Product and architecture

- The collection has 19 stable exhibit IDs and lazy route imports. The homepage exposes all exhibits, category filters, text search, favourites, recent visits, a featured work, previews, and a “Surprise me” action.
- Exhibit pages share a fullscreen shell with a study selector, sequential navigation, random discovery, Controls and About panels, pause, fullscreen, related exhibits, favourite state, and shareable parameter links. Recent visits live only in memory; favourites use local storage.
- Six added studies have focused numerical/model checks and browser review evidence. The collection contains Canvas 2D, WebGL, worker and audio paths; the Living Garden currently caps its population at 320.
- There is no curated multi-exhibit path UI or saved collection of named experiment states.

## Fresh verification

`npm ci` installed the lockfile dependencies with zero reported vulnerabilities. `npm run verify` passed: TypeScript and Vite build, all numerical/simulation/storage checks, and static metadata/page checks for 19 exhibits and 21 canonical URLs.

Production build output:

| Asset group | Raw size | Gzip |
|---|---:|---:|
| Initial JavaScript (`index-BXj_M9mC.js`) | 338.41 kB | 109.27 kB |
| Initial CSS (`index-ntHuyKTh.css`) | 97.60 kB | 21.38 kB |
| Lazy exhibit JavaScript | 11.37–53.01 kB each | 4.86–17.36 kB each |
| Preview raster worker | 0.87 kB | not reported |
| Mandelbrot and lensing workers | 7.48 kB and 5.57 kB | not reported |

All 19 exhibit pages are statically generated. `check:site` verifies unique metadata, route registration, page titles/descriptions, JSON-LD, canonical links, sitemap, robots, privacy, and the not-found page.

## Browser and interaction evidence

- `npm run qa:existing` passed 13 established exhibit routes at 1440×900 and 390×844 CSS pixels. It verified a titled mounted exhibit, visible canvas/SVG/content, stage bounds, no document-width overflow, and no browser or HTTP errors. Results are in [`evidence/existing-route-regression.json`](../invisible-world/evidence/existing-route-regression.json).
- `node scripts/qa-invisible-world.mjs` passed the six added exhibits, captured 50 opening/evolved/interaction/advanced/mobile states, exercised 12 repeated SPA entries, verified audio cleanup and network delivery, and recorded no browser or HTTP errors. Captures are in [`docs/invisible-world/evidence`](../invisible-world/evidence/).
- The garden run covers opening, evolution, intervention and high population. Its model tests include bounded population, inheritance and energy costs. Scientific limitations for the six added studies are documented in [`docs/invisible-world/README.md`](../invisible-world/README.md).

## Performance sample

[`evidence/baseline-runtime-resource-samples.json`](evidence/baseline-runtime-resource-samples.json) contains a clean-profile run of the existing `qa:resources` script: one 18-second evolving-garden interval, 120 animation-frame intervals, and eight SPA unmount/remount cycles with forced V8 collection between samples.

The browser was HeadlessChrome 157 on a host with 6 reported logical CPUs and 16 GiB reported device memory. Chromium was launched with `--use-angle=swiftshader-webgl`; these are software-rendered results, not GTX 1660 SUPER measurements. Frame intervals were 33.4 ms median and 50.0 ms p95. The model grew from 34 to 44 organisms. After collection, listener counts settled at 176 across eight remounts; DOM node counts were 383 initially and 389 after the first remount, then remained stable. Post-GC heap estimates fluctuated between 2.7 and 3.4 MiB across the last cycles. These are short-lived Chromium process counters, not device-wide memory or long-run leak proof.

The host has an NVIDIA GeForce GTX 1660 SUPER, but this headless browser selected SwiftShader. No physical-GPU or phone performance claim is established here. Baseline browser screenshots and route evidence establish rendered behavior/layout only.

## Findings to carry forward

1. The gallery read primarily as a featured item followed by a long grid; exhibit relationships were dispersed across About panels. Four compact, optional editorial routes now connect eighteen stops and carry their context between exhibits.
2. Route state sharing was parameter-only and unversioned. New links now use a versioned wrapper with legacy decoding, and named local settings have validation and storage caps. Per-exhibit bounds and deterministic-seed behavior still need a deeper audit.
3. Browser automation was unusually strong for a personal project, but `qa:invisible-world` lacked a package script. The command now exists; curated paths, local notebooks and state sharing have focused browser workflows.
4. Headless software rendering is substantially slower than physical GPU rendering and is a poor target for raw frame-rate acceptance. Continue measuring correctness and lifecycle in Chromium; use hardware runs only when the selected renderer is verified.
5. Visual review confirms excellent simulation-specific artwork and a consistent dark atmosphere. Several information labels remain very small, while the gallery provides limited conceptual orientation before visitors enter an exhibit.

## First validated change: curated paths

Four editorial paths now connect 18 collection stops across Patterns, Forces, Machines and Signals. Paths are selectable in the gallery, can start at any stop, carry their identifier in the URL, show progress and contextual notes in the exhibit About panel, and can be exited at any time. Validation covers the five-stop Patterns path from start to completion, keyboard path selection, a direct stop link, refresh, invalid path association, touch-emulated mobile and a 320px gallery.

The follow-up production build measured an initial JS chunk of 344.92 kB raw (111.22 kB gzip) and initial CSS of 103.68 kB raw (22.68 kB gzip). This is an increase of 6.51 kB raw / 1.95 kB gzip JS and 6.08 kB raw / 1.30 kB gzip CSS. Exhibit lazy chunks did not change. The path browser review is recorded in [`evidence/journey-browser-checks.json`](evidence/journey-browser-checks.json), with representative [desktop gallery](evidence/journey-gallery-desktop.png), [mobile gallery](evidence/journey-gallery-mobile.png), and [mobile exhibit path](evidence/journey-step-mobile.png) captures.

## Second validated change: reproducible configurations

The About panel can save the current supported settings under a visitor-chosen name. The collection places saved entries just before the card grid when any exist; each can reopen its validated settings link or be removed. The local notebook uses a version 1 schema, registered exhibit IDs, JSON-safe values, 16 KiB per state, at most twelve entries and 128 KiB total. If browser storage is blocked, it reports a tab-only save rather than implying persistence. The About and privacy copy makes clear that settings/presets are stored, not the running simulation’s full history or live buffers. Local saves are not sent to the site.

Shared URLs now contain a `{ "$armsteel": 1, "state": { ... } }` envelope. Older unversioned flat state links remain readable; unsupported future envelopes are ignored without blocking exhibit entry. URLs still use Base64 URL encoding, which is not encryption. All nineteen exhibits were exercised in a browser through share and reload. The sweep exposed a missing Adder serializer; it now restores supported circuit width, architecture, inputs and speed. An edited 8-bit Kogge–Stone setup (23 + 17) reopened with the visible controls intact and showed the result 40. The Living Network restores its 48-character message payload; that input and the save/privacy copy warn visitors to use fictional text, since it appears in saved and shared settings.

The build after the notebook and state-sharing changes measured 351.17 kB initial JS raw (113.25 kB gzip) and 107.17 kB initial CSS raw (23.33 kB gzip); the Adder lazy chunk was 19.61 kB (7.84 kB gzip) and Living Network was 16.41 kB (6.47 kB gzip). The latest build after the shared-shell refinements measures 351.64 kB initial JS raw (113.45 kB gzip) and 107.92 kB initial CSS raw (23.45 kB gzip). Relative to the baseline, initial JS grew 13.23 kB raw / 4.18 kB gzip, and initial CSS grew 10.32 kB raw / 2.07 kB gzip. The latest shell changes add a small focus observer and correct nested selector styling; they do not change exhibit chunk sizes. No dependency or backend service was added. The Adder serializer added 0.42 kB raw / 0.19 kB gzip to its lazy chunk; the Network restore/input disclosure added 0.29 kB raw / 0.10 kB gzip to that lazy chunk and 0.21 kB / 0.08 kB to initial JS. `npm run verify`, `qa:journeys`, `qa:saved-experiments`, and `qa:state-sharing` passed; state sharing has no browser or network errors for all nineteen exhibits. Evidence: [saved About form](evidence/saved-setup-about-desktop.png), [gallery notebook desktop](evidence/saved-notebook-gallery-desktop.png), [gallery notebook mobile](evidence/saved-notebook-gallery-mobile.png), [edited Adder settings](evidence/state-sharing-adder-settings.png), [`saved-experiment-browser-checks.json`](evidence/saved-experiment-browser-checks.json), and [`state-sharing-browser-checks.json`](evidence/state-sharing-browser-checks.json).

Export/import is not implemented. Per-exhibit validators accept different ranges and formats, so the state-sharing sweep establishes a valid envelope and route recovery, not a scientific guarantee that every arbitrary external setting will reproduce identically. Physical-GPU results remain unavailable; browser captures use HeadlessChrome with SwiftShader.

## Gallery preview first-paint and lifecycle follow-up

`npm run qa:gallery-previews` checked all 19 previews at 1440×900 and 390×844 in HeadlessChrome 157 with SwiftShader/touch emulation. All 38 canvases painted, neither viewport overflowed horizontally, hover caused a measurable change in the interactive L-system preview, pointer leave restored the sampled pixels, and reduced-motion emulation prevented preview animation.

The test instruments worker creation/termination across gallery exit and return. Before the fix, the shared preview raster worker remained alive after gallery unmount. After the fix it created once and terminated once at unmount; active worker count was zero after exit and remained zero after returning to the cached gallery. Unmounting the last preview also clears pending jobs and preview canvas caches. A pixel signature check on the animated entrance preview confirms it changes while visible, stops while well outside the viewport, and resumes when brought back. This is a targeted page-level cleanup/scheduling check, not a broad long-run memory measurement.

Representative captures: [desktop gallery](evidence/gallery-collection-desktop.png), [interactive preview hover](evidence/gallery-preview-hover-desktop.png), [phone gallery](evidence/gallery-collection-mobile.png), and the [homepage hero on desktop](evidence/home-hero-preview-desktop.png) and [phone](evidence/home-hero-preview-mobile.png). At this checkpoint the initial bundles are 351.89 kB JavaScript raw / 113.55 kB gzip and 107.92 kB CSS / 23.45 kB gzip; no new dependency was added.

## Concept discovery and curated recommendations

The gallery search accepts structured editorial concepts in addition to exhibit prose, titles and methods. When the optional search panel opens with an empty query, it offers six concise starting points: emergence, recursion, waves, learning, fields and computation. Idea prompts disappear after selection, leaving the ordinary search and result count. No-results text is a live status and the clear action remains available. Curated concept phrases live alongside each exhibit’s metadata; they are local static content and are not derived from visitor behavior.

All nineteen About panels now present two or three editor-selected related works. The relationship lists use scientific or interaction connections; the lensing study has two because a third recommendation was less useful. `check:site` validates every tag and link. `qa:collection-discovery` checked exact result sets for all six prompts, empty-state and focus recovery, favorites and recent visits, six 40 px phone targets without overflow, all nineteen recommendation lists and one actual transition through a related link. HeadlessChrome 157 / SwiftShader reported no browser or network errors. Captures: [desktop idea search](evidence/collection-ideas-desktop.png), [phone idea search](evidence/collection-ideas-mobile.png), and [`collection-discovery-browser-checks.json`](evidence/collection-discovery-browser-checks.json).

The production build now measures 354.35 kB initial JavaScript (114.25 kB gzip) and 108.79 kB initial CSS (23.66 kB gzip). Relative to the nineteen-exhibit baseline, the initial payload grew by 15.94 kB raw / 4.98 kB gzip JavaScript and 11.19 kB raw / 2.28 kB gzip CSS. The discovery change adds no package, network service or visitor tracking; exhibit code remains lazy loaded.

The overlay regression also applies a DOM naming heuristic to visible buttons, links and form controls inside Controls, About and the exhibit selector. Its full 19-route × six-viewport matrix recorded 4,452 observations and no unnamed items. It checks common explicit sources—ARIA labels/references, associated labels, text and titles—but is not the browser’s computed-name algorithm, a WCAG audit or evidence from a screen reader. Physical assistive-technology review remains open.

## Third validated change: shared exhibit navigation and overlays

The first full overlay review covered all nineteen exhibits at 320×740, 390×844, 768×1024, 1024×768, 1440×900 and 844×390. It exposed a mobile dock that placed some controls beyond the glass frame and a selector stylesheet whose direct-child selector did not reach the nested option list. Phone layouts now keep the home action, current-study chooser, Controls, About, pause and fullscreen visible as 44×44 px targets; the selector contains all nineteen destinations with 44 px scrollable rows. Sequential previous/next actions remain available on wider screens and the chooser exposes all destinations on phones.

The same browser sweep found that a control overlay could open before a lazy exhibit module mounted its controls, so a one-frame focus attempt could miss. The shell now observes the active exhibit until its panel exists and is focusable, then disconnects after focusing, closing, route change or a 2.5-second failure timeout. The rerun passed 456 dock/panel checks with no findings and no browser or network errors. Its capture of the narrow mobile chooser is [`evidence/exhibit-selector-320-mobile.png`](evidence/exhibit-selector-320-mobile.png), and full measurements are in [`evidence/exhibit-overlay-review.json`](evidence/exhibit-overlay-review.json). The review uses HeadlessChrome 157 with SwiftShader and touch/viewport emulation; it does not establish screen-reader or physical-phone behavior.

## Fourth validated change: high-density Flocking

The `Predator and prey` scenario previously created and populated a per-agent `Set` to deduplicate wrapped grid cells and searched 49 mixed-species cells for each prey bird on every update. It now walks the same unique toroidal neighborhood without a per-agent allocation, keeps predators in a compact list for prey-nearest searches, and scales steering vectors without creating temporary arrays. Neighborhood ordering, wrap seams, vector limiting, and the predator radius are checked against the former grid algorithm in `test:flocking-grid`.

`qa:flocking-performance` compares the exact pre-change commit `611ee7a` with the optimized build in the same HeadlessChrome 157 setup: Canvas 2D via SwiftShader/Vulkan, 1440×900, the `Predator and prey` scenario, 1,400 agents and 132 px awareness. Both runs configure the same visible controls, pause/resume once, then record three 2.2-second trials. The table reports the median of those three trial-level statistics.

| Measurement | Before | After | Change |
|---|---:|---:|---:|
| Page animation-callback median | 32.9 ms | 11.3 ms | 65.7% lower |
| Page animation-callback p95 | 79.7 ms | 21.1 ms | 73.5% lower |
| RAF timestamp interval median | 66.6 ms | 50.0 ms | 24.9% lower |
| RAF timestamp interval p95 | 116.8 ms | 66.7 ms | 42.9% lower |
| Long tasks over 50 ms / 2.2-second trial | 33 | 6 | 81.8% fewer |

The callback and long-task timings are page-level measurements, not isolated simulation-only profiles. The resulting median 50 ms frame interval still falls well short of 60 Hz. These are software-rendered headless figures and do not establish performance on a physical GPU or phone. Exact trials and caveats are recorded in [`evidence/flocking-performance-before.json`](evidence/flocking-performance-before.json) and [`evidence/flocking-performance-after.json`](evidence/flocking-performance-after.json); the evolved scene is [`evidence/flocking-predator-evolved.png`](evidence/flocking-predator-evolved.png). The new helper and regression scripts add 0.34 kB raw / 0.21 kB gzip to the lazy Boids chunk; the initial JavaScript bundle is unchanged.
