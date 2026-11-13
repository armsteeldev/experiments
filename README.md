# Armsteel Experiments

A browser-based digital museum of thirteen interactive studies in mathematics, physics, computing, electronics, artificial life, and generative art. The client uses React, TypeScript, and Vite with Canvas 2D, WebGL2, WebGPU, and Web Workers where available. Production is a static site served by Caddy; it has no application server or account system.

## Local development

```sh
npm ci
npm run dev
```

Vite prints the local development URL. To inspect the production bundle locally:

```sh
npm run build
npm run preview
```

## Verification

`npm run verify` runs the TypeScript and production build, deep-zoom numerical checks, simulation checks, exhaustive Adder checks, browser-storage checks, and generated SEO/site-file checks. It creates `dist/`, including a static HTML entry for each exhibit and the privacy page.

Focused checks are available as `npm run test:numerics`, `npm run test:simulations`, `npm run test:adder`, `npm run test:storage`, and `npm run check:site`. The numerical suite covers coordinates and rendering details through very deep zooms; actual render speed depends on the visitor's graphics hardware.

## The collection

The public routes are generated from `src/data/experiments.json`:

1. The Infinite Shore — Mandelbrot and Julia sets
2. A Quiet Current — interactive fluid motion
3. A Murmuration — collective flocking
4. Weather, Remembered — strange attractors
5. The Pattern Beneath — reaction–diffusion
6. A Grammar of Growth — Lindenmayer systems
7. Gravity Playground — N-body gravity
8. Inside the Machine — an 8-bit teaching computer
9. Neural Networks — a trainable decision surface
10. Logic Laboratory — editable Boolean circuits
11. Invisible Forces — electrostatic fields
12. Cellular Automata — local rules on a wrapped grid
13. The Adder — ripple-carry and Kogge–Stone circuits

Each study is lazy-loaded as its own route chunk. The shared shell handles navigation, descriptions, favourites, and browser history. WebGL2 studies have Canvas or CPU fallbacks where implemented; WebGPU accelerates deep Mandelbrot views when supported and available.

## Add an exhibit

1. Implement a component in `src/experiments/` using the `ExperimentControls` contract in `src/types.ts`. Clean up animation frames, workers, observers, and graphics resources when the component unmounts.
2. Add complete visitor-facing copy and a unique `metaDescription` to `src/data/experiments.json`.
3. Add its lazy component import to the matching ID in `src/registry.ts`.
4. Run `npm run verify`. The checks cover duplicate IDs/numbers, route output, descriptions, structured data, and sitemap membership.

Titles, descriptions, canonicals, Open Graph tags, JSON-LD, route HTML, the sitemap, and `robots.txt` are generated from the registry and `src/data/site-copy.json` during the Vite production build. Route pages contain useful static HTML before React loads; the interactive application then takes over in the browser.

## Privacy and browser support

The app has no analytics, advertising, tracking cookies, third-party scripts, or remote fonts. Favourites are written to local storage only after a visitor saves one; recently viewed studies stay in tab memory. Shared settings are encoded in the URL and are not encrypted. See [Privacy](https://experiments.armsteel.dev/privacy).

Use a current browser with JavaScript, Canvas 2D, and Web Workers enabled. WebGL2 is used by several visual studies; WebGPU is optional. If a graphics feature is unavailable, the relevant study uses its implemented fallback or explains that it could not open.

## Publish

The GitHub push does not deploy the site. After reviewing and approving a release on the Ubuntu host, run `npm run publish`. It runs `npm run verify`, stages the static output in a versioned release, and atomically switches the Caddy document-root symlink. Apply a reviewed Caddy hardening update separately with `sudo bash deploy/update-caddy.sh`. See [Deployment](docs/DEPLOYMENT.md) for first installation, public checks, and rollback.

## Structure

```text
src/
  data/                 exhibit metadata and shared page copy
  experiments/          isolated interactive studies and fallbacks
  components/           collection previews, controls, boundaries, and effects
  simulations/          deterministic simulation engines
  workers/              fractal and preview workers
  lib/                  browser storage, metadata, and deep-zoom math
scripts/                repeatable correctness and site-generation checks
deploy/                 scoped Caddy configuration and release scripts
docs/                   deployment details
```
