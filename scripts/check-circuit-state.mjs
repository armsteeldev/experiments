import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/circuitState.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const codec = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const snapshot = {
  preset: 'custom',
  goal: 'xor',
  nodes: [
    { id: 'a', type: 'input', x: 95, y: 206, value: true },
    { id: 'b', type: 'input', x: 95, y: 423, value: false },
    { id: 'gate-1', type: 'xor', x: 490, y: 310 },
    { id: 'lamp', type: 'output', x: 950, y: 337 },
  ],
  wires: [
    { from: 'a', to: 'gate-1', input: 0 },
    { from: 'b', to: 'gate-1', input: 1 },
    { from: 'gate-1', to: 'lamp', input: 0 },
  ],
}
assert.deepEqual(codec.restoreCircuitSnapshot(snapshot), snapshot, 'a valid custom circuit restores its parts, positions, switches, wires and goal')
assert.deepEqual(codec.restoreCircuitSnapshot({ ...snapshot, preset: 'and', goal: null }), { ...snapshot, preset: 'and', goal: null }, 'preset circuit snapshots remain valid after their switches change')
assert.equal(codec.restoreCircuitSnapshot({ ...snapshot, nodes: [...snapshot.nodes, snapshot.nodes[0]] }), null, 'duplicate part IDs are rejected')
assert.equal(codec.restoreCircuitSnapshot({ ...snapshot, nodes: [{ ...snapshot.nodes[0], id: '__proto__' }, ...snapshot.nodes.slice(1)] }), null, 'unsafe part IDs are rejected')
assert.equal(codec.restoreCircuitSnapshot({ ...snapshot, nodes: [{ ...snapshot.nodes[0], x: 1e9 }, ...snapshot.nodes.slice(1)] }), null, 'off-board coordinates are rejected')
assert.equal(codec.restoreCircuitSnapshot({ ...snapshot, nodes: [{ ...snapshot.nodes[0], value: 'on' }, ...snapshot.nodes.slice(1)] }), null, 'switches require real Boolean values')
assert.equal(codec.restoreCircuitSnapshot({ ...snapshot, wires: [...snapshot.wires, { from: 'a', to: 'gate-1', input: 0 }] }), null, 'two wires cannot drive the same gate input')
assert.equal(codec.restoreCircuitSnapshot({ ...snapshot, wires: [...snapshot.wires, { from: 'lamp', to: 'gate-1', input: 0 }] }), null, 'output lamps cannot drive other parts')
assert.equal(codec.restoreCircuitSnapshot({ ...snapshot, wires: [{ from: 'missing', to: 'lamp', input: 0 }] }), null, 'wires must refer to existing parts')
assert.equal(codec.restoreCircuitSnapshot({ ...snapshot, wires: [{ from: 'a', to: 'lamp', input: 1 }] }), null, 'wires must target an existing input socket')
assert.equal(codec.restoreCircuitSnapshot({ ...snapshot, goal: 'nand' }), null, 'only supported build goals restore')
assert.equal(codec.restoreCircuitSnapshot({ ...snapshot, nodes: Array(33).fill(snapshot.nodes[0]) }), null, 'oversized boards are rejected before graph processing')
assert.equal(codec.restoreCircuitSnapshot({ ...snapshot, wires: Array(65).fill(snapshot.wires[0]) }), null, 'oversized wire arrays are rejected before graph processing')
assert.equal(codec.restoreCircuitSnapshot(JSON.parse('{"__proto__":{"preset":"custom"}}')), null, 'unknown object shapes fail closed')

const maximumBoard = {
  preset: 'custom', goal: null,
  nodes: [{ id: 'a', type: 'input', x: 8, y: 8, value: true }, ...Array.from({ length: 31 }, (_, index) => ({ id: `and-${index}`, type: 'and', x: 24 + index * 24, y: 24 }))],
  wires: Array.from({ length: 31 }, (_, index) => [0, 1].map((input) => ({ from: 'a', to: `and-${index}`, input }))).flat(),
}
assert.equal(codec.restoreCircuitSnapshot(maximumBoard)?.wires.length, 62, 'a maximally wired supported board restores')
assert.ok(Buffer.from(JSON.stringify({ $armsteel: 1, state: { preset: 'custom', circuit: maximumBoard } })).toString('base64url').length < 16_000, 'the largest supported circuit fits the notebook and share-state budget')

console.log('Circuit state checks passed: round-trip shape, switch values, topology, coordinate and size bounds, and malformed state recovery.')
