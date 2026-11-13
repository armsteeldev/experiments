export type AdderArchitecture = 'ripple' | 'lookahead'
export type GateKind = 'AND' | 'OR' | 'XOR' | 'NOT'
export type GateRole = 'propagate' | 'generate' | 'sum' | 'carry-term' | 'carry' | 'prefix-term' | 'prefix-carry' | 'prefix-propagate'

export type AdderGate = {
  id: string
  kind: GateKind
  inputs: string[]
  bit: number
  stage: number
  role: GateRole
  label: string
}

export type AdderWire = {
  id: string
  from: string
  to: string
  inputIndex: number
  output?: string
}

export type AdderCircuit = {
  width: number
  architecture: AdderArchitecture
  gates: AdderGate[]
  wires: AdderWire[]
  inputSignals: string[]
  sumSignals: string[]
  carrySignals: string[]
}

export type AdderEvaluation = {
  a: number
  b: number
  values: Record<string, boolean>
  sumBits: boolean[]
  carries: boolean[]
  wrapped: number
  carryOut: boolean
  unsignedResult: number
  signedOverflow: boolean
  signedA: number
  signedB: number
  signedResult: number
}

export type AdderTraceEvent = {
  index: number
  gateId: string | null
  bit: number | null
  role: GateRole | 'inputs'
}

const signalA = (bit: number) => `A${bit}`
const signalB = (bit: number) => `B${bit}`
const signalSum = (bit: number) => `S${bit}`
const signalCarry = (bit: number) => `C${bit}`

export function evaluateGate(kind: GateKind, inputs: boolean[]): boolean {
  switch (kind) {
    case 'AND': return inputs.length === 2 && inputs[0] && inputs[1]
    case 'OR': return inputs.length === 2 && (inputs[0] || inputs[1])
    case 'XOR': return inputs.length === 2 && inputs[0] !== inputs[1]
    case 'NOT': return inputs.length === 1 && !inputs[0]
  }
}

export function createAdderCircuit(width: number, architecture: AdderArchitecture): AdderCircuit {
  if (![4, 8, 16].includes(width)) throw new RangeError('Adder width must be 4, 8, or 16 bits.')
  const gates: AdderGate[] = []
  const makeGate = (kind: GateKind, inputs: string[], bit: number, stage: number, role: GateRole, label: string) => {
    const id = `${role.replaceAll('-', '_')}_${bit}_${stage}`
    if (gates.some((gate) => gate.id === id)) throw new Error(`Duplicate gate id: ${id}`)
    gates.push({ id, kind, inputs, bit, stage, role, label })
    return id
  }

  const propagate: string[] = Array(width)
  const generate: string[] = Array(width)
  const sumSignals: string[] = Array(width)
  const carrySignals: string[] = Array(width + 1)
  carrySignals[0] = 'ZERO'

  if (architecture === 'ripple') {
    for (let bit = 0; bit < width; bit++) {
      const a = signalA(bit), b = signalB(bit)
      if (bit === 0) {
        // The least significant slice is a half adder: its carry-in is fixed at zero.
        const sum = makeGate('XOR', [a, b], bit, 0, 'propagate', `S₀ · A₀ ⊕ B₀`)
        const carry = makeGate('AND', [a, b], bit, 0, 'generate', `C₁ · A₀ ∧ B₀`)
        propagate[bit] = sum
        generate[bit] = carry
        sumSignals[bit] = sum
        carrySignals[1] = carry
        continue
      }

      propagate[bit] = makeGate('XOR', [a, b], bit, 0, 'propagate', `P${bit} · A${bit} ⊕ B${bit}`)
      generate[bit] = makeGate('AND', [a, b], bit, 0, 'generate', `G${bit} · A${bit} ∧ B${bit}`)
      sumSignals[bit] = makeGate('XOR', [propagate[bit], carrySignals[bit]], bit, 0, 'sum', `S${bit} · P${bit} ⊕ C${bit}`)
      const carryTerm = makeGate('AND', [propagate[bit], carrySignals[bit]], bit, 0, 'carry-term', `P${bit} ∧ C${bit}`)
      carrySignals[bit + 1] = makeGate('OR', [generate[bit], carryTerm], bit, 0, 'carry', `C${bit + 1} · G${bit} ∨ P${bit}C${bit}`)
    }
  } else {
    for (let bit = 0; bit < width; bit++) {
      const a = signalA(bit), b = signalB(bit)
      propagate[bit] = makeGate('XOR', [a, b], bit, 0, 'propagate', `P${bit} · A${bit} ⊕ B${bit}`)
      generate[bit] = makeGate('AND', [a, b], bit, 0, 'generate', `G${bit} · A${bit} ∧ B${bit}`)
    }

    // Kogge–Stone prefix stages combine generate/propagate pairs over spans 1, 2, 4, …
    // Each node in the prefix network is an ordinary AND or OR gate in the graph.
    let prefixP = [...propagate]
    let prefixG = [...generate]
    let stage = 0
    for (let span = 1; span < width; span *= 2) {
      const nextP = [...prefixP]
      const nextG = [...prefixG]
      stage++
      for (let bit = span; bit < width; bit++) {
        const term = makeGate('AND', [prefixP[bit], prefixG[bit - span]], bit, stage, 'prefix-term', `P${bit} · G${bit - span}`)
        nextG[bit] = makeGate('OR', [prefixG[bit], term], bit, stage, 'prefix-carry', `G${bit}:${bit - span} · G${bit} ∨ P${bit}G${bit - span}`)
        nextP[bit] = makeGate('AND', [prefixP[bit], prefixP[bit - span]], bit, stage, 'prefix-propagate', `P${bit}:${bit - span} · P${bit}P${bit - span}`)
      }
      prefixP = nextP
      prefixG = nextG
    }

    for (let bit = 0; bit < width; bit++) {
      if (bit === 0) sumSignals[bit] = propagate[bit]
      else sumSignals[bit] = makeGate('XOR', [propagate[bit], prefixG[bit - 1]], bit, stage + 1, 'sum', `S${bit} · P${bit} ⊕ C${bit}`)
      carrySignals[bit + 1] = prefixG[bit]
    }
  }

  const inputSignals = Array.from({ length: width }, (_, bit) => [signalA(bit), signalB(bit)]).flat()
  const wires: AdderWire[] = []
  for (const gate of gates) {
    gate.inputs.forEach((from, inputIndex) => wires.push({ id: `${from}>${gate.id}:${inputIndex}`, from, to: gate.id, inputIndex }))
  }
  for (let bit = 0; bit < width; bit++) wires.push({ id: `${sumSignals[bit]}>sum:${bit}`, from: sumSignals[bit], to: `output-sum-${bit}`, inputIndex: 0, output: signalSum(bit) })
  wires.push({ id: `${carrySignals[width]}>carry-out`, from: carrySignals[width], to: 'output-carry', inputIndex: 0, output: signalCarry(width) })

  return { width, architecture, gates, wires, inputSignals, sumSignals, carrySignals }
}

export function evaluateAdder(circuit: AdderCircuit, a: number, b: number): AdderEvaluation {
  const limit = 2 ** circuit.width
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= limit || b >= limit) {
    throw new RangeError(`Inputs must be integers from 0 to ${limit - 1}.`)
  }
  const values: Record<string, boolean> = { ZERO: false }
  for (let bit = 0; bit < circuit.width; bit++) {
    values[signalA(bit)] = ((a >> bit) & 1) === 1
    values[signalB(bit)] = ((b >> bit) & 1) === 1
  }
  for (const gate of circuit.gates) {
    const gateInputs = gate.inputs.map((signal) => {
      if (!(signal in values)) throw new Error(`Gate ${gate.id} reads unresolved signal ${signal}.`)
      return values[signal]
    })
    values[gate.id] = evaluateGate(gate.kind, gateInputs)
  }
  const sumBits = circuit.sumSignals.map((signal) => values[signal])
  const carries = circuit.carrySignals.map((signal) => values[signal])
  const wrapped = sumBits.reduce((result, bit, index) => result + (bit ? 2 ** index : 0), 0)
  const carryOut = carries[circuit.width]
  const signedOverflow = carries[circuit.width - 1] !== carryOut
  const signedLimit = 2 ** (circuit.width - 1)
  const signedA = a >= signedLimit ? a - limit : a
  const signedB = b >= signedLimit ? b - limit : b
  const signedResultRaw = signedA + signedB
  const signedResult = signedResultRaw >= signedLimit ? signedResultRaw - limit : signedResultRaw < -signedLimit ? signedResultRaw + limit : signedResultRaw
  return { a, b, values, sumBits, carries, wrapped, carryOut, unsignedResult: wrapped + (carryOut ? limit : 0), signedOverflow, signedA, signedB, signedResult }
}

export function createAdderTrace(circuit: AdderCircuit): AdderTraceEvent[] {
  return [
    { index: 0, gateId: null, bit: null, role: 'inputs' },
    ...circuit.gates.map((gate, index) => ({ index: index + 1, gateId: gate.id, bit: gate.bit, role: gate.role })),
  ]
}

export function clampTraceIndex(index: number, traceLength: number): number {
  return Math.max(0, Math.min(Math.floor(index), Math.max(0, traceLength - 1)))
}

export function resolvedSignalsAt(circuit: AdderCircuit, index: number): Set<string> {
  const count = clampTraceIndex(index, circuit.gates.length + 1)
  return new Set(['ZERO', ...circuit.inputSignals, ...circuit.gates.slice(0, count).map((gate) => gate.id)])
}

export function resolvedWiresAt(circuit: AdderCircuit, index: number): Set<string> {
  const resolved = resolvedSignalsAt(circuit, index)
  return new Set(circuit.wires.filter((wire) => resolved.has(wire.from)).map((wire) => wire.id))
}

export function logicPathTo(circuit: AdderCircuit, signal: string): { gates: Set<string>; wires: Set<string> } {
  const gates = new Set<string>()
  const wires = new Set<string>()
  const byId = new Map(circuit.gates.map((gate) => [gate.id, gate]))
  const visit = (current: string) => {
    const gate = byId.get(current)
    if (!gate || gates.has(current)) return
    gates.add(current)
    for (const input of gate.inputs) {
      const wire = circuit.wires.find((candidate) => candidate.to === current && candidate.from === input)
      if (wire) wires.add(wire.id)
      visit(input)
    }
  }
  visit(signal)
  for (const wire of circuit.wires) if (wire.from === signal && wire.output) wires.add(wire.id)
  return { gates, wires }
}
