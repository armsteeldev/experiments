import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExperimentControls } from '../types'
import { ControlPanel, SelectControl } from '../components/Controls'
import { createCpuDemoProgram, createCpuState, decodeCpuInstruction, executeCpuInstruction, fetchCpuInstruction, parseProgram, type CpuDemoTask, type CpuState, type Instruction } from '../simulations/cpu'
import { boundedStateInteger } from '../lib/experimentState'
import './ComputingRethink.css'

type Task = CpuDemoTask | 'custom'
type OperationReadout = { heading: string; detail: string }

const taskNames: Record<Task, string> = {
  sum: 'Add two numbers', compare: 'Are they equal?', memory: 'Store and find', count: 'Count to five', custom: 'Your program',
}
const demoTasks: readonly CpuDemoTask[] = ['sum', 'compare', 'memory', 'count']
const MAX_SHARED_PROGRAM_LENGTH = 2000
const importedProgram = (value: unknown) => typeof value === 'string' && value.length <= MAX_SHARED_PROGRAM_LENGTH ? value : null
const byteBits = (value: number) => (value & 255).toString(2).padStart(8, '0')
const byteText = (value: number) => String(value & 255).padStart(2, '0')
const cloneCpu = (cpu: CpuState): CpuState => ({ ...cpu, registers: { ...cpu.registers }, memory: cpu.memory.slice(), transfer: [...cpu.transfer] })

function instructionLine(instruction: Instruction | undefined, cpu: CpuState, phase: string) {
  if (!instruction) return 'Ready for its first instruction.'
  const [left, right] = instruction.args
  if (phase === 'fetch') return `The machine finds the next instruction in memory.`
  if (phase === 'decode') {
    if (instruction.op === 'LDI') return `Put ${right} into number holder ${left}.`
    if (instruction.op === 'ADD') return `Add the numbers held in ${left} and ${right}.`
    if (instruction.op === 'SUB') return `Subtract the number in ${right} from ${left}.`
    if (instruction.op === 'OUT') return `Copy the number in ${left} to the display.`
    if (instruction.op === 'STORE') return `Save the number in ${right} to memory place ${left}.`
    if (instruction.op === 'LOAD') return `Bring the number at memory place ${right} into ${left}.`
    if (instruction.op === 'JNZ') return `If ${left} is not zero, jump to line ${right}.`
    if (instruction.op === 'JMP') return `Jump to line ${left}.`
    if (instruction.op === 'HLT') return 'Finish the task and stop.'
    return `Move a number from ${right} to ${left}.`
  }
  if (instruction.op === 'LDI') return `Holder ${left} now keeps ${cpu.registers[left?.toUpperCase() ?? 'A']}.`
  if (instruction.op === 'ADD') return `The math unit adds ${cpu.registers[left?.toUpperCase() ?? 'A']} and ${cpu.registers[right?.toUpperCase() ?? 'B']}.`
  if (instruction.op === 'SUB') return `The math unit subtracts the two stored numbers.`
  if (instruction.op === 'OUT') return `The display now shows ${cpu.output}.`
  if (instruction.op === 'STORE') return `Memory place ${left} now keeps ${cpu.memory[Number(left)]}.`
  if (instruction.op === 'LOAD') return `Holder ${left} received ${cpu.registers[left?.toUpperCase() ?? 'B']} from memory.`
  if (instruction.op === 'JNZ') return cpu.registers[left?.toUpperCase() ?? 'A'] !== 0 ? 'The number was not zero, so the machine jumped back.' : 'The number reached zero, so the machine moved on.'
  if (instruction.op === 'HLT') return 'The computer has finished this task.'
  return `The instruction completed.`
}

function operationReadout(instruction: Instruction, before: CpuState, after: CpuState, task: Task): OperationReadout {
  const [left, right] = instruction.args
  const a = before.registers[left?.toUpperCase() ?? 'A'] ?? 0
  const b = before.registers[right?.toUpperCase() ?? 'B'] ?? 0
  if (instruction.op === 'ADD') return { heading: `${a} + ${b} = ${after.registers[left?.toUpperCase() ?? 'A']}`, detail: 'The ALU combined the two register values and sent the sum back to A.' }
  if (instruction.op === 'SUB') return { heading: `${a} − ${b} = ${after.registers[left?.toUpperCase() ?? 'A']}`, detail: 'Subtraction leaves zero when both numbers match. The next instruction checks that result.' }
  if (instruction.op === 'LDI') return { heading: `${left} holds ${after.registers[left?.toUpperCase() ?? 'A']}`, detail: 'A number was loaded into a register so the machine can use it later.' }
  if (instruction.op === 'OUT') return { heading: `Output · ${after.output}`, detail: 'The machine copied a stored number to its result display.' }
  if (instruction.op === 'STORE') return { heading: `Saved ${before.registers[right?.toUpperCase() ?? 'A']} in memory`, detail: `Memory place ${left} now keeps the value, even after it leaves register A.` }
  if (instruction.op === 'LOAD') return { heading: `Found ${after.registers[left?.toUpperCase() ?? 'B']} in memory`, detail: `The saved value was brought from memory place ${right} into register ${left}.` }
  if (instruction.op === 'JNZ') return { heading: after.registers[left?.toUpperCase() ?? 'A'] !== 0 ? 'The loop continues' : 'The loop is finished', detail: `The machine checked ${left} and chose its next line from the value it found.` }
  if (instruction.op === 'HLT' && task === 'compare') return after.output === 1
    ? { heading: 'They match', detail: 'The subtraction left zero, so the computer sent 1 to the display.' }
    : { heading: 'They differ', detail: `The subtraction left ${before.registers.A}; the computer sent 0 to the display.` }
  if (instruction.op === 'HLT') return { heading: 'Task complete', detail: `The output display holds ${after.output}.` }
  return { heading: instruction.source, detail: 'The control unit moved to the next instruction.' }
}

export default function InsideMachine({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const savedSource = importedProgram(stateFromUrl?.source)
  const initialDemoTask = demoTasks.includes(stateFromUrl?.program as CpuDemoTask) ? stateFromUrl?.program as CpuDemoTask : 'sum'
  const initialTask: Task = savedSource !== null ? 'custom' : initialDemoTask
  const initialA = boundedStateInteger(stateFromUrl?.a, 7, 0, 255)
  const initialB = boundedStateInteger(stateFromUrl?.b, 5, 0, 255)
  const [task, setTask] = useState<Task>(initialTask)
  const [numberA, setNumberA] = useState(initialA)
  const [numberB, setNumberB] = useState(initialB)
  const [source, setSource] = useState(() => savedSource ?? createCpuDemoProgram(initialDemoTask, initialA, initialB))
  const [cpu, setCpu] = useState<CpuState>(createCpuState)
  const [phase, setPhase] = useState<'idle' | 'fetch' | 'decode' | 'execute'>('idle')
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const [autoRun, setAutoRun] = useState(false)
  const [clock, setClock] = useState(0)
  const [lineNote, setLineNote] = useState('Choose a task or run this example to see how the computer works.')
  const [readout, setReadout] = useState<OperationReadout>(() => initialTask === 'sum'
    ? { heading: `${initialA} + ${initialB} = ?`, detail: 'Numbers wait in registers until the math unit combines them.' }
    : { heading: taskNames[initialTask], detail: 'The machine is ready to begin at its first instruction.' })
  const [trace, setTrace] = useState<string[]>([])
  const [error, setError] = useState('')
  const timers = useRef<number[]>([])
  const cpuRef = useRef(cpu)
  cpuRef.current = cpu
  const program = useMemo(() => { try { return parseProgram(source) } catch { return [] } }, [source])
  const line = cpu.ir ? Math.max(0, cpu.pc - 1) : cpu.pc
  const highlighted = (key: string) => trace.includes(key) ? ' is-live' : ''

  useEffect(() => { onShareState({ program: task, a: numberA, b: numberB, ...(task === 'custom' ? { source } : {}) }); }, [task, numberA, numberB, source, onShareState])
  useEffect(() => () => { timers.current.forEach((timer) => window.clearTimeout(timer)) }, [])

  const reset = (keepTask = true) => {
    timers.current.forEach((timer) => window.clearTimeout(timer)); timers.current = []
    const fresh = createCpuState()
    cpuRef.current = fresh; setCpu(fresh); setClock(0); setTrace([]); setPhase('idle'); setError(''); setAutoRun(false)
    setLineNote(keepTask ? 'Ready. Step once to follow the computer’s next move.' : 'Choose a task, then run it to see information move through the machine.')
    if (task === 'sum') setReadout({ heading: `${numberA} + ${numberB} = ?`, detail: 'Both numbers are waiting in the instruction memory.' })
    else setReadout({ heading: `${taskNames[task]}`, detail: 'The machine is ready for a new run.' })
  }

  const chooseTask = (next: Exclude<Task, 'custom'>) => {
    setTask(next); setSource(createCpuDemoProgram(next, numberA, numberB))
    timers.current.forEach((timer) => window.clearTimeout(timer)); timers.current = []
    const fresh = createCpuState(); cpuRef.current = fresh; setCpu(fresh); setClock(0); setTrace([]); setPhase('idle'); setAutoRun(false); setError('')
    setReadout(next === 'sum' ? { heading: `${numberA} + ${numberB} = ?`, detail: 'Two values, two number holders, and one arithmetic unit.' } : { heading: taskNames[next], detail: 'This task runs as real instructions inside the same little computer.' })
    setLineNote('Ready to run. Step slowly or watch the whole task.')
  }

  const changeNumber = (which: 'a' | 'b', next: number) => {
    const value = Math.max(0, Math.min(255, Number.isFinite(next) ? Math.floor(next) : 0))
    const a = which === 'a' ? value : numberA, b = which === 'b' ? value : numberB
    if (which === 'a') setNumberA(value); else setNumberB(value)
    if (task !== 'custom') { setSource(createCpuDemoProgram(task, a, b)); reset(true); setReadout({ heading: task === 'sum' ? `${a} + ${b} = ?` : taskNames[task], detail: 'Change a number, then run the new instructions.' }) }
  }

  const runCycle = () => {
    if (!program.length) { setError('The program has no valid instructions.'); return }
    const next = cloneCpu(cpuRef.current), address = next.pc
    const instruction = fetchCpuInstruction(next, program)
    if (!instruction) { setCpu(next); cpuRef.current = next; setPhase('idle'); setLineNote('The program has reached the end of its memory.'); setAutoRun(false); return }
    setCpu(next); cpuRef.current = next; setTrace(next.transfer); setError(''); setPhase('fetch')
    setLineNote(`Finding instruction ${address + 1} in program memory.`)
    timers.current.forEach((timer) => window.clearTimeout(timer)); timers.current = []
    timers.current.push(window.setTimeout(() => {
      const decoding = cloneCpu(cpuRef.current); decodeCpuInstruction(decoding)
      cpuRef.current = decoding; setCpu(decoding); setTrace(decoding.transfer); setPhase('decode')
      setLineNote(instructionLine(instruction, decoding, 'decode'))
    }, 210))
    timers.current.push(window.setTimeout(() => {
      const before = cloneCpu(cpuRef.current), executing = cloneCpu(cpuRef.current)
      executeCpuInstruction(executing)
      cpuRef.current = executing; setCpu(executing); setTrace(executing.transfer); setClock((value) => value + 1); setPhase('execute')
      setError(executing.error ?? '')
      setLineNote(instructionLine(instruction, executing, 'execute'))
      setReadout(operationReadout(instruction, before, executing, task))
      if (executing.halted || executing.error) setAutoRun(false)
    }, 430))
    timers.current.push(window.setTimeout(() => setPhase('idle'), 770))
  }

  const runCycleRef = useRef(runCycle)
  runCycleRef.current = runCycle

  useEffect(() => {
    if (!autoRun || paused || cpu.halted || error || !program.length) return
    const timer = window.setInterval(() => { if (!document.hidden && phaseRef.current === 'idle') runCycleRef.current() }, 880)
    return () => window.clearInterval(timer)
  }, [autoRun, paused, cpu.halted, error, program])

  const currentInstruction = program[line]
  const stepDisabled = cpu.halted || phase !== 'idle' || !program.length
  const taskCards: { key: Exclude<Task, 'custom'>; title: string; symbol: string; hint: string }[] = [
    { key: 'sum', title: 'Add two numbers', symbol: '+', hint: `${numberA} + ${numberB}` },
    { key: 'compare', title: 'Check if they match', symbol: '=', hint: `${numberA} and ${numberB}` },
    { key: 'memory', title: 'Store and find', symbol: '↔', hint: `save ${numberA} · find it again` },
    { key: 'count', title: 'Count to five', symbol: '↗', hint: 'make a little loop' },
  ]

  return <section className="experiment-surface machine-experience" aria-label="Inside the Machine, an observable miniature computer">
    <header className="machine-intro">
      <div><span className="machine-kicker"><i /> A LITTLE COMPUTER</span><h1>Give it a <em>job.</em></h1><p>Pick a task, then watch the machine figure it out.</p></div>
      <div className="machine-status"><span>CLOCK</span><strong>{String(clock).padStart(2, '0')}</strong><i className={phase !== 'idle' ? 'clock-running' : ''} /></div>
    </header>

    <div className="machine-task-picker" role="group" aria-label="Choose a computer task">
      {taskCards.map((card) => <button key={card.key} className={task === card.key ? 'task-chosen' : ''} aria-pressed={task === card.key} onClick={() => chooseTask(card.key)}>
        <span>{card.symbol}</span><strong>{card.title}</strong><small>{card.hint}</small>
      </button>)}
      {task === 'sum' || task === 'compare' ? <div className="machine-task-numbers">
        <label>FIRST NUMBER<input type="number" min="0" max="255" value={numberA} aria-label="First task number" onChange={(event) => changeNumber('a', Number(event.target.value))} /></label>
        <b>{task === 'sum' ? '+' : 'vs'}</b>
        <label>SECOND NUMBER<input type="number" min="0" max="255" value={numberB} aria-label="Second task number" onChange={(event) => changeNumber('b', Number(event.target.value))} /></label>
      </div> : null}
    </div>

    <div className="machine-main-display">
      <div className="machine-program-card">
        <span className="machine-section-label">NEXT MOVE <i>·</i> LINE {String(line + 1).padStart(2, '0')}</span>
        <strong>{phase === 'idle' ? instructionLine(currentInstruction, cpu, 'decode') : lineNote}</strong>
        <small className="machine-actual-instruction">{currentInstruction?.source ?? 'Program finished'} <i>·</i> actual instruction</small>
        <div className="machine-phase-track" aria-label={`Current stage: ${phase}`}>
          <span className={phase === 'fetch' ? 'phase-current' : phase === 'decode' || phase === 'execute' ? 'phase-done' : ''}>FIND</span><i /><span className={phase === 'decode' ? 'phase-current' : phase === 'execute' ? 'phase-done' : ''}>UNDERSTAND</span><i /><span className={phase === 'execute' ? 'phase-current' : ''}>DO IT</span>
        </div>
      </div>

      <div className={`machine-data-flow${phase !== 'idle' ? ' flow-moving' : ''}`}>
        <svg className="machine-connection-map" viewBox="0 0 1000 190" preserveAspectRatio="none" aria-hidden="true">
          <path className={'machine-link' + highlighted('RA')} d="M100 90 C260 90 270 90 382 90" />
          <path className={'machine-link' + highlighted('RB')} d="M100 145 C260 145 270 112 382 112" />
          <path className={'machine-link alu-link' + highlighted('ALU')} d="M568 100 H710" />
          <path className={'machine-link output-link' + highlighted('OUTPUT')} d="M865 100 H978" />
          {phase !== 'idle' && <circle className="machine-data-pulse" r="8"><animateMotion dur=".76s" repeatCount="1" fill="freeze"><mpath href={phase === 'fetch' ? '#machine-fetch-path' : phase === 'decode' ? '#machine-decode-path' : '#machine-execute-path'} /></animateMotion></circle>}
          <path id="machine-fetch-path" d="M62 24 H240 V70" />
          <path id="machine-decode-path" d="M240 70 H440 V95" />
          <path id="machine-execute-path" d="M440 95 H900" />
        </svg>
        <div className="machine-register-pair">
          {(['A', 'B'] as const).map((name) => <div key={name} className={`machine-register${highlighted(`R${name}`)}`}>
            <span>HOLDER {name}</span><strong>{cpu.registers[name]}</strong><code>{byteBits(cpu.registers[name])}</code><small>{cpu.registers[name].toString(16).padStart(2, '0').toUpperCase()} · 8 BITS</small>
          </div>)}
        </div>
        <div className={`machine-alu${highlighted('ALU')}`}>
          <span>MATH UNIT <i>·</i> ALU</span><strong>{phase === 'execute' && cpu.ir?.op ? cpu.ir.op : 'READY'}</strong>
          <small>{readout.heading}</small><b className="alu-led" />
        </div>
        <div className={`machine-output${highlighted('OUTPUT')}`}><span>RESULT</span><strong>{byteText(cpu.output)}</strong><small>{cpu.output} <i>·</i> decimal</small></div>
      </div>

      <div className="machine-memory-peek">
        <span>DATA MEMORY <small>16 places</small></span>
        <div>{[0, 1, 2, 3, 4, 5, 6, 7].map((address) => <i key={address} className={cpu.memory[address] ? 'memory-has-value' : ''}><small>{address.toString(16).toUpperCase()}</small><b>{byteText(cpu.memory[address])}</b></i>)}</div>
        <em>{readout.detail}</em>
      </div>
    </div>

    <div className="machine-actions">
      <div className="machine-action-primary">
        <button className="machine-step-button" onClick={runCycle} disabled={stepDisabled} aria-label="Step through one real CPU instruction">Step once <span>→</span></button>
        <button className="machine-run-button" onClick={() => { if (cpu.halted) reset(true); setAutoRun((value) => !value) }} disabled={!program.length || !!error}>{autoRun ? 'Pause the machine' : 'Run the whole task'} <span>{autoRun ? 'Ⅱ' : '▶'}</span></button>
        <button className="machine-reset-button" onClick={() => reset(true)} aria-label="Reset the computer">↺</button>
      </div>
      <p className="machine-live-note" aria-live="polite">{error ? `The machine stopped · ${error}` : lineNote}</p>
      <button className="machine-hood-button" onClick={() => controlsVisible ? onCloseControls() : document.querySelector<HTMLButtonElement>('[aria-label="Toggle experiment controls"]')?.click()} aria-expanded={controlsVisible}>OPEN THE HOOD</button>
    </div>

    <ControlPanel title="Inside the Machine" note="8-bit processor · real instruction execution" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Load a task" value={task} options={[["sum", "Add two numbers"], ["compare", "Check whether equal"], ["memory", "Store and retrieve"], ["count", "Count in a loop"], ...(task === 'custom' ? [["custom", "Your program"] as [string, string]] : [])]} onChange={(value) => value !== 'custom' && chooseTask(value as Exclude<Task, 'custom'>)} />
      <div className="machine-inspect-values"><span>REGISTERS</span>{(['A', 'B', 'C', 'D'] as const).map((name) => <i key={name}>R{name}<b>{byteText(cpu.registers[name])} · {byteBits(cpu.registers[name])}</b></i>)}</div>
      <div className="machine-inspect-memory"><span>ALL 16 MEMORY PLACES</span><div>{cpu.memory.map((value, address) => <i key={address}><small>{address.toString(16).toUpperCase()}</small><b>{byteText(value)}</b></i>)}</div></div>
      <label className="machine-assembly-editor"><span>EDIT THE ACTUAL INSTRUCTIONS</span><textarea spellCheck={false} maxLength={MAX_SHARED_PROGRAM_LENGTH} value={source} aria-label="Assembly program source" onChange={(event) => { setTask('custom'); setSource(event.target.value); reset(true) }} /></label>
      <p className="control-note">This is the same program the machine executes. LDI loads a number, ADD and SUB use the ALU, STORE and LOAD move data through RAM, JNZ repeats a loop, and OUT updates the display. Values are unsigned 8-bit numbers and wrap at 256. Links preserve up to 2,000 characters of custom source and restart at line one.</p>
    </ControlPanel>
  </section>
}
