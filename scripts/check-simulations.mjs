import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

async function loadModule(path) {
  const source = await readFile(resolve(path), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

const [gravity, cpu, neural, circuit, electric, automata] = await Promise.all([
  loadModule('src/simulations/gravity.ts'), loadModule('src/simulations/cpu.ts'),
  loadModule('src/simulations/neural.ts'), loadModule('src/simulations/circuit.ts'),
  loadModule('src/simulations/electric.ts'), loadModule('src/simulations/automata.ts'),
])

{
  const mass = 600, radius = 2, planetMass = .25, velocity = Math.sqrt((mass + planetMass) / radius)
  const barycenter = [
    { id: 1, x: -radius * planetMass / (mass + planetMass), y: 0, vx: 0, vy: -planetMass * velocity / mass, mass, color: '#fff' },
    { id: 2, x: radius * mass / (mass + planetMass), y: 0, vx: 0, vy: velocity * mass / (mass + planetMass), mass: planetMass, color: '#fff' },
  ]
  const before = gravity.gravityEnergy(barycenter)
  for (let i = 0; i < 1800; i++) gravity.integrateGravity(barycenter, .002, 1, 'pass')
  const after = gravity.gravityEnergy(barycenter)
  assert.ok(Math.abs(after - before) / Math.abs(before) < .003, `Velocity-Verlet orbital energy drift: ${before} → ${after}`)
  const star = { id: 8, x: 0, y: 0, vx: 0, vy: 0, mass: 980, color: '#fff' }
  const orbit = gravity.circularOrbitVelocity(star, 3.5, 0)
  assert.ok(orbit.vy > 0 && Math.abs(orbit.vx) < 1e-12, 'A body to the right should launch prograde, upward')
  assert.ok(Math.abs(Math.hypot(orbit.vx, orbit.vy) - Math.sqrt(980 / 3.5)) < .01, 'Circular launch should match the local orbital speed')
  const tinyPlanet = { id: 20, x: 1.2, y: 0, vx: 0, vy: 4, mass: .08, color: '#fff' }
  assert.equal(gravity.pickGravityBodyAtWorld([star, tinyPlanet], 1.2 + 18 / 80, 0, 80, 20)?.id, tinyPlanet.id, 'A tiny planet has a forgiving screen-space target')
  const closeBodies = [
    { ...star, x: 0, mass: 1 }, { ...tinyPlanet, id: 21, x: .1, mass: .1 },
  ]
  assert.equal(gravity.pickGravityBodyAtWorld(closeBodies, .08, 0, 100, 20)?.id, 21, 'The nearest center wins when hit targets overlap')
  const samplesAt = (hz, zoomScale, pxPerWorldSecond = 3) => {
    const samples = []
    for (let frame = 0; frame <= hz / 5; frame++) {
      const time = frame * 1000 / hz
      const worldX = time / 1000 * pxPerWorldSecond
      samples.push({ x: worldX * zoomScale / zoomScale, y: 0, time })
    }
    return samples
  }
  const throw60 = gravity.estimateGravityThrowVelocity(samplesAt(60, 24))
  const throw120 = gravity.estimateGravityThrowVelocity(samplesAt(120, 240))
  assert.ok(throw60 && throw120 && Math.abs(throw60.vx - throw120.vx) < .01, 'World-space throws are stable across 60 and 120 Hz sampling and zoom scales')
  assert.equal(gravity.estimateGravityThrowVelocity([{ x: 0, y: 0, time: 0 }, { x: .01, y: .01, time: 100 }]), null, 'A stationary release does not create launch velocity')
  const fastThrow = gravity.estimateGravityThrowVelocity([{ x: 0, y: 0, time: 0 }, { x: 100, y: 0, time: 100 }])
  assert.ok(fastThrow && Math.hypot(fastThrow.vx, fastThrow.vy) <= 28, 'Throw velocity has a predictable maximum')
  const heldPair = [
    { ...star, id: 31, mass: 50 }, { id: 32, x: 2, y: 0, vx: 0, vy: 5, mass: .5, color: '#fff' },
  ]
  const heldPosition = { x: heldPair[1].x, y: heldPair[1].y, vx: heldPair[1].vx, vy: heldPair[1].vy }
  for (let i = 0; i < 300; i++) gravity.integrateGravity(heldPair, .003, 1, 'merge', 32)
  assert.deepEqual({ x: heldPair[1].x, y: heldPair[1].y, vx: heldPair[1].vx, vy: heldPair[1].vy }, heldPosition, 'A manipulated body stays fixed with its original velocity while the rest of the system continues')
  assert.notEqual(heldPair[0].x, 0, 'Other bodies continue to respond to a held body')
  const circular = [star, { id: 9, x: 3.5, y: 0, ...orbit, mass: .5, color: '#fff' }]
  for (let i = 0; i < 2400; i++) gravity.integrateGravity(circular, .003, 1, 'pass')
  const orbitRadius = Math.hypot(circular[1].x - circular[0].x, circular[1].y - circular[0].y)
  assert.ok(Math.abs(orbitRadius - 3.5) < .035, `A circular launch should remain near its starting radius: ${orbitRadius}`)
  const softenedPair = [
    { id: 40, x: -.8, y: .4, vx: 0, vy: 0, mass: 2, color: '#fff' },
    { id: 41, x: 1.1, y: -.2, vx: 0, vy: 0, mass: 3, color: '#fff' },
  ]
  const acceleration = gravity.gravityAcceleration(softenedPair, .7)[0]
  const potentialAt = (x, y) => gravity.gravityEnergy([{ ...softenedPair[0], x, y }, softenedPair[1]], .7)
  const h = 1e-5, x0 = softenedPair[0].x, y0 = softenedPair[0].y
  const numericAx = -(potentialAt(x0 + h, y0) - potentialAt(x0 - h, y0)) / (2 * h * softenedPair[0].mass)
  const numericAy = -(potentialAt(x0, y0 + h) - potentialAt(x0, y0 - h)) / (2 * h * softenedPair[0].mass)
  assert.ok(Math.abs(acceleration.ax - numericAx) < 1e-7 && Math.abs(acceleration.ay - numericAy) < 1e-7, 'The softened acceleration is the gradient of the matching pair potential')
  const freePair = [
    { id: 42, x: -.8, y: .4, vx: .15, vy: .45, mass: 2, color: '#fff' },
    { id: 43, x: 1.1, y: -.2, vx: -.1, vy: -.3, mass: 3, color: '#fff' },
  ]
  const momentumBefore = freePair.reduce((p, body) => ({ x: p.x + body.mass * body.vx, y: p.y + body.mass * body.vy }), { x: 0, y: 0 })
  for (let i = 0; i < 400; i++) gravity.integrateGravity(freePair, .001, .7, 'pass')
  const momentumAfter = freePair.reduce((p, body) => ({ x: p.x + body.mass * body.vx, y: p.y + body.mass * body.vy }), { x: 0, y: 0 })
  assert.ok(Math.hypot(momentumAfter.x - momentumBefore.x, momentumAfter.y - momentumBefore.y) < 1e-11, 'An unforced, collision-free softened pair conserves total linear momentum')
  const collision = [
    { id: 3, x: -.02, y: 0, vx: 1, vy: 0, mass: 1, color: '#fff' },
    { id: 4, x: .02, y: 0, vx: -1, vy: 0, mass: 1, color: '#fff' },
  ]
  gravity.integrateGravity(collision, .001, 0, 'merge')
  assert.equal(collision.length, 1)
  assert.ok(Math.abs(collision[0].vx) < 1e-9, 'Merge should conserve linear momentum')
  const coincident = [
    { id: 5, x: 0, y: 0, vx: 1, vy: 0, mass: 1, color: '#fff', trail: [{ x: -1, y: 0 }] },
    { id: 6, x: 0, y: 0, vx: -1, vy: 0, mass: 1, color: '#fff', trail: [{ x: 1, y: 0 }] },
  ]
  gravity.integrateGravity(coincident, .001, 0, 'merge')
  assert.equal(coincident.length, 1, 'Bodies placed at precisely the same point should merge')
  assert.ok(Math.abs(coincident[0].vx) < 1e-9, 'Coincident merge should conserve linear momentum')
  assert.equal(coincident[0].trail?.length, 0, 'Merged bodies should not connect their unrelated historical trails')
  const coincidentBounce = [
    { id: 7, x: 0, y: 0, vx: 1, vy: 0, mass: 1, color: '#fff' },
    { id: 8, x: 0, y: 0, vx: -1, vy: 0, mass: 1, color: '#fff' },
  ]
  gravity.integrateGravity(coincidentBounce, .001, 0, 'bounce')
  assert.equal(coincidentBounce.length, 2)
  assert.ok(Math.hypot(coincidentBounce[1].x - coincidentBounce[0].x, coincidentBounce[1].y - coincidentBounce[0].y) >= gravity.bodyRadius(coincidentBounce[0]) + gravity.bodyRadius(coincidentBounce[1]), 'Coincident bounce should separate bodies')
}

{
  const program = cpu.parseProgram('LDI A, 7\nLDI B, 5\nADD A, B\nOUT A\nHLT')
  const state = cpu.createCpuState()
  const staged = cpu.createCpuState(), ldi = cpu.parseProgram('LDI A, 7')
  cpu.fetchCpuInstruction(staged, ldi); assert.equal(staged.pc, 1); assert.equal(staged.registers.A, 0)
  cpu.decodeCpuInstruction(staged); assert.equal(staged.transfer.includes('DECODER'), true); assert.equal(staged.registers.A, 0)
  cpu.executeCpuInstruction(staged); assert.equal(staged.registers.A, 7)
  for (let i = 0; i < 8 && !state.halted; i++) cpu.executeCpuCycle(state, program)
  assert.equal(state.registers.A, 12)
  assert.equal(state.output, 12)
  assert.equal(state.halted, true)
  const runDemo = (task, a, b) => {
    const instructions = cpu.parseProgram(cpu.createCpuDemoProgram(task, a, b))
    const result = cpu.createCpuState()
    for (let i = 0; i < 40 && !result.halted; i++) cpu.executeCpuCycle(result, instructions)
    assert.equal(result.halted, true, `${task} demo halts through actual CPU instructions`)
    return result
  }
  assert.equal(runDemo('sum', 5, 3).output, 8, 'Task-first addition executes the submitted values on the CPU')
  assert.equal(runDemo('compare', 7, 7).output, 1, 'The comparison program reports equal values through its branch')
  assert.equal(runDemo('compare', 7, 5).output, 0, 'The comparison program reports unequal values through its branch')
  const memoryDemo = runDemo('memory', 42, 0)
  assert.equal(memoryDemo.memory[3], 42, 'The task-first memory program stores a value in RAM')
  assert.equal(memoryDemo.output, 42, 'The task-first memory program retrieves its stored value')
  assert.equal(runDemo('count', 0, 0).output, 5, 'The task-first counter reaches five by looping')
  const memoryProgram = cpu.parseProgram('LDI A, 42\nSTORE 3, A\nLOAD B, 3\nOUT B\nHLT')
  const memoryState = cpu.createCpuState()
  for (let i = 0; i < 8 && !memoryState.halted; i++) cpu.executeCpuCycle(memoryState, memoryProgram)
  assert.equal(memoryState.memory[3], 42)
  assert.equal(memoryState.registers.B, 42)
  assert.equal(memoryState.output, 42)
  const byteProgram = cpu.parseProgram('LDI A, 250\nLDI B, 10\nADD A, B\nOUT A\nHLT')
  const byteState = cpu.createCpuState()
  for (let i = 0; i < 8 && !byteState.halted; i++) cpu.executeCpuCycle(byteState, byteProgram)
  assert.equal(byteState.registers.A, 4, '8-bit addition should wrap modulo 256')
  assert.equal(byteState.output, 4)
  const loopProgram=cpu.parseProgram('LDI A, 0\nLDI B, 1\nLDI C, 5\nADD A, B\nSUB C, B\nJNZ C, 3\nOUT A\nHLT'),loopState=cpu.createCpuState()
  for(let i=0;i<40&&!loopState.halted;i++)cpu.executeCpuCycle(loopState,loopProgram)
  assert.equal(loopState.output,5)
}

{
  const hand = { sizes: [2, 1], layers: [{ weights: [[1, -1]], biases: [.5] }] }
  assert.ok(Math.abs(neural.forwardNetwork(hand, [1, .25], 'tanh').output[0] - Math.tanh(1.25)) < 1e-12)
  const gradientNetwork = { sizes: [2, 2, 1], layers: [
    { weights: [[.4, -.2], [-.3, .5]], biases: [.45, .6] },
    { weights: [[.35, -.2]], biases: [.4] },
  ] }
  const gradientSample = { x: [.6, .2], y: .8 }
  const objective = (network, activation) => {
    const prediction = neural.forwardNetwork(network, gradientSample.x, activation).output[0]
    const target = activation === 'tanh' ? gradientSample.y * 2 - 1 : gradientSample.y
    return .5 * (prediction - target) ** 2
  }
  for (const activation of ['tanh', 'sigmoid', 'relu']) {
    const epsilon = 1e-4, rate = 1e-5, plus = structuredClone(gradientNetwork), minus = structuredClone(gradientNetwork), trained = structuredClone(gradientNetwork)
    plus.layers[0].weights[0][0] += epsilon
    minus.layers[0].weights[0][0] -= epsilon
    const numericGradient = (objective(plus, activation) - objective(minus, activation)) / (2 * epsilon)
    const initialWeight = trained.layers[0].weights[0][0]
    neural.trainNetworkStep(trained, [gradientSample], activation, rate)
    const backpropGradient = (initialWeight - trained.layers[0].weights[0][0]) / rate
    assert.ok(Math.abs(backpropGradient - numericGradient) < 2e-6, `${activation} backpropagation agrees with a finite-difference loss gradient`)
  }
  const samples = [
    { x: [-1, -1], y: 1 }, { x: [-1, 1], y: 0 },
    { x: [1, -1], y: 0 }, { x: [1, 1], y: 1 },
  ]
  let seed = 801
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const visitorPattern = Array.from({ length: 48 }, () => { const x = random() * 2 - 1, y = random() * 2 - 1; return { x: [x, y], y: Number(x * y > 0) } })
  const visitorNetwork = neural.createNetwork([2, 5, 1], 1)
  const visitorStart = neural.accuracy(visitorNetwork, visitorPattern, 'tanh')
  for (let i = 0; i < 75; i++) neural.trainNetworkStep(visitorNetwork, visitorPattern, 'tanh', .08)
  assert.ok(neural.accuracy(visitorNetwork, visitorPattern, 'tanh') >= .9, 'The exhibit’s deterministic starter network learns its visible XOR pattern in a short training run')
  assert.ok(neural.accuracy(visitorNetwork, visitorPattern, 'tanh') > visitorStart + .35, 'Training changes the network’s predictions for the starter examples')
  const net = neural.createNetwork([2, 6, 1], 31)
  const startLoss = samples.reduce((sum, sample) => sum + .5 * (neural.forwardNetwork(net, sample.x, 'tanh').output[0] - (sample.y * 2 - 1)) ** 2, 0) / samples.length
  for (let i = 0; i < 1500; i++) neural.trainNetworkStep(net, samples, 'tanh', .08)
  const finalLoss = samples.reduce((sum, sample) => sum + .5 * (neural.forwardNetwork(net, sample.x, 'tanh').output[0] - (sample.y * 2 - 1)) ** 2, 0) / samples.length
  assert.ok(finalLoss < startLoss * .28, `Backprop should reduce XOR loss: ${startLoss} → ${finalLoss}`)
  assert.ok(neural.accuracy(net, samples, 'tanh') >= .75, 'Trained XOR classifier should learn most corners')
}

{
  const nodes = [
    { id: 'a', type: 'input', x: 0, y: 0, value: true }, { id: 'b', type: 'input', x: 0, y: 0, value: false },
    { id: 'sum', type: 'xor', x: 0, y: 0 }, { id: 'carry', type: 'and', x: 0, y: 0 },
    { id: 'out', type: 'output', x: 0, y: 0 },
  ]
  const wires = [{ from: 'a', to: 'sum', input: 0 }, { from: 'b', to: 'sum', input: 1 }, { from: 'sum', to: 'out', input: 0 }, { from: 'a', to: 'carry', input: 0 }, { from: 'b', to: 'carry', input: 1 }]
  assert.equal(circuit.evaluateCircuit(nodes, wires).values.out, true)
  nodes[1].value = true
  const both = circuit.evaluateCircuit(nodes, wires)
  assert.equal(both.values.sum, false)
  assert.equal(both.values.carry, true)
  assert.equal(both.status, 'ready')
  assert.equal(circuit.evaluateCircuit(nodes, wires.slice(0, 2)).status, 'disconnected')
  const cyclic = circuit.evaluateCircuit([{ id: 'x', type: 'not', x: 0, y: 0 }], [{ from: 'x', to: 'x', input: 0 }])
  assert.equal(cyclic.status, 'cycle')
  assert.equal(circuit.evaluateCircuit(nodes, [...wires, { from: 'missing', to: 'sum', input: 0 }]).status, 'invalid')
}

{
  const dipole = [{ id: 1, x: -1, y: 0, q: 1 }, { id: 2, x: 1, y: 0, q: -1 }]
  const field = electric.electricField(dipole, 0, 0), potential = electric.electricPotential(dipole, 0, 0)
  assert.ok(field.x > 1.9 && Math.abs(field.y) < 1e-12, 'Dipole fields add between the charges')
  assert.ok(Math.abs(potential) < 1e-12)
  const line = electric.integrateFieldLine(dipole, { x: -.92, y: .08 }, 1, .02, 500)
  assert.ok(line.length > 10 && line.at(-1).x > .9, 'A dipole field line should run from the positive charge toward the negative charge')
  const one = electric.electricField([{ id: 1, x: 0, y: 0, q: 1 }], 1, 0)
  assert.ok(one.x > .99 && Math.abs(one.y) < 1e-12)
  const charges = [{ id: 3, x: -.3, y: .4, q: 2 }, { id: 4, x: 1.1, y: -.5, q: -.7 }]
  const point = { x: .37, y: -.21 }, sampledField = electric.electricField(charges, point.x, point.y)
  const potentialAt = (x, y) => electric.electricPotential(charges, x, y)
  const h = 1e-5
  const dx = (potentialAt(point.x + h, point.y) - potentialAt(point.x - h, point.y)) / (2 * h)
  const dy = (potentialAt(point.x, point.y + h) - potentialAt(point.x, point.y - h)) / (2 * h)
  assert.ok(Math.abs(sampledField.x + dx) < 1e-7 && Math.abs(sampledField.y + dy) < 1e-7, 'The softened electric field agrees with the negative numerical gradient of its potential')
}

{
  const cells = new Uint8Array(9 * 9)
  ;[[4, 3], [4, 4], [4, 5]].forEach(([x, y]) => { cells[y * 9 + x] = 1 })
  const next = automata.stepAutomaton(cells, 9, 9, 'life')
  assert.deepEqual([...next].map((value, index) => value ? index : -1).filter((index) => index >= 0), [39, 40, 41])
  const stable = new Uint8Array(7 * 7); [[2,2],[3,2],[2,3],[3,3]].forEach(([x,y]) => { stable[y*7+x]=1 })
  assert.deepEqual([...automata.stepAutomaton(stable, 7, 7, 'life')], [...stable])
  const seed = new Uint8Array(7 * 7); seed[3*7+2]=1;seed[3*7+3]=1
  assert.equal([...automata.stepAutomaton(seed, 7, 7, 'seeds')].reduce((a,b)=>a+b,0), 4)
  const six = new Uint8Array(9*9); [[3,3],[4,3],[5,3],[3,4],[5,4],[4,5]].forEach(([x,y])=>{six[y*9+x]=1})
  assert.equal(automata.stepAutomaton(six,9,9,'highlife')[4*9+4],1)
  assert.equal(automata.stepAutomaton(six,9,9,'life')[4*9+4],0)
  const wrappedBirth = new Uint8Array(25); [[4,1],[0,1],[1,1]].forEach(([x,y])=>{wrappedBirth[y*5+x]=1})
  assert.equal(automata.stepAutomaton(wrappedBirth,5,5,'life')[2*5],1, 'Neighbor counts cross the wrapped left/right grid edge')
  const brain = new Uint8Array(9*9); [[3,4],[5,4]].forEach(([x,y])=>{brain[y*9+x]=1})
  const firing=automata.stepAutomaton(brain,9,9,'brian');assert.equal(firing[4*9+4],1);assert.equal(automata.stepAutomaton(firing,9,9,'brian')[4*9+4],2)
  const garden = new Uint8Array(120 * 120)
  automata.placePattern(garden, 120, 120, automata.patterns.pulsarGarden, 30, 30)
  assert.equal([...garden].reduce((sum, value) => sum + value, 0), 9 * automata.patterns.pulsar.cells.length, 'The curated garden should contain nine independent pulsars')
  let gardenCycle = garden
  for (let i = 0; i < 3; i++) gardenCycle = automata.stepAutomaton(gardenCycle, 120, 120, 'life')
  assert.deepEqual([...gardenCycle], [...garden], 'Each pulsar should return to its original phase after three generations')
}

console.log('Simulation checks passed: gravity, CPU, backpropagation, circuits, electrostatics, and cellular automata.')
