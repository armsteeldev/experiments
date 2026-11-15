# Share and replay scope

Share links and named notebook entries store validated exhibit settings. Most links reconstruct a selected setup; they do not freeze an evolving simulation. URLs are Base64 URL encoded, not encrypted. Custom CPU source and network messages are plain text in the encoded state, so avoid private text.

| Exhibit | Recreated from a link | Starts fresh or is omitted |
| --- | --- | --- |
| Mandelbrot | Camera center and scale, iteration limit, palette, render mode | Fractal tiles are recalculated |
| A Quiet Current | Flow preset, rendering style where supported, pigment and physical controls | Hand strokes, velocity history and evolved dye |
| Flocking | Scenario, population, speed, neighbourhood radius, placement tool and seed | In-flight positions, trails and placed markers |
| Strange Attractors | System, coefficients, speed, trail budget, palette and camera | Traced point history |
| The Pattern Beneath | Preset, reaction rates, diffusion, steps, palette, detail, brush settings, seed and scatter mode | Painted marks and evolved chemistry |
| Recursive Growth | Rule, generation count, angle, randomness, line width, palette, seed and camera | Growth animation restarts |
| Gravity Playground | Preset or edited system's starting body positions, velocities, masses and colours; normalized camera framing; simulation controls | Trails and collision history; the system resumes evolving from its last manual edit |
| Inside the Machine | Task or up to 2,000 characters of assembly, plus operands | Execution restarts at line one; output and machine history |
| Neural Networks | Dataset, layer shape, activation and learning rate | Trained weights and training history |
| Logic Laboratory | Starter or built circuit: component types/positions, wires, switch values and goal | Signal values recalculate; malformed or oversized boards fall back to a safe starter |
| Invisible Forces | Named or custom source-charge arrangement, charge strengths, normalized camera zoom and world-space framing | Released test-particle positions and trails; field maps are recalculated |
| Cellular Automata | Rule, rate, rendering, seed and either a named pattern or the last drawn board | Generation count, cell ages and fading trails |
| The Adder | Width, architecture, operands and playback speed | Playback position and trace history are recalculated |
| The Wave Chamber | Wave preset, boundary, frequency, speed, damping, coherence, phase and view | Live pulses, drawn walls and evolved field |
| Geometry of Light | Optical elements and positions, spectrum, wavelength, material and component angles | Rays are recalculated |
| Shape of Sound | Frequency, partials, filter and display mode | Audio stays off; phase and playback history restart |
| The Living Garden | Temperature, resource rate and season setting | Organisms and ecological history |
| The Living Network | Source, destination and message | Failed links, packet positions and traversal history |
| Where Light Falls | Mass, distance, source ratio, impact parameter and view | Photon paths are recalculated |

The Canvas 2D Fluid and reaction-diffusion fallbacks accept the same shared presets and model settings as their GPU paths; fallback resolution and rendering detail are lower. Where renderer-specific options do not apply, the fallback omits those options. Reproducibility means recreating the listed starting setup, not guaranteeing identical pixels across devices or renderers.

The codec and bounds checks reject malformed or unsupported state safely. Logic boards are limited to 32 parts and 64 wires; restored IDs, gate types, coordinates, switch values and input sockets are validated before evaluation. Invisible Forces accepts at most 16 finite source charges with model-bounded strength/coordinates and a finite, bounded camera zoom. Gravity accepts at most 32 bodies, with unique positive IDs, bounded finite positions, velocities, masses and colours, plus a bounded camera zoom and framing. Browser checks cover share/reload for all nineteen exhibits, malformed state recovery for all nineteen, a painted cellular still life, CPU source execution, a built XOR circuit and goal after restoration, custom electrostatic charges and camera framing, a seven-body edited gravity system and post-reload body creation, and Canvas 2D/GPU fallback settings. Signal values, field maps, trails and simulation histories are recalculated rather than serialized. See the evidence files named in `PROGRESS.md` for the exact test scope and renderer.
