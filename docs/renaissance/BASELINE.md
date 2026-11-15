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

1. The gallery reads primarily as a featured item followed by a long grid; the exhibit relationships are useful but dispersed across About panels. Add a compact, optional curated route that carries its thread between exhibits.
2. Current route state sharing is parameter-only and per-exhibit-defined; the decoder rejects malformed and oversized values but has no explicit shared-state schema/version. Saved named configurations would need an explicit versioned local format and quotas.
3. Browser automation is unusually strong for a personal project, but `qa:invisible-world` is documented and implemented without a corresponding `package.json` script. Add a reliable command and extend tests around new collection flows.
4. Headless software rendering is substantially slower than physical GPU rendering and is a poor target for raw frame-rate acceptance. Continue measuring correctness and lifecycle in Chromium; use hardware runs only when the selected renderer is verified.
5. Visual review confirms excellent simulation-specific artwork and a consistent dark atmosphere. Several information labels remain very small, while the gallery provides limited conceptual orientation before visitors enter an exhibit.

## First validated change: curated paths

Four editorial paths now connect 18 collection stops across Patterns, Forces, Machines and Signals. Paths are selectable in the gallery, can start at any stop, carry their identifier in the URL, show progress and contextual notes in the exhibit About panel, and can be exited at any time. Validation covers the five-stop Patterns path from start to completion, keyboard path selection, a direct stop link, refresh, invalid path association, touch-emulated mobile and a 320px gallery.

The follow-up production build measured an initial JS chunk of 344.92 kB raw (111.22 kB gzip) and initial CSS of 103.68 kB raw (22.68 kB gzip). This is an increase of 6.51 kB raw / 1.95 kB gzip JS and 6.08 kB raw / 1.30 kB gzip CSS. Exhibit lazy chunks did not change. The path browser review is recorded in [`evidence/journey-browser-checks.json`](evidence/journey-browser-checks.json), with representative [desktop gallery](evidence/journey-gallery-desktop.png), [mobile gallery](evidence/journey-gallery-mobile.png), and [mobile exhibit path](evidence/journey-step-mobile.png) captures.
