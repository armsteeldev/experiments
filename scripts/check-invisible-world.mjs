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
  assert.equal(waves.createDoubleSlitState(80, 50).emitters.length, 1)
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
}

{
  const state = network.createNetworkState()
  assert.deepEqual(network.shortestRoute(state, 'origin', 'arrival'), ['origin', 'north', 'relay', 'south', 'arrival'], 'Dijkstra selects the deterministic minimum-latency route')
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
  assert.equal(far.conservedImpact, far.impact)
  const table = lensing.createLensingTable(1, 24, 48)
  assert.equal(lensing.lookupDeflection(table, table.criticalImpact - 0.1), null)
  assert.ok((lensing.lookupDeflection(table, 12) ?? 0) > 0)
}

console.log('Invisible World checks passed: finite-difference waves, geometric optics, Fourier synthesis, evolutionary ecology, packet routing, and Schwarzschild null geodesics.')
