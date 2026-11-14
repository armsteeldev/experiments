# Reliability & Interaction Overhaul

Branch: `improvement/reliability-interactions`

Scope: Mandelbrot, Weather, Remembered, Gravity Playground, A Grammar of Growth, and shared website controls.

## Findings and changes

### Mandelbrot deep zoom

**Reproduction.** On a visible Chrome tab with WebGPU unavailable, the deep preset reached approximately `10^50×` and entered the CPU tile fallback. A complete viewport took 25.7 seconds for 1,215 tiles, with 100.2 seconds of aggregate worker CPU time. The browser process group was about 1,294–1,329 MiB RSS during this run; the page stayed open and emitted no `pageerror`, worker error string, or browser crash. The reproduced failure was a long, difficult-to-interrupt render rather than a hard crash. Rapid wheel input, panning, preset switching, and resetting during a later active render kept the tab responsive; reset took 277 ms and the first camera response after it was 16 ms.

**Cause.** Deep reference-orbit generation ran for long stretches without yielding or checking whether its camera generation was obsolete. Tile work from earlier camera positions could keep occupying workers while newer work queued. The WebGPU path was not available in this browser, so this also exposed the much slower CPU fallback.

**Fix.** Reference orbits now use typed arrays and cooperatively yield/check cancellation every 128 iterations. Camera changes cancel obsolete generations, the worker pool is capped at two, tile rows yield, and failed workers are removed and their current work is retried where possible. Existing bounded reference, CPU-tile, and GPU caches remain in place. This lets current input reclaim workers and bounds simultaneous render jobs without imposing a shallow zoom limit.

**After.** A second full `10^50×` CPU render completed in 28.1 seconds for 812 tiles, with 55.4 seconds aggregate worker CPU, about 18.4 MB page JS heap, and 6.5 MB CPU-tile cache. Tile counts differ because the browser's raster viewport differed, so wall times are not a like-for-like speed comparison. The worker CPU total was lower, memory remained bounded, and the tab stayed usable. Numerical tests cover coordinates to `10^500×`, perturbation/exact color agreement at `10^50×`, tile fingerprints at `10^20×`, `10^30×`, and `10^50×`, and cancellation of a long reference orbit.

Before: [deep preset before stress](evidence/armsteel-mandelbrot-before-stress.png) · After: [deep render after stress](evidence/armsteel-mandelbrot-after-deep-final.png)

### Weather, Remembered

**Cause.** The exhibit kept a 28,000-point trail in a shifting object array, allocated projected point objects and color arrays while drawing, and rebuilt the entire luminous canvas on every animation frame. Warm-up also ran thousands of integration steps synchronously. Browser profiling showed the Canvas2D redraw and its Chrome GPU-process cost dominated; the simulation's scalar RK4 work was not the main frame-time cost.

**Fix.** Trail history now uses a fixed-capacity typed-array ring buffer, projection uses reusable typed arrays, and RK4 updates reusable scalar scratch state. Warm-up and trail fill are spread over frames with a fixed step budget. Simulation continues at up to 60 Hz while full luminous draws are capped at 30 Hz and at most 14,000 points are drawn. The luminous layered paths and color treatment remain intact. The exhibit clears the buffer and animation resources on unmount.

**Comparable browser profile.** On a visible, hardware-accelerated Chrome build using an NVIDIA GeForce GTX 1660 SUPER (`ANGLE`, OpenGL 4.5), the exhibit ran Aizawa at speed 4 with a 28,000-point trail while the camera was dragged. Browser RAF results improved from 49.75 to 60.04 FPS; p95/p99 frame intervals changed from 33.4/66.7 ms to 16.8/16.8 ms, and intervals above 50 ms fell from 9 to 0. The earlier run recorded one 55 ms long task; the capped run recorded none. In process sampling around the draw cap, the Chrome process group fell from 120.5% to 51.9% of one CPU core, with the GPU subprocess from 104.5% to 43.7%; process RSS stayed roughly flat within each run. This is hardware-backed Chrome/Canvas2D evidence, not WebGPU compute. Other processes were using the machine's GPU, so system-wide GPU utilization is not attributed to this exhibit. When the browser window was occluded, observed exhibit draws were about 23.7 Hz under the 30 Hz ceiling.

Before: [full trail under stress](evidence/armsteel-weather-before-stress.png) · After: [full trail with capped redraw](evidence/armsteel-weather-after-30hz.png)

### Shared button styling

**Cause.** The shared style imports were present and there was no global reset overriding the controls. Utility buttons, filters, selection chips, and panel actions instead had weak or missing role-specific visual states, making them appear as unstyled text or low-contrast outlines.

**Fix.** Added targeted styling for those existing roles: liquid-glass utility controls, visible filter chips, selected segmented and preset states, distinct panel actions, pressed/disabled feedback, and consistent keyboard focus outlines. Mobile controls have at least 42–44 px targets where applicable. Exhibit-local controls retain their own class rules and styling.

**Browser checks.** Tested rendered homepage actions and collection search/filter/favourite states at desktop and mobile sizes. Search returned the expected single exhibit, Mathematics returned two, and Favourites returned one after toggling. Keyboard focus remained visible; measured search/favourite targets were 44 px and filter targets 42 px. A route sweep loaded all 13 exhibit pages at desktop size with their expected surface/title, no error panels, alerts, or page errors.

Before: [homepage controls](evidence/armsteel-home-buttons-before.png) · After: [homepage controls](evidence/armsteel-home-buttons-after.png) · [mobile homepage](evidence/armsteel-home-buttons-mobile-after.png) · [mobile collection and filters](evidence/armsteel-home-collection-mobile-after.png)

### Gravity Playground

**Cause.** Picking depended too closely on the visible body radius, while dragging directly replaced position and velocity. There was no clear distinction between editing a body's position and intentionally launching it.

**Fix.** Picking chooses the nearest center inside a zoom-aware screen-space radius (20 px desktop minimum, 28 px touch minimum), with a 44 px mobile visual target, selection ring, and preserved pointer offset. Pointer capture and cancel/Escape restore the body's original state. **Move** holds the selected body while the rest of the simulation evolves, then restores its original velocity on release. **Throw** is an explicit mode: recent pointer samples are converted to world units, filtered with a 45 ms minimum sample span, estimated over the last 180 ms, given a low-speed dead zone, and capped at 28 units/time. A stationary release therefore retains the original momentum. The launch arrow and predicted path use the gravity simulation.

**Checks.** Browser interaction selected a small 0.2-mass planet with the pointer 18 screen pixels from its center. Move repositioning preserved its velocity exactly; Throw produced a changed velocity, while the held body remained fixed and other bodies continued moving. Pointer capture remained active after the pointer left the hit target. Mobile at 360×740 and 390×844 kept the selected body's inspector and toolbar separated and the touch target at least 44 px. Simulation tests cover stationary release, noisy/short samples, launch clamping, zoom/frame-rate consistency, collision behavior, and existing conservation/orbit checks.

Before: [mobile gravity controls](evidence/armsteel-gravity-mobile-initial.png) · After: [small body selected on mobile](evidence/armsteel-gravity-mobile-selected-final.png) · [throw vector and predicted path](evidence/armsteel-gravity-throw-feedback.png)

### A Grammar of Growth

**Cause.** The fern had stiff, nearly mirrored fronds, the tree form lacked a broad canopy, and the previous fern presentation mixed a parametric plant with L-system framing. Coral and sea-fan patterns also needed visibly richer branching.

**Fix.** Rebuilt the fern as seeded, curved fronds with asymmetry, tapering paired leaflets, and adjustable branch spread. The tree is now an honestly labeled seeded parametric recursive branching model, with generations controlling its depth and curved branches supporting a broad canopy. Coral and sea fan remain L-system studies and now expose more of their branching and web structure. Growth is revealed in small chunks to avoid a burst at startup; captions distinguish parametric plants from L-system patterns.

**Checks.** Evolved desktop and mobile compositions were inspected, as well as the tree opening and evolved frames. Deterministic geometry checks cover 10,472 fern curves, 4,000 recursive tree curves, seed repeatability, silhouette variation, branch-angle changes, bounded coordinates, and tree crown proportions.

Before: [fern](evidence/armsteel-growth-fern-before.png) · [tree](evidence/armsteel-growth-tree-before.png) · [coral](evidence/armsteel-growth-coral-before.png)

After: [evolved fern](evidence/armsteel-growth-fern-evolved.png) · [evolved tree](evidence/armsteel-growth-tree-parametric.png) · [mobile tree](evidence/armsteel-growth-tree-mobile-evolved.png) · [evolved coral](evidence/armsteel-growth-coral-evolved-v2.png) · [evolved sea fan](evidence/armsteel-growth-fan-evolved-v3.png) · [mobile fern](evidence/armsteel-growth-fern-mobile-evolved.png)

## Verification

- `npm run verify` — passed: TypeScript production build, numerical tests, simulation tests, exhaustive Adder checks, fern/tree geometry checks, attractor trail tests, button-role tests, storage tests, and generated site/SEO/privacy checks.
- Real visible-browser route sweep — all 13 exhibit routes loaded at desktop size with no route error panel, alert, or page error. Targeted rendered interactions covered Weather, Gravity, Growth, and homepage collection controls on mobile.
- Hardware profile — visible Chrome with NVIDIA GeForce GTX 1660 SUPER through ANGLE/OpenGL. Weather is Canvas2D rendered; no WebGPU compute result is claimed.
- `git diff --check` — passed.

## Remaining limits

- A hard Mandelbrot tab or application crash was not observed, so its exact crash trigger remains unverified. The reproducible failure was a slow and resource-heavy `10^50×` CPU fallback render. Full-view CPU rendering still takes about 28 seconds here; hardware WebGPU rendering was unavailable in this browser. The interaction and cache improvements bound and cancel work, but do not make this CPU fallback fast.
- The before/after Mandelbrot viewport tile counts differ (1,215 versus 812), so wall-time comparison is not controlled. Browser process RSS after the second run was not captured; post-run page heap and tile-cache sizes were.
- Weather was profiled on one NVIDIA desktop and sustained for roughly 12 seconds per measurement. Global GPU use included other active processes; mobile-GPU performance and long-duration thermal behavior were not measured.
- Gravity units are intentionally dimensionless; launch velocity limits are interaction limits, not real-world calibrated units.

## Delivery

The verified work was committed locally; its hash is included in the completion handoff. No push, merge, or deployment was performed.
