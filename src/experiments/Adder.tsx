import { useEffect, useMemo, useState } from 'react'
import type { ExperimentControls } from '../types'
import { ControlPanel, RangeControl, SelectControl } from '../components/Controls'
import {
  clampTraceIndex,
  createAdderCircuit,
  createAdderTrace,
  evaluateAdder,
  logicPathTo,
  resolvedSignalsAt,
  resolvedWiresAt,
  type AdderArchitecture,
  type AdderGate,
} from '../simulations/adder'
import './ComputingRethink.css'

type Point = { x: number; y: number }
type Box = Point & { width: number; height: number }
type GatePlace = { gate: AdderGate; box: Box }

const maximum = (width: number) => 2 ** width - 1
const subscript = (value: number) => String(value).replace(/\d/g, (digit) => '₀₁₂₃₄₅₆₇₈₉'[Number(digit)])
const bitAt = (value: number, bit: number) => Math.floor(value / 2 ** bit) % 2

function gateTitle(gate: AdderGate) {
  if (gate.role === 'propagate') return gate.bit === 0 && gate.stage === 0 ? 'SUM · P₀' : `P${subscript(gate.bit)}`
  if (gate.role === 'generate') return gate.bit === 0 && gate.stage === 0 ? 'CARRY · G₀' : `G${subscript(gate.bit)}`
  if (gate.role === 'sum') return `SUM · S${subscript(gate.bit)}`
  if (gate.role === 'carry-term') return `PASS · T${subscript(gate.bit)}`
  if (gate.role === 'carry') return `CARRY · C${subscript(gate.bit + 1)}`
  const low = gate.role === 'prefix-term' ? Math.max(0, gate.bit - 2 ** (gate.stage - 1)) : Math.max(0, gate.bit + 1 - 2 ** gate.stage)
  return `${gate.role.startsWith('prefix-propagate') ? 'PASS' : 'GROUP'} · ${subscript(low)}–${subscript(gate.bit)}`
}

function gateExplanation(gate: AdderGate, values: Record<string, boolean>, resolved: Set<string>) {
  if (!gate.inputs.every((input) => resolved.has(input)) || !resolved.has(gate.id)) return 'Waiting for its incoming signals.'
  const [left, right] = gate.inputs.map((input) => Number(values[input]))
  const result = Number(values[gate.id])
  if (gate.role === 'generate') return result ? `Both input bits are 1, so this gate creates carry ${subscript(gate.bit + 1)}.` : 'These two bits do not create a carry.'
  if (gate.role === 'propagate' && gate.bit === 0) return `1 XOR 1 makes sum bit 0. The AND gate beside it sends a carry into the next place.`
  if (gate.role === 'propagate') return `The bits ${left} and ${right} ${left === right ? 'match' : 'differ'}; XOR gives ${result}.`
  if (gate.role === 'sum') return `${left} XOR ${right} gives sum bit ${result}.`
  if (gate.role === 'carry-term') return `${left} AND ${right} ${result ? 'passes' : 'does not pass'} the incoming carry.`
  if (gate.role === 'carry') return `The OR gate combines the new carry ${left} with the passed carry ${right}: ${result}.`
  return `${gate.kind} combines ${left} and ${right} into ${result}.`
}

function placeGates(gates: AdderGate[], mobile: boolean): GatePlace[] {
  const byId = new Map(gates.map((gate) => [gate.id, gate]))
  const levels = new Map<string, number>()
  const levelOf = (gate: AdderGate, visiting = new Set<string>()): number => {
    if (levels.has(gate.id)) return levels.get(gate.id)!
    if (visiting.has(gate.id)) return 0
    const next = new Set(visiting).add(gate.id)
    const parents = gate.inputs.map((input) => byId.get(input)).filter((item): item is AdderGate => !!item)
    const level = parents.length ? Math.max(...parents.map((parent) => levelOf(parent, next))) + 1 : 0
    levels.set(gate.id, level)
    return level
  }
  gates.forEach((gate) => levelOf(gate))
  const rows = new Map<number, number>()
  return gates.map((gate) => {
    const level = levels.get(gate.id) ?? 0
    const row = rows.get(level) ?? 0
    rows.set(level, row + 1)
    return { gate, box: mobile
      ? { x: 154 + level * 174, y: 78 + row * 128, width: 110, height: 72 }
      : { x: 232 + level * 210, y: 98 + row * 173, width: 116, height: 76 } }
  })
}

function pathBetween(from: Point, to: Point) {
  const bend = Math.max(32, Math.abs(to.x - from.x) * .44)
  return `M${from.x} ${from.y} C${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`
}

function Gate({ gate, box, value, known, active, selected, onSelect }: {
  gate: AdderGate; box: Box; value: boolean; known: boolean; active: boolean; selected: boolean; onSelect: () => void
}) {
  return <g className={`adder-gate${known ? value ? ' is-one' : ' is-zero' : ''}${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`}
    transform={`translate(${box.x} ${box.y})`} role="button" tabIndex={0}
    aria-label={`${gate.kind} gate, ${gateTitle(gate)}, ${known ? `output ${Number(value)}` : 'waiting for signal'}`}
    onClick={onSelect} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() } }}>
    <rect className="adder-gate-shell" width={box.width} height={box.height} rx="12" />
    <text className="adder-gate-kind" x="12" y="19">{gate.kind}</text>
    <text className="adder-gate-symbol" x={box.width / 2} y="53" textAnchor="middle">{gate.kind === 'AND' ? '∧' : gate.kind === 'OR' ? '≥1' : gate.kind === 'NOT' ? '¬' : '⊕'}</text>
    <circle className="adder-gate-led" cx={box.width - 15} cy="15" r="4" />
    <text className="adder-gate-bit" x={box.width - 15} y="31" textAnchor="middle">{known ? Number(value) : '·'}</text>
    <text className="adder-gate-label" x={box.width / 2} y="94" textAnchor="middle">{gateTitle(gate)}</text>
  </g>
}

function NumberModule({ label, value, point }: { label: string; value: number; point: Point }) {
  return <g className={`adder-number-module ${value ? 'value-on' : ''}`} transform={`translate(${point.x} ${point.y - 24})`}>
    <rect width="116" height="48" rx="9" />
    <text className="adder-module-label" x="10" y="16">{label}</text>
    <text className="adder-module-value" x="10" y="39">{value}</text>
    <circle cx="110" cy="24" r="4" />
  </g>
}

function ResultModule({ label, value, known, point, carry = false }: { label: string; value: number; known: boolean; point: Point; carry?: boolean }) {
  return <g className={`adder-result-module${carry ? ' carry-result' : ''}${known ? value ? ' value-on' : ' value-off' : ''}`} transform={`translate(${point.x} ${point.y - 29})`}>
    <rect width="94" height="58" rx="10" />
    <text x="47" y="19" textAnchor="middle">{label}</text>
    <text className="adder-result-bit" x="47" y="47" textAnchor="middle">{known ? value : '·'}</text>
  </g>
}

export default function Adder({ paused, controlsVisible, onCloseControls }: ExperimentControls) {
  const [width, setWidth] = useState(4)
  const [architecture, setArchitecture] = useState<AdderArchitecture>('ripple')
  const [aText, setAText] = useState('1')
  const [bText, setBText] = useState('1')
  const [cursor, setCursor] = useState(9999)
  const [runStarted, setRunStarted] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [selectedBit, setSelectedBit] = useState(0)
  const [followTrace, setFollowTrace] = useState(false)
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null)
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 720px)').matches)

  const circuit = useMemo(() => createAdderCircuit(width, architecture), [width, architecture])
  const trace = useMemo(() => createAdderTrace(circuit), [circuit])
  const limit = maximum(width)
  const a = Number(aText), b = Number(bText)
  const validA = Number.isInteger(a) && a >= 0 && a <= limit
  const validB = Number.isInteger(b) && b >= 0 && b <= limit
  const validInputs = validA && validB
  const evaluation = useMemo(() => evaluateAdder(circuit, validA ? a : 0, validB ? b : 0), [circuit, validA, validB, a, b])
  const safeCursor = clampTraceIndex(cursor, trace.length)
  const activeGate = safeCursor > 0 ? circuit.gates[safeCursor - 1] : undefined
  const complete = runStarted && safeCursor === trace.length - 1
  const focusBit = followTrace && activeGate ? activeGate.bit : Math.min(width - 1, selectedBit)
  const resolved = useMemo(() => resolvedSignalsAt(circuit, safeCursor), [circuit, safeCursor])
  const resolvedWires = useMemo(() => resolvedWiresAt(circuit, safeCursor), [circuit, safeCursor])
  const visibleGates = useMemo(() => {
    if (architecture === 'ripple') return circuit.gates.filter((gate) => gate.bit === focusBit)
    const focus = followTrace && activeGate ? activeGate : undefined
    return focus ? circuit.gates.filter((gate) => gate.bit === focus.bit && gate.stage === focus.stage) : circuit.gates.filter((gate) => gate.bit === focusBit && gate.stage === 0)
  }, [architecture, circuit, focusBit, followTrace, activeGate])
  const placedGates = useMemo(() => placeGates(visibleGates, mobile), [visibleGates, mobile])
  const positions = useMemo(() => new Map(placedGates.map(({ gate, box }) => [gate.id, box])), [placedGates])
  const externalSignals = useMemo(() => [...new Set(visibleGates.flatMap((gate) => gate.inputs.filter((signal) => !positions.has(signal))))], [visibleGates, positions])
  const inputPoints = useMemo(() => new Map(externalSignals.map((signal, index) => [signal, { x: mobile ? 8 : 24, y: mobile ? 100 + index * 66 : 116 + index * 86 }])), [externalSignals, mobile])
  const sumSignal = circuit.sumSignals[focusBit]
  const carrySignal = circuit.carrySignals[focusBit + 1]
  const sumKnown = runStarted && resolved.has(sumSignal)
  const carryKnown = runStarted && resolved.has(carrySignal)
  const binaryA = a.toString(2).padStart(width, '0')
  const binaryB = b.toString(2).padStart(width, '0')
  const binarySum = evaluation.wrapped.toString(2).padStart(width, '0')
  const inspectorGate = visibleGates.find((gate) => gate.id === selectedGateId) ?? (followTrace ? activeGate ?? null : null)
  const inspectionPath = inspectorGate ? logicPathTo(circuit, inspectorGate.id) : null

  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)')
    const update = () => setMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!playing || paused) return
    if (safeCursor >= trace.length - 1) { setPlaying(false); return }
    const timer = window.setTimeout(() => setCursor((index) => Math.min(index + 1, trace.length - 1)), 250 / speed)
    return () => window.clearTimeout(timer)
  }, [playing, paused, safeCursor, trace.length, speed])

  const stopForEdit = () => { setPlaying(false); setRunStarted(false); setCursor(0); setFollowTrace(false); setSelectedGateId(null) }
  const calculate = () => {
    if (!validInputs) return
    setSelectedBit(0); setSelectedGateId(null); setCursor(0); setRunStarted(true); setFollowTrace(true); setPlaying(true)
  }
  const play = () => playing ? setPlaying(false) : calculate()
  const step = (delta: number) => {
    setPlaying(false)
    if (delta > 0) setRunStarted(true)
    const next = clampTraceIndex(safeCursor + delta, trace.length)
    setCursor(next); setFollowTrace(true)
  }
  const restart = () => { setCursor(0); setRunStarted(true); setFollowTrace(true); setPlaying(false); setSelectedBit(0); setSelectedGateId(null) }
  const chooseBit = (bit: number) => { setSelectedBit(bit); setSelectedGateId(null); setFollowTrace(false); setPlaying(false) }
  const chooseWidth = (next: number) => {
    setWidth(next)
    const nextLimit = maximum(next)
    if (Number(aText) > nextLimit) setAText(String(nextLimit))
    if (Number(bText) > nextLimit) setBText(String(nextLimit))
    setSelectedBit(0); stopForEdit()
  }
  const chooseArchitecture = (next: AdderArchitecture) => { setArchitecture(next); setSelectedBit(0); stopForEdit() }
  const inputPoint = (signal: string): Point => {
    const fromGate = positions.get(signal)
    if (fromGate) return { x: fromGate.x + fromGate.width, y: fromGate.y + fromGate.height / 2 }
    const point = inputPoints.get(signal) ?? { x: 24, y: 460 }
    return { x: point.x + 116, y: point.y }
  }
  const gateInputPoint = (gate: AdderGate, index: number): Point => {
    const box = positions.get(gate.id)!
    return { x: box.x, y: box.y + (gate.inputs.length > 1 ? index === 0 ? box.height * .34 : box.height * .72 : box.height / 2) }
  }
  const signalValue = (signal: string) => evaluation.values[signal] ?? false
  const outputPosition = (kind: 'sum' | 'carry') => mobile
    ? kind === 'sum' ? { x: 510, y: 156 } : { x: 510, y: 356 }
    : kind === 'sum' ? { x: 906, y: 170 } : { x: 906, y: 368 }
  const runLabel = playing ? 'Pause' : complete ? 'Replay the sum' : 'Calculate'

  return <section className="experiment-surface adder-instrument" aria-label="The Adder, a gate-level arithmetic instrument">
    <header className="adder-instrument-head">
      <div className="adder-wordmark"><span>PRECISION COMPUTING INSTRUMENT</span><h1>THE <em>ADDER</em></h1><p>Watch a sum travel through logic.</p></div>
      <div className="adder-equation-set">
        <label className="adder-number-input"><span>A · DECIMAL</span><input type="number" inputMode="numeric" min="0" max={limit} step="1" value={aText} aria-label="First number" aria-invalid={!validA} onChange={(event) => { setAText(event.target.value); stopForEdit() }} /><code>{validA ? binaryA : '—'}</code></label>
        <span className="adder-equation-sign">+</span>
        <label className="adder-number-input"><span>B · DECIMAL</span><input type="number" inputMode="numeric" min="0" max={limit} step="1" value={bText} aria-label="Second number" aria-invalid={!validB} onChange={(event) => { setBText(event.target.value); stopForEdit() }} /><code>{validB ? binaryB : '—'}</code></label>
        <span className="adder-equation-sign">=</span>
        <div className={`adder-answer ${complete ? 'answer-ready' : ''}`} aria-live="polite"><span>RESULT</span><strong>{complete && validInputs ? evaluation.unsignedResult : '—'}</strong><code>{complete && validInputs ? `${evaluation.carryOut ? '1 ' : ''}${binarySum}` : '·'.repeat(width)}</code></div>
        <button className="adder-run-button" onClick={play} disabled={!validInputs} aria-label={playing ? 'Pause calculation' : complete ? 'Replay calculation' : 'Calculate'}><span>{playing ? 'Ⅱ' : '▶'}</span>{runLabel}</button>
      </div>
      <div className="adder-quick-examples" aria-label="Try an example">
        <span>TRY</span>
        {[['1', '1'], ['5', '3'], ['7', '9']].map(([left, right]) => <button key={`${left}-${right}`} className={aText === left && bText === right ? 'example-current' : ''} onClick={() => { setAText(left); setBText(right); setSelectedBit(0); stopForEdit() }}>{left} + {right}</button>)}
      </div>
    </header>

    <div className="adder-machine-display">
      <div className="adder-display-caption"><span><i /> THE GATE DECK</span><span>{width}-BIT · {architecture === 'ripple' ? 'CARRY WALKS LEFT' : 'CARRIES RESOLVE IN GROUPS'}</span></div>
      <svg className="adder-gate-board" viewBox={mobile ? '0 0 620 500' : '0 0 1000 500'} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${architecture === 'ripple' ? 'Ripple carry' : 'Kogge–Stone'} gate network at bit ${focusBit}`}>
        <defs>
          <pattern id="adder-grid" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#aecfc4" opacity=".14" /></pattern>
          <filter id="adder-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <rect x="5" y="5" width={mobile ? 610 : 990} height="490" rx="22" fill="url(#adder-grid)" />
        <text className="adder-board-index" x={mobile ? 22 : 34} y="38">BIT {String(focusBit).padStart(2, '0')} <tspan>· {focusBit === 0 ? 'ONES PLACE' : 'NEXT PLACE LEFT'}</tspan></text>
        <text className="adder-board-index" x={mobile ? 598 : 966} y="38" textAnchor="end">{String(focusBit).padStart(2, '0')} / {String(width - 1).padStart(2, '0')}</text>
        {circuit.wires.map((wire) => {
          const gate = visibleGates.find((item) => item.id === wire.to)
          if (!gate) return null
          const start = inputPoint(wire.from), end = gateInputPoint(gate, wire.inputIndex)
          const known = resolvedWires.has(wire.id)
          const selectedPath = inspectionPath?.wires.has(wire.id) ?? false
          const active = activeGate?.id === wire.to || activeGate?.inputs.includes(wire.from)
          const id = `adder-wire-${wire.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
          return <g key={wire.id} className={`adder-wire${known ? signalValue(wire.from) ? ' wire-high' : ' wire-low' : ' wire-waiting'}${wire.from.startsWith('C') || wire.from.startsWith('generate_') || wire.from.startsWith('prefix_carry_') ? ' wire-carry' : ''}${active && playing ? ' wire-active' : ''}${selectedPath ? ' wire-inspected' : ''}`}>
            <path className="adder-wire-halo" d={pathBetween(start, end)} />
            <path className="adder-wire-line" d={pathBetween(start, end)} />
            <path id={id} className="adder-wire-motion" d={pathBetween(start, end)} />
            {active && playing && <circle className="adder-packet" r="5" filter="url(#adder-glow)"><animateMotion key={`${wire.id}-${safeCursor}`} dur={`${Math.max(240, 560 / speed)}ms`} fill="freeze"><mpath href={`#${id}`} /></animateMotion></circle>}
          </g>
        })}
        {externalSignals.map((signal, index) => <NumberModule key={signal} label={signal} value={Number(signalValue(signal))} point={inputPoints.get(signal) ?? { x: 24, y: 116 + index * 86 }} />)}
        {placedGates.map(({ gate, box }) => <Gate key={gate.id} gate={gate} box={box} value={evaluation.values[gate.id]} known={resolved.has(gate.id)} active={activeGate?.id === gate.id && playing} selected={selectedGateId === gate.id} onSelect={() => { setSelectedBit(gate.bit); setFollowTrace(false); setPlaying(false); setSelectedGateId(gate.id) }} />)}
        <g className="adder-output-wires"><path d={pathBetween(inputPoint(sumSignal), outputPosition('sum'))} /><path d={pathBetween(inputPoint(carrySignal), outputPosition('carry'))} /></g>
        <ResultModule label={`SUM S${subscript(focusBit)}`} value={Number(evaluation.values[sumSignal])} known={sumKnown} point={outputPosition('sum')} />
        <ResultModule label={`CARRY C${subscript(focusBit + 1)}`} value={Number(evaluation.values[carrySignal])} known={carryKnown} carry point={outputPosition('carry')} />
      </svg>
      <div className="adder-bit-readout" style={{ gridTemplateColumns: `30px repeat(${width}, minmax(34px, 1fr)) 30px` }} role="group" aria-label="Inspect binary places">
        <span className="readout-side-label">A</span>
        {Array.from({ length: width }, (_, index) => width - 1 - index).map((index) => {
          const known = runStarted && resolved.has(circuit.sumSignals[index])
          return <button key={index} onClick={() => chooseBit(index)} className={`adder-place${index === focusBit ? ' place-selected' : ''}${known ? ' place-ready' : ''}`} aria-label={`Inspect bit ${index}`} aria-pressed={index === focusBit}>
            <small>{subscript(index)} · {2 ** index}</small><b>{bitAt(a, index)}</b><i>{bitAt(b, index)}</i><span>{known ? Number(evaluation.sumBits[index]) : '·'}</span>
          </button>
        })}
        <span className="readout-side-label">B</span>
        <div className="adder-carry-path" aria-label="Carry signals move from the ones place to the left">
          {evaluation.carries.map((carry, index) => {
            const known = index === 0 || runStarted && resolved.has(circuit.carrySignals[index])
            return <span key={index} className={`${known && carry ? 'carry-lit' : ''}${known ? ' carry-known' : ''}`} title={`Carry C${index}: ${known ? Number(carry) : 'not resolved'}`}><small>C{subscript(index)}</small><b>{known ? Number(carry) : '·'}</b></span>
          })}
          <em>{complete ? `CARRY OUT ${Number(evaluation.carryOut)}` : 'CARRY PATH'}</em>
        </div>
      </div>
    </div>

    <div className="adder-run-console">
      <div className="adder-console-label"><span className="console-lamp" /><strong>{complete ? `${a} + ${b} = ${evaluation.unsignedResult}` : playing ? `SIGNAL ${safeCursor} OF ${trace.length - 1}` : runStarted ? 'PAUSED · READY TO STEP' : 'SET THE INPUTS, THEN CALCULATE'}</strong><small aria-live="polite">{inspectorGate ? gateExplanation(inspectorGate, evaluation.values, resolved) : complete ? 'Each lit gate shows the value produced by the real circuit.' : 'Follow each gate as the bits move through the machine.'}</small></div>
      <div className="adder-transport-actions">
        <button onClick={() => step(-1)} disabled={!runStarted || safeCursor === 0} aria-label="Step backward">←</button>
        <button className="transport-play" onClick={play} aria-label={playing ? 'Pause calculation' : complete ? 'Replay calculation' : 'Run calculation'}>{playing ? 'Ⅱ' : '▶'}</button>
        <button onClick={() => step(1)} disabled={complete} aria-label="Step forward">→</button>
        <button onClick={restart} aria-label="Restart calculation">↺</button>
        <div className="adder-progress" aria-label={`${safeCursor} of ${trace.length - 1} gates resolved`}><i style={{ width: `${runStarted ? safeCursor / Math.max(1, trace.length - 1) * 100 : 0}%` }} /></div>
      </div>
      <button className="adder-detail-button" onClick={() => controlsVisible ? onCloseControls() : document.querySelector<HTMLButtonElement>('[aria-label="Toggle experiment controls"]')?.click()} aria-expanded={controlsVisible}>CIRCUIT SETTINGS</button>
    </div>

    <ControlPanel title="The Adder" note="Actual gate-level arithmetic" visible={controlsVisible} onClose={onCloseControls}>
      <p className="control-note">Every gate and wire is part of the evaluated circuit. Playback reveals the deterministic gate trace; the timing is an illustration of the real signal dependencies.</p>
      <SelectControl label="Circuit width" value={String(width)} options={[["4", "4-bit · 0–15"], ["8", "8-bit · 0–255"], ["16", "16-bit · 0–65,535"]]} onChange={(value) => chooseWidth(Number(value))} />
      <SelectControl label="Carry architecture" value={architecture} options={[["ripple", "Ripple carry"], ["lookahead", "Kogge–Stone look-ahead"]]} onChange={(value) => chooseArchitecture(value as AdderArchitecture)} />
      <RangeControl label="Signal speed" value={speed} min={0.5} max={2} step={0.5} onChange={setSpeed} format={(value) => `${value}×`} />
      <details className="adder-advanced-reading"><summary>Read the signed interpretation</summary><p>Two’s complement interprets the highest bit as a sign. {validInputs ? `${binaryA} is ${evaluation.signedA}; ${binaryB} is ${evaluation.signedB}. The wrapped result is ${evaluation.signedResult}. Signed overflow: ${evaluation.signedOverflow ? 'yes' : 'no'}.` : 'Enter values within the selected width to inspect signed overflow.'}</p></details>
      <p className="control-note">Ripple carry passes each carry to the next place. Kogge–Stone builds group carries over spans of 1, 2, 4 and 8. Select any place on the rail, then inspect a gate to trace its contributing logic.</p>
    </ControlPanel>
  </section>
}
