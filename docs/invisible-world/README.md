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

- **Waves:** Leapfrog finite differences on a 192 × 120 cell field use `c·dt ≤ 1/√2`. Solid cells impose a zero-normal-flux stencil; the absorbing edge is a graded damping sponge, not a perfectly matched layer. Phase wander is a seeded random walk of source phase, a small finite-coherence approximation.
- **Optics:** Rays intersect line segments exactly within the 2D scene. Prism boundaries apply vector Snell refraction and Cauchy-style wavelength dispersion, including total internal reflection. The lens is paraxial and thin. Diffraction, interference, polarization and Fresnel intensity are outside this model.
- **Sound:** A local Web Audio `PeriodicWave` oscillator sums the selected harmonics and feeds a biquad low-pass and a quiet 5.5% gain. The plotted one-period waveform and FFT are generated from the same harmonic components; when filtering is enabled, the digital filter's magnitude and phase response are applied to each displayed partial. The spectrogram records that generated spectrum over time. The instrument is silent until a visitor acts and has a visible mute action.
- **Garden:** Organisms seek nearby food through a spatial hash, turn toward resources, pay movement and metabolism costs, and reproduce only after crossing an energy threshold. Offspring inherit speed, efficiency, metabolism and hue with bounded mutation; these traits change survival and energy conversion. Resources regenerate at a capped rate; the population is capped at 320 agents and food at 150 items. This is a constrained teaching ecology, without predation or a claim to model complete biological evolution.
- **Network:** Undirected links have integer tick latency, per-tick bandwidth and bounded FIFO queues. Dijkstra minimizes latency plus a queue-length penalty at each hop. Packets already in transit finish that hop; queued packets on a failed link return to routing and select another path. This is not TCP/IP: there are no acknowledgements, retransmission, variable packet sizes or Internet-scale routing protocols.
- **Lensing:** Equatorial Schwarzschild null geodesics use `d²u/dφ² + u = 3Mu²` with `u = 1/r`, integrated by RK4 from an asymptotic impact parameter. The critical capture boundary is `b = 3√3M`; escaped-ray deflection converges toward the weak-field `4M/b` limit. The synthetic star image applies a radial thin-lens source-plane projection to the numerically computed deflection. It is not a full finite-camera relativistic renderer or radiative-transfer calculation. The luminous disk is explicitly artistic.

## Performance shape

The wave field is fixed-size typed-array state; each animation frame advances a few stable stencil steps and colorizes an `ImageData` buffer. Optics traces are recomputed only when the arrangement or optical parameters change. Sound calculates the 2,048-sample FFT when the signal changes, then paints the instrument. Garden simulation updates at about 31 steps per second, paints at 30 fps, uses a food spatial hash, caps the population and bounds its trail history. Network updates every 78 ms, paints the small graph independently and retains at most 120 active packets (old records are pruned). Lensing computes the selected path locally and builds a 340-sample deflection table plus a maximum 620 × 500 warped image in a per-exhibit worker; the main thread draws at most five comparison paths.

Canvas quality is capped below native device-pixel ratio where needed. The browser review used software-rendered headless Chromium, so it verifies behavior and layout but is not a physical-GPU performance measurement. No claim about hardware GPU throughput is made.

## Correctness and browser review

```sh
npm run test:invisible-world
npm run verify
```

The focused checks cover wave propagation, the Courant boundary, long-run boundedness, barrier flux and linear superposition; ray intersections, reflection, Snell refraction, total internal reflection and dispersion; harmonic bins, `PeriodicWave` phase, low-pass magnitude and phase; seeded inheritance, bounded mutation, energy costs, population limits and sustained births/deaths; deterministic route choices, link failure, delivery and queue overflow; and Schwarzschild weak-field agreement, step-halving convergence, critical capture and mass scaling. The full verify suite additionally checks the original 13 studies and the 19-route page metadata/sitemap.

`scripts/qa-invisible-world.mjs` runs the six routes through Chrome DevTools Protocol. It captures opening, evolved, interaction, advanced, mobile interaction and mobile controls states, checks viewport overflow, exercises mobile touch and keyboard input, revisits each route twice through the SPA gallery, and captures both groups of new artwork previews plus collection search. The evidence set contains 45 PNGs. Start an isolated local Chromium first, with a fresh profile and the CDP port expected by the script:

```sh
/snap/bin/chromium --headless=new --no-sandbox --disable-dev-shm-usage \
  --user-data-dir=/tmp/armsteel-invisible-review \
  --remote-debugging-port=9345 --remote-allow-origins='*' \
  --no-first-run --no-default-browser-check about:blank
node scripts/qa-invisible-world.mjs
```

The script writes review captures to [`evidence/`](evidence/). Desktop captures use 1440 × 900 and mobile captures use 390 × 844 CSS pixels. These are review artifacts, not production or GPU benchmark evidence. No video recording was needed for this pass; the states are preserved as PNGs.

## Review checklist and remaining judgment

Before any release decision, a human should listen to the synthesized signal on an actual speaker/headphone setup, judge whether the garden remains engaging during longer unhurried visits, and assess the legibility of the low-level instrumentation at real phone viewing distance. The black-hole sky warp is deliberately a thin-lens projection layered over rigorously integrated Schwarzschild deflections; its visual mapping deserves a physicist's and an artist's further review. No study should be described as a comprehensive model of its underlying natural system.
