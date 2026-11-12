# Armsteel Experiments

A self-hostable, browser-only digital museum for computational art. It uses React, TypeScript, and Vite, with Canvas 2D, WebGL2, WebGPU, and Web Workers for its studies. No application server, account, external API, image service, or runtime font request is required.

## Run locally

Install the locked dependencies with **npm ci**, then start the development server with **npm run dev**. Open the local URL printed by Vite (normally `http://localhost:5173`).

Create a production bundle with **npm run build**, then inspect it locally with **npm run preview**. Vite serves the client-side routes directly in preview mode.

## Checks

- **npm run build** runs the TypeScript project checks and creates the production bundle in `dist/`.
- **npm run test:numerics** checks deep-zoom coordinate precision, perturbation rendering, exact CPU repairs, and distinct tile detail at several zoom levels.
- **npm ls --depth=0** reports whether installed top-level dependencies match the package manifest.

There is no separate lint or unit-test script configured. The six exhibits are registered centrally in `src/registry.ts`; the build checks their imports and TypeScript integration.

## Publish on the Ubuntu host

For self-hosting this site with Caddy at [experiments.armsteel.dev](https://experiments.armsteel.dev), including the initial setup and future updates, see [deployment](docs/DEPLOYMENT.md).

## The exhibition

The exhibition is the collection entrance. Open a study and it becomes a fullscreen, viewport-filling environment. A floating glass dock provides previous/next navigation, a quick selector, random discovery, controls, information, pause, and fullscreen. Controls and the short concept note open as compact overlays; click outside or press Escape to close them. The dock can be hidden with **H** and returns when the pointer reaches the bottom edge.

Keyboard shortcuts: **← / →** move between studies, **Space** pauses or resumes, **F** toggles browser fullscreen, and **H** hides or shows the interface. Focused links and controls keep their normal keyboard behavior.

The collection contains six interactive studies:

- **The Infinite Shore** — Mandelbrot and Julia sets. The native range uses an immediate WebGL2 preview. Deep views use a WebGPU perturbation renderer: workers build high-precision BigInt reference orbits and send split-float orbit values plus binary exponents to the GPU, which evaluates pixels in independently scheduled tiles. During motion, an 84 ms scheduler beat renders a 20-tile patch around the cursor and limits CPU workers to half the pool; after a 220 ms gesture-idle interval, the full viewport queue takes over. In-flight calculations are kept and completed nearby tiles are cached. A scaled-orbit glitch test rebases difficult regions into smaller tiles; CPU workers recompute unresolved pixels from their exact coordinates. Camera movement reprojects the last image without waiting for tile rendering, and completed CPU tiles are warped into the live preview without copying the full viewport on every gesture. At CPU render completion, the frame is assembled directly from cached tile pixels so transient preview-layer state cannot leave gaps. Perturbation and exact-repair pixels share the same smooth color map. CPU rendering is the compatibility and device-loss fallback. Coordinates and share links retain decimal precision that grows with the zoom exponent; the zoom control has no arbitrary fixed ceiling. The numeric checks exercise sub-pixel coordinate separation through 10⁵⁰⁰× and compare actual perturbation and exact-repair colors across tile boundaries at 10⁵⁰×, while practical render time and memory still depend on hardware, iteration depth and viewport size.
- **A Quiet Current** — a WebGL2 stable-fluids solver using separate velocity, pressure, dye, and display grids. It performs velocity and dye advection, diffusion, divergence calculation, pressure projection, and vorticity confinement. RGBA16F render targets preserve smooth pigment on compatible hardware; a denser Canvas fallback is used when WebGL2 is unavailable. Silk, ink, smoke, and electric styles change simulation and rendering behavior. Drag to inject momentum and pigment; tune brush, viscosity, force, dissipation, palette, and ambient sources.
- **A Murmuration** — a spatially partitioned Boids simulation with separation, alignment, cohesion, predator avoidance, multiple populations, attractors, repulsors, obstacles, food, and long motion trails. Five scenes provide distinct initial conditions and interactions.
- **Weather, Remembered** — Lorenz, Rössler, Thomas, Aizawa, and Halvorsen systems integrated with fourth-order Runge–Kutta. Rotate and zoom the camera, change speed, parameters, trail length and color mapping, or pause the trajectory while inspecting it.
- **The Pattern Beneath** — a GPU Gray–Scott reaction–diffusion surface with a 9-point Laplacian, periodic concentration seeds, aspect-aware labyrinth and branching fields, high-density rendering, brush seeding, adjustable reaction rates, speed, quality and palettes. Traveling waves use a separate colliding-front regime. A CPU fallback is available without WebGL2.
- **A Grammar of Growth** — eight deterministic L-system grammars, including plants, coral and recursive geometry. Curved branches, animated growth, regeneration seeds, palette and structural controls, pan and zoom, and bounded grammar sizes keep exploration responsive.

Gallery search, category filters, favourites, and recently visited studies work in the browser. Exhibit share links encode the current control configuration in the URL. Browser storage is used only for favourites and recent visits.

## Architecture

    src/
      App.tsx                  exhibition, routing, immersive study shell, floating dock
      registry.ts              metadata and component registry for every study
      types.ts                 shared category, exhibit, and experiment contracts
      components/
        AmbientField.tsx       low resolution procedural ambient canvas
        ArtworkPreview.tsx     lazy, low-cost procedural gallery artwork
        Controls.tsx           compact floating glass controls and native inputs
      experiments/             isolated WebGL2, worker, canvas, and CPU fallback implementations
      workers/                 reference-orbit preparation and progressive CPU tile fallback
      lib/deepZoom.ts          scientific magnification, fixed-point coordinates, perturbation scales
      lib/mandelbrotGpu.ts     WebGPU perturbation compute, presentation, and bounded tile cache
      lib/storage.ts           browser-local favourites, visit history, URL state
      styles.css               design tokens, layout, responsive and motion rules

Each experiment is a default React component that accepts the shared ExperimentControls contract: paused state, control visibility, decoded URL state, a callback for serializing its current configuration, and an overlay-dismiss callback. The registry supplies exhibition and information copy separately from simulation code. Each active study owns the viewport; the shared shell only layers navigation and optional overlays above it.

## Add an experiment

1. Add a component in src/experiments/ that implements ExperimentControls.
2. Put canvas, simulation state, listeners, observers, animation frames, and graphics resources inside the component lifecycle. Clean them up when the component unmounts.
3. Pause simulation work when paused is true and when document.hidden is true. Limit canvas pixel ratio and use a ResizeObserver for the visible surface.
4. Build experiment-specific controls with ControlPanel, RangeControl, SelectControl, or Segmented. Keep each control set in its own component and close the overlay through the supplied callback.
5. Call onShareState() with serializable settings when those settings change. Initialize from stateFromUrl where the configuration can be restored safely.
6. Add complete visitor-facing copy and its component to src/registry.ts. The gallery and exhibit route are generated from that registry.

For The Infinite Shore, **npm run test:numerics** checks fixed-point coordinate round trips, pointer-focused zoom arithmetic, sub-double neighboring pixels through 10⁵⁰⁰×, known bounded/escaping points, and matching rendered colors from perturbation and exact repair across tile edges at 10⁵⁰×. The WebGPU path evaluates split-float reference orbits in tiles; Web Workers calculate high-precision BigInt reference orbits and provide progressive CPU tiles for compatibility and device-loss fallback. Completed reference orbits and rendered tiles are cached, while work near the cursor is prioritized during gestures. Software-only WebGPU implementations may be much slower than a hardware GPU; a previous headless Chromium SwiftShader check lost its WebGPU device and used the CPU fallback. Hardware WebGPU performance is device-dependent and is not claimed as verified here. A full CPU render is not a real-time substitute for the WebGPU path at large viewports.

The app is a client-side single page site. Vite preview serves route fallbacks for `/exhibits/:id`.
