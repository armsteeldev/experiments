import type { CircuitNode, CircuitWire, GateType } from '../simulations/circuit'

export type CircuitPreset = 'and' | 'or' | 'xor' | 'half' | 'full' | 'mux' | 'adder' | 'custom'
export type CircuitGoal = 'and' | 'or' | 'xor' | null
export type CircuitSnapshot = { nodes: CircuitNode[]; wires: CircuitWire[]; preset: CircuitPreset; goal: CircuitGoal }
export const MAX_CIRCUIT_NODES = 32
export const MAX_CIRCUIT_WIRES = 64

const gates: GateType[] = ['input', 'output', 'and', 'or', 'not', 'xor', 'nand', 'nor']
const presets: CircuitPreset[] = ['and', 'or', 'xor', 'half', 'full', 'mux', 'adder', 'custom']
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const inputCount = (type: GateType) => type === 'not' || type === 'output' ? 1 : type === 'input' ? 0 : 2

/** Validate a shareable logic board before React or the circuit evaluator sees it. */
export function restoreCircuitSnapshot(value: unknown): CircuitSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.wires) || value.nodes.length > MAX_CIRCUIT_NODES || value.wires.length > MAX_CIRCUIT_WIRES) return null
  if (!presets.includes(value.preset as CircuitPreset) || !(value.goal === null || value.goal === 'and' || value.goal === 'or' || value.goal === 'xor')) return null

  const ids = new Set<string>()
  const nodes: CircuitNode[] = []
  for (const raw of value.nodes) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(raw.id) || ids.has(raw.id)) return null
    if (typeof raw.type !== 'string' || !gates.includes(raw.type as GateType)) return null
    if (!Number.isInteger(raw.x) || (raw.x as number) < 0 || (raw.x as number) > 1200 || !Number.isInteger(raw.y) || (raw.y as number) < 0 || (raw.y as number) > 760) return null
    if (raw.type === 'input' && typeof raw.value !== 'boolean') return null
    ids.add(raw.id)
    nodes.push({ id: raw.id, type: raw.type as GateType, x: raw.x as number, y: raw.y as number, ...(raw.type === 'input' ? { value: raw.value as boolean } : {}) })
  }

  const occupiedInputs = new Set<string>()
  const wires: CircuitWire[] = []
  for (const raw of value.wires) {
    if (!isRecord(raw) || typeof raw.from !== 'string' || typeof raw.to !== 'string' || !Number.isInteger(raw.input) || (raw.input as number) < 0) return null
    const source = nodes.find((node) => node.id === raw.from)
    const target = nodes.find((node) => node.id === raw.to)
    if (!source || !target || source.type === 'output' || target.type === 'input' || raw.input as number >= inputCount(target.type)) return null
    const slot = `${target.id}:${raw.input}`
    if (occupiedInputs.has(slot)) return null
    occupiedInputs.add(slot)
    wires.push({ from: source.id, to: target.id, input: raw.input as number })
  }

  if (value.preset !== 'custom' && value.goal !== null) return null
  return { nodes, wires, preset: value.preset as CircuitPreset, goal: value.goal as CircuitGoal }
}
