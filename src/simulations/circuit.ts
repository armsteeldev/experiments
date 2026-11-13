export type GateType = 'input' | 'output' | 'and' | 'or' | 'not' | 'xor' | 'nand' | 'nor'
export type CircuitNode = { id: string; type: GateType; x: number; y: number; value?: boolean }
export type CircuitWire = { from: string; to: string; input: number }
export type CircuitResult = { values: Record<string, boolean | null>; status: 'ready' | 'disconnected' | 'cycle' | 'invalid'; order: string[] }
const inputs = (type: GateType) => type === 'not' || type === 'output' ? 1 : type === 'input' ? 0 : 2

export function evaluateCircuit(nodes: readonly CircuitNode[], wires: readonly CircuitWire[]): CircuitResult {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const values: Record<string, boolean | null> = {}
  const incoming = new Map<string, CircuitWire[]>()
  let invalid = false
  for (const wire of wires) {
    const source = byId.get(wire.from), target = byId.get(wire.to)
    if (!source || !target || source.type === 'output' || target.type === 'input' || !Number.isInteger(wire.input) || wire.input < 0 || wire.input >= inputs(target.type)) { invalid = true; continue }
    const current = incoming.get(wire.to) ?? []
    if (current.some((edge) => edge.input === wire.input)) invalid = true
    incoming.set(wire.to, [...current, wire])
  }
  const visiting = new Set<string>(), visited = new Set<string>(), order: string[] = []
  let cycle = false, disconnected = false
  const visit = (node: CircuitNode) => {
    if (visited.has(node.id)) return
    if (visiting.has(node.id)) { cycle = true; return }
    visiting.add(node.id)
    for (const wire of incoming.get(node.id) ?? []) { const source = byId.get(wire.from); if (source) visit(source) }
    visiting.delete(node.id); visited.add(node.id); order.push(node.id)
  }
  nodes.forEach(visit)
  for (const id of order) {
    const node = byId.get(id)!
    if (node.type === 'input') { values[id] = Boolean(node.value); continue }
    const ins = inputs(node.type), connections = incoming.get(id) ?? []
    const args: (boolean | null)[] = Array(ins).fill(null)
    for (const wire of connections) if (wire.input >= 0 && wire.input < ins) args[wire.input] = values[wire.from] ?? null
    if (args.some((value) => value === null)) { values[id] = null; disconnected = true; continue }
    const [a, b] = args as boolean[]
    values[id] = node.type === 'output' ? a : node.type === 'not' ? !a : node.type === 'and' ? a && b : node.type === 'nand' ? !(a && b) : node.type === 'or' ? a || b : node.type === 'nor' ? !(a || b) : a !== b
  }
  if (cycle) nodes.forEach((node) => { if (visiting.has(node.id)) values[node.id] = null })
  return { values, status: cycle ? 'cycle' : invalid ? 'invalid' : disconnected ? 'disconnected' : 'ready', order }
}
