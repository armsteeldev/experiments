import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExperimentControls } from '../types'
import { ActionRow, ControlPanel, SelectControl } from '../components/Controls'
import { createCpuState, decodeCpuInstruction, executeCpuInstruction, fetchCpuInstruction, parseProgram, type CpuState } from '../simulations/cpu'
import './ExpandedExhibits.css'

const programs: Record<string, { name: string; code: string }> = {
  sum: { name: 'Add two numbers', code: 'LDI A, 7\nLDI B, 5\nADD A, B\nOUT A\nHLT' },
  memory: { name: 'Visit memory', code: 'LDI A, 42\nSTORE 3, A\nLOAD B, 3\nOUT B\nHLT' },
  loop: { name: 'Count by one', code: 'LDI A, 0\nLDI B, 1\nLDI C, 5\nADD A, B\nSUB C, B\nJNZ C, 3\nOUT A\nHLT' },
}
const instructions = ['LDI R, n', 'MOV R, R', 'ADD / SUB / MUL R, R', 'LOAD R, address', 'STORE address, R', 'OUT R', 'JMP address', 'JNZ R, address', 'HLT']
const cloneCpu = (cpu: CpuState): CpuState => ({ ...cpu, registers: { ...cpu.registers }, memory: cpu.memory.slice(), transfer: [...cpu.transfer] })
const dataValue = (value: number) => value.toString().padStart(2, '0')
const byteBits = (value: number) => (value & 255).toString(2).padStart(8, '0')
const addressLabel = (value: number) => value.toString(16).toUpperCase().padStart(2, '0')

function decodeNote(instruction: CpuState['ir']) {
  if (!instruction) return 'The decoder is waiting for an instruction from ROM.'
  const [first, second] = instruction.args
  if (instruction.op === 'LDI') return `LDI copies the constant ${second} into register ${first}.`
  if (['ADD', 'SUB', 'MUL'].includes(instruction.op)) return `${instruction.op} selects registers ${first} and ${second}, then sends both values to the ALU.`
  if (instruction.op === 'LOAD') return `LOAD selects RAM address ${second} and destination register ${first}.`
  if (instruction.op === 'STORE') return `STORE selects register ${second} and RAM address ${first}.`
  if (instruction.op === 'JNZ') return `JNZ checks ${first}; if it is not zero, the next address becomes ${second}.`
  if (instruction.op === 'JMP') return `JMP replaces the next address with ${first}.`
  if (instruction.op === 'HLT') return 'HLT tells the control unit to stop the clock.'
  return `${instruction.op} moves a value between registers.`
}

function executeNote(instruction: CpuState['ir'], before: CpuState, after: CpuState) {
  if (!instruction) return 'No instruction was available to execute.'
  const [first, second] = instruction.args
  if (instruction.op === 'LDI') { const value = after.registers[first?.toUpperCase() ?? 'A']; return `R${first} ← ${Number(second) & 255}  ·  ${byteBits(value)}` }
  if (instruction.op === 'MOV') return `R${first} copies ${before.registers[second?.toUpperCase() ?? 'A']} from R${second}.`
  if (['ADD', 'SUB', 'MUL'].includes(instruction.op)) {
    const a = before.registers[first?.toUpperCase() ?? 'A'], b = before.registers[second?.toUpperCase() ?? 'A'], result = after.registers[first?.toUpperCase() ?? 'A']
    const operation = instruction.op === 'ADD' ? '+' : instruction.op === 'SUB' ? '−' : '×'
    const wrap = instruction.op === 'SUB' && a < b || instruction.op === 'ADD' && a + b > 255 || instruction.op === 'MUL' && a * b > 255
    return `${byteBits(a)} ${operation} ${byteBits(b)} → ${byteBits(result)}  ·  R${first} = ${result}${wrap ? ' (wrapped to 8 bits)' : ''}`
  }
  if (instruction.op === 'LOAD') return `RAM[${second}] = ${after.registers[first?.toUpperCase() ?? 'A']} → R${first}.`
  if (instruction.op === 'STORE') return `R${second} = ${before.registers[second?.toUpperCase() ?? 'A']} → RAM[${first}].`
  if (instruction.op === 'OUT') return `R${first} (${before.registers[first?.toUpperCase() ?? 'A']}) is copied to the output register.`
  if (instruction.op === 'JMP') return `Program counter set to instruction ${addressLabel(after.pc)}.`
  if (instruction.op === 'JNZ') return before.registers[first?.toUpperCase() ?? 'A'] !== 0 ? `R${first} was not zero; program counter jumps to ${addressLabel(after.pc)}.` : `R${first} was zero; execution continues at ${addressLabel(after.pc)}.`
  if (instruction.op === 'HLT') return 'The control unit halted. Reset or load a program to run again.'
  return 'The instruction completed.'
}

export default function InsideMachine({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const initialProgram = typeof stateFromUrl?.program === 'string' ? stateFromUrl.program : 'sum'
  const [example, setExample] = useState(Object.hasOwn(programs, initialProgram) ? initialProgram : 'sum')
  const [source, setSource] = useState(programs[Object.hasOwn(programs, initialProgram) ? initialProgram : 'sum'].code)
  const [cpu, setCpu] = useState<CpuState>(createCpuState)
  const [autoRun, setAutoRun] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'fetch' | 'decode' | 'execute'>('idle')
  const [stepNote, setStepNote] = useState('Press Step instruction to fetch the highlighted line from program memory.')
  const [clock, setClock] = useState(0)
  const [error, setError] = useState('')
  const [trace, setTrace] = useState<string[]>([])
  const phaseTimers = useRef<number[]>([])
  const cpuRef = useRef(cpu); cpuRef.current = cpu
  const program = useMemo(() => { try { return parseProgram(source) } catch { return [] } }, [source])
  useEffect(() => { onShareState({ program: example }); }, [example, onShareState])

  const runCycle = () => {
    if (!program.length) { setError('This program has no valid instructions.'); return }
    const next = cloneCpu(cpuRef.current)
    phaseTimers.current.forEach((timer) => window.clearTimeout(timer)); phaseTimers.current = []
    const address = next.pc, instruction = fetchCpuInstruction(next, program)
    if (!instruction) { setCpu(next); cpuRef.current = next; setError(next.error ?? ''); setStepNote('The program counter reached the end of ROM.'); setPhase('idle'); return }
    setCpu(next); cpuRef.current = next; setError(next.error ?? '')
    setTrace(next.transfer); setPhase('fetch'); setStepNote(`Fetch ${addressLabel(address)}: ${instruction.source} moves from ROM into the instruction register; PC advances to ${addressLabel(next.pc)}.`)
    phaseTimers.current.push(window.setTimeout(() => { const decoding=cloneCpu(cpuRef.current);decodeCpuInstruction(decoding);setCpu(decoding);cpuRef.current=decoding;setTrace(decoding.transfer);setPhase('decode');setStepNote(decodeNote(instruction)) }, 170))
    phaseTimers.current.push(window.setTimeout(() => { const before=cloneCpu(cpuRef.current),executing=cloneCpu(cpuRef.current);executeCpuInstruction(executing);setCpu(executing);cpuRef.current=executing;setError(executing.error??'');setTrace(executing.transfer);setClock((value)=>value+1);setPhase('execute');setStepNote(executing.error ? `Fault · ${executing.error}` : executeNote(instruction,before,executing)) }, 340))
    phaseTimers.current.push(window.setTimeout(() => setPhase('idle'), 740))
  }
  useEffect(() => {
    if (!autoRun || paused || cpu.halted || !program.length || error) return
    const timer = window.setInterval(() => { if (!document.hidden) runCycle() }, 960)
    return () => window.clearInterval(timer)
  }, [autoRun, paused, cpu.halted, program, error])
  useEffect(() => () => { phaseTimers.current.forEach((timer) => window.clearTimeout(timer)) }, [])

  const reset = (run = false) => { phaseTimers.current.forEach((timer)=>window.clearTimeout(timer));phaseTimers.current=[];const fresh = createCpuState(); setCpu(fresh); cpuRef.current = fresh; setClock(0);setError(''); setTrace([]); setPhase('idle');setStepNote('Program reset. Step once to fetch the highlighted instruction.');setAutoRun(run) }
  const loadExample = (name: string) => { if(!programs[name])return;phaseTimers.current.forEach((timer)=>window.clearTimeout(timer));phaseTimers.current=[];setExample(name); setSource(programs[name].code); const fresh = createCpuState(); setCpu(fresh); cpuRef.current = fresh;setClock(0); setError(''); setTrace([]); setPhase('idle');setStepNote(`${programs[name].name} is ready. Step through it to follow the data.`);setAutoRun(false) }
  const currentLine = cpu.ir ? Math.max(0, cpu.pc - 1) : cpu.pc
  const lit = (name: string) => trace.includes(name) ? ' signal-hot' : ''

  return <section className="experiment-surface machine-surface" aria-label="Interactive simplified CPU">
    <div className="machine-backdrop" aria-hidden="true"><div className="machine-orbit orbit-a" /><div className="machine-orbit orbit-b" /><div className="machine-grid" /></div>
    <div className="machine-topline"><span className="exp-eyebrow">A SMALL COMPUTER <i /></span><span>CLOCK <b>{clock.toString().padStart(4, '0')}</b></span><span>{cpu.halted ? 'HALTED' : paused ? 'EXHIBIT PAUSED' : autoRun ? 'RUNNING' : clock === 0 ? 'READY TO STEP' : 'STEP MODE'} <i className={cpu.halted ? 'status-off' : ''} /></span></div>
    <div className="machine-rom-mobile"><span>ROM · CURRENT LINE <small>{addressLabel(currentLine)}</small></span><strong>{program[currentLine]?.source ?? 'Program complete'}</strong></div>
    <div className="cpu-stage">
      <div className="program-window machine-glass">
        <div className="machine-window-label"><span>PROGRAM · ROM</span><span>8-BIT ISA</span></div>
        <div className="machine-code-list">{program.length ? program.map((line, index) => <div key={index} className={(index === currentLine && !cpu.halted ? 'pc-active ' : '') + (cpu.halted && index === currentLine ? 'pc-halted' : '')}><small>{index.toString(16).toUpperCase().padStart(2, '0')}</small><code>{line.source}</code>{index === currentLine && !cpu.halted && <i>PC</i>}</div>) : <p className="machine-code-error">{error || 'Write an instruction to begin.'}</p>}</div>
      </div>
      <div className="processor-core">
        <div className="core-caption"><span>PROCESSING UNIT</span><i>{phase === 'idle' ? 'IDLE BETWEEN CLOCKS' : phase.toUpperCase()}</i></div>
        <svg className="datapath" viewBox="0 0 820 500" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs><filter id="signal-glow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
          <path className={'bus-line' + lit('PC')} d="M95 250 H162 V90 H240" /><path className={'bus-line' + lit('MEMORY')} d="M345 90 H412 V196" />
          <path className={'bus-line' + lit('IR')} d="M510 196 H575 V250" /><path className={'bus-line' + lit('DECODER')} d="M575 292 H510" />
          <path className={'bus-line' + lit('BUS')} d="M240 292 H160 V405 H650 V302" /><path className={'bus-line' + lit('ALU')} d="M412 306 V405" />
          <path className={'bus-line' + lit('OUTPUT')} d="M650 250 H724" />
          {[['PC', 34, 216, `${cpu.pc.toString(16).toUpperCase().padStart(2, '0')}`, 'program counter'], ['MEMORY', 240, 48, 'ROM / RAM', 'memory'], ['IR', 412, 154, cpu.ir?.op ?? '—', 'instruction register'], ['DECODER', 575, 216, phase === 'decode' ? 'DECODE' : 'CONTROL', 'instruction decoder'], ['ALU', 365, 246, cpu.ir?.op && ['ADD', 'SUB', 'MUL'].includes(cpu.ir.op) ? cpu.ir.op : 'ALU', 'arithmetic logic unit'], ['OUTPUT', 700, 216, dataValue(cpu.output), 'output']].map(([key, x, y, value, label]) => <g key={String(key)} className={'machine-block' + (trace.includes(String(key)) ? ' block-active' : '')} transform={`translate(${x} ${y})`}><rect width={key === 'DECODER' ? 116 : 96} height="64" rx="8" /><text className="block-kicker" x="12" y="18">{String(key)}</text><text className="block-value" x="12" y="43">{String(value)}</text><text className="block-caption" x="12" y="82">{String(label)}</text></g>)}
          <path className={'bus-line register-bus' + (['RA','RB','RC','RD'].some((name)=>trace.includes(name)) ? ' signal-hot' : '')} d="M160 405 V472 M160 472 H650 M242 405 V472 M324 405 V472 M406 405 V472 M488 405 V472" />
          {phase !== 'idle' && <text x="410" y="486" textAnchor="middle" className="cycle-phase-label">{phase === 'fetch' ? '01   FETCH INSTRUCTION' : phase === 'decode' ? '02   DECODE OPCODE & OPERANDS' : '03   EXECUTE · COMMIT RESULT'}</text>}
        </svg>
        <div className="current-instruction"><span>INSTRUCTION REGISTER</span><strong>{cpu.ir?.source ?? 'Awaiting first clock'}</strong>{cpu.ir && <small>Next address <b>{cpu.pc.toString(16).toUpperCase().padStart(2, '0')}</b></small>}</div>
      </div>
      <div className="machine-memory machine-glass"><div className="machine-window-label"><span>DATA RAM</span><span>16 × 8 BIT</span></div><div className="memory-cells">{cpu.memory.map((value, i) => <div key={i} className={trace.includes('MEMORY') && cpu.ir?.args.includes(String(i)) ? 'memory-active' : ''}><small>{i.toString(16).toUpperCase()}</small><b>{dataValue(value)}</b></div>)}</div><p>OUTPUT REGISTER <strong>{dataValue(cpu.output)} <i>· {cpu.output}</i></strong></p></div>
    </div>
    <div className="machine-controls"><button className="machine-step" onClick={() => { setAutoRun(false); runCycle() }} disabled={cpu.halted||phase!=='idle'} aria-label="Execute one instruction"><span>▸</span> Step instruction</button><button className="machine-run" onClick={() => setAutoRun((value) => !value)}>{autoRun ? 'Pause clock' : 'Run program'} <span>{autoRun ? 'Ⅱ' : '▶'}</span></button><button className="machine-reset" onClick={() => reset(false)}>Reset</button><span className="machine-cycle-legend"><i className={phase === 'fetch' ? 'phase-active' : ''}>01 FETCH</i><b>→</b><i className={phase === 'decode' ? 'phase-active' : ''}>02 DECODE</i><b>→</b><i className={phase === 'execute' ? 'phase-active' : ''}>03 EXECUTE</i></span></div>
    <div className="machine-live-readout" aria-live="polite">{error ? `FAULT · ${error}` : stepNote}</div>
    <ControlPanel title="Inside the Machine" note="8-bit teaching CPU · 4 registers" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Example program" value={example} options={[...Object.entries(programs).map(([key, value]) => [key, value.name] as [string,string]), ...(example==='custom' ? [['custom','Custom program'] as [string,string]] : [])]} onChange={loadExample} />
      <label className="machine-editor"><span>ASSEMBLY SOURCE</span><textarea spellCheck={false} value={source} onChange={(event) => { setSource(event.target.value); setExample('custom'); reset(false) }} aria-label="Assembly program source" /></label>
      <ActionRow><button className="small-action" onClick={() => { reset(true) }}>Reset & run</button><button className="small-action" onClick={() => { setAutoRun(false); runCycle() }} disabled={cpu.halted||phase!=='idle'}>Step</button><button className="small-action" onClick={() => reset(false)}>Clear state</button></ActionRow>
      <div className="instruction-reference"><span>INSTRUCTION SET</span><p>{instructions.map((instruction) => <code key={instruction}>{instruction}</code>)}</p></div>
      <p className="control-note">Registers hold unsigned 8-bit values. Their tiles show all eight bits and the decimal value. ADD, SUB and MUL wrap modulo 256; jumps address instruction rows. Loading an example leaves it ready to step.</p>
    </ControlPanel>
  </section>
}
