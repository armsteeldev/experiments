# Computing exhibit rethink

Four viewport-filling exhibits were redesigned around the thing a visitor can do: calculate, give a computer a job, teach a pattern, and make a light obey. Their simulation engines remain the source of every visible result. The shared shell, routes, registry, and global styles were left alone.

## Browser assessment

I opened and tried the original exhibits before consulting their implementations. The Adder showed a useful circuit slice, but the answer and carry story competed with low-level labels. Inside the Machine led with assembly and a CPU diagram, so the visitor had to know what the machine was for. Neural Networks could train, but offered no way to add examples; metrics and weights were more prominent than learning. Logic Laboratory evaluated a working half-adder, but the visitor had to infer how to begin changing or building it.

The browser pass used Chromium through CDP at 1440×900 and 390×844. I exercised pointer, keyboard, form, and control-panel interactions and inspected intermediate states as well as completed results. The connected browser surface was unavailable, so these are headless-browser findings. No novice comprehension study was conducted.

## What changed

### The Adder — precision instrument

The starting calculation is 1 + 1 = 10₂, already resolved and ready to replay. Decimal inputs and quick examples sit beside a gate deck that shows one understandable slice of the real circuit at a time. The carry rail makes propagation visible; bit selection and gate inspection reveal why a result appeared. Playback can pause, step, restart, or replay in one action. Width, ripple or Kogge–Stone architecture, speed, binary and signed interpretation remain in the optional controls.

Browser task: enter 5 and 3, run the actual gate trace, see 8 / 1000₂, inspect bit 2 and its carry. The in-progress frame records signal 5 of 17; the completed frame shows the carry chain. The replay button was also exercised after completion.

### Inside the Machine — a computer with a job

The visitor chooses addition, comparison, memory, or a counting loop. The processor then moves through find, understand, and do-it stages while its registers, ALU, RAM and output change. Numbers are the starting point; actual instruction source and all register/memory values remain available under the hood. Step, run, pause, reset, and editable assembly are preserved.

Browser task: run 7 + 5 to completion; the five actual CPU instructions halt with 12 on the output. A second run compared 7 and 5 and returned 0 with “They differ.” An in-progress screenshot shows register A loading 7 during `LDI A, 7`.

### Neural Networks — teach a tiny machine

The prediction canvas is the main exhibit. Visitors choose a starter pattern or blank canvas, add and move labelled examples, erase or undo edits, probe predictions without adding training data, and start or pause real backpropagation. Wrong guesses are ringed; the decision surface is rendered from the model’s real predictions. The optional network view exposes neurons and selectable, live weights; the controls retain layer count, width, activation, and learning rate.

Browser task: teach the starter XOR pattern. The measured model moved from 23/48 correct (48%, loss 0.506) to 44/48 (92%, loss 0.141) in about 4.2 seconds. Adding an example while training stopped the trainer; Undo restored the dataset. A probe left its example count unchanged. Selecting a connection exposed its current numeric weight.

### Logic Laboratory — electronics workbench

The first circuit is two off switches, a real AND gate, and a dark lamp. Toggling one input and then the other makes the cause and effect immediate. Visitors can choose optional circuit ideas or place gates, switches and lamps directly on the board. Large sockets support drag-to-connect wiring; parts snap to a grid. Placement, movement, wiring, switch changes, deletion, undo and redo remain editable.

Browser task: toggle both switches and see the AND lamp light. Then place an OR gate and connect both switches to it and its output to the lamp. With A on and B off, the actual circuit still lights the lamp. Undo and redo were exercised and restored the output state. The mobile palette scrolls horizontally to keep its larger controls usable.

## Evidence

The `screenshots/` folder contains before and after views for all four exhibits, desktop intermediate frames for the Adder and CPU, an Adder replay frame, a selected network weight, and completed mobile tasks. The [7.5-second Adder calculation clip](media/adder-calculation.mp4) shows the gate trace resolving before the answer appears.

The browser session reported no JavaScript exceptions or console errors. At 390px, all four pages had `scrollWidth === clientWidth`; primary actions and results remained on screen. This records automated browser behavior, not evidence of novice comprehension.

## Technical integrity and verification

- The Adder still uses `src/simulations/adder.ts`; existing checks cover gate truth tables, 4/8/16-bit ripple and Kogge–Stone circuits, carry traces, stepping, deterministic replay, and signed overflow.
- Inside the Machine now uses a shared `createCpuDemoProgram` helper. Simulation checks execute the four tasks through the real CPU, including equal/unequal branches, RAM store/retrieve, and the count loop.
- Neural training and inference still call the feedforward/backpropagation engine in `src/simulations/neural.ts`. A deterministic XOR-start regression check verifies that its predictions improve in a short training run.
- Logic edits still pass through the Boolean circuit evaluator in `src/simulations/circuit.ts`; the browser wiring test changed the lamp using connected gate outputs.
- `npm run verify`: **passed** — production build, all test suites, exhaustive adder checks, and production site checks.

## Performance and limits

The network map samples 58×40 points per desktop redraw and 34×28 on mobile, caps device pixel ratio at 1.5 and canvas area at two million pixels, and redraws during training at 12.5 updates per second. CPU autoplay uses a steady 880ms instruction cadence while each instruction animates its phases. Production JavaScript chunks (gzip) are 7.65 kB for The Adder, 5.84 kB for Inside the Machine, 7.01 kB for Neural Networks, and 8.49 kB for Logic Laboratory. Their shared scoped stylesheet is 45.70 kB (10.45 kB gzip).

These are code and headless-browser observations, not physical-GPU frame-rate or memory benchmarks. The mobile logic toolbar trades one-row visibility for larger targets and horizontal scrolling. No human participants were involved.
