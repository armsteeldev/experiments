# Exhibition Renaissance

Local experience and browser QA for branch `improvement/exhibition-renaissance`.
These changes have not been pushed, merged, or deployed.

## What changed

### The Adder — major redesign

The old default put the full gate graph on screen at once, making individual
signals too small to follow. The new default is a focused four-bit ripple
machine calculating **5 + 3**. Inputs become binary, one full-adder slice is
framed at a time, real gate outputs and carry wires illuminate as the existing
gate trace resolves, and the sum is shown at the end. The visitor can replay,
step in either direction, pause, change speed, inspect gates, or switch to 8/16
bits and Kogge–Stone. Timing is illustrative; values and transitions come from
the real circuit evaluator. The result is no longer pre-announced by the
opening composition.

The redesign changes the experience from surveying a dense schematic to
following one calculation through a physical-feeling instrument. At the end of
the default run, the displayed sum is `1000` (8), with carry 0. This is clearer
and more inviting; it is still a stylized logic instrument, rather than a
literal electronic breadboard.

### Inside the Machine — major redesign

The processor is now the central, larger visual object. Register bank, RAM,
program memory, instruction register, decoder, ALU, and output have clearer
roles and stronger legibility. Execution highlights and animated data paths
follow the actual fetch/decode/execute state. The same CPU model and controls
remain in use.

The example program loads 7 and 5, adds them, writes the result to output, and
halts. Browser playback reached `RA = 12`, `RB = 5`, output `12`; the decode,
execute, and write-to-output states were inspected separately.

### A Grammar of Growth — major redesign

The default turtle orientation and fit were corrected so the fern grows upright
and sits in the viewport above the floating dock. The default now grows from a
seeded, parametric cluster of five curved fronds, paired pinnae, and smaller
leaflets. The foliage unfolds in base-to-tip order over several seconds;
pausing preserves the current growth state. Other branching presets continue
to use their own L-system rewrite rules. The wider composition reads as a fern
and stays clear of the dock on desktop and mobile; zoom and pan remain available.

### Other exhibits

- **A Quiet Current:** retained the real WebGL2 velocity, pressure, vorticity,
  and pigment simulation. The opening pigment field is denser, color persists
  longer, and the live source contributes more continuously. The fluid develops
  detailed turquoise curls over time; dragging injects real momentum and dye.
- **Gravity Playground:** retained the Verlet gravity simulation and trails.
  The opening planets now occupy varied orbital phases and use circular-orbit
  velocities. Launching a body gives explicit feedback and creates a new
  trajectory in the live system.
- **A Murmuration:** retained flocking behavior while separating plumage
  variation from behavioral species. The default starts as a compact, moving
  flock, uses varied rounded bird forms and shorter trails, and remains more
  coherent over time. Attractor and predator presets were exercised.
- **The Pattern Beneath:** retained the Gray–Scott reaction-diffusion solver.
  Finer multi-scale initial noise and a labyrinth seed produce more intricate
  structures; the verdigris palette and live brush remain simulation-driven.
- **Cellular Automata:** replaced the repetitive default garden with an acorn
  Life seed at a closer scale. The ordinary Life rules are unchanged; the seed
  evolves into a changing population, and stepping and painting remain direct.
- **Neural Networks:** corrected the desktop heading/chart collision, moved the
  plot into a clearer frame, aligned pointer sampling to that plot, and improved
  small network labels. Training and the live decision boundary are unchanged.
- **Weather, Remembered:** kept the luminous attractor treatment and renderer.
  Lorenz/Rössler presets and camera dragging were exercised; the foreground
  hardware profile did not justify lowering visual quality.
- **The Infinite Shore:** preserved the arbitrary-precision renderer and
  deep-zoom behavior. A direct zoom and the mobile route were checked.
- **Logic Laboratory:** preserved its editor and real circuit evaluator. The
  Full Adder preset and input toggling were checked.
- **Invisible Forces:** preserved the field geometry and art direction. Adding
  and dragging a charge was checked against the live field.

The gallery, routes, site identity, navigation dock, and production metadata
were left intact.

## Browser validation

The final route sweep opened all 13 exhibits at 1440×900 and 390×844 (26
route/viewport combinations). It reported no horizontal viewport overflow and
no browser console errors. The following interactions were also performed:

- Adder: default 5+3 playback and replay; bit entry; 7+8; 8-bit 255+1; and
  Kogge–Stone. The default resolved to 8, and 255+1 resolved to sum 0 with
  carry 1.
- CPU: staged decode/execute and full run through output and halt.
- Growth: replayed the fern, paused and resumed it mid-growth, switched to
  Coral, and checked the completed composition and mobile framing.
- Fluid and reaction diffusion: elapsed simulation, pointer injection, and
  preset switching.
- Gravity and flock: time evolution, body launch, attractor interaction, and
  Predator preset.
- Cellular automata: natural evolution, step, and paint.
- Neural network: training and pointer probe movement.
- Weather: Rössler preset and camera drag; the remaining strong exhibits were
  checked with their described preset or direct manipulation above.

Weather was profiled in the visible installed Chrome with the NVIDIA GeForce
GTX 1660 SUPER / OpenGL renderer: 390 frames over 6.5 seconds on a 16,000-point
trail, with p50 and p95 frame intervals of 16.7 ms (about 60 fps). Headless
Chrome used SwiftShader and reported about 1.9 fps for the same scene, so that
software-rendered automation result was not treated as representative of the
hardware renderer. No weather rendering downgrade was made.

The fluid and reaction-diffusion scenes were also inspected in visible Chrome
on that GPU. Both used their WebGL path without fallback. Browser automation is
useful for interaction coverage, but these captures and frame timings are not a
claim about every device or mobile GPU.

## Verification

`npm run verify` passed:

- Production TypeScript/Vite build.
- Deep-zoom numerical checks through `10^500`.
- Simulation checks for gravity, CPU, backpropagation, circuits,
  electrostatics, and cellular automata.
- Adder gate truth tables; exhaustive 4-bit and 8-bit ripple/lookahead pairs;
  16-bit boundaries, carry/overflow, architecture equivalence, trace, replay,
  and input changes.
- Seeded fern generation, three branching depths, finite bounded coordinates,
  sequential curve order, and generation-dependent detail.
- Storage checks.
- Site checks for 13 exhibits, 15 canonical URLs, metadata, JSON-LD, icons,
  `robots.txt`, and the sitemap.

`git diff --check` also passed before commit.

## Screenshot index

The captures below include opening, evolved, interactive, and mobile states.
Timed states are approximate browser observation intervals; the interaction
states show the result after direct input.

### The Adder

![4-bit machine ready to calculate 5 + 3](screenshots/headed-adder-ready.jpg)

![Carry and sum signals resolving mid-calculation](screenshots/headed-adder-in-flight.jpg)

![Completed 5 + 3 calculation](screenshots/headed-adder-complete.jpg)

[Mobile result](screenshots/adder-v2-mobile-result.jpg)

### Inside the Machine

![CPU decode stage](screenshots/headed-machine-decode.jpg)

![CPU execute stage](screenshots/headed-machine-execute.jpg)

![Addition written to output](screenshots/headed-machine-add-output.jpg) ·
[Mobile output](screenshots/final-machine-output-mobile.jpg)

### A Grammar of Growth

![Fern partway through its staged growth](screenshots/growth-fern-unfurling.jpg)

![Completed five-frond fern composition](screenshots/growth-fern-evolved.jpg)

![Coral growth preset](screenshots/final-growth-coral-desktop.jpg) ·
[Completed fern on mobile](screenshots/growth-fern-mobile.jpg)

### A Quiet Current

![Opening pigment field](screenshots/headed-fluid-opening.jpg)

![Fluid after ten seconds](screenshots/headed-fluid-10s.jpg)

![Fluid after pointer interaction](screenshots/headed-fluid-gesture.jpg) ·
[Mobile view](screenshots/final-route-fluid-mobile.jpg)

### Gravity Playground

![Orbital trails after evolution](screenshots/final-gravity-15s.jpg)

![A newly launched body and its trajectory](screenshots/final-gravity-launched-body.jpg) ·
[Mobile view](screenshots/final-route-gravity-mobile.jpg)

### A Murmuration

![Flock after fifteen seconds](screenshots/final-boids-15s.jpg)

![Flock after thirty seconds](screenshots/final-boids-30s.jpg)

[Predator preset](screenshots/final-boids-predator.jpg) ·
[Mobile view](screenshots/final-route-boids-mobile.jpg)

### The Pattern Beneath

![Reaction-diffusion labyrinth after fifteen seconds](screenshots/headed-reaction-15s.jpg)

![Live seed interaction](screenshots/headed-reaction-gesture.jpg) ·
[Mobile view](screenshots/final-route-reaction-mobile.jpg)

### Cellular Automata

![Acorn seed evolving](screenshots/final-automata-9s.jpg)

![Painted cell state](screenshots/final-automata-painted.jpg) ·
[Mobile view](screenshots/final-route-automata-mobile.jpg)

### Neural Networks

![Trained decision boundary](screenshots/final-neural-learning.jpg)

![Live pointer probe](screenshots/final-neural-probe.jpg) ·
[Mobile layout](screenshots/final-neural-mobile.jpg)

### Weather, Remembered

![Rössler attractor in the retained renderer](screenshots/final-weather-rossler.jpg) ·
[Mobile view](screenshots/final-route-attractors-mobile.jpg)

### The Infinite Shore

![Mandelbrot zoom](screenshots/final-shore-zoom.jpg) ·
[Mobile view](screenshots/final-route-mandelbrot-mobile.jpg)

### Logic Laboratory

![Full Adder circuit with real input state](screenshots/final-logic-full-adder.jpg) ·
[Mobile view](screenshots/final-route-logic-mobile.jpg)

### Invisible Forces

![Charge placement and drag interaction](screenshots/final-forces-charge-dragged.jpg) ·
[Mobile view](screenshots/final-route-forces-mobile.jpg)
