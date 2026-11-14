# Accessibility of Understanding

This branch redesigns how visitors begin, explore and understand the collection. It keeps the existing simulations and their advanced controls while making the first action, its result and the relevant idea easier to see.

The first pass covered all 13 exhibits in Chrome at desktop and mobile sizes before reading the exhibit implementations. The repeated first-run problems were that controls were hidden in the dock, a canvas did not say what to do, parameters described a technical name without explaining an effect, and the result could change without a concise account of why. The changes below respond to those specific gaps.

## First actions across the collection

Each interactive scene now has a short, exhibit-specific prompt over the artwork. It names a concrete action, offers a touch friendly action button where useful, and disappears after the visitor interacts. A small information button can bring the hint back during the same visit. Hints are remembered in session storage so navigation does not repeatedly interrupt the visitor. They are also associated with their canvas or circuit using `aria-describedby` where applicable.

| Exhibit | A first thing to try | What the interface now explains |
| --- | --- | --- |
| The Infinite Shore | Drag, scroll or pinch to travel into the coastline. | How the Mandelbrot and Julia views use repeated number updates, and how escaping points colour the image. Deep zoom remains available. |
| A Quiet Current | Drag through the pigment, or use “Stir the centre.” | Stroke strength, viscosity, swirl and colour persistence by their effect. The CPU fallback has matching guidance. Values are identified as simulation values, not physical units. |
| A Murmuration | Drop food into the flock. | Each bird reacts to nearby flockmates by keeping space, matching direction and turning toward the group. Existing attractors, repellers and barriers remain. |
| Weather, Remembered | Drag to rotate the attractor; change a parameter in Controls. | Parameter notes describe how each system changes its trajectory while retaining the parameter symbols and fourth order Runge–Kutta integration. |
| The Pattern Beneath | Plant a seed in the field. | Feed replenishes one ingredient; kill removes the other. A centre seed action works without opening Controls. The same prompt is present in the CPU fallback. |
| A Grammar of Growth | Replay the growth. | An expandable explanation shows the starting string, replacement rules and how repeated symbols become branches and turns. |
| Gravity Playground | Launch a gentle orbit. | Mass changes pull and launch speed changes the path. Scale free simulation values are explicitly distinguished from measured planetary units. |
| Inside the Machine | Step the program that adds 7 and 5. | A register is a number holder; memory keeps instructions and data; the ALU is introduced as the math unit. Each step reports what moved and what value changed. |
| Neural Networks | Move the bright point and press Train. | The point, examples and two predicted regions are visible before training starts. The map changes only when the visitor trains the real network. |
| Logic Laboratory | Toggle either switch on the ready made half adder. | Lit wires carry 1 and dim wires carry 0. The displayed sum and carry are explained as a binary result. Optional AND, OR and XOR build goals check every switch pair. |
| Invisible Forces | Place a positive charge at the centre. | Positive field arrows point outward, negative arrows inward, and test particles respond to the field. Normalized values are not presented as physical units. |
| Cellular Automata | Start with a glider, pause and step. | The selected rule is stated in plain language, and a step reports how many cells lit up or went dark. |
| The Adder | Enter 5 and 3, then Calculate. | Decimal inputs map to binary digits; the rightmost place is identified first; actual gate inputs, outputs and carries are explained from the active circuit trace. |

Controls retain their technical names alongside effect based wording. Common action buttons now use the exhibit’s dark visual language, clear focus indication and a 38px minimum height. Primary touch actions in the computing scenes are 36–40px high.

## Computing redesigns

### The Adder

The default is a focused four bit ripple carry addition with 5 and 3 ready to calculate. The interface pairs each decimal operand with its binary form and matches the four input pairs to the bit slices. “Start with the rightmost bit” establishes the reading direction. The gold carry wire and output module show when two 1s create a carry into the next place. The completed result shows both `5 + 3 = 8` and `0101 + 0011 = 1000`.

Gate inspection begins with the actual gate values. For example, an AND gate explains that both inputs are 1 and therefore it sends a carry into bit 1; the accompanying formula shows `1 ∧ 1 = 1`. XOR explanations start with whether the inputs match, then show the signal result. These explanations are generated from the real gate and trace state.

Width, ripple carry, Kogge–Stone and signed two’s complement details are behind a native “More settings” disclosure. The full 4/8/16 bit choices, gate graph, deterministic stepping and replay remain available. The signed disclosure reports the exact input interpretations and overflow for the selected width.

### Inside the Machine

The default program is visibly framed as “TRY: ADD 7 + 5.” “Step instruction,” “Run program” and “Reset” are available in the scene. Fetch, decode and execute highlight the active parts of the datapath, while a short live note says what the instruction means and which value changed. After the ADD instruction, register A visibly changes to 12 while B remains 5; after OUT and HLT the output remains 12 and the machine reports that it has finished.

The program editor, example programs, instruction reference, memory, registers, binary values and run control are preserved inside Controls. Expandable explanations define the current step and expose the current register values in both decimal and eight bit binary. The datapath graphic and individual memory addresses have accessible labels.

### Logic Laboratory

Visitors begin with a live half adder instead of an unexplained empty board. Switches show 0 or 1, wires update their brightness, lamps report outputs, and the lesson explains that `1 + 1` makes carry 1 and sum 0 (binary `10`). Clicking a gate reports its rule and current inputs and output.

Free circuit building remains open. Parts can be placed in the centre, wires can be undone, and the starter circuit can be restored. The optional AND, OR and XOR challenges ask for a simple behavior in ordinary language and verify all four input pairs. A keyboard disclosure offers source, destination and gate input selectors for wiring without dragging. Switches and gates support Tab, Enter and Space; invalid connections leave the circuit unchanged and report how to recover.

### Neural Networks

Automatic startup training has been removed so visitors can see an actual untrained network before changing it. Dots are examples; the two coloured regions are current model guesses. Visitors can move a test point and press Train to observe the real decision boundary move. Loss and accuracy have plain descriptions; Controls explain classes, neurons, layers, activation, weight direction and strength, learning rate, and the two point coordinates. Sliders provide a non canvas way to move the test point.

## Further accessibility and control improvements

- Touch prompts, gate selectors, register disclosures and action rows fit within a 390px viewport in the checked mobile routes.
- Canvas descriptions identify what each scene depicts and the primary gesture. Readouts expose important values for the machine, Adder, neural network, logic circuit and cellular automaton.
- The CPU instruction button was activated with Enter in Chrome. Logic switches and gates support keyboard activation; the keyboard wiring path uses ordinary labeled selects and buttons. The Adder gates and bit selectors are focusable and named.
- The site’s existing reduced motion rules remain in place; the exhibit shell opens paused when `prefers-reduced-motion` is set.
- Reset, preset restore, clear, replay, pause and step actions remain available. The Logic Laboratory adds “Undo last wire.” The automaton’s single step pauses the running field and reports the actual births and deaths.

## Browser walkthrough and evidence

Assessment and validation used isolated headless Chrome through CDP against the running local Vite server because the connected visible browser was unavailable. Desktop was 1440×900; mobile emulation was 390×844 with touch enabled. The browser used SwiftShader software rendering, so these screenshots verify layout and interaction behavior, not physical GPU performance. No outside novice user study was conducted; the first time visitor walkthroughs below are reviewer walkthroughs.

All 13 exhibit routes mounted on desktop and mobile, and each reported the document width equal to the viewport width. The first pass tried the main interaction in every exhibit: fractal zoom, fluid stirring, flock food, attractor rotation, reaction seed painting, growth replay, body launch, CPU stepping, network training and point probing, logic input toggling, charge placement, automaton stepping and Adder calculation. The final focused pass also covered the reaction CPU fallback with WebGL disabled, an Adder mobile touch, CPU stepping with Enter, gate inspection, the Logic Laboratory keyboard build path, and mobile control panels. The collected browser sweep reported no JavaScript exceptions.

| Walkthrough | Observed result |
| --- | --- |
| Adder, desktop and mobile | Calculate completed `5 + 3 = 8`, binary `1000`; the actual ripple trace resolved 17/17 signals. Mobile touch reached the 40px Calculate button. Kogge–Stone completed 26/26 signals. The four bit signed view correctly reported result −8 and overflow for these bit patterns. |
| Inside the Machine | Step produced register A = 12 and B = 5; the program reached OUT and HLT with output 12. Enter activated the first instruction. The mobile register disclosure reported A = `00001100` and B = `00000101`. |
| Logic Laboratory | Gate inspection showed XOR inputs `1` and `1` yielding `0`. A built AND circuit met the goal across all four switch combinations; output lamp and wire state updated from the actual circuit. |
| Neural Networks | In the observed seeded session, loss/accuracy changed from 0.5436/56% before training to 0.1011/97% after training. Mobile shows the same before/after experience and fits the viewport. |
| The Pattern Beneath fallback | With WebGL disabled, the CPU path mounted, displayed its own first action, accepted a touch seed and receded to the hint button. The 390px view did not overflow. |
| Collection and privacy | The mobile gallery showed the featured work plus 12 cards, the favourite button saved to local storage, and `/privacy` displayed the existing no cookies/no trackers copy. Both views fit the mobile viewport. |

## Screenshots

The PNGs are browser captures from this branch. Beginner and explored states are included for desktop and mobile where listed.

- **Adder:** [first run, desktop](screenshots/adder-beginner-desktop.png), [first run, mobile](screenshots/adder-beginner-mobile.png), [5 + 3 complete, desktop](screenshots/adder-5-plus-3-complete-desktop.png), [5 + 3 complete, mobile](screenshots/adder-5-plus-3-complete-mobile.png), [carry gate with live values](screenshots/adder-carry-explanation-desktop.png), [advanced Kogge–Stone and signed view](screenshots/adder-kogge-stone-desktop.png).
- **Inside the Machine:** [first run, desktop](screenshots/machine-beginner-desktop.png), [first run, mobile](screenshots/machine-beginner-mobile.png), [ADD instruction in flight](screenshots/machine-add-step-desktop.png), [program finished](screenshots/machine-program-finished-desktop.png), [mobile decimal and binary register readout](screenshots/machine-values-controls-mobile.png).
- **Logic Laboratory:** [first run, desktop](screenshots/logic-beginner-desktop.png), [first run, mobile](screenshots/logic-beginner-mobile.png), [inspected XOR gate](screenshots/logic-inspect-xor-desktop.png), [AND challenge complete](screenshots/logic-and-challenge-complete-desktop.png).
- **Neural Networks:** [untrained, desktop](screenshots/neural-beginner-desktop.png), [untrained, mobile](screenshots/neural-beginner-mobile.png), [trained, desktop](screenshots/neural-trained-desktop.png), [trained, mobile](screenshots/neural-trained-mobile.png).
- **CPU fallback:** [The Pattern Beneath on mobile](screenshots/reaction-cpu-fallback-mobile.png).

## Verification

`npm run verify` runs the TypeScript production build, numerical checks, simulation checks, Adder checks, fern and storage checks, and generated production page checks. The final run passed all of them:

- Deep zoom coordinates through `10^500`; exact and perturbation colours agree at `10^50`; tile fingerprints differ at `10^20`, `10^30` and `10^50`.
- Gravity, CPU, neural backpropagation, circuit, electrostatics and automaton simulation checks passed.
- Adder tests passed all 256 four bit pairs and all 65,536 eight bit pairs in both architectures, plus sixteen bit boundaries, truth tables, carry, overflow, architecture equivalence, trace, replay and changed inputs.
- Fern checks passed 7,480 deterministic curves; storage checks passed favorites, volatile visits, invalid records, shared state and blocked storage.
- Generated page checks passed for all 13 exhibits, 15 canonical URLs, metadata, JSON-LD, icons, `robots.txt` and `sitemap.xml`.

The implementation does not change site copy, SEO generation, privacy handling, gallery navigation or deployment configuration. No publish, push or deployment was performed.

## Remaining work and limits

These are reviewer walkthroughs, not evidence that a child or other novice now understands every exhibit. The next meaningful usability check is to observe people from the three intended experience levels using the first actions without coaching, especially the Adder carry explanation, the CPU fetch/decode/execute sequence and mobile circuit construction. Screen-reader testing with a real screen reader and testing on physical touch devices are also outstanding. The artworks remain primarily visual and gestural; textual descriptions and structured values help inspection but do not provide a full nonvisual equivalent for every evolving canvas. Physical GPU output and performance were not tested in this headless SwiftShader run.
