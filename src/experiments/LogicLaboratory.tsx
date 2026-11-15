import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ExperimentControls } from '../types'
import { ActionRow, ControlPanel, SelectControl } from '../components/Controls'
import { evaluateCircuit, type CircuitNode, type CircuitWire, type GateType } from '../simulations/circuit'
import { MAX_CIRCUIT_NODES, restoreCircuitSnapshot, type CircuitGoal, type CircuitPreset, type CircuitSnapshot } from '../lib/circuitState'
import './ComputingRethink.css'

const presetNames: [CircuitPreset, string][] = [['and', 'Both switches · AND'], ['or', 'Either switch · OR'], ['xor', 'Different switches · XOR'], ['half', 'Half adder'], ['full', 'Full adder'], ['mux', '2-to-1 multiplexer'], ['adder', 'Two-bit adder']]
let serial = 0
const input = (id: string, x: number, y: number, value: boolean): CircuitNode => ({ id, type: 'input', x, y, value })
const node = (id: string, type: GateType, x: number, y: number): CircuitNode => ({ id, type, x, y })
const wire = (from: string, to: string, input: number): CircuitWire => ({ from, to, input })
function makeCircuit(preset: CircuitPreset): [CircuitNode[], CircuitWire[]] {
  if (preset === 'and' || preset === 'or' || preset === 'xor') {
    return [
      [input('a', 95, 206, false), input('b', 95, 423, false), node('gate', preset, 490, 310), node('lamp', 'output', 950, 337)],
      [wire('a', 'gate', 0), wire('b', 'gate', 1), wire('gate', 'lamp', 0)],
    ]
  }
  if (preset === 'full') return [
    [input('a', 100, 175, true), input('b', 100, 340, false), input('cin', 100, 520, true), node('p', 'xor', 360, 210), node('sum', 'xor', 620, 310), node('g1', 'and', 360, 450), node('g2', 'and', 620, 500), node('carry', 'or', 860, 465), node('sout', 'output', 1050, 300), node('cout', 'output', 1050, 495)],
    [wire('a','p',0),wire('b','p',1),wire('p','sum',0),wire('cin','sum',1),wire('a','g1',0),wire('b','g1',1),wire('p','g2',0),wire('cin','g2',1),wire('g1','carry',0),wire('g2','carry',1),wire('sum','sout',0),wire('carry','cout',0)],
  ]
  if (preset === 'mux') return [
    [input('d0',100,175,false),input('d1',100,345,true),input('sel',100,535,false),node('inv','not',315,510),node('t0','and',520,220),node('t1','and',520,430),node('combine','or',805,315),node('out', 'output',1050,315)],
    [wire('sel','inv',0),wire('d0','t0',0),wire('inv','t0',1),wire('d1','t1',0),wire('sel','t1',1),wire('t0','combine',0),wire('t1','combine',1),wire('combine','out',0)],
  ]
  if (preset === 'adder') return [
    [input('a0',70,130,true),input('b0',70,245,true),input('a1',70,470,false),input('b1',70,585,true),node('s0','xor',300,155),node('c0','and',300,285),node('p1','xor',300,470),node('g1','and',300,590),node('s1','xor',590,405),node('g2','and',590,535),node('c2','or',830,475),node('o0','output',1050,160),node('o1','output',1050,400),node('o2','output',1050,570)],
    [wire('a0','s0',0),wire('b0','s0',1),wire('a0','c0',0),wire('b0','c0',1),wire('a1','p1',0),wire('b1','p1',1),wire('a1','g1',0),wire('b1','g1',1),wire('p1','s1',0),wire('c0','s1',1),wire('p1','g2',0),wire('c0','g2',1),wire('g1','c2',0),wire('g2','c2',1),wire('s0','o0',0),wire('s1','o1',0),wire('c2','o2',0)],
  ]
  return [
    [input('a',100,245,true),input('b',100,440,true),node('sum','xor',470,195),node('carry','and',470,405),node('sout','output',875,195),node('cout','output',875,405)],
    [wire('a','sum',0),wire('b','sum',1),wire('a','carry',0),wire('b','carry',1),wire('sum','sout',0),wire('carry','cout',0)],
  ]
}
const size = (type: GateType, compact = false) => type === 'input' || type === 'output' ? (compact ? [112, 76] : [148, 88]) : (compact ? [132, 92] : [166, 112])
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
function displayX(n: CircuitNode, compact: boolean) { return compact ? n.x * .52 : n.x }
function outputPort(n: CircuitNode, compact = false) { const [w, h] = size(n.type, compact); return [displayX(n, compact) + w, n.y + h / 2] }
function inputPort(n: CircuitNode, index: number, compact = false) { const [, h] = size(n.type, compact), count = n.type === 'not' || n.type === 'output' ? 1 : 2; return [displayX(n, compact), n.y + h * (index + 1) / (count + 1)] }
const labels: Record<GateType, string> = { input: 'INPUT', output: 'OUTPUT', and: 'AND', or: 'OR', not: 'NOT', xor: 'XOR', nand: 'NAND', nor: 'NOR' }
const gateRule = (type: GateType) => ({
  input: 'A switch sends its current 0 or 1 into the circuit.',
  output: 'This lamp shows the value that reached the end of the circuit.',
  and: 'AND lights only when both inputs are 1.',
  or: 'OR lights when at least one input is 1.',
  not: 'NOT flips its input: 0 becomes 1, and 1 becomes 0.',
  xor: 'XOR lights when its two inputs are different.',
  nand: 'NAND is dark only when both inputs are 1.',
  nor: 'NOR lights only when both inputs are 0.',
}[type])

export default function LogicLaboratory({ controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const restoredCircuit = restoreCircuitSnapshot(stateFromUrl?.circuit)
  const initialPreset = restoredCircuit?.preset ?? (presetNames.some(([key]) => key === stateFromUrl?.preset) ? stateFromUrl?.preset as CircuitPreset : 'and')
  const [preset, setPreset] = useState<CircuitPreset>(initialPreset)
  const [nodes, setNodes] = useState<CircuitNode[]>(() => restoredCircuit?.nodes ?? makeCircuit(initialPreset)[0])
  const [wires, setWires] = useState<CircuitWire[]>(() => restoredCircuit?.wires ?? makeCircuit(initialPreset)[1])
  const [connecting, setConnecting] = useState<string | null>(null)
  const [pointer, setPointer] = useState<[number, number] | null>(null)
  const [hoveredPort, setHoveredPort] = useState<string | null>(null)
  const [tool, setTool] = useState<GateType>('and')
  const [wireFrom, setWireFrom] = useState('')
  const [wireTo, setWireTo] = useState('')
  const [wireInput, setWireInput] = useState('0')
  const [placing, setPlacing] = useState<GateType | null>(null)
  const [statusText, setStatusText] = useState('Tap a switch to see the lamp respond. Drag a signal socket to connect parts.')
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null)
  const [goal, setGoal] = useState<CircuitGoal>(restoredCircuit?.goal ?? null)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 720px)').matches)
  const [undoCount, setUndoCount] = useState(0)
  const [redoCount, setRedoCount] = useState(0)
  const undoStack = useRef<CircuitSnapshot[]>([])
  const redoStack = useRef<CircuitSnapshot[]>([])
  const scene = useRef<CircuitSnapshot>({ nodes, wires, preset, goal })
  scene.current = { nodes, wires, preset, goal }
  const drag = useRef<{ id: string; dx: number; dy: number; startX: number; startY: number; moved: boolean; before: CircuitSnapshot } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const result = useMemo(() => evaluateCircuit(nodes, wires), [nodes, wires])
  const challengePassed = useMemo(() => {
    if (!goal) return false
    const sources = nodes.filter((item) => item.type === 'input'), outputs = nodes.filter((item) => item.type === 'output')
    if (sources.length !== 2 || outputs.length !== 1) return false
    return [[false, false], [false, true], [true, false], [true, true]].every(([a, b]) => {
      const candidate = nodes.map((item) => item.id === sources[0].id ? { ...item, value: a } : item.id === sources[1].id ? { ...item, value: b } : item)
      const value = evaluateCircuit(candidate, wires).values[outputs[0].id]
      const expected = goal === 'and' ? a && b : goal === 'or' ? a || b : a !== b
      return value === expected
    })
  }, [goal, nodes, wires])
  useEffect(() => { const media=window.matchMedia('(max-width: 720px)'),update=()=>setCompact(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update) }, [])
  useEffect(() => { onShareState({ preset, circuit: { nodes, wires, preset, goal } }) }, [nodes, wires, preset, goal, onShareState])
  const copyScene = (source: CircuitSnapshot): CircuitSnapshot => ({ nodes: source.nodes.map((item) => ({ ...item })), wires: source.wires.map((edge) => ({ ...edge })), preset: source.preset, goal: source.goal })
  const applyScene = (next: CircuitSnapshot, remember = true, before = scene.current) => {
    if (remember) {
      undoStack.current = [...undoStack.current, copyScene(before)].slice(-80)
      redoStack.current = []
      setUndoCount(undoStack.current.length); setRedoCount(0)
    }
    scene.current = copyScene(next)
    setNodes(scene.current.nodes); setWires(scene.current.wires); setPreset(scene.current.preset); setGoal(scene.current.goal)
  }
  const undo = () => {
    const previous = undoStack.current.pop(); if (!previous) return
    redoStack.current = [...redoStack.current, copyScene(scene.current)]
    setUndoCount(undoStack.current.length); setRedoCount(redoStack.current.length); applyScene(previous, false)
    setStatusText('Last circuit change undone. Redo is ready if you want it back.')
  }
  const redo = () => {
    const next = redoStack.current.pop(); if (!next) return
    undoStack.current = [...undoStack.current, copyScene(scene.current)]
    setUndoCount(undoStack.current.length); setRedoCount(redoStack.current.length); applyScene(next, false)
    setStatusText('Circuit change restored.')
  }
  const load = (name: string) => {
    if (name === 'custom') return
    const [nextNodes, nextWires] = makeCircuit(name as Exclude<CircuitPreset, 'custom'>)
    applyScene({ nodes: nextNodes, wires: nextWires, preset: name as CircuitPreset, goal: null })
    setConnecting(null); setPlacing(null); setHoveredPort(null); setSelectedGateId(null)
    setStatusText('Board ready. Flip a switch and watch the signal find the lamp.')
  }
  const startGoal = (nextGoal: Exclude<CircuitGoal, null>) => {
    applyScene({ nodes: [input('a', 95, 206, false), input('b', 95, 423, false), node('lamp', 'output', 950, 337)], wires: [], preset: 'custom', goal: nextGoal })
    document.querySelectorAll<HTMLDetailsElement>('.logic-challenge-menu, .logic-goal-picker').forEach((picker) => { picker.open = false })
    setSelectedGateId(null); setConnecting(null); setPlacing(null)
    setStatusText(`Goal: make the lamp turn on ${nextGoal === 'and' ? 'only when both switches are on' : nextGoal === 'or' ? 'when either switch is on' : 'when the switches are different'}. Add a gate and connect it.`)
    onCloseControls()
  }
  const coordinates = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current, point = svg?.createSVGPoint(); if (!svg || !point) return [0, 0]
    point.x = event.clientX; point.y = event.clientY
    const transformed = point.matrixTransform(svg.getScreenCTM()?.inverse()); return [transformed.x, transformed.y]
  }
  const addComponent = (type: GateType, at?: [number, number]) => {
    if (scene.current.nodes.length >= MAX_CIRCUIT_NODES) {
      setStatusText(`This board holds up to ${MAX_CIRCUIT_NODES} parts. Remove one before adding another.`)
      return null
    }
    const existingIds = new Set(scene.current.nodes.map((item) => item.id))
    let id = ''
    do { id = `${type}-${++serial}` } while (existingIds.has(id))
    const offset = (serial % 6) * 20
    let x = 390 + offset, y = 330 + offset
    if (at) {
      const factor = compact ? .52 : 1, viewWidth = compact ? 640 : 1200, [w, h] = size(type, compact)
      x = Math.round((Math.max(12, Math.min(viewWidth - w - 12, at[0] - w / 2)) / factor) / 24) * 24
      y = Math.max(8, Math.min(760 - h - 8, at[1] - h / 2))
    }
    const before = scene.current
    applyScene({ ...before, preset: 'custom', nodes: [...before.nodes, { id, type, x, y, ...(type === 'input' ? { value: false } : {}) }] })
    setStatusText(`${labels[type]} placed. Drag its output pin ● to an input pin ○ to connect it.`)
    return id
  }
  const addAtCentre = () => {
    const id = addComponent(tool, [compact ? 320 : 600, 380])
    if (!id) return
    if (tool === 'input') setWireFrom(id)
    else setWireTo(id)
    setSelectedGateId(tool === 'input' || tool === 'output' ? null : id)
  }
  const connectBySelection = () => {
    const source = scene.current.nodes.find((item) => item.id === wireFrom)
    const target = scene.current.nodes.find((item) => item.id === wireTo)
    const port = Number(wireInput)
    const inputCount = !target || target.type === 'input' ? 0 : target.type === 'not' || target.type === 'output' ? 1 : 2
    if (!source || !target || source.id === target.id || port >= inputCount) {
      setStatusText('Choose an output and a different component input. No connection was changed.')
      return
    }
    const before = scene.current
    applyScene({ ...before, preset: 'custom', wires: [...before.wires.filter((edge) => edge.to !== target.id || edge.input !== port), { from: source.id, to: target.id, input: port }] })
    setSelectedGateId(target.type === 'input' || target.type === 'output' ? null : target.id)
    setStatusText(`Connected ${source.id.toUpperCase()} to ${target.id.toUpperCase()} input ${port + 1}. Values now recalculate from the switches.`)
  }
  const startPlacement = (type: GateType) => {
    setTool(type); setPlacing(type); setStatusText(`Click empty board space to place ${labels[type]}. Press Escape to cancel.`); onCloseControls()
  }
  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const target = event.target as SVGElement, [x, y] = coordinates(event)
    const output = target.closest('[data-output]')?.getAttribute('data-output')
    if (output) { event.preventDefault(); setConnecting(output); setPointer([x, y]); svgRef.current?.setPointerCapture(event.pointerId); setStatusText('Wire in progress. Release on a gate input pin.') ; return }
    if (placing && !target.closest('.circuit-node, .circuit-wire, .node-delete')) {
      event.preventDefault(); addComponent(placing, [x, y]); setPlacing(null); setHoveredPort(null); return
    }
  }
  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const [x, y] = coordinates(event)
    if (connecting) {
      setPointer([x, y])
      const nearest = nodes.flatMap((item) => Array.from({ length: item.type === 'input' ? 0 : item.type === 'not' || item.type === 'output' ? 1 : 2 }, (_, index) => { const [px, py] = inputPort(item, index, compact); return { id: item.id, index, x: px, y: py } }))
        .map((port) => ({ ...port, distance: Math.hypot(port.x - x, port.y - y) })).sort((a, b) => a.distance - b.distance)[0]
      const next = nearest && nearest.distance < 22 && nearest.id !== connecting ? `${nearest.id}:${nearest.index}` : null
      if (next !== hoveredPort) setHoveredPort(next)
    }
    const active = drag.current
    if (active && active.id) {
      const dx = x - active.startX, dy = y - active.startY
      if (Math.hypot(dx, dy) > 2) active.moved = true
      if (active.moved) {
        const snap = 24
        const nextNodes = scene.current.nodes.map((item) => {
          if (item.id !== active.id) return item
          const factor = compact ? .52 : 1, [nodeWidth, nodeHeight] = size(item.type, compact), viewWidth = compact ? 640 : 1200
          const nextX = Math.round(((x - active.dx) / factor) / snap) * snap
          const nextY = Math.round((y - active.dy) / snap) * snap
          return { ...item, x: clamp(nextX, 8, Math.floor((viewWidth - nodeWidth - 8) / factor)), y: clamp(nextY, 8, 760 - nodeHeight - 8) }
        })
        scene.current = { ...scene.current, preset: 'custom', nodes: nextNodes }
        setNodes(nextNodes); setPreset('custom')
      }
    }
  }
  const pointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const target = event.target as SVGElement
    const [x, y] = coordinates(event)
    const ports = nodes.flatMap((item) => Array.from({ length: item.type === 'input' ? 0 : item.type === 'not' || item.type === 'output' ? 1 : 2 }, (_, index) => { const [px, py] = inputPort(item, index, compact); return { id: item.id, index, x: px, y: py } }))
    const nearest = ports.map((port) => ({ ...port, distance: Math.hypot(port.x - x, port.y - y) })).sort((a,b) => a.distance - b.distance)[0]
    const targetPort = nearest && nearest.distance < 26 ? nearest : null
    const inputId = targetPort?.id ?? target.closest('[data-input-id]')?.getAttribute('data-input-id')
    const inputIndex = targetPort?.index ?? Number(target.closest('[data-input-index]')?.getAttribute('data-input-index'))
    if (connecting && inputId && inputId !== connecting) {
      const before = scene.current
      applyScene({ ...before, preset: 'custom', wires: [...before.wires.filter((edge) => edge.to !== inputId || edge.input !== inputIndex), { from: connecting, to: inputId, input: inputIndex }] }, true, drag.current?.before ?? before)
      setStatusText('Connected. Signal values update through the circuit from source to output.')
    } else if (connecting) setStatusText('No input pin reached. The circuit stayed unchanged; start again from a glowing output pin.')
    if (drag.current && !drag.current.moved) {
      const clicked = scene.current.nodes.find((item) => item.id === drag.current?.id)
      if (clicked?.type === 'input') {
        const nextValue = !clicked.value
        const before = scene.current
        applyScene({ ...before, nodes: before.nodes.map((item) => item.id === clicked.id ? { ...item, value: nextValue } : item) }, true, drag.current.before)
        setStatusText(`Switch ${clicked.id.toUpperCase()} is ${nextValue ? 'on' : 'off'} · connected gate and lamp values updated.`)
      } else if (clicked && !['output', 'input'].includes(clicked.type)) {
        setSelectedGateId(clicked.id)
        setStatusText(`${labels[clicked.type]} gate selected · inspect its actual inputs and output below.`)
      }
    }
    if (drag.current?.moved) {
      undoStack.current = [...undoStack.current, copyScene(drag.current.before)].slice(-80)
      redoStack.current = []; setUndoCount(undoStack.current.length); setRedoCount(0)
      setStatusText('Part moved onto the workbench grid.')
    }
    drag.current = null; setConnecting(null); setPointer(null); setHoveredPort(null)
  }
  const startDrag = (event: ReactPointerEvent<SVGGElement>, item: CircuitNode) => {
    const target = event.target as SVGElement
    if (target.closest('[data-output], [data-input-id]')) return
    const [x, y] = coordinates(event as unknown as ReactPointerEvent<SVGSVGElement>), originX = displayX(item, compact)
    event.stopPropagation(); drag.current = { id: item.id, dx: x - originX, dy: y - item.y, startX: x, startY: y, moved: false, before: copyScene(scene.current) }
    svgRef.current?.setPointerCapture(event.pointerId)
  }
  const removeNode = (id: string) => {
    const before = scene.current, removed = before.nodes.find((item) => item.id === id)
    applyScene({ ...before, preset: 'custom', nodes: before.nodes.filter((entry) => entry.id !== id), wires: before.wires.filter((edge) => edge.from !== id && edge.to !== id) })
    setSelectedGateId(null); setStatusText(`${labels[removed?.type ?? 'and']} removed. Undo will restore the part and its wires.`)
  }
  const nodeValue = (id: string) => result.values[id] === true ? '1' : result.values[id] === false ? '0' : '·'
  const selectedGate = nodes.find((item) => item.id === selectedGateId && !['input', 'output'].includes(item.type))
  const selectedInputs = selectedGate ? wires.filter((edge) => edge.to === selectedGate.id).sort((a,b) => a.input-b.input).map((edge) => ({ id: edge.from, value: result.values[edge.from] })) : []
  const halfAdderVisible = preset === 'half' && !goal && nodes.some((item) => item.id === 'a' && item.type === 'input')
  const halfCarry = nodeValue('cout'), halfSum = nodeValue('sout')

  useEffect(() => {
    const cancelPlacement = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && placing) { setPlacing(null); setStatusText('Placement cancelled.') }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
    }
    window.addEventListener('keydown', cancelPlacement)
    return () => window.removeEventListener('keydown', cancelPlacement)
  }, [placing, undoCount, redoCount])

  return <section className="experiment-surface logic-workbench" aria-label="Logic Laboratory, a live digital electronics workbench">
    <header className="logic-bench-head"><div><span className="logic-bench-kicker"><i /> DIGITAL ELECTRONICS WORKBENCH</span><h1>Make a light <em>obey.</em></h1><p>{preset === 'and' ? 'This lamp lights only when both switches are on.' : goal ? `Build a circuit that lights the lamp ${goal === 'and' ? 'only when both switches are on' : goal === 'or' ? 'when either switch is on' : 'when the switches are different'}.` : 'Flip a switch. The signal moves through the parts and changes the lamp.'}</p></div><span className={'logic-bench-status ' + result.status}>{result.status === 'ready' ? 'LIVE CIRCUIT' : result.status === 'cycle' ? 'FEEDBACK LOOP' : result.status === 'invalid' ? 'INVALID WIRE' : 'OPEN INPUT'}</span></header>
    <div className="logic-circuit-ideas" role="group" aria-label="Try a working circuit">
      <span>TRY A CIRCUIT</span>
      {presetNames.slice(0, 4).map(([key, label]) => <button key={key} className={preset === key ? 'idea-selected' : ''} onClick={() => load(key)} aria-pressed={preset === key}>{label}</button>)}
      <details className="logic-challenge-menu"><summary>Build a rule</summary><div><button onClick={() => startGoal('and')}>Light only when both switches are on</button><button onClick={() => startGoal('or')}>Light when either switch is on</button><button onClick={() => startGoal('xor')}>Light when switches differ</button></div></details>
    </div>
    <svg ref={svgRef} className={'circuit-canvas' + (placing ? ' placement-active' : '')} viewBox={compact ? '0 0 640 760' : '0 0 1200 760'} role="application" aria-label="Circuit workbench. Flip a switch, drag a signal socket to a gate input, or choose a part and place it on the board." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <defs><pattern id="logic-dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#91a9b4" opacity=".15" /></pattern><filter id="wire-glow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter><linearGradient id="logic-wire" x1="0" x2="1"><stop stopColor="#72dbc4"/><stop offset="1" stopColor="#a8e5d6"/></linearGradient></defs>
      <rect width={compact ? 640 : 1200} height="760" fill="url(#logic-dots)" />
      {wires.map((edge, index) => { const a = nodes.find((item) => item.id === edge.from), b = nodes.find((item) => item.id === edge.to); if (!a || !b) return null; const [x1, y1] = outputPort(a,compact), [x2, y2] = inputPort(b, edge.input,compact), middle = (x1 + x2) / 2, value = result.values[edge.from], active = value === true; return <g key={`${edge.from}-${edge.to}-${edge.input}-${index}`} className={active ? 'wire-on' : value === false ? 'wire-zero' : 'wire-unknown'}><path d={`M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`} className="circuit-wire-shadow"/><path d={`M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`} className="circuit-wire"/><circle cx={x1} cy={y1} r="3" className="wire-source-dot"/><text x={middle} y={(y1 + y2) / 2 - 8} className="wire-value">{value === null || value === undefined ? '?' : value ? '1' : '0'}</text></g> })}
      {connecting && pointer && <path d={`M${outputPort(nodes.find((item) => item.id === connecting)!,compact)[0]},${outputPort(nodes.find((item) => item.id === connecting)!,compact)[1]} Q${pointer[0]},${pointer[1]} ${pointer[0]},${pointer[1]}`} className="wire-draft"/>}
      {nodes.map((item) => { const [w, h] = size(item.type,compact), value = result.values[item.id], active = value === true, gate = !['input','output'].includes(item.type); return <g key={item.id} className={'circuit-node node-' + item.type + (active ? ' value-one' : value === false ? ' value-zero' : ' value-unknown') + (selectedGateId === item.id ? ' node-inspected' : '')} transform={`translate(${displayX(item,compact)} ${item.y})`} onPointerDown={(event) => startDrag(event, item)} {...(item.type === 'input' ? { role: 'button' as const, tabIndex: 0, 'aria-pressed': !!item.value, 'aria-label': `Switch ${item.id.toUpperCase()} is ${item.value ? 'on, 1' : 'off, 0'}` } : gate ? { role: 'button' as const, tabIndex: 0, 'aria-label': `${labels[item.type]} gate, output ${nodeValue(item.id)}. Inspect explanation.` } : {})} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && item.type === 'input') { event.preventDefault(); const before = scene.current; applyScene({ ...before, nodes: before.nodes.map((entry) => entry.id === item.id ? { ...entry, value: !entry.value } : entry) }); setStatusText(`Switch ${item.id.toUpperCase()} changed · every connected value recalculated.`) } else if ((event.key === 'Enter' || event.key === ' ') && gate) { event.preventDefault(); setSelectedGateId(item.id) } }} onClick={() => { if (gate) setSelectedGateId(item.id) }}>
        {item.type === 'input' ? <><rect className="node-body source-body" width={w} height={h} rx="16"/><text x="18" y="26" className="node-kicker">SWITCH</text><text x="18" y="61" className="node-title">{item.id.toUpperCase()}</text><text x={w-28} y="58" className="node-bit">{value === true ? '1' : '0'}</text><circle className="port-hitbox" cx={w} cy={h/2} r="21" data-output={item.id}/><circle className="output-port" cx={w} cy={h/2} r="8" pointerEvents="none"/></> : item.type === 'output' ? <><circle className={'port-hitbox input-hitbox' + (hoveredPort === `${item.id}:0` ? ' wire-target' : '')} cx="0" cy={h/2} r="21" data-input-id={item.id} data-input-index="0"/><circle className={'input-port' + (hoveredPort === `${item.id}:0` ? ' wire-target' : '')} cx="0" cy={h/2} r="8" pointerEvents="none"/><rect className="node-body sink-body" width={w} height={h} rx="16"/><text x="18" y="26" className="node-kicker">LAMP</text><text x="18" y="62" className="node-title">{item.id.toUpperCase()}</text><text x={w-30} y="58" className="node-bit">{nodeValue(item.id)}</text></> : <><rect className="node-body gate-body" width={w} height={h} rx="18"/><text className="gate-symbol" x={w/2} y="55">{item.type === 'not' ? '¬' : item.type === 'and' ? '∧' : item.type === 'or' ? '∨' : item.type === 'xor' ? '⊕' : item.type === 'nand' ? '⊼' : '⊽'}</text><text className="node-title gate-label" x={w/2} y="84">{labels[item.type]}</text>{Array.from({length: item.type === 'not' ? 1 : 2}, (_, port) => <g key={port}><circle className="port-hitbox input-hitbox" cx="0" cy={h*(port+1)/(item.type === 'not' ? 2 : 3)} r="20" data-input-id={item.id} data-input-index={port}/><circle className={'input-port' + (hoveredPort === `${item.id}:${port}` ? ' wire-target' : '')} cx="0" cy={h*(port+1)/(item.type === 'not' ? 2 : 3)} r="8" pointerEvents="none"/></g>)}<circle className="port-hitbox" cx={w} cy={h/2} r="20" data-output={item.id}/><circle className="output-port" cx={w} cy={h/2} r="8" pointerEvents="none"/><text x={w-27} y="27" className="gate-readout">{nodeValue(item.id)}</text></>}
        <g className="node-delete" role="button" aria-label={'Remove ' + item.id} tabIndex={0} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); removeNode(item.id) } }} onClick={(event) => { event.stopPropagation(); removeNode(item.id) }}><circle cx={w-14} cy="14" r="13"/><text x={w-14} y="19" textAnchor="middle">×</text></g>
      </g> })}
    </svg>
    <div className="logic-lesson" aria-live="polite">
      {selectedGate ? <><span>{labels[selectedGate.type]} · {selectedGate.id.toUpperCase()}</span><strong>{gateRule(selectedGate.type)}</strong><small>{selectedInputs.length ? selectedInputs.map((entry) => entry.value === true ? '1' : entry.value === false ? '0' : '?').join(selectedGate.type === 'xor' ? ' differs from ' : ' and ') : 'Waiting for input wires'} → {nodeValue(selectedGate.id)}</small></> : goal ? <><span>BUILDING GOAL · {goal.toUpperCase()}</span><strong>{challengePassed ? 'The lamp follows the rule for all four switch pairs.' : `Make the lamp turn on ${goal === 'and' ? 'only when both switches are on' : goal === 'or' ? 'when either switch is on' : 'when the switches are different'}.`}</strong><small>{challengePassed ? 'Now try another switch combination.' : 'The goal checks every switch combination.'}</small></> : halfAdderVisible ? <><span>HALF ADDER</span><strong>A {nodeValue('a')} + B {nodeValue('b')} → carry {halfCarry}, sum {halfSum}.</strong><small>Carry then sum reads {halfCarry}{halfSum} in binary.</small></> : preset === 'and' ? <><span>THE AND GATE</span><strong>Switch A is {nodeValue('a')}; switch B is {nodeValue('b')}. The lamp is {nodeValue('lamp')}.</strong><small>An AND gate lights only when both signals are 1.</small></> : <><span>{preset === 'or' ? 'THE OR GATE' : preset === 'xor' ? 'THE XOR GATE' : 'LIVE CIRCUIT'}</span><strong>{statusText}</strong><small>Each lamp reads the value the circuit actually produced.</small></>}
    </div>
    <div className="logic-toolbar">
      <span>{placing ? `PLACE ${labels[placing]}` : 'ADD TO THE CIRCUIT'}</span>
      {(['and','or','not','xor','nand','nor'] as GateType[]).map((type) => <button key={type} className={placing === type ? 'tool-active' : ''} aria-pressed={placing === type} onClick={() => startPlacement(type)}>{labels[type]}</button>)}
      <button className={placing === 'input' ? 'tool-active' : ''} aria-pressed={placing === 'input'} onClick={() => startPlacement('input')}>＋ SWITCH</button>
      <button className={placing === 'output' ? 'tool-active' : ''} aria-pressed={placing === 'output'} onClick={() => startPlacement('output')}>＋ LAMP</button>
      <span className="logic-wire-hint">DRAG SOCKET → SOCKET</span>
      <button className="history-button" onClick={undo} disabled={!undoCount} aria-label="Undo circuit change">↶</button>
      <button className="history-button" onClick={redo} disabled={!redoCount} aria-label="Redo circuit change">↷</button>
    </div>
    <div className="logic-inspector"><span>{connecting ? 'Signal cable in hand · release it on a glowing socket.' : statusText}</span><strong>OUTPUT <i>{nodes.filter((item) => item.type === 'output').map((item) => `${item.id.toUpperCase()} ${nodeValue(item.id)}`).join('   ') || '—'}</i></strong></div>
    <ControlPanel title="Logic Laboratory" note="Boolean gates · topological evaluation" visible={controlsVisible} onClose={onCloseControls}>
      <details className="logic-goal-picker"><summary>Build your own version of a rule</summary><p>Start with two switches and a lamp. Add a gate and connect the signals. Each goal is checked against all four switch combinations.</p><div><button onClick={() => startGoal('and')}>Light only when both are on</button><button onClick={() => startGoal('or')}>Light when either is on</button><button onClick={() => startGoal('xor')}>Light when they differ</button></div></details>
      <SelectControl label="Load a circuit" value={preset} options={[...presetNames,...(preset==='custom'?[['custom','Custom circuit'] as [string,string]]:[])]} onChange={load} />
      <SelectControl label="Gate to place" value={tool} options={(['and','or','not','xor','nand','nor'] as GateType[]).map((type) => [type, labels[type]]) as [string, string][]} onChange={(value) => setTool(value as GateType)} />
      <ActionRow><button className="small-action" onClick={() => startPlacement(tool)}>Place {labels[tool]} with pointer</button><button className="small-action" onClick={addAtCentre}>Add {labels[tool]} here</button></ActionRow>
      <details className="logic-keyboard-wire"><summary>Connect parts with the keyboard</summary>
        <SelectControl label="Signal from" value={nodes.some((item) => item.id === wireFrom && item.type !== 'output') ? wireFrom : nodes.find((item) => item.type !== 'output')?.id ?? ''} options={nodes.filter((item) => item.type !== 'output').map((item) => [item.id, `${labels[item.type]} ${item.id.toUpperCase()}`])} onChange={setWireFrom} />
        <SelectControl label="Connect to" value={nodes.some((item) => item.id === wireTo && item.type !== 'input') ? wireTo : nodes.find((item) => item.type !== 'input')?.id ?? ''} options={nodes.filter((item) => item.type !== 'input').map((item) => [item.id, `${labels[item.type]} ${item.id.toUpperCase()}`])} onChange={(value) => { setWireTo(value); setWireInput('0') }} />
        {(nodes.find((item) => item.id === wireTo)?.type !== 'not' && nodes.find((item) => item.id === wireTo)?.type !== 'output') && <SelectControl label="Gate input" value={wireInput} options={[["0", "Input 1"], ["1", "Input 2"]]} onChange={setWireInput} />}
        <button className="small-action" onClick={connectBySelection} disabled={!nodes.some((item) => item.type !== 'output') || !nodes.some((item) => item.type !== 'input')}>Connect selected parts</button>
      </details>
      <ActionRow><button className="small-action" onClick={() => { applyScene({ nodes: [], wires: [], preset: 'custom', goal: null }); setPlacing(null); setStatusText('Empty workbench. Choose switches, gates and lamps from the palette.') }}>Clear board</button><button className="small-action" onClick={undo} disabled={!undoCount}>Undo</button><button className="small-action" onClick={redo} disabled={!redoCount}>Redo</button><button className="small-action" onClick={() => load('and')}>Restore starter</button></ActionRow>
      <p className="control-note">Large sockets accept a wire dragged from a source to a gate or lamp. Parts snap to the workbench grid. Undo and redo restore connections, switch values, placements and moves. Incomplete and feedback circuits stay unresolved.</p>
    </ControlPanel>
  </section>
}
