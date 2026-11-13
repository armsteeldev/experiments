import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

async function loadModule(path) {
  const source = await readFile(resolve(path), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

const adder = await loadModule('src/simulations/adder.ts')

for (const [kind, expected] of [
  ['AND', [false, false, false, true]],
  ['OR', [false, true, true, true]],
  ['XOR', [false, true, true, false]],
]) {
  let index = 0
  for (const a of [false, true]) for (const b of [false, true]) assert.equal(adder.evaluateGate(kind, [a, b]), expected[index++], `${kind} truth table`)
}
assert.deepEqual([false, true].map((value) => adder.evaluateGate('NOT', [value])), [true, false], 'NOT truth table')
for (const kind of ['AND', 'OR', 'XOR', 'NOT']) assert.equal(adder.evaluateGate(kind, []), false, `${kind} must reject a missing input as low`)

function signedValue(value, width) {
  const sign = 2 ** (width - 1)
  return value >= sign ? value - 2 ** width : value
}

function verifyResult(circuit, a, b, context) {
  const result = adder.evaluateAdder(circuit, a, b)
  const limit = 2 ** circuit.width
  const expected = a + b
  const expectedWrapped = expected % limit
  const signedRaw = signedValue(a, circuit.width) + signedValue(b, circuit.width)
  const signedLimit = 2 ** (circuit.width - 1)
  const expectedSigned = ((signedRaw + signedLimit) % limit + limit) % limit - signedLimit
  assert.equal(result.wrapped, expectedWrapped, `${context}: wrapped result ${a} + ${b}`)
  assert.equal(result.carryOut, expected >= limit, `${context}: carry-out ${a} + ${b}`)
  assert.equal(result.unsignedResult, expected, `${context}: full unsigned result ${a} + ${b}`)
  assert.equal(result.signedOverflow, signedRaw < -signedLimit || signedRaw >= signedLimit, `${context}: signed overflow ${a} + ${b}`)
  assert.equal(result.signedA, signedValue(a, circuit.width), `${context}: signed input A`)
  assert.equal(result.signedB, signedValue(b, circuit.width), `${context}: signed input B`)
  assert.equal(result.signedResult, expectedSigned, `${context}: signed wrapped result`)
  assert.equal(result.sumBits.reduce((sum, bit, index) => sum + (bit ? 2 ** index : 0), 0), expectedWrapped, `${context}: visible sum bits`)
  assert.equal(result.carries[0], false, `${context}: initial carry-in is tied low`)
  assert.equal(result.carries.at(-1), result.carryOut, `${context}: final carry rail agrees with carry-out`)
  for (const gate of circuit.gates) {
    assert.ok(gate.inputs.every((signal) => signal in result.values), `${context}: ${gate.id} has resolved inputs`)
    assert.equal(result.values[gate.id], adder.evaluateGate(gate.kind, gate.inputs.map((signal) => result.values[signal])), `${context}: ${gate.id} follows its truth table`)
  }
  return result
}

for (const width of [4, 8]) {
  const limit = 2 ** width
  for (const architecture of ['ripple', 'lookahead']) {
    const circuit = adder.createAdderCircuit(width, architecture)
    for (let a = 0; a < limit; a++) {
      for (let b = 0; b < limit; b++) verifyResult(circuit, a, b, `${width}-bit ${architecture}`)
    }
    console.log(`Exhaustive ${width}-bit ${architecture} addition: ${limit * limit} input pairs passed.`)
  }
}

for (const architecture of ['ripple', 'lookahead']) {
  const circuit16 = adder.createAdderCircuit(16, architecture)
  for (const [a, b] of [[0, 0], [65535, 0], [65535, 1], [65535, 65535], [32767, 1], [32768, 32768], [0xaaaa, 0x5555], [0x7fff, 0x8001]]) {
    verifyResult(circuit16, a, b, `16-bit ${architecture}`)
  }
}

const byteRipple = adder.createAdderCircuit(8, 'ripple')
const byteLookahead = adder.createAdderCircuit(8, 'lookahead')
for (const [a, b] of [[255, 1], [255, 255], [127, 1], [128, 128], [127, 0], [137, 86]]) {
  const ripple = verifyResult(byteRipple, a, b, '8-bit ripple boundary')
  const lookahead = verifyResult(byteLookahead, a, b, '8-bit look-ahead boundary')
  assert.equal(lookahead.unsignedResult, ripple.unsignedResult, `Architectures agree for ${a} + ${b}`)
  assert.deepEqual(lookahead.sumBits, ripple.sumBits, `Architectures produce identical sum bits for ${a} + ${b}`)
  assert.deepEqual(lookahead.carries, ripple.carries, `Architectures produce identical carry bits for ${a} + ${b}`)
}
assert.equal(adder.evaluateAdder(byteRipple, 255, 1).unsignedResult, 256, 'A carry ripples through seven zero bits and exits the byte')
assert.equal(adder.evaluateAdder(byteRipple, 127, 1).signedOverflow, true, 'Positive signed overflow is reported')
assert.equal(adder.evaluateAdder(byteRipple, 128, 128).signedOverflow, true, 'Negative signed overflow is reported')
assert.equal(adder.evaluateAdder(byteRipple, 255, 1).signedOverflow, false, 'Unsigned carry does not imply signed overflow')

const traceCircuit = adder.createAdderCircuit(8, 'ripple')
const trace = adder.createAdderTrace(traceCircuit)
assert.equal(trace.length, traceCircuit.gates.length + 1, 'Trace has an initial source state and one event per gate')
assert.equal(trace[0].role, 'inputs')
for (let index = 0; index < trace.length; index++) {
  const event = trace[index]
  if (index > 0) {
    assert.equal(event.gateId, traceCircuit.gates[index - 1].id, 'Trace order is the actual topological gate order')
    assert.equal(event.bit, traceCircuit.gates[index - 1].bit)
  }
  const resolved = adder.resolvedSignalsAt(traceCircuit, index)
  assert.ok(traceCircuit.inputSignals.every((signal) => resolved.has(signal)), 'Input lines resolve before the first gate')
  assert.ok(traceCircuit.gates.slice(0, index).every((gate) => resolved.has(gate.id)), `Trace ${index} contains every prior gate`)
  assert.ok(traceCircuit.gates.slice(index).every((gate) => !resolved.has(gate.id)), `Trace ${index} hides every future gate`)
  for (const gate of traceCircuit.gates.slice(0, index)) assert.ok(gate.inputs.every((signal) => resolved.has(signal)), `${gate.id} resolves only after every input signal`)
  const resolvedWires = adder.resolvedWiresAt(traceCircuit, index)
  for (const wire of traceCircuit.wires) assert.equal(resolvedWires.has(wire.id), resolved.has(wire.from), `${wire.id} resolves exactly when its source does`)
}
assert.equal(adder.clampTraceIndex(-9, trace.length), 0, 'Reset clamps to the input frame')
assert.equal(adder.clampTraceIndex(trace.length + 90, trace.length), trace.length - 1, 'Playback clamps to the final recorded frame')
assert.equal(adder.clampTraceIndex(14, trace.length) - 1, 13, 'Step backward visits the immediately previous gate state')
assert.equal(adder.resolvedSignalsAt(traceCircuit, 0).has('ZERO'), true, 'The tied-low initial carry is already resolved')
assert.equal(adder.resolvedSignalsAt(traceCircuit, 0).size, traceCircuit.inputSignals.length + 1, 'Restart clears every computed gate and retains only sources')
assert.equal(adder.resolvedSignalsAt(traceCircuit, trace.length - 1).size, traceCircuit.inputSignals.length + traceCircuit.gates.length + 1, 'The final trace frame resolves all graph nodes')

// Reusing a compiled graph with arbitrary inputs must rebuild values without mutating earlier traces.
const sequence = [[137, 86], [255, 1], [0, 255], [19, 237], [137, 86]]
const snapshots = sequence.map(([a, b]) => adder.evaluateAdder(traceCircuit, a, b))
assert.equal(snapshots[0].unsignedResult, snapshots.at(-1).unsignedResult, 'Returning to earlier inputs reproduces the same result')
assert.equal(snapshots[0].values[traceCircuit.gates[0].id], snapshots.at(-1).values[traceCircuit.gates[0].id], 'Arbitrary input changes reproduce each gate state')
assert.notEqual(snapshots[0].unsignedResult, snapshots[1].unsignedResult, 'Changed inputs produce a fresh output')

// Playback speed affects only event timing; each indexed state and final arithmetic value are fixed.
for (const rate of [0.5, 1, 2, 4]) {
  const interval = 145 / rate
  let cursor = 0
  for (let elapsed = interval; elapsed < interval * (trace.length - 1); elapsed += interval) cursor = Math.min(cursor + 1, trace.length - 1)
  cursor = adder.clampTraceIndex(cursor + 1, trace.length)
  const final = adder.evaluateAdder(traceCircuit, 255, 1)
  assert.equal(cursor, trace.length - 1, `${rate}× playback reaches the final frame`)
  assert.equal(final.unsignedResult, 256, `${rate}× playback leaves simulation math unchanged`)
}

assert.throws(() => adder.createAdderCircuit(5, 'ripple'), /4, 8, or 16/)
assert.throws(() => adder.evaluateAdder(byteRipple, 256, 0), /integers from 0 to 255/)
assert.throws(() => adder.evaluateAdder(byteRipple, -1, 0), /integers from 0 to 255/)

console.log('Adder checks passed: all gate truth tables, exhaustive 4/8-bit pairs, 16-bit boundaries, carry/overflow, architecture equivalence, traces, replay and input changes.')
