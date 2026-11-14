import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ExperimentControls } from '../types'
import { ActionRow, ControlPanel, SelectControl } from '../components/Controls'
import { evaluateCircuit, type CircuitNode, type CircuitWire, type GateType } from '../simulations/circuit'
import { useDiscoveryHint } from '../lib/useDiscoveryHint'
import './ExpandedExhibits.css'

type CircuitPreset = 'half' | 'full' | 'mux' | 'adder' | 'custom'
type CircuitGoal = 'and' | 'or' | 'xor' | null
const presetNames: [CircuitPreset, string][] = [['half', 'Half adder'], ['full', 'Full adder'], ['mux', '2-to-1 multiplexer'], ['adder', 'Two-bit adder']]
let serial = 0
const input = (id: string, x: number, y: number, value: boolean): CircuitNode => ({ id, type: 'input', x, y, value })
const node = (id: string, type: GateType, x: number, y: number): CircuitNode => ({ id, type, x, y })
const wire = (from: string, to: string, input: number): CircuitWire => ({ from, to, input })
function makeCircuit(preset: CircuitPreset): [CircuitNode[], CircuitWire[]] {
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
const size = (type: GateType, compact = false) => type === 'input' || type === 'output' ? (compact ? [78, 58] : [88, 58]) : (compact ? [104, 76] : [122, 76])
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
  const hint = useDiscoveryHint('logic')
  const initialPreset = presetNames.some(([key]) => key === stateFromUrl?.preset) ? stateFromUrl?.preset as CircuitPreset : 'half'
  const [preset, setPreset] = useState<CircuitPreset>(initialPreset)
  const [nodes, setNodes] = useState<CircuitNode[]>(() => makeCircuit(initialPreset)[0])
  const [wires, setWires] = useState<CircuitWire[]>(() => makeCircuit(initialPreset)[1])
  const [connecting, setConnecting] = useState<string | null>(null)
  const [pointer, setPointer] = useState<[number, number] | null>(null)
  const [hoveredPort, setHoveredPort] = useState<string | null>(null)
  const [tool, setTool] = useState<GateType>('and')
  const [wireFrom, setWireFrom] = useState('')
  const [wireTo, setWireTo] = useState('')
  const [wireInput, setWireInput] = useState('0')
  const [placing, setPlacing] = useState<GateType | null>(null)
  const [statusText, setStatusText] = useState('Click an input to toggle it · choose a part below, then click the board to place it.')
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null)
  const [goal, setGoal] = useState<CircuitGoal>(null)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 720px)').matches)
  const drag = useRef<{ id: string; dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null)
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
  useEffect(() => { onShareState({ preset }); }, [preset, onShareState])
  const load = (name: string) => { if(name==='custom')return;const [nextNodes, nextWires] = makeCircuit(name as Exclude<CircuitPreset,'custom'>); setPreset(name as CircuitPreset); setGoal(null); setNodes(nextNodes); setWires(nextWires); setConnecting(null); setPlacing(null); setHoveredPort(null); setSelectedGateId(null); setStatusText('Starter circuit restored. Toggle a switch to see every connected value update.') }
  const startGoal = (nextGoal: Exclude<CircuitGoal, null>) => {
    hint.dismiss()
    setGoal(nextGoal); setPreset('custom'); setSelectedGateId(null); setConnecting(null); setPlacing(null)
    setNodes([input('a', 100, 245, false), input('b', 100, 440, false), node('lamp', 'output', 875, 340)])
    setWires([])
    setStatusText(`Goal: make the lamp turn on ${nextGoal === 'and' ? 'only when both switches are on' : nextGoal === 'or' ? 'when either switch is on' : 'when the switches are different'}. Add a gate and connect it.`)
    onCloseControls()
  }
  const coordinates = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current, point = svg?.createSVGPoint(); if (!svg || !point) return [0, 0]
    point.x = event.clientX; point.y = event.clientY
    const transformed = point.matrixTransform(svg.getScreenCTM()?.inverse()); return [transformed.x, transformed.y]
  }
  const addComponent = (type: GateType, at?: [number, number]) => {
    const id = `${type}-${++serial}`, offset = (serial % 6) * 18
    let x = 390 + offset, y = 330 + offset
    if (at) {
      const factor = compact ? .52 : 1, viewWidth = compact ? 640 : 1200, [w, h] = size(type, compact)
      x = (Math.max(w / 2, Math.min(viewWidth - w / 2, at[0])) - w / 2) / factor
      y = Math.max(8, Math.min(760 - h - 8, at[1] - h / 2))
    }
    setNodes((current) => [...current, { id, type, x, y, ...(type === 'input' ? { value: false } : {}) }])
    setPreset('custom')
    setStatusText(`${labels[type]} placed. Drag its output pin ● to an input pin ○ to connect it.`)
    return id
  }
  const addAtCentre = () => {
    const id = addComponent(tool, [compact ? 320 : 600, 380])
    if (tool === 'input') setWireFrom(id)
    else setWireTo(id)
    setSelectedGateId(tool === 'input' || tool === 'output' ? null : id)
  }
  const connectBySelection = () => {
    const source = nodes.find((item) => item.id === wireFrom)
    const target = nodes.find((item) => item.id === wireTo)
    const port = Number(wireInput)
    const inputCount = !target || target.type === 'input' ? 0 : target.type === 'not' || target.type === 'output' ? 1 : 2
    if (!source || !target || source.id === target.id || port >= inputCount) {
      setStatusText('Choose an output and a different component input. No connection was changed.')
      return
    }
    setWires((current) => [...current.filter((edge) => edge.to !== target.id || edge.input !== port), { from: source.id, to: target.id, input: port }])
    setPreset('custom')
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
      if (active.moved) setNodes((current) => current.map((item) => item.id === active.id ? { ...item, x: (x - active.dx) / (compact ? .52 : 1), y: y - active.dy } : item))
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
      setWires((current) => [...current.filter((edge) => edge.to !== inputId || edge.input !== inputIndex), { from: connecting, to: inputId, input: inputIndex }])
      setPreset('custom')
      setStatusText('Connected. Signal values update through the circuit from source to output.')
    } else if (connecting) setStatusText('No input pin reached. The circuit stayed unchanged; start again from a glowing output pin.')
    if (drag.current && !drag.current.moved) {
      const clicked = nodes.find((item) => item.id === drag.current?.id)
      if (clicked?.type === 'input') {
        const nextValue = !clicked.value
        setNodes((current) => current.map((item) => item.id === clicked.id ? { ...item, value: nextValue } : item))
        setStatusText(`Switch ${clicked.id.toUpperCase()} is ${nextValue ? 'on' : 'off'} · connected gate and lamp values updated.`)
      } else if (clicked && !['output', 'input'].includes(clicked.type)) {
        setSelectedGateId(clicked.id)
        setStatusText(`${labels[clicked.type]} gate selected · inspect its actual inputs and output below.`)
      }
    }
    drag.current = null; setConnecting(null); setPointer(null); setHoveredPort(null)
  }
  const startDrag = (event: ReactPointerEvent<SVGGElement>, item: CircuitNode) => {
    const target = event.target as SVGElement
    if (target.closest('[data-output], [data-input-id]')) return
    const [x, y] = coordinates(event as unknown as ReactPointerEvent<SVGSVGElement>), originX = displayX(item, compact)
    event.stopPropagation(); drag.current = { id: item.id, dx: x - originX, dy: y - item.y, startX: x, startY: y, moved: false }
    svgRef.current?.setPointerCapture(event.pointerId)
  }
  const unplug = (id: string) => { setPreset('custom');setWires((current) => current.filter((edge) => edge.from !== id && edge.to !== id)) }
  const nodeValue = (id: string) => result.values[id] === true ? '1' : result.values[id] === false ? '0' : '·'
  const selectedGate = nodes.find((item) => item.id === selectedGateId && !['input', 'output'].includes(item.type))
  const selectedInputs = selectedGate ? wires.filter((edge) => edge.to === selectedGate.id).sort((a,b) => a.input-b.input).map((edge) => ({ id: edge.from, value: result.values[edge.from] })) : []
  const halfAdderVisible = preset === 'half' && !goal && nodes.some((item) => item.id === 'a' && item.type === 'input')
  const halfCarry = nodeValue('cout'), halfSum = nodeValue('sout')

  useEffect(() => {
    const cancelPlacement = (event: KeyboardEvent) => { if (event.key === 'Escape' && placing) { setPlacing(null); setStatusText('Placement cancelled.') } }
    window.addEventListener('keydown', cancelPlacement)
    return () => window.removeEventListener('keydown', cancelPlacement)
  }, [placing])

  return <section className="experiment-surface logic-surface" aria-label="Digital logic circuit laboratory" onPointerDownCapture={hint.dismiss} onKeyDownCapture={hint.dismiss}>
    <div className="logic-header"><span className="exp-eyebrow">COMBINATIONAL LOGIC <i /></span><span className={'logic-status ' + result.status}>{result.status === 'ready' ? 'CIRCUIT RESOLVED' : result.status === 'cycle' ? 'FEEDBACK · UNRESOLVED' : result.status === 'invalid' ? 'INVALID CONNECTION · UNRESOLVED' : 'OPEN INPUT · UNRESOLVED'}</span></div>
    {hint.visible ? <aside className="scene-nudge scene-nudge-logic" id="logic-first-move" role="note"><span>Try this · Logic Laboratory</span><p>Tap a switch. Lit wires carry 1; dim wires carry 0. The starter board already shows that 1 + 1 becomes carry 1 and sum 0.</p><button onClick={hint.dismiss} aria-label="Dismiss first-move hint">×</button></aside> : <button className="scene-nudge-reopen scene-nudge-reopen-logic" onClick={hint.show} aria-label="Show interaction tip" title="Show interaction tip">i</button>}
    <svg ref={svgRef} className={'circuit-canvas' + (placing ? ' placement-active' : '')} viewBox={compact ? '0 0 640 760' : '0 0 1200 760'} role="application" aria-label="Circuit canvas. Click switches to toggle, click to place parts, drag gates to move, and connect output pins to input pins." aria-describedby={hint.visible ? 'logic-first-move' : undefined} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <defs><pattern id="logic-dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#91a9b4" opacity=".15" /></pattern><filter id="wire-glow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter><linearGradient id="logic-wire" x1="0" x2="1"><stop stopColor="#72dbc4"/><stop offset="1" stopColor="#a8e5d6"/></linearGradient></defs>
      <rect width="1200" height="760" fill="url(#logic-dots)" />
      {wires.map((edge, index) => { const a = nodes.find((item) => item.id === edge.from), b = nodes.find((item) => item.id === edge.to); if (!a || !b) return null; const [x1, y1] = outputPort(a,compact), [x2, y2] = inputPort(b, edge.input,compact), middle = (x1 + x2) / 2, value = result.values[edge.from], active = value === true; return <g key={`${edge.from}-${edge.to}-${edge.input}-${index}`} className={active ? 'wire-on' : value === false ? 'wire-zero' : 'wire-unknown'}><path d={`M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`} className="circuit-wire-shadow"/><path d={`M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`} className="circuit-wire"/><circle cx={x1} cy={y1} r="3" className="wire-source-dot"/><text x={middle} y={(y1 + y2) / 2 - 8} className="wire-value">{value === null || value === undefined ? '?' : value ? '1' : '0'}</text></g> })}
      {connecting && pointer && <path d={`M${outputPort(nodes.find((item) => item.id === connecting)!,compact)[0]},${outputPort(nodes.find((item) => item.id === connecting)!,compact)[1]} Q${pointer[0]},${pointer[1]} ${pointer[0]},${pointer[1]}`} className="wire-draft"/>}
      {nodes.map((item) => { const [w, h] = size(item.type,compact), value = result.values[item.id], active = value === true, gate = !['input','output'].includes(item.type); return <g key={item.id} className={'circuit-node node-' + item.type + (active ? ' value-one' : value === false ? ' value-zero' : ' value-unknown') + (selectedGateId === item.id ? ' node-inspected' : '')} transform={`translate(${displayX(item,compact)} ${item.y})`} onPointerDown={(event) => startDrag(event, item)} {...(item.type === 'input' ? { role: 'button' as const, tabIndex: 0, 'aria-pressed': !!item.value, 'aria-label': `Switch ${item.id.toUpperCase()} is ${item.value ? 'on, 1' : 'off, 0'}` } : gate ? { role: 'button' as const, tabIndex: 0, 'aria-label': `${labels[item.type]} gate, output ${nodeValue(item.id)}. Inspect explanation.` } : {})} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && item.type === 'input') { event.preventDefault(); setNodes((current) => current.map((entry) => entry.id === item.id ? { ...entry, value: !entry.value } : entry)); setStatusText(`Switch ${item.id.toUpperCase()} changed · every connected value recalculated.`) } else if ((event.key === 'Enter' || event.key === ' ') && gate) { event.preventDefault(); setSelectedGateId(item.id) } }} onClick={() => { if (gate) setSelectedGateId(item.id) }}>
        {item.type === 'input' ? <><rect className="node-body source-body" width={w} height={h} rx="9"/><text x="12" y="18" className="node-kicker">SWITCH</text><text x="12" y="42" className="node-title">{item.id.toUpperCase()}</text><text x="68" y="39" className="node-bit">{value === true ? '1' : '0'}</text><circle className="output-port" cx={w} cy={h/2} r="5" data-output={item.id}/></> : item.type === 'output' ? <><circle className={'input-port' + (hoveredPort === `${item.id}:0` ? ' wire-target' : '')} cx="0" cy={h/2} r="5" data-input-id={item.id} data-input-index="0"/><rect className="node-body sink-body" width={w} height={h} rx="9"/><text x="12" y="18" className="node-kicker">LAMP</text><text x="12" y="43" className="node-title">{item.id.toUpperCase()}</text><text x="67" y="41" className="node-bit">{nodeValue(item.id)}</text></> : <><rect className="node-body gate-body" width={w} height={h} rx="10"/><text className="gate-symbol" x={w/2} y="43">{item.type === 'not' ? '¬' : item.type === 'and' ? '∧' : item.type === 'or' ? '∨' : item.type === 'xor' ? '⊕' : item.type === 'nand' ? '⊼' : '⊽'}</text><text className="node-title gate-label" x={w/2} y="64">{labels[item.type]}</text>{Array.from({length: item.type === 'not' ? 1 : 2}, (_, port) => <circle key={port} className={'input-port' + (hoveredPort === `${item.id}:${port}` ? ' wire-target' : '')} cx="0" cy={h*(port+1)/(item.type === 'not' ? 2 : 3)} r="5" data-input-id={item.id} data-input-index={port}/>)}<circle className="output-port" cx={w} cy={h/2} r="5" data-output={item.id}/><text x={w-18} y="18" className="gate-readout">{nodeValue(item.id)}</text></>}
        <g className="node-delete" role="button" aria-label={'Remove ' + item.id} tabIndex={0} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); unplug(item.id); setNodes((current) => current.filter((entry) => entry.id !== item.id)) } }} onClick={(event) => { event.stopPropagation(); unplug(item.id); setNodes((current) => current.filter((entry) => entry.id !== item.id)) }}><circle cx={w-11} cy={10} r="9"/><text x={w-11} y={14} textAnchor="middle">×</text></g>
      </g> })}
    </svg>
    <div className="logic-lesson" aria-live="polite">
      {selectedGate ? <><span>{labels[selectedGate.type]} · {selectedGate.id.toUpperCase()}</span><strong>{gateRule(selectedGate.type)}</strong><small>{selectedInputs.length ? selectedInputs.map((entry) => entry.value === true ? '1' : entry.value === false ? '0' : '?').join(selectedGate.type === 'xor' ? ' differs from ' : ' and ') : 'Waiting for input wires'} → {nodeValue(selectedGate.id)}</small></> : goal ? <><span>BUILDING GOAL · {goal.toUpperCase()}</span><strong>{challengePassed ? 'Goal met · the circuit follows the rule for all four switch pairs.' : `Make the lamp turn on ${goal === 'and' ? 'only when both switches are on' : goal === 'or' ? 'when either switch is on' : 'when the switches are different'}.`}</strong><small>{challengePassed ? 'Try changing a switch, then inspect your circuit or continue building.' : 'The goal checks every input combination, not just the current one.'}</small></> : halfAdderVisible ? <><span>THE HALF ADDER · A SMALL BINARY SUM</span><strong>A {nodeValue('a')} + B {nodeValue('b')} → carry {halfCarry}, sum {halfSum}.</strong><small>Read the output as carry then sum: {halfCarry}{halfSum} in binary. When both switches are 1, that is 10.</small></> : <><span>LIVE CIRCUIT</span><strong>{statusText}</strong></>}
    </div>
    <div className="logic-toolbar"><span>{placing ? `PLACE ${labels[placing]}` : 'ADD PART'}</span>{(['and','or','not','xor','nand','nor'] as GateType[]).map((type) => <button key={type} className={placing === type ? 'tool-active' : ''} onClick={() => startPlacement(type)}>{labels[type]}</button>)}<button className={placing === 'input' ? 'tool-active' : ''} onClick={() => startPlacement('input')}>＋ INPUT</button><button className={placing === 'output' ? 'tool-active' : ''} onClick={() => startPlacement('output')}>＋ OUTPUT</button></div>
    <div className="logic-inspector"><span>{statusText}{connecting ? ' · glowing pins accept this wire' : ''}</span><strong>OUTPUTS <i>{nodes.filter((item) => item.type === 'output').map((item) => `${item.id.toUpperCase()} ${nodeValue(item.id)}`).join('   ') || '—'}</i></strong></div>
    <ControlPanel title="Logic Laboratory" note="Boolean gates · topological evaluation" visible={controlsVisible} onClose={onCloseControls}>
      <details className="logic-goal-picker"><summary>Try a build goal</summary><p>Build a switch circuit from the empty board. Each goal is checked against every combination of the two switches.</p><div><button onClick={() => startGoal('and')}>Both switches on · AND</button><button onClick={() => startGoal('or')}>Either switch on · OR</button><button onClick={() => startGoal('xor')}>Different switches · XOR</button></div></details>
      <SelectControl label="Load a circuit" value={preset} options={[...presetNames,...(preset==='custom'?[['custom','Custom circuit'] as [string,string]]:[])]} onChange={load} />
      <SelectControl label="Gate to place" value={tool} options={(['and','or','not','xor','nand','nor'] as GateType[]).map((type) => [type, labels[type]]) as [string, string][]} onChange={(value) => setTool(value as GateType)} />
      <ActionRow><button className="small-action" onClick={() => startPlacement(tool)}>Place {labels[tool]} with pointer</button><button className="small-action" onClick={addAtCentre}>Add {labels[tool]} here</button></ActionRow>
      <details className="logic-keyboard-wire"><summary>Connect parts with the keyboard</summary>
        <SelectControl label="Signal from" value={nodes.some((item) => item.id === wireFrom && item.type !== 'output') ? wireFrom : nodes.find((item) => item.type !== 'output')?.id ?? ''} options={nodes.filter((item) => item.type !== 'output').map((item) => [item.id, `${labels[item.type]} ${item.id.toUpperCase()}`])} onChange={setWireFrom} />
        <SelectControl label="Connect to" value={nodes.some((item) => item.id === wireTo && item.type !== 'input') ? wireTo : nodes.find((item) => item.type !== 'input')?.id ?? ''} options={nodes.filter((item) => item.type !== 'input').map((item) => [item.id, `${labels[item.type]} ${item.id.toUpperCase()}`])} onChange={(value) => { setWireTo(value); setWireInput('0') }} />
        {(nodes.find((item) => item.id === wireTo)?.type !== 'not' && nodes.find((item) => item.id === wireTo)?.type !== 'output') && <SelectControl label="Gate input" value={wireInput} options={[["0", "Input 1"], ["1", "Input 2"]]} onChange={setWireInput} />}
        <button className="small-action" onClick={connectBySelection} disabled={!nodes.some((item) => item.type !== 'output') || !nodes.some((item) => item.type !== 'input')}>Connect selected parts</button>
      </details>
      <ActionRow><button className="small-action" onClick={() => { setNodes([]); setWires([]); setPreset('custom'); setGoal(null); setPlacing(null); setStatusText('Empty board. Choose a part, then click where it should go.') }}>Clear board</button><button className="small-action" onClick={() => setWires((current) => current.slice(0, -1))} disabled={!wires.length}>Undo last wire</button><button className="small-action" onClick={() => load(preset==='custom'?'half':preset)}>Restore preset</button></ActionRow>
      <p className="control-note">Toggle a switch, add parts, and connect ● outputs to ○ inputs. You can also add a part at the centre and connect selected parts with the keyboard. A dotted wire is unknown; feedback loops stay unresolved. Switches and gates work with Tab, Enter and Space.</p>
    </ControlPanel>
  </section>
}
