import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ExperimentControls } from '../types'
import { ActionRow, ControlPanel, SelectControl } from '../components/Controls'
import { evaluateCircuit, type CircuitNode, type CircuitWire, type GateType } from '../simulations/circuit'
import './ExpandedExhibits.css'

type CircuitPreset = 'half' | 'full' | 'mux' | 'adder' | 'custom'
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

export default function LogicLaboratory({ controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const initialPreset = presetNames.some(([key]) => key === stateFromUrl?.preset) ? stateFromUrl?.preset as CircuitPreset : 'half'
  const [preset, setPreset] = useState<CircuitPreset>(initialPreset)
  const [nodes, setNodes] = useState<CircuitNode[]>(() => makeCircuit(initialPreset)[0])
  const [wires, setWires] = useState<CircuitWire[]>(() => makeCircuit(initialPreset)[1])
  const [connecting, setConnecting] = useState<string | null>(null)
  const [pointer, setPointer] = useState<[number, number] | null>(null)
  const [hoveredPort, setHoveredPort] = useState<string | null>(null)
  const [tool, setTool] = useState<GateType>('and')
  const [placing, setPlacing] = useState<GateType | null>(null)
  const [statusText, setStatusText] = useState('Click an input to toggle it · choose a part below, then click the board to place it.')
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 720px)').matches)
  const drag = useRef<{ id: string; dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const result = useMemo(() => evaluateCircuit(nodes, wires), [nodes, wires])
  useEffect(() => { const media=window.matchMedia('(max-width: 720px)'),update=()=>setCompact(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update) }, [])
  useEffect(() => { onShareState({ preset }); }, [preset, onShareState])
  const load = (name: string) => { if(name==='custom')return;const [nextNodes, nextWires] = makeCircuit(name as Exclude<CircuitPreset,'custom'>); setPreset(name as CircuitPreset); setNodes(nextNodes); setWires(nextWires); setConnecting(null); setPlacing(null); setHoveredPort(null); setStatusText('Preset loaded. Click an input to explore its truth table; drag a pin to rewire it.') }
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
    const targetPort = nearest && nearest.distance < 16 ? nearest : null
    const inputId = targetPort?.id ?? target.closest('[data-input-id]')?.getAttribute('data-input-id')
    const inputIndex = targetPort?.index ?? Number(target.closest('[data-input-index]')?.getAttribute('data-input-index'))
    if (connecting && inputId && inputId !== connecting) {
      setWires((current) => [...current.filter((edge) => edge.to !== inputId || edge.input !== inputIndex), { from: connecting, to: inputId, input: inputIndex }])
      setPreset('custom')
      setStatusText('Connected. Signal values update through the circuit from source to output.')
    } else if (connecting) setStatusText('Wire cancelled. Inputs need a source before they resolve to 0 or 1.')
    if (drag.current && !drag.current.moved) {
      const clicked = nodes.find((item) => item.id === drag.current?.id)
      if (clicked?.type === 'input') setNodes((current) => current.map((item) => item.id === clicked.id ? { ...item, value: !item.value } : item))
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

  useEffect(() => {
    const cancelPlacement = (event: KeyboardEvent) => { if (event.key === 'Escape' && placing) { setPlacing(null); setStatusText('Placement cancelled.') } }
    window.addEventListener('keydown', cancelPlacement)
    return () => window.removeEventListener('keydown', cancelPlacement)
  }, [placing])

  return <section className="experiment-surface logic-surface" aria-label="Digital logic circuit laboratory">
    <div className="logic-header"><span className="exp-eyebrow">COMBINATIONAL LOGIC <i /></span><span className={'logic-status ' + result.status}>{result.status === 'ready' ? 'CIRCUIT RESOLVED' : result.status === 'cycle' ? 'FEEDBACK · UNRESOLVED' : result.status === 'invalid' ? 'INVALID CONNECTION · UNRESOLVED' : 'OPEN INPUT · UNRESOLVED'}</span></div>
    <svg ref={svgRef} className={'circuit-canvas' + (placing ? ' placement-active' : '')} viewBox={compact ? '0 0 640 760' : '0 0 1200 760'} role="application" aria-label="Circuit canvas. Click to place parts, drag gates to move, and connect output pins to input pins." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <defs><pattern id="logic-dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#91a9b4" opacity=".15" /></pattern><filter id="wire-glow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter><linearGradient id="logic-wire" x1="0" x2="1"><stop stopColor="#72dbc4"/><stop offset="1" stopColor="#a8e5d6"/></linearGradient></defs>
      <rect width="1200" height="760" fill="url(#logic-dots)" />
      {wires.map((edge, index) => { const a = nodes.find((item) => item.id === edge.from), b = nodes.find((item) => item.id === edge.to); if (!a || !b) return null; const [x1, y1] = outputPort(a,compact), [x2, y2] = inputPort(b, edge.input,compact), middle = (x1 + x2) / 2, value = result.values[edge.from], active = value === true; return <g key={`${edge.from}-${edge.to}-${edge.input}-${index}`} className={active ? 'wire-on' : value === false ? 'wire-zero' : 'wire-unknown'}><path d={`M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`} className="circuit-wire-shadow"/><path d={`M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`} className="circuit-wire"/><circle cx={x1} cy={y1} r="3" className="wire-source-dot"/><text x={middle} y={(y1 + y2) / 2 - 8} className="wire-value">{value === null || value === undefined ? '?' : value ? '1' : '0'}</text></g> })}
      {connecting && pointer && <path d={`M${outputPort(nodes.find((item) => item.id === connecting)!,compact)[0]},${outputPort(nodes.find((item) => item.id === connecting)!,compact)[1]} Q${pointer[0]},${pointer[1]} ${pointer[0]},${pointer[1]}`} className="wire-draft"/>}
      {nodes.map((item) => { const [w, h] = size(item.type,compact), value = result.values[item.id], active = value === true; return <g key={item.id} className={'circuit-node node-' + item.type + (active ? ' value-one' : value === false ? ' value-zero' : ' value-unknown')} transform={`translate(${displayX(item,compact)} ${item.y})`} onPointerDown={(event) => startDrag(event, item)}>
        {item.type === 'input' ? <><rect className="node-body source-body" width={w} height={h} rx="9"/><text x="12" y="18" className="node-kicker">SOURCE</text><text x="12" y="42" className="node-title">{item.id.toUpperCase()}</text><text x="68" y="39" className="node-bit">{value === true ? '1' : '0'}</text><circle className="output-port" cx={w} cy={h/2} r="5" data-output={item.id}/></> : item.type === 'output' ? <><circle className={'input-port' + (hoveredPort === `${item.id}:0` ? ' wire-target' : '')} cx="0" cy={h/2} r="5" data-input-id={item.id} data-input-index="0"/><rect className="node-body sink-body" width={w} height={h} rx="9"/><text x="12" y="18" className="node-kicker">RESULT</text><text x="12" y="43" className="node-title">{item.id.toUpperCase()}</text><text x="67" y="41" className="node-bit">{nodeValue(item.id)}</text></> : <><rect className="node-body gate-body" width={w} height={h} rx="10"/><text className="gate-symbol" x={w/2} y="43">{item.type === 'not' ? '¬' : item.type === 'and' ? '∧' : item.type === 'or' ? '∨' : item.type === 'xor' ? '⊕' : item.type === 'nand' ? '⊼' : '⊽'}</text><text className="node-title gate-label" x={w/2} y="64">{labels[item.type]}</text>{Array.from({length: item.type === 'not' ? 1 : 2}, (_, port) => <circle key={port} className={'input-port' + (hoveredPort === `${item.id}:${port}` ? ' wire-target' : '')} cx="0" cy={h*(port+1)/(item.type === 'not' ? 2 : 3)} r="5" data-input-id={item.id} data-input-index={port}/>)}<circle className="output-port" cx={w} cy={h/2} r="5" data-output={item.id}/><text x={w-18} y="18" className="gate-readout">{nodeValue(item.id)}</text></>}
        <g className="node-delete" role="button" aria-label={'Remove ' + item.id} tabIndex={0} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); unplug(item.id); setNodes((current) => current.filter((entry) => entry.id !== item.id)) }}><circle cx={w-11} cy={10} r="9"/><text x={w-11} y={14} textAnchor="middle">×</text></g>
      </g> })}
    </svg>
    <div className="logic-toolbar"><span>{placing ? `PLACE ${labels[placing]}` : 'ADD PART'}</span>{(['and','or','not','xor','nand','nor'] as GateType[]).map((type) => <button key={type} className={placing === type ? 'tool-active' : ''} onClick={() => startPlacement(type)}>{labels[type]}</button>)}<button className={placing === 'input' ? 'tool-active' : ''} onClick={() => startPlacement('input')}>＋ INPUT</button><button className={placing === 'output' ? 'tool-active' : ''} onClick={() => startPlacement('output')}>＋ OUTPUT</button></div>
    <div className="logic-inspector"><span>{statusText}{connecting ? ' · glowing pins accept this wire' : ''}</span><strong>OUTPUTS <i>{nodes.filter((item) => item.type === 'output').map((item) => `${item.id.toUpperCase()} ${nodeValue(item.id)}`).join('   ') || '—'}</i></strong></div>
    <ControlPanel title="Logic Laboratory" note="Boolean gates · topological evaluation" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Load a circuit" value={preset} options={[...presetNames,...(preset==='custom'?[['custom','Custom circuit'] as [string,string]]:[])]} onChange={load} />
      <SelectControl label="Gate to place" value={tool} options={(['and','or','not','xor','nand','nor'] as GateType[]).map((type) => [type, labels[type]]) as [string, string][]} onChange={(value) => setTool(value as GateType)} />
      <ActionRow><button className="small-action" onClick={() => startPlacement(tool)}>Place {labels[tool]}</button><button className="small-action" onClick={() => startPlacement('input')}>Add input</button><button className="small-action" onClick={() => startPlacement('output')}>Add output</button></ActionRow>
      <ActionRow><button className="small-action" onClick={() => { setNodes([]); setWires([]); setPreset('custom'); setPlacing(null); setStatusText('Empty board. Choose a part, then click where it should go.') }}>Clear board</button><button className="small-action" onClick={() => load(preset==='custom'?'half':preset)}>Restore preset</button></ActionRow>
      <p className="control-note">Click a source to toggle it. Choose a component below, click empty board space to place it, then drag ● output pins to ○ input pins. A dotted wire is unknown; feedback loops stay unresolved.</p>
    </ControlPanel>
  </section>
}
