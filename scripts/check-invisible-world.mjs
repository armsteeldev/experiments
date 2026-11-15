import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

async function loadModule(path) {
  const source = await readFile(resolve(path), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

const [waves, optics, sound, garden, network, lensing] = await Promise.all([
  loadModule('src/simulations/waves.ts'), loadModule('src/simulations/optics.ts'), loadModule('src/simulations/sound.ts'),
  loadModule('src/simulations/garden.ts'), loadModule('src/simulations/network.ts'), loadModule('src/simulations/lensing.ts'),
])

{
  assert.equal(waves.isWaveStepStable(0.72, 0.72), true)
  assert.equal(waves.isWaveStepStable(1, 0.71), false, 'The two-dimensional Courant limit is 1/√2')
  const pulse = waves.createWaveState(72, 48)
  waves.addWavePulse(pulse, 36, 24, 0.8, 2)
  const initial = pulse.current[24 * 72 + 36]
  waves.stepWave(pulse, 22)
  assert.notEqual(pulse.current[24 * 72 + 36], initial, 'A pulse evolves through the finite-difference stencil')
  waves.stepWave(pulse, 1200)
  assert.ok(Number.isFinite(waves.waveEnergy(pulse)) && waves.waveEnergy(pulse) > 0)
  let peak = 0
  for (const value of pulse.current) peak = Math.max(peak, Math.abs(value))
  assert.ok(peak < 1.5, `Stable pulse remains bounded: ${peak}`)

  const wall = waves.createWaveState(64, 40)
  wall.boundary = 'reflect'; wall.damping = 0
  for (let y = 0; y < wall.height; y++) wall.solid[y * wall.width + 32] = 1
  waves.addWavePulse(wall, 18, 20, 1, 2)
  waves.stepWave(wall, 34)
  let rightEnergy = 0
  for (let y = 0; y < wall.height; y++) for (let x = 33; x < wall.width; x++) rightEnergy += wall.current[y * wall.width + x] ** 2
  assert.ok(rightEnergy < 1e-12, 'A solid barrier enforces zero normal flux')

  const a = waves.createWaveState(48, 32), b = waves.createWaveState(48, 32), combined = waves.createWaveState(48, 32)
  waves.addWavePulse(a, 12, 16, 0.5, 2); waves.addWavePulse(b, 36, 16, 0.5, 2)
  waves.addWavePulse(combined, 12, 16, 0.5, 2); waves.addWavePulse(combined, 36, 16, 0.5, 2)
  for (const state of [a, b, combined]) waves.stepWave(state, 18)
  for (let i = 0; i < a.current.length; i++) assert.ok(Math.abs(combined.current[i] - a.current[i] - b.current[i]) < 2e-6, 'Linear wave fields superpose')
  const doubleSlit = waves.createDoubleSlitState(80, 72)
  assert.equal(doubleSlit.emitters.length, 1)
  assert.equal(doubleSlit.emitters[0].amplitude, 0.45, 'The diffraction preset uses a stronger bounded plane-wave source')
  const slitWall = Math.round(doubleSlit.width * 0.43)
  assert.equal(doubleSlit.solid[Math.round(doubleSlit.height * 0.39) * doubleSlit.width + slitWall], 0, 'The upper aperture transmits the incident wave')
  assert.equal(doubleSlit.solid[Math.round(doubleSlit.height * 0.5) * doubleSlit.width + slitWall], 1, 'The solid between the two apertures blocks the incident wave')
  waves.stepWave(doubleSlit, 1200)
  assert.ok(doubleSlit.current.every(Number.isFinite) && Math.max(...doubleSlit.current.map(Math.abs)) < 1.5, 'Repeated double-slit diffraction stays finite and bounded')
  assert.equal(waves.createWaveState().current.length, 288 * 180, 'The desktop field has more spatial detail than the opening implementation')
  assert.throws(() => waves.createWaveState(7, 20), RangeError, 'Invalid solver grids fail before allocating arrays')
  assert.throws(() => waves.stepWave(pulse, 1201), RangeError, 'An excessive solver batch cannot block the main thread indefinitely')
  const sourced = waves.createWaveState(40, 30)
  assert.equal(waves.addWaveEmitter(sourced, { x: 8, y: 14, frequency: 3, amplitude: 2, phase: 0, phaseJitter: 0, active: true }), true)
  assert.equal(sourced.emitters[0].frequency, 0.45); assert.equal(sourced.emitters[0].amplitude, 0.5, 'Emitter inputs remain in a bounded simulation range')
  for (let i = 1; i < 8; i++) waves.addWaveEmitter(sourced, { x: 8 + i, y: 14, frequency: 0.1, amplitude: 0.1, phase: 0, phaseJitter: 0, active: true })
  assert.equal(waves.addWaveEmitter(sourced, { x: 20, y: 14, frequency: 0.1, amplitude: 0.1, phase: 0, phaseJitter: 0, active: true }), false, 'The source count has a fixed work budget')
  const energyField = waves.createWaveState(40, 30); waves.addWavePulse(energyField, 20, 15); waves.stepWave(energyField, 1)
  assert.ok(energyField.current.reduce((sum, _, index) => sum + waves.waveEnergyDensity(energyField, index), 0) > 0, 'Local energy responds to both field velocity and spatial gradients')
  energyField.solid[15 * energyField.width + 20] = 1
  assert.equal(waves.waveEnergyDensity(energyField, 15 * energyField.width + 20), 0, 'Solid cells have no displayed wave energy')
  assert.equal(waves.waveEnergyDensity(energyField, -1), 0, 'Probe bounds do not read outside the field')
  const cavity = waves.createWaveState(64, 48); cavity.damping = 0.005; cavity.boundary = 'reflect'
  for (const [x0, y0, x1, y1] of [[10, 10, 54, 10], [10, 38, 54, 38], [10, 10, 10, 38], [54, 10, 54, 38]]) waves.setWaveBarrier(cavity, x0, y0, x1, y1, 1.5)
  const resonantFrequency = waves.waveModeFrequency(cavity, 8, 4, 41, 25)
  assert.ok(resonantFrequency > 0.09 && resonantFrequency < 0.1, 'Cavity drive frequency follows the discrete leapfrog dispersion relation')
  assert.throws(() => waves.waveModeFrequency(cavity, 0, 0, 40, 24), RangeError, 'A uniform zero-frequency field is not a resonant cavity mode')
  const modeField = waves.createWaveState(64, 48); modeField.damping = cavity.damping
  for (const [x0, y0, x1, y1] of [[10, 10, 54, 10], [10, 38, 54, 38], [10, 10, 10, 38], [54, 10, 54, 38]]) waves.setWaveBarrier(modeField, x0, y0, x1, y1, 1.5)
  assert.equal(waves.seedWaveMode(modeField, 8, 4, 12, 12, 41, 25, 0.3), resonantFrequency, 'The seeded spatial mode and its drive use the same discrete frequency')
  const antinode = 24 * modeField.width + 32, initialModeAmplitude = modeField.current[antinode]
  assert.ok(Math.abs(initialModeAmplitude - 0.3) < 1e-6, 'The resonant mode opens at a clear antinode')
  waves.stepWave(modeField, 1)
  const dampedModeStep = initialModeAmplitude * Math.sqrt(1 - modeField.damping) * Math.cos(2 * Math.PI * resonantFrequency * modeField.dt)
  assert.ok(Math.abs(modeField.current[antinode] - dampedModeStep) < 1e-5, 'The damped discrete standing mode advances at its calculated temporal frequency')
  const cavityResponse = (frequency) => {
    const state = waves.createWaveState(64, 48); state.damping = 0.005; state.boundary = 'reflect'
    for (const [x0, y0, x1, y1] of [[10, 10, 54, 10], [10, 38, 54, 38], [10, 10, 10, 38], [54, 10, 54, 38]]) waves.setWaveBarrier(state, x0, y0, x1, y1, 1.5)
    waves.addWaveEmitter(state, { x: 32, y: 24, frequency, amplitude: 0.3, phase: 0, phaseJitter: 0, active: true })
    let meanEnergy = 0
    for (let step = 0; step < 1200; step++) { waves.stepWave(state, 1); if (step >= 1000) meanEnergy += waves.waveEnergy(state) }
    return meanEnergy / 200
  }
  assert.ok(cavityResponse(resonantFrequency) > cavityResponse(waves.waveModeFrequency(cavity, 4, 2, 41, 25)) * 1.35, 'The driven cavity stores more wave energy near the selected discrete mode than at a detuned frequency')
  const driftingA = waves.createWaveState(30, 20), driftingB = waves.createWaveState(30, 20)
  const wandering = { x: 15, y: 10, frequency: 0.1, amplitude: 0.2, phase: 0, phaseJitter: 0.2, active: true }
  driftingA.emitters.push({ ...wandering }); driftingB.emitters.push({ ...wandering })
  waves.stepWave(driftingA, 16); waves.stepWave(driftingB, 16)
  assert.equal(driftingA.emitters[0].phase, driftingB.emitters[0].phase, 'Seeded phase diffusion remains reproducible')
  assert.notEqual(driftingA.emitters[0].phase, 0, 'The incoherence approximation changes relative phase over time')
}

{
  const opticsV = optics.vector
  const hit = optics.intersectRaySegment({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 4, y: -2 }, { x: 4, y: 2 })
  assert.ok(hit && Math.abs(hit.distance - 4) < 1e-12 && Math.abs(hit.point.y) < 1e-12, 'Ray and mirror segment intersection is exact')
  const reflected = optics.reflectDirection({ x: Math.SQRT1_2, y: Math.SQRT1_2 }, { x: 0, y: -1 })
  assert.ok(Math.abs(reflected.x - Math.SQRT1_2) < 1e-12 && Math.abs(reflected.y + Math.SQRT1_2) < 1e-12, 'Reflection preserves tangential velocity and reverses the normal component')
  const refracted = optics.refractDirection({ x: 0.5, y: Math.sqrt(0.75) }, { x: 0, y: -1 }, 1, 1.5)
  assert.ok(refracted && Math.abs(refracted.x - 1 / 3) < 1e-12, 'Snell refraction obeys n₁ sin θ₁ = n₂ sin θ₂')
  const totalInternal = optics.refractDirection({ x: Math.sqrt(0.75), y: 0.5 }, { x: 0, y: -1 }, 1.5, 1)
  assert.equal(totalInternal, null, 'A supercritical incidence has no transmitted ray')
  assert.ok(optics.prismIndex(1.52, 0.02, 420) > optics.prismIndex(1.52, 0.02, 680), 'Shorter visible wavelengths refract more strongly in this Cauchy-style model')
  const triangle = { kind: 'prism', vertices: [{ x: 8, y: -6 }, { x: 14, y: 0 }, { x: 8, y: 6 }], index: 1.5, dispersion: 0.01 }
  const traced = optics.traceOptics({ width: 60, height: 40, objects: [triangle], maxBounces: 4 }, { x: 0, y: 0, angle: 0, spread: 0, count: 1, wavelength: 550 })[0]
  assert.ok(traced.events.length >= 2 && traced.events[0].kind === 'refraction', 'A prism ray refracts at entry and exit')
  assert.ok(Math.abs(opticsV.length({ x: traced.points.at(-1).x, y: traced.points.at(-1).y })) > 20)
  const focusing = optics.traceOptics({ width: 60, height: 40, objects: [{ kind: 'lens', center: { x: 10, y: 0 }, angle: 0, focalLength: 10, aperture: 18 }], maxBounces: 4 }, { x: 0, y: 3, angle: 0, spread: 0, count: 1, wavelength: 550 })[0]
  assert.equal(focusing.events[0]?.kind, 'thin-lens', 'A left-to-right beam crosses the default lens orientation')
  const focusedEnd = focusing.points.at(-1)
  assert.ok(focusedEnd && focusedEnd.y < 0, 'An off-axis ray bends toward the optical axis after a converging lens')
  const width = 1440, height = 900, prismCenter = { x: width * 0.47, y: height * 0.5 }, prismRadius = height * 0.105
  const vertices = [0, 1, 2].map((step) => { const angle = -Math.PI / 2 + 0.17 + step * Math.PI * 2 / 3; return { x: prismCenter.x + Math.cos(angle) * prismRadius, y: prismCenter.y + Math.sin(angle) * prismRadius } })
  const mirrorCenter = { x: width * 0.78, y: height * 0.31 }, half = height * 0.14, mirrorAxis = { x: Math.SQRT1_2, y: Math.SQRT1_2 }
  const defaultOptics = { width, height, maxBounces: 7, objects: [
    { kind: 'prism', vertices, index: 1.52, dispersion: 0.018 },
    { kind: 'mirror', a: { x: mirrorCenter.x - mirrorAxis.x * half, y: mirrorCenter.y - mirrorAxis.y * half }, b: { x: mirrorCenter.x + mirrorAxis.x * half, y: mirrorCenter.y + mirrorAxis.y * half } },
    { kind: 'lens', center: { x: width * 0.74, y: height * 0.78 }, angle: 0, focalLength: height * 0.24, aperture: height * 0.24 },
  ] }
  const defaultRays = [405, 430, 458, 488, 520, 550, 585, 620, 655, 680].flatMap((wavelength) => optics.traceOptics(defaultOptics, { x: width * 0.15, y: height * 0.5, angle: 0, spread: 0.065, count: 8, wavelength }))
  assert.ok(defaultRays.filter((ray) => ray.events.some((event) => event.kind === 'thin-lens')).length >= 60, 'Most rays in the opening prism arrangement reach the visible lens')
}

{
  const sine = sound.synthesizeSignal({ frequency: 440, harmonics: [{ multiple: 1, amplitude: 0.7, phase: 0 }], samples: 1024 })
  const spectrum = sound.signalSpectrum(sine)
  const fundamental = spectrum.indexOf(Math.max(...spectrum))
  assert.equal(fundamental, 1, 'A single synthesized cycle has its dominant energy in the fundamental bin')
  const mixed = sound.synthesizeSignal({ frequency: 220, harmonics: [{ multiple: 1, amplitude: 0.7, phase: 0 }, { multiple: 3, amplitude: 0.25, phase: Math.PI / 2 }], samples: 2048 })
  const mixedSpectrum = sound.signalSpectrum(mixed)
  assert.ok(mixedSpectrum[1] > mixedSpectrum[3] && mixedSpectrum[3] > 0.2, 'Harmonic superposition appears at the matching Fourier bins')
  const coeffs = sound.harmonicsToPeriodicWaveCoefficients([{ multiple: 1, amplitude: 0.5, phase: 0 }])
  assert.ok(Math.abs(coeffs.imaginary[1] - 0.5) < 1e-7 && coeffs.real[1] === 0, 'PeriodicWave coefficients preserve sinusoid amplitude and phase')
  assert.deepEqual(sound.addHarmonic([{ multiple: 1, amplitude: 0.4, phase: 0 }], 2).map((part) => part.multiple), [1, 2])
  assert.ok(Math.abs(coeffs.real[1] - 0) < 1e-7)
  const phased = sound.harmonicsToPeriodicWaveCoefficients([{ multiple: 2, amplitude: 0.4, phase: Math.PI / 6 }])
  assert.ok(Math.abs(phased.real[2] - 0.2) < 1e-7 && Math.abs(phased.imaginary[2] - 0.4 * Math.sqrt(0.75)) < 1e-7, 'PeriodicWave coefficients preserve arbitrary phase')
  const passband = sound.lowpassTransfer(220, 1800), stopband = sound.lowpassTransfer(8800, 1800)
  assert.ok(Math.hypot(passband.real, passband.imaginary) > 0.99 && Math.hypot(stopband.real, stopband.imaginary) < 0.06, 'The digital low-pass preserves its passband and attenuates its stopband')
  assert.ok(sound.lowpassMagnitude(100, 1000) > sound.lowpassMagnitude(8000, 1000), 'The digital low-pass response attenuates frequencies above its cutoff')
  const filteredParts = sound.applyLowpassResponse([{ multiple: 1, amplitude: 0.5, phase: 0 }, { multiple: 20, amplitude: 0.5, phase: 0 }], 220, 1800)
  assert.ok(filteredParts[0].amplitude > filteredParts[1].amplitude * 5 && filteredParts[1].phase !== 0, 'The displayed waveform uses the filter magnitude and phase at each partial')
  const square = sound.timbreHarmonics('square'), triangleWave = sound.timbreHarmonics('triangle'), saw = sound.timbreHarmonics('sawtooth')
  assert.equal(sound.isValidHarmonicSet(triangleWave), true, 'the built-in waveform has a valid bounded harmonic set')
  assert.equal(sound.isValidHarmonicSet([{ multiple: 1, amplitude: 1e100, phase: 0 }]), false, 'extreme oscillator amplitudes cannot enter from saved state')
  assert.equal(sound.isValidHarmonicSet([{ multiple: 1, amplitude: .5, phase: Infinity }]), false, 'non-finite harmonic phases are rejected')
  assert.equal(sound.isValidHarmonicSet([{ multiple: 1, amplitude: .5, phase: 0 }, { multiple: 1, amplitude: .4, phase: 0 }]), false, 'duplicate harmonic numbers cannot create ambiguous controls')
  assert.deepEqual(square.map((part) => part.multiple), [1, 3, 5, 7, 9, 11, 13, 15, 17], 'Square timbre contains the odd Fourier series only')
  assert.ok(Math.abs(square[1].amplitude - square[0].amplitude / 3) < 1e-12 && Math.abs(triangleWave[1].amplitude - triangleWave[0].amplitude / 9) < 1e-12, 'Preset harmonic amplitudes follow their Fourier coefficients')
  assert.ok(saw.some((part) => part.multiple === 2 && part.phase === Math.PI), 'Sawtooth even partials carry the alternating Fourier phase')
  for (const preset of ['sine', 'triangle', 'square', 'sawtooth']) {
    const sample = sound.synthesizeSignal({ frequency: 660, harmonics: sound.timbreHarmonics(preset), samples: 2048 })
    const peak = Math.max(...sample.map(Math.abs)), gain = sound.quietSignalGain(peak)
    assert.ok(peak * gain <= 0.055 + 1e-6 && 17 * 660 < 22050, `${preset} stays below the audio gain ceiling and supported Nyquist limit`)
  }
}

{
  const seededA = garden.createGardenState(991, 500, 350), seededB = garden.createGardenState(991, 500, 350)
  assert.deepEqual(seededA.agents, seededB.agents, 'A seed reproduces the opening population and inherited traits')
  const parent = garden.addGardenAgent(seededA, 250, 175, { speed: 42, efficiency: 0.62, metabolism: 0.02, energy: 1.3, hue: 140 })
  seededA.agents = [parent]; seededA.food = []; seededA.resourceRate = 0; seededA.maxPopulation = 10
  garden.stepGarden(seededA, 0.01)
  assert.equal(seededA.births, 1, 'Reproduction requires sufficient stored energy')
  const child = seededA.agents.find((agent) => agent.id !== parent.id)
  assert.ok(child && child.generation === 1, 'Offspring inherit a generation relationship')
  assert.ok(Math.abs(child.speed - parent.speed) <= 3.5 && Math.abs(child.efficiency - parent.efficiency) <= 0.06, 'Traits inherit with bounded mutation')
  const energyAfter = seededA.agents.reduce((sum, agent) => sum + agent.energy, 0)
  assert.ok(energyAfter < 1.3 && energyAfter > 1.1, 'Reproduction and metabolism account for an energy cost')
  seededA.maxPopulation = 1; parent.energy = 1.4; seededA.agents = [parent]
  garden.stepGarden(seededA, 0.01)
  assert.equal(seededA.agents.length, 1, 'Population cap prevents further births')
  const foodState = garden.createGardenState(17, 500, 350)
  foodState.agents = []; foodState.food = []; foodState.resourceRate = 1
  for (let i = 0; i < 20; i++) garden.stepGarden(foodState, 0.1)
  assert.ok(foodState.food.length <= 10, 'Resource regeneration is bounded by its simulation-time rate')
  const generations = garden.createGardenState(4781, 500, 350)
  for (let i = 0; i < 1400; i++) garden.stepGarden(generations, 0.08)
  assert.ok(generations.agents.length <= generations.maxPopulation && generations.totalBirths > 0 && generations.totalDeaths > 0, 'A sustained ecosystem remains bounded while recording births and deaths')
  assert.ok(generations.agents.every((agent) => Number.isFinite(agent.x + agent.y + agent.energy + agent.efficiency) && agent.efficiency >= 0.25 && agent.efficiency <= 0.92), 'Long-running inherited traits and positions remain finite and bounded')

  const assertGardenBounds = (state, label) => {
    assert.ok(state.agents.length <= 320 && state.food.length <= 150 && state.history.length <= 120, `${label} stays within population, food and history budgets`)
    assert.ok(state.agents.every((agent) => Number.isFinite(agent.x + agent.y + agent.vx + agent.vy + agent.energy + agent.speed + agent.efficiency + agent.metabolism) && agent.x >= 0 && agent.x <= state.width && agent.y >= 0 && agent.y <= state.height), `${label} retains finite, in-field agents`)
  }
  const runGarden = (seed, steps, condition) => {
    const state = garden.createGardenState(seed, 480, 320)
    for (let i = 0; i < steps; i++) { condition(state, i); garden.stepGarden(state, 0.08) }
    assertGardenBounds(state, `Seed ${seed} after ${steps} accelerated steps`)
    return state
  }
  const acceleratedStart = performance.now()
  const rich = runGarden(41721, 8000, (state) => { state.temperature = 0.31; state.resourceRate = 1.7 })
  const lean = runGarden(991, 8000, (state) => { state.temperature = 0.74; state.resourceRate = 0.48 })
  const changing = runGarden(8127, 10000, (state, i) => { const bloom = Math.floor(i / 1800) % 2 === 0; state.temperature = bloom ? 0.31 : 0.74; state.resourceRate = bloom ? 1.7 : 0.48 })
  assert.ok(rich.totalBirths > 0 && rich.totalDeaths > 0 && rich.generation > 10, 'Resource-rich runs sustain repeated inheritance and mortality over many generations')
  assert.ok(lean.totalBirths > 0 && lean.totalDeaths > 0, 'Lean-soil runs still express both reproduction and mortality')
  assert.ok(changing.totalBirths > 0 && changing.totalDeaths > 0, 'A changing climate continues to evolve rather than freezing its population')
  const recovery = garden.createGardenState(44, 500, 350); recovery.agents = recovery.agents.slice(0, 8); recovery.food = []; recovery.resourceRate = 1.9
  for (const agent of recovery.agents) for (let i = 0; i < 8; i++) garden.addGardenFood(recovery, agent.x + (i % 4 - 1.5) * 8, agent.y + (Math.floor(i / 4) - 0.5) * 8, 1.4)
  for (let i = 0; i < 3000; i++) garden.stepGarden(recovery, 0.08)
  assert.ok(recovery.agents.length > 8 && recovery.totalBirths > recovery.totalDeaths, 'A food-rich seed population recovers after a severe decline')
  const dense = garden.createGardenState(66291, 480, 320); dense.agents = []; dense.food = []; dense.temperature = 0.34; dense.resourceRate = 1.9
  for (let i = 0; i < 300; i++) garden.addGardenAgent(dense, (i * 137) % 480, (i * 83) % 320, { speed: 42, efficiency: 0.72, metabolism: 0.014, energy: 1.35 })
  for (let i = 0; i < 150; i++) garden.addGardenFood(dense, (i * 113) % 480, (i * 71) % 320, 1.5)
  let denseMinimum = dense.agents.length, denseMaximum = dense.agents.length
  for (let i = 0; i < 8000; i++) { garden.stepGarden(dense, 0.08); denseMinimum = Math.min(denseMinimum, dense.agents.length); denseMaximum = Math.max(denseMaximum, dense.agents.length) }
  assertGardenBounds(dense, 'Dense 300-organism ecology after 8,000 accelerated steps')
  assert.equal(denseMaximum, 320, 'A dense ecology reaches but does not exceed its configured population cap')
  assert.ok(denseMinimum < 40 && dense.agents.length > 100 && dense.totalBirths > 0 && dense.totalDeaths > 0, 'Crowded resource competition produces a bounded decline and recovery instead of growing without limit')
  const cap = garden.createGardenState(331, 480, 320); cap.agents = []
  for (let i = 0; i < 319; i++) garden.addGardenAgent(cap, i % 480, Math.floor(i / 480), { energy: 1.49 })
  garden.stepGarden(cap, 0.08)
  assert.equal(cap.agents.length, 320, 'A near-cap population may fill but never exceed its limit')
  assert.equal(garden.addGardenAgent(cap, 0, 0), null, 'Manual seeding respects the same cap as reproduction')
  const invalid = garden.createGardenState(5, NaN, Infinity)
  const repaired = garden.addGardenAgent(invalid, NaN, Infinity, { energy: Infinity, speed: NaN, efficiency: Infinity, metabolism: NaN, hue: Infinity })
  assert.ok(repaired && Number.isFinite(repaired.x + repaired.y + repaired.energy + repaired.speed + repaired.efficiency + repaired.metabolism + repaired.hue), 'Invalid coordinates and traits are repaired at the model boundary')
  invalid.food = Array.from({ length: 200 }, (_, i) => ({ x: i, y: i, energy: 0.8 }))
  garden.stepGarden(invalid, 0.08)
  assert.ok(invalid.food.length <= 150 && invalid.agents.length <= 320, 'Oversized imported states are bounded on the next model step')
  const zeroStep = garden.createGardenState(43); const initialTick = zeroStep.tick
  garden.stepGarden(zeroStep, NaN); assert.equal(zeroStep.tick, initialTick, 'Invalid or zero time steps do not advance the ecology')
  const describe = (state) => ({ population: state.agents.length, minimum: Math.min(...state.history.map((item) => item.population)), maximum: Math.max(...state.history.map((item) => item.population)), generation: state.generation, births: state.totalBirths, deaths: state.totalDeaths, speed: Number(garden.meanGardenTrait(state, 'speed').toFixed(1)), efficiency: Number(garden.meanGardenTrait(state, 'efficiency').toFixed(3)) })
  console.log(`Garden accelerated runs · 37,000 total steps in ${(performance.now() - acceleratedStart).toFixed(0)} ms: ${JSON.stringify({ rich: describe(rich), lean: describe(lean), changing: describe(changing), recovery: describe(recovery), dense: { ...describe(dense), observedMinimum: denseMinimum, observedMaximum: denseMaximum } })}`)
}

{
  const state = network.createNetworkState()
  assert.deepEqual(network.shortestRoute(state, 'origin', 'arrival'), ['origin', 'north', 'relay', 'south', 'arrival'], 'Dijkstra selects the deterministic minimum-latency route')
  assert.deepEqual(network.shortestRoute(state, 'origin', 'arrival', ['north']), ['origin', 'west', 'relay', 'south', 'arrival'], 'A route can exclude visited nodes to avoid packet backtracking')
  network.setLinkActive(state, 'on', false)
  assert.deepEqual(network.shortestRoute(state, 'origin', 'arrival'), ['origin', 'west', 'relay', 'south', 'arrival'], 'A failed link redirects route computation')
  network.setLinkActive(state, 'on', true)
  const packets = network.sendPacket(state, 'origin', 'arrival', 2)
  assert.equal(packets.length, 2)
  for (let i = 0; i < 40 && packets.some((packet) => packet.status !== 'delivered'); i++) network.stepNetwork(state)
  assert.ok(packets.every((packet) => packet.status === 'delivered' && packet.hops >= 3), 'Packets traverse links and arrive through their computed paths')
  assert.ok(network.averageDeliveredLatency(state) > 0)
  const congested = network.createNetworkState()
  congested.nodes = congested.nodes.filter((node) => ['origin', 'north'].includes(node.id))
  congested.links = [congested.links.find((link) => link.id === 'on')]
  congested.links[0].capacity = 1; congested.links[0].bandwidth = 1
  const burst = network.sendPacket(congested, 'origin', 'north', 4)
  network.stepNetwork(congested)
  assert.ok(burst.some((packet) => packet.status === 'dropped'), 'A bounded queue drops overflow packets under a burst')
  assert.ok(congested.links[0].dropped > 0)
  assert.equal(network.sendPacket(congested, 'unknown', 'north').length, 0, 'Unknown endpoints are rejected')
  assert.equal(network.sendPacket(congested, 'origin', 'north', Infinity).length, 0, 'Non-finite packet counts cannot allocate')
  const self = network.sendPacket(congested, 'north', 'north', 1, {})[0]
  assert.ok(self.status === 'delivered' && self.hops === 0, 'A local destination is delivered without inventing a network hop')

  const partition = network.createNetworkState(), waiting = network.sendPacket(partition, 'origin', 'arrival', 1)[0]
  for (const link of partition.links) link.active = false
  for (let i = 0; i < 4; i++) network.stepNetwork(partition)
  assert.equal(waiting.status, 'waiting', 'A disconnected network retains a packet without pretending to deliver it')
  for (const link of partition.links) link.active = true
  for (let i = 0; i < 50 && waiting.status !== 'delivered'; i++) network.stepNetwork(partition)
  assert.equal(waiting.status, 'delivered', 'The packet recovers after topology restoration')

  const dynamic = network.createNetworkState()
  dynamic.nodes = [{ id: 'a', x: 0.1, y: 0.5, label: 'A' }, { id: 'b', x: 0.5, y: 0.5, label: 'B' }, { id: 'c', x: 0.9, y: 0.5, label: 'C' }]
  const edge = (id, a, b, latency, bandwidth = 5, capacity = 20) => ({ id, a, b, latency, bandwidth, capacity, active: true, queue: [], transit: [], dropped: 0 })
  dynamic.links = [edge('ab', 'a', 'b', 1), edge('bc', 'b', 'c', 2), edge('ac', 'a', 'c', 5)]
  const routed = network.sendPacket(dynamic, 'a', 'c')[0]
  network.stepNetwork(dynamic)
  dynamic.links.find((link) => link.id === 'bc').queue.push(...Array.from({ length: 10 }, (_, i) => `load-${i}`))
  for (let i = 0; i < 20 && routed.status !== 'delivered'; i++) network.stepNetwork(dynamic)
  assert.equal(routed.status, 'delivered', 'A packet reaches its destination despite changing queue costs')
  assert.deepEqual(routed.route, ['a', 'b', 'c'], 'Per-hop queue changes cannot make one message revisit its previous node')
}

{
  const weak = lensing.traceSchwarzschildPhoton(200, 1, { step: 0.002, radius: 6000, maxPoints: 20000 })
  const reference = lensing.weakFieldDeflection(200, 1)
  assert.ok(!weak.captured && weak.deflection && Math.abs(weak.deflection - reference) / reference < 0.025, `Weak-field bending converges to 4M/b: ${weak.deflection} vs ${reference}`)
  const near = lensing.traceSchwarzschildPhoton(5.28, 1, { step: 0.003, maxPoints: 20000 })
  const far = lensing.traceSchwarzschildPhoton(8, 1, { step: 0.003 })
  assert.ok(!near.captured && near.deflection > far.deflection, 'Strong deflection rises sharply toward the critical impact parameter')
  const converged = lensing.traceSchwarzschildPhoton(8, 1, { step: 0.0015 })
  assert.ok(far.deflection && converged.deflection && Math.abs(far.deflection - converged.deflection) < 0.00002, 'RK4 deflection converges as the angular integration step is halved')
  const captured = lensing.traceSchwarzschildPhoton(5, 1, { step: 0.003 })
  assert.equal(captured.captured, true, 'Impact below b₍crit₎ = 3√3M crosses the capture region')
  assert.equal(captured.deflection, null)
  const scaled = lensing.traceSchwarzschildPhoton(16, 2, { step: 0.003 })
  assert.ok(scaled.deflection && Math.abs(scaled.deflection - far.deflection) < 0.002, 'Schwarzschild trajectories scale with M when b/M is fixed')
  assert.ok(Math.abs(far.conservedImpact - far.impact) / far.impact < 1e-7 && far.maxRelativeInvariantError < 1e-7, 'The numerically integrated null geodesic preserves its Schwarzschild impact invariant')
  const truncated = lensing.traceSchwarzschildPhoton(5.14, 1, { step: 0.025, maxAngle: 0.1, maxPoints: 5 })
  assert.equal(truncated.outcome, 'near-critical'); assert.equal(truncated.captured, false, 'A truncated subcritical ray is not reported as captured until it reaches the horizon')
  assert.throws(() => lensing.traceSchwarzschildPhoton(1e9, 1e-20), RangeError, 'Extreme ratios outside the integration range fail clearly')
  const table = lensing.createLensingTable(1, 24, 48)
  assert.equal(lensing.lookupDeflection(table, table.criticalImpact - 0.1), null)
  assert.ok((lensing.lookupDeflection(table, 12) ?? 0) > 0)
  assert.equal(lensing.lookupDeflection(table, NaN), null, 'Non-finite lookups do not poison the projection')
  assert.throws(() => lensing.traceSchwarzschildPhoton(Infinity, 1), RangeError, 'Non-finite impact parameters are rejected')
  assert.throws(() => lensing.traceSchwarzschildPhoton(8, 1, { radius: 1 }), RangeError, 'Integration cannot begin inside the horizon')
  assert.throws(() => lensing.createLensingTable(1, 24, 1), RangeError, 'A table needs a valid interpolation interval')
  assert.throws(() => lensing.rasterizeLensedSky(table, 2000, 1000, 36, 0.58), RangeError, 'The CPU raster has an explicit pixel budget')
  const rasterA = lensing.rasterizeLensedSky(table, 48, 36, 36, 0.58), rasterB = lensing.rasterizeLensedSky(table, 48, 36, 36, 0.58)
  assert.deepEqual(rasterA, rasterB, 'The same source field and deflection table produce deterministic image samples')
  assert.ok(rasterA.every((value, index) => index % 4 !== 3 || value === 255), 'Every lensed source pixel has opaque coverage')
}

console.log('Invisible World checks passed: finite-difference waves, geometric optics, Fourier synthesis, evolutionary ecology, packet routing, and Schwarzschild null geodesics.')
