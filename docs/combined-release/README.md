# Combined release candidate

Worktree: `/home/charlie/experiments-combined`
Branch: `improvement/combined-release`
Base: local `main` at `2af778f78da92ab15aebf66769319c3a2a86b42e`

This candidate integrates the accessibility, reliability, and computing work while retaining the recent art direction and opening states. It is for local review. No push, deploy, public-site update, or service change was made.

## Integration history

- `main` at `2af778f` was the starting point.
- `improvement/accessible-depth` (`de6ef29`) was fast-forwarded in.
- `improvement/reliability-interactions` (`6e8efd8`) was fast-forwarded next; it descends from accessibility.
- `improvement/computing-rethink` (`4261448`) was merged after reliability. This was the only merge commit. Git reported no textual conflicts.
- The accessibility worktree was also dirty: homepage, Fluid, Reaction Diffusion, Cellular Automata, Adder, styles, and `docs/design-audit/` had uncommitted changes. These files were inspected and the applicable visual work was copied into this candidate; the source worktree was left untouched. The computing redesign already has a compact mobile Adder stage, so its implementation was retained instead of reapplying the older Adder SVG patch.
- The GPU-backed Mandelbrot camera pan exposed an invalid `GPUQueue.copyTextureToTexture` call. The candidate now records the texture copy through a `GPUCommandEncoder` and submits it. This fix was exercised in the hardware-backed browser and is included in the candidate changes.

The protected source worktrees remain on their original commits. The original accessible-depth worktree remains dirty exactly as it was before integration.

## Preserved visual work

The candidate retains the large editorial headline and live Lorenz composition on the homepage, the asymmetric S-shaped Fluid current, the coral branching / patina-to-limestone Reaction Diffusion opening, and the horizontal Pulsar trio with its 3.5× mobile framing. The mobile Adder retains the newer computing redesign and its 620×500 gate stage, checked at 390 px with no horizontal overflow.

Direct desktop/mobile comparisons against the original `main` checkout are in [`screenshots/comparison.json`](screenshots/comparison.json). The side-by-side source captures are in [`screenshots/main-baseline`](screenshots/main-baseline) and [`screenshots/candidate-comparison`](screenshots/candidate-comparison). The original main worktree was detached and read-only during capture.

## Verification

`npm run verify` passed after the Mandelbrot GPU fix:

- TypeScript and production Vite build.
- Numerical deep zoom through 10⁵⁰⁰×, plus deep-zoom fingerprints and cancellation.
- Simulation checks for gravity, the CPU, backpropagation, logic, electrostatics, and cellular automata.
- Exhaustive 4-bit and 8-bit Adder pairs for ripple and look-ahead, plus 16-bit boundaries, overflow, traces, replay, and input changes.
- Fern determinism/geometry, attractor trail, button states, storage handling, and site generation.
- Site checks found 13 exhibits and 15 canonical URLs, with metadata, JSON-LD, icons, `robots.txt`, and sitemap intact.

The 26 desktop/mobile route measurements, screenshots, control-panel openings, first actions, and browser errors are recorded in [`screenshots/route-sweep/route-sweep.json`](screenshots/route-sweep/route-sweep.json) and [`screenshots/route-sweep/controls-and-first-actions.json`](screenshots/route-sweep/controls-and-first-actions.json). All 13 routes loaded at 1440×900 and 390×844, with no horizontal overflow or severe browser errors. The gallery, keyboard search, favourites, privacy page, direct exhibit refresh, dock selector, keyboard navigation, pause, hide/show, and fullscreen results are in [`screenshots/interactions/site-shell-validation.json`](screenshots/interactions/site-shell-validation.json). Space paused and resumed the exhibit with body focus in [`screenshots/interactions/keyboard-pause-validation.json`](screenshots/interactions/keyboard-pause-validation.json). The mobile selector exposed all 13 exhibits without overflow.

The candidate was rendered in headful Chromium 156 on the host with an NVIDIA GeForce GTX 1660 SUPER browser renderer. WebGPU was initially unavailable in the default session; with `--enable-unsafe-webgpu --enable-features=Vulkan,WebGPU`, `navigator.gpu.requestAdapter()` returned an adapter and Mandelbrot reported `backend: webgpu`. Weather itself uses the exhibit's Canvas2D renderer, so the browser renderer string is not evidence that this particular canvas drew through WebGPU.

## Mandelbrot stress results

The hard tab crash was not reproduced. The result is not a claim that it is definitively resolved.

- **CPU fallback:** 75 seconds at a 1440×900 viewport, starting at 10⁵⁰×. The stable 1,334-tile frame completed in about 45 seconds. During the same run I switched presets repeatedly, panned twice, reset during work, and issued four additional deep zooms. Two workers were the maximum. No tab crash, application exception, or console error occurred. The final changed frame was still progressing, at 91/1,334 tiles.
- **WebGPU:** the same 10⁵⁰× preset reached 345/345 tiles in about 80.1 seconds. Two workers were active; `cameraResponseMs` during pan was about 30 ms. JavaScript heap peaked around 265 MB during the reference-heavy phase and was about 94 MB at completion. Pan and reset completed without exceptions after the copy fix. No tab crash was observed.
- The CPU and GPU paths use different tile strategies, so the two render durations are not a controlled renderer benchmark. These deep views are expensive on this host and can show partial detail for many seconds. The stable completed WebGPU view is [`mandelbrot-stable-final.png`](screenshots/interactions/mandelbrot-stable-final.png); the CPU stress trace is [`mandelbrot-stress-validation.json`](screenshots/interactions/mandelbrot-stress-validation.json), and the WebGPU trace is [`mandelbrot-stable-render.json`](screenshots/interactions/mandelbrot-stable-render.json).

The earlier invalid queue-copy call and final no-error rerun are documented in [`mandelbrot-webgpu-validation.json`](screenshots/interactions/mandelbrot-webgpu-validation.json). The hardware path no longer fails immediately on pan, but the long render and heap peak remain open performance concerns.

## Weather, Remembered

The sustained run lasted 37.4 seconds with a 16,000-point trail, two drag rotations, and two wheel zooms. The exhibit reported Canvas2D, about 0.9–1.1 ms per draw, and 958 draws after starting at 86: approximately 23.3 actual canvas draws per second. The page's RAF probe was 59.99 Hz with 16.7 ms median and p95 intervals. There were no RAF intervals over 50 ms; one 53 ms long task occurred during initial page work. The isolated Chrome process group used about 38.6% of one CPU core over a 10-second sample. The RAF rate is not being presented as the exhibit's drawing rate.

The trail remains luminous and composed in [`weather-sustained-final.png`](screenshots/interactions/weather-sustained-final.png). A separate route-exit check found that the exhibit stopped drawing after teardown (one final count increment while cleanup completed, then flat) with no error: [`weather-cleanup-validation.json`](screenshots/interactions/weather-cleanup-validation.json). The measured draw rate is below a nominal 30 Hz target, though no sustained visible stutter or long-task burst was observed.

## Gravity interaction results

Real CDP mouse drags and emulated touch pointer events were used, not just simulation unit tests.

- A 0.5-mass body moved about 0.64 world units after a 45×15 px Move drag. Feedback said its original momentum was kept; its measured velocity changed by about 0.39 while gravity continued to act.
- A 100×20 px Throw drag released at about 1.26 units/time in the gesture direction. The UI reported the launch speed and displayed the selected body's velocity.
- Escape cleared pointer state; reset restored the six-body scene and cleared selection.
- “Launch body” created a near-circular orbit. Its radius stayed about 2.23 units over a 2.5-second sample; speed was about 20.93 units/time.
- A 390×844 touch-emulation drag repositioned the tiny body about 1.37 world units, with no overflow or browser error.

Detailed coordinates, feedback, and body state are in [`gravity-interaction-validation.json`](screenshots/interactions/gravity-interaction-validation.json). The small body's hit area also selected correctly from a 15 px offset at minimum, default, and maximum zoom (scales 20, 87.6, and 480) while the simulation was paused: [`gravity-hitbox-zoom-validation.json`](screenshots/interactions/gravity-hitbox-zoom-validation.json). These tests establish pointer/touch-emulation behavior, not physical touchscreen feel.

With a 2.0-mass body in a launched circular orbit, the visible prediction was compared with the body's rendered position 200, 500, and 1,000 ms later. The errors were about 5.5 screen pixels at each horizon (roughly half the prediction polyline's point spacing), with no browser exception: [`gravity-prediction-accuracy-validation.json`](screenshots/interactions/gravity-prediction-accuracy-validation.json). The overlay is [`gravity-predicted-trajectory-overlay.png`](screenshots/interactions/gravity-predicted-trajectory-overlay.png).

## Computing exhibits

- **The Adder:** browser calculations returned 2 for 1+1 (`0010`) and 8 for 5+3 (`1000`). The screen ties decimal inputs to binary places, gate signals, carry, and result. The mobile 5+3 state at 390 px has no horizontal overflow. A full 16-bit Kogge–Stone calculation completed with result 2 (`0000000000000010`) and carry 0; see [`adder-advanced-final-validation.json`](screenshots/interactions/adder-advanced-final-validation.json).
- **Inside the Machine:** real runs completed sum (7+5=12), comparison (7≠5), memory (store and retrieve 7 at place 3), and count (output 5). The displayed clock, instruction, registers, memory, and output advanced together. Evidence: [`machine-task-validation.json`](screenshots/interactions/machine-task-validation.json).
- **Neural Networks:** a blank map accepted teal and coral examples; undo and redraw changed the sample count; training lowered loss from 0.646 to 0.050 on this tiny sample; probing predicted teal at 0.628 confidence without adding a training point. This demonstrates meaningful state changes but is not evidence of generalization or novice comprehension. Evidence: [`neural-training-validation.json`](screenshots/interactions/neural-training-validation.json).
- **Logic Laboratory:** both starter switches changed the AND gate and lamp from 0 to 1. A new XOR component was placed and wired, and undo/redo restored edits. The open input state remained clearly marked. Evidence: [`logic-circuit-validation.json`](screenshots/interactions/logic-circuit-validation.json); the construction clip is [`logic-circuit-build.mp4`](recordings/logic-circuit-build.mp4).

The visual interaction clips are under [`recordings`](recordings), including the deep zoom, Weather animation, throw, Fluid gesture, Adder, CPU, Neural, Logic, and fern-growth states. The structured capture details are in [`recording-capture.json`](recording-capture.json). No human novice participants took part, so no claim of novice usability testing is made.

## Remaining issues and release readiness

1. **P2 — Deep rendering cost:** the 10⁵⁰× WebGPU view took about 80 seconds and heap reached about 265 MB; CPU fallback also needed about 45 seconds for a stable frame. The prior crash did not reproduce, but further longer-duration testing on other GPUs is still useful.
2. **P2 — Weather drawing cadence:** the measured Canvas2D draw loop averaged about 23.3 draws/s against a nominal 30 Hz target. CPU use and RAF pacing were modest and the image remained luminous; verify on a visible physical-GPU browser before tuning the fidelity/performance tradeoff.
3. **P2 — Small mobile dock controls:** most mobile dock buttons measured 34×38 px at 390 px width. The selector, touch interactions, and route remained usable, and the viewport did not overflow, but the hit targets are smaller than ideal.
4. **QA limit:** touch was emulated in Chromium and no novice participants or physical mobile devices were available.

The candidate is ready for local hands-on review. There is no technical route/build blocker found in this pass, but the deep-zoom memory/latency and Weather draw cadence should be accepted or addressed before describing the public release as fully performance-verified. Production publication remains intentionally unattempted.

## Local review

From the candidate worktree, start Vite with:

```sh
cd /home/charlie/experiments-combined && npm run dev -- --host 127.0.0.1 --port 5181 --strictPort
```

The screenshots and interaction JSON are under `docs/combined-release/screenshots/`. The short browser recordings are under `docs/combined-release/recordings/`.
