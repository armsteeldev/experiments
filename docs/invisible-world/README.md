# The Invisible World · engineering and review notes

This expansion adds six lazy-loaded exhibits to the 13-study collection. All six use subject-specific Canvas 2D compositions; the black-hole deflection table and lensed source image are calculated in a Web Worker. The sound instrument additionally uses Web Audio after an explicit visitor action. The new exhibits do not require WebGL or WebGPU.

## Local preview

From `/home/charlie/experiments-expansion`:

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5197
```

Open `http://127.0.0.1:5197/` or any route below:

| No. | Route | Model |
|---|---|---|
| 14 | `/exhibits/waves` | Damped 2D finite-difference wave equation |
| 15 | `/exhibits/optics` | 2D ray/segment tracing, Snell refraction, thin lens |
| 16 | `/exhibits/sound` | Fourier synthesis, radix-2 FFT, Web Audio |
| 17 | `/exhibits/garden` | Seeded agent ecology with inherited traits and energy |
| 18 | `/exhibits/network` | Discrete-tick packet queues and queue-aware Dijkstra |
| 19 | `/exhibits/lensing` | RK4 Schwarzschild null geodesics and sky projection |

The site has no account system. Audio remains off until “Listen to the signal” is pressed. Use the controls dock for presets, measurements, explanations and parameter ranges. Each canvas also has a keyboard entry: focus it with Tab, then follow its accessible label for the available keys.

## Model boundaries

- **Waves:** Leapfrog finite differences on a 288 × 180 cell field use `c·dt ≤ 1/√2`. The opening shows two phase-locked sources; presets include double-slit diffraction, opposing standing waves and a confined cavity. The cavity seeds a Neumann standing mode and drives it at the leapfrog stencil's calculated discrete resonance. Solid cells impose a zero-normal-flux stencil; the absorbing edge is a graded damping sponge, not a perfectly matched layer. Phase wander is a seeded random walk of source phase, a small finite-coherence approximation. The energy view estimates local kinetic and spatial-gradient density; emitters, damping and discretization mean this is not an exactly conserved energy integral. The model caps the field at 600,000 cells and continuous emitters at eight.
- **Optics:** Rays intersect line segments exactly within the 2D scene. Prism boundaries apply vector Snell refraction and Cauchy-style wavelength dispersion, including total internal reflection. The lens is paraxial and thin. Diffraction, interference, polarization and Fresnel intensity are outside this model.
- **Sound:** A local Web Audio `PeriodicWave` oscillator sums the selected harmonics and feeds a biquad low-pass and a quiet 5.5% gain. Sine, triangle, square and saw presets use their Fourier-series coefficients. The plotted one-period waveform, FFT and rolling spectrogram are generated from the same harmonic components; when filtering is enabled, the digital filter's magnitude and phase response are applied to each displayed partial. The instrument is silent until a visitor acts, has a visible mute action and closes its audio context on route exit.
- **Garden:** Organisms seek nearby food through a spatial hash, turn toward resources, pay movement and metabolism costs, and reproduce only after crossing an energy threshold. Offspring inherit speed, efficiency, metabolism and hue with bounded mutation; these traits change survival and energy conversion. Resources regenerate at a capped rate; the population is capped at 320 agents and food at 150 items. This is a constrained teaching ecology, without predation or a claim to model complete biological evolution.
- **Network:** Undirected links have integer tick latency, per-tick bandwidth and bounded FIFO queues. Dijkstra minimizes latency plus a queue-length penalty at each hop. Packets already in transit finish that hop; queued packets on a failed link return to routing and select another path. This is not TCP/IP: there are no acknowledgements, retransmission, variable packet sizes or Internet-scale routing protocols.
- **Lensing:** Equatorial Schwarzschild null geodesics use `d²u/dφ² + u = 3Mu²` with `u = 1/r`, integrated by RK4 from an asymptotic impact parameter. The critical capture boundary is `b = 3√3M`; escaped-ray deflection converges toward the weak-field `4M/b` limit. The interactive ray-path view is drawn from these trajectories and marks the `2M` horizon and `3M` photon sphere. The synthetic star image uses a radial thin-lens source-plane projection driven by the numerically computed deflection table; it is not a full finite-camera relativistic renderer. Its luminous disk and rings are explicitly artistic, not radiative transfer.

## Performance shape

The wave field is fixed-size typed-array state; each animation frame advances a few stable stencil steps and colorizes a reusable `ImageData` buffer. Optics traces are recomputed only when the arrangement or optical parameters change. Sound calculates the 2,048-sample FFT when the signal changes, then paints the instrument and appends a spectrogram column every 70 ms of simulation time. Garden simulation updates at about 31 steps per second, paints at 30 fps, uses a food spatial hash, caps the population at 320 and bounds its trait history. Network updates every 78 ms, paints the graph independently and retains at most 120 active packets (old records are pruned). Lensing computes selected paths locally and builds a 340-sample deflection table plus a maximum 620 × 500 warped image in a per-exhibit worker; its rasterizer has a 1.2-million-pixel ceiling, while the main thread draws at most five comparison paths.

Canvas quality is capped below native device-pixel ratio where needed. The browser review used software-rendered headless Chromium, so it verifies behavior and layout but is not a physical-GPU performance measurement. No claim about hardware GPU throughput is made.

## Correctness and browser review

```sh
npm run test:invisible-world
npm run verify
npm run qa:existing
npm run qa:resources
```

The focused checks cover wave propagation, the Courant boundary, long-run boundedness, barrier flux and linear superposition; ray intersections, reflection, Snell refraction, total internal reflection and dispersion; harmonic bins, `PeriodicWave` phase, low-pass magnitude and phase; seeded inheritance, bounded mutation, energy costs, population limits and sustained births/deaths; deterministic route choices, link failure, delivery and queue overflow; and Schwarzschild weak-field agreement, step-halving convergence, critical capture and mass scaling. The full verify suite additionally checks the original 13 studies and the 19-route page metadata/sitemap.

`npm run qa:existing` adds direct Chrome checks for all 13 pre-expansion routes at 1440 × 900 and 390 × 844. It verifies a mounted titled canvas, stage bounds, document overflow and browser errors, then writes `evidence/existing-route-regression.json`.

`npm run qa:resources` records an 18-second evolving-garden sample, 120 requestAnimationFrame intervals and eight SPA remounts in `evidence/runtime-resource-samples.json`. In the clean software-Chromium run, post-GC listeners settled at 177, DOM nodes at 266, and heap estimates fluctuated around 5.5 MiB by the last remounts. Frame intervals were 33.4 ms median and 50.1 ms at p95. These short-run process counters and frame intervals are not a device-wide memory or physical-GPU benchmark.

`scripts/qa-invisible-world.mjs` runs the six routes through Chrome DevTools Protocol. It captures opening, evolved, interaction, advanced, mobile interaction and mobile controls states, checks viewport overflow, exercises mobile touch and keyboard input, verifies audio starts muted and is closed on route exit, confirms messages sent by selecting graph nodes arrive, captures the double-slit, standing-wave and resonant-chamber presets, exercises the garden near its population cap, revisits each route twice through the SPA gallery, and captures the collection previews plus search. The evidence set contains 50 PNGs.

Run this check through the resource supervisor, which owns its preview, Chromium profile and browser lifecycle:

```sh
npm run build
npm run qa:invisible-world
```

Run it only when the QA supervisor reports that host memory, swap, CPU pressure and temperature are within its safety limits. It does not force SwiftShader or delete test evidence. Do not start a separate Chromium for the script.

The script writes review captures to [`evidence/`](evidence/). Desktop captures use 1440 × 900 and mobile captures use 390 × 844 CSS pixels. These are review artifacts, not production or GPU benchmark evidence. No video recording was needed for this pass; the states are preserved as PNGs.

## Review checklist and remaining judgment

Before any release decision, a human should listen to the synthesized signal on an actual speaker/headphone setup, judge whether the garden remains engaging during longer unhurried visits, and assess the legibility of the low-level instrumentation at real phone viewing distance. The black-hole sky warp is deliberately a thin-lens projection layered over rigorously integrated Schwarzschild deflections; its visual mapping deserves a physicist's and an artist's further review. No study should be described as a comprehensive model of its underlying natural system.
